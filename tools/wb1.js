// Content from the original LEGO WorldBuilder (WorldBuilder/), added to
// WorldBuilder 2: monster graphics WB2 lacks, and WB1's 60 missions as
// level templates.
'use strict';
const fs = require('fs');
const path = require('path');
const ab = require('./afterburner');
const cast = require('./cast');
const xmed = require('./xmed');
const bm = require('./bitmap');
const { castLibs, libraryWriter } = require('./castedit');

const ROOT = path.join(__dirname, '..');
const WB1_DCR = path.join(ROOT, 'WorldBuilder', 'worldbuilder', 'worldbuilder.dcr');

// WB2's config defines these monsters but its movie only has "frozen"
// pictures of them; WB1 has the full walk/attack animations.
const IMPORTED_SPRITES = /^monster\.(trex|scorpion)(\.|$)/;
// Members are added to the cast library that holds WB2's other monsters.
const TARGET_LIB_MEMBER = 'monster.crab.down';

let wb1Cache;
function loadWb1() {
  if (wb1Cache !== undefined) return wb1Cache;
  wb1Cache = null;
  if (fs.existsSync(WB1_DCR)) {
    const movie = ab.parse(fs.readFileSync(WB1_DCR));
    wb1Cache = { movie, members: cast.members(movie) };
  }
  return wb1Cache;
}

// Copy WB1 members into WB2's monster cast library. Returns names added.
function addMissingSprites(movie) {
  const wb1 = loadWb1();
  if (!wb1) return [];
  const wb2Members = cast.members(movie);
  const wb2ByName = new Map([...wb2Members.values()].map((m) => [m.name, m]));
  const fromWb1 = [...wb1.members.values()].filter((m) => m.type === 1 && IMPORTED_SPRITES.test(m.name));
  const wanted = fromWb1.filter((m) => !wb2ByName.has(m.name));
  // WB2 has a stray, differently drawn scorpion frame; use WB1's so the
  // animation matches.
  const replace = fromWb1.filter((m) => wb2ByName.has(m.name));
  if (!wanted.length && !replace.length) return [];

  const anchor = [...wb2Members.values()].find((m) => m.name === TARGET_LIB_MEMBER);
  const lib = libraryWriter(movie, castLibs(movie).findIndex((l) => l.ids.includes(anchor.id)));
  const wb1Libs = castLibs(wb1.movie);

  // Copy one member (CASt + listed children) and return its member number.
  function copyMember(member, childTags, patchCast) {
    let castData = Buffer.from(ab.chunkData(wb1.movie, wb1.movie.byId.get(member.id)));
    if (patchCast) castData = patchCast(castData);
    const children = member.children.filter((c) => childTags.includes(c.tag))
      .map((c) => ({ tag: c.tag, data: ab.chunkData(wb1.movie, wb1.movie.byId.get(c.id)) }));
    return lib.add(castData, children);
  }

  // Palettes used by the imported bitmaps (WB1 member number -> WB2 number).
  const paletteMap = new Map();
  for (const m of [...wanted, ...replace]) {
    const spec = bm.readSpec(m.spec);
    if (spec.clutId <= 0 || paletteMap.has(spec.clutId)) continue;
    const wb1Lib = wb1Libs.find((l) => l.ids.includes(m.id));
    const palMember = wb1.members.get(wb1Lib.ids[spec.clutId - 1]);
    if (palMember && palMember.children.some((c) => c.tag === 'CLUT')) {
      paletteMap.set(spec.clutId, copyMember(palMember, ['CLUT']));
    }
  }

  const remapPalette = (data) => {
    const specAt = 12 + data.readUInt32BE(4);
    const clutId = data.readInt16BE(specAt + 26);
    if (paletteMap.has(clutId)) data.writeInt16BE(paletteMap.get(clutId), specAt + 26);
    return data;
  };
  for (const m of wanted) copyMember(m, ['BITD'], remapPalette);
  for (const m of replace) {
    const target = wb2ByName.get(m.name);
    const bitd = target.children.find((c) => c.tag === 'BITD');
    const src = m.children.find((c) => c.tag === 'BITD');
    if (!bitd || !src) continue;
    ab.setChunk(movie, target.id, remapPalette(Buffer.from(ab.chunkData(wb1.movie, wb1.movie.byId.get(m.id)))));
    ab.setChunk(movie, bitd.id, ab.chunkData(wb1.movie, wb1.movie.byId.get(src.id)));
  }

  lib.commit();
  return [...wanted, ...replace].map((m) => m.name);
}

// --- WB1 missions as level templates ----------------------------------------

function wb1Text(name) {
  const wb1 = loadWb1();
  if (!wb1) return null;
  for (const m of wb1.members.values()) {
    if (m.name !== name) continue;
    const child = m.children.find((c) => c.tag === 'XMED');
    if (child) return xmed.readText(ab.chunkData(wb1.movie, wb1.movie.byId.get(child.id))).replace(/\r/g, '\n');
  }
  return null;
}

// [{ id: 'wb1:map3.1', title }] for all WB1 missions.
function wb1Levels() {
  if (!loadWb1()) return [];
  const names = wb1Text('level names') || '';
  const out = [];
  for (const line of names.split('\n')) {
    const m = /^(\d+)\s+(\d+)\s+(.*)$/.exec(line.trim());
    if (m && wb1Text(`map${m[1]}.${m[2]}`) != null) {
      const title = m[3].trim().toLowerCase().replace(/(^|[\s\-(])\w/g, (c) => c.toUpperCase());
      out.push({ id: `wb1:map${m[1]}.${m[2]}`, title, world: Number(m[1]) });
    }
  }
  return out;
}

// Level text for a WB1 mission ("wb1:map3.1"), tidied for WB2: map
// characters WB1 left undefined become plain ground, and the title is kept.
function wb1LevelText(id, terrainChars) {
  const { Level } = require('../editor/level.js');
  const name = String(id).replace(/^wb1:/, '');
  const text = wb1Text(name);
  if (text == null || !/^map\d+\.\d+$/.test(name)) return null;
  const level = Level.parse(text);
  const known = new Set(terrainChars);
  for (const row of level.terrain) row.forEach((ch, x) => { if (!known.has(ch) && ch !== 'whirlpool') row[x] = '.'; });
  const info = wb1Levels().find((l) => l.id === `wb1:${name}`);
  if (info) level.meta.title = info.title;
  return Level.serialize(level, terrainChars);
}

module.exports = { loadWb1, addMissingSprites, wb1Text, wb1Levels, wb1LevelText, IMPORTED_SPRITES };
