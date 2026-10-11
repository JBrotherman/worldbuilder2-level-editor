// Custom campaign + unit tuning: stored in campaign/, applied to a patched
// copy of the game.
//
// campaign/campaign.json:
//   { "missions": { "map1.1": { "level": "<file in levels/>"|null,
//                               "title": "..."|null, "unlocks": [2, 3]|null } } }
//   null/missing means "keep the original". { "empty": true } is a mission
//   the campaign doesn't use: nothing unlocks it, so it stays locked, and
//   locked missions aren't shown on the world map. Mission 1.1 is always
//   open, so it can't be empty. Unlock 13 opens the next world.
// campaign/config.txt: the full game config text, if it has been tuned.
'use strict';
const fs = require('fs');
const path = require('path');
const game = require('./game');
const { Level } = require('../editor/level.js');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'campaign');
const CAMPAIGN_FILE = path.join(DIR, 'campaign.json');
const CONFIG_FILE = path.join(DIR, 'config.txt');
const LEVELS_DIR = path.join(ROOT, 'levels');
const BUILD_DIR = path.join(ROOT, 'build', 'campaign');
const PREFS_FILE = 'gmlbLegoWB2.txt';

const SLOT_RE = /^map([12])\.(\d{1,2})$/;

function loadCampaign() {
  try {
    const c = JSON.parse(fs.readFileSync(CAMPAIGN_FILE, 'utf8'));
    return { missions: c.missions || {} };
  } catch (e) {
    return { missions: {} };
  }
}

function saveCampaign(c) {
  const missions = {};
  for (const [slot, m] of Object.entries((c && c.missions) || {})) {
    if (!SLOT_RE.test(slot) || !m) continue;
    if (m.empty === true && slot !== PLAY_SLOT) { missions[slot] = { empty: true }; continue; }
    const entry = {};
    if (typeof m.level === 'string' && m.level) entry.level = m.level;
    if (typeof m.title === 'string' && m.title.trim()) entry.title = m.title.trim().slice(0, 40);
    if (Array.isArray(m.unlocks)) entry.unlocks = m.unlocks.map(Number).filter((n) => n >= 1 && n <= 13);
    if (Object.keys(entry).length) missions[slot] = entry;
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(CAMPAIGN_FILE, JSON.stringify({ missions }, null, 2) + '\n');
  return { missions };
}

function loadConfigOverride() {
  return fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE, 'latin1') : null;
}

function saveConfigOverride(text) {
  if (text == null) {
    if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
    return;
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, text.replace(/\r\n?/g, '\n'), 'latin1');
}

// Original titles and unlocks, keyed by slot ("map1.1").
function originals(g) {
  const titles = {};
  for (const line of game.getText(g, 'level names').split('\n')) {
    const m = /^(\d+)\s+(\d+)\s+(.*)$/.exec(line.trim());
    if (m) titles[`map${m[1]}.${m[2]}`] = m[3].trim();
  }
  const unlocks = {};
  for (const line of game.getText(g, 'worlds').split('\n')) {
    if (line.trim().startsWith('--')) continue;
    const m = /^\s*(\d+)\s+(\d+)\s*(.*)$/.exec(line);
    if (m) unlocks[`map${m[1]}.${m[2]}`] = m[3].split(/[,\s]+/).filter(Boolean).map(Number);
  }
  return { titles, unlocks };
}

function applyConfig(g) {
  const text = loadConfigOverride();
  if (text != null) game.setText(g, 'config', text);
}

// A level reference is a file in levels/ or a WorldBuilder 1 mission ("wb1:map3.1").
function readLevelFile(file, terrainChars) {
  if (file.startsWith('wb1:')) {
    const text = require('./wb1').wb1LevelText(file, terrainChars);
    if (text == null) throw new Error(`WorldBuilder 1 mission "${file.slice(4)}" not found (is the WorldBuilder folder there?)`);
    return text;
  }
  const p = path.join(LEVELS_DIR, file + '.txt');
  if (!/^[\w\- ]{1,64}$/.test(file) || !fs.existsSync(p)) throw new Error(`Level "${file}" not found in the levels folder`);
  return fs.readFileSync(p, 'latin1');
}

// Patch titles, unlocks and levels from the campaign into a loaded game.
// readLevel(file, terrainChars) returns a mission's level text.
function applyCampaign(g, c, readLevel = readLevelFile) {
  const orig = originals(g);
  const terrainChars = game.getText(g, 'terrainmap').split('\n').filter(Boolean).map((l) => l[0]);
  const titles = { ...orig.titles };
  const unlocks = { ...orig.unlocks };
  const empty = emptySlots(c);
  for (const [slot, m] of Object.entries(c.missions)) {
    if (empty.has(slot)) { unlocks[slot] = []; continue; }
    let title = m.title;
    if (m.level) {
      const level = Level.parse(readLevel(m.level, terrainChars));
      game.setText(g, slot, Level.gameText(level, terrainChars));
      title = title || level.meta.title || m.level;
    }
    if (title) titles[slot] = title.replace(/[\r\n]/g, ' ').slice(0, 40);
    if (m.unlocks) unlocks[slot] = m.unlocks;
  }
  // Nothing may unlock a mission the campaign doesn't use.
  for (const s of Object.keys(unlocks)) {
    const w = SLOT_RE.exec(s)[1];
    unlocks[s] = unlocks[s].filter((u) => !empty.has(`map${w}.${u}`));
  }
  const order = Object.keys(orig.titles);
  const [w1, w2] = ['1', '2'].map((w) => order.filter((s) => s.startsWith(`map${w}.`)));
  const slotParts = (s) => SLOT_RE.exec(s).slice(1, 3);
  game.setText(g, 'level names', [...w1, ...w2].map((s) => `${slotParts(s).join(' ')} ${titles[s]}`).join('\n'));
  game.setText(g, 'worlds', ['-- world, mission, unlocks',
    ...[...w1, ...w2].map((s) => `${slotParts(s).join('\t')}\t${(unlocks[s] || []).join(',')}`)].join('\n'));
}

// Missions the campaign doesn't use (never mission 1.1, which is always open).
function emptySlots(c) {
  return new Set(Object.entries((c && c.missions) || {}).filter(([s, m]) => m && m.empty === true && s !== PLAY_SLOT).map(([s]) => s));
}

// Saved progress: one "world mission state" line per mission, CR separated.
// -1 = locked, 0 = available, 1 = completed (shown as a flag).
function writePrefs(dir, state) {
  const lines = [];
  for (const w of [1, 2]) for (let m = 1; m <= 12; m++) lines.push(`${w} ${m} ${state(w, m)}`);
  fs.mkdirSync(path.join(dir, 'Prefs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Prefs', PREFS_FILE), lines.join('\r'));
}

function buildCampaign({ freshProgress = true, unlockAll = false } = {}) {
  const g = game.load();
  applyConfig(g);
  const c = loadCampaign();
  applyCampaign(g, c);
  const dir = game.writeBuild(g, BUILD_DIR);
  // Missions the campaign doesn't use stay locked (hidden).
  const empty = emptySlots(c);
  if (unlockAll) writePrefs(dir, (w, m) => (empty.has(`map${w}.${m}`) ? -1 : 1));
  else if (freshProgress) {
    const prefs = path.join(dir, 'Prefs', PREFS_FILE);
    if (fs.existsSync(prefs)) fs.unlinkSync(prefs);
  }
  return dir;
}

// The game always unlocks mission 1.1, so single levels are played there.
const PLAY_SLOT = 'map1.1';

// Put a level (game text) in mission 1.1, with its title on the world map.
function applyLevel(g, gameText, title) {
  game.setText(g, PLAY_SLOT, gameText);
  const names = game.getText(g, 'level names').split('\n');
  const t = String(title || 'Custom Level').replace(/[\r\n]/g, ' ').slice(0, 40);
  game.setText(g, 'level names', names.map((l) => (/^1\s+1\s/.test(l) ? `1 1 ${t}` : l)).join('\n'));
}

// Build a shared level file or .wb2campaign.json (e.g. from the gallery)
// into outDir, leaving the saved campaign, levels and unit settings alone:
// a campaign uses its own unit settings, if it has them.
function buildShared({ type, title, data }, outDir) {
  const g = game.load();
  const terrainChars = game.getText(g, 'terrainmap').split('\n').filter(Boolean).map((l) => l[0]);
  if (type === 'level') {
    const level = Level.parse(String(data || ''));
    if (!level.width || !level.height) throw Object.assign(new Error('That is not a WorldBuilder 2 level.'), { status: 400 });
    applyLevel(g, Level.gameText(level, terrainChars), title || level.meta.title || level.name);
  } else if (type === 'campaign') {
    let c;
    try { c = JSON.parse(data); } catch (e) { c = null; }
    if (!c || c.format !== 'wb2-campaign' || typeof c.missions !== 'object') throw Object.assign(new Error('That is not a campaign file.'), { status: 400 });
    if (typeof c.config === 'string') game.setText(g, 'config', c.config);
    const levels = c.levels || {};
    applyCampaign(g, { missions: c.missions }, (file, chars) => {
      if (file.startsWith('wb1:')) return readLevelFile(file, chars);
      if (typeof levels[file] !== 'string') throw Object.assign(new Error(`The campaign is missing its level "${file}".`), { status: 400 });
      return levels[file];
    });
  } else throw Object.assign(new Error('Choose a level or a campaign.'), { status: 400 });
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  const dir = game.writeBuild(g, outDir);
  // Start without the progress of the game it was built from.
  const prefs = path.join(dir, 'Prefs', PREFS_FILE);
  if (fs.existsSync(prefs)) fs.unlinkSync(prefs);
  return dir;
}

module.exports = {
  loadCampaign, saveCampaign, loadConfigOverride, saveConfigOverride,
  originals, applyConfig, applyCampaign, applyLevel, buildShared, buildCampaign, BUILD_DIR, PLAY_SLOT,
};
