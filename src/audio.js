// Fully procedural, binaural (HRTF) horror sound engine — every sound is synthesized live.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volume = 0.8;
    this.loops = {};
  }

  init() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.3;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeIR(3.4, 2.6);
    this.revGain = ctx.createGain();
    this.revGain.gain.value = 0.6;
    this.reverb.connect(this.revGain);
    this.revGain.connect(this.master);
    this.sfx = this.bus(1);
    this.amb = this.bus(0.9);
    this.mus = this.bus(0.9);
    this.noise = this.makeNoise(3, 'white');
    this.brown = this.makeNoise(4, 'brown');
    this.curve = this.makeCurve(60);
    this.enabled = true;
  }
  bus(v) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    g.connect(this.master);
    return g;
  }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  get t() { return this.ctx.currentTime; }

  makeIR(sec, decay) {
    const rate = this.ctx.sampleRate, len = Math.floor(rate * sec);
    const b = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < rate * 0.01 ? i / (rate * 0.01) : 1);
      }
    }
    return b;
  }
  makeNoise(sec, kind) {
    const rate = this.ctx.sampleRate, len = Math.floor(rate * sec);
    const b = this.ctx.createBuffer(1, len, rate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  makeCurve(k) {
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x)); }
    return c;
  }

  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos[0]; l.positionY.value = pos[1]; l.positionZ.value = pos[2];
      l.forwardX.value = fwd[0]; l.forwardY.value = fwd[1]; l.forwardZ.value = fwd[2];
      l.upX.value = up[0]; l.upY.value = up[1]; l.upZ.value = up[2];
    } else {
      l.setPosition(pos[0], pos[1], pos[2]);
      l.setOrientation(fwd[0], fwd[1], fwd[2], up[0], up[1], up[2]);
    }
  }

  panner(pos, ref = 1.5, roll = 1.2) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = 100;
    p.rolloffFactor = roll;
    this.setPos(p, pos);
    return p;
  }
  setPos(p, pos) {
    if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; }
    else p.setPosition(pos[0], pos[1], pos[2]);
  }
  // route node -> (panner) -> bus + reverb send
  out(node, pos, { rev = 0.35, gain = 1, ref = 1.5, roll = 1.2, bus = null } = {}) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    node.connect(g);
    let last = g;
    if (pos) { const p = this.panner(pos, ref, roll); g.connect(p); last = p; }
    last.connect(bus || this.sfx);
    if (rev > 0) { const s = this.ctx.createGain(); s.gain.value = rev; last.connect(s); s.connect(this.reverb); }
    return g;
  }
  osc(type, f, t0, t1) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    o.start(t0);
    o.stop(t1 + 0.05);
    return o;
  }
  noiseSrc(t0, dur, buf = this.noise) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(t0, Math.random() * (buf.duration - 0.5));
    s.stop(t0 + dur + 0.05);
    return s;
  }
  filt(type, f, Q = 1) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = Q;
    return b;
  }
  envGain(t0, a, peak, d, hold = 0) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
    if (hold) g.gain.setValueAtTime(Math.max(peak, 0.0002), t0 + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + hold + d);
    return g;
  }
  chain(...n) { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; }

  // ------------------------------------------------------------------ one-shots
  footstep(pos, kind = 'player', surface = 'floor', vol = 0.3) {
    if (!this.enabled) return;
    const t = this.t + 0.005;
    if (kind === 'monster') {
      const o = this.osc('sine', 60, t, t + 0.3);
      o.frequency.exponentialRampToValueAtTime(30, t + 0.25);
      this.out(this.chain(o, this.envGain(t, 0.005, 0.9 * vol, 0.25)), pos, { ref: 3, roll: 1, rev: 0.5 });
      const n = this.noiseSrc(t, 0.2);
      this.out(this.chain(n, this.filt('lowpass', 500), this.envGain(t, 0.005, 0.5 * vol, 0.15)), pos, { ref: 3, roll: 1, rev: 0.4 });
      const c = this.noiseSrc(t + 0.06, 0.05);
      this.out(this.chain(c, this.filt('highpass', 3500), this.envGain(t + 0.06, 0.002, 0.25 * vol, 0.03)), pos, { ref: 2, roll: 1.2, rev: 0.3 });
      return;
    }
    const f = { floor: 900, floorTile: 1700, woodFloor: 520, concreteFloor: 1200 }[surface] || 900;
    const n = this.noiseSrc(t, 0.12);
    const bp = this.filt('bandpass', f * (0.85 + Math.random() * 0.3), 1.4);
    this.out(this.chain(n, bp, this.envGain(t, 0.004, vol, 0.08)), pos, { rev: 0.25, ref: 1.2, roll: 1.4 });
    const o = this.osc('sine', 95, t, t + 0.1);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    this.out(this.chain(o, this.envGain(t, 0.004, vol * 0.6, 0.07)), pos, { rev: 0.1 });
  }

  heartbeat(vol) {
    if (!this.enabled || vol < 0.02) return;
    const t = this.t + 0.01;
    for (const [dt, k] of [[0, 1], [0.17, 0.7]]) {
      const o = this.osc('sine', 62, t + dt, t + dt + 0.2);
      o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.15);
      this.out(this.chain(o, this.filt('lowpass', 150), this.envGain(t + dt, 0.01, vol * k * 1.4, 0.16)), null, { rev: 0 });
    }
  }

  breath(vol, inhale = true) {
    if (!this.enabled) return;
    const t = this.t + 0.01, d = inhale ? 0.55 : 0.75;
    const n = this.noiseSrc(t, d);
    const bp = this.filt('bandpass', inhale ? 1500 : 900, 0.8);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + d * 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + d);
    this.out(this.chain(n, bp, g), null, { rev: 0.05 });
  }

  creak(pos, vol = 0.5) {
    if (!this.enabled) return;
    const t = this.t + 0.01, d = 0.7 + Math.random() * 0.5;
    const o = this.osc('sawtooth', 90 + Math.random() * 40, t, t + d);
    o.frequency.linearRampToValueAtTime(140 + Math.random() * 60, t + d);
    const bp = this.filt('bandpass', 500, 9);
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.linearRampToValueAtTime(900 + Math.random() * 500, t + d);
    const g = this.envGain(t, 0.08, vol, d, 0);
    const lfo = this.osc('square', 16 + Math.random() * 10, t, t + d);
    const lg = this.ctx.createGain();
    lg.gain.value = 0.5;
    lfo.connect(lg);
    lg.connect(g.gain);
    this.out(this.chain(o, bp, g), pos, { rev: 0.5, ref: 2 });
    this.click(pos, 0.3, t);
  }
  click(pos, vol, t = this.t) {
    const n = this.noiseSrc(t, 0.04);
    this.out(this.chain(n, this.filt('bandpass', 2500, 3), this.envGain(t, 0.001, vol, 0.03)), pos, { rev: 0.2, ref: 1.5 });
  }
  thud(pos, vol, f = 80, rev = 0.5, t = this.t + 0.005) {
    const o = this.osc('sine', f, t, t + 0.4);
    o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.3);
    this.out(this.chain(o, this.envGain(t, 0.004, vol, 0.3)), pos, { rev, ref: 2.5, roll: 1 });
    const n = this.noiseSrc(t, 0.25);
    this.out(this.chain(n, this.filt('lowpass', 700), this.envGain(t, 0.003, vol * 0.7, 0.2)), pos, { rev, ref: 2.5, roll: 1 });
  }
  doorClose(pos) { if (!this.enabled) return; this.creak(pos, 0.25); this.thud(pos, 0.7, 90, 0.5, this.t + 0.45); this.click(pos, 0.4, this.t + 0.47); }
  doorOpen(pos) { if (!this.enabled) return; this.click(pos, 0.4); this.creak(pos, 0.45); }
  doorBash(pos) {
    if (!this.enabled) return;
    const t = this.t + 0.005;
    this.thud(pos, 1.4, 70, 0.8, t);
    for (const f of [183, 412, 655]) {
      const o = this.osc('triangle', f, t, t + 0.8);
      this.out(this.chain(o, this.envGain(t, 0.002, 0.18, 0.7)), pos, { rev: 0.6, ref: 3, roll: 1 });
    }
    this.creak(pos, 0.3);
  }
  slam(pos) { if (!this.enabled) return; this.thud(pos, 1.3, 75, 1.0); this.click(pos, 0.5); }
  knock(pos, n = 3) {
    if (!this.enabled) return;
    for (let i = 0; i < n; i++) this.thud(pos, 0.6, 130, 0.6, this.t + 0.05 + i * (0.32 + Math.random() * 0.08));
  }
  metal(pos, vol = 0.4) {
    if (!this.enabled) return;
    const t = this.t + 0.005;
    for (const f of [320, 742, 1210]) {
      const o = this.osc('square', f * (0.95 + Math.random() * 0.1), t, t + 0.3);
      this.out(this.chain(o, this.filt('bandpass', f, 6), this.envGain(t, 0.002, vol * 0.25, 0.25)), pos, { rev: 0.4 });
    }
    this.click(pos, vol, t);
  }
  chime(freqs = [880, 1320], vol = 0.15, dur = 0.6) {
    if (!this.enabled) return;
    const t = this.t + 0.01;
    freqs.forEach((f, i) => {
      const o = this.osc('sine', f, t + i * 0.08, t + i * 0.08 + dur);
      this.out(this.chain(o, this.envGain(t + i * 0.08, 0.005, vol, dur)), null, { rev: 0.3 });
    });
  }
  paper() {
    if (!this.enabled) return;
    const t = this.t + 0.01;
    for (let i = 0; i < 4; i++) {
      const n = this.noiseSrc(t + i * 0.06, 0.1);
      this.out(this.chain(n, this.filt('highpass', 2500 + Math.random() * 2000), this.envGain(t + i * 0.06, 0.005, 0.12, 0.07)), null, { rev: 0.1 });
    }
  }
  flashClick() { if (this.enabled) this.click(null, 0.25); }
  glassBurst(pos) {
    if (!this.enabled) return;
    const t = this.t + 0.005;
    const n = this.noiseSrc(t, 0.4);
    this.out(this.chain(n, this.filt('highpass', 3000), this.envGain(t, 0.002, 0.6, 0.35)), pos, { rev: 0.6, ref: 2 });
    for (let i = 0; i < 6; i++) {
      const o = this.osc('sine', 3000 + Math.random() * 4000, t + i * 0.04, t + i * 0.04 + 0.2);
      this.out(this.chain(o, this.envGain(t + i * 0.04, 0.001, 0.08, 0.18)), pos, { rev: 0.5 });
    }
  }

  stinger(vol = 0.6) {
    if (!this.enabled) return;
    const t = this.t + 0.01;
    const boom = this.osc('sine', 48, t, t + 2.5);
    boom.frequency.exponentialRampToValueAtTime(28, t + 2.2);
    this.out(this.chain(boom, this.envGain(t, 0.01, vol * 1.3, 2.2)), null, { rev: 0.5 });
    const base = 220 + Math.random() * 40;
    for (const k of [1, 1.06, 1.33, 2.0, 2.12, 2.83]) {
      const o = this.osc('sawtooth', base * k, t, t + 2.6);
      const v = this.osc('sine', 5 + Math.random() * 3, t, t + 2.6);
      const vg = this.ctx.createGain();
      vg.gain.value = base * k * 0.012;
      v.connect(vg); vg.connect(o.frequency);
      this.out(this.chain(o, this.filt('lowpass', 2600), this.envGain(t, 0.015, vol * 0.08, 2.4)), null, { rev: 0.8, bus: this.mus });
    }
    const s = this.osc('sawtooth', 1700, t, t + 1.4);
    s.frequency.linearRampToValueAtTime(2500, t + 1.3);
    this.out(this.chain(s, this.filt('bandpass', 2200, 4), this.envGain(t, 0.02, vol * 0.18, 1.3)), null, { rev: 0.7, bus: this.mus });
  }

  screech(vol = 1) {
    if (!this.enabled) return;
    const t = this.t + 0.005;
    const ws = this.ctx.createWaveShaper();
    ws.curve = this.curve;
    const g = this.envGain(t, 0.01, vol * 0.9, 1.7, 0.4);
    ws.connect(g);
    this.out(g, null, { rev: 0.4 });
    for (let i = 0; i < 7; i++) {
      const f = 500 + Math.random() * 1300;
      const o = this.osc(i % 2 ? 'sawtooth' : 'square', f, t, t + 2.2);
      o.frequency.linearRampToValueAtTime(f * (1.3 + Math.random() * 0.4), t + 0.6);
      o.frequency.linearRampToValueAtTime(f * 0.7, t + 2.0);
      const l = this.osc('sine', 18 + Math.random() * 14, t, t + 2.2);
      const lg = this.ctx.createGain();
      lg.gain.value = f * 0.08;
      l.connect(lg); lg.connect(o.frequency);
      const og = this.ctx.createGain();
      og.gain.value = 0.12;
      o.connect(og); og.connect(ws);
    }
    const n = this.noiseSrc(t, 2);
    const ng = this.ctx.createGain();
    ng.gain.value = 0.5;
    this.chain(n, this.filt('bandpass', 2600, 1.2), ng, ws);
    const boom = this.osc('sine', 55, t, t + 2);
    boom.frequency.exponentialRampToValueAtTime(25, t + 1.8);
    this.out(this.chain(boom, this.envGain(t, 0.005, vol * 1.5, 1.8)), null, { rev: 0.3 });
  }

  monsterScream(pos, vol = 1) {
    if (!this.enabled) return;
    const t = this.t + 0.01, d = 1.5 + Math.random() * 0.5;
    const ws = this.ctx.createWaveShaper();
    ws.curve = this.curve;
    const g = this.envGain(t, 0.05, vol * 0.8, d * 0.7, d * 0.3);
    this.chain(ws, this.filt('bandpass', 1100, 0.9), g);
    this.out(g, pos, { rev: 0.8, ref: 5, roll: 0.8 });
    for (const k of [1, 1.5, 2.02]) {
      const o = this.osc('sawtooth', 260 * k, t, t + d);
      o.frequency.linearRampToValueAtTime(520 * k, t + 0.3);
      o.frequency.linearRampToValueAtTime(330 * k, t + d);
      const l = this.osc('sine', 11, t, t + d);
      const lg = this.ctx.createGain();
      lg.gain.value = 30 * k;
      l.connect(lg); lg.connect(o.frequency);
      const og = this.ctx.createGain();
      og.gain.value = 0.2;
      o.connect(og); og.connect(ws);
    }
    const n = this.noiseSrc(t, d);
    const ng = this.ctx.createGain();
    ng.gain.value = 0.4;
    this.chain(n, this.filt('bandpass', 1800, 1), ng, ws);
  }

  growl(pos, vol = 0.6) {
    if (!this.enabled) return;
    const t = this.t + 0.01, d = 1.2 + Math.random() * 1.2;
    const ws = this.ctx.createWaveShaper();
    ws.curve = this.curve;
    const g = this.envGain(t, 0.2, vol, d * 0.6, d * 0.3);
    this.chain(ws, this.filt('lowpass', 700), g);
    this.out(g, pos, { rev: 0.6, ref: 2.5, roll: 1.1 });
    for (const f of [62, 66.5, 124]) {
      const o = this.osc('sawtooth', f, t, t + d);
      const og = this.ctx.createGain();
      og.gain.value = 0.25;
      const am = this.osc('sine', 7 + Math.random() * 6, t, t + d);
      const amg = this.ctx.createGain();
      amg.gain.value = 0.15;
      am.connect(amg); amg.connect(og.gain);
      o.connect(og); og.connect(ws);
    }
    const n = this.noiseSrc(t, d, this.brown);
    const ng = this.ctx.createGain();
    ng.gain.value = 0.6;
    this.chain(n, this.filt('bandpass', 350, 1.5), ng, ws);
  }

  whisper(pos, dur = 2, vol = 0.35) {
    if (!this.enabled) return;
    const t = this.t + 0.01;
    const n = this.noiseSrc(t, dur);
    const hp = this.filt('highpass', 700);
    const f1 = this.filt('bandpass', 1200, 6), f2 = this.filt('bandpass', 2400, 7);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    let tt = t;
    while (tt < t + dur) {
      const syl = 0.07 + Math.random() * 0.14;
      g.gain.linearRampToValueAtTime(vol * (0.4 + Math.random() * 0.6), tt + syl * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, tt + syl);
      f1.frequency.setValueAtTime(500 + Math.random() * 1500, tt);
      f2.frequency.setValueAtTime(1800 + Math.random() * 2000, tt);
      tt += syl + (Math.random() < 0.2 ? 0.15 : 0.02);
    }
    n.connect(hp);
    hp.connect(f1); hp.connect(f2);
    f1.connect(g); f2.connect(g);
    this.out(g, pos, { rev: 0.4, ref: 1, roll: 1.5, gain: 2.5 });
  }

  musicBox(pos, vol = 0.25) {
    if (!this.enabled) return;
    const notes = [76, 79, 83, 81, 79, 76, 74, 76, 79, 78, 76, 71, 72, 74, 76, 71];
    let t = this.t + 0.05, step = 0.32;
    for (let i = 0; i < notes.length; i++) {
      const f = 440 * Math.pow(2, (notes[i] - 69) / 12) * (1 + (Math.random() - 0.5) * 0.012);
      for (const [k, v] of [[1, 1], [2.01, 0.35], [3.98, 0.12]]) {
        const o = this.osc('sine', f * k, t, t + 1.6);
        this.out(this.chain(o, this.envGain(t, 0.003, vol * v, 1.4)), pos, { rev: 0.6, ref: 1.5, roll: 1.1 });
      }
      t += step;
      step *= 1.035;
    }
  }

  distantScream(pos, vol = 0.25) {
    if (!this.enabled) return;
    const t = this.t + 0.01, d = 1.6;
    const o = this.osc('sawtooth', 900, t, t + d);
    o.frequency.linearRampToValueAtTime(1300, t + 0.3);
    o.frequency.linearRampToValueAtTime(700, t + d);
    const v = this.osc('sine', 6, t, t + d);
    const vg = this.ctx.createGain();
    vg.gain.value = 40;
    v.connect(vg); vg.connect(o.frequency);
    this.out(this.chain(o, this.filt('bandpass', 1500, 3), this.envGain(t, 0.1, vol, d * 0.8, 0.2)), pos, { rev: 1.2, ref: 4, roll: 0.6 });
  }

  generatorStart(pos) {
    if (!this.enabled) return;
    const t = this.t + 0.01;
    const o = this.osc('sawtooth', 20, t, t + 3.5);
    o.frequency.exponentialRampToValueAtTime(55, t + 3);
    this.out(this.chain(o, this.filt('lowpass', 300), this.envGain(t, 0.4, 0.8, 1.5, 1.5)), pos, { rev: 0.5, ref: 3 });
    for (let i = 0; i < 5; i++) this.thud(pos, 0.5, 60, 0.4, t + 0.3 + i * 0.35);
  }

  // ------------------------------------------------------------------ loops
  startAmbience() {
    if (!this.enabled || this.loops.amb) return;
    const ctx = this.ctx, t = this.t;
    const drone = ctx.createGain();
    drone.gain.value = 0.0001;
    drone.gain.exponentialRampToValueAtTime(0.06, t + 4);
    const lp = this.filt('lowpass', 180, 2);
    const oscs = [];
    for (const f of [41.2, 41.7, 61.8, 82.4, 87.3]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
      oscs.push(o);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfg = ctx.createGain();
    lfg.gain.value = 90;
    lfo.connect(lfg); lfg.connect(lp.frequency);
    lfo.start();
    lp.connect(drone);
    drone.connect(this.amb);
    // wind / air
    const wn = ctx.createBufferSource();
    wn.buffer = this.brown;
    wn.loop = true;
    const wbp = this.filt('bandpass', 420, 0.7);
    const wg = ctx.createGain();
    wg.gain.value = 0.07;
    const wl = ctx.createOscillator();
    wl.frequency.value = 0.08;
    const wlg = ctx.createGain();
    wlg.gain.value = 250;
    wl.connect(wlg); wlg.connect(wbp.frequency);
    wl.start();
    wn.connect(wbp); wbp.connect(wg); wg.connect(this.amb);
    const ws = ctx.createGain(); ws.gain.value = 0.3; wg.connect(ws); ws.connect(this.reverb);
    wn.start();
    // tension layer (fear)
    const tg = ctx.createGain();
    tg.gain.value = 0;
    const tbp = this.filt('bandpass', 3200, 8);
    for (const f of [1567, 1661, 2349, 2489]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const v = ctx.createOscillator();
      v.frequency.value = 4 + Math.random() * 3;
      const vg = ctx.createGain();
      vg.gain.value = f * 0.01;
      v.connect(vg); vg.connect(o.frequency);
      v.start(); o.start();
      o.connect(tg);
      oscs.push(o, v);
    }
    void tbp;
    tg.connect(this.mus);
    // chase strings
    const cg = ctx.createGain();
    cg.gain.value = 0;
    const clp = this.filt('lowpass', 1800, 1);
    for (const f of [110, 116.5, 146.8, 155.6, 220, 233]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(clp);
      o.start();
      oscs.push(o);
    }
    const trem = ctx.createOscillator();
    trem.frequency.value = 11;
    const tremG = ctx.createGain();
    tremG.gain.value = 0.5;
    trem.connect(tremG);
    const cg2 = ctx.createGain();
    cg2.gain.value = 0.5;
    tremG.connect(cg2.gain);
    trem.start();
    clp.connect(cg2); cg2.connect(cg); cg.connect(this.mus);
    // lamp buzz (positional)
    const bo = ctx.createOscillator();
    bo.type = 'sawtooth';
    bo.frequency.value = 120;
    const bbp = this.filt('bandpass', 240, 3);
    const bg = ctx.createGain();
    bg.gain.value = 0;
    const bp = this.panner([0, 0, 0], 1.2, 1.6);
    bo.connect(bbp); bbp.connect(bg); bg.connect(bp); bp.connect(this.amb);
    bo.start();
    // monster breathing (positional)
    const mn = ctx.createBufferSource();
    mn.buffer = this.brown;
    mn.loop = true;
    const mbp = this.filt('bandpass', 320, 1.2);
    const mg = ctx.createGain();
    mg.gain.value = 0;
    const mam = ctx.createGain();
    mam.gain.value = 0.5;
    const ml = ctx.createOscillator();
    ml.frequency.value = 0.45;
    const mlg = ctx.createGain();
    mlg.gain.value = 0.5;
    ml.connect(mlg); mlg.connect(mam.gain);
    ml.start();
    const mo = ctx.createOscillator();
    mo.type = 'sawtooth';
    mo.frequency.value = 58;
    const mog = ctx.createGain();
    mog.gain.value = 0.08;
    mo.connect(mog); mog.connect(mbp);
    mo.start();
    const mp = this.panner([0, 0, 0], 1.5, 1.3);
    mn.connect(mbp); mbp.connect(mam); mam.connect(mg); mg.connect(mp); mp.connect(this.sfx);
    const mrs = ctx.createGain(); mrs.gain.value = 0.3; mp.connect(mrs); mrs.connect(this.reverb);
    mn.start();
    // alarm
    const ao = ctx.createOscillator();
    ao.type = 'square';
    ao.frequency.value = 640;
    const alp = this.filt('lowpass', 1500);
    const ag = ctx.createGain();
    ag.gain.value = 0;
    ao.connect(alp); alp.connect(ag); ag.connect(this.amb);
    const ars = ctx.createGain(); ars.gain.value = 0.5; ag.connect(ars); ars.connect(this.reverb);
    ao.start();
    this.loops = { amb: { drone, oscs, wn }, tension: tg, chase: cg, buzz: { g: bg, p: bp }, mbreath: { g: mg, p: mp, o: mo }, alarm: { o: ao, g: ag }, nextBeat: 0, alarmOn: false };
  }

  setFear(fear, chase) {
    if (!this.loops.amb) return;
    const t = this.t;
    this.loops.tension.gain.setTargetAtTime(fear * fear * 0.035, t, 0.4);
    this.loops.chase.gain.setTargetAtTime(chase * 0.05, t, chase > 0.5 ? 0.15 : 0.8);
    // chase drums
    if (chase > 0.05) {
      if (this.loops.nextBeat < t) this.loops.nextBeat = t + 0.05;
      while (this.loops.nextBeat < t + 0.25) {
        const bt = this.loops.nextBeat;
        const o = this.osc('sine', 70, bt, bt + 0.3);
        o.frequency.exponentialRampToValueAtTime(32, bt + 0.25);
        this.out(this.chain(o, this.envGain(bt, 0.003, 0.5 * chase, 0.25)), null, { rev: 0.2, bus: this.mus });
        this.loops.beatN = (this.loops.beatN || 0) + 1;
        if (this.loops.beatN % 4 === 2) {
          const n = this.noiseSrc(bt, 0.15);
          this.out(this.chain(n, this.filt('bandpass', 1800, 1), this.envGain(bt, 0.002, 0.18 * chase, 0.12)), null, { rev: 0.4, bus: this.mus });
        }
        this.loops.nextBeat += 0.36;
      }
    }
  }
  setBuzz(pos, level) {
    if (!this.loops.buzz) return;
    this.setPos(this.loops.buzz.p, pos);
    this.loops.buzz.g.gain.setTargetAtTime(level * 0.05, this.t, 0.02);
  }
  setMonsterBreath(pos, level) {
    if (!this.loops.mbreath) return;
    this.setPos(this.loops.mbreath.p, pos);
    this.loops.mbreath.g.gain.setTargetAtTime(level, this.t, 0.3);
  }
  setAlarm(on) {
    if (!this.loops.alarm) return;
    const a = this.loops.alarm;
    if (on && !this.loops.alarmOn) {
      this.loops.alarmOn = true;
      a.g.gain.setTargetAtTime(0.035, this.t, 0.5);
    }
    if (on) {
      const t = this.t;
      if (!a.next || a.next < t) a.next = t;
      while (a.next < t + 1) {
        a.o.frequency.setValueAtTime(640, a.next);
        a.o.frequency.linearRampToValueAtTime(880, a.next + 0.6);
        a.o.frequency.setValueAtTime(880, a.next + 0.6);
        a.o.frequency.linearRampToValueAtTime(640, a.next + 1.2);
        a.next += 1.2;
      }
    } else if (this.loops.alarmOn) {
      this.loops.alarmOn = false;
      a.g.gain.setTargetAtTime(0, this.t, 0.2);
    }
  }
  stopAll() {
    if (!this.ctx) return;
    const L = this.loops;
    try {
      if (L.amb) {
        for (const o of L.amb.oscs) o.stop();
        L.amb.wn.stop();
        L.alarm.o.stop();
      }
    } catch (e) { /* ignore */ }
    this.loops = {};
    // rebuild buses to drop lingering one-shots
    for (const k of ['sfx', 'amb', 'mus']) { try { this[k].disconnect(); } catch (e) { /* */ } this[k] = this.bus(k === 'amb' ? 0.9 : k === 'mus' ? 0.9 : 1); }
  }

  // positional voice chat stream
  attachVoice(stream) {
    if (!this.enabled) return null;
    try {
      const el = new Audio();
      el.srcObject = stream;
      el.muted = true;
      el.play().catch(() => {});
      const src = this.ctx.createMediaStreamSource(stream);
      const g = this.ctx.createGain();
      g.gain.value = 1.6;
      const p = this.panner([0, 0, 0], 2, 1.0);
      src.connect(g); g.connect(p); p.connect(this.master);
      const rs = this.ctx.createGain(); rs.gain.value = 0.25; p.connect(rs); rs.connect(this.reverb);
      return { el, src, g, p };
    } catch (e) {
      console.warn('voice attach failed', e);
      return null;
    }
  }
}
