// Units tab: edit the game's config (vehicles, buildings, monsters, terrain
// effects and game rules). Saved settings apply to Play and Play campaign.
(function () {
  'use strict';

  const SECTIONS = [
    { id: 'vehicle', title: 'Vehicles & robots', cat: 'vehicle' },
    { id: 'building', title: 'Buildings', cat: 'building' },
    { id: 'monster', title: 'Monsters', cat: 'monster' },
    { id: 'terrain', title: 'Terrain effects' },
    { id: 'setup', title: 'Game rules' },
  ];
  const BRICKS = ['yellow', 'blue', 'red', 'green', 'white', 'wheel', 'energy'];

  // Labels and help for known properties; anything else gets a generic field.
  const INFO = {
    name: ['Name', 'Shown in the game.'],
    plural: ['Plural name', 'Used in goal texts such as "Collect 2 crabs".'],
    kind: ['Kind', 'robot or animal.'],
    speed: ['Speed', 'How fast it moves. Higher is faster.'],
    energy: ['Energy use', 'Energy each action costs; a full energy brick holds 100. "move" is per tile.'],
    terrain: ['Can be on', 'Terrain it can move on or be built on.'],
    recipe: ['Recipe', 'Bricks needed to build it, which you also get back when taking it apart.'],
    carries: ['Carries', 'How many bricks it can carry at once.'],
    shield: ['Damage taken', 'Damage is multiplied by this: 0.1 = takes 10% damage. Lower is tougher.'],
    attack: ['Attacks', 'Who it fights and how hard. "units" means all your units.'],
    attack_search_range: ['Notices enemies within', 'Tiles.'],
    recharges: ['Recharges', 'Units that get their energy refilled here.'],
    waterversion: ['Has a water version', 'Changes to its water form on water.'],
    transplant: ['Can move trees', 'Uproot and plant trees.'],
    dig: ['Can dig and fill', 'Turn land into water and back.'],
    push: ['Can push', 'Push boulders out of the way.'],
    rest_every: ['Rests about every', 'Moves between rests.'],
    rest_for: ['Rests for about', 'Seconds.'],
    freeze_duration: ['Freeze lasts', 'Seconds a frozen monster stays frozen.'],
    freeze_recharge: ['Freeze recharge', 'Seconds before it can freeze again.'],
    freeze_range: ['Freeze range', 'Tiles.'],
    makeHowManyBricks: ['Bricks made', 'Bricks produced each cycle.'],
    howLongDoesItTake: ['Production time', 'Length of a production cycle.'],
    damage: ['Damage', 'Damage dealt each period.'],
    period: ['Every', 'Seconds between damage.'],
    hits_per_minute: ['Hits/min', ''],
    chance_of_success: ['Hit chance %', ''],
    damage_range: ['Damage min–max', ''],
  };

  let api, el;
  let cfg = null, origCfg = null;
  let savedText = '';
  let selected = null;
  let loaded = false;

  function init() {
    api = window.wb2;
    el = api.el;
    api.dirtyChecks.push(() => loaded && Lingo.writeConfig(cfg) !== savedText);
    const bar = document.querySelector('#unitsActions');
    bar.append(
      el('button', { title: 'Put every unit back to the original game values', onclick: resetAll }, 'Reset all'),
      el('button', { title: 'Throw away unsaved changes', onclick: discard }, 'Discard changes'),
      el('button', { class: 'primary', title: 'Save (Ctrl+S)', onclick: save }, 'Save'),
    );
    document.querySelector('.doc[data-for-tab=units]').append(el('span', { id: 'unitsStatus' }, 'Units'));
    window.addEventListener('wb2:tab', (e) => { if (e.detail === 'units') load(); });
    window.addEventListener('keydown', (e) => {
      if (api.tab() === 'units' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    });
    if (api.tab() === 'units') load();
  }

  async function load(force = false) {
    if (loaded && !force) { render(); return; }
    const data = await (await fetch('/api/config')).json();
    cfg = Lingo.parseConfig(data.text);
    origCfg = Lingo.parseConfig(data.original);
    savedText = Lingo.writeConfig(cfg);
    loaded = true;
    if (!selected) selected = 'vehicle:' + (defsIn('vehicle')[0] || {}).key;
    render();
  }

  // --- model helpers --------------------------------------------------------
  const defsIn = (section) => section === 'setup'
    ? cfg.defs.filter((d) => d.kind === 'setting')
    : cfg.defs.filter((d) => d.kind === 'def' && d.section === section);
  const findDef = (c, section, key) => c.defs.find((d) => d.section === section && d.key === key);
  const current = (d) => (d.kind === 'def' ? Lingo.serialize(d.value) : d.value);
  function originalOf(d) {
    const o = findDef(origCfg, d.section, d.key);
    return o ? current(o) : null;
  }
  const isModified = (d) => current(d) !== originalOf(d);

  function displayName(d) {
    if (d.kind === 'def' && d.value.t === 'props') {
      const n = Lingo.get(d.value, 'name');
      if (n && n.t === 'str') {
        const dup = defsIn(d.section).some((o) => o !== d && Lingo.get(o.value, 'name') && Lingo.get(o.value, 'name').v === n.v);
        return dup ? `${n.v} (${d.key})` : n.v;
      }
    }
    return api.pretty(d.key);
  }

  function spriteFor(section, key) {
    if (section === 'terrain') return api.view.first(`terrain.${key}`);
    if (!['vehicle', 'building', 'monster'].includes(section)) return null;
    return MapView.unitSprite(api.view, section, key, false);
  }

  // Every symbol used for a given property anywhere in the config (e.g. all terrain names).
  function symbolsUsed(prop) {
    const out = new Set();
    for (const d of cfg.defs) {
      if (d.kind !== 'def' || d.value.t !== 'props') continue;
      const v = Lingo.get(d.value, prop);
      if (v && v.t === 'list') v.items.forEach((i) => i.t === 'sym' && out.add(i.v));
    }
    return [...out];
  }

  function changed() {
    render();
  }

  // --- rendering ------------------------------------------------------------
  function render() {
    const root = document.querySelector('#unitsView');
    const scroll = root.querySelector('.units-form') ? root.querySelector('.units-form').scrollTop : 0;
    root.innerHTML = '';
    const mods = cfg.defs.filter(isModified).length;
    const dirty = Lingo.writeConfig(cfg) !== savedText;
    document.querySelector('#unitsStatus').textContent =
      `${mods ? `${mods} setting${mods === 1 ? '' : 's'} changed from the original` : 'Original game values'}${dirty ? ' · unsaved' : ''}`;

    const list = el('nav', { class: 'units-list' });
    for (const s of SECTIONS) {
      list.append(el('h3', {}, s.title));
      if (s.id === 'setup') {
        const any = defsIn('setup').some(isModified);
        list.append(entry('setup:', 'Game rules', null, any));
        continue;
      }
      for (const d of defsIn(s.id)) list.append(entry(`${s.id}:${d.key}`, displayName(d), spriteFor(s.id, d.key), isModified(d)));
    }
    const form = el('section', { class: 'units-form' });
    const [section, key] = selected.split(':');
    if (section === 'setup') renderSetup(form);
    else {
      const d = findDef(cfg, section, key);
      if (d) renderDef(form, d);
    }
    root.append(list, form);
    form.scrollTop = scroll;
  }

  function entry(id, label, sprite, modified) {
    return el('button', {
      class: 'unit-entry', 'aria-pressed': String(id === selected),
      onclick: () => { selected = id; render(); },
    },
    el('span', { class: 'unit-icon' }, sprite ? el('img', { src: api.spriteUrl(sprite), alt: '' }) : null),
    el('span', { class: 'unit-label' }, label),
    modified ? el('span', { class: 'mod-dot', title: 'Changed from the original' }, '●') : null);
  }

  function renderDef(form, d) {
    const sprite = spriteFor(d.section, d.key);
    form.append(el('header', { class: 'unit-head' },
      sprite ? el('img', { src: api.spriteUrl(sprite), alt: '' }) : null,
      el('div', {},
        el('h1', {}, displayName(d)),
        el('div', { class: 'muted' }, `${SECTIONS.find((s) => s.id === d.section).title} · #${d.key}`)),
      isModified(d) ? el('button', { class: 'small', onclick: () => {
        d.value = Lingo.parse(originalOf(d));
        changed();
      } }, 'Reset to original') : null));

    if (d.value.t !== 'props') { form.append(rawField(d, () => d.value, (v) => { d.value = v; })); return; }
    const props = d.value;
    const grid = el('div', { class: 'fields' });
    for (const e of props.entries) {
      if (e.key.t !== 'sym') continue;
      grid.append(field(d, props, e.key.v, e.value));
    }
    form.append(grid);

    // Offer properties other entries in this section have but this one lacks.
    const have = new Set(props.entries.map((e) => e.key.v));
    const options = new Map();
    for (const o of defsIn(d.section)) {
      if (o.value.t !== 'props') continue;
      for (const e of o.value.entries) if (e.key.t === 'sym' && !have.has(e.key.v) && !options.has(e.key.v)) options.set(e.key.v, e.value);
    }
    if (options.size) {
      form.append(el('div', { class: 'row add-prop' },
        el('select', { id: 'addProp' }, [...options.keys()].map((k) => el('option', { value: k }, (INFO[k] || [api.pretty(k)])[0]))),
        el('button', { class: 'small', onclick: () => {
          const k = document.querySelector('#addProp').value;
          Lingo.set(props, k, JSON.parse(JSON.stringify(options.get(k))));
          changed();
        } }, '+ Add property')));
    }
  }

  // size: '' (one column), 'wide' (two columns) or 'full' (whole row).
  function labelled(key, control, { removable, onRemove, size = '' } = {}) {
    const [label, help] = INFO[key] || [api.pretty(key), ''];
    return el('div', { class: `field ${size}`.trim() },
      el('div', { class: 'field-head' },
        el('span', { class: 'field-label' }, label),
        removable ? el('button', { class: 'link', title: 'Remove this property', onclick: onRemove }, 'remove') : null),
      control,
      help ? el('div', { class: 'help muted' }, help) : null);
  }

  function numberInput(node, onSet, attrs = {}) {
    return el('input', {
      type: 'number', step: 'any', value: node ? node.v : 0, ...attrs,
      onchange: (e) => {
        const v = Number(e.target.value);
        if (!Number.isFinite(v)) { e.target.value = node ? node.v : 0; return; }
        onSet(v);
        changed();
      },
    });
  }

  function field(d, props, key, value) {
    const remove = { removable: !['name'].includes(key), onRemove: () => { Lingo.set(props, key, undefined); changed(); } };
    const setVal = (v) => Lingo.set(props, key, v);

    if (key === 'recipe' && value.t === 'props') return labelled(key, brickGrid(value), { ...remove, size: 'wide' });
    if ((key === 'terrain' || key === 'recharges') && value.t === 'list') {
      const choices = key === 'terrain' ? symbolsUsed('terrain') : Object.keys(api.catalog.config.vehicle);
      return labelled(key, symbolChecks(value, choices, key === 'recharges'), { ...remove, size: 'wide' });
    }
    if (key === 'attack' && value.t === 'props') return labelled(key, attackTable(value), { ...remove, size: 'full' });
    if (value.t === 'sym' && (value.v === 'yes' || value.v === 'no')) {
      return labelled(key, el('label', { class: 'check' },
        el('input', { type: 'checkbox', checked: value.v === 'yes', onchange: (e) => { setVal(Lingo.sym(e.target.checked ? 'yes' : 'no')); changed(); } }),
        'Yes'), remove);
    }
    if (value.t === 'num') return labelled(key, numberInput(value, (v) => setVal(Lingo.num(v))), remove);
    if (value.t === 'str') {
      return labelled(key, el('input', { value: value.v, maxlength: 40, onchange: (e) => { setVal(Lingo.str(e.target.value)); changed(); } }), remove);
    }
    if (value.t === 'sym') {
      return labelled(key, el('input', { value: value.v, onchange: (e) => {
        const v = e.target.value.trim().replace(/^#/, '');
        if (/^[A-Za-z_]\w*$/.test(v)) { setVal(Lingo.sym(v)); changed(); } else e.target.value = value.v;
      } }), remove);
    }
    if (value.t === 'props' && value.entries.every((e) => e.value.t === 'num')) {
      return labelled(key, el('div', { class: 'sub-grid' }, value.entries.map((e) => el('label', {}, api.pretty(e.key.v),
        numberInput(e.value, (v) => { e.value = Lingo.num(v); })))), remove);
    }
    if (value.t === 'list' && value.items.every((i) => i.t === 'num')) {
      return labelled(key, el('div', { class: 'row' }, value.items.map((it, i) => numberInput(it, (v) => { value.items[i] = Lingo.num(v); }))), remove);
    }
    return labelled(key, rawField(d, () => value, setVal), remove);
  }

  function brickGrid(recipe) {
    return el('div', { class: 'brick-grid' }, BRICKS.map((b) => {
      const node = Lingo.get(recipe, b);
      const sprite = b === 'wheel' ? 'resource.wheel' : b === 'energy' ? 'resource.energy' : `resource.${b}.4`;
      return el('label', { title: api.pretty(b) },
        el('img', { src: api.spriteUrl(sprite), alt: '' }),
        numberInput(node, (v) => Lingo.set(recipe, b, v > 0 ? Lingo.num(v) : undefined), { min: 0 }));
    }));
  }

  function symbolChecks(list, choices, useNames) {
    const has = new Set(list.items.filter((i) => i.t === 'sym').map((i) => i.v));
    return el('div', { class: 'checks' }, choices.map((c) => el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: has.has(c), onchange: (e) => {
        if (e.target.checked) list.items.push(Lingo.sym(c));
        else list.items = list.items.filter((i) => !(i.t === 'sym' && i.v === c));
        changed();
      } }),
      useNames ? api.typeName('vehicle', c) : api.pretty(c))));
  }

  function attackTable(attack) {
    const monsters = ['units', ...Object.keys(api.catalog.config.monster)];
    const table = el('table', { class: 'attack' },
      el('thead', {}, el('tr', {}, ['Target', 'Hits/min', 'Hit chance %', 'Damage min', 'Damage max', ''].map((h) => el('th', {}, h)))));
    const body = el('tbody');
    for (const e of attack.entries) {
      const a = e.value;
      if (a.t !== 'props') continue;
      const range = Lingo.get(a, 'damage_range');
      const setNum = (k) => (v) => Lingo.set(a, k, Lingo.num(v));
      body.append(el('tr', {},
        el('td', {}, e.key.t === 'sym' && e.key.v === 'units' ? 'All your units' : api.typeName('monster', e.key.v)),
        el('td', {}, numberInput(Lingo.get(a, 'hits_per_minute'), setNum('hits_per_minute'), { min: 0 })),
        el('td', {}, numberInput(Lingo.get(a, 'chance_of_success'), setNum('chance_of_success'), { min: 0, max: 100 })),
        el('td', {}, numberInput(range && range.items[0], (v) => { ensureRange(a).items[0] = Lingo.num(v); }, { min: 0 })),
        el('td', {}, numberInput(range && range.items[1], (v) => { ensureRange(a).items[1] = Lingo.num(v); }, { min: 0 })),
        el('td', {}, el('button', { class: 'small', title: 'Stop attacking this', onclick: () => {
          attack.entries.splice(attack.entries.indexOf(e), 1);
          changed();
        } }, '×'))));
    }
    table.append(body);
    const missing = monsters.filter((mk) => !attack.entries.some((e) => e.key.v === mk));
    return el('div', {}, el('div', { class: 'table-scroll' }, table), missing.length ? el('div', { class: 'row' },
      el('select', { id: 'addTarget' }, missing.map((mk) => el('option', { value: mk }, mk === 'units' ? 'All your units' : api.typeName('monster', mk)))),
      el('button', { class: 'small', onclick: () => {
        const template = attack.entries[0] ? JSON.parse(JSON.stringify(attack.entries[0].value))
          : Lingo.parse('[#hits_per_minute: 25, #chance_of_success: 75, #damage_range: [150, 250]]');
        attack.entries.push({ key: Lingo.sym(document.querySelector('#addTarget').value), value: template });
        changed();
      } }, '+ Add target')) : null);
  }

  function ensureRange(a) {
    let r = Lingo.get(a, 'damage_range');
    if (!r || r.t !== 'list') { r = { t: 'list', items: [Lingo.num(0), Lingo.num(0)] }; Lingo.set(a, 'damage_range', r); }
    return r;
  }

  // Fallback: edit the raw Lingo text of a value.
  function rawField(d, get, set) {
    const ta = el('textarea', { class: 'raw', rows: 2, spellcheck: 'false' });
    ta.value = Lingo.serialize(get());
    ta.addEventListener('change', () => {
      try { set(Lingo.parse(ta.value)); ta.classList.remove('bad'); changed(); } catch (e) { ta.classList.add('bad'); ta.title = e.message; }
    });
    return ta;
  }

  // Game rules: the "key=value" settings, with the comments above them as help.
  function renderSetup(form) {
    form.append(el('header', { class: 'unit-head' }, el('div', {}, el('h1', {}, 'Game rules'),
      el('div', { class: 'muted' }, 'General settings from the [setup] section of the game config.'))));
    const grid = el('div', { class: 'fields' });
    for (const d of defsIn('setup')) {
      const help = [];
      for (let i = d.index - 1; i >= 0 && /^\s*--/.test(cfg.lines[i]); i--) help.unshift(cfg.lines[i].replace(/^\s*--\s?/, ''));
      grid.append(el('div', { class: 'field' },
        el('div', { class: 'field-head' }, el('span', { class: 'field-label' }, api.pretty(d.key)),
          isModified(d) ? el('button', { class: 'link', onclick: () => { d.value = originalOf(d); changed(); } }, 'reset') : null),
        el('input', { value: d.value, onchange: (e) => { d.value = e.target.value.trim(); changed(); } }),
        help.length ? el('div', { class: 'help muted' }, help.join(' ')) : null));
    }
    form.append(grid);
  }

  // --- actions --------------------------------------------------------------
  async function save() {
    const res = await fetch('/api/config', { method: 'PUT', body: Lingo.writeConfig(cfg) });
    if (!res.ok) { api.toast('Saving unit settings failed.', true); return; }
    savedText = Lingo.writeConfig(cfg);
    await api.refreshCatalog();
    render();
    api.toast('Unit settings saved. They apply to Play and Play campaign.');
  }

  async function discard() {
    if (Lingo.writeConfig(cfg) === savedText) return;
    if (!(await api.confirmDialog('Discard changes?', 'Unsaved unit changes will be lost.', 'Discard'))) return;
    await load(true);
  }

  async function resetAll() {
    if (!(await api.confirmDialog('Reset all units?', 'Every unit, building, monster and game rule goes back to the original game values.', 'Reset all'))) return;
    await fetch('/api/config', { method: 'DELETE' });
    await api.refreshCatalog();
    await load(true);
    api.toast('Unit settings reset to the original game.');
  }

  if (window.wb2 && window.wb2.ready) init();
  else window.addEventListener('wb2:ready', init, { once: true });
})();
