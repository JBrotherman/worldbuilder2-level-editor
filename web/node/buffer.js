// The parts of Node's Buffer the game tools use, for the browser version.
// A Buffer is a Uint8Array; slice() and subarray() return views, like Node.
'use strict';

const latin1Decode = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return s;
};

function normEnc(enc) {
  const e = String(enc || 'utf8').toLowerCase();
  if (e === 'utf-8') return 'utf8';
  if (e === 'binary') return 'latin1';
  return e;
}

class Buffer extends Uint8Array {
  static alloc(size, fill = 0) {
    const b = new Buffer(size);
    if (fill) b.fill(fill);
    return b;
  }

  static allocUnsafe(size) { return new Buffer(size); }

  static from(value, encOrOffset, length) {
    if (typeof value === 'string') {
      const enc = normEnc(encOrOffset);
      if (enc === 'latin1' || enc === 'ascii') {
        const b = new Buffer(value.length);
        for (let i = 0; i < value.length; i++) b[i] = value.charCodeAt(i) & 0xff;
        return b;
      }
      if (enc === 'hex') {
        const b = new Buffer(value.length >> 1);
        for (let i = 0; i < b.length; i++) b[i] = parseInt(value.substr(i * 2, 2), 16);
        return b;
      }
      if (enc === 'base64') {
        const bin = atob(value);
        return Buffer.from(bin, 'latin1');
      }
      const u = new TextEncoder().encode(value);
      return new Buffer(u.buffer, u.byteOffset, u.byteLength);
    }
    if (value instanceof ArrayBuffer) return new Buffer(value, encOrOffset || 0, length === undefined ? value.byteLength - (encOrOffset || 0) : length);
    // Arrays, typed arrays and Buffers are copied.
    const b = new Buffer(value.length);
    b.set(value);
    return b;
  }

  static concat(list, totalLength) {
    const total = totalLength === undefined ? list.reduce((n, b) => n + b.length, 0) : totalLength;
    const out = new Buffer(total);
    let pos = 0;
    for (const b of list) {
      if (pos >= total) break;
      const part = b.length > total - pos ? b.subarray(0, total - pos) : b;
      out.set(part, pos);
      pos += part.length;
    }
    return out;
  }

  static isBuffer(b) { return b instanceof Buffer; }

  static byteLength(s, enc) { return typeof s === 'string' ? Buffer.from(s, enc).length : s.byteLength; }

  static compare(a, b) { return Buffer.prototype.compare.call(a, b); }

  get _view() {
    if (!this._dv) Object.defineProperty(this, '_dv', { value: new DataView(this.buffer, this.byteOffset, this.byteLength) });
    return this._dv;
  }

  slice(start, end) { return this.subarray(start, end); }

  toString(enc, start = 0, end = this.length) {
    const bytes = this.subarray(start, end);
    switch (normEnc(enc)) {
      case 'latin1': return latin1Decode(bytes);
      case 'ascii': return latin1Decode(bytes.map((c) => c & 0x7f));
      case 'hex': return Array.from(bytes, (c) => c.toString(16).padStart(2, '0')).join('');
      case 'base64': return btoa(latin1Decode(bytes));
      default: return new TextDecoder().decode(bytes);
    }
  }

  equals(other) { return this.compare(other) === 0; }

  compare(other) {
    const n = Math.min(this.length, other.length);
    for (let i = 0; i < n; i++) if (this[i] !== other[i]) return this[i] < other[i] ? -1 : 1;
    return this.length === other.length ? 0 : this.length < other.length ? -1 : 1;
  }

  copy(target, targetStart = 0, sourceStart = 0, sourceEnd = this.length) {
    const src = this.subarray(sourceStart, Math.min(sourceEnd, sourceStart + target.length - targetStart));
    target.set(src, targetStart);
    return src.length;
  }

  fill(value, offset = 0, end = this.length) {
    if (typeof value === 'string') value = value.length ? value.charCodeAt(0) & 0xff : 0;
    return Uint8Array.prototype.fill.call(this, value, offset, end);
  }

  write(string, offset = 0, length, enc) {
    if (typeof length === 'string') { enc = length; length = undefined; }
    const bytes = Buffer.from(string, enc);
    const n = Math.min(bytes.length, this.length - offset, length === undefined ? Infinity : length);
    this.set(bytes.subarray(0, n), offset);
    return n;
  }

  _needle(value, enc) {
    if (typeof value === 'number') return [value & 0xff];
    return typeof value === 'string' ? Buffer.from(value, enc) : value;
  }

  indexOf(value, from = 0, enc) {
    const n = this._needle(value, enc);
    if (from < 0) from = Math.max(0, this.length + from);
    if (n.length === 1) return Uint8Array.prototype.indexOf.call(this, n[0], from);
    if (n.length === 0) return Math.min(from, this.length);
    const first = n[0];
    for (let i = Uint8Array.prototype.indexOf.call(this, first, from); i >= 0 && i <= this.length - n.length; i = Uint8Array.prototype.indexOf.call(this, first, i + 1)) {
      let j = 1;
      while (j < n.length && this[i + j] === n[j]) j++;
      if (j === n.length) return i;
    }
    return -1;
  }

  lastIndexOf(value, from = this.length, enc) {
    const n = this._needle(value, enc);
    if (from < 0) from = this.length + from;
    for (let i = Math.min(from, this.length - n.length); i >= 0; i--) {
      let j = 0;
      while (j < n.length && this[i + j] === n[j]) j++;
      if (j === n.length) return i;
    }
    return -1;
  }

  includes(value, from, enc) { return this.indexOf(value, from, enc) !== -1; }

  toJSON() { return { type: 'Buffer', data: Array.from(this) }; }
}

// readUInt16LE, writeInt32BE, ... via DataView.
for (const [name, size, getter] of [['UInt8', 1, 'Uint8'], ['Int8', 1, 'Int8'], ['UInt16', 2, 'Uint16'], ['Int16', 2, 'Int16'], ['UInt32', 4, 'Uint32'], ['Int32', 4, 'Int32']]) {
  for (const le of size === 1 ? [null] : [true, false]) {
    const suffix = le === null ? '' : le ? 'LE' : 'BE';
    Buffer.prototype[`read${name}${suffix}`] = function (offset = 0) {
      if (offset + size > this.length) throw new RangeError(`read${name}${suffix}: offset ${offset} out of range`);
      return this._view[`get${getter}`](offset, !!le);
    };
    Buffer.prototype[`write${name}${suffix}`] = function (value, offset = 0) {
      if (offset + size > this.length) throw new RangeError(`write${name}${suffix}: offset ${offset} out of range`);
      this._view[`set${getter}`](offset, value, !!le);
      return offset + size;
    };
  }
}

module.exports = { Buffer };
