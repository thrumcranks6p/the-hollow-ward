// Game session: simulation, networking glue, audio direction, rendering.
import { mat4, clamp, lerp, damp, dampAngle, hash1 } from './math.js';
import { generateMap, CELL, WALL_H, T } from './world/mapgen.js';
import { World } from './world/world.js';
import { MeshData, beamCone } from './gl/geometry.js';
import { Player } from './player.js';
import { MonsterModel, MonsterAI } from './monster.js';
import { Avatar, PLAYER_COLORS } from './avatar.js';
import { Scares } from './scares.js';
import { NOTES } from './story.js';

const SPOT_OUTER = (26 * Math.PI) / 180;
const SPOT_INNER = (11 * Math.PI) / 180;
const FL_COLOR = [7.2, 6.6, 5.3];
const FL_RANGE = 22;
const r2 = (v) => Math.round(v * 100) / 100;

function flicker(t, s) {
  const slow = hash1(Math.floor(t * 0.35 + s * 7) + s * 3.3);
  if (slow > 0.72) return 0.0;
  const seg = Math.floor(t * 11 + s * 50);
  const r = hash1(seg + s * 13.7);
  if (r < 0.2) return 0.03;
  if (r < 0.32) return 0.4;
  return 0.85 + 0.15 * hash1(seg * 3.1 + s);
}

export class Game {
  constructor(app, opts) {
    this.app = app;
    const R = app.renderer, mats = app.mats;
    this.opts = opts;
    this.mode = opts.mode;
    this.isHost = opts.mode !== 'client';
    this.net = opts.net || null;
    this.localId = opts.localId;
    this.roster = opts.players;
    this.seed = opts.seed;
    this.map = generateMap(opts.seed);
    this.world = new World(this.map, R, mats);
    const w = this.world;
    const me = this.roster.find((r) => r.id === this.localId) || this.roster[0];
    this.me = me;
    const sp = w.spawnPoints[me.idx % w.spawnPoints.length];
    const rc = w.center(Math.floor((this.map.spawnRoom.x0 + this.map.spawnRoom.x1) / 2), Math.floor((this.map.spawnRoom.y0 + this.map.spawnRoom.y1) / 2));
    const door = this.map.spawnRoom.doors[0];
    const look = door ? w.center(door.x, door.y) : rc;
    const yaw0 = Math.atan2(look[0] - sp[0], look[1] - sp[1]) + Math.PI;
    this.player = new Player(w, sp[0], sp[1], yaw0);
    this.status = new Map();
    for (const r of this.roster) this.status.set(r.id, 'alive');
    this.remotes = new Map();
    for (const r of this.roster) {
      if (r.id === this.localId) continue;
      const s = w.spawnPoints[r.idx % w.spawnPoints.length];
      this.remotes.set(r.id, { r, avatar: new Avatar(R, mats, r.idx), x: s[0], z: s[1], yaw: 0, pitch: 0, tx: s[0], tz: s[1], tyaw: 0, tpitch: 0, fl: true, cr: false, hid: -1, br: false, sp: 0, voice: null, invulnUntil: 0 });
    }
    this.monsterModel = new MonsterModel(R, mats);
    this.fakeModel = new MonsterModel(R, mats);
    const [mx, mz] = w.monsterSpawn;
    this.mon = { x: mx, z: mz, yaw: 0, tx: mx, tz: mz, tyaw: 0, anim: 'idle', state: 'dormant', sp: 0 };
    this.monLast = [mx, mz];
    if (this.isHost) {
      this.ai = new MonsterAI(w, {
        scream: () => this.hostEvent({ e: 'scream' }),
        growl: () => this.hostEvent({ e: 'growl' }),
        stare: (id) => this.hostEvent({ e: 'stare', id }),
        doorOpen: (d, bash) => this.setDoor(d, true, bash, 'monster'),
        catchPlayer: (id, how) => this.hostCatch(id, how),
      }, { dormant: opts.noMonster ? 1e9 : opts.dormant ?? (this.roster.length > 1 ? 24 : 30), coop: this.roster.length > 1 });
    }
    this.fuses = 0;
    this.powered = false;
    this.ended = false;
    this.paused = false;
    this.time = 0;
    this.timers = [];
    this.scares = new Scares(this);
    const bm = new MeshData();
    beamCone(bm, 24);
    this.beamMesh = R.createMesh(bm);
    const dp = new Float32Array(900 * 3);
    for (let i = 0; i < dp.length; i++) dp[i] = Math.random();
    this.dust = { mesh: R.createPoints(dp), size: 9 };
    this.fear = 0;
    this.chaseLevel = 0;
    this.redFlash = 0;
    this.fade = 1;
    this.flash = 0;
    this.heartT = 1;
    this.breathT = 0;
    this.netT = 0;
    this.noiseT = 0;
    this.monStep = 0;
    this.growlT = 10;
    this.lastMonSeen = -100;
    this.noteOpen = null;
    this.jumpscare = null;
    this.reviveHold = 0;
    this.interact = null;
    this.pendingEnd = null;
    this.proj = mat4.create(); this.view = mat4.create(); this.vp = mat4.create();
    this.spotV = mat4.create(); this.spotP = mat4.create(); this.spotVP = mat4.create();
    this.beamM = mat4.create(); this.tmpM = mat4.create();
    this.boxCache = new Map();
    this.rockerM = mat4.create();
    this.creakT = 0;
    this.hintT = 22;
    this.gateMsgT = 0;
    this.stats = { start: performance.now(), notes: new Set() };
    app.audio.startAmbience();
    app.ui.hud(true);
    app.ui.intro();
    app.ui.hint('WASD move &middot; SHIFT run &middot; C crouch &middot; F flashlight &middot; E interact');
    this.later(6.5, () => app.ui.message('Find the <b class="amber">4 fuses</b>. Restore the power. Escape.', 6));
    if (this.mode !== 'solo') this.later(13, () => app.ui.message('Stay together. Your teammates can revive you if <i>he</i> takes you.', 5));
  }

  later(t, f) { this.timers.push({ t: this.time + t, f }); }
  message(t, d) { this.app.ui.message(t, d); }
  name(id) { if (id === this.localId) return 'You'; const r = this.roster.find((x) => x.id === id); return r ? escapeHtml(r.name) : '???'; }
  surfaceAt(x, z) {
    const [cx, cy] = this.world.cellOf(x, z);
    return this.world.roomAt(cx, cy) ? this.world.floorMat(cx, cy) : 'floor';
  }
  monsterDist() { return Math.hypot(this.mon.x - this.player.x, this.mon.z - this.player.z); }
  cellBox(x, z) {
    const [cx, cy] = this.world.cellOf(x, z);
    const k = cy * 1000 + cx;
    let b = this.boxCache.get(k);
    if (!b) { b = this.world.lightBox(cx, cy, 3); this.boxCache.set(k, b); }
    return b;
  }

  // =================================================================== networking / authority
  act(a) {
    if (this.isHost) this.hostAct(this.localId, a);
    else this.net && this.net.toHost({ t: 'act', ...a });
  }
  hostEvent(ev) {
    this.applyEvent(ev);
    if (this.net) this.net.broadcast({ t: 'ev', ...ev });
  }
  noise(x, z, r) {
    if (this.isHost) { this.ai.hear(x, z, r); return; }
    if (r < 6 && this.noiseT > this.time) return;
    this.noiseT = this.time + 0.4;
    this.net && this.net.toHost({ t: 'act', a: 'noise', x: r2(x), z: r2(z), r });
  }
  setDoor(d, open, bash, by) {
    d.open = open;
    d.lastToggle = this.time;
    this.hostEvent({ e: 'door', id: d.id, open, bash: !!bash });
    if (by !== 'monster' && this.ai) this.ai.hear(d.cx, d.cz, 8);
  }
  hostCatch(id, how) {
    if (this.status.get(id) !== 'alive') return;
    if (id === this.localId && this.player.invuln > 0) return;
    const r = this.remotes.get(id);
    if (r && r.invulnUntil > this.time) return;
    this.hostEvent({ e: 'caught', id, how });
    this.checkEnd();
  }
  checkEnd() {
    if (!this.isHost || this.ended || this.pendingEnd) return;
    let alive = 0, esc = 0;
    for (const s of this.status.values()) { if (s === 'alive') alive++; if (s === 'escaped') esc++; }
    if (alive === 0) {
      const st = {};
      for (const [k, v] of this.status) st[k] = v;
      this.hostEvent({ e: 'end', result: esc > 0 ? 'win' : 'lose', st, time: Math.round(this.time) });
    }
  }
  hostAct(from, a) {
    const w = this.world;
    switch (a.a) {
      case 'door': {
        const d = w.doors[a.id];
        if (!d || this.time - d.lastToggle < 0.45) return;
        if (d.open) {
          const ents = [[this.player.x, this.player.z], [this.ai.x, this.ai.z], ...[...this.remotes.values()].map((r) => [r.tx, r.tz])];
          if (ents.some(([x, z]) => Math.hypot(x - d.cx, z - d.cz) < 0.75)) return;
        }
        this.setDoor(d, !d.open, false, from);
        break;
      }
      case 'pickup': {
        const it = w.items[a.id];
        if (!it || it.taken) return;
        it.taken = true;
        if (it.kind === 'fuse') this.fuses++;
        this.hostEvent({ e: 'pickup', id: it.id, by: from, fuses: this.fuses });
        this.ai.hear(it.pos[0], it.pos[2], 5);
        break;
      }
      case 'power': {
        if (this.fuses < 4 || this.powered) return;
        this.hostEvent({ e: 'power', by: from });
        break;
      }
      case 'revive': {
        if (this.status.get(a.id) !== 'down' || this.status.get(from) !== 'alive') return;
        this.hostEvent({ e: 'revived', id: a.id, by: from });
        break;
      }
      case 'escape': {
        if (this.status.get(from) !== 'alive' || !this.powered) return;
        this.hostEvent({ e: 'escaped', id: from });
        this.checkEnd();
        break;
      }
      case 'noise': this.ai.hear(a.x, a.z, a.r); break;
    }
  }

  applyEvent(ev) {
    const A = this.app.audio, w = this.world, p = this.player;
    const mpos = [this.mon.x, 2.2, this.mon.z];
    switch (ev.e) {
      case 'scream':
        A.monsterScream(mpos, 1);
        if (this.monsterDist() < 25) p.trauma = Math.max(p.trauma, 0.5);
        break;
      case 'growl': A.growl(mpos, 0.6); break;
      case 'stare':
        if (ev.id === this.localId) { A.stinger(0.75); p.trauma = Math.max(p.trauma, 0.45); }
        break;
      case 'door': {
        const d = w.doors[ev.id];
        if (!d) return;
        d.open = ev.open;
        d.bash = ev.bash;
        d.lastToggle = this.time;
        const pos = [d.cx, 1.2, d.cz];
        if (ev.bash) { A.doorBash(pos); if (Math.hypot(d.cx - p.x, d.cz - p.z) < 10) p.trauma = Math.max(p.trauma, 0.4); }
        else if (ev.open) A.doorOpen(pos);
        else A.doorClose(pos);
        break;
      }
      case 'pickup': {
        const it = w.items[ev.id];
        if (!it) return;
        it.taken = true;
        if (it.kind === 'fuse') {
          this.fuses = ev.fuses;
          A.chime([523, 784, 1046], 0.16, 1.2);
          this.message(`${ev.by === this.localId ? 'You found' : this.name(ev.by) + ' found'} a <b class="amber">fuse</b> (${this.fuses}/4)` + (this.fuses === 4 ? '<br>Get to the <b>generator</b>!' : ''), 4.5);
          if (this.fuses === 2) this.later(3, () => A.distantScream([p.x - 20, 1.5, p.z + 15], 0.3));
        } else if (it.kind === 'battery') {
          if (ev.by === this.localId) {
            p.battery = Math.min(1, p.battery + 0.5);
            A.chime([660, 990], 0.1, 0.4);
            A.click(null, 0.4);
            this.message('Battery <b>+50%</b>', 2);
          }
        }
        break;
      }
      case 'caught': {
        this.status.set(ev.id, 'down');
        if (ev.id === this.localId) this.startJumpscare(ev.how);
        else {
          const r = this.remotes.get(ev.id);
          if (r) A.distantScream([r.x, 1.2, r.z], 0.5);
          this.message(`<span class="red">${this.name(ev.id)} has been taken!</span>` + (this.status.get(this.localId) === 'alive' ? '<br>Hold [E] on them to revive.' : ''), 5);
        }
        break;
      }
      case 'revived': {
        this.status.set(ev.id, 'alive');
        if (ev.id === this.localId) {
          p.downed = false;
          p.invuln = 4;
          p.trauma = 0.3;
          this.app.ui.show('down-overlay', false);
          this.message(`${this.name(ev.by)} pulled you back up. <b>RUN.</b>`, 4);
        } else {
          const r = this.remotes.get(ev.id);
          if (r) r.invulnUntil = this.time + 4;
          this.message(`${this.name(ev.id)} is back on their feet.`, 3);
        }
        break;
      }
      case 'escaped': {
        this.status.set(ev.id, 'escaped');
        if (ev.id === this.localId) {
          p.escaped = true;
          this.app.ui.show('escaped-overlay', this.mode !== 'solo');
        } else this.message(`<b>${this.name(ev.id)}</b> made it out!`, 4);
        break;
      }
      case 'power': this.onPower(ev.by); break;
      case 'end': this.endGame(ev.result, ev.st); break;
      case 'left': {
        const r = this.remotes.get(ev.id);
        if (r) this.message(`${escapeHtml(r.r.name)} lost connection...`, 4);
        this.remotes.delete(ev.id);
        this.status.delete(ev.id);
        break;
      }
    }
  }

  onMessage(from, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (this.isHost) {
      if (msg.t === 'ps') {
        const r = this.remotes.get(from);
        if (!r) return;
        const q = msg.p;
        r.tx = q[0]; r.tz = q[1]; r.tyaw = q[2]; r.tpitch = q[3];
        r.fl = !!(q[4] & 1); r.cr = !!(q[4] & 2); r.br = !!(q[4] & 8); r.sp = q[5]; r.hid = q[6];
      } else if (msg.t === 'act') this.hostAct(from, msg);
    } else {
      if (msg.t === 'snap') {
        const m = msg.m;
        this.mon.tx = m[0]; this.mon.tz = m[1]; this.mon.tyaw = m[2]; this.mon.anim = m[3]; this.mon.sp = m[4]; this.mon.state = m[5];
        for (const id in msg.ps) {
          if (id === this.localId) continue;
          const r = this.remotes.get(id);
          if (!r) continue;
          const q = msg.ps[id];
          r.tx = q[0]; r.tz = q[1]; r.tyaw = q[2]; r.tpitch = q[3];
          r.fl = !!(q[4] & 1); r.cr = !!(q[4] & 2); r.br = !!(q[4] & 8); r.sp = q[5]; r.hid = q[6];
        }
        if (msg.st) for (const id in msg.st) if (id !== this.localId) this.status.set(id, msg.st[id]);
        if (msg.f > this.fuses) this.fuses = msg.f;
        if (msg.pw && !this.powered) this.onPower(null);
      } else if (msg.t === 'ev') this.applyEvent(msg);
    }
  }
  onLeave(id) {
    if (id === (this.net && this.net.hostId) && !this.isHost) {
      this.endGame('lost-host');
      return;
    }
    const r = this.remotes.get(id);
    if (!r) return;
    this.message(`${escapeHtml(r.r.name)} lost connection...`, 4);
    this.remotes.delete(id);
    this.status.delete(id);
    if (this.isHost) this.net.broadcast({ t: 'ev', e: 'left', id });
    this.checkEnd();
  }
  attachVoice(id, stream) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.voice = this.app.audio.attachVoice(stream);
  }

  packLocal() {
    const p = this.player;
    const flags = (p.flashlightIntensity() > 0.1 ? 1 : 0) | (p.crouching ? 2 : 0) | (p.hidden ? 4 : 0) | (p.holding ? 8 : 0);
    return [r2(p.x), r2(p.z), r2(p.yaw), r2(p.pitch), flags, r2(p.speed), p.hidden ? p.hidden.id : -1];
  }
  netSend(dt) {
    if (!this.net) return;
    this.netT -= dt;
    if (this.netT > 0) return;
    this.netT = 1 / 15;
    if (this.isHost) {
      const ps = { [this.localId]: this.packLocal() };
      for (const [id, r] of this.remotes) ps[id] = [r2(r.tx), r2(r.tz), r2(r.tyaw), r2(r.tpitch), (r.fl ? 1 : 0) | (r.cr ? 2 : 0) | (r.hid >= 0 ? 4 : 0) | (r.br ? 8 : 0), r.sp, r.hid];
      const st = {};
      for (const [k, v] of this.status) st[k] = v;
      this.net.broadcast({ t: 'snap', m: [r2(this.mon.x), r2(this.mon.z), r2(this.mon.yaw), this.mon.anim, r2(this.mon.sp), this.mon.state], ps, st, f: this.fuses, pw: this.powered ? 1 : 0 });
    } else this.net.toHost({ t: 'ps', p: this.packLocal() });
  }

  playerStates() {
    const p = this.player;
    const out = [];
    const fl = Math.hypot(p.fl[0], p.fl[2]) || 1;
    out.push({
      id: this.localId, x: p.x, z: p.z, alive: this.status.get(this.localId) === 'alive' && !p.downed && !p.escaped,
      hidden: !!p.hidden, fl: p.flashlightIntensity() > 0.1, cr: p.crouching, fx: p.fl[0] / fl, fz: p.fl[2] / fl,
      breath: p.holding, lockerFront: p.hidden ? p.hidden.front : null, invuln: p.invuln > 0,
    });
    for (const [id, r] of this.remotes) {
      const L = r.hid >= 0 ? this.world.lockers[r.hid] : null;
      out.push({
        id, x: L ? L.x : r.tx, z: L ? L.z : r.tz, alive: this.status.get(id) === 'alive', hidden: !!L, fl: r.fl, cr: r.cr,
        fx: Math.sin(r.tyaw), fz: Math.cos(r.tyaw), breath: r.br, lockerFront: L ? L.front : null, invuln: r.invulnUntil > this.time,
      });
    }
    return out;
  }

  // =================================================================== local events
  onPower(by) {
    if (this.powered) return;
    this.powered = true;
    const A = this.app.audio, w = this.world;
    w.exitOpen = true;
    for (const L of w.lamps) L.mode = 'alarm';
    const g = w.generatorPos;
    if (g) A.generatorStart([g.x, 1, g.z]);
    A.stinger(0.9);
    this.player.trauma = Math.max(this.player.trauma, 0.6);
    this.flash = 0.5;
    this.message('<span class="red">POWER RESTORED.</span> The gate is opening... <b>he knows where you are. RUN!</b>', 7);
    if (this.ai) {
      this.ai.enraged = true;
      this.ai.huntT = 0;
      if (this.ai.state === 'dormant') this.ai.setState('wander');
    }
    void by;
  }

  startJumpscare(how) {
    const p = this.player, A = this.app.audio;
    if (p.hidden) { p.hidden = null; this.app.ui.show('locker-overlay', false); }
    this.closeNote();
    this.jumpscare = { t: 0, how };
    p.trauma = 1;
    this.redFlash = 1;
    A.screech(1);
    A.stinger(1);
  }
  updateJumpscare(dt) {
    const j = this.jumpscare;
    if (!j) return;
    j.t += dt;
    const p = this.player, m = this.monsterModel;
    p.pitch = damp(p.pitch, 0.05, 8, dt);
    p.trauma = Math.max(p.trauma, 0.8);
    m.animate(dt, 'scare', 0);
    m.yaw = p.yaw + Math.PI;
    const d = 0.5 + Math.max(0, 0.7 - j.t * 3.5);
    m.x = p.x; m.z = p.z; m.y = 0;
    m.computeMatrices();
    const h = m.headWorld();
    const tx = p.eye[0] + Math.sin(p.yaw) * d, tz = p.eye[2] + Math.cos(p.yaw) * d;
    m.x += tx - h[0]; m.z += tz - h[2]; m.y += p.eye[1] - h[1] - 0.04;
    m.computeMatrices();
    if (j.t > 1.6) this.fade = Math.min(1, (j.t - 1.6) / 0.5);
    if (j.t > 2.4) {
      this.jumpscare = null;
      m.y = 0;
      if (this.pendingEnd) { const pe = this.pendingEnd; this.pendingEnd = null; this.showEnd(pe.result, pe.st); return; }
      p.downed = true;
      this.fade = 0.6;
      if (this.mode !== 'solo') {
        this.app.ui.show('down-overlay', true);
      }
    }
  }

  openNote(i) {
    this.noteOpen = { i };
    this.stats.notes.add(i);
    this.app.ui.showNote(NOTES[i]);
    this.app.audio.paper();
  }
  closeNote() {
    if (!this.noteOpen) return;
    this.noteOpen = null;
    this.app.ui.hideNote();
    this.app.audio.paper();
  }

  enterLocker(L) {
    const p = this.player;
    for (const r of this.remotes.values()) if (r.hid === L.id) { this.message('Someone is already hiding in there.', 2); return; }
    p.flBeforeHide = p.flOn;
    p.hidden = L;
    p.yaw = L.yaw;
    p.pitch = 0;
    p.crouching = false;
    this.app.audio.metal([L.x, 1.2, L.z], 0.35);
    this.app.ui.show('locker-overlay', true);
    this.noise(L.x, L.z, 3.5);
  }
  exitLocker() {
    const p = this.player, L = p.hidden;
    if (!L) return;
    p.hidden = null;
    if (p.flBeforeHide && p.battery > 0) p.flOn = true;
    const pt = [L.front[0] + (L.x - L.front[0]) * 0.15, L.front[1] + (L.z - L.front[1]) * 0.15];
    this.world.collide(pt, 0.3);
    p.x = pt[0]; p.z = pt[1];
    this.app.audio.metal([L.x, 1.2, L.z], 0.4);
    this.app.ui.show('locker-overlay', false);
    this.noise(L.x, L.z, 4);
  }

  // =================================================================== interaction
  updateInteraction(dt, input) {
    const p = this.player, w = this.world, ui = this.app.ui;
    let best = null, bestS = -1;
    const eye = p.eye, dir = p.dir;
    const consider = (kind, ref, x, y, z, range, label) => {
      const dx = x - eye[0], dy = y - eye[1], dz = z - eye[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > range) return;
      const dot = (dx * dir[0] + dy * dir[1] + dz * dir[2]) / (d || 1);
      const need = d < 1.0 ? 0.55 : 0.83;
      if (dot < need) return;
      const s = dot - d * 0.04;
      if (s <= bestS) return;
      if (!w.los(eye[0], eye[2], x, z)) return;
      best = { kind, ref, label };
      bestS = s;
    };
    if (p.hidden) {
      best = { kind: 'unhide', label: '<b>[E]</b> Leave the locker' };
    } else if (!p.downed && !p.escaped) {
      for (const d of w.doors) {
        if (Math.abs(d.cx - p.x) > 3 || Math.abs(d.cz - p.z) > 3) continue;
        consider('door', d, d.cx, 1.1, d.cz, 2.4, d.open ? '<b>[E]</b> Close door' : '<b>[E]</b> Open door');
      }
      for (const it of w.items) {
        if (it.taken) continue;
        if (Math.abs(it.pos[0] - p.x) > 3 || Math.abs(it.pos[2] - p.z) > 3) continue;
        const lbl = it.kind === 'fuse' ? '<b>[E]</b> Take the <b class="amber">fuse</b>' : it.kind === 'battery' ? '<b>[E]</b> Take battery' : '<b>[E]</b> Read note';
        consider('item', it, it.pos[0], it.pos[1] + 0.05, it.pos[2], 2.3, lbl);
      }
      for (const L of w.lockers) {
        if (Math.abs(L.x - p.x) > 3 || Math.abs(L.z - p.z) > 3) continue;
        const cx = L.x + (L.front[0] - L.x) * 0.25, cz = L.z + (L.front[1] - L.z) * 0.25;
        consider('locker', L, cx, 1.1, cz, 2.0, '<b>[E]</b> Hide in locker');
      }
      const g = w.generatorPos;
      if (g) {
        const lbl = this.powered ? 'The generator is roaring.' : this.fuses >= 4 ? '<b>[E]</b> Insert the fuses &amp; <b class="red">restore power</b>' : `Generator &mdash; missing fuses (<b class="amber">${this.fuses}/4</b>)`;
        consider('gen', g, g.x, 1.0, g.z, 2.6, lbl);
      }
      const ex = w.exit;
      if (!this.powered) consider('gate', ex, ex.gx, 1.3, ex.gz, 3, 'EXIT &mdash; <span class="red">locked. No power.</span>');
      for (const [id, r] of this.remotes) {
        if (this.status.get(id) !== 'down') continue;
        consider('revive', id, r.x, 0.35, r.z, 2.2, `Hold <b>[E]</b> to revive ${escapeHtml(r.r.name)}`);
      }
    }
    this.interact = best;
    ui.prompt(best ? best.label : '');
    // revive hold
    if (best && best.kind === 'revive' && input.down('KeyE')) {
      if (this.reviveTarget !== best.ref) { this.reviveTarget = best.ref; this.reviveHold = 0; }
      this.reviveHold += dt;
      if (this.reviveHold >= 3) { this.act({ a: 'revive', id: best.ref }); this.reviveHold = 0; }
    } else this.reviveHold = 0;
    ui.revive(this.reviveHold / 3);
    if (!best || !input.hit('KeyE')) return;
    switch (best.kind) {
      case 'unhide': this.exitLocker(); break;
      case 'door': this.act({ a: 'door', id: best.ref.id }); break;
      case 'item':
        if (best.ref.kind === 'note') this.openNote(best.ref.note);
        else this.act({ a: 'pickup', id: best.ref.id });
        break;
      case 'locker': this.enterLocker(best.ref); break;
      case 'gen':
        if (!this.powered && this.fuses >= 4) this.act({ a: 'power' });
        else if (!this.powered) { this.app.audio.metal([best.ref.x, 1, best.ref.z], 0.3); this.message(`The fuse panel has four empty slots. You have <b class="amber">${this.fuses}</b>.`, 3); }
        break;
      case 'gate': this.app.audio.metal([best.ref.gx, 1, best.ref.gz], 0.5); this.noise(best.ref.gx, best.ref.gz, 7); this.message('The gate won\'t budge. It needs <b>power</b>.', 3); break;
    }
  }

  // =================================================================== per-frame
  update(dt) {
    const app = this.app, A = app.audio, input = app.input, S = app.settings, ui = app.ui;
    if (this.paused) { this.render(); return; }
    this.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.timers[i].t <= this.time) { const f = this.timers[i].f; this.timers.splice(i, 1); f(); }
    const p = this.player;
    if (this.noteOpen && (input.hit('KeyE') || input.hit('Escape') || input.hit('Mouse0'))) { this.closeNote(); input.pressed.delete('KeyE'); }
    const frozen = !input.locked || !!this.noteOpen || !!this.jumpscare || this.ended;
    const ev = p.update(dt, input, S, frozen);
    if (ev.flToggled) A.flashClick();
    for (const s of ev.steps) { A.footstep(null, 'player', this.surfaceAt(p.x, p.z), s.vol); this.noise(p.x, p.z, s.radius); }
    if (ev.gasp) { A.breath(0.7, true); this.noise(p.x, p.z, 9); this.message('You gasp for air!', 2); }
    if (p.exhausted && !p.hidden) {
      this.breathT -= dt;
      if (this.breathT <= 0) { this.breathT = 0.8; this.breathIn = !this.breathIn; A.breath(0.13, this.breathIn); if (this.breathIn) this.noise(p.x, p.z, 4); }
    }
    if (!frozen) this.updateInteraction(dt, input);
    else { ui.prompt(''); ui.revive(0); }
    // reached the exit?
    const ex = this.world.exit;
    if (this.world.exitAnim > 0.8 && !p.escaped && !p.downed && Math.floor(p.x / CELL) === ex.x && Math.floor(p.z / CELL) === ex.y) {
      p.escaped = true;
      this.act({ a: 'escape' });
      this.flash = 1;
    }
    if (this.isHost) {
      const ai = this.ai;
      ai.fuses = this.fuses;
      ai.update(dt, this.playerStates());
      this.mon.x = ai.x; this.mon.z = ai.z; this.mon.yaw = ai.yaw; this.mon.anim = ai.anim; this.mon.state = ai.state; this.mon.sp = ai.speed;
    } else {
      const m = this.mon;
      if (Math.hypot(m.tx - m.x, m.tz - m.z) > 6) { m.x = m.tx; m.z = m.tz; }
      m.x = damp(m.x, m.tx, 10, dt); m.z = damp(m.z, m.tz, 10, dt);
      m.yaw = dampAngle(m.yaw, m.tyaw, 10, dt);
    }
    this.updateRemotes(dt);
    for (const d of this.world.doors) {
      const tgt = d.open ? 1 : 0;
      if (d.anim !== tgt) {
        const sp = d.bash ? 5 : 2.4;
        d.anim = tgt > d.anim ? Math.min(1, d.anim + dt * sp) : Math.max(0, d.anim - dt * sp);
        this.world.updateDoorMatrix(d);
      }
    }
    this.world.updateExit(dt);
    this.updateLamps(dt);
    this.updateMonsterVisual(dt);
    this.updateAudio(dt);
    this.scares.update(dt);
    this.updateJumpscare(dt);
    this.netSend(dt);
    this.updateHud(dt);
    this.redFlash = Math.max(0, this.redFlash - dt * 0.7);
    this.flash = Math.max(0, this.flash - dt * 1.5);
    if (!this.jumpscare && !p.downed && !this.ended) this.fade = Math.max(0, this.fade - dt * 0.35);
    if (p.downed && !this.jumpscare) this.fade = damp(this.fade, 0.45, 1, dt);
    if (p.escaped) this.fade = damp(this.fade, 0.85, 1.5, dt);
    this.render();
  }

  updateRemotes(dt) {
    for (const [id, r] of this.remotes) {
      if (Math.hypot(r.tx - r.x, r.tz - r.z) > 5) { r.x = r.tx; r.z = r.tz; }
      r.x = damp(r.x, r.tx, 12, dt); r.z = damp(r.z, r.tz, 12, dt);
      r.yaw = dampAngle(r.yaw, r.tyaw, 12, dt);
      r.pitch = damp(r.pitch, r.tpitch, 12, dt);
      const a = r.avatar;
      a.x = r.x; a.z = r.z; a.yaw = r.yaw;
      a.animate(dt, r.sp || 0, r.pitch, r.cr, this.status.get(id) === 'down');
      a.computeMatrices();
      if (r.voice) {
        const h = mat4.getPos(a.head.world);
        this.app.audio.setPos(r.voice.p, [h[0], h[1] + 0.2, h[2]]);
      }
    }
  }

  updateLamps(dt) {
    const t = this.time, mx = this.mon.x, mz = this.mon.z;
    for (const L of this.world.lamps) {
      let lv;
      if (L.mode === 'alarm') {
        lv = 0.2 + 0.8 * Math.pow(Math.max(0, Math.sin(t * 3.4 + L.x * 0.12 + L.z * 0.05)), 2);
        L.curColor = [1.0, 0.07, 0.03];
        L.curBase = 3.2;
      } else {
        L.curColor = L.color;
        L.curBase = L.base;
        if (L.mode === 'dead') lv = 0;
        else if (L.mode === 'steady') lv = 0.88 + 0.04 * Math.sin(t * 50 + L.seed);
        else lv = flicker(t, L.seed);
      }
      if (L.blackout && L.blackout > t) lv = 0;
      if (lv > 0 && Math.hypot(L.x - mx, L.z - mz) < 7 && L.mode !== 'alarm') lv *= hash1(Math.floor(t * 18) + L.seed) > 0.45 ? 1 : 0.05;
      L.level = lv;
    }
  }

  updateMonsterVisual(dt) {
    if (this.jumpscare) return;
    const m = this.monsterModel, A = this.app.audio;
    m.x = this.mon.x; m.z = this.mon.z; m.y = 0; m.yaw = this.mon.yaw;
    m.animate(dt, this.mon.anim, this.mon.sp);
    m.computeMatrices();
    const moved = Math.hypot(m.x - this.monLast[0], m.z - this.monLast[1]);
    this.monLast = [m.x, m.z];
    if (moved < 1) this.monStep += moved;
    const stepLen = this.mon.anim === 'chase' ? 1.25 : 0.9;
    if (this.monStep > stepLen) {
      this.monStep = 0;
      A.footstep([m.x, 0.1, m.z], 'monster', 'floor', this.mon.anim === 'chase' ? 1.1 : 0.75);
    }
  }

  updateAudio(dt) {
    const A = this.app.audio, p = this.player, w = this.world;
    A.setListener(p.eye, p.dir, p.up);
    const md = this.monsterDist();
    const st = this.mon.state, anim = this.mon.anim;
    const los = md < 30 && w.los(p.x, p.z, this.mon.x, this.mon.z);
    const chase = anim === 'chase';
    A.setMonsterBreath([this.mon.x, 2.1, this.mon.z], md < 20 ? (chase ? 0.55 : st === 'dormant' ? 0.12 : 0.28) : 0);
    let ft = clamp(1 - md / 20, 0, 1) * (los ? 1 : 0.5);
    if (chase && md < 25) ft = Math.max(ft, 0.85);
    if (p.hidden && md < 5) ft = 1;
    if (p.downed) ft = 0.3;
    this.fear = damp(this.fear, ft, 1.6, dt);
    this.chaseLevel = damp(this.chaseLevel, chase && md < 35 && !p.downed ? 1 : 0, chase ? 3 : 0.6, dt);
    A.setFear(this.fear, this.chaseLevel);
    if (this.fear > 0.12 || p.exhausted) {
      this.heartT -= dt;
      if (this.heartT <= 0) { this.heartT = lerp(1.15, 0.36, this.fear); A.heartbeat(0.12 + this.fear * 0.55); }
    }
    this.growlT -= dt;
    if (this.growlT <= 0) {
      this.growlT = 7 + Math.random() * 12;
      if (md < 26 && !chase && st !== 'dormant') A.growl([this.mon.x, 2.1, this.mon.z], 0.5);
    }
    // first sight stinger
    if (los && md < 20 && !this.jumpscare) {
      const dx = this.mon.x - p.x, dz = this.mon.z - p.z;
      const dot = (dx * p.dir[0] + dz * p.dir[2]) / (md || 1);
      if (dot > 0.6) {
        if (this.time - this.lastMonSeen > 25 && st !== 'dormant') { A.stinger(0.6); p.trauma = Math.max(p.trauma, 0.4); }
        this.lastMonSeen = this.time;
      }
    }
    // nearest flickering lamp buzz
    let bl = null, bd = 7;
    for (const L of w.lamps) {
      if (L.mode === 'dead') continue;
      const d = Math.hypot(L.x - p.x, L.z - p.z);
      if (d < bd) { bd = d; bl = L; }
    }
    if (bl) A.setBuzz(bl.pos, bl.level * (bl.mode === 'flicker' ? 1 : 0.4)); else A.setBuzz([0, 0, 0], 0);
    A.setAlarm(this.powered && !this.ended);
    // rocking chairs
    this.creakT -= dt;
    if (this.creakT <= 0) {
      this.creakT = 1.9;
      for (const r of w.rockers) if (Math.hypot(r.x - p.x, r.z - p.z) < 9) { A.creak([r.x, 0.3, r.z], 0.08); break; }
    }
  }

  updateHud(dt) {
    const ui = this.app.ui, p = this.player;
    ui.tick(dt);
    let obj;
    const fz = Array.from({ length: 4 }, (_, i) => `<span class="fz ${i < this.fuses ? 'on' : ''}"></span>`).join('');
    if (this.powered) obj = '<span class="urgent">ESCAPE THROUGH THE EXIT GATE</span>';
    else if (this.fuses >= 4) obj = `${fz}<br>Restore power at the <b>generator</b>`;
    else obj = `${fz}<br>Find the fuses &mdash; ${this.fuses}/4`;
    ui.set('objective', obj);
    if (this.remotes.size) {
      let html = '';
      for (const r of this.roster) {
        const s = this.status.get(r.id);
        if (!s) continue;
        const c = PLAYER_COLORS[r.idx % 4].map((v) => Math.round(Math.min(1, v * 1.8) * 255)).join(',');
        const tag = s === 'down' ? '<span class="down">DOWN</span>' : s === 'escaped' ? '<span class="esc">ESCAPED</span>' : 'alive';
        html += `<div><span class="sw" style="background:rgb(${c})"></span>${r.id === this.localId ? 'You' : escapeHtml(r.name)} &middot; ${tag}</div>`;
      }
      ui.set('team', html);
    }
    ui.meters(p.battery, p.flOn, p.stamina);
    ui.breath(!!p.hidden && (this.monsterDist() < 8 || p.breath < 1), p.breath);
    this.hintT -= dt;
    if (this.hintT < 0 && this.hintT > -1) ui.hint('');
  }

  // =================================================================== render
  gatherLights(spot) {
    const p = this.player, w = this.world;
    const cand = [];
    for (const L of w.lamps) {
      if (L.level < 0.02) continue;
      const d = Math.hypot(L.x - p.eye[0], L.z - p.eye[2]);
      if (d > 26) continue;
      cand.push([d, L]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const pts = [];
    for (let i = 0; i < cand.length && pts.length < 6; i++) {
      const L = cand[i][1];
      const k = L.level * L.curBase;
      pts.push({ pos: L.pos, color: [L.curColor[0] * k, L.curColor[1] * k, L.curColor[2] * k], range: L.range, box: L.box });
    }
    if (spot) {
      // fake bounce light where the beam lands
      const d = spot.dir;
      let t = w.rayDist(spot.pos[0], spot.pos[2], d[0], d[2], 14) / Math.max(0.05, Math.hypot(d[0], d[2]));
      if (d[1] < -0.01) t = Math.min(t, spot.pos[1] / -d[1]);
      if (d[1] > 0.01) t = Math.min(t, (WALL_H - spot.pos[1]) / d[1]);
      t = Math.min(t, 14);
      const hx = spot.pos[0] + d[0] * (t - 0.45), hy = spot.pos[1] + d[1] * (t - 0.45), hz = spot.pos[2] + d[2] * (t - 0.45);
      const k = 0.11 * (spot.color[0] / FL_COLOR[0]) * clamp(1.4 - t / 12, 0.2, 1.2);
      pts.push({ pos: [hx, hy, hz], color: [k * 1.0, k * 0.92, k * 0.8], range: 5.5, box: this.cellBox(hx, hz) });
    }
    if (this.world.exitAnim > 0.05) {
      const ex = this.world.exit;
      const k = this.world.exitAnim * 3;
      pts.push({ pos: [ex.cx, 2, ex.cz], color: [0.6 * k, 0.75 * k, 1.0 * k], range: 10, box: this.cellBox(ex.cx - ex.dx * CELL, ex.cz - ex.dz * CELL) });
    }
    if (this.jumpscare) pts.unshift({ pos: [p.eye[0] + p.dir[0] * 0.25, p.eye[1] + 0.25, p.eye[2] + p.dir[2] * 0.25], color: [1.6, 0.4, 0.35], range: 3, box: [-1e4, -1e4, 1e4, 1e4] });
    return pts.slice(0, 8);
  }

  render() {
    const app = this.app, R = app.renderer, S = app.settings, mats = app.mats;
    const p = this.player, w = this.world;
    const aspect = R.canvas.width / R.canvas.height;
    mat4.perspective(this.proj, ((S.fov || 72) * Math.PI) / 180, aspect, 0.04, 70);
    const eye = p.eye, dir = p.dir;
    mat4.lookAt(this.view, eye, [eye[0] + dir[0], eye[1] + dir[1], eye[2] + dir[2]], p.up);
    mat4.multiply(this.vp, this.proj, this.view);
    let fi = p.flashlightIntensity();
    if (this.jumpscare) fi = Math.random() < 0.7 ? 0.8 : 0.1;
    let spot = null;
    if (fi > 0) {
      const sp = p.flashlightPos(), sd = p.fl;
      const up = Math.abs(sd[1]) > 0.97 ? [0, 0, 1] : [0, 1, 0];
      mat4.lookAt(this.spotV, sp, [sp[0] + sd[0], sp[1] + sd[1], sp[2] + sd[2]], up);
      mat4.perspective(this.spotP, SPOT_OUTER * 2 + 0.1, 1, 0.08, FL_RANGE);
      mat4.multiply(this.spotVP, this.spotP, this.spotV);
      spot = { on: true, pos: sp, dir: sd, color: [FL_COLOR[0] * fi, FL_COLOR[1] * fi, FL_COLOR[2] * fi], range: FL_RANGE, viewProj: this.spotVP };
    }
    const opaque = w.staticDraws.slice();
    const near = (x, z, r) => Math.abs(x - eye[0]) < r && Math.abs(z - eye[2]) < r;
    for (const d of w.doors) if (near(d.cx, d.cz, 30)) for (const part of w.models.door) opaque.push({ mesh: part.mesh, mat: part.mat, model: d.model, shadow: true });
    const tube = w.models.lampTube[0];
    for (const L of w.lamps) {
      if (!near(L.x, L.z, 30)) continue;
      const k = L.level * 5;
      opaque.push({ mesh: tube.mesh, mat: tube.mat, model: L.m, shadow: false, emissive: k > 0 ? [L.curColor[0] * k, L.curColor[1] * k, L.curColor[2] * k] : [0, 0, 0] });
    }
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 3);
    for (const it of w.items) {
      if (it.taken || !near(it.pos[0], it.pos[2], 26)) continue;
      const model = w.models[it.kind];
      for (const part of model) {
        const o = { mesh: part.mesh, mat: part.mat, model: it.m, shadow: true };
        if (part.mat === mats.fuse) o.emissive = [1.8 * pulse, 0.8 * pulse, 0.1 * pulse];
        opaque.push(o);
      }
    }
    for (let i = 0; i < w.genLamps.length; i++) {
      const gl = w.genLamps[i];
      const em = this.powered ? [0.2, 3, 0.4] : i < this.fuses ? [3, 1.4, 0.1] : [0.35, 0.02, 0.01];
      opaque.push({ mesh: w.models.genLamp[0].mesh, mat: w.models.genLamp[0].mat, model: gl.m, shadow: false, emissive: em });
    }
    for (const r of w.rockers) {
      if (!near(r.x, r.z, 25)) continue;
      const a = Math.sin(this.time * 1.7 + r.phase) * 0.17;
      mat4.compose(r.m, r.x, 1.0, r.z, a, r.yaw, 0);
      mat4.translate(r.m, r.m, 0, -1.0, 0);
      for (const part of w.models.rocker) opaque.push({ mesh: part.mesh, mat: part.mat, model: r.m, shadow: true });
    }
    for (const pm of w.exit.panels) for (const part of w.models.gate) opaque.push({ mesh: part.mesh, mat: part.mat, model: pm, shadow: true });
    if (near(this.monsterModel.x, this.monsterModel.z, 45) || this.jumpscare) this.monsterModel.pushDraws(opaque, 1);
    const rspots = [];
    const beams = [];
    for (const [id, r] of this.remotes) {
      const s = this.status.get(id);
      if (!s || s === 'escaped' || r.hid >= 0) continue;
      r.avatar.pushDraws(opaque, r.fl && s === 'alive');
      if (r.fl && s === 'alive') {
        const hp = r.avatar.handWorld();
        const cp = Math.cos(r.pitch);
        const dd = [Math.sin(r.yaw) * cp, Math.sin(r.pitch), Math.cos(r.yaw) * cp];
        rspots.push({ pos: hp, dir: dd, color: [FL_COLOR[0] * 0.75, FL_COLOR[1] * 0.75, FL_COLOR[2] * 0.75], box: this.cellBox(hp[0], hp[2]) });
        beams.push({ mesh: this.beamMesh, model: this.beamMatrix(hp, dd, mat4.create()), color: [1, 0.92, 0.78], intensity: 0.05 });
      }
    }
    this.scares.pushDraws(opaque);
    if (spot && !p.hidden) beams.push({ mesh: this.beamMesh, model: this.beamMatrix(spot.pos, spot.dir, this.beamM), color: [1, 0.92, 0.78], intensity: 0.045 * fi });
    const fear = this.fear;
    const S_b = S.brightness || 1;
    const amb = this.powered ? [0.022, 0.006, 0.006] : [0.011, 0.012, 0.016];
    const j = this.jumpscare;
    R.render({
      viewProj: this.vp,
      camPos: eye,
      ambient: amb.map((v) => v * S_b),
      fogColor: this.powered ? [0.012, 0.002, 0.002] : [0.003, 0.0035, 0.005],
      fogDensity: 0.072,
      spot,
      spotCone: [Math.cos(SPOT_OUTER), Math.cos(SPOT_INNER)],
      cookie: mats.cookie,
      rspots,
      points: this.gatherLights(spot),
      opaque,
      decals: w.decalDraws,
      beams,
      dust: spot ? { mesh: this.dust.mesh, size: this.dust.size, intensity: fi } : null,
      time: this.time,
      drawDist: 42,
      post: {
        exposure: 1.3 * S_b,
        bloom: 0.6,
        ca: 0.3 + fear * 1.7 + (j ? 2.5 : 0),
        grain: 0.075 + fear * 0.05,
        vignette: 0.25 + fear * 0.6 + (p.hidden ? 0.4 : 0),
        red: Math.min(1, this.redFlash + (p.downed ? 0.6 : 0) + (this.powered ? 0.08 : 0)),
        fade: this.fade,
        distort: Math.max(0, fear - 0.55) * 1.4 + (j ? 1.6 : 0),
        gamma: 1 / S_b,
        desat: 0.32,
        flash: this.flash * 0.6,
      },
    });
  }

  beamMatrix(pos, dir, out) {
    const up = Math.abs(dir[1]) > 0.97 ? [0, 0, 1] : [0, 1, 0];
    mat4.lookAt(this.tmpM, pos, [pos[0] + dir[0], pos[1] + dir[1], pos[2] + dir[2]], up);
    mat4.invert(out, this.tmpM);
    const len = 7.5, r = Math.tan(SPOT_OUTER * 0.75) * len;
    mat4.scale(out, out, r, r, len);
    return out;
  }

  // =================================================================== end
  endGame(result, st) {
    if (this.ended) return;
    this.ended = true;
    if (st) for (const k in st) this.status.set(k, st[k]);
    if (this.jumpscare) { this.pendingEnd = { result, st }; return; }
    this.showEnd(result, st);
  }
  showEnd(result, st) {
    this.ended = true;
    const app = this.app;
    app.audio.setAlarm(false);
    app.audio.setFear(0, 0);
    app.ui.show('down-overlay', false);
    app.ui.show('escaped-overlay', false);
    app.ui.show('locker-overlay', false);
    app.onGameEnd(result, this.summary(result));
  }
  summary(result) {
    const secs = Math.round(this.time);
    const lines = [];
    lines.push(`Time inside: ${Math.floor(secs / 60)}m ${secs % 60}s`);
    lines.push(`Fuses recovered: ${this.fuses}/4`);
    lines.push(`Notes read: ${this.stats.notes.size}/${NOTES.length}`);
    if (this.roster.length > 1) for (const r of this.roster) {
      const s = this.status.get(r.id);
      lines.push(`${r.id === this.localId ? 'You' : escapeHtml(r.name)} &mdash; ${s === 'escaped' ? 'ESCAPED' : s === 'down' ? 'TAKEN' : s ? 'LEFT BEHIND' : 'DISCONNECTED'}`);
    }
    return { result, lines };
  }

  destroy() {
    const R = this.app.renderer;
    this.world.destroy();
    R.deleteMesh(this.beamMesh);
    this.app.audio.stopAll();
    this.app.ui.hud(false);
    this.app.ui.hideNote();
    for (const id of ['down-overlay', 'escaped-overlay', 'locker-overlay', 'intro']) this.app.ui.show(id, false);
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
