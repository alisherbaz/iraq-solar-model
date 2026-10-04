// Stages an upload-ready copy of the site for a sub-folder of another web server
// (live at https://nebosolutions.co.uk/solar/):
//
//   dist/solar/index.html          ← always re-checked by browsers (no-cache via .htaccess)
//   dist/solar/.htaccess, version.txt
//   dist/solar/a-<contenthash>/…   ← every script, stylesheet and library
//
// Some hosts (e.g. SiteGround's nginx) serve static files with a 1-year cache and ignore
// .htaccess for them. Putting the assets in a folder named after their content hash means
// each release gets new URLs, so visitors never mix a new page with year-old scripts.
//
// Usage: node scripts/package.mjs [folder-name]      (default: solar)
import { cp, rm, copyFile, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const name = process.argv[2] || 'solar';
const root = new URL('../', import.meta.url);
const pub = fileURLToPath(new URL('public/', root));

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    out.push(...(e.isDirectory() ? await walk(p) : [p]));
  }
  return out.sort();
}

// Content hash of everything except index.html
const hash = createHash('sha256');
for (const f of await walk(pub)) if (!f.endsWith('index.html')) hash.update(f.slice(pub.length)).update(await readFile(f));
const assets = 'a-' + hash.digest('hex').slice(0, 10);

const out = new URL(`dist/${name}/`, root);
await rm(new URL('dist/', root), { recursive: true, force: true });
await cp(new URL('public/', root), new URL(assets + '/', out), { recursive: true });
await rm(new URL(`${assets}/index.html`, out));

// index.html: point every relative asset reference into the hashed folder
let html = await readFile(new URL('public/index.html', root), 'utf8');
let n = 0;
html = html.replace(/(src|href)="(?!https?:|#|\/|mailto:)([^"]+)"/g, (_, attr, path) => { n++; return `${attr}="${assets}/${path}"`; });
await writeFile(new URL('index.html', out), html);

await copyFile(new URL('deploy/htaccess', root), new URL('.htaccess', out));
await copyFile(new URL('deploy/vendor-htaccess', root), new URL(`${assets}/vendor/.htaccess`, out));

let commit = 'unknown';
try { commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch { /* not a git checkout */ }
await writeFile(new URL('version.txt', out), `Iraq Solar Model\ncommit ${commit}\nassets ${assets}\nbuilt ${new Date().toISOString()}\n`);
console.log(`Staged dist/${name}/ (commit ${commit}, ${assets}, ${n} references rewritten)`);
