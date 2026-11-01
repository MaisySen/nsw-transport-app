// Build 213 (1 Nov 2026). Bidur, 10:57 AM: "Dynamic island just showed time?? Not the stop name ?"; 11:04 AM:
// "Stop name.    Time" / "This is how it should be in dynamic island. It was like that before".
// Build 212's 15e0a8d put a bell before the stop name in the compact Island ("🔔 Croydon" in the 52 pt the Island gives),
// so the name was cut to "🔔 Syd..." or "🔔 ..." beside the time. These tests lock the compact Island to the stop name
// beside the time so it cannot regress again; the native audit draws it (trip-compact-leading, probe island-compact-stop).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); const j = s.indexOf(b, i + a.length); assert.ok(j > i, b); return s.slice(i, j); };

test('compact Island: leading is the stop name, never a bell or a bare badge while a stop is known', () => {
  const w = read('targets/widget/LiveTripActivityWidget.swift');
  const lead = between(w, 'struct LiveTripCompactLeading: View', 'struct IslandNameLine');
  assert.match(lead, /if let name = state\.compactPlace\(stale: stale\)/, 'the stop name first');
  assert.doesNotMatch(lead, /bell/, 'no bell beside the name (the 212 regression)');
  assert.doesNotMatch(lead, /compactStation/, 'no "Redfern:" colon');
  // the line badge only when the card names no stop
  assert.match(lead, /\} else \{\s*WidgetLineBadge\(/);
  // fits before it shrinks: one line, two short lines, smaller one line, then scaled with an audit probe
  const order = ['IslandName.split(name)', '.font(.caption.weight(.semibold)).lineLimit(1).fixedSize()', 'VStack(alignment: .leading, spacing: -1)',
    '.font(.caption2.weight(.semibold)).lineLimit(1).fixedSize()', 'IslandNameLine(text: p.0)', 'IslandNameLine(text: name)'];
  let at = -1;
  for (const o of order) { const i = lead.indexOf(o, at + 1); assert.ok(i > at, 'order: ' + o); at = i; }
  const line = between(w, 'struct IslandNameLine: View', 'enum IslandName');
  assert.match(line, /\.minimumScaleFactor\(0\.5\)\s*\.lineProbe\("island-compact-stop", text: text, lines: 1/);
  assert.match(lead, /\.frame\(maxWidth: 64, alignment: \.leading\)/, 'the system clock stays visible (28 Oct)');
  assert.match(lead, /accessibilityLabel\(state\.compactPlaceSpoken\(stale: stale\)\)/);
  assert.match(lead, /countdownWord\(stale: stale\) == "Now"/, 'Get off now shows the get off stop, in orange');
});

test('compact Island: trailing is the time or its word (Due, Now), minimal stays the time; expanded unchanged', () => {
  const w = read('targets/widget/LiveTripActivityWidget.swift');
  const tr = between(w, 'struct LiveTripCompactTrailing: View', 'struct LiveTripMinimal: View');
  assert.match(tr, /CompactCountdown\(date: state\.shownTarget\(stale: stale\)[^\n]*word: state\.countdownWord\(stale: stale\)/);
  const min = between(w, 'struct LiveTripMinimal: View', 'struct CompactCountdown');
  assert.match(min, /CompactCountdown\(/);
  const di = between(w, 'dynamicIsland: { context in', '.widgetURL(URL(string: "nswtransport://go"))');
  for (const r of ['LiveTripIslandLeading(state: s)', 'LiveTripIslandTrailing(state: s, stale: stale)', 'LiveTripIslandCenter(state: s, stale: stale)',
    'LiveTripIslandBottom(state: s, stale: stale)', 'LiveTripCompactLeading(state: s, stale: stale)', 'LiveTripCompactTrailing(state: s, stale: stale)', 'LiveTripMinimal(state: s, stale: stale)'])
    assert.ok(di.includes(r), r);
});

test('compact Island stop: waiting the boarding stop, on board and at Get off now the stop off, arrived where you are', () => {
  const s = read('targets/widget/LiveTripActivity.swift');
  const f = between(s, 'public func compactPlace(stale: Bool) -> String?', 'public func compactPlaceSpoken');
  assert.match(f, /if phase == "wait" && !arrived\(stale: stale\) \{ raw = nextStop \} else \{ raw = getOffAt \}/);
  assert.match(f, /Naming\.compact\(Naming\.short\(r\)\)/, 'drops ", Stand A" and " Station"');
  assert.match(f, /return n\.isEmpty \? nil : n/);
  const sp = between(s, 'public func compactPlaceSpoken(stale: Bool) -> String', '\n    }\n');
  for (const words of ['Arrived at', 'Board at', 'Get off at']) assert.ok(sp.includes(words), words);
  // the card's next stop while waiting is the boarding stop (tripCard.ts), so the Island has it from 212's cards too
  const tc = read('platform/tripCard.ts');
  assert.match(tc, /nextStop: s\.phase === 'wait' \? shortName\(l\.from\) \|\| null/);
});

test('compact Island: the two line split puts the break nearest the middle', () => {
  const w = read('targets/widget/LiveTripActivityWidget.swift');
  const sp = between(w, 'enum IslandName', '\n}\n');
  assert.match(sp, /guard words\.count >= 2 else \{ return nil \}/);
  // JS mirror of the Swift rule, so the expected splits are checked here
  const split = (s) => { const ws = s.split(' ').filter(Boolean); if (ws.length < 2) return null; let best = 1, bd = Infinity;
    for (let i = 1; i < ws.length; i++) { const a = ws.slice(0, i).join(' ').length, b = ws.slice(i).join(' ').length; if (Math.abs(a - b) < bd) { bd = Math.abs(a - b); best = i; } }
    return [ws.slice(0, best).join(' '), ws.slice(best).join(' ')]; };
  assert.deepEqual(split('Kings Cross'), ['Kings', 'Cross']);
  assert.deepEqual(split('Macquarie University'), ['Macquarie', 'University']);
  assert.deepEqual(split('Parramatta Rd opp Sydney Uni'), ['Parramatta Rd', 'opp Sydney Uni']);
  assert.equal(split('Strathfield'), null);
});

test('the native audit draws the compact Island for every scenario on both Island phones', () => {
  const a = read('native-tests/native-audit/Tests/iOS/LiveActivityAudit.swift');
  assert.match(a, /region\(LiveTripCompactLeading\(state: st, stale: stale\), surface: "trip-compact-leading"/);
  assert.match(a, /region\(LiveTripCompactTrailing\(state: st, stale: stale\), surface: "trip-compact-trailing"/);
  assert.match(a, /region\(LiveTripMinimal\(state: st, stale: stale\), surface: "trip-minimal"/);
});
