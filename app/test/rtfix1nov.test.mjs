// Real-time harness fixes, app (1 Nov 2026, task e0bf4652; files/day-1nov/rt-harness.md bugs #2 to #4). Start trip sent
// the trip watch and the Lock Screen card's push token once, from JavaScript: locked before the token came, no signal or a
// server blip at that moment, and the card stayed frozen and no server alert (Get off now among them) came for the whole
// trip; a slow answer was taken as a failure (double Get off now) and End trip never stopped the server's. Now:
// tripRegCore.ts (keys, outcomes, backoff), live.ts (retries while open and on return, End trip by key), livePush.ts and
// iosBridge.ts (the card's registration waits natively for its token) and the native queue (TripOutbox.swift, sent by a
// background upload while locked and by the widget's timeline). The harness runs tripRegCore.ts itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '..');
const repo = path.join(app, '..');
const require = createRequire(import.meta.url);
const ts = require(path.join(app, 'node_modules', 'typescript'));
const read = (rel, base = app) => (fs.existsSync(path.join(base, rel)) ? fs.readFileSync(path.join(base, rel), 'utf8') : '');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-rtfix-'));
async function load(rel) {
  const src = read(rel);
  assert.ok(src, rel);
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  return import(pathToFileURL(f).href);
}
function which(cmd) { try { return execFileSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim() || null; } catch { return null; } }
const swiftc = process.env.WIDGET_NATIVE_CHECK === '0' ? null : which('swiftc');

test('tripRegCore: a 2xx is done, a time out is unknown (asked again with the same key), 4xx is never asked again', async () => {
  const R = await load('src/lib/tripRegCore.ts');
  assert.equal(R.regOutcome(200), 'ok');
  assert.equal(R.regOutcome('timeout'), 'unknown');
  assert.equal(R.regOutcome('offline'), 'retry');
  assert.equal(R.regOutcome(0), 'retry');
  assert.equal(R.regOutcome(503), 'retry');
  assert.equal(R.regOutcome(429), 'retry');
  assert.equal(R.regOutcome(400), 'gone');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map((n) => R.regBackoffMs(n) / 1000), [5, 15, 30, 60, 120, 300, 300], 'battery first: 5 min apart at most');
  const t0 = 1_000_000;
  assert.equal(R.regNextAt(1, 'retry', t0, t0), t0 + 5000);
  assert.equal(R.regNextAt(1, 'unknown', t0, t0), t0 + 5000);
  assert.equal(R.regNextAt(1, 'ok', t0, t0), null);
  assert.equal(R.regNextAt(1, 'gone', t0, t0), null);
  assert.equal(R.regNextAt(3, 'retry', t0 + R.REG_MAX_MS + 1, t0), null, 'gives up after 4 h');
});

test('tripRegCore: one key per registration, in the server\'s shape; the server says it keeps keys by saying it back', async () => {
  const R = await load('src/lib/tripRegCore.ts');
  const k = R.regKeyFor('gm9x2a1b3c', 'dev-1234567890abcdef0123');
  assert.match(k, /^[A-Za-z0-9_-]{6,64}$/, 'server watchKeyOf');
  assert.equal(R.regKeyFor('gm9x2a1b3c', 'dev-1234567890abcdef0123'), k, 'the same trip always gives the same key');
  assert.notEqual(R.regKeyFor('gother', 'dev-1234567890abcdef0123'), k);
  assert.match(R.regKeyFor('', ''), /^[A-Za-z0-9_-]{6,64}$/);
  assert.match(R.regKeyFor('g'.repeat(90), 'd'.repeat(90)), /^[A-Za-z0-9_-]{6,64}$/);
  assert.equal(R.serverKeepsKeys({ ok: true, watch: { id: 'w1', key: k } }, k), true);
  assert.equal(R.serverKeepsKeys({ ok: true, watch: { id: 'w1' } }, k), false, 'an older server: a time out is not asked again (it would make two watches)');
  assert.equal(R.keepPhoneGetOff(false, false), true);
  assert.equal(R.keepPhoneGetOff(true, false), true, 'the server took the watch but does not send Get off now');
  assert.equal(R.keepPhoneGetOff(true, true), false, 'one voice');
  const w = R.watchEntry({ key: k }, t(0), ['getoff-g1-gnow0']);
  assert.equal(w.kind, 'watch'); assert.equal(w.method, 'POST'); assert.equal(w.path, '/api/watch');
  assert.equal(w.after - t(0), R.REG_NATIVE_DELAY_S * 1000, 'the native copy waits for JavaScript\'s own try');
  assert.deepEqual(w.offNotes, ['getoff-g1-gnow0']);
  assert.equal(JSON.parse(w.body).key, k);
  const s = R.stopEntry('dev 1', k, 'w1', t(0));
  assert.equal(s.method, 'DELETE');
  assert.equal(s.path, `/api/watch?device=dev%201&key=${k}&id=w1`);
  assert.equal(s.after, t(0), 'End trip goes at once');
  function t(m) { return 1_793_520_000_000 + m * 60000; }
});

test('live.ts: the trip watch carries the key, is asked again with backoff while open and on return, and End trip stops it by key', () => {
  const L = read('src/lib/live.ts');
  assert.match(L, /from '\.\/tripRegCore'/);
  assert.match(L, /regKey\?: string/, 'the key is kept on the live trip');
  assert.match(L, /lead: 0, track: true, silentStart: true,[^\n]*\n[^\n]*key \};/, 'the key rides every try');
  assert.match(L, /retryLater\(next\)/, 'a failed try is asked again');
  assert.match(L, /out === 'unknown' && !wreg\.keeps \? null/, 'a time out is asked again only from a server that keeps keys');
  assert.match(L, /AppState\.addEventListener\('change'[\s\S]{0,120}liveWatch\(\)/, 'back in front: an unanswered registration goes again');
  assert.match(L, /iosNative\.outboxPut\('watch', watchEntry\(/, 'iPhone: the native queue holds a copy');
  assert.match(L, /iosNative\.outboxTake\('watch'\)/, 'taken back once JavaScript heard yes');
  assert.match(L, /if \(g\.watchId \|\| g\.regKey\) stopServerWatch\(g\.watchId, g\.regKey \|\| null\)/, 'End trip stops a watch it never heard back from');
  assert.match(L, /iosNative\.outboxPut\('stop', stopEntry\(/);
  const A = read('src/lib/api.ts');
  assert.match(A, /stopWatch: async \(id: string \| null, key\?: string\)/);
  const S = read('src/components/Smart.tsx');
  assert.match(S, /regKey: undefined/, 'a replan registers the new legs under a new key');
});

test('livePush/iosBridge: the card\'s registration waits natively for its token from Start trip; taken back once sent', () => {
  const P = read('platform/livePush.ts');
  assert.match(P, /export async function shareCardRegistration/);
  assert.match(P, /iosNative\.setCardRegistration\(\{ device: await getDevice\(\), trip: pushTrip\(g, c24\), tripFlow: TRIP_FLOW, c24 \}, PUSH_BASE\)/);
  assert.match(P, /if \(ok\) \{ sentKey = key; iosNative\.outboxTake\('card'\); \}/);
  const B = read('platform/iosBridge.ts');
  assert.ok(B.indexOf('shareCardRegistration(g)') > 0 && B.indexOf('shareCardRegistration(g)') < B.indexOf('activityId = await iosNative.startTrip('), 'before the card starts (its token can come after the phone locked)');
  const I = read('modules/transport-ios/index.ts');
  for (const f of ['outboxPut?:', 'outboxTake?:', 'setCardRegistration?:', 'hasOutbox:']) assert.ok(I.includes(f), f);
  assert.match(I, /typeof native\?\.outboxPut === 'function' \? !!native\.outboxPut/, 'feature detected: builds up to 214 have no queue (JavaScript retries still run)');
});

test('TripOutbox.swift: queue, backoff, card token, stop over watch, Get off now answer (compiled on its own)', { skip: swiftc ? false : 'no swiftc on this machine', timeout: 300000 }, () => {
  const bin = path.join(out, 'tob');
  execFileSync(swiftc, [path.join(app, 'modules/transport-ios/ios/TripOutbox.swift'), path.join(here, 'swift/tripoutbox/main.swift'), '-o', bin], { stdio: 'pipe', timeout: 280000 });
  const v = Object.fromEntries(execFileSync(bin, { encoding: 'utf8', timeout: 20000 }).trim().split('\n').map((l) => { const o = JSON.parse(l); return [o.k, o.v]; }));
  assert.equal(v.o200, 'ok'); assert.equal(v.o503, 'retry'); assert.equal(v.o429, 'retry'); assert.equal(v.o400, 'gone'); assert.equal(v.oNil, 'retry');
  assert.equal(v.wait1, 5); assert.equal(v.wait9, 300, 'same backoff as tripRegCore.ts');
  assert.equal(v.putWatch, true); assert.equal(v.putBad, false, 'only /api/ POST or DELETE');
  assert.equal(v.dueNow, 0, 'the watch copy waits 20 s'); assert.deepEqual(v.due21, ['watch']);
  assert.equal(v.cardToken, 'ab'); assert.equal(v.cardActivity, 'act1'); assert.equal(v.cardDevice, 'dev1');
  assert.deepEqual(v.cardDueNow, ['card'], 'token after the phone locked: sent at once');
  assert.equal(v.cardOpenWaits, 20, 'app open: JavaScript sends it, the copy waits');
  assert.equal(v.retryTries, 1); assert.equal(v.retryAfter, 26, 'retry 5 s after the failed try at 21 s');
  assert.equal(v.okGone, false, 'a 2xx takes it out');
  assert.equal(v.putStop, true); assert.deepEqual(v.afterStop, ['card', 'stop'], 'End trip takes the queued watch out');
  assert.deepEqual(v.dueOrder, ['stop', 'card']);
  assert.equal(v.stopURL, 'https://api.transportsydney.app/api/watch?device=dev1&key=g1-abc'); assert.equal(v.stopMethod, 'DELETE');
  assert.equal(v.getOffYes, true); assert.equal(v.getOffNo, false);
  assert.equal(v.pastUntil, true); assert.equal(v.cardCleared, false);
});

test('native wiring: one TripOutbox file in the app and the widget, background upload with its app delegate, the token queued natively', () => {
  const core = read('modules/transport-ios/ios/TripOutbox.swift');
  assert.ok(core);
  assert.equal(read('targets/widget/TripOutbox.swift'), core, 'the widget copy is the same file');
  const U = read('modules/transport-ios/ios/TripOutboxUploader.swift');
  assert.match(U, /URLSessionConfiguration\.background\(withIdentifier:/);
  assert.match(U, /sessionSendsLaunchEvents = true/);
  assert.match(U, /earliestBeginDate = at/, 'a retry waits by the backoff, run by iOS while suspended');
  assert.match(U, /removePendingNotificationRequests\(withIdentifiers: notes\)/, 'the phone\'s own Get off now comes off on the server\'s yes');
  assert.match(U, /guard identifier == TripOutboxUploader\.sessionId else \{ completionHandler\(\); return \}/, 'other sessions\' wakes answered at once');
  assert.match(U, /beginBackgroundTask/);
  const cfg = JSON.parse(read('modules/transport-ios/expo-module.config.json'));
  assert.deepEqual(cfg.apple.appDelegateSubscribers, ['TripOutboxAppDelegate']);
  assert.deepEqual(cfg.apple.modules, ['TransportIOSModule']);
  const M = read('modules/transport-ios/ios/TransportIOSModule.swift');
  assert.match(M, /TripOutbox\.cardToken\(token, activity: id, appOpen: open/);
  for (const f of ['Function("outboxPut")', 'Function("outboxTake")', 'Function("setCardRegistration")']) assert.ok(M.includes(f), f);
  assert.match(M, /didEnterBackgroundNotification/);
  const W = read('targets/widget/TransportWidgets.swift');
  assert.match(W, /TripOutbox\.flush\(AppIdentity\.groupDefaults, timeout: 5\)/, 'the widget\'s reload sends what is still waiting');
});

test('the real-time harness runs this app\'s registration code', () => {
  const sc = read('tools/rt-harness/scenario.mjs', repo);
  assert.match(sc, /app\/src\/lib\/tripRegCore\.ts/);
  assert.match(sc, /REG\.regOutcome/);
  const sv = read('tools/rt-harness/server.mjs', repo);
  assert.match(sv, /const after = Promise\.all\(\[\.\.\.exec\.pending\]\)/, 'the phone has its answer before the server\'s waitUntil work ends');
  const ck = read('tools/rt-harness/checks.mjs', repo);
  assert.match(ck, /endPush/, 'card push cadence ends at the card\'s own end');
});
