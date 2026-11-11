import { CosmoParams, KMSMPC_PER_GYR, PLANCK18 } from './params';

/**
 * Expansion history of a flat ΛCDM universe from the Friedmann equation
 *
 *   H(a)² = H0² · [ Ωr a⁻⁴ + Ωm a⁻³ + ΩΛ ]
 *
 * Cosmic time follows from dt = da / (a H). The integral is tabulated once
 * (Simpson's rule in ln a) and inverted by interpolation, so a(t) is a pure
 * function of time. No rendering code lives here.
 *
 * Units: time in Gyr, H in 1/Gyr.
 */
export class Cosmology {
  readonly p: CosmoParams;
  /** H0 in 1/Gyr */
  readonly H0: number;
  /** Age of the universe today (a = 1), Gyr */
  readonly t0: number;

  private readonly n = 4096;
  private readonly lnMin = Math.log(1e-13);
  private readonly lnMax = Math.log(1e3);
  private readonly dln: number;
  private readonly tTab: Float64Array;
  private readonly gTab: Float64Array;
  private readonly gNorm: number;

  constructor(p: CosmoParams = PLANCK18) {
    this.p = p;
    this.H0 = p.H0 * KMSMPC_PER_GYR;
    const n = this.n;
    this.dln = (this.lnMax - this.lnMin) / (n - 1);
    this.tTab = new Float64Array(n);
    this.gTab = new Float64Array(n);

    // Radiation-dominated start: a ∝ t^(1/2)  →  t = a² / (2 H0 √Ωr)
    const a0 = Math.exp(this.lnMin);
    this.tTab[0] = (a0 * a0) / (2 * this.H0 * Math.sqrt(p.Or));
    this.gTab[0] = 0;
    const fT = (ln: number) => 1 / this.H(Math.exp(ln));
    const fG = (ln: number) => {
      const a = Math.exp(ln);
      const E = this.E(a);
      return 1 / (a * a * E * E * E);
    };
    for (let i = 1; i < n; i++) {
      const l0 = this.lnMin + (i - 1) * this.dln;
      const l1 = l0 + this.dln;
      const lm = 0.5 * (l0 + l1);
      this.tTab[i] = this.tTab[i - 1] + (this.dln / 6) * (fT(l0) + 4 * fT(lm) + fT(l1));
      this.gTab[i] = this.gTab[i - 1] + (this.dln / 6) * (fG(l0) + 4 * fG(lm) + fG(l1));
    }
    this.t0 = this.tOfA(1);
    this.gNorm = 1;
    this.gNorm = this.growth(1);
  }

  /** Dimensionless Hubble rate E(a) = H(a)/H0 */
  E(a: number): number {
    const { Om, Or, OL } = this.p;
    return Math.sqrt(Or / (a * a * a * a) + Om / (a * a * a) + OL);
  }

  /** Hubble rate, 1/Gyr */
  H(a: number): number {
    return this.H0 * this.E(a);
  }

  /** Deceleration parameter q = −ä a / ȧ². Negative means accelerating expansion. */
  q(a: number): number {
    const { Om, Or, OL } = this.p;
    const r = Or / a ** 4;
    const m = Om / a ** 3;
    return (r + 0.5 * m - OL) / (r + m + OL);
  }

  /** Scale factor at which expansion switches from decelerating to accelerating (q = 0). */
  aAcceleration(): number {
    let lo = 0.1;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (this.q(mid) > 0) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  private interp(tab: Float64Array, a: number): number {
    const x = (Math.log(a) - this.lnMin) / this.dln;
    const i = Math.max(0, Math.min(this.n - 2, Math.floor(x)));
    const f = x - i;
    return tab[i] + (tab[i + 1] - tab[i]) * f;
  }

  /** Cosmic time (Gyr) at scale factor a */
  tOfA(a: number): number {
    const aMin = Math.exp(this.lnMin);
    if (a <= aMin) return (a * a) / (2 * this.H0 * Math.sqrt(this.p.Or));
    // interpolate ln t in ln a (t is close to a power law in a)
    const x = (Math.log(a) - this.lnMin) / this.dln;
    const i = Math.max(0, Math.min(this.n - 2, Math.floor(x)));
    const f = x - i;
    const l0 = Math.log(this.tTab[i]);
    const l1 = Math.log(this.tTab[i + 1]);
    return Math.exp(l0 + (l1 - l0) * f);
  }

  /** Scale factor at cosmic time t (Gyr). a(t0) = 1. */
  aOfT(t: number): number {
    const tab = this.tTab;
    if (t <= tab[0]) return Math.sqrt(2 * this.H0 * Math.sqrt(this.p.Or) * Math.max(t, 0));
    let lo = 0;
    let hi = this.n - 1;
    if (t >= tab[hi]) return Math.exp(this.lnMax);
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tab[mid] <= t) lo = mid;
      else hi = mid;
    }
    const l0 = Math.log(tab[lo]);
    const l1 = Math.log(tab[hi]);
    const f = (Math.log(t) - l0) / (l1 - l0);
    return Math.exp(this.lnMin + (lo + f) * this.dln);
  }

  /**
   * Linear growth factor D(a) of matter perturbations, normalised to D(1) = 1:
   *   D(a) ∝ H(a) ∫₀ᵃ da' / (a' H(a'))³
   * (exact for matter + Λ; during radiation domination growth is in reality
   * only logarithmic, which this expression approximates by a very small D).
   */
  growth(a: number): number {
    const aMin = Math.exp(this.lnMin);
    if (a <= aMin) return 0;
    return (this.E(a) * this.interp(this.gTab, Math.min(a, Math.exp(this.lnMax)))) / this.gNorm;
  }

  /** Redshift of light emitted at scale factor a and observed today */
  zOfA(a: number): number {
    return 1 / a - 1;
  }

  /** Radiation temperature, K */
  temperature(a: number): number {
    return this.p.Tcmb / a;
  }
}
