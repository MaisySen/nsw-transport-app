// Speed pass (27 Oct 2026, "It's bad everywhere"): every screen paints at once from what the phone already has, reads go
// out side by side, and a row's next screen is read on press in, within bounds. Pure parts run here; screen wiring is
// checked in the source.
// Run: TZ=Australia/Sydney OFFLINE=1 node --test test/speed27.test.mjs
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-speed27-'));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// A fake phone storage for offline.ts.
fs.writeFileSync(path.join(out, 'async-storage.mjs'), `const m = new Map();
export default { getItem: async (k) => (m.has(k) ? m.get(k) : null), setItem: async (k, v) => { m.set(k, v); }, multiGet: async (ks) => ks.map((k) => [k, m.has(k) ? m.get(k) : null]), multiRemove: async (ks) => { for (const k of ks) m.delete(k); }, removeItem: async (k) => { m.delete(k); } };`);
const done = new Set();
function emit(rel) {
  if (done.has(rel)) return;
  done.add(rel);
  let js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  js = js.replace(/from '@react-native-async-storage\/async-storage'/g, "from './async-storage.mjs'");
  js = js.replace(/from '\.\/([A-Za-z0-9_]+)'/g, (m, name) => { emit(`src/lib/${name}.ts`); return `from './${name}.mjs'`; });
  fs.writeFileSync(path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs')), js);
}
async function load(rel) { emit(rel); return import(pathToFileURL(path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'))).href); }

const S = await load('src/lib/speedCore.ts');
const O = await load('src/lib/offlineCore.ts');
const OFF = await load('src/lib/offline.ts');

const NOW = Date.parse('2026-10-26T22:20:00Z'); // 9:20am Sydney, 27 Oct
const iso = (min) => new Date(NOW + min * 60000).toISOString();
const row = { tripId: 'T1.123', feed: '', line: 'T1', stopId: '2135223', planned: iso(4), mode: 'train', destId: '2077', color: '#F99D1C', dest: 'Berowra', realtime: true, estimated: iso(6), delayMin: 2, stopName: 'Strathfield Station Platform 3', seenAt: NOW - 20000 };

test('one query wherever a service is read: the screen, a board line and a press in build the same keys in the same order', () => {
  const p = S.svcParams(row);
  const q = S.serviceQuery(p);
  assert.deepEqual(Object.keys(q), ['trip', 'feed', 'line', 'stop', 'planned', 'mode', 'destId', 'to', 'dest']);
  assert.equal(q.feed, undefined, 'empty values are left out, as qs() drops them');
  assert.equal(q.to, undefined);
  // The service screen gets the params as strings through the router: the same query and the same kept copy key.
  const viaRouter = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)]));
  assert.deepEqual(S.serviceQuery(viaRouter), q);
  assert.equal(S.svcCacheId(viaRouter), S.svcCacheId(p));
  assert.equal(S.svcCacheId(p), `T1.123|${row.planned}|2135223|`);
  for (const f of ['src/app/service.tsx', 'src/app/board.tsx', 'src/lib/prefetch.ts']) assert.match(read(f), /serviceQuery\(/, `${f} builds the query with serviceQuery`);
  assert.doesNotMatch(read('src/app/service.tsx'), /api\.service\(\{/, 'no hand built service query left on the screen');
  assert.doesNotMatch(read('src/app/board.tsx'), /api\.service\(\{/, 'no hand built service query left on the board');
});

test('a service opened from a board paints its first frame from the row: line, destination, live delay, your stop and time', () => {
  const s = S.serviceSeed(S.svcParams(row), NOW);
  assert.ok(s);
  assert.equal(s.at, NOW - 20000, 'labelled with when the row was read');
  assert.equal(s.data.seeded, true);
  assert.equal(s.data.line, 'T1');
  assert.equal(s.data.dest, 'Berowra');
  assert.equal(s.data.live, true);
  assert.equal(s.data.delayMin, 2);
  assert.equal(s.data.stops.length, 1);
  assert.equal(s.data.stops[0].mine, true);
  assert.equal(s.data.stops[0].estimated, row.estimated);
  assert.equal(s.data.mine.name, 'Strathfield Station Platform 3');
  assert.equal(s.data.mineIndex, 0);
  assert.equal(s.data.vehicle, undefined, 'no vehicle is made up');
});

test('a seed from a trip leg carries both stops; a timetable row carries no live time or delay', () => {
  const leg = { ...row, realtime: false, estimated: null, delayMin: null, toStopId: '200060', toName: 'Central Station', arrPlanned: iso(20) };
  const s = S.serviceSeed(S.svcParams(leg), NOW);
  assert.equal(s.data.live, false);
  assert.equal(s.data.delayMin, null);
  assert.equal(s.data.stops[0].estimated, undefined);
  assert.deepEqual(s.data.stops.map((x) => [x.id, !!x.mine, !!x.alight]), [['2135223', true, false], ['200060', false, true]]);
  assert.equal(s.data.stops[1].planned, iso(20));
});

test('no seed without a trip or line, or from a row more than 10 minutes old; a seed is never kept on the phone', () => {
  assert.equal(S.serviceSeed(S.svcParams({ ...row, tripId: '' }), NOW), null);
  assert.equal(S.serviceSeed(S.svcParams({ ...row, line: '' }), NOW), null);
  assert.equal(S.serviceSeed(S.svcParams({ ...row, seenAt: NOW - 11 * 60000 }), NOW), null);
  assert.equal(S.serviceSeed(S.svcParams({ ...row, seenAt: NOW + 60000 }), NOW).at, NOW, 'a future stamp counts as now');
  const s = S.serviceSeed(S.svcParams(row), NOW);
  assert.equal(O.worthKeeping(s.data), false);
  assert.equal(S.isSeeded(s.data), true);
  assert.equal(S.isSeeded({ kind: 'service', stops: [] }), false);
});

test('first frame order: a recent kept copy, the pack, an older kept copy, then the seed, then nothing', () => {
  const kept = { at: NOW - 60000, data: { kind: 'service', stops: [{ id: 'a' }] } };
  const old = { at: NOW - 3 * 3600000, data: { kind: 'departures', items: [{}] } };
  const pack = { kind: 'departures', items: [{ line: 'T1' }], fromPack: NOW - 3600000 };
  const seed = { at: NOW - 5000, data: { kind: 'service', seeded: true, stops: [] } };
  assert.equal(S.firstFrame(kept, null, seed, NOW).kind, 'kept');
  assert.equal(S.firstFrame(old, pack, seed, NOW).kind, 'pack');
  assert.equal(S.firstFrame(old, null, seed, NOW).kind, 'kept');
  const f = S.firstFrame(null, null, seed, NOW);
  assert.equal(f.kind, 'seed');
  assert.equal(f.at, NOW - 5000);
  assert.equal(S.firstFrame(null, null, null, NOW).kind, 'none');
  // useLive paints the seed labelled (staleAt), lets a kept copy read from storage replace it, never a pack.
  const h = read('src/lib/hooks.ts');
  assert.match(h, /firstFrame<T>\(opts\.cacheKey/);
  assert.match(h, /seed: f\.kind === 'seed'/);
  assert.match(h, /if \(shown\.current\.seed\) \{ if \(f\.kind === 'kept'\) paint\(f\); return; \}/);
  assert.match(h, /setStaleAt\(f\.kind === 'kept' \|\| f\.kind === 'seed' \? f\.at : null\)/);
});

test('paint from cache: an answer held in memory by a press in is what the next screen peeks on its first frame', async () => {
  const key = O.cacheKey('svc', S.svcCacheId(S.svcParams(row)));
  assert.equal(OFF.peekOffline(key), null);
  const ans = { kind: 'service', line: 'T1', stops: [{ id: '2135223', name: 'Strathfield', planned: iso(4) }] };
  OFF.keepMem(key, ans, NOW - 2000);
  const p = OFF.peekOffline(key);
  assert.ok(p, 'peeked with no storage read');
  assert.equal(p.at, NOW - 2000);
  assert.equal(OFF.memAt(key), NOW - 2000);
  // An older answer never replaces a newer one; a seed or an error is never held.
  OFF.keepMem(key, { ...ans, line: 'old' }, NOW - 9000);
  assert.equal(OFF.peekOffline(key).data.line, 'T1');
  OFF.keepMem(O.cacheKey('svc', 'x'), { kind: 'service', seeded: true, stops: [] });
  assert.equal(OFF.memAt(O.cacheKey('svc', 'x')), null);
  OFF.keepMem(O.cacheKey('svc', 'y'), { error: 'nope' });
  assert.equal(OFF.memAt(O.cacheKey('svc', 'y')), null);
});

test('memory stays bounded: held answers share the kept copies cap', () => {
  for (let i = 0; i < O.MAX_ENTRIES + 25; i++) OFF.keepMem(O.cacheKey('dep', `s${i}`), { kind: 'departures', items: [{ line: 'T1', planned: iso(10) }] }, Date.now());
  let held = 0;
  for (let i = 0; i < O.MAX_ENTRIES + 25; i++) if (OFF.memAt(O.cacheKey('dep', `s${i}`)) != null) held++;
  assert.ok(held <= O.MAX_ENTRIES, `held ${held}`);
  assert.equal(OFF.memAt(O.cacheKey('dep', `s${O.MAX_ENTRIES + 24}`)) != null, true, 'the newest stays');
});

test('press in prefetch is bounded: once per service per 20 s, 8 a minute, none when a fresh copy is in memory', () => {
  const g = S.createPrefetchGate();
  let t = NOW;
  assert.equal(g.allow('a', t), true);
  assert.equal(g.allow('a', t + 1000), false, 'same service again within 20 s');
  assert.equal(g.allow('a', t + 20000), true, 'again after 20 s');
  assert.equal(g.allow('b', t + 20001, t + 20001 - 3000), false, 'a copy 3 s old is used as it is');
  assert.equal(g.allow('b', t + 20002, t + 20002 - 60000), true, 'a minute old copy is read again');
  const g2 = S.createPrefetchGate();
  let n = 0;
  for (let i = 0; i < 30; i++) if (g2.allow(`k${i}`, t + i * 100)) n++;
  assert.equal(n, S.PREFETCH_PER_MIN, 'a finger dragged across many rows reads at most 8');
  assert.equal(g2.allow('late', t + 61000), true, 'the minute passes');
  assert.ok(g2.size() <= S.PREFETCH_PER_MIN + 1, 'old keys are dropped');
});

test('rows that open a service start its read on press in; the screen joins it (no tap behaviour change)', () => {
  assert.match(read('src/components/Transit.tsx'), /onPress=\{onPress\} onPressIn=\{\(\) => pressService\(d\)\}/);
  assert.match(read('src/components/LeftRow.tsx'), /onPressIn=\{\(\) => pressService\(d\)\}/);
  assert.match(read('src/components/Home.tsx'), /onPressIn=\{\(\) => pressService\(d\)\}/);
  assert.match(read('src/app/trip.tsx'), /onPress=\{\(\) => openService\(legRow\(l\)\)\} onPressIn=\{\(\) => pressService\(legRow\(l\)\)\}/);
  const pf = read('src/lib/prefetch.ts');
  assert.match(pf, /gate\.allow\(key, Date\.now\(\), memAt\(key\)\)/);
  assert.match(pf, /keepMem\(key, r\)/, 'held in memory, not written to storage');
  // The board's next stops read is held for the service screen too.
  assert.match(read('src/app/board.tsx'), /holdService\(sp, s\)/);
});

test('the service screen paints the seed and says it is still loading, never "Finding the vehicle" with a row in hand', () => {
  const s = read('src/app/service.tsx');
  assert.match(s, /seed \}\);/);
  assert.match(s, /serviceSeed\(p, Date\.now\(\)\)/);
  assert.match(s, /\{!data && !error \? <T kind="sub" tone="text2">Finding the vehicle<\/T> : null\}/);
  assert.match(s, /seeded && !error \? <T[^>]*>Loading every stop<\/T>/);
  assert.match(s, /data && !seeded && !data\.vehicle/, 'no "No GPS position yet" before the server has answered');
  assert.match(read('src/components/Cards.tsx'), /stopName: d\.stopName \|\| data\?\.stop\?\.name \|\| stop\.name/);
});

test('reads go out side by side: nearby station lookups, a route opened stop beside its probes', async () => {
  // allSettledMap: all start at once, order kept, a failure is null and does not fail the rest.
  const started = [];
  const r = await S.allSettledMap([30, 10, 20, -1], (ms, i) => new Promise((res, rej) => { started.push(i); setTimeout(() => (ms < 0 ? rej(new Error('x')) : res(ms)), Math.max(ms, 0)); }));
  assert.deepEqual(started, [0, 1, 2, 3], 'every one started before any finished');
  assert.deepEqual(r, [30, 10, 20, null]);
  const t0 = Date.now();
  await S.allSettledMap([60, 60, 60, 60, 60], (ms) => new Promise((res) => setTimeout(() => res(ms), ms)));
  assert.ok(Date.now() - t0 < 200, `five 60 ms reads took ${Date.now() - t0} ms side by side`);
  const home = read('src/components/Home.tsx');
  const near = home.slice(home.indexOf('export async function nearbyStops'), home.indexOf('type NearState'));
  assert.doesNotMatch(near, /for \(const g of sorted\)[\s\S]*await parentOf/, 'no lookup waits on the one before');
  assert.match(near, /allSettledMap\(sorted/);
  const route = read('src/app/route.tsx');
  const load = route.slice(route.indexOf('const load = useCallback'), route.indexOf('const runNow'));
  assert.ok(load.indexOf('const openOwn') < load.indexOf('await Promise.all(probes'), 'the opened stop is asked before the probes are awaited');
  assert.doesNotMatch(load, /await api\.departures\(o\)/);
});

test('nearby paints the kept list at once when the phone is within 400 m of where it was made', () => {
  const kept = { at: NOW - 3600000, lat: -33.8732, lon: 151.0827, stops: [{ id: '213510', name: 'Strathfield Station' }] };
  assert.deepEqual(S.nearFirstPaint(kept, { lat: -33.8740, lon: 151.0830 }, NOW), kept.stops);
  assert.equal(S.nearFirstPaint(kept, { lat: -33.8832, lon: 151.0827 }, NOW), null, 'about 1.1 km away');
  assert.equal(S.nearFirstPaint({ ...kept, at: NOW - 13 * 3600000 }, { lat: -33.8732, lon: 151.0827 }, NOW), null, 'too old');
  assert.equal(S.nearFirstPaint({ ...kept, stops: [] }, { lat: -33.8732, lon: 151.0827 }, NOW), null);
  assert.equal(S.nearFirstPaint(kept, null, NOW), null);
  assert.ok(Math.abs(S.metres({ lat: -33.8732, lon: 151.0827 }, { lat: -33.8832, lon: 151.0827 }) - 1112) < 15);
  const home = read('src/components/Home.tsx');
  assert.match(home, /nearFirstPaint\(kept/);
  assert.match(home, /keepNear\(pos\.coords\.latitude/);
});

test('car parks and routes keep a copy: the list, a car park opened from it, a route\'s stops', () => {
  assert.equal(O.worthKeeping({ carparks: [] }), false, 'an empty car park list is never kept');
  assert.equal(O.worthKeeping({ carparks: [{ id: '1' }] }), true);
  assert.equal(O.MAX_ENTRIES, 40);
  const pk = read('src/app/parking.tsx');
  assert.match(pk, /cacheKey: cacheKey\('park', 'all'\)/);
  assert.match(pk, /holdPark\(p, /);
  assert.match(pk, /LiveStamp updatedAt=\{null\}/, 'a kept list says how old it is');
  assert.match(read('src/app/carpark.tsx'), /cacheKey\('park', `cp:\$\{id\}`\)/);
  const route = read('src/app/route.tsx');
  assert.match(route, /routeMem\.get\(rk\) \?\? peekOffline/);
  assert.match(route, /keepOffline\(rk, raw\)/);
  const cap = S.createCapped(3);
  for (const k of ['a', 'b', 'c', 'd']) cap.set(k, k);
  assert.equal(cap.size(), 3);
  assert.equal(cap.get('a'), undefined);
});

test('no new timers, background work or precise location in the speed pass files', () => {
  for (const f of ['src/lib/speedCore.ts', 'src/lib/prefetch.ts']) {
    const s = read(f);
    assert.doesNotMatch(s, /setInterval|setTimeout|Accuracy\.High|AppState/, f);
  }
});
