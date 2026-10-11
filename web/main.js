// Browser version of the editor: runs the same API as tools/server.js inside
// the page. The visitor picks their own WorldBuilder 2 folder once; its
// files, levels, campaign and unit settings are kept in this browser
// (IndexedDB) and never uploaded. "Play" builds the game in the page and
// saves it to a folder (Chrome/Edge) or as a zip, to start Launcher.exe.
'use strict';
const fs = require('fs');
const path = require('path');
const paths = require('../tools/paths');
const { createApi } = require('../tools/api');
const web = require('./shared');

const { ROOT, GAME2_DIR, GAME1_DIR, $, el, nextFrame, hasFolderPicker } = web;
const SEEDED_FLAG = path.join(ROOT, '.seeded');

// ------------------------------------------------------------ the API

const api = createApi({
  launch: (outDir, kind, title) => {
    setTimeout(() => web.showPlayDialog(outDir, kind, { title }));
    return { message: '' };
  },
});

let markReady;
const ready = new Promise((r) => { markReady = r; });

// The editor calls fetch('/api/...'); answer those here.
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  if (typeof input !== 'string' || !/^\/(api|sprite)\//.test(input)) return realFetch(input, init);
  await ready;
  await nextFrame(); // let "Building…" and similar show before the work
  const url = new URL(input, 'http://editor');
  const r = api.handle((init.method || 'GET').toUpperCase(), decodeURIComponent(url.pathname), url.searchParams, typeof init.body === 'string' ? init.body : '')
    || { status: 404, type: 'application/json', body: JSON.stringify({ error: 'not found' }) };
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.type } });
};

// Sprite images: rendered from the game on first use.
const spriteUrls = new Map();
window.WB2_SPRITE_URL = (name) => {
  if (!spriteUrls.has(name)) {
    const img = api.sprites() && api.sprites().render(name);
    spriteUrls.set(name, img ? URL.createObjectURL(new Blob([img.png], { type: 'image/png' })) : 'data:,');
  }
  return spriteUrls.get(name);
};

// ------------------------------------------------------------ setup screen

// What a folder dropped on the welcome screen does (set by showSetup).
let setupDrop = null;

function overlay() {
  let o = $('#wb2Setup');
  if (!o) {
    o = el('div', { id: 'wb2Setup', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wb2SetupTitle' });
    document.body.append(o);
    web.dropTarget(o, (files) => { if (setupDrop) setupDrop(files); });
  }
  o.hidden = false;
  return o;
}

function showLoading(text) {
  overlay().replaceChildren(el('div', { class: 'wb2-card' }, el('p', { class: 'wb2-loading' }, text)));
}

function showSetup(error) {
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
      startGame();
    } catch (e) {
      status.className = 'wb2-status error';
      status.textContent = e.message;
    }
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
    if (![...files].some((f) => f.name.toLowerCase() === 'worldbuilder.dcr')) {
      wb1Note.textContent = ' No worldbuilder.dcr in that folder.';
      return;
    }
    wantWb1 = files;
    wb1Note.textContent = ' ✓ WorldBuilder will be added.';
  }, { primary: false });

  overlay().replaceChildren(el('div', { class: 'wb2-card' },
    el('h1', { id: 'wb2SetupTitle' }, el('span', { class: 'brick' }), 'WorldBuilder 2 Level Editor'),
    el('p', { class: 'wb2-lead' }, 'Make your own missions and campaigns for LEGO WorldBuilder 2, and play them in the real game.'),
    el('p', { class: 'wb2-gallery-link' }, 'Just looking? ', el('a', { href: 'gallery.html' }, 'Browse the gallery'), ' of levels and campaigns other players made; no game files needed to look around.'),
    el('h2', {}, 'Your copy of the game'),
    el('p', {}, 'The editor uses your own copy of WorldBuilder 2 for its pictures, missions and rules. Show it where the game is: the folder with ',
      el('code', {}, 'Launcher.exe'), ' and ', el('code', {}, 'worldbuilder2.dcr'), ' in it, or the folder above it.'),
    drop,
    status,
    el('p', { class: 'muted' }, 'The game files stay on your computer: this page only reads them and keeps a copy in this browser. Nothing is uploaded.',
      hasFolderPicker ? '' : ' (If you use the button, your browser calls it "uploading"; dragging the folder avoids that.)'),
    web.gameHelp(),
    el('details', {},
      el('summary', {}, 'Optional: also have the original LEGO WorldBuilder?'),
      el('p', {}, 'It adds the scorpion and T-Rex animations and its 60 missions as templates. Choose its folder before your WorldBuilder 2 folder, or drag both folders here together.'),
      el('div', { class: 'wb2-actions' }, pick1, pick1Input, wb1Note)),
    el('h2', {}, 'Good to know'),
    el('ul', {},
      el('li', {}, 'Playing your levels needs Windows: the editor gives you a ready-to-play copy of the game to start.'),
      el('li', {}, 'Your levels stay in this browser. Use Share and Export to send them to friends or keep a backup.'),
      el('li', {}, 'Prefer to run it on your own PC? ', el('a', { href: 'https://github.com/JBrotherman/worldbuilder2-level-editor', target: '_blank', rel: 'noopener' }, 'Download it from GitHub'), '.')),
    el('p', { class: 'muted wb2-legal' }, 'LEGO and WorldBuilder are trademarks of the LEGO Group, which does not make or endorse this editor. The game is not included.')));
  setupDrop = onPick;
  pick.focus();
}

async function startGame() {
  setupDrop = null;
  showLoading('Loading your game…');
  await nextFrame();
  if (api.loadGame({ retry: true })) {
    $('#wb2Setup').hidden = true;
    markReady();
    return;
  }
  const { loadError } = api.status();
  if (fs.existsSync(GAME2_DIR)) fs.rmSync(GAME2_DIR, { recursive: true });
  showSetup(loadError || 'That folder could not be read as WorldBuilder 2.');
}

// ------------------------------------------------------------ game files menu

function showGameFiles() {
  const d = web.dialog('dlgWebPlay');
  const status = el('p', { class: 'wb2-status', role: 'status' });
  const reloadAfter = (fn) => async (files) => {
    status.className = 'wb2-status';
    status.textContent = 'Reading…';
    try {
      await fn(files);
      await web.flush();
      location.reload();
    } catch (e) {
      status.className = 'wb2-status error';
      status.textContent = e.message;
    }
  };
  const [pick2, in2] = web.folderPicker('Choose WorldBuilder 2 again', reloadAfter(async (files) => {
    if (!(await web.importFolder(files)).wb2) throw new Error('No worldbuilder2.dcr in that folder.');
  }), { primary: false });
  const [pick1, in1] = web.folderPicker(web.hasWb1() ? 'Choose WorldBuilder again' : 'Add the original WorldBuilder', reloadAfter(async (files) => {
    if (!(await web.importFolder(files, { wb1Only: true })).wb1) throw new Error('No worldbuilder.dcr in that folder.');
  }), { primary: false });
  const forget = el('button', { type: 'button', onclick: async () => {
    if (!confirm('Remove the game files from this browser? Your levels and campaign stay.')) return;
    for (const dir of [GAME2_DIR, GAME1_DIR]) if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    await web.flush();
    location.reload();
  } }, 'Remove game files');
  d.replaceChildren(
    el('h2', {}, 'Game files'),
    el('p', {}, 'WorldBuilder 2: ✓ loaded. Original WorldBuilder: ', web.hasWb1() ? '✓ loaded.' : 'not added (optional).'),
    el('p', { class: 'muted' }, 'They are kept in this browser only. Your levels, campaign and unit settings are kept here too: use Share and Export for backups.'),
    el('div', { class: 'wb2-actions' }, pick2, in2, pick1, in1, forget),
    status,
    el('menu', {}, el('button', { type: 'button', onclick: () => d.close() }, 'Close')));
  d.showModal();
}

function adaptEditorPage() {
  // Texts that describe the local version's folders.
  for (const p of document.querySelectorAll('dialog p.muted')) {
    if (/levels.*folder/i.test(p.textContent)) p.textContent = 'Saved in this browser. Use Share to send it to someone or to keep a copy.';
  }
  const topbar = $('.topbar');
  if (topbar) topbar.append(el('button', { type: 'button', class: 'wb2-gamefiles', title: 'Your WorldBuilder game files', onclick: showGameFiles }, 'Game files'));
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
    if (fs.existsSync(paths.wb2Dcr())) startGame();
    else showSetup();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, { once: true });
  else begin();
}

// For debugging and tests in the browser console.
window.WB2_WEB = { api, fs, importFolder: web.importFolder, startGame, showPlayDialog: web.showPlayDialog };

module.exports = { start };
