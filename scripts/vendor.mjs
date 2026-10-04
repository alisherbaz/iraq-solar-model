// Copies third-party browser libraries from node_modules into public/vendor so the site
// has no CDN dependency. Run after upgrading them: npm run vendor
import { copyFile, mkdir } from 'node:fs/promises';

const FILES = [
  ['chart.js/dist/chart.umd.min.js', 'chart.umd.min.js'],
  ['leaflet/dist/leaflet.js', 'leaflet.js'],
  ['leaflet/dist/leaflet.css', 'leaflet.css'],
];
const dir = new URL('../public/vendor/', import.meta.url);
await mkdir(dir, { recursive: true });
for (const [src, dest] of FILES) {
  await copyFile(new URL('../node_modules/' + src, import.meta.url), new URL(dest, dir));
  console.log('Vendored', dest);
}
