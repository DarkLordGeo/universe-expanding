/**
 * Cosmological parameters — flat ΛCDM.
 *
 * Planck 2018 results VI (TT,TE,EE+lowE+lensing+BAO), Table 2:
 *   H0 = 67.66 km/s/Mpc, Ωm = 0.3111, T_CMB = 2.7255 K (Fixsen 2009).
 * Radiation = photons + 3.046 massless neutrino species:
 *   Ωr h² = 2.473e-5 · (1 + 0.2271 · 3.046) = 4.184e-5  →  Ωr = 9.14e-5.
 * Flatness fixes ΩΛ = 1 − Ωm − Ωr.
 */
export interface CosmoParams {
  /** Hubble constant, km/s/Mpc */
  H0: number;
  Om: number;
  Or: number;
  OL: number;
  /** CMB temperature today, K */
  Tcmb: number;
}

const Om = 0.3111;
const Or = 9.14e-5;

export const PLANCK18: CosmoParams = {
  H0: 67.66,
  Om,
  Or,
  OL: 1 - Om - Or,
  Tcmb: 2.7255,
};

/** 1 km/s/Mpc expressed in 1/Gyr */
export const KMSMPC_PER_GYR = 1.0227121650e-3;
export const SECONDS_PER_YEAR = 3.15576e7;
