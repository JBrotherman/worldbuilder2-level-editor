#!/usr/bin/env node
// Local server for the level editor: serves the editor, game sprites and
// catalog, stores custom levels in levels/, and builds + launches the game.
// Usage: node tools/server.js [port] [--open]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const game = require('./game');
const catalog = require('./catalog');
const { createSpriteStore } = require('./sprites');
const gameWindow = require('./window');

const ROOT = path.join(__dirname, '..');
const EDITOR_DIR = path.join(ROOT, 'editor');
const LEVELS_DIR = path.join(ROOT, 'levels');
const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a))) || 4321;
const OPEN_BROWSER = process.argv.includes('--open');
// The game always unlocks mission 1.1, so custom levels are played there.
const PLAY_SLOT = 'map1.1';

const cat = catalog.build();
const sprites = createSpriteStore(cat.game.movie);
const catalogJson = JSON.stringify({
  config: cat.config,
  terrain: cat.terrain,
  levels: cat.levels,
  sprites: sprites.info(),
});

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type + (type.startsWith('text') || type.endsWith('json') ? '; charset=utf-8' : ''), 'Cache-Control': 'no-store' });
  res.end(body);
}
const json = (res, obj, status = 200) => send(res, status, JSON.stringify(obj));

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Custom level file names: keep them simple and inside levels/.
function levelPath(file) {
  if (!/^[\w\- ]{1,64}$/.test(file)) throw Object.assign(new Error('invalid file name'), { status: 400 });
  return path.join(LEVELS_DIR, file + '.txt');
}

function play({ text, title }) {
  const g = game.load();
  game.setText(g, PLAY_SLOT, text);
  const names = game.getText(g, 'level names').split('\n');
  const t = String(title || 'Custom Level').replace(/[\r\n]/g, ' ').slice(0, 40);
  game.setText(g, 'level names', names.map((l) => (/^1\s+1\s/.test(l) ? `1 1 ${t}` : l)).join('\n'));
  let outDir;
  try {
    outDir = game.writeBuild(g);
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      throw Object.assign(new Error('The game is still running. Close it and press Play again.'), { status: 409 });
    }
    throw e;
  }
  const { scaled } = gameWindow.launch(path.join(outDir, 'Launcher.exe'));
  return { ok: true, slot: PLAY_SLOT, scaled };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);

  if (p === '/api/catalog') return send(res, 200, catalogJson);

  if (p === '/api/level') {
    const id = url.searchParams.get('id');
    if (!cat.levels.some((l) => l.id === id)) return json(res, { error: 'unknown level' }, 404);
    return send(res, 200, game.getText(cat.game, id), 'text/plain');
  }

  if (p === '/api/custom' && req.method === 'GET' && !url.searchParams.has('file')) {
    fs.mkdirSync(LEVELS_DIR, { recursive: true });
    const files = fs.readdirSync(LEVELS_DIR).filter((f) => f.endsWith('.txt')).map((f) => {
      const st = fs.statSync(path.join(LEVELS_DIR, f));
      return { file: f.slice(0, -4), modified: st.mtimeMs };
    }).sort((a, b) => b.modified - a.modified);
    return json(res, files);
  }

  if (p === '/api/custom') {
    const file = levelPath(url.searchParams.get('file') || '');
    if (req.method === 'GET') {
      if (!fs.existsSync(file)) return json(res, { error: 'not found' }, 404);
      return send(res, 200, fs.readFileSync(file, 'latin1'), 'text/plain');
    }
    if (req.method === 'PUT') {
      const text = await readBody(req);
      fs.mkdirSync(LEVELS_DIR, { recursive: true });
      fs.writeFileSync(file, text, 'latin1');
      return json(res, { ok: true });
    }
    if (req.method === 'DELETE') {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return json(res, { ok: true });
    }
  }

  if (p === '/api/play' && req.method === 'POST') {
    return json(res, play(JSON.parse(await readBody(req))));
  }

  const sprite = /^\/sprite\/(.+)\.png$/.exec(p);
  if (sprite) {
    const img = sprites.render(sprite[1]);
    if (!img) return send(res, 404, 'no sprite', 'text/plain');
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' });
    return res.end(img.png);
  }

  // Static editor files.
  const rel = p === '/' ? 'index.html' : p.slice(1);
  const file = path.join(EDITOR_DIR, rel);
  if (!file.startsWith(EDITOR_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'not found', 'text/plain');
  }
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
}

http.createServer((req, res) => {
  handle(req, res).catch((e) => json(res, { error: e.message }, e.status || 500));
}).listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`WorldBuilder 2 level editor: ${url}  (close this window to stop it)`);
  if (OPEN_BROWSER) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
});
