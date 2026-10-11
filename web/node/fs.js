// An in-memory file system with the synchronous fs functions the tools use,
// for the browser version. web/main.js loads it from IndexedDB at startup
// and saves changes back (see onChange).
'use strict';
const { Buffer } = require('buffer');
const path = require('path');

const files = new Map(); // path -> { data: Buffer, mtimeMs }
const dirs = new Set(['/']);
const listeners = [];

const norm = (p) => path.resolve(String(p));

function enoent(p, op) {
  return Object.assign(new Error(`ENOENT: no such file or directory, ${op} '${p}'`), { code: 'ENOENT', path: p });
}

function addDirs(p) {
  for (let d = path.dirname(p); !dirs.has(d); d = path.dirname(d)) dirs.add(d);
}

function emit(p, entry) { for (const fn of listeners) fn(p, entry); }

// Calls fn(path, { data, mtimeMs } | null) after every write or delete.
function onChange(fn) { listeners.push(fn); }

// Puts a file in place without notifying listeners (used when loading).
function mount(p, data, mtimeMs = Date.now()) {
  p = norm(p);
  addDirs(p);
  files.set(p, { data: Buffer.from(data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data), mtimeMs });
}

function existsSync(p) { p = norm(p); return files.has(p) || dirs.has(p); }

function readFileSync(p, opts) {
  p = norm(p);
  const f = files.get(p);
  if (!f) throw enoent(p, 'open');
  const enc = typeof opts === 'string' ? opts : opts && opts.encoding;
  return enc ? f.data.toString(enc) : f.data;
}

function writeFileSync(p, data, opts) {
  p = norm(p);
  if (dirs.has(p)) throw Object.assign(new Error(`EISDIR: illegal operation on a directory, open '${p}'`), { code: 'EISDIR' });
  const enc = typeof opts === 'string' ? opts : opts && opts.encoding;
  const buf = typeof data === 'string' ? Buffer.from(data, enc || 'utf8') : Buffer.from(data);
  addDirs(p);
  const entry = { data: buf, mtimeMs: Date.now() };
  files.set(p, entry);
  emit(p, entry);
}

function mkdirSync(p) {
  p = norm(p);
  addDirs(p + '/x');
}

function children(dir) {
  const prefix = dir === '/' ? '/' : dir + '/';
  const names = new Map();
  for (const set of [files.keys(), dirs]) {
    for (const p of set) {
      if (!p.startsWith(prefix) || p === dir) continue;
      const name = p.slice(prefix.length).split('/')[0];
      if (!names.has(name)) names.set(name, dirs.has(prefix + name));
    }
  }
  return names;
}

function readdirSync(p, opts) {
  p = norm(p);
  if (!dirs.has(p)) throw enoent(p, 'scandir');
  const list = [...children(p)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (opts && opts.withFileTypes) return list.map(([name, isDir]) => ({ name, isDirectory: () => isDir, isFile: () => !isDir }));
  return list.map(([name]) => name);
}

function statSync(p) {
  p = norm(p);
  const f = files.get(p);
  if (!f && !dirs.has(p)) throw enoent(p, 'stat');
  const mtimeMs = f ? f.mtimeMs : 0;
  return { size: f ? f.data.length : 0, mtimeMs, mtime: new Date(mtimeMs), isDirectory: () => !f, isFile: () => !!f };
}

function unlinkSync(p) {
  p = norm(p);
  if (!files.delete(p)) throw enoent(p, 'unlink');
  emit(p, null);
}

function rmSync(p, { recursive = false, force = false } = {}) {
  p = norm(p);
  if (files.has(p)) return unlinkSync(p);
  if (!dirs.has(p)) { if (force) return; throw enoent(p, 'rm'); }
  if (!recursive && children(p).size) throw Object.assign(new Error(`ENOTEMPTY: directory not empty, rm '${p}'`), { code: 'ENOTEMPTY' });
  for (const f of [...files.keys()]) if (f.startsWith(p + '/')) unlinkSync(f);
  for (const d of [...dirs]) if (d === p || d.startsWith(p + '/')) dirs.delete(d);
}

// Copies files (sharing their contents, which are never changed in place).
function cpSync(src, dest) {
  src = norm(src);
  dest = norm(dest);
  if (files.has(src)) {
    addDirs(dest);
    const entry = { data: files.get(src).data, mtimeMs: Date.now() };
    files.set(dest, entry);
    emit(dest, entry);
    return;
  }
  if (!dirs.has(src)) throw enoent(src, 'cp');
  mkdirSync(dest);
  for (const d of [...dirs]) if (d.startsWith(src + '/')) mkdirSync(dest + d.slice(src.length));
  for (const f of [...files.keys()]) if (f.startsWith(src + '/')) cpSync(f, dest + f.slice(src.length));
}

// Every file under dir, as paths relative to it; with withDirs, also every
// folder (ending in "/"), so empty ones are kept.
function listTree(dir, { withDirs = false } = {}) {
  dir = norm(dir);
  const under = (p) => p.startsWith(dir + '/');
  const out = [...files.keys()].filter(under).map((f) => f.slice(dir.length + 1));
  if (withDirs) for (const d of dirs) if (under(d)) out.push(d.slice(dir.length + 1) + '/');
  return out.sort();
}

module.exports = {
  existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync, cpSync,
  onChange, mount, listTree,
};
