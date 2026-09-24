/**
 * Zips a built dist/ into one file to upload.
 *
 *   npm run package
 *
 * This exists because of a specific failure. The site was uploaded folder by
 * folder and `icons/` was missed; every file under it answered 404 while the
 * directory itself answered 403, so it had been created and left empty. The
 * app looked and behaved perfectly — the only symptom was that browsers
 * stopped offering to install it and the installed app had no icon of its own,
 * because a manifest whose icons cannot be fetched fails the installability
 * check silently.
 *
 * One archive cannot lose a folder. It also cannot lose `.htaccess`, which is
 * a dotfile and is exactly the sort of thing an upload client hides.
 *
 * So the archive is not written until everything that has to be in it is
 * verified present, and the manifest is read to get that list rather than
 * being told it — a sixth icon added there tomorrow is checked tomorrow.
 */

import { deflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const { version, name } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(DIST).map((f) => ({
  path: relative(DIST, f).split(sep).join('/'),
  body: readFileSync(f),
}));
const have = new Set(files.map((f) => f.path));

/* What must be there. The icons come from the manifest the build just wrote,
   so this list cannot drift away from what the app actually asks for. */
const manifestName = [...have].find((p) => p.endsWith('.webmanifest'));
if (!manifestName) throw new Error('no .webmanifest in dist/ — did the build run?');
const manifest = JSON.parse(readFileSync(join(DIST, manifestName), 'utf8'));

const required = [
  'index.html',
  manifestName,
  // Sign-in with Todoist fetches this file by URL; without it Todoist refuses the app.
  'oauth/client.json',
  // The security headers and the SPA fallback; a dotfile, so easy to lose.
  '.htaccess',
  ...manifest.icons.map((icon) => icon.src.replace(/^\.?\//, '')),
  ...[...readFileSync(join(DIST, 'index.html'), 'utf8').matchAll(/(?:href|src)="\.\/([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => !p.startsWith('http')),
];

const missing = [...new Set(required)].filter((p) => !have.has(p));
if (missing.length) {
  console.error('\nNot packaging. These are referenced but not in dist/:\n');
  for (const p of missing) console.error(`  ${p}`);
  console.error('\nRun `npm run build` (and `npm run icons` if an icon is missing).\n');
  process.exit(1);
}

/* ---------- zip ---------- */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const locals = [];
const central = [];
let offset = 0;

for (const { path, body } of files) {
  const nameBuf = Buffer.from(path, 'utf8');
  const deflated = deflateRawSync(body, { level: 9 });
  // Stored, when compressing made it bigger — true for the PNGs.
  const useStore = deflated.length >= body.length;
  const data = useStore ? body : deflated;
  const method = useStore ? 0 : 8;
  const crc = crc32(body);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);           // UTF-8 names
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  locals.push(local, nameBuf, data);

  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0);
  dir.writeUInt16LE(20, 4);
  dir.writeUInt16LE(20, 6);
  dir.writeUInt16LE(0x0800, 8);
  dir.writeUInt16LE(method, 10);
  dir.writeUInt32LE(crc, 16);
  dir.writeUInt32LE(data.length, 20);
  dir.writeUInt32LE(body.length, 24);
  dir.writeUInt16LE(nameBuf.length, 28);
  dir.writeUInt32LE(offset, 42);
  central.push(dir, nameBuf);

  offset += local.length + nameBuf.length + data.length;
}

const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

const out = join(ROOT, `${name}-${version}.zip`);
writeFileSync(out, Buffer.concat([...locals, centralBuf, end]));

const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(`\n${relative(ROOT, out)}  —  ${files.length} files, ${kb(statSync(out).size)}`);
console.log('\nChecked present:');
for (const p of [...new Set(required)].sort()) console.log(`  ${p}`);
console.log('\nUnzip the whole thing at the site root, folders included.\n');
