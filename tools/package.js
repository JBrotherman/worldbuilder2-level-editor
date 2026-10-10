#!/usr/bin/env node
// Writes a release zip of the editor to build/, with only the files that may
// be shared: never the LEGO game files, build output or extracted game text.
// Takes the files git tracks (commit first), or, without git, everything in
// the shared folders.
// Usage: node tools/package.js            write build/WB2-Level-Editor-<date>.zip
//        node tools/package.js --list z   list the files in a zip
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { crc32 } = require('./bitmap');

const ROOT = path.join(__dirname, '..');
const FOLDERS = ['editor', 'tools', 'levels', 'campaign'];
const FILES = ['Start Editor.bat', 'Play WorldBuilder 2.bat', 'README.md', 'LICENSE'];
// Must never be shipped, whatever git tracks.
const FORBIDDEN = [
  /^(WorldBuilder2?|build|extracted|node_modules|\.claude|\.git)\//i,
  /\.(dcr|dxr|dir|cst|cct|cxt|exe|dll|x32)$/i,
  /^settings\.json$/i,
];
const TOP = 'WB2-Level-Editor';

const isShared = (f) => FILES.includes(f) || FOLDERS.some((d) => f.startsWith(d + '/'));

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(rel) : [rel];
  });
}

function listFiles() {
  let files;
  try {
    files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
    const untracked = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0').filter((f) => f && isShared(f));
    if (untracked.length) console.log(`Not included (not committed):\n  ${untracked.join('\n  ')}`);
  } catch (e) {
    files = [...FOLDERS.filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap(walk), ...FILES];
  }
  files = files.filter((f) => isShared(f) && fs.existsSync(path.join(ROOT, f))).sort();
  const bad = files.filter((f) => FORBIDDEN.some((re) => re.test(f)));
  if (bad.length) throw new Error(`refusing to package game or build files:\n  ${bad.join('\n  ')}`);
  for (const f of FILES) if (!files.includes(f)) throw new Error(`${f} is missing`);
  return files;
}

function dosDateTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// A plain zip: deflated entries, UTF-8 names, no directory entries.
function writeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data, mtime } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const { time, date } = dosDateTime(mtime);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // made by
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(stored ? 0 : 8, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, body);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

// Names and sizes from a zip's central directory.
function readZipList(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const skip = nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    out.push({ name: buf.toString('utf8', p + 46, p + 46 + nameLen), size });
    p += 46 + skip;
  }
  return out;
}

function printList(list) {
  for (const { name, size } of list) console.log(`${String(size).padStart(9)}  ${name}`);
  console.log(`${list.length} files`);
}

if (process.argv[2] === '--list') {
  printList(readZipList(fs.readFileSync(process.argv[3])));
} else {
  const entries = listFiles().map((f) => {
    const full = path.join(ROOT, f);
    let data = fs.readFileSync(full);
    // Batch files need Windows line endings, whatever the checkout uses.
    if (f.endsWith('.bat')) data = Buffer.from(data.toString('latin1').replace(/\r?\n/g, '\r\n'), 'latin1');
    return { name: `${TOP}/${f}`, data, mtime: fs.statSync(full).mtime };
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const out = path.join(ROOT, 'build', `${TOP}-${stamp}.zip`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, writeZip(entries));
  const list = readZipList(fs.readFileSync(out));
  printList(list);
  console.log(`Wrote ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}
