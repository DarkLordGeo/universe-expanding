import { Cosmology } from '../cosmology/friedmann';
import { YEAR_S } from '../cosmology/timeline';
import { smoothstep, viewScale } from './kinematics';
import { BOX_DISPLAY } from './structure';

/** Everything the renderer needs, as a pure function of cosmic time. */
export interface VisualState {
  years: number;
  a: number;
  z: number;
  T: number;
  /** linear growth factor */
  D: number;
  /** deceleration parameter (negative → accelerating) */
  q: number;
  /** view scale × box size, display units per comoving box */
  sigmaBox: number;
  sigma: number;
  logT: number;
  /** ionised fraction: 1 = opaque plasma, 0 = neutral & transparent */
  xe: number;
  /** photon mean free path in display units */
  mfp: number;
  /** progress of primordial nucleosynthesis 0..1 */
  helium: number;
  wallColor: [number, number, number];
  wallBrightness: number;
  plasmaB: number;
  gasB: number;
  starB: number;
  ageRed: number;
  bloom: number;
  /** fraction of matter particles drawn */
  drawFraction: number;
}

// colour of the radiating medium vs log10(temperature / K)
const STOPS: [number, number, number, number, number][] = [
  // logT,   r,    g,    b,   intensity
  [10.2, 0.2, 0.46, 1.0, 0.8],
  [9.6, 0.5, 0.72, 1.0, 0.74],
  [9.0, 1.0, 0.82, 0.42, 0.66],
  [7.0, 1.0, 0.72, 0.36, 0.56],
  [5.0, 1.0, 0.6, 0.26, 0.47],
  [3.62, 1.0, 0.5, 0.2, 0.4],
  [3.47, 1.0, 0.42, 0.15, 0.34],
  [3.0, 0.8, 0.17, 0.06, 0.34],
  [2.4, 0.45, 0.05, 0.02, 0.34],
];

function wall(logTemp: number): [number, number, number, number] {
  if (logTemp >= STOPS[0][0]) return [STOPS[0][1], STOPS[0][2], STOPS[0][3], STOPS[0][4]];
  for (let i = 1; i < STOPS.length; i++) {
    const b = STOPS[i];
    if (logTemp >= b[0]) {
      const a = STOPS[i - 1];
      const f = (logTemp - b[0]) / (a[0] - b[0]);
      return [b[1] + (a[1] - b[1]) * f, b[2] + (a[2] - b[2]) * f, b[3] + (a[3] - b[3]) * f, b[4] + (a[4] - b[4]) * f];
    }
  }
  const l = STOPS[STOPS.length - 1];
  return [l[1], l[2], l[3], l[4]];
}

export function visualState(cos: Cosmology, years: number): VisualState {
  const a = cos.aOfT(years / 1e9);
  const T = cos.temperature(a);
  const D = cos.growth(a);
  const sigma = viewScale(a);
  const logT = Math.log10(years);

  // Hydrogen recombines as the plasma cools through ~4000–2700 K (Saha-like switch)
  const xe = smoothstep(2650, 4100, T);
  const mfp = 80 / Math.max(xe, 1e-4) ** 2;

  const seconds = years * YEAR_S;
  const helium = Math.min(1, Math.max(0, (Math.log10(seconds) - 1) / (Math.log10(1200) - 1)));

  const [r, g, b, inten] = wall(Math.log10(T));
  // after last scattering the background glow redshifts out of the visible band
  const wallBrightness = inten * (0.4 + 0.6 * xe) * (T >= 3000 ? 1 : Math.pow(T / 3000, 2.0));

  const future = smoothstep(1, 6, a);
  return {
    years,
    a,
    z: 1 / a - 1,
    T,
    D,
    q: cos.q(a),
    sigma,
    sigmaBox: sigma * BOX_DISPLAY,
    logT,
    xe,
    mfp,
    helium,
    wallColor: [r, g, b],
    wallBrightness,
    plasmaB: 0.34 + 0.3 * inten,
    gasB: 0.085 - 0.04 * smoothstep(0.04, 0.5, D),
    starB: 0.95 - 0.3 * future,
    ageRed: 0.3 * smoothstep(0.2, 1, a) + 0.35 * future,
    bloom: 0.06 + 0.6 * (1 - xe),
    drawFraction: Math.min(1, Math.max(0.34, Math.pow(sigma / 0.85, 2.2))),
  };
}
