// New trip first look (30 Oct 2026, newTripCore.ts): a brand new A to B search asks the server's timetable trips
// (GET /api/trip?tt=1, x-serves word trip-tt) beside its normal request and paints them as timetable times until the
// live answer replaces them in place. Bidur's live trip rules R1 to R6 (instantPaintCore.ts) hold for it.
// Pure parts run here; screen and request wiring are checked in the source. Made up stop ids and times only.
// Run: TZ=Australia/Sydney OFFLINE=1 node --test test/newtrip.test.mjs
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-newtrip-'));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const done = new Set();
function emit(rel) {
  if (done.has(rel)) return;
  done.add(rel);
  let js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  js = js.replace(/from '\.\/([A-Za-z0-9_]+)'/g, (m, name) => { emit(`src/lib/${name}.ts`); return `from './${name}.mjs'`; });
  fs.writeFileSync(path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs')), js);
}
async function load(rel) { emit(rel); return import(pathToFileURL(path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'))).href); }

const NT = await load('src/lib/newTripCore.ts');
const IP = await load('src/lib/instantPaintCore.ts');
const O = await load('src/lib/offlineCore.ts');

const NOW = Date.parse('2026-10-30T07:00:00Z'); // 6 pm Sydney
const MIN = 60000;
const iso = (t) => new Date(t).toISOString();

// A made up direct journey leaving at `dep` as the server's first look sends it (source timetable, Scheduled).
function TT(dep, o = {}) {
  const leg = { kind: 'transit', mode: 'train', line: 'X1', tripId: o.tripId || `trip-${dep}`, stopId: '900001', toStopId: '900002', from: 'Stop A', to: 'Stop B',
    planned: iso(dep), arrPlanned: iso(dep + 20 * MIN), durationMin: 20, realtime: false, status: { key: 'scheduled', text: 'Scheduled' }, ...(o.leg || {}) };
  return { leave: iso(dep - 3 * MIN), board: iso(dep), arrive: iso(dep + 20 * MIN), durationMin: 23, changes: 0, live: false, anyCancelled: false, source: 'timetable', legs: [{ kind: 'walk', durationMin: 3 }, leg], ...(o.j || {}) };
}
const answer = (journeys, extra = {}) => ({ kind: 'trip', from: { id: '900001', name: 'Stop A' }, to: { id: '900002', name: 'Stop B' }, journeys, now: NOW, source: 'timetable', fallback: 'planner-slow', ...extra });

test('asked only for a plain new search with nothing on screen, from a server that serves trip-tt', () => {
  const ok = { served: true, plain: true, accessible: false, long: false, painted: false };
  assert.equal(NT.ttFirstWanted(ok), true);
  assert.equal(NT.ttFirstWanted({ ...ok, served: false }), false, 'a server without trip-tt: no extra request');
  assert.equal(NT.ttFirstWanted({ ...ok, plain: false }), false, 'set legs or via: the normal request only');
  assert.equal(NT.ttFirstWanted({ ...ok, accessible: true }), false, 'step free: never from the timetable');
  assert.equal(NT.ttFirstWanted({ ...ok, long: true }), false);
  assert.equal(NT.ttFirstWanted({ ...ok, painted: true }), false, 'a kept copy or phone built seed already paints');
  assert.equal(NT.TRIP_TT, 'trip-tt');
  assert.ok(NT.TT_FIRST_MS > 1500 && NT.TT_FIRST_MS <= 3000);
});

test('the first look asks the same search with tt=1: never a page, a day list, a poll or step free', () => {
  const q = NT.ttFirstQuery({ from: '900001', to: '900002', fromName: 'Stop A', toName: 'Stop B', count: 6, time: '1830', arriveBy: true, date: '20261030', modes: ['train', 'bus'], fare: 'adult' });
  assert.deepEqual(q, { from: '900001', to: '900002', fromName: 'Stop A', toName: 'Stop B', count: '6', time: '1830', arriveBy: '1', date: '20261030', modes: 'train,bus', fare: 'adult', tt: '1' });
  const plain = NT.ttFirstQuery({ from: '900001', to: '900002' });
  for (const k of ['page', 'days', 'after', 'before', 'refresh', 'acc', 'time', 'date', 'arriveBy']) assert.ok(!(k in plain), k);
  assert.equal(plain.tt, '1');
  assert.equal(NT.ttFirstQuery({ from: 'a', to: 'b', time: '6pm', date: 'today' }).time, undefined, 'only clean words go');
});

test('R1: never live, whatever the server sent; labelled phone built so the screen says timetable times', () => {
  const stray = TT(NOW + 10 * MIN, { leg: { realtime: true, estimated: iso(NOW + 12 * MIN), arrEstimated: iso(NOW + 32 * MIN), delayMin: 2, occupancy: 'many', vehicle: { lat: 0, lon: 0 } }, j: { warn: 'Tight change' } });
  const d = NT.ttFirstSeed(answer([stray, TT(NOW + 20 * MIN)]), NOW);
  assert.ok(d);
  assert.equal(d.journeys.length, 2);
  for (const j of d.journeys) {
    assert.equal(j.live, false);
    assert.ok(!j.warn);
    for (const l of j.legs.filter((x) => x.kind === 'transit')) {
      assert.equal(l.realtime, false);
      assert.equal(l.delayMin, null);
      for (const k of ['estimated', 'arrEstimated', 'occupancy', 'vehicle']) assert.ok(!(k in l), k);
    }
  }
  assert.equal(d.source, 'timetable');
  assert.equal(d.phoneBuilt, true);
  assert.equal(d.seeded, true);
  assert.equal(NT.isTtFirst(d), true);
  assert.equal(IP.isPhoneBuilt(d), true, 'the trip screen shows "Timetable times. Getting live times." over it');
  assert.equal(IP.phoneBuiltText(false), 'Timetable times. Getting live times.');
});

test('only a timetable answer paints: a live answer, an empty 204, an error or nothing is not a first look', () => {
  assert.equal(NT.ttFirstSeed(null, NOW), null);
  assert.equal(NT.ttFirstSeed({}, NOW), null, 'a 204 reads as an empty body');
  assert.equal(NT.ttFirstSeed({ error: 'No timetable trips to stand in' }, NOW), null);
  assert.equal(NT.ttFirstSeed(answer([TT(NOW + 5 * MIN)], { source: 'planner' }), NOW), null);
  const mixed = answer([TT(NOW + 5 * MIN, { j: { source: 'planner', live: true } }), TT(NOW + 15 * MIN)]);
  assert.equal(NT.ttFirstSeed(mixed, NOW).journeys.length, 1, 'a journey that is not timetable never shows');
  assert.equal(NT.ttFirstSeed(answer([TT(NOW + 5 * MIN, { j: { anyCancelled: true } })]), NOW), null, 'a cancelled one never shows as running');
});

test('R3: services gone by the phone clock drop; all gone is nothing (placeholders stay)', () => {
  const d = NT.ttFirstSeed(answer([TT(NOW - 2 * MIN), TT(NOW + 1 * MIN), TT(NOW + 11 * MIN)]), NOW + 2 * MIN);
  assert.deepEqual(d.journeys.map((j) => Date.parse(j.board)), [NOW + 11 * MIN]);
  assert.equal(NT.ttFirstSeed(answer([TT(NOW - 5 * MIN)]), NOW), null);
});

test('R4: rows share the live answer keys (first service trip id) in time order, one row per key', () => {
  const d = NT.ttFirstSeed(answer([TT(NOW + 20 * MIN, { tripId: 'b' }), TT(NOW + 10 * MIN, { tripId: 'a' }), TT(NOW + 10 * MIN, { tripId: 'a' })]), NOW);
  assert.deepEqual(d.journeys.map(IP.seedRowKey), ['a', 'b']);
  const live = { legs: [{ kind: 'transit', tripId: 'a', line: 'X1', planned: iso(NOW + 10 * MIN), estimated: iso(NOW + 12 * MIN), realtime: true }] };
  assert.equal(IP.seedRowKey(live), IP.seedRowKey(d.journeys[0]), 'the live row replaces it in place');
  const many = NT.ttFirstSeed(answer(Array.from({ length: 14 }, (_, i) => TT(NOW + (i + 1) * 5 * MIN))), NOW);
  assert.equal(many.journeys.length, IP.SEED_MAX);
});

test('arrive by keeps the trips nearest the time; leave at drops trips before the chosen time', () => {
  const list = Array.from({ length: 14 }, (_, i) => TT(NOW + (i + 1) * 5 * MIN));
  const arr = NT.ttFirstSeed(answer(list), NOW, NOW + 90 * MIN, true);
  assert.equal(arr.journeys.length, IP.SEED_MAX);
  assert.equal(Date.parse(arr.journeys.at(-1).board), NOW + 70 * MIN);
  const at = NT.ttFirstSeed(answer(list), NOW, NOW + 30 * MIN, false);
  assert.ok(at.journeys.every((j) => Date.parse(j.board) >= NOW + 29 * MIN));
});

test('R5 and R6: never kept on the phone and Start trip never arms live times from it', () => {
  const d = NT.ttFirstSeed(answer([TT(NOW + 10 * MIN)]), NOW);
  assert.equal(O.worthKeeping(d), false, 'never written back as if live');
  assert.equal(IP.tripSeed({ at: NOW, data: d }, { anchor: NOW, arriveBy: false, now: NOW }), null, 'never seeds another search');
  assert.equal(IP.armFresh({ data: d, updatedAt: NOW, now: NOW }), false);
  const spec = IP.armSpec({ legs: [{ estimated: iso(NOW + 12 * MIN) }] }, IP.armFresh({ data: d, updatedAt: NOW, now: NOW }));
  assert.ok(!('estimated' in spec.legs[0]));
});

test('R2: the live cap is untouched (LIVE_MAX_MS still 5 minutes)', async () => {
  const LL = await load('src/lib/liveLabelCore.ts');
  assert.equal(LL.LIVE_MAX_MS, 5 * MIN);
});

test('it paints only while nothing live, kept or seeded is on screen', () => {
  assert.equal(NT.ttFirstMayPaint({ live: false, at: null }), true);
  assert.equal(NT.ttFirstMayPaint({ live: true, at: NOW }), false, 'the live answer already landed');
  assert.equal(NT.ttFirstMayPaint({ live: false, at: NOW }), false, 'a kept copy or seed is on screen');
  assert.equal(NT.ttFirstMayPaint(null), false);
});

test('wiring: one quick request beside the live one, after the phone copies came up empty, for a server that serves it', () => {
  const api = read('src/lib/api.ts');
  const body = api.slice(api.indexOf('tripFirst:'), api.indexOf('plan: (legs'));
  assert.match(body, /serves\(TRIP_TT, base\)/, 'feature detected per server (x-serves)');
  assert.match(body, /once<TripResp>\(/, 'one try: no retry, no fallback server, no offline label');
  assert.match(body, /TT_FIRST_MS/);
  assert.match(body, /catch \{\s*return null;/, 'a failure says nothing');
  assert.ok(!/refresh|page:|days:/.test(body), 'never a poll or a page');
  const hooks = read('src/lib/hooks.ts');
  assert.match(hooks, /early\?: \(\(\) => Promise<T \| null>\) \| null/);
  assert.match(hooks, /\.catch\(\(\) => \{\}\)\.then\(startEarly\)/, 'asked after the kept copy read');
  const se = hooks.slice(hooks.indexOf('const startEarly'), hooks.indexOf('if ((key || pk)'));
  assert.ok(!/keepOffline/.test(se), 'R5: never kept');
  assert.match(se, /seed: true/);
  assert.match(se, /ttFirstMayPaint\(shown\.current\)/);
  const trip = read('src/app/trip.tsx');
  assert.match(trip, /early: ttFirstAsk/);
  assert.match(trip, /ttFirstWanted\(\{[^}]*accessible: accOn[^}]*painted: !!tripSeedNow/);
  assert.match(trip, /ttFirstSeed\(r, Date\.now\(\)/);
});

test('OTA safe for builds 201 to 208: JavaScript only, no native or phone dependency in the new module', () => {
  const s = read('src/lib/newTripCore.ts').replace(/^\/\/.*$/gm, '');
  assert.ok(!/requireNativeModule|NativeModules|expo-|react-native/.test(s));
  const imports = [...s.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./instantPaintCore', './types']);
});
