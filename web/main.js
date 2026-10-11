// Browser version of the editor: runs the same API as tools/server.js inside
// the page. The visitor picks their own WorldBuilder 2 folder once; its
// files, levels, campaign and unit settings are kept in this browser
// (IndexedDB) and never uploaded. "Play" builds the game in the page and
// saves it to a folder (Chrome/Edge) or as a zip, to start Launcher.exe.
'use strict';
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');
const paths = require('../tools/paths');
const { createApi } = require('../tools/api');
const { writeZip } = require('../tools/zip');

const ROOT = paths.ROOT;
const GAME2_DIR = path.join(ROOT, 'WorldBuilder2', 'worldbuilder2');
const GAME1_DIR = path.join(ROOT, 'WorldBuilder', 'worldbuilder');
const BUILD_DIR = path.join(ROOT, 'build');
const SEEDED_FLAG = path.join(ROOT, '.seeded');
const BUILD_FOLDERS = { level: 'WorldBuilder2 Custom Level', campaign: 'WorldBuilder2 Campaign' };

// ------------------------------------------------------------ IndexedDB

const DB_NAME = 'wb2-editor';
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('files');
        req.result.createObjectStore('handles');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function idb(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const result = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

async function loadStoredFiles() {
  const entries = await idb('files', 'readonly', (s) => {
    const out = [];
    s.openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (c) { out.push([c.key, c.value]); c.continue(); }
    };
    return { get result() { return out; } };
  });
  for (const [p, { data, mtimeMs }] of entries) fs.mount(p, new Uint8Array(data), mtimeMs);
  return entries.length;
}

// Saves every change outside build/ back to IndexedDB, batched.
const pendingWrites = new Map();
let flushTimer = null;
let storageWarned = false;
function persist(p, entry) {
  pendingWrites.set(p, entry);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 50);
}
async function flush() {
  const batch = [...pendingWrites];
  pendingWrites.clear();
  try {
    await idb('files', 'readwrite', (s) => {
      for (const [p, entry] of batch) {
        if (entry) s.put({ data: Uint8Array.prototype.slice.call(entry.data).buffer, mtimeMs: entry.mtimeMs }, p);
        else s.delete(p);
      }
    });
  } catch (e) {
    if (!storageWarned) {
      storageWarned = true;
      alert(`This browser didn't let the editor save its files (${e.message}). Your work lasts until you close the page; use Share or Export to keep copies.`);
    }
  }
}

// Build output stays in memory; remember what a build removed (such as old
// progress) so saving the build can remove it on disk too.
const buildDeletes = new Set();
fs.onChange((p, entry) => {
  if (p.startsWith(BUILD_DIR + '/')) {
    if (entry) buildDeletes.delete(p);
    else buildDeletes.add(p);
    return;
  }
  persist(p, entry);
});

// ------------------------------------------------------------ helpers

const $ = (sel) => document.querySelector(sel);
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}
const nextFrame = () => new Promise((r) => setTimeout(r, 30));
const hasFolderSaving = typeof window.showDirectoryPicker === 'function';

function download(name, data, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([data], { type })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// ------------------------------------------------------------ the API

const api = createApi({
  launch: (outDir, kind) => {
    // Picked folders never include empty ones; the game keeps its progress in Prefs.
    fs.mkdirSync(path.join(outDir, 'Prefs'));
    setTimeout(() => showPlayDialog(outDir, kind));
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

function overlay() {
  let o = $('#wb2Setup');
  if (!o) {
    o = el('div', { id: 'wb2Setup', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wb2SetupTitle' });
    document.body.append(o);
    dropTarget(o, (files) => { if (setupDrop) setupDrop(files); });
  }
  o.hidden = false;
  return o;
}

function showLoading(text) {
  overlay().replaceChildren(el('div', { class: 'wb2-card' }, el('p', { class: 'wb2-loading' }, text)));
}

// Reads the picked folder(s): WorldBuilder 2 (required) and WorldBuilder 1.
// Entries are Files, or { name, webkitRelativePath, getFile() } (see below).
async function importFolder(fileList, { wb1Only = false } = {}) {
  const bytes = async (f) => {
    const file = f.getFile ? await f.getFile() : f;
    return file.size > 64 * 1024 * 1024 ? null : new Uint8Array(await file.arrayBuffer());
  };
  const list = [...fileList];
  const rel = (f) => (f.webkitRelativePath || f.name).replace(/\\/g, '/');
  const dirOf = (f) => { const r = rel(f); return r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : ''; };
  const wb2Dcr = list.find((f) => f.name.toLowerCase() === 'worldbuilder2.dcr');
  const wb1Dcr = list.find((f) => f.name.toLowerCase() === 'worldbuilder.dcr');
  const found = { wb2: false, wb1: false };

  if (wb2Dcr && !wb1Only) {
    const base = dirOf(wb2Dcr);
    const inside = base ? list.filter((f) => rel(f).startsWith(base + '/')) : list;
    if (!inside.some((f) => f.name.toLowerCase() === 'launcher.exe' && dirOf(f) === base)) {
      throw new Error('Launcher.exe is missing next to worldbuilder2.dcr. Choose the complete WorldBuilder 2 folder.');
    }
    if (fs.existsSync(GAME2_DIR)) fs.rmSync(GAME2_DIR, { recursive: true });
    for (const f of inside) {
      const sub = base ? rel(f).slice(base.length + 1) : rel(f);
      const data = await bytes(f);
      if (data) fs.writeFileSync(path.join(GAME2_DIR, sub), data);
    }
    found.wb2 = true;
  }
  if (wb1Dcr) {
    fs.writeFileSync(path.join(GAME1_DIR, 'worldbuilder.dcr'), await bytes(wb1Dcr));
    found.wb1 = true;
  }
  return found;
}

// Folders are read from a folder picker or a drop. Big folders (someone
// picking their whole Documents) are cut short: the game is near the top.
const MAX_ENTRIES = 5000;
const MAX_DEPTH = 4;
const lazyFile = (name, relPath, getFile) => ({ name, webkitRelativePath: relPath, getFile });

// Chrome and Edge: showDirectoryPicker, which asks to "view files".
async function readDirectoryHandle(dir, prefix = dir.name, out = [], depth = 0) {
  for await (const [name, h] of dir.entries()) {
    if (out.length >= MAX_ENTRIES) break;
    const relPath = `${prefix}/${name}`;
    if (h.kind === 'file') out.push(lazyFile(name, relPath, () => h.getFile()));
    else if (depth < MAX_DEPTH) await readDirectoryHandle(h, relPath, out, depth + 1);
  }
  return out;
}

// Every browser: folders dragged onto the page.
async function readDroppedEntries(entries) {
  const out = [];
  const walk = async (entry, depth) => {
    if (out.length >= MAX_ENTRIES) return;
    const relPath = entry.fullPath.replace(/^\//, '');
    if (entry.isFile) {
      out.push(lazyFile(entry.name, relPath, () => new Promise((resolve, reject) => entry.file(resolve, reject))));
    } else if (entry.isDirectory && depth <= MAX_DEPTH) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const e of batch) await walk(e, depth + 1);
      }
    }
  };
  for (const e of entries) await walk(e, 0);
  return out;
}

// Elsewhere: <input webkitdirectory>, which browsers word as an "upload".
const hasFolderPicker = typeof window.showDirectoryPicker === 'function';

function folderPicker(label, onPick, { primary = true } = {}) {
  const input = el('input', { type: 'file', webkitdirectory: true, multiple: true, hidden: true });
  input.addEventListener('change', () => { if (input.files.length) onPick(input.files); input.value = ''; });
  const choose = async () => {
    if (!hasFolderPicker) return input.click();
    let dir;
    try {
      dir = await window.showDirectoryPicker({ id: 'wb2-game', mode: 'read' });
    } catch (e) {
      if (e.name !== 'AbortError') input.click(); // e.g. a folder the browser won't open
      return;
    }
    onPick(await readDirectoryHandle(dir));
  };
  const button = el('button', { type: 'button', class: primary ? 'primary' : '', onclick: choose }, label);
  return [button, input];
}

// Lets folders be dropped on an element; calls onDrop(entries).
function dropTarget(target, onDrop) {
  let depth = 0;
  target.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; target.classList.add('dragging'); });
  target.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; target.classList.remove('dragging'); } });
  target.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  target.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    target.classList.remove('dragging');
    const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (entries.length) onDrop(await readDroppedEntries(entries));
  });
}

// What a folder dropped on the welcome screen does (set by showSetup).
let setupDrop = null;

function showSetup(error) {
  const status = el('p', { class: 'wb2-status' + (error ? ' error' : ''), role: 'status' }, error || '');
  let wantWb1 = null;
  const onPick = async (files) => {
    status.className = 'wb2-status';
    status.textContent = 'Reading the game files…';
    try {
      const found = await importFolder(files);
      if (!found.wb2) throw new Error('No worldbuilder2.dcr in that folder. Choose the WorldBuilder 2 folder (the one with Launcher.exe and worldbuilder2.dcr, or the folder above it).');
      if (wantWb1) await importFolder(wantWb1, { wb1Only: true });
      await flush();
      startGame();
    } catch (e) {
      status.className = 'wb2-status error';
      status.textContent = e.message;
    }
  };
  const [pick, pickInput] = folderPicker('Choose the folder', onPick);
  const drop = el('div', { class: 'wb2-drop' },
    el('div', { class: 'wb2-drop-icon', 'aria-hidden': 'true' }, '📁'),
    el('p', {}, el('strong', {}, 'Drag your WorldBuilder2 folder here')),
    el('p', { class: 'muted' }, 'or'),
    el('div', { class: 'wb2-actions' }, pick, pickInput));
  const wb1Note = el('span', { class: 'muted' });
  const [pick1, pick1Input] = folderPicker('Choose the WorldBuilder folder', (files) => {
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
    el('h2', {}, 'Your copy of the game'),
    el('p', {}, 'The editor uses your own copy of WorldBuilder 2 for its pictures, missions and rules. Show it where the game is: the folder with ',
      el('code', {}, 'Launcher.exe'), ' and ', el('code', {}, 'worldbuilder2.dcr'), ' in it, or the folder above it.'),
    drop,
    status,
    el('p', { class: 'muted' }, 'The game files stay on your computer: this page only reads them and keeps a copy in this browser. Nothing is uploaded.',
      hasFolderPicker ? '' : ' (If you use the button, your browser calls it "uploading"; dragging the folder avoids that.)'),
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

// ------------------------------------------------------------ playing

async function savedHandle() {
  try { return await idb('handles', 'readonly', (s) => s.get('play')); } catch (e) { return null; }
}

async function writeToFolder(parent, folder, outDir) {
  const target = await parent.getDirectoryHandle(folder, { create: true });
  const dirFor = async (rel) => {
    let d = target;
    const parts = rel.split('/');
    for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part, { create: true });
    return [d, parts[parts.length - 1]];
  };
  for (const rel of fs.listTree(outDir, { withDirs: true })) {
    if (rel.endsWith('/')) { await dirFor(rel + 'x'); continue; } // a folder, such as the empty Prefs
    const [d, name] = await dirFor(rel);
    const handle = await d.getFileHandle(name, { create: true });
    const w = await handle.createWritable();
    await w.write(fs.readFileSync(path.join(outDir, rel)));
    await w.close();
  }
  for (const p of [...buildDeletes]) {
    if (!p.startsWith(outDir + '/')) continue;
    const [d, name] = await dirFor(p.slice(outDir.length + 1)).catch(() => [null]);
    if (d) await d.removeEntry(name).catch(() => {});
    buildDeletes.delete(p);
  }
}

function playDialog() {
  let d = $('#dlgWebPlay');
  if (!d) {
    d = el('dialog', { id: 'dlgWebPlay', class: 'wb2-play' });
    document.body.append(d);
  }
  return d;
}

function afterSaveText(kind, where) {
  return [
    el('p', {}, `Saved to ${where}. Open it and double-click `, el('strong', {}, 'Launcher.exe'), ' to start the game.'),
    el('p', { class: 'muted' }, kind === 'level'
      ? 'Your level is the first mission on the world map.'
      : 'Press Start Game to get to the world map.'),
  ];
}

async function showPlayDialog(outDir, kind) {
  const folder = BUILD_FOLDERS[kind];
  const d = playDialog();
  const status = el('p', { class: 'wb2-status', role: 'status' });
  const close = el('button', { type: 'button', onclick: () => d.close() }, 'Close');
  const busy = (on) => d.querySelectorAll('button').forEach((b) => { if (b !== close) b.disabled = on; });
  const remembered = hasFolderSaving ? await savedHandle() : null;

  const saveTo = async (parent) => {
    busy(true);
    status.className = 'wb2-status';
    status.textContent = 'Saving…';
    try {
      await writeToFolder(parent, folder, outDir);
      await idb('handles', 'readwrite', (s) => s.put(parent, 'play')).catch(() => {});
      body.replaceChildren(...afterSaveText(kind, `“${parent.name}\\${folder}”`));
    } catch (e) {
      status.className = 'wb2-status error';
      status.textContent = /NoModificationAllowed|InvalidState|being used|locked/i.test(`${e.name} ${e.message}`)
        ? 'Could not overwrite the game files: close the game first, then try again.'
        : `Could not save: ${e.message}`;
    } finally {
      busy(false);
    }
  };
  const pickFolder = async () => {
    let parent;
    try {
      parent = await window.showDirectoryPicker({ id: 'wb2-play', mode: 'readwrite', startIn: 'documents' });
    } catch (e) {
      return; // cancelled
    }
    saveTo(parent);
  };
  const useRemembered = async () => {
    if ((await remembered.requestPermission({ mode: 'readwrite' })) !== 'granted') return pickFolder();
    saveTo(remembered);
  };
  const downloadZip = async () => {
    busy(true);
    status.className = 'wb2-status';
    status.textContent = 'Packing…';
    await nextFrame();
    const now = new Date();
    const entries = fs.listTree(outDir, { withDirs: true }).map((rel) => ({
      name: `${folder}/${rel}`, data: rel.endsWith('/') ? Buffer.alloc(0) : fs.readFileSync(path.join(outDir, rel)), mtime: now,
    }));
    download(`${folder}.zip`, writeZip(entries), 'application/zip');
    busy(false);
    body.replaceChildren(
      el('p', {}, `Unzip “${folder}.zip” (right-click it, Extract All), open the folder and double-click `, el('strong', {}, 'Launcher.exe'), '.'),
      el('p', { class: 'muted' }, 'If Windows says it protected your PC, click More info, then Run anyway: it\'s the game\'s own Launcher.exe with your missions inside.'),
      el('p', { class: 'muted' }, kind === 'level' ? 'Your level is the first mission on the world map.' : 'Press Start Game to get to the world map.'));
  };

  const buttons = [];
  if (remembered) buttons.push(el('button', { type: 'button', class: 'primary', onclick: useRemembered }, `Save in “${remembered.name}”`));
  if (hasFolderSaving) buttons.push(el('button', { type: 'button', class: remembered ? '' : 'primary', onclick: pickFolder }, remembered ? 'Other folder…' : 'Save to a folder…'));
  buttons.push(el('button', { type: 'button', class: hasFolderSaving ? '' : 'primary', onclick: downloadZip }, 'Download zip'));

  const body = el('div', {},
    el('p', {}, kind === 'level'
      ? 'A copy of WorldBuilder 2 with your level as its first mission is ready.'
      : 'A copy of WorldBuilder 2 with your campaign is ready.'),
    el('p', { class: 'muted' }, hasFolderSaving
      ? `Browsers can't start games, so save it to a folder on your PC (it goes in a “${folder}” subfolder, replaced on every Play) and start it from there.`
      : 'Browsers can\'t start games, so download it, unzip it and start it from there.'),
    el('div', { class: 'wb2-actions' }, buttons),
    status);
  d.replaceChildren(el('h2', {}, kind === 'level' ? 'Play your level' : 'Play your campaign'), body, el('menu', {}, close));
  d.showModal();
}

// ------------------------------------------------------------ game files menu

function showGameFiles() {
  const d = playDialog();
  const wb1 = fs.existsSync(path.join(GAME1_DIR, 'worldbuilder.dcr'));
  const status = el('p', { class: 'wb2-status', role: 'status' });
  const reloadAfter = (fn) => async (files) => {
    status.className = 'wb2-status';
    status.textContent = 'Reading…';
    try {
      await fn(files);
      await flush();
      location.reload();
    } catch (e) {
      status.className = 'wb2-status error';
      status.textContent = e.message;
    }
  };
  const [pick2, in2] = folderPicker('Choose WorldBuilder 2 again', reloadAfter(async (files) => {
    if (!(await importFolder(files)).wb2) throw new Error('No worldbuilder2.dcr in that folder.');
  }), { primary: false });
  const [pick1, in1] = folderPicker(wb1 ? 'Choose WorldBuilder again' : 'Add the original WorldBuilder', reloadAfter(async (files) => {
    if (!(await importFolder(files, { wb1Only: true })).wb1) throw new Error('No worldbuilder.dcr in that folder.');
  }), { primary: false });
  const forget = el('button', { type: 'button', onclick: async () => {
    if (!confirm('Remove the game files from this browser? Your levels and campaign stay.')) return;
    for (const dir of [GAME2_DIR, GAME1_DIR]) if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    await flush();
    location.reload();
  } }, 'Remove game files');
  d.replaceChildren(
    el('h2', {}, 'Game files'),
    el('p', {}, 'WorldBuilder 2: ✓ loaded. Original WorldBuilder: ', wb1 ? '✓ loaded.' : 'not added (optional).'),
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
      await loadStoredFiles();
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
window.WB2_WEB = { api, fs, importFolder, startGame, showPlayDialog };

module.exports = { start };
