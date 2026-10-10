#!/usr/bin/env node
// Extract text cast members (levels, config, labels) from the game movie.
// Usage: node tools/extract.js [game.dcr] [outDir]
'use strict';
const fs = require('fs');
const path = require('path');
const ab = require('./afterburner');
const cast = require('./cast');
const xmed = require('./xmed');

const root = path.join(__dirname, '..');
const src = process.argv[2] || path.join(root, 'WorldBuilder2/worldbuilder2/worldbuilder2.dcr');
const outDir = process.argv[3] || path.join(root, 'extracted');

const movie = ab.parse(fs.readFileSync(src));
fs.mkdirSync(path.join(outDir, 'text'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'levels'), { recursive: true });

let count = 0;
for (const m of cast.members(movie).values()) {
  const child = m.children.find((c) => c.tag === 'XMED');
  if (!child || !m.name) continue;
  const raw = xmed.readText(ab.chunkData(movie, movie.byId.get(child.id)));
  if (raw === null) continue;
  const text = raw.replace(/\r/g, '\n');
  const safe = m.name.replace(/[^\w.\- ]/g, '_');
  const isLevel = /^map\d+\.\d+$/.test(m.name);
  fs.writeFileSync(path.join(outDir, isLevel ? 'levels' : 'text', safe + '.txt'), text, 'latin1');
  count++;
}
console.log(`extracted ${count} text members to ${outDir}`);
