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
const { watchContextFor, watchContextJSON, WATCH_MAX_STARRED, WATCH_MAX_TRIPS, WATCH_TIMES_GAP_MS, watchTripsFor, watchTripKey, watchNextFor, tripKeyOfCache, shouldTakeTimes } = await load('platform/watchShare.ts');

const hw = { home: { id: '213510', name: 'Strathfield Station' }, work: { id: '2011', name: 'Kings Cross Station' }, flip: null, trips: [] };
const card = {
  line: 'T1', lineColorHex: '#F99D1C', mode: 'train', nextStop: 'Burwood', stopsLeft: 3, getOffAt: 'Redfern', arrival: 2000, phase: 'ride',
  warning: null, progress: 0.4, towards: 'Central', platform: 'Platform 2', departs: 1000, legArrives: 1500, destination: 'Kings Cross',
  title: 'Strathfield to Kings Cross', until: 122000,
};

test('context carries Home, Work, the server and the trip card', () => {
  const c = watchContextFor('https://api.transportsydney.app/', 'uabc', hw, [{ id: '200060', name: 'Central' }], card);
  assert.equal(c.v, 2);
  assert.equal(c.base, 'https://api.transportsydney.app');
  assert.equal(c.profile, 'uabc');
  assert.deepEqual(c.home, hw.home);
  assert.deepEqual(c.work, hw.work);
  assert.deepEqual(c.starred, [{ id: '200060', name: 'Central' }]);
  assert.equal(c.live.getOffAt, 'Redfern');
  assert.deepEqual(c.trips, []);
  assert.deepEqual(c.times, {});
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

// Saved trips for the watch (build 207 watch app).
const P = (id, name) => ({ id, name });
const KX = P('201110', 'Kings Cross Station, Potts Point'), ST = P('213510', 'Strathfield Station'), CEN = P('200060', 'Central Station');
const RED = P('201510', 'Redfern Station'), PAR = P('215020', 'Parramatta Station');

test('trips come in the order Home lists them: commutes, phone trips, saved trips, then your drag order', () => {
  const st = {
    places: {},
    myTrips: [{ name: 'Gym', from: KX, to: ST }, { name: 'Gym again', from: KX, to: ST }],
    tripOrder: [],
  };
  const lists = {
    commutes: { items: [{ id: 'c1', name: 'Morning', from: CEN, to: PAR, active: true }, { id: 'c2', name: 'Off', from: RED, to: PAR, active: false }] },
    saved: { items: [{ name: 'Back', from: ST, to: KX }] },
  };
  let t = watchTripsFor(st, lists);
  assert.deepEqual(t.map((x) => [x.kind, x.key]), [['commute', '200060>215020'], ['mine', '201110>213510'], ['saved', '213510>201110']]);
  assert.equal(t[1].name, 'Gym');
  assert.equal(t[1].plan, null);
  t = watchTripsFor({ ...st, tripOrder: ['213510>201110', '201110>213510'] }, lists);
  assert.deepEqual(t.map((x) => x.key), ['213510>201110', '201110>213510', '200060>215020']);
});

test('the Home and Work trip is left out both ways (the watch makes the commute card itself)', () => {
  const st = { places: { home: KX, work: ST }, myTrips: [{ name: 'Work', from: KX, to: ST }, { name: 'Home', from: ST, to: KX }, { name: 'Other', from: KX, to: CEN }] };
  assert.deepEqual(watchTripsFor(st, null).map((x) => x.key), ['201110>200060']);
});

test('a trip with changes you chose goes with its legs for /api/plan; older via trips too', () => {
  const legs = [{ mode: 'train', from: KX, to: RED }, { mode: 'train', from: RED, to: ST, conn: 4 }];
  const t = watchTripsFor({ myTrips: [{ name: 'Chain', from: KX, to: ST, legs }, { name: 'Via', from: CEN, to: PAR, via: RED, conn: 6, modes: ['train', 'bus'] }] }, null);
  assert.equal(t[0].key, '201110>201510>213510');
  assert.deepEqual(JSON.parse(t[0].plan), [
    { f: '201110', fn: KX.name, t: '201510', tn: RED.name, m: 'train', c: 5, a: 0, w: 5 },
    { f: '201510', fn: RED.name, t: '213510', tn: ST.name, m: 'train', c: 4, a: 0, w: 5 },
  ]);
  assert.equal(t[1].key, '200060>201510>215020');
  assert.equal(JSON.parse(t[1].plan)[1].m, 'bus');
  assert.equal(JSON.parse(t[1].plan)[1].c, 6);
  assert.equal(watchTripKey({ from: KX, to: ST }), '201110>213510');
});

test('broken, repeated and same stop trips are left out, and there are at most 8', () => {
  const myTrips = [{ name: 'x', from: KX, to: KX }, { name: 'y', from: null, to: ST }, { name: 'z' }];
  for (let i = 0; i < 20; i++) myTrips.push({ name: `t${i}`, from: P(String(100 + i), `A${i}`), to: ST });
  const t = watchTripsFor({ myTrips }, { commutes: null, saved: { items: [null, {}] } });
  assert.equal(t.length, WATCH_MAX_TRIPS);
  assert.equal(t[0].from.id, '100');
  assert.deepEqual(watchTripsFor(null, null), []);
});

const iso = (ms) => new Date(ms).toISOString();
const NOW = Date.parse('2026-10-25T03:30:00.000Z');
const trip = {
  journeys: [
    { anyCancelled: false, legs: [{ kind: 'walk' }, { kind: 'transit', line: 'T4', color: '#005AA3', mode: 'train', fromPlatform: 'Platform 1', planned: iso(NOW + 60000), estimated: iso(NOW + 120000), realtime: true, delayMin: 1 }, { kind: 'transit', line: 'T1', color: '#F99D1C', planned: iso(NOW + 900000) }] },
    { legs: [{ kind: 'transit', line: 'T4', color: '#005AA3', fromPlatform: 'Platform 1', planned: iso(NOW - 300000), realtime: false }] },
    { legs: [{ kind: 'transit', line: 'T4', color: '#005AA3', fromPlatform: 'Platform 1', planned: iso(NOW + 1080000), estimated: null, realtime: false, delayMin: null, cancelled: true }] },
    { legs: [{ kind: 'transit', line: 'T4', planned: iso(NOW + 960000), estimated: iso(NOW + 960000), realtime: true, delayMin: 0 }, { kind: 'transit', line: 'T4' }] },
    { legs: [{ kind: 'transit', line: 'T9', planned: iso(NOW + 2000000) }] },
  ],
};

test('phone times: the first service of each trip, gone ones out, soonest first, at most 3, with lines and delay', () => {
  const n = watchNextFor(trip, NOW);
  assert.equal(n.length, 3);
  assert.deepEqual(n.map((x) => x.dep), [NOW + 120000, NOW + 960000, NOW + 1080000]);
  assert.deepEqual(n[0], { line: 'T4', color: '#005AA3', mode: 'train', platform: 'Platform 1', dep: NOW + 120000, delay: 1, live: true, cancelled: false, lines: ['T4', 'T1'], colors: ['#005AA3', '#F99D1C'] });
  assert.deepEqual(n[1].lines, ['T4']);
  assert.equal(n[2].cancelled, true);
  assert.equal(n[2].live, false);
  assert.deepEqual(watchNextFor(null, NOW), []);
  assert.deepEqual(watchNextFor({ journeys: [{ legs: [{ kind: 'walk' }] }] }, NOW), []);
});

test('only plain trip answers count, not a plan at a chosen time', () => {
  assert.equal(tripKeyOfCache('offline:trip:201110>213510[]|0|0'), '201110>213510');
  assert.equal(tripKeyOfCache('offline:trip:201110>201510>213510[["train",5,null,null]]|1|0'), '201110>201510>213510');
  assert.equal(tripKeyOfCache('offline:trip:201110>213510[]|0|0|dep:0830'), null);
  assert.equal(tripKeyOfCache('offline:dep:201110'), null);
  assert.equal(tripKeyOfCache('offline:home:lists'), null);
});

test('phone times change at most every 5 minutes per trip, unless there were none or all have gone', () => {
  const next = watchNextFor(trip, NOW);
  assert.equal(shouldTakeTimes(undefined, next, NOW), true);
  assert.equal(shouldTakeTimes(undefined, [], NOW), false);
  const old = { at: NOW - 60000, next };
  assert.equal(shouldTakeTimes(old, next, NOW), false);
  assert.equal(shouldTakeTimes(old, next, NOW - 60000 + WATCH_TIMES_GAP_MS), true);
  assert.equal(shouldTakeTimes({ at: NOW, next: [{ ...next[0], dep: NOW - 1 }] }, next, NOW + 1000), true);
});

test('the context carries trips and only their times (and both ways of Home and Work), in a stable order', () => {
  const trips = watchTripsFor({ myTrips: [{ name: 'Gym', from: KX, to: ST }] }, null);
  const next = watchNextFor(trip, NOW);
  const times = { '201110>213510': { at: NOW, next }, '999>888': { at: NOW, next }, '213510>2011': { at: NOW, next }, 'x>y': { at: NOW, next: [] } };
  const c = watchContextFor('https://h.example', 'p', hw, [], null, trips, times);
  assert.deepEqual(c.trips, trips);
  assert.deepEqual(Object.keys(c.times), ['201110>213510', '213510>2011']);
  const again = watchContextFor('https://h.example', 'p', hw, [], null, trips, { '213510>2011': times['213510>2011'], '201110>213510': times['201110>213510'] });
  assert.equal(watchContextJSON(c), watchContextJSON(again));
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
  const trip = fields(block('WTrip'));
  for (const k of ['key', 'name', 'kind', 'from', 'to', 'plan']) assert.ok(trip.includes(k), `WTrip lacks ${k}`);
  const next = fields(block('WNext'));
  for (const k of ['line', 'color', 'mode', 'platform', 'dep', 'delay', 'live', 'cancelled', 'lines', 'colors']) assert.ok(next.includes(k), `WNext lacks ${k}`);
  assert.ok(fields(block('WTimes')).includes('next'));
  const live = fields(block('WLiveCard'));
  for (const k of ['line', 'lineColorHex', 'phase', 'getOffAt', 'nextStop', 'platform', 'warning', 'departs', 'legArrives', 'arrival', 'until', 'title', 'updated']) {
    assert.ok(live.includes(k), `WLiveCard lacks ${k}`);
  }
});

test('watch app: list of trip cards, refresh while on screen only, no seconds timer in the complications', () => {
  const app = swift('targets/watch/TransportWatchApp.swift');
  const comp = swift('targets/watch-widget/Complications.swift');
  assert.ok(app.includes('struct TripRowView') && app.includes('struct ServiceCardView'), 'trip rows and service cards');
  assert.ok(/navigationTitle\(WText\.short\(shown\.from\.name\)\)/.test(app), 'trip screen titled with the stop you leave from');
  assert.ok(app.includes('Save a trip on your iPhone to see it here.'), 'empty state');
  assert.ok(/\.task\(id: phase\)/.test(app) && app.includes('guard phase == .active'), 'loads only while active');
  assert.ok(!/Timer\.publish/.test(app), 'no always on timers');
  assert.ok(!/style: \.timer/.test(comp) && !/timerInterval/.test(comp), 'no seconds countdown in complications');
  assert.ok(!/URLSession|WatchAPI\(/.test(comp), 'complications never load anything');
  const code = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const f of [app, comp, swift('targets/watch/WatchCore.swift')]) assert.ok(!/Kings Cross|Strathfield|Parramatta|Central/.test(code(f)), 'no sample trips in shipping code');
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
