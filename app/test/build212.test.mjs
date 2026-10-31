// Build 212 (1 Nov 2026, native, runtime 1.3.0): the whole trip on every native surface (spec docs/TRIP_FLOW_SPEC.md
// 2.4, 2.5, gaps G3 G4 G5 G10 G24 G25 G27 G28 G30 G31 G36 G37). Swift cannot run here, so the Swift rules are pinned by
// their source and the native audit (ios-native-audit.yml) renders them; the app code is run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linkTs } from './tsLink.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '..');
const root = path.join(app, '..');
const read = (rel) => fs.readFileSync(path.join(app, rel), 'utf8');
/** The code without its // comments, for checks on what is drawn. */
const code = (s) => s.replace(/\/\/[^\n]*/g, '');
const require = createRequire(import.meta.url);
const ts = require(path.join(app, 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-212-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(app, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, linkTs(js, out, ts));
  return import(pathToFileURL(f).href);
}

test('build 212 has its own runtime 1.3.0 and the build workflow refuses 1.2.0 for it', () => {
  const a = JSON.parse(read('app.json')).expo;
  assert.equal(a.ios.buildNumber, '212');
  assert.equal(a.runtimeVersion, '1.3.0');
  const wf = fs.readFileSync(path.join(root, '.github/workflows/ios-209-local.yml'), 'utf8');
  assert.match(wf, /github\.ref == 'refs\/heads\/build-212-rc'/);
  assert.match(wf, /"\$BN" -ge 212 \] && \[ "\$RT" = "1\.2\.0" \]/);
  assert.match(wf, /needs: audit/);
  assert.doesNotMatch(wf, /eas(-cli@latest)? submit|appStoreVersionSubmissions|reviewSubmissions/);
});

test('the Kylie arrival clip is bundled as a notification sound, same format as the get off clips (G37)', () => {
  const a = JSON.parse(read('app.json')).expo;
  const n = a.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-notifications');
  assert.deepEqual(n[1].sounds, ['./assets/sounds/getoff_now.wav', './assets/sounds/getoff_soon.wav', './assets/sounds/arrival.wav']);
  const b = fs.readFileSync(path.join(app, 'assets/sounds/arrival.wav'));
  assert.equal(crypto.createHash('sha256').update(b).digest('hex'), '38638ca00d6a940402e6f9914dc3dae8f09b9462e56bacd26678ca40e900dd2c');
  // RIFF WAVE, PCM, mono, 44.1 kHz, 16 bit, about 2.2 s (iOS plays notification sounds up to 30 s).
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WAVE');
  assert.equal(b.readUInt16LE(20), 1);
  assert.equal(b.readUInt16LE(22), 1);
  assert.equal(b.readUInt32LE(24), 44100);
  assert.equal(b.readUInt16LE(34), 16);
  const secs = (b.length - 44) / (44100 * 2);
  assert.ok(secs > 1.8 && secs < 2.6, `${secs} s`);
});

test('the arrival clip has the trip clip name the server sends and the words it says', async () => {
  const { TRIP_CLIPS } = await load('src/lib/tripState.ts');
  assert.equal(TRIP_CLIPS.arrived.file, 'arrival');
  assert.equal(TRIP_CLIPS.arrived.words, "You've arrived at your stop.");
  const { GETOFF_SOUND_WORDS, arrivalClipSupported } = await load('src/lib/getOffCore.ts');
  assert.equal(GETOFF_SOUND_WORDS.arrival, "You've arrived at your stop.");
  assert.equal(arrivalClipSupported('ios', 212), true);
  assert.equal(arrivalClipSupported('ios', '211'), false);
  assert.equal(arrivalClipSupported('android', 9), false);
});

test('card version 3: redrawn at the get off moment on board as well as at the departure while waiting (G3, G10)', async () => {
  const { staleAt } = await load('platform/tripCard.ts');
  const u = 1_793_500_000_000;
  const ride = { phase: 'ride', departs: null, legArrives: u + 50_000, arrival: u + 600_000 };
  const wait = { phase: 'wait', departs: u + 40_000, legArrives: u + 900_000, arrival: u + 900_000 };
  assert.equal(staleAt(ride, u, 3), u + 50_000);
  assert.equal(staleAt(ride, u, 2), u + 120_000, 'build 210 and 211 would draw it as old');
  assert.equal(staleAt(ride, u, true), u + 120_000);
  assert.equal(staleAt(wait, u, 3), u + 40_000);
  assert.equal(staleAt({ ...ride, legArrives: u - 5_000 }, u, 3), u + 1_000, 'never in the past');
  assert.equal(staleAt({ ...ride, phase: 'arrived' }, u, 3), null);
  const native = read('modules/transport-ios/ios/TransportIOSModule.swift');
  assert.match(native, /Function\("liveCardVersion"\) \{ \(\) -> Int in\s*return 3/);
  assert.match(read('platform/iosBridge.ts'), /staleAt\(card, card\.updated \?\? updated, cardV,/);
});

const fieldsOf = (src) => {
  const s = src.slice(src.indexOf('struct ContentState'), src.indexOf('public init(line:'));
  return [...s.matchAll(/public var (\w+): ([\w?<>\[\]]+)/g)].map((m) => `${m[1]}:${m[2]}`);
};

test('the card carries the delay as a number and a live flag per time; both Swift copies decode the same fields (G31)', () => {
  const mod = fieldsOf(read('modules/transport-ios/ios/LiveTripAttributes.swift'));
  const wid = fieldsOf(read('targets/widget/LiveTripActivity.swift'));
  assert.deepEqual(mod, wid);
  for (const f of ['delayMin:Int?', 'departsLive:Bool?', 'legArrivesLive:Bool?']) assert.ok(wid.includes(f), f);
  const card = read('platform/tripCard.ts');
  assert.match(card, /delayMin: cancelled \|\| x\.missed \|\| s\.delayMin == null \|\| s\.track === 'timetable' \? null : s\.delayMin/);
  // The widget and the Watch read the same numbers from the shared card.
  assert.match(read('targets/widget/WidgetIntents.swift'), /var delayMin: Int\?/);
  assert.match(read('targets/watch/WatchCore.swift'), /var delayMin: Int\?/);
});

test('Live Activity: Due at the live departure and Now at the get off moment, never 0:00; old data steps by itself (G3, G25)', () => {
  const s = read('targets/widget/LiveTripActivity.swift');
  assert.match(s, /return phase == "wait" \? "Due" : "Now"/);
  assert.match(s, /public static let liveFor: TimeInterval = 120/);
  assert.match(s, /return a >= 600 \? 3 : \(a >= 300 \? 2 : 1\)/);
  assert.match(s, /"No live data since \\\(Clock\.time\(u\)\)"/);
  const w = read('targets/widget/LiveTripActivityWidget.swift');
  // Every countdown on the card and in the Island takes the word.
  assert.equal((w.match(/word: state\.countdownWord\(stale: stale\)/g) || []).length, 6);
  assert.match(w, /struct CompactCountdown[\s\S]*?\} else if let w = word \{/);
  assert.match(w, /struct MinutesUntil[\s\S]*?\} else if let w = word \{/);
});

test('Live Activity: one line status, Island wording, VoiceOver for the countdown and the whole card (G10, G24, G30)', () => {
  const w = read('targets/widget/LiveTripActivityWidget.swift');
  assert.equal((w.match(/lineLimit\(lines\)/g) || []).length, 2, 'only a warning (OneLine lines: 2, statusText lines: 2) may take a second line');
  assert.match(w, /statusText\("", s, isWarning: true, lines: 2\)/);
  assert.doesNotMatch(w, /card\(lines: 2/);
  assert.match(w, /lineProbe\("lock-status"/);
  assert.match(w, /lineProbe\(probe, text: last, lines: 1/);
  assert.doesNotMatch(w, /probe: "lock-detail", lines: 2/);
  assert.match(w, /Text\(Image\(systemName: "bell\.fill"\)\)\.font\(\.caption2\) \+ Text\(" " \+ state\.compactStop\)/);
  assert.match(w, /\.accessibilityLabel\(state\.spokenSummary\(stale: stale\)\)/);
  assert.equal((w.match(/spoken: state\.spokenCountdown\(stale: stale\)/g) || []).length, 4);
  const s = read('targets/widget/LiveTripActivity.swift');
  assert.match(s, /w == "Due" \? "\\\(modeNoun\) due now" : "Get off now"/);
});

test('the Your trip widget follows the whole trip: a moment per phase, no "Checking for the next one", no "Trip started" (G4, G5, G28)', () => {
  const w = read('targets/widget/TransportWidgets.swift');
  const live = w.slice(w.indexOf('static func liveEntries'), w.indexOf('static func notice(for'));
  assert.ok(live.length > 500);
  assert.doesNotMatch(code(live), /Checking for the next one|Trip started/);
  assert.match(w, /if e\.live, let card = SharedLiveCard\.load\(\) \{\s*let entries = Self\.liveEntries\(card\)/);
  assert.match(live, /status = delay \?\? "Leaves"/, 'the delay on the row (G28)');
  assert.match(live, /word = "Due"/);
  assert.match(live, /status = "Get off now"/);
  const m = read('targets/widget/TripMoments.swift');
  for (const k of ['case wait', 'case due', 'case ride', 'case next', 'case getOff', 'case arrived']) assert.ok(m.includes(k), k);
});

test('the Watch has the same moments and never says "Leaving now" (G27)', () => {
  const core = read('targets/watch/WatchCore.swift');
  assert.equal(core, read('targets/watch-widget/WatchCore.swift'), 'the two WatchCore copies are the same file');
  const m = read('targets/widget/TripMoments.swift');
  for (const k of ['nextLead', 'getOffLead', 'dueLead', 'dueFor', 'liveFor']) {
    const a = m.match(new RegExp(`static let ${k}: TimeInterval = (\\d+)`))[1];
    const b = core.match(new RegExp(`static let ${k}: TimeInterval = (\\d+)`))[1];
    assert.equal(a, b, k);
  }
  const c = read('targets/watch-widget/Complications.swift');
  assert.doesNotMatch(code(c), /Leaving now/);
  assert.match(c, /WTripMoments\.list\(l, now: now\)\.map/);
  assert.match(read('targets/watch/TransportWatchApp.swift'), /let m = WTripMoments\.list\(card, now: now\)\[0\]/);
});

test('the never started followed service Live Activity is not bundled (G36)', () => {
  const w = read('targets/widget/TransportWidgets.swift');
  const bundle = w.slice(w.indexOf('struct TransportWidgets: WidgetBundle'), w.indexOf('#endif'));
  assert.doesNotMatch(bundle, /^\s*TripLiveActivity\(\)/m);
  assert.match(bundle, /LiveTripActivityWidget\(\)/);
});

test('battery: no new background mode, no Always location, no Critical Alerts in build 212', () => {
  const a = JSON.parse(read('app.json')).expo;
  assert.equal(a.ios.infoPlist.UIBackgroundModes, undefined);
  assert.equal(a.ios.entitlements['com.apple.developer.usernotifications.critical-alerts'], undefined);
  const loc = a.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-location')[1];
  assert.equal(loc.locationAlwaysPermission, false);
  const all = ['targets/widget/TripMoments.swift', 'targets/widget/TransportWidgets.swift', 'targets/watch/WatchCore.swift'].map(read).join('\n');
  assert.doesNotMatch(all, /Timer\.scheduledTimer|BGTaskScheduler|requestAlwaysAuthorization/);
});

test('native strings from the polish audit: no "Checking for the next one" anywhere, Watch "Due now" not "Leaves now", seconds as "8:00:30pm" (N1, N2, N4)', () => {
  for (const f of ['targets/widget/TransportWidgets.swift', 'targets/watch/WatchCore.swift', 'targets/watch-widget/WatchCore.swift', 'targets/watch-widget/Complications.swift']) {
    assert.doesNotMatch(code(read(f)), /"Checking for the next one"|"Leaves now"|"Leaving now"/, f);
  }
  assert.match(read('targets/watch/WatchCore.swift'), /if m < 1 \{ return "Due now" \}/);
  const fmt = read('targets/widget/Format.swift');
  const sec = fmt.slice(fmt.indexOf('static func seconds'));
  assert.match(sec.slice(0, 400), /replacingOccurrences\(of: " ", with: ""\)/);
});

test('the build sends Sentry every dSYM (Watch included) and the JavaScript source map matched by debug ID, never failing the build', () => {
  const wf = fs.readFileSync(path.join(root, '.github/workflows/ios-209-local.yml'), 'utf8');
  const step = wf.slice(wf.indexOf('- name: Sentry debug symbols'), wf.indexOf('- name: Clean up signing files'));
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /debug-files upload/);
  assert.match(step, /Xcode\/Archives/);
  assert.match(step, /sourcemaps upload/);
  assert.match(step, /"\$ID" = "\$ID2"/, 'a rebuilt bundle is used only when its debug ID equals the IPA one');
  assert.match(wf, /rm -rf "\$RUNNER_TEMP\/easwd"/, 'the kept working folder is removed');
});

test('native audit round 1 fixes: shorter words before a cut, warnings may take two lines, no age said twice, trip rows keep their words (G24, G25)', () => {
  const w = read('targets/widget/LiveTripActivityWidget.swift');
  assert.match(w, /enum ShortText/);
  assert.match(w, /"Platform ", with: "Plat "/);
  assert.match(w, /probe: "lock-warning", lines: 2\)/, 'a warning may take a second line on the Lock Screen');
  assert.match(w, /lineProbe\("lock-status", text: s, lines: 2/);
  assert.match(w, /struct IslandWarning/);
  assert.match(w, /lineProbe\("island-detail"/);
  assert.match(read('targets/widget/LiveTripActivity.swift'), /\^\(No live data since\|Updated\) /);
  const t = read('targets/widget/TransportWidgets.swift');
  assert.match(t, /t\.tripRow == true \? t\.status : WidgetText\.status/);
  assert.match(t, /waitWord: word, tripRow: true\)/);
});
