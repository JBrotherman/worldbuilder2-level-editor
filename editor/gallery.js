// The gallery: levels and campaigns other players shared. Runs as the
// editor's Gallery tab, and on its own as gallery.html, which needs no game
// files to browse. Play builds an item into the player's own game; Open
// loads it into the editor. The server is gallery/worker.js.
(function () {
  'use strict';
  const DEFAULT_SERVER = 'https://wb2-gallery.jbrotherman.workers.dev';
  const SITE = 'https://jbrotherman.github.io/worldbuilder2-level-editor/';
  const KEYS = 'wb2-gallery-keys'; // id -> delete key, for things you shared
  const AUTHOR = 'wb2-gallery-author';

  // Preview colours per map character (terrain), and for items on the map.
  const TERRAIN_COLORS = {
    '.': '#3fae5c', _: '#6f9a5a', T: '#1f7a3d', '!': '#1f7a3d', "'": '#1f7a3d', '?': '#2a8a45',
    '%': '#2f9450', '&': '#2f9450', $: '#2f9450', '*': '#2f9450', '#': '#5d7d3c',
    w: '#1fb5e6', x: '#127fb5', r: '#4fc0c8', M: '#8c8577', '^': '#b0503a', '@': '#2a2420',
    ':': '#e6c84a', '`': '#a9b4b8', '~': '#c9a227', '>': '#d0703a', '-': '#4c585e',
    '(': '#5f6e75', '[': '#5f6e75', '{': '#5f6e75', '\\': '#5f6e75', '/': '#5f6e75', ')': '#5f6e75', ']': '#5f6e75', '}': '#5f6e75', '+': '#5f6e75', '=': '#5f6e75',
  };
  const ITEM_COLORS = { goal: '#ffcf1a', pile: '#ff9d2e', plan: '#4f9dff', whirlpool: '#9fe8ff', unit: '#ffffff', monster: '#ff5a4f', building: '#c38bff' };

  let api, el;
  let onPage = false; // gallery.html, rather than the editor's tab
  const query = { type: '', sort: 'created', dir: 'desc', q: '' };
  let items = [];
  let more = false;
  let busy = false;
  let featured = null; // the item a link pointed to (gallery.html#g=…)

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ } },
  };
  // A different server can be set for testing: localStorage['wb2-gallery-server'].
  const server = () => String(store.get('wb2-gallery-server', DEFAULT_SERVER)).replace(/\/$/, '');
  // The gallery is the site's front page.
  const itemLink = (id) => `${SITE}#g=${id}`;

  async function call(path, opts = {}) {
    let res;
    try {
      res = await fetch(server() + path, opts);
    } catch (e) {
      throw new Error('The gallery can\'t be reached right now. Check your internet connection and try again.');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `The gallery answered with an error (${res.status}).`);
    return body;
  }

  // ---------------------------------------------------------------- start

  function initEditor() {
    api = window.wb2;
    el = api.el;
    api.shareToGallery = share;
    document.querySelector('#galleryActions').append(
      el('button', { title: 'Share the level you have open in the Level tab', onclick: () => share('level') }, 'Share my level'),
      el('button', { title: 'Share your campaign (from the Campaign tab)', onclick: () => share('campaign') }, 'Share my campaign'),
    );
    document.querySelector('#btnGalleryShare').addEventListener('click', () => {
      document.querySelector('#dlgShare').close();
      share('level');
    });
    // Reload on every visit, so new items and play counts show.
    window.addEventListener('wb2:tab', (e) => { if (e.detail === 'gallery') refresh(); });
    if (api.tab() === 'gallery') refresh();
    openLinkedItem();
    window.addEventListener('hashchange', openLinkedItem);
  }

  // gallery.html: the same helpers the editor has, for its own markup.
  function initPage() {
    onPage = true;
    el = (tag, attrs = {}, ...children) => {
      const e = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') e.className = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
      }
      for (const c of children.flat()) if (c != null) e.append(c);
      return e;
    };
    const toast = (msg, isError = false, ms = 4000) => {
      const t = document.querySelector('#toast');
      t.textContent = msg;
      t.className = 'toast' + (isError ? ' error' : '');
      t.hidden = false;
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => { t.hidden = true; }, ms);
    };
    const confirmDialog = (title, text, okLabel = 'OK') => {
      const d = document.querySelector('#dlgConfirm');
      document.querySelector('#confirmTitle').textContent = title;
      document.querySelector('#confirmText').textContent = text;
      document.querySelector('#confirmOk').textContent = okLabel;
      d.returnValue = '';
      d.showModal();
      return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
    };
    api = { el, toast, confirmDialog, tab: () => 'gallery' };
    const m = /^#g=([a-z0-9]{8})$/.exec(location.hash);
    if (m) featured = m[1];
    refresh();
  }

  // ---------------------------------------------------------------- list

  async function refresh(append = false) {
    if (busy) return;
    busy = true;
    const status = document.querySelector('#galleryStatus');
    if (status) status.textContent = 'Loading…';
    try {
      const params = new URLSearchParams({ sort: query.sort, dir: query.dir, offset: append ? items.length : 0 });
      if (query.type) params.set('type', query.type);
      if (query.q) params.set('q', query.q);
      const [res, linked] = await Promise.all([
        call(`/api/items?${params}`),
        typeof featured === 'string' ? call(`/api/items/${featured}?peek`).catch(() => null) : null,
      ]);
      if (typeof featured === 'string') featured = linked;
      items = append ? items.concat(res.items) : res.items;
      more = res.more;
      render();
    } catch (e) {
      render(e.message);
    } finally {
      busy = false;
    }
  }

  function render(error) {
    const view = document.querySelector('#galleryView');
    const search = el('input', { type: 'search', placeholder: 'Search titles, makers and descriptions', value: query.q, 'aria-label': 'Search the gallery' });
    let timer;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { query.q = search.value.trim(); refresh(); }, 350);
    });
    const select = (value, options, onchange, label) => {
      const s = el('select', { 'aria-label': label, onchange: () => onchange(s.value) }, options.map(([v, t]) => el('option', { value: v, selected: v === value }, t)));
      return s;
    };
    const head = el('div', { class: 'gallery-head' },
      search,
      select(query.type, [['', 'Levels and campaigns'], ['level', 'Levels'], ['campaign', 'Campaigns']], (v) => { query.type = v; refresh(); }, 'Show'));
    const list = featured ? items.filter((i) => i.id !== featured.id) : items;
    let note = null;
    if (error) note = el('p', { class: 'gallery-note error' }, error, ' ', el('button', { class: 'small', onclick: () => refresh() }, 'Try again'));
    else if (!items.length) note = el('p', { class: 'gallery-note' }, query.q || query.type ? 'Nothing found.' : 'Nothing shared yet.');
    const intro = onPage
      ? el('div', { class: 'page-intro' },
        el('h1', {}, 'WorldBuilder 2 Gallery'),
        el('p', { class: 'muted' }, 'Levels and campaigns made by other players. Press Play to play one in your own copy of LEGO WorldBuilder 2, or open it in the ',
          el('a', { href: 'editor.html' }, 'editor'), ' to change it or make your own.'),
        guide())
      : el('div', { class: 'page-intro' },
        el('h1', {}, 'Gallery'),
        el('p', { class: 'muted' }, 'Levels and campaigns made by other players. Play one, or open it here to play with it; share your own with the buttons above or from Share in the Level tab.'));
    const parts = [
      intro,
      featured ? el('section', { class: 'gallery-featured' }, el('h2', {}, 'Shared with you'), table([featured], { sortable: false })) : null,
      head,
      el('p', { id: 'galleryStatus', class: 'muted', role: 'status' }),
      note,
      list.length ? table(list, { sortable: true }) : null,
      more ? el('div', { class: 'gallery-more' }, el('button', { onclick: () => refresh(true) }, 'Show more')) : null,
    ];
    view.replaceChildren(...parts.filter(Boolean));
    for (const canvas of view.querySelectorAll('canvas.gallery-thumb')) drawThumb(canvas);
  }

  // Table columns; those with a key can be sorted on (by the server).
  const COLUMNS = [
    { cls: 'col-thumb', label: 'Preview', hidden: true },
    { cls: 'col-name', label: 'Name', key: 'title' },
    { cls: 'col-type', label: 'Type', key: 'type' },
    { cls: 'col-num', label: 'Missions', key: 'missions' },
    { cls: 'col-author', label: 'Creator', key: 'author' },
    { cls: 'col-num', label: 'Plays', key: 'downloads' },
    { cls: 'col-date', label: 'Added', key: 'created' },
    { cls: 'col-actions', label: 'Actions', hidden: true },
  ];
  const defaultDir = (key) => (['title', 'author', 'type'].includes(key) ? 'asc' : 'desc');

  function table(list, { sortable }) {
    const th = (c) => {
      if (c.hidden) return el('th', { class: c.cls, scope: 'col' }, el('span', { class: 'sr-only' }, c.label));
      if (!sortable) return el('th', { class: c.cls, scope: 'col' }, c.label);
      const active = query.sort === c.key;
      const sortBy = () => {
        if (active) query.dir = query.dir === 'asc' ? 'desc' : 'asc';
        else { query.sort = c.key; query.dir = defaultDir(c.key); }
        refresh();
      };
      return el('th', { class: c.cls, scope: 'col', 'aria-sort': active ? (query.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
        el('button', { class: 'sort' + (active ? ' active' : ''), title: `Sort by ${c.label.toLowerCase()}`, onclick: sortBy },
          c.label, el('span', { class: 'arrow', 'aria-hidden': 'true' }, active ? (query.dir === 'asc' ? '▲' : '▼') : '↕')));
    };
    return el('div', { class: 'gallery-table-wrap' },
      el('table', { class: 'gallery-table' },
        el('thead', {}, el('tr', {}, COLUMNS.map(th))),
        el('tbody', {}, list.map(row))));
  }

  // gallery.html: how playing works, for people new to it. Can be hidden.
  function guide() {
    const GUIDE_HIDDEN = 'wb2-gallery-guide-hidden';
    if (store.get(GUIDE_HIDDEN, false)) {
      return el('p', {}, el('button', { class: 'link', onclick: () => { store.set(GUIDE_HIDDEN, false); render(); } }, 'How do I play these?'));
    }
    return el('section', { class: 'gallery-guide', 'aria-label': 'How to play' },
      el('div', { class: 'gallery-guide-head' },
        el('h2', {}, 'New here? Playing takes three steps'),
        el('button', { class: 'small', onclick: () => { store.set(GUIDE_HIDDEN, true); render(); } }, 'Got it')),
      el('ol', {},
        el('li', {}, el('strong', {}, 'Have LEGO WorldBuilder 2'), ' on your Windows PC: a folder called WorldBuilder2, or the zip it came in. Nothing to install.'),
        el('li', {}, el('strong', {}, 'Press ▶ Play'), ' on a level or campaign and show it where your game is. The first time only.'),
        el('li', {}, el('strong', {}, 'Open the new “WorldBuilder2 - …” folder'), ' next to your game and double-click Launcher.exe.')),
      window.WB2_GALLERY_HOST.gameHelp());
  }

  function ago(ms) {
    const days = Math.floor((Date.now() - ms) / 86400e3);
    if (days < 1) return 'today';
    if (days < 2) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    return new Date(ms).toLocaleDateString();
  }

  function row(item) {
    const mine = !!store.get(KEYS, {})[item.id];
    const isLevel = item.type === 'level';
    const thumb = isLevel
      ? el('canvas', { class: 'gallery-thumb', 'aria-hidden': 'true' })
      : el('div', { class: 'gallery-thumb campaign', 'aria-hidden': 'true' }, String(item.info.missions || ''));
    if (isLevel) thumb.item = item;
    // "⋯" menu with the less common actions.
    const menu = el('details', { class: 'row-menu' });
    const menuItem = (label, title, fn) => el('button', { type: 'button', title, onclick: () => { menu.open = false; fn(); } }, label);
    menu.addEventListener('toggle', () => { if (menu.open) placeMenu(menu); });
    menu.append(
      el('summary', { title: 'More', 'aria-label': `More for ${item.title}` }, '⋯'),
      el('div', { class: 'row-menu-items' },
        menuItem(isLevel ? 'Open in editor' : 'Import into editor', isLevel ? 'Open it in the editor to look at it or change it' : 'Use it as your campaign in the editor', () => openItem(item)),
        menuItem('Copy link', 'Copy a link to this, to send to someone', () => copyLink(item)),
        mine ? menuItem('Delete from gallery', 'Remove what you shared', () => remove(item))
          : menuItem('Report', 'Report spam or something inappropriate', () => report(item))));
    const type = isLevel
      ? `Level · ${item.info.width}×${item.info.height}`
      : `Campaign${item.info.tunedUnits ? ' · own units' : ''}`;
    return el('tr', {},
      el('td', { class: 'col-thumb' }, thumb),
      el('td', { class: 'col-name' },
        el('div', { class: 'gallery-name' }, item.title, mine ? el('span', { class: 'gallery-badge' }, 'yours') : null),
        item.description ? el('div', { class: 'gallery-desc', title: item.description }, item.description) : null),
      el('td', { class: 'col-type' }, type),
      el('td', { class: 'col-num', 'data-label': 'Missions' }, String(isLevel ? 1 : item.info.missions || 0)),
      el('td', { class: 'col-author', 'data-label': 'By' }, item.author),
      el('td', { class: 'col-num', 'data-label': 'Plays' }, String(item.downloads || 0)),
      el('td', { class: 'col-date', title: new Date(item.created).toLocaleString() }, ago(item.created)),
      el('td', { class: 'col-actions' },
        el('button', { class: 'primary small', title: 'Play it in your own copy of WorldBuilder 2', onclick: () => playItem(item) }, '▶ Play'),
        menu));
  }

  // The "⋯" menu floats above the page (the table and the scrolling page
  // would cut it off), under its button, or above it near the bottom.
  function placeMenu(menu) {
    for (const m of document.querySelectorAll('.row-menu[open]')) if (m !== menu) m.open = false;
    const items = menu.querySelector('.row-menu-items');
    const button = menu.querySelector('summary').getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = items;
    const below = button.bottom + 4 + h <= window.innerHeight - 8;
    items.style.top = `${below ? button.bottom + 4 : Math.max(8, button.top - 4 - h)}px`;
    items.style.left = `${Math.max(8, Math.min(button.right - w, window.innerWidth - w - 8))}px`;
  }

  // Close "⋯" menus when clicking elsewhere, scrolling or resizing.
  const closeMenus = (except) => {
    for (const m of document.querySelectorAll('.row-menu[open]')) if (!except || !m.contains(except)) m.open = false;
  };
  document.addEventListener('click', (e) => closeMenus(e.target));
  document.addEventListener('scroll', () => closeMenus(), true);
  window.addEventListener('resize', () => closeMenus());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

  // A little map of a level.
  function drawThumb(canvas) {
    const item = canvas.item;
    if (!item || !item.data) return;
    const lv = Level.parse(item.data);
    if (!lv.width || !lv.height) return;
    const cell = Math.max(2, Math.min(8, Math.floor(160 / Math.max(lv.width, lv.height))));
    canvas.width = lv.width * cell;
    canvas.height = lv.height * cell;
    const g = canvas.getContext('2d');
    for (let y = 0; y < lv.height; y++) {
      for (let x = 0; x < lv.width; x++) {
        g.fillStyle = TERRAIN_COLORS[lv.terrain[y][x]] || '#556';
        g.fillRect(x * cell, y * cell, cell, cell);
        const it = lv.items[y][x];
        if (it) {
          g.fillStyle = ITEM_COLORS[it.kind === 'unit' && ITEM_COLORS[it.cat] ? it.cat : it.kind] || '#fff';
          const m = Math.max(1, Math.floor(cell / 4));
          g.fillRect(x * cell + m, y * cell + m, cell - 2 * m, cell - 2 * m);
        }
      }
    }
  }

  // ---------------------------------------------------------------- actions

  // Fetches the whole item; this counts as a play.
  async function fetchItem(id) {
    try {
      return await call(`/api/items/${id}`);
    } catch (e) {
      api.toast(e.message, true, 6000);
      return null;
    }
  }

  async function playItem(summary) {
    const item = await fetchItem(summary.id);
    if (!item) return;
    if (onPage) {
      await window.WB2_GALLERY_HOST.play(item);
      return;
    }
    // The editor's API: the browser version shows its own Play dialog, the
    // local version starts the game.
    try {
      const res = await fetch('/api/shared/play', { method: 'POST', body: JSON.stringify({ type: item.type, title: item.title, data: item.data }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      if (body.message === undefined) api.toast('Game launching… Press Start Game to get to the world map.', false, 7000);
    } catch (e) {
      api.toast(e.message, true, 7000);
    }
  }

  async function openItem(summary) {
    if (onPage) {
      // The editor opens it (after setting up the game files, if needed).
      location.href = `editor.html#g=${summary.id}`;
      return;
    }
    const item = await fetchItem(summary.id);
    if (!item) return;
    if (item.type === 'level') {
      if (await api.openLevelText(item.data)) api.toast(`Opened “${item.title}” by ${item.author}. Save it to keep it.`, false, 6000);
    } else if (await api.importCampaign(item.data)) {
      api.showTab('campaign');
    }
  }

  // In the editor, links like …/editor.html#g=abcd2345 open that item.
  async function openLinkedItem() {
    const m = /^#g=([a-z0-9]{8})$/.exec(location.hash);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    api.showTab('gallery');
    const item = await fetchItem(m[1]);
    if (!item) return;
    const what = item.type === 'level' ? 'level' : 'campaign';
    if (!(await api.confirmDialog(`Open “${item.title}”?`, `A ${what} by ${item.author} from the gallery.${item.description ? ` ${item.description}` : ''}`, item.type === 'level' ? 'Open in editor' : 'Import campaign'))) return;
    if (item.type === 'level') {
      if (await api.openLevelText(item.data)) api.toast(`Opened “${item.title}”. Save it to keep it.`, false, 6000);
    } else if (await api.importCampaign(item.data)) api.showTab('campaign');
  }

  async function copyLink(item) {
    const link = itemLink(item.id);
    try {
      await navigator.clipboard.writeText(link);
      api.toast('Link copied.');
    } catch (e) {
      api.toast(link, false, 10000);
    }
  }

  async function report(item) {
    if (!(await api.confirmDialog('Report this?', `Report “${item.title}” as spam or inappropriate? Things several people report are hidden.`, 'Report'))) return;
    try {
      await call(`/api/items/${item.id}/report`, { method: 'POST' });
      api.toast('Thanks, reported.');
    } catch (e) {
      api.toast(e.message, true);
    }
  }

  async function remove(item) {
    if (!(await api.confirmDialog('Delete from the gallery?', `“${item.title}” will be removed from the gallery for everyone. Your own copy stays.`, 'Delete'))) return;
    const keys = store.get(KEYS, {});
    try {
      await call(`/api/items/${item.id}`, { method: 'DELETE', headers: { 'X-Delete-Key': keys[item.id] } });
      delete keys[item.id];
      store.set(KEYS, keys);
      items = items.filter((i) => i.id !== item.id);
      if (featured && featured.id === item.id) featured = null;
      render();
      api.toast('Deleted from the gallery.');
    } catch (e) {
      api.toast(e.message, true);
    }
  }

  // ---------------------------------------------------------------- share

  async function share(type) {
    let data, title;
    if (type === 'level') {
      const errors = (api.state.problems || []).filter((p) => p.severity === 'error');
      if (errors.length && !(await api.confirmDialog('Share anyway?', `This level has ${errors.length} error(s): ${errors[0].message} Others may not be able to finish it.`, 'Share anyway'))) return;
      data = api.levelText();
      title = api.state.level.meta.title || api.state.level.name || '';
    } else {
      data = await api.campaignFile();
      if (!data) return;
      title = '';
      const missions = Object.values(JSON.parse(data).missions || {}).filter((m) => m && m.level).length;
      if (!missions) {
        api.toast('Your campaign doesn\'t use any of your own levels yet. Choose levels for its missions in the Campaign tab first.', true, 7000);
        return;
      }
    }
    const d = document.querySelector('#dlgGalleryShare');
    const form = d.querySelector('form');
    d.querySelector('h2').textContent = type === 'level' ? 'Share this level in the gallery' : 'Share your campaign in the gallery';
    form.elements.title.value = title.slice(0, 60);
    form.elements.author.value = store.get(AUTHOR, '');
    form.elements.description.value = '';
    form.elements.own.checked = false;
    if ((await api.openDialog(d)) !== 'ok') return;
    const author = form.elements.author.value.trim();
    store.set(AUTHOR, author);
    try {
      const res = await call('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, title: form.elements.title.value, author, description: form.elements.description.value, data }),
      });
      const keys = store.get(KEYS, {});
      keys[res.id] = res.deleteKey;
      store.set(KEYS, keys);
      if (await api.confirmDialog('Shared!', `It's in the gallery now. Anyone can see and play it with this link: ${itemLink(res.id)}`, 'Copy link')) {
        copyLink({ id: res.id });
      }
      if (api.tab() === 'gallery') refresh();
    } catch (e) {
      api.toast(e.message, true, 7000);
    }
  }

  if (window.WB2_GALLERY_HOST) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPage, { once: true });
    else initPage();
  } else if (window.wb2 && window.wb2.ready) initEditor();
  else window.addEventListener('wb2:ready', initEditor, { once: true });
})();
