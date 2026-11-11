import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Navigator, OrbitTarget } from './camera/navigator';
import { Cosmology } from './cosmology/friedmann';
import { U_NOW, uToYears } from './cosmology/timeline';
import { applyVisualState, Backdrop, GalaxyLayer, makeSharedUniforms, MatterLayer } from './render/layers';
import { effectivePosition } from './sim/kinematics';
import { generateUniverse } from './sim/structure';
import { visualState, VisualState } from './sim/visual';
import { Hud } from './ui/hud';

// ---------------------------------------------------------------- quality tiers
type Tier = 'high' | 'mid' | 'low';
const TIERS: Record<Tier, { n: number; galaxies: number; dpr: number; msaa: number }> = {
  high: { n: 64, galaxies: 6000, dpr: 2, msaa: 4 },
  mid: { n: 52, galaxies: 3600, dpr: 1.5, msaa: 0 },
  low: { n: 40, galaxies: 2200, dpr: 1.25, msaa: 0 },
};
const params = new URLSearchParams(location.search);
const touch = matchMedia('(pointer: coarse)').matches;
function detectTier(): Tier {
  const forced = params.get('q') as Tier | null;
  if (forced && forced in TIERS) return forced;
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  if (touch || Math.min(innerWidth, innerHeight) < 600) return mem >= 6 && cores >= 8 ? 'mid' : 'low';
  return cores <= 4 || mem <= 4 ? 'mid' : 'high';
}
const tier = TIERS[detectTier()];
const SEED = Number(params.get('seed')) || 13800;

// ---------------------------------------------------------------- model
const cosmology = new Cosmology();
const universe = generateUniverse(SEED, tier.n, tier.galaxies);

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
let pixelRatio = Math.min(devicePixelRatio || 1, tier.dpr);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2000);
const shared = makeSharedUniforms();
const backdrop = new Backdrop(shared);
const matter = new MatterLayer(universe, shared);
const galaxies = new GalaxyLayer(universe, shared);
scene.add(backdrop.mesh, matter.group, galaxies.group);

const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: tier.msaa });
const composer = new EffectComposer(renderer, target);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.85, 0.7);
if (params.get('bloom') !== '0') composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize(): void {
  const w = innerWidth;
  const h = innerHeight;
  camera.aspect = w / h;
  camera.fov = w < h ? 72 : 60;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  shared.uPx.value = (h * pixelRatio) / (2 * Math.tan((camera.fov * Math.PI) / 360));
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- cosmic clock
const SPEEDS = [0.25, 0.5, 1, 2, 4];
const clock = {
  u: Math.min(1, Math.max(0, Number(params.get('u')) || 0)),
  goal: 0,
  playing: params.get('paused') === null,
  speed: 1,
  dir: 1,
  tween: null as null | { from: number; to: number; t: number; dur: number },
};
clock.goal = clock.u;
/** seconds of real time for the whole timeline at 1× */
const FULL_RUN = 150;

function stepClock(dt: number): void {
  if (clock.tween) {
    const tw = clock.tween;
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const s = tw.t * tw.t * (3 - 2 * tw.t);
    clock.u = clock.goal = tw.from + (tw.to - tw.from) * s;
    if (tw.t >= 1) clock.tween = null;
    return;
  }
  if (clock.playing) {
    clock.goal += (clock.dir * clock.speed * dt) / FULL_RUN;
    // stop only on reaching the end we are heading towards
    if ((clock.dir > 0 && clock.goal >= 1) || (clock.dir < 0 && clock.goal <= 0)) setPlaying(false);
    clock.goal = Math.min(1, Math.max(0, clock.goal));
  }
  // the displayed time eases towards the requested time: scrubbing never pops
  clock.u += (clock.goal - clock.u) * (1 - Math.exp(-dt * 7));
  if (Math.abs(clock.goal - clock.u) < 1e-6) clock.u = clock.goal;
}
function jumpTo(u: number): void {
  const dur = 0.6 + 1.6 * Math.min(1, Math.abs(u - clock.u) * 2.5);
  clock.tween = { from: clock.u, to: u, t: 0, dur };
}
function setPlaying(p: boolean): void {
  clock.playing = p;
  hud.setPlaying(p);
}

// ---------------------------------------------------------------- camera & picking
const nav = new Navigator(camera, canvas);
let state: VisualState = visualState(cosmology, uToYears(clock.u));
const tmp = new Float64Array(6);
const nearest = (v: number) => v - Math.round(v);

function galaxyTarget(g: number, image: [number, number, number]): OrbitTarget {
  const particle = universe.galaxies.index[g];
  return {
    locate: (out) => effectivePosition(universe, particle, state.D, out),
    image,
    distance: universe.galaxies.info[g * 4 + 1] * 6 + 5,
  };
}

/** Find the formed galaxy closest to a view ray (dir in world space). */
function pickGalaxy(dir: THREE.Vector3, tolerance: number): OrbitTarget | null {
  const gal = universe.galaxies;
  let best = -1;
  let bestScore = Infinity;
  let bestImg: [number, number, number] = [0, 0, 0];
  const sb = state.sigmaBox;
  for (let g = 0; g < gal.count; g++) {
    if (state.logT < gal.info[g * 4 + 3] + 0.12) continue;
    effectivePosition(universe, gal.index[g], state.D, tmp);
    const bx = nearest(tmp[0] - nav.co[0]);
    const by = nearest(tmp[1] - nav.co[1]);
    const bz = nearest(tmp[2] - nav.co[2]);
    for (let iz = -1; iz <= 1; iz++)
      for (let iy = -1; iy <= 1; iy++)
        for (let ix = -1; ix <= 1; ix++) {
          const x = sb * (bx + ix) + tmp[3];
          const y = sb * (by + iy) + tmp[4];
          const z = sb * (bz + iz) + tmp[5];
          const along = x * dir.x + y * dir.y + z * dir.z;
          if (along < 1 || along > (shared.uFade.value as number) * 0.9) continue;
          const d2 = x * x + y * y + z * z - along * along;
          const lim = Math.max(gal.info[g * 4 + 1] * 1.4, along * tolerance);
          if (d2 > lim * lim) continue;
          const score = along * (1 + Math.sqrt(d2) / lim);
          if (score < bestScore) {
            bestScore = score;
            best = g;
            bestImg = [ix, iy, iz];
          }
        }
  }
  return best < 0 ? null : galaxyTarget(best, bestImg);
}

nav.onPick = (cx, cy) => {
  const th = Math.tan((camera.fov * Math.PI) / 360);
  const dir = new THREE.Vector3(((cx / innerWidth) * 2 - 1) * th * camera.aspect, (1 - (cy / innerHeight) * 2) * th, -1)
    .normalize()
    .applyQuaternion(camera.quaternion);
  const hit = pickGalaxy(dir, 0.018);
  if (hit) nav.orbit(hit);
  else nav.release();
};
nav.onModeChange = () => hud.setMode(nav.orbiting);

// ---------------------------------------------------------------- interface
const hud = new Hud(
  document.getElementById('hud')!,
  {
    togglePlay: () => {
      if (!clock.playing && clock.dir > 0 && clock.goal >= 1) jumpTo(0);
      if (!clock.playing && clock.dir < 0 && clock.goal <= 0) jumpTo(1);
      setPlaying(!clock.playing);
    },
    reset: () => {
      nav.reset();
      clock.dir = 1;
      jumpTo(0);
      setPlaying(true);
    },
    now: () => jumpTo(U_NOW),
    scrub: (u) => {
      clock.tween = null;
      clock.goal = u;
    },
    jump: jumpTo,
    cycleSpeed: () => (clock.speed = SPEEDS[(SPEEDS.indexOf(clock.speed) + 1) % SPEEDS.length]),
    toggleDirection: () => (clock.dir = -clock.dir),
    toggleMode: () => {
      if (nav.orbiting) return nav.release();
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const hit = pickGalaxy(fwd, 0.45);
      if (hit) return nav.orbit(hit);
      // nothing has formed yet: orbit a fixed comoving point ahead
      const sb = state.sigmaBox;
      const p = [nav.co[0] + (fwd.x * 90) / sb, nav.co[1] + (fwd.y * 90) / sb, nav.co[2] + (fwd.z * 90) / sb];
      nav.orbit({ locate: (out) => out.set([p[0], p[1], p[2], 0, 0, 0]), image: [0, 0, 0], distance: 90 });
    },
    thrust: (on) => (nav.thrust = on ? 1 : 0),
  },
  touch,
);
hud.setPlaying(clock.playing);

addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    setPlaying(!clock.playing);
  } else if (e.code === 'Period' || e.code === 'Comma') {
    clock.tween = null;
    clock.goal = Math.min(1, Math.max(0, clock.goal + (e.code === 'Period' ? 0.01 : -0.01)));
  } else if (e.code === 'Home') {
    jumpTo(0);
  } else if (e.code === 'Escape') {
    nav.release();
  }
});

// ---------------------------------------------------------------- frame loop
let last = performance.now();
let slow = 0;
let realClock = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  realClock += dt;

  stepClock(dt);
  state = visualState(cosmology, uToYears(clock.u));
  nav.update(dt, state.sigmaBox);
  camera.updateMatrixWorld();

  applyVisualState(shared, state);
  (shared.uCam.value as THREE.Vector3).set(nav.co[0], nav.co[1], nav.co[2]);
  matter.setDrawFraction(state.drawFraction);
  backdrop.update(camera, state, realClock);
  bloom.strength = state.bloom;
  composer.render();
  hud.update(clock.u, state);

  // performance fallback: shed resolution if frames stay slow
  slow = dt > 0.034 ? slow + dt : Math.max(0, slow - dt * 2);
  if (slow > 2.5 && pixelRatio > 0.8) {
    pixelRatio = Math.max(0.75, pixelRatio * 0.8);
    slow = 0;
    resize();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame((t) => {
  last = t;
  frame(t);
  document.getElementById('veil')?.classList.add('gone');
});

// handle for automated checks
Object.assign(window, {
  __cosmos: {
    clock,
    nav,
    universe,
    cosmology,
    get state() {
      return state;
    },
    setU: (u: number) => {
      clock.tween = null;
      clock.u = clock.goal = u;
    },
    setPlaying,
  },
});
