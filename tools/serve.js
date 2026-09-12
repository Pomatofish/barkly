// tools/serve.js — zero-dependency static server for test pages.
//   node tools/serve.js            → http://localhost:8123/  (repo root)
//   node tools/serve.js 9000       → custom port
// Needed because file:// pages cannot fetch() fixtures or import ES modules.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 8123;

// Dev routes: serve the saved fixtures under Instagram-shaped paths so the
// extension (loaded unpacked, with the dev localhost match in manifest.json)
// sees URLs its page-type detection understands. Example:
//   http://localhost:8123/p/C9xY2kLpQ7a/        → fixtures/post.html
//   http://localhost:8123/reel/DA7mQ2ZtVbn/     → fixtures/reel.html
//   http://localhost:8123/stories/nomad.bites/1/ → fixtures/story.html
//   http://localhost:8123/quiet.club/           → fixtures/private-profile.html
//   http://localhost:8123/lena.explores/        → fixtures/profile.html
//   http://localhost:8123/feed/                 → fixtures/feed.html
//   http://localhost:8123/create/style/         → fixtures/composer.html
const FIX = 'src/context/fixtures';
const ROUTES = [
  [/^\/p\/DB1QuietZ9k\/?$/, `${FIX}/private-post.html`],   // post owned by the private account (row 1)
  [/^\/accounts\/.*$/, `${FIX}/unknown.html`],           // e.g. /accounts/edit/ → unknown page (row 3)
  [/^\/p\/[^/]+\/?$/, `${FIX}/post.html`],
  [/^\/(reel|reels)\/[^/]+\/?$/, `${FIX}/reel.html`],
  [/^\/stories\/[^/]+\/[^/]+\/?$/, `${FIX}/story.html`],
  [/^\/quiet\.club\/?$/, `${FIX}/private-profile.html`],
  [/^\/lena\.explores\/?$/, `${FIX}/profile.html`],
  [/^\/$/, `${FIX}/feed.html`],                      // site root → feed (the detector reads "/" as feed)
  [/^\/create\/[^/]*\/?$/, `${FIX}/composer.html`],
];
function route(pathname) {
  for (const [re, file] of ROUTES) if (re.test(pathname)) return file;
  return null;
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webm': 'audio/webm', '.mp3': 'audio/mpeg', '.txt': 'text/plain',
};

http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const routed = route(url.pathname);
    let p = path.normalize(path.join(root, routed || decodeURIComponent(url.pathname)));
    if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
}).listen(port, () => console.log(`serving ${root} at http://localhost:${port}/`));
