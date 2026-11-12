// Tiny static server with SPA fallback for the Expo web build: node qa/serve.mjs <dir> <port>
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const [dir = '../mobile/dist', port = '5352'] = process.argv.slice(2);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(dir, url));
  if (!file.startsWith(normalize(dir))) { res.writeHead(403).end(); return; }
  try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { file = join(dir, 'index.html'); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
}).listen(Number(port), '127.0.0.1', () => console.log(`serving ${dir} on http://127.0.0.1:${port}`));
