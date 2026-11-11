import { fft3d } from './fft';
import { gaussian, mulberry32 } from './rng';

export interface DisplacementField {
  /** grid resolution per axis */
  g: number;
  /** displacement components, box units, n³ each */
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
}

/**
 * Initial density fluctuations and their Zel'dovich displacement field.
 *
 * A Gaussian random field δ(q) is drawn with a CDM-like power spectrum
 * (red-tilted, smoothed on small scales), and the displacement field is
 *   ψ(k) = i k δ(k) / k²        so that   δ = −∇·ψ.
 * Matter then moves as x(q, t) = q + D(t) ψ(q) in comoving coordinates, where
 * D is the linear growth factor from the cosmology module.
 */
export function makeDisplacementField(seed: number, g = 64, sigmaDelta = 1.75): DisplacementField {
  const n3 = g * g * g;
  const rand = mulberry32(seed);
  const re = new Float64Array(n3);
  const im = new Float64Array(n3);
  for (let i = 0; i < n3; i++) re[i] = gaussian(rand);
  fft3d(re, im, g, false);

  const kc = 11; // small-scale cutoff (truncated Zel'dovich keeps filaments sharp)
  const kf = (i: number) => (i <= g / 2 ? i : i - g);
  let varDelta = 0;
  for (let z = 0; z < g; z++) {
    for (let y = 0; y < g; y++) {
      for (let x = 0; x < g; x++) {
        const i = (z * g + y) * g + x;
        const kx = kf(x);
        const ky = kf(y);
        const kz = kf(z);
        const k2 = kx * kx + ky * ky + kz * kz;
        if (k2 === 0) {
          re[i] = 0;
          im[i] = 0;
          continue;
        }
        const k = Math.sqrt(k2);
        // P(k) ∝ k / (1 + (k/k_t)²)^1.4 · exp(−k²/kc²)
        const P = (k / Math.pow(1 + (k / 2.2) ** 2, 1.4)) * Math.exp(-k2 / (kc * kc));
        const amp = Math.sqrt(P);
        re[i] *= amp;
        im[i] *= amp;
        varDelta += re[i] * re[i] + im[i] * im[i];
      }
    }
  }
  // Parseval: real-space variance = Σ|δk|² / n3²
  const norm = sigmaDelta / Math.sqrt(varDelta / (n3 * n3));

  const out: Float32Array[] = [];
  const cr = new Float64Array(n3);
  const ci = new Float64Array(n3);
  for (let axis = 0; axis < 3; axis++) {
    for (let z = 0; z < g; z++) {
      for (let y = 0; y < g; y++) {
        for (let x = 0; x < g; x++) {
          const i = (z * g + y) * g + x;
          const kx = kf(x);
          const ky = kf(y);
          const kz = kf(z);
          const k2 = kx * kx + ky * ky + kz * kz;
          if (k2 === 0) {
            cr[i] = 0;
            ci[i] = 0;
            continue;
          }
          const kj = axis === 0 ? kx : axis === 1 ? ky : kz;
          // i·kj/(2π k²) · δk   (box length = 1)
          const f = (kj / (2 * Math.PI * k2)) * norm;
          cr[i] = -f * im[i];
          ci[i] = f * re[i];
        }
      }
    }
    fft3d(cr, ci, g, true);
    const comp = new Float32Array(n3);
    for (let i = 0; i < n3; i++) comp[i] = cr[i];
    out.push(comp);
  }
  return { g, px: out[0], py: out[1], pz: out[2] };
}

/** Periodic trilinear sample of one displacement component at box position (x,y,z) ∈ [0,1)³ */
export function sampleField(f: Float32Array, g: number, x: number, y: number, z: number): number {
  const fx = x * g;
  const fy = y * g;
  const fz = z * g;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;
  const m = g - 1; // g is a power of two
  const xa = x0 & m;
  const xb = (x0 + 1) & m;
  const ya = (y0 & m) * g;
  const yb = ((y0 + 1) & m) * g;
  const za = (z0 & m) * g * g;
  const zb = ((z0 + 1) & m) * g * g;
  const c00 = f[za + ya + xa] * (1 - tx) + f[za + ya + xb] * tx;
  const c10 = f[za + yb + xa] * (1 - tx) + f[za + yb + xb] * tx;
  const c01 = f[zb + ya + xa] * (1 - tx) + f[zb + ya + xb] * tx;
  const c11 = f[zb + yb + xa] * (1 - tx) + f[zb + yb + xb] * tx;
  return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
}
