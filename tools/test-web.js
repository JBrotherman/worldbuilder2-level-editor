#!/usr/bin/env node
// Checks the browser version against the local version: runs the bundled
// tools with the browser stand-ins for fs/path/zlib/Buffer (web/node/) in an
// isolated context, next to the real tools in Node, and compares the API's
// answers, the sprites and the games they build. Needs the game files.
// Usage: node tools/test-web.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const ab = require('./afterburner');
const paths = require('./paths');
const { collect } = require('./build-web');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(ok, what) {
  if (ok) console.log(`ok    ${what}`);
  else { failures++; console.log(`FAIL  ${what}`); }
}

// ---- the browser version, in a context without Node's modules
function loadBrowserTools() {
  const modules = new Map([...collect('tools/api.js'), ...collect('tools/zip.js')]);
  const context = vm.createContext({ console, TextEncoder, TextDecoder, atob, btoa, URLSearchParams, Date, Math, JSON });
  const cache = {};
  function load(id) {
    if (cache[id]) return cache[id].exports;
    const { source, deps } = modules.get(id);
    const module = { exports: {} };
    cache[id] = module;
    const fn = vm.compileFunction(source, ['require', 'module', 'exports', '__filename', '__dirname'], { parsingContext: context, filename: id });
    fn.call(module.exports, (name) => load(deps[name]), module, module.exports, '/wb2/' + id, '/wb2/' + path.posix.dirname(id));
    return module.exports;
  }
  context.Buffer = load('web/node/buffer.js').Buffer;
  return { load, Buffer: context.Buffer };
}

const web = loadBrowserTools();
const vfs = web.load('web/node/fs.js');
const toWeb = (buf) => web.Buffer.from(buf);
const toNode = (buf) => Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);

// Same game, levels and campaign as the local version.
const wb2Dir = paths.wb2Dir();
for (const rel of fs.readdirSync(wb2Dir, { recursive: true })) {
  const full = path.join(wb2Dir, rel);
  if (fs.statSync(full).isFile()) vfs.mount('/wb2/WorldBuilder2/worldbuilder2/' + rel.split(path.sep).join('/'), toWeb(fs.readFileSync(full)));
}
if (fs.existsSync(paths.wb1Dcr())) vfs.mount('/wb2/WorldBuilder/worldbuilder/worldbuilder.dcr', toWeb(fs.readFileSync(paths.wb1Dcr())));
for (const dir of ['levels', 'campaign']) {
  for (const name of fs.readdirSync(path.join(ROOT, dir))) {
    const full = path.join(ROOT, dir, name);
    if (fs.statSync(full).isFile()) vfs.mount(`/wb2/${dir}/${name}`, toWeb(fs.readFileSync(full)), fs.statSync(full).mtimeMs);
  }
}

const builds = {};
const webApi = web.load('tools/api.js').createApi({ launch: (dir, kind) => { builds.web = dir; return { kind }; }, log: { log() {}, error: console.error } });
const nodeApi = require('./api').createApi({ launch: (dir, kind) => { builds.node = dir; return { kind }; }, log: { log() {}, error: console.error } });

let t = Date.now();
check(!!webApi.loadGame(), `browser version loads the game (${Date.now() - t} ms)`);
t = Date.now();
check(!!nodeApi.loadGame(), `local version loads the game (${Date.now() - t} ms)`);

const ask = (api, method, p, body = '') => {
  const url = new URL(p, 'http://x');
  const r = api.handle(method, url.pathname, url.searchParams, body);
  return { status: r.status, type: r.type, body: typeof r.body === 'string' ? r.body : Buffer.from(r.body) };
};
const same = (method, p, body) => {
  const a = ask(webApi, method, p, body), b = ask(nodeApi, method, p, body);
  check(a.status === b.status && a.type === b.type && Buffer.from(a.body).equals(Buffer.from(b.body)), `${method} ${p} gives the same answer`);
  return a;
};

const catalog = JSON.parse(same('GET', '/api/catalog').body);
for (const id of ['map1.1', 'map2.12', 'wb1:map3.1', 'nope']) same('GET', `/api/level?id=${encodeURIComponent(id)}`);
same('GET', '/api/config');
same('GET', '/api/campaign');
same('GET', '/api/custom?file=' + encodeURIComponent('Brickwood 01 First Bricks'));
same('GET', '/api/custom?file=..%2Fsecret');

// Saving a level, in the browser's file system only.
const lv = ask(webApi, 'PUT', '/api/custom?file=Web%20Test', '[map]\nname=WEB TEST\n map=..\n');
check(lv.status === 200 && vfs.existsSync('/wb2/levels/Web Test.txt'), 'browser version saves a level');
check(JSON.parse(ask(webApi, 'GET', '/api/custom').body).some((f) => f.file === 'Web Test'), 'and lists it');
ask(webApi, 'DELETE', '/api/custom?file=Web%20Test');
check(!vfs.existsSync('/wb2/levels/Web Test.txt'), 'and deletes it');

// Sprites: the PNGs compress differently, so compare the pixels.
function pngPixels(png) {
  const idat = [];
  for (let p = 8; p < png.length;) {
    const len = png.readUInt32BE(p);
    if (png.toString('latin1', p + 4, p + 8) === 'IDAT') idat.push(png.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  return zlib.inflateSync(Buffer.concat(idat));
}
t = Date.now();
const names = Object.keys(catalog.sprites);
let spriteDiffs = 0;
for (const name of names) {
  const a = webApi.sprites().render(name), b = nodeApi.sprites().render(name);
  if (!a !== !b || (a && (a.width !== b.width || a.height !== b.height || !pngPixels(toNode(a.png)).equals(pngPixels(b.png))))) spriteDiffs++;
}
check(spriteDiffs === 0, `all ${names.length} sprites have the same pixels (${spriteDiffs} differ, ${Date.now() - t} ms)`);

// Builds: every chunk of the built movie (and the copy inside Launcher.exe)
// must match the local version's.
function chunksOf(movieBuf) {
  const movie = ab.parse(movieBuf);
  return new Map(movie.resources.map((r) => [r.id, `${r.tag}:${ab.chunkData(movie, r).toString('base64')}`]));
}
function embeddedMovie(exe) {
  const start = exe.lastIndexOf(Buffer.from('MDGF')) - 8;
  return { prefix: exe.subarray(0, start), movie: exe.subarray(start, exe.length - 4) };
}
function sameBuild(what) {
  const read = (p) => toNode(vfs.readFileSync(p));
  const webDcr = read(path.posix.join(builds.web, 'worldbuilder2.dcr'));
  const nodeDcr = fs.readFileSync(path.join(builds.node, 'worldbuilder2.dcr'));
  const a = chunksOf(webDcr), b = chunksOf(nodeDcr);
  check(a.size === b.size && [...a].every(([id, v]) => b.get(id) === v), `${what}: built movie has the same ${a.size} chunks`);
  const webExe = embeddedMovie(read(path.posix.join(builds.web, 'Launcher.exe')));
  const nodeExe = embeddedMovie(fs.readFileSync(path.join(builds.node, 'Launcher.exe')));
  check(webExe.prefix.equals(nodeExe.prefix) && webExe.movie.equals(webDcr), `${what}: Launcher.exe carries that movie`);
  const webFiles = vfs.listTree(builds.web);
  const missing = webFiles.filter((f) => !fs.existsSync(path.join(builds.node, f)));
  check(!missing.length, `${what}: same ${webFiles.length} files (${missing.join(', ') || 'none missing'})`);
}

const level = fs.readFileSync(path.join(ROOT, 'levels', 'Brickwood 05 Crab Cove.txt'), 'latin1');
const { Level } = require('../editor/level.js');
const gameText = Level.gameText(Level.parse(level), catalog.terrain.map((x) => x.char));
t = Date.now();
check(ask(webApi, 'POST', '/api/play', JSON.stringify({ text: gameText, title: 'Crab Cove' })).status === 200, `browser version builds a level (${Date.now() - t} ms)`);
ask(nodeApi, 'POST', '/api/play', JSON.stringify({ text: gameText, title: 'Crab Cove' }));
sameBuild('level');

t = Date.now();
check(ask(webApi, 'POST', '/api/campaign/play', JSON.stringify({ freshProgress: true })).status === 200, `browser version builds the campaign (${Date.now() - t} ms)`);
ask(nodeApi, 'POST', '/api/campaign/play', JSON.stringify({ freshProgress: true }));
sameBuild('campaign');

// Zip: Node's zlib must read what the browser's deflate wrote.
const zip = web.load('tools/zip.js');
const data = toWeb(fs.readFileSync(path.join(wb2Dir, 'Launcher.exe')));
const z = toNode(zip.writeZip([{ name: 'a/Launcher.exe', data, mtime: new Date() }]));
const lh = 30 + z.readUInt16LE(26);
const unzipped = z.readUInt16LE(8) === 8 ? zlib.inflateRawSync(z.subarray(lh, lh + z.readUInt32LE(18))) : z.subarray(lh, lh + z.readUInt32LE(18));
check(unzipped.equals(toNode(data)), 'browser zip holds Launcher.exe intact');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
