// CPU-side mesh building with auto-oriented triangles and transformed primitives.
import { mat4 } from '../math.js';

const WHITE = [1, 1, 1];
const _n3 = new Float32Array(9);
const _p = [0, 0, 0];
const _n = [0, 0, 0];

export class MeshData {
  constructor() {
    this.p = [];
    this.n = [];
    this.t = [];
    this.c = [];
    this.i = [];
  }
  get vcount() {
    return this.p.length / 3;
  }
  isEmpty() {
    return this.i.length === 0;
  }
  v(x, y, z, nx, ny, nz, u, vv, c = WHITE) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.t.push(u, vv);
    this.c.push(c[0], c[1], c[2]);
    return this.p.length / 3 - 1;
  }
  tri(a, b, c) {
    const P = this.p, N = this.n;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const e1x = P[b * 3] - ax, e1y = P[b * 3 + 1] - ay, e1z = P[b * 3 + 2] - az;
    const e2x = P[c * 3] - ax, e2y = P[c * 3 + 1] - ay, e2z = P[c * 3 + 2] - az;
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    const nx = N[a * 3] + N[b * 3] + N[c * 3];
    const ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1];
    const nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (cx * nx + cy * ny + cz * nz >= 0) this.i.push(a, b, c);
    else this.i.push(a, c, b);
  }
  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  // quad from 4 world-space points (in order around the quad), normal n
  quadP(p0, p1, p2, p3, n, uv = [0, 0, 1, 0, 1, 1, 0, 1], cols) {
    const cs = cols && Array.isArray(cols[0]) ? cols : [cols || WHITE, cols || WHITE, cols || WHITE, cols || WHITE];
    const a = this.v(p0[0], p0[1], p0[2], n[0], n[1], n[2], uv[0], uv[1], cs[0]);
    const b = this.v(p1[0], p1[1], p1[2], n[0], n[1], n[2], uv[2], uv[3], cs[1]);
    const c = this.v(p2[0], p2[1], p2[2], n[0], n[1], n[2], uv[4], uv[5], cs[2]);
    const d = this.v(p3[0], p3[1], p3[2], n[0], n[1], n[2], uv[6], uv[7], cs[3]);
    this.quad(a, b, c, d);
  }
  append(o) {
    const base = this.vcount;
    for (let k = 0; k < o.p.length; k++) this.p.push(o.p[k]);
    for (let k = 0; k < o.n.length; k++) this.n.push(o.n[k]);
    for (let k = 0; k < o.t.length; k++) this.t.push(o.t[k]);
    for (let k = 0; k < o.c.length; k++) this.c.push(o.c[k]);
    for (let k = 0; k < o.i.length; k++) this.i.push(o.i[k] + base);
  }
}

function tp(m, x, y, z, out) {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}
function tn(n3, x, y, z, out) {
  let a = n3[0] * x + n3[3] * y + n3[6] * z;
  let b = n3[1] * x + n3[4] * y + n3[7] * z;
  let c = n3[2] * x + n3[5] * y + n3[8] * z;
  const l = Math.hypot(a, b, c) || 1;
  out[0] = a / l; out[1] = b / l; out[2] = c / l;
  return out;
}
function axisLen(m, i) {
  return Math.hypot(m[i * 4], m[i * 4 + 1], m[i * 4 + 2]);
}

const FACES = [
  [0, 1, 2, 1], [0, -1, 2, 1],
  [1, 1, 0, 2], [1, -1, 0, 2],
  [2, 1, 0, 1], [2, -1, 0, 1],
];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

// Unit box (-0.5..0.5) transformed by m. uvs = texture repeats per meter.
// uvs may be a number (repeats per meter) or { u, wv } where wv maps world Y -> v for vertical faces.
export function box(md, m, color = WHITE, uvs = 0.5, skip = 0) {
  mat4.normalMat3(_n3, m);
  const S = [axisLen(m, 0), axisLen(m, 1), axisLen(m, 2)];
  const us = typeof uvs === 'number' ? uvs : uvs.u;
  const wv = typeof uvs === 'number' ? 0 : uvs.wv || 0;
  const l = [0, 0, 0];
  for (let f = 0; f < 6; f++) {
    if (skip & (1 << f)) continue;
    const [ax, sg, ua, va] = FACES[f];
    const ids = [];
    for (const [du, dv] of CORNERS) {
      l[0] = l[1] = l[2] = 0;
      l[ax] = 0.5 * sg;
      l[ua] = 0.5 * du;
      l[va] = 0.5 * dv;
      tp(m, l[0], l[1], l[2], _p);
      const nl = [0, 0, 0];
      nl[ax] = sg;
      tn(_n3, nl[0], nl[1], nl[2], _n);
      const u = (l[ua] + 0.5) * S[ua] * us;
      const v = wv && va === 1 ? _p[1] * wv : (l[va] + 0.5) * S[va] * us;
      ids.push(md.v(_p[0], _p[1], _p[2], _n[0], _n[1], _n[2], u, v, color));
    }
    md.quad(ids[0], ids[1], ids[2], ids[3]);
  }
}
export const SKIP_BOTTOM = 1 << 3;

// Cylinder along local Y (-0.5..0.5), radius 0.5 (scaled by m). rTop/rBot scale radius.
export function cylinder(md, m, segs = 10, color = WHITE, rTop = 1, rBot = 1, caps = true, uvs = 0.5) {
  mat4.normalMat3(_n3, m);
  const circ = Math.PI * axisLen(m, 0);
  const hgt = axisLen(m, 1);
  const slope = (rBot - rTop) * 0.5;
  const ring = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const cx = Math.cos(a), sz = Math.sin(a);
    tn(_n3, cx, slope, sz, _n);
    const nn = [_n[0], _n[1], _n[2]];
    tp(m, 0.5 * rBot * cx, -0.5, 0.5 * rBot * sz, _p);
    const b = md.v(_p[0], _p[1], _p[2], nn[0], nn[1], nn[2], (i / segs) * circ * uvs, 0, color);
    tp(m, 0.5 * rTop * cx, 0.5, 0.5 * rTop * sz, _p);
    const t = md.v(_p[0], _p[1], _p[2], nn[0], nn[1], nn[2], (i / segs) * circ * uvs, hgt * uvs, color);
    ring.push([b, t]);
  }
  for (let i = 0; i < segs; i++) md.quad(ring[i][0], ring[i + 1][0], ring[i + 1][1], ring[i][1]);
  if (caps) {
    for (const [y, r, sg] of [[0.5, rTop, 1], [-0.5, rBot, -1]]) {
      if (r <= 0.001) continue;
      tn(_n3, 0, sg, 0, _n);
      const nn = [_n[0], _n[1], _n[2]];
      tp(m, 0, y, 0, _p);
      const c = md.v(_p[0], _p[1], _p[2], nn[0], nn[1], nn[2], 0.5, 0.5, color);
      const ids = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        tp(m, 0.5 * r * Math.cos(a), y, 0.5 * r * Math.sin(a), _p);
        ids.push(md.v(_p[0], _p[1], _p[2], nn[0], nn[1], nn[2], 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a), color));
      }
      for (let i = 0; i < segs; i++) md.tri(c, ids[i], ids[i + 1]);
    }
  }
}

// Sphere radius 0.5 (scaled by m)
export function sphere(md, m, ws = 12, hs = 8, color = WHITE, uvs = 1) {
  mat4.normalMat3(_n3, m);
  const rows = [];
  for (let y = 0; y <= hs; y++) {
    const v = y / hs;
    const th = v * Math.PI;
    const row = [];
    for (let x = 0; x <= ws; x++) {
      const u = x / ws;
      const ph = u * Math.PI * 2;
      const nx = -Math.cos(ph) * Math.sin(th), ny = Math.cos(th), nz = Math.sin(ph) * Math.sin(th);
      tp(m, nx * 0.5, ny * 0.5, nz * 0.5, _p);
      tn(_n3, nx, ny, nz, _n);
      row.push(md.v(_p[0], _p[1], _p[2], _n[0], _n[1], _n[2], u * uvs * 2, v * uvs, color));
    }
    rows.push(row);
  }
  for (let y = 0; y < hs; y++)
    for (let x = 0; x < ws; x++) {
      const a = rows[y][x], b = rows[y][x + 1], c = rows[y + 1][x + 1], d = rows[y + 1][x];
      if (y !== 0) md.tri(a, b, d);
      if (y !== hs - 1) md.tri(b, c, d);
    }
}

// Torus in local XY plane (axis = Z). R major, r minor (in units before m scaling)
export function torus(md, m, R = 0.4, r = 0.05, segs = 16, tsegs = 6, color = WHITE) {
  mat4.normalMat3(_n3, m);
  const grid = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const row = [];
    for (let j = 0; j <= tsegs; j++) {
      const b = (j / tsegs) * Math.PI * 2;
      const cx = Math.cos(a), cy = Math.sin(a);
      const nx = cx * Math.cos(b), ny = cy * Math.cos(b), nz = Math.sin(b);
      tp(m, cx * R + nx * r, cy * R + ny * r, nz * r, _p);
      tn(_n3, nx, ny, nz, _n);
      row.push(md.v(_p[0], _p[1], _p[2], _n[0], _n[1], _n[2], i / segs, j / tsegs, color));
    }
    grid.push(row);
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < tsegs; j++) md.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
}

// Cone along -Z from apex at origin, length 1, end radius 1 (for volumetric beams). Open ended.
export function beamCone(md, segs = 20) {
  const ids = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const x = Math.cos(a), y = Math.sin(a);
    const n = [x, y, 0.35];
    const l = Math.hypot(n[0], n[1], n[2]);
    const a0 = md.v(0, 0, 0, n[0] / l, n[1] / l, n[2] / l, i / segs, 0);
    const a1 = md.v(x, y, -1, n[0] / l, n[1] / l, n[2] / l, i / segs, 1);
    ids.push([a0, a1]);
  }
  for (let i = 0; i < segs; i++) md.quad(ids[i][0], ids[i + 1][0], ids[i + 1][1], ids[i][1]);
}

// Helper: build matrix from position/rotation/scale quickly
const _m = mat4.create();
export function M(x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, base = null) {
  mat4.compose(_m, x, y, z, rx, ry, rz, sx, sy, sz);
  if (base) {
    const o = mat4.create();
    return mat4.multiply(o, base, _m);
  }
  return mat4.copy(mat4.create(), _m);
}
