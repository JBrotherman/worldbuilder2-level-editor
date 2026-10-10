// Cast-level helpers on top of afterburner.js: member names, KEY* links, text.
'use strict';
const ab = require('./afterburner');

// KEY*: links child chunks (BITD, XMED, ...) to their owning CASt chunk.
function readKeys(movie) {
  const d = ab.chunkData(movie, ab.findAll(movie, 'KEY*')[0]);
  const used = d.readUInt32LE(8);
  const keys = [];
  for (let i = 0; i < used; i++) {
    const o = 12 + i * 12;
    keys.push({
      sectionId: d.readUInt32LE(o),
      castId: d.readUInt32LE(o + 4),
      tag: Buffer.from(d.subarray(o + 8, o + 12)).reverse().toString('latin1'),
    });
  }
  return keys;
}

// CASt chunks are big-endian regardless of movie byte order.
function readMember(movie, res) {
  const d = ab.chunkData(movie, res);
  const type = d.readUInt32BE(0);
  const infoLen = d.readUInt32BE(4);
  const specLen = d.readUInt32BE(8);
  const info = d.subarray(12, 12 + infoLen);
  const spec = d.subarray(12 + infoLen, 12 + infoLen + specLen);
  let name = '';
  if (infoLen >= 20) {
    const dataOffset = info.readUInt32BE(0);
    const count = info.readUInt16BE(dataOffset);
    const offsets = [];
    for (let i = 0; i < count; i++) offsets.push(info.readUInt32BE(dataOffset + 2 + i * 4));
    const itemsStart = dataOffset + 2 + count * 4 + 4;
    if (count > 1) {
      const nameItem = info.subarray(itemsStart + offsets[1], itemsStart + (count > 2 ? offsets[2] : info.length - itemsStart));
      if (nameItem.length) name = nameItem.toString('latin1', 1, 1 + nameItem[0]);
    }
  }
  return { id: res.id, type, name, spec };
}

function members(movie) {
  const keys = readKeys(movie);
  const out = new Map();
  for (const res of ab.findAll(movie, 'CASt')) out.set(res.id, { ...readMember(movie, res), children: [] });
  for (const k of keys) {
    const m = out.get(k.castId);
    if (m) m.children.push({ tag: k.tag, id: k.sectionId });
  }
  return out;
}

module.exports = { readKeys, readMember, members };
