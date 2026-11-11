import { makeDisplacementField, sampleField } from './field';
import { mulberry32 } from './rng';

/** Display units spanned by one comoving box when the view scale is 1 (today). */
export const BOX_DISPLAY = 1000;
/** Comoving size the periodic box stands for, in megaparsecs (≈ 1 billion light-years). */
export const BOX_MPC = 300;
/** misc.z value marking a particle that never joins a bound structure */
export const UNBOUND = 99;

export interface Galaxies {
  count: number;
  /** index of the matter particle each galaxy rides on */
  index: Uint32Array;
  /** disc normal, xyz per galaxy */
  axis: Float32Array;
  /** type (0 spiral, 1 elliptical, 2 irregular), radius in display units, seed, log10(formation time / yr) */
  info: Float32Array;
}

export interface Universe {
  seed: number;
  count: number;
  /** Lagrangian (initial comoving) position q, box units */
  q: Float32Array;
  /** Zel'dovich displacement ψ(q), box units */
  psi: Float32Array;
  /** for bound particles: centre-of-mass q and ψ of the host structure */
  hq: Float32Array;
  hpsi: Float32Array;
  /** for bound particles: fixed *physical* offset inside the structure, display units */
  off: Float32Array;
  /** density rank 0..1, random 0..1, growth factor at collapse (UNBOUND if never), log10(star ignition time / yr) */
  misc: Float32Array;
  haloCount: number;
  galaxies: Galaxies;
}

const wrap01 = (v: number) => v - Math.floor(v);
const nearest = (v: number) => v - Math.round(v);

/**
 * Procedural universe: particles on a jittered lattice displaced by a
 * Zel'dovich field, with the densest knots identified as gravitationally bound
 * structures (groups/clusters) and a subset of particles promoted to galaxies.
 * Everything is derived from `seed`; no observational data is used.
 */
export function generateUniverse(seed: number, n: number, galaxyTarget: number): Universe {
  const field = makeDisplacementField(seed);
  const g = field.g;
  const count = n * n * n;
  const rand = mulberry32(seed ^ 0x9e3779b9);

  // random visiting order so that any prefix of the arrays is a fair sub-sample
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }

  const q = new Float32Array(count * 3);
  const psi = new Float32Array(count * 3);
  const hq = new Float32Array(count * 3);
  const hpsi = new Float32Array(count * 3);
  const off = new Float32Array(count * 3);
  const misc = new Float32Array(count * 4);

  for (let p = 0; p < count; p++) {
    const l = order[p];
    const ix = l % n;
    const iy = Math.floor(l / n) % n;
    const iz = Math.floor(l / (n * n));
    const x = (ix + rand()) / n;
    const y = (iy + rand()) / n;
    const z = (iz + rand()) / n;
    q[p * 3] = x;
    q[p * 3 + 1] = y;
    q[p * 3 + 2] = z;
    psi[p * 3] = sampleField(field.px, g, x, y, z);
    psi[p * 3 + 1] = sampleField(field.py, g, x, y, z);
    psi[p * 3 + 2] = sampleField(field.pz, g, x, y, z);
    misc[p * 4 + 1] = rand();
    misc[p * 4 + 2] = UNBOUND;
  }

  // ---- density of the evolved (D = 1) distribution, cloud-in-cell on the field grid
  const g3 = g * g * g;
  const m = g - 1;
  let dens = new Float32Array(g3);
  const fin = new Float32Array(count * 3);
  for (let p = 0; p < count; p++) {
    const fx = wrap01(q[p * 3] + psi[p * 3]) * g;
    const fy = wrap01(q[p * 3 + 1] + psi[p * 3 + 1]) * g;
    const fz = wrap01(q[p * 3 + 2] + psi[p * 3 + 2]) * g;
    fin[p * 3] = fx;
    fin[p * 3 + 1] = fy;
    fin[p * 3 + 2] = fz;
    const x0 = Math.floor(fx - 0.5);
    const y0 = Math.floor(fy - 0.5);
    const z0 = Math.floor(fz - 0.5);
    const tx = fx - 0.5 - x0;
    const ty = fy - 0.5 - y0;
    const tz = fz - 0.5 - z0;
    for (let dz = 0; dz < 2; dz++)
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
          dens[(((z0 + dz) & m) * g + ((y0 + dy) & m)) * g + ((x0 + dx) & m)] += w;
        }
  }
  // light smoothing (separable 1-2-1)
  for (let axis = 0; axis < 3; axis++) {
    const s = axis === 0 ? 1 : axis === 1 ? g : g * g;
    const next = new Float32Array(g3);
    for (let i = 0; i < g3; i++) {
      const c = Math.floor(i / s) % g;
      const lo = i + (((c - 1) & m) - c) * s;
      const hi = i + (((c + 1) & m) - c) * s;
      next[i] = 0.25 * dens[lo] + 0.5 * dens[i] + 0.25 * dens[hi];
    }
    dens = next;
  }
  const mean = count / g3;

  // ---- density rank per particle
  const pd = new Float32Array(count);
  for (let p = 0; p < count; p++) {
    const c = ((Math.floor(fin[p * 3 + 2]) & m) * g + (Math.floor(fin[p * 3 + 1]) & m)) * g + (Math.floor(fin[p * 3]) & m);
    pd[p] = dens[c] + misc[p * 4 + 1] * 1e-3;
  }
  const byDens = new Uint32Array(count);
  for (let i = 0; i < count; i++) byDens[i] = i;
  byDens.sort((a, b) => pd[a] - pd[b]);
  for (let r = 0; r < count; r++) misc[byDens[r] * 4] = r / (count - 1);

  // ---- bound structures: local maxima of the evolved density
  interface Peak {
    x: number;
    y: number;
    z: number;
    v: number;
  }
  const peaks: Peak[] = [];
  for (let z = 0; z < g; z++)
    for (let y = 0; y < g; y++)
      for (let x = 0; x < g; x++) {
        const v = dens[(z * g + y) * g + x];
        if (v < mean * 4.5) continue;
        let isMax = true;
        for (let dz = -1; dz <= 1 && isMax; dz++)
          for (let dy = -1; dy <= 1 && isMax; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy && !dz) continue;
              const o = dens[(((z + dz) & m) * g + ((y + dy) & m)) * g + ((x + dx) & m)];
              if (o > v || (o === v && (dz < 0 || (dz === 0 && (dy < 0 || (dy === 0 && dx < 0)))))) {
                isMax = false;
                break;
              }
            }
        if (isMax) peaks.push({ x, y, z, v });
      }
  peaks.sort((a, b) => b.v - a.v);
  peaks.length = Math.min(peaks.length, 320);
  const vMax = peaks.length ? peaks[0].v : 1;
  const radius = peaks.map((p) => 0.9 + 0.9 * Math.cbrt(p.v / vMax));
  const owner = new Int16Array(g3).fill(-1);
  for (let h = 0; h < peaks.length; h++) {
    const p = peaks[h];
    const rr = Math.ceil(radius[h]);
    for (let dz = -rr; dz <= rr; dz++)
      for (let dy = -rr; dy <= rr; dy++)
        for (let dx = -rr; dx <= rr; dx++) {
          const c = (((p.z + dz) & m) * g + ((p.y + dy) & m)) * g + ((p.x + dx) & m);
          if (owner[c] < 0) owner[c] = h;
        }
  }
  const members: number[][] = peaks.map(() => []);
  for (let p = 0; p < count; p++) {
    const c = ((Math.floor(fin[p * 3 + 2]) & m) * g + (Math.floor(fin[p * 3 + 1]) & m)) * g + (Math.floor(fin[p * 3]) & m);
    const h = owner[c];
    if (h < 0) continue;
    const pk = peaks[h];
    const dx = nearest((fin[p * 3] - pk.x - 0.5) / g) * g;
    const dy = nearest((fin[p * 3 + 1] - pk.y - 0.5) / g) * g;
    const dz = nearest((fin[p * 3 + 2] - pk.z - 0.5) / g) * g;
    if (dx * dx + dy * dy + dz * dz <= radius[h] * radius[h]) members[h].push(p);
  }
  let mMax = 1;
  for (const list of members) mMax = Math.max(mMax, list.length);
  let haloCount = 0;
  const haloOf = new Int32Array(count).fill(-1);
  for (let h = 0; h < peaks.length; h++) {
    const list = members[h];
    if (list.length < 6) continue;
    haloCount++;
    // centre of mass in Lagrangian space (periodic-safe) and mean displacement
    const r0 = list[0];
    let cx = 0, cy = 0, cz = 0, sx = 0, sy = 0, sz = 0;
    for (const p of list) {
      cx += nearest(q[p * 3] - q[r0 * 3]);
      cy += nearest(q[p * 3 + 1] - q[r0 * 3 + 1]);
      cz += nearest(q[p * 3 + 2] - q[r0 * 3 + 2]);
      sx += psi[p * 3];
      sy += psi[p * 3 + 1];
      sz += psi[p * 3 + 2];
    }
    const k = 1 / list.length;
    cx = q[r0 * 3] + cx * k;
    cy = q[r0 * 3 + 1] + cy * k;
    cz = q[r0 * 3 + 2] + cz * k;
    const Rh = 3.5 + 8.5 * Math.cbrt(list.length / mMax);
    const ax = 0.7 + 0.3 * rand();
    const ay = 0.55 + 0.45 * rand();
    const az = 0.55 + 0.45 * rand();
    const dc = 0.38 + 0.5 * rand();
    for (const p of list) {
      haloOf[p] = h;
      hq[p * 3] = cx;
      hq[p * 3 + 1] = cy;
      hq[p * 3 + 2] = cz;
      hpsi[p * 3] = sx * k;
      hpsi[p * 3 + 1] = sy * k;
      hpsi[p * 3 + 2] = sz * k;
      // isotropic direction, centrally concentrated radius
      const ct = 2 * rand() - 1;
      const st = Math.sqrt(1 - ct * ct);
      const ph = 2 * Math.PI * rand();
      const r = Rh * Math.pow(rand(), 0.85);
      off[p * 3] = r * st * Math.cos(ph) * ax;
      off[p * 3 + 1] = r * st * Math.sin(ph) * ay;
      off[p * 3 + 2] = r * ct * az;
      misc[p * 4 + 2] = dc * (0.85 + 0.3 * rand());
    }
  }

  // ---- star ignition: densest regions first (≈100 Myr), sparse regions never
  for (let p = 0; p < count; p++) {
    const rank = misc[p * 4];
    const lit = rank > 0.45 || haloOf[p] >= 0;
    misc[p * 4 + 3] = lit ? 8.0 + (Math.max(0, 1 - rank) / 0.55) * 1.7 + (rand() - 0.5) * 0.16 : UNBOUND;
  }

  // ---- galaxies
  const gi: number[] = [];
  const perHalo = new Map<number, number>();
  const inHalo: boolean[] = [];
  const first: boolean[] = [];
  for (let p = 0; p < count && gi.length < galaxyTarget * 0.45; p++) {
    const h = haloOf[p];
    if (h < 0) continue;
    const c = perHalo.get(h) ?? 0;
    const cap = Math.min(42, 4 + members[h].length * 0.25);
    if (c >= cap) continue;
    perHalo.set(h, c + 1);
    gi.push(p);
    inHalo.push(true);
    first.push(c === 0);
  }
  for (let p = 0; p < count && gi.length < galaxyTarget; p++) {
    if (haloOf[p] >= 0 || misc[p * 4] < 0.62) continue;
    gi.push(p);
    inHalo.push(false);
    first.push(false);
  }
  const gc = gi.length;
  const galaxies: Galaxies = {
    count: gc,
    index: new Uint32Array(gi),
    axis: new Float32Array(gc * 3),
    info: new Float32Array(gc * 4),
  };
  for (let i = 0; i < gc; i++) {
    const p = gi[i];
    const r = rand();
    let type: number;
    let size: number;
    if (inHalo[i]) {
      type = r < 0.68 ? 1 : r < 0.94 ? 0 : 2;
    } else {
      type = r < 0.66 ? 0 : r < 0.8 ? 1 : 2;
    }
    if (first[i]) type = 1;
    if (type === 0) size = 1.0 + 0.9 * rand();
    else if (type === 1) size = first[i] ? 2.4 + rand() : 0.8 + 0.9 * rand();
    else size = 0.5 + 0.4 * rand();
    const ct = 2 * rand() - 1;
    const st = Math.sqrt(1 - ct * ct);
    const ph = 2 * Math.PI * rand();
    galaxies.axis[i * 3] = st * Math.cos(ph);
    galaxies.axis[i * 3 + 1] = st * Math.sin(ph);
    galaxies.axis[i * 3 + 2] = ct;
    const ign = misc[p * 4 + 3];
    galaxies.info[i * 4] = type;
    galaxies.info[i * 4 + 1] = size;
    galaxies.info[i * 4 + 2] = rand();
    galaxies.info[i * 4 + 3] = Math.max(8.56, ign + 0.3 + 0.4 * rand());
  }

  return { seed, count, q, psi, hq, hpsi, off, misc, haloCount, galaxies };
}
