// getoffregion31 (31 Oct, Bidur: "what if train or bus delays? ... that would freak user out"). Kylie's voice plays only
// when it is known to be real: the server's push from live times, or the phone's real position. The phone's own backup
// is a pair of location alerts per leg (UNLocationNotificationTrigger, set by the native module from build 211); without
// location it is one quiet note, no sound, never "get off", from live times at most 5 minutes old. Nothing is ever set
// on the phone to say "get off" from a clock. Stop names here are made up.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-getoffregion-'));
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
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const T0 = Date.parse('2026-10-26T21:00:00Z');
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();
const POS = (k, gap = 0.0155) => ({ lat: -33.8, lon: 151.0 + k * gap });
// Made-up line: get on at stop 1 (Northgate), off at stop 5 (Riverside).
const NAMES = ['Hilltop', 'Northgate', 'Elmwood', 'Parkside', 'Millbrook', 'Riverside', 'Southend'];
const MIN = [-2, 0, 3, 6, 9, 12, 15];
const MINE = 1, OFF = 5;
const ARR = at(MIN[OFF]);
function feed({ delay = 0, t = at(0), isLive = true, gap = 0.0155, mode = 'train', noPos = false } = {}) {
  const stops = NAMES.map((name, k) => ({ id: 'S' + k, name: name + ' Station', ...(noPos ? {} : POS(k, gap)), planned: iso(at(MIN[k])), estimated: iso(at(MIN[k]) + delay * 60000), mine: k === MINE, alight: k === OFF }));
  let nextIndex = stops.findIndex((s) => Date.parse(s.estimated) > t - 20000);
  if (nextIndex < 0) nextIndex = stops.length;
  return { kind: 'service', live: isLive, line: 'X1', mode, mineIndex: MINE, alightIndex: OFF, nextIndex, stops };
}
const LEG = { mode: 'train', line: 'X1', tripId: 'X1.r', stopId: 'S1', toStopId: 'S5', from: 'Northgate Station', to: 'Riverside Station', planned: iso(at(0)), arrPlanned: iso(ARR) };
const BUS = { ...LEG, mode: 'bus', line: '333' };
const state = (o = {}, leg = LEG) => live.computeLive([leg], [feed({ mode: leg.mode, ...o })], o.t ?? at(0), {});
const base = (o = {}) => ({ id: 'g1', legs: [LEG], alerted: {}, offSet: {}, offRegion: {}, voice: { now: true, all: true }, ...o });
const keys = (acts, t) => acts.filter((a) => a.t === t).map((a) => a.key).sort();
const GETOFF = /get off/i;

test('the circles: Get off now around your stop, the heads up around the stop before, sized for the mode', () => {
  const d = feed();
  const rs = G.legRegions(LEG, d, 0, 1);
  const now = rs.find((r) => r.kind === 'now');
  const soon = rs.find((r) => r.kind === 'soon');
  assert.equal(now.key, 'rnow0');
  assert.deepEqual([now.lat, now.lon], [POS(OFF).lat, Math.round(POS(OFF).lon * 1e5) / 1e5]);
  assert.equal(now.radius, 300, 'train: 300 m');
  assert.equal(soon.key, 'rsoon0');
  assert.equal(Math.round(soon.lon * 1e4), Math.round(POS(OFF - 1).lon * 1e4), 'the stop before');
  const bus = G.legRegions(BUS, feed({ mode: 'bus' }), 0, 1);
  assert.equal(bus.find((r) => r.kind === 'now').radius, 150, 'bus: 150 m');
  assert.equal(bus.find((r) => r.kind === 'soon').radius, 200);
  for (const r of [...rs, ...bus]) assert.ok(r.radius >= 150 && r.radius <= 300, 'inside 150 to 300 m');
  assert.equal(G.modeClass('Light Rail'), 'tram');
  assert.equal(G.modeClass('metro'), 'rail');
  assert.equal(G.modeClass('ferry'), 'ferry');
  assert.equal(G.modeClass('coach'), 'bus');
});

test('N stops early: the heads up circle is around the stop that many before yours', () => {
  const rs = G.legRegions(LEG, feed(), 0, 3);
  const soon = rs.find((r) => r.kind === 'soon');
  assert.equal(Math.round(soon.lon * 1e4), Math.round(POS(OFF - 3).lon * 1e4));
  assert.equal(G.legRegions(LEG, feed(), 0, 4).filter((r) => r.kind === 'soon').length, 0, 'that stop would be where you get on');
});

test('a stop before far away: the heads up goes 900 m (train) or 600 m (bus) before your stop, on the line between', () => {
  const far = feed({ gap: 0.05 }); // about 4.6 km apart
  const soon = G.legRegions(LEG, far, 0, 1).find((r) => r.kind === 'soon');
  const off = far.stops[OFF];
  assert.ok(Math.abs(G.metres(soon, off) - 900) < 5, String(G.metres(soon, off)));
  const bsoon = G.legRegions(BUS, feed({ gap: 0.05, mode: 'bus' }), 0, 1).find((r) => r.kind === 'soon');
  assert.ok(Math.abs(G.metres(bsoon, off) - 600) < 5);
});

test('circles that would overlap, or hold the stop you get on at, are left out; no coordinates, no circles', () => {
  const close = feed({ gap: 0.004 }); // about 370 m apart: the two circles would overlap
  const rs = G.legRegions(LEG, close, 0, 1);
  assert.equal(rs.filter((r) => r.kind === 'soon').length, 0);
  // Get on one stop before: the heads up circle would be where you stand.
  const d = { ...feed(), mineIndex: OFF - 1 };
  assert.equal(G.legRegions(LEG, d, 0, 1).filter((r) => r.kind === 'soon').length, 0);
  assert.deepEqual(G.legRegions(LEG, feed({ noPos: true }), 0, 1), []);
});

test('iOS limit: a trip never asks for more than MAX_REGIONS circles (iOS monitors at most 20 per app)', () => {
  const legs = Array.from({ length: 6 }, (_, k) => ({ ...LEG, tripId: 'r' + k }));
  const s = live.computeLive(legs, legs.map(() => feed()), at(0), {});
  const rs = G.tripRegions(legs, s, 1, { now: true, soon: true });
  assert.ok(rs.length <= G.MAX_REGIONS && G.MAX_REGIONS <= 20, String(rs.length));
});

test('with location: both circles set once, Time Sensitive voice only by position; nothing set for a time', () => {
  const s = state();
  const a = G.getOffStep(base({ backup: 'region' }), G.GETOFF_DEFAULT, s, at(0), fmt);
  assert.deepEqual(keys(a.actions, 'regionSchedule'), ['rnow0', 'rsoon0']);
  const now = a.actions.find((x) => x.key === 'rnow0');
  assert.equal(now.sound, 'getoff_now');
  assert.equal(now.id, 'getoff-g1-rnow0');
  assert.equal(now.title, 'Get off now: Riverside');
  assert.doesNotMatch(now.body, /\d:\d\d/, 'no clock time in a position alert');
  assert.equal(a.actions.find((x) => x.key === 'rsoon0').sound, 'getoff_soon');
  assert.equal(keys(a.actions, 'offSchedule').length, 0);
  // Next refresh, 4 min late: the places do not move, nothing is set again.
  const b = G.getOffStep({ ...base({ backup: 'region' }), ...a.g }, G.GETOFF_DEFAULT, state({ delay: 4, t: at(1) }), at(1), fmt);
  assert.equal(b.actions.length, 0, JSON.stringify(b.actions));
});

test('the voice choice decides each circle\'s sound; a change sets it again in the same place', () => {
  const a = G.getOffStep(base({ backup: 'region', voice: { now: false, all: false } }), G.GETOFF_DEFAULT, state(), at(0), fmt);
  assert.ok(a.actions.filter((x) => x.t === 'regionSchedule').every((x) => !x.sound));
  const b = G.getOffStep({ ...base({ backup: 'region' }), ...a.g, voice: { now: true, all: false } }, G.GETOFF_DEFAULT, state({ t: at(1) }), at(1), fmt);
  assert.deepEqual(keys(b.actions, 'regionSchedule'), ['rnow0']);
  assert.equal(b.actions[0].sound, 'getoff_now');
});

test('no location: one quiet note at the live arrival less 2 min, no sound, never "get off"; moved on a live update', () => {
  // Read 6 min in: the note (10 min) rings within 5 min of that read (quietnote31: never set further ahead).
  const g = base({ backup: 'quiet', liveAt: at(6) });
  const a = G.getOffStep(g, G.GETOFF_DEFAULT, state({ t: at(6) }), at(6), fmt);
  const q = a.actions.filter((x) => x.t === 'offSchedule');
  assert.equal(q.length, 1);
  assert.equal(q[0].key, 'quiet0');
  assert.equal(q[0].quiet, true);
  assert.equal(q[0].sound, undefined);
  assert.equal(q[0].at, ARR - 120000);
  assert.equal(q[0].title, 'Your stop is coming up soon');
  assert.doesNotMatch(q[0].title + q[0].body, GETOFF);
  assert.equal(keys(a.actions, 'regionSchedule').length, 0);
  const b = G.getOffStep({ ...g, ...a.g, liveAt: at(7) }, G.GETOFF_DEFAULT, state({ delay: 1, t: at(7) }), at(7), fmt);
  const m = b.actions.find((x) => x.t === 'offSchedule');
  assert.equal(m.at, ARR + 1 * 60000 - 120000, 'follows the live arrival');
  assert.equal(m.id, 'getoff-g1-quiet0', 'same id replaces it');
});

test('no location: never set from live times older than 5 min, taken back when they go stale, none without live times', () => {
  const stale = G.getOffStep(base({ backup: 'quiet', liveAt: at(0) - 6 * 60000 }), G.GETOFF_DEFAULT, state(), at(0), fmt);
  assert.equal(stale.actions.length, 0);
  const a = G.getOffStep(base({ backup: 'quiet', liveAt: at(6) }), G.GETOFF_DEFAULT, state({ t: at(6) }), at(6), fmt);
  assert.deepEqual(keys(a.actions, 'offSchedule'), ['quiet0']);
  // The reads stop (6 min ago by 9 min in): taken back, though its time (10 min) has not come.
  const b = G.getOffStep({ ...base({ backup: 'quiet' }), ...a.g, liveAt: at(3) }, G.GETOFF_DEFAULT, state({ t: at(9) }), at(9), fmt);
  assert.ok(b.actions.some((x) => x.t === 'offCancel' && x.key === 'quiet0'), JSON.stringify(b.actions));
  const tt = G.getOffStep(base({ backup: 'quiet', liveAt: at(0) }), G.GETOFF_DEFAULT, state({ isLive: false }), at(0), fmt);
  assert.equal(tt.actions.length, 0, 'a timetable guess sets nothing');
  const never = G.getOffStep(base({ backup: 'quiet' }), G.GETOFF_DEFAULT, state(), at(0), fmt);
  assert.equal(never.actions.length, 0, 'no live read yet');
});

test('the server sends Get off now: no Get off now circle and no quiet note from the phone; one taken back on the yes', () => {
  const s = state();
  const r = G.getOffStep(base({ backup: 'region', server: true }), G.GETOFF_DEFAULT, s, at(0), fmt);
  assert.deepEqual(keys(r.actions, 'regionSchedule'), ['rsoon0']);
  const a = G.getOffStep(base({ backup: 'region' }), G.GETOFF_DEFAULT, s, at(0), fmt);
  const b = G.getOffStep({ ...base({ backup: 'region' }), ...a.g, server: true }, G.GETOFF_DEFAULT, state({ t: at(1) }), at(1), fmt);
  assert.deepEqual(keys(b.actions, 'regionCancel'), ['rnow0']);
  const q = G.getOffStep(base({ backup: 'quiet', liveAt: at(6), server: true }), G.GETOFF_DEFAULT, state({ t: at(6) }), at(6), fmt);
  assert.equal(q.actions.length, 0);
});

test('first one wins: a circle that rang marks its moment done, so the app neither rings nor reads it out again', () => {
  const a = G.getOffStep(base({ backup: 'region', speak: true, sayNow: true }), G.GETOFF_DEFAULT, state(), at(0), fmt);
  // Opened 10 s before the arrival, after the Get off now circle rang with its voice.
  const t = ARR - 10000;
  const b = G.getOffStep({ ...base({ backup: 'region', speak: true, sayNow: true }), ...a.g, rung: { rnow0: 1, rsoon0: 1 } }, G.GETOFF_DEFAULT, state({ t }), t, fmt);
  assert.equal(b.actions.filter((x) => x.t === 'offDue' || x.t === 'say').length, 0, JSON.stringify(b.actions));
  assert.equal(b.g.alerted.gnow0, 1);
  assert.equal(b.g.alerted.next0, 1, 'the trip\'s own Next stop knows it rang');
  assert.equal(b.g.spoken.gnow0, 1, 'said by the phone already');
  assert.deepEqual(b.g.offRegion, {});
});

test('first one wins: the server push shown first takes the circle back; the app\'s own moment does the same', () => {
  const a = G.getOffStep(base({ backup: 'region' }), G.GETOFF_DEFAULT, state(), at(0), fmt);
  const t = ARR - 60000;
  const b = G.getOffStep({ ...base({ backup: 'region' }), ...a.g, server: true, serverRung: { gnow0: 1 }, serverVoice: true }, G.GETOFF_DEFAULT, state({ t }), t, fmt);
  assert.ok(b.actions.some((x) => x.t === 'regionCancel' && x.key === 'rnow0'), 'no second voice from the circle');
  assert.equal(b.g.alerted.gnow0, 1);
  assert.equal(b.actions.filter((x) => x.t === 'offDue' || x.t === 'say').length, 0);
  const t2 = ARR - 20000;
  const c = G.getOffStep({ ...base({ backup: 'region' }), ...a.g }, G.GETOFF_DEFAULT, state({ t: t2 }), t2, fmt);
  assert.ok(c.actions.some((x) => x.t === 'offDue' && x.key === 'gnow0'), 'the app open with live times rings it');
  assert.ok(c.actions.some((x) => x.t === 'regionCancel' && x.key === 'rnow0'));
});

test('no voice from a clock, ever: across modes, delays, live or not, app open or closed, every timed alert is quiet', () => {
  for (const backup of ['region', 'quiet', undefined]) for (const isLive of [true, false]) for (const delay of [0, 4, -1]) for (const pref of [G.GETOFF_DEFAULT, { stops: 3, now: true }, { stops: 2, now: false }]) {
    let g = base({ backup, liveAt: at(0), speak: true, sayNow: true });
    for (let t = at(-2); t <= ARR + 120000; t += 15000) {
      const o = G.getOffStep({ ...g, liveAt: t }, pref, state({ delay, t, isLive }), t, fmt);
      g = { ...g, ...o.g };
      for (const x of o.actions) {
        if (x.t === 'offSchedule') {
          assert.equal(x.quiet, true, JSON.stringify(x));
          assert.equal(x.sound, undefined);
          assert.doesNotMatch(x.title + ' ' + x.body, GETOFF);
          assert.ok(x.at >= ARR + delay * 60000 - 120000 - 1, 'never before the live arrival less 2 min');
        }
        if (!isLive) assert.notEqual(x.t, 'offDue', 'no ring from the timetable');
        if (!isLive && x.t === 'say') assert.doesNotMatch(x.text, GETOFF);
      }
    }
  }
});

test('alerts an earlier version set for a time are taken back (still to come) or kept as rung (time passed)', () => {
  const g = base({ backup: 'region', offSet: { gnow0: ARR - 30000, next0: at(0) - 1000 }, offVoice: { next0: 1 } });
  const o = G.getOffStep(g, G.GETOFF_DEFAULT, state(), at(0), fmt);
  assert.ok(o.actions.some((x) => x.t === 'offCancel' && x.key === 'gnow0'));
  assert.equal(o.g.alerted.next0, 1);
  assert.equal(o.g.spoken.next0, 1);
  assert.deepEqual(Object.keys(o.g.offSet), []);
});

test('the trip ends or a leg is past: every circle is taken back', () => {
  const a = G.getOffStep(base({ backup: 'region' }), G.GETOFF_DEFAULT, state(), at(0), fmt);
  const done = state({ t: ARR + 60000 });
  const b = G.getOffStep({ ...base({ backup: 'region' }), ...a.g }, G.GETOFF_DEFAULT, done, ARR + 60000, fmt);
  assert.deepEqual(keys(b.actions, 'regionCancel'), ['rnow0', 'rsoon0']);
});

test('ids, leftovers and the backup choice', () => {
  assert.deepEqual(G.parseGetOffId('getoff-abc-123-rnow0'), { gid: 'abc-123', key: 'rnow0' });
  assert.equal(G.parseGetOffId('trip-g1-off0'), null);
  assert.deepEqual(G.ownRungKeys('g1', ['getoff-g1-rnow0', 'getoff-g2-rnow0', 'getoff-g1-quiet1', 'x']), { rnow0: 1, quiet1: 1 });
  assert.deepEqual(G.staleRegionIds(['getoff-g1-rnow0', 'getoff-g2-rsoon1', 'getoff-g2-quiet0', 'leave-reminder'], 'g1'), ['getoff-g2-rsoon1']);
  assert.deepEqual(G.staleRegionIds(['getoff-g1-rnow0'], null), ['getoff-g1-rnow0'], 'no trip running: all taken back');
  assert.equal(G.backupOf(true, 'ok'), 'region');
  for (const st of ['denied', 'notDetermined', 'reduced', 'unavailable', null]) assert.equal(G.backupOf(true, st), 'quiet', String(st));
  assert.equal(G.backupOf(false, 'ok'), 'quiet', 'a build without the native part');
  assert.deepEqual(G.quietWords('Riverside'), { title: 'Your stop is coming up soon', body: 'Check the app for Riverside.' });
});

test('native part: a location trigger on entry only, once, time sensitive, When In Use, stated in the permission text', () => {
  const sw = read('modules/transport-ios/ios/TransportIOSModule.swift');
  assert.match(sw, /UNLocationNotificationTrigger\(region: region, repeats: false\)/);
  assert.match(sw, /region\.notifyOnEntry = true/);
  assert.match(sw, /region\.notifyOnExit = false/);
  assert.match(sw, /content\.interruptionLevel = \.timeSensitive/);
  assert.match(sw, /accuracyAuthorization != \.fullAccuracy/);
  assert.match(sw, /\.authorizedAlways, \.authorizedWhenInUse/);
  assert.match(read('modules/transport-ios/ios/TransportIOS.podspec'), /'CoreLocation', 'UserNotifications'/);
  const ix = read('modules/transport-ios/index.ts');
  assert.match(ix, /hasRegionAlerts: \(\): boolean => typeof native\?\.scheduleRegionAlert === 'function'/);
  const cfg = JSON.parse(read('app.json'));
  const loc = cfg.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-location')[1];
  assert.match(loc.locationWhenInUsePermission, /alert you as you near your stop/);
  assert.equal(loc.locationAlwaysAndWhenInUsePermission, false, 'When In Use only, no Always');
  assert.ok(!cfg.expo.ios.infoPlist.UIBackgroundModes, 'no background modes');
});

test('wiring: the engine sets and takes back circles, sweeps leftovers, reads what rang; the trip end takes them back', () => {
  const e = read('src/lib/liveEngine.ts');
  assert.match(e, /a\.t === 'regionSchedule'\) await scheduleRegion\(/);
  assert.match(e, /a\.t === 'regionCancel'\) await cancelGetOff\(a\.id\)/);
  assert.match(e, /a\.quiet\) await scheduleQuiet\(/);
  assert.match(e, /sweepRegions\(sweptFor\)/);
  assert.match(e, /backup, offRegion: g\.offRegion, rung, liveAt: liveOkAt \|\| null/);
  const l = read('src/lib/live.ts');
  assert.match(l, /for \(const k of Object\.keys\(g\.offRegion \|\| \{\}\)\) cancelGetOff/);
  const n = read('src/lib/getOffNotify.ts');
  assert.match(n, /sound: false, interruptionLevel: 'active'/);
  assert.match(read('src/components/Smart.tsx'), /Object\.keys\(cur\.offRegion \|\| \{\}\)/);
});

test('Silent switch (Bidur, 31 Oct: banner on Silent, voice on open): spoken trip alerts use an ambient session the switch mutes', () => {
  const sw = read('modules/transport-ios/ios/TransportIOSModule.swift');
  assert.match(sw, /Function\("startAlertAudio"\)[\s\S]*?setCategory\(\.ambient, mode: \.default, options: \[\]\)/, 'ambient, not playback');
  assert.doesNotMatch(sw, /setCategory\(\.playback/);
  assert.match(sw, /Function\("endAlertAudio"\)[\s\S]*?notifyOthersOnDeactivation/);
  const ne = read('src/lib/nativeExtras.ts');
  assert.match(ne, /typeof m\.startAlertAudio === 'function'/);
  assert.match(ne, /const amb = opts\.alert \? alertAudio\(\) : null;/);
  assert.match(ne, /S\.speak\(text, speechOptions\(ok, fin, voice\)\)/, 'the app session (useApplicationAudioSession) when it started');
  const e = read('src/lib/liveEngine.ts');
  assert.match(e, /a\.t === 'say'\) speak\(a\.text, \{ alert: true, \.\.\.\(a\.quiet \? \{ quiet: true \} : \{\}\) \}\)/, 'get off lines');
  assert.match(e, /if \(a\.t === 'say'\) speak\(a\.text, \{ alert: true \}\);/, 'trip guidance lines');
});

test('Silent still buzzes: every get off alert has a sound (spoken or the normal one); no Critical Alerts entitlement', () => {
  const sw = read('modules/transport-ios/ios/TransportIOSModule.swift');
  assert.match(sw, /content\.sound = UNNotificationSound\(named: UNNotificationSoundName\(rawValue: sound\)\)\n\s*\} else \{\n\s*content\.sound = \.default/);
  const n = read('src/lib/getOffNotify.ts');
  assert.match(n, /sound: voice && sound \? `\$\{sound\}\.wav` : true, interruptionLevel: 'timeSensitive'/);
  assert.match(n, /name: 'Stop coming up, quiet', importance: Notifications\.AndroidImportance\.LOW, sound: null, enableVibrate: false/, 'only the quiet note is silent');
  const cfg = read('app.json') + read('app.config.js');
  assert.doesNotMatch(cfg, /critical-alerts|criticalAlert/i, 'Apple does not grant Critical Alerts for transit');
  assert.equal(JSON.parse(read('app.json')).expo.ios.entitlements['com.apple.developer.usernotifications.time-sensitive'], true);
});
