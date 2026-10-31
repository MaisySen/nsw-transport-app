// getoffbg31 (31 Oct, Bidur on build 210: "Sound still plays only when i open app. Even if i arrived few minutes ago.
// If i open app now. It will speak now."). The app cannot run or speak in the background, so: the alerts are set on
// the phone ahead (Next stop next<leg> when no server watch sends it, Get off now gnow<leg>) with the spoken sounds and
// time sensitive, moved on every live refresh while the app runs; one moment is one alert (server push or phone,
// never both); and nothing is read out or rung late when the app is opened after the moment.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-getoffbg-'));
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


/**
 * One trip, refreshed every 15 s while the app is open (`open(t)`), the way liveEngine runs it: stepLive, then
 * getOffStep with the spoken sounds (`voice`), the server watch (`watchId`: its Next stop push) and server Get off now
 * (`server`). Alarms set on the phone ring at their time whether the app is open or not. `delayAt(t)` is the live delay.
 */
function replay({ pref = G.GETOFF_DEFAULT, delayAt = () => 0, open = () => true, speak = true, voice = { now: true, all: true }, watchId = null, server = false, serverPushAt = null, t1 = at(40) } = {}) {
  let g = { id: 'g1', legs: [LEG], alerted: {}, watchId, share: null, speak, spoken: {}, offSet: {}, offVoice: {} };
  const alarms = new Map();
  const log = { rang: [], said: [], alerts: [], schedules: [], cancels: [] };
  const presented = new Set();
  let ended = false;
  let pushed = false;
  for (let t = at(-3); t <= t1 && !ended; t += 15000) {
    for (const [id, a] of [...alarms]) if (a.at <= t) { log.rang.push({ id, t: a.at, by: 'phone', sound: a.sound, title: a.title }); presented.add(id); alarms.delete(id); }
    if (server && serverPushAt != null && !pushed && t >= serverPushAt) { pushed = true; log.rang.push({ id: 'server:gnow0', t, by: 'server' }); }
    if (!open(t)) continue;
    const r = live.stepLive(g, [feed(RUN, delayAt(t), t)], t, fmt);
    const serverRung = server && pushed ? { gnow0: 1 } : {};
    const o = G.getOffStep({ id: g.id, legs: g.legs, alerted: r.g.alerted, offSet: g.offSet, speak, sayNow: true, spoken: r.g.spoken, voice, offVoice: g.offVoice,
      serverNext: !!g.watchId, wake: false, ...(server ? { server: true, serverRung, serverVoice: true } : {}) }, pref, r.s, t, fmt);
    g = { ...r.g, alerted: o.g.alerted, spoken: o.g.spoken, offSet: o.g.offSet, offVoice: o.g.offVoice };
    for (const a of o.actions) {
      if (a.t === 'offSchedule') { alarms.set(a.id, { at: a.at, sound: a.sound, title: a.title }); log.schedules.push({ ...a, t }); }
      else if (a.t === 'offCancel') { alarms.delete(a.id); log.cancels.push({ ...a, t }); }
      else if (a.t === 'offDue') { if (!presented.has(a.id)) { alarms.delete(a.id); log.rang.push({ id: a.id, t, by: 'app', title: a.title, sound: a.sound }); presented.add(a.id); } }
      else if (a.t === 'say') log.said.push({ ...a, t });
    }
    for (const a of r.actions) {
      if (a.t === 'alert') log.alerts.push({ ...a, t });
      if (a.t === 'say') log.said.push({ ...a, t });
      if (a.t === 'end') ended = true;
    }
  }
  const of = (re) => log.rang.filter((x) => re.test(x.id));
  return { ...log, g, alarms, next: of(/-next\d+$/), now: of(/-gnow\d+$/), server: of(/^server:/) };
}
const ARR = at(16);

test('locked after Start trip, no server watch: Next stop and Get off now ring from the phone, ahead, with the spoken sounds', () => {
  // Bidur's trip: the app opened at the start, then the phone locked until after the arrival.
  const r = replay({ open: (t) => t < at(1) });
  assert.equal(r.next.length, 1, JSON.stringify(r.rang));
  assert.equal(r.next[0].by, 'phone');
  assert.equal(r.next[0].sound, 'getoff_soon');
  assert.match(r.next[0].title, /^Next stop: Central/);
  assert.ok(r.next[0].t >= leaves(5) && r.next[0].t <= ARR - 60000, 'after it is due to leave Epping, a minute or more before the arrival');
  assert.equal(r.now.length, 1);
  assert.equal(r.now[0].by, 'phone');
  assert.equal(r.now[0].sound, 'getoff_now');
  assert.equal(r.now[0].t, ARR - G.GETOFF_NOW_LEAD_MS);
  assert.ok(r.next[0].t < r.now[0].t);
});

test('a delay seen while the app is open moves both alerts set on the phone (rescheduled, same identifier)', () => {
  const r = replay({ delayAt: (t) => (t >= at(5) ? 4 : 0), open: (t) => t < at(8) });
  assert.equal(r.now.length, 1);
  assert.equal(r.now[0].t, ARR + 4 * 60000 - G.GETOFF_NOW_LEAD_MS, 'at the late arrival');
  assert.equal(r.next.length, 1);
  assert.ok(r.next[0].t >= leaves(5, 4), 'not at the old time');
  const ids = new Set(r.schedules.map((s) => s.id));
  assert.ok(r.schedules.length > ids.size, 'set again under the same id when the time moved');
  assert.equal(r.alarms.size, 0);
});

test('app open the whole ride: the phone\'s own Next stop is taken back and the app says it once; nothing twice', () => {
  const r = replay({});
  assert.equal(r.next.length, 0, 'taken back at the stop before');
  assert.ok(r.cancels.some((c) => /-next0$/.test(c.id)));
  assert.equal(r.alerts.filter((a) => a.key === 'off0').length, 1, 'the app\'s Next stop alert, once');
  assert.equal(r.said.filter((s) => s.key === 'off0').length, 1);
  assert.equal(r.now.length, 1);
  assert.equal(r.said.filter((s) => s.key === 'arrived').length, 1, 'said at the arrival, while it is news');
});

test('a server watch sends Next stop: the phone sets none of its own (one moment, one alert)', () => {
  const r = replay({ watchId: 'w1', open: (t) => t < at(1) });
  assert.equal(r.schedules.filter((s) => /-next\d+$/.test(s.id)).length, 0);
  assert.equal(r.next.length, 0);
  assert.equal(r.now.length, 1, 'Get off now still set on the phone while the server does not send it');
});

test('a server watch that arrives after the phone set its Next stop takes it back', () => {
  const g0 = { id: 'g1', legs: [LEG], alerted: {}, offSet: {}, voice: { now: true, all: true } };
  const s0 = live.computeLive([LEG], [feed(RUN, 0, at(2))], at(2), {});
  const a = G.getOffStep(g0, G.GETOFF_DEFAULT, s0, at(2), fmt);
  assert.ok(a.actions.some((x) => x.t === 'offSchedule' && x.key === 'next0'));
  const b = G.getOffStep({ ...g0, ...a.g, serverNext: true }, G.GETOFF_DEFAULT, s0, at(2) + 15000, fmt);
  assert.ok(b.actions.some((x) => x.t === 'offCancel' && x.key === 'next0'));
  assert.equal(b.g.offSet.next0, undefined);
});

test('server Get off now: nothing set on the phone; its push, once shown, is done and never rung or said again', () => {
  const r = replay({ watchId: 'w1', server: true, serverPushAt: ARR - 60000, open: (t) => t < at(1) || t >= ARR - 30000 });
  assert.equal(r.schedules.filter((s) => /-gnow\d+$/.test(s.id)).length, 0);
  assert.equal(r.now.length, 0, 'no phone or app Get off now beside the server push');
  assert.equal(r.server.length, 1);
  assert.equal(r.said.filter((s) => s.key === 'gnow0').length, 0, 'the push spoke already');
  assert.equal(r.g.alerted.gnow0, 1);
});

test('no stale speech on resume: opened 3 min after the arrival, nothing is read out or rung, and the trip shows arrived', () => {
  const r = replay({ open: (t) => t < at(1) || t >= ARR + 3 * 60000 });
  const late = (x) => x.t >= ARR + 3 * 60000;
  assert.deepEqual(r.said.filter(late), [], 'nothing said late: ' + JSON.stringify(r.said.filter(late)));
  assert.deepEqual(r.alerts.filter(late), [], 'no late banner');
  assert.deepEqual(r.rang.filter((x) => late(x) && x.by === 'app'), []);
  assert.equal(r.g.spoken.arrived, 1, 'kept as said, quietly');
  assert.ok(r.g.arrivedAt >= ARR + 3 * 60000, 'the quiet You\'ve arrived state');
  assert.equal(r.alarms.size, 0, 'nothing left set on the phone');
});

test('no stale speech on resume, mid ride: what the phone already rang with its voice is not read out again', () => {
  // Opened 20 s after the phone's own Next stop rang (with its spoken sound): the app does not say "Your stop is next".
  const lock = replay({ open: (t) => t < at(1) });
  const rangAt = lock.next[0].t;
  const r = replay({ open: (t) => t < at(1) || t >= rangAt + 15000 });
  assert.equal(r.said.filter((s) => s.key === 'off0').length, 0, JSON.stringify(r.said));
  assert.equal(r.alerts.filter((a) => a.key === 'off0').length, 0, 'no second Next stop banner');
  assert.equal(r.now.length, 1, 'Get off now still comes once');
});

test('cueStale: arrived only within 45 s of the arrival; Next stop never once that arrival has passed by the clock', () => {
  const done = { done: true, L2: [], eta: ARR };
  assert.equal(live.cueStale('arrived', done, ARR + 30000), false);
  assert.equal(live.cueStale('arrived', done, ARR + 46000), true);
  assert.equal(live.cueStale('arrived', { done: true, L2: [], eta: NaN }, ARR), true);
  const riding = { done: false, cur: 0, L2: [{ arr: ARR }] };
  assert.equal(live.cueStale('off0', riding, ARR - 60000), false);
  assert.equal(live.cueStale('off0', riding, ARR + 1000), true);
  assert.equal(live.cueStale('late0:5', riding, ARR + 1000), false, 'state cues are about now');
});

test('getOffTrigger: a time interval on iPhone (seconds from now, at least 1), the date on Android, now when no time', () => {
  assert.deepEqual(G.getOffTrigger('ios', at(10), at(0), 'getoff_now'), { type: 'timeInterval', seconds: 600, repeats: false });
  assert.deepEqual(G.getOffTrigger('ios', at(0) + 200, at(0), 'getoff_now'), { type: 'timeInterval', seconds: 1, repeats: false });
  assert.deepEqual(G.getOffTrigger('android', at(10), at(0), 'getoff_now'), { type: 'date', date: at(10), channelId: 'getoff_now' });
  assert.equal(G.getOffTrigger('ios', null, at(0), 'default'), null);
  assert.deepEqual(G.getOffTrigger('android', null, at(0), 'default'), { channelId: 'default' });
});

test('tripPushSoundless: the running trip\'s spoken push in front, while the app reads it out, is shown without sound', () => {
  const base = { watch: 'w1', sound: 'custom', appState: 'active', tripWatch: 'w1', speaks: true };
  assert.equal(G.tripPushSoundless(base), true);
  assert.equal(G.tripPushSoundless({ ...base, sound: 'getoff_soon.wav' }), true);
  assert.equal(G.tripPushSoundless({ ...base, appState: 'background' }), false, 'locked: it rings');
  assert.equal(G.tripPushSoundless({ ...base, speaks: false }), false, 'the app says nothing: the push sound is the alert');
  assert.equal(G.tripPushSoundless({ ...base, sound: 'default' }), false);
  assert.equal(G.tripPushSoundless({ ...base, watch: 'w2' }), false);
});

test('the wiring: time sensitive with the spoken sound, the iPhone trigger, server watch and Next stop to getOffStep, quiet push in front', () => {
  const n = src('lib/getOffNotify.ts');
  assert.match(n, /interruptionLevel: 'timeSensitive'/);
  assert.match(n, /sound: voice && sound \? `\$\{sound\}\.wav`/);
  assert.match(n, /trigger: getOffTrigger\(Platform\.OS, at, Date\.now\(\), channelId\)/);
  assert.match(n, /identifier: id/, 'one stable id per trip and alert, so setting it again replaces it');
  const e = src('lib/liveEngine.ts');
  assert.match(e, /serverNext: !!g\.watchId, wake: !!g\.wake/);
  assert.match(e, /setTripWatch\(/);
  assert.match(src('lib/push.ts'), /tripPushQuiet\(d\.watch, \(n\.request\.content as any\)\.sound/);
  assert.match(src('lib/live.ts'), /setTripWatch\(null, false\)/);
  // The push token the server's alerts need is registered when a trip starts (enablePush, registerExpo).
  assert.match(src('lib/live.ts'), /if \(ps\.status === 'off'\) await enablePush\(false\)/);
  assert.match(src('lib/push.ts'), /await api\.registerExpo\(data, Platform\.OS, welcome\)/);
  for (const f of ['getoff_now.wav', 'getoff_soon.wav']) assert.ok(fs.existsSync(path.join(root, 'assets', 'sounds', f)), f);
});
