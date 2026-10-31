// "Never spoke" (Bidur, 1 Nov 10:00 AM, build 212). The morning fix (c72d75f) left Kylie's clip moments to the server's
// push with the app open. Bidur then said he was on Silent with headphones: a push's sound is muted in Silent mode even
// in headphones, so that left him with nothing. Superseded by test/neverspoke2.test.mjs (the open app voices every
// moment itself, at its moment, through the ambient session, and the push stays soundless while open). What stays
// from the morning fix and is checked here: the open app rings and says the arrival in the refresh that sees it, and
// opening the app after the stop says nothing old.
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

test('the app reads every moment out, the arrival included (whatever the server clips)', () => {
  for (const clips of [[], null, ['headsup', 'getoff', 'arrived']]) {
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

