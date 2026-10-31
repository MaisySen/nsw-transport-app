// Build 211 (31 Oct): Live Activity fixes from the owner's real iPhone on build 210 (a T1 trip, 2 stops, 3 min late).
// 1) The countdown said "in 6 minutes" and went onto two lines ("Get off / in 6 / minutes" on the Lock Screen,
//    "in 5 / minutes" in the Island): now "6 min" on one line in every layout.
// 2) The Lock Screen card fell back to the plain bar while the Island showed the stop track: the track layouts now put
//    the stops and the delay on one line, so the card is short enough for the track.
// 3) The Island showed no delay: "3 min late" or "On time" under its countdown.
// 4) The native audit only counted pixels outside a box: it now also fails a countdown on two lines or a cut stop name.
// The Swift is checked here as text (no SwiftUI on this box); the native audit renders it on the simulator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const require = createRequire(import.meta.url);
const ts = require(path.join(root, 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-211-'));
async function load(rel) {
  const js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}

const W = 'targets/widget/LiveTripActivityWidget.swift';
const F = 'targets/widget/TripLiveActivity.swift';

test('the countdown is "6 min" on one line: hours and minutes with short units, never "in 6 minutes"', () => {
  const w = read(W);
  const mu = w.slice(w.indexOf('struct MinutesUntil: View'), w.indexOf('struct LiveTripIslandBottom'));
  assert.match(mu, /TimeDataSource<Range<Date>>\.dateRange\(endingAt: date\), format: Self\.style/);
  assert.match(mu, /Date\.ComponentsFormatStyle\(style: \.abbreviated, locale: unitsLocale, fields: \[\.hour, \.minute\]\)/);
  // US English units: the phone's Australian English writes "6 min." (audit run 41153220659 drew "6 min." and "1 hr, 24 min.").
  assert.match(mu, /static let unitsLocale = Locale\(identifier: "en_US"\)/);
  assert.match(mu, /format: Self\.style\)\s*\.environment\(\\\.locale, Self\.unitsLocale\)/);
  assert.match(mu, /timeIntervalSinceNow < 60 \{\s*Text\("Now"\)/, 'under a minute: "Now"');
  // Old times keep the clock time, iOS 17 too (no minutes only countdown there).
  assert.match(mu, /else if outdated \{\s*Text\(Clock\.time\(date\)\)/);
  for (const f of ['targets/widget', 'targets/watch', 'targets/watch-widget']) {
    for (const name of fs.readdirSync(path.join(root, f)).filter((n) => n.endsWith('.swift'))) {
      const s = read(`${f}/${name}`);
      assert.doesNotMatch(s, /Text\(\.currentDate, format: \.reference\(/, `${name} still has the "in 6 minutes" countdown`);
    }
  }
});

test('every big countdown stays on one line and shrinks before it is cut', () => {
  for (const rel of [W, F]) {
    const s = read(rel);
    const uses = [...s.matchAll(/MinutesUntil\([^\n]*\)\n([\s\S]{0,260}?)\.lineLimit\((\d)\)/g)];
    assert.ok(uses.length >= 2, `${rel}: ${uses.length} countdowns found`);
    for (const u of uses) assert.equal(u[2], '1', `${rel}: a countdown may use ${u[2]} lines`);
  }
  // The small Island countdowns were already one line ("1:59").
  assert.match(read(W), /struct CompactCountdown[\s\S]*?timerInterval[\s\S]{0,200}?\.lineLimit\(1\)/);
});

test('the Lock Screen card keeps the stop track: stops and delay share a line in every track layout, the bar stays the fallback', () => {
  const w = read(W);
  const body = w.slice(w.indexOf('struct LiveTripLockCard'));
  const track = [...body.matchAll(/card\(lines: \d, track: true[^)]*\)/g)].map((m) => m[0]);
  assert.ok(track.length >= 3);
  for (const c of track) assert.match(c, /merged: true/, `${c} puts the stops and the delay on separate lines (too tall, 31 Oct)`);
  assert.ok(body.indexOf('track: true') < body.indexOf('card(lines: 2, track: false)'), 'the track layouts come before the bar');
  assert.match(body, /ProgressView\(value:/);
  assert.match(body, /detailAndWarning\(lines, track: track\)/);
  // "2 stops · On time" with the track and no warning, in the same green as the Island.
  assert.match(body, /else if track, let on = state\.delayStatus\(stale: stale\)/);
});

test('the Island shows the delay under the countdown and does not repeat it under the stop track', () => {
  const w = read(W);
  const tr = w.slice(w.indexOf('struct LiveTripIslandTrailing'), w.indexOf('struct LiveTripIslandCenter'));
  assert.match(tr, /state\.delayStatus\(stale: stale\)/);
  assert.match(tr, /foregroundStyle\(delayColor\(d\)\)/);
  assert.match(w, /func delayColor\(_ words: String\) -> Color \{ words == "On time" \? \.green : \.orange \}/);
  const bottom = w.slice(w.indexOf('struct LiveTripIslandBottom'), w.indexOf('struct TrackFooter'));
  assert.equal((bottom.match(/state\.delayStatus\(stale: stale\) == nil/g) || []).length, 2, 'both bottom layouts leave the delay to the countdown');
});

test('delayStatus reads the card warning the app writes: "N min late" alone, else "On time" only with live stops', async () => {
  const swift = read('targets/widget/LiveTripActivity.swift');
  assert.match(swift, /public func delayStatus\(stale: Bool\) -> String\?/);
  const re = new RegExp(swift.match(/range\(of: #"([^"]+)"#/)[1]);
  const { cardWarning } = await load('platform/tripCard.ts');
  // What the card says for a late leg, a timetable leg, a tight change and a missed change.
  assert.ok(re.test(cardWarning(null, null, null, '3 min late')));
  assert.ok(re.test(cardWarning(null, null, null, '12 min late')));
  assert.ok(!re.test(cardWarning(null, null, null, 'Timetable times, not live')));
  assert.ok(!re.test(cardWarning({ risk: 'tight', at: 'Central Station' }, null, null, '3 min late')));
  assert.ok(!re.test(cardWarning(null, null, 1793400000000, '3 min late')), 'with "Updated" the warning stays whole under the track');
  assert.match(swift, /return stopTrack\?\.live == true \? "On time" : nil/);
  assert.match(swift, /if arrived\(stale: stale\) \|\| outdated\(stale: stale\) \{ return nil \}/);
});

test('the native audit line check: probes in the views, off in the app, and a failing test when anything wraps or is cut', () => {
  const p = read('targets/widget/LineProbe.swift');
  assert.match(p, /nonisolated\(unsafe\) static var on = false/);
  assert.match(p, /if LineProbe\.on && !text\.isEmpty \{[\s\S]*\} else \{\s*content\s*\}/);
  const w = read(W);
  for (const id of ['island-countdown', 'island-stop', 'island-delay', 'lock-stop', 'lock-countdown', 'next-stop']) assert.ok(w.includes(`lineProbe("${id}"`), id);
  const f = read(F);
  for (const id of ['follow-island-countdown', 'follow-island-to', 'follow-lock-countdown', 'follow-lock-to']) assert.ok(f.includes(`lineProbe("${id}"`), id);
  // Countdowns may use one line.
  for (const m of (w + f).matchAll(/lineProbe\("([a-z-]*countdown)"[\s\S]{0,260}?lines: (\d)/g)) assert.equal(m[2], '1', m[1]);
  const dir = 'native-tests/native-audit/Tests';
  const t = read(`${dir}/iOS/WidgetAuditTests.swift`);
  assert.match(t, /LineCheck\.install\(\)\s*LiveActivityAudit\.run\(\)/);
  assert.match(t, /XCTAssertGreaterThan\(LineCheck\.probed, 100/);
  assert.match(t, /XCTAssertTrue\(cut\.isEmpty, "Wraps or cut/);
  assert.match(read(`${dir}/iOS/LineCheck.swift`), /l\.used > r\.allowed[\s\S]*l\.needed > r\.allowed/);
  // The shared kit has no widget code (the Watch audit compiles it too).
  assert.doesNotMatch(read(`${dir}/Shared/AuditKit.swift`), /LineProbe/);
  const a = read(`${dir}/iOS/LiveActivityAudit.swift`);
  for (const s of ['"owner-late"', '"owner-ontime"', '"one-stop"', '"hour"']) assert.ok(a.includes(s), s);
  assert.match(read('native-tests/native-audit/sheets.py'), /WRAPS\/CUT/);
});

test('very large text keeps names whole: the stop name alone, the next stop alone, short destinations', () => {
  const w = read(W);
  assert.match(w, /typeSize >= \.xxLarge \? state\.bareHeadline\(stale: stale\) : state\.headline\(stale: stale\)/);
  assert.equal((w.match(/typeSize >= \.xxLarge \? state\.bareHeadline\(stale: stale\)/g) || []).length, 2, 'Lock Screen and Island');
  assert.equal((w.match(/\.accessibilityLabel\(state\.headline\(stale: stale\)\)/g) || []).length, 2, 'VoiceOver reads the whole line');
  const s = read('targets/widget/LiveTripActivity.swift');
  assert.match(s, /public func bareHeadline\(stale: Bool = false\) -> String \{\s*if arrived\(stale: stale\) \{ return destination \?\? getOffAt \}\s*if phase == "wait" \{ return "To \\\(towards \?\? getOffAt\)" \}\s*return getOffAt/);
  // The Lock Screen countdown is only as wide as it needs, so the name gets the rest.
  assert.match(w, /\.frame\(maxWidth: 100, alignment: \.trailing\)\s*\/\/[^\n]*\n\s*\.fixedSize\(horizontal: true, vertical: false\)/);
  // The arrival time gives way before the next stop is cut.
  const footer = w.slice(w.indexOf('struct TrackFooter'), w.indexOf('struct StopTrackView'));
  assert.match(footer, /HStack\(spacing: 0\) \{ nextText\(n\)\.fixedSize\(\); Spacer\(minLength: 0\) \}/);
  const f = read(F);
  assert.match(f, /func shortTowards\(_ s: String\) -> String \{\s*guard s\.count > 28, let r = s\.range\(of: " via "\)/);
  const short = (x) => (x.length > 28 && x.includes(' via ') ? x.slice(0, x.indexOf(' via ')) : x);
  assert.equal(short('Macquarie University via Epping and North Ryde'), 'Macquarie University');
  assert.equal(short('Hornsby via Strathfield'), 'Hornsby via Strathfield', 'short ones keep their via');
});

test('at the largest text sizes a long stop name keeps the bar layouts, so it is never cut beside the track', () => {
  const w = read(W);
  assert.match(w, /private var showsTrack: Bool \{\s*guard state\.showsTrack\(stale: stale\) else \{ return false \}\s*return typeSize < \.xxLarge \|\| state\.bareHeadline\(stale: stale\)\.count <= 16/);
  assert.match(w, /if showsTrack \{\s*card\(lines: 2, track: true, merged: true\)/);
});

test('at the largest text sizes the stop name may take three lines on the bar card before it is cut', () => {
  const w = read(W);
  assert.match(w, /if typeSize >= \.xxLarge \{\s*card\(lines: 1, track: false, merged: true, headLines: 3, headScale: 0\.65\)\s*\}\s*card\(lines: 2, track: false\)/);
});
