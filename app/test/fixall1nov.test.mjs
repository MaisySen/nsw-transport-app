// Fix-all 1 Nov 2026 (known issues sweep, files/day-1nov/known-issues.md): old live times never move a trip on by the
// clock on the Apple Watch (A1, known since build 212) or on the iPhone "Your trip" widget (A2, found in the sweep).
// Spec 2.4 and R-A: Get off now only from a reading under 2 min old, the arrival only from evidence; with old data the
// trip holds its phase and says "about", then the timetable time. The Watch said "Get off now", "Arrived" and "Due" and
// tapped "arrived" from old data (a held train with the phone locked). WatchCore.swift and TripMoments.swift import
// SwiftUI / Foundation only in the parts compiled here, so the moment rules are compiled with swiftc and run on a grid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '..');
const read = (rel) => fs.readFileSync(path.join(app, rel), 'utf8');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-fixall1nov-'));
const CORE = read('targets/watch/WatchCore.swift');
const MOM = read('targets/widget/TripMoments.swift');
const WIDGETS = read('targets/widget/TransportWidgets.swift');
const WAPP = read('targets/watch/TransportWatchApp.swift');

function which(cmd) {
  try { return execFileSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}
const swiftc = process.env.WIDGET_NATIVE_CHECK === '0' ? null : which('swiftc');
const lines = (text) => text.trim().split('\n').map((l) => JSON.parse(l));

// The cases, in seconds from "now" (1 Nov 2026, 12:00pm Sydney). age: how old the card's live times are.
const CASES = [
  { id: 'fresh-getoff', phase: 'ride', age: 30, off: 10 },
  { id: 'old-getoff', phase: 'ride', age: 180, off: 10 },
  { id: 'old-arrived', phase: 'ride', age: 180, off: -20 },
  { id: 'nodata-getoff', phase: 'ride', age: 360, off: 10, delay: 3 },
  { id: 'nodata-next', phase: 'ride', age: 360, off: 100 },
  { id: 'fresh-due', phase: 'wait', age: 30, dep: 20, off: 900 },
  { id: 'old-wait', phase: 'wait', age: 300, dep: -30, off: 900 },
  { id: 'old-left', phase: 'wait', age: 180, dep: -120, off: 900 },
  { id: 'timeline', phase: 'ride', age: 60, off: 150 },
  { id: 'getoff-then-old', phase: 'ride', age: 150, off: -10 },
  { id: 'arrived-by-phone', phase: 'arrived', age: 400, off: -60 },
  { id: 'no-updated', phase: 'ride', age: null, off: 10 },
];

function watchProgram() {
  const a = CORE.indexOf('enum Clock {');
  const b = CORE.indexOf('extension Color {');
  const c = CORE.indexOf('// MARK: The moments of a started trip');
  assert.ok(a > 0 && b > a && c > b, 'WatchCore sections found');
  const cases = CASES.map((k) => `(${JSON.stringify(k.id)}, ${JSON.stringify(k.phase)}, ${k.age == null ? 'nil' : `now.addingTimeInterval(${-k.age})`}, ${k.dep == null ? 'nil' : `now.addingTimeInterval(${k.dep})`}, now.addingTimeInterval(${k.off}), ${k.delay ?? 'nil'})`).join(',\n  ');
  return `import Foundation
struct WLiveCard {
    var phase: String
    var getOffAt: String
    var destination: String?
    var nextStop: String?
    var platform: String?
    var departs: Double?
    var legArrives: Double?
    var arrival: Double
    var updated: Double?
    var delayMin: Int?
    var getOffTime: Date { Date(timeIntervalSince1970: (legArrives ?? arrival) / 1000) }
    var updatedAt: Date? { updated.map { Date(timeIntervalSince1970: $0 / 1000) } }
}
${CORE.slice(a, b)}
${CORE.slice(c)}
let now = ISO8601DateFormatter().date(from: "2026-11-01T01:00:00Z")!
let cases: [(String, String, Date?, Date?, Date, Int?)] = [
  ${cases}
]
for (id, phase, upd, dep, off, delay) in cases {
    let card = WLiveCard(phase: phase, getOffAt: "Wollongong Station", destination: "Wollongong Station", nextStop: "North Wollongong Station",
                         platform: "2", departs: dep.map { $0.timeIntervalSince1970 * 1000 }, legArrives: off.timeIntervalSince1970 * 1000,
                         arrival: off.timeIntervalSince1970 * 1000, updated: upd.map { $0.timeIntervalSince1970 * 1000 }, delayMin: delay)
    let l = WTripMoments.list(card, now: now)
    let kinds = l.map { "\\"" + $0.kind.rawValue + "\\"" }.joined(separator: ",")
    let ats = l.map { String(Int($0.at.timeIntervalSince(now).rounded())) }.joined(separator: ",")
    let big = WTripMoments.big(card, l[0], at: now)
    let detail = WTripMoments.detail(card, l[0], at: now) ?? ""
    print("{\\"id\\":\\"\\(id)\\",\\"kinds\\":[\\(kinds)],\\"ats\\":[\\(ats)],\\"big\\":\\"\\(big)\\",\\"detail\\":\\"\\(detail)\\"}")
}
`;
}

function widgetProgram() {
  const cases = CASES.map((k) => `(${JSON.stringify(k.id)}, ${JSON.stringify(k.phase)}, ${k.age == null ? 'nil' : `now.addingTimeInterval(${-k.age})`}, ${k.dep == null ? 'nil' : `now.addingTimeInterval(${k.dep})`}, now.addingTimeInterval(${k.off}))`).join(',\n  ');
  return `import Foundation
${MOM}
let now = ISO8601DateFormatter().date(from: "2026-11-01T01:00:00Z")!
let cases: [(String, String, Date?, Date?, Date)] = [
  ${cases}
]
for (id, phase, upd, dep, off) in cases {
    let l = TripMoments.list(phase: phase, departs: dep, legArrives: off, arrival: off, now: now, updated: upd)
    let kinds = l.map { "\\"" + $0.kind.rawValue + "\\"" }.joined(separator: ",")
    let ats = l.map { String(Int($0.at.timeIntervalSince(now).rounded())) }.joined(separator: ",")
    print("{\\"id\\":\\"\\(id)\\",\\"kinds\\":[\\(kinds)],\\"ats\\":[\\(ats)]}")
}
`;
}

function run(name, src) {
  const f = path.join(out, `${name}.swift`);
  fs.writeFileSync(f, src);
  const bin = path.join(out, name);
  execFileSync(swiftc, [f, '-o', bin], { stdio: 'pipe', timeout: 280000 });
  // kinds: the moments with a held repeat folded into the one before it (a held moment is the same moment carried on, as a
  // new entry so a complication's timer stops there); raw: as listed.
  return Object.fromEntries(lines(execFileSync(bin, { encoding: 'utf8', timeout: 20000 })).map((r) => {
    const keep = r.kinds.map((k, i) => i === 0 || k !== r.kinds[i - 1]);
    return [r.id, { ...r, raw: r.kinds, rawAts: r.ats, kinds: r.kinds.filter((_, i) => keep[i]), ats: r.ats.filter((_, i) => keep[i]) }];
  }));
}

// What both surfaces must do (the same moments, R-E).
function checkKinds(R, who) {
  assert.deepEqual(R['fresh-getoff'].kinds.slice(0, 1), ['getOff'], `${who}: fresh data, 10 s out: Get off now as before`);
  assert.equal(R['old-getoff'].kinds[0], 'next', `${who}: 3 min old data: the stop with "about", never Get off now`);
  assert.equal(R['old-arrived'].kinds[0], 'next', `${who}: 3 min old data past the arrival time: never Arrived by the clock`);
  assert.deepEqual(R['nodata-getoff'].kinds, ['next'], `${who}: 6 min old data: your stop with the timetable time, no Get off now or Arrived`);
  assert.equal(R['fresh-due'].kinds[0], 'due', `${who}: fresh data 20 s before leaving: Due as before`);
  assert.equal(R['old-wait'].kinds[0], 'wait', `${who}: data already old when Due would start: still waiting, never Due`);
  assert.ok(!R['old-wait'].kinds.includes('due'), `${who}: no Due ahead from old data`);
  assert.deepEqual(R['timeline'].kinds, ['ride', 'next'], `${who}: the timeline never reaches Get off now or Arrived once the data is old`);
  assert.deepEqual(R['timeline'].ats, [0, 30], `${who}: the stop at 2 min out, then it holds`);
  assert.deepEqual(R['getoff-then-old'].kinds, ['getOff'], `${who}: Get off now reached on fresh data stays (as the phone's phase), never Arrived from old data, never steps back`);
  assert.deepEqual(R['arrived-by-phone'].kinds, ['arrived'], `${who}: an arrival the phone sent is evidence and stays`);
  // the held moment is listed again where Get off now and Arrived would have been, so the complication's countdown stops
  // there instead of counting past the stop (Text(.timer) counts up past its date)
  assert.deepEqual(R['timeline'].raw, ['ride', 'next', 'next', 'next'], `${who}: held entries at the old Get off now and arrival times`);
  assert.deepEqual(R['timeline'].rawAts, [0, 30, 120, 150], `${who}: at 30 s before and at the arrival`);
  assert.equal(R['no-updated'].kinds[0], 'getOff', `${who}: a card with no data time (older phones) keeps the clock moments`);
  for (const [id, r] of Object.entries(R)) {
    if (id === 'arrived-by-phone' || id === 'no-updated' || id.startsWith('fresh')) continue;
    if (id === 'getoff-then-old') continue; // reached on fresh data, checked above
    assert.ok(!r.kinds.includes('getOff') && !r.kinds.includes('arrived') && !r.kinds.includes('due'), `${who} ${id}: no Get off now, Arrived or Due from old data anywhere ahead (${r.kinds})`);
  }
}

test('Apple Watch: old live times never say Get off now, Arrived or Due (A1)', { skip: swiftc ? false : 'no swiftc on this machine', timeout: 300000 }, () => {
  const R = run('watchmoments', watchProgram());
  checkKinds(R, 'watch');
  assert.equal(R['fresh-getoff'].big, 'Get off now');
  assert.match(R['fresh-getoff'].detail, /^Arriving \d/, 'audit review: the stop is on the line above, the detail says when');
  assert.match(R['old-getoff'].big, /^About \d/, 'the stop time with about');
  assert.match(R['old-getoff'].detail, /^Updated /);
  assert.match(R['old-arrived'].big, /^About \d/);
  assert.match(R['nodata-getoff'].big, /^11:57am$|^11:57$/, 'from 5 min the timetable time (live 12:00pm less the 3 min delay), no about');
  assert.match(R['nodata-getoff'].detail, /^No live data since /);
  assert.match(R['old-wait'].big, /^\d{1,2}:\d\d(am|pm)?$/, 'waiting with 5 min old data: the timetable time');
  assert.equal(R['getoff-then-old'].big.startsWith('About '), true, 'Get off now reached on fresh data says about once the data is old (as the Lock Screen card)');
  assert.match(R['nodata-next'].big, /^\d{1,2}:\d\d(am|pm)?$/);
  assert.equal(R['fresh-due'].big, 'Due');
});

test('iPhone "Your trip" widget: old live times never say Get off now, Arrived or Due (A2)', { skip: swiftc ? false : 'no swiftc on this machine', timeout: 300000 }, () => {
  checkKinds(run('widgetmoments', widgetProgram()), 'widget');
  assert.match(WIDGETS, /now: now,\s*updated: c\.updatedDate\)/, 'the widget timeline passes the card\'s data time');
});

test('the Watch and the widget hold with the same rule, the wrist taps follow it (no arrived tap from old data)', () => {
  assert.equal(CORE, read('targets/watch-widget/WatchCore.swift'), 'the two WatchCore copies are the same file');
  const body = (src) => { const i = src.indexOf('static func holdWhenOld('); return src.slice(src.indexOf('{', i), src.indexOf('\n    }\n', i)); };
  const norm = (s) => s.replace(/WTripKind|TripMomentKind/g, 'K').replace(/WTripMoment|TripMoment/g, 'M').replace(/ageStep\(c, at: m\.at\)|ageStep\(updated: u, at: m\.at\)/g, 'AGE')
    .replace(/guard [^\n]*\n/, '').replace(/\s+/g, ' ');
  assert.equal(norm(body(CORE)), norm(body(MOM)), 'one rule on the Watch and the widget');
  assert.match(CORE, /sorted = holdWhenOld\(sorted, c, departs: /);
  assert.match(MOM, /sorted = holdWhenOld\(sorted, updated: updated, departs: departs, off: off\)/);
  assert.match(WIDGETS, /if step >= 1 \{ status = step >= 2 \? "Timetable" : "Due about"; word = nil \}/, 'widget: Due with old data says about');
  assert.match(WIDGETS, /if step >= 1 \{ status = "Get off about"; word = nil \}/, 'widget: Get off now with old data says about');
  const tick = WAPP.slice(WAPP.indexOf('let m = WTripMoments.list(l, now: t)[0]'));
  assert.match(tick.slice(0, 900), /case \.arrived:/, 'the arrived tap comes from the held moments');
});

test('the browser checks no longer look for the removed "Wake me before my stop" switch (A5, native-asks 13)', () => {
  for (const f of ['test/e2e/buttons.mjs', 'test/e2e/live-replay.mjs']) {
    assert.doesNotMatch(read(f), /getByRole\("switch", \{ name: "Wake me before my stop" \}\)/, f);
  }
});

test('Watch complications: commute times over 5 min old show the clock time and "Updated", never a countdown (A6, found in the sweep)', () => {
  // The complication reloads every 20 to 60 min, so one load's live countdowns ran up to an hour past the 5 min live cap
  // (R2), with "then 9:55am" and no age. Now each entry is old or not at its own time, split where it turns old.
  const COMP = read('targets/watch-widget/Complications.swift');
  const ent = COMP.slice(COMP.indexOf('static func entries('), COMP.indexOf('struct NextView'));
  assert.doesNotMatch(ent, /let stale = snapshot\.commuteAt\.map \{ now\.timeIntervalSince/, 'old is no longer worked out once, at load');
  assert.match(ent, /let oldFrom = snapshot\.commuteAt\.map \{ \$0\.addingTimeInterval\(5 \* 60\) \}/);
  assert.match(ent, /if oldFrom > start && oldFrom < s\.time \{ starts\.append\(oldFrom\) \}/, 'split where it turns old');
  assert.match(ent, /if old, let u = snapshot\.commuteAt \{ detail = "Updated \\\(Clock\.hhmm\(u\)\)" \}/);
  assert.match(COMP, /\(old \? Text\(Clock\.hhmm\(t\)\) : Text\(t, style: \.timer\)\.monospacedDigit\(\)\)/, 'rectangular and inline: clock time');
  assert.match(COMP, /if let r = entry\.ringRange, let t = entry\.target, !entry\.old \{/, 'circular: no ring countdown');
  assert.match(COMP, /\} else if entry\.old, let t = entry\.target \{/, 'circular: the line and the clock time, not a bare icon (audit review)');
  assert.match(COMP, /if let t = entry\.target, entry\.old \{/, 'corner: clock time');
  assert.match(read('native-tests/native-audit/Tests/Watch/WatchAuditTests.swift'), /\("commute-old", NextEntry\(/, 'the native audit draws it');
});

test('iPhone Your trip circular widget: an old clock time drops am/pm so it is not cut (A8, found in the audit review)', () => {
  const w = read('targets/widget/TransportWidgets.swift');
  const circ = w.slice(w.indexOf('private var circular: some View'), w.indexOf('private var rectangular: some View'));
  assert.match(circ, /Text\(t\.waitWord\.map \{ \$0\.replacingOccurrences\(of: "am", with: ""\)\.replacingOccurrences\(of: "pm", with: ""\) \}/);
  assert.match(circ, /\.dynamicTypeSize\(\.\.\.DynamicTypeSize\.xLarge\)/, 'stops growing in the fixed circle (cut at xxxLarge in the audit)');
});

test('Watch circular complication: an hour or more away shows the clock time, not a timer over two lines (A9, audit review)', () => {
  const COMP = read('targets/watch-widget/Complications.swift');
  const circ = COMP.slice(COMP.indexOf('private var circular: some View'), COMP.indexOf('private var corner: some View'));
  assert.match(circ, /if t\.timeIntervalSince\(entry\.date\) >= 3600 \{\s*Text\(Clock\.hhmm\(t\)\)/);
});
