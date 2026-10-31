// staleopen31 (31 Oct, Bidur on build 210, T1 Strathfield to Ashfield due 12:06, flags on). Locked, the server's
// "Ashfield is next" and Get off now came on time. On opening the app at about 12:07 three banners and a voice came at
// once: "Leave now: Your T1 is 0 min away" (a departure reminder during the ride), "Arriving at Ashfield Station in 2
// min" (after 12:06) and "You've arrived at Ashfield". Our notes table shows all three were server watch notes written
// on time (11:57:57, 12:03:56, 12:06:55) that push never carried (pushed 0, no Expo token for that phone); the app's
// catch-up ask (push.ts pollNotes) posted every one it found, with no check on how old it was.
// Required: (1) nothing shown or said on opening for a moment that passed; (2) Leave now never during a trip or after
// its departure, and the phone's own leave reminders come off at Start trip; (3) no app banner for a stop whose Get off
// now (server push or location alert) is already on the phone; (4) "You've arrived" over 45 s late: the quiet state
// only; (5) a trip's alerts set ahead are taken back when it ends, or at the next launch.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-staleopen-'));
const has = (rel) => fs.existsSync(path.join(root, rel));
const tr = (src) => ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
let seq = 0;
async function load(rel) {
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '') + '-' + (seq++) + '.mjs');
  fs.writeFileSync(f, linkTs(tr(fs.readFileSync(path.join(root, rel), 'utf8')), out, ts));
  return import(pathToFileURL(f).href);
}
const src = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');

// ---------- push.ts, run as it is with the phone's parts replaced (notifications, storage, the server's answer) ----------
const STUBS = {
  'react-native': `export const Platform = { OS: 'ios' }; export const AppState = { get currentState() { return globalThis.__h.appState || 'active'; } };`,
  'expo-notifications': `const h = () => globalThis.__h;
    export const AndroidImportance = { HIGH: 4 };
    export function setNotificationHandler() {}
    export async function setNotificationChannelAsync() {}
    export async function getPermissionsAsync() { return { granted: true, canAskAgain: true }; }
    export async function requestPermissionsAsync() { return { granted: true }; }
    export async function getExpoPushTokenAsync() { return null; }
    export async function getPresentedNotificationsAsync() { return h().presented || []; }
    export async function scheduleNotificationAsync(r) { h().posted.push({ id: r.identifier, title: r.content.title }); return r.identifier; }
    export async function cancelScheduledNotificationAsync() {}`,
  'expo-device': `export const isDevice = true;`,
  'expo-constants': `export default { expoConfig: {} };`,
  '@react-native-async-storage/async-storage': `const s = () => globalThis.__h.store;
    export default { async getItem(k) { return k in s() ? s()[k] : null; }, async setItem(k, v) { s()[k] = String(v); }, async removeItem(k) { delete s()[k]; } };`,
  './api': `export const watchClock = { startedAt: 0 }; export const api = { async watches() { return globalThis.__h.answer; }, async registerExpo() {}, async unregisterExpo() {} };`,
  './gesture': `export function withTimeout(p) { return p; }`,
  './forgetTokens': `export async function allowPushTokens() {}`,
  './getOffNotify': `export const isServerGetOffWatch = () => false; export const tripPushQuiet = () => false;`,
};
const REAL = ['./pollCore', './liveCalc', './getOffCore', './noteShowCore'];
async function loadPush() {
  const dir = fs.mkdtempSync(path.join(out, 'push-'));
  const map = {};
  for (const [spec, code] of Object.entries(STUBS)) { const f = path.join(dir, 'stub-' + spec.replace(/[^a-z]/gi, '_') + '.mjs'); fs.writeFileSync(f, code); map[spec] = f; }
  for (const spec of REAL) {
    const rel = `src/lib/${spec.slice(2)}.ts`;
    if (!has(rel)) continue;
    const f = path.join(dir, spec.slice(2) + '.mjs');
    fs.writeFileSync(f, linkTs(tr(fs.readFileSync(path.join(root, rel), 'utf8')), dir, ts));
    map[spec] = f;
  }
  let js = tr(src('lib/push.ts'));
  js = js.replace(/from\s+'([^']+)'/g, (m, spec) => { if (!map[spec]) throw new Error('push.ts imports ' + spec + ' (no stub)'); return `from '${pathToFileURL(map[spec]).href}'`; });
  const f = path.join(dir, 'push.mjs');
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}

// Bidur's trip, as our tables hold it (watch EqhCys_trPw, notes 207 to 209).
const W = 'EqhCys_trPw';
const STARTED = 1793408188877; // 11:56:28 Start trip
const NOTES = [
  { id: 207, watch_id: W, at: 1793408277000, title: 'Leave now', body: 'Your T1 is 0 min away, on time. From Platform 7.', url: '/', pushed: 0 },
  { id: 208, watch_id: W, at: 1793408636000, title: 'Arriving at Ashfield Station in 2 min', body: 'Get ready to get off. Your T1 gets in at 12:06pm.', url: '/', pushed: 0 },
  { id: 209, watch_id: W, at: 1793408815000, title: "You've arrived at Ashfield", body: 'Your T1 got in at 12:06pm. The trip has ended.', url: '/', pushed: 0 },
];
const TRIP = { id: 'gbidur', title: 'Current location to Ashfield Station', legs: [{ mode: 'train', line: 'T1', tripId: '808G', stopId: '2135237', toStopId: '2131123', planned: '2026-10-31T00:58:30.000Z', arrPlanned: '2026-10-31T01:06:00.000Z' }],
  started: STARTED, alerted: {}, share: null, watchId: W, offServer: true };
const SERVER_GETOFF = { request: { identifier: 'srv-1', content: { data: { watch: W, getOff: 0 } } } };

async function openApp({ notes = NOTES, openAt, trip = TRIP, presented = [SERVER_GETOFF], token = false, lastNote = 206 } = {}) {
  const store = { lastNoteId: String(lastNote), shownNoteKeys: '[]' };
  if (token) store.expoPushToken = 'tok';
  if (trip) store.liveTrip = JSON.stringify(trip);
  globalThis.__h = { store, presented, posted: [], answer: { items: [], notes: notes.slice().reverse(), now: openAt } };
  const realNow = Date.now;
  Date.now = () => openAt;
  try {
    const P = await loadPush();
    await P.pollNotes();
  } finally { Date.now = realNow; }
  return globalThis.__h;
}
const T = (hhmmss) => Date.parse(`2026-10-31T${hhmmss}+11:00`);

test('(1)(2)(3)(4) Bidur 31 Oct: opening the app at 12:07:10 shows none of the three server notes push never carried', async () => {
  for (const token of [false, true]) {
    const h = await openApp({ openAt: T('12:07:10'), token });
    assert.deepEqual(h.posted.map((x) => x.title), [], `token ${token}: posted ${JSON.stringify(h.posted)}`);
    // Kept as seen: asking again later posts nothing either, and the next note id is remembered.
    assert.equal(h.store.lastNoteId, '209');
    assert.ok(JSON.parse(h.store.shownNoteKeys).length >= 2);
  }
});

test('(1) the same three found later still: nothing, whatever time the app opens after the arrival', async () => {
  for (const at of ['12:08:00', '12:15:00', '12:30:00']) {
    const h = await openApp({ openAt: T(at) });
    assert.deepEqual(h.posted, [], at);
  }
});

test('(2) Leave now is never shown during a trip, even fresh; and never once its departure passed', async () => {
  const fresh = { ...NOTES[0], at: T('11:57:57') };
  let h = await openApp({ notes: [fresh], openAt: T('11:58:05') });
  assert.deepEqual(h.posted, [], 'a trip is running on this phone');
  // No trip running (a watch from Remind me): shown while news, not after its departure.
  h = await openApp({ notes: [fresh], openAt: T('11:58:05'), trip: null, presented: [] });
  assert.deepEqual(h.posted.map((x) => x.title), ['Leave now']);
  const inTwo = { ...NOTES[0], at: T('11:56:00'), body: 'Your T1 is 2 min away, on time. From Platform 7.' };
  h = await openApp({ notes: [inTwo], openAt: T('11:58:20'), trip: null, presented: [] });
  assert.deepEqual(h.posted, [], 'its train has left');
});

test('(3) "Arriving at Ashfield in 2 min" is not shown once the server Get off now (or a location alert) is on the phone', async () => {
  const arr = { ...NOTES[1], at: T('12:03:56') };
  let h = await openApp({ notes: [arr], openAt: T('12:04:10') });
  assert.deepEqual(h.posted, [], 'server Get off now shown');
  h = await openApp({ notes: [arr], openAt: T('12:04:10'), presented: [{ request: { identifier: 'getoff-gbidur-rsoon0', content: { data: {} } } }] });
  assert.deepEqual(h.posted, [], 'heads up location alert rang');
  // Nothing on the phone yet: it is news, shown (the replacement for a push that never came).
  h = await openApp({ notes: [arr], openAt: T('12:04:10'), presented: [] });
  assert.deepEqual(h.posted.map((x) => x.title), ['Arriving at Ashfield Station in 2 min']);
  // Its arrival time passed: not shown.
  h = await openApp({ notes: [arr], openAt: T('12:06:27'), presented: [] });
  assert.deepEqual(h.posted, []);
});

test('(4) "You\'ve arrived" counts from the arrival it names: 30 s after, shown; 46 s after, only the quiet state', async () => {
  const done = { ...NOTES[2], at: T('12:06:20') };
  let h = await openApp({ notes: [done], openAt: T('12:06:30'), presented: [] });
  assert.deepEqual(h.posted.map((x) => x.title), ["You've arrived at Ashfield"]);
  h = await openApp({ notes: [done], openAt: T('12:06:46'), presented: [] });
  assert.deepEqual(h.posted, []);
});

test('alerts that are news still show: a fresh delay alert, an older server with no time on its notes', async () => {
  const late = { id: 300, watch_id: 'other', at: T('08:00:00'), title: 'Now 4 min late', body: 'Your T4 now leaves at 8:09am.', url: '/', pushed: 0 };
  let h = await openApp({ notes: [late], openAt: T('08:00:30'), trip: null, presented: [] });
  assert.deepEqual(h.posted.map((x) => x.title), ['Now 4 min late']);
  h = await openApp({ notes: [late], openAt: T('08:02:00'), trip: null, presented: [] });
  assert.deepEqual(h.posted, [], '2 min old');
  h = await openApp({ notes: [{ ...late, at: null }], openAt: T('08:02:00'), trip: null, presented: [] });
  assert.deepEqual(h.posted.map((x) => x.title), ['Now 4 min late'], 'no time: as before');
  // Pushed already (with a token): never posted again, as before.
  h = await openApp({ notes: [{ ...late, pushed: 1 }], openAt: T('08:00:30'), trip: null, presented: [], token: true });
  assert.deepEqual(h.posted, []);
});

// ---------- the rules, one by one ----------
const N = has('src/lib/noteShowCore.ts') ? await load('src/lib/noteShowCore.ts') : null;
test('noteShowCore: kinds, moments and verdicts', { skip: !N && 'noteShowCore.ts not on this commit' }, () => {
  assert.equal(N.noteKind('Leave now'), 'leave');
  assert.equal(N.noteKind('Arriving at Ashfield Station in 2 min'), 'stop');
  assert.equal(N.noteKind('Next stop: Central, change here'), 'stop');
  assert.equal(N.noteKind("You've arrived at Ashfield"), 'arrived');
  assert.equal(N.noteKind('Platform changed to 3'), 'other');
    assert.equal(N.noteMoment(NOTES[1]), NOTES[1].at + 150000);
  assert.equal(N.noteMoment(NOTES[0]), NOTES[0].at + 30000, '0 min away: half a minute of grace');
  assert.equal(N.arrivedAt(NOTES[2]), T('12:06:00'));
  const ctx = { now: T('12:07:10'), serverNow: T('12:07:10'), trip: { id: 'g', watchId: W, started: STARTED }, offShown: { gnow0: 1 } };
  assert.deepEqual(NOTES.map((n) => N.noteVerdict(n, ctx).why), ['onTrip', 'late', 'late']);
  // The server's clock is used for age when it answered (a phone clock 10 min fast changes nothing).
  const fresh = { id: 1, at: T('09:00:00'), title: 'Platform changed to 3', body: '' };
  assert.equal(N.noteVerdict(fresh, { now: T('09:10:00'), serverNow: T('09:00:20') }).show, true);
  assert.equal(N.noteVerdict(fresh, { now: T('09:00:20'), serverNow: null }).show, true);
  assert.equal(N.noteVerdict(fresh, { now: T('09:01:31'), serverNow: null }).show, false);
  // Anything else about the running trip after it arrived: no.
  assert.equal(N.noteVerdict({ id: 2, watch_id: W, at: T('12:06:30'), title: 'Connection at risk', body: '' }, { now: T('12:06:40'), trip: { id: 'g', watchId: W, started: STARTED, arrivedAt: T('12:06:20') } }).why, 'tripOver');
});

test('(2) Start trip takes back the Remind me leave alert, and Last way home when the trip goes there', { skip: !N && 'noteShowCore.ts not on this commit' }, () => {
  const trip = { to: { id: '213110' }, legs: [{ tripId: '808G', toStopId: '2131123' }] };
  assert.deepEqual(N.startCancels(trip, { leave: true }), ['leave']);
  assert.deepEqual(N.startCancels(trip, { leave: false, lastHome: { to: { id: '213110' }, svc: { tripId: 'x' } } }), ['lastHome']);
  assert.deepEqual(N.startCancels(trip, { leave: false, lastHome: { to: { id: '200060' }, svc: { tripId: '808G' } } }), ['lastHome'], 'same service');
  assert.deepEqual(N.startCancels(trip, { leave: false, lastHome: { to: { id: '200060' }, svc: { tripId: 'zzz' } } }), [], 'a trip somewhere else keeps it');
  assert.deepEqual(N.startCancels(trip, {}), []);
});

test('(2) startLive calls the take back as the trip starts', () => {
  const s = src('lib/live.ts');
  const i = s.indexOf('export async function startLive');
  const body = s.slice(i, s.indexOf('\n}\n', i));
  assert.match(body, /setLive\(g\);[\s\S]*takeBackLeave\(g\)/);
  assert.match(s, /cancelLeave\(\);\s*store\.setLeaveReminder\(null\)/);
});

// ---------- the app's own trip alerts on the first refresh after opening ----------
const live = await load('src/lib/liveCalc.ts');
const smart = await load('src/lib/smart.ts');
const format = await load('src/lib/format.ts');
const G = await load('src/lib/getOffCore.ts');
const fmt = { clock: format.clock, short: (n) => String(n || '').replace(/ Station$/, ''), plat: (p) => p || '' };
const T0 = Date.parse('2026-10-26T21:00:00Z');
const at = (m) => T0 + m * 60000;
const iso = (t) => new Date(t).toISOString();
const RUN = { stops: [['Chatswood', 0], ['Parramatta', 3], ['Croydon', 5], ['Ashfield', 7], ['Central', 10]], mine: 0, off: 4 };
const LEG = { mode: 'train', line: 'T1', tripId: 'T1.r', stopId: 'CHA', toStopId: 'CEN', from: 'Chatswood Station', to: 'Central Station', planned: iso(at(0)), arrPlanned: iso(at(10)), fromPlatform: 'Platform 4' };
function feed(t) {
  const stops = RUN.stops.map(([name, m], k) => ({ id: 'S' + k, name: name + ' Station', lat: -33.8, lon: 151 + k * 0.015, planned: iso(at(m)), estimated: iso(at(m)), mine: k === RUN.mine, alight: k === RUN.off }));
  let nextIndex = stops.findIndex((s) => Date.parse(s.estimated) > t - 20000);
  if (nextIndex < 0) nextIndex = stops.length;
  return { kind: 'service', live: true, line: 'T1', mode: 'train', tripId: 'T1.r', mineIndex: RUN.mine, alightIndex: RUN.off, nextIndex, stops };
}
const g0 = () => ({ id: 'g1', legs: [LEG], alerted: {}, watchId: null, share: null, speak: true, spoken: {}, offRegion: { rsoon0: 'x', rnow0: 'y' } });

test('(3) opened at the stop before yours after the heads up location alert rang: no second "Next stop", nothing said', () => {
  const t = at(7) + 65000; // left Ashfield (phase 2: its own live time 60 s past), Central next
  const r = live.stepLive(g0(), [feed(t)], t, fmt, null, { rsoon0: 1 });
  assert.deepEqual(r.actions.filter((a) => a.t === 'alert' || a.t === 'say'), []);
  // Nothing shown yet: the app says it (the moment is now).
  const r2 = live.stepLive(g0(), [feed(t)], t, fmt, null, {});
  assert.ok(r2.actions.some((a) => a.t === 'alert' && a.key === 'off0'));
  // The server's Get off now push for that stop: also none.
  const r3 = live.stepLive(g0(), [feed(t)], t, fmt, null, { gnow0: 1 });
  assert.deepEqual(r3.actions.filter((a) => a.t === 'alert' || a.t === 'say'), []);
});

test('(3) liveEngine reads what the phone shows before the refresh and hands it to stepLive', () => {
  const s = src('lib/liveEngine.ts');
  const a = s.indexOf('serverGetOffShown(g.watchId)'), b = s.indexOf('ownGetOffShown(g.id)'), c = s.indexOf('stepLive(g, svcCache, now, fmt, pos,');
  assert.ok(a > 0 && b > 0 && c > 0 && a < c && b < c, 'shown alerts read before stepLive');
});

test('(4) the app\'s own "You\'ve arrived": within 45 s a banner and the voice, later only the quiet state', () => {
  for (const [late, want] of [[30000, true], [46000, false], [5 * 60000, false]]) {
    const t = at(10) + late;
    const r = live.stepLive({ ...g0(), offRegion: {} }, [feed(t)], t, fmt, null, {});
    assert.equal(r.s.done, true);
    assert.equal(r.actions.some((a) => a.t === 'alert' && a.key === 'arrived'), want, `alert ${late}`);
    assert.equal(r.actions.some((a) => a.t === 'say' && a.key === 'arrived'), want, `say ${late}`);
    assert.equal(r.g.alerted.arrived, 1, 'kept as said either way');
  }
});

test('(1) Wake me before my stop is gone (phase 2, G9): never rings, before or after the stop', () => {
  const s = live.computeLive([LEG], [feed(at(9) + 50000)], at(9) + 50000, {}, null);
  for (const t of [at(9) + 50000, at(10) + 20000]) {
    const w = smart.wakeStep({ id: 'g1', legs: [LEG], wake: true, wakeSet: {}, alerted: {} }, { ...s, done: false, L2: s.L2.map((x) => ({ ...x, arr: at(10) })) }, t, fmt);
    assert.deepEqual(w.actions, []);
  }
});

test('(5) every alert a trip set ahead that belongs to no running trip is taken back (launch, trip end)', { skip: !G.staleTripIds && 'staleTripIds not on this commit' }, () => {
  const ids = ['getoff-gA-rnow0', 'getoff-gA-rsoon0', 'getoff-gA-quiet0', 'getoff-gA-gnow0', 'getoff-gA-next1', 'wake-gA-0', 'getoff-gB-rnow0', 'wake-gB-1', 'leave-reminder', 'last-home-local', 'trip-gA-arrived', 'reminder-x'];
  assert.deepEqual(G.staleTripIds(ids, 'gB'), ['getoff-gA-rnow0', 'getoff-gA-rsoon0', 'getoff-gA-quiet0', 'getoff-gA-gnow0', 'getoff-gA-next1', 'wake-gA-0']);
  assert.deepEqual(G.staleTripIds(ids, null), ['getoff-gA-rnow0', 'getoff-gA-rsoon0', 'getoff-gA-quiet0', 'getoff-gA-gnow0', 'getoff-gA-next1', 'wake-gA-0', 'getoff-gB-rnow0', 'wake-gB-1']);
  const n = src('lib/getOffNotify.ts');
  assert.match(n, /staleTripIds\(pending\.map/);
  assert.doesNotMatch(n.slice(n.indexOf('export async function sweepRegions'), n.indexOf('export async function cancelGetOff')), /hasRegionAlerts/, 'all platforms, every build');
});

test('(5) the engine reads the saved trip before its first sweep (a cold launch mid trip kept its own alerts)', () => {
  const s = src('lib/liveEngine.ts');
  const i = s.indexOf('export async function tickLive');
  const body = s.slice(i, s.indexOf('sweepRegions(', i));
  assert.match(body, /await loadLive\(\)/);
});
