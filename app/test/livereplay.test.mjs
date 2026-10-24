// Replay of a whole live trip with a fake clock: a real two leg trip shape (T2 Ashfield to Redfern, change to the
// T4, get off at Kings Cross), on time, delayed and early, refreshed every 15 seconds from 5 minutes before the
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
const T2 = { line: 'T2', mode: 'train', stops: [['Strathfield', -6], ['Burwood', -3], ['Ashfield', 0], ['Stanmore', 6], ['Newtown', 9], ['Redfern', 13], ['Central', 16]], mine: 2, off: 5 };
const T4 = { line: 'T4', mode: 'train', stops: [['Wolli Creek', 12], ['Sydenham', 15], ['Redfern', 19], ['Central', 21], ['Town Hall', 23], ['Martin Place', 25], ['Kings Cross', 28], ['Edgecliff', 31], ['Bondi Junction', 34]], mine: 2, off: 6 };

const legs = [
  { mode: 'train', line: 'T2', tripId: 'T2.run1', stopId: 'ASH', toStopId: 'RDF', from: 'Ashfield Station', to: 'Redfern Station', planned: iso(at(0)), arrPlanned: iso(at(13)), fromPlatform: 'Platform 3', towards: 'Central Station' },
  { mode: 'train', line: 'T4', tripId: 'T4.run1', stopId: 'RDF4', toStopId: 'KXS', from: 'Redfern Station', to: 'Kings Cross Station', planned: iso(at(19)), arrPlanned: iso(at(28)), fromPlatform: 'Platform 9', towards: 'Bondi Junction Station' },
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

function replay({ d1, d2, watchId = null, rollAfter = 1 }) {
  let g = { id: 'g1', legs, alerted: {}, watchId, share: null };
  const log = [];
  let ended = null;
  for (let t = at(-5); t <= at(28 + d2 + 15); t += 15000) {
    if (ended) { log.push({ time: t, after: true }); continue; }
    const svc = [feed(T2, d1, t, { rollAfter }), feed(T4, d2, t, { rollAfter })];
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

function checks(name, { log, ended }, { d1, d2, server }) {
  const alerts = log.filter((e) => e.t === 'alert');
  // Each alert once, with a unique and stable id.
  const ids = alerts.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, `${name}: an alert fired twice: ${ids.join(', ')}`);
  const arrived = alerts.filter((a) => a.key === 'arrived');
  assert.equal(arrived.length, 1, `${name}: one You've arrived`);
  const kx = at(28) + d2 * 60000;
  // Arrival is noticed on the first refresh after the train reaches Kings Cross, never before.
  assert.ok(arrived[0].time >= kx && arrived[0].time <= kx + 60000, `${name}: arrived at ${format.clockSec(arrived[0].time)}, train in at ${format.clockSec(kx)}`);
  assert.match(arrived[0].body, new RegExp(`^Kings Cross at ${format.clock(kx).replace('.', '\\.')}`), `${name}: arrival time in the alert matches the feed`);
  if (server) {
    assert.deepEqual(alerts.map((a) => a.key), ['arrived'], `${name}: with the server watching, the phone only adds You've arrived`);
  } else {
    const off0 = alerts.find((a) => a.key === 'off0'), off1 = alerts.find((a) => a.key === 'off1');
    assert.ok(off0 && /^Next stop: Redfern, change here/.test(off0.title), `${name}: change alert`);
    const rd = at(13) + d1 * 60000;
    assert.ok(off0.time < rd, `${name}: change alert before Redfern`);
    assert.ok(off0.body.includes(format.clock(at(19) + d2 * 60000)), `${name}: change alert names the T4 live time`);
    assert.ok(off1 && /^Next stop: Kings Cross$/.test(off1.title), `${name}: get off alert`);
    assert.ok(off1.time < kx, `${name}: get off alert before Kings Cross`);
    assert.ok(off1.body.includes(format.clock(kx)), `${name}: get off alert has the live arrival`);
  }
  // The ongoing notification always shows the same arrival as the feed, and stops at arrival.
  const ongoing = log.filter((e) => e.t === 'ongoing');
  for (const o of ongoing) {
    assert.ok(o.time < kx + 60000, `${name}: ongoing notification after arrival at ${format.clockSec(o.time)}`);
    assert.ok(o.body.includes(`Arrive ${format.clock(kx)}`), `${name}: ongoing says ${o.body}, train in ${format.clock(kx)}`);
    assert.ok(!/Board the T4/.test(o.body) || o.time < at(19) + d2 * 60000 + 60000, `${name}: rolled onto another T4: ${o.body}`);
  }
  const clear = log.filter((e) => e.t === 'clearOngoing');
  assert.equal(clear.length, 1, `${name}: ongoing notification cleared once`);
  assert.equal(clear[0].time, arrived[0].time, `${name}: cleared at arrival`);
  // Ends 10 minutes after arrival, then nothing at all.
  assert.ok(ended && ended >= arrived[0].time + 10 * 60000 && ended <= arrived[0].time + 10 * 60000 + 15000, `${name}: trip record ends 10 min after arrival`);
  const afterArrive = log.filter((e) => !e.after && e.time > arrived[0].time);
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
      assert.match(tight[0].title, /^Tight change at Redfern/);
    }
  });
  test(`replay, server watching: ${c.name}`, () => {
    const r = replay({ ...c, watchId: 'w1' });
    timeline(`${c.name}, server watching`, r.log);
    checks(c.name + ' (server)', r, { ...c, server: true });
    const stop = r.log.filter((e) => e.t === 'stopWatch');
    assert.equal(stop.length, 1, 'server alerts stopped once');
    assert.equal(stop[0].id, 'w1');
  });
}

test('replay: the feed rolls onto the next T4 the moment you arrive, the trip still ends', () => {
  const r = replay({ d1: 0, d2: 0, rollAfter: 0 });
  checks('roll at arrival', r, { d1: 0, d2: 0, server: false });
});

test('a later feed for the next service is not your train', () => {
  const l = legs[1];
  const ridden = feed(T4, 0, at(24));
  const next = feed(T4, 0, at(24), { shift: 15 });
  assert.equal(live.sameRun(ridden, l, true), true);
  assert.equal(live.sameRun(next, l, true), false, 'timetable time 15 min off');
  const before = { ...ridden, nextIndex: 1 };
  assert.equal(live.sameRun(before, l, true), false, 'vehicle before your stop after you boarded');
  assert.equal(live.sameRun(before, l, false), true, 'before boarding that is normal');
});

test('server alerts about the same stop share one key and one notification id', () => {
  const a = live.noteKey({ id: 1, watch_id: 'w9', title: 'Next stop: Kings Cross Station' });
  const b = live.noteKey({ id: 2, watch_id: 'w9', title: 'Arriving at Kings Cross Station in 2 min' });
  const c = live.noteKey({ id: 3, watch_id: 'w9', title: 'Change at Redfern Station in 2 min' });
  const d = live.noteKey({ id: 4, watch_id: 'w9', title: 'Next stop: Redfern Station, change here' });
  assert.equal(a.key, b.key);
  assert.equal(c.key, d.key);
  assert.notEqual(a.key, c.key);
  assert.equal(a.id, c.id, 'a newer stop alert for the trip replaces the older one');
  assert.equal(live.noteKey({ id: 5, title: 'T1 is 6 min late' }).key, 'note|5');
});
