// Speed pass part 2 (27 Oct 2026): ids in headers (shared edge cache keys), re-timing held trips by trip id, version
// tags for static data, trips via a stop without forced planner calls and with the second part asked early, and Home
// reading the likely next screen while idle. Pure parts run here; screen wiring is checked in the source.
// Run: TZ=Australia/Sydney OFFLINE=1 node --test test/speed27b.test.mjs
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-speed27b-'));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

fs.writeFileSync(path.join(out, 'async-storage.mjs'), `const m = new Map();
export const __m = m;
export default { getItem: async (k) => (m.has(k) ? m.get(k) : null), setItem: async (k, v) => { m.set(k, v); }, multiGet: async (ks) => ks.map((k) => [k, m.has(k) ? m.get(k) : null]), multiRemove: async (ks) => { for (const k of ks) m.delete(k); }, multiSet: async (kv) => { for (const [k, v] of kv) m.set(k, v); } };
`);
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

const SV = await load('src/lib/servesCore.ts');
const TL = await load('src/lib/tripLiveCore.ts');
const ET = await load('src/lib/etagCore.ts');
const HP = await load('src/lib/homePrefetchCore.ts');

const NOW = Date.parse('2026-10-26T22:20:00Z'); // 9:20am Sydney, 27 Oct
const iso = (min) => new Date(NOW + min * 60000).toISOString();
const BASE = 'https://api.transportsydney.app';

// ---------- a) device and profile in headers ----------
test('x-serves words: parsed, per server, a rollback turns them off, the config can switch them on', () => {
  assert.deepEqual(SV.parseServes(' id-headers, Trip-Live ,,bad word,id-headers'), ['id-headers', 'trip-live']);
  assert.deepEqual(SV.parseServes(null), []);
  const s = SV.createServes();
  assert.equal(s.has(SV.ID_HEADERS, BASE), false, 'nothing until the server says so');
  assert.equal(s.note(BASE, '/api/departures?stop=1', 200, 'id-headers,trip-live'), true);
  assert.equal(s.has(SV.ID_HEADERS, BASE), true);
  assert.equal(s.has(SV.ID_HEADERS, 'https://other.example'), false, 'per server address');
  assert.equal(s.note(BASE, '/api/departures?stop=1', 500, null), false, 'an error answer says nothing');
  assert.equal(s.note(BASE, '/stations/train.json', 200, null), false, 'a static file says nothing');
  assert.equal(s.has(SV.TRIP_LIVE, BASE), true);
  assert.equal(s.note(BASE, '/api/trip?from=1&to=2', 200, null), true, 'a good answer without the header');
  assert.equal(s.has(SV.TRIP_LIVE, BASE), false, 'a server rolled back is followed');
  assert.equal(s.has(SV.TRIP_LIVE, BASE, SV.configServes({ copy: { serves: ['trip-live'] } })), true);
  assert.deepEqual(SV.configServes({ copy: { serves: 'id-headers, trip-live' } }), ['id-headers', 'trip-live']);
  assert.deepEqual(SV.configServes({ copy: {} }), []);
  const k = SV.createServes(); k.load({ [BASE]: ['id-headers'] });
  assert.equal(k.has(SV.ID_HEADERS, BASE), true, 'kept words count on a cold open');
});

test('ids go in headers only when the server reads them there; the address is then the same for every phone', () => {
  const ids = { device: 'dev-abc', profile: 'p1' };
  const h = SV.placeIds('/api/departures?stop=213510', ids, true);
  assert.equal(h.path, '/api/departures?stop=213510');
  assert.deepEqual(h.headers, { 'x-device': 'dev-abc', 'x-profile': 'p1' });
  const q = SV.placeIds('/api/departures?stop=213510', ids, false);
  assert.equal(q.path, '/api/departures?stop=213510&device=dev-abc&profile=p1');
  assert.deepEqual(q.headers, {});
  assert.equal(SV.placeIds('/api/trip', { device: 'd' }, false).path, '/api/trip?device=d');
  assert.deepEqual(SV.placeIds('/x', undefined, true), { path: '/x', headers: {} });
  const other = SV.placeIds('/api/departures?stop=213510', { device: 'zzz', profile: 'p9' }, true);
  assert.equal(other.path, h.path, 'two phones, one edge cache key');
});

test('api.ts: departures and trips carry ids per server, read x-serves from every answer', () => {
  const a = read('src/lib/api.ts');
  assert.doesNotMatch(a, /\/api\/departures\?\$\{qs\(\{[^}]*device: await getDevice\(\)/, 'no device in the board address');
  assert.doesNotMatch(a, /\/api\/trip\?\$\{qs\(\{[^}]*device: await getDevice\(\)/, 'no device in the trip address');
  assert.doesNotMatch(a, /qs\(\{ device: await getDevice\(\), profile: PROFILE \}\)/, 'no ids glued onto trip and board paths');
  assert.match(a, /placeIds\(path, ids, !!ids && serves\(ID_HEADERS, base\)\)/, 'decided per server address (a fallback server gets the old form)');
  assert.match(a, /noteServes\(base, path, r\.status, r\.headers\?\.get\?\.\(SERVES_HEADER\)\)/);
  assert.match(a, /\/api\/departures\?\$\{qs\(\{ stop, mode: mode \|\| '', refresh: refresh \? 1 : '' \}\)\}`, await withIds\(\)/);
  // Writes keep their ids in the body as before.
  assert.match(a, /body: JSON\.stringify\(\{ device: await getDevice\(\), profile: PROFILE, \.\.\.body \}\)/);
});

// ---------- b) re-timing held trips ----------
const leg = (o) => ({ kind: 'transit', mode: 'train', line: 'T1', durationMin: 20, ...o });
function plan() {
  return {
    kind: 'trip', from: { id: '213510', name: 'Strathfield' }, to: { id: '201110', name: 'Kings Cross' }, now: NOW,
    journeys: [
      { leave: iso(3), board: iso(5), arrive: iso(30), durationMin: 27, changes: 1, live: true, legs: [
        { kind: 'walk', durationMin: 2 },
        leg({ tripId: 'T1.a', stopId: '2135223', toStopId: '200060', planned: iso(5), estimated: iso(6), realtime: true, delayMin: 1, arrPlanned: iso(17), arrEstimated: iso(18) }),
        leg({ tripId: 'T4.b', line: 'T4', stopId: '200061', toStopId: '201110', planned: iso(22), realtime: false, arrPlanned: iso(28) }),
      ] },
      { leave: iso(13), board: iso(15), arrive: iso(40), durationMin: 27, changes: 0, live: false, legs: [
        leg({ tripId: 'T1.c', stopId: '2135223', toStopId: '201110', planned: iso(15), realtime: false, arrPlanned: iso(38) }),
      ] },
    ],
  };
}

test('the legs a refresh sends: tripId@from@to@mode@line, encoded, in requests of at most 12', () => {
  const r = TL.liveRequests(plan());
  assert.equal(r.params.length, 1);
  assert.equal(r.params[0], 'T1.a@2135223@200060@train@T1,T4.b@200061@201110@train@T4,T1.c@2135223@201110@train@T1');
  assert.deepEqual(r.refs[0], [{ j: 0, l: 1 }, { j: 0, l: 2 }, { j: 1, l: 0 }]);
  assert.equal(TL.wireLeg(leg({ tripId: 'a@b,c', stopId: '1', toStopId: '2', line: 'M' })), 'a%40b%2Cc@1@2@train@M');
  const p = plan(); delete p.journeys[1].legs[0].tripId;
  assert.equal(TL.liveRequests(p), null, 'a leg with no trip id: plan again');
  const big = plan(); big.journeys = Array.from({ length: 7 }, () => plan().journeys[0]);
  const rb = TL.liveRequests(big);
  assert.equal(rb.params.length, 2, '14 legs in two requests, a journey never split');
  assert.ok(rb.refs.every((g) => g.length <= TL.LIVE_LEGS_MAX));
  const huge = plan(); huge.journeys = Array.from({ length: 19 }, () => plan().journeys[0]);
  assert.equal(TL.liveRequests(huge), null, 'past three requests: plan again');
});

const ans = (legs) => ({ kind: 'triplive', now: NOW, legs });
test('live times laid over the held plan; a leg with no news shows its timetable time, never the old live one', () => {
  const p = plan();
  const { refs } = TL.liveRequests(p);
  const o = TL.overlayLive(p, refs, [ans([
    { tripId: 'T1.a', stopId: '2135223', realtime: false },
    { tripId: 'T4.b', stopId: '200061', realtime: true, estimated: iso(24), arrEstimated: iso(30), delayMin: 2, vehicle: { lat: 1, lon: 2 }, stopsAway: 3 },
    { tripId: 'T1.c', stopId: '2135223', realtime: true, estimated: iso(16), delayMin: 1 },
  ])], NOW, NOW - 5000);
  assert.equal(o.replan, false);
  const [j0, j1] = o.resp.journeys;
  assert.equal(j0.legs[1].realtime, false);
  assert.equal(j0.legs[1].estimated, undefined, 'the old live time is gone');
  assert.equal(j0.legs[1].delayMin, null);
  assert.equal(j0.legs[2].realtime, true);
  assert.equal(j0.legs[2].estimated, iso(24));
  assert.equal(j0.legs[2].stopsAway, 3);
  assert.equal(j0.legs[2].seenAt, NOW - 5000, 'labelled with when the feed was read');
  assert.equal(j0.board, iso(5), 'boards on the timetable time now');
  assert.equal(j0.leave, iso(3), 'the walk before stays');
  assert.equal(j0.arrive, iso(32), 'live arrival plus the walk after');
  assert.equal(j0.live, true);
  assert.equal(j1.legs[0].arrEstimated, iso(39), 'no live arrival: the planned one moved by the delay');
  assert.equal(j1.board, iso(16));
  assert.equal(o.resp.liveBy, 'trip-live');
  assert.equal(p.journeys[0].legs[1].estimated, iso(6), 'the held plan itself is untouched');
});

test('planned again when a leg is cancelled or skipped, a change breaks, the first trip has gone, or the answer does not match', () => {
  const ok = (o = {}) => [
    { tripId: 'T1.a', stopId: '2135223', realtime: true, estimated: iso(6), ...o },
    { tripId: 'T4.b', stopId: '200061', realtime: false },
    { tripId: 'T1.c', stopId: '2135223', realtime: false },
  ];
  const run = (legs, now = NOW) => { const p = plan(); return TL.overlayLive(p, TL.liveRequests(p).refs, [ans(legs)], now, now); };
  assert.deepEqual(run(ok({ cancelled: true })), { replan: true, why: 'cancelled' });
  assert.deepEqual(run(ok({ skipped: true })), { replan: true, why: 'skipped' });
  assert.deepEqual(run(ok({ estimated: iso(12), arrEstimated: iso(23) })), { replan: true, why: 'connection' });
  assert.deepEqual(run(ok({ tripId: 'T1.zzz' })), { replan: true, why: 'mismatch' });
  assert.deepEqual(run(ok().slice(0, 2)), { replan: true, why: 'mismatch' });
  assert.deepEqual(run(ok(), NOW + 8 * 60000), { replan: true, why: 'gone' });
  assert.equal(run(ok()).replan, false);
});

test('only live planner answers are held as plans, for 10 minutes', () => {
  assert.equal(TL.keepAsPlan(plan()), true);
  assert.equal(TL.keepAsPlan({ ...plan(), source: 'timetable', fallback: 'planner-slow' }), false, 'a slow planner stand in is never re-timed');
  assert.equal(TL.keepAsPlan({ ...plan(), fallback: [true, false] }), false);
  assert.equal(TL.keepAsPlan({ ...plan(), error: 'x' }), false);
  assert.equal(TL.keepAsPlan({ ...plan(), journeys: [] }), false);
  assert.equal(TL.planFresh(NOW - 9 * 60000, NOW), true);
  assert.equal(TL.planFresh(NOW - 10 * 60000, NOW), false);
});

test('api.trip re-times only refreshes of plain trips from now, when served, and falls back to today\'s call', () => {
  const a = read('src/lib/api.ts');
  assert.match(a, /if \(opts\.refresh && plainNow && serves\(TRIP_LIVE, apiBase\(\)\)\) \{/);
  assert.match(a, /const plainNow = !opts\.time && !opts\.arriveBy && !opts\.days && !\(opts\.page && \(opts\.after != null \|\| opts\.before != null\)\);/);
  assert.match(a, /const re = await retime\(kept\.r\)\.catch\(\(\) => null\);\n\s+if \(re\) \{ slowPairs\.delete\(pair\); return re; \}/);
  assert.match(a, /\/api\/trip\/live\?\$\{qs\(\{ legs \}\)\}/);
  assert.match(a, /if \(answers\.some\(\(a\) => !a \|\| \(a as any\)\.kind !== 'triplive'\)\) return null;/);
  assert.match(a, /while \(plans\.size > 8\)/, 'held plans are capped');
});

// ---------- c) version tags ----------
test('version tags: kept with their copy, sent back, capped', () => {
  assert.equal(ET.cleanTag('W/"e12-34"'), 'W/"e12-34"');
  assert.equal(ET.cleanTag('"abc"'), '"abc"');
  assert.equal(ET.cleanTag('abc'), null);
  assert.deepEqual(ET.condHeaders('"abc"'), { 'if-none-match': '"abc"' });
  assert.deepEqual(ET.condHeaders(null), {});
  let idx = {};
  for (let i = 0; i < 20; i++) idx = ET.keepTag(idx, `/k${i}`, `"t${i}"`, 1000, NOW + i).idx;
  assert.equal(Object.keys(idx).length, ET.TAG_MAX_ENTRIES);
  assert.equal(idx['/k0'], undefined, 'oldest dropped first');
  const big = ET.keepTag(idx, '/big', '"b"', ET.TAG_MAX_CHARS + 1, NOW);
  assert.equal(big.idx['/big'], undefined, 'too big is not kept');
  const r = ET.keepTag({}, '/a', '"a"', ET.TAG_MAX_CHARS, NOW);
  const r2 = ET.keepTag(r.idx, '/b', '"b"', ET.TAG_MAX_CHARS, NOW + 1);
  const r3 = ET.keepTag(r2.idx, '/c', '"c"', ET.TAG_MAX_CHARS, NOW + 2);
  assert.ok(Object.values(r3.idx).reduce((s, e) => s + e.n, 0) <= ET.TAG_MAX_TOTAL, 'total capped');
  assert.equal(ET.touchTag(r3.idx, '/c', NOW + 9)['/c'].at, NOW + 9);
  assert.equal(ET.keepTag(r3.idx, '/c', null, 10, NOW).idx['/c'], undefined, 'no tag: not kept');
});

test('a 304 hands back the kept station list; a new answer replaces it', async () => {
  const E = await load('src/lib/etag.ts');
  const calls = [];
  let mode = 'fresh';
  globalThis.fetch = async (url, init) => {
    calls.push({ url, h: (init && init.headers) || {} });
    if (mode === 'same') return { status: 304, ok: false, headers: { get: () => null }, json: async () => ({}) };
    return { status: 200, ok: true, headers: { get: (k) => (k === 'etag' ? '"v1"' : null) }, json: async () => [['2135', 'Strathfield', 1, 2]] };
  };
  const a = await E.getJsonTagged('/api/stations?mode=train', 5000);
  assert.deepEqual(a, [['2135', 'Strathfield', 1, 2]]);
  assert.deepEqual(calls[0].h, {}, 'nothing kept yet: no tag');
  mode = 'same';
  const b = await E.getJsonTagged('/api/stations?mode=train', 5000);
  assert.deepEqual(calls[1].h, { 'if-none-match': '"v1"' });
  assert.deepEqual(b, a, 'the kept copy, nothing downloaded');
});

test('packs, Ask lists and bus stops send their tag and keep their copy on 304', () => {
  const p = read('src/lib/timetablePack.ts');
  assert.match(p, /headers: condHeaders\(old\?\.etag\)/);
  assert.match(p, /if \(r\.status === 304 && old && old\.etag\) \{/);
  assert.match(p, /if \(!packValid\(old\.pack, now\)\) return 'fail';/, 'a 304 never revives an expired pack');
  assert.match(read('src/lib/askPlaces.ts'), /if \(r\.status === 304 && have\) \{ tags\[f\] = have; return \{ same: kept!\.lists\[f\] \}; \}/);
  assert.match(read('src/lib/localSearch.ts'), /if \(r\.status === 304 && tag\) return 'same';/);
  assert.match(read('src/lib/server.ts'), /if \(r\.status === 304 && cond\?\.tag\) \{ words\.reach\(\); return NOT_MODIFIED as T; \}/);
});

// ---------- d) trips via a stop ----------
test('trips via a stop: no forced planner calls, the second part asked early and used only when it covers', async () => {
  const s = read('src/lib/trips.ts');
  const body = s.slice(s.indexOf('export async function planTrip'), s.indexOf('/** Two separately planned parts'));
  assert.doesNotMatch(body, /refresh: true/, 'neither part forces a fresh planner call');
  assert.match(body, /const early = !opts\.time && !opts\.date && !opts\.arriveBy \? viaEarly\(/);
  assert.ok(body.indexOf('const early =') < body.indexOf('const d1 ='), 'the second part starts before the first is awaited');
  assert.match(body, /if \(early && early\.at <= firstArr \+ conn\) \{/, 'never from later than the first part could arrive');
  assert.match(body, /viaCovers\(j1,/);
  assert.match(body, /d2 = viaFresh\(d2, Date\.now\(\)\);/);
});

// viaCovers and viaFresh with a stand in api (trips.ts imports api.ts, which needs the phone, so these run on a copy).
test('viaCovers and viaFresh', async () => {
  const src = read('src/lib/trips.ts').replace(/^import .*$/gm, '');
  const js = ts.transpileModule(`const bestTime = (p, e) => Date.parse(e || p); const ms = (s) => Date.parse(s); const api = {}; const shortName = (s) => s; const getJsonTagged = null; const dateNeeded = () => ''; const ymd = () => '';\n${src}`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, 'trips-copy.mjs');
  fs.writeFileSync(f, js);
  const T = await import(pathToFileURL(f).href);
  const j = (dep, arr) => ({ leave: iso(dep), arrive: iso(arr), legs: [leg({ planned: iso(dep), arrPlanned: iso(arr) })] });
  const j1 = [j(0, 10), j(10, 20)];
  assert.equal(T.viaCovers(j1, [j(16, 30), j(26, 40)], 5 * 60000), true);
  assert.equal(T.viaCovers(j1, [j(16, 30)], 5 * 60000), false, 'the later first part has no second part: ask again from its arrival');
  const r = { kind: 'trip', dataAt: NOW - 20 * 60000, journeys: [{ live: true, legs: [leg({ realtime: true, estimated: iso(2), planned: iso(1) })] }] };
  const f2 = T.viaFresh(r, NOW);
  assert.equal(f2.journeys[0].legs[0].realtime, false, 'a copy over 15 min old is never shown as live');
  assert.equal(f2.journeys[0].legs[0].estimated, undefined);
  assert.equal(f2.journeys[0].live, false);
  const fresh = { ...r, dataAt: NOW - 60000 };
  assert.equal(T.viaFresh(fresh, NOW), fresh, 'a recent copy is passed through as it is');
  assert.equal(T.viaFresh({ ...r, dataAt: NOW - 60000 }, NOW).journeys[0].legs[0].realtime, true, 'a recent copy keeps its live times (labelled by its age)');
});

// ---------- e) Home reads ahead ----------
test('Home reads the top card\'s trip screen only for a plain trip, once per foreground, only on screen and in front', () => {
  const A = { id: '1', name: 'A' }, B = { id: '2', name: 'B' };
  assert.deepEqual(HP.nextTripPlan({ from: A, to: B }, []), { from: A, to: B });
  assert.equal(HP.nextTripPlan({ from: A, to: B, via: { id: '3', name: 'C' } }, []), null);
  assert.equal(HP.nextTripPlan({ from: A, to: B, legs: [{}, {}] }, []), null);
  assert.equal(HP.nextTripPlan({ from: A, to: B }, ['bus']), null, 'mode chips on: the screen asks another way');
  assert.equal(HP.nextTripPlan({ from: A, to: A }, []), null);
  assert.equal(HP.nextTripPlan(null, []), null);
  const once = HP.createForegroundOnce();
  assert.equal(once.take('k'), true);
  assert.equal(once.take('k'), false);
  once.foreground();
  assert.equal(once.take('k'), true);
  assert.equal(HP.mayReadAhead({ focused: true, appState: 'active', hasLists: true }), true);
  assert.equal(HP.mayReadAhead({ focused: true, appState: 'background', hasLists: true }), false);
  assert.equal(HP.mayReadAhead({ focused: true, appState: 'inactive', hasLists: true }), false);
  assert.equal(HP.mayReadAhead({ focused: false, appState: 'active', hasLists: true }), false);
  assert.equal(HP.mayReadAhead({ focused: true, appState: 'active', hasLists: false }), false);
});

test('Home wiring: idle timer on focus, cleared on blur, through the press in gate, no polling', () => {
  const h = read('src/app/(tabs)/home/index.tsx');
  assert.match(h, /useFocusEffect\(useCallback\(\(\) => \{/);
  assert.match(h, /\}, HOME_IDLE_MS\);/);
  assert.match(h, /return \(\) => \{ clearTimeout\(t\);/);
  assert.match(h, /prefetchTripScreen\(aheadPlan, aheadKey, readTripWalk\(sn\.tripWalk, `\$\{aheadPlan\.from\.id\}>\$\{aheadPlan\.to\.id\}`, sn\.walkPref\), AppState\.currentState\)/);
  assert.doesNotMatch(h.slice(h.indexOf('Read ahead')), /setInterval/);
  const p = read('src/lib/prefetch.ts');
  const fn = p.slice(p.indexOf('export function prefetchTripScreen'));
  assert.match(fn, /if \(!homeOnce\.take\(keepKey\)\) return;/);
  assert.match(fn, /if \(!gate\.allow\(keepKey, Date\.now\(\), memAt\(keepKey\)\)\) return;/, 'the same limits as a finger on a row');
  assert.match(fn, /planTrip\(plan, \{ count: 6, walk, page: true, days: true \}\)/, 'the trip screen\'s own first request');
  const t = read('src/app/trip.tsx');
  assert.ok(t.includes("cacheKey('trip', tripCacheId(tripPkey(plan), chain && allOn) + (whenKey ? `|${whenKey}` : '') + (modesKey ? `|m:${modesKey}` : ''))"), 'the screen reads the same key Home keeps');
});
