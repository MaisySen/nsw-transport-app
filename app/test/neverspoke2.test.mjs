// "Never spoke" follow-up (Bidur, 1 Nov 10:00 AM, build 212: "Was in silent. But headphone on"). Two fixes, JS only.
// A) Headphones: with the app open, every calm moment (heads-up, Get off now, arrival) is voiced by the app itself, at
//    its moment (no 10 s / two-refresh wait), through the ambient session: iOS mutes that on the speaker in Silent mode
//    and plays it in headphones. The running trip's server push stays soundless while the app is open, so it is never
//    heard twice. A build with the native clip player (213) plays Kylie's clip there instead of the phone's voice.
//    A moment that was already due before the app came to the front is never spoken (catch-up stays quiet).
// B) Multi-leg: tapping a trip alert (the 40T2 then T4 trip's "At Central: change here") opened the Watching screen,
//    whose one button is "Stop watching"; the trip was stopped 12 s later and the T4 leg never ran. A trip alert of the
//    running trip now opens the live trip, and the Watching screen never offers to stop the trip in progress.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-neverspoke2-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, linkTs(js, out, ts));
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));
const live = await load('src/lib/liveCalc.ts');
const T = await load('src/lib/tripState.ts');
const G = await load('src/lib/getOffCore.ts');

const T0 = Date.parse('2026-10-31T09:00:00Z');
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();
const fmt = { clock: (t) => new Date(t).toISOString().slice(11, 16), short: (n) => String(n || '').replace(/ Station$/, ''), plat: (p) => p || '' };

// ---- one train leg (sample stops), the train at the stop off by its position ----
const NAMES = [['Lidcombe', 0], ['Auburn', 3], ['Clyde', 5], ['Granville', 7], ['Harris Park', 9]];
const LEG = { mode: 'train', line: 'T9', tripId: 'T9.a', stopId: 'S0', toStopId: 'S3', from: 'Lidcombe Station', to: 'Granville Station', planned: iso(at(0)), arrPlanned: iso(at(7)), fromPlatform: 'Platform 6', towards: 'Parramatta Station' };
function feed(t) {
  const stops = NAMES.map(([n, m], k) => ({ id: 'S' + k, name: n + ' Station', lat: -33.87 + k / 200, lon: 151.08 + k / 200, planned: iso(at(m)), estimated: iso(at(m)) }));
  let nextIndex = stops.findIndex((s) => Date.parse(s.estimated) > t - 20000);
  if (nextIndex < 0) nextIndex = stops.length;
  const vehicle = t >= at(7) && t < at(7) + 40000 ? { lat: stops[3].lat, lon: stops[3].lon, ageS: 0 } : null;
  return { kind: 'service', live: true, line: 'T9', mode: 'train', tripId: 'T9.a', mineIndex: 0, alightIndex: 3, nextIndex, stops, ...(vehicle ? { vehicle } : {}) };
}
// The app open from `from`, refreshing every 5 s; flow extras (clipPlayer) as given.
function ride({ from = at(-3), to = at(12), extra = {}, step = 5000 } = {}) {
  let g = { id: 'g1', legs: [LEG], alerted: {}, watchId: 'w1', offServer: true, share: null, speak: true, started: at(-5) };
  const log = [];
  let refreshes = 0, until = 0;
  for (let t = from; t <= to; t += step) {
    refreshes++;
    const r = live.stepLive(g, [feed(t)], t, fmt, null, null, { asOf: t, c24: false, ...extra, voice: { open: true, silent: false, openSince: from, refreshes, speakingUntil: until } });
    if (r.voiceUntil != null) until = r.voiceUntil;
    g = r.g;
    for (const a of r.actions) log.push({ ...a, time: t });
  }
  return log;
}
const said = (log) => log.filter((a) => a.t === 'say').map((a) => a.text);
const clips = (log) => log.filter((a) => a.t === 'clip');

// ---------- A: the voice rule ----------
test('voice gate: a fresh moment is said at its moment, 1 s after opening (no 10 s or two-refresh wait)', () => {
  const t = at(10);
  const v = { open: true, silent: false, openSince: t - 1000, refreshes: 1, speakingUntil: 0 };
  assert.equal(T.voiceGate(v, t, 'Get off now for Clyde.', 2000, false, t).words, 'Get off now for Clyde.');
});

test('voice gate: never a moment that was due before the app came to the front (catch-up stays quiet)', () => {
  const t = at(10);
  const v = { open: true, silent: false, openSince: t - 2000, refreshes: 1, speakingUntil: 0 };
  assert.match(T.voiceGate(v, t, 'x', 0, false, t - 20000).why, /before the app came to the front/);
  // no known moment (a delay first seen now): quiet on the first refresh after opening, said from the next one
  assert.match(T.voiceGate(v, t, 'x', 0, false, null).why, /first refresh/);
  assert.equal(T.voiceGate({ ...v, refreshes: 2 }, t, 'x', 0, false, null).words, 'x');
  assert.match(T.voiceGate({ ...v, open: false }, t, 'x', 0, false, t).why, /not in front/);
});

test('voice gate: Silent mutes the speaker, headphones still hear it (the ambient session, as iOS routes it)', () => {
  const t = at(10);
  const v = { open: true, silent: true, openSince: t - 60000, refreshes: 5, speakingUntil: 0 };
  assert.match(T.voiceGate(v, t, 'x', 0, false, t).why, /Silent/);
  assert.equal(T.voiceGate({ ...v, headphones: true }, t, 'x', 0, false, t).words, 'x');
  assert.equal(T.TRIP_RULES.VOICE_OPEN_FOR, undefined, 'the 10 s wait is gone');
  assert.equal(T.TRIP_RULES.VOICE_SILENT_REFRESHES, undefined, 'the two-refresh wait is gone');
});

test('app open, build 212 (no clip player): heads-up, Get off now and arrival are each said once by the app', () => {
  // A server watch with Kylie clips (what the engine handed over on 1 Nov as serverClips) no longer silences the app:
  // on Silent with headphones the push's clip is muted, so the app's own voice is the one that is heard.
  const log = ride({ extra: { serverClips: ['headsup', 'getoff', 'arrived'] } });
  const s = said(log);
  assert.equal(s.length, 3, s.join(' | '));
  assert.match(s[0], /Granville is next/);
  assert.match(s[1], /Get off now/);
  assert.match(s[2], /arrived at Granville/i);
  assert.deepEqual(clips(log), []);
});

test('app open: the running trip\'s server push is shown without sound, so the moment is never heard twice', () => {
  const base = { watch: 'w1', appState: 'active', tripWatch: 'w1', speaks: true, flow2: true };
  for (const s of ['custom', 'getoff_now.wav', 'getoff_soon.wav', 'arrival.wav', 'default', null]) assert.equal(G.tripPushSoundless({ ...base, sound: s }), true, String(s));
  assert.equal(G.tripPushSoundless({ ...base, sound: 'getoff_now.wav', appState: 'background' }), false, 'locked or away: the push rings Kylie');
  assert.equal(G.tripPushSoundless({ ...base, watch: 'other' }), false, 'another watch keeps its sound');
});

test('build with the native clip player (213): Kylie\'s clip plays in the app for the clip moments, not the phone voice', () => {
  const log = ride({ extra: { clipPlayer: true } });
  const c = clips(log);
  assert.deepEqual(c.map((a) => a.clip), ['headsup', 'getoff', 'arrived'], JSON.stringify(c));
  assert.deepEqual(c.map((a) => a.file), ['getoff_soon', 'getoff_now', 'arrival']);
  assert.ok(c.every((a) => typeof a.text === 'string' && a.text.length > 5), 'the words ride along for a phone without the clip');
  assert.deepEqual(said(log), [], 'no phone-voice copy of a clip moment');
});

test('Get off now due 3 s after the app opened is said at once, not lost to a wait', () => {
  // Get off now is due at the live arrival (7:00) minus 30 s = 6:30. Open the app at 6:27, refresh every second.
  const log = ride({ from: at(6.45), to: at(6.7), step: 1000 });
  assert.ok(said(log).some((x) => /Get off now/.test(x)), JSON.stringify(said(log)));
});

test('opening the app 20 s after Get off now rang: nothing is said for it', () => {
  const log = ride({ from: at(6.5) + 20000, to: at(6.95), step: 5000 });
  assert.ok(!said(log).some((x) => /Get off now|is next/.test(x)), JSON.stringify(said(log)));
});

test('engine: passes the clip player, plays clips through it, and speaks through the ambient (Silent-aware) session', () => {
  const eng = read('src/lib/liveEngine.ts');
  assert.match(eng, /clipPlayer: hasClipPlayer\(\)/);
  assert.match(eng, /a\.t === 'clip'\) playClip\(a\.file, a\.text\)/);
  assert.match(eng, /a\.t === 'say'\) speak\(a\.text, \{ alert: true \}\)/);
  assert.ok(!/serverClips\(/.test(eng), 'the push no longer stands in for the app voice');
  const nx = read('src/lib/nativeExtras.ts');
  assert.match(nx, /typeof m\.playAlertClip [!=]== 'function'/, 'feature detected: only a build that has it');
  assert.match(nx, /typeof m\.audioRoute [!=]== 'function'/);
  assert.match(nx, /export async function playClip\(/);
});

// ---------- B: a trip with a change keeps going ----------
// Bus 400 Lidcombe Stand B to Auburn, then the T9 from Auburn to Granville (sample stops, as the 40T2 then T4 shape).
const BUS = { mode: 'bus', line: '400', tripId: 'B400.a', stopId: 'B0', toStopId: 'B2', from: 'Lidcombe Station, Stand B', to: 'Auburn Station, Stand A', planned: iso(at(-20)), arrPlanned: iso(at(-10)), fromPlatform: 'Stand B', towards: 'Auburn' };
const TRAIN = { ...LEG, stopId: 'S1', from: 'Auburn Station', planned: iso(at(3)), fromPlatform: 'Platform 2' };
function busFeed(t) {
  const st = [['Lidcombe Station, Stand B', -20], ['Mona St', -15], ['Auburn Station, Stand A', -10]].map(([n, m], k) => ({ id: 'B' + k, name: n, lat: -33.86 + k / 300, lon: 151.04 + k / 300, planned: iso(at(m)), estimated: iso(at(m)) }));
  let nextIndex = st.findIndex((s) => Date.parse(s.estimated) > t - 20000);
  if (nextIndex < 0) nextIndex = st.length;
  const k = t >= at(-10) ? 2 : t >= at(-15) ? 1 : 0;
  const vehicle = t < at(-9) ? { lat: st[k].lat, lon: st[k].lon, ageS: 0 } : null;
  return { kind: 'service', live: true, line: '400', mode: 'bus', tripId: 'B400.a', mineIndex: 0, alightIndex: 2, nextIndex, stops: st, ...(vehicle ? { vehicle } : {}) };
}
function trainFeed(t) {
  const d = feed(t);
  return { ...d, mineIndex: 1 };
}
function trip({ tapAt = null } = {}) {
  let g = { id: 'g2', legs: [BUS, TRAIN], alerted: {}, watchId: 'w2', offServer: true, share: null, speak: true, started: at(-25) };
  const log = [], states = [];
  let refreshes = 0, until = 0;
  for (let t = at(-22); t <= at(12); t += 5000) {
    refreshes++;
    const r = live.stepLive(g, [busFeed(t), trainFeed(t)], t, fmt, null, null, { asOf: t, c24: false, voice: { open: true, silent: false, openSince: at(-22), refreshes, speakingUntil: until } });
    if (r.voiceUntil != null) until = r.voiceUntil;
    g = r.g;
    states.push({ t, done: r.s.done, cur: r.s.done ? null : r.s.cur });
    for (const a of r.actions) log.push({ ...a, time: t });
  }
  return { log, states, g };
}

test('a trip with a change: after "change here" the trip goes on to the second leg and ends only at the last stop', () => {
  const { log, states } = trip();
  const titles = log.filter((a) => a.t === 'alert').map((a) => a.title);
  assert.ok(titles.some((x) => /^At Auburn: change here/.test(x)), titles.join(' | '));
  assert.ok(titles.some((x) => /^Arrived at Granville/.test(x)), titles.join(' | '));
  const mid = states.filter((s) => s.t > at(-9) && s.t < at(6.9));
  assert.ok(mid.length && mid.every((s) => !s.done && s.cur === 1), 'between the change and the last stop the trip is on leg 2: ' + JSON.stringify(mid.find((s) => s.done || s.cur !== 1)));
  assert.ok(!log.some((a) => (a.t === 'end' || a.t === 'stopWatch') && a.time < at(7)), 'nothing ends the trip before the last stop');
  assert.ok(said(log).some((x) => /change/i.test(x)), 'the change is said (no clip for it)');
});

test('tapping an alert of the running trip opens the live trip, not the Watching screen with Stop watching', async () => {
  assert.ok(exists('src/lib/alertTapCore.ts'), 'alertTapCore.ts');
  const A = await load('src/lib/alertTapCore.ts');
  // The 1 Nov 9:43 alert: APNs data { url: "/#/watch/CLHO...", watch: "CLHO...", tag: "w...arrived" }
  const d = { url: '/#/watch/w2', watch: 'w2', id: 7, tag: 'ww2arrived' };
  assert.equal(A.alertTapRoute(d, { watchId: 'w2' }), 'go');
  assert.equal(A.alertTapRoute(d, { watchId: 'w9' }), 'watch', 'another watch still opens its own screen');
  assert.equal(A.alertTapRoute(d, null), 'watch');
  assert.equal(A.alertTapRoute({ go: 1 }, null), 'go');
  assert.equal(A.alertTapRoute({ tag: 'tb' }, null), null);
  const lay = read('src/app/_layout.tsx');
  assert.match(lay, /alertTapRoute\(d, getLive\(\)\)/);
});

test('the Watching screen of the trip in progress offers Open trip, never Stop watching', () => {
  const src = read('src/app/watch/[id].tsx');
  assert.match(src, /const ours = !!w && w\.kind === 'trip' && getLive\(\)\?\.watchId === w\.id/);
  assert.match(src, /title="Open trip"/);
  assert.match(src, /w\.active && !ours \?/);
});
