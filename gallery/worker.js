// The level gallery: a Cloudflare Worker with a D1 database (schema.sql).
// Players share levels and campaigns from the editor and browse, open and
// import other people's. No accounts: each upload gets a secret delete key
// (kept by the uploader's browser), uploads are rate limited per IP (stored
// only as a salted hash), and items with several reports are hidden.
//
//   GET    /api/items?type=level|campaign&sort=created|downloads|title|author|type|missions&dir=asc|desc&q=…&offset=0
//   GET    /api/items/:id          (counts as a download, unless ?peek)
//   POST   /api/items              { type, title, author, description, data }
//   DELETE /api/items/:id          X-Delete-Key, or Authorization: Bearer ADMIN_TOKEN
//   POST   /api/items/:id/report

const PAGE = 24;
const LIMITS = { title: 60, author: 40, description: 600, level: 20000, campaign: 400000, config: 100000 };
const UPLOADS_PER_HOUR = 10; // per IP
const UPLOADS_PER_DAY = 500; // for everyone together
const HIDE_AFTER_REPORTS = 5;
const ALLOWED_ORIGINS = [/^https:\/\/jbrotherman\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function cors(request) {
  const origin = request.headers.get('Origin') || '';
  if (!ALLOWED_ORIGINS.some((re) => re.test(origin))) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Delete-Key, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (request, body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(request) },
});

async function sha256(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomId(length) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(length))].map((b) => alphabet[b % alphabet.length]).join('');
}

// One line of plain text, without control characters.
function cleanText(value, max, { multiline = false } = {}) {
  let s = String(value == null ? '' : value).replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, ' ');
  s = s.replace(multiline ? /[ \t]+/g : /\s+/g, ' ').trim();
  return s.slice(0, max);
}

// Checks a level file and summarises it: map size and its own title.
function levelInfo(text) {
  if (typeof text !== 'string' || text.length > LIMITS.level) throw new HttpError(400, 'The level is missing or too big.');
  const rows = text.split(/\r?\n|\r/).filter((l) => /^\s*map=/.test(l)).map((l) => l.replace(/^\s*map=/, ''));
  if (!/^\s*\[map\]/m.test(text) || !rows.length) throw new HttpError(400, 'That is not a WorldBuilder 2 level.');
  const name = /^\s*name=(.*)$/m.exec(text);
  return { width: Math.max(...rows.map((r) => r.length)), height: rows.length, name: name ? cleanText(name[1], 60) : '' };
}

function campaignInfo(text) {
  if (typeof text !== 'string' || text.length > LIMITS.campaign) throw new HttpError(400, 'The campaign is missing or too big.');
  let c;
  try { c = JSON.parse(text); } catch (e) { throw new HttpError(400, 'That is not a campaign file.'); }
  if (!c || c.format !== 'wb2-campaign' || typeof c.missions !== 'object' || !c.missions) throw new HttpError(400, 'That is not a campaign file.');
  const levels = c.levels && typeof c.levels === 'object' ? Object.values(c.levels) : [];
  for (const l of levels) levelInfo(l);
  if (c.config != null && (typeof c.config !== 'string' || c.config.length > LIMITS.config)) throw new HttpError(400, 'The unit settings in that campaign are too big.');
  const missions = Object.values(c.missions).filter((m) => m && m.level).length;
  return { missions, levels: levels.length, tunedUnits: c.config != null };
}

const publicItem = (row, withData) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  author: row.author,
  description: row.description,
  info: JSON.parse(row.info || '{}'),
  created: row.created,
  downloads: row.downloads,
  ...(withData ? { data: row.data } : {}),
});

// Columns the list can be sorted on (sort=…&dir=asc|desc). Levels count as
// one mission. "new" and "popular" are older names for created/downloads.
const SORTS = {
  created: 'created',
  downloads: 'downloads',
  title: 'title COLLATE NOCASE',
  author: 'author COLLATE NOCASE',
  type: 'type',
  missions: "COALESCE(json_extract(info, '$.missions'), 1)",
};

async function list(env, url) {
  const type = url.searchParams.get('type');
  let key = url.searchParams.get('sort');
  key = key === 'new' ? 'created' : key === 'popular' ? 'downloads' : key;
  if (!SORTS[key]) key = 'created';
  const dirParam = url.searchParams.get('dir');
  const dir = dirParam === 'asc' || dirParam === 'desc' ? dirParam : ['title', 'author', 'type'].includes(key) ? 'asc' : 'desc';
  const sort = `${SORTS[key]} ${dir.toUpperCase()}, created DESC`;
  const q = cleanText(url.searchParams.get('q'), 60);
  const offset = Math.max(0, Math.min(10000, Number(url.searchParams.get('offset')) || 0));
  const where = ['reports < ?'];
  const args = [HIDE_AFTER_REPORTS];
  if (type === 'level' || type === 'campaign') { where.push('type = ?'); args.push(type); }
  if (q) {
    where.push("(title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    args.push(like, like, like);
  }
  const { results } = await env.DB.prepare(`SELECT * FROM items WHERE ${where.join(' AND ')} ORDER BY ${sort} LIMIT ? OFFSET ?`)
    .bind(...args, PAGE + 1, offset).all();
  // Levels are small, so the list includes them (for previews); campaigns
  // are fetched when opened.
  return { items: results.slice(0, PAGE).map((r) => publicItem(r, r.type === 'level')), more: results.length > PAGE };
}

async function create(env, request, ipHash) {
  if (Number(request.headers.get('Content-Length') || 0) > LIMITS.campaign + 10000) throw new HttpError(413, 'That is too big to share.');
  let body;
  try { body = JSON.parse(await request.text()); } catch (e) { throw new HttpError(400, 'Invalid request.'); }
  const type = body && body.type;
  if (type !== 'level' && type !== 'campaign') throw new HttpError(400, 'Choose a level or a campaign.');
  const info = type === 'level' ? levelInfo(body.data) : campaignInfo(body.data);
  const title = cleanText(body.title, LIMITS.title);
  if (!title) throw new HttpError(400, 'Give it a title.');
  const author = cleanText(body.author, LIMITS.author) || 'Anonymous';
  const description = cleanText(body.description, LIMITS.description, { multiline: true });

  const now = Date.now();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM items WHERE ip_hash = ? AND created > ?').bind(ipHash, now - 3600e3).first();
  if (recent.n >= UPLOADS_PER_HOUR) throw new HttpError(429, 'You have shared a lot in the last hour. Please try again later.');
  const today = await env.DB.prepare('SELECT COUNT(*) AS n FROM items WHERE created > ?').bind(now - 86400e3).first();
  if (today.n >= UPLOADS_PER_DAY) throw new HttpError(429, 'The gallery has had a very busy day. Please try again tomorrow.');

  const id = randomId(8);
  const deleteKey = randomId(24);
  await env.DB.prepare('INSERT INTO items (id, type, title, author, description, data, info, created, delete_hash, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, type, title, author, description, body.data, JSON.stringify(info), now, await sha256(deleteKey), ipHash).run();
  return { id, deleteKey };
}

// Counts as a download, unless ?peek (just showing it, e.g. for a link).
async function get(env, id, peek) {
  const row = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  if (!row || row.reports >= HIDE_AFTER_REPORTS) throw new HttpError(404, 'That is no longer in the gallery.');
  if (peek) return publicItem(row, true);
  await env.DB.prepare('UPDATE items SET downloads = downloads + 1 WHERE id = ?').bind(id).run();
  return publicItem({ ...row, downloads: row.downloads + 1 }, true);
}

async function remove(env, request, id) {
  const row = await env.DB.prepare('SELECT delete_hash FROM items WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Not found.');
  const auth = request.headers.get('Authorization') || '';
  const isAdmin = env.ADMIN_TOKEN && auth === `Bearer ${env.ADMIN_TOKEN}`;
  const key = request.headers.get('X-Delete-Key') || '';
  if (!isAdmin && (!key || (await sha256(key)) !== row.delete_hash)) throw new HttpError(403, 'Only the person who shared this can delete it.');
  await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM reports WHERE item_id = ?').bind(id).run();
  return { ok: true };
}

async function report(env, id, ipHash) {
  const row = await env.DB.prepare('SELECT id FROM items WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Not found.');
  await env.DB.prepare('INSERT OR IGNORE INTO reports (item_id, ip_hash) VALUES (?, ?)').bind(id, ipHash).run();
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE item_id = ?').bind(id).first();
  await env.DB.prepare('UPDATE items SET reports = ? WHERE id = ?').bind(n, id).run();
  return { ok: true };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
    try {
      const ipHash = await sha256(`${env.IP_SALT || 'wb2-gallery'}:${request.headers.get('CF-Connecting-IP') || 'local'}`);
      const m = /^\/api\/items(?:\/([a-z0-9]{8})(\/report)?)?$/.exec(url.pathname);
      if (!m) {
        if (url.pathname === '/') return new Response('WorldBuilder 2 level gallery. Open it from the editor: https://jbrotherman.github.io/worldbuilder2-level-editor/\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        throw new HttpError(404, 'Not found.');
      }
      const [, id, isReport] = m;
      if (!id && request.method === 'GET') return json(request, await list(env, url));
      if (!id && request.method === 'POST') return json(request, await create(env, request, ipHash), 201);
      if (id && isReport && request.method === 'POST') return json(request, await report(env, id, ipHash));
      if (id && !isReport && request.method === 'GET') return json(request, await get(env, id, url.searchParams.has('peek')));
      if (id && !isReport && request.method === 'DELETE') return json(request, await remove(env, request, id));
      throw new HttpError(405, 'Method not allowed.');
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      return json(request, { error: e instanceof HttpError ? e.message : 'Something went wrong in the gallery.' }, e.status || 500);
    }
  },
};
