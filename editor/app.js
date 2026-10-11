// WorldBuilder 2 level editor UI.
(async function () {
  'use strict';
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs = {}, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) e.append(c);
    return e;
  };
  const pretty = (s) => String(s).replace(/_/g, ' ').replace(/([a-z])(\d)/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());
  // Friendly names, mostly from the developers' "MAP KEY" notes in the game.
  const TERRAIN_LABELS = {
    normal_undiggable: 'Rocky ground', water_undiggable: 'Deep water', water_reefs: 'Reefs',
    tree2: 'Cypress', tree3: 'Little pine', tree4: 'Palm tree',
    jungle1: 'Flowery plant', jungle2: 'Lumpy root', jungle3: 'Cauliflowers', jungle4: 'Rocks & flowers',
    goal: 'Goal tile', billboard: 'Billboard', street_undiggable: 'Rocky street', cement: 'Cement',
  };
  const terrainLabel = (name) => TERRAIN_LABELS[name] || pretty(name);

  const catalog = await (await fetch('/api/catalog')).json();
  const { config } = catalog;
  const terrainChars = catalog.terrain.map((t) => t.char);
  const WATER_TERRAIN = new Set(['w', 'x', 'r', 'whirlpool']);
  const DRAFT_KEY = 'wb2-editor-draft';
  const START_LEVEL = 'Brickwood 12 The Last Expedition';

  const view = new MapView($('#map'), catalog);
  const state = {
    level: null,
    file: null,      // custom level file name, if saved
    dirty: false,
    tool: 'paint',
    brush: { type: 'terrain', char: '.' },
    selected: null,
    undo: [],
    redo: [],
  };

  // ---------------------------------------------------------------- helpers
  const typeName = (cat, t) => {
    const def = (config[cat] || {})[t];
    if (!def || !def.name) return pretty(t);
    const dup = Object.entries(config[cat]).some(([o, d]) => o !== t && d.name === def.name);
    return dup ? `${def.name} (${t})` : def.name;
  };
  const anyName = (t) => (config.vehicle[t] || config.building[t] || config.monster[t] || {}).name || pretty(t);
  const recipeText = (def) => def && def.recipe
    ? Object.entries(def.recipe).filter(([, n]) => n > 0).map(([c, n]) => `${n} ${c}`).join(' + ')
    : '';
  // The browser version renders sprites itself (web/main.js).
  const spriteUrl = (name) => (window.WB2_SPRITE_URL ? window.WB2_SPRITE_URL(name) : `/sprite/${encodeURIComponent(name)}.png`);

  function toast(msg, isError = false, ms = 4000) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, ms);
  }

  function confirmDialog(title, text, okLabel = 'OK') {
    const d = $('#dlgConfirm');
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmOk').textContent = okLabel;
    d.returnValue = '';
    d.showModal();
    return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
  }

  function openDialog(d) {
    d.returnValue = '';
    d.showModal();
    return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue), { once: true }));
  }

  // ---------------------------------------------------------------- palette
  function itemSprite(item) {
    return view.itemSprites(item).filter(Boolean)[0] || null;
  }

  function buildPalette() {
    const sections = [];
    sections.push({
      title: 'Terrain',
      entries: catalog.terrain.map((t) => ({
        label: terrainLabel(t.name), title: `${terrainLabel(t.name)}  (map character "${t.char}")`,
        sprite: view.first(`terrain.${t.name}`), brush: { type: 'terrain', char: t.char },
        color: catalog.preview ? MapView.terrainColor(t.name) : null,
      })),
    });
    // The browser version before the game files are added: only terrain,
    // drawn in colours (see web/main.js).
    if (catalog.preview) {
      buildPaletteSections(sections);
      $('#palette').append(el('div', { class: 'pal-preview-note' },
        el('p', {}, 'Vehicles, buildings, monsters, brick piles, plans and goals come from your copy of WorldBuilder 2.'),
        el('button', { class: 'primary small', onclick: () => window.WB2_REQUEST_GAME && window.WB2_REQUEST_GAME('palette') }, 'Add game files')));
      return;
    }
    // Types without any graphics (e.g. the unfinished bluebird) are left out.
    const unitEntries = (cat) => Object.entries(config[cat]).filter(([type]) => MapView.unitSprite(view, cat, type, false)).map(([type, def]) => {
      const item = { kind: 'unit', cat, type, water: false };
      const dup = Object.entries(config[cat]).some(([t, d]) => t !== type && d.name === def.name);
      const label = dup ? `${def.name} (${type})` : def.name || pretty(type);
      const lines = [label];
      if (def.recipe) lines.push(`Recipe: ${recipeText(def)}`);
      if (def.terrain) lines.push(`Moves on: ${def.terrain.join(', ')}`);
      return { label, title: lines.join('\n'), sprite: itemSprite(item), brush: { type: 'item', item } };
    });
    sections.push({ title: 'Vehicles & robots', entries: unitEntries('vehicle') });
    sections.push({ title: 'Buildings', entries: unitEntries('building') });
    sections.push({ title: 'Monsters', entries: unitEntries('monster') });
    sections.push({
      title: 'Brick piles',
      entries: Level.PILE_COLORS.map((c) => {
        const item = { kind: 'pile', contents: [[c, c === 'energy' ? 1 : 10]], water: false };
        return { label: pretty(c), title: `Pile of ${c} bricks (edit amounts in the inspector)`, sprite: itemSprite(item), brush: { type: 'item', item } };
      }),
    });
    const planTypes = [...Object.keys(config.vehicle), ...Object.keys(config.building)]
      .filter((t) => MapView.unitSprite(view, config.vehicle[t] ? 'vehicle' : 'building', t, false));
    sections.push({
      title: 'Plans',
      entries: planTypes.map((type) => {
        const def = config.vehicle[type] || config.building[type];
        const item = { kind: 'plan', type, count: 5, water: false };
        return {
          label: def.name || pretty(type), title: `Plan: ${def.name || type}\nRecipe: ${recipeText(def)}`,
          sprite: itemSprite(item), plan: true, brush: { type: 'item', item },
        };
      }),
    });
    sections.push({
      title: 'Goals',
      entries: [
        { label: 'Goal', title: 'Mission goal (set what it needs in the inspector)', sprite: 'goal.goal', brush: { type: 'item', item: { kind: 'goal', bonus: false, target: 'anything', water: false } } },
        { label: 'Bonus goal', title: 'Bonus goal (set what it needs in the inspector)', sprite: 'goal.bonus', brush: { type: 'item', item: { kind: 'goal', bonus: true, target: 'anything', water: false } } },
      ],
    });
    sections.push({
      title: 'Special',
      entries: [{ label: 'Whirlpool', title: 'Whirlpool (numbered; they seem to link in pairs 1↔2, 3↔4…)', sprite: 'whirlpool.generic', brush: { type: 'item', item: { kind: 'whirlpool', n: 1 } } }],
    });

    buildPaletteSections(sections);
  }

  function buildPaletteSections(sections) {
    const pal = $('#palette');
    pal.innerHTML = '';
    state.paletteButtons = [];
    for (const s of sections) {
      const grid = el('div', { class: 'pal-grid' });
      const sec = el('div', { class: 'pal-section' + (['Monsters', 'Buildings', 'Special'].includes(s.title) ? '' : '') },
        el('h3', { onclick: () => sec.classList.toggle('collapsed') }, s.title), grid);
      for (const e of s.entries) {
        const fallback = e.color ? el('span', { class: 'swatch-icon', style: `background:${e.color}` })
          : e.brush.type === 'terrain' ? el('span', { class: 'hole-icon' }) : '?';
        const icon = el('span', { class: 'pal-icon' + (e.plan ? ' plan' : '') }, e.sprite ? el('img', { src: spriteUrl(e.sprite), alt: '' }) : fallback);
        const b = el('button', {
          class: 'pal-item', title: e.title, 'aria-pressed': 'false',
          onclick: () => { setBrush(e.brush); setTool('paint'); },
        }, icon, el('span', { class: 'pal-label' }, e.label));
        b.brush = e.brush;
        state.paletteButtons.push(b);
        grid.append(b);
      }
      pal.append(sec);
    }
  }

  function brushKey(b) {
    if (!b) return '';
    if (b.type === 'terrain') return 't:' + b.char;
    const it = b.item;
    if (it.kind === 'unit') return `u:${it.cat}:${it.type}`;
    if (it.kind === 'plan') return `p:${it.type}`;
    if (it.kind === 'pile') return `pile:${it.contents.length === 1 ? it.contents[0][0] : '*'}`;
    if (it.kind === 'goal') return `g:${it.bonus}`;
    return it.kind;
  }

  function setBrush(brush) {
    state.brush = JSON.parse(JSON.stringify(brush));
    const key = brushKey(state.brush);
    for (const b of state.paletteButtons) b.setAttribute('aria-pressed', String(brushKey(b.brush) === key));
    renderBrushInfo();
    updateCursor();
  }

  function brushSprite(b) {
    if (b.type === 'terrain') return view.first(`terrain.${view.terrainName(b.char)}`);
    return itemSprite(b.item);
  }

  function describeItem(it) {
    switch (it.kind) {
      case 'unit': return typeName(it.cat, it.type) + (it.water ? ' (on water)' : '');
      case 'pile': return 'Brick pile: ' + it.contents.map(([c, n]) => `${n} ${c}`).join(', ');
      case 'plan': return `Plan: ${anyName(it.type)} ×${it.count}`;
      case 'goal': return `${it.bonus ? 'Bonus goal' : 'Goal'}: ${goalTargetLabel(it.target)}`;
      case 'whirlpool': return `Whirlpool ${it.n}`;
      default: return it.value;
    }
  }

  function renderBrushInfo() {
    const b = state.brush;
    const box = $('#brushInfo');
    box.innerHTML = '';
    if (state.tool !== 'paint') {
      box.append(el('span', {}, {
        select: 'Click a tile to inspect and edit it',
        erase: 'Click or drag to remove items',
        pick: 'Click a tile to copy it into the brush',
        center: 'Click where the camera should start',
      }[state.tool]));
      return;
    }
    const sprite = brushSprite(b);
    const label = b.type === 'terrain' ? terrainLabel(view.terrainName(b.char)) : describeItem(b.item);
    if (sprite) box.append(el('img', { src: spriteUrl(sprite), alt: '' }));
    box.append(el('span', {}, 'Brush: '), el('strong', {}, label));
  }

  // ---------------------------------------------------------------- tools
  function setTool(tool) {
    state.tool = tool;
    for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    renderBrushInfo();
    updateCursor();
  }

  // ---------------------------------------------------------------- cursors
  // Each tool gets its own cursor; the paint cursor also carries a small
  // picture of the current brush.
  const CURSOR_SIZE = 32;
  const TOOL_CURSORS = {
    select: { hot: [1, 1], fallback: 'default', draw(ctx) {
      outlined(ctx, new Path2D('M1.5 1.5 L1.5 22 L6.5 17.5 L10 25.5 L13.5 24 L10 16 L16.5 16 Z'), '#fff');
    } },
    paint: { hot: [2, 29], fallback: 'crosshair', draw(ctx) {
      outlined(ctx, new Path2D('M8 19 L17 10 L21 14 L12 23 Z'), '#c9c9d1');           // ferrule
      outlined(ctx, new Path2D('M17 10 L26 1.5 L30 5.5 L21 14 Z'), '#b5651d');          // handle
      outlined(ctx, new Path2D('M8 19 L12 23 C9 27 6 29 1.5 30 C2.5 25.5 4.5 22 8 19 Z'), '#ffcf1a'); // bristles
    } },
    erase: { hot: [4, 28], fallback: 'crosshair', draw(ctx) {
      outlined(ctx, new Path2D('M3 22 L15 10 L23 18 L13 28 L7 28 Z'), '#ff8fa3');
      outlined(ctx, new Path2D('M15 10 L22 3 L30 11 L23 18 Z'), '#4f9dff');
    } },
    pick: { hot: [2, 29], fallback: 'crosshair', draw(ctx) {
      outlined(ctx, new Path2D('M2 29.5 L3 25 L16 12 L19 15 L6 28 Z'), '#e7e9ee');
      outlined(ctx, new Path2D('M14 10 L21 17 L23 15 L16 8 Z'), '#7d8596');
      outlined(ctx, new Path2D('M19 12 C17 10 18 7 21 4 C24 1 27 1 29 3 C31 5 31 8 28 11 C25 14 22 15 20 13 Z'), '#ff5a4f');
    } },
    center: { hot: [16, 16], fallback: 'crosshair', draw(ctx) {
      const ring = new Path2D();
      ring.arc(16, 16, 9, 0, Math.PI * 2);
      const cross = new Path2D('M16 1 L16 10 M16 22 L16 31 M1 16 L10 16 M22 16 L31 16');
      for (const [w, c] of [[4, '#000'], [2, '#fff']]) {
        ctx.lineWidth = w; ctx.strokeStyle = c;
        ctx.stroke(ring); ctx.stroke(cross);
      }
    } },
  };

  function outlined(ctx, path, fill) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(path);
    ctx.fillStyle = fill; ctx.fill(path);
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#000'; ctx.stroke(path);
  }

  const cursorImages = new Map();
  function cursorImage(name) {
    let img = cursorImages.get(name);
    if (!img) {
      img = new Image();
      img.onload = () => updateCursor();
      img.src = spriteUrl(name);
      cursorImages.set(name, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  function updateCursor() {
    const def = TOOL_CURSORS[state.tool];
    if (!def) return;
    const c = document.createElement('canvas');
    c.width = c.height = CURSOR_SIZE;
    const ctx = c.getContext('2d');
    if (state.tool === 'paint') {
      // Brush preview badge in the top-left corner, away from the hotspot.
      const sprite = brushSprite(state.brush);
      const img = sprite && cursorImage(sprite);
      const isPlan = state.brush.type === 'item' && state.brush.item.kind === 'plan';
      ctx.fillStyle = isPlan ? 'rgba(40,110,220,0.95)' : 'rgba(21,23,28,0.9)';
      ctx.strokeStyle = '#ffcf1a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(0.75, 0.75, 17, 17, 3);
      ctx.fill(); ctx.stroke();
      if (img) {
        const s = Math.min(15 / img.naturalWidth, 15 / img.naturalHeight);
        const w = img.naturalWidth * s, h = img.naturalHeight * s;
        ctx.drawImage(img, 1.5 + (15 - w) / 2, 1.5 + (15 - h) / 2, w, h);
      }
    }
    def.draw(ctx);
    canvas.style.cursor = `url(${c.toDataURL()}) ${def.hot[0]} ${def.hot[1]}, ${def.fallback}`;
  }

  function pushUndo() {
    state.undo.push(JSON.stringify(state.level));
    if (state.undo.length > 200) state.undo.shift();
    state.redo = [];
  }
  function undo() {
    if (!state.undo.length) return;
    state.redo.push(JSON.stringify(state.level));
    state.level = JSON.parse(state.undo.pop());
    afterEdit(true);
  }
  function redo() {
    if (!state.redo.length) return;
    state.undo.push(JSON.stringify(state.level));
    state.level = JSON.parse(state.redo.pop());
    afterEdit(true);
  }

  function placeItem(x, y, template) {
    const lv = state.level;
    const item = JSON.parse(JSON.stringify(template));
    const onWater = WATER_TERRAIN.has(lv.terrain[y][x]);
    if (item.kind !== 'whirlpool' && item.kind !== 'raw') item.water = onWater;
    lv.items[y][x] = item;
    lv.terrain[y][x] = Level.itemTerrain(item);
  }

  // Apply the current tool to one tile. Returns true if the level changed.
  function applyTool(cell) {
    const lv = state.level;
    const { x, y } = cell;
    const before = JSON.stringify([lv.terrain[y][x], lv.items[y][x], lv.center]);
    switch (state.tool) {
      case 'select':
        return false; // selecting happens on mousedown; never edits
      case 'paint':
        if (state.brush.type === 'terrain') {
          lv.items[y][x] = null;
          lv.terrain[y][x] = state.brush.char;
        } else {
          placeItem(x, y, state.brush.item);
        }
        break;
      case 'erase':
        lv.items[y][x] = null;
        break;
      case 'pick': {
        const it = lv.items[y][x];
        setBrush(it ? { type: 'item', item: it } : { type: 'terrain', char: lv.terrain[y][x] });
        setTool('paint');
        return false;
      }
      case 'center':
        lv.center = { x, y };
        break;
    }
    return before !== JSON.stringify([lv.terrain[y][x], lv.items[y][x], lv.center]);
  }

  // ---------------------------------------------------------------- map input
  const canvas = $('#map');
  let drag = null; // {button, changed, undoPushed}

  function cellFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    return view.cellAt(e.clientX - r.left, e.clientY - r.top);
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    const cell = cellFromEvent(e);
    if (!cell) return;
    e.preventDefault();
    select(cell);
    const snapshot = JSON.stringify(state.level);
    const prevTool = state.tool;
    if (e.button === 2) {
      // Right-click erases only while painting/erasing; elsewhere it just selects.
      if (prevTool !== 'paint' && prevTool !== 'erase') return;
      state.tool = 'erase';
    } else if (e.button !== 0) return;
    drag = { snapshot, changed: applyTool(cell), restoreTool: e.button === 2 ? prevTool : null, last: cell };
    if (drag.changed) afterEdit();
  });
  window.addEventListener('mousemove', (e) => {
    const cell = e.target === canvas ? cellFromEvent(e) : null;
    const same = (a, b) => a && b && a.x === b.x && a.y === b.y;
    if (!same(cell, view.hover)) {
      view.hover = cell;
      view.requestDraw();
      showStatus(cell);
    }
    if (drag && cell && !same(cell, drag.last) && (state.tool === 'paint' || state.tool === 'erase')) {
      drag.last = cell;
      if (applyTool(cell)) { drag.changed = true; afterEdit(); }
    }
  });
  window.addEventListener('mouseup', () => {
    if (!drag) return;
    if (drag.changed) {
      state.undo.push(drag.snapshot);
      if (state.undo.length > 200) state.undo.shift();
      state.redo = [];
    }
    if (drag.restoreTool) state.tool = drag.restoreTool;
    drag = null;
  });
  canvas.addEventListener('mouseleave', () => { view.hover = null; view.requestDraw(); showStatus(null); });

  function showStatus(cell) {
    const s = $('#statusbar');
    if (!cell) { s.innerHTML = '&nbsp;'; return; }
    const lv = state.level;
    const it = lv.items[cell.y][cell.x];
    const t = terrainLabel(view.terrainName(lv.terrain[cell.y][cell.x]));
    s.textContent = `Tile ${cell.x + 1}, ${cell.y + 1} — ${it ? describeItem(it) : t}`;
  }

  // ---------------------------------------------------------------- selection / inspector
  function select(cell) {
    state.selected = cell;
    view.selected = cell;
    view.requestDraw();
    renderTileInfo();
  }

  function goalTargetLabel(t) {
    if (!t || t === 'anything') return 'anything';
    const m = /^collect\s+(\d+)\s+(\w+)$/.exec(t);
    if (m) return `collect ${m[1]} ${typeName('monster', m[2])}`;
    return anyName(t);
  }

  function optionList(pairs, current) {
    return pairs.map(([value, label]) => el('option', { value, selected: value === current }, label));
  }

  function editSelected(mutate) {
    const { x, y } = state.selected;
    pushUndo();
    mutate(state.level.items[y][x], state.level);
    const it = state.level.items[y][x];
    if (it) state.level.terrain[y][x] = Level.itemTerrain(it);
    afterEdit();
  }

  function renderTileInfo() {
    const box = $('#tileInfo');
    box.innerHTML = '';
    box.classList.remove('muted');
    const cell = state.selected;
    const lv = state.level;
    if (!cell || cell.x >= lv.width || cell.y >= lv.height) {
      box.classList.add('muted');
      box.textContent = 'Click a tile on the map.';
      return;
    }
    const it = lv.items[cell.y][cell.x];
    const tName = view.terrainName(lv.terrain[cell.y][cell.x]);
    const sprite = it ? itemSprite(it) : view.first(`terrain.${tName}`);
    box.append(el('div', { class: 'tile-head' },
      sprite ? el('img', { src: spriteUrl(sprite), alt: '' }) : null,
      el('div', {}, el('div', {}, el('strong', {}, it ? describeItem(it) : terrainLabel(tName))),
        el('div', { class: 'muted' }, `Tile ${cell.x + 1}, ${cell.y + 1}` + (it ? ` · on ${it.water ? 'water' : it.kind === 'whirlpool' ? 'whirlpool' : 'land'}` : '')))));
    if (!it) return;

    const vehicleOpts = Object.keys(config.vehicle).map((t) => [t, typeName('vehicle', t)]);
    const buildingOpts = Object.keys(config.building).map((t) => [t, typeName('building', t)]);

    if (it.kind === 'unit') {
      const opts = Object.keys(config[it.cat] || {}).map((t) => [t, typeName(it.cat, t)]);
      box.append(el('label', {}, pretty(it.cat),
        el('select', { onchange: (e) => editSelected((i) => { i.type = e.target.value; }) }, optionList(opts, it.type))));
    } else if (it.kind === 'plan') {
      box.append(
        el('label', {}, 'Builds',
          el('select', { onchange: (e) => editSelected((i) => { i.type = e.target.value; }) },
            el('optgroup', { label: 'Vehicles & robots' }, optionList(vehicleOpts, it.type)),
            el('optgroup', { label: 'Buildings' }, optionList(buildingOpts, it.type)))),
        el('label', {}, 'Number of uses',
          el('input', { type: 'number', min: 1, max: 99, value: it.count, onchange: (e) => editSelected((i) => { i.count = Math.max(1, Number(e.target.value) || 1); }) })));
    } else if (it.kind === 'pile') {
      const list = el('div');
      it.contents.forEach(([c, n], idx) => {
        list.append(el('div', { class: 'list-row' },
          el('select', { onchange: (e) => editSelected((i) => { i.contents[idx][0] = e.target.value; }) },
            optionList(Level.PILE_COLORS.map((p) => [p, pretty(p)]), c)),
          el('input', { type: 'number', min: 1, max: 999, value: n, onchange: (e) => editSelected((i) => { i.contents[idx][1] = Math.max(1, Number(e.target.value) || 1); }) }),
          el('button', { title: 'Remove', onclick: () => editSelected((i) => { i.contents.splice(idx, 1); }) }, '×')));
      });
      box.append(el('div', { class: 'muted', style: 'margin-bottom:4px' }, 'Bricks in this pile'), list,
        el('button', { class: 'small', onclick: () => editSelected((i) => {
          const unused = Level.PILE_COLORS.find((p) => !i.contents.some(([c]) => c === p)) || 'yellow';
          i.contents.push([unused, unused === 'energy' ? 1 : 10]);
        }) }, '+ Add bricks'));
    } else if (it.kind === 'goal') {
      const targets = [['anything', 'Anything'],
        ...vehicleOpts, ...buildingOpts,
        ...Object.keys(config.monster).map((m) => [`collect 1 ${m}`, `Collect 1 ${typeName('monster', m)}`])];
      if (!targets.some(([v]) => v === it.target)) targets.push([it.target, it.target]);
      box.append(
        el('label', {}, 'Needs',
          el('select', { onchange: (e) => editSelected((i) => { i.target = e.target.value; }) }, optionList(targets, it.target))),
        el('label', { class: 'check' },
          el('input', { type: 'checkbox', checked: it.bonus, onchange: (e) => editSelected((i) => { i.bonus = e.target.checked; }) }), 'Bonus goal'),
        el('label', { class: 'check' },
          el('input', { type: 'checkbox', checked: it.water, onchange: (e) => editSelected((i) => { i.water = e.target.checked; }) }), 'Goal is on water'));
    } else if (it.kind === 'whirlpool') {
      box.append(el('label', {}, 'Number',
        el('input', { type: 'number', min: 1, max: 99, value: it.n, onchange: (e) => editSelected((i) => { i.n = Math.max(1, Number(e.target.value) || 1); }) })));
    }
    if (it.kind === 'unit' || it.kind === 'pile' || it.kind === 'plan') {
      box.append(el('div', { class: 'muted' }, it.water
        ? 'Placed on water. Paint it on land to move it ashore.'
        : 'Placed on land. Paint it on water for the water version.'));
    }
    box.append(el('div', { class: 'row' },
      el('button', { class: 'small', onclick: () => { setBrush({ type: 'item', item: it }); setTool('paint'); } }, 'Use as brush'),
      el('button', { class: 'small', onclick: () => editSelected((i, lv2) => { lv2.items[state.selected.y][state.selected.x] = null; }) }, 'Remove item')));
  }

  function renderLevelInfo() {
    const lv = state.level;
    $('#lvTitle').value = lv.meta.title || '';
    $('#lvName').value = lv.name;
    $('#lvSize').textContent = `${lv.width} × ${lv.height}`;
    $('#lvCenter').textContent = lv.center ? `tile ${lv.center.x + 1}, ${lv.center.y + 1}` : 'map centre (default)';
    $('#btnClearCenter').disabled = !lv.center;

    const inv = $('#inventory');
    inv.innerHTML = '';
    const opts = [
      ...Object.keys(config.vehicle).map((t) => [t, typeName('vehicle', t)]),
      ...Object.keys(config.building).map((t) => [t, typeName('building', t)]),
    ];
    if (!lv.inventory.length) inv.append(el('div', { class: 'muted', style: 'margin-bottom:6px' }, 'None. The player only has what is on the map.'));
    lv.inventory.forEach((entry, idx) => {
      inv.append(el('div', { class: 'list-row' },
        el('select', { onchange: (e) => { pushUndo(); lv.inventory[idx].type = e.target.value; afterEdit(); } }, optionList(opts, entry.type)),
        el('input', { type: 'number', min: 1, max: 99, value: entry.count, title: 'Number of uses', onchange: (e) => { pushUndo(); lv.inventory[idx].count = Math.max(1, Number(e.target.value) || 1); afterEdit(); } }),
        el('button', { title: 'Remove', onclick: () => { pushUndo(); lv.inventory.splice(idx, 1); afterEdit(); } }, '×')));
    });
  }

  function renderProblems() {
    // Checking needs the game's unit definitions.
    const problems = catalog.preview
      ? [{ severity: 'warning', message: 'Add your game files (top right) to check this level and place vehicles, buildings and goals.', cells: [] }]
      : Level.validate(state.level, catalog);
    state.problems = problems;
    const list = $('#problems');
    list.innerHTML = '';
    const errors = problems.filter((p) => p.severity === 'error').length;
    const count = $('#problemCount');
    count.textContent = problems.length ? String(problems.length) : '';
    count.className = 'count' + (errors ? ' err' : problems.length ? ' warn' : '');
    if (!problems.length) list.append(el('li', { class: 'ok' }, '✓ No problems found'));
    for (const p of problems) {
      const li = el('li', { class: p.severity, 'data-has-cells': p.cells.length ? '' : null }, p.message);
      if (p.cells.length) {
        li.addEventListener('click', () => {
          const c = p.cells[0];
          select({ x: c.x, y: c.y });
          scrollToTile(c.x, c.y);
        });
        li.addEventListener('mouseenter', () => { view.marks = p.cells; view.requestDraw(); });
        li.addEventListener('mouseleave', () => { view.marks = null; view.requestDraw(); });
      }
      list.append(li);
    }
  }

  function scrollToTile(x, y) {
    const r = view.tileRect(x, y);
    const vp = $('#viewport');
    vp.scrollTo({ left: r.x - vp.clientWidth / 2 + r.w / 2, top: r.y - vp.clientHeight / 2 + r.h / 2, behavior: 'smooth' });
  }

  function renderText() {
    const text = Level.serialize(state.level, terrainChars);
    $('#lvText').value = text;
    const len = Level.gameText(state.level, terrainChars).length;
    $('#textSize').textContent = `${len} / ${Level.MAX_TEXT} characters`;
  }

  // Called after any change to the level.
  function afterEdit(structural = false) {
    state.dirty = true;
    if (structural) view.setLevel(state.level);
    else view.requestDraw();
    view.level = state.level;
    renderAll();
    saveDraft();
  }

  function renderAll() {
    renderLevelInfo();
    renderTileInfo();
    renderProblems();
    renderText();
    $('#docName').textContent = state.file ? `${state.file}.txt` : (state.level.meta.title || 'Untitled level');
    $('#dirtyMark').hidden = !state.dirty;
    document.title = `${state.dirty ? '● ' : ''}${$('#docName').textContent} — WB2 Level Editor`;
    $('#btnUndo').disabled = !state.undo.length;
    $('#btnRedo').disabled = !state.redo.length;
  }

  function loadLevel(level, file, { dirty = false } = {}) {
    state.level = level;
    state.file = file;
    state.dirty = dirty;
    state.undo = [];
    state.redo = [];
    state.selected = null;
    view.selected = null;
    view.setLevel(level);
    renderAll();
    saveDraft();
    $('#viewport').scrollTo(0, 0);
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: Level.serialize(state.level, terrainChars), file: state.file, dirty: state.dirty }));
    } catch (e) { /* storage unavailable */ }
  }

  // ---------------------------------------------------------------- level panel events
  $('#lvTitle').addEventListener('change', (e) => { pushUndo(); state.level.meta.title = e.target.value.trim(); afterEdit(); });
  $('#lvName').addEventListener('change', (e) => { pushUndo(); state.level.name = e.target.value.trim() || 'CUSTOM LEVEL'; afterEdit(); });
  $('#btnClearCenter').addEventListener('click', () => { pushUndo(); state.level.center = null; afterEdit(); });
  $('#btnAddInv').addEventListener('click', () => {
    pushUndo();
    const used = new Set(state.level.inventory.map((i) => i.type));
    const type = Object.keys(config.vehicle).find((t) => !used.has(t)) || 'buggy';
    state.level.inventory.push({ type, count: 5 });
    afterEdit();
  });
  for (const b of document.querySelectorAll('[data-resize]')) {
    b.addEventListener('click', () => {
      const [, side, delta] = /^(\w+)([+-]1)$/.exec(b.dataset.resize);
      const d = Number(delta);
      const lv = state.level;
      let w = lv.width, h = lv.height, ax = 0, ay = 0;
      if (side === 'top') { h += d; ay = d; }
      if (side === 'bottom') h += d;
      if (side === 'left') { w += d; ax = d; }
      if (side === 'right') w += d;
      if (w < 3 || h < 3 || w > 60 || h > 60) { toast('Maps must be between 3 and 60 tiles in each direction.'); return; }
      pushUndo();
      state.level = Level.resize(lv, w, h, ax, ay);
      if (state.selected) select({ x: state.selected.x + ax, y: state.selected.y + ay });
      afterEdit(true);
    });
  }
  $('#btnCopyText').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#lvText').value); toast('Level text copied.'); } catch (e) { toast('Copy failed; select the text and copy it manually.', true); }
  });

  // ---------------------------------------------------------------- toolbar events
  for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  const ZOOMS = [0.5, 0.75, 1, 1.5, 2];
  function setZoom(z) {
    view.setZoom(z);
    $('#zoomLabel').textContent = `${Math.round(z * 100)}%`;
    try { localStorage.setItem('wb2-editor-zoom', String(z)); } catch (e) { /* ignore */ }
  }
  const stepZoom = (dir) => setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(view.zoom) + dir))] || 1);
  $('#btnZoomIn').addEventListener('click', () => stepZoom(1));
  $('#btnZoomOut').addEventListener('click', () => stepZoom(-1));
  $('#btnGrid').addEventListener('click', () => {
    view.showGrid = !view.showGrid;
    $('#btnGrid').setAttribute('aria-pressed', String(view.showGrid));
    view.requestDraw();
  });

  // ---------------------------------------------------------------- file actions
  async function confirmDiscard() {
    if (!state.dirty) return true;
    return confirmDialog('Discard changes?', 'This level has unsaved changes.', 'Discard');
  }

  $('#btnNew').addEventListener('click', async () => {
    if (!(await confirmDiscard())) return;
    const d = $('#dlgNew');
    if ((await openDialog(d)) !== 'ok') return;
    const f = new FormData(d.querySelector('form'));
    const w = Math.max(3, Math.min(60, Number(f.get('w')) || 16));
    const h = Math.max(3, Math.min(60, Number(f.get('h')) || 12));
    const lv = Level.create(w, h);
    lv.name = 'CUSTOM LEVEL';
    for (const row of lv.terrain) row.fill(f.get('fill'));
    loadLevel(lv, null);
  });

  $('#btnOpen').addEventListener('click', async () => {
    const d = $('#dlgOpen');
    const custom = $('#openCustom');
    const original = $('#openGame');
    custom.innerHTML = '';
    original.innerHTML = '';
    const files = await (await fetch('/api/custom')).json();
    if (!files.length) custom.append(el('li', { class: 'empty' }, 'No saved levels yet.'));
    for (const f of files) {
      custom.append(el('li', { onclick: () => { d.close(); openCustom(f.file); } },
        el('span', {}, f.file), el('span', { class: 'id' }, new Date(f.modified).toLocaleString())));
    }
    let group = null;
    for (const l of catalog.levels) {
      const g = l.source === 'wb1' ? `WorldBuilder 1 · World ${l.world}` : 'WorldBuilder 2';
      if (g !== group) { group = g; original.append(el('li', { class: 'group' }, g)); }
      original.append(el('li', { onclick: () => { d.close(); openOriginal(l); } },
        el('span', {}, l.title), el('span', { class: 'id' }, l.id.replace(/^(wb1:)?map/, 'Mission '))));
    }
    d.showModal();
  });

  async function openCustom(file) {
    if (!(await confirmDiscard())) return;
    const res = await fetch(`/api/custom?file=${encodeURIComponent(file)}`);
    if (!res.ok) { toast('Could not open that level.', true); return; }
    const lv = Level.parse(await res.text());
    loadLevel(lv, file);
  }

  async function openOriginal(l) {
    if (!(await confirmDiscard())) return;
    const lv = Level.parse(await (await fetch(`/api/level?id=${encodeURIComponent(l.id)}`)).text());
    lv.meta.title = `${l.title} (copy)`;
    loadLevel(lv, null, { dirty: true });
    toast(`Opened a copy of "${l.title}". Save it to keep your changes.`);
  }

  async function save(asNew = false) {
    let file = state.file;
    if (!file || asNew) {
      const d = $('#dlgSaveAs');
      const input = d.querySelector('input[name=file]');
      input.value = (state.level.meta.title || state.level.name || 'my-level').replace(/[^\w\- ]+/g, '').trim().slice(0, 64) || 'my-level';
      if ((await openDialog(d)) !== 'ok') return false;
      file = input.value.trim();
    }
    const res = await fetch(`/api/custom?file=${encodeURIComponent(file)}`, { method: 'PUT', body: Level.serialize(state.level, terrainChars) });
    if (!res.ok) { toast(`Save failed: ${(await res.json()).error}`, true); return false; }
    state.file = file;
    state.dirty = false;
    renderAll();
    saveDraft();
    toast(`Saved levels/${file}.txt`);
    return true;
  }
  $('#btnSave').addEventListener('click', () => save(false));
  $('#btnSaveAs').addEventListener('click', () => save(true));

  // ---------------------------------------------------------------- sharing
  // Share code: "WB2:" + base64url(deflate(level text)).
  const SHARE_PREFIX = 'WB2:';
  const latin1Bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
  const bytesLatin1 = (b) => Array.from(b, (x) => String.fromCharCode(x)).join('');
  async function pipeBytes(bytes, stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  }
  async function encodeShareCode(text) {
    const packed = await pipeBytes(latin1Bytes(text), new CompressionStream('deflate-raw'));
    return SHARE_PREFIX + btoa(bytesLatin1(packed)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function decodeShareCode(code) {
    const b64 = code.trim().slice(SHARE_PREFIX.length).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    return bytesLatin1(await pipeBytes(latin1Bytes(atob(b64)), new DecompressionStream('deflate-raw')));
  }
  // Level text, share code, or nothing recognisable -> level text or null.
  async function levelTextFrom(input) {
    const s = input.trim();
    if (s.toUpperCase().startsWith(SHARE_PREFIX)) {
      try { return await decodeShareCode(s); } catch (e) { throw new Error('That share code is damaged or incomplete.'); }
    }
    return s;
  }

  function downloadFile(name, text, type = 'text/plain') {
    const a = el('a', { href: URL.createObjectURL(new Blob([latin1Bytes(text)], { type })), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const safeFileName = (s) => (s || 'level').replace(/[^\w\- ]+/g, '').trim().slice(0, 64) || 'level';

  $('#btnShare').addEventListener('click', async () => {
    const text = Level.serialize(state.level, terrainChars);
    const code = await encodeShareCode(text);
    $('#shareCode').value = code;
    $('#shareInfo').textContent = `${code.length} characters · ${state.level.width}×${state.level.height} map`;
    openDialog($('#dlgShare'));
    $('#shareCode').select();
  });
  $('#btnCopyCode').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#shareCode').value); toast('Share code copied.'); } catch (e) { $('#shareCode').select(); toast('Press Ctrl+C to copy the selected code.'); }
  });
  $('#btnDownloadLevel').addEventListener('click', () => {
    downloadFile(`${safeFileName(state.level.meta.title || state.file || state.level.name)}.txt`, Level.serialize(state.level, terrainChars));
  });

  $('#btnImportFile').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    $('#dlgImport textarea').value = bytesLatin1(new Uint8Array(await f.arrayBuffer()));
  });

  $('#btnImport').addEventListener('click', async () => {
    const d = $('#dlgImport');
    const ta = d.querySelector('textarea');
    ta.value = '';
    if ((await openDialog(d)) !== 'ok' || !ta.value.trim()) return;
    if (!(await confirmDiscard())) return;
    let text;
    try { text = await levelTextFrom(ta.value); } catch (e) { toast(e.message, true); return; }
    const lv = Level.parse(text);
    if (!lv.width || !lv.height) { toast('No level found. Paste a WB2: share code or level text.', true); return; }
    loadLevel(lv, null, { dirty: true });
    toast(`Imported "${lv.meta.title || lv.name}". Save it to keep it.`);
  });

  async function play() {
    const errors = (state.problems || []).filter((p) => p.severity === 'error');
    if (errors.length && !(await confirmDialog('Play anyway?', `This level has ${errors.length} error(s): ${errors[0].message} The game may crash or the mission may be impossible.`, 'Play anyway'))) return;
    const btn = $('#btnPlay');
    btn.disabled = true;
    btn.textContent = 'Building…';
    try {
      const res = await fetch('/api/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: Level.gameText(state.level, terrainChars), title: state.level.meta.title || state.level.name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      // The browser version answers with its own message (or none).
      if (body.message !== undefined) { if (body.message) toast(body.message, false, 9000); } else {
        toast('Game launching… Start the game and click the first mission on the world map to play this level.'
          + (body.scaled ? ' Resize the window to scale it; F11 toggles fullscreen.' : ''), false, 9000);
      }
    } catch (e) {
      toast(e.message, true, 7000);
    } finally {
      btn.disabled = false;
      btn.textContent = '▶ Play in game';
    }
  }
  $('#btnPlay').addEventListener('click', play);

  // ---------------------------------------------------------------- keyboard
  window.addEventListener('keydown', (e) => {
    if (currentTab !== 'level') return; // other tabs handle their own keys
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) || document.querySelector('dialog[open]');
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); save(e.shiftKey); return; }
    if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#btnOpen').click(); return; }
    if (e.key === 'F5') { e.preventDefault(); play(); return; }
    if (typing) return;
    if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (ctrl) return;
    const k = e.key.toLowerCase();
    if (k === 'v' || k === 'escape') setTool('select');
    else if (k === 'p') setTool('paint');
    else if (k === 'e') setTool('erase');
    else if (k === 'i') setTool('pick');
    else if (k === 'c') setTool('center');
    else if (k === 'g') $('#btnGrid').click();
    else if (k === '+' || k === '=') stepZoom(1);
    else if (k === '-') stepZoom(-1);
    else if ((k === 'delete' || k === 'backspace') && state.selected && state.level.items[state.selected.y][state.selected.x]) {
      editSelected((i, lv) => { lv.items[state.selected.y][state.selected.x] = null; });
    }
  });
  // Other tabs register functions that report unsaved changes.
  const dirtyChecks = [() => state.dirty];
  window.addEventListener('beforeunload', (e) => {
    if (dirtyChecks.some((f) => f())) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------------------------------------------------------------- tabs
  let currentTab = 'level';
  function showTab(tab) {
    currentTab = tab;
    document.body.dataset.tab = tab;
    for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const n of document.querySelectorAll('[data-for-tab]')) n.hidden = n.dataset.forTab !== tab;
    if (tab === 'level') view.requestDraw();
    window.dispatchEvent(new CustomEvent('wb2:tab', { detail: tab }));
    try { localStorage.setItem('wb2-editor-tab', tab); } catch (e) { /* ignore */ }
  }
  for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => showTab(b.dataset.tab));

  // Re-read unit definitions after the Units tab saves, so names, recipes and
  // level checks use the tuned values.
  // Also called once the browser version gets its game files: the whole
  // catalog (pictures, terrain, original levels) is replaced.
  async function refreshCatalog() {
    const fresh = await (await fetch('/api/catalog')).json();
    for (const k of Object.keys(config)) delete config[k];
    Object.assign(config, fresh.config);
    Object.assign(catalog, { configTuned: fresh.configTuned, terrain: fresh.terrain, levels: fresh.levels, sprites: fresh.sprites, preview: !!fresh.preview });
    view.terrainByChar = Object.fromEntries(catalog.terrain.map((t) => [t.char, t.name]));
    view.images.clear();
    view.requestDraw();
    buildPalette();
    setBrush(state.brush);
    renderAll();
  }

  // ---------------------------------------------------------------- start
  // Shared with campaign.js / units.js (and handy for debugging).
  window.wb2 = {
    state, view, catalog, terrainChars,
    el, toast, confirmDialog, openDialog, spriteUrl, pretty, typeName, terrainLabel, describeItem,
    downloadFile, safeFileName, latin1Bytes, bytesLatin1, dirtyChecks, refreshCatalog, showTab,
    tab: () => currentTab,
    // Open a saved level in the Level tab.
    async editLevel(file) { showTab('level'); await openCustom(file); },
    // Open level text (e.g. from the gallery) as a new, unsaved level.
    async openLevelText(text) {
      if (!(await confirmDiscard())) return false;
      const lv = Level.parse(text);
      if (!lv.width || !lv.height) { toast('That is not a WorldBuilder 2 level.', true); return false; }
      loadLevel(lv, null, { dirty: true });
      showTab('level');
      return true;
    },
    levelText: () => Level.serialize(state.level, terrainChars),
  };
  buildPalette();
  setTool('select');
  setBrush({ type: 'terrain', char: '.' });
  $('#btnGrid').setAttribute('aria-pressed', 'true');
  let zoom = 1;
  try { zoom = Number(localStorage.getItem('wb2-editor-zoom')) || 1; } catch (e) { /* ignore */ }
  setZoom(ZOOMS.includes(zoom) ? zoom : 1);

  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { /* ignore */ }
  if (draft && draft.text) {
    loadLevel(Level.parse(draft.text), draft.file || null, { dirty: !!draft.dirty });
  } else {
    // The first time: an unsaved copy of the Brickwood finale (the level in
    // the picture behind the browser version's game files window), or an
    // empty field if that level is gone.
    let lv = null;
    try {
      const res = await fetch(`/api/custom?file=${encodeURIComponent(START_LEVEL)}`);
      if (res.ok) lv = Level.parse(await res.text());
    } catch (e) { /* use an empty field */ }
    if (!lv || !lv.width || !lv.height) {
      lv = Level.create(16, 12);
      lv.name = 'CUSTOM LEVEL';
    }
    loadLevel(lv, null);
  }

  window.wb2.ready = true;
  window.dispatchEvent(new CustomEvent('wb2:ready'));
  let startTab = 'level';
  try { startTab = localStorage.getItem('wb2-editor-tab') || 'level'; } catch (e) { /* ignore */ }
  showTab(['level', 'campaign', 'units'].includes(startTab) ? startTab : 'level');
})();
