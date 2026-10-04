// Copies Chart.js from node_modules into public/vendor so the site has no CDN dependency.
// Run after upgrading chart.js: npm run vendor
import { copyFile, mkdir } from 'node:fs/promises';

const src = new URL('../node_modules/chart.js/dist/chart.umd.min.js', import.meta.url);
const dest = new URL('../public/vendor/chart.umd.min.js', import.meta.url);
await mkdir(new URL('.', dest), { recursive: true });
await copyFile(src, dest);
console.log('Vendored chart.umd.min.js');
