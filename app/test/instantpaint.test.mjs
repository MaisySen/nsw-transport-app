// Instant paint (30 Oct 2026): trip results paint on the first frame from the phone, placeholders instead of spinners,
// saved trips read ahead within a budget, more kept copies, and Bidur's live trip rules R1 to R6 (instantPaintCore.ts):
// what the phone shows before the live answer is never shown as live, the 5 min live cap stays, gone services drop by
// the phone's clock, live replaces the phone's trips in place, and Start trip arms only from a fresh live answer.
// Pure parts run here; screen wiring is checked in the source. Made up stop ids and times only.
// Run: TZ=Australia/Sydney OFFLINE=1 node --test test/instantpaint.test.mjs
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-instantpaint-'));
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

const IP = await load('src/lib/instantPaintCore.ts');
const O = await load('src/lib/offlineCore.ts');
const LL = await load('src/lib/liveLabelCore.ts');
const SC = await load('src/lib/speedCore.ts');
const HP = await load('src/lib/homePrefetchCore.ts');

const NOW = Date.parse('2026-10-30T07:00:00Z'); // 6 pm Sydney
const MIN = 60000;
const iso = (t) => new Date(t).toISOString();

// A made up direct trip leaving at `dep`, 20 min ride, 3 min walk before, with live fields set like a live answer.
function J(dep, o = {}) {
  const est = dep + (o.late || 0) * MIN;
  const leg = { kind: 'transit', mode: o.mode || 'train', line: o.line || 'X1', tripId: o.tripId || `trip-${dep}`, stopId: '900001', toStopId: '900002',
    from: 'Stop A', to: 'Stop B', planned: iso(dep), estimated: iso(est), arrPlanned: iso(dep + 20 * MIN), arrEstimated: iso(est + 20 * MIN),
    realtime: true, delayMin: o.late || 0, durationMin: 20, seenAt: o.seenAt ?? NOW - 30000, occupancy: 'many', cancelled: !!o.cancelled,
    vehicle: { lat: 0, lon: 0 }, stopsAway: 2, platformChangedFrom: o.moved ? '3' : null };
  return { leave: iso(est - 3 * MIN), board: iso(est), arrive: iso(est + 20 * MIN), durationMin: 23, changes: 0, live: true, anyCancelled: !!o.cancelled,
    warn: o.late ? 'Tight change' : null, legs: [{ kind: 'walk', durationMin: 3 }, leg], seenAt: NOW - 30000 };
}
// The kept copy of "this trip from now", asked `ago` ms before NOW, trips every 10 min for `n` services.
function baseCopy(ago = 10 * MIN, n = 12, extra = {}) {
  const at = NOW - ago;
  const journeys = Array.from({ length: n }, (_, i) => J(at + (i + 1) * 10 * MIN, { late: i % 3 }));
  return { at, data: { kind: 'trip', from: { id: '900001', name: 'Stop A' }, to: { id: '900002', name: 'Stop B' }, journeys, now: at, ...extra } };
}
const W = (anchor, o = {}) => ({ anchor, arriveBy: false, now: NOW, ...o });

test('R1: phone built trips carry timetable times only, never a live field, a delay or a cancelled service', () => {
  const s = IP.tripSeed(baseCopy(), W(NOW + 30 * MIN));
  assert.ok(s && s.data.journeys.length > 0);
  assert.equal(s.data.phoneBuilt, true);
  assert.equal(s.data.seeded, true);
  assert.equal(s.data.source, 'timetable');
  for (const j of s.data.journeys) {
    assert.equal(j.live, false);
    assert.equal(j.warn, undefined, 'no delay warning from old live times');
    const t = j.legs.find((l) => l.kind === 'transit');
    assert.equal(t.realtime, false);
    for (const k of ['estimated', 'arrEstimated', 'vehicle', 'stopsAway', 'occupancy', 'seenAt', 'platformChangedFrom']) assert.equal(t[k], undefined, k);
    assert.equal(t.delayMin, null);
    // Leave, board and arrive are the timetable times (the walk before keeps its 3 minutes).
    assert.equal(j.board, t.planned);
    assert.equal(Date.parse(j.board) - Date.parse(j.leave), 3 * MIN);
    assert.equal(j.arrive, t.arrPlanned);
    // The label the rows draw from (liveLabelCore): Timetable, never Live, never a countdown from a live time.
    const st = LL.liveState({ planned: t.planned, estimated: t.estimated, realtime: t.realtime, seenAt: t.seenAt }, NOW);
    assert.equal(st.kind, 'timetable');
    assert.notEqual(st.label, 'Live');
  }
  // A service the live answer said was cancelled is left out, never shown as running.
  const c = baseCopy(10 * MIN, 6);
  c.data.journeys[3] = J(Date.parse(c.data.journeys[3].legs[1].planned), { cancelled: true });
  const s2 = IP.tripSeed(c, W(NOW));
  assert.ok(s2.data.journeys.every((j) => !j.legs.some((l) => l.cancelled)));
  assert.equal(s2.data.journeys.length, IP.tripSeed(baseCopy(10 * MIN, 6), W(NOW)).data.journeys.length - 1);
  assert.equal(IP.phoneBuiltText(false), 'Timetable times. Getting live times.');
  assert.equal(IP.phoneBuiltText(true), 'Timetable times. Live trips are unavailable right now.');
});

test('R1 exception and R2: a kept live time under 5 min shows with its true age; past the cap it is never live', () => {
  assert.equal(LL.LIVE_MAX_MS, 300000);
  const t = J(NOW + 20 * MIN, { late: 2 }).legs[1];
  const fresh = LL.liveState({ ...t, seenAt: NOW - 3 * MIN }, NOW);
  assert.equal(fresh.kind, 'live');
  assert.ok(fresh.age && /3 min/.test(fresh.age), `true age shown: ${fresh.age}`);
  const old = LL.liveState({ ...t, seenAt: NOW - 6 * MIN }, NOW);
  assert.notEqual(old.kind, 'live');
  assert.equal(old.t, Date.parse(t.planned), 'past the cap the row stands for its timetable time');
});

test('R3: services gone by the phone clock drop before any network answer, kept or phone built', () => {
  const base = baseCopy(30 * MIN);
  const s = IP.tripSeed(base, W(NOW));
  assert.ok(s.data.journeys.every((j) => IP.plannedLeave(j) > NOW));
  // Move the phone clock on 25 min: the next two services are gone from the next paint.
  const later = IP.tripSeed(base, { ...W(NOW + 25 * MIN), now: NOW + 25 * MIN });
  assert.ok(later.data.journeys.every((j) => IP.plannedLeave(j) > NOW + 25 * MIN));
  assert.ok(later.data.journeys.length <= s.data.journeys.length);
  // The kept copy itself is pruned of gone services on every read (offlineCore.prune).
  const kept = O.prune({ kind: 'trip', journeys: [J(NOW - 5 * MIN), J(NOW + 5 * MIN)] }, NOW);
  assert.equal(kept.journeys.length, 1);
});

test('R4: the live answer replaces phone built trips in place: same row keys, same order', () => {
  const base = baseCopy();
  const s = IP.tripSeed(base, W(NOW + 15 * MIN));
  const liveKeys = base.data.journeys.filter((j) => IP.plannedLeave(j) >= NOW + 15 * MIN).map(IP.seedRowKey);
  const seedKeys = s.data.journeys.map(IP.seedRowKey);
  assert.deepEqual(seedKeys, liveKeys.slice(0, seedKeys.length), 'the trip id keys match the live rows');
  const deps = s.data.journeys.map(IP.plannedLeave);
  assert.deepEqual(deps, [...deps].sort((a, b) => a - b));
  assert.ok(s.data.journeys.length <= IP.SEED_MAX);
  // The trip screen keys rows the same way (jKey: trip id, else line and time).
  const trip = read('src/app/trip.tsx');
  assert.match(trip, /const jKey = \(j: Journey\) => \{ const l = firstT\(j\); return l \? l\.tripId \|\| `\$\{l\.line\}\|\$\{l\.planned\}` : String\(j\.leave\); \};/);
});

test('R5: phone built trips are never kept and never seed again; only a copy that covers the moment seeds', () => {
  const s = IP.tripSeed(baseCopy(), W(NOW + 30 * MIN));
  assert.equal(O.worthKeeping(s.data), false, 'never written back as if live');
  assert.equal(IP.tripSeed(s, W(NOW + 30 * MIN)), null, 'a phone built answer never seeds another');
  // Asked before the copy was made: services between could be missing.
  assert.equal(IP.tripSeed(baseCopy(10 * MIN), W(NOW - 20 * MIN)), null);
  // Past the copy's last service.
  assert.equal(IP.tripSeed(baseCopy(10 * MIN, 3), W(NOW + 3 * 3600000)), null);
  // Another mode chip's copy leaves services out; step free must match; errors and old copies never seed.
  assert.equal(IP.tripSeed(baseCopy(10 * MIN, 12, { modes: ['train'] }), W(NOW + 20 * MIN)), null);
  assert.equal(IP.tripSeed(baseCopy(10 * MIN, 12, { modesBy: 'server' }), W(NOW + 20 * MIN)), null);
  assert.equal(IP.tripSeed(baseCopy(), W(NOW + 20 * MIN, { accessible: true })), null);
  assert.ok(IP.tripSeed(baseCopy(10 * MIN, 12, { accessible: true }), W(NOW + 20 * MIN, { accessible: true })));
  assert.equal(IP.tripSeed(baseCopy(10 * MIN, 12, { error: 'x' }), W(NOW + 20 * MIN)), null);
  assert.equal(IP.tripSeed(baseCopy(7 * 3600000, 60), W(NOW)), null);
  assert.equal(IP.tripSeed(null, W(NOW)), null);
  assert.equal(IP.tripSeed({ at: NOW, data: { journeys: 'x' } }, W(NOW)), null);
  // Arrive by: the services that get there by the time, latest last, only when the copy reaches past it.
  const a = IP.tripSeed(baseCopy(), W(NOW + 60 * MIN, { arriveBy: true }));
  assert.ok(a.data.journeys.length > 0);
  assert.ok(a.data.journeys.every((j) => IP.plannedArrive(j) <= NOW + 60 * MIN));
  assert.equal(IP.tripSeed(baseCopy(10 * MIN, 2), W(NOW + 5 * 3600000, { arriveBy: true })), null);
  // speedCore.firstFrame: a seed paints only when there is no kept copy of the search itself and no pack.
  assert.equal(SC.firstFrame(null, null, s, NOW).kind, 'seed');
  const own = { at: NOW - MIN, data: { kind: 'trip', journeys: [J(NOW + 5 * MIN)] } };
  assert.equal(SC.firstFrame(own, null, s, NOW).kind, 'kept');
});

test('R6: Start trip and its Live Activity arm from live times only from a fresh live answer', () => {
  const live = { kind: 'trip', journeys: [J(NOW + 10 * MIN)] };
  assert.equal(IP.armFresh({ data: live, updatedAt: NOW - MIN, offlineAt: null, now: NOW }), true);
  assert.equal(IP.armFresh({ data: live, updatedAt: NOW - 6 * MIN, offlineAt: null, now: NOW }), false, 'older than the live cap');
  assert.equal(IP.armFresh({ data: live, updatedAt: null, staleAt: NOW - MIN, now: NOW }), false, 'a kept copy, live answer still on its way');
  assert.equal(IP.armFresh({ data: live, updatedAt: NOW - MIN, offlineAt: NOW - MIN, now: NOW }), false, 'offline');
  const s = IP.tripSeed(baseCopy(), W(NOW + 30 * MIN));
  assert.equal(IP.armFresh({ data: s.data, updatedAt: NOW, now: NOW }), false, 'phone built');
  const spec = { title: 'A to B', legs: [{ planned: iso(NOW + 10 * MIN), estimated: iso(NOW + 14 * MIN), stopId: '900001' }] };
  assert.equal(IP.armSpec(spec, true), spec);
  const tt = IP.armSpec(spec, false);
  assert.equal(tt.legs[0].estimated, undefined);
  assert.equal(tt.legs[0].planned, spec.legs[0].planned);
  assert.equal(spec.legs[0].estimated, iso(NOW + 14 * MIN), 'the spec on screen is not changed');
  const trip = read('src/app/trip.tsx');
  assert.match(trip, /startLive\(armSpec\(spec, fresh\), j\.fare\)/);
  assert.match(trip, /fresh=\{armFresh\(\{ data, updatedAt, offlineAt, staleAt, now \}\)\}/);
});

test('paint first: the trip screen seeds from the phone, draws placeholder rows, never a spinner', () => {
  const trip = read('src/app/trip.tsx');
  assert.ok(!/ActivityIndicator/.test(trip), 'no spinner on the trip screen');
  const srch = trip.slice(trip.indexOf('function Searching('), trip.indexOf('function TimetableFirstNote('));
  assert.match(srch, /<SkeletonRows count=\{4\}/);
  // The seed: only the kept copy of the same trip from now, read from memory (no request, no storage wait).
  assert.match(trip, /const seedKey = pageable && \(whenKey \|\| modesKey\) \? cacheKey\('trip', tripCacheId\(tripPkey\(plan\), false\)\) : '';/);
  assert.match(trip, /return tripSeed\(peekOffline\(seedKey\), \{ anchor: whenAt\(when, t\), arriveBy: when\.kind === 'arrive', now: t, accessible: accOn \}\);/);
  assert.match(trip, /seed: tripSeedNow(, early: ttFirstAsk)? \}\);/);
  // No extra page or batch request while phone built trips are on screen (battery: the live answer is on its way).
  assert.match(trip, /const loadLater = async \(\) => \{\n    \/\/ [^\n]*\n    if \(isPhoneBuilt\(data\)\) return;/);
  assert.match(trip, /const loadEarlier = async \(\) => \{\n    if \(isPhoneBuilt\(data\)\) return;/);
  assert.match(trip, /isPhoneBuilt\(data\) \? <TimetableFirstNote text=\{phoneBuiltText\(!!error \|\| !!offlineAt\)\} \/>/);
  // The stop screen: placeholder rows for a board on its way, no spinner on an empty screen.
  const stop = read('src/app/stop/[id].tsx');
  assert.match(stop, /\{!data && !error \? <SkeletonRows count=\{5\}/);
  assert.ok(!/!data && !error && at != null \? <View style=\{\{ alignItems: 'center', marginTop: 24 \}\}><ActivityIndicator/.test(stop));
  // useLive paints a seed on the first frame and on every change of the search (hooks.ts).
  const hooks = read('src/lib/hooks.ts');
  assert.match(hooks, /firstFrame<T>\(key \? peekOffline<T>\(key\) : null, pk \? peekPackBoard\(pk\.stop, pk\.mode, pk\.at\) : null, seedRef\.current, Date\.now\(\)\)/);
});

test('prefetch budget: at most 4 trip screens per foreground, only old or missing copies, never in the background', () => {
  assert.equal(HP.READ_AHEAD_MAX, 4);
  const P = (id) => ({ id, name: `Stop ${id}` });
  const trips = [
    { from: P('1'), to: P('2') }, { from: P('1'), to: P('2') }, { from: P('3'), to: P('4'), via: P('9') },
    { from: P('5'), to: P('6') }, { from: P('7'), to: P('8') }, { from: P('10'), to: P('11') }, { from: P('12'), to: P('13') }, { from: P('14'), to: P('14') },
  ];
  const plans = HP.readAheadPlans(trips, (pair) => (pair === '5>6' ? ['bus'] : null));
  assert.deepEqual(plans.map((x) => `${x.from.id}>${x.to.id}`), ['1>2', '7>8', '10>11', '12>13']);
  assert.equal(HP.readAheadPlans(trips, () => null, 2).length, 2);
  assert.equal(HP.readAheadDue(null, NOW), true);
  assert.equal(HP.readAheadDue(NOW - 9 * MIN, NOW), false);
  assert.equal(HP.readAheadDue(NOW - 10 * MIN, NOW), true);
  const home = read('src/app/(tabs)/home/index.tsx');
  assert.match(home, /\.slice\(0, READ_AHEAD_MAX - \(aheadPlan \? 1 : 0\)\)/);
  assert.match(home, /if \(readAheadDue\(keptAt\(moreKeys\[i\]\), t0\)\) prefetchTripScreen\(x, moreKeys\[i\]/);
  // Same slot as before: after HOME_IDLE_MS, on an idle callback where there is one, only on view and in front.
  const block = home.slice(home.indexOf('const morePlans'), home.indexOf('}, [aheadKey, moreKeys'));
  assert.match(block, /mayReadAhead\(\{ focused: true, appState: AppState\.currentState, hasLists: !!d \}\)/);
  assert.match(block, /\}, HOME_IDLE_MS\);/);
  assert.ok(!/setInterval|BackgroundFetch|TaskManager/.test(block));
  // Each read still goes through the once per foreground and press in limits (prefetch.ts).
  const pf = read('src/lib/prefetch.ts');
  const fn = pf.slice(pf.indexOf('export function prefetchTripScreen'), pf.indexOf('export function keptAt'));
  assert.match(fn, /if \(!mayReadAhead\(/);
  assert.match(fn, /if \(!homeOnce\.take\(keepKey\)\) return;/);
  assert.match(fn, /if \(!gate\.allow\(keepKey, Date\.now\(\), memAt\(keepKey\)\)\) return;/);
  // More kept copies on the phone.
  assert.equal(O.MAX_ENTRIES, 64);
});

test('OTA safe for builds 201 to 208: the new module has no native or phone dependency', () => {
  const core = read('src/lib/instantPaintCore.ts');
  const imports = [...core.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./liveLabelCore', './types']);
  for (const f of ['src/lib/instantPaintCore.ts', 'src/lib/homePrefetchCore.ts']) {
    const s = read(f);
    assert.ok(!/requireNativeModule|NativeModules|expo-|react-native/.test(s.replace(/^\/\/.*$/gm, '')), `${f} stays JavaScript only`);
  }
});
