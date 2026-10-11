// Procedural asylum layout: corridor grid + subdivided blocks of rooms, barricades, exit.
import { RNG } from '../rng.js';

export const T = { WALL: 0, ROOM: 1, CORR: 2, DOOR: 3, BARR: 4, EXIT: 5 };
export const CELL = 2.6;
export const WALL_H = 3.0;
export const W = 36;
export const H = 30;
const V_LINES = [1, 12, 23, 34];
const H_LINES = [1, 10, 19, 28];
export const DIRS = [[0, -1, 'N'], [1, 0, 'E'], [0, 1, 'S'], [-1, 0, 'W']];

export const isWalkableType = (t) => t === T.ROOM || t === T.CORR || t === T.DOOR;

export function generateMap(seed) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const m = tryGenerate((seed + attempt * 7919) >>> 0);
    if (m) { m.seed = seed; return m; }
  }
  throw new Error('Map generation failed');
}

function tryGenerate(seed) {
  const rng = new RNG(seed);
  const grid = new Uint8Array(W * H);
  const roomOf = new Int16Array(W * H).fill(-1);
  const I = (x, y) => y * W + x;
  const get = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? T.WALL : grid[I(x, y)]);
  for (const y of H_LINES) for (let x = V_LINES[0]; x <= V_LINES[3]; x++) grid[I(x, y)] = T.CORR;
  for (const x of V_LINES) for (let y = H_LINES[0]; y <= H_LINES[3]; y++) grid[I(x, y)] = T.CORR;

  const rooms = [];
  const doors = [];
  const addRoom = (x0, y0, x1, y1, block) => {
    const r = { id: rooms.length, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, doors: [], type: null, block };
    rooms.push(r);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { grid[I(x, y)] = T.ROOM; roomOf[I(x, y)] = r.id; }
    return r;
  };
  const addDoor = (x, y, axis, rooms_) => {
    grid[I(x, y)] = T.DOOR;
    const d = { id: doors.length, x, y, axis, rooms: rooms_ };
    doors.push(d);
    for (const r of rooms_) if (r) r.doors.push(d);
    return d;
  };
  const nearDoor = (x, y) => {
    for (const [dx, dy] of DIRS) if (get(x + dx, y + dy) === T.DOOR) return true;
    return false;
  };

  for (let bj = 0; bj < 3; bj++)
    for (let bi = 0; bi < 3; bi++) {
      const bx0 = V_LINES[bi] + 1, bx1 = V_LINES[bi + 1] - 1, by0 = H_LINES[bj] + 1, by1 = H_LINES[bj + 1] - 1;
      const ix0 = bx0 + 1, ix1 = bx1 - 1, iy0 = by0 + 1, iy1 = by1 - 1;
      const r = rng.next();
      const layout = r < 0.12 ? 'hall' : r < 0.42 ? 'v' : r < 0.82 ? 'vh' : 'h';
      const block = { bi, bj, bx0, bx1, by0, by1, ix0, ix1, iy0, iy1, layout };
      const br = [];
      let s = 0, t = 0;
      if (layout === 'hall') {
        const R = addRoom(ix0, iy0, ix1, iy1, block);
        R.hall = true;
        br.push(R);
        for (const [px, py] of [[ix0 + 2, iy0 + 2], [ix1 - 2, iy0 + 2], [ix0 + 2, iy1 - 2], [ix1 - 2, iy1 - 2]]) {
          grid[I(px, py)] = T.WALL;
          roomOf[I(px, py)] = -1;
        }
      } else if (layout === 'v') {
        s = ix0 + 3 + rng.int(0, 1);
        br.push(addRoom(ix0, iy0, s - 1, iy1, block), addRoom(s + 1, iy0, ix1, iy1, block));
        if (rng.chance(0.45)) {
          const y = rng.int(iy0, iy1);
          addDoor(s, y, 'x', [br[0], br[1]]);
        }
      } else if (layout === 'h') {
        t = iy0 + 2 + rng.int(0, 1);
        br.push(addRoom(ix0, iy0, ix1, t - 1, block), addRoom(ix0, t + 1, ix1, iy1, block));
        if (rng.chance(0.45)) addDoor(rng.int(ix0, ix1), t, 'z', [br[0], br[1]]);
      } else {
        s = ix0 + 3 + rng.int(0, 1);
        t = iy0 + 2 + rng.int(0, 1);
        const a = addRoom(ix0, iy0, s - 1, t - 1, block), b = addRoom(s + 1, iy0, ix1, t - 1, block);
        const c = addRoom(ix0, t + 1, s - 1, iy1, block), d = addRoom(s + 1, t + 1, ix1, iy1, block);
        br.push(a, b, c, d);
        if (rng.chance(0.35)) addDoor(s, rng.int(iy0, t - 1), 'x', [a, b]);
        if (rng.chance(0.35)) addDoor(s, rng.int(t + 1, iy1), 'x', [c, d]);
        if (rng.chance(0.35)) addDoor(rng.int(ix0, s - 1), t, 'z', [a, c]);
        if (rng.chance(0.35)) addDoor(rng.int(s + 1, ix1), t, 'z', [b, d]);
      }
      for (const R of br) {
        const sides = [];
        if (R.x0 === ix0) sides.push('W');
        if (R.x1 === ix1) sides.push('E');
        if (R.y0 === iy0) sides.push('N');
        if (R.y1 === iy1) sides.push('S');
        rng.shuffle(sides);
        const nd = R.hall ? 3 : rng.chance(0.3) ? 2 : 1;
        for (let k = 0; k < Math.min(nd, sides.length); k++) {
          const side = sides[k];
          const cands = [];
          if (side === 'W' || side === 'E') {
            const x = side === 'W' ? bx0 : bx1;
            for (let y = R.y0; y <= R.y1; y++) if (!nearDoor(x, y)) cands.push([x, y]);
          } else {
            const y = side === 'N' ? by0 : by1;
            for (let x = R.x0; x <= R.x1; x++) if (!nearDoor(x, y)) cands.push([x, y]);
          }
          if (!cands.length) continue;
          const [x, y] = rng.pick(cands);
          addDoor(x, y, side === 'W' || side === 'E' ? 'x' : 'z', [R]);
        }
      }
    }

  // connectivity helper
  const bfs = (sx, sy) => {
    const dist = new Int32Array(W * H).fill(-1);
    const q = [I(sx, sy)];
    dist[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!isWalkableType(get(nx, ny))) continue;
        const n = I(nx, ny);
        if (dist[n] >= 0) continue;
        dist[n] = dist[c] + 1;
        q.push(n);
      }
    }
    return dist;
  };
  const connected = () => {
    const d = bfs(V_LINES[0], H_LINES[0]);
    for (let i = 0; i < W * H; i++) if (isWalkableType(grid[i]) && d[i] < 0) return false;
    return true;
  };
  if (!connected()) return null;

  // barricades in corridor segments
  const segs = [];
  for (const y of H_LINES) for (let k = 0; k < 3; k++) segs.push({ dir: 'h', y, a: V_LINES[k], b: V_LINES[k + 1] });
  for (const x of V_LINES) for (let k = 0; k < 3; k++) segs.push({ dir: 'v', x, a: H_LINES[k], b: H_LINES[k + 1] });
  rng.shuffle(segs);
  let placed = 0;
  const barricades = [];
  for (const sg of segs) {
    if (placed >= 3) break;
    const mid = Math.round((sg.a + sg.b) / 2) + rng.int(-2, 2);
    const x = sg.dir === 'h' ? mid : sg.x, y = sg.dir === 'h' ? sg.y : mid;
    if (get(x, y) !== T.CORR || nearDoor(x, y)) continue;
    grid[I(x, y)] = T.BARR;
    if (!connected()) { grid[I(x, y)] = T.CORR; continue; }
    barricades.push({ x, y, dir: sg.dir });
    placed++;
  }

  // spawn room: in a corner block, decent size
  const corner = rooms.filter((r) => (r.block.bi !== 1 && r.block.bj !== 1) && r.w * r.h >= 6 && !r.hall);
  if (!corner.length) return null;
  const spawnRoom = rng.pick(corner);
  spawnRoom.type = 'ward';
  const sc = [Math.floor((spawnRoom.x0 + spawnRoom.x1) / 2), Math.floor((spawnRoom.y0 + spawnRoom.y1) / 2)];
  const dSpawn = bfs(sc[0], sc[1]);
  const rdist = (r, d) => d[I(Math.floor((r.x0 + r.x1) / 2), Math.floor((r.y0 + r.y1) / 2))];

  const cand = rooms.filter((r) => r !== spawnRoom && !r.hall && r.w * r.h >= 6).sort((a, b) => rdist(b, dSpawn) - rdist(a, dSpawn));
  if (cand.length < 3) return null;
  const genRoom = cand[rng.int(1, Math.min(4, cand.length - 1))];
  genRoom.type = 'generator';
  const gc = [Math.floor((genRoom.x0 + genRoom.x1) / 2), Math.floor((genRoom.y0 + genRoom.y1) / 2)];
  const dGen = bfs(gc[0], gc[1]);

  // exit on boundary
  const exits = [];
  for (let x = 2; x < W - 2; x++) {
    if (get(x, 1) === T.CORR && !V_LINES.includes(x)) exits.push({ x, y: 0, ax: x, ay: 1, side: 'N' });
    if (get(x, H - 2) === T.CORR && !V_LINES.includes(x)) exits.push({ x, y: H - 1, ax: x, ay: H - 2, side: 'S' });
  }
  for (let y = 2; y < H - 2; y++) {
    if (get(1, y) === T.CORR && !H_LINES.includes(y)) exits.push({ x: 0, y, ax: 1, ay: y, side: 'W' });
    if (get(W - 2, y) === T.CORR && !H_LINES.includes(y)) exits.push({ x: W - 1, y, ax: W - 2, ay: y, side: 'E' });
  }
  for (const e of exits) e.score = dSpawn[I(e.ax, e.ay)] + 0.8 * dGen[I(e.ax, e.ay)];
  exits.sort((a, b) => b.score - a.score);
  const exit = exits[rng.int(0, Math.min(3, exits.length - 1))];
  if (!exit) return null;
  grid[I(exit.x, exit.y)] = T.EXIT;

  const others = rooms.filter((r) => r !== spawnRoom && r !== genRoom).sort((a, b) => rdist(b, dSpawn) - rdist(a, dSpawn));
  const monsterRoom = others[0];

  // room types
  for (const r of rooms) if (r.hall && !r.type) r.type = 'hall';
  const free = rng.shuffle(rooms.filter((r) => !r.type));
  const big = (r) => r.w >= 3 && r.h >= 3;
  const must = ['morgue', 'nursery', 'bathroom', 'storage', 'office', 'isolation', 'storage'];
  for (const t of must) {
    const r = free.find((x) => !x.type && (t === 'morgue' ? big(x) : t === 'isolation' ? x.w * x.h <= 9 : true));
    if (r) r.type = t;
  }
  for (const r of free) {
    if (r.type) continue;
    r.type = big(r)
      ? rng.pick(['ward', 'ward', 'storage', 'morgue', 'nursery', 'office'])
      : rng.pick(['office', 'office', 'bathroom', 'isolation', 'storage']);
  }

  return {
    W, H, grid, roomOf, rooms, doors, barricades, spawnRoom, genRoom, monsterRoom, exit,
    dSpawn, get, I,
  };
}
