// Co-op networking. PeerJS (WebRTC) star topology: host is authoritative. Voice chat is mesh.
const PREFIX = 'hollowward-v2-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const randomCode = (n = 5) => Array.from({ length: n }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error('load failed: ' + src));
    document.head.appendChild(s);
  });
}

async function loadPeerJS() {
  if (window.Peer) return window.Peer;
  const urls = [
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
    'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
  ];
  for (const u of urls) {
    try {
      await loadScript(u);
      if (window.Peer) return window.Peer;
    } catch (e) { /* try next */ }
  }
  throw new Error('Could not load the multiplayer library. Check your internet connection.');
}

class Emitter {
  constructor() { this.h = {}; }
  on(e, f) { (this.h[e] = this.h[e] || []).push(f); return this; }
  off(e) { delete this.h[e]; }
  emit(e, ...a) { for (const f of this.h[e] || []) { try { f(...a); } catch (err) { console.error(err); } } }
}

export class PeerNet extends Emitter {
  constructor() {
    super();
    this.peer = null;
    this.conns = new Map();
    this.isHost = false;
    this.hostId = null;
    this.id = null;
    this.code = null;
    this.localStream = null;
    this.calls = new Map();
  }

  _open(id) {
    const Peer = window.Peer;
    return new Promise((res, rej) => {
      const p = id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 });
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; rej(new Error('Could not reach the matchmaking server.')); } }, 15000);
      p.on('open', (pid) => { if (done) return; done = true; clearTimeout(to); this.peer = p; this.id = pid; res(p); });
      p.on('error', (e) => {
        if (!done) { done = true; clearTimeout(to); try { p.destroy(); } catch (x) { /* */ } rej(e); return; }
        this.emit('error', e);
      });
      p.on('disconnected', () => { try { if (!p.destroyed) p.reconnect(); } catch (e) { /* */ } });
      p.on('call', (call) => this._answer(call));
    });
  }

  async host() {
    await loadPeerJS();
    for (let i = 0; i < 6; i++) {
      const code = randomCode();
      try {
        await this._open(PREFIX + code);
        this.code = code;
        this.isHost = true;
        this.hostId = this.id;
        this.peer.on('connection', (c) => this._setup(c));
        return code;
      } catch (e) {
        if (e && e.type === 'unavailable-id') continue;
        throw e;
      }
    }
    throw new Error('Could not create a room. Try again.');
  }

  async join(code) {
    await loadPeerJS();
    code = code.trim().toUpperCase();
    await this._open(null);
    this.code = code;
    this.hostId = PREFIX + code;
    this.peer.on('connection', (c) => this._setup(c));
    const conn = this.peer.connect(this.hostId, { reliable: true, serialization: 'json' });
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('Connection timed out. Is the room code right?')), 15000);
      conn.on('open', () => { clearTimeout(to); res(); });
      conn.on('error', (e) => { clearTimeout(to); rej(e); });
      this.on('error', (e) => { if (e && e.type === 'peer-unavailable') { clearTimeout(to); rej(new Error('Room not found.')); } });
    });
    this._setup(conn);
  }

  _setup(conn) {
    const fire = () => {
      this.conns.set(conn.peer, conn);
      this.emit('join', conn.peer);
    };
    conn.on('data', (d) => this.emit('message', conn.peer, d));
    conn.on('close', () => { this.conns.delete(conn.peer); this.emit('leave', conn.peer); });
    conn.on('error', (e) => console.warn('conn error', e));
    if (conn.open) fire(); else conn.on('open', fire);
  }

  send(id, msg) {
    const c = this.conns.get(id);
    if (c && c.open) { try { c.send(msg); } catch (e) { /* */ } }
  }
  toHost(msg) { this.send(this.hostId, msg); }
  broadcast(msg, except = null) {
    for (const [id, c] of this.conns) if (id !== except && c.open) { try { c.send(msg); } catch (e) { /* */ } }
  }

  // ------------- voice
  async enableVoice() {
    if (this.localStream) return true;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      return true;
    } catch (e) {
      console.warn('mic denied', e);
      return false;
    }
  }
  callPeer(id) {
    if (!this.peer || !this.localStream || this.calls.has(id) || id === this.id) return;
    try {
      const call = this.peer.call(id, this.localStream);
      if (call) this._wireCall(call);
    } catch (e) { console.warn('call failed', e); }
  }
  _answer(call) {
    try {
      call.answer(this.localStream || undefined);
      this._wireCall(call);
    } catch (e) { console.warn('answer failed', e); }
  }
  _wireCall(call) {
    this.calls.set(call.peer, call);
    call.on('stream', (s) => this.emit('voice', call.peer, s));
    call.on('close', () => this.calls.delete(call.peer));
    call.on('error', () => this.calls.delete(call.peer));
  }

  close() {
    for (const c of this.calls.values()) { try { c.close(); } catch (e) { /* */ } }
    if (this.localStream) for (const t of this.localStream.getTracks()) t.stop();
    try { this.peer && this.peer.destroy(); } catch (e) { /* */ }
    this.conns.clear();
  }
}

// Same-browser transport for testing co-op across tabs (?net=local)
export class LocalNet extends Emitter {
  constructor() {
    super();
    this.conns = new Map();
    this.isHost = false;
    this.id = 'P' + randomCode(6);
  }
  _chan(code) {
    this.ch = new BroadcastChannel('hollowward-' + code);
    this.ch.onmessage = (e) => {
      const m = e.data;
      if (m.to !== this.id) return;
      if (m.type === 'hello') { this.conns.set(m.from, true); this.post(m.from, 'ok'); this.emit('join', m.from); }
      else if (m.type === 'ok') { this.conns.set(m.from, true); this._ok && this._ok(); }
      else if (m.type === 'msg') this.emit('message', m.from, m.data);
      else if (m.type === 'bye') { this.conns.delete(m.from); this.emit('leave', m.from); }
    };
  }
  post(to, type, data) { this.ch.postMessage({ to, from: this.id, type, data }); }
  async host() {
    this.code = randomCode();
    this.isHost = true;
    this.id = 'H-' + this.code;
    this.hostId = this.id;
    this._chan(this.code);
    return this.code;
  }
  async join(code) {
    this.code = code.toUpperCase();
    this.hostId = 'H-' + this.code;
    this._chan(this.code);
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('Room not found.')), 4000);
      this._ok = () => { clearTimeout(to); res(); };
      this.post(this.hostId, 'hello');
    });
  }
  send(id, msg) { this.post(id, 'msg', msg); }
  toHost(msg) { this.send(this.hostId, msg); }
  broadcast(msg, except = null) { for (const id of this.conns.keys()) if (id !== except) this.send(id, msg); }
  async enableVoice() { return false; }
  callPeer() {}
  close() { for (const id of this.conns.keys()) this.post(id, 'bye'); this.ch && this.ch.close(); }
}
