// Gallery tab: browse the levels and campaigns other players shared, open
// them in the editor, and share your own. The server is gallery/worker.js.
(function () {
  'use strict';
  const DEFAULT_SERVER = 'https://wb2-gallery.workers.dev';
  const SITE = 'https://jbrotherman.github.io/worldbuilder2-level-editor/';
  const KEYS = 'wb2-gallery-keys'; // id -> delete key, for things you shared
  const AUTHOR = 'wb2-gallery-author';

  let api, el;
  const query = { type: '', sort: 'new', q: '' };
  let items = [];
  let more = false;
  let busy = false;

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ } },
  };
  // A different server can be set for testing: localStorage['wb2-gallery-server'].
  const server = () => String(store.get('wb2-gallery-server', DEFAULT_SERVER)).replace(/\/$/, '');

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

  function init() {
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

  // ---------------------------------------------------------------- list

  async function refresh(append = false) {
    if (busy) return;
    busy = true;
    const status = document.querySelector('#galleryStatus');
    if (status) status.textContent = 'Loading…';
    try {
      const params = new URLSearchParams({ sort: query.sort, offset: append ? items.length : 0 });
      if (query.type) params.set('type', query.type);
      if (query.q) params.set('q', query.q);
      const res = await call(`/api/items?${params}`);
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
      select(query.type, [['', 'Levels and campaigns'], ['level', 'Levels'], ['campaign', 'Campaigns']], (v) => { query.type = v; refresh(); }, 'Show'),
      select(query.sort, [['new', 'Newest first'], ['popular', 'Most played']], (v) => { query.sort = v; refresh(); }, 'Order'));
    const grid = el('div', { class: 'gallery-grid' }, items.map(card));
    let note = null;
    if (error) note = el('p', { class: 'gallery-note error' }, error, ' ', el('button', { class: 'small', onclick: () => refresh() }, 'Try again'));
    else if (!items.length) note = el('p', { class: 'gallery-note' }, query.q || query.type ? 'Nothing found.' : 'Nothing shared yet. Be the first: share a level with the buttons above.');
    view.replaceChildren(
      el('div', { class: 'page-intro' },
        el('h1', {}, 'Gallery'),
        el('p', { class: 'muted' }, 'Levels and campaigns made by other players. Open one to play it or remix it; share your own with the buttons above or from Share in the Level tab.')),
      head,
      el('p', { id: 'galleryStatus', class: 'muted', role: 'status' }),
      note,
      grid,
      more ? el('div', { class: 'gallery-more' }, el('button', { onclick: () => refresh(true) }, 'Show more')) : null);
    drawThumbs(grid);
  }

  function ago(ms) {
    const days = Math.floor((Date.now() - ms) / 86400e3);
    if (days < 1) return 'today';
    if (days < 2) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    return new Date(ms).toLocaleDateString();
  }

  function card(item) {
    const keys = store.get(KEYS, {});
    const mine = !!keys[item.id];
    const size = item.type === 'level'
      ? `${item.info.width}×${item.info.height}`
      : `${item.info.missions} mission${item.info.missions === 1 ? '' : 's'}${item.info.tunedUnits ? ', own unit settings' : ''}`;
    const thumb = item.type === 'level'
      ? el('canvas', { class: 'gallery-thumb', 'data-id': item.id, 'aria-hidden': 'true' })
      : el('div', { class: 'gallery-thumb campaign', 'aria-hidden': 'true' }, el('span', {}, String(item.info.missions)), 'missions');
    return el('article', { class: 'gallery-card' },
      thumb,
      el('div', { class: 'gallery-body' },
        el('h3', {}, item.title, mine ? el('span', { class: 'gallery-badge' }, 'yours') : null),
        el('div', { class: 'gallery-meta' }, `${item.type === 'level' ? 'Level' : 'Campaign'} by ${item.author} · ${size} · ${ago(item.created)} · ${item.downloads} play${item.downloads === 1 ? '' : 's'}`),
        item.description ? el('p', { class: 'gallery-desc' }, item.description) : null,
        el('div', { class: 'gallery-actions' },
          el('button', { class: 'primary small', onclick: () => openItem(item.id) }, item.type === 'level' ? 'Open in editor' : 'Import campaign'),
          el('button', { class: 'small', title: 'Copy a link to this, to send to someone', onclick: () => copyLink(item) }, 'Copy link'),
          mine
            ? el('button', { class: 'small', onclick: () => remove(item) }, 'Delete')
            : el('button', { class: 'small subtle', title: 'Report spam or something inappropriate', onclick: () => report(item) }, 'Report'))));
  }

  // ---------------------------------------------------------------- previews

  // Average colour of each terrain picture, from the player's own game.
  let terrainColors = null;
  function loadTerrainColors() {
    if (!terrainColors) {
      terrainColors = Promise.all(api.catalog.terrain.map((t) => new Promise((resolve) => {
        const sprite = api.view.terrainSprite(t.name);
        if (!sprite) return resolve([t.char, '#556']);
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = c.height = 8;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(img, 0, 0, 8, 8);
          const px = g.getImageData(0, 0, 8, 8).data;
          let r = 0, gr = 0, b = 0, n = 0;
          for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 128) { r += px[i]; gr += px[i + 1]; b += px[i + 2]; n++; }
          resolve([t.char, n ? `rgb(${Math.round(r / n)},${Math.round(gr / n)},${Math.round(b / n)})` : '#556']);
        };
        img.onerror = () => resolve([t.char, '#556']);
        img.src = api.spriteUrl(sprite);
      }))).then((pairs) => new Map(pairs));
    }
    return terrainColors;
  }

  const ITEM_COLORS = { goal: '#ffcf1a', pile: '#ff9d2e', plan: '#4f9dff', whirlpool: '#9fe8ff', unit: '#ffffff', monster: '#ff5a4f', building: '#c38bff' };

  async function drawThumbs(grid) {
    const colors = await loadTerrainColors();
    for (const canvas of grid.querySelectorAll('canvas.gallery-thumb')) {
      const item = items.find((i) => i.id === canvas.dataset.id);
      if (!item || !item.data) continue;
      const lv = Level.parse(item.data);
      if (!lv.width || !lv.height) continue;
      const cell = Math.max(2, Math.min(8, Math.floor(160 / Math.max(lv.width, lv.height))));
      canvas.width = lv.width * cell;
      canvas.height = lv.height * cell;
      const g = canvas.getContext('2d');
      for (let y = 0; y < lv.height; y++) {
        for (let x = 0; x < lv.width; x++) {
          g.fillStyle = colors.get(lv.terrain[y][x]) || '#556';
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
  }

  // ---------------------------------------------------------------- actions

  async function openItem(id) {
    let item;
    try {
      item = await call(`/api/items/${id}`);
    } catch (e) {
      api.toast(e.message, true, 6000);
      return;
    }
    if (item.type === 'level') {
      if (await api.openLevelText(item.data)) api.toast(`Opened “${item.title}” by ${item.author}. Save it to keep it.`, false, 6000);
    } else if (await api.importCampaign(item.data)) {
      api.showTab('campaign');
    }
  }

  // Links like …/#g=abcd2345 open that item.
  async function openLinkedItem() {
    const m = /^#g=([a-z0-9]{8})$/.exec(location.hash);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    api.showTab('gallery');
    let item;
    try {
      item = await call(`/api/items/${m[1]}`);
    } catch (e) {
      api.toast(e.message, true, 6000);
      return;
    }
    const what = item.type === 'level' ? 'level' : 'campaign';
    if (!(await api.confirmDialog(`Open “${item.title}”?`, `A ${what} by ${item.author} from the gallery.${item.description ? ` ${item.description}` : ''}`, item.type === 'level' ? 'Open in editor' : 'Import campaign'))) return;
    if (item.type === 'level') {
      if (await api.openLevelText(item.data)) api.toast(`Opened “${item.title}”. Save it to keep it.`, false, 6000);
    } else if (await api.importCampaign(item.data)) api.showTab('campaign');
  }

  async function copyLink(item) {
    const link = `${SITE}#g=${item.id}`;
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
      if (await api.confirmDialog('Shared!', `It's in the gallery now. Anyone can open it with this link: ${SITE}#g=${res.id}`, 'Copy link')) {
        copyLink({ id: res.id });
      }
      if (api.tab() === 'gallery') refresh();
    } catch (e) {
      api.toast(e.message, true, 7000);
    }
  }

  if (window.wb2 && window.wb2.ready) init();
  else window.addEventListener('wb2:ready', init, { once: true });
})();
