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
const { execFileSync } = require('child_process');
const { writeZip, readZipList } = require('./zip');

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
