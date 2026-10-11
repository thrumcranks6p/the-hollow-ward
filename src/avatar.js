// Remote co-op player avatars (procedural humanoid holding a flashlight).
import { MeshData, box, cylinder, sphere, M } from './gl/geometry.js';
import { mat4, clamp, damp } from './math.js';

export const PLAYER_COLORS = [
  [0.55, 0.3, 0.12],
  [0.15, 0.3, 0.55],
  [0.2, 0.45, 0.22],
  [0.45, 0.2, 0.45],
];

function part(R, mats, fn) {
  const parts = new Map();
  const get = (m) => { if (!parts.has(m)) parts.set(m, new MeshData()); return parts.get(m); };
  fn({
    box: (m, x, y, z, sx, sy, sz, c, rx = 0, ry = 0, rz = 0) => box(get(m), M(x, y, z, sx, sy, sz, rx, ry, rz), c, 2),
    cyl: (m, x, y, z, d, h, c, rx = 0, ry = 0, rz = 0) => cylinder(get(m), M(x, y, z, d, h, d, rx, ry, rz), 8, c),
    sph: (m, x, y, z, sx, sy, sz, c) => sphere(get(m), M(x, y, z, sx, sy, sz), 10, 7, c),
  });
  return [...parts].map(([m, md]) => ({ mesh: R.createMesh(md), mat: mats[m], matName: m }));
}

export class Avatar {
  constructor(R, mats, colorIdx) {
    const jc = PLAYER_COLORS[colorIdx % PLAYER_COLORS.length];
    const pants = [0.18, 0.18, 0.2], skin = [0.85, 0.68, 0.58], hair = [0.12, 0.08, 0.05];
    this.parts = [];
    const P = (name, parent, off, fn) => {
      const p = { name, parent, off, rot: [0, 0, 0], tgt: [0, 0, 0], world: mat4.create(), local: mat4.create(), meshes: fn ? part(R, mats, fn) : [] };
      this.parts.push(p);
      this[name] = p;
      return this.parts.length - 1;
    };
    const root = P('root', -1, [0, 0, 0]);
    const hips = P('hips', root, [0, 0.95, 0], (a) => a.box('fabric', 0, 0, 0, 0.34, 0.18, 0.2, pants));
    const torso = P('torso', hips, [0, 0.08, 0], (a) => {
      a.box('fabric', 0, 0.28, 0, 0.42, 0.56, 0.24, jc);
      a.box('fabric', 0, 0.52, -0.02, 0.46, 0.12, 0.26, jc);
      a.box('fabric', 0, 0.3, -0.14, 0.3, 0.38, 0.08, [jc[0] * 0.6, jc[1] * 0.6, jc[2] * 0.6]);
    });
    P('head', torso, [0, 0.62, 0], (a) => {
      a.cyl('skin', 0, 0.05, 0, 0.1, 0.12, skin);
      a.sph('skin', 0, 0.2, 0.01, 0.21, 0.25, 0.23, skin);
      a.sph('fabric', 0, 0.26, -0.02, 0.23, 0.18, 0.24, hair);
      a.sph('black', -0.045, 0.21, 0.11, 0.03, 0.025, 0.02, [1, 1, 1]);
      a.sph('black', 0.045, 0.21, 0.11, 0.03, 0.025, 0.02, [1, 1, 1]);
    });
    for (const s of [-1, 1]) {
      const n = s < 0 ? 'L' : 'R';
      const sh = P('arm' + n, torso, [s * 0.26, 0.5, 0], (a) => a.cyl('fabric', 0, -0.17, 0, 0.1, 0.34, jc));
      const fa = P('fore' + n, sh, [0, -0.34, 0], (a) => {
        a.cyl('fabric', 0, -0.14, 0, 0.085, 0.28, jc);
        a.sph('skin', 0, -0.32, 0, 0.08, 0.1, 0.06, skin);
        if (s > 0) {
          a.cyl('metal', 0, -0.33, 0.08, 0.05, 0.2, [0.15, 0.15, 0.15], Math.PI / 2, 0, 0);
          a.cyl('lampTube', 0, -0.33, 0.185, 0.055, 0.01, [1, 1, 1], Math.PI / 2, 0, 0);
        }
      });
      void fa;
      const th = P('thigh' + n, hips, [s * 0.1, -0.05, 0], (a) => a.cyl('fabric', 0, -0.22, 0, 0.13, 0.44, pants));
      P('shin' + n, th, [0, -0.44, 0], (a) => {
        a.cyl('fabric', 0, -0.2, 0, 0.11, 0.4, pants);
        a.box('black', 0, -0.42, 0.04, 0.1, 0.07, 0.24, [1, 1, 1]);
      });
    }
    this.phase = 0;
    this.x = 0; this.y = 0; this.z = 0; this.yaw = 0; this.pitch = 0;
    this.down = 0;
    this.crouch = 0;
  }

  animate(dt, speed, pitch, crouch, downed) {
    this.phase += dt * speed * 3.4;
    const sw = Math.sin(this.phase);
    const amp = clamp(speed / 2.5, 0, 1.2);
    this.crouch = damp(this.crouch, crouch ? 1 : 0, 10, dt);
    this.down = damp(this.down, downed ? 1 : 0, 6, dt);
    const set = (p, x, y, z) => { p.tgt[0] = x; p.tgt[1] = y; p.tgt[2] = z; };
    set(this.thighL, -sw * 0.6 * amp - this.crouch * 1.2, 0, 0);
    set(this.thighR, sw * 0.6 * amp - this.crouch * 1.2, 0, 0);
    set(this.shinL, Math.max(0, Math.sin(this.phase - 1.3)) * 0.9 * amp + this.crouch * 1.8, 0, 0);
    set(this.shinR, Math.max(0, Math.sin(this.phase + Math.PI - 1.3)) * 0.9 * amp + this.crouch * 1.8, 0, 0);
    set(this.torso, this.crouch * 0.45, 0, 0);
    set(this.head, -pitch * 0.6 - this.crouch * 0.4, 0, 0);
    set(this.armL, sw * 0.5 * amp, 0, -0.08);
    set(this.foreL, -0.3, 0, 0);
    set(this.armR, -1.25 - pitch * 0.9 - this.crouch * 0.4, 0, 0.1);
    set(this.foreR, -0.25, 0, 0);
    if (downed) {
      set(this.armL, -2.6, 0, -0.3);
      set(this.armR, -2.4, 0, 0.3);
      set(this.thighL, 0.1, 0, 0);
      set(this.thighR, -0.2, 0, 0);
      set(this.shinL, 0.3, 0, 0);
      set(this.shinR, 0.6, 0, 0);
      set(this.head, 0.2, 0.6, 0);
    }
    for (const p of this.parts) for (let i = 0; i < 3; i++) p.rot[i] = damp(p.rot[i], p.tgt[i], 14, dt);
    this.bob = -Math.abs(Math.cos(this.phase)) * 0.04 * amp - this.crouch * 0.4;
  }

  computeMatrices() {
    for (const p of this.parts) {
      if (p.parent < 0) {
        mat4.compose(p.world, this.x, this.y + (this.bob || 0) * (1 - this.down) + this.down * 0.15, this.z, -this.down * 1.5, this.yaw, 0);
        continue;
      }
      mat4.compose(p.local, p.off[0], p.off[1], p.off[2], p.rot[0], p.rot[1], p.rot[2]);
      mat4.multiply(p.world, this.parts[p.parent].world, p.local);
    }
  }

  handWorld() {
    return mat4.transformPoint(this.foreR.world, 0, -0.33, 0.2);
  }

  pushDraws(list, flOn) {
    for (const p of this.parts)
      for (const m of p.meshes) {
        const it = { mesh: m.mesh, mat: m.mat, model: p.world, shadow: true };
        if (m.matName === 'lampTube') it.emissive = flOn ? [6, 5.6, 4.6] : [0, 0, 0];
        list.push(it);
      }
  }
}
