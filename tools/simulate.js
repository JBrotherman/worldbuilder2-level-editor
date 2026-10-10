#!/usr/bin/env node
// Checks that a level can be solved by following a written solution.
//
// It models the game's rules closely enough to catch design mistakes:
// unit terrain and energy (from the game config), plans and their uses,
// building from nearby bricks, taking apart, carrying, digging/filling,
// moving trees, pushing boulders, and fighting weak monsters. It does NOT
// model monster movement, so levels should keep monsters penned in or use
// them as obstacles that the solution deals with explicitly.
//
// Solution file: one action per line ("#" comments), units named by id:
//   unit <id> <x>,<y>          name a unit that starts on the map
//   move <id> <x>,<y>          drive there (shortest path); picks up a plan
//   build <type> <x>,<y> <id>  build next to bricks (Chebyshev distance 1)
//   apart <id>                 take apart; bricks drop where it stood
//   load <id> <x>,<y>          pick up bricks from a pile (on/next to it)
//   unload <id> <x>,<y>        drop carried bricks (on/next to the unit)
//   dig|fill <id> <x>,<y>      steamshovel, on a neighbouring tile
//   uproot|plant <id> <x>,<y>  treebot, on a neighbouring tile
//   push <id> <x>,<y>          dozer pushes the boulder/frozen monster there
//   fight <id> <x>,<y>         defender takes apart a neighbouring monster
//   freeze <id> <x>,<y>        freezebot (within 2 tiles) freezes a monster
//   goal / bonus               assert the goal / bonus goal is reached
// Usage: node tools/simulate.js level.txt solution.txt
'use strict';
const fs = require('fs');
const path = require('path');
const { Level } = require('../editor/level.js');

const TREES = new Set(['tree', 'tree2', 'tree3', 'tree4']);
// A fight is only allowed when the attackers clearly win according to the
// config: damage per second = hits/min x hit chance x average damage x the
// target's shield, and both sides have 100 energy. The attackers must need
// at most WIN_MARGIN of the time the monster needs. Frozen monsters don't
// fight back.
const WIN_MARGIN = 0.85;

function dps(attack, shield) {
  if (!attack) return 0;
  const [lo, hi] = attack.damage_range || [0, 0];
  return (attack.hits_per_minute || 0) / 60 * (attack.chance_of_success || 0) / 100 * ((lo + hi) / 2) * (shield == null ? 1 : shield);
}

function loadConfig() {
  // Prefer the game's own config; fall back to the extracted copy.
  try {
    const game = require('./game');
    const catalog = require('./catalog');
    const g = game.load({ extras: false });
    return {
      config: catalog.parseConfig(game.getText(g, 'config')),
      terrain: game.getText(g, 'terrainmap').split('\n').filter(Boolean).map((l) => ({ char: l[0], name: l.slice(2).trim() })),
    };
  } catch (e) {
    throw new Error('could not load the game config: ' + e.message);
  }
}

function simulate(levelText, solutionText, { config, terrain }) {
  const lv = Level.parse(levelText);
  const terrainName = Object.fromEntries(terrain.map((t) => [t.char, t.name]));
  const T = lv.terrain.map((row) => row.slice());
  const name = (x, y) => {
    if (T[y][x] === 'whirlpool') return 'water_whirlpool';
    const n = terrainName[T[y][x]] || 'normal';
    return /^street[0-9]+$/.test(n) ? 'street' : n; // road pieces are all "street"
  };
  const key = (x, y) => `${x},${y}`;
  const inside = (x, y) => x >= 0 && y >= 0 && x < lv.width && y < lv.height;

  const units = new Map();      // id -> {type, cat, x, y, energy, carry:{}}
  const occupied = new Map();   // "x,y" -> {kind:'unit'|'monster'|'building', ...}
  const piles = new Map();      // "x,y" -> {bricks:{color:n}, energy:[charges]}
  const plans = new Map();      // "x,y" -> {type, count}
  const inventory = new Map(lv.inventory.map((i) => [i.type, i.count]));
  const goals = [];
  const log = [];
  let anon = 0;

  const def = (type) => config.vehicle[type] || config.building[type] || config.monster[type];
  const addPile = (x, y, bricks = {}, energy = []) => {
    const p = piles.get(key(x, y)) || { bricks: {}, energy: [] };
    for (const [c, n] of Object.entries(bricks)) if (n > 0) p.bricks[c] = (p.bricks[c] || 0) + n;
    p.energy.push(...energy);
    piles.set(key(x, y), p);
  };

  for (let y = 0; y < lv.height; y++) {
    for (let x = 0; x < lv.width; x++) {
      const it = lv.items[y][x];
      if (!it) continue;
      if (it.kind === 'unit') {
        const o = { kind: it.cat === 'vehicle' ? 'unit' : it.cat, type: it.type, x, y, energy: 100, carry: {}, carryEnergy: [] };
        occupied.set(key(x, y), o);
        if (it.cat === 'vehicle') units.set(`#${++anon}@${x},${y}`, o);
      } else if (it.kind === 'pile') {
        const bricks = {};
        const energy = [];
        for (const [c, n] of it.contents) {
          if (c === 'energy') for (let i = 0; i < n; i++) energy.push(100);
          else bricks[c] = (bricks[c] || 0) + n;
        }
        addPile(x, y, bricks, energy);
      } else if (it.kind === 'plan') {
        plans.set(key(x, y), { type: it.type, count: it.count });
      } else if (it.kind === 'goal') {
        goals.push({ ...it, x, y, done: false });
      }
    }
  }

  function fail(msg) { throw new Error(msg); }
  const unitAt = (id) => units.get(id) || fail(`unknown unit "${id}"`);
  const parseXY = (s) => { const [x, y] = s.split(',').map(Number); if (!inside(x, y)) fail(`tile ${s} is outside the map`); return { x, y }; };
  const canStand = (type, x, y) => inside(x, y) && (def(type).terrain || []).includes(name(x, y)) && !occupied.has(key(x, y));
  const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const near = (a, b) => cheb(a, b) <= 1;
  const spend = (u, action, times = 1) => {
    const e = (def(u.type).energy || {})[action] || 0;
    if (u.energy < e * times - 1e-9) fail(`${u.type} at ${u.x},${u.y} is out of energy (${u.energy.toFixed(1)} left, needs ${(e * times).toFixed(1)})`);
    u.energy -= e * times;
  };

  function path(u, to) {
    const start = key(u.x, u.y);
    const prev = new Map([[start, null]]);
    const queue = [{ x: u.x, y: u.y }];
    while (queue.length) {
      const c = queue.shift();
      if (c.x === to.x && c.y === to.y) {
        let n = 0;
        for (let k = key(c.x, c.y); prev.get(k); k = prev.get(k)) n++;
        return n;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = c.x + dx, ny = c.y + dy, k = key(nx, ny);
        if (prev.has(k) || !canStand(u.type, nx, ny)) continue;
        prev.set(k, key(c.x, c.y));
        queue.push({ x: nx, y: ny });
      }
    }
    return -1;
  }

  function arrive(u) {
    // Recharge next to a building that recharges this kind of unit.
    for (const o of occupied.values()) {
      if (o === u || cheb(o, u) !== 1 || o.kind === 'monster') continue;
      if ((def(o.type).recharges || []).includes(u.type)) {
        if (u.energy < 100) log.push(`  recharged by ${o.type}`);
        u.energy = 100;
      }
      if (o.kind === 'unit' && (def(u.type).recharges || []).includes(o.type)) {
        if (o.energy < 100) log.push(`  ${u.type} recharged a ${o.type}`);
        o.energy = 100;
      }
    }
    const p = plans.get(key(u.x, u.y));
    if (p) {
      inventory.set(p.type, (inventory.get(p.type) || 0) + p.count);
      plans.delete(key(u.x, u.y));
      log.push(`  picked up plan: ${p.type} x${p.count}`);
    }
    for (const g of goals) {
      if (g.done || g.x !== u.x || g.y !== u.y) continue;
      const collect = /^collect/.test(g.target);
      if (!collect && (g.target === 'anything' || g.target === u.type)) { g.done = true; log.push(`  ${g.bonus ? 'BONUS GOAL' : 'GOAL'} reached by ${u.type}`); }
    }
  }

  // Take bricks for a recipe from piles within distance 1 of the build tile.
  function takeRecipe(recipe, at) {
    const nearby = [...piles.entries()]
      .map(([k, p]) => { const [x, y] = k.split(',').map(Number); return { k, p, x, y }; })
      .filter((e) => near(e, at))
      .sort((a, b) => cheb(a, at) - cheb(b, at));
    const need = { ...recipe };
    const energyNeeded = need.energy || 0;
    delete need.energy;
    for (const [c, n] of Object.entries(need)) {
      const have = nearby.reduce((s, e) => s + (e.p.bricks[c] || 0), 0);
      if (have < n) fail(`not enough ${c} near ${at.x},${at.y}: need ${n}, have ${have}`);
    }
    const allEnergy = nearby.flatMap((e) => e.p.energy.map((ch, i) => ({ e, i, ch })));
    if (allEnergy.length < energyNeeded) fail(`no energy brick near ${at.x},${at.y}`);
    for (const [c, n] of Object.entries(need)) {
      let left = n;
      for (const e of nearby) {
        if (!e.p.bricks[c]) continue; // don't create empty (NaN) entries
        const t = Math.min(left, e.p.bricks[c]);
        e.p.bricks[c] -= t;
        left -= t;
      }
    }
    let charge = 100;
    if (energyNeeded) {
      allEnergy.sort((a, b) => b.ch - a.ch); // the freshest energy brick
      const best = allEnergy[0];
      charge = best.ch;
      best.e.p.energy.splice(best.e.p.energy.indexOf(best.ch), 1);
    }
    for (const e of nearby) {
      if (!Object.values(e.p.bricks).some((n) => n > 0) && !e.p.energy.length) piles.delete(e.k);
    }
    return charge;
  }

  const lines = solutionText.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const [cmd, ...args] = line.split(/\s+/);
    const where = `line ${i + 1} (${line})`;
    try {
      switch (cmd) {
        case 'unit': {
          const at = parseXY(args[1]);
          const o = occupied.get(key(at.x, at.y));
          if (!o || (o.kind !== 'unit' && o.kind !== 'building')) fail(`no unit or building at ${args[1]}`);
          for (const [k, v] of units) if (v === o) units.delete(k);
          units.set(args[0], o);
          break;
        }
        case 'move': {
          const u = unitAt(args[0]);
          const to = parseXY(args[1]);
          occupied.delete(key(u.x, u.y));
          const n = path(u, to);
          if (n < 0) { occupied.set(key(u.x, u.y), u); fail(`${u.type} can't reach ${args[1]} from ${u.x},${u.y}`); }
          spend(u, 'move', n);
          u.x = to.x; u.y = to.y;
          occupied.set(key(u.x, u.y), u);
          log.push(`${where}: ${n} tiles, energy ${u.energy.toFixed(1)}`);
          arrive(u);
          return;
        }
        case 'build': {
          const type = args[0];
          const at = parseXY(args[1]);
          const d = def(type) || fail(`unknown type ${type}`);
          if (!(inventory.get(type) > 0)) fail(`no ${type} plan`);
          if (!canStand(type, at.x, at.y)) fail(`${type} can't be built on ${name(at.x, at.y)} at ${args[1]} (or the tile is taken)`);
          if (piles.has(key(at.x, at.y))) fail(`build tile ${args[1]} has a brick pile on it`);
          const charge = takeRecipe(d.recipe || {}, at);
          inventory.set(type, inventory.get(type) - 1);
          const isBuilding = !!config.building[type];
          const o = { kind: isBuilding ? 'building' : 'unit', type, x: at.x, y: at.y, energy: charge, carry: {}, carryEnergy: [] };
          occupied.set(key(at.x, at.y), o);
          if (args[2]) units.set(args[2], o);
          log.push(`${where}: built, energy ${charge.toFixed(1)}`);
          if (!isBuilding) arrive(o);
          else for (const g of goals) if (!g.done && g.x === at.x && g.y === at.y && (g.target === type || g.target === 'anything')) { g.done = true; log.push(`  ${g.bonus ? 'BONUS GOAL' : 'GOAL'} reached by ${type}`); }
          return;
        }
        case 'apart': {
          const u = unitAt(args[0]);
          occupied.delete(key(u.x, u.y));
          const r = { ...(def(u.type).recipe || {}) };
          delete r.energy;
          for (const [c, n] of Object.entries(u.carry)) r[c] = (r[c] || 0) + n;
          addPile(u.x, u.y, r, [...(def(u.type).recipe && def(u.type).recipe.energy ? [u.energy] : []), ...u.carryEnergy]);
          units.delete(args[0]);
          break;
        }
        case 'load': {
          const u = unitAt(args[0]);
          const at = parseXY(args[1]);
          if (!near(u, at)) fail(`${u.type} is not next to ${args[1]}`);
          const p = piles.get(key(at.x, at.y)) || fail(`no pile at ${args[1]}`);
          let room = (def(u.type).carries || 0) - Object.values(u.carry).reduce((s, n) => s + n, 0) - u.carryEnergy.length;
          if (room <= 0) fail(`${u.type} can't carry anything (more)`);
          const only = args[2] ? args.slice(2) : null;
          for (const c of Object.keys(p.bricks)) {
            if (only && !only.includes(c)) continue;
            const t = Math.min(room, p.bricks[c]);
            p.bricks[c] -= t; u.carry[c] = (u.carry[c] || 0) + t; room -= t;
          }
          while (room > 0 && p.energy.length && (!only || only.includes('energy'))) { u.carryEnergy.push(p.energy.pop()); room--; }
          if (!Object.values(p.bricks).some((n) => n > 0) && !p.energy.length) piles.delete(key(at.x, at.y));
          log.push(`${where}: carrying ${JSON.stringify(u.carry)} +${u.carryEnergy.length} energy`);
          return;
        }
        case 'unload': {
          const u = unitAt(args[0]);
          const at = parseXY(args[1]);
          if (!near(u, at)) fail(`${u.type} is not next to ${args[1]}`);
          addPile(at.x, at.y, u.carry, u.carryEnergy);
          u.carry = {}; u.carryEnergy = [];
          break;
        }
        case 'dig': case 'fill': {
          const u = unitAt(args[0]);
          if (!def(u.type).dig) fail(`${u.type} can't dig`);
          const at = parseXY(args[1]);
          if (cheb(u, at) !== 1 || (at.x !== u.x && at.y !== u.y)) fail(`${args[1]} is not straight next to the steamshovel`);
          if (occupied.has(key(at.x, at.y)) || piles.has(key(at.x, at.y)) || plans.has(key(at.x, at.y))) fail(`${args[1]} is not empty`);
          if (cmd === 'dig') {
            if (u.full) fail('the steamshovel is already full');
            if (name(at.x, at.y) !== 'normal') fail(`can't dig ${name(at.x, at.y)} at ${args[1]}`);
            T[at.y][at.x] = 'w'; u.full = true;
          } else {
            if (!u.full) fail('the steamshovel is empty; dig first');
            if (name(at.x, at.y) !== 'water') fail(`can't fill ${name(at.x, at.y)} at ${args[1]}`);
            T[at.y][at.x] = '.'; u.full = false;
          }
          spend(u, cmd);
          break;
        }
        case 'uproot': case 'plant': {
          const u = unitAt(args[0]);
          if (!def(u.type).transplant) fail(`${u.type} can't move trees`);
          const at = parseXY(args[1]);
          if (cheb(u, at) !== 1 || (at.x !== u.x && at.y !== u.y)) fail(`${args[1]} is not straight next to the treebot`);
          if (cmd === 'uproot') {
            if (u.tree) fail('the treebot is already holding a tree');
            if (!TREES.has(name(at.x, at.y))) fail(`no tree at ${args[1]} (${name(at.x, at.y)})`);
            u.tree = T[at.y][at.x]; T[at.y][at.x] = '.';
          } else {
            if (!u.tree) fail('the treebot is not holding a tree');
            if (name(at.x, at.y) !== 'normal' || occupied.has(key(at.x, at.y)) || piles.has(key(at.x, at.y))) fail(`can't plant at ${args[1]}`);
            T[at.y][at.x] = u.tree; u.tree = null;
          }
          spend(u, cmd);
          break;
        }
        case 'push': {
          const u = unitAt(args[0]);
          if (!def(u.type).push) fail(`${u.type} can't push`);
          const at = parseXY(args[1]);
          const o = occupied.get(key(at.x, at.y));
          if (!o || o.kind !== 'monster' || !(o.type === 'boulder' || o.frozen)) fail(`nothing pushable at ${args[1]}`);
          const dx = at.x - u.x, dy = at.y - u.y;
          if (Math.abs(dx) + Math.abs(dy) !== 1) fail(`${args[1]} is not straight next to the dozer`);
          const to = { x: at.x + dx, y: at.y + dy };
          if (!inside(to.x, to.y) || occupied.has(key(to.x, to.y)) || !(def(o.type).terrain || []).includes(name(to.x, to.y))) fail(`can't push into ${to.x},${to.y}`);
          spend(u, 'push');
          occupied.delete(key(at.x, at.y)); o.x = to.x; o.y = to.y; occupied.set(key(to.x, to.y), o);
          for (const g of goals) {
            const m = /^collect\s+\d+\s+(\w+)/.exec(g.target);
            if (!g.done && m && m[1] === o.type && g.x === o.x && g.y === o.y) { g.done = true; log.push(`  ${g.bonus ? 'BONUS GOAL' : 'GOAL'}: ${o.type} collected`); }
          }
          break;
        }
        case 'fight': {
          const fighters = args[0].split('+').map((id) => units.get(id) || fail(`unknown unit "${id}"`));
          const at = parseXY(args[1]);
          const o = occupied.get(key(at.x, at.y));
          if (!o || o.kind !== 'monster') fail(`no monster at ${args[1]}`);
          const md = def(o.type);
          let ours = 0;
          let worst = Infinity;
          for (const u of fighters) {
            const range = (def(u.type).attack_search_range && u.kind === 'building') ? def(u.type).attack_search_range : 1;
            if (cheb(u, at) > range) fail(`${u.type} is not close enough to the ${o.type}`);
            const d = dps((def(u.type).attack || {})[o.type], md.shield);
            if (!d) fail(`a ${u.type} can't attack a ${o.type}`);
            ours += d;
            // A robot with a repairbot next to it is fixed up as fast as it's hurt.
            const repaired = [...occupied.values()].some((r) => r !== u && r.kind === 'unit' && cheb(r, u) === 1 && (def(r.type).recharges || []).includes(u.type));
            if (!repaired) worst = Math.min(worst, 100 / (dps((md.attack || {}).units, def(u.type).shield) || 1e-9));
          }
          const ourTime = 100 / ours;
          if (!o.frozen && ourTime > WIN_MARGIN * worst) {
            fail(`${fighters.map((u) => u.type).join(' + ')} would not reliably beat a ${o.type} (${ourTime.toFixed(0)}s to win vs ${worst.toFixed(0)}s to lose)`);
          }
          occupied.delete(key(at.x, at.y));
          const r = { ...(def(o.type).recipe || {}) };
          const e = r.energy ? [100] : [];
          delete r.energy;
          addPile(at.x, at.y, r, e);
          log.push(`${where}: ${o.type} taken apart`);
          return;
        }
        case 'produce': {
          // produce <buildingId> <x,y> [color]: factory turns a tree/boulder at
          // x,y into bricks there; windmill/garage put energy/wheels at x,y;
          // nursery grows a tree at x,y.
          const b = units.get(args[0]) || fail(`unknown building "${args[0]}"`);
          const at = parseXY(args[1]);
          const d = def(b.type);
          if (cheb(b, at) !== 1) fail(`${args[1]} is not next to the ${b.type}`);
          const neighbours = [...piles.entries()].filter(([k]) => { const [x, y] = k.split(',').map(Number); return cheb({ x, y }, b) === 1; });
          const free = () => !occupied.has(key(at.x, at.y)) && !piles.has(key(at.x, at.y)) && !plans.has(key(at.x, at.y));
          spend(b, 'make');
          if (b.type === 'factory') {
            const color = args[2] || fail('say which colour the factory makes');
            const o = occupied.get(key(at.x, at.y));
            if (o && o.kind === 'monster' && o.type === 'boulder') occupied.delete(key(at.x, at.y));
            else if (TREES.has(name(at.x, at.y))) T[at.y][at.x] = '.';
            else fail(`no tree or boulder at ${args[1]}`);
            addPile(at.x, at.y, { [color]: d.makeHowManyBricks || 25 });
          } else if (b.type === 'windmill') {
            if (neighbours.some(([, p]) => p.energy.length)) fail('the windmill only makes energy when none is next to it');
            if (!free()) fail(`${args[1]} is not empty`);
            addPile(at.x, at.y, {}, [100]);
          } else if (b.type === 'garage') {
            if (neighbours.some(([, p]) => p.bricks.wheel > 0)) fail('the garage only makes wheels when none are next to it');
            if (!free()) fail(`${args[1]} is not empty`);
            addPile(at.x, at.y, { wheel: d.makeHowManyBricks || 4 });
          } else if (b.type === 'nursery') {
            if (!free() || name(at.x, at.y) !== 'normal') fail(`no room for a tree at ${args[1]}`);
            T[at.y][at.x] = 'T';
          } else fail(`a ${b.type} doesn't produce anything`);
          log.push(`${where}: ${b.type} produced, its energy ${b.energy.toFixed(1)}`);
          return;
        }
        case 'freeze': {
          const u = unitAt(args[0]);
          if (u.type !== 'freezebot') fail('only a freezebot can freeze');
          const at = parseXY(args[1]);
          const o = occupied.get(key(at.x, at.y));
          if (!o || o.kind !== 'monster') fail(`no monster at ${args[1]}`);
          if (cheb(u, at) > 2) fail('the monster is out of freeze range (2 tiles)');
          spend(u, 'freeze');
          o.frozen = true;
          break;
        }
        case 'goal': case 'bonus': {
          const g = goals.filter((x) => x.bonus === (cmd === 'bonus'));
          if (!g.length) fail(`level has no ${cmd}`);
          if (!g.every((x) => x.done)) fail(`${cmd} not reached yet`);
          break;
        }
        default: fail(`unknown action "${cmd}"`);
      }
      log.push(`${where}: ok`);
    } catch (e) {
      throw Object.assign(new Error(`${where}: ${e.message}`), { log });
    }
  });
  return { log, goals };
}

module.exports = { simulate, loadConfig };

if (require.main === module) {
  const [levelFile, solutionFile] = process.argv.slice(2);
  const cfg = loadConfig();
  try {
    const { log, goals } = simulate(fs.readFileSync(levelFile, 'latin1'), fs.readFileSync(solutionFile, 'utf8'), cfg);
    if (process.argv.includes('-v')) console.log(log.join('\n'));
    console.log(`${path.basename(levelFile)}: OK — goals ${goals.map((g) => `${g.bonus ? 'bonus' : 'goal'}:${g.done ? 'reached' : 'NOT reached'}`).join(', ')}`);
  } catch (e) {
    console.error(`${path.basename(levelFile)}: FAILED — ${e.message}`);
    process.exitCode = 1;
  }
}
