// App bootstrap: menus, lobby, settings, main loop.
import { Renderer } from './gl/renderer.js';
import { buildMaterials } from './textures.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { UI, $ } from './ui.js';
import { Game, escapeHtml } from './game.js';
import { PeerNet, LocalNet } from './net.js';
import { PLAYER_COLORS } from './avatar.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const SKEY = 'hollowward-settings-v1';

const defaults = { sens: 1, fov: 66, brightness: 1, volume: 0.85, quality: '', invertY: false, name: '' };
const settings = Object.assign({}, defaults, (() => { try { return JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch (e) { return {}; } })());
if (DEBUG) settings.keyLook = true;
const save = () => { try { const { keyLook, ...s } = settings; localStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) { /* */ } };

const app = { settings, game: null, net: null, lobby: null, pendingVoice: new Map(), settingsReturn: 'menu', lastMode: 'solo' };
window.__app = app;

function fatal(msg) {
  const ui = app.ui || new UI();
  ui.screen('fatal');
  $('fatal-text').innerHTML = msg;
}

async function boot() {
  const canvas = $('c');
  app.ui = new UI();
  try {
    app.renderer = new Renderer(canvas);
  } catch (e) {
    console.error(e);
    fatal('Your browser or device does not support WebGL 2, which this game needs.<br>Try a recent Chrome, Edge or Firefox on a computer.');
    return;
  }
  if (!settings.quality) {
    const mobile = /Mobi|Android/i.test(navigator.userAgent);
    settings.quality = mobile ? 'low' : 'medium';
  }
  app.renderer.setQuality(settings.quality);
  app.audio = new AudioEngine();
  app.audio.volume = settings.volume;
  app.input = new Input(canvas);
  if (DEBUG) app.input.forceLocked = true;
  // horror fonts are optional (used for blood writing); never block more than ~2.5s
  try {
    await Promise.race([
      Promise.all([document.fonts.load('120px Creepster'), document.fonts.load('16px "Special Elite"')]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch (e) { /* offline is fine */ }
  try {
    app.mats = await buildMaterials(app.renderer, (p, name) => {
      $('load-fill').style.width = Math.round(p * 100) + '%';
      $('load-text').textContent = p >= 1 ? 'Ready.' : `Generating ${name}...`;
    });
  } catch (e) {
    console.error(e);
    fatal('Failed to generate the world: ' + escapeHtml(e.message));
    return;
  }
  app.onGameEnd = onGameEnd;
  bindMenu();
  bindSettings();
  window.addEventListener('resize', () => app.renderer.resize());
  document.addEventListener('pointerlockchange', onLockChange);
  canvas.addEventListener('click', () => { if (app.game && !app.game.ended && !app.input.locked) lockGame(); });
  $('clickstart').addEventListener('click', lockGame);
  app.ui.screen('menu');
  const jc = params.get('join');
  if (jc) $('join-code').value = jc.toUpperCase();
  requestAnimationFrame(frame);
  if (params.get('autostart') === 'solo') startSolo();
}

let last = performance.now();
let errCount = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  try {
    if (app.game) app.game.update(dt);
  } catch (e) {
    console.error(e);
    if (++errCount === 1) app.ui.message('Error: ' + escapeHtml(e.message), 6);
  }
  app.input.endFrame();
}

// ------------------------------------------------------------------ pointer lock / pause
function lockGame() {
  app.audio.init();
  app.audio.resume();
  if (DEBUG) { onLockChange(); return; }
  app.input.lock();
}
function onLockChange() {
  const g = app.game;
  if (!g || g.ended) return;
  if (app.input.locked) {
    app.ui.screen(null);
    g.paused = false;
  } else {
    app.ui.screen('pause');
    $('pause-coop').classList.toggle('hidden', g.mode === 'solo');
    if (g.mode === 'solo') g.paused = true;
  }
}

// ------------------------------------------------------------------ menu
function playerName() {
  let n = $('name').value.trim().slice(0, 14);
  if (!n) n = 'Patient ' + Math.floor(100 + Math.random() * 899);
  settings.name = $('name').value.trim().slice(0, 14);
  save();
  return n;
}
function menuError(t) { $('menu-error').textContent = t || ''; }
function bindMenu() {
  $('name').value = settings.name || '';
  $('b-solo').onclick = () => { app.audio.init(); startSolo(); };
  $('b-host').onclick = () => { app.audio.init(); hostCoop(); };
  $('b-join').onclick = () => { app.audio.init(); joinCoop($('join-code').value); };
  $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('b-join').click(); });
  $('b-howto').onclick = () => app.ui.screen('howto');
  $('b-howto-back').onclick = () => app.ui.screen('menu');
  $('b-settings').onclick = () => { app.settingsReturn = 'menu'; app.ui.screen('settings'); };
  $('b-pause-settings').onclick = () => { app.settingsReturn = 'pause'; app.ui.screen('settings'); };
  $('b-settings-back').onclick = () => app.ui.screen(app.settingsReturn);
  $('b-resume').onclick = lockGame;
  $('b-quit').onclick = () => { quitToMenu(); };
  $('b-leave').onclick = () => { quitToMenu(); };
  $('b-copy').onclick = () => {
    const link = `${location.origin}${location.pathname}?join=${app.lobby ? app.lobby.code : ''}`;
    const done = () => { $('b-copy').textContent = 'COPIED!'; setTimeout(() => ($('b-copy').textContent = 'COPY INVITE LINK'), 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, () => window.prompt('Invite link:', link));
    else window.prompt('Invite link:', link);
  };
  $('b-start').onclick = hostStart;
  $('b-again').onclick = playAgain;
  $('b-end-menu').onclick = () => quitToMenu();
}

function bindSettings() {
  const bind = (id, key, fmt, apply) => {
    const el = $(id), v = $(id + '-v');
    el.value = settings[key];
    const upd = () => {
      settings[key] = parseFloat(el.value);
      if (v) v.textContent = fmt(settings[key]);
      apply && apply(settings[key]);
      save();
    };
    el.addEventListener('input', upd);
    if (v) v.textContent = fmt(settings[key]);
  };
  bind('s-sens', 'sens', (x) => x.toFixed(2));
  bind('s-fov', 'fov', (x) => x + '°');
  bind('s-bright', 'brightness', (x) => Math.round(x * 100) + '%');
  bind('s-vol', 'volume', (x) => Math.round(x * 100) + '%', (x) => app.audio.setVolume(x));
  const q = $('s-quality');
  q.value = settings.quality;
  q.onchange = () => { settings.quality = q.value; app.renderer.setQuality(q.value); save(); };
  const inv = $('s-invert');
  inv.checked = !!settings.invertY;
  inv.onchange = () => { settings.invertY = inv.checked; save(); };
}

// ------------------------------------------------------------------ game start / end
function startGame(opts) {
  app.audio.init();
  app.audio.resume();
  if (app.game) { app.game.destroy(); app.game = null; }
  menuError('');
  try {
    app.game = new Game(app, opts);
  } catch (e) {
    console.error(e);
    fatal('Could not start the game: ' + escapeHtml(e.message));
    return;
  }
  window.__game = app.game;
  for (const [id, s] of app.pendingVoice) app.game.attachVoice(id, s);
  app.ui.screen(app.input.locked ? null : 'clickstart');
}

function startSolo() {
  app.lastMode = 'solo';
  const name = playerName();
  const seed = params.get('seed') ? parseInt(params.get('seed'), 10) : (Math.random() * 1e9) | 0;
  const dormant = params.get('dormant') ? parseFloat(params.get('dormant')) : undefined;
  startGame({ mode: 'solo', seed, localId: 'me', players: [{ id: 'me', name, idx: 0 }], noMonster: params.has('nomonster'), dormant });
}

function onGameEnd(result, summary) {
  const g = app.game;
  app.input.unlock();
  const local = g ? g.status.get(g.localId) : null;
  let title, sub, win = false;
  if (result === 'lost-host') { title = 'CONNECTION LOST'; sub = 'The host left the asylum. You are alone now.'; }
  else if (result === 'win') {
    win = true;
    if (local === 'escaped') { title = 'YOU ESCAPED'; sub = g.roster.length > 1 ? 'You made it out of St. Mercy. Not everyone did.' : 'The gate groans shut behind you. Something screams inside. You never look back.'; }
    else { title = 'THEY ESCAPED'; sub = 'Your friends made it out. You are still inside... with him.'; win = false; }
    if (g.roster.length > 1 && [...g.status.values()].every((s) => s === 'escaped')) sub = 'Everyone made it out. Against all odds.';
  } else { title = 'YOU DIED'; sub = g && g.roster.length > 1 ? 'Nobody made it out of St. Mercy tonight.' : 'He found you. He always finds you.'; }
  $('end-title').textContent = title;
  $('end-title').classList.toggle('win', win);
  $('end-sub').textContent = sub;
  $('end-stats').innerHTML = summary.lines.map((l) => `<li>${l}</li>`).join('');
  $('b-again').classList.toggle('hidden', app.lastMode === 'client' || result === 'lost-host');
  $('b-again').textContent = app.lastMode === 'host' ? 'BACK TO LOBBY' : 'PLAY AGAIN';
  app.ui.hud(false);
  app.ui.screen('end');
}

function playAgain() {
  if (app.lastMode === 'solo') { startSolo(); return; }
  if (app.lastMode === 'host' && app.net) {
    if (app.game) { app.game.destroy(); app.game = null; }
    app.lobby.inGame = false;
    app.net.broadcast({ t: 'lobby-return', players: app.lobby.players });
    renderLobby();
    app.ui.screen('lobby');
  }
}

function quitToMenu() {
  app.input.unlock();
  if (app.game) { app.game.destroy(); app.game = null; }
  if (app.net) { try { app.net.close(); } catch (e) { /* */ } app.net = null; }
  app.lobby = null;
  app.pendingVoice.clear();
  app.ui.screen('menu');
}

// ------------------------------------------------------------------ co-op
function makeNet() { return params.get('net') === 'local' ? new LocalNet() : new PeerNet(); }

function renderLobby() {
  const L = app.lobby;
  if (!L) return;
  $('room-code').textContent = L.code || '-----';
  $('lobby-players').innerHTML = L.players.map((p) => {
    const c = PLAYER_COLORS[p.idx % 4].map((v) => Math.round(Math.min(1, v * 1.8) * 255)).join(',');
    return `<li><span><span class="dot" style="background:rgb(${c})"></span>${escapeHtml(p.name)}</span><span>${p.id === (app.net && app.net.hostId) ? 'HOST' : ''}${p.id === (app.net && app.net.id) ? ' (you)' : ''}</span></li>`;
  }).join('') + (L.players.length < 4 ? `<li class="dim"><span>${4 - L.players.length} empty slot${L.players.length < 3 ? 's' : ''}...</span></li>` : '');
  $('b-start').classList.toggle('hidden', !L.isHost);
  $('lobby-wait').classList.toggle('hidden', L.isHost);
  $('b-copy').classList.toggle('hidden', !L.code);
}

function wireNet(net) {
  net.on('message', (from, msg) => route(from, msg));
  net.on('leave', (id) => {
    if (app.game) { app.game.onLeave(id); }
    if (app.lobby && app.lobby.isHost) {
      app.lobby.players = app.lobby.players.filter((p) => p.id !== id);
      net.broadcast({ t: 'lobby', players: app.lobby.players });
      renderLobby();
    } else if (app.lobby && id === net.hostId && !app.game) {
      $('lobby-error').textContent = 'The host closed the room.';
    }
  });
  net.on('voice', (id, stream) => {
    app.pendingVoice.set(id, stream);
    if (app.game) app.game.attachVoice(id, stream);
  });
  net.on('error', (e) => console.warn('net error', e));
}

async function hostCoop() {
  const name = playerName();
  app.lastMode = 'host';
  const net = makeNet();
  app.lobby = { isHost: true, code: null, players: [], inGame: false };
  renderLobby();
  $('lobby-error').textContent = 'Creating room...';
  app.ui.screen('lobby');
  try {
    const code = await net.host();
    app.net = net;
    app.lobby.code = code;
    app.lobby.players = [{ id: net.id, name, idx: 0 }];
    wireNet(net);
    $('lobby-error').textContent = '';
    renderLobby();
  } catch (e) {
    console.error(e);
    app.lobby = null;
    app.ui.screen('menu');
    menuError('Could not create a room: ' + (e.message || e.type || e));
  }
}

async function joinCoop(code) {
  code = (code || '').trim().toUpperCase();
  if (code.length < 4) { menuError('Enter the room code your friend gave you.'); return; }
  const name = playerName();
  app.lastMode = 'client';
  const net = makeNet();
  app.lobby = { isHost: false, code, players: [], inGame: false };
  renderLobby();
  $('lobby-error').textContent = 'Connecting...';
  app.ui.screen('lobby');
  try {
    await net.join(code);
    app.net = net;
    wireNet(net);
    net.toHost({ t: 'hello', name });
    $('lobby-error').textContent = '';
  } catch (e) {
    console.error(e);
    try { net.close(); } catch (x) { /* */ }
    app.lobby = null;
    app.ui.screen('menu');
    menuError('Could not join: ' + (e.message || e.type || e));
  }
}

async function hostStart() {
  const L = app.lobby, net = app.net;
  if (!L || !L.isHost || !net) return;
  const seed = (Math.random() * 1e9) | 0;
  L.inGame = true;
  const voice = $('voice-chk').checked;
  net.broadcast({ t: 'start', seed, players: L.players });
  startGame({ mode: 'host', net, seed, localId: net.id, players: L.players });
  if (voice) startVoice(L.players);
}

async function startVoice(players) {
  const net = app.net;
  if (!net || !(await net.enableVoice())) return;
  for (const p of players) if (p.id !== net.id && net.id < p.id) net.callPeer(p.id);
}

function route(from, msg) {
  const L = app.lobby, net = app.net;
  if (!msg || !net) return;
  if (L && L.isHost) {
    if (msg.t === 'hello') {
      if (L.inGame) { net.send(from, { t: 'reject', reason: 'The game is already in progress.' }); return; }
      if (L.players.length >= 4) { net.send(from, { t: 'reject', reason: 'The room is full (4 players).' }); return; }
      if (!L.players.find((p) => p.id === from)) {
        const used = new Set(L.players.map((p) => p.idx));
        let idx = 0;
        while (used.has(idx)) idx++;
        L.players.push({ id: from, name: String(msg.name || 'Patient').slice(0, 14), idx });
      }
      net.send(from, { t: 'welcome', players: L.players });
      net.broadcast({ t: 'lobby', players: L.players });
      renderLobby();
      return;
    }
    if (app.game) app.game.onMessage(from, msg);
    return;
  }
  // client
  switch (msg.t) {
    case 'welcome':
    case 'lobby':
      if (L) { L.players = msg.players; renderLobby(); }
      return;
    case 'reject':
      quitToMenu();
      menuError(msg.reason || 'Rejected by host.');
      return;
    case 'start':
      if (L) L.players = msg.players;
      startGame({ mode: 'client', net, seed: msg.seed, localId: net.id, players: msg.players });
      if ($('voice-chk').checked) startVoice(msg.players);
      return;
    case 'lobby-return':
      if (app.game) { app.game.destroy(); app.game = null; }
      app.input.unlock();
      if (L) { L.players = msg.players; renderLobby(); }
      app.ui.screen('lobby');
      return;
  }
  if (app.game) app.game.onMessage(from, msg);
}

boot();
