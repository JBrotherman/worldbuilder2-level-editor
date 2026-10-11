// Synchronous zlib inflate/deflate (RFC 1950/1951) for the browser version,
// which has no synchronous built-in. Inflate handles every block type;
// deflate uses LZ77 with hash chains and the fixed Huffman code, which is
// plenty for the few chunks the editor changes.
'use strict';
const { Buffer } = require('buffer');

// ------------------------------------------------------------------ inflate

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// Canonical Huffman decoding table: counts per length and symbols by code.
function huffTable(lengths) {
  const counts = new Uint16Array(16);
  for (const l of lengths) counts[l]++;
  counts[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
  const symbols = new Uint16Array(lengths.length);
  for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbols[offs[lengths[s]]++] = s;
  return { counts, symbols };
}

let FIXED_LIT, FIXED_DIST;
function fixedTables() {
  if (!FIXED_LIT) {
    const l = new Uint8Array(288);
    l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
    FIXED_LIT = huffTable(l);
    FIXED_DIST = huffTable(new Uint8Array(30).fill(5));
  }
  return [FIXED_LIT, FIXED_DIST];
}

function inflateRaw(src, start = 0) {
  let pos = start, bitBuf = 0, bitCnt = 0;
  let out = new Uint8Array(Math.max(1024, src.length * 4));
  let outLen = 0;
  const need = (n) => {
    if (outLen + n <= out.length) return;
    let size = out.length * 2;
    while (size < outLen + n) size *= 2;
    const bigger = new Uint8Array(size);
    bigger.set(out.subarray(0, outLen));
    out = bigger;
  };
  const bits = (n) => {
    while (bitCnt < n) {
      if (pos >= src.length) throw new Error('unexpected end of deflate data');
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };
  const decode = ({ counts, symbols }) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = counts[len];
      if (code - first < count) return symbols[index + code - first];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('invalid Huffman code');
  };

  let final;
  do {
    final = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0; // skip to a byte boundary
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      need(len);
      out.set(src.subarray(pos, pos + len), outLen);
      outLen += len;
      pos += len;
      continue;
    }
    let lit, dist;
    if (type === 1) [lit, dist] = fixedTables();
    else if (type === 2) {
      const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
      const clLens = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) clLens[CL_ORDER[i]] = bits(3);
      const cl = huffTable(clLens);
      const lens = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist;) {
        const sym = decode(cl);
        if (sym < 16) lens[i++] = sym;
        else {
          let rep, val = 0;
          if (sym === 16) { val = lens[i - 1]; rep = 3 + bits(2); } else if (sym === 17) rep = 3 + bits(3); else rep = 11 + bits(7);
          lens.fill(val, i, i + rep);
          i += rep;
        }
      }
      lit = huffTable(lens.subarray(0, hlit));
      dist = huffTable(lens.subarray(hlit));
    } else throw new Error('invalid deflate block type');

    for (;;) {
      const sym = decode(lit);
      if (sym < 256) { need(1); out[outLen++] = sym; continue; }
      if (sym === 256) break;
      const li = sym - 257;
      const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
      const di = decode(dist);
      const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
      if (d > outLen) throw new Error('invalid deflate distance');
      need(len);
      for (let k = 0; k < len; k++, outLen++) out[outLen] = out[outLen - d];
    }
  } while (!final);
  return { data: Buffer.from(out.subarray(0, outLen)), end: pos };
}

function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length;) {
    const end = Math.min(i + 3800, buf.length);
    for (; i < end; i++) { a += buf[i]; b += a; }
    a %= 65521; b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function inflateSync(buf) {
  if ((buf[0] & 0x0f) !== 8 || ((buf[0] << 8) | buf[1]) % 31 !== 0) throw new Error('incorrect header check');
  if (buf[1] & 0x20) throw new Error('preset dictionaries are not supported');
  return inflateRaw(buf, 2).data;
}

function inflateRawSync(buf) { return inflateRaw(buf, 0).data; }

// ------------------------------------------------------------------ deflate

class BitWriter {
  constructor(size) { this.out = new Uint8Array(size); this.len = 0; this.buf = 0; this.cnt = 0; }
  grow() { const b = new Uint8Array(this.out.length * 2); b.set(this.out); this.out = b; }
  bits(value, n) { // LSB first
    this.buf |= value << this.cnt;
    this.cnt += n;
    while (this.cnt >= 8) {
      if (this.len === this.out.length) this.grow();
      this.out[this.len++] = this.buf & 0xff;
      this.buf >>>= 8;
      this.cnt -= 8;
    }
  }
  huff(code, n) { // Huffman codes go MSB first
    let rev = 0;
    for (let i = 0; i < n; i++) rev = (rev << 1) | ((code >> i) & 1);
    this.bits(rev, n);
  }
  finish() { if (this.cnt) this.bits(0, 8 - this.cnt); return this.out.subarray(0, this.len); }
}

function writeLiteral(w, sym) {
  if (sym < 144) w.huff(0x30 + sym, 8);
  else if (sym < 256) w.huff(0x190 + sym - 144, 9);
  else if (sym < 280) w.huff(sym - 256, 7);
  else w.huff(0xc0 + sym - 280, 8);
}

function lengthCode(len) { let i = 28; while (LEN_BASE[i] > len) i--; return i; }
function distCode(d) { let i = 29; while (DIST_BASE[i] > d) i--; return i; }

const WINDOW = 32768, MAX_MATCH = 258, MIN_MATCH = 3, HASH_SIZE = 1 << 15, MAX_CHAIN = 128;

function deflateRaw(data) {
  const w = new BitWriter(Math.max(64, data.length + (data.length >> 3) + 64));
  w.bits(1, 1); // one final block
  w.bits(1, 2); // fixed Huffman
  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(WINDOW);
  const n = data.length;
  const hash = (i) => ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & (HASH_SIZE - 1);
  const insert = (i) => {
    if (i + 2 >= n) return;
    const h = hash(i);
    prev[i & (WINDOW - 1)] = head[h];
    head[h] = i;
  };
  const longest = (i) => {
    let bestLen = 0, bestDist = 0;
    if (i + MIN_MATCH > n) return [0, 0];
    const maxLen = Math.min(MAX_MATCH, n - i);
    let j = head[hash(i)], chain = MAX_CHAIN;
    while (j >= 0 && i - j <= WINDOW && chain-- > 0) {
      if (data[j + bestLen] === data[i + bestLen]) {
        let l = 0;
        while (l < maxLen && data[j + l] === data[i + l]) l++;
        if (l > bestLen) { bestLen = l; bestDist = i - j; if (l === maxLen) break; }
      }
      const p = prev[j & (WINDOW - 1)];
      if (p >= j) break;
      j = p;
    }
    return bestLen >= MIN_MATCH ? [bestLen, bestDist] : [0, 0];
  };

  let i = 0;
  while (i < n) {
    const [len, dist] = longest(i);
    insert(i);
    // Lazy matching: emit a literal if the next position matches longer.
    if (len && len < 32 && i + 1 < n && longest(i + 1)[0] > len) { writeLiteral(w, data[i]); i++; continue; }
    if (!len) { writeLiteral(w, data[i]); i++; continue; }
    const lc = lengthCode(len);
    writeLiteral(w, 257 + lc);
    if (LEN_EXTRA[lc]) w.bits(len - LEN_BASE[lc], LEN_EXTRA[lc]);
    const dc = distCode(dist);
    w.huff(dc, 5);
    if (DIST_EXTRA[dc]) w.bits(dist - DIST_BASE[dc], DIST_EXTRA[dc]);
    for (let k = 1; k < len; k++) insert(i + k);
    i += len;
  }
  writeLiteral(w, 256);
  const packed = w.finish();
  return packed.length <= n + 5 * Math.ceil(n / 65535) ? Buffer.from(packed) : storedBlocks(data);
}

// Uncompressed blocks, for data that doesn't compress.
function storedBlocks(data) {
  const parts = [];
  for (let i = 0; i < data.length || !parts.length; i += 65535) {
    const chunk = data.subarray(i, i + 65535);
    const head = Buffer.alloc(5);
    head[0] = i + 65535 >= data.length ? 1 : 0;
    head.writeUInt16LE(chunk.length, 1);
    head.writeUInt16LE(~chunk.length & 0xffff, 3);
    parts.push(head, chunk);
  }
  return Buffer.concat(parts);
}

function deflateRawSync(data) { return deflateRaw(data); }

function deflateSync(data) {
  const body = deflateRaw(data);
  const out = Buffer.alloc(body.length + 6);
  out[0] = 0x78; out[1] = 0xda;
  out.set(body, 2);
  out.writeUInt32BE(adler32(data), body.length + 2);
  return out;
}

module.exports = { inflateSync, inflateRawSync, deflateSync, deflateRawSync, adler32 };
