// Bundles the game into a single self-contained dist/index.html (no external assets).
// Usage: node tools/build.mjs   (requires bun on PATH)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const tmp = path.join(dist, '_game.js');
const bun = process.env.BUN || 'bun';
execFileSync(bun, ['build', path.join(root, 'src/main.js'), '--outfile', tmp, '--minify', '--target', 'browser', '--format', 'esm'], { stdio: 'inherit' });
const js = fs.readFileSync(tmp, 'utf8').replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="style.css" />', () => `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="src/main.js"></script>', () => `<script type="module">\n${js}\n</script>`);
fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.unlinkSync(tmp);
console.log(`dist/index.html written (${(html.length / 1024).toFixed(1)} KB)`);
