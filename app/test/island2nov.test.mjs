// 2 Nov 2026, the owner's first real trip on build 214 (files/day-2nov/trip-0452-diagnosis.md B2, B3), yes at 9:19 AM.
// B2: with music playing iOS drew our Live Activity in its minimal form, which showed only "Due". It now shows the line and
//     the clock time ("T4 4:52"), side by side, the line over the time, or the time alone, whichever fits.
// B3: the "Your trip" widget sat on "T9 4:49am · Change here · Now · Updated 4:48am" until 4:55 with no word of the T4. The
//     saved card now carries the next leg so the widget's own timeline moves on to it after "Change here", and "Now" ages
//     by the stale ladder (2 / 5 / 10 min). Swift compiled with swiftc where present (skipped otherwise).
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
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); const j = s.indexOf(b, i + a.length); assert.ok(j > i, b); return s.slice(i, j); };
function which(cmd) { try { return execFileSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim() || null; } catch { return null; } }
const swiftc = process.env.WIDGET_NATIVE_CHECK === '0' ? null : which('swiftc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-island2nov-'));
function runSwift(files, main) {
  const bin = path.join(tmp, path.basename(path.dirname(main)));
  execFileSync(swiftc, [...files.map((f) => path.join(app, f)), path.join(here, main), '-o', bin], { stdio: 'pipe', timeout: 280000 });
  return Object.fromEntries(execFileSync(bin, { encoding: 'utf8', env: { ...process.env, TZ: 'Australia/Sydney' } }).trim().split('\n').map((l) => JSON.parse(l)).map((x) => [x.case, x]));
}
async function load(rel) {
  const js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(tmp, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, linkTs(js, tmp, ts));
  return import(pathToFileURL(f).href);
}

test('B2 minimal Island: the line and the clock time ("T4 4:52"), never a bare Due or Now; orange at Get off now; the tick once arrived', { skip: swiftc ? false : 'no swiftc on this machine', timeout: 300000 }, () => {
  const r = runSwift(['targets/widget/IslandMinimal.swift', 'targets/widget/Format.swift'], 'swift/islandminimal/main.swift');
  const clock = (x) => assert.match(x, /^(4:52|04:52)$/, x);
  assert.equal(r.due.line, 'T4'); clock(r.due.time); assert.equal(r.due.getOff, false);
  assert.equal(r.counting.line, 'T4'); clock(r.counting.time);
  assert.equal(r.getoff.getOff, true, 'Get off now is orange');
  assert.match(r.getoff.time, /^0?4:55$/);
  assert.equal(r.arrived.nil, true, 'arrived keeps the tick');
  assert.equal(r.noline.line, null, 'no line: the time alone');
  assert.equal(r.longline.line, 'M1X99', 'never a cut line name (it falls back to the time alone if it does not fit)');
  assert.equal(r.spoken.v, 'T4, leaves 4:52am');
  assert.equal(r.spokenride.v, 'T4, get off 4:52am');
});

test('B2 minimal Island view: line and time side by side, then stacked, then the time alone; 36 pt; never the countdown word', () => {
  const w = read('targets/widget/LiveTripActivityWidget.swift');
  const min = between(w, 'struct LiveTripMinimal: View', 'struct IslandMinimalLine');
  assert.match(min, /MinimalIsland\.words\(line: state\.line, target: target, word: state\.countdownWord\(stale: stale\), arrived: state\.arrived\(stale: stale\)\)/);
  const order = ['ViewThatFits(in: [.horizontal, .vertical])', 'HStack(spacing: 2)', 'IslandMinimalLine(line: l', 'Text(w.time)', 'VStack(spacing: 1)', 'IslandMinimalLine(line: l', 'Text(w.time)', 'Text(w.time)'];
  let at = -1;
  for (const o of order) { const i = min.indexOf(o, at + 1); assert.ok(i > at, 'order: ' + o); at = i; }
  assert.match(min, /\.frame\(maxWidth: 36, maxHeight: 36\)/);
  assert.match(min, /w\.getOff \? Color\.orange : Color\.white/);
  assert.match(min, /accessibilityLabel\(MinimalIsland\.spoken\(/);
  assert.doesNotMatch(min, /CompactCountdown\([^\n]*word: state\.countdownWord/, 'the minimal view never draws the bare word (Due, Now)');
  assert.match(min, /CompactCountdown\(date: target, arrived: true/, 'the countdown view only for the arrived tick');
  // compact and expanded are unchanged (build 213)
  assert.match(w, /compactLeading: \{\s*LiveTripCompactLeading\(state: s, stale: stale\)/);
  assert.match(w, /minimal: \{\s*LiveTripMinimal\(state: s, stale: stale\)/);
});

test('B3 widget: the stale ladder and the move to the next leg (TripMoments), the next leg decodes from the app', { skip: swiftc ? false : 'no swiftc on this machine', timeout: 300000 }, () => {
  const r = runSwift(['targets/widget/TripMoments.swift'], 'swift/tripmoments2nov/main.swift');
  assert.deepEqual(r.ladder.v, [120, 300, 600], 'redrawn at 2, 5 and 10 min old');
  assert.deepEqual(r.ladderLate.v, [600]);
  assert.equal(r.ladderNone.v, 0);
  assert.equal(r.nextAt.v, 60, '"Change here" for a minute, then the next leg');
  assert.equal(r.nextAtLate.v, 374, 'never before now (the widget redrawn late)');
  assert.deepEqual(r.nextMoments.v.slice(0, 2), ['wait', 'due'], 'counts to the next leg, then Due');
  assert.equal(r.nextMoments.first, 60);
  assert.equal(r.decode.line, 'T4'); assert.equal(r.decode.platform, 'Platform 5'); assert.equal(r.decode.arrives, true);
});

test('B3 widget: liveEntries moves on to the next leg after "Change here"; "Now" only on live times', () => {
  const tw = read('targets/widget/TransportWidgets.swift');
  const le = between(tw, 'static func liveEntries(_ c: SharedLiveCard', 'static func liveReload');
  assert.match(le, /TripMoments\.ladder\(updated: c\.updatedDate, after: m\.at\)/);
  assert.match(le, /if let n = c\.nextLegCard\(\) \{/);
  assert.match(le, /out = out\.filter \{ \$0\.date < start \} \+ liveEntries\(n, now: start\)/);
  const arr = between(tw, 'case .arrived:', 'Old live times');
  assert.match(arr, /if !lastLeg && step >= 1 \{ word = nil \}/);
  const wi = read('targets/widget/WidgetIntents.swift');
  const card = between(wi, 'struct SharedLiveCard: Decodable', 'var target: Date');
  assert.match(card, /var next: SharedNextLeg\?/);
  const nl = between(card, 'func nextLegCard() -> SharedLiveCard?', '\n    }\n');
  for (const s of ['c.phase = "wait"', 'c.departs = n.departs', 'c.platform = n.platform', 'c.line = n.line', 'c.next = nil', 'c.delayMin = nil']) assert.ok(nl.includes(s), s);
});

test('B3 app: the saved card carries the next leg (line, live departure, platform) with the Swift field names', async () => {
  const W = await load('platform/widgetShare.ts');
  const L = await load('src/lib/liveCalc.ts');
  const T0 = Date.parse('2026-11-01T17:26:00Z');
  const at = (m) => T0 + m * 60000, iso = (t) => new Date(t).toISOString();
  const legs = [
    { mode: 'train', line: 'L1', color: '#F99D1C', tripId: 'RUN.A', stopId: 'AAA0', toStopId: 'HUB2', from: 'Aston Station', to: 'Hub Station', planned: iso(at(0)), arrPlanned: iso(at(16.6)), fromPlatform: '4' },
    { mode: 'train', line: 'L2', color: '#005AA3', tripId: 'RUN.B', stopId: 'HUB5', toStopId: 'END2', from: 'Hub Station', to: 'End Station', planned: iso(at(26)), arrPlanned: iso(at(30)), fromPlatform: 'Platform 5' },
  ];
  const s = L.computeLive(legs, [null, null], at(5), {}, null, {});
  assert.equal(s.cur, 0);
  const n = W.nextLegFor(legs, s);
  assert.deepEqual({ line: n.line, from: n.from, to: n.to, platform: n.platform, departs: n.departs, color: n.lineColorHex }, { line: 'L2', from: 'Hub', to: 'End', platform: 'Platform 5', departs: at(26), color: '#005AA3' });
  const share = W.liveCardFor('Aston to End', { phase: 'ride', arrival: at(30) }, 120000, n);
  assert.equal(share.next, n);
  assert.equal(W.liveCardFor('x', { phase: 'arrived', arrival: at(30) }, 120000, n).next, undefined, 'never on an arrived card');
  assert.equal(W.nextLegFor(legs, { ...s, cur: 1 }), null, 'none on the last leg');
  // the keys are the Swift struct's
  const sw = between(read('targets/widget/TripMoments.swift'), 'struct SharedNextLeg: Codable, Hashable {', '\n}\n');
  const swiftKeys = [...sw.matchAll(/^\s+var (\w+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(n).sort(), swiftKeys);
  // the bridge passes it
  const br = read('platform/iosBridge.ts');
  assert.match(br, /shareLive\(g, card, nextLegFor\(g\.legs, s\)\)/);
  assert.match(br, /liveCardFor\([^\n]*ARRIVED_KEEP_S \* 1000, next\)/);
});
