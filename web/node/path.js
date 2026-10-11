// POSIX-style path functions for the browser version's virtual file system.
'use strict';

function normalize(p) {
  const abs = p.startsWith('/');
  const out = [];
  for (const part of p.split(/[\\/]+/)) {
    if (!part || part === '.') continue;
    if (part === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!abs) out.push('..'); } else out.push(part);
  }
  const s = (abs ? '/' : '') + out.join('/');
  return s || (abs ? '/' : '.');
}

const join = (...parts) => normalize(parts.filter((x) => x !== '').join('/'));

function resolve(...parts) {
  let p = '';
  for (const part of parts) p = part.startsWith('/') ? part : p ? `${p}/${part}` : part;
  return normalize(p.startsWith('/') ? p : `/${p}`);
}

function dirname(p) {
  const n = normalize(p);
  const i = n.lastIndexOf('/');
  return i < 0 ? '.' : i === 0 ? '/' : n.slice(0, i);
}

function basename(p, ext) {
  const b = normalize(p).split('/').pop();
  return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
}

function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i) : '';
}

function relative(from, to) {
  const a = resolve(from).split('/').filter(Boolean);
  const b = resolve(to).split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

const isAbsolute = (p) => p.startsWith('/');

module.exports = { sep: '/', delimiter: ':', normalize, join, resolve, dirname, basename, extname, relative, isAbsolute, posix: null };
module.exports.posix = module.exports;
