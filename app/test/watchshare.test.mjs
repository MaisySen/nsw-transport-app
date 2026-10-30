// What the iPhone sends to the Apple Watch app (platform/watchShare.ts). Field names must match WatchContext in
// targets/watch/WatchCore.swift, and the watch app and its complications must carry the same WatchCore.swift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(import.meta.url);
const ts = require(path.join(root, 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-watchshare-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const { watchContextFor, watchContextJSON, WATCH_MAX_STARRED } = await load('platform/watchShare.ts');

const hw = { home: { id: '206710', name: 'Chatswood Station' }, work: { id: '2011', name: 'Bondi Junction Station' }, flip: null, trips: [] };
const card = {
  line: 'T1', lineColorHex: '#F99D1C', mode: 'train', nextStop: 'Parramatta', stopsLeft: 3, getOffAt: 'Epping', arrival: 2000, phase: 'ride',
  warning: null, progress: 0.4, towards: 'Central', platform: 'Platform 2', departs: 1000, legArrives: 1500, destination: 'Bondi Junction',
  title: 'Chatswood to Bondi Junction', until: 122000,
};

test('context carries Home, Work, the server and the trip card', () => {
  const c = watchContextFor('https://api.transportsydney.app/', 'uabc', hw, [{ id: '200060', name: 'Central' }], card);
  assert.equal(c.v, 1);
  assert.equal(c.base, 'https://api.transportsydney.app');
  assert.equal(c.profile, 'uabc');
  assert.deepEqual(c.home, hw.home);
  assert.deepEqual(c.work, hw.work);
  assert.deepEqual(c.starred, [{ id: '200060', name: 'Central' }]);
  assert.equal(c.live.getOffAt, 'Epping');
  assert.equal('trips' in c, false);
});

test('no https server address, no context', () => {
  assert.equal(watchContextFor('http://example.com', null, hw, [], null), null);
  assert.equal(watchContextFor('', null, hw, [], null), null);
  assert.equal(watchContextFor('https://bad host', null, hw, [], null), null);
});

test('starred stops: no repeats, no empty ids, at most the cap, order kept', () => {
  const many = [{ id: '', name: 'x' }, { id: '1', name: 'A' }, { id: '1', name: 'A again' }];
  for (let i = 2; i < 20; i++) many.push({ id: String(i), name: `S${i}` });
  const c = watchContextFor('https://h.example', null, hw, many, null);
  assert.equal(c.starred.length, WATCH_MAX_STARRED);
  assert.deepEqual(c.starred.slice(0, 2).map((s) => s.id), ['1', '2']);
});

test('the trip card leaves out the progress fraction and rounds its load time to the minute', () => {
  const c = watchContextFor('https://h.example', 'p', hw, [], { ...card, updated: 1792882871541 });
  assert.equal('progress' in c.live, false);
  assert.equal(c.live.updated, 1792882860000);
  const a = watchContextFor('https://h.example', 'p', hw, [], { ...card, progress: 0.1, updated: 1792882861000 });
  const b = watchContextFor('https://h.example', 'p', hw, [], { ...card, progress: 0.3, updated: 1792882899000 });
  assert.equal(watchContextJSON(a), watchContextJSON(b));
});

test('an arrived trip is not sent; equal contexts give equal JSON', () => {
  const a = watchContextFor('https://h.example', 'p', hw, [], { ...card, phase: 'arrived' });
  assert.equal(a.live, null);
  const b = watchContextFor('https://h.example', 'p', hw, [], null);
  assert.equal(watchContextJSON(a), watchContextJSON(b));
});

const swift = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('watch app and complications carry the same WatchCore.swift', () => {
  assert.equal(swift('targets/watch/WatchCore.swift'), swift('targets/watch-widget/WatchCore.swift'));
});

test('Swift WatchContext and WLiveCard have the fields the phone sends', () => {
  const src = swift('targets/watch/WatchCore.swift');
  const block = (name) => src.slice(src.indexOf(`struct ${name}`), src.indexOf('\n}\n', src.indexOf(`struct ${name}`)));
  const fields = (b) => [...b.matchAll(/^\s{4}var (\w+): /gm)].map((m) => m[1]);
  const ctx = fields(block('WatchContext'));
  const c = watchContextFor('https://h.example', 'p', hw, [], card);
  for (const k of Object.keys(c)) assert.ok(ctx.includes(k), `WatchContext lacks ${k}`);
  const live = fields(block('WLiveCard'));
  for (const k of ['line', 'lineColorHex', 'phase', 'getOffAt', 'nextStop', 'platform', 'warning', 'departs', 'legArrives', 'arrival', 'until', 'title', 'updated']) {
    assert.ok(live.includes(k), `WLiveCard lacks ${k}`);
  }
});

test('no em or en dashes in the watch code', () => {
  for (const dir of ['targets/watch', 'targets/watch-widget']) {
    for (const f of fs.readdirSync(path.join(root, dir))) {
      if (!/\.(swift|js|plist|entitlements)$/.test(f)) continue;
      const s = swift(`${dir}/${f}`);
      assert.ok(!/[\u2013\u2014]/.test(s), `${dir}/${f} has a dash`);
    }
  }
  for (const f of ['platform/watchShare.ts', 'modules/transport-ios/ios/WatchLink.swift']) assert.ok(!/[\u2013\u2014]/.test(swift(f)), f);
});
