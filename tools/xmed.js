// Director 8 text member (XMED chunk) text read/replace.
//
// An XMED chunk is a series of sections: 4 hex id, 8 hex byte length, 8 hex
// count, then `length` bytes of data ending in \x03. Values inside a section
// are hex tokens separated by \x01/\x02/\x03. Section 0002 holds the text as
// "\x00<hex len>,<text>\x03". Other sections cache the text length and
// layout (line count, pixel height), which we regenerate when replacing text.
'use strict';

const LINE_HEIGHT = 15;
// Director splits text into multiple 0002 sections past ~4.5k chars; we only
// write single-section text, which is plenty for a level.
const MAX_TEXT = 4000;

function parseSections(s) {
  const out = [];
  let p = 0;
  while (p < s.length) {
    const len = parseInt(s.substr(p + 4, 8), 16);
    out.push({ id: s.substr(p, 4), count: s.substr(p + 12, 8), data: s.substr(p + 20, len) });
    p += 20 + len;
  }
  return out;
}

function buildSections(sections) {
  return sections.map((sec) => sec.id + hex(sec.data.length, 8) + sec.count + sec.data).join('');
}

function hex(n, width = 0) { return n.toString(16).toUpperCase().padStart(width, '0'); }

function readTextSection(data) {
  const comma = data.indexOf(',');
  const len = parseInt(data.slice(1, comma), 16);
  return data.slice(comma + 1, comma + 1 + len);
}

// Returns null for XMED chunks that aren't text members (e.g. fonts).
function readText(buf) {
  const s = buf.toString('latin1');
  if (!s.startsWith('FFFF')) return null;
  // Long texts are split over several 0002 sections; count = start offset.
  const parts = parseSections(s).filter((x) => x.id === '0002');
  return parts.length ? parts.map((x) => readTextSection(x.data)).join('') : null;
}

// Map the hex value of each token in a section through fn(value, index).
// Tokens can carry trailing marker bytes (e.g. \x81, \xC1), which are kept.
function mapTokens(data, fn) {
  let i = 0;
  return data.split(/([\x01\x02\x03])/).map((tok) => {
    if (tok === '' || /^[\x01\x02\x03]$/.test(tok)) return tok;
    const [, value, suffix] = /^(-?[0-9A-F]*)([\s\S]*)$/.exec(tok);
    return fn(value, i++) + suffix;
  }).join('');
}

function layout(text) {
  // A trailing \r doesn't count as a line but does add to the height.
  const lines = text.replace(/\r$/, '').split('\r').length;
  return { lines, height: text.split('\r').length * LINE_HEIGHT };
}

// Return a new XMED buffer with the text replaced. `text` uses \r line breaks.
function replaceText(buf, text) {
  if (/[^\x00-\xff]/.test(text)) throw new Error('text must be latin1');
  if (text.length > MAX_TEXT) throw new Error(`text too long (${text.length} > ${MAX_TEXT} chars)`);
  const sections = parseSections(buf.toString('latin1'));
  if (sections.filter((s) => s.id === '0002').length !== 1) throw new Error('multi-part text members not supported');
  const oldL = readTextSection(sections.find((s) => s.id === '0002').data).length;
  const newL = text.length;
  const lay = layout(text);
  let oldHeight = null;
  mapTokens(sections.find((s) => s.id === '0001').data, (t, i) => { if (i === 8) oldHeight = parseInt(t, 16); return t; });
  const oldL2 = hex(oldL + 2);

  for (const sec of sections) {
    switch (sec.id) {
      case '0002':
        sec.data = '\x00' + hex(newL) + ',' + text + '\x03';
        break;
      case '0000':
      case '000A':
        sec.data = mapTokens(sec.data, (t) => (parseInt(t, 16) === oldHeight ? hex(lay.height) : t));
        break;
      case '0001':
        sec.data = mapTokens(sec.data, (t, i) => {
          if (i === 1) return hex(newL); // text length
          if (i === 10) { // saved cursor position
            const sel = parseInt(t, 16);
            return hex(sel === oldL ? newL : Math.min(sel, newL));
          }
          if (i === 4 || i === 6) return hex(lay.lines);
          if (i === 8 || i === 17) return hex(lay.height);
          if (i === 15) return hex(lay.height - LINE_HEIGHT);
          return t;
        });
        break;
      case '0004':
      case '0005':
      case '0128':
      case '0129':
        // Style/paragraph runs end at text length + 2.
        sec.data = mapTokens(sec.data, (t) => (t === oldL2 ? hex(newL + 2) : t));
        break;
    }
  }
  return Buffer.from(buildSections(sections), 'latin1');
}

module.exports = { readText, replaceText, parseSections };
