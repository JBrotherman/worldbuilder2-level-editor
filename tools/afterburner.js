// Reader/writer for Director "Afterburner" (.dcr) files.
// Layout: 'XFIR' len 'MDGF' | Fver | Fcdr | ABMP | FGEI <ILS body + chunk bodies>
// Chunk offsets in the ABMP are relative to the start of the FGEI body.
'use strict';
const zlib = require('zlib');

const ZLIB_GUIDS = ['ac99e904-0070-0b36-0000-0800072c9a3c', 'ac99e904-0070-0b36-0000-080007377a34'];

class Reader {
  constructor(buf, pos = 0) { this.buf = buf; this.pos = pos; }
  eof() { return this.pos >= this.buf.length; }
  u8() { return this.buf[this.pos++]; }
  u16le() { const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  u32le() { const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v; }
  bytes(n) { const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  // FourCCs are stored little-endian, i.e. byte-reversed.
  fourcc() { return Buffer.from(this.bytes(4)).reverse().toString('latin1'); }
  varint() {
    let v = 0, b;
    do { b = this.u8(); v = v * 128 + (b & 0x7f); } while (b & 0x80);
    return v > 0x7fffffff ? v - 0x100000000 : v;
  }
  cstr() { const end = this.buf.indexOf(0, this.pos); const s = this.buf.toString('latin1', this.pos, end); this.pos = end + 1; return s; }
}

function encVarint(v) {
  if (v < 0) v += 0x100000000;
  const out = [v & 0x7f];
  v = Math.floor(v / 128);
  while (v > 0) { out.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
  return Buffer.from(out);
}

function fourccBytes(s) { return Buffer.from(s, 'latin1').reverse(); }

function guidString(b) {
  const h = (x) => x.toString(16).padStart(8, '0');
  return [
    h(b.readUInt32LE(0)),
    b.readUInt16LE(4).toString(16).padStart(4, '0'),
    b.readUInt16LE(6).toString(16).padStart(4, '0'),
    b.subarray(8, 10).toString('hex'),
    b.subarray(10, 16).toString('hex'),
  ].join('-');
}

function parse(buf) {
  const r = new Reader(buf);
  if (r.fourcc() !== 'RIFX') throw new Error('not an XFIR file');
  r.u32le();
  const codec = r.fourcc();
  if (codec !== 'FGDM') throw new Error('not an Afterburner movie (codec ' + codec + ')');

  const sections = {};
  // Fver
  if (r.fourcc() !== 'Fver') throw new Error('expected Fver');
  let len = r.varint();
  sections.fverRaw = r.bytes(len);

  // Fcdr: compression type table
  if (r.fourcc() !== 'Fcdr') throw new Error('expected Fcdr');
  len = r.varint();
  sections.fcdrRaw = r.bytes(len);
  const fcdr = new Reader(zlib.inflateSync(sections.fcdrRaw));
  const typeCount = fcdr.u16le();
  const compressionTypes = [];
  for (let i = 0; i < typeCount; i++) compressionTypes.push({ guid: guidString(fcdr.bytes(16)) });
  for (let i = 0; i < typeCount; i++) compressionTypes[i].name = fcdr.cstr();

  // ABMP: resource map
  if (r.fourcc() !== 'ABMP') throw new Error('expected ABMP');
  len = r.varint();
  const abmpEnd = r.pos + len;
  const abmpCompType = r.varint();
  r.varint(); // uncompressed length
  const abmp = new Reader(zlib.inflateSync(r.buf.subarray(r.pos, abmpEnd)));
  r.pos = abmpEnd;
  const abmpUnk1 = abmp.varint();
  const abmpUnk2 = abmp.varint();
  const resCount = abmp.varint();
  const resources = [];
  for (let i = 0; i < resCount; i++) {
    resources.push({
      id: abmp.varint(),
      offset: abmp.varint(),
      compSize: abmp.varint(),
      size: abmp.varint(),
      compType: abmp.varint(),
      tag: abmp.fourcc(),
    });
  }

  // FGEI: initial load segment
  if (r.fourcc() !== 'FGEI') throw new Error('expected FGEI');
  const fgeiUnk = r.varint();
  const bodyOffset = r.pos;
  const byId = new Map(resources.map((res) => [res.id, res]));
  const ilsInfo = byId.get(2);
  const ils = new Reader(zlib.inflateSync(buf.subarray(bodyOffset, bodyOffset + ilsInfo.compSize)));
  const ilsData = new Map();
  while (!ils.eof()) {
    const id = ils.varint();
    ilsData.set(id, Buffer.from(ils.bytes(byId.get(id).compSize)));
  }

  const movie = {
    buf, codec, sections, compressionTypes, abmpCompType, abmpUnk1, abmpUnk2, fgeiUnk,
    resources, byId, bodyOffset, ilsInfo, ilsData, overrides: new Map(),
  };
  return movie;
}

// Raw (still compressed) bytes of a resource as stored in the file.
function rawChunk(movie, res) {
  if (movie.ilsData.has(res.id)) return movie.ilsData.get(res.id);
  const start = movie.bodyOffset + res.offset;
  return movie.buf.subarray(start, start + res.compSize);
}

function isZlib(movie, res) {
  const t = movie.compressionTypes[res.compType];
  return !!t && ZLIB_GUIDS.includes(t.guid);
}

function chunkData(movie, res) {
  if (movie.overrides.has(res.id)) return movie.overrides.get(res.id);
  const raw = rawChunk(movie, res);
  // Chunks inside the ILS are stored uncompressed (the ILS itself is zlib'd).
  if (movie.ilsData.has(res.id)) return raw;
  return isZlib(movie, res) ? zlib.inflateSync(raw) : raw;
}

function findAll(movie, tag) { return movie.resources.filter((r) => r.tag === tag); }

// Replace the uncompressed contents of a resource (written by serialize()).
function setChunk(movie, id, data) { movie.overrides.set(id, Buffer.from(data)); }

// Rebuild the file. Untouched chunks keep their original bytes; overridden
// chunks are recompressed and appended after the original chunk bodies.
function serialize(movie) {
  const resources = movie.resources.map((r) => ({ ...r }));
  const byId = new Map(resources.map((r) => [r.id, r]));
  const origBody = movie.buf.subarray(movie.bodyOffset);
  const appended = [];
  let tail = origBody.length;
  const newIls = new Map(movie.ilsData);

  for (const [id, data] of movie.overrides) {
    const res = byId.get(id);
    const inIls = newIls.has(id);
    const stored = !inIls && isZlib(movie, res) ? zlib.deflateSync(data, { level: 9 }) : data;
    res.size = data.length;
    res.compSize = stored.length;
    if (inIls) {
      newIls.set(id, stored);
    } else {
      res.offset = tail;
      appended.push(stored);
      tail += stored.length;
    }
  }

  let body = Buffer.concat([origBody, ...appended]);
  const ilsTouched = [...movie.overrides.keys()].some((id) => movie.ilsData.has(id));
  if (ilsTouched) {
    // ILS must stay at body offset 0; rebuild it and shift everything else.
    const parts = [];
    for (const [id, data] of newIls) parts.push(encVarint(id), data);
    const ilsRaw = Buffer.concat(parts);
    const ilsComp = zlib.deflateSync(ilsRaw, { level: 9 });
    const ils = byId.get(2);
    const delta = ilsComp.length - movie.ilsInfo.compSize;
    ils.compSize = ilsComp.length;
    ils.size = ilsRaw.length;
    for (const r of resources) if (r.id !== 2 && r.offset >= 0) r.offset += delta;
    body = Buffer.concat([ilsComp, body.subarray(movie.ilsInfo.compSize)]);
  }

  const abmpParts = [encVarint(movie.abmpUnk1), encVarint(movie.abmpUnk2), encVarint(resources.length)];
  for (const r of resources) {
    abmpParts.push(encVarint(r.id), encVarint(r.offset), encVarint(r.compSize), encVarint(r.size), encVarint(r.compType), fourccBytes(r.tag));
  }
  const abmpRaw = Buffer.concat(abmpParts);
  const abmpComp = zlib.deflateSync(abmpRaw, { level: 9 });
  const abmpBody = Buffer.concat([encVarint(movie.abmpCompType), encVarint(abmpRaw.length), abmpComp]);

  const content = Buffer.concat([
    fourccBytes('FGDM'),
    fourccBytes('Fver'), encVarint(movie.sections.fverRaw.length), movie.sections.fverRaw,
    fourccBytes('Fcdr'), encVarint(movie.sections.fcdrRaw.length), movie.sections.fcdrRaw,
    fourccBytes('ABMP'), encVarint(abmpBody.length), abmpBody,
    fourccBytes('FGEI'), encVarint(movie.fgeiUnk),
    body,
  ]);
  const header = Buffer.alloc(8);
  fourccBytes('RIFX').copy(header, 0);
  header.writeUInt32LE(content.length, 4);
  return Buffer.concat([header, content]);
}

module.exports = { parse, serialize, chunkData, rawChunk, findAll, setChunk, Reader };
