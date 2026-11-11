import * as THREE from 'three';
import { Universe } from '../sim/structure';
import { VisualState } from '../sim/visual';
import { BACKDROP_FRAG, BACKDROP_VERT, GALAXY_FRAG, GALAXY_VERT, MATTER_FRAG, MATTER_VERT } from './shaders';

/** Visibility radius in display units. Must stay below min(σ)·BOX so the periodic images never show an edge. */
export const FADE_MAX = 620;

type U = Record<string, THREE.IUniform>;

/** Uniforms shared (by reference) between every layer and every periodic image. */
export function makeSharedUniforms(): U {
  return {
    uCam: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
    uSigmaL: { value: 1000 },
    uD: { value: 0 },
    uFade: { value: 385 },
    uMfp: { value: 55 },
    uPx: { value: 800 },
    uLogT: { value: 0 },
    uXe: { value: 1 },
    uHe: { value: 0 },
    uGasB: { value: 0 },
    uPlasmaB: { value: 0 },
    uStarB: { value: 1 },
    uAgeRed: { value: 0 },
    uPlasmaCol: { value: new THREE.Color(1, 1, 1) },
  };
}

export function applyVisualState(u: U, v: VisualState): void {
  u.uSigmaL.value = v.sigmaBox;
  // eight periodic images cover a cube of half-width σ·BOX around the observer
  u.uFade.value = Math.min(FADE_MAX, 0.96 * v.sigmaBox);
  u.uD.value = v.D;
  u.uMfp.value = v.mfp;
  u.uLogT.value = v.logT;
  u.uXe.value = v.xe;
  u.uHe.value = v.helium;
  u.uGasB.value = v.gasB;
  u.uPlasmaB.value = v.plasmaB;
  u.uStarB.value = v.starB;
  u.uAgeRed.value = v.ageRed;
  (u.uPlasmaCol.value as THREE.Color).setRGB(v.wallColor[0], v.wallColor[1], v.wallColor[2]);
}

const TILES: [number, number, number][] = [];
for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) TILES.push([x, y, z]);

/** All matter: plasma → neutral gas → starlight. One static buffer, eight periodic images. */
export class MatterLayer {
  readonly group = new THREE.Group();
  private geometry = new THREE.BufferGeometry();
  private count: number;

  constructor(uni: Universe, shared: U) {
    this.count = uni.count;
    const g = this.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(uni.q, 3));
    g.setAttribute('aPsi', new THREE.BufferAttribute(uni.psi, 3));
    g.setAttribute('aHq', new THREE.BufferAttribute(uni.hq, 3));
    g.setAttribute('aHpsi', new THREE.BufferAttribute(uni.hpsi, 3));
    g.setAttribute('aOff', new THREE.BufferAttribute(uni.off, 3));
    g.setAttribute('aMisc', new THREE.BufferAttribute(uni.misc, 4));
    for (const t of TILES) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...shared, uTile: { value: new THREE.Vector3(...t) } },
        vertexShader: MATTER_VERT,
        fragmentShader: MATTER_FRAG,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      });
      const pts = new THREE.Points(g, mat);
      pts.frustumCulled = false;
      this.group.add(pts);
    }
  }

  /** Draw only a prefix of the (randomly ordered) particles when space is compressed on screen. */
  setDrawFraction(f: number): void {
    this.geometry.setDrawRange(0, Math.max(1, Math.floor(this.count * f)));
  }
}

/** Galaxies: instanced procedural discs + glows riding on matter particles. */
export class GalaxyLayer {
  readonly group = new THREE.Group();

  constructor(uni: Universe, shared: U) {
    const gal = uni.galaxies;
    const g = new THREE.InstancedBufferGeometry();
    const quad = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
    g.setAttribute('position', new THREE.Float32BufferAttribute([...quad, ...quad], 3));
    g.setAttribute('aLayer', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 1, 1, 1], 1));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    g.instanceCount = gal.count;

    const pick = (src: Float32Array, size: number) => {
      const out = new Float32Array(gal.count * size);
      for (let i = 0; i < gal.count; i++)
        for (let k = 0; k < size; k++) out[i * size + k] = src[gal.index[i] * size + k];
      return new THREE.InstancedBufferAttribute(out, size);
    };
    g.setAttribute('aQ', pick(uni.q, 3));
    g.setAttribute('aPsi', pick(uni.psi, 3));
    g.setAttribute('aHq', pick(uni.hq, 3));
    g.setAttribute('aHpsi', pick(uni.hpsi, 3));
    g.setAttribute('aOff', pick(uni.off, 3));
    g.setAttribute('aMisc', pick(uni.misc, 4));
    g.setAttribute('aAxis', new THREE.InstancedBufferAttribute(gal.axis, 3));
    g.setAttribute('aG', new THREE.InstancedBufferAttribute(gal.info, 4));

    for (const t of TILES) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...shared, uTile: { value: new THREE.Vector3(...t) } },
        vertexShader: GALAXY_VERT,
        fragmentShader: GALAXY_FRAG,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }
}

/** Full-screen radiation field: opaque glowing plasma that becomes the redshifting CMB. */
export class Backdrop {
  readonly mesh: THREE.Mesh;
  private uniforms: U;

  constructor(shared: U) {
    this.uniforms = {
      uCam: shared.uCam,
      uSigmaL: shared.uSigmaL,
      uXe: shared.uXe,
      uMfp: shared.uMfp,
      uRot: { value: new THREE.Matrix3() },
      uTan: { value: new THREE.Vector2(1, 1) },
      uClock: { value: 0 },
      uBright: { value: 1 },
      uColor: { value: new THREE.Color(1, 1, 1) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: BACKDROP_VERT,
      fragmentShader: BACKDROP_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  update(camera: THREE.PerspectiveCamera, v: VisualState, clock: number): void {
    const u = this.uniforms;
    (u.uRot.value as THREE.Matrix3).setFromMatrix4(camera.matrixWorld);
    const th = Math.tan((camera.fov * Math.PI) / 360);
    (u.uTan.value as THREE.Vector2).set(th * camera.aspect, th);
    u.uClock.value = clock;
    u.uBright.value = v.wallBrightness;
    (u.uColor.value as THREE.Color).setRGB(v.wallColor[0], v.wallColor[1], v.wallColor[2]);
    this.mesh.visible = v.wallBrightness > 0.0015;
  }
}
