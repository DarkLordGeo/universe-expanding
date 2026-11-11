import { describe, expect, it } from 'vitest';
import { Cosmology } from '../src/cosmology/friedmann';
import { displayPosition, effectivePosition, viewScale } from '../src/sim/kinematics';
import { BOX_DISPLAY, generateUniverse, UNBOUND } from '../src/sim/structure';
import { visualState } from '../src/sim/visual';
import { uToYears } from '../src/cosmology/timeline';

const U = generateUniverse(1380, 24, 600);
const dist = (a: Float64Array, b: Float64Array) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('procedural universe', () => {
  it('is deterministic for a given seed', () => {
    const V = generateUniverse(1380, 24, 600);
    expect(Array.from(V.q.slice(0, 300))).toEqual(Array.from(U.q.slice(0, 300)));
    expect(Array.from(V.psi.slice(0, 300))).toEqual(Array.from(U.psi.slice(0, 300)));
    expect(V.galaxies.count).toBe(U.galaxies.count);
    const W = generateUniverse(7, 24, 600);
    expect(Array.from(W.psi.slice(0, 30))).not.toEqual(Array.from(U.psi.slice(0, 30)));
  });

  it('forms bound structures and galaxies', () => {
    expect(U.haloCount).toBeGreaterThan(10);
    expect(U.galaxies.count).toBeGreaterThan(300);
  });

  it('clusters matter as the growth factor rises', () => {
    // variance of counts-in-cells grows with D
    const variance = (D: number) => {
      const g = 8;
      const cells = new Float64Array(g * g * g);
      const o = new Float64Array(6);
      for (let i = 0; i < U.count; i++) {
        effectivePosition(U, i, D, o);
        const f = (v: number) => Math.floor((v - Math.floor(v)) * g) % g;
        cells[(f(o[2]) * g + f(o[1])) * g + f(o[0])]++;
      }
      const mean = U.count / cells.length;
      return cells.reduce((s, c) => s + (c - mean) ** 2, 0) / cells.length / (mean * mean);
    };
    expect(variance(1)).toBeGreaterThan(variance(0.3) * 2);
    expect(variance(0.3)).toBeGreaterThan(variance(0.01));
  });
});

describe('expansion kinematics', () => {
  const pick = (bound: boolean, n: number) => {
    const out: number[] = [];
    for (let i = 0; i < U.count && out.length < n; i++) {
      if (U.misc[i * 4 + 2] < UNBOUND - 1 === bound) out.push(i);
    }
    return out;
  };

  it('view scale is monotonic in a and equals 1 today', () => {
    expect(viewScale(1)).toBeCloseTo(1, 6);
    let prev = 0;
    for (let l = -23; l < 3; l += 0.1) {
      const s = viewScale(Math.exp(l));
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
  });

  it('unbound matter separates in proportion to the scale applied to space', () => {
    const [i, j] = pick(false, 2);
    const cam = [0.31, 0.62, 0.17];
    const a = new Float64Array(6);
    const b = new Float64Array(6);
    const d = (s: number) => {
      effectivePosition(U, i, 1, a);
      effectivePosition(U, j, 1, b);
      displayPosition(U, i, 1, s * BOX_DISPLAY, cam, a);
      return Math.hypot(a[0], a[1], a[2]);
    };
    expect(d(1.8) / d(0.9)).toBeCloseTo(2, 6);
  });

  it('gravitationally bound structures do not expand', () => {
    // two members of the same structure
    const bound = pick(true, 4000);
    let i = -1;
    let j = -1;
    outer: for (const p of bound)
      for (const r of bound)
        if (p !== r && U.hq[p * 3] === U.hq[r * 3] && U.hq[p * 3 + 1] === U.hq[r * 3 + 1]) {
          i = p;
          j = r;
          break outer;
        }
    expect(i).toBeGreaterThanOrEqual(0);
    const cam = [0.5, 0.5, 0.5];
    const a = new Float64Array(6);
    const b = new Float64Array(6);
    const sep = (D: number, s: number) => {
      displayPosition(U, i, D, s * BOX_DISPLAY, cam, a);
      displayPosition(U, j, D, s * BOX_DISPLAY, cam, b);
      return dist(a, b);
    };
    const today = sep(1, 1);
    expect(today).toBeGreaterThan(0);
    expect(sep(1.2, 1.9)).toBeCloseTo(today, 3);
    expect(sep(1.3, 3.0)).toBeCloseTo(today, 3);
  });

  it('has no privileged centre: every observer sees the same expansion law', () => {
    const [i] = pick(false, 1);
    const o = new Float64Array(6);
    for (const cam of [
      [0.1, 0.2, 0.3],
      [0.77, 0.05, 0.9],
      [0.5, 0.5, 0.5],
    ]) {
      displayPosition(U, i, 1, 1 * BOX_DISPLAY, cam, o);
      const d1 = Math.hypot(o[0], o[1], o[2]);
      displayPosition(U, i, 1, 1.5 * BOX_DISPLAY, cam, o);
      const d2 = Math.hypot(o[0], o[1], o[2]);
      expect(d2 / d1).toBeCloseTo(1.5, 6); // recession ∝ distance, from anywhere
    }
  });
});

describe('visual state', () => {
  const cos = new Cosmology();
  it('is a pure, continuous function of cosmic time', () => {
    const a = visualState(cos, uToYears(0.5));
    const b = visualState(cos, uToYears(0.5));
    expect(a).toEqual(b);
    let prev = visualState(cos, uToYears(0));
    for (let u = 0.001; u <= 1; u += 0.001) {
      const v = visualState(cos, uToYears(u));
      expect(Math.abs(v.sigma - prev.sigma)).toBeLessThan(0.03);
      expect(Math.abs(v.xe - prev.xe)).toBeLessThan(0.12);
      expect(Math.abs(v.wallBrightness - prev.wallBrightness)).toBeLessThan(0.05);
      prev = v;
    }
  });
  it('plasma is opaque before recombination and transparent after', () => {
    expect(visualState(cos, 1e4).xe).toBe(1);
    expect(visualState(cos, 2e6).xe).toBe(0);
  });
});
