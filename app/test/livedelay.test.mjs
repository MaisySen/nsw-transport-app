// Live times on the trip card and screen: realtime over the timetable, a train that is late but not there yet, tight
// and missed changes, and a card that says when its times are from. The case is Bidur's trip on 25 Oct 2026:
// Chatswood to Epping on a T1 that ran 4 minutes late, then a T4 to Milsons Point with 4 minutes planned to change.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-delay-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, linkTs(js, out, ts));
  return import(pathToFileURL(f).href);
}
const live = await load('src/lib/liveCalc.ts');
const { cardFor, cardWarning, staleAt } = await load('platform/tripCard.ts');

// 25 Oct 2026, 8:10am Sydney.
const T0 = Date.parse('2026-10-24T21:10:00Z');
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();
const sec = (t) => new Date(t).toISOString().slice(11, 19);

// T1: Chatswood 8:10, Epping 8:22. T4: Epping 8:26, Milsons Point 8:36.
const T1 = { line: 'T1', stops: [['Lidcombe', -6, -33.865, 151.047], ['Chatswood', 0, -33.8713, 151.0941], ['Epping', 12, -33.8919, 151.1982], ['Central', 15, -33.8832, 151.2063]], mine: 1, off: 2 };
const T4 = { line: 'T4', stops: [['Sydenham', 22, -33.9149, 151.1677], ['Epping', 16, -33.8923, 151.1993], ['Central', 18, -33.8832, 151.2063], ['Martin Place', 21, -33.8679, 151.2111], ['Milsons Point', 26, -33.8742, 151.2218]], mine: 1, off: 4 };
T4.stops[0][1] = 13;
const legs = [
  { mode: 'train', line: 'T1', tripId: 'T1.a', stopId: 'STR', toStopId: 'RDF', from: 'Chatswood Station', to: 'Epping Station', planned: iso(at(0)), arrPlanned: iso(at(12)), fromPlatform: 'Platform 2', towards: 'Central Station', color: '#F99D1C' },
  { mode: 'train', line: 'T4', tripId: 'T4.a', stopId: 'RDF11', toStopId: 'KXS', from: 'Epping Station', to: 'Milsons Point Station', planned: iso(at(16)), arrPlanned: iso(at(26)), fromPlatform: 'Platform 11', towards: 'Bondi Junction Station', color: '#005AA3' },
];
const trip = { legs, to: { id: 'KXS', name: 'Milsons Point Station, Potts Point' } };

/**
 * /api/service for a run at time t. delay: minutes the feed knows about. lag: minutes the train is really behind the
 * feed's times (the feed does not know). clockNext: the stop list's next stop follows the feed's clock, as the server
 * does when it has no trip update. vehicle: true puts the train where it really is.
 */
function feed(run, t, { delay = 0, lag = 0, vehicle = false, shift = 0 } = {}) {
  const stops = run.stops.map(([name, m, lat, lon], k) => ({ id: name.slice(0, 3).toUpperCase() + k, name: name + ' Station', lat, lon,
    planned: iso(at(m + shift)), estimated: iso(at(m + shift + delay)), mine: k === run.mine, alight: k === run.off }));
  let nextIndex = stops.findIndex((s) => Date.parse(s.estimated) > t - 20000);
  if (nextIndex < 0) nextIndex = stops.length;
  stops.forEach((s, i) => { s.passed = i < nextIndex; });
  let veh;
  if (vehicle) {
    // Really: the train runs delay + lag minutes behind the timetable. Put it between the stops it is between.
    const real = (m) => at(m + shift + delay + lag);
    let k = run.stops.findIndex(([, m]) => real(m) > t);
    if (k <= 0) k = Math.max(1, k < 0 ? run.stops.length - 1 : 1);
    const [, m0, la0, lo0] = run.stops[k - 1], [, m1, la1, lo1] = run.stops[k];
    const f = Math.min(1, Math.max(0, (t - real(m0)) / (real(m1) - real(m0))));
    veh = { lat: la0 + (la1 - la0) * f, lon: lo0 + (lo1 - lo0) * f, ageS: 20 };
  }
  return { kind: 'service', live: true, line: run.line, mode: 'train', tripId: run === T1 ? 'T1.a' : 'T4.a', mineIndex: run.mine, alightIndex: run.off, nextIndex, stops, ...(veh ? { vehicle: veh } : {}) };
}

test('realtime first: a T1 4 min late counts to 8:26 at Epping, and a 0 minute change is tight', () => {
  const t = at(5);
  const s = live.computeLive(legs, [feed(T1, t, { delay: 4 }), feed(T4, t)], t, { rode: { 0: at(16) } });
  assert.equal(s.done, false);
  assert.equal(s.cur, 0);
  assert.equal(sec(s.L2[0].arr), sec(at(16)), 'T1 arrival is the estimate, not the timetable 8:22');
  assert.equal(s.conns[0].risk, 'tight');
  const c = cardFor(trip, s, t);
  assert.equal(c.legArrives, at(16));
  assert.equal(c.warning, 'Tight change at Epping');
  assert.equal(c.destination, 'Milsons Point', 'no "Station", no suburb');
  assert.equal(c.arrival, at(26), 'the T4 is still catchable, so 8:36 stands');
});

test('timetable only when there are no live times', () => {
  const t = at(5);
  const s = live.computeLive(legs, [null, null], t);
  assert.equal(sec(s.L2[0].arr), sec(at(12)));
  assert.equal(s.eta, at(26));
});

test('the T4 leaving before the T1 gets in: change at risk, and the arrival moves later', () => {
  const t = at(5);
  const s = live.computeLive(legs, [feed(T1, t, { delay: 6 }), feed(T4, t)], t);
  assert.equal(s.conns[0].risk, 'miss');
  assert.equal(s.etaLate, true);
  assert.equal(s.eta, at(28), 'at least as late as the T1 is short of the T4');
  const c = cardFor(trip, s, t);
  assert.match(c.warning, /^You'll likely miss the 8:26am T4$/);
  // With the next service found for the change, the card names it and arrives with it.
  const alt = { line: 'T4', dep: at(21), arr: at(31) };
  const c2 = cardFor(trip, s, t, { alt });
  assert.equal(c2.warning, 'Change at risk. Next T4 8:31am');
  assert.equal(c2.arrival, at(31));
});

test('25 Oct, 8:24am: the stop list moved past Epping by the clock, the train had not; the card stays on the T1', () => {
  // The feed has no delay for the T1 (estimates are the timetable), so its next stop passes Epping at 8:22:20.
  // The train is really 4 minutes behind, and its position says so.
  const t = at(14);
  const f1 = feed(T1, t, { delay: 0, lag: 4, vehicle: true });
  assert.ok(f1.nextIndex > f1.alightIndex, 'the stop list alone says the T1 is past Epping');
  const s = live.computeLive(legs, [f1, feed(T4, t)], t, { rode: { 0: at(12) } });
  assert.equal(s.cur, 0, 'still on the T1, not "T4 leaves 8:26am"');
  assert.equal(s.phase, 'ride');
  assert.ok(s.L2[0].arr >= t + 30000, 'counts to a time still ahead, never "Get off now" before the train is there');
  const c = cardFor(trip, s, t);
  assert.equal(c.line, 'T1');
  assert.equal(c.getOffAt, 'Epping');
  // Without the train's position the stop list is all there is.
  const s2 = live.computeLive(legs, [feed(T1, t), feed(T4, t)], t, { rode: { 0: at(12) } });
  assert.equal(s2.cur, 1);
});

test('a live feed that still shows the train before your stop holds the arrival 30 s ahead once the estimate is 30 s old', () => {
  const d = feed(T1, at(16.75), { delay: 4 });
  d.nextIndex = 2; d.stops[2].passed = false;
  assert.equal(live.heldArrival(d, 2, at(16), at(16.25)), at(16), 'under 30 s past the estimate it stands (feeds lag)');
  assert.equal(live.heldArrival(d, 2, at(16), at(17)), at(17) + 30000);
  d.nextIndex = 3; d.stops[2].passed = true;
  assert.equal(live.heldArrival(d, 2, at(16), at(17)), at(16), 'at or past the stop: the real time');
  assert.equal(live.heldArrival({ ...d, live: false, nextIndex: 2 }, 2, at(16), at(17)), at(16), 'no live data: nothing to go on');
});

test('vehicleShort: only a fresh position clearly before the stop', () => {
  const d = feed(T1, at(6), { vehicle: true });
  assert.equal(live.vehicleShort(d, 1, 2), true, 'halfway to Epping');
  const near = { ...d, vehicle: { lat: -33.8918, lon: 151.1975, ageS: 10 } };
  assert.equal(live.vehicleShort(near, 1, 2), false, 'at Epping');
  const old = { ...d, vehicle: { ...d.vehicle, ageS: 400 } };
  assert.equal(live.vehicleShort(old, 1, 2), false, 'position too old');
  assert.equal(live.vehicleShort({ ...d, vehicle: undefined }, 1, 2), false);
});

test('a change already missed: no countdown to the train that left, and the trip does not end with it', () => {
  // The T1 got to Epping at 8:29 (rode records it); the T4 left at 8:26.
  const t = at(20);
  const f4 = feed(T4, t);
  // Phase 2: a leg ends on evidence only (the train seen at Epping, kept as memo.here), not 45 s after rode by the clock.
  const s = live.computeLive(legs, [null, f4], t, { rode: { 0: at(19) }, here: { 0: at(19) } });
  assert.equal(s.done, false);
  assert.equal(s.cur, 1);
  assert.equal(s.phase, 'wait');
  assert.equal(s.L2[1].missed, true);
  assert.equal(s.conns[0].risk, 'miss');
  assert.equal(s.conns[0].nextDep, at(16));
  const c = cardFor(trip, s, t);
  assert.equal(c.departs, null, 'no made up departure');
  assert.match(c.warning, /miss the 8:26am T4/);
  const c2 = cardFor(trip, s, t, { alt: { line: 'T4', dep: at(23), arr: at(33) } });
  assert.equal(c2.departs, at(23));
  assert.equal(c2.arrival, at(33));
  // When the missed T4 reaches Milsons Point the trip is still on.
  const t2 = at(27);
  const s2 = live.computeLive(legs, [null, feed(T4, t2)], t2, { rode: { 0: at(19) } });
  assert.equal(s2.done, false);
  const w = live.liveWords(legs, s, t, { clock: (x) => sec(x), short: (n) => String(n).replace(/ Station$/, ''), plat: (p) => p });
  assert.match(w.title, /Change at risk at Epping/);
});

test('the card says when its times are from once the app cannot refresh it', () => {
  const t = at(5);
  const s = live.computeLive(legs, [feed(T1, t, { delay: 4 }), feed(T4, t)], t);
  const c = cardFor(trip, s, t, { asOf: at(5) });
  assert.equal(c.warning, 'Tight change at Epping. Updated 8:15am');
  assert.equal(cardWarning(null, null, at(11)), 'Updated 8:21am. Open the app for live times');
  assert.equal(cardWarning(null, null, null), null);
  const c2 = cardFor(trip, live.computeLive(legs, [feed(T1, t), feed(T4, t)], t), t, { updated: at(5) });
  assert.equal(c2.updated, at(5));
});

test('stale date: builds up to 204 keep the arrival rule, the honest card goes stale 2 min after its live times', () => {
  const t = at(5);
  const c = cardFor(trip, live.computeLive(legs, [feed(T1, t), feed(T4, t)], t), t);
  assert.equal(staleAt(c, at(5), false), c.arrival + 120000);
  assert.equal(staleAt(c, at(5), true), at(7));
  assert.equal(staleAt(c, null, true), c.arrival + 120000);
  assert.equal(staleAt({ ...c, phase: 'arrived' }, at(5), true), null);
});
