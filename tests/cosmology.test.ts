import { describe, expect, it } from 'vitest';
import { Cosmology } from '../src/cosmology/friedmann';
import { EPOCHS, T0_YR, U_NOW, uToYears, yearsToU } from '../src/cosmology/timeline';

const cos = new Cosmology();

describe('ΛCDM expansion history', () => {
  it('gives the Planck 2018 age of the universe', () => {
    expect(cos.t0).toBeGreaterThan(13.74);
    expect(cos.t0).toBeLessThan(13.84);
  });

  it('a(t0) = 1 and a(t) inverts t(a)', () => {
    expect(cos.aOfT(cos.t0)).toBeCloseTo(1, 6);
    for (const a of [1e-9, 1e-6, 1e-3, 0.1, 0.5, 1, 3, 10]) {
      expect(cos.aOfT(cos.tOfA(a)) / a).toBeCloseTo(1, 5);
    }
  });

  it('scale factor grows monotonically with time', () => {
    let prev = 0;
    for (let u = 0; u <= 1.0001; u += 0.002) {
      const a = cos.aOfT(uToYears(u) / 1e9);
      expect(a).toBeGreaterThan(prev);
      prev = a;
    }
  });

  it('recombination (380,000 yr) falls at z ≈ 1100, T ≈ 3000 K', () => {
    const a = cos.aOfT(380e3 / 1e9);
    expect(cos.zOfA(a)).toBeGreaterThan(1000);
    expect(cos.zOfA(a)).toBeLessThan(1200);
    expect(cos.temperature(a)).toBeGreaterThan(2700);
    expect(cos.temperature(a)).toBeLessThan(3300);
  });

  it('one second after the Big Bang the universe is ~10^10 K', () => {
    const T = cos.temperature(cos.aOfT(1 / 3.15576e7 / 1e9));
    expect(T).toBeGreaterThan(5e9);
    expect(T).toBeLessThan(2e10);
  });

  it('follows the right power laws: a ∝ t^1/2 (radiation), t^2/3 (matter)', () => {
    const slope = (t: number) => Math.log(cos.aOfT(t * 1.01) / cos.aOfT(t)) / Math.log(1.01);
    expect(slope(1e-12)).toBeCloseTo(0.5, 2);
    expect(slope(0.5)).toBeCloseTo(0.667, 1);
  });

  it('expansion decelerates early and accelerates late (transition z ≈ 0.6)', () => {
    expect(cos.q(1e-6)).toBeCloseTo(1, 2);
    expect(cos.q(0.05)).toBeGreaterThan(0.4);
    expect(cos.q(1)).toBeLessThan(-0.4);
    const zAcc = 1 / cos.aAcceleration() - 1;
    expect(zAcc).toBeGreaterThan(0.55);
    expect(zAcc).toBeLessThan(0.75);
    // far future: exponential (de Sitter) expansion, H → H0 √ΩΛ
    expect(cos.H(100) / (cos.H0 * Math.sqrt(cos.p.OL))).toBeCloseTo(1, 3);
  });

  it('growth factor: D ∝ a in the matter era, frozen by dark energy later', () => {
    expect(cos.growth(1)).toBeCloseTo(1, 9);
    const r = cos.growth(0.1) / cos.growth(0.05);
    expect(r).toBeGreaterThan(1.9);
    expect(r).toBeLessThan(2.06);
    expect(cos.growth(10) / cos.growth(1)).toBeLessThan(1.4);
    expect(cos.growth(100) / cos.growth(10)).toBeLessThan(1.01);
  });
});

describe('timeline', () => {
  it('is monotonic and invertible', () => {
    let prev = 0;
    for (let u = 0; u <= 1; u += 0.01) {
      const t = uToYears(u);
      expect(t).toBeGreaterThan(prev);
      expect(yearsToU(t)).toBeCloseTo(u, 9);
      prev = t;
    }
  });
  it('puts the present at 13.8 Gyr and continues into the future', () => {
    expect(uToYears(U_NOW)).toBeCloseTo(T0_YR, -3);
    expect(Math.abs(T0_YR / 1e9 - cos.t0)).toBeLessThan(0.05);
    expect(uToYears(1)).toBeGreaterThan(T0_YR * 2);
  });
  it('has ordered epochs', () => {
    for (let i = 1; i < EPOCHS.length; i++) expect(EPOCHS[i].start).toBeGreaterThan(EPOCHS[i - 1].start);
  });
});
