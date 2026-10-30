// Trip progress, arrival time and changes on a live trip follow realtime and your location, never the timetable alone
// (liveCalc.ts computeLive, stepLive; platform/tripCard.ts). Cases from across NSW: trains, metro, a ferry to a light
// rail change, buses. Each run is the /api/service answer an older server gives, whose next stop follows the clock over
// live and timetable times alike, unless the case says otherwise.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-track-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const live = await load('src/lib/liveCalc.ts');
const { cardFor } = await load('platform/tripCard.ts');

const T0 = Date.parse('2026-10-27T21:00:00Z');
const at = (m) => T0 + m * 60000;
const iso = (t) => new Date(t).toISOString();
const hm = (t) => new Date(t + 11 * 3600000).toISOString().slice(11, 16);
const fmt = { clock: hm, short: (s) => String(s || '').replace(/ Station$/, ''), plat: (p) => p || '' };

/**
 * A run: stops are [name, timetable minute, lat, lon, live delay in minutes or null when the feed has no news for it].
 * clock: the next stop follows the clock over each stop's own live time or its timetable time (an older server).
 */
function run(id, stops, mine, off, t, o = {}) {
  const st = stops.map(([name, m, lat, lon, dl], k) => ({ id: id + k, name: name + ' Station', lat, lon, planned: iso(at(m)),
    ...(dl != null ? { estimated: iso(at(m + dl)) } : {}), mine: k === mine, alight: k === off }));
  let nextIndex = o.nextIndex;
  if (nextIndex == null) { nextIndex = st.findIndex((s) => Date.parse(s.estimated || s.planned) >= t - 20000); if (nextIndex < 0) nextIndex = st.length; }
  const d = { kind: 'service', tripId: id, live: !!st[mine]?.estimated, stops: st, mineIndex: mine, alightIndex: off, nextIndex };
  if (o.vehicle) d.vehicle = { lat: o.vehicle[0], lon: o.vehicle[1], ageS: o.vehicleAge ?? 20 };
  if (o.progress) d.progress = o.progress;
  return d;
}
const leg = (id, line, mode, stops, mine, off, extra = {}) => ({ mode, line, tripId: id, stopId: id + mine, toStopId: id + off,
  from: stops[mine][0] + ' Station', to: stops[off][0] + ' Station', planned: iso(at(stops[mine][1])), arrPlanned: iso(at(stops[off][1])), ...extra });
const withDelay = (stops, list) => stops.map((s, k) => [s[0], s[1], s[2], s[3], list[k] ?? null]);

// T8 Glenfield to Wolli Creek, change to a T4 to Hurstville (4 min planned to change).
const T8 = [['Glenfield', 0, -33.9719, 150.8924], ['East Hills', 10, -33.9617, 150.9887], ['Revesby', 14, -33.9523, 151.0145], ['Turrella', 24, -33.9295, 151.1414], ['Wolli Creek', 28, -33.9286, 151.1545]];
const T4 = [['Wolli Creek', 32, -33.9289, 151.1550], ['Rockdale', 36, -33.9524, 151.1371], ['Kogarah', 38, -33.9632, 151.1335], ['Hurstville', 42, -33.9675, 151.1022]];
const t8legs = [leg('T8a', 'T8', 'train', T8, 0, 4, { fromPlatform: 'Platform 1' }), leg('T4a', 'T4', 'train', T4, 0, 3, { fromPlatform: 'Platform 3' })];
// F1 Manly to Circular Quay, then the L2 to Randwick (5 min planned to change, 2 min walk).
const F1 = [['Manly Wharf', 0, -33.8003, 151.2841], ['Circular Quay Wharf', 18, -33.8611, 151.2108]];
const L2 = [['Circular Quay', 23, -33.8616, 151.2105], ['Bridge Street', 25, -33.8635, 151.2094], ['Central Chalmers Street', 36, -33.8845, 151.2065], ['Randwick', 50, -33.9156, 151.2412]];
const ferryLegs = [leg('F1a', 'F1', 'ferry', F1, 0, 1), leg('L2a', 'L2', 'lightrail', L2, 0, 3, { walkBefore: 2 })];
// 610X bus Castle Hill to Wynyard.
const B610 = [['Castle Hill', 0, -33.7316, 151.0045], ['Baulkham Hills', 8, -33.7612, 150.9927], ['North Sydney', 38, -33.8394, 151.2072], ['Wynyard', 45, -33.8662, 151.2061]];
const busLegs = [leg('B610a', '610X', 'bus', B610, 0, 3)];
// M1 Tallawong to Chatswood.
const M1 = [['Tallawong', 0, -33.6914, 150.9061], ['Norwest', 12, -33.7314, 150.9600], ['Epping', 24, -33.7727, 151.0822], ['Macquarie Park', 28, -33.7787, 151.1235], ['Chatswood', 37, -33.7968, 151.1806]];
const metroLegs = [leg('M1a', 'M1', 'metro', M1, 0, 4)];

function replay(legs, svcAt, from, to, step = 0.5, posAt = () => null, g0 = {}) {
  let g = { id: 'trip', legs, alerted: {}, watchId: null, share: null, ...g0 };
  const log = [];
  for (let m = from; m <= to + 1e-9; m += step) {
    const t = at(m);
    const r = live.stepLive(g, svcAt(t, m), t, fmt, posAt(m));
    g = r.g;
    log.push({ m, s: r.s, alerts: r.actions.filter((a) => a.t === 'alert').map((a) => a.title), ongoing: r.actions.find((a) => a.t === 'ongoing') });
  }
  return { g, log };
}
const firstAlert = (log, re) => log.find((x) => x.alerts.some((a) => re.test(a)));

test('a T8 9 minutes late whose stop off has no live time of its own: arrival and ETA move with it', () => {
  // The feed knows the delay at Glenfield and East Hills only; Wolli Creek keeps its timetable time.
  const t = at(12);
  const s = live.computeLive(t8legs, [run('T8a', withDelay(T8, [9, 9]), 0, 4, t), run('T4a', withDelay(T4, [0, 0, 0, 0]), 0, 3, t)], t);
  assert.equal(s.done, false);
  assert.equal(s.cur, 0);
  assert.equal(s.L2[0].arr, at(28 + 9), 'Wolli Creek: timetable time plus the 9 minutes carried on');
  assert.equal(s.L2[0].arrLive, true);
  assert.equal(s.delayMin, 9);
  assert.notEqual(s.track, 'timetable');
});

test('the delayed T8: the planned T4 change is flagged as a miss straight away, with the arrival never earlier than you can get there', () => {
  const t = at(12);
  const s = live.computeLive(t8legs, [run('T8a', withDelay(T8, [9, 9]), 0, 4, t), run('T4a', withDelay(T4, [0, 0, 0, 0]), 0, 3, t)], t);
  assert.equal(s.conns[0].risk, 'miss');
  assert.ok(s.conns[0].spare < 0);
  assert.equal(s.etaLate, true);
  assert.ok(s.eta >= at(42 + 5), 'never the planned arrival');
});

test('the delayed T8 replayed: "Connection at risk" once, "Next stop: Wolli Creek, change here" only when the train is really due', () => {
  const { log } = replay(t8legs, (t) => [run('T8a', withDelay(T8, [9, 9]), 0, 4, t), run('T4a', withDelay(T4, [0, 0, 0, 0]), 0, 3, t)], -2, 40);
  const risk = log.filter((x) => x.alerts.includes('Connection at risk'));
  assert.equal(risk.length, 1);
  const change = firstAlert(log, /^Next stop: Wolli Creek, change here/);
  assert.ok(change, 'the change alert comes');
  assert.ok(change.m >= 24 + 9, `not before the late train reaches Turrella (came at minute ${change.m})`);
  // Still on the T8 at the timetable arrival time and well after it.
  for (const x of log.filter((y) => y.m >= 28 && y.m < 37)) assert.equal(x.s.done ? -1 : x.s.cur, 0, `minute ${x.m}`);
});

test('a missed change, seen on live times: after you get off at Wolli Creek the T4 you missed neither counts down nor ends the trip', () => {
  const t = at(38);
  const s = live.computeLive(t8legs, [run('T8a', withDelay(T8, [9, 9, 9, 9, 9]), 0, 4, t), run('T4a', withDelay(T4, [0, 0, 0, 0]), 0, 3, t)], t, { here: { 0: at(37) } });
  assert.equal(s.done, false);
  assert.equal(s.cur, 1);
  assert.equal(s.L2[1].missed, true);
  assert.equal(s.phase, 'wait');
  assert.equal(s.conns[0].risk, 'miss');
  assert.ok(s.eta > at(42), 'arrival later than the missed T4 would have been');
});

test('a ferry 7 minutes late into Circular Quay: the L2 change is at risk and the card says so', () => {
  const t = at(10);
  const legsF = ferryLegs;
  const s = live.computeLive(legsF, [run('F1a', withDelay(F1, [7, 7]), 0, 1, t, { nextIndex: 1 }), run('L2a', withDelay(L2, [0, 0, 0, 0]), 0, 3, t)], t);
  assert.equal(s.conns[0].risk, 'miss', '25 min arrival + 2 min walk is after the 23 min L2');
  const c = cardFor({ legs: legsF, to: { id: 'x', name: 'Randwick' } }, s, t);
  assert.match(c.warning, /^You'll likely miss the \d{1,2}:\d\d[ap]m L2$/);
});

test('a ferry 2 minutes late: the L2 change stays on, and the ETA is the L2 arrival', () => {
  const t = at(10);
  const s = live.computeLive(ferryLegs, [run('F1a', withDelay(F1, [2, 2]), 0, 1, t, { nextIndex: 1 }), run('L2a', withDelay(L2, [0, 0, 0, 0]), 0, 3, t)], t);
  assert.notEqual(s.conns[0].risk, 'miss');
  assert.equal(s.eta, at(50));
  assert.equal(s.etaLate, undefined);
});

test('no realtime on a 610X: riding by the clock reads "not live", with no next stop and no stops left', () => {
  const t = at(20);
  const s = live.computeLive(busLegs, [run('B610a', B610.map((x) => [...x, null]), 0, 3, t)], t);
  assert.equal(s.done, false);
  assert.equal(s.phase, 'ride');
  assert.equal(s.track, 'timetable');
  assert.equal(s.stopsLeft, null);
  assert.equal(s.delayMin, null);
  const w = live.liveWords(busLegs, s, t, fmt);
  assert.match(w.body, /^Not live, running to timetable: due at Wynyard \d\d:\d\d\./);
});

test('no realtime on a 610X: the timetable arrival passes and the trip does not end or say "You\'ve arrived"', () => {
  const { log, g } = replay(busLegs, (t) => [run('B610a', B610.map((x) => [...x, null]), 0, 3, t)], 0, 70);
  assert.ok(log.every((x) => !x.s.done), 'still on the bus 25 minutes past the timetable arrival');
  assert.ok(log.every((x) => !x.alerts.some((a) => /arrived|Next stop/.test(a))));
  assert.equal(g.arrivedAt, undefined);
  assert.deepEqual(g.rode || {}, {}, 'a timetable time is never remembered as a ride');
});

test('no realtime and no service answer at all: the leg stays on and the card says "Timetable times, not live"', () => {
  const t = at(60);
  const s = live.computeLive(busLegs, [null], t);
  assert.equal(s.done, false);
  assert.equal(s.track, 'timetable');
  const c = cardFor({ legs: busLegs, to: { id: 'x', name: 'Wynyard' } }, s, t);
  assert.equal(c.warning, 'Timetable times, not live');
  assert.equal(c.nextStop, null);
  assert.ok(c.progress <= 0.9);
});

test('no realtime: your tap ("I\'m at Wynyard") ends the trip at that moment', () => {
  const t = at(50);
  const s = live.computeLive(busLegs, [run('B610a', B610.map((x) => [...x, null]), 0, 3, t)], t, { here: { 0: at(49) } });
  assert.equal(s.done, true);
  assert.equal(s.eta, at(49));
});

test('no realtime on a two leg trip: the change is never assumed made by the clock', () => {
  const { log } = replay(t8legs, (t) => [run('T8a', T8.map((x) => [...x, null]), 0, 4, t), run('T4a', T4.map((x) => [...x, null]), 0, 3, t)], 0, 50, 1);
  assert.ok(log.every((x) => !x.s.done && x.s.cur === 0), 'stays on the T8 with nothing to go on');
  assert.ok(!firstAlert(log, /change here/));
});

test('GPS arrival on the M1 with no live times: your location at Chatswood ends the trip and is remembered', () => {
  const pos = (m) => (m >= 39 ? { lat: -33.7970, lon: 151.1810, acc: 30, at: at(m) } : null);
  const { log, g } = replay(metroLegs, (t) => [run('M1a', M1.map((x) => [...x, null]), 0, 4, t)], 30, 41, 1, pos);
  const done = log.find((x) => x.s.done);
  assert.ok(done && done.m === 39, 'done the moment the location shows Chatswood');
  assert.equal(g.here[0], at(39));
  // Location off afterwards: the trip stays ended.
  const s = live.computeLive(metroLegs, [run('M1a', M1.map((x) => [...x, null]), 0, 4, at(45))], at(45), { here: g.here });
  assert.equal(s.done, true);
});

test('GPS before your stop holds the leg, even when the live arrival time has passed', () => {
  // Live times say Chatswood at minute 37, but you are still at Epping.
  const t = at(40);
  const pos = { lat: -33.7729, lon: 151.0825, acc: 40, at: t - 10000 };
  const s = live.computeLive(metroLegs, [run('M1a', withDelay(M1, [0, 0, 0, 0, 0]), 0, 4, t)], t, null, pos);
  assert.equal(s.done, false);
  assert.equal(s.L2[0].gpsBefore, true);
});

test('a stale or rough GPS fix is ignored', () => {
  const t = at(40);
  const old = { lat: -33.7970, lon: 151.1810, acc: 30, at: t - 5 * 60000 };
  const rough = { lat: -33.7970, lon: 151.1810, acc: 1500, at: t };
  for (const p of [old, rough]) {
    const s = live.computeLive(metroLegs, [run('M1a', M1.map((x) => [...x, null]), 0, 4, t)], t, null, p);
    assert.equal(s.done, false);
  }
});

test('GPS at the change station with no stop list for the leg: being at the next leg\'s boarding stop ends it', () => {
  const t = at(30);
  const pos = { lat: -33.9288, lon: 151.1548, acc: 50, at: t };
  const s = live.computeLive(t8legs, [null, run('T4a', withDelay(T4, [0, 0, 0, 0]), 0, 3, t)], t, null, pos);
  assert.equal(s.done, false);
  assert.equal(s.cur, 1);
  assert.equal(s.phase, 'wait');
});

test('a fresh vehicle position short of your stop wins over a clock that has moved on', () => {
  // The server's next stop says Wynyard (the clock), the bus is at Baulkham Hills.
  const t = at(44);
  const s = live.computeLive(busLegs, [run('B610a', B610.map((x) => [...x, null]), 0, 3, t, { nextIndex: 3, vehicle: [-33.7612, 150.9927] })], t);
  assert.equal(s.track, 'vehicle');
  assert.equal(s.nextIdx, 1);
  assert.equal(s.stopsLeft, 3);
  const a = live.tripAlerts(busLegs, s, {}, false, fmt);
  assert.ok(!a.some((x) => /Next stop/.test(x.title)));
});

test('a server that says its next stop is only the timetable clock is not trusted for "change here"', () => {
  const t = at(27);
  const d = run('T8a', T8.map((x) => [...x, null]), 0, 4, t, { progress: 'timetable', nextIndex: 4 });
  const s = live.computeLive(t8legs, [d, run('T4a', T4.map((x) => [...x, null]), 0, 3, t)], t);
  assert.equal(s.track, 'timetable');
  const a = live.tripAlerts(t8legs, s, {}, false, fmt);
  assert.ok(!a.some((x) => /change here/.test(x.title)));
  const say = live.speechCues(t8legs, s, t, fmt);
  assert.ok(!say.some((x) => /Change here/.test(x.text)));
});

test('the delay shows on the leg: notification and card say how late', () => {
  const t = at(16);
  const s = live.computeLive(busLegs, [run('B610a', withDelay(B610, [6, 6]), 0, 3, t)], t);
  assert.equal(s.phase, 'ride');
  assert.equal(s.delayMin, 6);
  assert.match(live.liveWords(busLegs, s, t, fmt).body, /6 min late\./);
  const c = cardFor({ legs: busLegs, to: { id: 'x', name: 'Wynyard' } }, s, t);
  assert.equal(c.warning, '6 min late');
  assert.equal(c.legArrives, at(45 + 6));
});

test('carriedDelay and liveAt follow GTFS realtime: the latest delay before a stop carries on', () => {
  const d = run('x', withDelay(M1, [null, 3, null, 5, null]), 0, 4, at(0));
  assert.equal(live.carriedDelay(d, 0), 3 * 60000, 'nothing before: the first live time after');
  assert.equal(live.carriedDelay(d, 2), 3 * 60000);
  assert.equal(live.carriedDelay(d, 4), 5 * 60000);
  assert.equal(live.liveAt(d, 4), at(37 + 5));
  assert.equal(live.carriedDelay(run('x', M1.map((x) => [...x, null]), 0, 4, at(0)), 4), null);
});

test('rode is only kept from live data, so a missed change is never judged on a timetable arrival', () => {
  const t = at(20);
  const s1 = live.computeLive(busLegs, [run('B610a', B610.map((x) => [...x, null]), 0, 3, t)], t);
  assert.deepEqual(live.nextMemo({}, s1, t).rode, {});
  const s2 = live.computeLive(busLegs, [run('B610a', withDelay(B610, [4, 4]), 0, 3, t)], t);
  assert.equal(live.nextMemo({}, s2, t).rode[0], at(45 + 4));
});

test('owner case, 26 Oct 2026: the 8:46 T1 from Parramatta P4 running 37 min late, trip id ending at Central, change at Milsons Point', () => {
  // GTFS 150F.1324.165.12.A.8.92003946 ends at Central; Milsons Point is on the next trip, so the feed has no time for it.
  const STR = [['Parramatta', 0, -33.8717, 151.0944], ['Hornsby', 10.7, -33.8917, 151.1986], ['Central', 13, -33.8832, 151.2063], ['Milsons Point', 16.6, -33.8733, 151.2069]];
  const ESL = [['Milsons Point', 20, -33.8736, 151.2072], ['Martin Place', 22, -33.8679, 151.2111], ['Edgecliff', 27, -33.8794, 151.2363], ['Bondi Junction', 30, -33.8914, 151.2478]];
  const legsO = [leg('T1a', 'T1', 'train', STR, 0, 3, { fromPlatform: 'Platform 4' }), leg('T4o', 'T4', 'train', ESL, 0, 3, { fromPlatform: 'Platform 5' })];
  const svcAt = (t) => [run('T1a', withDelay(STR, [37, 37, 37, null]), 0, 3, t), run('T4o', withDelay(ESL, [0, 0, 0, 0]), 0, 3, t)];
  // Location: on the train, near Hornsby at what was the timetable Milsons Point arrival.
  const pos = (m) => (m >= 16 && m <= 30 ? { lat: -33.8905, lon: 151.1950, acc: 60, at: at(m) } : null);
  const { log } = replay(legsO, svcAt, -1, 52, 0.5, pos);
  const x0 = log.find((x) => x.m === 5);
  assert.equal(x0.s.eta > at(30 + 30), true, 'the ETA moves from the timetable arrival');
  assert.ok(log.filter((x) => x.m <= 50).every((x) => !x.s.done && x.s.cur === 0), 'never at Milsons Point before the late train gets there');
  const change = firstAlert(log, /change here/);
  assert.ok(!change || change.m >= 13 + 37, `"change here" not before the train nears Milsons Point (minute ${change && change.m})`);
  assert.ok(firstAlert(log, /^Connection at risk/), 'the planned T4 is flagged as missed');
});
