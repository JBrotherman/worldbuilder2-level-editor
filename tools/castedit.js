// Helpers for adding cast members to a movie: cast library lists (CAS*),
// the library table (MCsL), the key table (KEY*) and member names (CASt).
'use strict';
const ab = require('./afterburner');
const cast = require('./cast');

// Cast libraries: CAS* chunk per library, listing CASt ids by member number.
function castLibs(movie) {
  return ab.findAll(movie, 'CAS*').map((res) => {
    const d = ab.chunkData(movie, res);
    const ids = [];
    for (let i = 0; i + 4 <= d.length; i += 4) ids.push(d.readUInt32BE(i));
    return { res, ids };
  });
}

// MCsL: cast library table. Each library has 4 items (name, path, preload,
// [minMember u16, maxMember u16, castId u32]); we update maxMember.
function setLibMaxMember(movie, libIndex, max) {
  const res = ab.findAll(movie, 'MCsL')[0];
  const d = Buffer.from(ab.chunkData(movie, res));
  const dataOffset = d.readUInt32BE(0);
  const itemsPerCast = d.readUInt16BE(8);
  const count = d.readUInt16BE(dataOffset);
  const offsets = [];
  for (let i = 0; i < count; i++) offsets.push(d.readUInt32BE(dataOffset + 2 + i * 4));
  const itemsStart = dataOffset + 2 + count * 4 + 4;
  const item = offsets[1 + libIndex * itemsPerCast + 3];
  d.writeUInt16BE(max, itemsStart + item + 2);
  ab.setChunk(movie, res.id, d);
}

// KEY*: add links from child chunks (BITD, CLUT) to their CASt. The player
// looks entries up by binary search, so the table must stay sorted by owner
// (castId); appending out of order breaks lookups of other entries.
function addKeys(movie, entries) {
  const res = ab.findAll(movie, 'KEY*')[0];
  const old = ab.chunkData(movie, res);
  const used = old.readUInt32LE(8);
  const all = [];
  for (let i = 0; i < used; i++) all.push(old.subarray(12 + i * 12, 24 + i * 12));
  for (const { sectionId, castId, tag } of entries) {
    const e = Buffer.alloc(12);
    e.writeUInt32LE(sectionId, 0);
    e.writeUInt32LE(castId, 4);
    Buffer.from(tag, 'latin1').reverse().copy(e, 8);
    all.push(e);
  }
  // Array.prototype.sort is stable, so existing entries keep their order.
  all.sort((a, b) => a.readUInt32LE(4) - b.readUInt32LE(4));
  const max = Math.max(old.readUInt32LE(4), all.length);
  const d = Buffer.alloc(12 + max * 12);
  old.copy(d, 0, 0, 12);
  d.writeUInt32LE(max, 4);
  d.writeUInt32LE(all.length, 8);
  all.forEach((e, i) => e.copy(d, 12 + i * 12));
  ab.setChunk(movie, res.id, d);
}

// A cast library being added to: call add() per member, then commit().
function libraryWriter(movie, libIndex) {
  const lib = castLibs(movie)[libIndex];
  const keys = [];
  return {
    // castData: CASt chunk bytes; children: [{tag, data}]. Returns member number.
    add(castData, children = []) {
      const castId = ab.addChunk(movie, 'CASt', castData, { ils: true });
      for (const { tag, data } of children) keys.push({ sectionId: ab.addChunk(movie, tag, data), castId, tag });
      lib.ids.push(castId);
      return lib.ids.length;
    },
    commit() {
      const casStar = Buffer.alloc(lib.ids.length * 4);
      lib.ids.forEach((id, i) => casStar.writeUInt32BE(id, i * 4));
      ab.setChunk(movie, lib.res.id, casStar);
      setLibMaxMember(movie, libIndex, lib.ids.length);
      addKeys(movie, keys);
    },
  };
}

// Index of the cast library holding the member with this name.
function libIndexOf(movie, memberName) {
  const member = [...cast.members(movie).values()].find((m) => m.name === memberName);
  if (!member) throw new Error(`no member "${memberName}"`);
  return castLibs(movie).findIndex((l) => l.ids.includes(member.id));
}

// Return a copy of CASt chunk bytes with a different member name. The info
// block is a list whose item 1 is the name (as a Pascal string).
function renameCast(castData, name) {
  const infoLen = castData.readUInt32BE(4);
  const info = castData.subarray(12, 12 + infoLen);
  const spec = castData.subarray(12 + infoLen);
  const dataOffset = info.readUInt32BE(0);
  const count = info.readUInt16BE(dataOffset);
  const offsets = [];
  for (let i = 0; i < count; i++) offsets.push(info.readUInt32BE(dataOffset + 2 + i * 4));
  const itemsStart = dataOffset + 2 + count * 4 + 4;
  const itemsLen = info.readUInt32BE(dataOffset + 2 + count * 4);
  const items = offsets.map((o, i) => info.subarray(itemsStart + o, itemsStart + (i + 1 < count ? offsets[i + 1] : itemsLen)));
  items[1] = Buffer.concat([Buffer.from([name.length]), Buffer.from(name, 'latin1')]);
  const table = Buffer.alloc(2 + count * 4 + 4);
  table.writeUInt16BE(count, 0);
  let o = 0;
  items.forEach((it, i) => { table.writeUInt32BE(o, 2 + i * 4); o += it.length; });
  table.writeUInt32BE(o, 2 + count * 4);
  const newInfo = Buffer.concat([info.subarray(0, dataOffset), table, ...items]);
  const header = Buffer.from(castData.subarray(0, 12));
  header.writeUInt32BE(newInfo.length, 4);
  return Buffer.concat([header, newInfo, spec]);
}

module.exports = { castLibs, setLibMaxMember, addKeys, libraryWriter, libIndexOf, renameCast };
