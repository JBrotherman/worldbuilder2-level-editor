// Look up bitmap cast members by name and render them as PNG, resolving
// palettes and keying out white (the game draws these with
// "background transparent" ink).
'use strict';
const ab = require('./afterburner');
const cast = require('./cast');
const bm = require('./bitmap');
const { systemWin } = require('./palettes');

function createSpriteStore(movie) {
  const members = cast.members(movie);
  // CAS* chunks list each cast library's CASt ids, indexed by member number - 1.
  const libs = ab.findAll(movie, 'CAS*').map((res) => {
    const d = ab.chunkData(movie, res);
    const ids = [];
    for (let i = 0; i + 4 <= d.length; i += 4) ids.push(d.readUInt32BE(i));
    return ids;
  });
  const libOf = new Map();
  libs.forEach((ids, lib) => ids.forEach((id) => libOf.set(id, lib)));

  const byName = new Map();
  for (const m of members.values()) {
    if (m.type === 1 && m.name && !byName.has(m.name) && m.children.some((c) => c.tag === 'BITD' && movie.byId.has(c.id))) {
      byName.set(m.name, m);
    }
  }

  function palette(member, spec) {
    if (spec.clutId === -101 || spec.clutId === 0) return systemWin;
    if (spec.clutId < 0) return null;
    const ids = libs[libOf.get(member.id)];
    const clutMember = ids && members.get(ids[spec.clutId - 1]);
    const clut = clutMember && clutMember.children.find((c) => c.tag === 'CLUT');
    return clut ? bm.readClut(ab.chunkData(movie, movie.byId.get(clut.id))) : systemWin;
  }

  const cache = new Map();
  function render(name) {
    if (cache.has(name)) return cache.get(name);
    const member = byName.get(name);
    let out = null;
    if (member) {
      const img = bm.decodeMember(movie, member, (spec) => palette(member, spec));
      if (img) {
        const px = img.rgba;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i] === 255 && px[i + 1] === 255 && px[i + 2] === 255) px[i + 3] = 0;
        }
        out = { png: bm.encodePng(img), width: img.width, height: img.height, regX: img.regX, regY: img.regY };
      }
    }
    cache.set(name, out);
    return out;
  }

  // Size and registration point of every bitmap, without decoding pixels.
  function info() {
    const out = {};
    for (const [name, m] of byName) {
      const s = bm.readSpec(m.spec);
      out[name] = { w: s.width, h: s.height, regX: s.regX, regY: s.regY };
    }
    return out;
  }

  return { render, info };
}

module.exports = { createSpriteStore };
