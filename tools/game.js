// Load the original WorldBuilder 2 files, read/replace level texts, and write
// a patched, playable copy. The original game folder is never modified.
'use strict';
const fs = require('fs');
const path = require('path');
const ab = require('./afterburner');
const cast = require('./cast');
const xmed = require('./xmed');
const paths = require('./paths');

const ROOT = path.join(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build', 'worldbuilder2');

// The WorldBuilder 2 folder (see paths.js). Read on every load, so a newly
// configured location is picked up without a restart.
const gameDir = () => paths.wb2Dir();

// extras: also add content from the original WorldBuilder (see wb1.js), when
// its folder is present.
function load({ extras = true } = {}) {
  const movie = ab.parse(fs.readFileSync(path.join(gameDir(), 'worldbuilder2.dcr')));
  const added = [...require('./fixes').applyFixes(movie), ...(extras ? require('./wb1').addMissingSprites(movie) : [])];
  const textMembers = new Map(); // name -> XMED resource
  for (const m of cast.members(movie).values()) {
    const child = m.children.find((c) => c.tag === 'XMED');
    if (child && m.name) textMembers.set(m.name, movie.byId.get(child.id));
  }
  return { movie, textMembers, added };
}

// Game text uses \r line breaks; we expose \n.
function getText(game, name) {
  const res = game.textMembers.get(name);
  if (!res) throw new Error(`no text member "${name}"`);
  return xmed.readText(ab.chunkData(game.movie, res)).replace(/\r/g, '\n');
}

// Members whose text is only read by the game's scripts, never shown, may be
// longer than a level.
const LONG_TEXT_MEMBERS = new Set(['config']);

function setText(game, name, text) {
  const res = game.textMembers.get(name);
  if (!res) throw new Error(`no text member "${name}"`);
  const raw = text.replace(/\r\n?/g, '\n').replace(/\n/g, '\r');
  let current = ab.chunkData(game.movie, res);
  // Long texts are stored in several parts with cached word-wrap layout. We
  // write them as one part, using a single-part text member as the template.
  if (xmed.isMultiPart(current)) current = ab.chunkData(game.movie, game.textMembers.get('map1.1'));
  const maxLength = LONG_TEXT_MEMBERS.has(name) ? 32000 : undefined;
  ab.setChunk(game.movie, res.id, xmed.replaceText(current, raw, { maxLength }));
}

function levelNames(game) {
  return [...game.textMembers.keys()].filter((n) => /^map\d+\.\d+$/.test(n));
}

// The projector (Launcher.exe) embeds its own copy of the movie at the end of
// the file, followed by a 4-byte pointer to the projector's file table.
function patchProjector(exe, movieBuf) {
  const start = exe.lastIndexOf(Buffer.from('MDGF')) - 8;
  if (start < 0 || exe.toString('latin1', start, start + 4) !== 'XFIR') throw new Error('embedded movie not found in projector');
  const oldLen = exe.readUInt32LE(start + 4) + 8;
  const trailer = exe.subarray(start + oldLen);
  if (trailer.length !== 4) throw new Error('unexpected data after embedded movie');
  return Buffer.concat([exe.subarray(0, start), movieBuf, trailer]);
}

// Write a full playable copy of the game folder with the patched movie.
function writeBuild(game, outDir = BUILD_DIR) {
  fs.mkdirSync(outDir, { recursive: true });
  const src = gameDir();
  fs.cpSync(src, outDir, { recursive: true });
  const movieBuf = ab.serialize(game.movie);
  fs.writeFileSync(path.join(outDir, 'worldbuilder2.dcr'), movieBuf);
  const exe = fs.readFileSync(path.join(src, 'Launcher.exe'));
  fs.writeFileSync(path.join(outDir, 'Launcher.exe'), patchProjector(exe, movieBuf));
  return outDir;
}

module.exports = { load, getText, setText, levelNames, writeBuild, gameDir, BUILD_DIR };
