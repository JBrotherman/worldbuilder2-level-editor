// The editor's API: game catalog and sprites, custom levels, campaign and
// unit settings, and building the game to play. Shared by the local server
// (server.js) and the browser version (web/), so both behave the same.
'use strict';
const fs = require('fs');
const path = require('path');
const game = require('./game');
const catalog = require('./catalog');
const { createSpriteStore } = require('./sprites');
const campaign = require('./campaign');
const wb1 = require('./wb1');
const paths = require('./paths');

const LEVELS_DIR = path.join(paths.ROOT, 'levels');
const SHARED_BUILD_DIR = path.join(paths.ROOT, 'build', 'gallery');

const fail = (status, message) => Object.assign(new Error(message), { status });

// launch(outDir, kind, title): starts or hands over a finished build
// ("level", "campaign", or "shared-level"/"shared-campaign" for
// a gallery item); returns extra
// fields for the response.
function createApi({ launch, log = console }) {
  // The game is loaded on first use, so the editor can start (and explain
  // what to do) when WorldBuilder 2 isn't there yet.
  let loaded = null; // { cat, sprites, spriteInfo, originalConfig }
  let loadError = null;
  function loadGame({ retry = false } = {}) {
    if (loaded || (loadError && !retry)) return loaded;
    loadError = null;
    const status = paths.wb2Status();
    if (!status.found) return null;
    try {
      const cat = catalog.build();
      const sprites = createSpriteStore(cat.game.movie);
      loaded = { cat, sprites, spriteInfo: sprites.info(), originalConfig: game.getText(cat.game, 'config') };
      log.log(`Loaded WorldBuilder 2 from ${path.dirname(status.dcr)}`);
    } catch (e) {
      loadError = `${status.dcr} could not be read as WorldBuilder 2 (${e.message}).`;
      log.error(loadError);
    }
    return loaded;
  }

  function status() {
    return { ...paths.wb2Status(), loaded: !!loaded, loadError, wb1Found: fs.existsSync(paths.wb1Dcr()), root: paths.ROOT };
  }

  // Rebuilt whenever the tuned config changes, so level checks use it.
  let catalogJson = null;
  function getCatalogJson() {
    if (!catalogJson) {
      const { cat, spriteInfo, originalConfig } = loaded;
      const tuned = campaign.loadConfigOverride();
      catalogJson = JSON.stringify({
        config: catalog.parseConfig(tuned != null ? tuned : originalConfig),
        configTuned: tuned != null,
        terrain: cat.terrain,
        levels: cat.levels,
        sprites: spriteInfo,
      });
    }
    return catalogJson;
  }

  function writeBuildOrExplain(fn) {
    try {
      return fn();
    } catch (e) {
      if (e.code === 'EBUSY' || e.code === 'EPERM') throw fail(409, 'The game is still running. Close it and press Play again.');
      throw e;
    }
  }

  // Custom level file names: keep them simple and inside levels/.
  function levelPath(file) {
    if (!/^[\w\- ]{1,64}$/.test(file)) throw fail(400, 'invalid file name');
    return path.join(LEVELS_DIR, file + '.txt');
  }

  // Play one level: the original game (with any unit tuning) and the level in
  // mission 1.1.
  function play({ text, title }) {
    const g = game.load();
    campaign.applyConfig(g);
    campaign.applyLevel(g, text, title);
    const outDir = writeBuildOrExplain(() => game.writeBuild(g));
    return { ok: true, slot: campaign.PLAY_SLOT, ...launch(outDir, 'level') };
  }

  function playCampaign({ freshProgress, unlockAll }) {
    const outDir = writeBuildOrExplain(() => campaign.buildCampaign({ freshProgress: !!freshProgress, unlockAll: !!unlockAll }));
    return { ok: true, ...launch(outDir, 'campaign') };
  }

  const ok = (obj) => ({ status: 200, type: 'application/json', body: JSON.stringify(obj) });
  const text = (body) => ({ status: 200, type: 'text/plain', body });
  const parse = (body) => JSON.parse(body || '{}');

  // One API request; `p` is the path ("/api/catalog", "/sprite/x.png").
  // Returns { status, type, body } or null when the path isn't an API path.
  function route(method, p, query, body) {
    if (p === '/api/catalog') return { status: 200, type: 'application/json', body: getCatalogJson() };
    const { cat, sprites, originalConfig } = loaded || {};

    if (p === '/api/campaign') {
      if (method === 'GET') return ok({ campaign: campaign.loadCampaign(), original: campaign.originals(cat.game) });
      if (method === 'PUT') return ok({ campaign: campaign.saveCampaign(parse(body)) });
    }
    if (p === '/api/campaign/play' && method === 'POST') return ok(playCampaign(parse(body)));

    if (p === '/api/config') {
      if (method === 'GET') {
        const tuned = campaign.loadConfigOverride();
        return ok({ text: tuned != null ? tuned : originalConfig, original: originalConfig, tuned: tuned != null });
      }
      if (method === 'PUT') {
        campaign.saveConfigOverride(body.replace(/\r\n?/g, '\n') === originalConfig ? null : body);
        catalogJson = null;
        return ok({ ok: true });
      }
      if (method === 'DELETE') {
        campaign.saveConfigOverride(null);
        catalogJson = null;
        return ok({ ok: true });
      }
    }

    if (p === '/api/level') {
      const id = query.get('id');
      if (!cat.levels.some((l) => l.id === id)) throw fail(404, 'unknown level');
      if (id.startsWith('wb1:')) return text(wb1.wb1LevelText(id, cat.terrain.map((t) => t.char)));
      return text(game.getText(cat.game, id));
    }

    if (p === '/api/custom' && method === 'GET' && !query.has('file')) {
      fs.mkdirSync(LEVELS_DIR, { recursive: true });
      const files = fs.readdirSync(LEVELS_DIR).filter((f) => f.endsWith('.txt')).map((f) => {
        const st = fs.statSync(path.join(LEVELS_DIR, f));
        return { file: f.slice(0, -4), modified: st.mtimeMs };
      }).sort((a, b) => b.modified - a.modified);
      return ok(files);
    }

    if (p === '/api/custom') {
      const file = levelPath(query.get('file') || '');
      if (method === 'GET') {
        if (!fs.existsSync(file)) throw fail(404, 'not found');
        return text(fs.readFileSync(file, 'latin1'));
      }
      if (method === 'PUT') {
        fs.mkdirSync(LEVELS_DIR, { recursive: true });
        fs.writeFileSync(file, body, 'latin1');
        return ok({ ok: true });
      }
      if (method === 'DELETE') {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        return ok({ ok: true });
      }
    }

    if (p === '/api/play' && method === 'POST') return ok(play(parse(body)));

    // Play a level or campaign from the gallery: { type, title, data }.
    if (p === '/api/shared/play' && method === 'POST') {
      const item = parse(body);
      const outDir = writeBuildOrExplain(() => campaign.buildShared(item, SHARED_BUILD_DIR));
      return ok({ ok: true, ...launch(outDir, item.type === 'level' ? 'shared-level' : 'shared-campaign', item.title) });
    }

    const sprite = /^\/sprite\/(.+)\.png$/.exec(p);
    if (sprite) {
      const img = sprites.render(sprite[1]);
      if (!img) throw fail(404, 'no sprite');
      return { status: 200, type: 'image/png', body: img.png, cache: true };
    }
    return null;
  }

  // Like route(), but errors become JSON error responses. Without the game
  // every API path answers 503.
  // Saved levels (/api/custom) work without the game; everything else needs it.
  function handle(method, p, query, body) {
    if (p !== '/api/custom' && !loadGame()) {
      if (p.startsWith('/api/') || p.startsWith('/sprite/')) {
        return { status: 503, type: 'application/json', body: JSON.stringify({ error: 'WorldBuilder 2 was not found. Reload the editor page to see how to set it up.' }) };
      }
      return null;
    }
    try {
      return route(method, p, query, body);
    } catch (e) {
      return { status: e.status || 500, type: 'application/json', body: JSON.stringify({ error: e.message }) };
    }
  }

  return { loadGame, status, handle, sprites: () => loaded && loaded.sprites };
}

module.exports = { createApi };
