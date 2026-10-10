// Decode Director bitmap cast members (BITD) to RGBA, and encode PNGs.
'use strict';
const zlib = require('zlib');
const ab = require('./afterburner');

// Bitmap CASt spec data (big-endian).
function readSpec(spec) {
  const top = spec.readInt16BE(2), left = spec.readInt16BE(4);
  const bottom = spec.readInt16BE(6), right = spec.readInt16BE(8);
  return {
    pitch: spec.readUInt16BE(0) & 0x3fff,
    width: right - left,
    height: bottom - top,
    regY: spec.readInt16BE(18),
    regX: spec.readInt16BE(20),
    bpp: spec.length > 23 ? spec[23] || 1 : 1,
    clutLib: spec.length > 25 ? spec.readInt16BE(24) : 0,
    clutId: spec.length > 27 ? spec.readInt16BE(26) : 0,
  };
}

// PackBits-style RLE used by BITD chunks.
function unpack(data, size) {
  if (data.length >= size) return data;
  const out = Buffer.alloc(size);
  let o = 0;
  for (let i = 0; i < data.length && o < size;) {
    const n = data[i++];
    if (n < 0x80) {
      data.copy(out, o, i, i + n + 1);
      o += n + 1; i += n + 1;
    } else {
      out.fill(data[i++], o, Math.min(size, o + 257 - n));
      o += 257 - n;
    }
  }
  return out;
}

// palette: array of [r,g,b] or null (grayscale fallback).
function decode(spec, bitd, palette) {
  const { width: w, height: h, pitch, bpp } = spec;
  const raw = unpack(bitd, pitch * h);
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = y * pitch;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (bpp === 32) {
        // Channels are stored as planes within each row: A, R, G, B.
        rgba[o] = raw[row + w + x];
        rgba[o + 1] = raw[row + 2 * w + x];
        rgba[o + 2] = raw[row + 3 * w + x];
        rgba[o + 3] = raw[row + x];
      } else if (bpp === 16) {
        const v = (raw[row + x] << 8) | raw[row + w + x];
        rgba[o] = ((v >> 10) & 31) * 255 / 31;
        rgba[o + 1] = ((v >> 5) & 31) * 255 / 31;
        rgba[o + 2] = (v & 31) * 255 / 31;
        rgba[o + 3] = 255;
      } else {
        const perByte = 8 / bpp;
        const byte = raw[row + Math.floor(x / perByte)];
        const shift = 8 - bpp * (x % perByte + 1);
        const idx = (byte >> shift) & ((1 << bpp) - 1);
        let c;
        if (bpp === 1) c = idx ? [0, 0, 0] : [255, 255, 255];
        else if (palette) c = palette[idx] || [0, 0, 0];
        else { const g = 255 - idx * 255 / ((1 << bpp) - 1); c = [g, g, g]; }
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
      }
    }
  }
  return { width: w, height: h, rgba };
}

// CLUT chunk: 6 bytes per entry, 16-bit big-endian r, g, b.
function readClut(buf) {
  const pal = [];
  for (let i = 0; i + 6 <= buf.length; i += 6) pal.push([buf[i], buf[i + 2], buf[i + 4]]);
  return pal;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng({ width, height, rgba }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const rows = [];
  for (let y = 0; y < height; y++) rows.push(Buffer.from([0]), rgba.subarray(y * width * 4, (y + 1) * width * 4));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function decodeMember(movie, member, palettes) {
  const spec = readSpec(member.spec);
  const child = member.children.find((c) => c.tag === 'BITD');
  const res = child && movie.byId.get(child.id);
  if (!res || spec.width <= 0 || spec.height <= 0) return null;
  const palette = palettes ? palettes(spec) : null;
  return { ...decode(spec, ab.chunkData(movie, res), palette), regX: spec.regX, regY: spec.regY, bpp: spec.bpp };
}

module.exports = { readSpec, decode, decodeMember, readClut, encodePng };
