#!/usr/bin/env node
// Minimal disassembler for Director 8 compiled Lingo (Lscr chunks), for
// reading what the game's scripts do. Not complete, but enough to follow
// handlers with their names, literals and calls.
// Usage: node tools/lingo-dis.js [file.dcr] [filter]   (filter: script id or text)
'use strict';
const fs = require('fs');
const path = require('path');
const ab = require('./afterburner');

const OPS = {
  0x01: 'ret', 0x03: 'pushzero', 0x04: 'mul', 0x05: 'add', 0x06: 'sub', 0x07: 'div', 0x08: 'mod', 0x09: 'inv',
  0x0a: 'joinstr', 0x0b: 'joinpadstr', 0x0c: 'lt', 0x0d: 'lteq', 0x0e: 'nteq', 0x0f: 'eq', 0x10: 'gt', 0x11: 'gteq',
  0x12: 'and', 0x13: 'or', 0x14: 'not', 0x15: 'containsstr', 0x16: 'contains0str', 0x17: 'getchunk', 0x18: 'hilitechunk',
  0x19: 'ontospr', 0x1a: 'intospr', 0x1b: 'getfield', 0x1c: 'starttell', 0x1d: 'endtell', 0x1e: 'pushlist', 0x1f: 'pushproplist', 0x21: 'swap',
  0x41: 'pushint8', 0x42: 'pusharglistnoret', 0x43: 'pusharglist', 0x44: 'pushcons', 0x45: 'pushsymb', 0x46: 'pushvarref',
  0x48: 'getglobal2', 0x49: 'getglobal', 0x4a: 'getprop', 0x4b: 'getparam', 0x4c: 'getlocal', 0x4d: 'setglobal2', 0x4f: 'setglobal',
  0x50: 'setprop', 0x51: 'setparam', 0x52: 'setlocal', 0x53: 'jmp', 0x54: 'endrepeat', 0x55: 'jmpifz', 0x56: 'localcall',
  0x57: 'extcall', 0x58: 'objcallv4', 0x59: 'put', 0x5a: 'putchunk', 0x5b: 'deletechunk', 0x5c: 'get', 0x5d: 'set',
  0x5f: 'getmovieprop', 0x60: 'setmovieprop', 0x61: 'getobjprop', 0x62: 'setobjprop', 0x63: 'tellcall', 0x64: 'peek', 0x65: 'pop',
  0x66: 'thebuiltin', 0x67: 'objcall', 0x6d: 'pushchunkvarref', 0x6e: 'pushint16', 0x6f: 'pushint32', 0x70: 'getchainedprop',
  0x71: 'pushfloat32', 0x72: 'gettoplevelprop', 0x73: 'newobj',
};
const NAME_OPS = new Set(['pushsymb', 'getglobal', 'getglobal2', 'setglobal', 'setglobal2', 'getprop', 'setprop', 'extcall', 'objcall', 'objcallv4', 'getobjprop', 'setobjprop', 'getmovieprop', 'setmovieprop', 'thebuiltin', 'getchainedprop', 'gettoplevelprop', 'tellcall', 'newobj', 'pushvarref']);
const HANDLER_RECORD = 42; // bytes per handler record (Director 8)

function readNames(buf) {
  const off = buf.readUInt16BE(16), count = buf.readUInt16BE(18);
  const names = [];
  let p = off;
  for (let i = 0; i < count; i++) { const n = buf[p]; names.push(buf.toString('latin1', p + 1, p + 1 + n)); p += 1 + n; }
  return names;
}

function disassemble(buf, names) {
  const u16 = (o) => buf.readUInt16BE(o), u32 = (o) => buf.readUInt32BE(o);
  const propsCount = u16(60), propsOffset = u32(62);
  const handlersCount = u16(72), handlersOffset = u32(74);
  const literalsCount = u16(78), literalsOffset = u32(80), literalsDataOffset = u32(88);
  const literals = [];
  for (let i = 0; i < literalsCount; i++) {
    const type = u32(literalsOffset + i * 8), off = u32(literalsOffset + i * 8 + 4);
    const at = literalsDataOffset + off;
    if (type === 1) literals.push(JSON.stringify(buf.toString('latin1', at + 4, at + 4 + u32(at)).replace(/\0$/, '')));
    else if (type === 4) literals.push(String(off));
    else if (type === 9) literals.push(String(buf.readDoubleBE(at + 4)));
    else literals.push(`<literal type ${type}>`);
  }
  const props = Array.from({ length: propsCount }, (_, i) => names[u16(propsOffset + i * 2)]);
  const out = [];
  if (props.length) out.push(`  property ${props.join(', ')}`);
  for (let h = 0; h < handlersCount; h++) {
    const r = handlersOffset + h * HANDLER_RECORD;
    const nameId = u16(r), len = u32(r + 4), codeOff = u32(r + 8);
    const argCount = u16(r + 12), argOff = u32(r + 14), localCount = u16(r + 18), localOff = u32(r + 20);
    const args = Array.from({ length: argCount }, (_, i) => names[u16(argOff + i * 2)]);
    const locals = Array.from({ length: localCount }, (_, i) => names[u16(localOff + i * 2)]);
    out.push(`  on ${names[nameId]} ${args.join(', ')}${locals.length ? `   -- locals: ${locals.join(', ')}` : ''}`);
    let p = codeOff;
    while (p < codeOff + len) {
      const pos = p - codeOff;
      let op = buf[p++];
      let arg = null;
      if (op >= 0xc0) { arg = buf.readInt32BE(p); p += 4; op -= 0x80; } else if (op >= 0x80) { arg = buf.readUInt16BE(p); p += 2; op -= 0x40; } else if (op >= 0x40) { arg = buf[p++]; }
      const name = OPS[op] || `op_${op.toString(16)}`;
      let note = '';
      if (NAME_OPS.has(name) && names[arg] !== undefined) note = names[arg];
      else if (name === 'pushcons') note = literals[arg / 8] ?? '';
      else if (name === 'getlocal' || name === 'setlocal') note = locals[arg / 8] ?? '';
      else if (name === 'getparam' || name === 'setparam') note = args[arg / 8] ?? '';
      else if (name === 'localcall') note = `handler #${arg}`;
      out.push(`    ${String(pos).padStart(4)}  ${name}${arg !== null ? ' ' + arg : ''}${note ? '   ; ' + note : ''}`);
    }
  }
  return out.join('\n');
}

// Each Lctx lists its scripts and names the Lnam chunk holding their names.
function lscrNames(movie) {
  const map = new Map();
  for (const ctx of ab.findAll(movie, 'Lctx')) {
    const d = ab.chunkData(movie, ctx);
    const count = d.readUInt32BE(8), entriesOffset = d.readUInt16BE(16), lnamId = d.readUInt32BE(32);
    const lnam = movie.byId.get(lnamId);
    const names = lnam ? readNames(ab.chunkData(movie, lnam)) : [];
    for (let i = 0; i < count; i++) {
      const sec = d.readInt32BE(entriesOffset + i * 12 + 4);
      if (sec > 0) map.set(sec, names);
    }
  }
  return map;
}

module.exports = { disassemble, lscrNames, readNames };

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args[0] && args[0].endsWith('.dcr') ? args.shift() : path.join(__dirname, '..', 'WorldBuilder2', 'worldbuilder2', 'worldbuilder2.dcr');
  const filter = args.join(' ');
  const movie = ab.parse(fs.readFileSync(file));
  const namesFor = lscrNames(movie);
  for (const r of ab.findAll(movie, 'Lscr')) {
    let text;
    try { text = disassemble(ab.chunkData(movie, r), namesFor.get(r.id) || []); } catch (e) { text = `  (could not disassemble: ${e.message})`; }
    if (!filter || String(r.id) === filter || text.includes(filter)) console.log(`== Lscr ${r.id}\n${text}\n`);
  }
}
