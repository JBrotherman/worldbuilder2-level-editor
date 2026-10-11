#!/usr/bin/env node
// Builds the browser version and serves it locally, to try it before
// publishing: node tools/serve-web.js [port] [--game] [--zip file.zip]
// With --game it also serves your own game files under /__game/ (only on
// this PC), so tests can load them without the folder picker; --zip serves
// a zip of the game as /__game/test.zip.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { build } = require('./build-web');
const paths = require('./paths');

const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a))) || 4400;
const SERVE_GAME = process.argv.includes('--game');
const zipArg = process.argv.indexOf('--zip');
const TEST_ZIP = zipArg > 0 ? path.resolve(process.argv[zipArg + 1]) : null;
const OUT = build();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

// /__game/wb2/<file in the WorldBuilder 2 folder>, /__game/wb1.dcr, and
// /__game/list (the WorldBuilder 2 files).
function gameFile(p) {
  if (p === '/__game/list') {
    const dir = paths.wb2Dir();
    return Buffer.from(JSON.stringify(fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).map((f) => f.split(path.sep).join('/'))));
  }
  if (p === '/__game/test.zip') return TEST_ZIP && fs.existsSync(TEST_ZIP) ? fs.readFileSync(TEST_ZIP) : null;
  if (p === '/__game/wb1.dcr') return fs.existsSync(paths.wb1Dcr()) ? fs.readFileSync(paths.wb1Dcr()) : null;
  if (p.startsWith('/__game/wb2/')) {
    const dir = paths.wb2Dir();
    const file = path.join(dir, p.slice('/__game/wb2/'.length));
    return file.startsWith(dir + path.sep) && fs.existsSync(file) ? fs.readFileSync(file) : null;
  }
  return null;
}

http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (SERVE_GAME && p.startsWith('/__game/')) {
    const data = gameFile(p);
    res.writeHead(data ? 200 : 404, { 'Content-Type': 'application/octet-stream' });
    return res.end(data || '');
  }
  const file = path.join(OUT, p === '/' ? 'index.html' : p);
  if (!file.startsWith(OUT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': (MIME[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(file));
}).listen(PORT, '127.0.0.1', () => console.log(`Browser version: http://localhost:${PORT}/${SERVE_GAME ? '  (serving your game files for tests)' : ''}`));
