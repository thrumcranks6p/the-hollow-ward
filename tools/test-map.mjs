import { generateMap, T } from '../src/world/mapgen.js';

const chars = { [T.WALL]: '#', [T.ROOM]: '.', [T.CORR]: ' ', [T.DOOR]: 'D', [T.BARR]: 'X', [T.EXIT]: 'E' };
let fails = 0;
for (let s = 1; s <= 300; s++) {
  try {
    const m = generateMap(s * 1013);
    if (s <= 1) {
      let out = '';
      for (let y = 0; y < m.H; y++) {
        let row = '';
        for (let x = 0; x < m.W; x++) {
          const r = m.roomOf[m.I(x, y)];
          let c = chars[m.grid[m.I(x, y)]];
          if (m.grid[m.I(x, y)] === T.ROOM && r === m.spawnRoom.id) c = 'S';
          if (m.grid[m.I(x, y)] === T.ROOM && r === m.genRoom.id) c = 'G';
          if (m.grid[m.I(x, y)] === T.ROOM && r === m.monsterRoom.id) c = 'M';
          row += c;
        }
        out += row + '\n';
      }
      console.log(out);
      console.log(m.rooms.map((r) => `${r.id}:${r.type}(${r.w}x${r.h})`).join(' '));
      console.log('doors', m.doors.length, 'barricades', m.barricades.length, 'exit', m.exit);
    }
  } catch (e) {
    fails++;
    console.log('seed fail', s, e.message);
  }
}
console.log('fails', fails);
