// Browser version of the editor: runs the same API as tools/server.js inside
// the page. The visitor's own WorldBuilder 2 files, levels, campaign and unit
// settings are kept in this browser (IndexedDB) and never uploaded. Without
// the game files the editor opens in a preview (terrain only, in colours)
// under a window asking for them; Play, the Campaign and Units tabs ask
// again. "Play" builds the game in the page and saves it to a folder
// (Chrome/Edge) or as a zip, to start Launcher.exe.
'use strict';
const fs = require('fs');
const path = require('path');
const paths = require('../tools/paths');
const { createApi } = require('../tools/api');
const web = require('./shared');

const { ROOT, GAME2_DIR, $, el, nextFrame, hasFolderPicker } = web;
const SEEDED_FLAG = path.join(ROOT, '.seeded');

// The level format's terrain characters (see the README), for the preview
// before the game files are added.
const PREVIEW_TERRAIN = [
  ['.', 'normal'], ['T', 'tree'], ['w', 'water'], ['M', 'mountain'], ['_', 'normal_undiggable'], ['x', 'water_undiggable'],
  ['r', 'water_reefs'], ['@', 'hole'], ['~', 'billboard'], ['#', 'swamp'], ['^', 'volcano'], [':', 'goal'], ['`', 'cement'],
  ['>', 'roadblock'], ['(', 'street1'], ['[', 'street2'], ['{', 'street3'], ['\\', 'street4'], ['/', 'street5'], [')', 'street6'],
  [']', 'street7'], ['}', 'street8'], ['+', 'street9'], ['=', 'street10'], ['-', 'street_undiggable'], ['!', 'tree2'],
  ["'", 'tree3'], ['?', 'tree4'], ['%', 'jungle1'], ['&', 'jungle2'], ['$', 'jungle3'], ['*', 'jungle4'],
].map(([char, name]) => ({ char, name }));

const previewCatalog = () => ({
  preview: true,
  config: { vehicle: {}, building: {}, monster: {} },
  configTuned: false,
  terrain: PREVIEW_TERRAIN,
  levels: [],
  sprites: {},
});

// ------------------------------------------------------------ the API

const api = createApi({
  launch: (outDir, kind, title) => {
    setTimeout(() => web.showPlayDialog(outDir, kind, { title }));
    return { message: '' };
  },
});

let gameLoaded = false;
let markReady;
const ready = new Promise((r) => { markReady = r; });

const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// What needs the game asks for it first (see requestGame).
function gameReason(p) {
  if (/\/play$/.test(p)) return 'play';
  if (p === '/api/campaign') return 'campaign';
  if (p === '/api/config') return 'units';
  return 'other';
}

// The editor calls fetch('/api/...'); answer those here.
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  if (typeof input !== 'string' || !/^\/(api|sprite)\//.test(input)) return realFetch(input, init);
  await ready;
  await nextFrame(); // let "Building…" and similar show before the work
  const url = new URL(input, 'http://editor');
  const p = decodeURIComponent(url.pathname);
  if (!gameLoaded) {
    if (p === '/api/catalog') return jsonResponse(previewCatalog());
    if (p !== '/api/custom') {
      const reason = gameReason(p);
      if (!(await requestGame(reason))) {
        if (reason === 'play') return jsonResponse({ ok: true, message: '' });
        if ((reason === 'campaign' || reason === 'units') && window.wb2) window.wb2.showTab('level');
        return jsonResponse({ error: 'Add your game files (top right) first.' }, 503);
      }
    }
  }
  const r = api.handle((init.method || 'GET').toUpperCase(), p, url.searchParams, typeof init.body === 'string' ? init.body : '')
    || { status: 404, type: 'application/json', body: JSON.stringify({ error: 'not found' }) };
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.type } });
};

// Sprite images: rendered from the game on first use.
const spriteUrls = new Map();
window.WB2_SPRITE_URL = (name) => {
  if (!spriteUrls.has(name)) {
    const img = api.sprites() && api.sprites().render(name);
    if (!img) return 'data:,';
    spriteUrls.set(name, URL.createObjectURL(new Blob([img.png], { type: 'image/png' })));
  }
  return spriteUrls.get(name);
};

// ------------------------------------------------------------ the game files window

// What a folder dropped on the window does (set by showSetup).
let setupDrop = null;

function overlay() {
  let o = $('#wb2Setup');
  if (!o) {
    o = el('div', { id: 'wb2Setup', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wb2SetupTitle' });
    document.body.append(o);
    web.dropTarget(o, (files) => { if (setupDrop) setupDrop(files); });
    // A click on the dimmed editor around the window, or Escape, closes it.
    o.addEventListener('click', (e) => { if (e.target === o && o.dismiss) o.dismiss(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !o.hidden && o.dismiss) o.dismiss(); });
  }
  o.hidden = false;
  return o;
}

function hideOverlay() {
  const o = $('#wb2Setup');
  if (o) { o.hidden = true; o.dismiss = null; }
  setupDrop = null;
}

// Full-screen, while a stored game loads at startup.
function showLoading(text) {
  const o = overlay();
  o.className = '';
  o.dismiss = null;
  o.replaceChildren(el('div', { class: 'wb2-card' }, el('p', { class: 'wb2-loading' }, text)));
}

const HEADINGS = {
  start: 'Welcome to the WorldBuilder 2 Level Editor',
  play: 'Add your game files to play',
  campaign: 'The Campaign tab needs your game files',
  units: 'The Units tab needs your game files',
};

// The window over the editor asking for the game files. done(true) once
// they're added and loaded, done(false) when it's closed.
function showSetup({ reason = 'button', error = null, done }) {
  const o = overlay();
  o.className = 'modal';
  const finish = (ok) => { hideOverlay(); done(ok); };
  o.dismiss = () => finish(false);
  const status = el('p', { class: 'wb2-status' + (error ? ' error' : ''), role: 'status' }, error || '');
  let wantWb1 = null;
  const onPick = async (files) => {
    status.className = 'wb2-status';
    status.textContent = 'Reading the game files…';
    try {
      const found = await web.importFolder(files);
      if (!found.wb2) throw new Error('No WorldBuilder 2 there (no worldbuilder2.dcr). Choose the WorldBuilder 2 folder (the one with Launcher.exe and worldbuilder2.dcr, or the folder above it), or the zip it came in.');
      if (wantWb1) await web.importFolder(wantWb1, { wb1Only: true });
      await web.flush();
    } catch (e) {
      status.className = 'wb2-status error';
      status.textContent = e.message;
      return;
    }
    status.textContent = 'Loading your game…';
    await nextFrame();
    const loadError = await switchToGame();
    if (loadError) {
      status.className = 'wb2-status error';
      status.textContent = loadError;
      return;
    }
    finish(true);
  };
  const [pick, pickInput] = web.folderPicker('Choose the folder', onPick);
  const [zip, zipInput] = web.zipPicker('choose the zip file', onPick);
  const drop = el('div', { class: 'wb2-drop' },
    el('div', { class: 'wb2-drop-icon', 'aria-hidden': 'true' }, '📁'),
    el('p', {}, el('strong', {}, 'Drag your WorldBuilder2 folder here')),
    el('p', { class: 'muted' }, 'or'),
    el('div', { class: 'wb2-actions' }, pick, pickInput),
    el('p', { class: 'muted wb2-zip-line' }, 'Have the game as a .zip? Drag it here too, or ', zip, zipInput, '.'));
  const wb1Note = el('span', { class: 'muted' });
  const [pick1, pick1Input] = web.folderPicker('Choose the WorldBuilder folder', (files) => {
    if (![...files].some((f) => f.name.toLowerCase() === 'worldbuilder.dcr' || /\.zip$/i.test(f.name))) {
      wb1Note.textContent = ' No worldbuilder.dcr there.';
      return;
    }
    wantWb1 = files;
    wb1Note.textContent = ' ✓ WorldBuilder will be added.';
  }, { primary: false });

  const intro = reason === 'start'
    ? el('p', { class: 'wb2-lead' }, 'Make your own missions and campaigns for LEGO WorldBuilder 2, and play them in the real game. For the game\'s pictures, vehicles, buildings and to play, the editor uses your own copy of WorldBuilder 2: show it where it is. Or look around the editor first.')
    : el('p', { class: 'wb2-lead' }, 'The editor uses your own copy of WorldBuilder 2 for the game\'s pictures, vehicles, buildings and rules, and to play. Show it where your game is, once.');

  o.replaceChildren(el('div', { class: 'wb2-card' },
    el('button', { type: 'button', class: 'wb2-close', title: 'Close (Esc)', 'aria-label': 'Close', onclick: o.dismiss }, '×'),
    el('h1', { id: 'wb2SetupTitle' }, el('span', { class: 'brick' }), HEADINGS[reason] || 'Add your game files'),
    intro,
    el('p', {}, 'The folder with ', el('code', {}, 'Launcher.exe'), ' and ', el('code', {}, 'worldbuilder2.dcr'), ' in it, or the folder above it:'),
    drop,
    status,
    el('p', { class: 'muted' }, 'The game files stay on your computer: this page only reads them and keeps a copy in this browser. Nothing is uploaded.',
      hasFolderPicker ? '' : ' (If you use the button, your browser calls it "uploading"; dragging the folder avoids that.)'),
    web.gameHelp(),
    el('details', { class: 'wb2-help' },
      el('summary', {}, 'Optional: also have the original LEGO WorldBuilder?'),
      el('p', {}, 'It adds the scorpion and T-Rex animations and its 60 missions as templates. Choose its folder before your WorldBuilder 2 folder, or drag both folders in together.'),
      el('div', { class: 'wb2-actions' }, pick1, pick1Input, wb1Note)),
    el('div', { class: 'wb2-card-footer' },
      el('button', { type: 'button', onclick: o.dismiss }, reason === 'start' ? 'Look around the editor first' : 'Not now')),
    el('p', { class: 'muted wb2-legal' }, 'LEGO and WorldBuilder are trademarks of the LEGO Group, which does not make or endorse this editor. The game is not included.')));
  setupDrop = onPick;
  pick.focus();
}

// Asks for the game files (once at a time). Resolves to true once they're
// loaded, false if the window was closed.
let gamePrompt = null;
function requestGame(reason = 'button') {
  if (gameLoaded) return Promise.resolve(true);
  if (!gamePrompt) {
    gamePrompt = new Promise((resolve) => showSetup({ reason, done: resolve })).finally(() => { gamePrompt = null; });
  }
  return gamePrompt;
}
window.WB2_REQUEST_GAME = requestGame;

// Loads the stored game; the editor (if it's running) switches from the
// preview to the full catalog. Returns an error message, or null.
async function switchToGame() {
  if (!api.loadGame({ retry: true })) {
    const { loadError } = api.status();
    if (fs.existsSync(GAME2_DIR)) fs.rmSync(GAME2_DIR, { recursive: true });
    await web.flush();
    return loadError || 'That could not be read as WorldBuilder 2.';
  }
  gameLoaded = true;
  spriteUrls.clear();
  if (window.wb2 && window.wb2.ready) await window.wb2.refreshCatalog();
  updateGameButton();
  return null;
}

// ------------------------------------------------------------ the editor page

let gameButton = null;
function updateGameButton() {
  if (!gameButton) return;
  gameButton.textContent = gameLoaded ? 'Game files' : 'Add game files';
  gameButton.classList.toggle('primary', !gameLoaded);
}

function adaptEditorPage() {
  // Texts that describe the local version's folders.
  for (const p of document.querySelectorAll('dialog p.muted')) {
    if (/levels.*folder/i.test(p.textContent)) p.textContent = 'Saved in this browser. Use Share to send it to someone or to keep a copy.';
  }
  const topbar = $('.topbar');
  if (topbar) {
    gameButton = el('button', { type: 'button', class: 'wb2-gamefiles', title: 'Your WorldBuilder game files', onclick: () => (gameLoaded ? web.showGameFiles() : requestGame('button')) });
    topbar.append(gameButton);
    updateGameButton();
  }
  // Online, the gallery is its own page (the site's front page): the
  // Gallery tab goes there, first in line.
  const galleryTab = $('.tabs [data-tab=gallery]');
  if (galleryTab) {
    galleryTab.parentNode.prepend(el('a', { href: './', class: 'tab-link', title: 'Levels and campaigns other players made' }, 'Gallery'));
    galleryTab.remove();
  }
}

// ------------------------------------------------------------ start

async function start(seed) {
  const begin = async () => {
    adaptEditorPage();
    showLoading('Starting…');
    try {
      await web.loadStoredFiles();
    } catch (e) {
      console.warn('No stored files:', e);
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if (!fs.existsSync(SEEDED_FLAG)) {
      for (const [rel, text] of Object.entries(seed)) {
        const p = path.join(ROOT, rel);
        if (!fs.existsSync(p)) fs.writeFileSync(p, text, 'latin1');
      }
      fs.writeFileSync(SEEDED_FLAG, '1');
    }
    let error = null;
    if (fs.existsSync(paths.wb2Dcr())) {
      showLoading('Loading your game…');
      await nextFrame();
      error = await switchToGame();
    }
    // The editor starts either way; without the game, as a preview under
    // the game files window.
    if (gameLoaded) hideOverlay();
    markReady();
    if (!gameLoaded) requestGame(error ? 'button' : 'start');
    if (error) setTimeout(() => { const s = $('#wb2Setup .wb2-status'); if (s) { s.className = 'wb2-status error'; s.textContent = error; } });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, { once: true });
  else begin();
}

// For debugging and tests in the browser console.
window.WB2_WEB = { api, fs, importFolder: web.importFolder, requestGame, showPlayDialog: web.showPlayDialog };

module.exports = { start };
