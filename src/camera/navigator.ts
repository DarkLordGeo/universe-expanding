import * as THREE from 'three';

export type CameraMode = 'fly' | 'orbit';

/** Something the camera can orbit: effective comoving position + fixed physical offset. */
export interface OrbitTarget {
  /** fills out = [xe(3), extra(3)] for the current cosmic time */
  locate(out: Float64Array): void;
  /** integer periodic-image offset used only while flying towards it */
  image: [number, number, number];
  /** preferred viewing distance, display units */
  distance: number;
}

const wrap01 = (v: number) => v - Math.floor(v);
const nearest = (v: number) => v - Math.round(v);

/**
 * The observer. The camera sits at the scene origin and only rotates; its
 * location is a comoving coordinate (double precision) handed to the shaders.
 * It is therefore a comoving observer wherever it goes — the timeline never
 * moves or zooms it, and expansion is always seen from "here", with no centre.
 */
export class Navigator {
  readonly camera: THREE.PerspectiveCamera;
  /** comoving position, box units */
  readonly co = new Float64Array([0.5, 0.5, 0.5]);
  mode: CameraMode = 'fly';
  target: OrbitTarget | null = null;
  onPick: ((x: number, y: number) => void) | null = null;
  onModeChange: (() => void) | null = null;
  thrust = 0; // touch "fly" button

  private vel = new THREE.Vector3();
  private keys = new Set<string>();
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private downAt = { x: 0, y: 0, t: 0, moved: 0 };
  private rho = 20;
  private rhoGoal = 20;
  private approach: { t: number; from: THREE.Quaternion } | null = null;
  private idle = 0;
  private drift = true;
  private tmp = new Float64Array(6);
  private v1 = new THREE.Vector3();
  private q1 = new THREE.Quaternion();
  private m1 = new THREE.Matrix4();

  constructor(camera: THREE.PerspectiveCamera, private dom: HTMLElement) {
    this.camera = camera;
    camera.position.set(0, 0, 0);
    dom.addEventListener('pointerdown', this.onDown);
    dom.addEventListener('pointermove', this.onMove);
    dom.addEventListener('pointerup', this.onUp);
    dom.addEventListener('pointercancel', this.onUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private rotate(dx: number, dy: number): void {
    const k = (this.camera.fov * Math.PI) / 180 / this.dom.clientHeight;
    this.q1.setFromAxisAngle(this.v1.set(0, 1, 0), dx * k * 1.2);
    this.camera.quaternion.multiply(this.q1);
    this.q1.setFromAxisAngle(this.v1.set(1, 0, 0), dy * k * 1.2);
    this.camera.quaternion.multiply(this.q1).normalize();
  }

  private onDown = (e: PointerEvent) => {
    this.dom.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) this.downAt = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
    if (this.pointers.size === 2) this.pinch = this.pinchDist();
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    this.idle = 0;
    if (this.pointers.size === 1) {
      this.downAt.moved += Math.abs(dx) + Math.abs(dy);
      if (!this.approach) this.rotate(dx, dy);
    } else if (this.pointers.size === 2) {
      const d = this.pinchDist();
      const ratio = d / Math.max(this.pinch, 1);
      this.pinch = d;
      if (this.mode === 'orbit') this.rhoGoal = THREE.MathUtils.clamp(this.rhoGoal / ratio, 2.5, 330);
      else this.push((ratio - 1) * 520);
    }
  };

  private onUp = (e: PointerEvent) => {
    const had = this.pointers.delete(e.pointerId);
    if (had && this.pointers.size === 0 && this.downAt.moved < 7 && performance.now() - this.downAt.t < 350) {
      this.onPick?.(e.clientX, e.clientY);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.idle = 0;
    const d = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120);
    if (this.mode === 'orbit') this.rhoGoal = THREE.MathUtils.clamp(this.rhoGoal * Math.exp(d * 0.0016), 2.5, 330);
    else this.push(-d * 0.55);
  };

  private pinchDist(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** impulse along the view direction, display units/s */
  private push(amount: number): void {
    this.drift = false;
    this.vel.addScaledVector(this.v1.set(0, 0, -1).applyQuaternion(this.camera.quaternion), amount);
  }

  /** Relative display position of the current target (using its chosen periodic image). */
  private targetRel(sigmaBox: number, out: THREE.Vector3): THREE.Vector3 {
    const t = this.target!;
    t.locate(this.tmp);
    return out.set(
      sigmaBox * (nearest(this.tmp[0] - this.co[0]) + t.image[0]) + this.tmp[3],
      sigmaBox * (nearest(this.tmp[1] - this.co[1]) + t.image[1]) + this.tmp[4],
      sigmaBox * (nearest(this.tmp[2] - this.co[2]) + t.image[2]) + this.tmp[5],
    );
  }

  /** Turn towards a target, then orbit it. */
  orbit(target: OrbitTarget): void {
    this.target = target;
    this.mode = 'fly';
    this.vel.set(0, 0, 0);
    this.drift = false;
    this.approach = { t: 0, from: this.camera.quaternion.clone() };
    this.onModeChange?.();
  }

  release(): void {
    if (this.mode === 'orbit' || this.approach) {
      this.mode = 'fly';
      this.target = null;
      this.approach = null;
      this.onModeChange?.();
    }
  }

  get orbiting(): boolean {
    return this.mode === 'orbit' || this.approach !== null;
  }

  reset(): void {
    this.release();
    this.co.set([0.5, 0.5, 0.5]);
    this.vel.set(0, 0, 0);
    this.camera.quaternion.identity();
    this.drift = true;
  }

  update(dt: number, sigmaBox: number): void {
    const cam = this.camera;
    this.idle += dt;

    if (this.approach && this.target) {
      const a = this.approach;
      a.t = Math.min(1, a.t + dt / 0.9);
      const rel = this.targetRel(sigmaBox, this.v1);
      this.m1.lookAt(new THREE.Vector3(0, 0, 0), rel, new THREE.Vector3(0, 1, 0).applyQuaternion(a.from));
      this.q1.setFromRotationMatrix(this.m1);
      const s = a.t * a.t * (3 - 2 * a.t);
      cam.quaternion.copy(a.from).slerp(this.q1, s);
      if (a.t >= 1) {
        this.rho = rel.length();
        this.rhoGoal = Math.min(this.rho, this.target.distance);
        this.target.image = [0, 0, 0];
        this.approach = null;
        this.mode = 'orbit';
        this.onModeChange?.();
      }
      return;
    }

    if (this.mode === 'orbit' && this.target) {
      if (this.idle > 4 && this.pointers.size === 0) {
        this.q1.setFromAxisAngle(this.v1.set(0, 1, 0), dt * 0.05);
        cam.quaternion.multiply(this.q1);
      }
      const k = this.keys;
      if (k.has('KeyW') || k.has('ArrowUp')) this.rhoGoal = Math.max(2.5, this.rhoGoal * Math.exp(-dt * 1.2));
      if (k.has('KeyS') || k.has('ArrowDown')) this.rhoGoal = Math.min(330, this.rhoGoal * Math.exp(dt * 1.2));
      this.rho += (this.rhoGoal - this.rho) * (1 - Math.exp(-dt * 3));
      const fwd = this.v1.set(0, 0, -1).applyQuaternion(cam.quaternion);
      this.target.locate(this.tmp);
      // place the observer so the target sits `rho` straight ahead
      this.co[0] = wrap01(this.tmp[0] - (this.rho * fwd.x - this.tmp[3]) / sigmaBox);
      this.co[1] = wrap01(this.tmp[1] - (this.rho * fwd.y - this.tmp[4]) / sigmaBox);
      this.co[2] = wrap01(this.tmp[2] - (this.rho * fwd.z - this.tmp[5]) / sigmaBox);
      return;
    }

    // --- free flight
    const k = this.keys;
    const ax = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ay = (k.has('KeyE') || k.has('KeyR') ? 1 : 0) - (k.has('KeyQ') || k.has('KeyF') ? 1 : 0);
    const az = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - this.thrust;
    if (ax || ay || az) {
      this.drift = false;
      this.idle = 0;
      const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1;
      this.v1.set(ax, ay, az).normalize().applyQuaternion(cam.quaternion);
      this.vel.addScaledVector(this.v1, 150 * boost * dt);
    }
    this.vel.multiplyScalar(Math.exp(-dt * 1.6));
    if (this.drift) {
      // gentle initial glide so depth is readable before the first input
      this.v1.set(0, 0, -1).applyQuaternion(cam.quaternion);
      this.vel.lerp(this.v1.multiplyScalar(5), 1 - Math.exp(-dt));
    }
    this.co[0] = wrap01(this.co[0] + (this.vel.x * dt) / sigmaBox);
    this.co[1] = wrap01(this.co[1] + (this.vel.y * dt) / sigmaBox);
    this.co[2] = wrap01(this.co[2] + (this.vel.z * dt) / sigmaBox);
  }
}
