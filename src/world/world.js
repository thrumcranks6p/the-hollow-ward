// Builds renderable geometry, colliders, doors, lamps, props and items from a generated map.
import { MeshData, box, cylinder, sphere, torus } from '../gl/geometry.js';
import { T, CELL, WALL_H, W, H, DIRS, isWalkableType } from './mapgen.js';
import { RNG } from '../rng.js';
import { mat4, clamp } from '../math.js';
import { decalUV, SPLATS } from '../textures.js';
import { NOTES } from '../story.js';

export const DOOR_W = 1.25;
export const DOOR_H = 2.2;
const CHUNK = 6;
const HALF = CELL / 2;
const YAW = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 };

const C = {
  bedFrame: [0.55, 0.6, 0.58],
  sheet: [0.86, 0.84, 0.78],
  locker: [[0.3, 0.38, 0.34], [0.36, 0.38, 0.4], [0.42, 0.36, 0.28]],
  cabinet: [0.5, 0.52, 0.5],
  dark: [0.15, 0.15, 0.15],
  wood: [0.9, 0.85, 0.8],
};

class PropCtx {
  constructor(world) {
    this.w = world;
    this.base = mat4.create();
    this.tmp = mat4.create();
    this.room = null;
    this.px = 0; this.pz = 0;
  }
  at(x, z, yaw = 0) {
    mat4.compose(this.base, x, 0, z, 0, yaw, 0);
    this.px = x; this.pz = z;
    return this;
  }
  sub(lx, ly, lz, yaw = 0, rx = 0, rz = 0) {
    const c = new PropCtx(this.w);
    mat4.compose(c.tmp, lx, ly, lz, rx, yaw, rz);
    mat4.multiply(c.base, this.base, c.tmp);
    c.room = this.room;
    c.px = c.base[12]; c.pz = c.base[14];
    return c;
  }
  _m(lx, ly, lz, sx, sy, sz, r) {
    mat4.compose(this.tmp, lx, ly, lz, r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, sx, sy, sz);
    return mat4.multiply(mat4.create(), this.base, this.tmp);
  }
  md(mat) { return this.w.md(mat, this.px, this.pz); }
  box(mat, lx, ly, lz, sx, sy, sz, col = [1, 1, 1], r = null, uvs = 0.6) {
    box(this.md(mat), this._m(lx, ly, lz, sx, sy, sz, r), col, uvs);
  }
  cyl(mat, lx, ly, lz, d, h, col = [1, 1, 1], segs = 8, r = null, rTop = 1, rBot = 1) {
    cylinder(this.md(mat), this._m(lx, ly, lz, d, h, d, r), segs, col, rTop, rBot);
  }
  sph(mat, lx, ly, lz, sx, sy, sz, col = [1, 1, 1], r = null, ws = 10, hs = 7) {
    sphere(this.md(mat), this._m(lx, ly, lz, sx, sy, sz, r), ws, hs, col);
  }
  tor(mat, lx, ly, lz, R, rr, col, r) {
    torus(this.md(mat), this._m(lx, ly, lz, 1, 1, 1, r), R, rr, 16, 6, col);
  }
  pt(lx, ly, lz) { return mat4.transformPoint(this.base, lx, ly, lz); }
  col(lx0, lz0, lx1, lz1) {
    const ps = [this.pt(lx0, 0, lz0), this.pt(lx1, 0, lz0), this.pt(lx1, 0, lz1), this.pt(lx0, 0, lz1)];
    const xs = ps.map((p) => p[0]), zs = ps.map((p) => p[2]);
    this.w.addCollider(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs));
  }
  surface(lx, ly, lz) {
    if (this.room) this.w.addSurface(this.room.id, this.pt(lx, ly, lz));
  }
}

export class World {
  constructor(map, renderer, mats) {
    this.map = map;
    this.R = renderer;
    this.mats = mats;
    this.rng = new RNG((map.seed * 31 + 7) >>> 0);
    this.colliders = Array.from({ length: W * H }, () => []);
    this.navBlock = new Uint8Array(W * H);
    this.cellUsed = new Uint8Array(W * H);
    this.chunks = new Map();
    this.decalMDs = new Map();
    this.doors = [];
    this.doorAt = new Int16Array(W * H).fill(-1);
    this.lamps = [];
    this.lockers = [];
    this.items = [];
    this.rockers = [];
    this.musicBoxes = [];
    this.surfaces = new Map();
    this.floorSpots = new Map();
    this.staticDraws = [];
    this.decalDraws = [];
    this.exitOpen = false;
    this.exitAnim = 0;
    this.genLamps = [];
    this.build();
  }

  // ------------------------------------------------------------ helpers
  get(x, y) { return this.map.get(x, y); }
  I(x, y) { return y * W + x; }
  cellOf(x, z) { return [Math.floor(x / CELL), Math.floor(z / CELL)]; }
  center(x, y) { return [(x + 0.5) * CELL, (y + 0.5) * CELL]; }
  roomAt(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    const r = this.map.roomOf[this.I(x, y)];
    return r >= 0 ? this.map.rooms[r] : null;
  }
  md(mat, wx, wz) {
    const cx = clamp(Math.floor(wx / CELL / CHUNK), 0, 99), cy = clamp(Math.floor(wz / CELL / CHUNK), 0, 99);
    const key = `${cx},${cy},${mat}`;
    let m = this.chunks.get(key);
    if (!m) { m = new MeshData(); m.mat = mat; this.chunks.set(key, m); }
    return m;
  }
  decalMD(wx, wz) {
    const key = `${Math.floor(wx / CELL / CHUNK)},${Math.floor(wz / CELL / CHUNK)}`;
    let m = this.decalMDs.get(key);
    if (!m) { m = new MeshData(); this.decalMDs.set(key, m); }
    return m;
  }
  addCollider(x0, z0, x1, z1) {
    const c = { x0, z0, x1, z1 };
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL), cy0 = Math.floor(z0 / CELL), cy1 = Math.floor(z1 / CELL);
    for (let y = cy0; y <= cy1; y++)
      for (let x = cx0; x <= cx1; x++) if (x >= 0 && y >= 0 && x < W && y < H) this.colliders[this.I(x, y)].push(c);
    return c;
  }
  addSurface(roomId, p) {
    if (!this.surfaces.has(roomId)) this.surfaces.set(roomId, []);
    this.surfaces.get(roomId).push(p);
  }
  solidRender(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return true;
    return this.get(x, y) === T.WALL;
  }
  solidCell(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return true;
    const t = this.get(x, y);
    if (t === T.WALL || t === T.BARR) return true;
    if (t === T.EXIT) return this.exitAnim < 0.8;
    return false;
  }
  doorClosed(x, y) {
    const d = this.doorAt[this.I(x, y)];
    return d >= 0 && this.doors[d].anim < 0.35;
  }
  blocksSight(x, y) {
    if (this.solidCell(x, y)) return true;
    return this.doorClosed(x, y);
  }
  monsterWalkable(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const t = this.get(x, y);
    return (t === T.ROOM || t === T.CORR || t === T.DOOR) && !this.navBlock[this.I(x, y)];
  }

  los(x0, z0, x1, z1) {
    let cx = Math.floor(x0 / CELL), cy = Math.floor(z0 / CELL);
    const ex = Math.floor(x1 / CELL), ey = Math.floor(z1 / CELL);
    const dx = x1 - x0, dz = z1 - z0;
    const sx = dx > 0 ? 1 : -1, sy = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tdy = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tmx = dx !== 0 ? (sx > 0 ? (cx + 1) * CELL - x0 : x0 - cx * CELL) / Math.abs(dx) : Infinity;
    let tmy = dz !== 0 ? (sy > 0 ? (cy + 1) * CELL - z0 : z0 - cy * CELL) / Math.abs(dz) : Infinity;
    const sx0 = cx, sy0 = cy;
    for (let n = 0; n < 200; n++) {
      if (cx === ex && cy === ey) return true;
      if (!(cx === sx0 && cy === sy0) && this.blocksSight(cx, cy)) return false;
      if (Math.min(tmx, tmy) > 1) return true;
      if (tmx < tmy) { tmx += tdx; cx += sx; } else { tmy += tdy; cy += sy; }
    }
    return true;
  }

  // distance along a 2D ray until a sight-blocking cell
  rayDist(x0, z0, dx, dz, max) {
    const l = Math.hypot(dx, dz);
    if (l < 1e-5) return max;
    dx /= l; dz /= l;
    let cx = Math.floor(x0 / CELL), cy = Math.floor(z0 / CELL);
    const sx = dx > 0 ? 1 : -1, sy = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tdy = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tmx = dx !== 0 ? (sx > 0 ? (cx + 1) * CELL - x0 : x0 - cx * CELL) / Math.abs(dx) : Infinity;
    let tmy = dz !== 0 ? (sy > 0 ? (cy + 1) * CELL - z0 : z0 - cy * CELL) / Math.abs(dz) : Infinity;
    let t = 0;
    for (let n = 0; n < 100 && t < max; n++) {
      if (tmx < tmy) { t = tmx; tmx += tdx; cx += sx; } else { t = tmy; tmy += tdy; cy += sy; }
      if (this.blocksSight(cx, cy)) return Math.min(t, max);
    }
    return max;
  }

  collide(p, r) {
    for (let it = 0; it < 2; it++) {
      const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
      for (let y = cy - 1; y <= cy + 1; y++)
        for (let x = cx - 1; x <= cx + 1; x++) {
          if (this.solidCell(x, y)) { pushOut(p, r, x * CELL, y * CELL, (x + 1) * CELL, (y + 1) * CELL); continue; }
          const list = this.colliders[this.I(x, y)];
          for (let k = 0; k < list.length; k++) { const c = list[k]; pushOut(p, r, c.x0, c.z0, c.x1, c.z1); }
          const di = this.doorAt[this.I(x, y)];
          if (di >= 0) {
            const d = this.doors[di];
            if (d.anim < 0.2) { const b = d.panelBox; pushOut(p, r, b[0], b[1], b[2], b[3]); }
          }
        }
    }
    return p;
  }

  // ------------------------------------------------------------ build
  build() {
    this.buildShell();
    this.buildDoors();
    this.buildExit();
    this.buildBarricades();
    for (const room of this.map.rooms) this.decorateRoom(room);
    this.buildCorridors();
    this.ensureLockers();
    this.computeFloorSpots();
    this.buildLamps();
    this.placeItems();
    this.buildDecals();
    this.buildModels();
    this.upload();
  }

  wallMat(x, y) {
    const r = this.roomAt(x, y);
    if (r) {
      if (r.type === 'bathroom' || r.type === 'morgue') return 'tile';
      if (r.type === 'isolation') return 'padded';
      if (r.type === 'generator') return 'concrete';
    }
    return this.rng.chance(0.3) ? 'wall2' : 'wall';
  }
  floorMat(x, y) {
    const r = this.roomAt(x, y);
    if (r) {
      if (r.type === 'office' || r.type === 'nursery') return 'woodFloor';
      if (r.type === 'bathroom' || r.type === 'morgue') return 'floorTile';
      if (r.type === 'generator') return 'concreteFloor';
    }
    return 'floor';
  }

  buildShell() {
    const rng = this.rng;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = this.get(x, y);
        if (t === T.WALL) continue;
        const x0 = x * CELL, z0 = y * CELL;
        const tint = 0.9 + rng.next() * 0.14;
        const s = (dx, dy) => (this.solidRender(x + dx, y + dy) ? 1 : 0);
        // AO grid 3x3
        const ao = [];
        for (let j = 0; j < 3; j++)
          for (let i = 0; i < 3; i++) {
            let v = 1;
            const ex = i === 0 ? -1 : i === 2 ? 1 : 0, ey = j === 0 ? -1 : j === 2 ? 1 : 0;
            if (ex && ey) { const c = s(ex, 0) + s(0, ey) + s(ex, ey); v = 1 - c * 0.17; }
            else if (ex) v = s(ex, 0) ? 0.68 : 1;
            else if (ey) v = s(0, ey) ? 0.68 : 1;
            ao.push(v * tint);
          }
        const fm = this.md(this.floorMat(x, y), x0 + 1, z0 + 1);
        const cm = this.md(this.roomAt(x, y)?.type === 'generator' ? 'concrete' : 'ceil', x0 + 1, z0 + 1);
        for (let j = 0; j < 2; j++)
          for (let i = 0; i < 2; i++) {
            const ax = x0 + i * HALF, az = z0 + j * HALF, bx = ax + HALF, bz = az + HALF;
            const u0 = i * 0.5, u1 = u0 + 0.5, v0 = j * 0.5, v1 = v0 + 0.5;
            const c00 = ao[j * 3 + i], c10 = ao[j * 3 + i + 1], c11 = ao[(j + 1) * 3 + i + 1], c01 = ao[(j + 1) * 3 + i];
            const g = (v) => [v, v, v];
            fm.quadP([ax, 0, az], [bx, 0, az], [bx, 0, bz], [ax, 0, bz], [0, 1, 0], [u0, v0, u1, v0, u1, v1, u0, v1], [g(c00), g(c10), g(c11), g(c01)]);
            const k = 0.9;
            cm.quadP([ax, WALL_H, az], [bx, WALL_H, az], [bx, WALL_H, bz], [ax, WALL_H, bz], [0, -1, 0], [u0, v0, u1, v0, u1, v1, u0, v1], [g(c00 * k), g(c10 * k), g(c11 * k), g(c01 * k)]);
          }
        // walls
        for (const [dx, dy, side] of DIRS) {
          if (!this.solidRender(x + dx, y + dy)) continue;
          if (t === T.EXIT && (x + dx < 0 || y + dy < 0 || x + dx >= W || y + dy >= H)) continue; // outside opening
          const mat = this.wallMat(x, y);
          const wm = this.md(mat, x0 + HALF, z0 + HALF);
          let p0, p1, n, endA, endB;
          if (side === 'N') { p0 = [x0, z0]; p1 = [x0 + CELL, z0]; n = [0, 0, 1]; endA = s(-1, 0); endB = s(1, 0); }
          else if (side === 'S') { p0 = [x0 + CELL, z0 + CELL]; p1 = [x0, z0 + CELL]; n = [0, 0, -1]; endA = s(1, 0); endB = s(-1, 0); }
          else if (side === 'W') { p0 = [x0, z0 + CELL]; p1 = [x0, z0]; n = [1, 0, 0]; endA = s(0, 1); endB = s(0, -1); }
          else { p0 = [x0 + CELL, z0]; p1 = [x0 + CELL, z0 + CELL]; n = [-1, 0, 0]; endA = s(0, -1); endB = s(0, 1); }
          const ka = endA ? 0.72 : 1, kb = endB ? 0.72 : 1;
          const bt = 0.6 * tint, tp = 0.82 * tint;
          const g = (v) => [v, v, v];
          wm.quadP([p0[0], 0, p0[1]], [p1[0], 0, p1[1]], [p1[0], WALL_H, p1[1]], [p0[0], WALL_H, p0[1]], n,
            [0, 0, 1, 0, 1, 1, 0, 1], [g(bt * ka), g(bt * kb), g(tp * kb), g(tp * ka)]);
        }
      }
  }

  buildDoors() {
    const rng = this.rng;
    const ctx = new PropCtx(this);
    for (const d of this.map.doors) {
      const [cx, cz] = this.center(d.x, d.y);
      const yaw = d.axis === 'x' ? Math.PI / 2 : 0;
      ctx.at(cx, cz, yaw);
      const wm = this.wallMat(d.x, d.y);
      const pw = HALF - DOOR_W / 2;
      const wuv = { u: 1 / CELL, wv: 1 / WALL_H };
      for (const sg of [-1, 1]) {
        ctx.box(wm, sg * (DOOR_W / 2 + pw / 2), WALL_H / 2, 0, pw, WALL_H, 0.3, [0.7, 0.7, 0.7], null, wuv);
        ctx.col(sg > 0 ? DOOR_W / 2 : -HALF, -0.15, sg > 0 ? HALF : -DOOR_W / 2, 0.15);
        ctx.box('wood', sg * (DOOR_W / 2 + 0.04), DOOR_H / 2, 0, 0.08, DOOR_H + 0.04, 0.36, [0.45, 0.4, 0.36]);
      }
      ctx.box(wm, 0, (DOOR_H + WALL_H) / 2, 0, DOOR_W, WALL_H - DOOR_H, 0.3, [0.7, 0.7, 0.7], null, wuv);
      ctx.box('wood', 0, DOOR_H + 0.04, 0, DOOR_W + 0.16, 0.08, 0.36, [0.45, 0.4, 0.36]);
      const B = mat4.copy(mat4.create(), ctx.base);
      const open = rng.chance(0.4);
      const door = {
        id: d.id, x: d.x, y: d.y, axis: d.axis, yaw, cx, cz, B,
        open, anim: open ? 1 : 0, swing: rng.chance(0.5) ? 1 : -1,
        model: mat4.create(), lastToggle: -10,
      };
      const a = ctx.pt(-DOOR_W / 2, 0, -0.06), b = ctx.pt(DOOR_W / 2, 0, 0.06);
      door.panelBox = [Math.min(a[0], b[0]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[2], b[2])];
      this.updateDoorMatrix(door);
      this.doors.push(door);
      this.doorAt[this.I(d.x, d.y)] = this.doors.length - 1;
    }
  }
  updateDoorMatrix(d) {
    const m = d.model;
    mat4.copy(m, d.B);
    mat4.translate(m, m, -DOOR_W / 2, 0, 0);
    const e = d.anim * d.anim * (3 - 2 * d.anim);
    mat4.rotateY(m, m, e * 1.75 * d.swing);
  }

  buildExit() {
    const e = this.map.exit;
    const [cx, cz] = this.center(e.x, e.y);
    const [ax, az] = this.center(e.ax, e.ay);
    const dx = Math.sign(cx - ax), dz = Math.sign(cz - az);
    // gate plane at border between adj corridor and exit cell
    const gx = (cx + ax) / 2, gz = (cz + az) / 2;
    const yaw = dx !== 0 ? Math.PI / 2 : 0; // local z along passage
    this.exit = { x: e.x, y: e.y, cx, cz, gx, gz, dx, dz, yaw, B: mat4.compose(mat4.create(), gx, 0, gz, 0, yaw, 0), panels: [mat4.create(), mat4.create()] };
    // outside glow quad at far edge
    const ox = cx + dx * HALF * 0.98, oz = cz + dz * HALF * 0.98;
    const ctx = new PropCtx(this).at(ox, oz, yaw);
    ctx.box('outside', 0, WALL_H / 2, 0, CELL, WALL_H, 0.02, [1, 1, 1], null, { u: 1 / CELL, wv: 1 / WALL_H });
    // sign above gate, facing the corridor
    const nx = -dx, nz = -dz;
    const sx = gx + nx * 0.3, sz = gz + nz * 0.3, sy = WALL_H - 0.3;
    const rx = nz, rz = -nx;
    const sm = this.md('sign', sx, sz);
    const hw = 0.32, hh = 0.15;
    sm.quadP([sx - rx * hw, sy - hh, sz - rz * hw], [sx + rx * hw, sy - hh, sz + rz * hw], [sx + rx * hw, sy + hh, sz + rz * hw], [sx - rx * hw, sy + hh, sz - rz * hw], [nx, 0, nz], [0, 0, 1, 0, 1, 1, 0, 1]);
    const bctx = new PropCtx(this).at(sx - nx * 0.03, sz - nz * 0.03, yaw);
    bctx.box('metal', 0, sy, 0, dx !== 0 ? 0.68 : 0.68, 0.34, 0.04, C.dark);
    bctx.box('metal', 0, (sy + WALL_H) / 2 + 0.08, 0, 0.03, WALL_H - sy - 0.1, 0.03, C.dark);
    // frame
    const fctx = new PropCtx(this).at(gx, gz, yaw);
    fctx.box('steel', 0, WALL_H - 0.12, 0, CELL, 0.24, 0.3, [0.4, 0.4, 0.4]);
    this.exitSignPos = [sx + nx * 0.2, sy - 0.1, sz + nz * 0.2];
    this.updateExit(0);
  }
  updateExit(dt) {
    const ex = this.exit;
    if (this.exitOpen) ex.anim = Math.min(1, (ex.anim || 0) + dt * 0.35);
    this.exitAnim = ex.anim || 0;
    const slide = this.exitAnim * (HALF - 0.1);
    for (let k = 0; k < 2; k++) {
      const sg = k === 0 ? -1 : 1;
      const m = ex.panels[k];
      mat4.copy(m, ex.B);
      mat4.translate(m, m, sg * (HALF / 2 + slide), 0, 0);
    }
  }

  buildBarricades() {
    const rng = this.rng;
    for (const b of this.map.barricades) {
      const [cx, cz] = this.center(b.x, b.y);
      const yaw = b.dir === 'h' ? Math.PI / 2 : 0; // local z across corridor... local x along corridor width
      const ctx = new PropCtx(this).at(cx, cz, yaw);
      // tipped bed
      bed(ctx.sub(-0.2, 0.45, -0.9, 0.3, 0, 1.4), rng, { noCol: true });
      // planks crossing the corridor
      for (let k = 0; k < 6; k++) {
        const y = 0.5 + k * 0.38 + rng.range(-0.1, 0.1);
        ctx.box('wood', 0, y, rng.range(-0.3, 0.3), CELL * 1.02, 0.18, 0.04, [0.8, 0.7, 0.6], [0, rng.range(-0.1, 0.1), rng.range(-0.35, 0.35)]);
      }
      chair(ctx.sub(0.6, 0.22, 0.5, rng.range(0, 6), -Math.PI / 2), rng);
      cabinet(ctx.sub(-0.7, 0, 0.6, 0.5, 0, Math.PI / 2 - 0.1), rng, { noCol: true });
      ctx.box('cardboard', 0.6, 0.2, -0.5, 0.5, 0.4, 0.5, [1, 1, 1], [0, 0.4, 0]);
      this.navBlock[this.I(b.x, b.y)] = 1;
    }
  }

  // ------------------------------------------------------------ rooms
  roomCells(room) {
    const out = [];
    for (let y = room.y0; y <= room.y1; y++) for (let x = room.x0; x <= room.x1; x++) if (this.get(x, y) === T.ROOM) out.push([x, y]);
    return out;
  }
  roomConnected(room, keep) {
    const cells = this.roomCells(room).filter(([x, y]) => !this.navBlock[this.I(x, y)]);
    if (!cells.length) return false;
    const set = new Set(cells.map(([x, y]) => this.I(x, y)));
    const start = keep.length ? keep[0] : cells[0];
    if (!set.has(this.I(start[0], start[1]))) return false;
    const seen = new Set([this.I(start[0], start[1])]);
    const q = [start];
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of DIRS) {
        const k = this.I(x + dx, y + dy);
        if (set.has(k) && !seen.has(k)) { seen.add(k); q.push([x + dx, y + dy]); }
      }
    }
    return seen.size === set.size;
  }
  slotFrame(s) {
    const [cx, cz] = this.center(s.x, s.y);
    if (s.side === 'N') return [cx, s.y * CELL, YAW.N];
    if (s.side === 'S') return [cx, (s.y + 1) * CELL, YAW.S];
    if (s.side === 'W') return [s.x * CELL, cz, YAW.W];
    return [(s.x + 1) * CELL, cz, YAW.E];
  }

  decorateRoom(room) {
    const rng = this.rng;
    const cells = this.roomCells(room);
    const keepSet = new Set();
    const keep = [];
    for (const d of room.doors) {
      for (const [dx, dy] of DIRS) {
        const x = d.x + dx, y = d.y + dy;
        if (this.roomAt(x, y) === room) { keepSet.add(this.I(x, y)); keep.push([x, y]); }
      }
    }
    room.keep = keepSet;
    const slots = [];
    for (const [x, y] of cells) {
      if (keepSet.has(this.I(x, y))) continue;
      for (const [dx, dy, side] of DIRS) if (this.get(x + dx, y + dy) === T.WALL) slots.push({ x, y, side });
    }
    rng.shuffle(slots);
    const interior = cells.filter(([x, y]) => x > room.x0 && x < room.x1 && y > room.y0 && y < room.y1 && !keepSet.has(this.I(x, y)));
    const ctx = new PropCtx(this);
    ctx.room = room;
    const use = (fn, { block = false, side = null } = {}) => {
      for (const s of slots) {
        if (this.cellUsed[this.I(s.x, s.y)]) continue;
        if (side && s.side !== side) continue;
        const k = this.I(s.x, s.y);
        if (block) {
          this.navBlock[k] = 1;
          if (!this.roomConnected(room, keep)) { this.navBlock[k] = 0; continue; }
        }
        this.cellUsed[k] = 1;
        const [px, pz, yaw] = this.slotFrame(s);
        fn(ctx.at(px, pz, yaw), s);
        return s;
      }
      return null;
    };
    const useCenter = (fn) => {
      for (const [x, y] of rng.shuffle(interior.slice())) {
        const k = this.I(x, y);
        if (this.cellUsed[k]) continue;
        this.navBlock[k] = 1;
        if (!this.roomConnected(room, keep)) { this.navBlock[k] = 0; continue; }
        this.cellUsed[k] = 1;
        const [cx, cz] = this.center(x, y);
        fn(ctx.at(cx, cz, rng.chance(0.5) ? 0 : Math.PI / 2));
        return true;
      }
      return false;
    };
    const n = cells.length;
    const papers = (count) => {
      for (let i = 0; i < count; i++) {
        const [x, y] = rng.pick(cells);
        const [cx, cz] = this.center(x, y);
        ctx.at(cx + rng.range(-1, 1), cz + rng.range(-1, 1), rng.range(0, 6.28));
        ctx.box('paper', 0, 0.004, 0, 0.21, 0.004, 0.29, [1, 1, 1], [0, 0, 0], 3);
      }
    };

    switch (room.type) {
      case 'ward': {
        const beds = Math.max(1, Math.floor(n / 2.5));
        for (let i = 0; i < beds; i++) use((c) => { bed(c, rng, { blood: rng.chance(0.3) }); if (rng.chance(0.6)) curtain(c, rng); c.surface(0.2, 0.64, 1.4); }, { block: true });
        if (rng.chance(0.8)) use((c) => ivStand(c.sub(rng.range(-0.6, 0.6), 0, 0.4), rng));
        if (rng.chance(0.7)) use((c) => wheelchair(c.sub(rng.range(-0.5, 0.5), 0, 0.6, rng.range(-0.8, 0.8)), rng));
        use((c, s) => this.locker(c, s));
        if (rng.chance(0.5)) use((c) => { cabinet(c, rng); c.surface(0, 1.33, 0.32); });
        papers(3);
        break;
      }
      case 'office': {
        use((c) => { desk(c, rng); c.surface(-0.3, 0.79, 0.4); c.surface(0.35, 0.79, 0.45); chair(c.sub(rng.range(-0.3, 0.3), 0, 1.05, Math.PI + rng.range(-0.5, 0.5)), rng); });
        use((c) => { cabinet(c.sub(-0.5, 0, 0), rng); cabinet(c.sub(0.1, 0, 0), rng); c.surface(-0.5, 1.33, 0.32); });
        if (rng.chance(0.6)) use((c) => { shelf(c, rng); c.surface(0, 1.12, 0.25); });
        if (rng.chance(0.5)) use((c) => chair(c.sub(0, 0.22, 0.9, rng.range(0, 6), -Math.PI / 2), rng));
        papers(8);
        break;
      }
      case 'storage': {
        const sh = Math.max(2, Math.floor(slots.length * 0.4));
        for (let i = 0; i < sh; i++) use((c) => { shelf(c, rng); c.surface(rng.range(-0.6, 0.6), 0.62, 0.25); c.surface(rng.range(-0.6, 0.6), 1.12, 0.25); });
        use((c, s) => this.locker(c, s));
        use((c, s) => this.locker(c, s));
        for (let i = 0; i < 2; i++) use((c) => { crate(c.sub(rng.range(-0.6, 0.6), 0, 0.45, rng.range(-0.4, 0.4)), rng); });
        papers(2);
        break;
      }
      case 'bathroom': {
        use((c) => bathtub(c, rng), { block: true });
        for (let i = 0; i < 3; i++) use((c) => { sink(c, rng); c.surface(0.2, 0.9, 0.2); });
        papers(1);
        break;
      }
      case 'morgue': {
        let t = 0;
        while (t < 3 && useCenter((c) => { morgueTable(c, rng); })) t++;
        use((c) => morgueDrawers(c, rng));
        use((c) => { cabinet(c, rng); c.surface(0, 1.33, 0.32); });
        if (rng.chance(0.7)) use((c) => bodyBag(c.sub(0, 0, 0.6, Math.PI / 2 + rng.range(-0.3, 0.3)), rng));
        if (t === 0) use((c) => morgueTable(c.sub(0, 0, 1.1), rng), { block: true });
        break;
      }
      case 'nursery': {
        for (let i = 0; i < 3; i++) use((c) => { crib(c, rng); c.surface(0, 0.62, 0.38); });
        use((c) => {
          const [x, , z] = c.pt(rng.range(-0.3, 0.3), 0, 0.9);
          this.rockers.push({ x, z, yaw: Math.atan2(c.base[8], c.base[10]) + rng.range(-0.4, 0.4), phase: rng.range(0, 6), m: mat4.create() });
          this.addCollider(x - 0.35, z - 0.35, x + 0.35, z + 0.35);
        });
        for (let i = 0; i < 2; i++) use((c) => teddy(c.sub(rng.range(-0.8, 0.8), 0, rng.range(0.3, 1.0), rng.range(0, 6)), rng));
        use((c) => {
          shelf(c, rng, true);
          const p = c.pt(0, 1.13, 0.25);
          musicBox(c.sub(0, 1.12, 0.25, rng.range(-0.5, 0.5)), rng);
          this.musicBoxes.push(p);
        });
        blocks(ctx, cells, rng, this);
        break;
      }
      case 'isolation': {
        use((c) => bed(c, rng, { straps: true, blood: true }), { block: true });
        room.writeLetMeOut = true;
        break;
      }
      case 'hall': {
        let t = 0;
        while (t < 4 && useCenter((c) => longTable(c, rng))) t++;
        for (let i = 0; i < 3; i++) use((c) => chair(c.sub(rng.range(-0.8, 0.8), rng.chance(0.5) ? 0 : 0.22, rng.range(0.4, 1.0), rng.range(0, 6), rng.chance(0.5) ? 0 : -Math.PI / 2), rng));
        use((c) => { cabinet(c, rng); c.surface(0, 1.33, 0.32); });
        use((c, s) => this.locker(c, s));
        papers(4);
        break;
      }
      case 'generator': {
        use((c) => this.generator(c, rng), { block: true });
        use((c) => { crate(c.sub(-0.5, 0, 0.45), rng); crate(c.sub(0.3, 0, 0.4, 0.3), rng); });
        use((c) => { shelf(c, rng); c.surface(0, 0.62, 0.25); });
        use((c, s) => this.locker(c, s));
        break;
      }
    }
  }

  locker(c, s) {
    const rng = this.rng;
    const col = rng.pick(C.locker);
    const W_ = 0.62, D = 0.55, Hh = 1.98;
    c.box('metal', 0, Hh / 2, 0.01, W_, Hh, 0.02, col);
    for (const sg of [-1, 1]) c.box('metal', sg * (W_ / 2 - 0.01), Hh / 2, D / 2, 0.02, Hh, D, col);
    c.box('metal', 0, Hh - 0.01, D / 2, W_, 0.02, D, col);
    c.box('metal', 0, 0.04, D / 2, W_, 0.08, D, col);
    const fz = D - 0.01;
    c.box('metal', 0, 0.71, fz, W_, 1.42, 0.02, col);
    c.box('metal', 0, (1.74 + Hh) / 2, fz, W_, Hh - 1.74, 0.02, col);
    for (const sg of [-1, 1]) c.box('metal', sg * (W_ / 2 - 0.05), 1.58, fz, 0.1, 0.32, 0.02, col);
    for (let k = 0; k < 5; k++) c.box('metal', 0, 1.445 + k * 0.064, fz, W_ - 0.2, 0.026, 0.02, col, [0.35, 0, 0]);
    c.box('steel', W_ / 2 - 0.1, 1.1, D + 0.01, 0.03, 0.12, 0.03);
    c.col(-W_ / 2, 0, W_ / 2, D + 0.02);
    const p = c.pt(0, 0, 0.27);
    const f = c.pt(0, 0, 1.0);
    const yaw = Math.atan2(f[0] - p[0], f[2] - p[2]);
    this.lockers.push({ id: this.lockers.length, x: p[0], z: p[2], yaw, front: [f[0], f[2]], cell: [s.x, s.y] });
  }

  generator(c, rng) {
    const body = [0.2, 0.28, 0.22];
    c.box('metal', 0, 0.08, 0.7, 1.9, 0.16, 1.2, [0.2, 0.2, 0.2]);
    c.box('metal', 0, 0.85, 0.7, 1.7, 1.4, 1.0, body);
    c.cyl('steel', -0.4, 1.0, 0.7, 0.55, 1.6, [0.5, 0.5, 0.5], 14, [0, 0, Math.PI / 2]);
    c.cyl('metal', 0.55, 1.75, 0.5, 0.2, 2.2, [0.25, 0.25, 0.25], 10);
    c.box('metal', 0, 1.1, 1.215, 0.9, 0.5, 0.04, [0.08, 0.08, 0.08]);
    for (let i = 0; i < 3; i++) c.cyl('glass', -0.25 + i * 0.25, 1.2, 1.24, 0.14, 0.02, [1, 1, 1], 12, [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 6; i++) c.box('metal', -0.75 + i * 0.3, 0.2, 1.31, 0.15, 0.1, 0.02, i % 2 ? [0.6, 0.5, 0.05] : [0.05, 0.05, 0.05]);
    for (let i = 0; i < 3; i++) c.cyl('black', -0.6 + i * 0.3, 0.03, 1.3 + i * 0.1, 0.05, 1.2 + i * 0.3, [1, 1, 1], 6, [Math.PI / 2, rng.range(-0.3, 0.3), 0]);
    c.col(-0.95, 0.1, 0.95, 1.3);
    const front = c.pt(0, 1.0, 1.55);
    this.generatorPos = { x: front[0], y: 1.0, z: front[2] };
    for (let i = 0; i < 4; i++) this.genLamps.push({ p: c.pt(-0.3 + i * 0.2, 0.95, 1.24), m: mat4.compose(mat4.create(), ...c.pt(-0.3 + i * 0.2, 0.95, 1.24), 0, 0, 0, 0.07, 0.07, 0.07) });
  }

  ensureLockers() {
    const rng = this.rng;
    const ctx = new PropCtx(this);
    let tries = 0;
    while (this.lockers.length < 10 && tries++ < 400) {
      const x = rng.int(1, W - 2), y = rng.int(1, H - 2);
      if (this.get(x, y) !== T.CORR || this.cellUsed[this.I(x, y)]) continue;
      let doorNear = false;
      for (const [dx, dy] of DIRS) if (this.get(x + dx, y + dy) === T.DOOR || this.get(x + dx, y + dy) === T.EXIT) doorNear = true;
      if (doorNear) continue;
      const sides = DIRS.filter(([dx, dy]) => this.get(x + dx, y + dy) === T.WALL);
      if (sides.length !== 2) continue;
      const [, , side] = rng.pick(sides);
      const s = { x, y, side };
      const [px, pz, yaw] = this.slotFrame(s);
      this.cellUsed[this.I(x, y)] = 1;
      this.locker(ctx.at(px, pz, yaw), s);
    }
  }

  buildCorridors() {
    const rng = this.rng;
    const ctx = new PropCtx(this);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        if (this.get(x, y) !== T.CORR || this.cellUsed[this.I(x, y)]) continue;
        const sides = DIRS.filter(([dx, dy]) => this.get(x + dx, y + dy) === T.WALL);
        let doorNear = false;
        for (const [dx, dy] of DIRS) { const t = this.get(x + dx, y + dy); if (t === T.DOOR || t === T.EXIT || t === T.BARR) doorNear = true; }
        if (sides.length !== 2 || doorNear || !rng.chance(0.09)) continue;
        const [, , side] = rng.pick(sides);
        const [px, pz, yaw] = this.slotFrame({ x, y, side });
        ctx.at(px, pz, yaw);
        ctx.room = null;
        this.cellUsed[this.I(x, y)] = 1;
        const r = rng.next();
        if (r < 0.3) gurney(ctx, rng);
        else if (r < 0.5) wheelchair(ctx.sub(rng.range(-0.6, 0.6), 0, 0.55, rng.range(-1, 1)), rng);
        else if (r < 0.65) chair(ctx.sub(rng.range(-0.6, 0.6), 0.22, 0.6, rng.range(0, 6), -Math.PI / 2), rng);
        else if (r < 0.8) bodyBag(ctx.sub(0, 0, 0.45, Math.PI / 2 + rng.range(-0.2, 0.2)), rng);
        else cabinet(ctx.sub(rng.range(-0.6, 0.6), 0, 0), rng);
      }
  }

  computeFloorSpots() {
    for (const room of this.map.rooms) {
      const spots = [];
      for (const [x, y] of this.roomCells(room)) {
        if (this.navBlock[this.I(x, y)]) continue;
        for (let k = 0; k < 4; k++) {
          const [cx, cz] = this.center(x, y);
          const p = [cx + this.rng.range(-0.7, 0.7), cz + this.rng.range(-0.7, 0.7)];
          if (this.pointFree(p[0], p[1], 0.3)) { spots.push([p[0], 0, p[1]]); break; }
        }
      }
      this.floorSpots.set(room.id, spots);
    }
  }
  pointFree(x, z, r) {
    const p = [x, z];
    this.collide(p, r);
    return Math.hypot(p[0] - x, p[1] - z) < 0.01;
  }

  buildLamps() {
    const rng = this.rng;
    const spots = [];
    const seen = new Set();
    for (const y of [1, 10, 19, 28]) {
      const off = rng.int(0, 3);
      for (let x = 2 + off; x < W - 2; x += 4) if (this.get(x, y) === T.CORR) spots.push({ x, y, axis: 'x' });
    }
    for (const x of [1, 12, 23, 34]) {
      const off = rng.int(0, 3);
      for (let y = 3 + off; y < H - 2; y += 4) if (this.get(x, y) === T.CORR) spots.push({ x, y, axis: 'z' });
    }
    for (const room of this.map.rooms) {
      const cnt = room.hall ? 2 : 1;
      const cells = this.roomCells(room).filter(([x, y]) => !this.navBlock[this.I(x, y)]);
      for (let k = 0; k < cnt && cells.length; k++) {
        const [x, y] = k === 0 ? cells[Math.floor(cells.length / 2)] : rng.pick(cells);
        spots.push({ x, y, axis: room.w > room.h ? 'x' : 'z', room });
      }
    }
    const ctx = new PropCtx(this);
    for (const s of spots) {
      const k = this.I(s.x, s.y);
      if (seen.has(k)) continue;
      seen.add(k);
      const [cx, cz] = this.center(s.x, s.y);
      const isSpawn = s.room === this.map.spawnRoom;
      const isGen = s.room === this.map.genRoom;
      const r = rng.next();
      const mode = isSpawn ? 'flicker' : isGen ? 'dead' : r < 0.42 ? 'dead' : r < 0.78 ? 'flicker' : 'steady';
      const warm = rng.chance(0.35);
      const color = warm ? [1.0, 0.68, 0.38] : [0.72, 0.92, 0.82];
      const yaw = s.axis === 'x' ? 0 : Math.PI / 2;
      ctx.at(cx, cz, yaw);
      ctx.box('metal', 0, WALL_H - 0.03, 0, 1.25, 0.06, 0.28, [0.55, 0.55, 0.52]);
      const m = mat4.compose(mat4.create(), cx, WALL_H - 0.075, cz, 0, yaw, 0);
      this.lamps.push({
        x: cx, z: cz, pos: [cx, WALL_H - 0.25, cz], m, mode, baseMode: mode, seed: rng.next() * 100,
        color, base: warm ? 2.4 : 2.0, level: 0, box: this.lightBox(s.x, s.y, 3), range: 8.5,
      });
    }
  }
  lightBox(x, y, R) {
    let mnx = x, mny = y, mxx = x, mxy = y;
    const [cx, cz] = this.center(x, y);
    for (let j = y - R; j <= y + R; j++)
      for (let i = x - R; i <= x + R; i++) {
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        const t = this.get(i, j);
        if (t === T.WALL) continue;
        const [tx, tz] = this.center(i, j);
        if (!this.losStatic(cx, cz, tx, tz)) continue;
        mnx = Math.min(mnx, i); mny = Math.min(mny, j); mxx = Math.max(mxx, i); mxy = Math.max(mxy, j);
      }
    return [mnx * CELL - 0.05, mny * CELL - 0.05, (mxx + 1) * CELL + 0.05, (mxy + 1) * CELL + 0.05];
  }
  losStatic(x0, z0, x1, z1) {
    const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.3);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const [cx, cy] = this.cellOf(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      if (this.solidRender(cx, cy) || this.get(cx, cy) === T.BARR) return false;
    }
    return true;
  }

  placeItems() {
    const rng = this.rng;
    const map = this.map;
    const rc = (r) => this.center(Math.floor((r.x0 + r.x1) / 2), Math.floor((r.y0 + r.y1) / 2));
    const spotIn = (room, preferSurface) => {
      const s = this.surfaces.get(room.id) || [];
      const f = this.floorSpots.get(room.id) || [];
      if (s.length && (preferSurface || !f.length) && rng.chance(0.75)) return s.splice(rng.int(0, s.length - 1), 1)[0];
      if (f.length) return f.splice(rng.int(0, f.length - 1), 1)[0];
      if (s.length) return s.splice(rng.int(0, s.length - 1), 1)[0];
      return null;
    };
    // fuses: farthest point sampling
    const pool = map.rooms.filter((r) => r !== map.spawnRoom && r !== map.genRoom);
    const chosen = [];
    const anchors = [rc(map.spawnRoom), rc(map.genRoom)];
    for (let k = 0; k < 4; k++) {
      let best = null, bestD = -1;
      for (const r of pool) {
        if (chosen.includes(r)) continue;
        const c = rc(r);
        let d = Infinity;
        for (const a of anchors) d = Math.min(d, Math.hypot(a[0] - c[0], a[1] - c[1]));
        d += rng.range(0, 8);
        if (d > bestD) { bestD = d; best = r; }
      }
      if (!best) break;
      chosen.push(best);
      anchors.push(rc(best));
    }
    for (const r of chosen) {
      const p = spotIn(r, true);
      if (p) this.items.push({ id: this.items.length, kind: 'fuse', pos: p, taken: false, room: r.id });
    }
    // notes
    const noteRooms = [map.spawnRoom, ...rng.shuffle(pool.filter((r) => !chosen.includes(r)))];
    for (let i = 0; i < NOTES.length && i < noteRooms.length; i++) {
      const p = spotIn(noteRooms[i], true);
      if (p) this.items.push({ id: this.items.length, kind: 'note', note: i, pos: p, taken: false, yaw: rng.range(0, 6.28), room: noteRooms[i].id });
    }
    // batteries
    const batRooms = [map.spawnRoom, ...rng.shuffle(map.rooms.filter((r) => r !== map.spawnRoom))];
    let b = 0;
    for (const r of batRooms) {
      if (b >= 9) break;
      const p = spotIn(r, false);
      if (p) { this.items.push({ id: this.items.length, kind: 'battery', pos: p, taken: false, yaw: rng.range(0, 6.28), room: r.id }); b++; }
    }
    // spawn points
    const sp = this.floorSpots.get(map.spawnRoom.id) || [];
    this.spawnPoints = [];
    const cells = this.roomCells(map.spawnRoom).filter(([x, y]) => !this.navBlock[this.I(x, y)]);
    for (const [x, y] of cells) {
      const [cx, cz] = this.center(x, y);
      if (this.pointFree(cx, cz, 0.35)) this.spawnPoints.push([cx, cz]);
    }
    if (!this.spawnPoints.length) this.spawnPoints.push(sp.length ? [sp[0][0], sp[0][2]] : this.center(cells[0][0], cells[0][1]));
    const mc = this.roomCells(map.monsterRoom).filter(([x, y]) => !this.navBlock[this.I(x, y)]);
    this.monsterSpawn = this.center(...(mc.length ? mc[0] : [map.monsterRoom.x0, map.monsterRoom.y0]));
  }

  // ------------------------------------------------------------ decals
  wallDecal(x, y, side, kind, idx, w, h, yc, off = 0) {
    const uv = decalUV(kind, idx);
    const x0 = x * CELL, z0 = y * CELL, e = 0.015;
    const md = this.decalMD(x0 + HALF, z0 + HALF);
    let a, b, n;
    const cxw = x0 + HALF + off, czw = z0 + HALF + off;
    if (side === 'N') { a = [cxw - w / 2, z0 + e]; b = [cxw + w / 2, z0 + e]; n = [0, 0, 1]; }
    else if (side === 'S') { a = [cxw + w / 2, z0 + CELL - e]; b = [cxw - w / 2, z0 + CELL - e]; n = [0, 0, -1]; }
    else if (side === 'W') { a = [x0 + e, czw + w / 2]; b = [x0 + e, czw - w / 2]; n = [1, 0, 0]; }
    else { a = [x0 + CELL - e, czw - w / 2]; b = [x0 + CELL - e, czw + w / 2]; n = [-1, 0, 0]; }
    const y0 = yc - h / 2, y1 = yc + h / 2;
    md.quadP([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], n, [uv.u0, uv.v0, uv.u1, uv.v0, uv.u1, uv.v1, uv.u0, uv.v1], [0.95, 0.95, 0.95]);
  }
  floorDecal(x, z, idx, size, rot) {
    const uv = decalUV('splat', idx);
    const md = this.decalMD(x, z);
    const c = Math.cos(rot) * size / 2, s = Math.sin(rot) * size / 2;
    const y = 0.012;
    md.quadP([x - c + s, y, z - s - c], [x + c + s, y, z + s - c], [x + c - s, y, z + s + c], [x - c - s, y, z - s + c], [0, 1, 0],
      [uv.u0, uv.v0, uv.u1, uv.v0, uv.u1, uv.v1, uv.u0, uv.v1], [0.9, 0.9, 0.9]);
  }
  buildDecals() {
    const rng = this.rng;
    const faces = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = this.get(x, y);
        if (t !== T.CORR && t !== T.ROOM) continue;
        for (const [dx, dy, side] of DIRS) if (this.get(x + dx, y + dy) === T.WALL && x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H) faces.push({ x, y, side, corr: t === T.CORR, room: this.roomAt(x, y) });
      }
    rng.shuffle(faces);
    const used = new Set();
    const take = (pred) => {
      for (const f of faces) {
        const k = `${f.x},${f.y},${f.side}`;
        if (used.has(k) || !pred(f)) continue;
        used.add(k);
        return f;
      }
      return null;
    };
    for (let i = 0; i < 7; i++) {
      const f = take((f) => f.corr);
      if (f) this.wallDecal(f.x, f.y, f.side, 'text', i % 7, 2.3, 0.58, 1.55 + rng.range(-0.2, 0.25));
    }
    for (const room of this.map.rooms) {
      if (room.writeLetMeOut) {
        const f = take((f) => f.room === room);
        if (f) this.wallDecal(f.x, f.y, f.side, 'text', 7, 2.2, 0.55, 1.4);
        for (let k = 0; k < 2; k++) { const g = take((f) => f.room === room); if (g) this.wallDecal(g.x, g.y, g.side, 'splat', SPLATS.claws, 1.2, 1.2, 1.2, rng.range(-0.5, 0.5)); }
      }
    }
    for (let i = 0; i < 10; i++) {
      const f = take(() => true);
      if (f) this.wallDecal(f.x, f.y, f.side, 'splat', rng.pick([SPLATS.hand, SPLATS.hands, SPLATS.splat, SPLATS.splat2, SPLATS.claws]), 1.1, 1.1, rng.range(0.9, 1.6), rng.range(-0.6, 0.6));
    }
    // floor decals
    for (let i = 0; i < 22; i++) {
      const x = rng.int(1, W - 2), y = rng.int(1, H - 2);
      const t = this.get(x, y);
      if (t !== T.CORR && t !== T.ROOM) continue;
      const [cx, cz] = this.center(x, y);
      const kind = rng.pick([SPLATS.pool, SPLATS.drag, SPLATS.drag, SPLATS.feet, SPLATS.splat, SPLATS.splat2]);
      let rot = rng.range(0, 6.28);
      if (t === T.CORR && (kind === SPLATS.drag || kind === SPLATS.feet)) {
        const horiz = this.get(x - 1, y) !== T.WALL && this.get(x + 1, y) !== T.WALL;
        rot = horiz ? (rng.chance(0.5) ? 0 : Math.PI) : (rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2);
      }
      this.floorDecal(cx + rng.range(-0.4, 0.4), cz + rng.range(-0.4, 0.4), kind, kind === SPLATS.pool ? rng.range(0.9, 1.6) : 2.2, rot);
    }
  }

  // ------------------------------------------------------------ dynamic models
  buildModels() {
    const R = this.R;
    const mk = (fn) => {
      const parts = new Map();
      const c = new PropCtx({ md: (mat) => { if (!parts.has(mat)) parts.set(mat, new MeshData()); return parts.get(mat); }, addCollider() {}, addSurface() {} });
      c.at(0, 0, 0);
      fn(c);
      return [...parts].map(([mat, md]) => ({ mesh: R.createMesh(md), mat: this.mats[mat] }));
    };
    this.models = {
      door: mk((c) => {
        const col = [0.42, 0.5, 0.46];
        c.box('metal', DOOR_W / 2, DOOR_H / 2, 0, DOOR_W - 0.02, DOOR_H - 0.02, 0.05, col);
        c.box('steel', DOOR_W / 2, 0.15, 0, DOOR_W - 0.1, 0.25, 0.065, [0.5, 0.5, 0.5]);
        c.box('glass', DOOR_W / 2, 1.6, 0, 0.32, 0.42, 0.06);
        c.box('metal', DOOR_W / 2, 1.6, 0, 0.4, 0.5, 0.055, [0.2, 0.22, 0.2]);
        for (const sz of [-1, 1]) c.cyl('steel', DOOR_W - 0.12, 1.0, sz * 0.06, 0.035, 0.08, [0.8, 0.8, 0.8], 8, [Math.PI / 2, 0, 0]);
        for (const y of [0.3, 1.9]) c.box('steel', 0.015, y, 0, 0.04, 0.12, 0.07);
      }),
      gate: mk((c) => {
        const col = [0.25, 0.28, 0.27];
        c.box('metal', 0, (WALL_H - 0.24) / 2, 0, HALF, WALL_H - 0.24, 0.08, col);
        c.box('steel', 0, 1.05, 0.07, HALF - 0.2, 0.06, 0.06, [0.7, 0.7, 0.7]);
        c.box('steel', 0, 1.05, -0.07, HALF - 0.2, 0.06, 0.06, [0.7, 0.7, 0.7]);
        c.box('glass', 0, 1.9, 0, 0.3, 0.5, 0.09);
        for (let k = 0; k < 3; k++) c.box('metal', 0, 0.4 + k * 0.9, 0, HALF - 0.02, 0.04, 0.1, [0.15, 0.15, 0.15]);
      }),
      lampTube: mk((c) => c.box('lampTube', 0, 0, 0, 1.1, 0.04, 0.08)),
      fuse: mk((c) => {
        c.cyl('fuse', 0, 0.04, 0, 0.075, 0.2, [1, 1, 1], 10, [0, 0, Math.PI / 2]);
        for (const sx of [-1, 1]) c.cyl('steel', sx * 0.115, 0.04, 0, 0.085, 0.04, [0.9, 0.85, 0.6], 10, [0, 0, Math.PI / 2]);
      }),
      battery: mk((c) => {
        c.cyl('battery', 0, 0.028, 0, 0.055, 0.14, [1, 1, 1], 10, [0, 0, Math.PI / 2]);
        c.cyl('steel', 0.075, 0.028, 0, 0.03, 0.015, [0.9, 0.7, 0.4], 8, [0, 0, Math.PI / 2]);
        c.cyl('steel', -0.071, 0.028, 0, 0.055, 0.006, [0.8, 0.8, 0.8], 10, [0, 0, Math.PI / 2]);
      }),
      note: mk((c) => {
        c.box('paper', 0, 0.004, 0, 0.21, 0.006, 0.29, [1.15, 1.15, 1.1]);
      }),
      rocker: mk((c) => rockingChair(c)),
      genLamp: mk((c) => c.sph('lampTube', 0, 0, 0, 1, 1, 1, [1, 1, 1], null, 8, 6)),
    };
    for (const it of this.items) {
      it.m = mat4.compose(mat4.create(), it.pos[0], it.pos[1], it.pos[2], 0, it.yaw || 0, 0);
    }
  }

  upload() {
    const R = this.R;
    for (const [, md] of this.chunks) {
      if (md.isEmpty()) continue;
      const mat = this.mats[md.mat];
      const noShadow = md.mat === 'ceil' || md.mat.startsWith('floor') || md.mat === 'woodFloor' || md.mat === 'concreteFloor' || md.mat === 'outside' || md.mat === 'sign';
      this.staticDraws.push({ mesh: R.createMesh(md), mat, shadow: !noShadow, matName: md.mat });
    }
    this.staticDraws.sort((a, b) => (a.matName < b.matName ? -1 : 1));
    for (const [, md] of this.decalMDs) if (!md.isEmpty()) this.decalDraws.push({ mesh: R.createMesh(md), mat: this.mats.decal });
    this.chunks.clear();
    this.decalMDs.clear();
  }

  destroy() {
    for (const d of this.staticDraws) this.R.deleteMesh(d.mesh);
    for (const d of this.decalDraws) this.R.deleteMesh(d.mesh);
    for (const k in this.models) for (const p of this.models[k]) this.R.deleteMesh(p.mesh);
  }
}

function pushOut(p, r, x0, z0, x1, z1) {
  const qx = p[0] < x0 ? x0 : p[0] > x1 ? x1 : p[0];
  const qz = p[1] < z0 ? z0 : p[1] > z1 ? z1 : p[1];
  const dx = p[0] - qx, dz = p[1] - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    p[0] += (dx / d) * (r - d);
    p[1] += (dz / d) * (r - d);
  } else {
    const l = p[0] - x0, rr = x1 - p[0], t = p[1] - z0, b = z1 - p[1];
    const m = Math.min(l, rr, t, b);
    if (m === l) p[0] = x0 - r;
    else if (m === rr) p[0] = x1 + r;
    else if (m === t) p[1] = z0 - r;
    else p[1] = z1 + r;
  }
}

// ======================================================================= props
function bed(c, rng, o = {}) {
  const fr = C.bedFrame;
  const L = 1.95, z0 = 0.12, zc = z0 + L / 2;
  for (const lx of [-0.42, 0.42])
    for (const lz of [z0 + 0.05, z0 + L - 0.05]) {
      c.cyl('metal', lx, 0.24, lz, 0.04, 0.42, fr, 6);
      c.sph('black', lx, 0.04, lz, 0.08, 0.08, 0.05, [1, 1, 1], null, 6, 4);
    }
  c.box('metal', -0.43, 0.43, zc, 0.04, 0.06, L, fr);
  c.box('metal', 0.43, 0.43, zc, 0.04, 0.06, L, fr);
  c.box('metal', 0, 0.42, zc, 0.84, 0.02, L - 0.05, [0.3, 0.3, 0.3]);
  for (const [zz, hh] of [[z0, 1.1], [z0 + L, 0.85]]) {
    for (const lx of [-0.43, 0.43]) c.cyl('metal', lx, hh / 2, zz, 0.045, hh, fr, 6);
    c.cyl('metal', 0, hh - 0.02, zz, 0.04, 0.9, fr, 6, [0, 0, Math.PI / 2]);
    for (let i = 0; i < 5; i++) c.cyl('metal', -0.3 + i * 0.15, hh * 0.72, zz, 0.025, hh * 0.5, fr, 5);
  }
  if (!o.bare) {
    const sc = o.blood ? [0.8, 0.62, 0.58] : C.sheet;
    c.box('fabric', 0, 0.53, zc, 0.84, 0.17, L - 0.08, sc);
    c.box('fabric', rng.range(-0.05, 0.05), 0.66, z0 + 0.3, 0.55, 0.1, 0.32, [0.9, 0.9, 0.86], [0, rng.range(-0.3, 0.3), 0]);
    c.box('fabric', 0.05, 0.63, zc + 0.35, 0.86, 0.04, 1.05, [0.62, 0.68, 0.7], [0.04, rng.range(-0.15, 0.15), 0.03]);
    if (rng.chance(0.5)) c.box('fabric', 0.47, 0.38, zc + 0.3, 0.02, 0.46, 0.9, [0.62, 0.68, 0.7], [0, 0, 0.12]);
  }
  if (o.straps) for (let k = 0; k < 3; k++) c.box('wood', 0, 0.63, z0 + 0.55 + k * 0.55, 0.92, 0.025, 0.09, [0.35, 0.2, 0.1]);
  if (!o.noCol) c.col(-0.48, 0.05, 0.48, z0 + L + 0.04);
}

function curtain(c, rng) {
  const col = [0.5, 0.62, 0.58];
  const x = rng.chance(0.5) ? 1.2 : -1.2;
  c.cyl('steel', x, 2.6, 0.65, 0.03, 1.3, [0.7, 0.7, 0.7], 6, [Math.PI / 2, 0, 0]);
  for (let k = 0; k < 4; k++) c.box('fabric', x + (k % 2 ? 0.03 : -0.03), 1.6, 0.15 + k * 0.28, 0.02, 1.95, 0.3, col, [0, (k % 2 ? 0.25 : -0.25), 0]);
  c.col(x - 0.06, 0.02, x + 0.06, 1.2);
}

function ivStand(c, rng) {
  const m = [0.7, 0.7, 0.7];
  for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; c.box('steel', Math.cos(a) * 0.14, 0.04, Math.sin(a) * 0.14, 0.28, 0.025, 0.03, m, [0, -a, 0]); }
  c.cyl('steel', 0, 0.95, 0, 0.025, 1.85, m, 6);
  c.cyl('steel', 0, 1.85, 0, 0.015, 0.4, m, 5, [0, 0, Math.PI / 2]);
  c.sph('fabric', 0.15, 1.65, 0, 0.12, 0.22, 0.06, rng.chance(0.4) ? [0.55, 0.05, 0.04] : [0.85, 0.82, 0.55]);
  c.cyl('glass', 0.15, 1.15, 0, 0.008, 0.8, [1, 1, 1], 4);
  c.col(-0.15, -0.15, 0.15, 0.15);
}

function wheelchair(c, rng) {
  const f = [0.35, 0.36, 0.38], seat = [0.25, 0.22, 0.2];
  c.box('fabric', 0, 0.5, 0, 0.48, 0.05, 0.44, seat);
  c.box('fabric', 0, 0.8, -0.22, 0.48, 0.5, 0.04, seat, [-0.12, 0, 0]);
  for (const sx of [-1, 1]) {
    c.tor('steel', sx * 0.29, 0.31, -0.05, 0.29, 0.022, f, [0, Math.PI / 2, 0]);
    c.box('steel', sx * 0.29, 0.31, -0.05, 0.01, 0.55, 0.02, f, [0.6, 0, 0]);
    c.box('steel', sx * 0.29, 0.31, -0.05, 0.01, 0.55, 0.02, f, [-0.6, 0, 0]);
    c.cyl('black', sx * 0.2, 0.06, 0.28, 0.12, 0.03, [1, 1, 1], 8, [0, 0, Math.PI / 2]);
    c.cyl('steel', sx * 0.24, 0.66, 0, 0.02, 0.4, f, 5, [Math.PI / 2, 0, 0]);
    c.cyl('steel', sx * 0.22, 1.02, -0.3, 0.03, 0.16, [0.1, 0.1, 0.1], 5, [Math.PI / 2, 0, 0]);
  }
  c.col(-0.34, -0.36, 0.34, 0.36);
}

function desk(c, rng) {
  c.box('wood', 0, 0.76, 0.4, 1.4, 0.05, 0.72, C.wood);
  c.box('wood', 0.48, 0.37, 0.4, 0.4, 0.74, 0.66, [0.8, 0.75, 0.7]);
  for (let k = 0; k < 3; k++) c.box('steel', 0.48, 0.18 + k * 0.23, 0.74, 0.12, 0.02, 0.02);
  for (const lz of [0.1, 0.7]) c.box('wood', -0.65, 0.37, lz, 0.05, 0.74, 0.05, C.wood);
  for (let k = 0; k < 4; k++) c.box('paper', rng.range(-0.55, 0.25), 0.786, rng.range(0.15, 0.6), 0.21, 0.003, 0.29, [1, 1, 1], [0, rng.range(-0.6, 0.6), 0], 3);
  if (rng.chance(0.6)) {
    c.box('metal', 0.3, 0.86, 0.35, 0.4, 0.14, 0.32, [0.12, 0.12, 0.12]);
    c.box('metal', 0.3, 0.95, 0.25, 0.36, 0.05, 0.12, [0.08, 0.08, 0.08], [-0.4, 0, 0]);
  }
  c.cyl('metal', -0.5, 0.8, 0.2, 0.12, 0.03, C.dark, 8);
  c.cyl('metal', -0.5, 0.98, 0.2, 0.02, 0.36, C.dark, 5);
  c.cyl('metal', -0.45, 1.15, 0.28, 0.2, 0.15, [0.15, 0.25, 0.18], 10, [0.5, 0, 0], 0.4, 1);
  c.col(-0.72, 0.02, 0.72, 0.78);
}

function chair(c, rng) {
  const col = [0.75, 0.7, 0.62];
  c.box('wood', 0, 0.45, 0, 0.42, 0.04, 0.42, col);
  for (const sx of [-0.18, 0.18]) for (const sz of [-0.18, 0.18]) c.box('wood', sx, 0.22, sz, 0.035, 0.45, 0.035, col);
  for (const sx of [-0.18, 0.18]) c.box('wood', sx, 0.72, -0.19, 0.035, 0.52, 0.035, col);
  for (let k = 0; k < 2; k++) c.box('wood', 0, 0.68 + k * 0.2, -0.19, 0.38, 0.07, 0.02, col);
  c.col(-0.22, -0.22, 0.22, 0.22);
}

function cabinet(c, rng, o = {}) {
  const col = C.cabinet;
  c.box('metal', 0, 0.66, 0.31, 0.48, 1.32, 0.6, col);
  const open = rng.chance(0.3) ? rng.int(0, 3) : -1;
  for (let k = 0; k < 4; k++) {
    const y = 0.17 + k * 0.32;
    if (k === open) {
      c.box('metal', 0, y, 0.75, 0.44, 0.26, 0.34, col);
      c.box('paper', 0, y + 0.1, 0.72, 0.38, 0.06, 0.28, [0.9, 0.85, 0.7]);
    } else {
      c.box('metal', 0, y, 0.615, 0.44, 0.28, 0.01, [0.42, 0.44, 0.42]);
      c.box('steel', 0, y + 0.06, 0.625, 0.12, 0.025, 0.02);
    }
  }
  if (!o.noCol) c.col(-0.25, 0.0, 0.25, open >= 0 ? 0.93 : 0.63);
}

function shelf(c, rng, sparse = false) {
  const m = [0.45, 0.47, 0.48];
  for (const sx of [-0.88, 0.88]) for (const sz of [0.04, 0.48]) c.box('metal', sx, 1.0, sz, 0.035, 2.0, 0.035, m);
  for (const y of [0.1, 0.6, 1.1, 1.6, 1.98]) c.box('metal', 0, y, 0.26, 1.78, 0.025, 0.46, m);
  if (!sparse)
    for (const y of [0.1, 0.6, 1.1, 1.6]) {
      let x = -0.8;
      while (x < 0.7) {
        const w = rng.range(0.2, 0.45);
        const r = rng.next();
        if (r < 0.5) { const h = rng.range(0.15, 0.4); c.box('cardboard', x + w / 2, y + 0.0125 + h / 2, 0.26, w, h, rng.range(0.25, 0.42), [1, 1, 1], [0, rng.range(-0.1, 0.1), 0]); }
        else if (r < 0.75) { for (let j = 0; j < 3; j++) c.cyl('glass', x + 0.06 + j * 0.1, y + 0.1, 0.26, 0.08, 0.18, [1, 1, 1], 8); }
        else if (r < 0.9) { for (let j = 0; j < 4; j++) c.box('fabric', x + 0.03 + j * 0.05, y + 0.15, 0.26, 0.04, 0.28, 0.24, [rng.range(0.2, 0.5), rng.range(0.1, 0.3), rng.range(0.1, 0.3)]); }
        x += w + 0.05;
      }
    }
  c.col(-0.92, 0.0, 0.92, 0.52);
}

function crate(c, rng) {
  const s = rng.range(0.5, 0.75);
  c.box('wood', 0, s / 2, s / 2, s, s, s, [0.85, 0.75, 0.6]);
  for (const y of [0.04, s - 0.04]) c.box('wood', 0, y, s + 0.005, s, 0.07, 0.02, [0.6, 0.5, 0.4]);
  if (rng.chance(0.5)) c.box('cardboard', 0, s + 0.15, s / 2, s * 0.7, 0.3, s * 0.7, [1, 1, 1], [0, rng.range(-0.5, 0.5), 0]);
  c.col(-s / 2, 0, s / 2, s);
}

function sink(c, rng) {
  c.box('ceramic', 0, 0.82, 0.24, 0.56, 0.16, 0.44);
  c.box('ceramic', 0, 0.91, 0.24, 0.44, 0.02, 0.32, [0.5, 0.5, 0.45]);
  c.cyl('ceramic', 0, 0.38, 0.18, 0.16, 0.74, [0.95, 0.95, 0.95], 10);
  c.cyl('steel', 0, 0.98, 0.08, 0.03, 0.16, [1, 1, 1], 6);
  c.cyl('steel', 0, 1.05, 0.12, 0.025, 0.12, [1, 1, 1], 6, [Math.PI / 2, 0, 0]);
  c.box('metal', 0, 1.55, 0.015, 0.56, 0.76, 0.02, [0.3, 0.3, 0.3]);
  c.box('glass', 0, 1.55, 0.028, 0.5, 0.7, 0.01);
  c.col(-0.29, 0, 0.29, 0.47);
}

function bathtub(c, rng) {
  const L = 1.7, zc = 0.1 + L / 2;
  c.box('ceramic', 0, 0.1, zc, 0.78, 0.08, L);
  for (const sx of [-1, 1]) c.box('ceramic', sx * 0.355, 0.36, zc, 0.07, 0.56, L);
  for (const sz of [-1, 1]) c.box('ceramic', 0, 0.36, zc + sz * (L / 2 - 0.035), 0.78, 0.56, 0.07);
  for (const sx of [-0.3, 0.3]) for (const sz of [0.2, L - 0.1]) c.sph('steel', sx, 0.04, sz, 0.1, 0.1, 0.1);
  c.box('blood', 0, 0.48, zc, 0.64, 0.02, L - 0.14);
  if (rng.chance(0.6)) {
    c.cyl('skin', 0.38, 0.55, zc + 0.2, 0.07, 0.5, [0.85, 0.82, 0.8], 8, [0, 0, 1.1]);
    c.sph('skin', 0.56, 0.38, zc + 0.2, 0.09, 0.12, 0.06, [0.85, 0.82, 0.8]);
  }
  c.col(-0.4, 0.08, 0.4, 0.12 + L);
}

function morgueTable(c, rng) {
  c.cyl('steel', 0, 0.42, 0, 0.2, 0.84, [0.6, 0.6, 0.62], 10);
  c.box('steel', 0, 0.06, 0, 0.6, 0.06, 0.8, [0.5, 0.5, 0.5]);
  c.box('steel', 0, 0.86, 0, 0.82, 0.05, 2.0, [0.75, 0.76, 0.78]);
  for (const sx of [-1, 1]) c.box('steel', sx * 0.4, 0.9, 0, 0.02, 0.05, 2.0, [0.75, 0.76, 0.78]);
  if (rng.chance(0.85)) {
    const sheet = rng.chance(0.3) ? [0.75, 0.55, 0.52] : [0.82, 0.82, 0.8];
    c.sph('fabric', 0, 0.98, 0.05, 0.5, 0.24, 1.2, sheet);
    c.sph('fabric', 0, 1.0, -0.72, 0.26, 0.22, 0.3, sheet);
    for (const sx of [-0.1, 0.1]) c.sph('fabric', sx, 1.0, 0.78, 0.13, 0.2, 0.12, sheet);
    c.box('fabric', 0, 0.9, 0.0, 0.84, 0.02, 1.9, sheet, [0, 0, 0]);
    if (rng.chance(0.6)) {
      c.sph('skin', 0.12, 0.95, 0.98, 0.1, 0.12, 0.2, [0.85, 0.82, 0.78]);
      c.box('paper', 0.12, 0.88, 1.08, 0.06, 0.09, 0.005, [1, 1, 0.9], [0.3, 0, 0]);
    }
  }
  c.col(-0.42, -1.02, 0.42, 1.02);
}

function morgueDrawers(c, rng) {
  c.box('steel', 0, 1.05, 0.07, 2.3, 2.1, 0.14, [0.55, 0.56, 0.58]);
  const open = rng.int(0, 5);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 2; j++) {
      const x = -0.75 + i * 0.75, y = 0.5 + j * 0.95;
      if (i + j * 3 === open) {
        c.box('black', x, y, 0.15, 0.62, 0.6, 0.02);
        c.box('steel', x, y - 0.18, 0.6, 0.6, 0.06, 0.95, [0.7, 0.7, 0.72]);
        c.sph('fabric', x, y - 0.06, 0.65, 0.4, 0.2, 0.9, [0.8, 0.8, 0.78]);
        c.col(x - 0.32, 0.1, x + 0.32, 1.1);
      } else {
        c.box('steel', x, y, 0.145, 0.66, 0.72, 0.02, [0.65, 0.66, 0.68]);
        c.box('steel', x, y + 0.2, 0.17, 0.2, 0.04, 0.03, [0.85, 0.85, 0.85]);
        c.box('paper', x - 0.2, y + 0.25, 0.158, 0.1, 0.06, 0.005);
      }
    }
  c.col(-1.15, 0, 1.15, 0.15);
}

function bodyBag(c, rng) {
  c.sph('black', 0, 0.13, 0, 0.55, 0.26, 1.8, [1, 1, 1], null, 12, 6);
  c.sph('black', 0, 0.16, -0.65, 0.3, 0.22, 0.32, [1, 1, 1], null, 8, 5);
  c.box('steel', 0.12, 0.25, 0, 0.01, 0.01, 1.5, [0.6, 0.6, 0.6]);
  c.col(-0.28, -0.9, 0.28, 0.9);
}

function gurney(c, rng) {
  const f = [0.7, 0.72, 0.74];
  c.box('steel', -0.95, 0.75, 0.45, 0.02, 0.04, 0.6, f);
  c.box('steel', 0, 0.72, 0.45, 1.9, 0.04, 0.62, f);
  for (const sx of [-0.85, 0.85]) for (const sz of [0.2, 0.7]) { c.cyl('steel', sx, 0.38, sz, 0.03, 0.7, f, 6); c.sph('black', sx, 0.05, sz, 0.09, 0.09, 0.05); }
  if (rng.chance(0.6)) c.sph('fabric', 0, 0.86, 0.45, 1.8, 0.22, 0.5, rng.chance(0.4) ? [0.7, 0.45, 0.42] : [0.82, 0.82, 0.8]);
  else c.box('fabric', 0, 0.76, 0.45, 1.8, 0.05, 0.58, [0.6, 0.65, 0.68], [0, 0.05, 0]);
  c.col(-0.97, 0.12, 0.97, 0.78);
}

function crib(c, rng) {
  const f = [0.85, 0.85, 0.82];
  const Lx = 1.15, D = 0.62, zc = 0.06 + D / 2;
  for (const sx of [-Lx / 2, Lx / 2]) for (const sz of [0.06, 0.06 + D]) c.cyl('metal', sx, 0.45, sz, 0.035, 0.9, f, 6);
  for (const sz of [0.06, 0.06 + D]) {
    c.cyl('metal', 0, 0.88, sz, 0.025, Lx, f, 5, [0, 0, Math.PI / 2]);
    for (let k = 1; k < 12; k++) c.cyl('metal', -Lx / 2 + k * (Lx / 12), 0.62, sz, 0.012, 0.5, f, 4);
  }
  c.box('metal', 0, 0.36, zc, Lx, 0.03, D, [0.4, 0.4, 0.4]);
  c.box('fabric', 0, 0.42, zc, Lx - 0.05, 0.09, D - 0.04, [0.8, 0.76, 0.7]);
  c.col(-Lx / 2 - 0.03, 0.03, Lx / 2 + 0.03, 0.06 + D + 0.03);
}

function teddy(c, rng) {
  const col = [0.48, 0.32, 0.2];
  c.sph('fabric', 0, 0.12, 0, 0.22, 0.25, 0.18, col);
  c.sph('fabric', 0, 0.3, 0.02, 0.17, 0.16, 0.15, col);
  for (const sx of [-1, 1]) c.sph('fabric', sx * 0.07, 0.38, 0.0, 0.06, 0.06, 0.03, col);
  c.sph('black', -0.035, 0.32, 0.085, 0.025, 0.025, 0.02);
  c.sph('fabric', 0.11, 0.1, 0.05, 0.07, 0.14, 0.07, col, [0, 0, 1.2]);
  c.sph('fabric', 0.06, 0.03, 0.1, 0.07, 0.07, 0.14, col);
  c.sph('fabric', -0.06, 0.03, 0.1, 0.07, 0.07, 0.14, col);
}

function musicBox(c, rng) {
  c.box('wood', 0, 0.05, 0, 0.18, 0.1, 0.12, [1, 0.75, 0.7]);
  c.box('wood', 0, 0.13, -0.07, 0.18, 0.1, 0.012, [1, 0.75, 0.7], [-0.4, 0, 0]);
  c.cyl('ceramic', 0, 0.13, 0.0, 0.015, 0.06, [1, 1, 1], 5);
  c.sph('ceramic', 0, 0.175, 0, 0.025, 0.03, 0.025);
  c.cyl('fabric', 0, 0.145, 0, 0.05, 0.02, [1, 0.8, 0.85], 8, null, 0.3, 1);
}

function blocks(ctx, cells, rng, world) {
  for (let i = 0; i < 6; i++) {
    const [x, y] = rng.pick(cells);
    if (world.navBlock[world.I(x, y)]) continue;
    const [cx, cz] = world.center(x, y);
    ctx.at(cx + rng.range(-0.9, 0.9), cz + rng.range(-0.9, 0.9), rng.range(0, 6));
    const col = rng.pick([[0.6, 0.15, 0.1], [0.15, 0.3, 0.55], [0.7, 0.6, 0.2], [0.2, 0.45, 0.2]]);
    ctx.box('wood', 0, 0.04, 0, 0.08, 0.08, 0.08, col);
  }
}

function longTable(c, rng) {
  const col = [0.8, 0.75, 0.68];
  c.box('wood', 0, 0.76, 0, 0.85, 0.05, 2.2, col);
  for (const sx of [-0.36, 0.36]) for (const sz of [-1.0, 1.0]) c.box('steel', sx, 0.37, sz, 0.05, 0.74, 0.05, [0.4, 0.4, 0.4]);
  for (const sx of [-0.68, 0.68]) {
    c.box('wood', sx, 0.45, 0, 0.3, 0.04, 2.0, col);
    for (const sz of [-0.85, 0.85]) c.box('steel', sx, 0.22, sz, 0.04, 0.44, 0.04, [0.4, 0.4, 0.4]);
  }
  for (let k = 0; k < 3; k++) {
    const z = rng.range(-0.9, 0.9), x = rng.range(-0.25, 0.25);
    c.box('steel', x, 0.795, z, 0.35, 0.02, 0.26, [0.6, 0.6, 0.62], [0, rng.range(-0.4, 0.4), 0]);
    if (rng.chance(0.5)) c.cyl('ceramic', x + 0.1, 0.84, z, 0.07, 0.09, [0.9, 0.9, 0.85], 8);
  }
  c.col(-0.85, -1.12, 0.85, 1.12);
}

function rockingChair(c) {
  const col = [0.7, 0.55, 0.4];
  for (const sx of [-0.22, 0.22]) {
    for (let k = 0; k < 5; k++) {
      const a = -0.5 + k * 0.25;
      const x = Math.sin(a) * 1.0, y = 1.0 - Math.cos(a) * 1.0;
      c.box('wood', sx, y + 0.02, x, 0.04, 0.035, 0.27, col, [-a, 0, 0]);
    }
    c.box('wood', sx, 0.24, -0.18, 0.035, 0.44, 0.035, col);
    c.box('wood', sx, 0.24, 0.18, 0.035, 0.44, 0.035, col);
    c.box('wood', sx, 0.65, -0.24, 0.04, 0.85, 0.04, col, [-0.15, 0, 0]);
    c.box('wood', sx, 0.66, 0.0, 0.04, 0.03, 0.42, col);
  }
  c.box('wood', 0, 0.46, 0, 0.48, 0.04, 0.42, col);
  for (let k = 0; k < 5; k++) c.box('wood', -0.16 + k * 0.08, 0.7, -0.26, 0.04, 0.42, 0.02, col, [-0.15, 0, 0]);
  c.box('wood', 0, 1.06, -0.3, 0.5, 0.06, 0.04, col, [-0.15, 0, 0]);
}

export { pushOut };
