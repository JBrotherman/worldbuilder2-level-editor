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
const campaign = require('./campaign');
const wb1 = require('./wb1');
const paths = require('./paths');

const ROOT = path.join(__dirname, '..');
const EDITOR_DIR = path.join(ROOT, 'editor');
const LEVELS_DIR = path.join(ROOT, 'levels');
const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a))) || 4321;
const OPEN_BROWSER = process.argv.includes('--open');
// The game always unlocks mission 1.1, so custom levels are played there.
const PLAY_SLOT = 'map1.1';

// The game is loaded on first use, so the editor can start (and explain what
// to do) when WorldBuilder 2 isn't there yet.
let loaded = null; // { cat, sprites, spriteInfo, originalConfig }
let loadError = null;
function loadGame({ retry = false } = {}) {
  if (loaded || (loadError && !retry)) return loaded;
  loadError = null;
  const status = paths.wb2Status();
  if (!status.found) return null;
  try {
    const cat = catalog.build();
    const sprites = createSpriteStore(cat.game.movie);
    loaded = { cat, sprites, spriteInfo: sprites.info(), originalConfig: game.getText(cat.game, 'config') };
    console.log(`Loaded WorldBuilder 2 from ${path.dirname(status.dcr)}`);
  } catch (e) {
    loadError = `${status.dcr} could not be read as WorldBuilder 2 (${e.message}).`;
    console.error(loadError);
  }
  return loaded;
}

function setupStatus() {
  const status = paths.wb2Status();
  return { ...status, loaded: !!loaded, loadError, wb1Found: fs.existsSync(paths.wb1Dcr()), root: ROOT };
}

// Rebuilt whenever the tuned config changes, so level checks use it.
let catalogJson = null;
function getCatalogJson({ cat, spriteInfo, originalConfig }) {
  if (!catalogJson) {
    const tuned = campaign.loadConfigOverride();
    catalogJson = JSON.stringify({
      config: catalog.parseConfig(tuned != null ? tuned : originalConfig),
      configTuned: tuned != null,
      terrain: cat.terrain,
      levels: cat.levels,
      sprites: spriteInfo,
    });
  }
  return catalogJson;
}

function writeBuildOrExplain(fn) {
  try {
    return fn();
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      throw Object.assign(new Error('The game is still running. Close it and press Play again.'), { status: 409 });
    }
    throw e;
  }
}

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

// Play one level: the original game (with any unit tuning) and the level in
// mission 1.1.
function play({ text, title }) {
  const g = game.load();
  campaign.applyConfig(g);
  game.setText(g, PLAY_SLOT, text);
  const names = game.getText(g, 'level names').split('\n');
  const t = String(title || 'Custom Level').replace(/[\r\n]/g, ' ').slice(0, 40);
  game.setText(g, 'level names', names.map((l) => (/^1\s+1\s/.test(l) ? `1 1 ${t}` : l)).join('\n'));
  const outDir = writeBuildOrExplain(() => game.writeBuild(g));
  const { scaled } = gameWindow.launch(path.join(outDir, 'Launcher.exe'));
  return { ok: true, slot: PLAY_SLOT, scaled };
}

function playCampaign({ freshProgress, unlockAll }) {
  const outDir = writeBuildOrExplain(() => campaign.buildCampaign({ freshProgress: !!freshProgress, unlockAll: !!unlockAll }));
  const { scaled } = gameWindow.launch(path.join(outDir, 'Launcher.exe'));
  return { ok: true, scaled };
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
      loadGame({ retry: url.searchParams.has('retry') });
      return json(res, setupStatus());
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
      loadGame({ retry: true });
      return json(res, setupStatus());
    }
  }

  const g = loadGame({ retry: p === '/' });
  if (!g) {
    if (p === '/' || p === '/index.html') return send(res, 200, fs.readFileSync(path.join(EDITOR_DIR, 'setup.html')), 'text/html');
    if (p.startsWith('/api/') || p.startsWith('/sprite/')) {
      return json(res, { error: 'WorldBuilder 2 was not found. Reload the editor page to see how to set it up.' }, 503);
    }
  }
  const { cat, sprites, originalConfig } = g || {};

  if (p === '/api/catalog') return send(res, 200, getCatalogJson(g));

  if (p === '/api/campaign') {
    if (req.method === 'GET') {
      return json(res, { campaign: campaign.loadCampaign(), original: campaign.originals(cat.game) });
    }
    if (req.method === 'PUT') return json(res, { campaign: campaign.saveCampaign(JSON.parse(await readBody(req))) });
  }
  if (p === '/api/campaign/play' && req.method === 'POST') {
    return json(res, playCampaign(JSON.parse(await readBody(req) || '{}')));
  }

  if (p === '/api/config') {
    if (req.method === 'GET') {
      const tuned = campaign.loadConfigOverride();
      return json(res, { text: tuned != null ? tuned : originalConfig, original: originalConfig, tuned: tuned != null });
    }
    if (req.method === 'PUT') {
      const text = await readBody(req);
      campaign.saveConfigOverride(text.replace(/\r\n?/g, '\n') === originalConfig ? null : text);
      catalogJson = null;
      return json(res, { ok: true });
    }
    if (req.method === 'DELETE') {
      campaign.saveConfigOverride(null);
      catalogJson = null;
      return json(res, { ok: true });
    }
  }

  if (p === '/api/level') {
    const id = url.searchParams.get('id');
    if (!cat.levels.some((l) => l.id === id)) return json(res, { error: 'unknown level' }, 404);
    if (id.startsWith('wb1:')) return send(res, 200, wb1.wb1LevelText(id, cat.terrain.map((t) => t.char)), 'text/plain');
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
  if (!loadGame()) {
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
