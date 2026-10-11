// "Subject E." — procedural model, procedural animation, and the stalker AI (host authoritative).
import { MeshData, box, cylinder, sphere, M } from './gl/geometry.js';
import { mat4, clamp, lerp, damp, dampAngle, angleDiff } from './math.js';
import { findPath } from './world/nav.js';
import { CELL, W, H, T } from './world/mapgen.js';

const SKIN = [0.62, 0.62, 0.64];
const DARK = [0.35, 0.33, 0.36];

function buildPart(R, mats, fn) {
  const parts = new Map();
  const get = (m) => { if (!parts.has(m)) parts.set(m, new MeshData()); return parts.get(m); };
  const api = {
    box: (m, x, y, z, sx, sy, sz, c = SKIN, rx = 0, ry = 0, rz = 0) => box(get(m), M(x, y, z, sx, sy, sz, rx, ry, rz), c, 2),
    cyl: (m, x, y, z, d, h, c = SKIN, rTop = 1, rBot = 1, rx = 0, ry = 0, rz = 0, segs = 10) => cylinder(get(m), M(x, y, z, d, h, d, rx, ry, rz), segs, c, rTop, rBot, true, 2),
    sph: (m, x, y, z, sx, sy, sz, c = SKIN, rx = 0, ry = 0, rz = 0, ws = 12, hs = 8) => sphere(get(m), M(x, y, z, sx, sy, sz, rx, ry, rz), ws, hs, c, 2),
  };
  fn(api);
  return [...parts].map(([m, md]) => ({ mesh: R.createMesh(md), mat: mats[m], matName: m }));
}

export class MonsterModel {
  constructor(R, mats) {
    this.parts = [];
    const P = (name, parent, off, fn) => {
      const p = { name, parent, off, rot: [0, 0, 0], tgt: [0, 0, 0], world: mat4.create(), local: mat4.create(), meshes: fn ? buildPart(R, mats, fn) : [] };
      this.parts.push(p);
      this[name] = p;
      return this.parts.length - 1;
    };
    const root = P('root', -1, [0, 0, 0]);
    const hips = P('hips', root, [0, 1.32, 0], (a) => {
      a.sph('skin', 0, 0, 0, 0.34, 0.2, 0.22);
      for (let i = 0; i < 9; i++) {
        const a0 = (i / 9) * Math.PI * 2;
        const len = 0.22 + ((i * 37) % 7) * 0.035;
        a.box('fabric', Math.sin(a0) * 0.15, -0.05 - len / 2, Math.cos(a0) * 0.1, 0.09, len, 0.012, [0.2, 0.17, 0.14], Math.cos(a0) * 0.25, a0, -Math.sin(a0) * 0.25);
      }
    });
    const spine = P('spine', hips, [0, 0.06, 0], (a) => {
      a.cyl('skin', 0, 0.16, 0, 0.13, 0.36, DARK, 1, 1.2, 0, 0, 0, 10);
      a.sph('skin', 0, 0.5, 0.0, 0.38, 0.5, 0.25);
      for (let i = 0; i < 6; i++) a.sph('skin', 0, 0.33 + i * 0.055, 0.004, 0.4 - Math.abs(i - 2) * 0.025, 0.026, 0.27, SKIN, 0, 0, 0, 14, 5);
      for (let i = 0; i < 9; i++) a.sph('skin', 0, 0.05 + i * 0.075, -0.1 - Math.sin(i * 0.4) * 0.02, 0.05, 0.05, 0.05, SKIN, 0, 0, 0, 6, 4);
      a.sph('skin', 0, 0.7, -0.01, 0.46, 0.1, 0.18);
      for (const s of [-1, 1]) a.sph('skin', s * 0.13, 0.62, -0.08, 0.14, 0.18, 0.06, SKIN);
    });
    const neck = P('neck', spine, [0, 0.72, 0.03], (a) => {
      a.cyl('skin', 0, 0.15, 0, 0.065, 0.32, SKIN, 0.9, 1.1);
      for (const s of [-1, 1]) a.cyl('skin', s * 0.022, 0.14, 0.022, 0.018, 0.3, DARK);
    });
    const head = P('head', neck, [0, 0.29, 0.02], (a) => {
      a.sph('skin', 0, 0.2, -0.02, 0.24, 0.3, 0.28);
      a.sph('skin', 0, 0.1, 0.03, 0.19, 0.24, 0.22);
      for (const s of [-1, 1]) {
        a.sph('black', s * 0.052, 0.19, 0.11, 0.072, 0.062, 0.04);
        a.sph('eye', s * 0.052, 0.188, 0.126, 0.022, 0.02, 0.012);
      }
      a.sph('black', 0, 0.135, 0.128, 0.03, 0.04, 0.015);
      a.sph('black', 0, 0.055, 0.105, 0.13, 0.1, 0.06);
      for (let i = 0; i < 11; i++) {
        const x = -0.06 + i * 0.012;
        a.cyl('teeth', x, 0.085, 0.13 - x * x * 3, 0.011, 0.04 + (i % 3) * 0.012, [1, 1, 1], 0, 1, Math.PI, 0, 0, 4);
      }
    });
    const jaw = P('jaw', head, [0, 0.06, 0.0], (a) => {
      a.box('skin', 0, -0.04, 0.05, 0.13, 0.035, 0.15);
      a.sph('skin', 0, -0.045, 0.115, 0.08, 0.04, 0.05);
      for (let i = 0; i < 10; i++) {
        const x = -0.054 + i * 0.012;
        a.cyl('teeth', x, -0.01, 0.118 - x * x * 3, 0.01, 0.04 + (i % 2) * 0.01, [1, 1, 1], 0, 1, 0, 0, 0, 4);
      }
    });
    const arm = (side) => {
      const s = side === 'L' ? -1 : 1;
      const sh = P('shoulder' + side, spine, [s * 0.23, 0.64, 0], (a) => {
        a.sph('skin', 0, 0, 0, 0.12, 0.1, 0.11);
        a.cyl('skin', 0, -0.37, 0, 0.07, 0.74, SKIN, 1.1, 0.8);
        a.sph('skin', 0, -0.74, 0, 0.075, 0.08, 0.075);
      });
      const fa = P('forearm' + side, sh, [0, -0.74, 0], (a) => {
        a.cyl('skin', 0, -0.36, 0, 0.055, 0.72, SKIN, 1, 0.7);
        a.cyl('skin', 0.012 * s, -0.3, 0.015, 0.018, 0.5, DARK);
      });
      P('hand' + side, fa, [0, -0.72, 0], (a) => {
        a.box('skin', 0, -0.06, 0, 0.085, 0.13, 0.035);
        for (let i = 0; i < 4; i++) {
          const x = -0.03 + i * 0.02;
          a.cyl('skin', x, -0.26, 0.012, 0.018, 0.3 - Math.abs(i - 1.5) * 0.03, SKIN, 0.4, 1, 0.18, 0, 0, 6);
          a.cyl('teeth', x, -0.42 + Math.abs(i - 1.5) * 0.015, 0.03, 0.012, 0.05, [0.4, 0.38, 0.3], 0, 1, 0.3, 0, 0, 4);
        }
        a.cyl('skin', s * -0.05, -0.12, 0.02, 0.02, 0.18, SKIN, 0.5, 1, 0.3, 0, s * 0.6, 6);
      });
    };
    arm('L'); arm('R');
    const leg = (side) => {
      const s = side === 'L' ? -1 : 1;
      const th = P('thigh' + side, hips, [s * 0.12, -0.02, 0], (a) => {
        a.cyl('skin', 0, -0.34, 0, 0.1, 0.68, SKIN, 1.2, 0.75);
        a.sph('skin', 0, -0.68, 0.01, 0.09, 0.1, 0.09);
      });
      const sn = P('shin' + side, th, [0, -0.68, 0], (a) => {
        a.cyl('skin', 0, -0.31, 0, 0.07, 0.62, SKIN, 1, 0.7);
      });
      P('foot' + side, sn, [0, -0.62, 0], (a) => {
        a.box('skin', 0, -0.03, 0.07, 0.08, 0.05, 0.24);
        for (let i = 0; i < 3; i++) a.cyl('skin', -0.025 + i * 0.025, -0.045, 0.24, 0.02, 0.12, SKIN, 0.5, 1, Math.PI / 2, 0, 0, 5);
      });
    };
    leg('L'); leg('R');
    this.phase = 0;
    this.twitch = [0, 0, 0];
    this.twitchT = 1;
    this.jawOpen = 0;
    this.eyeGlow = 1;
    this.bob = 0;
    this.time = 0;
    this.tmp = mat4.create();
    this.x = 0; this.z = 0; this.y = 0; this.yaw = 0; this.pitch = 0;
  }

  animate(dt, mode, speed) {
    this.time += dt;
    const t = this.time;
    const run = mode === 'chase';
    const stride = run ? 1.25 : 1.0;
    this.phase += dt * speed * (run ? 2.6 : 3.2) / stride;
    const ph = this.phase;
    const amp = clamp(speed / 1.4, 0, 1) * (run ? 1.25 : 1);
    const set = (p, x, y, z) => { p.tgt[0] = x; p.tgt[1] = y; p.tgt[2] = z; };
    // twitch impulses
    this.twitchT -= dt;
    if (this.twitchT <= 0) {
      this.twitchT = 0.4 + Math.random() * (mode === 'stare' ? 0.9 : 2.2);
      this.twitch = [(Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.0, (Math.random() - 0.5) * 0.9];
    }
    for (let i = 0; i < 3; i++) this.twitch[i] = damp(this.twitch[i], 0, 7, dt);
    let lean = 0.42, jaw = 0.08;
    let headX = -0.3, headY = 0, headZ = 0;
    let shX = 0.1, shZ = 0.14, faX = -0.35;
    const sw = Math.sin(ph);
    if (mode === 'chase') {
      lean = 0.8 + Math.sin(ph * 2) * 0.06;
      headX = -0.75; jaw = 0.35 + Math.sin(t * 23) * 0.12;
      shX = -lean - 0.9; shZ = 0.3; faX = -0.5;
    } else if (mode === 'stare') {
      lean = 0.25; headX = -0.15; headZ = 0.55 + Math.sin(t * 0.9) * 0.15; jaw = 0.2 + Math.sin(t * 3) * 0.05;
      shX = -lean; shZ = 0.18; faX = -0.15;
    } else if (mode === 'scare') {
      lean = 0.55 + Math.sin(t * 40) * 0.04; headX = -0.78 + Math.sin(t * 37) * 0.06; headZ = 0.25 + Math.sin(t * 29) * 0.12;
      jaw = 0.95 + Math.sin(t * 31) * 0.08;
      shX = -2.3; shZ = 0.75; faX = -0.7;
    } else if (mode === 'bash') {
      lean = 0.6; headX = -0.5; jaw = 0.5;
      shX = -1.6 + Math.sin(t * 13) * 0.9; shZ = 0.2; faX = -0.6;
    } else if (mode === 'search' || mode === 'idle') {
      lean = 0.35; headY = Math.sin(t * 0.8) * 0.9; headZ = Math.sin(t * 0.53) * 0.3; headX = -0.25;
      shX = -lean + 0.05; jaw = 0.1 + Math.max(0, Math.sin(t * 1.7)) * 0.15;
    }
    set(this.spine, lean, 0, 0);
    set(this.neck, 0.15, 0, 0);
    set(this.head, headX + this.twitch[0], headY + this.twitch[1], headZ + this.twitch[2]);
    set(this.jaw, jaw, 0, 0);
    const armSwing = mode === 'chase' ? 0.5 : 0.35;
    set(this.shoulderL, shX + sw * armSwing * amp, 0, -shZ);
    set(this.shoulderR, shX - sw * armSwing * amp, 0, shZ);
    if (mode === 'bash') set(this.shoulderL, -lean - 0.1, 0, -0.15);
    set(this.forearmL, faX, 0, 0);
    set(this.forearmR, faX, 0, 0);
    set(this.handL, 0.2 + Math.sin(t * 9) * 0.05, 0, 0);
    set(this.handR, 0.2 + Math.cos(t * 8) * 0.05, 0, 0);
    const legA = 0.6 * amp;
    set(this.thighL, -sw * legA, 0, -0.03);
    set(this.thighR, sw * legA, 0, 0.03);
    set(this.shinL, 0.1 + Math.max(0, Math.sin(ph - 1.3)) * 1.0 * amp, 0, 0);
    set(this.shinR, 0.1 + Math.max(0, Math.sin(ph + Math.PI - 1.3)) * 1.0 * amp, 0, 0);
    set(this.footL, -0.1, 0, 0);
    set(this.footR, -0.1, 0, 0);
    this.bob = -Math.abs(Math.cos(ph)) * 0.06 * amp + (mode === 'chase' ? -0.12 : 0);
    const k = mode === 'scare' ? 30 : mode === 'chase' ? 14 : 9;
    for (const p of this.parts) for (let i = 0; i < 3; i++) p.rot[i] = damp(p.rot[i], p.tgt[i], k, dt);
    this.eyeGlow = mode === 'chase' || mode === 'scare' ? 1.6 : mode === 'stare' ? 1.3 : 0.9;
  }

  snapPose() {
    for (const p of this.parts) for (let i = 0; i < 3; i++) p.rot[i] = p.tgt[i];
  }

  computeMatrices() {
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (p.parent < 0) {
        mat4.compose(p.world, this.x, this.y + this.bob, this.z, this.pitch, this.yaw, 0);
        continue;
      }
      mat4.compose(p.local, p.off[0], p.off[1], p.off[2], p.rot[0], p.rot[1], p.rot[2]);
      mat4.multiply(p.world, this.parts[p.parent].world, p.local);
    }
  }

  headWorld() {
    return mat4.transformPoint(this.head.world, 0, 0.17, 0.12);
  }

  pushDraws(list, eyeBoost = 1) {
    for (const p of this.parts)
      for (const m of p.meshes) {
        const it = { mesh: m.mesh, mat: m.mat, model: p.world, shadow: true };
        if (m.matName === 'eye') { const g = this.eyeGlow * eyeBoost; it.emissive = [3.2 * g, 2.9 * g, 2.2 * g]; it.shadow = false; }
        list.push(it);
      }
  }
}

// =========================================================================== AI
const ST = { DORMANT: 'dormant', WANDER: 'wander', INVESTIGATE: 'investigate', STARE: 'stare', CHASE: 'chase', SEARCH: 'search', KILL: 'kill', RETREAT: 'retreat', HUNT: 'hunt' };
export { ST };

export class MonsterAI {
  constructor(world, cb, opts = {}) {
    this.w = world;
    this.cb = cb; // { scream(), doorOpen(door, bash), catchPlayer(id, how), growl() }
    const [sx, sz] = world.monsterSpawn;
    this.x = sx; this.z = sz; this.yaw = 0;
    this.state = ST.DORMANT;
    this.timer = opts.dormant ?? 25;
    this.path = [];
    this.goal = null;
    this.target = null;
    this.lastSeen = null;
    this.lastSeenVel = [0, 0];
    this.lastSeenT = -99;
    this.seenAt = -99;
    this.time = 0;
    this.speed = 0;
    this.moveSpeed = 0;
    this.anim = 'idle';
    this.repath = 0;
    this.sight = 0;
    this.doorWait = 0;
    this.stuck = 0;
    this.farTime = 0;
    this.stareCool = 0;
    this.fuses = 0;
    this.enraged = false;
    this.pause = 0;
    this.huntT = 0;
    this.exposure = new Map();
    this.coop = opts.coop || false;
  }

  cell() { return [Math.floor(this.x / CELL), Math.floor(this.z / CELL)]; }

  setState(s, t = 0) {
    this.state = s;
    this.timer = t;
    this.path = [];
    this.repath = 0;
  }

  hear(x, z, radius, important = false) {
    if (this.state === ST.DORMANT || this.state === ST.KILL || this.state === ST.CHASE || this.state === ST.STARE || this.state === ST.RETREAT) return;
    const d = Math.hypot(x - this.x, z - this.z);
    if (d > radius) return;
    this.goal = [x, z];
    this.setState(ST.INVESTIGATE, 14);
    this.goal = [x, z];
    if (important && this.cb.growl) this.cb.growl();
  }

  baseChaseSpeed() {
    return 3.75 + this.fuses * 0.17 + (this.enraged ? 0.55 : 0) + (this.coop ? 0.1 : 0);
  }

  canSee(p) {
    if (!p.alive || p.hidden) return false;
    const dx = p.x - this.x, dz = p.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d > 28) return false;
    let view = p.fl ? 21 : 11;
    if (p.cr && !p.fl) view = 6;
    if (this.state === ST.CHASE) view += 6;
    if (this.enraged) view += 6;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const facing = (dx * fx + dz * fz) / (d || 1);
    let ok = d < 3.2 || (facing > 0.35 && d < view);
    // the beam: if the player shines their light at it, it notices
    if (!ok && p.fl && d < 19) {
      const ld = (-dx * p.fx - dz * p.fz) / (d || 1);
      if (ld > 0.93) ok = true;
    }
    if (!ok) return false;
    return this.w.los(this.x, this.z, p.x, p.z);
  }

  pickWanderGoal(players) {
    const w = this.w;
    const alive = players.filter((p) => p.alive);
    for (let tries = 0; tries < 40; tries++) {
      let cx, cy;
      if (alive.length && Math.random() < 0.6) {
        const p = alive[Math.floor(Math.random() * alive.length)];
        const pc = [Math.floor(p.x / CELL), Math.floor(p.z / CELL)];
        cx = pc[0] + Math.round((Math.random() - 0.5) * 16);
        cy = pc[1] + Math.round((Math.random() - 0.5) * 16);
      } else {
        cx = Math.floor(Math.random() * W);
        cy = Math.floor(Math.random() * H);
      }
      if (!w.monsterWalkable(cx, cy)) continue;
      const [gx, gz] = w.center(cx, cy);
      if (Math.hypot(gx - this.x, gz - this.z) < 6) continue;
      return [gx + (Math.random() - 0.5) * 0.8, gz + (Math.random() - 0.5) * 0.8];
    }
    return null;
  }

  // walkable straight segment check (cells only)
  straight(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.ceil(d / 0.35);
    const px = -(z1 - z0) / (d || 1), pz = (x1 - x0) / (d || 1);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      for (const o of [-0.38, 0, 0.38]) {
        const x = x0 + (x1 - x0) * t + px * o, z = z0 + (z1 - z0) * t + pz * o;
        const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
        if (!this.w.monsterWalkable(cx, cy)) return false;
        if (this.w.get(cx, cy) === T.DOOR) return false;
      }
    }
    return true;
  }

  computePath(tx, tz) {
    const [sx, sy] = this.cell();
    const ex = Math.floor(tx / CELL), ey = Math.floor(tz / CELL);
    let p = findPath(this.w, sx, sy, ex, ey);
    if (!p) return false;
    this.path = p.map(([x, y]) => this.w.center(x, y));
    this.pathCells = p;
    if (this.path.length) this.path[this.path.length - 1] = [tx, tz];
    else this.path = [[tx, tz]];
    this.pathCells = p.length ? p : [[ex, ey]];
    return true;
  }

  followPath(dt, speed) {
    const w = this.w;
    if (!this.path.length) return true;
    // string pulling
    while (this.path.length >= 2) {
      const c0 = this.pathCells[0];
      if (w.get(c0[0], c0[1]) === T.DOOR) break;
      const nx = this.path[1];
      if (this.straight(this.x, this.z, nx[0], nx[1])) { this.path.shift(); this.pathCells.shift(); } else break;
    }
    const [tx, tz] = this.path[0];
    const cell = this.pathCells[0];
    // doors (in the next path cell, or the doorway we're standing in)
    const here = this.cell();
    for (const c of [here, cell]) {
      if (!c) continue;
      const di = w.doorAt[w.I(c[0], c[1])];
      if (di >= 0) {
        const d = w.doors[di];
        const ax = d.axis === 'x' ? 1 : 0, az = d.axis === 'x' ? 0 : 1;
        const sideMe = (this.x - d.cx) * ax + (this.z - d.cz) * az;
        const sideT = (tx - d.cx) * ax + (tz - d.cz) * az;
        const crossing = c === cell || Math.sign(sideMe) !== Math.sign(sideT);
        if ((!d.open || d.anim < 0.6) && crossing) {
          const dd = Math.hypot(d.cx - this.x, d.cz - this.z);
          if (dd < 2.1) {
            this.moveSpeed = 0;
            this.anim = 'bash';
            const want = Math.atan2(d.cx - this.x, d.cz - this.z);
            this.yaw = dampAngle(this.yaw, want, 8, dt);
            this.doorWait += dt;
            if (!d.open && this.doorWait > (this.state === ST.CHASE ? 0.55 : 1.2)) {
              this.cb.doorOpen(d, this.state === ST.CHASE || this.state === ST.HUNT);
              this.doorWait = 0;
            }
            return false;
          }
        }
      }
    }
    this.doorWait = 0;
    let dx = tx - this.x, dz = tz - this.z;
    // line up with door openings before passing through them
    if (cell && w.get(cell[0], cell[1]) === T.DOOR) {
      const di = w.doorAt[w.I(cell[0], cell[1])];
      const dr = di >= 0 ? w.doors[di] : null;
      if (dr) {
        const ax = dr.axis === 'x' ? 1 : 0, az = dr.axis === 'x' ? 0 : 1;
        const rx = this.x - dr.cx, rz = this.z - dr.cz;
        const along = rx * ax + rz * az;
        const lat = rx * az - rz * ax;
        if (Math.abs(lat) > 0.22 && Math.abs(along) > 0.5) {
          const s = Math.sign(along) || 1;
          dx = dr.cx + ax * s * 1.25 - this.x;
          dz = dr.cz + az * s * 1.25 - this.z;
        }
      }
    }
    const dReal = Math.hypot(tx - this.x, tz - this.z);
    const last = this.path.length === 1;
    if (dReal < (last ? 0.35 : 0.6)) {
      this.path.shift();
      this.pathCells.shift();
      return this.path.length === 0;
    }
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { this.path.shift(); this.pathCells.shift(); return this.path.length === 0; }
    const want = Math.atan2(dx, dz);
    this.yaw = dampAngle(this.yaw, want, this.state === ST.CHASE ? 10 : 5, dt);
    const step = Math.min(d, speed * dt);
    const ox = this.x, oz = this.z;
    const p = [this.x + (dx / d) * step, this.z + (dz / d) * step];
    w.collide(p, 0.36);
    this.x = p[0]; this.z = p[1];
    const moved = Math.hypot(this.x - ox, this.z - oz);
    this.moveSpeed = moved / Math.max(dt, 1e-4);
    if (moved < step * 0.25) {
      this.stuck += dt;
      if (this.stuck > 0.8) { this.stuck = 0; this.path = []; }
    } else this.stuck = 0;
    return false;
  }

  update(dt, players) {
    this.time += dt;
    this.timer -= dt;
    this.stareCool -= dt;
    const alive = players.filter((p) => p.alive);

    // ---- perception
    this.sight -= dt;
    let seen = null;
    if (this.sight <= 0 && this.state !== ST.DORMANT && this.state !== ST.KILL && this.state !== ST.RETREAT) {
      this.sight = 0.12;
      let best = Infinity;
      for (const p of alive) {
        if (!this.canSee(p)) continue;
        const d = Math.hypot(p.x - this.x, p.z - this.z);
        if (d < best) { best = d; seen = p; }
      }
      if (seen) {
        if (this.lastSeen && this.target === seen.id) {
          const vt = Math.max(0.05, this.time - this.lastSeenT);
          this.lastSeenVel = [(seen.x - this.lastSeen[0]) / vt, (seen.z - this.lastSeen[1]) / vt];
        }
        this.lastSeen = [seen.x, seen.z];
        this.lastSeenT = this.time;
        this.seenAt = this.time;
        this.target = seen.id;
        if (this.state !== ST.CHASE && this.state !== ST.STARE) {
          const d = best;
          if (d > 8.5 && this.stareCool <= 0 && !this.enraged) {
            this.setState(ST.STARE, 1.1 + Math.random() * 0.8);
            this.stareCool = 25;
            this.cb.stare && this.cb.stare(seen.id);
          } else {
            this.setState(ST.CHASE, 0);
            this.cb.scream();
          }
        }
      }
    }

    // hidden-player checks (locker) & breath
    for (const p of alive) {
      if (!p.hidden) { this.exposure.delete(p.id); continue; }
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (this.state === ST.CHASE && this.target === p.id && this.time - this.seenAt < 1.3 && d < 8) {
        // saw them get in
        this.goal = [p.x, p.z];
        this.setState(ST.HUNT, 6);
        this.huntTarget = p.id;
        this.computePath(p.lockerFront[0], p.lockerFront[1]);
      }
      if (d < 3.3 && this.state !== ST.KILL) {
        let e = this.exposure.get(p.id) || 0;
        if (!p.breath) e += dt; else e = Math.max(0, e - dt * 0.3);
        this.exposure.set(p.id, e);
        if (e > 1.4) {
          this.cb.catchPlayer(p.id, 'locker');
          this.setState(ST.KILL, 3.2);
          return;
        }
      }
    }

    switch (this.state) {
      case ST.DORMANT: {
        this.anim = 'idle';
        this.moveSpeed = 0;
        if (this.timer <= 0) this.setState(ST.WANDER, 0);
        break;
      }
      case ST.STARE: {
        this.anim = 'stare';
        this.moveSpeed = 0;
        const p = players.find((q) => q.id === this.target);
        if (p) this.yaw = dampAngle(this.yaw, Math.atan2(p.x - this.x, p.z - this.z), 6, dt);
        if (this.timer <= 0) {
          this.setState(ST.CHASE, 0);
          this.cb.scream();
        }
        break;
      }
      case ST.CHASE: {
        this.anim = 'chase';
        const p = players.find((q) => q.id === this.target);
        if (!p || !p.alive) { this.setState(ST.SEARCH, 6); break; }
        const sinceSeen = this.time - this.seenAt;
        const d = Math.hypot(p.x - this.x, p.z - this.z);
        if (d < 1.15 && sinceSeen < 0.5 && !p.hidden && !p.invuln) {
          this.cb.catchPlayer(p.id, 'chase');
          this.setState(ST.KILL, 3.2);
          break;
        }
        if (sinceSeen > 3.6) {
          const lx = this.lastSeen ? this.lastSeen[0] + this.lastSeenVel[0] * 1.2 : p.x;
          const lz = this.lastSeen ? this.lastSeen[1] + this.lastSeenVel[1] * 1.2 : p.z;
          this.goal = [lx, lz];
          this.setState(ST.INVESTIGATE, 10);
          this.goal = [lx, lz];
          break;
        }
        const tx = sinceSeen < 0.3 ? p.x : this.lastSeen[0];
        const tz = sinceSeen < 0.3 ? p.z : this.lastSeen[1];
        this.repath -= dt;
        if (sinceSeen < 0.3 && d < 3 && this.straight(this.x, this.z, tx, tz)) {
          this.path = [[tx, tz]];
          this.pathCells = [[Math.floor(tx / CELL), Math.floor(tz / CELL)]];
        } else if (this.repath <= 0 || !this.path.length) {
          this.repath = 0.3;
          this.computePath(tx, tz);
        }
        this.followPath(dt, this.baseChaseSpeed());
        break;
      }
      case ST.HUNT: {
        this.anim = 'chase';
        const p = players.find((q) => q.id === this.huntTarget);
        if (!p || !p.alive) { this.setState(ST.SEARCH, 5); break; }
        if (!p.hidden) { this.target = p.id; this.setState(ST.CHASE); break; }
        const fr = p.lockerFront;
        if (Math.hypot(fr[0] - this.x, fr[1] - this.z) < 1.2) {
          this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
          this.cb.catchPlayer(p.id, 'locker');
          this.setState(ST.KILL, 3.2);
          break;
        }
        if (!this.path.length) this.computePath(fr[0], fr[1]);
        this.followPath(dt, this.baseChaseSpeed() * 0.85);
        if (this.timer <= 0) this.setState(ST.SEARCH, 6);
        break;
      }
      case ST.INVESTIGATE: {
        this.anim = 'walk';
        if (!this.goal || this.timer <= 0) { this.setState(ST.SEARCH, 6); break; }
        if (!this.path.length) {
          if (!this.computePath(this.goal[0], this.goal[1])) { this.setState(ST.SEARCH, 5); break; }
        }
        const done = this.followPath(dt, 2.35 + this.fuses * 0.1);
        if (done || (this.goal && Math.hypot(this.goal[0] - this.x, this.goal[1] - this.z) < 0.6)) this.setState(ST.SEARCH, 5 + Math.random() * 4);
        break;
      }
      case ST.SEARCH: {
        this.anim = this.path.length ? 'walk' : 'search';
        if (!this.path.length && Math.random() < dt * 0.5) {
          const [cx, cy] = this.cell();
          const nx = cx + Math.round((Math.random() - 0.5) * 6), ny = cy + Math.round((Math.random() - 0.5) * 6);
          if (this.w.monsterWalkable(nx, ny)) { const [gx, gz] = this.w.center(nx, ny); this.computePath(gx, gz); }
        }
        if (this.path.length) this.followPath(dt, 1.5);
        else this.moveSpeed = 0;
        if (this.timer <= 0) this.setState(ST.WANDER, 0);
        break;
      }
      case ST.KILL: {
        this.anim = 'scare';
        this.moveSpeed = 0;
        if (this.timer <= 0) this.setState(ST.RETREAT, 7);
        break;
      }
      case ST.RETREAT: {
        this.anim = 'walk';
        if (!this.path.length) {
          // move away from players
          const g = this.pickWanderGoal([]);
          if (g) this.computePath(g[0], g[1]);
        }
        this.followPath(dt, 1.8);
        if (this.timer <= 0) this.setState(ST.WANDER, 0);
        break;
      }
      case ST.WANDER:
      default: {
        if (this.pause > 0) {
          this.pause -= dt;
          this.anim = 'search';
          this.moveSpeed = 0;
          break;
        }
        this.anim = 'walk';
        if (this.enraged) {
          this.huntT -= dt;
          if (this.huntT <= 0 && alive.length) {
            this.huntT = 4;
            let best = null, bd = Infinity;
            for (const p of alive) { const d = Math.hypot(p.x - this.x, p.z - this.z); if (d < bd) { bd = d; best = p; } }
            if (best) { this.computePath(best.x, best.z); this.goal = [best.x, best.z]; }
          }
        }
        if (!this.path.length) {
          const g = this.pickWanderGoal(alive);
          if (g) { this.goal = g; this.computePath(g[0], g[1]); }
          else break;
        }
        const done = this.followPath(dt, this.enraged ? 2.6 : 1.4 + this.fuses * 0.1);
        if (done) this.pause = 1.5 + Math.random() * 3.5;
        break;
      }
    }

    // director: if far from everyone for a long time, relocate closer (out of sight)
    let near = Infinity;
    for (const p of alive) near = Math.min(near, Math.hypot(p.x - this.x, p.z - this.z));
    if (near > 30 && this.state === ST.WANDER) this.farTime += dt; else this.farTime = 0;
    if (this.farTime > 40) {
      this.farTime = 0;
      this.relocate(alive);
    }
    this.speed = this.moveSpeed;
  }

  relocate(alive) {
    if (!alive.length) return;
    const p = alive[Math.floor(Math.random() * alive.length)];
    for (let i = 0; i < 60; i++) {
      const cx = Math.floor(p.x / CELL) + Math.round((Math.random() - 0.5) * 18);
      const cy = Math.floor(p.z / CELL) + Math.round((Math.random() - 0.5) * 18);
      if (!this.w.monsterWalkable(cx, cy)) continue;
      const [gx, gz] = this.w.center(cx, cy);
      const d = Math.hypot(gx - p.x, gz - p.z);
      if (d < 13 || d > 24) continue;
      if (alive.some((q) => this.w.los(q.x, q.z, gx, gz))) continue;
      this.x = gx; this.z = gz;
      this.path = [];
      return;
    }
  }
}
