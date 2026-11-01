// 2 Nov 2026 (Bidur's first real build 214 trip, B1): a phone that woke 3 min after the change posted "Connection at
// risk" for the 4:52 change he had already made. The server watch owned the trip's alerts (trip flow 2), the change's
// departure had already gone, the trip flow knew the next leg had left, and the first leg's stop off had dropped out
// of the feed, which held its arrival 30 s ahead of now. Generic stops (no real stations); failing first on 30319ea.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linkTs } from './tsLink.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require(path.join(here, '..', 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-connrisk-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, linkTs(js, out, ts));
  return import(pathToFileURL(f).href);
}
const live = await load('src/lib/liveCalc.ts');
const tsx = await load('src/lib/tripState.ts');

const T0 = Date.parse('2026-11-01T17:26:00Z'); // leg 1 planned departure
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();
const legs = [
  { mode: 'train', line: 'L1', tripId: 'RUN.A', stopId: 'AAA0', toStopId: 'HUB2', from: 'Aston Station', to: 'Hub Station', planned: iso(at(0)), arrPlanned: iso(at(16.6)), estimated: iso(at(0)), fromPlatform: 'Platform 4', toPlatform: 'Platform 3' },
  { mode: 'train', line: 'L2', tripId: 'RUN.B', stopId: 'HUB5', toStopId: 'END2', from: 'Hub Station', to: 'End Station', planned: iso(at(26)), arrPlanned: iso(at(30)), estimated: iso(at(26)), fromPlatform: 'Platform 5', toPlatform: 'Platform 2' },
];
// Leg 1's answer 3 min after the change: the stop off has dropped out of the feed (passed), only later stops carry the
// run's delay, and the asked trip id has no vehicle any more (the run carries on under another id).
const svc0 = (progress) => ({ kind: 'service', live: true, line: 'L1', mode: 'train', tripId: 'RUN.A', mineIndex: 0, alightIndex: 2, nextIndex: 3,
  ...(progress ? { progress } : {}),
  stops: [
    { id: 'AAA0', name: 'Aston Station', planned: iso(at(0)), estimated: null, passed: true },
    { id: 'MID1', name: 'Mid Station', planned: iso(at(12)), estimated: null, passed: true },
    { id: 'HUB2', name: 'Hub Station', planned: iso(at(16.6)), estimated: null, passed: true },
    { id: 'NXT3', name: 'Next Station', planned: iso(at(30)), estimated: iso(at(35.5)), passed: false },
  ] });
// Leg 2's answer: on time, its train has left the change stop (the rider is on it).
const svc1 = { kind: 'service', live: true, line: 'L2', mode: 'train', tripId: 'RUN.B', mineIndex: 0, alightIndex: 2, nextIndex: 2,
  stops: [
    { id: 'HUB5', name: 'Hub Station', planned: iso(at(26)), estimated: iso(at(26)), passed: true },
    { id: 'MDL1', name: 'Middle Station', planned: iso(at(28)), estimated: iso(at(28)), passed: true },
    { id: 'END2', name: 'End Station', planned: iso(at(30)), estimated: iso(at(30)), passed: false },
  ] };
const t = at(29.25); // 3 min 15 s after the change train left
const F = { clock: (x) => new Date(x).toISOString().slice(11, 16), short: (n) => String(n || '').replace(/ Station$/, ''), plat: (p) => String(p || '') };
const connOf = (r) => r.actions.filter((a) => a.t === 'alert' && String(a.key).startsWith('conn'));
const trip = (o = {}) => ({ id: 'x', legs, watchId: null, started: at(3.8), rode: {}, here: {}, alerted: {}, speak: false, ...o });

test('B1 (a): with the server watch on (trip flow 2), the phone posts no change alert of its own', () => {
  const r = live.stepLive(trip({ watchId: 'srv-watch' }), [svc0(), svc1], t, F, null, null, { asOf: t, c24: false });
  assert.equal(connOf(r).length, 0, connOf(r).map((a) => a.title + ' | ' + a.body).join('\n'));
});

test('B1 (b): no server watch, the change train already gone: no "Connection at risk" for a departure in the past', () => {
  const r = live.stepLive(trip(), [svc0(), svc1], t, F, null, null, { asOf: t, c24: false });
  assert.equal(connOf(r).length, 0, connOf(r).map((a) => a.title + ' | ' + a.body).join('\n'));
});

test('B1 (b): the older path (no trip flow) also posts nothing for a change whose departure has gone', () => {
  const r = live.stepLive(trip(), [svc0(), svc1], t, F, null, null, null);
  assert.equal(connOf(r).length, 0, connOf(r).map((a) => a.title + ' | ' + a.body).join('\n'));
});

test('B1 (c): on wake the trip flow memory (leg 1 arrived, leg 2 left) is used, not the feed: the trip is on leg 2', () => {
  const plan = tsx.tripPlanFrom(legs, [svc0(), svc1]);
  const M = tsx.newTripMemory(plan);
  M.legs[0].phase = tsx.PHASE_INDEX.arrived; M.legs[0].arrivedAt = at(21.75); M.legs[0].arrivedTime = at(21.75);
  M.legs[1].phase = tsx.PHASE_INDEX.onTheWay; M.legs[1].phaseAt = { waiting: null, due: at(26), left: at(26.5), onTheWay: at(26.5) };
  M.current = 1;
  const r = live.stepLive(trip({ flow: M }), [svc0(), svc1], t, F, null, null, { asOf: t, c24: false });
  assert.equal(r.s.cur, 1, 'on the second leg, as the trip flow says');
  assert.notEqual(r.g.rode?.[0], t + 30000, 'the first leg is not held 30 s ahead of now');
  assert.equal(connOf(r).length, 0);
});

test('B1 (c): a fresh answer whose feed has dropped the stop off (a later stop has its own live time) ends the leg, no hold to now + 30 s', () => {
  for (const p of [undefined, 'live']) {
    const s = live.computeLive(legs, [svc0(p), svc1], t, {}, null, { asOf: t });
    assert.equal(s.cur, 1, 'leg 1 is over: the feed lists only stops after its stop off');
    assert.notEqual(s.L2[0].arr, t + 30000);
    const m = live.nextMemo({}, s, t);
    assert.ok(m.here && m.here[0] <= t, 'kept as over (memo here), at the live arrival');
  }
});

test('B1 (c) kept: without the feed\'s own evidence past the stop off the arrival is still held 30 s ahead', () => {
  // a carried time is not the stop's own: the train is past it when a later stop has its own
  const car = svc0('live');
  car.stops[2] = { ...car.stops[2], estimated: iso(at(22.1)), carried: true };
  car.stops[3] = { ...car.stops[3], carried: true };
  const s2 = live.computeLive(legs, [car, svc1], t, {}, null, { asOf: t });
  assert.equal(s2.cur, 0, 'no later stop with its own time: held as before');
  // an old answer is not evidence
  const s3 = live.computeLive(legs, [svc0('live'), svc1], t, {}, null, { asOf: t - 5 * 60000 });
  assert.notEqual(s3.cur, 1);
});

test('B1 (c): the hold stops 10 min after the live arrival, as heldArrival does', () => {
  const t2 = at(16.6 + 5.5 + 10.5); // over 10 min past the carried live arrival
  const s = live.computeLive(legs, [svc0(), svc1], t2, {}, null, { asOf: t2 });
  assert.ok(!(s.L2[0].arr === t2 + 30000), 'not held past 10 min');
});

// Kept: the phone still warns about a real missed change when no server watches the trip.
test('kept: no server watch, still riding leg 1, live times say the change will be missed before it leaves: one alert', () => {
  const t3 = at(20);
  const a = { kind: 'service', live: true, line: 'L1', mode: 'train', tripId: 'RUN.A', mineIndex: 0, alightIndex: 2, nextIndex: 1, progress: 'live',
    stops: [
      { id: 'AAA0', name: 'Aston Station', planned: iso(at(0)), estimated: iso(at(9)), passed: true },
      { id: 'MID1', name: 'Mid Station', planned: iso(at(12)), estimated: iso(at(21)), passed: false },
      { id: 'HUB2', name: 'Hub Station', planned: iso(at(16.6)), estimated: iso(at(27)), passed: false },
    ] };
  const b = { kind: 'service', live: true, line: 'L2', mode: 'train', tripId: 'RUN.B', mineIndex: 0, alightIndex: 2, nextIndex: 0,
    stops: [
      { id: 'HUB5', name: 'Hub Station', planned: iso(at(26)), estimated: iso(at(26)), passed: false },
      { id: 'MDL1', name: 'Middle Station', planned: iso(at(28)), estimated: iso(at(28)), passed: false },
      { id: 'END2', name: 'End Station', planned: iso(at(30)), estimated: iso(at(30)), passed: false },
    ] };
  const r = live.stepLive(trip(), [a, b], t3, F, null, null, { asOf: t3, c24: false });
  const c = connOf(r);
  assert.equal(c.length, 1);
  assert.equal(c[0].title, 'Connection at risk');
  const r2 = live.stepLive(trip(), [a, b], t3, F, null, null, null);
  assert.equal(connOf(r2).length, 1, 'the older path too');
  const r3 = live.stepLive(trip({ watchId: 'srv' }), [a, b], t3, F, null, null, { asOf: t3, c24: false });
  assert.equal(connOf(r3).length, 0, 'but never while the server watches the trip');
});
