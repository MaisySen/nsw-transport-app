// Trip alerts spoken in headphones with the iPhone locked or on Silent (2 Nov, Bidur 3:12 PM: "Silent mode. Airpod or
// headphone on. App talks only when app opened", 3:18 PM: "Find a way to do this from in app"). The rules
// (lockedVoiceCore.ts), the silent push clips (QuietClips.swift, compiled with swiftc where present), the native
// background session (TripAwake.swift, read), Info.plist and the engine wiring. docs/VOICE_LOCKED.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linkTs } from './tsLink.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '..');
const require = createRequire(import.meta.url);
const ts = require(path.join(app, 'node_modules', 'typescript'));
const read = (rel) => fs.readFileSync(path.join(app, rel), 'utf8');
function which(cmd) { try { return execFileSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim() || null; } catch { return null; } }
const swiftc = process.env.WIDGET_NATIVE_CHECK === '0' ? null : which('swiftc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-voicelocked-'));
async function load(rel) {
  const js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(tmp, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, linkTs(js, tmp, ts));
  return import(pathToFileURL(f).href);
}
const exists = (rel) => fs.existsSync(path.join(app, rel));
const L = exists('src/lib/lockedVoiceCore.ts') ? await load('src/lib/lockedVoiceCore.ts') : null;
const need = () => assert.ok(L, 'src/lib/lockedVoiceCore.ts is missing');

const T0 = Date.UTC(2026, 10, 2, 4, 50);
const base = { os: 'ios', supported: true, setting: true, speaks: true, status: 'ok', tripActive: true, arrivedAt: null, appActive: false, route: 'headphones', headphonesAt: T0, now: T0 };

test('the switch: Speak alerts in headphones is on unless switched off', () => {
  need();
  assert.equal(L.readLockedVoice(undefined), true);
  assert.equal(L.readLockedVoice(null), true);
  assert.equal(L.readLockedVoice(true), true);
  assert.equal(L.readLockedVoice(false), false);
});

test('awake only for a running trip that speaks, with location allowed, on iPhone; in the background only with headphones (5 min grace)', () => {
  need();
  const W = (o) => L.awakeWanted({ ...base, ...o }).want;
  assert.equal(W({}), true, 'locked, headphones in');
  assert.equal(W({ appActive: true, route: 'speaker' }), true, 'open: ready for the lock (location can only start in front)');
  assert.equal(W({ route: 'speaker', headphonesAt: T0 - 4 * 60000 }), true, 'AirPods back in the case under 5 min ago');
  assert.equal(W({ route: 'speaker', headphonesAt: T0 - 6 * 60000 }), false, 'out over 5 min: let go');
  assert.equal(W({ route: 'speaker', headphonesAt: null }), false, 'locked without headphones: no blue pill, no battery');
  assert.equal(W({ route: 'other', headphonesAt: null }), false, 'car or AirPlay: the push and the car do it');
  assert.equal(W({ os: 'android' }), false);
  assert.equal(W({ supported: false }), false);
  assert.equal(W({ setting: false }), false);
  assert.equal(W({ speaks: false }), false, 'obeys the trip voice settings');
  assert.equal(W({ tripActive: false }), false);
  assert.equal(W({ status: 'notDetermined' }), false, 'never prompts from here');
  assert.equal(W({ status: 'denied' }), false);
  assert.equal(W({ status: 'noBackgroundMode' }), false);
  assert.equal(W({ arrivedAt: T0 - 30000 }), true, 'the arrival is heard in full');
  assert.equal(W({ arrivedAt: T0 - 61000 }), false, 'stops after the arrival');
});

test('the native deadline: 30 min after the last arrival, at least 30 min, at most 4 h', () => {
  need();
  assert.equal(L.awakeUntil(T0 + 20 * 60000, T0), T0 + 50 * 60000);
  assert.equal(L.awakeUntil(T0 - 60 * 60000, T0), T0 + 30 * 60000);
  assert.equal(L.awakeUntil(T0 + 10 * 3600000, T0), T0 + 4 * 3600000);
  assert.equal(L.awakeUntil(null, T0), T0 + 4 * 3600000);
});

test('voicing the locked trip: background, awake, setting on, headphones in; the voice time runs without a break', () => {
  need();
  assert.equal(L.canVoiceLocked({ appActive: false, awake: true, route: 'headphones', setting: true }), true);
  assert.equal(L.canVoiceLocked({ appActive: false, awake: true, route: 'speaker', setting: true }), false, 'never the speaker from the lock (Silent keeps its meaning)');
  assert.equal(L.canVoiceLocked({ appActive: true, awake: true, route: 'headphones', setting: true }), false, 'open: the open app voices as before');
  assert.equal(L.canVoiceLocked({ appActive: false, awake: false, route: 'headphones', setting: true }), false);
  assert.equal(L.canVoiceLocked({ appActive: false, awake: true, route: 'headphones', setting: false }), false);
  // open at T0, locked with headphones at T0+1 min: the time stays T0; headphones out: gone; in again: from then.
  let s = L.nextVoiceSince(null, true, T0);
  s = L.nextVoiceSince(s, true, T0 + 60000); assert.equal(s, T0);
  s = L.nextVoiceSince(s, false, T0 + 120000); assert.equal(s, null);
  s = L.nextVoiceSince(s, true, T0 + 180000); assert.equal(s, T0 + 180000);
  assert.equal(L.lockedVoiceState({ voicing: false, since: T0, refreshes: 3, speakingUntil: 0 }), null);
  assert.deepEqual(L.lockedVoiceState({ voicing: true, since: T0, refreshes: 3, speakingUntil: 5 }), { open: true, silent: false, headphones: true, openSince: T0, refreshes: 3, speakingUntil: 5 });
});

test('the trip flow voice gate speaks a moment from the lock, never a catch-up from before the voice was there, never a stale reading', async () => {
  need();
  const S = await load('src/lib/tripState.ts');
  const v = L.lockedVoiceState({ voicing: true, since: T0, refreshes: 4, speakingUntil: 0 });
  const said = S.voiceGate(v, T0 + 90000, 'Get off now. Cove.', 10000, false, T0 + 90000);
  assert.equal(said.words, 'Get off now. Cove.');
  assert.equal(S.voiceGate(v, T0 + 90000, 'Get off now. Cove.', 10000, false, T0 - 60000).words, null, 'V4: due before the voice was there');
  assert.equal(S.voiceGate(v, T0 + 90000, 'Get off now. Cove.', 70000, false, T0 + 90000).words, null, 'V2: reading over 60 s old');
});

test('locked actions: no own banner while the server watches, speech only in headphones, a moment a push already read is not said again', () => {
  need();
  const acts = [
    { t: 'alert', key: 'f:getoff:0', id: 'a' },
    { t: 'clip', key: 'f:getoff:0', clip: 'getoff', file: 'getoff_now', text: 'Get off now. Cove.' },
    { t: 'say', key: 'f:headsup:1', text: 'Cove is next.' },
    { t: 'ongoing', title: 'x', body: 'y' },
    { t: 'end' },
  ];
  const kinds = (a) => a.map((x) => x.t + (x.key ? ':' + x.key : ''));
  assert.deepEqual(kinds(L.lockedActions(acts, { serverWatching: true, headphones: true, said: {}, now: T0 })), ['clip:f:getoff:0', 'say:f:headsup:1', 'end']);
  assert.deepEqual(kinds(L.lockedActions(acts, { serverWatching: false, headphones: true, said: {}, now: T0 })), ['alert:f:getoff:0', 'clip:f:getoff:0', 'say:f:headsup:1', 'end'], 'no server: the phone keeps its own (silent) banner');
  assert.deepEqual(kinds(L.lockedActions(acts, { serverWatching: true, headphones: false, said: {}, now: T0 })), ['end']);
  assert.deepEqual(kinds(L.lockedActions(acts, { serverWatching: true, headphones: true, said: { getoff: T0 - 20000 }, now: T0 })), ['say:f:headsup:1', 'end'], 'the push read Get off now 20 s ago');
  assert.deepEqual(kinds(L.lockedActions(acts, { serverWatching: true, headphones: true, said: { getoff: T0 - 4 * 60000 }, now: T0 })), ['clip:f:getoff:0', 'say:f:headsup:1', 'end'], 'a Get off now 4 min ago was the leg before');
  assert.equal(L.kindOfKey('f:atstop:0'), 'getoff');
  assert.equal(L.kindOfKey('f:arrived:1'), 'arrived');
  assert.equal(L.kindOfKey('f:delay:0'), null);
  assert.equal(L.kindOfKey('conn1'), null);
  assert.deepEqual(L.saidKinds(acts, {}, T0), { getoff: T0, headsup: T0 });
});

test('pushes read out by the app: this trip, last minute, heads-up / Get off now / arrival only, once, not what the app said', () => {
  need();
  const n = (id, ago, tag, body, watch = 'W7') => ({ id, date: T0 - ago, title: 't', body, data: { watch, tag } });
  const shown = [
    n('1', 10000, 'wW7getoff', 'Get off now. Cove.'),
    n('2', 20000, 'wW7headsup', 'Cove is next. Arriving about 4:56. Get ready to get off.'),
    n('3', 15000, 'wW7delay', 'Your T9 is 5 min late.'),
    n('4', 90000, 'wW7arrived', "You've arrived at Cove. 4:56."),
    n('5', 5000, 'wX1getoff', 'Get off now. Elsewhere.', 'X1'),
    n('6', 5000, 'wW7atstop', 'Cove now. Get off here.'),
  ];
  const r = L.pushesToSay(shown, { watch: 'W7', now: T0, said: {}, heard: {} });
  assert.deepEqual(r.map((x) => [x.id, x.kind]), [['2', 'headsup'], ['1', 'getoff']], 'oldest first; atstop is the same Get off now, said once');
  assert.equal(r[1].text, 'Get off now. Cove.');
  assert.deepEqual(L.pushesToSay(shown, { watch: 'W7', now: T0, said: { getoff: T0 - 30000 }, heard: {} }).map((x) => x.id), ['2'], 'the app said Get off now itself');
  assert.deepEqual(L.pushesToSay(shown, { watch: 'W7', now: T0, said: {}, heard: { 1: 1, 2: 1 } }).map((x) => x.id), ['6'], 'heard ones are never said again');
  assert.deepEqual(L.pushesToSay(shown, { watch: null, now: T0, said: {}, heard: {} }), []);
});

test('silent push clips only while the app voices the locked trip from a reading under 60 s, on a 45 s lease', () => {
  need();
  assert.equal(L.quietLease({ voicing: true, readingAge: 10000, now: T0 }), T0 + 45000);
  assert.equal(L.quietLease({ voicing: true, readingAge: 61000, now: T0 }), null, 'stale: the push talks');
  assert.equal(L.quietLease({ voicing: true, readingAge: null, now: T0 }), null);
  assert.equal(L.quietLease({ voicing: false, readingAge: 1000, now: T0 }), null);
});

test('Settings row words follow the location answer; the help names Announce Notifications', () => {
  need();
  assert.deepEqual(L.lockedVoiceRow('ok'), { subtitle: 'On a trip, even when locked or on Silent', action: 'none' });
  assert.equal(L.lockedVoiceRow('notDetermined').action, 'ask');
  assert.equal(L.lockedVoiceRow('denied').action, 'settings');
  assert.match(L.LOCKED_VOICE_HELP.body, /Announce Notifications/);
  assert.match(L.LOCKED_VOICE_HELP.body, /stops when you arrive/);
  for (const w of [L.LOCKED_VOICE_HELP.body, L.lockedVoiceRow('ok').subtitle]) assert.doesNotMatch(w, /[\u2013\u2014]/, 'no dashes');
});

test('QuietClips: a silent 16 bit WAV under the three clip names in Library/Sounds, removed again; the lease rule', { skip: swiftc ? false : 'no swiftc on this machine', timeout: 300000 }, () => {
  assert.ok(exists('modules/transport-ios/ios/QuietClips.swift'), 'QuietClips.swift is missing');
  const bin = path.join(tmp, 'quietclips');
  execFileSync(swiftc, [path.join(app, 'modules/transport-ios/ios/QuietClips.swift'), path.join(here, 'swift/quietclips/main.swift'), '-o', bin], { stdio: 'pipe', timeout: 280000 });
  const r = Object.fromEntries(execFileSync(bin, { encoding: 'utf8' }).trim().split('\n').map((l) => JSON.parse(l)).map((x) => [x.case, x]));
  assert.equal(r.wav.head, 'RIFF'); assert.equal(r.wav.wave, 'WAVE'); assert.equal(r.wav.riffSize, r.wav.len - 8);
  assert.equal(r.wav.silent, true); assert.equal(r.wav.rate, 8000 & 0xffff); assert.equal(r.wav.bits, 16);
  assert.deepEqual(r.on.files, ['arrival.wav', 'getoff_now.wav', 'getoff_soon.wav']);
  assert.equal(r.on.present, true);
  assert.deepEqual(r.off.files, []); assert.equal(r.off.present, false); assert.equal(r.off.again, true);
  assert.deepEqual([r.lease.all, r.lease.speaker, r.lease.notWanted, r.lease.expired, r.lease.noLease], [true, false, false, false, false]);
});

test('QuietClips names are exactly the bundled sounds the pushes name', () => {
  assert.ok(exists('modules/transport-ios/ios/QuietClips.swift'), 'QuietClips.swift is missing');
  const q = read('modules/transport-ios/ios/QuietClips.swift');
  const cfg = JSON.parse(read('app.json')).expo;
  const sounds = cfg.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-notifications')[1].sounds.map((s) => path.basename(s, '.wav')).sort();
  const names = JSON.parse(/static let names = (\[[^\]]+\])/.exec(q)[1]).sort();
  assert.deepEqual(names, sounds);
  assert.match(q, /\.libraryDirectory/);
  assert.match(q, /appendingPathComponent\("Sounds"/);
});

test('TripAwake: When In Use background location the way guidance does it, battery first, stops itself, no Always', () => {
  assert.ok(exists('modules/transport-ios/ios/TripAwake.swift'), 'TripAwake.swift is missing');
  const a = read('modules/transport-ios/ios/TripAwake.swift');
  for (const re of [/allowsBackgroundLocationUpdates = true/, /showsBackgroundLocationIndicator = true/, /pausesLocationUpdatesAutomatically = false/,
    /desiredAccuracy = kCLLocationAccuracyHundredMeters/, /distanceFilter = 100/, /activityType = \.otherNavigation/,
    /#available\(iOS 17\.0, \*\) \{ activity = CLBackgroundActivitySession\(\) \}/, /\.invalidate\(\)/, /stopUpdatingLocation\(\)/,
    /AVAudioSession\.routeChangeNotification/, /UIApplication\.willTerminateNotification/, /QuietClips\.apply\(false\)/, /if let u = until, now >= u \{ stop\(\); return \}/,
    /modes\.contains\("location"\), modes\.contains\("audio"\)/]) assert.match(a, re);
  for (const bad of [/requestAlwaysAuthorization/, /requestWhenInUseAuthorization/, /kCLLocationAccuracyBest/, /startMonitoringSignificantLocationChanges/, /AVAudioPlayer/]) assert.doesNotMatch(a, bad);
  const m = read('modules/transport-ios/ios/TransportIOSModule.swift');
  assert.match(m, /Events\("onActivityPushToken", "onIntentQueued", "onWatchAction", "onTripWake"\)/);
  for (const f of ['tripAwakeStatus', 'startTripAwake', 'stopTripAwake', 'tripAwakeOn', 'setPushClipsQuiet', 'startVoiceAudio']) assert.match(m, new RegExp(`Function\\("${f}"\\)`), f);
  assert.match(m, /AsyncFunction\("startTripAwake"\)[\s\S]{0,200}\.runOnQueue\(\.main\)/);
  assert.match(m, /setCategory\(\.playback, mode: \.voicePrompt, options: \[\.duckOthers, \.interruptSpokenAudioAndMixWithOthers\]\)/);
  const create = m.slice(m.indexOf('OnCreate {'), m.indexOf('OnCreate {') + 400);
  assert.match(create, /QuietClips\.apply\(false\)/, 'nothing left silent from an earlier run');
  assert.match(read('modules/transport-ios/ios/ClipPlayer.swift'), /setCategory\(\.playback, mode: \.voicePrompt, options: \[\.duckOthers, \.interruptSpokenAudioAndMixWithOthers\]\)/);
});

test('Info.plist: exactly the audio and location background modes, When In Use only (no Always), the purpose text says why', () => {
  const e = JSON.parse(read('app.json')).expo;
  assert.deepEqual([...(e.ios.infoPlist.UIBackgroundModes || [])].sort(), ['audio', 'location']);
  const loc = e.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-location')[1];
  assert.equal(loc.locationAlwaysAndWhenInUsePermission, false);
  assert.equal(loc.locationAlwaysPermission, false);
  assert.match(loc.locationWhenInUsePermission, /spoken alerts going in your headphones while your iPhone is locked/);
  assert.equal(e.ios.entitlements['com.apple.developer.usernotifications.critical-alerts'], undefined, 'no Critical Alerts');
});

test('wiring: the engine starts and stops the session with the trip, filters and speaks through lockedVoice, wakes on the native tick', () => {
  assert.ok(exists('src/lib/lockedVoice.ts'), 'src/lib/lockedVoice.ts is missing');
  const e = read('src/lib/liveEngine.ts');
  assert.match(e, /const lk = await lockedStep\(cur, /);
  assert.match(e, /if \(AppState\.currentState !== 'active' && !lk\.voicing\) \{ await lockedQuiet\(false, null\)/, 'background without the locked voice: nothing runs, as before');
  assert.match(e, /voice: lk\.voice \|\| \{ open: AppState\.currentState === 'active'/);
  assert.match(e, /lockedActions\(r\.actions, \{ serverWatching: !!g\.watchId, headphones: true/);
  assert.match(e, /await lockedReadPushes\(g\.watchId/);
  assert.match(e, /await lockedQuiet\(true, svcAt \? Date\.now\(\) - svcAt : null\)/);
  assert.match(e, /onLockedWake\(\(\) => \{ tickLive\(\)/);
  assert.match(e, /await stopLockedVoice\(\)\.catch/, 'no trip: stopped');
  const v = read('src/lib/lockedVoice.ts');
  assert.match(v, /if \(appActive\) \{/, 'started only with the app in front');
  assert.match(v, /speak\(p\.text, \{ alert: true, locked: true \}\)/);
  const n = read('src/lib/nativeExtras.ts');
  assert.match(n, /opts\.locked \? voiceAudio\(\) : null\) \|\| alertAudio\(\)/);
  const ix = read('modules/transport-ios/index.ts');
  assert.match(ix, /hasTripAwake: \(\): boolean => typeof native\?\.startTripAwake === 'function'/);
  const st = read('src/app/(tabs)/settings/index.tsx');
  assert.match(st, /title=\{LOCKED_VOICE_HELP\.title\}/);
  assert.match(st, /lockedOk \? \(/, 'hidden on builds without it');
  assert.match(read('src/lib/store.ts'), /setLockedVoice\(on: boolean\)/);
});

test('docs: the App Review note for background location and audio, and the decision', () => {
  assert.ok(exists('../docs/VOICE_LOCKED.md'), 'docs/VOICE_LOCKED.md is missing');
  const d = read('../docs/VOICE_LOCKED.md');
  assert.match(d, /Review Notes/);
  assert.match(d, /UIBackgroundModes/);
  assert.match(read('../docs/APP_REVIEW_NOTES.md'), /spoken trip alerts/i);
});
