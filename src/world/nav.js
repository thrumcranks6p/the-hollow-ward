// Grid A* (8-directional, no corner cutting) used by the monster AI.
import { W, H, T } from './mapgen.js';

class Heap {
  constructor() { this.a = []; }
  push(n, f) {
    const a = this.a;
    a.push([f, n]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }
  get size() { return this.a.length; }
}

const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

export function findPath(world, sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  const walk = (x, y) => world.monsterWalkable(x, y);
  if (!walk(tx, ty)) return null;
  const g = new Float32Array(W * H).fill(Infinity);
  const from = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const I = (x, y) => y * W + x;
  const h = (x, y) => {
    const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  const heap = new Heap();
  const s = I(sx, sy);
  g[s] = 0;
  heap.push(s, h(sx, sy));
  const target = I(tx, ty);
  let iter = 0;
  while (heap.size && iter++ < 4000) {
    const c = heap.pop();
    if (c === target) break;
    if (closed[c]) continue;
    closed[c] = 1;
    const cx = c % W, cy = (c / W) | 0;
    for (const [dx, dy, cost] of N8) {
      const nx = cx + dx, ny = cy + dy;
      if (!walk(nx, ny)) continue;
      if (dx && dy) {
        if (!walk(cx + dx, cy) || !walk(cx, cy + dy)) continue;
        if (world.get(cx + dx, cy) === T.DOOR || world.get(cx, cy + dy) === T.DOOR || world.get(nx, ny) === T.DOOR || world.get(cx, cy) === T.DOOR) continue;
      }
      const n = I(nx, ny);
      let extra = 0;
      if (world.doorClosed(nx, ny)) extra = 3;
      const ng = g[c] + cost + extra;
      if (ng < g[n]) {
        g[n] = ng;
        from[n] = c;
        heap.push(n, ng + h(nx, ny));
      }
    }
  }
  if (from[target] < 0) return null;
  const path = [];
  let c = target;
  while (c !== s && c >= 0) {
    path.push([c % W, (c / W) | 0]);
    c = from[c];
  }
  path.reverse();
  return path;
}

// BFS distance field (cells) from a world cell, used for picking far/near targets
export function distanceField(world, sx, sy) {
  const d = new Int16Array(W * H).fill(-1);
  const q = [sy * W + sx];
  d[q[0]] = 0;
  for (let i = 0; i < q.length; i++) {
    const c = q[i], x = c % W, y = (c / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!world.monsterWalkable(nx, ny)) continue;
      const n = ny * W + nx;
      if (d[n] >= 0) continue;
      d[n] = d[c] + 1;
      q.push(n);
    }
  }
  return d;
}
