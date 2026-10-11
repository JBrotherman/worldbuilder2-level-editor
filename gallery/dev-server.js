#!/usr/bin/env node
// Runs the gallery Worker locally, with Node's built-in SQLite standing in
// for Cloudflare D1: node gallery/dev-server.js [port] [--memory]
// The database is build/gallery-dev.sqlite (or in memory with --memory).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a))) || 8787;
const file = process.argv.includes('--memory') ? ':memory:' : path.join(DIR, '..', 'build', 'gallery-dev.sqlite');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

// The parts of the D1 API the Worker uses.
function d1(db) {
  return {
    prepare(sql) {
      const bound = (args) => ({
        bind: (...a) => bound(a),
        async first() { const r = db.prepare(sql).get(...args); return r === undefined ? null : { ...r }; },
        async all() { return { results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }; },
        async run() { db.prepare(sql).run(...args); return { success: true }; },
      });
      return bound([]);
    },
  };
}

const db = new DatabaseSync(file);
db.exec(fs.readFileSync(path.join(DIR, 'schema.sql'), 'utf8'));
const env = { DB: d1(db), ADMIN_TOKEN: process.env.ADMIN_TOKEN || '', IP_SALT: 'dev' };

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  headers.set('CF-Connecting-IP', req.headers['x-test-ip'] || req.socket.remoteAddress);
  const request = new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, '127.0.0.1', () => console.log(`Gallery (local): http://localhost:${PORT}/  database: ${file}`));
