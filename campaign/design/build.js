#!/usr/bin/env node
// Builds the Brickwood Valley levels into levels/ and proves each one is
// solvable: the editor's checks must pass and the written solution must
// reach both the goal and the bonus goal in tools/simulate.js.
// Usage: node campaign/design/build.js [--write-campaign]
'use strict';
const fs = require('fs');
const path = require('path');
const { Level } = require('../../editor/level.js');
const { simulate, loadConfig } = require('../../tools/simulate');

const ROOT = path.join(__dirname, '..', '..');
const levels = require('./levels');
const cfg = loadConfig();
const terrainChars = cfg.terrain.map((t) => t.char);

function levelText(def) {
  const rows = def.map.map((r) => r.split(''));
  for (const [k, [x, y]] of Object.entries(def.extra || {})) rows[y][x] = k;
  const width = rows[0].length;
  rows.forEach((r, i) => { if (r.length !== width) throw new Error(`${def.file}: row ${i} is ${r.length} wide, expected ${width}`); });
  const lines = ['[map]', `name=${def.title.toUpperCase()}`, ...rows.map((r) => ` map=${r.join('')}`), '', '[mapitems]'];
  for (const [k, v] of Object.entries(def.items)) lines.push(`${k}=${v}`);
  lines.push('', '[inventory]');
  for (const [k, v] of Object.entries(def.inventory || {})) lines.push(`${k}=${v}`);
  const level = Level.parse(lines.join('\n'));
  level.meta.title = def.title;
  // Start the camera on the player's first unit ('a').
  const y = rows.findIndex((r) => r.includes('a'));
  if (y >= 0) level.center = { x: rows[y].indexOf('a'), y };
  return Level.serialize(level, terrainChars);
}

let failed = 0;
fs.mkdirSync(path.join(ROOT, 'levels'), { recursive: true });
for (const def of levels) {
  try {
    const text = levelText(def);
    const problems = Level.validate(Level.parse(text), cfg).filter((p) => p.severity === 'error');
    if (problems.length) throw new Error('level check: ' + problems.map((p) => p.message).join('; '));
    const { goals } = simulate(text, def.solution, cfg);
    const missed = goals.filter((g) => !g.done);
    if (missed.length) throw new Error(`solution leaves ${missed.map((g) => (g.bonus ? 'bonus goal' : 'goal')).join(', ')} unreached`);
    fs.writeFileSync(path.join(ROOT, 'levels', def.file + '.txt'), text, 'latin1');
    console.log(`ok    ${def.file}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${def.file}: ${e.message}`);
  }
}

if (!failed && process.argv.includes('--write-campaign')) {
  const missions = {};
  levels.forEach((def, i) => {
    missions[`map1.${i + 1}`] = { level: def.file, title: def.title, unlocks: [i + 2] };
  });
  const file = path.join(ROOT, 'campaign', 'campaign.json');
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(ROOT, 'campaign', 'campaign.before-brickwood.json'));
  fs.writeFileSync(file, JSON.stringify({ missions }, null, 2) + '\n');
  console.log('campaign/campaign.json updated (previous version saved as campaign.before-brickwood.json)');
}
process.exitCode = failed ? 1 : 0;
