/**
 * GLSL sources. COSMIC_POS is the single place where expansion kinematics are
 * evaluated on the GPU; sim/kinematics.ts mirrors it on the CPU.
 */

export const COSMIC_POS = /* glsl */ `
uniform vec3 uCam;      // observer, comoving box units [0,1)
uniform vec3 uTile;     // periodic image offset (0 or 1 per axis)
uniform float uSigmaL;  // view scale × box size (display units per comoving box)
uniform float uD;       // linear growth factor D(t)

attribute vec3 aPsi;
attribute vec3 aHq;
attribute vec3 aHpsi;
attribute vec3 aOff;
attribute vec4 aMisc;   // density rank, random, D at collapse, log10 ignition time

// Position relative to the observer, display units.
//   comoving:  x = q + D ψ   (Zel'dovich)
//   display:   σ·L·(x − x_cam) [+ fixed physical offset for bound matter]
vec3 cosmicPos(vec3 q, out float bound) {
  vec3 x = q + uD * aPsi;
  vec3 rel = mod(x - uCam + uTile + 1.0, 2.0) - 1.0;
  vec3 extra = vec3(0.0);
  bound = 0.0;
  if (aMisc.z < 90.0) {
    bound = smoothstep(aMisc.z * 0.55, aMisc.z, uD);
    vec3 c = aHq + uD * aHpsi;
    rel += bound * (mod(c - x + 0.5, 1.0) - 0.5);
    extra = bound * aOff;           // not scaled by σ: bound structures do not expand
  }
  return rel * uSigmaL + extra;
}
`;

export const MATTER_VERT = /* glsl */ `
${COSMIC_POS}
uniform float uFade, uMfp, uPx, uLogT, uXe, uHe, uGasB, uPlasmaB, uStarB, uAgeRed;
uniform vec3 uPlasmaCol;
varying vec3 vStar;     // starlight colour × intensity
varying vec4 vGas;      // diffuse medium colour, intensity
varying float vCore;    // star core radius as a fraction of the sprite

float hash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }

void main() {
  float w;
  vec3 p = cosmicPos(position, w);
  float dist = length(p);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float fade = (1.0 - smoothstep(uFade * 0.4, uFade, dist)) * smoothstep(0.8, 6.0, dist) * exp(-dist / uMfp);
  float dens = aMisc.x, rnd = aMisc.y, ign = aMisc.w;
  float web = smoothstep(0.04, 0.55, uD);

  // --- ionised plasma (before recombination)
  vec3 pc = uPlasmaCol * (0.75 + 0.5 * hash(rnd * 13.7));
  float pa = uPlasmaB * (0.4 + 1.2 * hash(rnd * 3.3));
  float ps = 0.8 + 1.5 * hash(rnd * 7.9);
  if (rnd < 0.1) {                      // nuclei fused during primordial nucleosynthesis
    float r2 = hash(rnd * 977.0);
    float h = uHe * 1.12;
    float formed = smoothstep(r2 - 0.04, r2 + 0.04, h);
    float spark = exp(-pow((h - r2) / 0.05, 2.0));
    pc = mix(pc, vec3(0.6, 0.85, 1.0), formed * 0.9);
    pa *= 1.0 + 1.6 * formed + 6.0 * spark;
    ps *= 1.0 + 0.9 * spark;
  }

  // --- neutral / intergalactic gas: traces the growing density field
  vec3 gc = mix(vec3(0.17, 0.2, 0.5), vec3(0.32, 0.2, 0.46), hash(rnd * 5.1));
  gc = mix(gc, vec3(0.2, 0.3, 0.75), web * dens);
  float ga = uGasB * mix(0.55 + 0.9 * dens, 0.1 + 2.6 * dens * dens * dens, web);
  float gs = 3.6 + 6.0 * dens * web;

  // --- starlight: ignites first where matter is densest
  float lit = smoothstep(ign, ign + 0.06, uLogT) * (1.0 - uXe);
  float flash = exp(-pow((uLogT - ign - 0.03) / 0.05, 2.0));
  float h2 = hash(rnd * 31.1);
  vec3 sc = mix(vec3(0.62, 0.75, 1.0), vec3(1.0, 0.8, 0.56), smoothstep(0.2, 0.9, h2 + uAgeRed));
  sc = mix(sc, vec3(1.0, 0.95, 0.9), 0.25);
  float sa = uStarB * (0.45 + 0.75 * dens * dens) * (1.0 + 0.9 * flash) * (1.0 - 0.7 * w);
  float ss = mix(0.7, 1.5, dens * h2) * (1.0 + 1.2 * flash);

  ga *= (1.0 - 0.4 * lit) * (1.0 - 0.5 * w);
  vec3 mc = mix(gc, pc, uXe);
  float ma = mix(ga, pa, uXe);
  float s = mix(gs, ps, uXe);

  float px = s * uPx / max(-mv.z, 0.5);
  float corePx = ss * uPx / max(-mv.z, 0.5);
  if (corePx < 1.4) { sa *= corePx * corePx / 1.96; corePx = 1.4; }
  if (px < corePx) { ma *= px * px / (corePx * corePx); px = corePx; }
  px = min(px, 110.0);
  gl_PointSize = px;
  vCore = clamp(corePx / px, 0.02, 1.0);
  vStar = sc * sa * lit * fade;
  vGas = vec4(mc, ma * fade);
  if (max(vGas.a, sa * lit * fade) < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const MATTER_FRAG = /* glsl */ `
varying vec3 vStar;
varying vec4 vGas;
varying float vCore;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float soft = exp(-r * r * 3.2) * (1.0 - r * r);
  float rc = min(r / vCore, 1.0);
  float core = pow(1.0 - rc, 2.5);
  gl_FragColor = vec4(vGas.rgb * vGas.a * soft + vStar * core, 1.0);
}
`;

export const GALAXY_VERT = /* glsl */ `
${COSMIC_POS}
uniform float uFade, uMfp, uLogT, uPx;
attribute vec3 aQ;
attribute vec3 aAxis;
attribute vec4 aG;       // type, radius, seed, log10 formation time
attribute float aLayer;  // 0 = disc in its own plane, 1 = camera-facing glow
varying vec2 vUv;
varying float vLayer;
varying float vA;
varying vec3 vG;

void main() {
  float w;
  vec3 p = cosmicPos(aQ, w);
  float dist = length(p);
  float grow = smoothstep(aG.w, aG.w + 0.5, uLogT);
  float size = aG.y * (0.3 + 0.7 * grow);
  vec3 pos;
  if (aLayer < 0.5) {
    vec3 n = normalize(aAxis);
    vec3 t = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 b = cross(n, t);
    pos = p + (t * position.x + b * position.y) * size;
  } else {
    vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    pos = p + (r * position.x + u * position.y) * size;
  }
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = position.xy;
  vLayer = aLayer;
  vG = aG.xyz;
  float px = size * uPx / max(dist, 0.5);
  vA = grow * (1.0 - smoothstep(uFade * 0.45, uFade, dist)) * smoothstep(0.3, 2.5, dist)
     * exp(-dist / uMfp) * smoothstep(0.6, 3.0, px);
  if (vA < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const GALAXY_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vLayer;
varying float vA;
varying vec3 vG;

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  float type = vG.x, seed = vG.z;
  float r = length(vUv);
  if (r > 1.0) discard;
  float edge = 1.0 - smoothstep(0.72, 1.0, r);
  vec3 col;
  float I;
  if (vLayer < 0.5) {
    if (type < 0.5) {                                   // spiral disc
      float th = atan(vUv.y, vUv.x);
      float arms = seed > 0.72 ? 3.0 : 2.0;
      float wind = 3.2 + 2.2 * fract(seed * 7.3);
      float n1 = vnoise(vUv * 9.0 + seed * 40.0);
      float n2 = vnoise(vUv * 26.0 + seed * 91.0);
      float ph = arms * th - wind * arms * 0.5 * log(r + 0.04) + seed * 6.283 + (n1 - 0.5) * 1.1;
      float arm = pow(0.5 + 0.5 * cos(ph), 2.4);
      float disc = exp(-r * 4.2);
      float bulge = exp(-r * r * 70.0);
      float dust = 1.0 - 0.55 * pow(0.5 + 0.5 * cos(ph + 0.9), 6.0) * smoothstep(0.08, 0.3, r);
      I = disc * (0.22 + 1.9 * arm * (0.55 + 0.9 * n1)) * dust * smoothstep(0.0, 0.1, r + 0.05) + bulge * 1.1;
      vec3 warm = vec3(1.0, 0.82, 0.58), blue = vec3(0.6, 0.74, 1.0);
      col = mix(warm, blue, smoothstep(0.06, 0.45, r) * (0.35 + 0.65 * arm));
      col += vec3(1.0, 0.3, 0.45) * step(0.8, n2) * arm * 0.9;   // star-forming regions
    } else if (type > 1.5) {                            // irregular
      float n = vnoise(vUv * 4.5 + seed * 60.0) * vnoise(vUv * 11.0 + seed * 17.0);
      I = exp(-r * 3.0) * n * 5.0;
      col = mix(vec3(0.62, 0.76, 1.0), vec3(1.0, 0.5, 0.6), step(0.42, n));
    } else {
      discard;                                          // ellipticals have no disc
    }
  } else {
    if (type > 0.5 && type < 1.5) {                     // elliptical: smooth, old stars
      float ang = seed * 3.1416;
      vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * vUv;
      q.y *= 1.0 + 0.9 * fract(seed * 5.7);
      float rr = length(q);
      I = min(exp(-7.2 * pow(rr, 0.42)) * 16.0, 1.8);
      col = vec3(1.0, 0.8, 0.56);
    } else {                                            // faint halo so edge-on discs keep volume
      I = 0.42 * exp(-r * 7.5);
      col = type < 0.5 ? vec3(1.0, 0.85, 0.66) : vec3(0.7, 0.8, 1.0);
    }
  }
  gl_FragColor = vec4(col * I * edge, vA);
}
`;

export const BACKDROP_VERT = /* glsl */ `
uniform mat3 uRot;
uniform vec2 uTan;
varying vec3 vDir;
void main() {
  vDir = uRot * vec3(position.x * uTan.x, position.y * uTan.y, -1.0);
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`;

export const BACKDROP_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uCam;
uniform float uSigmaL, uXe, uMfp, uClock, uBright;
uniform vec3 uColor;
varying vec3 vDir;

float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
// value noise, periodic with integer period 'per' (so it tiles with the box)
float pnoise(vec3 p, float per) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec3 i0 = mod(i, per), i1 = mod(i + 1.0, per);
  return mix(
    mix(mix(h3(vec3(i0.x, i0.y, i0.z)), h3(vec3(i1.x, i0.y, i0.z)), f.x),
        mix(h3(vec3(i0.x, i1.y, i0.z)), h3(vec3(i1.x, i1.y, i0.z)), f.x), f.y),
    mix(mix(h3(vec3(i0.x, i0.y, i1.z)), h3(vec3(i1.x, i0.y, i1.z)), f.x),
        mix(h3(vec3(i0.x, i1.y, i1.z)), h3(vec3(i1.x, i1.y, i1.z)), f.x), f.y), f.z);
}
float sky(vec3 d) {
  return 0.55 * pnoise(d * 9.0 + 31.0, 1024.0) + 0.3 * pnoise(d * 21.0 + 7.0, 1024.0) + 0.15 * pnoise(d * 47.0, 1024.0);
}

void main() {
  vec3 d = normalize(vDir);
  float pattern = 0.5;
  if (uXe > 0.001) {
    // glowing plasma seen from inside: only the nearest mean free path contributes
    float acc = 0.0;
    for (int i = 0; i < 4; i++) {
      float s = (float(i) + 0.6) * 0.33 * min(uMfp, 260.0);
      vec3 pc = uCam + d * s / uSigmaL;
      float wgt = i == 0 ? 0.46 : i == 1 ? 0.28 : i == 2 ? 0.16 : 0.1;
      acc += wgt * (pnoise(pc * 24.0 + vec3(0.0, uClock * 0.16, 0.0), 24.0) * 0.6
           + pnoise(pc * 72.0 - vec3(uClock * 0.27, 0.0, 0.0), 72.0) * 0.4);
    }
    pattern = smoothstep(0.2, 0.8, acc);
  }
  float cmb = sky(d);
  float n = mix(cmb, pattern, uXe);
  // contrast is strongly exaggerated: real CMB anisotropies are ~1 part in 100,000
  float contrast = mix(0.5, 0.55, uXe);
  float k = (n - 0.5) * 2.0;
  vec3 col = uColor * uBright * (1.0 + contrast * k);
  col *= mix(vec3(1.0), mix(vec3(1.08, 0.9, 0.78), vec3(0.9, 1.0, 1.14), smoothstep(-0.5, 0.5, k)), uXe);
  col += (h3(vec3(gl_FragCoord.xy, 1.0)) - 0.5) / 255.0;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;
