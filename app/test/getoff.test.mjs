// Get off alert the rider controls (g32): 1, 2 or 3 stops before, and Get off now. Replayed with a fake clock on a
// 6 stop T1 run (Chatswood to Central), refreshing every 15 s like the app, with the phone's own scheduled alerts
// simulated (they ring at their time with the app open or closed). Also: the delay is said once on Home cards.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-getoff-'));
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

const T0 = Date.parse('2026-10-26T21:00:00Z'); // Tue 27 Oct, 8:00am Sydney
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();

function feed(run, delay, t, isLive = true) {
  const stops = run.stops.map(([name, m], k) => ({ id: name.slice(0, 3).toUpperCase() + k, name: name + ' Station', planned: iso(at(m)), estimated: iso(at(m) + delay * 60000), mine: k === run.mine, alight: k === run.off }));
  let nextIndex = stops.findIndex((s) => Date.parse(s.estimated) > t - 20000);
  if (nextIndex < 0) nextIndex = stops.length;
  return { kind: 'service', live: isLive, line: run.line, mode: 'train', mineIndex: run.mine, alightIndex: run.off, nextIndex, stops };
}
// Chatswood to Central: Parramatta, Croydon, Ashfield, Epping between (5 stops ridden).
const RUN = { line: 'T1', stops: [['Homebush', -2], ['Chatswood', 0], ['Parramatta', 3], ['Croydon', 5], ['Ashfield', 7], ['Epping', 13], ['Central', 16], ['Martin Place', 18]], mine: 1, off: 6 };
const LEG = { mode: 'train', line: 'T1', tripId: 'T1.r', stopId: 'STR', toStopId: 'CEN', from: 'Chatswood Station', to: 'Central Station', planned: iso(at(0)), arrPlanned: iso(at(16)), fromPlatform: 'Platform 4', towards: 'Hornsby Station' };
const leaves = (k, d = 0) => at(RUN.stops[k][1]) + d * 60000;

/** One trip, refreshed every 15 s. `pref` may change at a minute (prefAt). Returns what rang, by whom and when. */
function replay({ pref = G.GETOFF_DEFAULT, delay = 0, lateDelay = null, lateFrom = 0, appOpen = true, speak = false, isLive = true, prefAt = null, pref2 = null, run = RUN, leg = LEG }) {
  let g = { id: 'g1', legs: [leg], alerted: {}, watchId: null, share: null, speak, spoken: {}, offSet: {} };
  const alarms = new Map();
  const rang = [];
  const said = [];
  const presented = new Set();
  const cancels = [];
  const schedules = [];
  let ended = false;
  for (let t = at(-3); t <= at(40) && !ended; t += 15000) {
    for (const [id, when] of [...alarms]) if (when <= t) { rang.push({ id, t: when, by: 'phone' }); presented.add(id); alarms.delete(id); }
    const p = prefAt != null && t >= at(prefAt) ? pref2 : pref;
    if (!appOpen && t > at(-3) + 15000) continue;
    const d = lateDelay != null && t >= at(lateFrom) ? lateDelay : delay;
    const r = live.stepLive(g, [feed(run, d, t, isLive)], t, fmt);
    const o = G.getOffStep({ id: g.id, legs: g.legs, alerted: r.g.alerted, offSet: g.offSet, speak, spoken: r.g.spoken }, p, r.s, t, fmt);
    g = { ...r.g, alerted: o.g.alerted, spoken: o.g.spoken, offSet: o.g.offSet };
    for (const a of o.actions) {
      if (a.t === 'offSchedule') { alarms.set(a.id, a.at); schedules.push({ ...a, t }); }
      else if (a.t === 'offCancel') { alarms.delete(a.id); cancels.push({ ...a, t }); }
      else if (a.t === 'offDue') { if (!presented.has(a.id)) { alarms.delete(a.id); rang.push({ id: a.id, t, by: 'app', title: a.title }); presented.add(a.id); } }
      else if (a.t === 'say') said.push({ ...a, t });
    }
    for (const a of r.actions) {
      if (a.t === 'alert' && a.key.startsWith('off')) rang.push({ id: a.id, t, by: 'nextStop', title: a.title });
      if (a.t === 'say') said.push({ ...a, t });
      if (a.t === 'end') ended = true;
    }
  }
  const early = rang.filter((x) => /-early\d+$/.test(x.id));
  const now = rang.filter((x) => /-gnow\d+$/.test(x.id));
  const next = rang.filter((x) => x.by === 'nextStop');
  return { rang, early, now, next, said, schedules, cancels, g, alarms };
}

test('the stored choice is read safely: anything unknown is 1 stop with Get off now (28 Oct default)', () => {
  assert.deepEqual(G.readGetOff(undefined), { stops: 1, now: true });
  assert.deepEqual(G.readGetOff({ stops: 7, now: 'yes' }), { stops: 1, now: true });
  assert.deepEqual(G.readGetOff({ stops: 3, now: true }), { stops: 3, now: true });
  assert.deepEqual(G.readGetOff({ stops: '2' }), { stops: 2, now: true });
  assert.deepEqual(G.readGetOff({ stops: 1, now: false }), { stops: 1, now: true }, 'a false saved before 28 Oct was the old default');
  assert.deepEqual(G.readGetOff({ stops: 2, now: false, v: 2 }), { stops: 2, now: false }, 'turned off from this version stays off');
  assert.equal(G.getOffValueText({ stops: 2, now: true }), '2 stops before, Get off now');
  assert.equal(G.getOffValueText({ stops: 1, now: false }), '1 stop before');
  assert.equal(G.getOffSubText({ stops: 3, now: false }, 'Central'), '3 stops before Central, then at the stop before');
  assert.equal(G.getOffSubText({ stops: 1, now: false }, 'Central'), 'As you leave the stop before Central');
  assert.equal(G.getOffShortText({ stops: 2, now: true }), '2 stops');
});

test('default (1 stop, Get off now): the Next stop alert as before, and Get off now once', () => {
  const r = replay({});
  assert.equal(r.early.length, 0);
  assert.equal(r.now.length, 1);
  assert.ok(r.schedules.length >= 1);
  assert.equal(r.next.length, 1, 'the Next stop alert, once');
  assert.match(r.next[0].title, /^Next stop: Central/);
  assert.ok(r.next[0].t >= leaves(5) && r.next[0].t <= leaves(5) + 30000, 'as the train leaves Epping');
});

for (const n of [2, 3]) {
  for (const delay of [0, 4]) {
    test(`${n} stops before, ${delay ? delay + ' min late' : 'on time'}: one heads up as the train leaves the stop ${n} before, then Next stop`, () => {
      const r = replay({ pref: { stops: n, now: false }, delay });
      assert.equal(r.early.length, 1, JSON.stringify(r.rang));
      const want = leaves(RUN.off - n, delay);
      assert.ok(r.early[0].t >= want && r.early[0].t <= want + 30000, `rang ${format.clockSec(r.early[0].t)}, want ${format.clockSec(want)}`);
      assert.equal(r.next.length, 1);
      assert.ok(r.early[0].t < r.next[0].t);
      assert.equal(r.now.length, 0);
      assert.equal(r.alarms.size, 0, 'nothing left set');
    });
  }
}

test('2 stops before with the app closed: the phone rings it at the live time it was set for', () => {
  const r = replay({ pref: { stops: 2, now: false }, appOpen: false });
  assert.equal(r.early.length, 1);
  assert.equal(r.early[0].by, 'phone');
  assert.equal(r.early[0].t, leaves(4));
});

test('a delay that shows up mid ride moves the heads up and Get off now', () => {
  const r = replay({ pref: { stops: 3, now: true }, delay: 0, lateDelay: 5, lateFrom: 2 });
  assert.equal(r.early.length, 1);
  assert.ok(r.early[0].t >= leaves(3, 5), 'not at the timetable time');
  assert.equal(r.now.length, 1);
  assert.ok(r.now[0].t >= at(16 + 5) - 60000 && r.now[0].t < at(16 + 5), 'within the minute before the late arrival');
  assert.ok(r.schedules.length >= 4, 'moved when the live times moved');
});

test('Get off now: once, after Next stop, in the minute before arrival, never before the train leaves the stop before', () => {
  for (const appOpen of [true, false]) {
    const r = replay({ pref: { stops: 1, now: true }, appOpen });
    assert.equal(r.now.length, 1, JSON.stringify(r.rang));
    assert.ok(r.now[0].t >= leaves(5));
    assert.ok(r.now[0].t >= at(16) - 60000 && r.now[0].t < at(16));
    if (appOpen) { assert.equal(r.next.length, 1); assert.ok(r.next[0].t <= r.now[0].t); }
  }
});

test('Get off now on a short last stretch waits for the train to leave the stop before', () => {
  // Epping to Central in 1 minute: arrival minus a minute is before it leaves Epping.
  const run = { ...RUN, stops: RUN.stops.map(([n, m]) => [n, n === 'Central' ? 13.5 : n === 'Martin Place' ? 15 : m]) };
  const r = replay({ pref: { stops: 1, now: true }, run });
  assert.equal(r.now.length, 1);
  assert.ok(r.now[0].t >= leaves(5));
});

test('a ride shorter than the choice: no heads up (the Next stop alert covers it)', () => {
  const run = { ...RUN, mine: 4 }; // Ashfield to Central: Epping only between
  const leg = { ...LEG, stopId: 'ASH', from: 'Ashfield Station', planned: iso(at(7)) };
  const r = replay({ pref: { stops: 3, now: false }, run, leg });
  assert.equal(r.early.length, 0);
  assert.equal(r.next.length, 1);
});

test('no live times: no heads up from the timetable clock; Get off now a minute before the timetable arrival', () => {
  const r = replay({ pref: { stops: 3, now: true }, isLive: false });
  assert.equal(r.early.length, 0);
  assert.equal(r.now.length, 1);
  assert.ok(r.now[0].t >= at(16) - 60000 - 15000 && r.now[0].t < at(16), JSON.stringify(r.now));
});

test('turning it back to 1 stop before it rings takes the set alerts back', () => {
  const r = replay({ pref: { stops: 3, now: true }, prefAt: 2, pref2: { stops: 1, now: false } });
  assert.equal(r.early.length, 0);
  assert.equal(r.now.length, 0);
  assert.equal(r.cancels.length, 2);
  assert.equal(r.next.length, 1, 'the Next stop alert stays');
});

test('turned on after the moment: the heads up is not rung late, Get off now still comes', () => {
  const r = replay({ pref: { stops: 1, now: false }, prefAt: 14, pref2: { stops: 3, now: true } });
  assert.equal(r.early.length, 0, 'already past 3 stops before');
  assert.equal(r.now.length, 1);
});

test('Speak alerts on: the heads up and Get off now are read out once each', () => {
  const r = replay({ pref: { stops: 2, now: true }, speak: true });
  const texts = r.said.map((x) => x.text);
  assert.ok(texts.includes('2 stops to Central.'), texts.join(' | '));
  assert.ok(texts.includes('Get off now at Central.'), texts.join(' | '));
  assert.equal(texts.filter((x) => x === 'Get off now at Central.').length, 1);
  assert.ok(texts.includes('Your stop is next. Central.'), 'the existing line stays');
});

test('words at a change: the next line is named', () => {
  const legs = [LEG, { ...LEG, line: 'T4', stopId: 'CEN2', from: 'Central Station', to: 'Bondi Junction Station' }];
  const s = live.computeLive(legs, [feed(RUN, 0, at(8)), null], at(8), null);
  const w = G.getOffWords(legs, s, 0, 'early', 2, fmt);
  assert.equal(w.title, '2 stops to Central');
  assert.match(w.body, /change to the T4/);
  assert.equal(G.getOffWords(legs, s, 0, 'now', 2, fmt).body, 'Change here to the T4.');
});

test('switching to the next way on drops get off alerts for the replaced legs', () => {
  const g = { legs: [LEG, LEG], alerted: { early0: 1, early1: 1, gnow1: 1, off0: 1 }, offSet: { early1: at(20), gnow0: at(15) } };
  const n = smart.switchLegs(g, { i: 0 }, [LEG]);
  assert.deepEqual(Object.keys(n.alerted).sort(), ['early0', 'off0']);
  assert.deepEqual(n.offSet, { gnow0: at(15) });
});

test('the app wires it in: engine, trip mode row, end of trip, no timers', () => {
  const eng = src('lib/liveEngine.ts');
  assert.match(eng, /getOffStep\(/);
  assert.match(eng, /readGetOff\(store\.getOff\(\)\)/);
  assert.match(eng, /speak: g\.speak && hasSpeech\(\)/);
  assert.match(src('app/go.tsx'), /<GetOffRow g=\{g\} st=\{st\} \/>/);
  assert.match(src('lib/live.ts'), /cancelGetOff\(getOffId\(g\.id, k\)\)/);
  for (const f of ['lib/getOffCore.ts', 'lib/getOffNotify.ts', 'components/GetOffChoice.tsx']) {
    const s = src(f);
    assert.doesNotMatch(s, /setInterval|Accuracy\.High|watchPositionAsync|requireNativeModule\(/, f);
    assert.doesNotMatch(s, /[\u2013\u2014]/, f);
  }
  assert.match(src('components/GetOffChoice.tsx'), /accessibilityRole="button"/);
});

// ---------- the delay said once on Home cards ----------
const veh = { lat: -33.8150, lon: 151.0011, ageS: 20 };
test('where the bus is beside a status line that shows the delay: only where it is', () => {
  const x = { kind: 'transit', mode: 'bus', realtime: true, delayMin: 4, stopsAway: 3, vehicle: veh };
  assert.equal(W.whereNow(x).text, '3 stops away \u00b7 4 min late', 'unchanged by default');
  const w = W.whereNow(x, true, true);
  assert.equal(w.text, '3 stops away');
  assert.equal(w.a11y, 'Bus 3 stops away, from its live position');
  assert.equal(w.late, 4, 'the delay still colours the line');
  assert.equal(W.whereNow({ ...x, delayMin: 0, stopsAway: 0 }, true, true).text, 'At your stop');
});

test('Home cards and trip rows pass the status line delay, so "4 min late" shows once', () => {
  const home = src('components/Home.tsx');
  assert.match(home, /whereNow\(l, ls\?\.kind === 'live', true\)/);
  assert.equal((home.match(/whereNow\([^;]*, true\)( : null)?;/g) || []).length, 2);
});
