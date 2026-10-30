// Widgets and the Watch refresh on their own (30 Oct, build 210). Bidur on build 209: the widgets, and the Apple Watch,
// changed only after the app was opened. Causes: every widget asked iOS for a new timeline every 5 to 15 minutes day
// and night (96 to 288 a day, past WidgetKit's 40 to 70), its timeline ended after 20 minutes (15 on the stop board)
// so a late reload froze it, and the Watch complications never loaded anything (only the watch app did, on screen).
// The rules are targets/widget/WidgetRefresh.swift and WatchRefresh in targets/watch/WatchCore.swift. This file
// compiles them with swiftc when it is on the machine (skipped otherwise) and checks the code uses them.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-widgetrefresh-'));
const REFRESH = read('targets/widget/WidgetRefresh.swift');
const TEXT = read('targets/widget/WidgetText.swift');
const WIDGETS = read('targets/widget/TransportWidgets.swift');
const API = read('targets/widget/APIClient.swift');
const CORE = read('targets/watch/WatchCore.swift');
const COMP = read('targets/watch-widget/Complications.swift');
const WAPP = read('targets/watch/TransportWatchApp.swift');
const BRIDGE = read('platform/iosBridge.ts');

function which(cmd) {
  try { return execFileSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}
const swiftc = process.env.WIDGET_NATIVE_CHECK === '0' ? null : which('swiftc');
const lines = (text) => text.trim().split('\n').map((l) => JSON.parse(l));

test('iPhone widgets: reload rule by time of day, inside the daily budget, and an hour of entries', { skip: swiftc ? false : 'no swiftc on this machine', timeout: 300000 }, () => {
  const bin = path.join(out, 'widgetrefresh');
  execFileSync(swiftc, [path.join(app, 'targets/widget/WidgetRefresh.swift'), path.join(here, 'swift/widgetrefresh/main.swift'), '-o', bin], { stdio: 'pipe', timeout: 280000 });
  const rows = lines(execFileSync(bin, { encoding: 'utf8', timeout: 20000 }));
  const get = (kind, c) => rows.find((r) => r.kind === kind && r.case === c)?.v;
  assert.equal(get('band', 'fri0200'), 'night');
  assert.equal(get('band', 'fri0715'), 'busy');
  assert.equal(get('band', 'fri1100'), 'day');
  assert.equal(get('band', 'fri1700'), 'busy');
  assert.equal(get('band', 'fri2200'), 'evening');
  assert.equal(get('band', 'sat0815'), 'day', 'no peak at the weekend');
  assert.equal(get('band', 'fri0020'), 'evening');
  assert.equal(get('band', 'fri0929'), 'busy');
  assert.equal(get('band', 'fri0930'), 'day');
  assert.equal(get('next', 'fri0715'), 900);
  assert.equal(get('next', 'fri1100'), 1200);
  assert.equal(get('next', 'fri2200'), 1800);
  assert.ok(get('next', 'fri0200') >= 2400, 'overnight, rarely');
  assert.equal(get('empty', 'fri0200'), 3600);
  for (const c of ['fri0715', 'fri1100', 'fri2200', 'sat0815']) {
    assert.equal(get('failed', c), 900, `${c}: offline tries again in 15 min`);
    assert.ok(get('short', c) >= 300, `${c}: never sooner than 5 min outside a trip`);
    assert.equal(get('live', c), 130, `${c}: a trip in progress reloads at its next step`);
    assert.equal(get('liveNow', c), 60, `${c}: never sooner than a minute`);
  }
  assert.ok(get('short', 'fri2200') >= 600, 'quiet hours never sooner than 10 min');
  const perDay = Object.fromEntries(rows.filter((r) => r.kind === 'perDay').map((r) => [r.case, r.v]));
  assert.ok(perDay.weekday <= 70 && perDay.weekday >= 50, `weekday asks ${perDay.weekday}`);
  assert.ok(perDay.saturday <= 70, `weekend asks ${perDay.saturday}`);
  const e = rows.find((r) => r.kind === 'entries');
  assert.equal(e.first, 0);
  assert.equal(e.last, 3540, 'an entry a minute for an hour');
  assert.equal(e.hasDeparture, true);
  assert.equal(e.pastHorizon, false);
});

test('Apple Watch: refresh clock inside the complication budget', { skip: swiftc ? false : 'no swiftc on this machine', timeout: 300000 }, () => {
  // WatchCore imports SwiftUI, so only the WatchRefresh clock is compiled here, with the two types it reads.
  const start = CORE.indexOf('enum WatchRefresh {');
  const stop = CORE.indexOf('    /// Loads the commute', start);
  assert.ok(start > 0 && stop > start);
  const src = `import Foundation
enum Clock { static let sydney = TimeZone(identifier: "Australia/Sydney")! }
struct WService { var time: Date }
struct WatchSnapshot { var commuteKey: String?; var commute: [WService] = []; var commuteAt: Date?
  static func upcoming(_ s: [WService], now: Date) -> [WService] { s.filter { $0.time > now.addingTimeInterval(-30) } } }
${CORE.slice(start, stop)}}
let iso = ISO8601DateFormatter()
var t = iso.date(from: "2026-10-29T13:00:00Z")!
for day in ["weekday", "saturday"] { var n = 0; let end = t.addingTimeInterval(86400); while t < end { t = WatchRefresh.next(t); n += 1 }; print("{\\"kind\\":\\"perDay\\",\\"case\\":\\"\\(day)\\",\\"v\\":\\(n)}") }
let noon = iso.date(from: "2026-10-30T01:00:00Z")!
print("{\\"kind\\":\\"live\\",\\"v\\":\\(Int(WatchRefresh.next(noon, live: true).timeIntervalSince(noon)))}")
print("{\\"kind\\":\\"failed\\",\\"v\\":\\(Int(WatchRefresh.next(noon, failed: true).timeIntervalSince(noon)))}")
var s = WatchSnapshot(commuteKey: "a>b", commute: [WService(time: noon.addingTimeInterval(200)), WService(time: noon.addingTimeInterval(500))], commuteAt: noon.addingTimeInterval(-60))
print("{\\"kind\\":\\"stale\\",\\"fresh\\":\\(WatchRefresh.commuteStale(s, key: "a>b", now: noon)),\\"turned\\":\\(WatchRefresh.commuteStale(s, key: "b>a", now: noon))}")
s.commuteAt = noon.addingTimeInterval(-300)
print("{\\"kind\\":\\"old\\",\\"v\\":\\(WatchRefresh.commuteStale(s, key: "a>b", now: noon))}")
`;
  const f = path.join(out, 'watchrefresh.swift');
  fs.writeFileSync(f, src);
  const bin = path.join(out, 'watchrefresh');
  execFileSync(swiftc, [f, '-o', bin], { stdio: 'pipe', timeout: 280000 });
  const rows = lines(execFileSync(bin, { encoding: 'utf8', timeout: 20000 }));
  const perDay = Object.fromEntries(rows.filter((r) => r.kind === 'perDay').map((r) => [r.case, r.v]));
  assert.ok(perDay.weekday <= 50, `watch weekday reloads ${perDay.weekday}`);
  assert.ok(perDay.saturday <= 50, `watch weekend reloads ${perDay.saturday}`);
  assert.equal(rows.find((r) => r.kind === 'live').v, 300);
  assert.equal(rows.find((r) => r.kind === 'failed').v, 900);
  const st = rows.find((r) => r.kind === 'stale');
  assert.equal(st.fresh, false, 'loaded a minute ago: used as it is');
  assert.equal(st.turned, true, 'the commute turned round: load');
  assert.equal(rows.find((r) => r.kind === 'old').v, true, '5 minutes old: load');
});

test('iPhone widgets use the rule: an hour of entries on both widgets, reload by WidgetRefresh, offline sooner', () => {
  assert.match(TEXT, /public static func entryDates\(updated: Date, departures: \[Date\], minutes: Int = 60\)/);
  assert.match(TEXT, /WidgetRefresh\.next\(updated: updated, departures: departures, live: live, failed: failed\)/);
  assert.match(WIDGETS, /policy: \.after\(WidgetText\.reloadDate\(updated: e\.updated, departures: e\.trips\.map\(\\\.leave\), live: e\.live, failed: e\.failed\)\)/);
  assert.match(WIDGETS, /policy: \.after\(WidgetText\.reloadDate\(updated: e\.updated, departures: e\.rows\.map\(\\\.time\), failed: e\.failed\)\)/);
  assert.match(WIDGETS, /let entries = WidgetText\.entryDates\(updated: e\.updated, departures: e\.rows\.map\(\\\.time\)\)/);
  assert.doesNotMatch(WIDGETS, /\(0\.\.<15\)\.map/, 'the stop board no longer stops after 15 minutes');
  assert.equal((WIDGETS.match(/e\.failed = true/g) || []).length, 3, 'two trip offline paths and the board');
  assert.match(REFRESH, /horizon: TimeInterval = 60 \* 60/);
  assert.doesNotMatch(REFRESH, /Timer|DispatchQueue|asyncAfter/, 'no timer');
});

test('iPhone widgets: the fetch waits 8 s once in the widget, and an offline board is never live', () => {
  assert.match(API, /static let inWidget = Bundle\.main\.bundlePath\.hasSuffix\("\.appex"\)/);
  assert.match(API, /req\.timeoutInterval = Self\.inWidget \? WidgetRefresh\.fetchTimeout : 12/);
  assert.match(API, /retry: method == "GET" && !Self\.inWidget/);
  assert.match(REFRESH, /fetchTimeout: TimeInterval = 8/);
  const off = WIDGETS.slice(WIDGETS.indexOf('static func offline(_ rows: [BoardRow]'));
  assert.match(off, /if r\.isLive, let t = r\.timetable \{ x\.time = t \}/);
  assert.match(off, /x\.isLive = false/);
  assert.match(off, /\.filter \{ \$0\.time > now \}/);
  assert.match(WIDGETS, /BoardCache\.save\(Array\(rows\.prefix\(10\)\), stop: stop\.id, filter: filter, at: now\)/);
  assert.match(WIDGETS, /struct BoardRow: Hashable, Codable \{/);
});

test('Apple Watch: complications load the commute themselves, the app refreshes in the background', () => {
  assert.equal(read('targets/watch/WatchCore.swift'), read('targets/watch-widget/WatchCore.swift'));
  assert.doesNotMatch(COMP, /never load anything/);
  assert.match(COMP, /WatchRefresh\.commuteStale\(snap, key: m\.key, now: now\)/);
  assert.match(COMP, /await WatchRefresh\.load\(c, into: snap, stops: false, now: now\)/);
  assert.match(COMP, /policy: \.after\(WatchRefresh\.next\(now, live: live, failed: failed\)\)/);
  assert.match(WAPP, /@WKApplicationDelegateAdaptor\(WatchAppDelegate\.self\)/);
  assert.match(WAPP, /final class WatchAppDelegate: NSObject, WKApplicationDelegate/);
  assert.match(WAPP, /task as\? WKApplicationRefreshBackgroundTask/);
  assert.match(WAPP, /setTaskCompletedWithSnapshot\(false\)/);
  assert.match(WAPP, /scheduleBackgroundRefresh\(withPreferredDate: at, userInfo: nil\)/);
  assert.match(WAPP, /await WatchRefresh\.load\(c, into: self\.snapshot, stops: true\)/);
  // Kept times count as fresh for 4 minutes, so the app and the complications never load twice.
  assert.match(CORE, /static let fresh: TimeInterval = 4 \* 60/);
});

test('app: leaving the app reloads the widgets once, only when the last reload is over 2 minutes old', () => {
  assert.match(BRIDGE, /const WIDGET_LEAVE_RELOAD_MS = 120000;/);
  assert.match(BRIDGE, /else if \(s === 'background'\) \{ refreshCard\(true\); reloadWidgetsOnLeave\(\); \}/);
  assert.match(BRIDGE, /if \(now - widgetsReloadedAt < WIDGET_LEAVE_RELOAD_MS\) return;/);
  assert.match(BRIDGE, /if \(changed \|\| force\) iosNative\.reloadWidgets\(\);\n\s+if \(changed \|\| force\) widgetsReloadedAt = Date\.now\(\);/);
});
