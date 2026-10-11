// The gallery page (gallery.html): browse without any game files; Play
// builds a level or campaign from the player's own WorldBuilder 2 and saves
// it next to their WorldBuilder2 folder (or as a zip). The page itself is
// editor/gallery.js; this is the part that needs the game tools.
'use strict';
const { createApi } = require('../tools/api');
const web = require('./shared');

const { el, nextFrame, hasFolderPicker } = web;

// Set by play() when the player just chose the folder their games are in:
// the build is saved there without asking again.
let saveNextTo = null;

const api = createApi({
  launch: (outDir, kind, title) => {
    const saveTo = saveNextTo;
    saveNextTo = null;
    setTimeout(() => web.showPlayDialog(outDir, kind, { title, saveTo }));
    return {};
  },
});

let storedLoaded = null;
const loadStored = () => {
  if (!storedLoaded) storedLoaded = web.loadStoredFiles().catch((e) => console.warn('No stored files:', e));
  return storedLoaded;
};

// Asks for the game, to play item (or, without an item, from the "Add game
// files" button). Resolves to true once it's in this browser.
function askForGame(item = null) {
  return new Promise((resolve) => {
    const d = web.dialog('dlgWebPlay');
    const status = el('p', { class: 'wb2-status', role: 'status' });
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    const onPick = async (files, handle) => {
      status.className = 'wb2-status';
      status.textContent = 'Reading the game files…';
      try {
        const found = await web.importFolder(files);
        if (!found.wb2) throw new Error('No WorldBuilder 2 there (no worldbuilder2.dcr). Choose the folder your WorldBuilder2 folder is in, the WorldBuilder2 folder itself, or the zip it came in.');
        await web.flush();
        // With the folder picker: save builds right there, next to the game.
        if (item) saveNextTo = handle;
        else if (handle) await web.saveHandle('play', handle);
        finish(true);
      } catch (e) {
        status.className = 'wb2-status error';
        status.textContent = e.message;
      }
    };
    const [pick, pickInput] = web.folderPicker(hasFolderPicker ? 'Choose that folder' : 'Choose your WorldBuilder2 folder', onPick, { mode: 'readwrite' });
    const [zip, zipInput] = web.zipPicker('choose the zip file', onPick);
    const drop = el('div', { class: 'wb2-drop' },
      el('div', { class: 'wb2-drop-icon', 'aria-hidden': 'true' }, '📁'),
      el('div', { class: 'wb2-actions' }, pick, pickInput),
      el('p', { class: 'muted' }, hasFolderPicker ? 'or drag your WorldBuilder2 folder here' : 'or drag your WorldBuilder2 folder here (this avoids your browser calling it an "upload")'),
      el('p', { class: 'muted wb2-zip-line' }, 'Have the game as a .zip? Drag it here too, or ', zip, zipInput, '.'));
    web.dropTarget(drop, onPick);
    d.replaceChildren(
      el('h2', {}, item ? `Play “${item.title}”` : 'Add your game files'),
      el('p', {}, item
        ? `To play, the gallery puts the ${item.type === 'level' ? 'level' : 'campaign'} into a copy of your own WorldBuilder 2 (the game isn't included here).`
        : 'Levels and campaigns are played in a copy of your own WorldBuilder 2 (the game isn\'t included here). Show it where yours is once, and Play works straight away from then on, here and in the editor.'),
      el('p', {}, hasFolderPicker
        ? `Choose the folder your WorldBuilder2 folder is in (with WorldBuilder too, if you have it). The game is read from there${item ? ', and the copy is saved next to it, ready to start' : ', and what you play is saved next to it'}.`
        : 'Choose or drag in your WorldBuilder2 folder. Playing then gives you a zip to unpack next to it.'),
      drop,
      status,
      el('p', { class: 'muted' }, 'The game files stay on your computer; they are only read by this page and kept in this browser, so the editor can use them too.'),
      web.gameHelp(),
      el('menu', {}, el('button', { type: 'button', onclick: () => { d.close(); finish(false); } }, 'Cancel')));
    d.addEventListener('close', () => finish(false), { once: true });
    if (!d.open) d.showModal();
    pick.focus();
  });
}

// item: { type, title, data } from the gallery.
async function play(item) {
  await loadStored();
  if (!web.hasGame() && !(await askForGame(item))) return;
  updateGameButton();
  const d = web.dialog('dlgWebPlay');
  d.replaceChildren(el('h2', {}, `Play “${item.title}”`), el('p', { class: 'wb2-loading-inline' }, 'Building your copy of the game…'));
  if (!d.open) d.showModal();
  await nextFrame();
  if (!api.loadGame({ retry: true })) {
    d.replaceChildren(el('h2', {}, 'The game could not be read'),
      el('p', { class: 'wb2-status error' }, api.status().loadError || 'Your WorldBuilder 2 files could not be read.'),
      el('menu', {}, el('button', { type: 'button', onclick: () => d.close() }, 'Close')));
    return;
  }
  const r = api.handle('POST', '/api/shared/play', new URLSearchParams(), JSON.stringify({ type: item.type, title: item.title, data: item.data }));
  if (r.status !== 200) {
    d.replaceChildren(el('h2', {}, 'Could not build it'),
      el('p', { class: 'wb2-status error' }, JSON.parse(r.body).error),
      el('menu', {}, el('button', { type: 'button', onclick: () => d.close() }, 'Close')));
  }
}

// The "Add game files" button, top right: says whether the game is there.
async function updateGameButton() {
  const b = document.querySelector('#btnGameFiles');
  if (!b) return;
  const has = await web.hasStoredGame();
  b.textContent = has ? 'Game files ✓' : 'Add game files';
  b.classList.toggle('primary', !has);
  b.classList.toggle('has-game', has);
}

async function gameFilesButton() {
  await loadStored();
  if (web.hasGame()) return web.showGameFiles();
  if (await askForGame()) {
    web.dialog('dlgWebPlay').close();
    updateGameButton();
    const t = document.querySelector('#toast');
    if (t) {
      t.textContent = 'Game files added. Press ▶ Play on anything in the gallery.';
      t.className = 'toast';
      t.hidden = false;
      setTimeout(() => { t.hidden = true; }, 6000);
    }
  }
}

async function start() {
  // editor/gallery.js picks this up.
  window.WB2_GALLERY_HOST = { play, gameHelp: web.gameHelp };
  window.WB2_WEB = { api, play, importFolder: web.importFolder };
  const begin = () => {
    const b = document.querySelector('#btnGameFiles');
    if (b) b.addEventListener('click', gameFilesButton);
    updateGameButton();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, { once: true });
  else begin();
}

module.exports = { start };
