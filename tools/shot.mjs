// Headless smoke test + screenshots. Usage: node tools/shot.mjs [root=.] [script]
import { chromium } from '/opt/toolchains/.nvm/versions/node/v22.23.3/lib/node_modules/@playwright/mcp/node_modules/playwright-core/index.mjs';
import { serve } from './serve.mjs';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(process.argv[2] || '.');
const scenario = process.argv[3] || 'basic';
const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const srv = await serve(root);
const port = srv.address().port;
const browser = await chromium.launch({
  executablePath: '/opt/playwright/chromium-1232/chrome-linux64/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
async function newPage(url) {
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + '\n' + e.stack));
  await page.goto(url);
  return page;
}
const base = `http://127.0.0.1:${port}/`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  if (scenario === 'basic') {
    const page = await newPage(base + 'index.html?debug=1&seed=12345&nomonster');
    await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
    await page.screenshot({ path: `${outDir}/00-menu.png` });
    await page.click('#b-solo');
    await wait(1500);
    await page.evaluate(() => window.__game && (window.__game.fade = 0));
    await wait(3000);
    await page.screenshot({ path: `${outDir}/01-spawn.png` });
    const info = await page.evaluate(() => {
      const g = window.__game;
      return { draws: window.__app.renderer.stats.draws, hdr: window.__app.renderer.hdr, items: g.world.items.length, lockers: g.world.lockers.length, lamps: g.world.lamps.length, doors: g.world.doors.length, spawn: [g.player.x, g.player.z], static: g.world.staticDraws.length };
    });
    console.log('INFO', JSON.stringify(info));
    // turn around
    for (let i = 0; i < 3; i++) {
      await page.evaluate((k) => { const g = window.__game; g.player.yaw += Math.PI / 2; }, i);
      await wait(1200);
      await page.screenshot({ path: `${outDir}/02-look-${i}.png` });
    }
  }
  if (scenario === 'monster') {
    const page = await newPage(base + 'index.html?debug=1&seed=777&dormant=0.5');
    await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
    await page.click('#b-solo');
    await wait(1500);
    // put the monster 7m in front of the player, in a walkable cell with LOS
    const r = await page.evaluate(() => {
      const g = window.__game, p = g.player, w = g.world;
      g.fade = 0;
      for (let d = 7; d > 2; d -= 0.5) {
        for (let a = 0; a < 6.28; a += 0.3) {
          const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
          const [cx, cy] = w.cellOf(x, z);
          if (w.monsterWalkable(cx, cy) && w.los(p.x, p.z, x, z) && w.pointFree(x, z, 0.4)) {
            g.ai.x = x; g.ai.z = z; g.ai.setState('wander'); g.ai.stareCool = 0; g.ai.yaw = Math.atan2(p.x - x, p.z - z);
            p.yaw = Math.atan2(x - p.x, z - p.z); p.pitch = 0.05;
            return { d, x, z };
          }
        }
      }
      return null;
    });
    console.log('placed', JSON.stringify(r));
    for (let i = 0; i < 6; i++) {
      await wait(450);
      const st = await page.evaluate(() => {
        const g = window.__game, ai = g.ai, w = g.world;
        const pc = w.cellOf(g.player.x, g.player.z), mc = ai.cell();
        return { st: ai.state, an: ai.anim, d: g.monsterDist().toFixed(2), js: !!g.jumpscare, status: g.status.get('me'), path: ai.path.length, cells: JSON.stringify(ai.pathCells), mc, pc, pw: w.monsterWalkable(...pc), mw: w.monsterWalkable(...mc), mtype: w.get(...mc), seenAgo: (ai.time - ai.seenAt).toFixed(2), stuck: ai.stuck.toFixed(2), dw: ai.doorWait.toFixed(2) };
      });
      console.log('t', i, JSON.stringify(st));
      await page.screenshot({ path: `${outDir}/10-monster-${i}.png` });
    }
    await wait(9000);
    const end = await page.evaluate(() => ({ js: window.__game && JSON.stringify(window.__game.jumpscare), gt: window.__game && window.__game.time, pend: window.__game && JSON.stringify(window.__game.pendingEnd), ended: window.__game && window.__game.ended, endVisible: !document.getElementById('end').classList.contains('hidden'), title: document.getElementById('end-title').textContent }));
    console.log('END', JSON.stringify(end));
    await page.screenshot({ path: `${outDir}/11-end.png` });
  }
  if (scenario === 'portrait') {
    const page = await newPage(base + 'index.html?debug=1&seed=777&nomonster');
    await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
    await page.click('#b-solo');
    await wait(1500);
    for (const [i, anim, dist] of [[0, 'stare', 2.6], [1, 'chase', 3.2], [2, 'walk', 4.5]]) {
      await page.evaluate(({ anim, dist }) => {
        const g = window.__game, p = g.player, ai = g.ai;
        g.fade = 0;
        ai.update = () => {};
        ai.anim = anim; ai.speed = anim === 'chase' ? 3.5 : anim === 'walk' ? 1.4 : 0;
        const f = [Math.sin(p.yaw), Math.cos(p.yaw)];
        ai.x = p.x + f[0] * dist; ai.z = p.z + f[1] * dist; ai.yaw = p.yaw + Math.PI;
        p.pitch = 0.12;
      }, { anim, dist });
      await wait(1500);
      await page.screenshot({ path: `${outDir}/15-portrait-${i}.png` });
    }
    await page.evaluate(() => { const g = window.__game; g.startJumpscare('chase'); });
    await wait(700);
    await page.screenshot({ path: `${outDir}/16-jumpscare.png` });
  }
  if (scenario === 'scares') {
    const page = await newPage(base + 'index.html?debug=1&seed=31337&nomonster');
    await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
    await page.click('#b-solo');
    await wait(1500);
    await page.evaluate(() => {
      const g = window.__game, w = g.world, p = g.player;
      g.fade = 0;
      // move into a long corridor facing along it
      const [ax, az] = w.center(1, 14);
      p.x = ax; p.z = az; p.yaw = Math.PI * 0 ; p.pitch = 0;
      for (const k of ['whisper', 'steps', 'knock', 'lights', 'flash', 'scream', 'slam', 'breath']) g.scares.fire(k);
      g.scares.spawnApparition('girl');
      g.monsterDist = () => 99;
    });
    await wait(400);
    await page.screenshot({ path: `${outDir}/40-girl.png` });
    await wait(2500);
    await page.evaluate(() => { const g = window.__game; g.scares.app = null; g.scares.spawnApparition('fake'); });
    await wait(500);
    await page.screenshot({ path: `${outDir}/41-fake.png` });
    await page.evaluate(() => { const g = window.__game; const n = g.world.items.find((i) => i.kind === 'note'); g.openNote(n.note); });
    await wait(500);
    await page.screenshot({ path: `${outDir}/42-note.png` });
    const st = await page.evaluate(() => ({ app: !!window.__game.scares.app, note: !!window.__game.noteOpen }));
    console.log('scares', JSON.stringify(st));
  }
  if (scenario === 'flow') {
    const page = await newPage(base + 'index.html?debug=1&seed=4242&nomonster');
    await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
    await page.click('#b-solo');
    await wait(1500);
    const res = await page.evaluate(async () => {
      const g = window.__game, w = g.world, p = g.player;
      g.fade = 0;
      const log = [];
      // doors
      const d = w.doors[0];
      const before = d.open;
      g.act({ a: 'door', id: 0 });
      log.push(`door0 ${before} -> ${d.open}`);
      // pick all fuses + a battery
      p.battery = 0.3;
      for (const it of w.items) if (it.kind === 'fuse') g.act({ a: 'pickup', id: it.id });
      const bat = w.items.find((i) => i.kind === 'battery');
      g.act({ a: 'pickup', id: bat.id });
      log.push(`fuses=${g.fuses} battery=${p.battery.toFixed(2)}`);
      // locker
      g.enterLocker(w.lockers[0]);
      log.push(`hidden=${!!p.hidden}`);
      return log;
    });
    console.log(res.join('\n'));
    await wait(1200);
    await page.screenshot({ path: `${outDir}/20-locker.png` });
    // go to generator & power
    await page.evaluate(() => {
      const g = window.__game, w = g.world, p = g.player;
      g.exitLocker();
      const gp = w.generatorPos;
      const L = w.lockers[0];
      p.x = gp.x; p.z = gp.z;
      p.yaw = Math.atan2(w.genLamps[0].p[0] - gp.x, w.genLamps[0].p[2] - gp.z);
      p.pitch = -0.25;
    });
    await wait(1000);
    await page.screenshot({ path: `${outDir}/21-generator.png` });
    await page.evaluate(() => window.__game.act({ a: 'power' }));
    await wait(3500);
    await page.screenshot({ path: `${outDir}/22-powered.png` });
    // go to the exit
    await page.evaluate(() => {
      const g = window.__game, w = g.world, p = g.player, ex = w.exit;
      p.x = ex.gx - ex.dx * 3.5; p.z = ex.gz - ex.dz * 3.5;
      p.yaw = Math.atan2(ex.dx, ex.dz); p.pitch = 0.05;
    });
    await wait(4000);
    await page.screenshot({ path: `${outDir}/23-exit.png` });
    const e2 = await page.evaluate(() => {
      const g = window.__game, w = g.world, p = g.player, ex = w.exit;
      p.x = ex.cx; p.z = ex.cz;
      return { exitAnim: w.exitAnim, powered: g.powered };
    });
    console.log('exit', JSON.stringify(e2));
    await wait(1500);
    const end = await page.evaluate(() => ({ title: document.getElementById('end-title').textContent, vis: !document.getElementById('end').classList.contains('hidden') }));
    console.log('END', JSON.stringify(end));
    await page.screenshot({ path: `${outDir}/24-end.png` });
  }
  if (scenario === 'coop') {
    const host = await newPage(base + 'index.html?debug=1&net=local');
    await host.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
    await host.fill('#name', 'Alice');
    await host.click('#b-host');
    await host.waitForFunction(() => document.getElementById('room-code').textContent.length === 5 && !document.getElementById('room-code').textContent.includes('-'));
    const code = await host.textContent('#room-code');
    console.log('code', code);
    const cl = await newPage(base + 'index.html?debug=1&net=local&join=' + code);
    await cl.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
    await cl.fill('#name', 'Bob');
    await cl.click('#b-join');
    await wait(1500);
    console.log('host lobby:', await host.textContent('#lobby-players'));
    console.log('client lobby:', await cl.textContent('#lobby-players'));
    await host.click('#b-start');
    await wait(4000);
    const hs = await host.evaluate(() => { const g = window.__game; return { remotes: g.remotes.size, mode: g.mode, seed: g.seed }; });
    const cs = await cl.evaluate(() => { const g = window.__game; return { remotes: g.remotes.size, mode: g.mode, seed: g.seed }; });
    console.log('host', JSON.stringify(hs), 'client', JSON.stringify(cs));
    // client looks at host avatar & picks up a fuse; host toggles door
    await cl.evaluate(() => {
      const g = window.__game, p = g.player;
      g.fade = 0;
      const r = [...g.remotes.values()][0];
      p.x = r.x + 3; p.z = r.z;
      const pt = [p.x, p.z]; g.world.collide(pt, 0.3); p.x = pt[0]; p.z = pt[1];
      p.yaw = Math.atan2(r.x - p.x, r.z - p.z);
      const f = g.world.items.find((i) => i.kind === 'fuse');
      g.act({ a: 'pickup', id: f.id });
    });
    await host.evaluate(() => { window.__game.fade = 0; window.__game.act({ a: 'door', id: 1 }); });
    await wait(2500);
    const hs2 = await host.evaluate(() => { const g = window.__game; const r = [...g.remotes.values()][0]; return { fuses: g.fuses, door1: g.world.doors[1].open, remote: [r.x.toFixed(1), r.z.toFixed(1)] }; });
    const cs2 = await cl.evaluate(() => { const g = window.__game; return { fuses: g.fuses, door1: g.world.doors[1].open, mon: [g.mon.x.toFixed(1), g.mon.z.toFixed(1)], monState: g.mon.state }; });
    console.log('host2', JSON.stringify(hs2), 'client2', JSON.stringify(cs2));
    await cl.screenshot({ path: `${outDir}/30-coop-client.png` });
    // host catches client -> downed, then revive
    await host.evaluate(() => { const g = window.__game; const id = [...g.remotes.keys()][0]; g.hostCatch(id, 'chase'); });
    await wait(3500);
    const c3 = await cl.evaluate(() => { const g = window.__game; return { downed: g.player.downed, status: g.status.get(g.localId) }; });
    console.log('client after catch', JSON.stringify(c3));
    await cl.screenshot({ path: `${outDir}/31-coop-down.png` });
    await host.evaluate(() => { const g = window.__game; const id = [...g.remotes.keys()][0]; g.act({ a: 'revive', id }); });
    await wait(1000);
    const c4 = await cl.evaluate(() => { const g = window.__game; return { downed: g.player.downed, status: g.status.get(g.localId) }; });
    console.log('client after revive', JSON.stringify(c4));
  }
} catch (e) {
  console.error('SCENARIO ERROR', e);
}
console.log('ERRORS:\n' + errors.slice(0, 40).join('\n'));
await browser.close();
srv.close();
