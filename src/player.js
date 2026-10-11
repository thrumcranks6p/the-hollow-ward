// First-person controller: movement, stamina, crouch, head-bob, flashlight sway, hiding, breath.
import { clamp, lerp, damp, angleDiff } from './math.js';
import { CELL } from './world/mapgen.js';

export const WALK = 2.5, SPRINT = 4.75, CROUCH = 1.25;

export class Player {
  constructor(world, x, z, yaw = 0) {
    this.w = world;
    this.x = x; this.z = z;
    this.yaw = yaw; this.pitch = 0;
    this.vx = 0; this.vz = 0;
    this.crouch = 0;
    this.crouching = false;
    this.stamina = 1;
    this.exhausted = false;
    this.staminaDelay = 0;
    this.battery = 1;
    this.flOn = true;
    this.flFlicker = 0;
    this.hidden = null;
    this.downed = false;
    this.escaped = false;
    this.bobPhase = 0;
    this.bobAmt = 0;
    this.trauma = 0;
    this.breath = 1;
    this.holding = false;
    this.speed = 0;
    this.sprinting = false;
    this.fl = [Math.sin(yaw), 0, Math.cos(yaw)];
    this.lastStepSide = 0;
    this.eye = [x, 1.62, z];
    this.dir = [0, 0, 1];
    this.right = [1, 0, 0];
    this.up = [0, 1, 0];
    this.roll = 0;
    this.invuln = 0;
    this.time = 0;
    this.lookYaw = 0;
  }

  forward() { return [Math.sin(this.yaw), 0, Math.cos(this.yaw)]; }

  update(dt, input, settings, frozen) {
    const ev = { steps: [], gasp: false, flToggled: false };
    this.time += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    const sens = 0.0022 * (settings.sens || 1);
    if (!frozen) {
      this.yaw -= input.dx * sens;
      this.pitch -= input.dy * sens * (settings.invertY ? -1 : 1);
      if (settings.keyLook) {
        if (input.down('ArrowLeft')) this.yaw += dt * 2.2;
        if (input.down('ArrowRight')) this.yaw -= dt * 2.2;
        if (input.down('ArrowUp')) this.pitch += dt * 1.5;
        if (input.down('ArrowDown')) this.pitch -= dt * 1.5;
      }
    }
    this.pitch = clamp(this.pitch, -1.45, 1.45);

    if (this.hidden) {
      const ly = this.hidden.yaw;
      const d = angleDiff(ly, this.yaw);
      if (Math.abs(d) > 0.55) this.yaw = ly + Math.sign(d) * 0.55;
      this.pitch = clamp(this.pitch, -0.4, 0.3);
      this.x = this.hidden.x; this.z = this.hidden.z;
      this.vx = this.vz = 0;
      this.speed = 0;
      // breath holding
      this.holding = !frozen && input.down('Space') && this.breath > 0;
      if (this.holding) {
        this.breath -= dt / 7;
        if (this.breath <= 0) { this.breath = 0; this.holding = false; ev.gasp = true; }
      } else this.breath = Math.min(1, this.breath + dt / 4);
      this.flOn = false;
    } else if (this.downed || this.escaped) {
      this.vx = this.vz = 0;
      this.speed = 0;
      this.pitch = clamp(this.pitch, -0.6, 0.9);
      this.breath = 1;
      this.holding = false;
    } else {
      this.holding = false;
      this.breath = Math.min(1, this.breath + dt / 4);
      let mx = 0, mz = 0;
      if (!frozen) {
        if (input.down('KeyW')) mz += 1;
        if (input.down('KeyS')) mz -= 1;
        if (input.down('KeyA')) mx -= 1;
        if (input.down('KeyD')) mx += 1;
        if (input.hit('KeyC') || input.hit('ControlLeft')) this.crouching = !this.crouching;
        if (input.hit('KeyF') || input.hit('Mouse2')) {
          if (this.battery > 0) { this.flOn = !this.flOn; ev.flToggled = true; }
        }
      }
      const wantSprint = !frozen && (input.down('ShiftLeft') || input.down('ShiftRight'));
      const moving = mx !== 0 || mz !== 0;
      if (wantSprint && moving && this.crouching) this.crouching = false;
      const canSprint = wantSprint && moving && mz > 0 && !this.exhausted && this.crouch < 0.5;
      this.sprinting = canSprint;
      if (canSprint) {
        this.stamina -= dt / 6.5;
        this.staminaDelay = 1.1;
        if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; }
      } else {
        this.staminaDelay -= dt;
        if (this.staminaDelay <= 0) this.stamina = Math.min(1, this.stamina + dt / (this.exhausted ? 7 : 5));
        if (this.exhausted && this.stamina > 0.4) this.exhausted = false;
      }
      this.crouch = damp(this.crouch, this.crouching ? 1 : 0, 9, dt);
      let sp = canSprint ? SPRINT : this.crouching ? CROUCH : WALK;
      if (this.exhausted) sp = Math.min(sp, 2.0);
      const l = Math.hypot(mx, mz) || 1;
      const f = this.forward();
      const rgt = [-Math.cos(this.yaw), 0, Math.sin(this.yaw)];
      const dxw = (f[0] * mz + rgt[0] * mx) / l * sp;
      const dzw = (f[2] * mz + rgt[2] * mx) / l * sp;
      this.vx = damp(this.vx, dxw, moving ? 9 : 12, dt);
      this.vz = damp(this.vz, dzw, moving ? 9 : 12, dt);
      const ox = this.x, oz = this.z;
      const p = [this.x + this.vx * dt, this.z + this.vz * dt];
      this.w.collide(p, 0.3);
      this.x = p[0]; this.z = p[1];
      const moved = Math.hypot(this.x - ox, this.z - oz);
      this.speed = moved / Math.max(dt, 1e-4);
      const stepLen = canSprint ? 1.05 : this.crouching ? 0.55 : 0.78;
      const prev = this.bobPhase;
      this.bobPhase += (moved / stepLen) * Math.PI;
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI) && this.speed > 0.4) {
        const r = canSprint ? 14 : this.crouching ? 1.5 : 6.5;
        ev.steps.push({ radius: r, vol: canSprint ? 0.45 : this.crouching ? 0.1 : 0.27 });
      }
      this.bobAmt = damp(this.bobAmt, clamp(this.speed / WALK, 0, 1.6), 8, dt);
    }

    // battery
    if (this.flOn) {
      this.battery = Math.max(0, this.battery - dt / 270);
      if (this.battery <= 0) { this.flOn = false; ev.flToggled = true; }
    }
    this.flFlicker = Math.max(0, this.flFlicker - dt);

    // camera
    this.trauma = Math.max(0, this.trauma - dt * 0.9);
    const shake = this.trauma * this.trauma;
    const t = this.time;
    const sy = Math.sin(t * 37.1) * 0.03 * shake + Math.sin(t * 61.7) * 0.015 * shake;
    const sp = Math.cos(t * 41.3) * 0.03 * shake;
    const yaw = this.yaw + sy, pitch = this.pitch + sp;
    let eyeH = lerp(1.62, 0.95, this.crouch);
    if (this.downed) eyeH = 0.28;
    if (this.hidden) eyeH = 1.55;
    const bobY = Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmt;
    const bobX = Math.sin(this.bobPhase) * 0.03 * this.bobAmt;
    const rgt = [-Math.cos(yaw), 0, Math.sin(yaw)];
    this.right = rgt;
    this.eye = [this.x + rgt[0] * bobX, eyeH + bobY, this.z + rgt[2] * bobX];
    const cp = Math.cos(pitch);
    this.dir = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
    this.roll = damp(this.roll, this.downed ? 0.5 : Math.sin(this.bobPhase) * 0.006 * this.bobAmt + (this.hidden ? 0 : 0), 4, dt);
    const up0 = [0, 1, 0];
    // up vector = rotate world up around dir by roll (approx with right)
    this.up = [up0[0] * Math.cos(this.roll) + rgt[0] * Math.sin(this.roll), Math.cos(this.roll), up0[2] * Math.cos(this.roll) + rgt[2] * Math.sin(this.roll)];
    // flashlight lag
    const k = 1 - Math.exp(-13 * dt);
    const swayX = Math.sin(this.bobPhase) * 0.02 * this.bobAmt, swayY = Math.sin(this.bobPhase * 2) * 0.015 * this.bobAmt;
    const target = [this.dir[0] + rgt[0] * swayX, this.dir[1] + swayY, this.dir[2] + rgt[2] * swayX];
    for (let i = 0; i < 3; i++) this.fl[i] += (target[i] - this.fl[i]) * k;
    const l = Math.hypot(...this.fl);
    for (let i = 0; i < 3; i++) this.fl[i] /= l;
    return ev;
  }

  flashlightIntensity() {
    if (!this.flOn) return 0;
    let k = 1;
    if (this.battery < 0.2) k *= 0.45 + this.battery * 2.75;
    if (this.battery < 0.12 && Math.random() < 0.08) k *= 0.2;
    if (this.flFlicker > 0) k *= Math.random() < 0.5 ? 0.05 : 0.7;
    return k;
  }

  flashlightPos() {
    const r = this.right;
    return [this.eye[0] + r[0] * 0.17 + this.dir[0] * 0.15, this.eye[1] - 0.17, this.eye[2] + r[2] * 0.17 + this.dir[2] * 0.15];
  }

  cell() { return [Math.floor(this.x / CELL), Math.floor(this.z / CELL)]; }
}
