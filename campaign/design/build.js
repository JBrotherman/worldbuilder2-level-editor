#!/usr/bin/env node
// Builds the campaign levels into levels/ and proves each one is solvable:
// the editor's checks must pass and the written solution must reach both
// the goal and the bonus goal in tools/simulate.js.
//   levels.js  World 1 (Jungle): Brickwood Valley
//   urban.js   World 2 (Urban):  Brickton City
// Usage: node campaign/design/build.js [--write-campaign] [jungle|urban]
'use strict';
const fs = require('fs');
const path = require('path');
const { Level } = require('../../editor/level.js');
const { simulate, loadConfig } = require('../../tools/simulate');

const ROOT = path.join(__dirname, '..', '..');
const only = process.argv.find((a) => a === 'jungle' || a === 'urban');
const WORLDS = [
  { world: 1, name: 'jungle', levels: require('./levels') },
  { world: 2, name: 'urban', levels: require('./urban') },
].filter((w) => !only || w.name === only);
const cfg = loadConfig();
const terrainChars = cfg.terrain.map((t) => t.char);

// Roads are drawn as "R"; pick the piece that connects to neighbouring road.
// Learned from the original maps: \ east-west, / north-south, [ { ] } the
// corners (ES, NE, SW, NW), + crossroads, ) T-junction north-south-west.
const ROAD_PIECES = {
  EW: '\\', E: '\\', W: '\\', NS: '/', N: '/', S: '/', '': '\\',
  ES: '[', NE: '{', SW: ']', NW: '}', NSW: ')', NESW: '+', NES: '+', ESW: '+', NEW: '+',
};
function drawRoads(rows) {
  const isRoad = (x, y) => !!rows[y] && rows[y][x] === 'R';
  return rows.map((r, y) => r.map((c, x) => {
    if (c !== 'R') return c;
    const d = (isRoad(x, y - 1) ? 'N' : '') + (isRoad(x + 1, y) ? 'E' : '') + (isRoad(x, y + 1) ? 'S' : '') + (isRoad(x - 1, y) ? 'W' : '');
    return ROAD_PIECES[d];
  }));
}

function levelText(def) {
  const rows = drawRoads(def.map.map((r) => r.split('')));
  for (const [k, [x, y]] of Object.entries(def.extra || {})) rows[y][x] = k;
  const width = rows[0].length;
  rows.forEach((r, i) => { if (r.length !== width) throw new Error(`row ${i} is ${r.length} wide, expected ${width}`); });
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
for (const w of WORLDS) {
  for (const def of w.levels) {
    try {
      const text = levelText(def);
      const problems = Level.validate(Level.parse(text), cfg).filter((p) => p.severity === 'error');
      if (problems.length) throw new Error('level check: ' + problems.map((p) => p.message).join('; '));
      const { goals, log } = simulate(text, def.solution, cfg);
      const missed = goals.filter((g) => !g.done);
      if (missed.length) throw new Error(`solution leaves ${missed.map((g) => (g.bonus ? 'bonus goal' : 'goal')).join(', ')} unreached`);
      const energies = log.map((l) => /energy (-?[\d.]+)/.exec(l)).filter(Boolean).map((m) => +m[1]);
      fs.writeFileSync(path.join(ROOT, 'levels', def.file + '.txt'), text, 'latin1');
      console.log(`ok    ${def.file}  (lowest energy ${Math.min(...energies).toFixed(0)})`);
    } catch (e) {
      failed++;
      console.log(`FAIL  ${def.file}: ${e.message}`);
      if (process.argv.includes('-v') && e.log) console.log(e.log.slice(-12).map((l) => '      ' + l).join('\n'));
    }
  }
}

if (!failed && process.argv.includes('--write-campaign')) {
  const file = path.join(ROOT, 'campaign', 'campaign.json');
  const missions = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).missions || {} : {};
  for (const w of WORLDS) {
    w.levels.forEach((def, i) => {
      missions[`map${w.world}.${i + 1}`] = { level: def.file, title: def.title, unlocks: [i + 2] };
    });
  }
  fs.writeFileSync(file, JSON.stringify({ missions }, null, 2) + '\n');
  console.log(`campaign/campaign.json updated (world ${WORLDS.map((w) => w.world).join(' and ')})`);
}
process.exitCode = failed ? 1 : 0;
