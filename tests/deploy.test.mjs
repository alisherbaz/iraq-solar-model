// Guards the deployment configs: the same security policy everywhere the app is hosted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const header = (src, name, re) => src.match(re(name))?.[1];
const toml = n => new RegExp(`${n} = "([^"]+)"`);
const apache = n => new RegExp(`Header always set ${n} "([^"]+)"`);

test('Apache .htaccess (nebosolutions.co.uk/iraq/) matches the Netlify security headers', () => {
  const netlify = read('netlify.toml'), htaccess = read('deploy/htaccess');
  for (const h of ['Content-Security-Policy', 'Permissions-Policy', 'X-Frame-Options', 'Referrer-Policy', 'X-Content-Type-Options']) {
    const a = header(netlify, h, toml), b = header(htaccess, h, apache);
    assert.ok(a, `${h} missing from netlify.toml`);
    assert.equal(b, a, `${h} differs between netlify.toml and deploy/htaccess`);
  }
});

test('CSP allows every external service the app calls', () => {
  const csp = header(read('netlify.toml'), 'Content-Security-Policy', toml);
  for (const host of ['https://power.larc.nasa.gov', 'https://nominatim.openstreetmap.org']) assert.match(csp, new RegExp(`connect-src[^;]*${host}`));
  assert.match(csp, /img-src[^;]*https:\/\/server\.arcgisonline\.com/);
  const app = read('public/map.js') + read('public/geo.js');
  for (const url of app.match(/https:\/\/[a-z0-9.-]+/g)) {
    if (/google\.com|power\.larc|nominatim|arcgisonline/.test(url)) continue;
    assert.fail(`unexpected external host in app code: ${url}`);
  }
});

test('all app asset links are relative (works from a sub-folder such as /iraq/)', () => {
  const html = read('public/index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1]).filter(u => !/^https?:/.test(u));
  assert.ok(refs.length > 5);
  for (const r of refs) assert.ok(!r.startsWith('/'), `root-relative path breaks under /iraq/: ${r}`);
});
