// Procedural texture generation (no image assets). Alpha channel = height (for bump) unless noted.
import { mulberry32 } from './rng.js';
import { clamp, lerp, smoothstep } from './math.js';

function valueTile(S, fx, fy, rnd) {
  const lat = new Float32Array(fx * fy);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    const gy = (y / S) * fy;
    const iy = Math.floor(gy);
    let ty = gy - iy;
    ty = ty * ty * (3 - 2 * ty);
    const y0 = (iy % fy) * fx, y1 = ((iy + 1) % fy) * fx;
    for (let x = 0; x < S; x++) {
      const gx = (x / S) * fx;
      const ix = Math.floor(gx);
      let tx = gx - ix;
      tx = tx * tx * (3 - 2 * tx);
      const x0 = ix % fx, x1 = (ix + 1) % fx;
      const a = lat[y0 + x0], b = lat[y0 + x1], c = lat[y1 + x0], d = lat[y1 + x1];
      out[y * S + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  return out;
}

export function fbm(S, fx, fy, oct, seed) {
  const rnd = mulberry32(seed);
  const out = new Float32Array(S * S);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const n = valueTile(S, fx << o, fy << o, rnd);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    tot += amp;
    amp *= 0.5;
  }
  // normalize to 0..1 with contrast stretch
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < out.length; i++) { const v = out[i] / tot; out[i] = v; if (v < mn) mn = v; if (v > mx) mx = v; }
  const k = 1 / (mx - mn || 1);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) * k;
  return out;
}

class Img {
  constructor(S) {
    this.S = S;
    this.d = new Float32Array(S * S * 4);
  }
  set(i, r, g, b, h) {
    const o = i * 4, d = this.d;
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = h;
  }
  paint(x, y, r, g, b, a, h = -1, ha = a) {
    const S = this.S;
    x = ((Math.round(x) % S) + S) % S;
    y = ((Math.round(y) % S) + S) % S;
    const o = (y * S + x) * 4, d = this.d;
    d[o] += (r - d[o]) * a;
    d[o + 1] += (g - d[o + 1]) * a;
    d[o + 2] += (b - d[o + 2]) * a;
    if (h >= 0) d[o + 3] += (h - d[o + 3]) * ha;
  }
  mulAt(x, y, k, hk = 1) {
    const S = this.S;
    x = ((Math.round(x) % S) + S) % S;
    y = ((Math.round(y) % S) + S) % S;
    const o = (y * S + x) * 4, d = this.d;
    d[o] *= k; d[o + 1] *= k; d[o + 2] *= k; d[o + 3] *= hk;
  }
  disc(cx, cy, rad, r, g, b, a, h = -1) {
    for (let y = -rad; y <= rad; y++)
      for (let x = -rad; x <= rad; x++) {
        const dd = Math.hypot(x, y) / rad;
        if (dd > 1) continue;
        const f = a * (1 - dd * dd);
        this.paint(cx + x, cy + y, r, g, b, f, h, f);
      }
  }
  crack(rnd, x, y, len, w = 1, dark = 0.06) {
    let ang = rnd() * Math.PI * 2;
    for (let i = 0; i < len; i++) {
      ang += (rnd() - 0.5) * 0.7;
      x += Math.cos(ang);
      y += Math.sin(ang);
      for (let k = 0; k < w; k++) this.paint(x + k * 0.7, y, dark, dark * 0.95, dark * 0.9, 0.85, 0.05, 0.9);
      this.paint(x + 1, y + 1, 1, 1, 1, 0.05, 0.75, 0.3);
      if (rnd() < 0.02 && len - i > 20) this.crack(rnd, x, y, (len - i) * 0.4, 1, dark);
    }
  }
  scratch(x0, y0, x1, y1, r, g, b, a, h) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.paint(lerp(x0, x1, t), lerp(y0, y1, t), r, g, b, a * Math.sin(t * Math.PI), h, a);
    }
  }
  toBytes() {
    const S = this.S, d = this.d;
    const out = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) {
      const ro = (S - 1 - y) * S * 4, ri = y * S * 4;
      for (let x = 0; x < S * 4; x++) out[ro + x] = clamp(d[ri + x] * 255, 0, 255);
    }
    return { data: out, w: S, h: S };
  }
}

const hash2 = (x, y, s) => {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

// ---------------------------------------------------------------- walls
function wallTex(seed, dirty) {
  const S = 512, img = new Img(S), rnd = mulberry32(seed);
  const n1 = fbm(S, 4, 4, 6, seed + 1);
  const n2 = fbm(S, 3, 3, 5, seed + 2);
  const n3 = fbm(S, 32, 32, 3, seed + 3);
  const st = fbm(S, 24, 2, 3, seed + 4);
  const n4 = fbm(S, 6, 6, 4, seed + 5);
  for (let y = 0; y < S; y++) {
    const v = 1 - y / S;
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let r, g, b;
      if (v > 0.4) { r = 0.55; g = 0.6; b = 0.5; } else { r = 0.22; g = 0.34; b = 0.31; }
      if (v > 0.395 && v < 0.425) { r = 0.3; g = 0.16; b = 0.13; }
      let h = 0.55 + (n3[i] - 0.5) * 0.35;
      if (v < 0.05) { r = 0.12; g = 0.1; b = 0.08; h = 0.85; }
      const k = 0.6 + (n1[i] - 0.5) * 0.85 + (n3[i] - 0.5) * 0.2;
      r *= k; g *= k; b *= k;
      const s = smoothstep(0.62, 0.85, st[i]) * (0.25 + 0.75 * smoothstep(0.1, 1.0, v));
      const sa = s * (dirty ? 0.95 : 0.7);
      r = lerp(r, r * 0.55 + 0.07, sa); g = lerp(g, g * 0.5 + 0.045, sa); b = lerp(b, b * 0.4 + 0.02, sa);
      const fd = smoothstep(0.3, 0.0, v) * (0.4 + 0.6 * n1[i]);
      r *= 1 - fd * 0.55; g *= 1 - fd * 0.55; b *= 1 - fd * 0.6;
      const pm = n2[i];
      if (v > 0.06 && pm > 0.7) {
        const c = 0.36 + (n3[i] - 0.5) * 0.3;
        r = c * 1.03; g = c; b = c * 0.9;
        h = 0.2 + (n3[i] - 0.5) * 0.2;
      } else if (v > 0.06 && pm > 0.68) {
        r *= 1.2; g *= 1.2; b *= 1.12; h = 0.85;
      }
      const mold = smoothstep(0.66, 0.8, n4[i]) * smoothstep(0.5, 0.05, v);
      r = lerp(r, 0.04, mold * 0.9); g = lerp(g, 0.06, mold * 0.9); b = lerp(b, 0.035, mold * 0.9);
      if (dirty) {
        const blood = smoothstep(0.72, 0.8, n4[(i + 70000) % (S * S)]) * smoothstep(0.75, 0.2, v);
        r = lerp(r, 0.2, blood * 0.85); g = lerp(g, 0.02, blood * 0.85); b = lerp(b, 0.015, blood * 0.85);
        const dk = 0.8 + 0.2 * n1[i];
        r *= dk; g *= dk; b *= dk;
      }
      img.set(i, r, g, b, h);
    }
  }
  for (let c = 0; c < (dirty ? 9 : 5); c++) img.crack(rnd, rnd() * S, rnd() * S, 60 + rnd() * 220);
  if (dirty) {
    // claw scratches
    for (let c = 0; c < 2; c++) {
      const x = rnd() * S, y = 150 + rnd() * 250, len = 60 + rnd() * 80, ang = 1.2 + rnd() * 0.6;
      for (let f = 0; f < 4; f++)
        img.scratch(x + f * 9, y, x + f * 9 + Math.cos(ang) * len, y + Math.sin(ang) * len, 0.08, 0.06, 0.05, 0.9, 0.05);
    }
  }
  return img.toBytes();
}

function tileWallTex(seed) {
  const S = 512, img = new Img(S), rnd = mulberry32(seed);
  const n1 = fbm(S, 4, 4, 6, seed + 1);
  const n3 = fbm(S, 32, 32, 3, seed + 3);
  const st = fbm(S, 24, 2, 3, seed + 4);
  const cols = 10, rows = 12, tw = S / cols, th = S / rows;
  for (let y = 0; y < S; y++) {
    const v = 1 - y / S;
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const tx = Math.floor(x / tw), ty = Math.floor(y / th);
      const lx = x - tx * tw, ly = y - ty * th;
      const hr = hash2(tx, ty, seed);
      let r = 0.68, g = 0.74, b = 0.7, h = 0.7;
      if (v < 0.35) { r = 0.42; g = 0.55; b = 0.52; }
      r *= 0.9 + hr * 0.15; g *= 0.9 + hr * 0.15; b *= 0.9 + hr * 0.15;
      const edge = Math.min(lx, ly, tw - lx, th - ly);
      h = 0.7 - smoothstep(3, 0, edge) * 0.2;
      if (lx < 2 || ly < 2) { r = 0.16; g = 0.15; b = 0.13; h = 0.1; }
      if (hr > 0.965) { r = 0.3; g = 0.29; b = 0.27; h = 0.2 + n3[i] * 0.2; }
      const k = 0.65 + (n1[i] - 0.5) * 0.8 + (n3[i] - 0.5) * 0.12;
      r *= k; g *= k; b *= k;
      const s = smoothstep(0.65, 0.85, st[i]) * 0.7;
      r = lerp(r, r * 0.5 + 0.08, s); g = lerp(g, g * 0.45 + 0.05, s); b = lerp(b, b * 0.4 + 0.02, s);
      const fd = smoothstep(0.25, 0, v);
      r *= 1 - fd * 0.5; g *= 1 - fd * 0.5; b *= 1 - fd * 0.5;
      img.set(i, r, g, b, h);
    }
  }
  for (let c = 0; c < 6; c++) img.crack(rnd, rnd() * S, rnd() * S, 40 + rnd() * 120);
  return img.toBytes();
}

function paddedTex(seed) {
  const S = 512, img = new Img(S);
  const n1 = fbm(S, 4, 4, 5, seed + 1);
  const n2 = fbm(S, 5, 5, 4, seed + 2);
  const c = 8, cw = S / c;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const lx = (x % cw) / cw, ly = (y % cw) / cw;
      const bulge = Math.sin(lx * Math.PI) * Math.sin(ly * Math.PI);
      let k = 0.6 + 0.4 * Math.sqrt(bulge);
      let r = 0.7 * k, g = 0.68 * k, b = 0.6 * k;
      const gk = 0.72 + (n1[i] - 0.5) * 0.7;
      r *= gk; g *= gk; b *= gk;
      const stain = smoothstep(0.62, 0.78, n2[i]);
      r = lerp(r, 0.38, stain * 0.7); g = lerp(g, 0.3, stain * 0.7); b = lerp(b, 0.14, stain * 0.7);
      const btn = Math.hypot(lx - 0, ly - 0) < 0.06 || Math.hypot(lx - 1, ly - 1) < 0.06 || Math.hypot(lx, ly - 1) < 0.06 || Math.hypot(lx - 1, ly) < 0.06;
      if (btn) { r *= 0.3; g *= 0.3; b *= 0.3; }
      img.set(i, r, g, b, 0.1 + bulge * 0.9);
    }
  return img.toBytes();
}

function concreteTex(seed, floor) {
  const S = 512, img = new Img(S), rnd = mulberry32(seed);
  const n1 = fbm(S, 4, 4, 6, seed + 1);
  const n3 = fbm(S, 48, 48, 3, seed + 3);
  const n2 = fbm(S, 3, 3, 5, seed + 9);
  for (let i = 0; i < S * S; i++) {
    let c = 0.38 + (n1[i] - 0.5) * 0.35 + (n3[i] - 0.5) * 0.12;
    let r = c * 1.02, g = c, b = c * 0.95;
    if (floor) {
      const oil = smoothstep(0.68, 0.8, n2[i]);
      r = lerp(r, 0.07, oil * 0.8); g = lerp(g, 0.065, oil * 0.8); b = lerp(b, 0.06, oil * 0.8);
    }
    img.set(i, r, g, b, 0.5 + (n3[i] - 0.5) * 0.6);
  }
  for (let c = 0; c < 8; c++) img.crack(rnd, rnd() * S, rnd() * S, 80 + rnd() * 250, 2);
  return img.toBytes();
}

// ---------------------------------------------------------------- floors / ceiling
function linoTex(seed) {
  const S = 512, img = new Img(S), rnd = mulberry32(seed);
  const n1 = fbm(S, 4, 4, 6, seed + 1);
  const n2 = fbm(S, 5, 5, 5, seed + 2);
  const n3 = fbm(S, 64, 64, 2, seed + 3);
  const t = 128;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const tx = (x / t) | 0, ty = (y / t) | 0, lx = x % t, ly = y % t;
      const hr = hash2(tx, ty, seed);
      const ch = (tx + ty) & 1;
      let r, g, b;
      if (ch) { r = 0.6; g = 0.58; b = 0.5; } else { r = 0.2; g = 0.25; b = 0.23; }
      const tv = 0.88 + hr * 0.2;
      r *= tv; g *= tv; b *= tv;
      let h = 0.6 + (n3[i] - 0.5) * 0.15;
      if (lx < 2 || ly < 2) { r = 0.09; g = 0.085; b = 0.08; h = 0.15; }
      const k = 0.55 + (n1[i] - 0.5) * 0.9 + (n3[i] - 0.5) * 0.15;
      r *= k; g *= k; b *= k;
      const stain = smoothstep(0.66, 0.8, n2[i]);
      r = lerp(r, 0.12, stain * 0.75); g = lerp(g, 0.09, stain * 0.75); b = lerp(b, 0.05, stain * 0.75);
      if (hr > 0.93) { // broken tile -> concrete
        const c = 0.3 + (n3[i] - 0.5) * 0.2;
        r = c; g = c * 0.97; b = c * 0.92; h = 0.3;
      }
      img.set(i, r, g, b, h);
    }
  for (let c = 0; c < 30; c++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, l = 10 + rnd() * 40;
    img.scratch(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.05, 0.05, 0.05, 0.5, 0.4);
  }
  for (let c = 0; c < 4; c++) img.crack(rnd, rnd() * S, rnd() * S, 50 + rnd() * 120);
  return img.toBytes();
}

function smallTileFloorTex(seed) {
  const S = 512, img = new Img(S);
  const n1 = fbm(S, 4, 4, 6, seed + 1);
  const n2 = fbm(S, 4, 4, 5, seed + 2);
  const n3 = fbm(S, 64, 64, 2, seed + 3);
  const t = 64;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const tx = (x / t) | 0, ty = (y / t) | 0, lx = x % t, ly = y % t;
      const hr = hash2(tx, ty, seed);
      let r = 0.62, g = 0.64, b = 0.6, h = 0.65;
      r *= 0.9 + hr * 0.15; g *= 0.9 + hr * 0.15; b *= 0.9 + hr * 0.15;
      if (lx < 2 || ly < 2) { r = 0.1; g = 0.1; b = 0.09; h = 0.1; }
      const k = 0.55 + (n1[i] - 0.5) * 0.9 + (n3[i] - 0.5) * 0.1;
      r *= k; g *= k; b *= k;
      const stain = smoothstep(0.6, 0.78, n2[i]);
      r = lerp(r, 0.14, stain * 0.8); g = lerp(g, 0.1, stain * 0.8); b = lerp(b, 0.06, stain * 0.8);
      img.set(i, r, g, b, h);
    }
  return img.toBytes();
}

function woodFloorTex(seed) {
  const S = 512, img = new Img(S);
  const grain = fbm(S, 2, 64, 3, seed + 1);
  const n1 = fbm(S, 4, 4, 5, seed + 2);
  const n3 = fbm(S, 64, 64, 2, seed + 3);
  const planks = 6, ph = S / planks;
  for (let y = 0; y < S; y++) {
    const p = Math.floor(y / ph), ly = y - p * ph;
    const off = hash2(p, 1, seed) * S;
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const xx = (x + off) % S;
      const seg = Math.floor(xx / (S / 2));
      const pr = hash2(p, seg, seed + 3);
      const g = grain[y * S + ((x * 3 + p * 100) % S)];
      let c = 0.24 + pr * 0.1 + (g - 0.5) * 0.18;
      let r = c * 1.25, gg = c * 0.82, b = c * 0.5;
      const k = 0.65 + (n1[i] - 0.5) * 0.7 + (n3[i] - 0.5) * 0.1;
      r *= k; gg *= k; b *= k;
      let h = 0.6 + (g - 0.5) * 0.4;
      if (ly < 3 || xx % (S / 2) < 3) { r *= 0.2; gg *= 0.2; b *= 0.2; h = 0.05; }
      img.set(i, r, gg, b, h);
    }
  }
  return img.toBytes();
}

function ceilingTex(seed) {
  const S = 512, img = new Img(S);
  const n1 = fbm(S, 4, 4, 6, seed + 1);
  const n2 = fbm(S, 3, 3, 5, seed + 2);
  const n3 = fbm(S, 128, 128, 1, seed + 3);
  const t = 128;
  const missing = Math.floor(mulberry32(seed)() * 16);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const tx = (x / t) | 0, ty = (y / t) | 0, lx = x % t, ly = y % t;
      let c = 0.55 + (n3[i] > 0.75 ? -0.15 : 0) + (n1[i] - 0.5) * 0.4;
      let r = c, g = c * 0.97, b = c * 0.88, h = n3[i] > 0.75 ? 0.3 : 0.6;
      const w = n2[i];
      if (w > 0.6) {
        const ring = smoothstep(0.6, 0.62, w) - smoothstep(0.63, 0.66, w);
        r = lerp(r, 0.42, 0.5) - ring * 0.2; g = lerp(g, 0.32, 0.5) - ring * 0.2; b = lerp(b, 0.18, 0.5) - ring * 0.15;
      }
      if (tx + ty * 4 === missing) { r = 0.02; g = 0.02; b = 0.02; h = 0.0; }
      if (lx < 4 || ly < 4) { r = 0.3; g = 0.3; b = 0.28; h = 0.9; }
      img.set(i, r, g, b, h);
    }
  return img.toBytes();
}

// ---------------------------------------------------------------- props
function metalTex(seed) {
  const S = 256, img = new Img(S), rnd = mulberry32(seed);
  const n1 = fbm(S, 4, 4, 5, seed + 1);
  const n2 = fbm(S, 4, 4, 5, seed + 2);
  const n3 = fbm(S, 64, 64, 2, seed + 3);
  for (let i = 0; i < S * S; i++) {
    let c = 0.72 + (n1[i] - 0.5) * 0.35 + (n3[i] - 0.5) * 0.1;
    let r = c, g = c, b = c * 0.97, h = 0.6;
    const rust = smoothstep(0.68, 0.8, n2[i]);
    r = lerp(r, 0.36, rust); g = lerp(g, 0.17, rust); b = lerp(b, 0.07, rust);
    h -= rust * 0.3;
    img.set(i, r, g, b, h);
  }
  for (let c = 0; c < 40; c++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, l = 5 + rnd() * 30;
    img.scratch(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.9, 0.9, 0.88, 0.5, 0.3);
  }
  return img.toBytes();
}

function woodTex(seed) {
  const S = 256, img = new Img(S);
  const grain = fbm(S, 2, 32, 4, seed + 1);
  const n1 = fbm(S, 4, 4, 4, seed + 2);
  for (let i = 0; i < S * S; i++) {
    const g = grain[i];
    let c = 0.28 + (g - 0.5) * 0.3;
    const ring = 0.5 + 0.5 * Math.sin(g * 40);
    c *= 0.85 + ring * 0.15;
    const k = 0.7 + (n1[i] - 0.5) * 0.5;
    img.set(i, c * 1.2 * k, c * 0.78 * k, c * 0.48 * k, 0.4 + ring * 0.3);
  }
  return img.toBytes();
}

function fabricTex(seed) {
  const S = 256, img = new Img(S);
  const n1 = fbm(S, 4, 4, 5, seed + 1);
  const n2 = fbm(S, 3, 3, 5, seed + 2);
  const n4 = fbm(S, 5, 5, 4, seed + 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const weave = ((x >> 1) + (y >> 1)) & 1 ? 0.96 : 1.04;
      let c = (0.74 + (n1[i] - 0.5) * 0.4) * weave;
      let r = c, g = c * 0.97, b = c * 0.88;
      const st = smoothstep(0.62, 0.76, n2[i]);
      r = lerp(r, 0.5, st * 0.6); g = lerp(g, 0.42, st * 0.6); b = lerp(b, 0.22, st * 0.6);
      const bl = smoothstep(0.78, 0.86, n4[i]);
      r = lerp(r, 0.25, bl); g = lerp(g, 0.015, bl); b = lerp(b, 0.01, bl);
      img.set(i, r, g, b, 0.5 + (weave - 1) * 3);
    }
  return img.toBytes();
}

function skinTex(seed) {
  const S = 256, img = new Img(S), rnd = mulberry32(seed);
  const n1 = fbm(S, 4, 4, 6, seed + 1);
  const n2 = fbm(S, 8, 8, 4, seed + 2);
  const n3 = fbm(S, 64, 64, 2, seed + 3);
  for (let i = 0; i < S * S; i++) {
    const k = 0.75 + (n1[i] - 0.5) * 0.6;
    let r = 0.52 * k, g = 0.52 * k, b = 0.5 * k;
    const bruise = smoothstep(0.6, 0.85, n2[i]);
    r = lerp(r, 0.2, bruise * 0.7); g = lerp(g, 0.14, bruise * 0.7); b = lerp(b, 0.18, bruise * 0.7);
    img.set(i, r, g, b, 0.5 + (n3[i] - 0.5) * 0.4 + (n2[i] - 0.5) * 0.3);
  }
  for (let c = 0; c < 14; c++) {
    let x = rnd() * S, y = rnd() * S, a = rnd() * 6.28;
    for (let s = 0; s < 120; s++) {
      a += (rnd() - 0.5) * 0.5;
      x += Math.cos(a); y += Math.sin(a);
      img.paint(x, y, 0.16, 0.07, 0.13, 0.55, 0.85, 0.6);
    }
  }
  return img.toBytes();
}

function ceramicTex(seed) {
  const S = 256, img = new Img(S), rnd = mulberry32(seed);
  const n1 = fbm(S, 4, 4, 5, seed + 1);
  const n2 = fbm(S, 4, 4, 5, seed + 2);
  for (let i = 0; i < S * S; i++) {
    const k = 0.8 + (n1[i] - 0.5) * 0.3;
    let r = 0.8 * k, g = 0.8 * k, b = 0.76 * k;
    const st = smoothstep(0.65, 0.8, n2[i]);
    r = lerp(r, 0.45, st * 0.6); g = lerp(g, 0.38, st * 0.6); b = lerp(b, 0.22, st * 0.6);
    img.set(i, r, g, b, 0.6);
  }
  for (let c = 0; c < 4; c++) img.crack(rnd, rnd() * S, rnd() * S, 30 + rnd() * 60);
  return img.toBytes();
}

function cardboardTex(seed) {
  const S = 256, img = new Img(S);
  const n1 = fbm(S, 4, 4, 5, seed + 1);
  const n3 = fbm(S, 2, 48, 2, seed + 3);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const k = 0.75 + (n1[i] - 0.5) * 0.5 + (n3[i] - 0.5) * 0.1;
      let r = 0.52 * k, g = 0.39 * k, b = 0.24 * k;
      if (Math.abs(x - S / 2) < 14) { r *= 1.15; g *= 1.12; b *= 1.0; }
      img.set(i, r, g, b, 0.5);
    }
  return img.toBytes();
}

function paperTex(seed) {
  const S = 128, img = new Img(S);
  const n1 = fbm(S, 4, 4, 4, seed + 1);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let c = 0.82 + (n1[i] - 0.5) * 0.2;
      let r = c, g = c * 0.96, b = c * 0.84;
      if (y > 20 && y % 9 === 0 && x > 12 && x < 116) { r *= 0.55; g *= 0.55; b *= 0.6; }
      img.set(i, r, g, b, 0.5);
    }
  return img.toBytes();
}

function cookieTex() {
  const S = 256, img = new Img(S);
  const n1 = fbm(S, 6, 6, 4, 777);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
      const r = Math.hypot(dx, dy);
      let v = smoothstep(1.0, 0.8, r) * (0.35 + 0.65 * smoothstep(0.55, 0.0, r));
      v += 0.22 * Math.exp(-(((r - 0.62) / 0.05) ** 2));
      v -= 0.12 * Math.exp(-(((r - 0.36) / 0.04) ** 2));
      v *= 0.85 + 0.3 * (n1[i] - 0.5);
      v = clamp(v, 0, 1) * (r < 0.97 ? 1 : 0);
      img.set(i, v, v * 0.94, v * 0.8, 1);
    }
  return img.toBytes();
}

// ---------------------------------------------------------------- canvas-based (decals, signs)
function canvasBytes(cv) {
  const ctx = cv.getContext('2d');
  const id = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const w = cv.width, h = cv.height;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(id.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
  return { data: out, w, h };
}

export const MESSAGES = [
  'HE SEES YOU',
  "DON'T LOOK BEHIND YOU",
  'RUN',
  'IT HEARS YOU BREATHE',
  'WE NEVER LEFT',
  'HIDE',
  'NO ONE GETS OUT',
  'LET ME OUT',
];
export const SPLATS = { hand: 0, hands: 1, splat: 2, splat2: 3, pool: 4, drag: 5, claws: 6, feet: 7 };

function bloodColor(rnd, a = 0.92) {
  const r = 70 + rnd() * 50;
  return `rgba(${r | 0},${(rnd() * 6) | 0},${(rnd() * 5) | 0},${a})`;
}

function decalAtlas(seed) {
  const S = 2048;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(seed);
  ctx.clearRect(0, 0, S, S);
  // writings
  MESSAGES.forEach((msg, k) => {
    const x0 = (k % 2) * 1024, y0 = Math.floor(k / 2) * 256;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, 1024, 256);
    ctx.clip();
    ctx.translate(x0 + 512, y0 + 110);
    ctx.rotate((rnd() - 0.5) * 0.08);
    let size = 150;
    const font = (s) => `${s}px "Creepster", Chiller, "Jokerman", "Impact", "Arial Black", sans-serif`;
    ctx.font = font(size);
    while (ctx.measureText(msg).width > 940 && size > 30) { size -= 6; ctx.font = font(size); }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(msg).width;
    for (let p = 0; p < 6; p++) {
      ctx.fillStyle = bloodColor(rnd, p === 0 ? 0.95 : 0.25);
      ctx.fillText(msg, (rnd() - 0.5) * 8, (rnd() - 0.5) * 6);
    }
    // drips
    for (let d = 0; d < 9 + msg.length; d++) {
      const dx = (rnd() - 0.5) * tw * 0.95;
      const dy = size * 0.25;
      const len = 20 + rnd() * 110;
      const wdt = 2 + rnd() * 5;
      const g = ctx.createLinearGradient(0, dy, 0, dy + len);
      g.addColorStop(0, bloodColor(rnd, 0.9));
      g.addColorStop(1, bloodColor(rnd, 0.6));
      ctx.fillStyle = g;
      ctx.fillRect(dx - wdt / 2, dy, wdt, len);
      ctx.beginPath();
      ctx.arc(dx, dy + len, wdt * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'destination-out';
    for (let e = 0; e < 900; e++) {
      ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.6})`;
      ctx.fillRect((rnd() - 0.5) * 1000, (rnd() - 0.5) * 240, 1 + rnd() * 3, 1 + rnd() * 3);
    }
    ctx.restore();
  });
  const slot = (k) => [(k % 4) * 512, 1024 + Math.floor(k / 4) * 512];
  const blob = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
  const hand = (x, y, sc, rot) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(sc, sc);
    ctx.fillStyle = bloodColor(rnd, 0.85);
    ctx.beginPath();
    ctx.ellipse(0, 0, 42, 50, 0, 0, Math.PI * 2);
    ctx.fill();
    const fingers = [[-34, -62, -0.35, 52], [-13, -80, -0.1, 62], [10, -82, 0.05, 64], [31, -70, 0.25, 56], [52, -10, 0.9, 46]];
    for (const [fx, fy, fr, fl] of fingers) {
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(fr);
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, fl / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // smear downward
    for (let s = 0; s < 14; s++) {
      ctx.fillStyle = bloodColor(rnd, 0.25);
      ctx.fillRect(-40 + rnd() * 80, 20, 3 + rnd() * 6, 60 + rnd() * 140);
    }
    ctx.restore();
  };
  // 0: single hand
  { const [x, y] = slot(0); hand(x + 256, y + 230, 2.2, (rnd() - 0.5) * 0.4); }
  // 1: many hands
  { const [x, y] = slot(1); for (let i = 0; i < 6; i++) hand(x + 80 + rnd() * 350, y + 90 + rnd() * 300, 0.9 + rnd() * 0.4, (rnd() - 0.5) * 1.2); }
  // 2,3: splatter
  for (const k of [2, 3]) {
    const [x, y] = slot(k);
    ctx.fillStyle = bloodColor(rnd, 0.9);
    blob(x + 256, y + 256, 60 + rnd() * 30);
    for (let i = 0; i < 160; i++) {
      const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.7) * 230;
      ctx.fillStyle = bloodColor(rnd, 0.6 + rnd() * 0.35);
      blob(x + 256 + Math.cos(a) * d, y + 256 + Math.sin(a) * d, Math.max(1.5, (1 - d / 240) * 18 * rnd()));
    }
    for (let i = 0; i < 12; i++) {
      const a = rnd() * Math.PI * 2;
      ctx.strokeStyle = bloodColor(rnd, 0.7);
      ctx.lineWidth = 2 + rnd() * 6;
      ctx.beginPath();
      ctx.moveTo(x + 256, y + 256);
      ctx.lineTo(x + 256 + Math.cos(a) * (120 + rnd() * 120), y + 256 + Math.sin(a) * (120 + rnd() * 120));
      ctx.stroke();
    }
  }
  // 4: pool
  {
    const [x, y] = slot(4);
    ctx.fillStyle = 'rgba(55,0,0,0.96)';
    for (let i = 0; i < 26; i++) blob(x + 256 + (rnd() - 0.5) * 220, y + 256 + (rnd() - 0.5) * 220, 50 + rnd() * 70);
  }
  // 5: drag trail (horizontal)
  {
    const [x, y] = slot(5);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = bloodColor(rnd, 0.15 + rnd() * 0.3);
      const yy = y + 200 + rnd() * 110;
      ctx.fillRect(x + rnd() * 40, yy, 420 + rnd() * 60, 2 + rnd() * 6);
    }
    ctx.fillStyle = bloodColor(rnd, 0.85);
    blob(x + 40, y + 256, 60);
  }
  // 6: claw gouges (dark)
  {
    const [x, y] = slot(6);
    for (let set = 0; set < 2; set++) {
      const sx = x + 90 + set * 170, sy = y + 60 + rnd() * 40;
      for (let f = 0; f < 4; f++) {
        ctx.strokeStyle = 'rgba(12,8,6,0.92)';
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sx + f * 26, sy + f * 6);
        let px = sx + f * 26, py = sy + f * 6;
        for (let s = 0; s < 12; s++) { px += 6 + rnd() * 4; py += 28 + rnd() * 8; ctx.lineTo(px, py); }
        ctx.stroke();
        ctx.strokeStyle = 'rgba(90,0,0,0.6)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
  }
  // 7: bloody footprints
  {
    const [x, y] = slot(7);
    for (let i = 0; i < 6; i++) {
      const fx = x + 70 + i * 75, fy = y + 256 + (i % 2 ? -50 : 50);
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(Math.PI / 2 + (rnd() - 0.5) * 0.2);
      ctx.fillStyle = bloodColor(rnd, 0.5 + (i / 6) * 0.4);
      ctx.beginPath(); ctx.ellipse(0, 10, 16, 30, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, 52, 13, 15, 0, 0, Math.PI * 2); ctx.fill();
      for (let t = 0; t < 5; t++) blob(-14 + t * 7, -26 - (t === 0 ? 4 : 0), 5 - t * 0.5);
      ctx.restore();
    }
  }
  return canvasBytes(cv);
}

export function decalUV(kind, index) {
  const S = 2048;
  let x, y, w, h;
  if (kind === 'text') { x = (index % 2) * 1024; y = Math.floor(index / 2) * 256; w = 1024; h = 256; }
  else { x = (index % 4) * 512; y = 1024 + Math.floor(index / 4) * 512; w = 512; h = 512; }
  return { u0: x / S, u1: (x + w) / S, v0: 1 - (y + h) / S, v1: 1 - y / S };
}

function outsideTex() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(99);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#0b1426');
  g.addColorStop(0.55, '#4f6c93');
  g.addColorStop(0.68, '#9db6d6');
  g.addColorStop(0.72, '#4a5f7a');
  g.addColorStop(1, '#0d1118');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const m = ctx.createRadialGradient(178, 62, 2, 178, 62, 40);
  m.addColorStop(0, 'rgba(235,240,255,1)');
  m.addColorStop(0.25, 'rgba(220,230,255,0.9)');
  m.addColorStop(1, 'rgba(160,180,220,0)');
  ctx.fillStyle = m;
  ctx.fillRect(120, 10, 120, 110);
  ctx.fillStyle = '#05070b';
  for (let i = 0; i < 18; i++) {
    const x = rnd() * 256, h = 40 + rnd() * 70, w = 10 + rnd() * 18;
    ctx.beginPath();
    ctx.moveTo(x - w, 180);
    ctx.lineTo(x, 180 - h);
    ctx.lineTo(x + w, 180);
    ctx.fill();
  }
  ctx.fillRect(0, 178, 256, 78);
  ctx.strokeStyle = '#05070b';
  ctx.lineWidth = 3;
  for (let x = 6; x < 256; x += 14) { ctx.beginPath(); ctx.moveTo(x, 256); ctx.lineTo(x, 150); ctx.stroke(); }
  ctx.fillRect(0, 150, 256, 4);
  return canvasBytes(cv);
}

function signTex() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0a0202';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#ff2a1a';
  ctx.font = 'bold 84px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EXIT', 128, 68);
  return canvasBytes(cv);
}

// ---------------------------------------------------------------- materials
export async function buildMaterials(renderer, onProgress = () => {}) {
  const steps = [
    ['wall', () => wallTex(11, false)],
    ['wall2', () => wallTex(23, true)],
    ['tile', () => tileWallTex(31)],
    ['padded', () => paddedTex(41)],
    ['concrete', () => concreteTex(51, false)],
    ['concreteFloor', () => concreteTex(52, true)],
    ['floor', () => linoTex(61)],
    ['floorTile', () => smallTileFloorTex(71)],
    ['woodFloor', () => woodFloorTex(81)],
    ['ceil', () => ceilingTex(91)],
    ['metal', () => metalTex(101)],
    ['wood', () => woodTex(111)],
    ['fabric', () => fabricTex(121)],
    ['skin', () => skinTex(131)],
    ['ceramic', () => ceramicTex(141)],
    ['cardboard', () => cardboardTex(151)],
    ['paper', () => paperTex(161)],
    ['cookie', () => cookieTex()],
    ['decals', () => decalAtlas(171)],
    ['sign', () => signTex()],
    ['outside', () => outsideTex()],
  ];
  const tex = {};
  for (let i = 0; i < steps.length; i++) {
    const [name, fn] = steps[i];
    onProgress(i / steps.length, name);
    await new Promise((r) => setTimeout(r, 0));
    const t = fn();
    tex[name] = renderer.createTexture(t.data, t.w, t.h, { srgb: name !== 'cookie', repeat: name !== 'cookie' && name !== 'decals', mips: name !== 'cookie' });
  }
  onProgress(1, 'done');
  const M = (o) => ({ bump: 0, tint: [1, 1, 1], emissive: [0, 0, 0], spec: 0.15, shin: 20, ...o });
  return {
    textures: tex,
    wall: M({ map: tex.wall, bump: 0.004, spec: 0.08, shin: 12 }),
    wall2: M({ map: tex.wall2, bump: 0.004, spec: 0.08, shin: 12 }),
    tile: M({ map: tex.tile, bump: 0.003, spec: 0.6, shin: 60 }),
    padded: M({ map: tex.padded, bump: 0.03, spec: 0.05, shin: 8 }),
    concrete: M({ map: tex.concrete, bump: 0.004, spec: 0.05, shin: 10 }),
    concreteFloor: M({ map: tex.concreteFloor, bump: 0.004, spec: 0.15, shin: 20 }),
    floor: M({ map: tex.floor, bump: 0.003, spec: 0.45, shin: 50 }),
    floorTile: M({ map: tex.floorTile, bump: 0.003, spec: 0.55, shin: 60 }),
    woodFloor: M({ map: tex.woodFloor, bump: 0.003, spec: 0.3, shin: 30 }),
    ceil: M({ map: tex.ceil, bump: 0.004, spec: 0.03, shin: 8 }),
    metal: M({ map: tex.metal, bump: 0.002, spec: 0.7, shin: 50 }),
    steel: M({ map: tex.metal, bump: 0.001, spec: 1.2, shin: 90, tint: [0.75, 0.77, 0.8] }),
    wood: M({ map: tex.wood, bump: 0.002, spec: 0.25, shin: 25 }),
    fabric: M({ map: tex.fabric, bump: 0.001, spec: 0.03, shin: 6 }),
    skin: M({ map: tex.skin, bump: 0.002, spec: 0.35, shin: 28, tint: [1.15, 1.12, 1.12] }),
    ceramic: M({ map: tex.ceramic, bump: 0.001, spec: 0.9, shin: 80 }),
    cardboard: M({ map: tex.cardboard, spec: 0.04, shin: 6 }),
    paper: M({ map: tex.paper, spec: 0.05, shin: 6 }),
    glass: M({ map: null, tint: [0.03, 0.035, 0.04], spec: 2.0, shin: 140 }),
    blood: M({ map: null, tint: [0.16, 0.0, 0.0], spec: 1.4, shin: 90 }),
    black: M({ map: null, tint: [0.02, 0.02, 0.02], spec: 0.6, shin: 40 }),
    teeth: M({ map: null, tint: [0.62, 0.58, 0.45], spec: 0.8, shin: 60 }),
    eye: M({ map: null, tint: [1, 1, 1], emissive: [3.2, 3.0, 2.3], spec: 0 }),
    lampTube: M({ map: null, tint: [0.9, 0.9, 0.85], emissive: [0, 0, 0], spec: 0.2 }),
    fuse: M({ map: null, tint: [0.6, 0.35, 0.05], emissive: [1.6, 0.7, 0.08], spec: 1.5, shin: 90 }),
    battery: M({ map: null, tint: [0.12, 0.25, 0.6], emissive: [0.03, 0.06, 0.18], spec: 1.2, shin: 70 }),
    sign: M({ map: tex.sign, emissive: [2.2, 2.2, 2.2], emMap: 1, spec: 0 }),
    outside: M({ map: tex.outside, tint: [0, 0, 0], emissive: [7, 7, 7.5], emMap: 1, spec: 0 }),
    decal: M({ map: tex.decals, alpha: 1, spec: 0.9, shin: 60, double: true }),
    ghost: M({ map: tex.fabric, tint: [1.1, 1.15, 1.2], emissive: [0.05, 0.06, 0.07], spec: 0.1 }),
    hair: M({ map: null, tint: [0.015, 0.012, 0.01], spec: 0.6, shin: 30 }),
    cookie: tex.cookie,
  };
}
