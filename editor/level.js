// WorldBuilder 2 level model: parse/serialize the game's level text format.
// Works in the browser (window.Level) and in Node (require).
(function (exports) {
  'use strict';

  const PILE_COLORS = ['yellow', 'blue', 'red', 'green', 'white', 'wheel', 'energy'];
  // Terrain chars that items must never use as keys.
  const DEFAULT_TERRAIN = '.';
  const WATER = 'w';

  // Item kinds:
  //   {kind:'unit', cat:'vehicle'|'monster'|'building', type, water}
  //   {kind:'pile', contents:[[color, n], ...], water}
  //   {kind:'plan', type, count, water}
  //   {kind:'goal', bonus, target, water}   target: type | 'anything' | 'collect 1 lion'
  //   {kind:'whirlpool', n}
  //   {kind:'raw', value}                   anything we don't understand
  function parseItem(value) {
    const parts = value.split(',').map((s) => s.trim());
    const head = parts[0];
    const water = head.startsWith('water') && head !== 'whirlpool';
    switch (water ? head.slice(5) : head) {
      case 'unit':
        return { kind: 'unit', cat: parts[1], type: parts[2], water };
      case 'pile': {
        const contents = [];
        for (let i = 1; i + 1 < parts.length; i += 2) contents.push([parts[i], Number(parts[i + 1])]);
        return { kind: 'pile', contents, water };
      }
      case 'plan':
        return { kind: 'plan', type: parts[1], count: Number(parts[2] || 1), water };
      case 'goal':
      case 'bonusgoal':
        return { kind: 'goal', bonus: head === 'bonusgoal', target: parts[1], water: parts[2] === 'water' };
    }
    if (head === 'whirlpool') return { kind: 'whirlpool', n: Number(parts[1] || 1) };
    return { kind: 'raw', value };
  }

  function itemValue(item) {
    const w = item.water ? 'water' : '';
    switch (item.kind) {
      case 'unit': return `${w}unit,${item.cat},${item.type}`;
      case 'pile': return `${w}pile,` + item.contents.map(([c, n]) => `${c},${n}`).join(',');
      case 'plan': return `${w}plan,${item.type},${item.count}`;
      case 'goal': return `${item.bonus ? 'bonusgoal' : 'goal'},${item.target}${item.water ? ',water' : ''}`;
      case 'whirlpool': return `whirlpool,${item.n}`;
      default: return item.value;
    }
  }

  // Terrain under an item cell: the item's character replaces the terrain.
  function itemTerrain(item) {
    if (item.kind === 'whirlpool') return 'whirlpool';
    return item.water ? WATER : DEFAULT_TERRAIN;
  }

  function create(width, height) {
    return {
      name: 'NEW LEVEL',
      width, height,
      terrain: Array.from({ length: height }, () => Array(width).fill(DEFAULT_TERRAIN)),
      items: Array.from({ length: height }, () => Array(width).fill(null)),
      center: null,
      inventory: [],
      meta: {},
    };
  }

  function parse(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const rows = [];
    const keys = {};
    const level = create(0, 0);
    level.inventory = [];
    let section = 'map';
    for (const rawLine of lines) {
      const meta = /^--\s*editor-(\w+):\s*(.*)$/.exec(rawLine.trim());
      if (meta) { level.meta[meta[1]] = meta[2]; continue; }
      const line = rawLine.replace(/--.*$/, '').trim();
      if (!line) continue;
      const sec = /^\[(\w+)\]$/.exec(line);
      if (sec) { section = sec[1].toLowerCase(); continue; }
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (section === 'map') {
        if (key === 'map') rows.push(value);
        else if (key === 'name') level.name = value;
        else if (key === 'center') {
          const [x, y] = value.split(',').map(Number);
          level.center = { x: x - 1, y: y - 1 }; // file is 1-based
        }
      } else if (section === 'mapitems') {
        keys[key] = parseItem(value);
      } else if (section === 'inventory') {
        level.inventory.push({ type: key, count: Number(value) });
      }
    }
    level.height = rows.length;
    level.width = Math.max(0, ...rows.map((r) => r.length));
    level.terrain = [];
    level.items = [];
    for (const row of rows) {
      const t = [], it = [];
      for (let x = 0; x < level.width; x++) {
        const ch = row[x] || DEFAULT_TERRAIN;
        if (keys[ch]) {
          const item = keys[ch];
          it.push({ ...item, contents: item.contents && item.contents.map((p) => [...p]) });
          t.push(itemTerrain(item));
        } else {
          it.push(null);
          t.push(ch);
        }
      }
      level.terrain.push(t);
      level.items.push(it);
    }
    return level;
  }

  // Key alphabet: lowercase, then uppercase, avoiding terrain characters.
  function keyAlphabet(terrainChars) {
    const used = new Set(terrainChars);
    const all = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    return all.filter((c) => !used.has(c));
  }

  // terrainChars: every character the game treats as terrain (from terrainmap).
  function serialize(level, terrainChars) {
    const letters = keyAlphabet(terrainChars || ['w', 'x', 'r', 'T', 'M']);
    const goalDigits = '123456789'.split('');
    const byValue = new Map();
    const entries = [];
    const keyFor = (item) => {
      const value = itemValue(item);
      if (byValue.has(value)) return byValue.get(value);
      // Goals use digits like the original levels; everything else letters.
      const pool = item.kind === 'goal' ? goalDigits : letters;
      const key = pool.shift() || letters.shift() || goalDigits.shift();
      if (!key) throw new Error('too many different items (out of map keys)');
      byValue.set(value, key);
      entries.push([key, value, item.kind === 'goal']);
      return key;
    };

    const rows = [];
    for (let y = 0; y < level.height; y++) {
      let row = '';
      for (let x = 0; x < level.width; x++) {
        const item = level.items[y][x];
        row += item ? keyFor(item) : level.terrain[y][x];
      }
      rows.push(row);
    }

    const out = [];
    for (const [k, v] of Object.entries(level.meta || {})) if (v !== '' && v != null) out.push(`-- editor-${k}: ${v}`);
    out.push('[map]', `name=${level.name}`);
    for (const r of rows) out.push(` map=${r}`);
    out.push('');
    if (level.center) out.push(`center=${level.center.x + 1},${level.center.y + 1}`, '');
    out.push('[mapitems]');
    for (const [k, v] of entries.filter((e) => !e[2])) out.push(`${k}=${v}`);
    out.push('');
    for (const [k, v] of entries.filter((e) => e[2])) out.push(`${k}=${v}`);
    out.push('', '[inventory]');
    for (const { type, count } of level.inventory) out.push(`${type}=${count}`);
    out.push('');
    return out.join('\n');
  }

  // Text sent to the game: drop editor-only comment lines.
  function gameText(level, terrainChars) {
    return serialize({ ...level, meta: {} }, terrainChars);
  }

  function resize(level, width, height, anchorX = 0, anchorY = 0) {
    // anchorX/anchorY: how many columns/rows to add (or remove, if negative) on the left/top.
    const terrain = [], items = [];
    for (let y = 0; y < height; y++) {
      const sy = y - anchorY;
      const t = [], it = [];
      for (let x = 0; x < width; x++) {
        const sx = x - anchorX;
        const inside = sy >= 0 && sy < level.height && sx >= 0 && sx < level.width;
        t.push(inside ? level.terrain[sy][sx] : DEFAULT_TERRAIN);
        it.push(inside ? level.items[sy][sx] : null);
      }
      terrain.push(t); items.push(it);
    }
    let center = level.center;
    if (center) {
      center = { x: center.x + anchorX, y: center.y + anchorY };
      if (center.x < 0 || center.y < 0 || center.x >= width || center.y >= height) center = null;
    }
    return { ...level, width, height, terrain, items, center };
  }

  function clone(level) {
    return JSON.parse(JSON.stringify(level));
  }

  const MAX_TEXT = 4000; // keep in sync with tools/xmed.js

  // Plans the game can't handle: the original never lets you build these,
  // and selecting their plan causes a script error (no placement picture).
  const BROKEN_PLANS = { windmill: 'Windmill' };

  // cat: { config: {vehicle, building, monster}, terrain: [{char, name}] }
  // Returns [{severity: 'error'|'warning', message, cells: [{x, y}]}].
  function validate(level, cat) {
    const problems = [];
    const add = (severity, message, cells = []) => problems.push({ severity, message, cells });
    const { vehicle = {}, building = {}, monster = {} } = cat.config;
    const buildable = (t) => !!(vehicle[t] || building[t]);
    const anyType = (t) => !!(vehicle[t] || building[t] || monster[t]);
    const terrainChars = new Set(cat.terrain.map((t) => t.char));

    const cellsOf = new Map(); // item description -> cells
    const note = (key, x, y) => { if (!cellsOf.has(key)) cellsOf.set(key, []); cellsOf.get(key).push({ x, y }); };
    const available = new Set(level.inventory.map((i) => i.type));
    const onMap = new Set();
    const goals = [], whirlpools = new Map();
    let playerUnits = 0;

    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        const it = level.items[y][x];
        if (!it) {
          if (!terrainChars.has(level.terrain[y][x])) note(`Unknown terrain "${level.terrain[y][x]}"`, x, y);
          continue;
        }
        if (it.kind === 'unit') {
          const def = (cat.config[it.cat] || {})[it.type];
          if (!def) { note(`Unknown ${it.cat} "${it.type}"`, x, y); continue; }
          onMap.add(it.type);
          if (it.cat === 'vehicle') playerUnits++;
          if (it.water && it.cat !== 'building' && def.terrain && !def.terrain.includes('water')) {
            note(`${def.name || it.type} can't be placed on water`, x, y);
          }
        } else if (it.kind === 'plan') {
          if (BROKEN_PLANS[it.type]) note(`${BROKEN_PLANS[it.type]} plans crash the game when selected (it can't build one). Place a ${BROKEN_PLANS[it.type].toLowerCase()} on the map instead`, x, y);
          if (!buildable(it.type)) note(`Unknown plan "${it.type}"`, x, y);
          else available.add(it.type);
          if (!(it.count >= 1)) note('Plan with no uses', x, y);
        } else if (it.kind === 'pile') {
          if (!it.contents.length) note('Empty brick pile', x, y);
          for (const [c, n] of it.contents) {
            if (!PILE_COLORS.includes(c)) note(`Unknown brick "${c}"`, x, y);
            if (!(n > 0)) note('Brick pile entry with no bricks', x, y);
          }
        } else if (it.kind === 'goal') {
          goals.push({ ...it, x, y });
        } else if (it.kind === 'whirlpool') {
          if (!whirlpools.has(it.n)) whirlpools.set(it.n, []);
          whirlpools.get(it.n).push({ x, y });
        } else {
          note(`Unrecognised item "${it.value}"`, x, y);
        }
      }
    }
    for (const [msg, cells] of cellsOf) add(/can't be placed/.test(msg) ? 'warning' : 'error', msg, cells);

    if (!goals.some((g) => !g.bonus)) add('error', 'No mission goal: add a Goal so the mission can be completed.');
    for (const g of goals) {
      const label = g.bonus ? 'Bonus goal' : 'Goal';
      const collect = /^collect\s+\d+\s+(\w+)$/.exec(g.target || '');
      if (g.target === 'anything') continue;
      if (collect) {
        if (!monster[collect[1]]) add('error', `${label} wants unknown monster "${collect[1]}"`, [g]);
        else if (!onMap.has(collect[1])) add('warning', `${label} needs a ${collect[1]}, but there is none on the map`, [g]);
        continue;
      }
      if (!anyType(g.target)) { add('error', `${label} wants unknown type "${g.target}"`, [g]); continue; }
      if (!available.has(g.target) && !onMap.has(g.target)) {
        add('warning', `${label} needs a ${g.target}, but there's no ${g.target} unit or plan on the map or in the starting plans`, [g]);
      }
    }

    for (const inv of level.inventory) {
      if (BROKEN_PLANS[inv.type]) add('error', `${BROKEN_PLANS[inv.type]} plans crash the game when selected (it can't build one). Remove this starting plan`);
      if (!buildable(inv.type)) add('error', `Starting plan "${inv.type}" is not a vehicle or building`);
      if (!(inv.count >= 1)) add('error', `Starting plan "${inv.type}" has no uses`);
    }
    if (!playerUnits && !level.inventory.length) {
      add('warning', 'The player starts with no vehicles and no plans. Add a vehicle or a starting plan.');
    }

    // Whirlpools appear to link in pairs: 1<->2, 3<->4, ...
    for (const [n, cells] of whirlpools) {
      const partner = n % 2 ? n + 1 : n - 1;
      if (!whirlpools.has(partner)) add('warning', `Whirlpool ${n} has no partner (whirlpools probably link in pairs: ${Math.min(n, partner)}↔${Math.max(n, partner)})`, cells);
    }

    if (level.center && (level.center.x >= level.width || level.center.y >= level.height)) {
      add('warning', 'Start view centre is outside the map');
    }
    try {
      const len = gameText(level, [...terrainChars]).length;
      if (len > MAX_TEXT) add('error', `Level is too big for the game file (${len} of ${MAX_TEXT} characters). Use fewer different item types or a smaller map.`);
    } catch (e) {
      add('error', e.message);
    }
    return problems;
  }

  exports.Level = { parse, serialize, gameText, create, resize, clone, validate, parseItem, itemValue, itemTerrain, PILE_COLORS, MAX_TEXT, BROKEN_PLANS };
})(typeof module !== 'undefined' ? module.exports : window);
