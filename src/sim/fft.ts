/** In-place radix-2 complex FFT. inverse = true applies the 1/n normalisation. */
export function fft1d(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/** Separable 3-D FFT on an n³ grid stored as index = (z*n + y)*n + x. */
export function fft3d(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
  const lr = new Float64Array(n);
  const li = new Float64Array(n);
  const strides = [1, n, n * n];
  for (let axis = 0; axis < 3; axis++) {
    const s = strides[axis];
    const s1 = strides[(axis + 1) % 3];
    const s2 = strides[(axis + 2) % 3];
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const base = a * s1 + b * s2;
        for (let k = 0; k < n; k++) {
          lr[k] = re[base + k * s];
          li[k] = im[base + k * s];
        }
        fft1d(lr, li, inverse);
        for (let k = 0; k < n; k++) {
          re[base + k * s] = lr[k];
          im[base + k * s] = li[k];
        }
      }
    }
  }
}
