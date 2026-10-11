// Campaign tab: choose which level plays in each of the 24 mission slots
// (or leave it unused), their titles and which missions each one unlocks;
// play or share it.
(function () {
  'use strict';
  const WORLDS = [
    { n: 1, name: 'World 1 · Jungle' },
    { n: 2, name: 'World 2 · Urban' },
  ];
  const slotsOf = (w) => Array.from({ length: 12 }, (_, i) => `map${w}.${i + 1}`);
  const missionNo = (slot) => Number(slot.split('.')[1]);
  const worldNo = (slot) => Number(slot[3]);
  // Always open in the game, so every campaign starts there; never unused.
  const FIRST = 'map1.1';
  const NEXT_WORLD = 13; // an unlock that opens the next world's mission 1
  const EMPTY = ':empty'; // the "Not used" choice (no file name has a colon)

  let api, el;
  let original = null;   // { titles, unlocks }
  let missions = {};     // slot -> { level, title, unlocks }
  let savedJson = '';
  let files = [];        // custom level file names
  const levelCache = new Map(); // file -> { text, level, problems }
  let loaded = false;

  function init() {
    api = window.wb2;
    el = api.el;
    api.dirtyChecks.push(() => loaded && JSON.stringify(missions) !== savedJson);
    buildActions();
    // For the gallery (gallery.js).
    api.campaignFile = campaignFile;
    api.importCampaign = importCampaign;
    api.campaignProblems = problems;
    window.addEventListener('wb2:tab', (e) => { if (e.detail === 'campaign') load(); });
    if (api.tab() === 'campaign') load();
    window.addEventListener('keydown', (e) => {
      if (api.tab() !== 'campaign') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      if (e.key === 'F5') { e.preventDefault(); play(); }
    });
  }

  function buildActions() {
    const bar = document.querySelector('#campaignActions');
    bar.append(
      el('button', { title: 'Start a campaign of your own: every mission unused until you choose a level for it', onclick: newCampaign }, 'New'),
      el('button', { title: 'Load a campaign file', onclick: () => importInput.click() }, 'Import'),
      el('button', { title: 'Save (Ctrl+S)', onclick: save }, 'Save'),
      el('button', { title: 'Share this campaign in the gallery, or as a file', onclick: () => document.querySelector('#dlgCampaignShare').showModal() }, 'Share'),
      el('span', { class: 'sep' }),
      el('button', { class: 'primary', id: 'btnPlayCampaign', title: 'Build the whole campaign and launch it (F5)', onclick: play }, '▶ Play campaign'),
    );
    document.querySelector('.doc[data-for-tab=campaign]').append(el('span', { id: 'campaignStatus' }, 'Campaign'));
    const shareDialog = document.querySelector('#dlgCampaignShare');
    document.querySelector('#btnCampaignGallery').addEventListener('click', () => { shareDialog.close(); api.shareToGallery('campaign'); });
    document.querySelector('#btnCampaignDownload').addEventListener('click', exportCampaign);
  }

  const importInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,.wb2campaign', hidden: true });
  importInput.addEventListener('change', async () => {
    const f = importInput.files[0];
    importInput.value = '';
    if (f) importCampaign(await f.text());
  });
  document.body.append(importInput);

  async function load() {
    if (loaded) {
      // Levels may have been saved or edited in the Level tab meanwhile.
      levelCache.clear();
      await refreshFiles();
      await loadAssignedLevels();
      render();
      return;
    }
    const [c, list] = await Promise.all([
      fetch('/api/campaign').then((r) => r.json()),
      fetch('/api/custom').then((r) => r.json()),
    ]);
    if (c.error) return; // e.g. the browser version without the game files
    original = c.original;
    missions = c.campaign.missions || {};
    savedJson = JSON.stringify(missions);
    files = list.map((f) => f.file).sort((a, b) => a.localeCompare(b));
    loaded = true;
    await loadAssignedLevels();
    render();
  }

  async function refreshFiles() {
    files = (await fetch('/api/custom').then((r) => r.json())).map((f) => f.file).sort((a, b) => a.localeCompare(b));
  }

  async function levelInfo(file) {
    if (levelCache.has(file)) return levelCache.get(file);
    const res = await fetch(file.startsWith('wb1:')
      ? `/api/level?id=${encodeURIComponent(file)}`
      : `/api/custom?file=${encodeURIComponent(file)}`);
    const info = res.ok ? { text: await res.text() } : { missing: true };
    if (info.text) {
      info.level = Level.parse(info.text);
      info.problems = Level.validate(info.level, api.catalog);
    }
    levelCache.set(file, info);
    return info;
  }
  async function loadAssignedLevels() {
    await Promise.all(Object.values(missions).filter((m) => m.level).map((m) => levelInfo(m.level)));
  }

  // --- helpers --------------------------------------------------------------
  const wb1Levels = () => api.catalog.levels.filter((l) => l.source === 'wb1');
  const m = (slot) => missions[slot] || {};
  const isEmpty = (slot) => slot !== FIRST && m(slot).empty === true;
  const unlocksOf = (slot) => m(slot).unlocks || original.unlocks[slot] || [];
  // What completing it really unlocks: unused missions stay locked.
  const opensOf = (slot) => unlocksOf(slot).filter((u) => u === NEXT_WORLD || !isEmpty(`map${worldNo(slot)}.${u}`));
  function setUnlocks(slot, list) {
    const same = JSON.stringify(list) === JSON.stringify(original.unlocks[slot] || []);
    update(slot, { unlocks: same ? null : list });
  }
  // Same fallback order as tools/campaign.js: own title, the level's title,
  // the level's file name, the original mission's title.
  function titleOf(slot) {
    const mm = m(slot);
    if (mm.title) return mm.title;
    if (mm.level) {
      const info = levelCache.get(mm.level);
      return (info && info.level && info.level.meta.title) || mm.level;
    }
    return original.titles[slot];
  }
  function update(slot, patch) {
    const next = { ...m(slot), ...patch };
    for (const k of Object.keys(next)) if (next[k] == null || next[k] === '') delete next[k];
    if (Object.keys(next).length) missions[slot] = next; else delete missions[slot];
    render();
  }

  // Missions reachable from mission 1 by following unlocks.
  function reachable(w) {
    const seen = new Set([1]);
    const queue = [1];
    while (queue.length) {
      const n = queue.shift();
      for (const u of opensOf(`map${w}.${n}`)) if (u <= 12 && !seen.has(u)) { seen.add(u); queue.push(u); }
    }
    return seen;
  }

  // Used missions nothing leads to, and whether World 2 ever opens.
  function worldIssues(w) {
    const reach = reachable(w);
    const used = slotsOf(w).filter((s) => !isEmpty(s));
    return {
      used,
      unreachable: used.filter((s) => !reach.has(missionNo(s))),
      opens2: [...reachable(1)].some((n) => opensOf(`map1.${n}`).includes(NEXT_WORLD)),
    };
  }

  // What keeps the campaign from being finished, one line each (for the
  // gallery, which only takes campaigns without them).
  async function problems() {
    if (!loaded) await load();
    if (!loaded) return [];
    levelCache.clear(); // levels may have been edited in the Level tab
    await loadAssignedLevels();
    const out = [];
    for (const w of WORLDS) {
      const { used, unreachable, opens2 } = worldIssues(w.n);
      for (const slot of used) {
        const mm = m(slot);
        const info = mm.level && levelCache.get(mm.level);
        if (!info) continue;
        const error = (info.problems || []).find((p) => p.severity === 'error');
        if (info.missing) out.push(`Mission ${slot.slice(3)}: its level "${mm.level}" is missing.`);
        else if (error) out.push(`Mission ${slot.slice(3)} (${titleOf(slot)}): ${error.message}`);
      }
      if (unreachable.length) out.push(`${w.name}: missions ${unreachable.map(missionNo).join(', ')} can't be reached; no other mission unlocks them.`);
      if (w.n === 2 && used.length && !opens2) out.push('World 2 never opens: no World 1 mission the player can reach unlocks "World 2".');
    }
    return out;
  }

  // A level chosen for an unused mission: the used mission before it now
  // leads here, and hands over opening World 2 if it did that.
  function fill(slot, level) {
    const n = missionNo(slot);
    const prev = `map${worldNo(slot)}.${n - 1}`;
    let unlocks = [];
    if (n > 1 && !isEmpty(prev) && !opensOf(prev).includes(n)) {
      const before = opensOf(prev);
      if (before.includes(NEXT_WORLD)) unlocks = [NEXT_WORLD];
      setUnlocks(prev, [...before.filter((u) => u !== NEXT_WORLD), n].sort((a, b) => a - b));
    }
    missions[slot] = {};
    setUnlocks(slot, unlocks);
    update(slot, { level });
  }

  // --- rendering ------------------------------------------------------------
  function render() {
    const root = document.querySelector('#campaignView');
    const scrollTop = root.scrollTop;
    root.innerHTML = '';
    const changed = Object.keys(missions).length;
    const used = 24 - WORLDS.flatMap((w) => slotsOf(w.n)).filter(isEmpty).length;
    const dirty = JSON.stringify(missions) !== savedJson;
    document.querySelector('#campaignStatus').textContent =
      `${used < 24 ? `${used} mission${used === 1 ? '' : 's'}` : changed ? `${changed} mission${changed === 1 ? '' : 's'} changed` : 'Original campaign'}${dirty ? ' · unsaved' : ''}`;

    root.append(el('div', { class: 'page-intro' },
      el('h1', {}, 'Campaign'),
      el('p', { class: 'muted' },
        'Pick a level for each mission, give it a title, and choose which missions it unlocks when completed. ',
        'Missions you don\'t need can be left unused; they stay hidden on the world map. ',
        'The campaign starts at mission 1.1, and World 2 opens when a World 1 mission that unlocks "World 2" is completed. ',
        api.catalog.configTuned ? 'Your unit settings from the Units tab are included.' : ''),
      el('div', { class: 'row options' },
        el('label', { class: 'check' }, el('input', { type: 'checkbox', id: 'optFresh', checked: true }), 'Start with fresh progress'),
        el('label', { class: 'check', title: 'Marks every mission as completed so you can open any of them (they show as flags on the world map).' },
          el('input', { type: 'checkbox', id: 'optUnlockAll' }), 'Unlock all missions (for testing)'))));

    for (const w of WORLDS) {
      const reach = reachable(w.n);
      const { used, unreachable, opens2 } = worldIssues(w.n);
      const section = el('section', { class: 'world' },
        el('h2', {}, w.name, used.length < 12 ? el('span', { class: 'muted' }, ` · ${used.length} of 12 missions used`) : null),
        unreachable.length ? el('p', { class: 'warn-line' },
          `⚠ Missions ${unreachable.map(missionNo).join(', ')} can't be reached: no other mission unlocks them.`) : null,
        w.n === 2 && used.length && !opens2 ? el('p', { class: 'warn-line' },
          '⚠ World 2 never opens: no World 1 mission the player can reach unlocks "World 2".') : null);
      const grid = el('div', { class: 'mission-grid' });
      for (const slot of slotsOf(w.n)) grid.append(card(slot, reach.has(missionNo(slot))));
      section.append(grid);
      root.append(section);
    }
    root.scrollTop = scrollTop;
  }

  function card(slot, isReachable) {
    const n = missionNo(slot);
    const mm = m(slot);
    const empty = isEmpty(slot);
    const info = mm.level ? levelCache.get(mm.level) : null;
    const errors = info && info.problems ? info.problems.filter((p) => p.severity === 'error') : [];
    const warnings = info && info.problems ? info.problems.filter((p) => p.severity === 'warning') : [];

    const levelSelect = el('select', {
      onchange: async (e) => {
        const v = e.target.value;
        if (v === EMPTY) { update(slot, { empty: true, level: null, title: null, unlocks: null }); return; }
        if (v) await levelInfo(v);
        if (!empty) update(slot, { level: v || null });
        else if (v) fill(slot, v);
        else update(slot, { empty: null });
      },
    },
    slot !== FIRST ? el('option', { value: EMPTY, selected: empty }, 'Not used') : null,
    el('option', { value: '', selected: !empty && !mm.level }, `Original: ${original.titles[slot]}`),
    files.length ? el('optgroup', { label: 'My levels' }, files.map((f) => el('option', { value: f, selected: f === mm.level }, f))) : null,
    wb1Levels().length ? el('optgroup', { label: 'WorldBuilder 1 missions' }, wb1Levels().map((l) =>
      el('option', { value: l.id, selected: l.id === mm.level }, `WB1 ${l.id.slice(7)}: ${l.title}`))) : null);
    if (mm.level && !files.includes(mm.level) && !mm.level.startsWith('wb1:')) levelSelect.append(el('option', { value: mm.level, selected: true }, `${mm.level} (missing!)`));

    const chips = el('div', { class: 'chips' });
    const unlocks = opensOf(slot);
    const chip = (i, label, what) => {
      const on = unlocks.includes(i);
      chips.append(el('button', {
        class: 'chip', 'aria-pressed': String(on), title: on ? `Completing this unlocks ${what}` : `Click to unlock ${what} when this one is completed`,
        onclick: () => setUnlocks(slot, on ? unlocks.filter((u) => u !== i) : [...unlocks, i].sort((a, b) => a - b)),
      }, label));
    };
    for (let i = 1; i <= 12; i++) if (i !== n && !isEmpty(`map${worldNo(slot)}.${i}`)) chip(i, String(i), `mission ${i}`);
    if (worldNo(slot) === 1) chip(NEXT_WORLD, 'World 2', 'World 2');

    if (empty) {
      return el('article', { class: 'mission empty' },
        el('header', {},
          el('span', { class: 'mission-no' }, `Mission ${slot.slice(3)}`),
          el('span', { class: 'badges' }, el('span', { class: 'badge' }, 'not used'))),
        el('label', {}, 'Level', levelSelect));
    }

    const status = [];
    if (!isReachable) status.push(el('span', { class: 'badge warn', title: 'No mission unlocks this one' }, 'unreachable'));
    if (info && info.missing) status.push(el('span', { class: 'badge err' }, 'level file missing'));
    if (errors.length) status.push(el('span', { class: 'badge err', title: errors.map((p) => p.message).join('\n') }, `${errors.length} error${errors.length > 1 ? 's' : ''}`));
    else if (warnings.length) status.push(el('span', { class: 'badge warn', title: warnings.map((p) => p.message).join('\n') }, `${warnings.length} warning${warnings.length > 1 ? 's' : ''}`));

    return el('article', { class: 'mission' + (mm.level ? ' custom' : '') + (isReachable ? '' : ' unreachable') },
      el('header', {},
        el('span', { class: 'mission-no' }, `Mission ${slot.slice(3)}`),
        el('span', { class: 'badges' }, mm.level ? el('span', { class: 'badge custom' }, 'custom') : null, status)),
      el('label', {}, 'Level', levelSelect),
      el('label', {}, 'Title',
        el('input', {
          maxlength: 40, value: mm.title || '', placeholder: titleOf(slot),
          onchange: (e) => update(slot, { title: e.target.value.trim() || null }),
        })),
      el('div', { class: 'unlock-label muted' }, 'When completed, unlocks:'),
      chips,
      el('div', { class: 'row' },
        mm.level && !mm.level.startsWith('wb1:') ? el('button', { class: 'small', onclick: () => api.editLevel(mm.level) }, 'Edit level') : null,
        slot !== FIRST ? el('button', { class: 'small', title: 'Leave this mission out of the campaign (it stays hidden in the game)', onclick: () => update(slot, { empty: true, level: null, title: null, unlocks: null }) }, 'Don\'t use') : null));
  }

  // --- actions --------------------------------------------------------------
  async function save() {
    const res = await fetch('/api/campaign', { method: 'PUT', body: JSON.stringify({ missions }) });
    if (!res.ok) { api.toast('Saving the campaign failed.', true); return false; }
    missions = (await res.json()).campaign.missions;
    savedJson = JSON.stringify(missions);
    render();
    api.toast('Campaign saved.');
    return true;
  }

  async function play() {
    if (JSON.stringify(missions) !== savedJson && !(await save())) return;
    const bad = Object.entries(missions).filter(([, mm]) => {
      const info = mm.level && levelCache.get(mm.level);
      return info && (info.missing || (info.problems || []).some((p) => p.severity === 'error'));
    });
    if (bad.length && !(await api.confirmDialog('Play anyway?', `Missions ${bad.map(([s]) => s.slice(3)).join(', ')} have errors. The game may crash or those missions may be impossible.`, 'Play anyway'))) return;
    const btn = document.querySelector('#btnPlayCampaign');
    btn.disabled = true;
    btn.textContent = 'Building…';
    try {
      const res = await fetch('/api/campaign/play', {
        method: 'POST',
        body: JSON.stringify({
          freshProgress: document.querySelector('#optFresh').checked,
          unlockAll: document.querySelector('#optUnlockAll').checked,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      if (body.message !== undefined) { if (body.message) api.toast(body.message, false, 7000); } else api.toast('Campaign launching… Press Start Game to get to the world map.', false, 7000);
    } catch (e) {
      api.toast(e.message, true, 7000);
    } finally {
      btn.disabled = false;
      btn.textContent = '▶ Play campaign';
    }
  }

  async function newCampaign() {
    if (!(await api.confirmDialog('Start a new campaign?', 'Every mission becomes unused, so you can fill missions 1, 2, 3… with your own levels. Unused missions stay hidden in the game. Your level files are not deleted.', 'Start new'))) return;
    missions = {};
    for (const w of WORLDS) for (const slot of slotsOf(w.n)) missions[slot] = slot === FIRST ? { unlocks: [] } : { empty: true };
    render();
  }

  // Download (Share): one JSON file with the mission setup, every level it uses and the
  // unit settings (if tuned).
  async function exportCampaign() {
    const file = await campaignFile();
    if (file) api.downloadFile('my-campaign.wb2campaign.json', file, 'application/json');
  }

  // The campaign as a .wb2campaign.json text; null if it can't be loaded
  // (the browser version without the game files).
  async function campaignFile() {
    if (!loaded) await load();
    if (!loaded) return null;
    const levels = {};
    for (const mm of Object.values(missions)) {
      if (!mm.level) continue;
      const info = await levelInfo(mm.level);
      if (info.text) levels[mm.level] = info.text;
    }
    const cfg = await fetch('/api/config').then((r) => r.json());
    const data = { format: 'wb2-campaign', version: 1, missions, levels, config: cfg.tuned ? cfg.text : null };
    return JSON.stringify(data, null, 2);
  }

  // Returns true when the campaign was imported.
  async function importCampaign(text) {
    if (!loaded) await load();
    if (!loaded) return false;
    let data;
    try { data = JSON.parse(text); } catch (e) { api.toast('That file is not a campaign file.', true); return false; }
    if (!data || data.format !== 'wb2-campaign' || typeof data.missions !== 'object') { api.toast('That file is not a campaign file.', true); return false; }
    if ((Object.keys(missions).length || savedJson !== '{}') &&
      !(await api.confirmDialog('Replace your campaign?', 'The imported campaign replaces your current mission setup. Its levels are added to your levels folder (renamed if a different level already has the same name).', 'Import'))) return false;

    await refreshFiles();
    const rename = {};
    for (const [file, levelText] of Object.entries(data.levels || {})) {
      let name = api.safeFileName(file);
      const existing = files.includes(name) ? await levelInfo(name) : null;
      if (existing && existing.text !== levelText) {
        let k = 2;
        while (files.includes(`${name} ${k}`)) k++;
        name = `${name} ${k}`;
      }
      if (!existing || existing.text !== levelText) {
        await fetch(`/api/custom?file=${encodeURIComponent(name)}`, { method: 'PUT', body: levelText });
        files.push(name);
      }
      rename[file] = name;
      levelCache.delete(name);
    }
    missions = {};
    for (const [slot, mm] of Object.entries(data.missions)) {
      missions[slot] = { ...mm, level: mm.level ? rename[mm.level] || mm.level : undefined };
    }
    if (data.config && await api.confirmDialog('Use its unit settings?', 'This campaign comes with its own unit settings (speeds, recipes, monsters…). Replace yours with them?', 'Use them')) {
      await fetch('/api/config', { method: 'PUT', body: data.config });
      await api.refreshCatalog();
    }
    await refreshFiles();
    await loadAssignedLevels();
    await save();
    api.toast('Campaign imported.');
    return true;
  }

  if (window.wb2 && window.wb2.ready) init();
  else window.addEventListener('wb2:ready', init, { once: true });
})();
