// Where the game files are. By default the WorldBuilder2/ (and optional
// WorldBuilder/) folders next to the .bat files; settings.json in the same
// place can point elsewhere:
//   { "worldBuilder2": "D:\\Games\\WorldBuilder2",
//     "worldBuilder1": "D:\\Games\\WorldBuilder" }
// Either the outer folder or the inner one that holds the .dcr works.
// Relative paths are relative to the editor folder.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SETTINGS_FILE = path.join(ROOT, 'settings.json');

// Returns {} when there's no settings file; { error } when it can't be read.
function readSettings() {
  let text;
  try {
    text = fs.readFileSync(SETTINGS_FILE, 'utf8');
  } catch (e) {
    return e.code === 'ENOENT' ? {} : { error: `could not read settings.json: ${e.message}` };
  }
  try {
    const s = JSON.parse(text.replace(/^\uFEFF/, ''));
    return s && typeof s === 'object' ? s : {};
  } catch (e) {
    return { error: `settings.json is not valid JSON (${e.message}). Tip: write backslashes in paths as \\\\ or use forward slashes.` };
  }
}

function writeSettings(changes) {
  const s = readSettings();
  delete s.error;
  Object.assign(s, changes);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2) + '\n');
}

const WB2_FILE = 'worldbuilder2.dcr';
const WB1_FILE = 'worldbuilder.dcr';

// `dir` or its `inner` subfolder, whichever holds `file`; null if neither.
function locate(dir, inner, file) {
  const base = path.resolve(ROOT, dir);
  return [base, path.join(base, inner)].find((d) => fs.existsSync(path.join(d, file))) || null;
}

// The configured folder, else the default location.
function findDir(setting, defaultDir, inner, file) {
  if (typeof setting === 'string' && setting.trim()) {
    return locate(setting.trim(), inner, file) || path.resolve(ROOT, setting.trim(), inner);
  }
  return defaultDir;
}

// The folder holding worldbuilder2.dcr, given the folder a user picked.
const locateWb2 = (dir) => locate(dir, 'worldbuilder2', WB2_FILE);

// Folder with worldbuilder2.dcr and Launcher.exe (it may not exist).
function wb2Dir() {
  return findDir(readSettings().worldBuilder2, path.join(ROOT, 'WorldBuilder2', 'worldbuilder2'), 'worldbuilder2', WB2_FILE);
}

function wb2Dcr() {
  return path.join(wb2Dir(), WB2_FILE);
}

function wb1Dcr() {
  return path.join(findDir(readSettings().worldBuilder1, path.join(ROOT, 'WorldBuilder', 'worldbuilder'), 'worldbuilder', WB1_FILE), WB1_FILE);
}

// What the help page needs to explain a missing game.
function wb2Status() {
  const settings = readSettings();
  const dcr = wb2Dcr();
  return {
    found: fs.existsSync(dcr),
    dcr,
    configured: typeof settings.worldBuilder2 === 'string' && settings.worldBuilder2.trim() ? settings.worldBuilder2 : null,
    settingsError: settings.error || null,
    settingsFile: SETTINGS_FILE,
    defaultDir: path.join(ROOT, 'WorldBuilder2'),
  };
}

module.exports = { ROOT, SETTINGS_FILE, readSettings, writeSettings, locateWb2, wb2Dir, wb2Dcr, wb1Dcr, wb2Status };
