#!/usr/bin/env node
// Tests the gallery Worker against a fresh in-memory database:
// node gallery/test.js
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..');
const PORT = 8791;
const BASE = `http://localhost:${PORT}`;
const ORIGIN = 'https://jbrotherman.github.io';

const server = spawn(process.execPath, [path.join(DIR, 'dev-server.js'), String(PORT), '--memory'], { env: { ...process.env, ADMIN_TOKEN: 'admin-secret' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve) => server.stdout.once('data', resolve));

let failures = 0;
function check(ok, what) {
  if (ok) console.log(`ok    ${what}`);
  else { failures++; console.log(`FAIL  ${what}`); }
}
async function call(method, p, { body, ip = '1.1.1.1', headers = {} } = {}) {
  const res = await fetch(BASE + p, { method, body: body && JSON.stringify(body), headers: { Origin: ORIGIN, 'X-Test-IP': ip, ...headers } });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}

const levelText = fs.readFileSync(path.join(ROOT, 'levels', 'Brickwood 01 First Bricks.txt'), 'latin1');
try {
  const up = await call('POST', '/api/items', { body: { type: 'level', title: 'First Bricks', author: 'Tester', description: 'A gentle start.\nTwo lines.', data: levelText } });
  check(up.status === 201 && /^[a-z0-9]{8}$/.test(up.body.id) && up.body.deleteKey, 'share a level');
  check(up.headers.get('access-control-allow-origin') === ORIGIN, 'answers the editor site (CORS)');

  const listed = await call('GET', '/api/items');
  const item = listed.body.items[0];
  check(listed.body.items.length === 1 && item.title === 'First Bricks' && item.data === levelText && item.info.width > 0, 'list includes it, with the level and its size');
  check(item.description === 'A gentle start.\nTwo lines.' && !('delete_hash' in item) && !('ip_hash' in item), 'keeps line breaks, hides secrets');

  const got = await call('GET', `/api/items/${up.body.id}`);
  check(got.body.data === levelText && got.body.downloads === 1, 'open it (counts a download)');
  check((await call('GET', '/api/items?sort=popular')).body.items[0].downloads === 1, 'popular sort sees the download');
  check((await call('GET', '/api/items?q=gentle')).body.items.length === 1 && (await call('GET', '/api/items?q=nothing%25')).body.items.length === 0, 'search');
  check((await call('GET', '/api/items?type=campaign')).body.items.length === 0, 'filter by type');

  const bad = [
    [{ type: 'level', title: 'x', data: 'hello' }, 'reject a non-level'],
    [{ type: 'level', title: '', data: levelText }, 'require a title'],
    [{ type: 'level', title: 'x', data: '[map]\n map=' + '.'.repeat(30000) }, 'reject a huge level'],
    [{ type: 'campaign', title: 'x', data: '{"format":"other"}' }, 'reject a non-campaign'],
    [{ type: 'virus', title: 'x', data: levelText }, 'reject unknown types'],
  ];
  for (const [body, what] of bad) check((await call('POST', '/api/items', { body, ip: '9.9.9.9' })).status === 400, what);

  // A campaign, as the editor's Export makes it.
  const missions = JSON.parse(fs.readFileSync(path.join(ROOT, 'campaign', 'campaign.json'), 'utf8')).missions;
  const levels = {};
  for (const m of Object.values(missions)) if (m.level) levels[m.level] = fs.readFileSync(path.join(ROOT, 'levels', `${m.level}.txt`), 'latin1');
  const campaign = JSON.stringify({ format: 'wb2-campaign', version: 1, missions, levels, config: null });
  const cup = await call('POST', '/api/items', { body: { type: 'campaign', title: 'Both campaigns', author: 'Tester', data: campaign } });
  check(cup.status === 201, `share a campaign (${(campaign.length / 1024).toFixed(0)} KB)`);
  const clist = (await call('GET', '/api/items?type=campaign')).body.items[0];
  check(clist && clist.info.missions === 24 && !('data' in clist), 'campaign list shows 24 missions, without the file');
  check((await call('GET', `/api/items/${cup.body.id}`)).body.data === campaign, 'open the campaign');

  check((await call('DELETE', `/api/items/${up.body.id}`, { headers: { 'X-Delete-Key': 'wrong' } })).status === 403, 'wrong delete key is refused');
  check((await call('DELETE', `/api/items/${up.body.id}`, { headers: { 'X-Delete-Key': up.body.deleteKey } })).status === 200, 'uploader deletes with their key');
  check((await call('GET', `/api/items/${up.body.id}`)).status === 404, 'deleted item is gone');
  check((await call('DELETE', `/api/items/${cup.body.id}`, { headers: { Authorization: 'Bearer admin-secret' } })).status === 200, 'admin can delete anything');

  // Reports: hidden after 5 different people report it.
  const r = await call('POST', '/api/items', { body: { type: 'level', title: 'Spam', data: levelText }, ip: '2.2.2.2' });
  for (let i = 0; i < 4; i++) await call('POST', `/api/items/${r.body.id}/report`, { ip: `3.3.3.${i}` });
  await call('POST', `/api/items/${r.body.id}/report`, { ip: '3.3.3.0' }); // same person twice counts once
  check((await call('GET', '/api/items')).body.items.some((x) => x.id === r.body.id), 'still listed after 4 reports');
  await call('POST', `/api/items/${r.body.id}/report`, { ip: '3.3.3.9' });
  check(!(await call('GET', '/api/items')).body.items.some((x) => x.id === r.body.id), 'hidden after 5 reports');

  // Rate limit: 10 uploads per hour per IP.
  let lastStatus;
  for (let i = 0; i < 11; i++) lastStatus = (await call('POST', '/api/items', { body: { type: 'level', title: `L${i}`, data: levelText }, ip: '4.4.4.4' })).status;
  check(lastStatus === 429, 'the 11th upload in an hour is refused');
  check((await call('POST', '/api/items', { body: { type: 'level', title: 'other', data: levelText }, ip: '5.5.5.5' })).status === 201, 'others can still share');

  const pre = await fetch(BASE + '/api/items', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  check(!pre.headers.get('access-control-allow-origin'), 'other websites get no CORS access');
  const page = await call('GET', '/api/items?offset=0');
  check(page.body.items.length <= 24, 'pages of at most 24');
} finally {
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
