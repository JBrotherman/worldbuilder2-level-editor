// Load the original WorldBuilder 2 files, read/replace level texts, and write
// a patched, playable copy. The original game folder is never modified.
'use strict';
const fs = require('fs');
const path = require('path');
const ab = require('./afterburner');
const cast = require('./cast');
const xmed = require('./xmed');

const ROOT = path.join(__dirname, '..');
const GAME_DIR = path.join(ROOT, 'WorldBuilder2', 'worldbuilder2');
const BUILD_DIR = path.join(ROOT, 'build', 'worldbuilder2');

function load() {
  const movie = ab.parse(fs.readFileSync(path.join(GAME_DIR, 'worldbuilder2.dcr')));
  const textMembers = new Map(); // name -> XMED resource
  for (const m of cast.members(movie).values()) {
    const child = m.children.find((c) => c.tag === 'XMED');
    if (child && m.name) textMembers.set(m.name, movie.byId.get(child.id));
  }
  return { movie, textMembers };
}

// Game text uses \r line breaks; we expose \n.
function getText(game, name) {
  const res = game.textMembers.get(name);
  if (!res) throw new Error(`no text member "${name}"`);
  return xmed.readText(ab.chunkData(game.movie, res)).replace(/\r/g, '\n');
}

function setText(game, name, text) {
  const res = game.textMembers.get(name);
  if (!res) throw new Error(`no text member "${name}"`);
  const raw = text.replace(/\r\n?/g, '\n').replace(/\n/g, '\r');
  ab.setChunk(game.movie, res.id, xmed.replaceText(ab.chunkData(game.movie, res), raw));
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
  fs.cpSync(GAME_DIR, outDir, { recursive: true });
  const movieBuf = ab.serialize(game.movie);
  fs.writeFileSync(path.join(outDir, 'worldbuilder2.dcr'), movieBuf);
  const exe = fs.readFileSync(path.join(GAME_DIR, 'Launcher.exe'));
  fs.writeFileSync(path.join(outDir, 'Launcher.exe'), patchProjector(exe, movieBuf));
  return outDir;
}

module.exports = { load, getText, setText, levelNames, writeBuild, GAME_DIR, BUILD_DIR };
