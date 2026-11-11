import { UNBOUND, Universe } from './structure';

export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const nearest = (v: number) => v - Math.round(v);

/**
 * View scale σ(a): on-screen length of one comoving unit, normalised to 1 today.
 *
 * The true scale factor changes by ten orders of magnitude over the timeline,
 * far beyond what a camera can show at one zoom level. σ is therefore a
 * monotonic *compression* of a(t) — logarithmic in the early universe, ∝ √a
 * later — so expansion is always visible and always in the right direction,
 * while the read-out reports the true a(t). It is the only non-literal
 * mapping in the kinematics and is documented as such.
 */
export function viewScale(a: number): number {
  return 0.4 + 0.012 * Math.max(0, Math.log(a) + 23) + 0.324 * Math.sqrt(a);
}

/**
 * CPU mirror of the vertex-shader kinematics (see render/shaders.ts → COSMIC_POS).
 *
 *   comoving position      x(t) = q + D(t) ψ            (Zel'dovich approximation)
 *   bound particle         x → centre of its structure as it collapses (weight w)
 *   on-screen position     σ(a) · BOX · (x − x_camera)  +  w · offset
 *
 * `offset` is a fixed physical vector, deliberately NOT multiplied by σ:
 * gravitationally bound structures keep their size while space expands.
 *
 * out = [xe_x, xe_y, xe_z, extra_x, extra_y, extra_z]; xe is the effective
 * comoving position, extra the physical offset in display units.
 */
export function effectivePosition(u: Universe, i: number, D: number, out: Float64Array): void {
  const j = i * 3;
  let x = u.q[j] + D * u.psi[j];
  let y = u.q[j + 1] + D * u.psi[j + 1];
  let z = u.q[j + 2] + D * u.psi[j + 2];
  const dc = u.misc[i * 4 + 2];
  let w = 0;
  if (dc < UNBOUND - 1) {
    w = smoothstep(dc * 0.55, dc, D);
    x += w * nearest(u.hq[j] + D * u.hpsi[j] - x);
    y += w * nearest(u.hq[j + 1] + D * u.hpsi[j + 1] - y);
    z += w * nearest(u.hq[j + 2] + D * u.hpsi[j + 2] - z);
  }
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = w * u.off[j];
  out[4] = w * u.off[j + 1];
  out[5] = w * u.off[j + 2];
}

/** On-screen position relative to an observer at comoving position cam (nearest periodic image). */
export function displayPosition(
  u: Universe,
  i: number,
  D: number,
  sigmaBox: number,
  cam: ArrayLike<number>,
  out: Float64Array,
): void {
  effectivePosition(u, i, D, out);
  out[0] = sigmaBox * nearest(out[0] - cam[0]) + out[3];
  out[1] = sigmaBox * nearest(out[1] - cam[1]) + out[4];
  out[2] = sigmaBox * nearest(out[2] - cam[2]) + out[5];
}
