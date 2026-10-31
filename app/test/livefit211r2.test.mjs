// Build 211 round 2 (31 Oct): three things the first 211 candidate (97b2d03) still drew wrong, read off its audit
// pictures beside the owner's build 210 iPhone, and the audit checks that now catch them.
// 1) The expanded Island countdown sat flush with the right edge, into the rounded corner: now 4 pt in, like the badge
//    on the left, and the audit fails ink within 8 pt of the Island's rounded outline (margins as on his iPhone).
// 2) The Island title wrapped ("Get off at / Croydon") in every shot: now one line, smaller or the stop alone.
// 3) The Lock Screen title wrapped beside a long countdown ("Get off at / Macarthur" beside "1 hr, 4 min"): one line.
// The Swift is checked here as text (no SwiftUI on this box); the native audit renders it on the simulator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const W = 'targets/widget/LiveTripActivityWidget.swift';
const F = 'targets/widget/TripLiveActivity.swift';
const A = 'native-tests/native-audit/Tests/iOS';
const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a) + a.length));

test('titles are one line on the Lock Screen and in the Island, for both Live Activities', () => {
  const w = read(W);
  const title = between(w, 'struct LiveTripTitle: View', 'struct LiveTripCompactLeading');
  assert.ok(title.length > 200, 'LiveTripTitle found');
  assert.doesNotMatch(title, /lineLimit\((?!1\))/, 'every line of the title is lineLimit(1)');
  assert.doesNotMatch(title, /lines: [2-9]/);
  // The whole title, then smaller, then the stop after its symbol, then the stop shrinking and cut at its end.
  const order = ['line(full, font)', 'line(full, smaller)', 'Image(systemName: symbol)', '.minimumScaleFactor(minScale)', '.truncationMode(.tail)'];
  let at = -1;
  for (const o of order) { const i = title.indexOf(o); assert.ok(i > at, `${o} out of order`); at = i; }
  const center = between(w, 'struct LiveTripIslandCenter: View', 'struct LiveTripTitle');
  assert.match(center, /probe: "island-stop"/);
  assert.match(center, /smaller: \.footnote\.weight\(\.semibold\)/);
  assert.match(center, /"bell\.fill"/, 'the bell the stop track uses for the stop off');
  assert.doesNotMatch(center, /lineLimit\(2\)/);
  const lock = w.slice(w.indexOf('struct LiveTripLockCard'));
  assert.match(lock, /LiveTripTitle\(full: state\.headline\(stale: stale\), bare: state\.bareHeadline\(stale: stale\),\s*probe: "lock-stop"/);
  assert.doesNotMatch(lock, /headLines|headMax/, 'no layout gives the title more lines');
  const f = read(F);
  for (const id of ['follow-island-to', 'follow-lock-to']) assert.match(f, new RegExp(`lineProbe\\("${id}"[^\\n]*lines: 1`), id);
  assert.doesNotMatch(f, /towardsLines/);
});

test('the expanded Island countdown keeps the same inset from the right edge as the badge keeps from the left', () => {
  const w = read(W);
  const tr = between(w, 'struct LiveTripIslandTrailing: View', 'func delayColor');
  assert.match(tr, /\.padding\(\.trailing, 4\)\s*\.frame\(minWidth: 80, maxWidth: 104, alignment: \.trailing\)/);
  assert.match(between(w, 'struct LiveTripIslandLeading: View', 'struct LiveTripIslandTrailing'), /\.padding\(\.leading, 4\)/);
  const f = read(F);
  assert.match(between(f, 'struct IslandTrailing: View', 'struct IslandCenter'), /\.padding\(\.trailing, 4\)\s*\.frame\(minWidth: 80, maxWidth: 104, alignment: \.trailing\)/);
  assert.match(between(f, 'struct IslandLeading: View', 'struct IslandTrailing'), /\.padding\(\.leading, 4\)/);
});

test('the audit holds titles to one line and checks the Island edge on every expanded shot', () => {
  const lc = read(`${A}/LineCheck.swift`);
  assert.match(lc, /static let titles: Set<String> = \["island-stop", "lock-stop", "follow-island-to", "follow-lock-to"\]/);
  assert.match(lc, /titles\.contains\(r\.id\) \? min\(r\.allowed, 1\) : r\.allowed/);
  const e = read(`${A}/IslandEdge.swift`);
  assert.match(e, /static let inset = EdgeInsets\(top: 16, leading: 18, bottom: 8, trailing: 18\)/);
  assert.match(e, /static let corner: CGFloat = 44/);
  assert.match(e, /static let clearance: CGFloat = 8/);
  assert.match(e, /if nearest < clearance/);
  assert.match(e, /right \+ 0\.5 < left/);
  const la = read(`${A}/LiveActivityAudit.swift`);
  assert.match(la, /IslandPill\(content: layout[^\n]*inset: IslandEdge\.inset\)/);
  assert.match(la, /IslandEdge\.check\(layout: layout, leading: l, trailing: tr, box: inner, side: side, type: t\.1\)/);
  assert.match(la, /Audit\.records\[i\]\.lines = \(Audit\.records\[i\]\.lines \?\? \[\]\) \+ fails/);
  const t = read(`${A}/WidgetAuditTests.swift`);
  assert.match(t, /XCTAssertGreaterThan\(IslandEdge\.checked, 40/);
  assert.match(t, /XCTAssertTrue\(cut\.isEmpty, "Wraps or cut, or too close to the Island's edge/);
});

// The corner arithmetic of IslandEdge.distance, worked through for the countdown's top right ink: flush with the
// region (97b2d03) in the old picture margins (10 pt sides, 6 pt top) it is past the curve; 4 pt in, with the margins
// measured on the owner's iPhone, it is clear by more than the 8 pt asked.
function distance(x, y, W, H, r = 44) {
  const cx = x < r ? r : x > W - r ? W - r : null;
  const cy = y < r ? r : y > H - r ? H - r : null;
  if (cx !== null && cy !== null) return r - Math.hypot(x - cx, y - cy);
  return Math.min(x, W - x, y, H - y);
}
test('the corner distance: flush ink in the old margins fails, 4 pt in with the phone margins passes', () => {
  const w = 335, h = 136, glyphTop = 4; // 6.1 inch expanded content box; title3 ink starts about 4 pt below its line top
  const old = distance(10 + w, 6 + glyphTop, w + 20, h + 12);
  assert.ok(old < 0, `old picture: ${old.toFixed(1)} pt, outside the curve`);
  const now = distance(18 + w - 4, 16 + glyphTop, w + 36, h + 24);
  assert.ok(now >= 8, `round 2: ${now.toFixed(1)} pt`);
  assert.equal(distance(100, 80, w + 36, h + 24), 80, 'away from the corners it is the nearest straight edge');
});
