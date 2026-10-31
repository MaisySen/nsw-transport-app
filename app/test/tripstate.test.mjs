// app/src/lib/tripState.ts on the app's real data shapes: the three feed shapes that gave the 7:48 card on 31 Oct
// (docs/TRIP_FLOW_SPEC.md section 0) must all give one live departure, delay and arrival from the same reading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require(path.join(here, '..', 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-shapes-'));
const src = fs.readFileSync(path.join(here, '..', 'src', 'lib', 'tripState.ts'), 'utf8');
fs.writeFileSync(path.join(out, 'tripState.mjs'), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const T = await import(pathToFileURL(path.join(out, 'tripState.mjs')).href);

const at = (hm) => Date.parse(`2026-10-31T${hm}+11:00`);
const iso = (hm) => new Date(at(hm)).toISOString();
// sample stations (the owner's own are kept out of most tests)
const leg = { mode: 'train', line: 'T1', tripId: 'T1-1950', stopId: 'LID7', toStopId: 'CLY', from: 'Lidcombe Station', to: 'Clyde Station', planned: iso('19:50:00'), arrPlanned: iso('19:55:00'), fromPlatform: 'Platform 7' };
const stops = (o = {}) => [
  { id: 'LID7', name: 'Lidcombe Station', planned: iso('19:50:00'), platform: 'Platform 7', ...(o.lid || {}) },
  { id: 'AUB', name: 'Auburn Station', planned: iso('19:53:00'), ...(o.aub || {}) },
  { id: 'CLY', name: 'Clyde Station', planned: iso('19:55:00'), ...(o.cly || {}) },
];
const svc = (o = {}) => ({ kind: 'service', tripId: 'T1-1950', line: 'T1', live: false, stops: stops(o), mineIndex: 0, alightIndex: 2, ...(o.d || {}) });
function stateAt(w, d, now, asOf = now, o = {}) {
  const plan = T.tripPlanFrom([w], [svc()]);
  const M = T.newTripMemory(plan);
  const snap = T.tripReadingFrom(plan, [w], [d], asOf, o);
  return { tm: T.tripLegTimes(plan, M, snap, 0, now), r: T.tripRender(plan, M, snap, now) };
}
const card748 = (s) => ({ status: s.r.status, warn: s.r.warn, arrive: s.r.arrive, timer: s.r.timer });
const want748 = { status: 'Leaves 7:54pm · Platform 7', warn: '4 min late', arrive: 'Arrive Clyde 7:59pm', timer: at('19:54:00') };

test('shape (a): no live time in the answer, the planner estimate 4 min late: departure, delay and arrival all 4 min late', () => {
  const s = stateAt({ ...leg, estimated: iso('19:54:00') }, svc(), at('19:48:00'), at('19:48:00'), { plannerAt: at('19:46:00') });
  assert.deepEqual(card748(s), want748);
  assert.equal(s.tm.dep.source, 'run');
  assert.equal(s.tm.dep.asOf, at('19:46:00'));
});
test('shape (a): the planner estimate ages out after 5 min and the card says timetable, never a live-looking 7:50 with a delay', () => {
  const s = stateAt({ ...leg, estimated: iso('19:54:00') }, svc(), at('19:51:30'), at('19:51:30'), { plannerAt: at('19:46:00') });
  assert.equal(s.r.status, 'Leaves 7:50pm · Platform 7');
  assert.equal(s.r.warn, 'Timetable time');
  assert.equal(s.r.delayShown, null);
});
test('shape (b): only later stops have live times: the delay is carried back to the boarding stop', () => {
  const s = stateAt(leg, svc({ aub: { estimated: iso('19:57:00') }, cly: { estimated: iso('19:59:00') }, d: { live: true } }), at('19:48:00'));
  assert.deepEqual(card748(s), want748);
  assert.equal(s.tm.dep.source, 'run');
  assert.equal(s.tm.arr.source, 'stop');
});
test('shape (b): times the server carried on (stop.carried) are run times, not the stop\'s own', () => {
  const s = stateAt(leg, svc({ lid: { estimated: iso('19:54:00'), carried: true }, aub: { estimated: iso('19:57:00'), carried: true }, cly: { estimated: iso('19:59:00'), carried: true }, d: { live: true } }), at('19:48:00'));
  assert.deepEqual(card748(s), want748);
  assert.equal(s.tm.dep.source, 'run');
});
test('shape (c): the boarding stop not matched by index is matched by name', () => {
  const d = svc({ lid: { id: 'X1', name: 'Lidcombe Station, Platform 7', estimated: iso('19:54:00') }, aub: { estimated: iso('19:57:00') }, cly: { id: 'X3', estimated: iso('19:59:00') }, d: { live: true, mineIndex: undefined, alightIndex: undefined } });
  const s = stateAt(leg, d, at('19:48:00'));
  assert.deepEqual(card748(s), want748);
  assert.equal(s.tm.dep.source, 'stop');
});
test('shape (c): an answer for another run is timetable only and says so; no phase can move on it', () => {
  const d = { kind: 'service', live: true, stops: [{ id: 'Q1', name: 'Somewhere Station', planned: iso('19:40:00'), estimated: iso('19:44:00') }, { id: 'Q2', name: 'Elsewhere Station', planned: iso('19:45:00'), estimated: iso('19:49:00') }] };
  const s = stateAt(leg, d, at('19:48:00'));
  assert.equal(s.r.status, 'Timetable 7:50pm · Platform 7');
  assert.equal(s.r.sub, 'No live data for this service');
  assert.equal(s.r.timer, null);
});
test('the stop\'s own live time wins over the run and the board; the board wins over the run at the boarding stop', () => {
  const d = svc({ lid: { estimated: iso('19:53:00') }, cly: { estimated: iso('19:59:00') }, d: { live: true } });
  assert.equal(stateAt(leg, d, at('19:48:00')).tm.dep.at, at('19:53:00'));
  const d2 = svc({ cly: { estimated: iso('19:59:00') }, d: { live: true } });
  const s = stateAt(leg, d2, at('19:48:00'), at('19:48:00'), { boards: [{ planned: iso('19:50:00'), estimated: iso('19:55:00'), realtime: true, tripId: 'T1-1950' }] });
  assert.equal(s.tm.dep.source, 'board');
  assert.equal(s.tm.dep.at, at('19:55:00'));
});
test('a vehicle position under 150 m from a stop is at it; half way between two stops it has left the first', () => {
  const xy = { lid: { lat: -33.86, lon: 151.03 }, aub: { lat: -33.85, lon: 151.03 }, cly: { lat: -33.84, lon: 151.03 } };
  const base = { lid: { ...xy.lid }, aub: { ...xy.aub }, cly: { ...xy.cly } };
  const plan = T.tripPlanFrom([leg], [svc(base)]);
  const atStop = T.tripReadingFrom(plan, [leg], [svc({ ...base, d: { live: true, vehicle: { lat: -33.8601, lon: 151.0301, ageS: 5 } } })], at('19:50:00'));
  assert.deepEqual(atStop.legs[0].vehicle, { stop: 0, state: 'at', at: at('19:50:00') - 5000 });
  const between = T.tripReadingFrom(plan, [leg], [svc({ ...base, d: { live: true, vehicle: { lat: -33.855, lon: 151.03, ageS: 0 } } })], at('19:51:00'));
  assert.deepEqual(between.legs[0].vehicle, { stop: 0, state: 'left', at: at('19:51:00') });
  const old = T.tripReadingFrom(plan, [leg], [svc({ ...base, d: { live: true, vehicle: { lat: -33.855, lon: 151.03, ageS: 400 } } })], at('19:51:00'));
  assert.equal(old.legs[0].vehicle, null);
});
test('24 hour phones get 24 hour words; Due never counts to 0:00', () => {
  const plan = T.tripPlanFrom([leg], [svc()]);
  const M = T.newTripMemory(plan);
  const snap = T.tripReadingFrom(plan, [leg], [svc({ lid: { estimated: iso('19:54:00') }, cly: { estimated: iso('19:59:00') }, d: { live: true } })], at('19:54:05'));
  const r = T.tripRender(plan, M, snap, at('19:54:10'), { c24: true });
  assert.equal(r.status, 'Due now · Platform 7');
  assert.equal(r.timer, null);
  assert.equal(r.arrive, 'Arrive Clyde 19:59');
  assert.equal(T.tripClock(at('07:05:00'), true), '07:05');
  assert.equal(T.tripClock(at('00:05:00'), false), '12:05am');
});
test('voice: never in the first 10 s or the first two refreshes, never on Silent, never from an old reading, one queue', () => {
  const t = at('19:58:30');
  const v = { open: true, silent: false, openSince: t - 60000, refreshes: 5, speakingUntil: 0 };
  assert.equal(T.voiceGate(v, t, 'Get off now for Clyde.', 5000, false).words, 'Get off now for Clyde.');
  assert.match(T.voiceGate({ ...v, openSince: t - 5000 }, t, 'x', 0, false).why, /V1/);
  assert.match(T.voiceGate({ ...v, refreshes: 2 }, t, 'x', 0, false).why, /V4/);
  assert.match(T.voiceGate({ ...v, silent: true }, t, 'x', 0, false).why, /Silent/);
  assert.match(T.voiceGate(v, t, 'x', 61000, false).why, /V2/);
  assert.equal(T.voiceGate(v, t, 'x', 61000, true).words, 'x');
  assert.match(T.voiceGate({ ...v, speakingUntil: t + 31000 }, t, 'x', 0, false).why, /V5/);
  assert.equal(T.voiceGate({ ...v, speakingUntil: t + 3000 }, t, 'x', 0, false).start, t + 3000);
});
test('the module is pure: no runtime imports, no clock, no timers', () => {
  assert.ok(!/^import (?!type )/m.test(src));
  assert.ok(!/Date\.now\(|new Date\(\)|setTimeout|setInterval/.test(src));
});

test('31 Oct live: the stop off row carries its departure (30 s dwell): the stop\'s own delay goes on the arrival you get off at, as the server card has it', () => {
  // the run lists Clyde's departure 7:55:30 with the train 4 min late there (7:59:30); you arrive 7:55 planned, so 7:59
  const d = svc({ lid: { estimated: iso('19:54:00') }, cly: { planned: iso('19:55:30'), estimated: iso('19:59:30') }, d: { live: true } });
  const s = stateAt(leg, d, at('19:48:00'));
  assert.equal(s.tm.arr.at, at('19:59:00'), 'arrival 7:55 + 4 min, not the row\'s departure 7:59:30');
  assert.equal(s.tm.arr.source, 'stop');
  assert.equal(s.tm.dep.at, at('19:54:00'));
  // a row for another visit (more than 3 min apart) keeps its own time
  const far = svc({ cly: { planned: iso('20:05:00'), estimated: iso('20:06:00') }, d: { live: true } });
  assert.equal(stateAt(leg, far, at('19:48:00')).tm.arr.at, at('20:06:00'));
});

test('1 Nov live: a position-only feed heading to your stop under 1.5 km out gives the arrival from the position when the feed\'s is later (as the server card)', () => {
  // Clyde at -33.83, 151.02; the train 406 m short of it, between Auburn and Clyde, 30 s old; the stop says 7:59
  const geo = { lid: { lat: -33.8649, lon: 151.0471, estimated: iso('19:54:00') }, aub: { lat: -33.8492, lon: 151.0329, estimated: iso('19:57:00') }, cly: { lat: -33.8350, lon: 151.0180, estimated: iso('19:59:00') } };
  const k = 406 / 2050, vlat = -33.8350 + (-33.8492 + 33.8350) * k, vlon = 151.0180 + (151.0329 - 151.0180) * k;
  const d = svc({ ...geo, d: { live: true, vehicle: { lat: vlat, lon: vlon, ageS: 30, stopId: 'Auburn.X Loc' } } });
  const s = stateAt(leg, d, at('19:57:30'), at('19:57:30'));
  const want = at('19:57:00') + 45000 + 40 * 406;
  assert.ok(Math.abs(s.tm.arr.at - want) < 3000, `arrival from the position, got ${new Date(s.tm.arr.at).toISOString()}`);
  // a feed with stop ids (the vehicle names one of the stops) keeps the stop's time
  const d2 = svc({ ...geo, d: { live: true, vehicle: { lat: vlat, lon: vlon, ageS: 30, stopId: 'AUB' } } });
  assert.equal(stateAt(leg, d2, at('19:57:30'), at('19:57:30')).tm.arr.at, at('19:59:00'));
});
