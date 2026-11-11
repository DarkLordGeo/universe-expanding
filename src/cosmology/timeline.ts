/**
 * The cosmic timeline: a monotonic map between a normalised control value
 * u ∈ [0, 1] and cosmic time. Cosmic history spans ~25 orders of magnitude in
 * time, so the map is piecewise log-linear between anchors. It only decides how
 * the slider is laid out — all physics is evaluated from the resulting time.
 */
export const YEAR_S = 3.15576e7;
export const T0_YR = 13.787e9;
export const T_END_YR = 60e9;

/** [u, time in years] */
const ANCHORS: [number, number][] = [
  [0.0, 1 / YEAR_S], // 1 second
  [0.09, 10 / YEAR_S], // nucleosynthesis begins
  [0.17, 1200 / YEAR_S], // nucleosynthesis ends (~20 min)
  [0.24, 2.0e5],
  [0.3, 6.0e5], // recombination (~380 kyr) sits inside this span
  [0.42, 1.0e8], // first stars
  [0.52, 4.0e8], // first galaxies
  [0.62, 1.5e9],
  [0.8, 9.0e9],
  [0.86, T0_YR], // today
  [1.0, T_END_YR],
];

export const U_NOW = 0.86;

export function uToYears(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  for (let i = 1; i < ANCHORS.length; i++) {
    const [u1, t1] = ANCHORS[i];
    if (x <= u1) {
      const [u0, t0] = ANCHORS[i - 1];
      const f = (x - u0) / (u1 - u0);
      return Math.exp(Math.log(t0) + f * (Math.log(t1) - Math.log(t0)));
    }
  }
  return T_END_YR;
}

export function yearsToU(t: number): number {
  if (t <= ANCHORS[0][1]) return 0;
  for (let i = 1; i < ANCHORS.length; i++) {
    const [u1, t1] = ANCHORS[i];
    if (t <= t1) {
      const [u0, t0] = ANCHORS[i - 1];
      const f = (Math.log(t) - Math.log(t0)) / (Math.log(t1) - Math.log(t0));
      return u0 + f * (u1 - u0);
    }
  }
  return 1;
}

export interface Epoch {
  id: string;
  name: string;
  /** where the epoch begins on the timeline */
  start: number;
  /** where "jump to epoch" lands */
  jump: number;
}

export const EPOCHS: Epoch[] = [
  { id: 'early', name: 'Early Universe', start: 0, jump: 0 },
  { id: 'bbn', name: 'Primordial Nucleosynthesis', start: 0.09, jump: 0.1 },
  { id: 'plasma', name: 'Photon–Baryon Plasma', start: 0.17, jump: 0.2 },
  { id: 'recomb', name: 'Recombination', start: 0.25, jump: yearsToU(3.0e5) },
  { id: 'dark', name: 'Cosmic Dark Ages', start: 0.3, jump: 0.34 },
  { id: 'stars', name: 'First Stars', start: 0.42, jump: 0.44 },
  { id: 'galaxies', name: 'First Galaxies', start: 0.52, jump: 0.55 },
  { id: 'web', name: 'Galaxy Clusters & Cosmic Web', start: 0.62, jump: 0.72 },
  { id: 'now', name: 'The Modern Universe', start: 0.845, jump: U_NOW },
  { id: 'future', name: 'The Future — ΛCDM Projection', start: 0.8605, jump: 0.96 },
];

export function epochAt(u: number): Epoch {
  let e = EPOCHS[0];
  for (const ep of EPOCHS) if (u >= ep.start) e = ep;
  return e;
}

/** Human-readable cosmic time */
export function formatTime(years: number): string {
  const s = years * YEAR_S;
  const f = (v: number, d = 1) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(Math.min(d, 1)) : v.toFixed(d));
  if (s < 60) return `${f(s)} seconds`;
  if (s < 3600) return `${f(s / 60)} minutes`;
  if (s < 86400) return `${f(s / 3600)} hours`;
  if (years < 1) return `${f(s / 86400)} days`;
  if (years < 1e3) return `${f(years)} years`;
  if (years < 1e6) return `${Math.round(years / 1e3).toLocaleString('en-US')},000 years`;
  if (years < 1e9) return `${f(years / 1e6)} million years`;
  return `${(years / 1e9).toFixed(2)} billion years`;
}
