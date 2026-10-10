// Custom campaign + unit tuning: stored in campaign/, applied to a patched
// copy of the game.
//
// campaign/campaign.json:
//   { "missions": { "map1.1": { "level": "<file in levels/>"|null,
//                               "title": "..."|null, "unlocks": [2, 3]|null } } }
//   null/missing means "keep the original".
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

function readLevelFile(file) {
  const p = path.join(LEVELS_DIR, file + '.txt');
  if (!/^[\w\- ]{1,64}$/.test(file) || !fs.existsSync(p)) throw new Error(`Level "${file}" not found in the levels folder`);
  return fs.readFileSync(p, 'latin1');
}

// Patch titles, unlocks and levels from the campaign into a loaded game.
function applyCampaign(g, c) {
  const orig = originals(g);
  const terrainChars = game.getText(g, 'terrainmap').split('\n').filter(Boolean).map((l) => l[0]);
  const titles = { ...orig.titles };
  const unlocks = { ...orig.unlocks };
  for (const [slot, m] of Object.entries(c.missions)) {
    let title = m.title;
    if (m.level) {
      const level = Level.parse(readLevelFile(m.level));
      game.setText(g, slot, Level.gameText(level, terrainChars));
      title = title || level.meta.title || m.level;
    }
    if (title) titles[slot] = title.replace(/[\r\n]/g, ' ').slice(0, 40);
    if (m.unlocks) unlocks[slot] = m.unlocks;
  }
  const order = Object.keys(orig.titles);
  const [w1, w2] = ['1', '2'].map((w) => order.filter((s) => s.startsWith(`map${w}.`)));
  const slotParts = (s) => SLOT_RE.exec(s).slice(1, 3);
  game.setText(g, 'level names', [...w1, ...w2].map((s) => `${slotParts(s).join(' ')} ${titles[s]}`).join('\n'));
  game.setText(g, 'worlds', ['-- world, mission, unlocks',
    ...[...w1, ...w2].map((s) => `${slotParts(s).join('\t')}\t${(unlocks[s] || []).join(',')}`)].join('\n'));
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
  applyCampaign(g, loadCampaign());
  const dir = game.writeBuild(g, BUILD_DIR);
  if (unlockAll) writePrefs(dir, () => 1);
  else if (freshProgress) {
    const prefs = path.join(dir, 'Prefs', PREFS_FILE);
    if (fs.existsSync(prefs)) fs.unlinkSync(prefs);
  }
  return dir;
}

module.exports = {
  loadCampaign, saveCampaign, loadConfigOverride, saveConfigOverride,
  originals, applyConfig, applyCampaign, buildCampaign, BUILD_DIR,
};
