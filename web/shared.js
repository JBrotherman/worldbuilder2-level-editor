// Shared by the browser editor (main.js) and the gallery page
// (gallery-page.js): files kept in this browser, reading the player's game
// folders, and saving a built game to a folder or zip.
'use strict';
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');
const paths = require('../tools/paths');
const { writeZip } = require('../tools/zip');

const ROOT = paths.ROOT;
const GAME2_DIR = path.join(ROOT, 'WorldBuilder2', 'worldbuilder2');
const GAME1_DIR = path.join(ROOT, 'WorldBuilder', 'worldbuilder');
const BUILD_DIR = path.join(ROOT, 'build');

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

const savedHandle = async (key) => {
  try { return (await idb('handles', 'readonly', (s) => s.get(key))) || null; } catch (e) { return null; }
};
const saveHandle = (key, handle) => idb('handles', 'readwrite', (s) => s.put(handle, key)).catch(() => {});

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
const hasFolderPicker = typeof window.showDirectoryPicker === 'function';

function download(name, data, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([data], { type })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

function dialog(id, className = 'wb2-play') {
  let d = $(`#${id}`);
  if (!d) {
    d = el('dialog', { id, class: className });
    document.body.append(d);
  }
  return d;
}

// ------------------------------------------------------------ game folders

const hasGame = () => fs.existsSync(paths.wb2Dcr());
const hasWb1 = () => fs.existsSync(path.join(GAME1_DIR, 'worldbuilder.dcr'));

// Reads the picked folder(s): WorldBuilder 2 (required) and WorldBuilder 1,
// into this browser. Entries are Files, or { name, webkitRelativePath,
// getFile() } (see below). Returns which games were found, and where the
// WorldBuilder 2 folder was (path parts of worldbuilder2.dcr).
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
  const found = { wb2: false, wb1: false, wb2Path: wb2Dcr ? rel(wb2Dcr).split('/') : null };

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

// A button that picks a folder: showDirectoryPicker where there is one,
// else <input webkitdirectory> (which browsers word as an "upload").
// onPick(files, handle); mode 'readwrite' also lets builds be saved there.
function folderPicker(label, onPick, { primary = true, mode = 'read' } = {}) {
  const input = el('input', { type: 'file', webkitdirectory: true, multiple: true, hidden: true });
  input.addEventListener('change', () => { if (input.files.length) onPick(input.files, null); input.value = ''; });
  const choose = async () => {
    if (!hasFolderPicker) return input.click();
    let dir;
    try {
      dir = await window.showDirectoryPicker({ id: 'wb2-game', mode });
    } catch (e) {
      if (e.name !== 'AbortError') input.click(); // e.g. a folder the browser won't open
      return;
    }
    onPick(await readDirectoryHandle(dir), dir);
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
    if (entries.length) onDrop(await readDroppedEntries(entries), null);
  });
}

// ------------------------------------------------------------ playing

// Where each kind of build is saved, inside the folder the player chooses.
function buildFolder(kind, title) {
  if (kind === 'level') return 'WorldBuilder2 Custom Level';
  if (kind === 'campaign') return 'WorldBuilder2 Campaign';
  const name = String(title || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60).replace(/[. ]+$/, '');
  return `WorldBuilder2 - ${name || 'Gallery'}`;
}

async function writeToFolder(parent, folder, outDir, { applyDeletes }) {
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
    buildDeletes.delete(p);
    if (!applyDeletes) continue;
    const [d, name] = await dirFor(p.slice(outDir.length + 1)).catch(() => [null]);
    if (d) await d.removeEntry(name).catch(() => {});
  }
}

// After a build: save it to a folder (remembered for next time) or a zip.
// kind: 'level', 'campaign', 'shared-level' or 'shared-campaign'.
// saveTo: a folder handle to save to straight away.
async function showPlayDialog(outDir, kind, { title = '', saveTo = null } = {}) {
  // Picked folders never include empty ones; the game keeps its progress in Prefs.
  fs.mkdirSync(path.join(outDir, 'Prefs'));
  const shared = kind.startsWith('shared-');
  const isLevel = kind === 'level' || kind === 'shared-level';
  const folder = buildFolder(shared ? 'shared' : kind, title);
  const startHint = isLevel ? 'The level is the first mission on the world map.' : 'Press Start Game to get to the world map.';
  const d = dialog('dlgWebPlay');
  const status = el('p', { class: 'wb2-status', role: 'status' });
  const close = el('button', { type: 'button', onclick: () => d.close() }, 'Close');
  const busy = (on) => d.querySelectorAll('button').forEach((b) => { if (b !== close) b.disabled = on; });
  const remembered = hasFolderPicker ? await savedHandle('play') : null;

  const saveIn = async (parent) => {
    busy(true);
    status.className = 'wb2-status';
    status.textContent = 'Saving…';
    try {
      await writeToFolder(parent, folder, outDir, { applyDeletes: kind === 'campaign' });
      await saveHandle('play', parent);
      body.replaceChildren(
        el('p', {}, `Saved “${folder}” in “${parent.name}”. Open it and double-click `, el('strong', {}, 'Launcher.exe'), ' to start the game.'),
        el('p', { class: 'muted' }, startHint));
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
    saveIn(parent);
  };
  const useRemembered = async () => {
    if ((await remembered.requestPermission({ mode: 'readwrite' })) !== 'granted') return pickFolder();
    saveIn(remembered);
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
      el('p', {}, `Unzip “${folder}.zip” into the folder your WorldBuilder2 folder is in (right-click it, Extract All), open “${folder}” and double-click `, el('strong', {}, 'Launcher.exe'), '.'),
      el('p', { class: 'muted' }, 'If Windows says it protected your PC, click More info, then Run anyway: it\'s the game\'s own Launcher.exe with the missions inside.'),
      el('p', { class: 'muted' }, startHint));
  };

  const buttons = [];
  if (remembered) buttons.push(el('button', { type: 'button', class: 'primary', onclick: useRemembered }, `Save in “${remembered.name}”`));
  if (hasFolderPicker) buttons.push(el('button', { type: 'button', class: remembered ? '' : 'primary', onclick: pickFolder }, remembered ? 'Other folder…' : 'Choose where to save…'));
  buttons.push(el('button', { type: 'button', class: hasFolderPicker ? '' : 'primary', onclick: downloadZip }, 'Download zip'));

  const what = shared ? `“${title}”` : isLevel ? 'your level' : 'your campaign';
  const body = el('div', {},
    el('p', {}, `A copy of WorldBuilder 2 with ${what} is ready.`),
    el('p', { class: 'muted' }, hasFolderPicker
      ? `Browsers can't start games, so save it on your PC and start it from there. Choose the folder your WorldBuilder2 folder is in: it goes next to it, as “${folder}”${shared ? '' : ' (replaced on every Play)'}.`
      : 'Browsers can\'t start games, so download it, unzip it next to your WorldBuilder2 folder and start it from there.'),
    el('div', { class: 'wb2-actions' }, buttons),
    status);
  d.replaceChildren(el('h2', {}, isLevel ? 'Play the level' : 'Play the campaign'), body, el('menu', {}, close));
  if (!d.open) d.showModal();
  if (saveTo) saveIn(saveTo);
}

module.exports = {
  ROOT, GAME2_DIR, GAME1_DIR, idb, loadStoredFiles, flush, savedHandle, saveHandle,
  $, el, nextFrame, hasFolderPicker, download, dialog,
  hasGame, hasWb1, importFolder, readDirectoryHandle, folderPicker, dropTarget, showPlayDialog,
};
