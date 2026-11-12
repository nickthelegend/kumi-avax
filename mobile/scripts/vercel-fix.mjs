// Vercel's CLI never uploads folders named node_modules, so the fonts and images that
// `expo export --platform web` writes to dist/assets/node_modules/ 404 on Vercel and the
// app waits on its fonts forever. Move them to dist/assets/nm/ and point the bundles there.
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const from = join(dist, 'assets/node_modules');
if (existsSync(from)) renameSync(from, join(dist, 'assets/nm'));

let changed = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html|json|css)$/.test(name)) {
      const s = readFileSync(p, 'utf8');
      const t = s.replaceAll('/assets/node_modules/', '/assets/nm/');
      if (t !== s) { writeFileSync(p, t); changed++; }
    }
  }
};
walk(dist);
writeFileSync(join(dist, 'vercel.json'), JSON.stringify({
  rewrites: [{ source: '/((?!_expo/|assets/).*)', destination: '/index.html' }],
}, null, 2));
console.log(`vercel-fix: ${changed} files now point at /assets/nm/`);
