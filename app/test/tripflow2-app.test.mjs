// Phase 2 of the trip flow on the app side (docs/TRIP_FLOW_SPEC.md, docs/TRIP_STATE_API.md): the registration bodies
// carry tripFlow 2 and c24, the open app rings the calm sequence from the one trip state with one light tap, speech
// passes the voice gate, get off has no quiet note or heads-up location alert, the server's push is shown without
// sound while the app rings it, and the card's words come from the same live time.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-flow2-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, linkTs(js, out, ts));
  return import(pathToFileURL(f).href);
}
const live = await load('src/lib/liveCalc.ts');
const G = await load('src/lib/getOffCore.ts');
const { cardFor } = await load('platform/tripCard.ts');
const LP = await load('platform/livePushCore.ts');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const T0 = Date.parse('2026-10-31T09:00:00Z'); // 8:00pm Sydney
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();
const fmt = { clock: (t) => new Date(t).toISOString().slice(11, 16), short: (n) => String(n || '').replace(/ Station$/, ''), plat: (p) => p || '' };
const NAMES = [['Strathfield', 0], ['Burwood', 3], ['Croydon', 5], ['Ashfield', 7], ['Summer Hill', 9]];
const LEG = { mode: 'train', line: 'T9', tripId: 'T9.a', stopId: 'S0', toStopId: 'S3', from: 'Strathfield Station', to: 'Ashfield Station', planned: iso(at(0)), arrPlanned: iso(at(7)), fromPlatform: 'Platform 6', towards: 'Hornsby Station' };
function feed(t, delay = 0, more = {}) {
  const stops = NAMES.map(([n, m], k) => ({ id: 'S' + k, name: n + ' Station', lat: -33.87 + k / 200, lon: 151.08 + k / 200, planned: iso(at(m)), estimated: iso(at(m) + delay * 60000) }));
  let nextIndex = stops.findIndex((s) => Date.parse(s.estimated) > t - 20000);
  if (nextIndex < 0) nextIndex = stops.length;
  return { kind: 'service', live: true, line: 'T9', mode: 'train', tripId: 'T9.a', mineIndex: 0, alightIndex: 3, nextIndex, stops, ...more };
}

function ride({ delay = 0, speak = true, openAt = at(-3), every = 15000 } = {}) {
  let g = { id: 'g1', legs: [LEG], alerted: {}, watchId: null, share: null, speak, started: at(-5) };
  const log = [];
  let refreshes = 0, until = 0;
  for (let t = openAt; t <= at(12); t += every) {
    refreshes++;
    const r = live.stepLive(g, [feed(t, delay)], t, fmt, null, null, { asOf: t, c24: false, voice: { open: true, silent: false, openSince: openAt, refreshes, speakingUntil: until } });
    if (r.voiceUntil != null) until = r.voiceUntil;
    g = r.g;
    for (const a of r.actions) log.push({ ...a, time: t });
  }
  return { g, log };
}

test('registration: every trip, get-off and card body carries tripFlow 2 and c24', () => {
  const g = { id: 'g1', title: 'x', origin: null, to: null, legs: [LEG], rode: {}, arrivedAt: null, started: at(-5) };
  const p = LP.pushTrip(g, true);
  assert.equal(p.tripFlow, 2);
  assert.equal(p.c24, true);
  assert.equal(p.started, at(-5));
  assert.notEqual(LP.pushKey('a'.repeat(64), g, true), LP.pushKey('a'.repeat(64), g, false), 'a clock change sends it again');
  assert.match(read('platform/livePush.ts'), /trip: pushTrip\(g, c24\), tripFlow: TRIP_FLOW, c24/);
  assert.match(read('src/lib/live.ts'), /kind: 'trip'[\s\S]{0,300}tripFlow: 2, c24: phone24h\(\)/);
});

test('open app: heads-up, Get off now 30 s before the live arrival and arrived, each once, a light tap only for the calm steps', () => {
  for (const delay of [0, 4]) {
    const { log } = ride({ delay, every: 5000 });
    const alerts = log.filter((a) => a.t === 'alert');
    const ids = alerts.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length, ids.join(', '));
    const off = alerts.find((a) => /^Get off now/.test(a.title));
    assert.ok(off, JSON.stringify(alerts.map((a) => a.title)));
    const arr = at(7) + delay * 60000;
    assert.ok(off.time >= arr - 30000 && off.time < arr, `Get off now at ${iso(off.time)} for ${iso(arr)}`);
    assert.equal(off.haptic, 'light');
    for (const a of alerts) assert.doesNotMatch(a.title + ' ' + a.body, /Wake up|Checking for the next one/);
    assert.ok(log.some((a) => a.t === 'clearOngoing'));
  }
});

test('voice gate: nothing said in the first 10 s or the first two refreshes after opening, then the moment is said', () => {
  // Opened 20 s before the heads-up would be said: the gate holds it; a later moment is said.
  const { log } = ride({ openAt: at(6), every: 5000 });
  const said = log.filter((a) => a.t === 'say');
  assert.ok(said.every((a) => a.time >= at(6) + 10000), 'not in the first 10 s');
  assert.ok(said.every((a) => a.time >= at(6) + 10000 && a.time > at(6) + 5000), 'not in the first two refreshes');
  const quiet = ride({ speak: false, every: 5000 }).log.filter((a) => a.t === 'say');
  assert.deepEqual(quiet, [], 'Speak alerts off: nothing said');
});

test('Get off now timer: the open app steps again at the live arrival minus 30 s', () => {
  let g = { id: 'g1', legs: [LEG], alerted: {}, watchId: null, share: null, started: at(-5) };
  const t = at(6) + 20000;
  const r = live.stepLive(g, [feed(t)], t, fmt, null, null, { asOf: t });
  const due = live.nextFlowMoment(r.g, r.s, t);
  assert.equal(due, at(7) - 30000);
});

test('get off (flow2): no quiet note, no heads-up location alert, no in-app moments; only the backup Get off now location alert', () => {
  const s = live.computeLive([LEG], [feed(at(4))], at(4), { rode: { 0: at(7) } });
  const base = { id: 'g1', legs: [LEG], alerted: {}, offSet: {}, speak: true, flow2: true };
  const r = G.getOffStep(base, s, at(4), { stops: 2, now: true }, fmt, { region: true, server: false });
  for (const a of r.actions) {
    assert.notEqual(a.t === 'quiet' || a.t === 'quietSchedule', true, JSON.stringify(a));
    assert.ok(!/soon|quiet|early/.test(String(a.id || '')), JSON.stringify(a));
    assert.ok(a.t !== 'alert' && a.t !== 'say', JSON.stringify(a));
  }
  const src = read('src/lib/getOffCore.ts');
  assert.match(src, /const wantSoonRegion = !g\.flow2 &&/);
  assert.match(src, /if \(!g\.flow2 && g\.backup !== 'region' && !s\.done && !g\.server\)/);
});

test('the server push for the running trip is shown without sound while the app rings the moment itself', () => {
  assert.equal(G.tripPushSoundless({ watch: 'w1', sound: 'default', appState: 'active', tripWatch: 'w1', speaks: false, flow2: true }), true);
  assert.equal(G.tripPushSoundless({ watch: 'w1', sound: 'default', appState: 'background', tripWatch: 'w1', speaks: false, flow2: true }), false, 'locked: the push rings');
  assert.equal(G.tripPushSoundless({ watch: 'w2', sound: 'default', appState: 'active', tripWatch: 'w1', speaks: false, flow2: true }), false);
});

test('card: one live time for the countdown and the delay, Due now, the live platform, 24 hour words, always updated', () => {
  const trip = { legs: [LEG], to: { id: 'S3', name: 'Ashfield Station' } };
  const t = at(-2);
  const s = live.computeLive([LEG], [feed(t, 4, { platform: 'Platform 7' })], t, null, null, { asOf: t, c24: true });
  const c = cardFor(trip, s, t, { c24: true });
  assert.equal(c.departs, at(4), 'the live departure');
  assert.equal(c.warning, '4 min late');
  assert.equal(typeof c.updated, 'number');
  const due = live.computeLive([LEG], [feed(at(4) + 10000, 4)], at(4) + 10000, null, null, { asOf: at(4) + 10000 });
  assert.match(cardFor(trip, due, at(4) + 10000).warning, /^Due now/);
  const cx = live.computeLive([LEG], [feed(t, 0, { cancelled: true })], t, null, null, { asOf: t });
  const cc = cardFor(trip, cx, t);
  assert.equal(cc.departs, null, 'a cancelled run has no countdown');
  assert.match(cc.warning, /^Cancelled/);
});

test('Wake me before my stop is gone from the trip screen and the engine', () => {
  assert.doesNotMatch(read('src/app/go.tsx'), /WakeRow/);
  assert.doesNotMatch(read('src/components/Smart.tsx'), /export function WakeRow/);
  assert.doesNotMatch(read('src/lib/liveEngine.ts'), /scheduleWake|wakeNow/);
});

test('the server copy carries the trip state: gen-livecard inlines tripState and returns its exports', () => {
  const w = read('../backend/src/worker.js');
  const a = w.indexOf('// ---- live card start'), b = w.indexOf('// ---- live card end');
  const block = w.slice(a, b);
  assert.match(block, /\/\/ src\/lib\/tripState\.ts/);
  for (const n of ['computeLive', 'cardFor', 'staleAt', 'cardWarning', 'tripStep', 'tripRender', 'voiceGate', 'backupGetOff', 'serverPollMs']) assert.match(block, new RegExp('\\b' + n + '\\b'), n);
  assert.doesNotMatch(block, /^\s*import\s/m);
});
