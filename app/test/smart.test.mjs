// Tests for the "it just knows" set: the commute direction, Leave in N min, Wake me before my stop (replayed with
// a fake clock on Burwood to Strathfield and a 3 stop trip, with the phone's own alarm simulated), and the next
// option after a missed change. Run: node --test test/
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-smart-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const live = await load('src/lib/liveCalc.ts');
const smart = await load('src/lib/smart.ts');
const format = await load('src/lib/format.ts');
const short = (n) => String(n || '').replace(/ Station$/, '');
const fmt = { clock: format.clock, short, plat: (p) => (p ? p.replace(/^Platform\s*/i, 'Platform ') : '') };

// Saturday 24 Oct 2026, 10:00pm Sydney (AEDT, UTC+11).
const T0 = Date.parse('2026-10-24T11:00:00Z');
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();
const syd = (hhmm, day = '2026-10-26') => Date.parse(`${day}T${hhmm}:00+11:00`);

// ---------- 1 and 2: setup and the commute card ----------

test('commute flips by time of day in Sydney: Home to Work before 12pm, Work to Home after', () => {
  assert.equal(smart.commuteDir(syd('07:30'), false), 'toWork');
  assert.equal(smart.commuteDir(syd('11:59'), false), 'toWork');
  assert.equal(smart.commuteDir(syd('12:00'), false), 'toHome');
  assert.equal(smart.commuteDir(syd('17:45'), false), 'toHome');
  assert.equal(smart.commuteDir(syd('00:30'), false), 'toWork');
  // A swap shows the other direction.
  assert.equal(smart.commuteDir(syd('07:30'), true), 'toHome');
  assert.equal(smart.commuteDir(syd('17:45'), true), 'toWork');
});

test('a swap lasts until the next 12: the half day key changes at noon and at midnight, Sydney time', () => {
  assert.equal(smart.halfDayKey(syd('09:00')), '2026-10-26 am');
  assert.equal(smart.halfDayKey(syd('11:59')), '2026-10-26 am');
  assert.equal(smart.halfDayKey(syd('12:00')), '2026-10-26 pm');
  assert.equal(smart.halfDayKey(syd('23:59')), '2026-10-26 pm');
  assert.equal(smart.halfDayKey(syd('00:01', '2026-10-27')), '2026-10-27 am');
  assert.equal(smart.sydHHMM(syd('07:05')), '0705');
  assert.equal(smart.sydHHMM(syd('23:40')), '2340');
});

// ---------- 3: Leave now ----------

// Burwood Station platform area, and a spot 750 m south of it.
const BWD = { lat: -33.8773, lon: 151.1037 };
const south = (m) => ({ lat: BWD.lat - m / 111195, lon: BWD.lon });
const jny = (depMin, { line = 'T1', late = 0, cancelled = false, path = [[BWD.lat, BWD.lon], [-33.8760, 151.0900]] } = {}) => ({
  leave: iso(at(depMin + late)), board: iso(at(depMin + late)), arrive: iso(at(depMin + late + 4)), durationMin: 4, changes: 0, live: true,
  legs: [{ kind: 'transit', mode: 'train', line, from: 'Burwood Station', fromPlatform: 'Platform 2', to: 'Strathfield Station', planned: iso(at(depMin)), estimated: iso(at(depMin + late)), realtime: true, cancelled, durationMin: 4, path }],
});

test('walking time is a straight line at 5 km/h, rounded up', () => {
  assert.equal(Math.round(smart.distM(BWD, south(750))), 750);
  assert.equal(smart.walkMin(BWD, south(750)), 9); // 750 m at 83.3 m a minute
  assert.equal(smart.walkMin(BWD, south(1000)), 12);
  assert.equal(smart.walkMin(BWD, BWD), 1);
});

test('Leave in N min: the first service you can still reach, its live time, walk plus a minute for the platform', () => {
  const now = at(0);
  const js = [jny(5), jny(15, { late: 2 }), jny(30)];
  const p = smart.leavePlan(js, now, south(750));
  // 5 min train: leave by 5 - 9 - 1 = 5 min ago, can't make it. Next: 15 min, 2 late, so 17 - 10 = leave in 7 min.
  assert.equal(p.index, 1);
  assert.equal(p.walk, 9);
  assert.equal(p.dep, at(17));
  assert.equal(p.leaveAt, at(7));
  assert.equal(p.inMin, 7);
  assert.equal(smart.leaveWords(p), 'Leave in 7 min');
  // At the leave time it says Leave now.
  const p2 = smart.leavePlan(js, at(7), south(750));
  assert.equal(smart.leaveWords(p2), 'Leave now');
  // A cancelled service is skipped.
  assert.equal(smart.leavePlan([jny(15, { cancelled: true }), jny(30)], now, south(750)).index, 1);
});

test('Leave line hides when location is not known, the walk is over 25 min, or nothing has a path', () => {
  const js = [jny(15), jny(30)];
  assert.equal(smart.leavePlan(js, at(0), null), null, 'no location (denied or not asked)');
  assert.equal(smart.leavePlan(js, at(0), south(5000)), null, '5 km away is not a walk to the station');
  assert.equal(smart.leavePlan([jny(15, { path: null })], at(0), south(500)), null);
});

test('busy hour: every loaded service leaves before you could walk there, so the card asks again from when you could board', () => {
  // Trains 2 minutes apart, a 9 minute walk: none of the next three is reachable, and leavePlan alone shows nothing.
  const js = [jny(2), jny(4), jny(6)];
  assert.equal(smart.leavePlan(js, at(0), south(750)), null);
  assert.equal(smart.reachFrom(js, at(0), south(750)), at(10), 'walk 9 plus a minute for the platform');
  // With the later answer added, the leave line shows the first one you can make.
  const p = smart.leavePlan([...js, jny(10), jny(12)], at(0), south(750));
  assert.equal(p.dep, at(10));
  assert.equal(smart.leaveWords(p), 'Leave now');
  // No second ask when a loaded service is reachable, the walk is too long, or the location is unknown.
  assert.equal(smart.reachFrom([jny(2), jny(15)], at(0), south(750)), null);
  assert.equal(smart.reachFrom(js, at(0), south(5000)), null);
  assert.equal(smart.reachFrom(js, at(0), null), null);
  assert.equal(smart.reachFrom([], at(0), south(750)), null);
});

// ---------- 4: Wake me before my stop ----------

// Live feed for a run of stops: timetable minutes from T0, a delay, and the next stop not yet reached.
function feed(run, delay, t) {
  const stops = run.stops.map(([name, m], k) => ({ id: name.slice(0, 3).toUpperCase() + k, name: name + ' Station', planned: iso(at(m)), estimated: iso(at(m) + delay * 60000), mine: k === run.mine, alight: k === run.off }));
  let nextIndex = stops.findIndex((s) => Date.parse(s.estimated) > t - 20000);
  if (nextIndex < 0) nextIndex = stops.length;
  return { kind: 'service', live: true, line: run.line, mode: 'train', mineIndex: run.mine, alightIndex: run.off, nextIndex, stops };
}
// Burwood to Strathfield, one stop.
const T1s = { line: 'T1', stops: [['Croydon', -2], ['Burwood', 0], ['Strathfield', 3], ['Homebush', 5]], mine: 1, off: 2 };
const legBS = { mode: 'train', line: 'T1', tripId: 'T1.short', stopId: 'BWD', toStopId: 'STR', from: 'Burwood Station', to: 'Strathfield Station', planned: iso(at(0)), arrPlanned: iso(at(3)), fromPlatform: 'Platform 2', towards: 'Penrith Station' };
// A 3 stop trip: Ashfield to Strathfield via Croydon and Burwood.
const T1three = { line: 'T1', stops: [['Summer Hill', -2], ['Ashfield', 0], ['Croydon', 3], ['Burwood', 5], ['Strathfield', 8], ['Homebush', 10]], mine: 1, off: 4 };
const legAS = { mode: 'train', line: 'T1', tripId: 'T1.three', stopId: 'ASH', toStopId: 'STR', from: 'Ashfield Station', to: 'Strathfield Station', planned: iso(at(0)), arrPlanned: iso(at(8)), fromPlatform: 'Platform 3', towards: 'Penrith Station' };

/**
 * Replays a trip with Wake me on, refreshing every 15 s like the app. The phone side is simulated: a scheduled
 * alarm rings at its time unless cancelled or moved; a "ring now" is skipped if that alarm already rang (the app
 * checks the presented notifications). `appOpen` false means the app sleeps and only the phone's alarm can ring.
 * Returns every ring with its time.
 */
function wakeReplay({ run, leg, delay = 0, lateDelay = null, lateFrom = -3, wakeFrom = -5, appOpen = true, offAt = null }) {
  let g = { id: 'g1', legs: [leg], alerted: {}, watchId: null, share: null, wake: false, wakeSet: {} };
  const alarms = new Map(); // id -> at
  const rang = [];
  const presented = new Set();
  const cancels = [];
  const schedules = [];
  let ended = false;
  for (let t = at(-5); t <= at(30) && !ended; t += 15000) {
    // The phone's own alarms ring when their time comes, app open or not.
    for (const [id, when] of [...alarms]) if (when <= t) { rang.push({ id, t: when, by: 'phone' }); presented.add(id); alarms.delete(id); }
    if (t >= at(wakeFrom) && !g.wake && (offAt == null || t < at(offAt))) g = { ...g, wake: true };
    if (offAt != null && t >= at(offAt)) g = { ...g, wake: false };
    if (!appOpen && t > at(-5) + 15000) continue; // only the first refresh ran, then the phone slept
    const d = lateDelay != null && t >= at(lateFrom) ? lateDelay : delay;
    const svc = [feed(run, d, t)];
    const r = live.stepLive(g, svc, t, fmt);
    const w = smart.wakeStep({ ...r.g, wake: g.wake, wakeSet: g.wakeSet }, r.s, t, fmt);
    g = { ...r.g, wake: g.wake, wakeSet: w.g.wakeSet, alerted: w.g.alerted };
    for (const a of w.actions) {
      if (a.t === 'wakeSchedule') { alarms.set(a.id, a.at); schedules.push({ ...a, t }); }
      else if (a.t === 'wakeCancel') { alarms.delete(a.id); cancels.push({ ...a, t }); }
      else if (a.t === 'wakeDue') { if (!presented.has(a.id)) { alarms.delete(a.id); rang.push({ id: a.id, t, by: 'app', title: a.title }); presented.add(a.id); } }
    }
    for (const a of r.actions) {
      if (a.t === 'alert' && a.key.startsWith('off')) rang.push({ id: a.id, t, by: 'plainAlert' });
      if (a.t === 'end') ended = true;
    }
  }
  return { rang, schedules, cancels, g };
}

const depOf = (run, d) => at(run.stops[run.off - 1][1]) + d * 60000;

for (const [name, run, leg] of [['Burwood to Strathfield (one stop)', T1s, legBS], ['Ashfield to Strathfield (3 stops)', T1three, legAS]]) {
  for (const delay of [0, 3, -1]) {
    test(`wake me, ${name}, ${delay === 0 ? 'on time' : delay > 0 ? delay + ' min late' : 'early'}: rings once as the train leaves the stop before`, () => {
      const r = wakeReplay({ run, leg, delay });
      const wakes = r.rang.filter((x) => x.id.startsWith('wake-'));
      assert.equal(wakes.length, 1, `rang ${wakes.length} times: ${JSON.stringify(r.rang)}`);
      const want = depOf(run, delay);
      assert.equal(wakes[0].t, want, `rang at ${format.clockSec(wakes[0].t)}, train leaves ${run.stops[run.off - 1][0]} at ${format.clockSec(want)}`);
      // Before the get off stop, never after.
      assert.ok(wakes[0].t < at(run.stops[run.off][1]) + delay * 60000);
      // The plain "Next stop" alert is replaced by the alarm, not doubled.
      assert.equal(r.rang.filter((x) => x.by === 'plainAlert').length, 0, 'no second Next stop alert');
      // Nothing left set after the trip.
      assert.equal(Object.keys(r.g.wakeSet || {}).length, 0);
    });
  }
  test(`wake me, ${name}: a delay that shows up after the alarm is set moves it`, () => {
    // One stop: the delay shows before boarding. Three stops: it grows mid ride, after Croydon.
    const r = wakeReplay({ run, leg, delay: 0, lateDelay: 4, lateFrom: run === T1s ? -3 : 3.5 });
    const wakes = r.rang.filter((x) => x.id.startsWith('wake-'));
    assert.equal(wakes.length, 1);
    assert.equal(wakes[0].t, depOf(run, 4));
    assert.ok(r.schedules.length >= 2, 'rescheduled when the live time moved');
  });
  test(`wake me, ${name}: with the app asleep the phone's own alarm rings, once`, () => {
    const r = wakeReplay({ run, leg, appOpen: false });
    const wakes = r.rang.filter((x) => x.id.startsWith('wake-'));
    assert.equal(wakes.length, 1);
    assert.equal(wakes[0].by, 'phone');
    assert.equal(wakes[0].t, depOf(run, 0));
  });
}

test('wake me turned on after the moment (already past the stop before) rings at once, once', () => {
  const r = wakeReplay({ run: T1three, leg: legAS, wakeFrom: 6 });
  const wakes = r.rang.filter((x) => x.id.startsWith('wake-'));
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0].by, 'app');
  assert.ok(wakes[0].t >= at(6) && wakes[0].t <= at(6) + 15000);
  assert.match(wakes[0].title, /^Wake up, Strathfield is next/);
});

test('wake me turned off before it rings cancels the alarm', () => {
  const r = wakeReplay({ run: T1three, leg: legAS, wakeFrom: -5, offAt: 2 });
  assert.equal(r.rang.filter((x) => x.id.startsWith('wake-')).length, 0);
  assert.equal(r.cancels.length, 1);
  // With it off, the plain Next stop alert is back.
  assert.equal(r.rang.filter((x) => x.by === 'plainAlert').length, 1);
});

test('wake time without a live feed: 2 minutes before arrival', () => {
  const s = live.computeLive([legAS], [null], at(1), null);
  assert.equal(smart.wakeTime(s, 0), at(6));
});

// ---------- 5: Missed connection ----------

const legA = { mode: 'train', line: 'T2', tripId: 'T2.run1', stopId: 'ASH3', toStopId: 'RDF3', toParent: '201510', from: 'Ashfield Station', to: 'Redfern Station', planned: iso(at(0)), arrPlanned: iso(at(13)), fromPlatform: 'Platform 3' };
const legB = { mode: 'train', line: 'T4', tripId: 'T4.run1', stopId: 'RDF9', toStopId: 'KXS1', toParent: '201110', from: 'Redfern Station', to: 'Kings Cross Station', planned: iso(at(19)), arrPlanned: iso(at(28)), fromPlatform: 'Platform 9', walkBefore: 3 };
const T2 = { line: 'T2', stops: [['Ashfield', 0], ['Newtown', 9], ['Redfern', 13], ['Central', 16]], mine: 0, off: 2 };
const T4 = { line: 'T4', stops: [['Wolli Creek', 12], ['Redfern', 19], ['Kings Cross', 28]], mine: 1, off: 2 };

test('missed change: detected from live times, planned from the change station to the end', () => {
  // T2 is 6 min late: in at 19, plus a 3 min walk, misses the 19 T4.
  const t = at(5);
  const s = live.computeLive([legA, legB], [feed(T2, 6, t), feed(T4, 0, t)], t, null);
  const m = smart.missedConn([legA, legB], s, { id: '201110', name: 'Kings Cross Station' });
  assert.ok(m);
  assert.equal(m.i, 0);
  assert.equal(m.fromId, '201510', 'the station, not one platform');
  assert.equal(m.toId, '201110');
  assert.equal(m.readyAt, at(22));
  assert.deepEqual(smart.missedPlanLegs(m), [{ f: '201510', fn: 'Redfern Station', t: '201110', tn: 'Kings Cross Station', a: 1 }]);
  // On time: no miss.
  const s2 = live.computeLive([legA, legB], [feed(T2, 0, t), feed(T4, 0, t)], t, null);
  assert.equal(smart.missedConn([legA, legB], s2, null), null);
});

const opt = (line, depMin, tripId, extra = {}) => ({ leave: iso(at(depMin)), board: iso(at(depMin)), arrive: iso(at(depMin + 9)), durationMin: 9, changes: 0, live: true,
  legs: [{ kind: 'transit', mode: 'train', line, tripId, from: 'Redfern Station', fromPlatform: 'Platform 9', to: 'Kings Cross Station', planned: iso(at(depMin)), estimated: iso(at(depMin)), realtime: true, durationMin: 9, arrPlanned: iso(at(depMin + 9)), fromParent: '201510', toParent: '201110', ...extra }] });

test('next option: never the train you are missing, never one you cannot reach, the first after that', () => {
  const t = at(5);
  const s = live.computeLive([legA, legB], [feed(T2, 6, t), feed(T4, 0, t)], t, null);
  const m = smart.missedConn([legA, legB], s, { id: '201110', name: 'Kings Cross Station' });
  // 19 is the train being missed, 21 leaves before you reach the platform at 22, so the 25 T8 is the next option.
  const sorted = [opt('T4', 19, 'T4.run1'), opt('T4', 21, 'T4.runX'), opt('T8', 25, 'T8.run1'), opt('T4', 34, 'T4.run2')];
  assert.equal(smart.pickNextOption(sorted, m).legs[0].tripId, 'T8.run1');
  assert.equal(smart.pickNextOption([opt('T4', 19, 'T4.run1'), opt('T4', 21, 'T4.runX')], m), null, 'nothing reachable');
  assert.equal(smart.pickNextOption([opt('T8', 25, 'T8.run1', { cancelled: true })], m), null, 'cancelled skipped');
});

test('switch to this: the change stays, the rest is the new service, its alerts can fire again', () => {
  const t = at(5);
  const s = live.computeLive([legA, legB], [feed(T2, 6, t), feed(T4, 0, t)], t, null);
  const m = smart.missedConn([legA, legB], s, { id: '201110', name: 'Kings Cross Station' });
  const next = smart.legsOf(opt('T8', 25, 'T8.run1'), short);
  const g = { id: 'g1', legs: [legA, legB], alerted: { conn0: 1, off0: 1, off1: 1, wake1: 1, wake0: 1 }, wakeSet: { 0: at(9), 1: at(27) }, rode: { 0: at(19) } };
  const n = smart.switchLegs(g, m, next);
  assert.equal(n.legs.length, 2);
  assert.equal(n.legs[0], legA);
  assert.equal(n.legs[1].tripId, 'T8.run1');
  assert.equal(n.legs[1].walkBefore, 3, 'keeps the walk between platforms');
  assert.equal(n.legs[1].toParent, '201110');
  assert.deepEqual(Object.keys(n.alerted).sort(), ['off0', 'wake0'], 'conn0, off1 and wake1 can fire for the new train');
  assert.deepEqual(Object.keys(n.wakeSet), ['0']);
  // With the new train the change is fine.
  const s2 = live.computeLive(n.legs, [feed(T2, 6, t), null], t, null);
  assert.equal(s2.conns[0].risk, 'ok');
  assert.equal(smart.missedConn(n.legs, s2, null), null);
});
