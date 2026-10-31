// Get off now, 28 Oct: 30 s before the realtime arrival at your stop (a minute before the timetable arrival with no
// live times), moved on every refresh, never after the arrival. Replayed with a fake clock, refreshing every 15 s like
// the app, with the phone's own scheduled alerts simulated (they ring at their time with the app open or closed).
// Also the trip card going stale at the arrival where you get off, and the alert being time sensitive.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-getoff30-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const live = await load('src/lib/liveCalc.ts');
const smart = await load('src/lib/smart.ts');
const format = await load('src/lib/format.ts');
const G = await load('src/lib/getOffCore.ts');
const W = await load('src/lib/whereNowCore.ts');
const short = (n) => String(n || '').replace(/ Station$/, '');
const fmt = { clock: format.clock, short, plat: (p) => (p ? p.replace(/^Platform\s*/i, 'Platform ') : '') };
const src = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');


const tripCard = await load('platform/tripCard.ts');
const T0 = Date.parse('2026-10-27T19:00:00Z'); // Wed 28 Oct, 6:00am Sydney
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();
// Epping to Rhodes on the T9, four stops ridden. `lagS`: the stop list's "next stop" trails the train this long.
const RUN = { line: 'T9', stops: [['Cheltenham', -2], ['Epping', 0], ['Eastwood', 2], ['Denistone', 4], ['West Ryde', 6], ['Meadowbank', 8], ['Rhodes', 10], ['Concord West', 12]], mine: 1, off: 6 };
const LEG = { mode: 'train', line: 'T9', tripId: 'T9.r', stopId: 'EPP', toStopId: 'RHO', from: 'Epping Station', to: 'Rhodes Station', planned: iso(at(0)), arrPlanned: iso(at(10)), fromPlatform: 'Platform 1', towards: 'Gordon Station' };
const ARR = at(10);

function feed(delayMin, t, isLive, lagS) {
  const stops = RUN.stops.map(([name, m], k) => ({ id: name.slice(0, 3).toUpperCase() + k, name: name + ' Station', planned: iso(at(m)), estimated: iso(at(m) + delayMin * 60000), mine: k === RUN.mine, alight: k === RUN.off }));
  let nextIndex = stops.findIndex((s) => Date.parse(s.estimated) > t - 20000 - lagS * 1000);
  if (nextIndex < 0) nextIndex = stops.length;
  return { kind: 'service', live: isLive, line: RUN.line, mode: 'train', mineIndex: RUN.mine, alightIndex: RUN.off, nextIndex, stops };
}

/** One trip refreshed every 15 s from `from` (minutes). The app runs until `closeAt` (minutes), then only the phone's set alerts ring. */
function replay({ pref = G.GETOFF_DEFAULT, delay = () => 0, isLive = true, lagS = 0, from = -3, closeAt = Infinity } = {}) {
  let g = { id: 'g1', legs: [LEG], alerted: {}, watchId: null, share: null, speak: false, spoken: {}, offSet: {} };
  const alarms = new Map();
  const rang = [], schedules = [], cancels = [];
  const presented = new Set();
  let ended = false;
  for (let t = at(from); t <= at(20) && !ended; t += 15000) {
    for (const [id, when] of [...alarms]) if (when <= t) { rang.push({ id, t: when, by: 'phone' }); presented.add(id); alarms.delete(id); }
    if (t >= at(closeAt)) continue;
    const r = live.stepLive(g, [feed(delay(t), t, isLive, lagS)], t, fmt);
    const o = G.getOffStep({ id: g.id, legs: g.legs, alerted: r.g.alerted, offSet: g.offSet, speak: false, spoken: r.g.spoken }, pref, r.s, t, fmt);
    g = { ...r.g, alerted: o.g.alerted, spoken: o.g.spoken, offSet: o.g.offSet };
    for (const a of o.actions) {
      if (a.t === 'offSchedule') { alarms.set(a.id, a.at); schedules.push({ ...a, t }); }
      else if (a.t === 'offCancel') { alarms.delete(a.id); cancels.push({ ...a, t }); }
      else if (a.t === 'offDue') { if (!presented.has(a.id)) { alarms.delete(a.id); rang.push({ id: a.id, t, by: 'app', title: a.title }); presented.add(a.id); } }
    }
    for (const a of r.actions) if (a.t === 'end') ended = true;
  }
  return { now: rang.filter((x) => /-gnow\d+$/.test(x.id)), schedules: schedules.filter((x) => /gnow/.test(x.key)), cancels, alarms };
}
const sec = (t) => format.clockSec ? format.clockSec(t) : new Date(t).toISOString();
const inWindow = (t, arr, lead) => t >= arr - lead - 1 && t < arr;

test('the lead times: 30 s before the realtime arrival, a minute before the timetable one', () => {
  assert.equal(G.GETOFF_NOW_LEAD_MS, 30000);
  assert.equal(G.GETOFF_NOW_TIMETABLE_LEAD_MS, 60000);
  assert.equal(G.GETOFF_DEFAULT.now, true, 'on for everyone unless turned off');
});

test('on time: Get off now rings once, in the 30 s before arrival, with the app open; closed, never from a clock', () => {
  const r = replay({});
  assert.equal(r.now.length, 1, JSON.stringify(r.now));
  assert.ok(inWindow(r.now[0].t, ARR, 30000), `rang ${sec(r.now[0].t)} for ${sec(ARR)}`);
  // Closed (31 Oct): the phone sets nothing for a time; the server's push or a location alert stands in.
  for (const closeAt of [-2.5, 5]) {
    const c = replay({ closeAt });
    assert.equal(c.now.length, 0, `closeAt ${closeAt}: ${JSON.stringify(c.now)}`);
    assert.equal(c.schedules.length, 0);
  }
});

test('a stop list that trails the train by 90 s no longer makes it late (the 28 Oct bug)', () => {
  const r = replay({ lagS: 90 });
  assert.equal(r.now.length, 1);
  assert.ok(inWindow(r.now[0].t, ARR, 30000), `rang ${sec(r.now[0].t)}, arrival ${sec(ARR)}`);
});

test('running late: it follows the realtime arrival, not the timetable', () => {
  const late = (t) => (t >= at(3) ? 3 : 0);
  const r = replay({ delay: late });
  assert.equal(r.now.length, 1);
  assert.ok(inWindow(r.now[0].t, ARR + 3 * 60000, 30000), `rang ${sec(r.now[0].t)}`);
  assert.equal(r.schedules.length, 0, 'nothing set from a clock (31 Oct)');
});

test('running early: it moves earlier and still rings before the arrival', () => {
  const early = (t) => (t >= at(4) ? -1 : 0);
  const r = replay({ delay: early });
  assert.equal(r.now.length, 1);
  assert.ok(inWindow(r.now[0].t, ARR - 60000, 30000), `rang ${sec(r.now[0].t)}`);
});

test('never after arrival: opened after the train got in, nothing rings and nothing is set', () => {
  const r = replay({ from: 10.25 });
  assert.equal(r.now.length, 0);
  assert.equal(r.schedules.length, 0);
});

test('opened inside the last 30 s: it rings at once, before the arrival', () => {
  const r = replay({ from: 9.75 });
  assert.equal(r.now.length, 1);
  assert.ok(r.now[0].t < ARR && r.now[0].by === 'app');
});

test('no live times: no Get off now from the timetable clock (31 Oct, a guess never says get off)', () => {
  const r = replay({ isLive: false });
  assert.equal(r.now.length, 0, JSON.stringify(r.now));
  assert.equal(r.schedules.length, 0);
});

test('turned off from this version: nothing is set', () => {
  const r = replay({ pref: G.readGetOff({ stops: 1, now: false, v: 2 }) });
  assert.equal(r.now.length, 0);
  assert.equal(r.schedules.length, 0);
});

test('every set time is before the arrival it was set for', () => {
  for (const delay of [() => 0, (t) => (t >= at(3) ? 2 : 0), (t) => (t >= at(6) ? -1 : 0)]) {
    const r = replay({ delay, lagS: 60 });
    for (const s of r.schedules) {
      const d = delay(s.t);
      assert.ok(s.at < ARR + d * 60000, `set ${sec(s.at)} at ${sec(s.t)}`);
    }
  }
});

test('the trip card goes stale at the arrival where you get off, so the island stops counting', () => {
  const base = { phase: 'ride', arrival: at(30), legArrives: at(10), progress: 0.5 };
  assert.equal(tripCard.staleAt(base, at(9), true), at(10));
  assert.equal(tripCard.staleAt({ ...base, legArrives: at(20) }, at(9), true), at(11), '2 minutes after the live times when that is sooner');
  assert.equal(tripCard.staleAt({ ...base, phase: 'wait' }, at(9), true), at(11), 'waiting: unchanged');
  assert.equal(tripCard.staleAt(base, at(9), false), at(32), 'builds without the honest stale card: unchanged');
});

test('the alert is time sensitive', () => {
  const src = fs.readFileSync(path.join(root, 'src/lib/getOffNotify.ts'), 'utf8');
  assert.match(src, /interruptionLevel: 'timeSensitive'/);
});
