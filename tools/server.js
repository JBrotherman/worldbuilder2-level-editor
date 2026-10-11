#!/usr/bin/env node
// Local server for the level editor: serves the editor, game sprites and
// catalog, stores custom levels in levels/, and builds + launches the game.
// Usage: node tools/server.js [port] [--open]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const gameWindow = require('./window');
const paths = require('./paths');
const { createApi } = require('./api');

const ROOT = path.join(__dirname, '..');
const EDITOR_DIR = path.join(ROOT, 'editor');
const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a))) || 4321;
const OPEN_BROWSER = process.argv.includes('--open');

const api = createApi({
  launch: (outDir) => ({ scaled: gameWindow.launch(path.join(outDir, 'Launcher.exe')).scaled }),
});

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

function send(res, status, body, type = 'application/json', cache = false) {
  res.writeHead(status, {
    'Content-Type': type + (type.startsWith('text') || type.endsWith('json') ? '; charset=utf-8' : ''),
    'Cache-Control': cache ? 'max-age=3600' : 'no-store',
  });
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

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);

  // Lets a newly started editor replace this one. The custom header can't be
  // sent cross-origin without a CORS preflight, which we never approve, so
  // web pages can't trigger it.
  if (p === '/api/shutdown' && req.method === 'POST' && req.headers['x-wb2-editor'] === '1') {
    json(res, { ok: true });
    console.log('Another editor window took over. This one is closing.');
    setTimeout(() => process.exit(0), 100);
    return;
  }

  // Setup page: where the game is, and setting its location.
  if (p === '/api/setup') {
    if (req.method === 'GET') {
      api.loadGame({ retry: url.searchParams.has('retry') });
      return json(res, api.status());
    }
    // Same custom-header guard as /api/shutdown: web pages can't send it.
    if (req.method === 'POST' && req.headers['x-wb2-editor'] === '1') {
      const { worldBuilder2 } = JSON.parse(await readBody(req) || '{}');
      const dir = typeof worldBuilder2 === 'string' ? worldBuilder2.trim().replace(/^"(.*)"$/, '$1') : '';
      if (!dir) return json(res, { error: 'Enter a folder.' }, 400);
      if (!path.isAbsolute(dir) || !paths.locateWb2(dir)) {
        return json(res, { error: `There is no worldbuilder2.dcr in "${dir}" or its worldbuilder2 subfolder.` }, 400);
      }
      paths.writeSettings({ worldBuilder2: dir });
      api.loadGame({ retry: true });
      return json(res, api.status());
    }
  }

  if (!api.loadGame({ retry: p === '/' }) && (p === '/' || p === '/index.html')) {
    return send(res, 200, fs.readFileSync(path.join(EDITOR_DIR, 'setup.html')), 'text/html');
  }
  if (p.startsWith('/api/') || p.startsWith('/sprite/')) {
    const body = ['PUT', 'POST'].includes(req.method) ? await readBody(req) : '';
    const r = api.handle(req.method, p, url.searchParams, body);
    if (r) return send(res, r.status, r.body, r.type, r.cache);
  }

  // Static editor files.
  const rel = p === '/' ? 'index.html' : p.slice(1);
  const file = path.join(EDITOR_DIR, rel);
  if (!file.startsWith(EDITOR_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'not found', 'text/plain');
  }
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => json(res, { error: e.message }, e.status || 500));
});

function listen(port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(port); });
  });
}

// If an older editor is already running on the port, ask it to stop so this
// (possibly newer) one takes over.
async function replaceRunningEditor(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
      method: 'POST', headers: { 'X-WB2-Editor': '1' }, signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
  } catch (e) {
    return false;
  }
  await new Promise((r) => setTimeout(r, 500));
  return true;
}

(async () => {
  let port = PORT;
  for (let attempt = 0; ; attempt++) {
    try {
      await listen(port);
      break;
    } catch (e) {
      if (e.code !== 'EADDRINUSE' || attempt >= 10) throw e;
      if (port === PORT && attempt === 0 && await replaceRunningEditor(port)) {
        console.log('Replaced an editor that was already running.');
        continue;
      }
      port++; // something else uses this port; try the next one
    }
  }
  const url = `http://localhost:${port}/`;
  console.log(`WorldBuilder 2 level editor: ${url}  (close this window to stop it)`);
  if (!api.loadGame()) {
    const { dcr } = paths.wb2Status();
    console.log(`
WorldBuilder 2 was not found (looked for ${dcr}).
The editor page explains where to put the game.`);
  }
  if (OPEN_BROWSER) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
})().catch((e) => {
  console.error(`Could not start the editor: ${e.message}`);
  process.exit(1);
});
