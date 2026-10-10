// Build the editor's catalog (terrain types, units, recipes, level titles)
// from the game's own config text members.
'use strict';
const game = require('./game');

// Parse a Lingo literal: [#a: 1, #b: [#c, #d]], "str", #sym, 1.5
function parseLingo(src) {
  let i = 0;
  const ws = () => { while (/\s/.test(src[i])) i++; };
  function value() {
    ws();
    const c = src[i];
    if (c === '[') {
      i++;
      const list = [], props = {};
      let isProp = false;
      ws();
      while (src[i] !== ']' && i < src.length) {
        const v = value();
        ws();
        if (src[i] === ':') {
          i++;
          isProp = true;
          props[String(v)] = value();
          ws();
        } else list.push(v);
        if (src[i] === ',') i++;
        ws();
      }
      i++;
      return isProp ? props : list;
    }
    if (c === '"') {
      const end = src.indexOf('"', i + 1);
      const s = src.slice(i + 1, end);
      i = end + 1;
      return s;
    }
    const m = /^#?[\w.\-]+/.exec(src.slice(i));
    if (!m) throw new Error('lingo parse error at ' + src.slice(i, i + 20));
    i += m[0].length;
    const tok = m[0];
    return tok[0] === '#' ? tok.slice(1) : Number(tok);
  }
  return value();
}

function parseConfig(text) {
  const out = { building: {}, vehicle: {}, monster: {} };
  let section = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const sec = /^\[(\w+)\]$/.exec(line);
    if (sec) { section = sec[1]; continue; }
    const def = /^#(\w+)\s*=\s*(\[.*\])\s*$/.exec(line);
    if (def && out[section]) {
      try { out[section][def[1]] = parseLingo(def[2]); } catch (e) { /* skip malformed entry */ }
    }
  }
  return out;
}

function build() {
  const g = game.load();
  const config = parseConfig(game.getText(g, 'config'));
  const terrain = game.getText(g, 'terrainmap').split('\n').filter(Boolean)
    .map((l) => ({ char: l[0], name: l.slice(2).trim() }));
  const titles = {};
  for (const line of game.getText(g, 'level names').split('\n')) {
    const m = /^(\d+)\s+(\d+)\s+(.*)$/.exec(line.trim());
    if (m) titles[`map${m[1]}.${m[2]}`] = m[3];
  }
  const levels = game.levelNames(g)
    .filter((id) => id !== 'map999.999')
    .map((id) => ({ id, title: titles[id] || id, source: 'wb2' }))
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  levels.push({ id: 'map999.999', title: 'Developer test level', source: 'wb2' });
  for (const l of require('./wb1').wb1Levels()) levels.push({ ...l, source: 'wb1' });
  return { config, terrain, levels, game: g };
}

module.exports = { build, parseLingo, parseConfig };
