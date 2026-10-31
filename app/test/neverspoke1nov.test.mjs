// "Never spoke" (Bidur, 1 Nov 10:00 AM, build 212): with the app open, trip flow 2 showed the server's push for a moment
// without its sound and read the moment out in the phone's own voice only after the voice gate (10 s and two
// refreshes after opening, never on Silent). Kylie's clip was never heard with the app open. Now a moment whose clip
// the server's push plays (heads-up, Get off now; arrival from build 212) is left to that push: its sound plays with the
// app open too, and the app does not read the same moment out. Moments without a clip are read out as before.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-neverspoke-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, linkTs(js, out, ts));
  return import(pathToFileURL(f).href);
}
const live = await load('src/lib/liveCalc.ts');
const G = await load('src/lib/getOffCore.ts');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const T0 = Date.parse('2026-10-31T09:00:00Z');
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();
const fmt = { clock: (t) => new Date(t).toISOString().slice(11, 16), short: (n) => String(n || '').replace(/ Station$/, ''), plat: (p) => p || '' };
const NAMES = [['Strathfield', 0], ['Burwood', 3], ['Croydon', 5], ['Ashfield', 7], ['Summer Hill', 9]];
const LEG = { mode: 'train', line: 'T9', tripId: 'T9.a', stopId: 'S0', toStopId: 'S3', from: 'Strathfield Station', to: 'Ashfield Station', planned: iso(at(0)), arrPlanned: iso(at(7)), fromPlatform: 'Platform 6', towards: 'Hornsby Station' };
function feed(t) {
  const stops = NAMES.map(([n, m], k) => ({ id: 'S' + k, name: n + ' Station', lat: -33.87 + k / 200, lon: 151.08 + k / 200, planned: iso(at(m)), estimated: iso(at(m)) }));
  let nextIndex = stops.findIndex((s) => Date.parse(s.estimated) > t - 20000);
  if (nextIndex < 0) nextIndex = stops.length;
  // The train's position at Ashfield once it is in (arrival by evidence, as the 9:59:45 Kings Cross arrival was).
  const vehicle = t >= at(7) && t < at(7) + 40000 ? { lat: stops[3].lat, lon: stops[3].lon, ageS: 0 } : null;
  return { kind: 'service', live: true, line: 'T9', mode: 'train', tripId: 'T9.a', mineIndex: 0, alightIndex: 3, nextIndex, stops, ...(vehicle ? { vehicle } : {}) };
}
function ride(serverClips) {
  let g = { id: 'g1', legs: [LEG], alerted: {}, watchId: 'w1', offServer: true, share: null, speak: true, started: at(-5) };
  const log = [];
  let refreshes = 0, until = 0;
  for (let t = at(-3); t <= at(12); t += 5000) {
    refreshes++;
    const r = live.stepLive(g, [feed(t)], t, fmt, null, null, { asOf: t, c24: false, serverClips, voice: { open: true, silent: false, openSince: at(-3), refreshes, speakingUntil: until } });
    if (r.voiceUntil != null) until = r.voiceUntil;
    g = r.g;
    for (const a of r.actions) log.push({ ...a, time: t });
  }
  return log;
}

test('app open, build 212 with a server watch: heads-up, Get off now and arrival are left to the Kylie push, not read out', () => {
  const log = ride(['headsup', 'getoff', 'arrived']);
  const alerts = log.filter((a) => a.t === 'alert').map((a) => a.title);
  assert.ok(alerts.some((x) => /is next/.test(x)) && alerts.some((x) => /^Get off now/.test(x)) && alerts.some((x) => /^Arrived/.test(x)), alerts.join(' | '));
  assert.deepEqual(log.filter((a) => a.t === 'say').map((a) => a.text), [], 'the clip moments are not said in the phone voice');
});

test('build 211 (no arrival clip): heads-up and Get off now go to the push, arrival is still read out by the app', () => {
  const said = ride(['headsup', 'getoff']).filter((a) => a.t === 'say').map((a) => a.text);
  assert.equal(said.length, 1, said.join(' | '));
  assert.match(said[0], /arrived/i);
});

test('no server clips (no server watch, spoken sounds off): the app reads every moment out, the arrival included', () => {
  for (const clips of [[], null]) {
    const said = ride(clips).filter((a) => a.t === 'say').map((a) => a.text);
    assert.equal(said.length, 3, JSON.stringify(said));
    assert.match(said[2], /You've arrived at Ashfield/);
  }
});

test('open app at the stop: the arrival is rung and said in the refresh that sees it (it was "skipped" before)', () => {
  const log = ride([]);
  assert.ok(log.some((a) => a.t === 'alert' && /^Arrived at Ashfield/.test(a.title)), JSON.stringify(log.filter((a) => a.t === 'alert').map((a) => a.title)));
});

test('opening the app after the stop: the finished leg is still done quietly, nothing stale is said', () => {
  let g = { id: 'g1', legs: [LEG], alerted: {}, watchId: 'w1', offServer: true, share: null, speak: true, started: at(-5) };
  const log = [];
  let refreshes = 0;
  for (let t = at(7) + 20000; t <= at(9); t += 5000) {
    refreshes++;
    const r = live.stepLive(g, [feed(t)], t, fmt, null, null, { asOf: t, c24: false, serverClips: [], voice: { open: true, silent: false, openSince: at(7) + 20000, refreshes, speakingUntil: 0 } });
    g = r.g;
    log.push(...r.actions);
  }
  assert.deepEqual(log.filter((a) => a.t === 'say'), []);
  assert.ok(!log.some((a) => a.t === 'alert' && /^Arrived/.test(a.title)), 'no late Arrived banner');
});

test('push handler: a Kylie clip push plays with the app open; a default-sound push of the running trip stays quiet', () => {
  const base = { watch: 'w1', appState: 'active', tripWatch: 'w1', speaks: true, flow2: true };
  for (const s of ['custom', 'getoff_now.wav', 'getoff_soon.wav', 'arrival.wav', 'arrival']) assert.equal(G.tripPushSoundless({ ...base, sound: s }), false, s);
  assert.equal(G.tripPushSoundless({ ...base, sound: 'default' }), true, 'the app reads that one out');
  assert.equal(G.tripPushSoundless({ ...base, sound: null }), true);
  assert.equal(G.tripPushSoundless({ ...base, sound: 'getoff_now.wav', appState: 'background' }), false);
});

test('serverClipsFor: by platform, build and server watch', () => {
  assert.deepEqual(G.serverClipsFor('ios', '212', true), ['headsup', 'getoff', 'arrived']);
  assert.deepEqual(G.serverClipsFor('ios', '211', true), ['headsup', 'getoff']);
  assert.deepEqual(G.serverClipsFor('ios', '209', true), [], 'no spoken sounds before 210');
  assert.deepEqual(G.serverClipsFor('ios', '212', false), [], 'no server watch: the app speaks');
  assert.deepEqual(G.serverClipsFor('android', '6', true), ['headsup', 'getoff']);
  assert.deepEqual(G.serverClipsFor('web', '1', true), []);
});

test('the engine hands the server clips to the trip step', () => {
  assert.match(read('src/lib/liveEngine.ts'), /serverClips: serverClips\(!!g\.offServer && !!g\.watchId\)/);
});
