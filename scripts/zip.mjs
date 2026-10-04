// Zips dist/<folder>/ into dist/iraq-solar-model.zip (folder kept as the top-level entry).
// Zero dependencies: Node's zlib (deflate + crc32, Node ≥ 22.2). Dotfiles such as .htaccess are included.
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { deflateRawSync, crc32 } from 'node:zlib';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const folder = process.argv[2] || 'solar';

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    out.push(...(e.isDirectory() ? await walk(p) : [p]));
  }
  return out;
}

function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

const files = (await walk(join(dist, folder))).sort();
const local = [], central = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(relative(dist, file).split(sep).join('/'));
  const data = await readFile(file), comp = deflateRawSync(data, { level: 9 });
  const crc = crc32(data), { time, date } = dosTime((await stat(file)).mtime);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
  h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12); h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
  local.push(h, name, comp);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x031e, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
  c.writeUInt16LE(8, 10); c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14); c.writeUInt32LE(crc, 16);
  c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28);
  c.writeUInt32LE((0o100644 << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += h.length + name.length + comp.length;
}
const cd = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
const zipPath = join(dist, 'iraq-solar-model.zip');
await writeFile(zipPath, Buffer.concat([...local, cd, end]));
console.log(`Wrote dist/iraq-solar-model.zip (${files.length} files, ${(offset / 1024).toFixed(0)} KB)`);
