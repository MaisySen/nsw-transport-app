// Get off alert you choose, spoken (28 Oct): "Alert 1, 2 or 3 stops early" counted on the stops the service really
// calls at (an express skips some), and a spoken "Get off now at <stop>" as the final alert rings, even with Speak
// alerts off, never once the arrival has passed, muted by Silent mode, and off when turned off. Replayed with a fake
// clock refreshing every 15 s like the app, with the phone's own scheduled alerts simulated.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-getoffspoken-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const live = await load('src/lib/liveCalc.ts');
const format = await load('src/lib/format.ts');
const G = await load('src/lib/getOffCore.ts');
const short = (n) => String(n || '').replace(/ Station$/, '');
const fmt = { clock: format.clock, short, plat: (p) => (p ? p.replace(/^Platform\s*/i, 'Platform ') : '') };
const src = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');

const T0 = Date.parse('2026-10-28T08:00:00Z'); // Wed 28 Oct, 7:00pm Sydney
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();
// An express on the T9: gets on at stop 1, off at stop 6; stops 3 and 5 are run through (skipped).
const NAMES = ['Cheltenham', 'Epping', 'Eastwood', 'Denistone', 'West Ryde', 'Meadowbank', 'Rhodes', 'Concord West'];
const MIN = [-2, 0, 2, 4, 6, 8, 10, 12];
const SKIP = new Set([3, 5]);
const MINE = 1, OFF = 6;
const LEG = { mode: 'train', line: 'T9', tripId: 'T9.x', stopId: 'EPP', toStopId: 'RHO', from: 'Epping Station', to: 'Rhodes Station', planned: iso(at(0)), arrPlanned: iso(at(10)), fromPlatform: 'Platform 1', towards: 'Hornsby Station' };
const ARR = at(MIN[OFF]);

function feed(delayMin, t, isLive, skip = SKIP) {
  const stops = NAMES.map((name, k) => ({ id: name.slice(0, 3).toUpperCase() + k, name: name + ' Station', planned: iso(at(MIN[k])), estimated: iso(at(MIN[k]) + delayMin * 60000), mine: k === MINE, alight: k === OFF, ...(skip.has(k) ? { skipped: true } : {}) }));
  let nextIndex = stops.findIndex((s, k) => !skip.has(k) && Date.parse(s.estimated) > t - 20000);
  if (nextIndex < 0) nextIndex = stops.length;
  return { kind: 'service', live: isLive, line: 'T9', mode: 'train', mineIndex: MINE, alightIndex: OFF, nextIndex, stops };
}

/** One trip refreshed every 15 s. The app runs before `closeAt` and from `openAt` (minutes); between, only the phone's set alerts ring. */
function replay({ pref = G.GETOFF_DEFAULT, delay = 0, isLive = true, speak = false, sayNow = true, from = -3, closeAt = Infinity, openAt = Infinity, skip = SKIP } = {}) {
  let g = { id: 'g1', legs: [LEG], alerted: {}, watchId: null, share: null, speak, spoken: {}, offSet: {} };
  const alarms = new Map();
  const rang = [], said = [];
  const presented = new Set();
  let ended = false;
  for (let t = at(from); t <= at(20) && !ended; t += 15000) {
    for (const [id, when] of [...alarms]) if (when <= t) { rang.push({ id, t: when, by: 'phone' }); presented.add(id); alarms.delete(id); }
    if (t >= at(closeAt) && t < at(openAt)) continue;
    const r = live.stepLive(g, [feed(delay, t, isLive, skip)], t, fmt);
    const o = G.getOffStep({ id: g.id, legs: g.legs, alerted: r.g.alerted, offSet: g.offSet, speak, sayNow, spoken: r.g.spoken }, pref, r.s, t, fmt);
    g = { ...r.g, alerted: o.g.alerted, spoken: o.g.spoken, offSet: o.g.offSet };
    for (const a of o.actions) {
      if (a.t === 'offSchedule') alarms.set(a.id, a.at);
      else if (a.t === 'offCancel') alarms.delete(a.id);
      else if (a.t === 'offDue') { if (!presented.has(a.id)) { alarms.delete(a.id); rang.push({ id: a.id, t, by: 'app' }); presented.add(a.id); } }
      else if (a.t === 'say') said.push({ ...a, t });
    }
    for (const a of r.actions) if (a.t === 'end') ended = true;
  }
  return {
    early: rang.filter((x) => /-early\d+$/.test(x.id)),
    now: rang.filter((x) => /-gnow\d+$/.test(x.id)),
    said, saidNow: said.filter((x) => /^gnow/.test(x.key)), saidEarly: said.filter((x) => /^early/.test(x.key)),
  };
}
const leaves = (k, d = 0) => at(MIN[k]) + d * 60000;

test('stops are counted on the stops the service calls at: run through stops are not counted', () => {
  const s = live.computeLive([LEG], [feed(0, at(1))], at(1), null);
  assert.equal(G.earlyTime(s, 0, 1), leaves(4), '1 early is the last stop it calls at before yours');
  assert.equal(G.earlyTime(s, 0, 2), leaves(2), '2 early skips the stop it runs through');
  assert.ok(Number.isNaN(G.earlyTime(s, 0, 3)), '3 early would be where you got on: no heads up');
  const all = live.computeLive([LEG], [feed(0, at(1), true, new Set())], at(1), null);
  assert.equal(G.earlyTime(all, 0, 2), leaves(4), 'an all stops service counts every stop');
  assert.equal(s.stopsLeft != null ? s.stopsLeft : 3, 3, 'stops left counts only stops it calls at');
});

for (const delay of [0, 3]) {
  test(`express, 2 stops early, ${delay ? delay + ' min late' : 'on time'}: the heads up as it leaves the stop 2 calls before yours`, () => {
    const r = replay({ pref: { stops: 2, now: true }, delay });
    assert.equal(r.early.length, 1, JSON.stringify(r));
    const want = leaves(2, delay);
    assert.ok(r.early[0].t >= want && r.early[0].t <= want + 30000, `rang ${format.clockSec(r.early[0].t)}, want ${format.clockSec(want)}`);
    assert.equal(r.now.length, 1);
    assert.ok(r.early[0].t < r.now[0].t);
  });
}

test('express, 3 stops early on a ride that calls at only 2: no heads up, Get off now still once', () => {
  const r = replay({ pref: { stops: 3, now: true } });
  assert.equal(r.early.length, 0);
  assert.equal(r.now.length, 1);
});

for (const delay of [0, 2, -1]) {
  test(`spoken Get off now with Speak alerts off (${delay} min): said once, quiet, in the 30 s before the live arrival`, () => {
    const r = replay({ pref: { stops: 2, now: true }, delay, sayNow: true, speak: false });
    assert.equal(r.saidNow.length, 1, JSON.stringify(r.said));
    const arr = ARR + delay * 60000;
    assert.equal(r.saidNow[0].text, 'Get off now at Rhodes.');
    assert.equal(r.saidNow[0].quiet, true, 'follows Silent mode');
    assert.ok(r.saidNow[0].t >= arr - G.GETOFF_NOW_LEAD_MS - 1 && r.saidNow[0].t < arr, format.clockSec(r.saidNow[0].t));
    assert.equal(r.saidEarly.length, 0, 'only the final alert is spoken without Speak alerts');
  });
}

test('speech turned off: nothing is said, the Get off now alert still rings once on time', () => {
  const r = replay({ pref: { stops: 2, now: true }, sayNow: false, speak: false });
  assert.equal(r.said.length, 0);
  assert.equal(r.now.length, 1);
  assert.ok(r.now[0].t >= ARR - G.GETOFF_NOW_LEAD_MS - 1 && r.now[0].t < ARR);
});

test('Get off now turned off: nothing is said even with speech on', () => {
  const r = replay({ pref: { stops: 1, now: false }, sayNow: true });
  assert.equal(r.said.length, 0);
  assert.equal(r.now.length, 0);
});

test('Speak alerts on: every alert is said through the app\'s own voice session (not marked quiet)', () => {
  const r = replay({ pref: { stops: 2, now: true }, speak: true, sayNow: true });
  assert.equal(r.saidNow.length, 1);
  assert.equal(r.saidNow[0].quiet, undefined);
  assert.equal(r.saidEarly.length, 1);
});

test('never after arrival: opened after the arrival, nothing rings and nothing is said', () => {
  const r = replay({ pref: { stops: 1, now: true }, from: 10.25 });
  assert.equal(r.now.length, 0);
  assert.equal(r.said.length, 0);
});

test('never after arrival: the phone rang it with the app closed, the app opened after arrival does not say it late', () => {
  const r = replay({ pref: { stops: 1, now: true }, closeAt: 9, openAt: 10.25 });
  assert.equal(r.now.length, 1);
  assert.equal(r.now[0].by, 'phone');
  assert.ok(r.now[0].t < ARR);
  assert.equal(r.said.length, 0, 'news that came 45 s ago is not said once the train is there');
});

test('the phone rang it and the app opens before arrival: said then, still before arrival', () => {
  const r = replay({ pref: { stops: 1, now: true }, closeAt: 9, openAt: 9.75 });
  assert.equal(r.saidNow.length, 1);
  assert.ok(r.saidNow[0].t < ARR);
});

test('no live times: said with the timetable Get off now, a minute before, never after', () => {
  const r = replay({ pref: { stops: 1, now: true }, isLive: false });
  assert.equal(r.saidNow.length, 1);
  assert.ok(r.saidNow[0].t >= ARR - G.GETOFF_NOW_TIMETABLE_LEAD_MS - 15000 && r.saidNow[0].t < ARR);
});

test('the words, the stored choice and the menu labels', () => {
  assert.equal(G.getOffSayText('Central', false), 'Get off now at Central.');
  assert.equal(G.getOffSayText('Central', true), 'Get off now at Central. Change here.');
  assert.equal(G.getOffSayText('', false), 'Get off now.');
  assert.equal(G.readGetOffSay(undefined), true, 'on unless turned off');
  assert.equal(G.readGetOffSay(false), false);
  assert.equal(G.readGetOffSay('no'), true);
  assert.deepEqual([1, 2, 3].map(G.earlyWords), ['Alert 1 stop early', 'Alert 2 stops early', 'Alert 3 stops early']);
  const legs = [LEG, { ...LEG, line: 'T1', from: 'Rhodes Station', to: 'Hornsby Station' }];
  const s = live.computeLive(legs, [feed(0, at(8)), null], at(8), null);
  assert.equal(G.getOffWords(legs, s, 0, 'now', 1, fmt).say, 'Get off now at Rhodes. Change here.');
});

test('the app wiring: speech feature detected, quiet speech skips the app session, menu item only where it can speak', () => {
  const eng = src('lib/liveEngine.ts');
  assert.match(eng, /sayNow: readGetOffSay\(store\.getOffSay\(\)\) && hasSpeech\(\)/);
  assert.match(eng, /speak\(a\.text, a\.quiet \? \{ quiet: true \} : \{\}\)/);
  const nx = src('lib/nativeExtras.ts');
  assert.match(nx, /const own = !opts\.quiet && !!a\?\.start\?\.\(\)/);
  const menu = src('components/GetOffChoice.tsx');
  assert.match(menu, /earlyWords\(n\)/);
  assert.match(menu, /canSpeak \? \{ on: sayOn/);
  assert.match(menu, /if \(speech && pref\.now\)/);
  assert.match(src('lib/store.ts'), /setGetOffSay\(on: boolean\)/);
  assert.doesNotMatch(menu + eng, /setInterval|useNow\(1000\)/);
});
