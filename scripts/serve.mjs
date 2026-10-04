// Zero-dependency static server for local development and the e2e tests.
// Usage: node scripts/serve.mjs [port]   (default 5173, or $PORT)
//        SERVE_ROOT=dist node scripts/serve.mjs 5190   → serves the packaged copy at /iraq/
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.SERVE_ROOT
  ? resolve(fileURLToPath(new URL('../', import.meta.url)), process.env.SERVE_ROOT) + sep
  : fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 5173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
// Mirror the production Content-Security-Policy from netlify.toml so local runs and e2e tests catch CSP breakage.
const csp = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8').match(/Content-Security-Policy = "([^"]+)"/)?.[1];

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(root, path.endsWith('/') ? path + 'index.html' : path));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403).end(); return; }
  // Like Apache: /iraq → /iraq/ for folders, so relative links resolve correctly
  if (!path.endsWith('/') && (await stat(file).catch(() => null))?.isDirectory()) {
    res.writeHead(301, { Location: path + '/' }).end(); return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', ...(csp && { 'Content-Security-Policy': csp }) });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(port, () => console.log(`Iraq solar model running at http://localhost:${port}`));
