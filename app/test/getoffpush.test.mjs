// Get off now from the server (30 Oct, build 210). Set on the phone at the last app open, Get off now rang early when
// the bus ran late after the phone locked. A build 210 trip watch asks the server (getOff: 1); once it says yes the
// phone sets no Get off now of its own (and takes back one already set), the server sends it from live times, and a
// server alert already shown is not rung or read out again. With the app open it still rings and is read out at its
// moment. Builds 201 to 209 never ask. Replayed with a fake clock refreshing every 15 s like the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linkTs } from './tsLink.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(import.meta.url);
const ts = require(path.join(root, 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-getoffpush-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, linkTs(js, out, ts));
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

/** One trip refreshed every 15 s. server: from this minute on the server sends Get off now (null: never). */
function replay({ pref = G.GETOFF_DEFAULT, delay = 0, isLive = true, speak = false, sayNow = true, voice = { now: true, all: false }, from = -3, closeAt = Infinity, openAt = Infinity, serverFrom = null, serverRungAt = null, serverVoice = true } = {}) {
  let g = { id: 'g1', legs: [LEG], alerted: {}, watchId: null, share: null, speak, spoken: {}, offSet: {}, offVoice: {} };
  const alarms = new Map();
  const rang = [], said = [], sets = [], cancels = [];
  const presented = new Set();
  for (let t = at(from); t <= at(20); t += 15000) {
    for (const [id, a] of [...alarms]) if (a.at <= t) { rang.push({ id, t: a.at, by: 'phone', sound: a.sound }); presented.add(id); alarms.delete(id); }
    if (t >= at(closeAt) && t < at(openAt)) continue;
    const server = serverFrom != null && t >= at(serverFrom);
    const serverRung = server && serverRungAt != null && t >= at(serverRungAt) ? { gnow0: 1 } : {};
    const r = live.stepLive(g, [feed(delay, t, isLive)], t, fmt);
    const o = G.getOffStep({ id: g.id, legs: g.legs, alerted: r.g.alerted, offSet: g.offSet, speak, sayNow, spoken: r.g.spoken, voice, offVoice: g.offVoice,
      ...(server ? { server: true, serverRung, serverVoice } : {}) }, pref, r.s, t, fmt);
    g = { ...r.g, alerted: o.g.alerted, spoken: o.g.spoken, offSet: o.g.offSet, offVoice: o.g.offVoice };
    for (const a of o.actions) {
      if (a.t === 'offSchedule') { alarms.set(a.id, { at: a.at, sound: a.sound }); sets.push({ ...a, t }); }
      else if (a.t === 'offCancel') { alarms.delete(a.id); cancels.push({ ...a, t }); }
      else if (a.t === 'offDue') { if (!presented.has(a.id)) { alarms.delete(a.id); rang.push({ id: a.id, t, by: 'app', sound: a.sound }); presented.add(a.id); } }
      else if (a.t === 'say') said.push({ ...a, t });
    }
  }
  return { rang, said, sets, cancels, g };
}
const isNow = (x) => /gnow/.test(x.id || x.key || '');

test('server from the start: Get off now is never set on the phone', () => {
  const r = replay({ serverFrom: -3, closeAt: 1 });
  assert.equal(r.sets.filter(isNow).length, 0, JSON.stringify(r.sets));
  assert.equal(r.rang.filter(isNow).length, 0, 'nothing of its own rings with the phone locked: the server sends it');
});

test('the server says yes: nothing rings from the phone for a time, before or after the yes (31 Oct)', () => {
  // Before 31 Oct the phone set its own Get off now for a time and took it back on the yes. Since 31 Oct it sets none
  // for a time at all (location alerts are taken back on the yes instead: getoffregion31).
  const r = replay({ serverFrom: 1, closeAt: 2 });
  assert.equal(r.sets.filter(isNow).length, 0);
  assert.equal(r.rang.filter(isNow).length, 0);
});

test('a bus running late after lock never rings early on the phone, with or without the server (31 Oct)', () => {
  // App closed from minute 2: before 31 Oct, with no server, the phone rang at its old time. Now it never rings from a
  // clock; the server's push (live) or a location alert (position) is what rings.
  const noServer = replay({ closeAt: 2, delay: 0 });
  assert.equal(noServer.rang.filter(isNow).length, 0);
  assert.equal(noServer.sets.filter(isNow).length, 0);
  const now = replay({ serverFrom: -3, closeAt: 2 });
  assert.equal(now.rang.filter(isNow).length, 0);
});

test('app open: it still rings and is read out at its moment', () => {
  const r = replay({ serverFrom: -3 });
  const g = r.rang.filter(isNow);
  assert.equal(g.length, 1);
  assert.equal(g[0].by, 'app');
  assert.ok(g[0].t >= ARR - 30000 - 15000 && g[0].t <= ARR - 30000 + 15000);
  assert.equal(r.said.filter((x) => /^gnow/.test(x.key)).length, 1);
});

test('the server already showed it: not rung or read out again when the app opens', () => {
  const r = replay({ serverFrom: -3, closeAt: 2, openAt: 9, serverRungAt: 8.6 });
  assert.equal(r.rang.filter(isNow).length, 0);
  assert.equal(r.said.filter((x) => /^gnow/.test(x.key)).length, 0);
  assert.equal(r.g.alerted.gnow0, 1);
  assert.equal(r.g.spoken.gnow0, 1, 'said by its spoken sound');
  const q = replay({ serverFrom: -3, closeAt: 2, openAt: 9, serverRungAt: 8.6, serverVoice: false });
  assert.equal(q.said.filter((x) => /^gnow/.test(x.key)).length, 0, 'no late voice on opening');
  assert.equal(q.g.spoken.gnow0, undefined);
});

test('the heads up (2 or 3 stops early) stays on the phone', () => {
  const r = replay({ serverFrom: -3, pref: { stops: 2, now: true } });
  const o = replay({ pref: { stops: 2, now: true } });
  assert.ok(o.rang.some((x) => /early/.test(x.id)), 'rings without the server');
  assert.deepEqual(r.rang.filter((x) => /early/.test(x.id)), o.rang.filter((x) => /early/.test(x.id)), 'the same with it');
  assert.equal(r.sets.filter(isNow).length, 0);
});

test('no live times: the words say it is the timetable, and the phone sets nothing for that time (31 Oct)', () => {
  const s = live.computeLive([LEG], [feed(0, at(1), false)], at(1), null);
  assert.match(G.getOffWords([LEG], s, 0, 'now', 1, fmt).body, /Timetable time, no live times\.$/);
  const l = live.computeLive([LEG], [feed(0, at(1), true)], at(1), null);
  assert.doesNotMatch(G.getOffWords([LEG], l, 0, 'now', 1, fmt).body, /Timetable/);
  assert.equal(replay({ isLive: false, closeAt: 1 }).sets.filter(isNow).length, 0);
});

test('only build 210 and later ask; the shown server alerts are read by watch and leg', () => {
  assert.equal(G.serverGetOffSupported('ios', '209'), false);
  assert.equal(G.serverGetOffSupported('ios', '210'), true);
  assert.equal(G.serverGetOffSupported('android', 5), false);
  assert.equal(G.serverGetOffSupported('android', 6), true);
  assert.equal(G.serverGetOffSupported('web', 999), false);
  assert.equal(G.serverGetOffSupported('ios', null), false);
  const shown = [{ data: { watch: 'w1', getOff: '0' } }, { data: { watch: 'w1', getOff: '1' } }, { data: { watch: 'w2', getOff: '0' } }, { data: { watch: 'w1', tag: 'ww1a' } }, { data: { watch: 'w1', getOff: 'x' } }, {}];
  assert.deepEqual(G.serverRungKeys('w1', shown), { gnow0: 1, gnow1: 1 });
  assert.deepEqual(G.serverRungKeys(null, shown), {});
});

test('the wiring: asked only with a push token and Get off now on, taken off on yes, quiet in front, reset on Switch', () => {
  const l = src('lib/live.ts');
  assert.match(l, /ps\.status === 'on' && serverGetOff\(\) && readGetOff\(store\.getOff\(\)\)\.now/);
  assert.match(l, /off = \{ getOff: 1, \.\.\.\(say \? \{ getOffVoice: 1 \} : \{\}\) \}/);
  assert.match(l, /\(r\.watch as any\)\.getOff === true && 'getOff' in off/);
  assert.match(l, /if \(server\) for \(const k of Object\.keys\(offSet\)\) if \(\/\^\(gnow\|quiet\)\\d\+\$\/\.test\(k\)\) \{ cancelGetOff/);
  assert.match(l, /if \(server\) for \(const k of Object\.keys\(offRegion\)\) if \(\/\^rnow\\d\+\$\/\.test\(k\)\) \{ cancelGetOff/);
  assert.match(l, /setServerGetOffWatch\(null\);\n  setLive\(null\);/);
  const e = src('lib/liveEngine.ts');
  assert.match(e, /const server = !!g\.offServer && !!g\.watchId;/);
  assert.match(e, /server: true, serverRung, serverVoice/);
  const p = src('lib/push.ts');
  assert.match(p, /appState === 'active' && d && d\.getOff != null && isServerGetOffWatch\(d\.watch\)/);
  assert.match(src('components/Smart.tsx'), /setLive\(\{ \.\.\.n, watchId: null, offServer: false \}\)/);
  const n = src('lib/getOffNotify.ts');
  assert.match(n, /isOn\('getOffPush'\)/);
  assert.match(n, /serverGetOffSupported\(Platform\.OS, build\)/);
});
