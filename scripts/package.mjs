// Stages an upload-ready copy of the site for a sub-folder of another web server
// (e.g. https://nebosolutions.co.uk/iraq/): dist/iraq/ = public/ + Apache .htaccess + version.txt
// Usage: node scripts/package.mjs [folder-name]      (default: iraq)
import { cp, rm, copyFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';

const name = process.argv[2] || 'iraq';
const root = new URL('../', import.meta.url);
const out = new URL(`dist/${name}/`, root);

await rm(new URL('dist/', root), { recursive: true, force: true });
await cp(new URL('public/', root), out, { recursive: true });
await copyFile(new URL('deploy/htaccess', root), new URL('.htaccess', out));
await copyFile(new URL('deploy/vendor-htaccess', root), new URL('vendor/.htaccess', out));

let commit = 'unknown';
try { commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch { /* not a git checkout */ }
await writeFile(new URL('version.txt', out), `Iraq Solar Model\ncommit ${commit}\nbuilt ${new Date().toISOString()}\n`);
console.log(`Staged dist/${name}/ (commit ${commit})`);
