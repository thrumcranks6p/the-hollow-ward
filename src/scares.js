// Local "scare director": whispers behind you, apparitions, lights bursting, phantom footsteps...
import { MeshData, box, cylinder, sphere, M } from './gl/geometry.js';
import { mat4, clamp } from './math.js';
import { CELL } from './world/mapgen.js';

function buildGhost(R, mats) {
  const parts = new Map();
  const get = (m) => { if (!parts.has(m)) parts.set(m, new MeshData()); return parts.get(m); };
  const pale = [0.95, 0.95, 1.0];
  cylinder(get('ghost'), M(0, 0.62, 0, 0.5, 1.15, 0.42), 12, pale, 0.55, 1.15);
  sphere(get('ghost'), M(0, 1.15, 0, 0.36, 0.22, 0.26), 10, 6, pale);
  for (const s of [-1, 1]) {
    cylinder(get('skin'), M(s * 0.2, 0.86, 0.02, 0.06, 0.62, 0.06, 0, 0, s * 0.08), 6, [0.9, 0.9, 0.92]);
    sphere(get('skin'), M(s * 0.23, 0.53, 0.03, 0.06, 0.1, 0.05), 6, 5, [0.9, 0.9, 0.92]);
    cylinder(get('skin'), M(s * 0.08, 0.03, 0.02, 0.06, 0.12, 0.06), 6, [0.9, 0.9, 0.92]);
  }
  cylinder(get('skin'), M(0, 1.3, 0, 0.08, 0.12, 0.08), 6, [0.9, 0.9, 0.92]);
  sphere(get('skin'), M(0, 1.47, 0, 0.22, 0.27, 0.23), 10, 7, [0.9, 0.9, 0.92]);
  sphere(get('hair'), M(0, 1.5, -0.01, 0.26, 0.3, 0.26), 10, 7);
  box(get('hair'), M(0, 1.2, 0.08, 0.25, 0.62, 0.06, 0.08), [1, 1, 1]);
  box(get('hair'), M(0, 1.15, -0.06, 0.28, 0.75, 0.08, -0.05), [1, 1, 1]);
  for (const s of [-1, 1]) box(get('hair'), M(s * 0.12, 1.2, 0.0, 0.06, 0.6, 0.2, 0, 0, s * 0.05), [1, 1, 1]);
  return [...parts].map(([m, md]) => ({ mesh: R.createMesh(md), mat: mats[m] }));
}

export class Scares {
  constructor(game) {
    this.g = game;
    this.timer = 35 + Math.random() * 20;
    this.ghostParts = buildGhost(game.app.renderer, game.app.mats);
    this.app = null; // active apparition
    this.ghostM = mat4.create();
    this.last = '';
    this.musicT = 20;
  }

  update(dt) {
    const g = this.g, p = g.player;
    if (this.app) this.updateApparition(dt);
    this.musicT -= dt;
    if (this.musicT <= 0) {
      this.musicT = 28 + Math.random() * 25;
      for (const mb of g.world.musicBoxes) {
        const d = Math.hypot(mb[0] - p.x, mb[2] - p.z);
        if (d < 16) { g.app.audio.musicBox(mb, 0.22); break; }
      }
    }
    if (g.ended || p.downed || p.escaped || g.jumpscare) return;
    const md = g.monsterDist();
    if (md < 14 || g.chaseLevel > 0.2) { this.timer = Math.max(this.timer, 12); return; }
    this.timer -= dt * (1 + g.fuses * 0.15 + (g.powered ? 0.6 : 0));
    if (this.timer > 0) return;
    this.timer = 22 + Math.random() * 30;
    const opts = ['whisper', 'steps', 'knock', 'lights', 'flash', 'apparition', 'scream', 'slam', 'breath', 'fake'];
    if (p.hidden) opts.splice(0, opts.length, 'whisper', 'breath', 'knock');
    let pick;
    for (let i = 0; i < 6; i++) { pick = opts[Math.floor(Math.random() * opts.length)]; if (pick !== this.last) break; }
    this.last = pick;
    this.fire(pick);
  }

  behind(dist = 1.2, side = 0.4) {
    const p = this.g.player;
    return [p.eye[0] - p.dir[0] * dist + p.right[0] * (Math.random() - 0.5) * side * 2, p.eye[1] - 0.05, p.eye[2] - p.dir[2] * dist + p.right[2] * (Math.random() - 0.5) * side * 2];
  }

  fire(kind) {
    const g = this.g, A = g.app.audio, p = g.player, w = g.world;
    switch (kind) {
      case 'whisper': A.whisper(this.behind(0.9, 0.5), 2.0 + Math.random(), 0.4); break;
      case 'breath': A.whisper(this.behind(0.5, 0.2), 0.8, 0.25); A.heartbeat(0.5); break;
      case 'steps': {
        for (let i = 0; i < 4; i++) {
          g.later(i * 0.48, () => A.footstep(this.behind(3.2 - i * 0.6, 0.1).map((v, k) => (k === 1 ? 0 : v)), 'player', 'floor', 0.5));
        }
        break;
      }
      case 'knock': {
        const s = Math.random() < 0.5 ? 1 : -1;
        A.knock([p.x + p.right[0] * 2.6 * s, 1.2, p.z + p.right[2] * 2.6 * s], 3 + Math.floor(Math.random() * 3));
        break;
      }
      case 'lights': {
        let n = 0;
        for (const L of w.lamps) {
          if (L.mode === 'dead') continue;
          const d = Math.hypot(L.x - p.x, L.z - p.z);
          if (d > 14) continue;
          L.blackout = g.time + 3.5 + Math.random() * 2;
          if (n === 0) { A.glassBurst(L.pos); if (Math.random() < 0.6) L.mode = 'dead'; }
          n++;
        }
        if (n) { A.stinger(0.35); p.trauma = Math.max(p.trauma, 0.3); }
        else A.distantScream([p.x + 25, 1.5, p.z - 20], 0.2);
        break;
      }
      case 'flash': p.flFlicker = 1.2 + Math.random(); A.whisper(this.behind(1.5, 0.8), 1.2, 0.2); break;
      case 'scream': {
        const a = Math.random() * Math.PI * 2;
        A.distantScream([p.x + Math.cos(a) * 22, 1.5, p.z + Math.sin(a) * 22], 0.3);
        break;
      }
      case 'slam': {
        let best = null, bd = 18;
        for (const d of w.doors) { const dd = Math.hypot(d.cx - p.x, d.cz - p.z); if (dd > 5 && dd < bd) { bd = dd; best = d; } }
        if (best) A.slam([best.cx, 1.2, best.cz]);
        else A.knock([p.x, 2.9, p.z], 2);
        break;
      }
      case 'apparition':
      case 'fake':
        if (!this.spawnApparition(kind === 'fake' ? 'fake' : 'girl')) A.whisper(this.behind(1.0, 0.5), 1.5, 0.35);
        break;
    }
  }

  spawnApparition(kind) {
    const g = this.g, p = g.player, w = g.world;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    for (let tries = 0; tries < 30; tries++) {
      const d = (kind === 'fake' ? 12 : 8) + Math.random() * 7;
      const a = (Math.random() - 0.5) * 0.5;
      const dx = fx * Math.cos(a) - fz * Math.sin(a), dz = fz * Math.cos(a) + fx * Math.sin(a);
      const x = p.x + dx * d, z = p.z + dz * d;
      const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
      if (!w.monsterWalkable(cx, cy)) continue;
      const [ccx, ccz] = w.center(cx, cy);
      if (!w.los(p.x, p.z, ccx, ccz)) continue;
      this.app = { kind, x: ccx, z: ccz, t: 0, yaw: Math.atan2(p.x - ccx, p.z - ccz), seen: false };
      if (kind === 'fake') {
        const m = g.fakeModel;
        m.x = ccx; m.z = ccz; m.yaw = this.app.yaw;
        m.animate(0.016, 'stare', 0);
        m.snapPose();
      }
      return true;
    }
    return false;
  }

  updateApparition(dt) {
    const g = this.g, p = g.player, a = this.app, A = g.app.audio;
    a.t += dt;
    const dx = a.x - p.x, dz = a.z - p.z;
    const d = Math.hypot(dx, dz);
    const dot = (dx * p.dir[0] + dz * p.dir[2]) / (d || 1);
    const lit = p.flashlightIntensity() > 0 && (dx * p.fl[0] + dz * p.fl[2]) / (d || 1) > 0.97;
    if (!a.seen && dot > 0.8) {
      a.seen = true;
      a.seenT = a.t;
      A.stinger(0.55);
      if (a.kind === 'girl') A.whisper([a.x, 1.4, a.z], 1.4, 0.3);
      p.trauma = Math.max(p.trauma, 0.35);
    }
    let vanish = a.t > 5 || d < (a.kind === 'fake' ? 8 : 5);
    if (a.seen && a.t - a.seenT > (a.kind === 'fake' ? 0.9 : 1.6)) vanish = true;
    if (a.kind === 'fake' && lit && a.seen && a.t - a.seenT > 0.35) vanish = true;
    if (a.seen && dot < 0.3) vanish = true;
    if (vanish) {
      for (const L of g.world.lamps) if (Math.hypot(L.x - a.x, L.z - a.z) < 10) L.blackout = g.time + 0.6;
      p.flFlicker = Math.max(p.flFlicker, 0.35);
      if (a.seen && d < 9) A.whisper([a.x, 1.5, a.z], 0.6, 0.3);
      this.app = null;
      return;
    }
    if (a.kind === 'fake') {
      const m = g.fakeModel;
      m.yaw = Math.atan2(p.x - a.x, p.z - a.z);
      m.animate(dt, 'stare', 0);
    } else {
      a.yaw = Math.atan2(p.x - a.x, p.z - a.z);
      mat4.compose(this.ghostM, a.x, Math.sin(a.t * 2) * 0.02, a.z, 0, a.yaw, Math.sin(a.t * 1.3) * 0.05);
    }
  }

  pushDraws(list) {
    const a = this.app;
    if (!a) return;
    if (a.kind === 'fake') {
      const m = this.g.fakeModel;
      m.computeMatrices();
      m.pushDraws(list, 2.6);
    } else {
      for (const part of this.ghostParts) list.push({ mesh: part.mesh, mat: part.mat, model: this.ghostM, shadow: true });
    }
  }
}

export { clamp };
