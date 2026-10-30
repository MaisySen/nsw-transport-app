// Replay of a whole live trip with a fake clock: a real two leg trip shape (T2 Ashfield to Epping, change to the
// T4, get off at Milsons Point), on time, delayed and early, refreshed every 15 seconds from 5 minutes before the
// first train until 15 minutes after arrival, through the same stepLive the app runs. Every notification the phone
// would schedule is logged and checked: each alert once, times that agree with the feed, the trip ends at arrival
// and nothing happens after it. Run: node --test test/ (set REPLAY_LOG=<file> to keep the timelines).
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-replay-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const live = await load('src/lib/liveCalc.ts');
const format = await load('src/lib/format.ts');
const short = (n) => String(n || '').replace(/ Station$/, '');
const fmt = { clock: format.clock, short, plat: (p) => (p ? p.replace(/^Platform\s*/i, 'Platform ') : '') };

// Saturday 24 Oct 2026, 10:00pm Sydney.
const T0 = Date.parse('2026-10-24T11:00:00Z');
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();

// Timetable minutes from T0 for each run's stops. Index of your stop and of where you get off.
const T2 = { line: 'T2', mode: 'train', stops: [['Chatswood', -6], ['Parramatta', -3], ['Ashfield', 0], ['Stanmore', 6], ['Newtown', 9], ['Epping', 13], ['Central', 16]], mine: 2, off: 5 };
const T4 = { line: 'T4', mode: 'train', stops: [['Wolli Creek', 12], ['Sydenham', 15], ['Epping', 19], ['Central', 21], ['North Sydney', 23], ['Martin Place', 25], ['Milsons Point', 28], ['Edgecliff', 31], ['Bondi Junction', 34]], mine: 2, off: 6 };

const legsKX = [
  { mode: 'train', line: 'T2', tripId: 'T2.run1', stopId: 'ASH', toStopId: 'RDF', from: 'Ashfield Station', to: 'Epping Station', planned: iso(at(0)), arrPlanned: iso(at(13)), fromPlatform: 'Platform 3', towards: 'Central Station' },
  { mode: 'train', line: 'T4', tripId: 'T4.run1', stopId: 'RDF4', toStopId: 'KXS', from: 'Epping Station', to: 'Milsons Point Station', planned: iso(at(19)), arrPlanned: iso(at(28)), fromPlatform: 'Platform 9', towards: 'Bondi Junction Station' },
];

/**
 * What /api/service answers for a leg at time t: stops with timetable and live times, and the next stop the vehicle
 * has not reached. `shift` moves a whole run (a later service is +15). After your run has passed your stop by
 * `rollAfter` minutes the feed answers with the NEXT run on the line, the way the live feed did on Bidur's trip.
 */
function feed(run, delay, t, { shift = 0, rollAfter = null } = {}) {
  const offT = at(run.stops[run.off][1] + shift) + delay * 60000;
  if (rollAfter != null && t > offT + rollAfter * 60000) return feed(run, 0, t, { shift: shift + 15 });
  const stops = run.stops.map(([name, m], k) => ({ id: name.slice(0, 3).toUpperCase() + k, name: name + ' Station', lat: -33.9 + k / 100, lon: 151.1 + k / 100,
    planned: iso(at(m + shift)), estimated: iso(at(m + shift) + delay * 60000), mine: k === run.mine, alight: k === run.off }));
  let nextIndex = stops.findIndex((s) => Date.parse(s.estimated) > t - 20000);
  if (nextIndex < 0) nextIndex = stops.length;
  return { kind: 'service', live: true, line: run.line, mode: run.mode, mineIndex: run.mine, alightIndex: run.off, nextIndex, stops };
}

// Short trips Bidur picked to test on: Parramatta to Chatswood (one stop), and one stop more with a change.
const T1s = { line: 'T1', mode: 'train', stops: [['Croydon', -2], ['Parramatta', 0], ['Chatswood', 3], ['Homebush', 5]], mine: 1, off: 2 };
const T9s = { line: 'T9', mode: 'train', stops: [['Parramatta', 3], ['Chatswood', 7], ['North Chatswood', 9]], mine: 1, off: 2 };
const legBS = { mode: 'train', line: 'T1', tripId: 'T1.short', stopId: 'BWD', toStopId: 'STR', from: 'Parramatta Station', to: 'Chatswood Station', planned: iso(at(0)), arrPlanned: iso(at(3)), fromPlatform: 'Platform 2', towards: 'Penrith Station' };
const legSN = { mode: 'train', line: 'T9', tripId: 'T9.short', stopId: 'STR9', toStopId: 'NST', from: 'Chatswood Station', to: 'North Chatswood Station', planned: iso(at(7)), arrPlanned: iso(at(9)), fromPlatform: 'Platform 6', towards: 'Hornsby Station' };
const SC = {
  kx: { legs: legsKX, runs: [T2, T4], change: 'Epping', final: 'Milsons Point', changeLeg: 1 },
  bs: { legs: [legBS], runs: [T1s], change: null, final: 'Chatswood' },
  bsn: { legs: [legBS, legSN], runs: [T1s, T9s], change: 'Chatswood', final: 'North Chatswood', changeLeg: 1 },
};
const offAt = (run, d) => at(run.stops[run.off][1]) + d * 60000;
const depAt = (run, d) => at(run.stops[run.mine][1]) + d * 60000;

function replay({ sc = 'kx', d1, d2 = 0, watchId = null, rollAfter = 1 }) {
  const S = SC[sc];
  const legs = S.legs;
  const ds = [d1, d2];
  let g = { id: 'g1', legs, alerted: {}, watchId, share: null };
  const log = [];
  let ended = null;
  const endT = offAt(S.runs[S.runs.length - 1], ds[S.runs.length - 1]) + 15 * 60000;
  for (let t = at(-5); t <= endT; t += 15000) {
    if (ended) { log.push({ time: t, after: true }); continue; }
    const svc = S.runs.map((run, i) => feed(run, ds[i], t, { rollAfter }));
    const r = live.stepLive(g, svc, t, fmt);
    g = r.g;
    for (const a of r.actions) {
      log.push({ ...a, time: t });
      if (a.t === 'end') ended = t;
    }
  }
  return { log, g, ended };
}

function timeline(name, log) {
  const lines = [];
  let lastOngoing = '';
  for (const e of log) {
    if (e.after) continue;
    const when = format.clockSec(e.time);
    if (e.t === 'ongoing') { const w = `${e.title} | ${e.body}`; if (w.replace(/\(\d+ (h )?\d* ?min\)/, '') !== lastOngoing) { lines.push(`${when}  ongoing   ${w}`); lastOngoing = w.replace(/\(\d+ (h )?\d* ?min\)/, ''); } }
    else if (e.t === 'alert') lines.push(`${when}  ALERT     ${e.title} | ${e.body}   [id ${e.id}]`);
    else lines.push(`${when}  ${e.t}`);
  }
  if (process.env.REPLAY_LOG) fs.appendFileSync(process.env.REPLAY_LOG, `\n== ${name} ==\n` + lines.join('\n') + '\n');
  return lines;
}

function checks(name, { log, ended }, { sc = 'kx', d1, d2 = 0, server }) {
  const S = SC[sc];
  const ds = [d1, d2];
  const lastRun = S.runs[S.runs.length - 1], dl = ds[S.runs.length - 1];
  const alerts = log.filter((e) => e.t === 'alert');
  // Each alert once, with a unique and stable id.
  const ids = alerts.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, `${name}: an alert fired twice: ${ids.join(', ')}`);
  const kx = offAt(lastRun, dl);
  // Arrival: the ongoing notification is cleared once, on the first refresh after the train reaches the stop, never before.
  const clear = log.filter((e) => e.t === 'clearOngoing');
  assert.equal(clear.length, 1, `${name}: ongoing notification cleared once`);
  const arrT = clear[0].time;
  assert.ok(arrT >= kx && arrT <= kx + 60000, `${name}: arrived at ${format.clockSec(arrT)}, train in at ${format.clockSec(kx)}`);
  const arrived = alerts.filter((a) => a.key === 'arrived');
  if (!server) {
    assert.equal(arrived.length, 1, `${name}: one You've arrived`);
    assert.equal(arrived[0].time, arrT, `${name}: You've arrived at arrival`);
    assert.ok(arrived[0].body.startsWith(`${S.final} at ${format.clock(kx)}`), `${name}: arrival time in the alert matches the feed: ${arrived[0].body}`);
  }
  if (server) {
    // The server sends every alert for a trip it watches, You've arrived included, and ends its watch at the stop.
    assert.deepEqual(alerts.map((a) => a.key), [], `${name}: with the server watching, the phone posts no alert of its own`);
    assert.equal(log.filter((e) => e.t === 'stopWatch').length, 0, `${name}: the server watch is left to end itself at the stop`);
  } else {
    const lastI = S.runs.length - 1;
    if (S.change) {
      const off0 = alerts.find((a) => a.key === 'off0');
      assert.ok(off0 && off0.title === `Next stop: ${S.change}, change here`, `${name}: change alert`);
      assert.ok(off0.time < offAt(S.runs[0], d1), `${name}: change alert before ${S.change}`);
      assert.ok(off0.body.includes(format.clock(depAt(S.runs[1], d2))), `${name}: change alert names the next train's live time`);
    }
    const offL = alerts.find((a) => a.key === 'off' + lastI);
    assert.ok(offL && offL.title === `Next stop: ${S.final}`, `${name}: get off alert`);
    assert.ok(offL.time < kx, `${name}: get off alert before ${S.final}`);
    assert.ok(offL.body.includes(format.clock(kx)), `${name}: get off alert has the live arrival`);
    assert.equal(alerts.filter((a) => a.key.startsWith('off')).length, S.runs.length, `${name}: one stop alert per leg`);
  }
  // The ongoing notification always shows the same arrival as the feed, and stops at arrival.
  const ongoing = log.filter((e) => e.t === 'ongoing');
  const lastI0 = S.runs.length - 1;
  for (const o of ongoing) {
    assert.ok(o.time < kx + 60000, `${name}: ongoing notification after arrival at ${format.clockSec(o.time)}`);
    assert.ok(o.body.includes(`Arrive ${format.clock(kx)}`), `${name}: ongoing says ${o.body}, train in ${format.clock(kx)}`);
    assert.ok(!(o.leg === lastI0 && /Board the|Change to the/.test(o.body)) || o.time < depAt(lastRun, dl) + 60000, `${name}: rolled onto another train: ${o.body}`);
  }
  // Ends 10 minutes after arrival, then nothing at all.
  assert.ok(ended && ended >= arrT + 10 * 60000 && ended <= arrT + 10 * 60000 + 15000, `${name}: trip record ends 10 min after arrival`);
  const afterArrive = log.filter((e) => !e.after && e.time > arrT);
  assert.deepEqual(afterArrive.map((e) => e.t), ['end'], `${name}: only the end after arrival, saw ${afterArrive.map((e) => format.clockSec(e.time) + ' ' + e.t).join(', ')}`);
  assert.equal(afterArrive[0].time, ended);
}

const cases = [
  { name: 'on time', d1: 0, d2: 0 },
  { name: 'delayed (T2 7 min late, T4 2 min late, a 1 minute change)', d1: 7, d2: 2 },
  { name: 'early (both trains 1 min early)', d1: -1, d2: -1 },
];
for (const c of cases) {
  test(`replay, phone alerts: ${c.name}`, () => {
    const r = replay(c);
    timeline(`${c.name}, phone alerts`, r.log);
    checks(c.name, r, { ...c, server: false });
    if (c.d1 === 7) {
      const tight = r.log.filter((e) => e.t === 'alert' && e.key === 'conn0');
      assert.equal(tight.length, 1, 'one tight change alert');
      assert.match(tight[0].title, /^Tight change at Epping/);
    }
  });
  test(`replay, server watching: ${c.name}`, () => {
    const r = replay({ ...c, watchId: 'w1' });
    timeline(`${c.name}, server watching`, r.log);
    checks(c.name + ' (server)', r, { ...c, server: true });
  });
}

const shortTrips = [
  { name: 'Parramatta to Chatswood, one stop, on time', sc: 'bs', d1: 0 },
  { name: 'Parramatta to Chatswood, one stop, 3 min late', sc: 'bs', d1: 3 },
  { name: 'Parramatta to Chatswood, one stop, 1 min early', sc: 'bs', d1: -1 },
  { name: 'Parramatta to North Chatswood, change at Chatswood', sc: 'bsn', d1: 0, d2: 0 },
  { name: 'Parramatta to North Chatswood, change at Chatswood, T1 2 min late', sc: 'bsn', d1: 2, d2: 0 },
];
for (const c of shortTrips) {
  test(`replay, short trip: ${c.name}`, () => {
    const r = replay(c);
    timeline(`${c.name}, phone alerts`, r.log);
    checks(c.name, r, { ...c, server: false });
    const rs = replay({ ...c, watchId: 'w2' });
    timeline(`${c.name}, server watching`, rs.log);
    checks(c.name + ' (server)', rs, { ...c, server: true });
  });
}

test('replay: the feed rolls onto the next T4 the moment you arrive, the trip still ends', () => {
  const r = replay({ d1: 0, d2: 0, rollAfter: 0 });
  checks('roll at arrival', r, { d1: 0, d2: 0, server: false });
});

test('a later feed for the next service is not your train', () => {
  const l = legsKX[1];
  const ridden = feed(T4, 0, at(24));
  const next = feed(T4, 0, at(24), { shift: 15 });
  assert.equal(live.sameRun(ridden, l, true), true);
  assert.equal(live.sameRun(next, l, true), false, 'timetable time 15 min off');
  const before = { ...ridden, nextIndex: 1 };
  assert.equal(live.sameRun(before, l, true), false, 'vehicle before your stop after you boarded');
  assert.equal(live.sameRun(before, l, false), true, 'before boarding that is normal');
});

test('server alerts about the same stop share one key and one notification id', () => {
  const a = live.noteKey({ id: 1, watch_id: 'w9', title: 'Next stop: Milsons Point Station' });
  const b = live.noteKey({ id: 2, watch_id: 'w9', title: 'Arriving at Milsons Point Station in 2 min' });
  const c = live.noteKey({ id: 3, watch_id: 'w9', title: 'Change at Epping Station in 2 min' });
  const d = live.noteKey({ id: 4, watch_id: 'w9', title: 'Next stop: Epping Station, change here' });
  assert.equal(a.key, b.key);
  assert.equal(c.key, d.key);
  assert.notEqual(a.key, c.key);
  assert.equal(a.id, c.id, 'a newer stop alert for the trip replaces the older one');
  assert.equal(live.noteKey({ id: 5, title: 'T1 is 6 min late' }).key, 'note|5');
});
