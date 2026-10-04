// Builds the nebosolutions.co.uk upload package and checks it is self-consistent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('upload package: hashed asset folder, every reference resolves, .htaccess included', () => {
  execFileSync(process.execPath, ['scripts/package.mjs', 'solar'], { cwd: root });
  const dir = root + 'dist/solar/';
  const html = readFileSync(dir + 'index.html', 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1]).filter(u => !/^https?:/.test(u));
  assert.ok(refs.length >= 6);
  const assets = readdirSync(dir).filter(d => d.startsWith('a-'));
  assert.equal(assets.length, 1, 'exactly one hashed asset folder');
  for (const r of refs) {
    assert.ok(r.startsWith(assets[0] + '/'), `not cache-busted: ${r}`);
    assert.ok(existsSync(dir + r), `missing file: ${r}`);
  }
  // ES-module imports inside app.js are relative, so they resolve within the hashed folder too
  for (const m of readFileSync(dir + assets[0] + '/app.js', 'utf8').matchAll(/from '\.\/([^']+)'/g)) {
    assert.ok(existsSync(dir + assets[0] + '/' + m[1]), `missing module ${m[1]}`);
  }
  assert.ok(existsSync(dir + '.htaccess'));
  assert.ok(existsSync(dir + 'version.txt'));
});
