// Build 209: widgets stop calling a time live once its data is older than the app's own rule (liveLabelCore.ts):
// over 5 minutes old, or over 2 minutes old for a service under 10 minutes away. The iPhone rule is
// targets/widget/WidgetLive.swift and the Android one plugins/widget/kotlin/WidgetLive.kt. This file checks that
// both say what the app says on a grid of cases (compiling them when swiftc or kotlinc is on the machine; skipped
// otherwise), and that the widgets actually use them, with no new timer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '..');
const require = createRequire(import.meta.url);
const ts = require(path.join(app, 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-widgetlive-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(app, rel), 'utf8');
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  js = js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const L = await load('src/lib/liveLabelCore.ts');
const read = (rel) => fs.readFileSync(path.join(app, rel), 'utf8');
const SWIFT = read('targets/widget/WidgetLive.swift');
const KT = read('plugins/widget/kotlin/WidgetLive.kt');
const WIDGETS = read('targets/widget/TransportWidgets.swift');
const MODELS = read('targets/widget/Models.swift');
const API = read('plugins/widget/kotlin/TransitApi.kt');
const TRIPW = read('plugins/widget/kotlin/TripWidgetProvider.kt');
const BOARDW = read('plugins/widget/kotlin/BoardWidgetProvider.kt');

const AT = 1793268000000; // 29 Oct 2026, 8:20am Sydney
const AGES = [0, 60, 119, 120, 121, 180, 299, 300, 301, 600, 1200];
const LEADS = [30, 300, 599, 600, 601, 900, 1800];
/** What the app's rows say for a live time `lead` s away whose data is `age` s old. */
const appFresh = (age, lead) => L.liveState({ planned: new Date(AT + (lead - 60) * 1000).toISOString(), estimated: new Date(AT + lead * 1000).toISOString(),
  realtime: true, seenAt: AT - age * 1000 }, AT).kind === 'live';

test('the widget rule uses the app numbers: 5 min, 2 min within 10 min of the service', () => {
  assert.equal(L.LIVE_MAX_MS, 300000);
  assert.equal(L.STALE_DATA_MS, 120000);
  assert.equal(L.STALE_NEAR_MS, 600000);
  const num = (src, re) => Number((src.match(re) || [])[1].replace(/_/g, ''));
  assert.equal(num(SWIFT, /maxAge: TimeInterval = ([\d_]+)/) * 1000, L.LIVE_MAX_MS);
  assert.equal(num(SWIFT, /nearAge: TimeInterval = ([\d_]+)/) * 1000, L.STALE_DATA_MS);
  assert.equal(num(SWIFT, /nearWindow: TimeInterval = ([\d_]+)/) * 1000, L.STALE_NEAR_MS);
  assert.equal(num(KT, /MAX_AGE_MS = ([\d_]+)L/), L.LIVE_MAX_MS);
  assert.equal(num(KT, /NEAR_AGE_MS = ([\d_]+)L/), L.STALE_DATA_MS);
  assert.equal(num(KT, /NEAR_WINDOW_MS = ([\d_]+)L/), L.STALE_NEAR_MS);
});

test('the grid the native checks run is the app rule itself (sanity of the expectations)', () => {
  assert.equal(appFresh(0, 30), true);
  assert.equal(appFresh(121, 300), false);
  assert.equal(appFresh(121, 900), true);
  assert.equal(appFresh(301, 1800), false);
});

function which(cmd) {
  try { return execFileSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}
const lines = (text) => text.trim().split('\n').map((l) => JSON.parse(l));
function checkGrid(rows, who) {
  const fresh = rows.filter((r) => r.kind === 'fresh');
  assert.equal(fresh.length, AGES.length * LEADS.length, `${who}: every case ran`);
  for (const r of fresh) assert.equal(r.fresh, appFresh(r.age, r.lead), `${who}: data ${r.age} s old, service in ${r.lead} s`);
  const d = Object.fromEntries(rows.filter((r) => r.kind === 'dataAt').map((r) => [r.case, r.v]));
  assert.deepEqual(d, { none: 0, feed90: -90, skew: -40, future: 0, ancient: -86400, zero: 0 }, `${who}: data time on the phone's clock`);
  assert.deepEqual(rows.filter((r) => r.kind === 'timetable').map((r) => r.v).slice(0, 1), [720], `${who}: timetable time of a late service`);
}
const nativeOff = process.env.WIDGET_NATIVE_CHECK === '0';
const swiftc = nativeOff ? null : which('swiftc');
const kotlinc = nativeOff ? null : (process.env.KOTLINC || which('kotlinc'));

test('iPhone widgets: WidgetLive.swift says what the app says', { skip: swiftc ? false : 'no swiftc on this machine', timeout: 300000 }, () => {
  const bin = path.join(out, 'widgetlive');
  execFileSync(swiftc, [path.join(app, 'targets/widget/WidgetLive.swift'), path.join(here, 'swift/widgetlive/main.swift'), '-o', bin], { stdio: 'pipe', timeout: 280000 });
  const rows = lines(execFileSync(bin, { encoding: 'utf8', timeout: 20000 }));
  checkGrid(rows, 'swift');
  const ago = Object.fromEntries(rows.filter((r) => r.kind === 'ago').map((r) => [r.s, r.v]));
  assert.equal(ago[420], 'Updated 7 min ago');
  assert.equal(ago[30], 'Updated 1 min ago');
  assert.equal(ago[3600], 'Updated over an hour ago');
  const s = Object.fromEntries(rows.filter((r) => r.kind === 'settle').map((r) => [r.case, r.r]));
  assert.deepEqual(s.fresh, { leave: 900, live: true, demoted: false });
  assert.deepEqual(s.old, { leave: 720, live: false, demoted: true }, 'an old live time shows its timetable time');
  assert.deepEqual(s.oldNoTimetable, { leave: 900, live: false, demoted: true });
  assert.deepEqual(s.neverLive, { leave: 900, live: false, demoted: false });
  assert.deepEqual(s.noData, { leave: 900, live: true, demoted: false });
  assert.equal(rows.find((r) => r.kind === 'oldest').v, 3);
});

test('Android widgets: WidgetLive.kt says what the app says', { skip: kotlinc ? false : 'no kotlinc on this machine', timeout: 300000 }, () => {
  const jar = path.join(out, 'widgetlive.jar');
  execFileSync(kotlinc, [path.join(app, 'plugins/widget/kotlin/WidgetLive.kt'), path.join(here, 'kotlin/WidgetLiveCheck.kt'), '-include-runtime', '-d', jar], { stdio: 'pipe', timeout: 280000 });
  const rows = lines(execFileSync('java', ['-jar', jar], { encoding: 'utf8', timeout: 30000 }));
  checkGrid(rows, 'kotlin');
  const st = rows.filter((r) => r.kind === 'staleAt');
  assert.ok(st.length >= 10);
  for (const r of st) assert.equal(r.ok, true, `refresh cap is the first stale moment: age ${r.age}, lead ${r.lead}`);
});

test('iPhone widgets age every live time in their timelines, from the feed time when the answer has it', () => {
  // Next trip: each minute entry settles the trips; the trip answer's feed time (feedTs, else feedAt) and the server clock.
  assert.match(WIDGETS, /let \(trips, demoted\) = settle\(e\.trips, dataAt: e\.dataAt, at: d\)/);
  assert.match(WIDGETS, /WidgetLive\.dataAt\(fetched: now, feedMs: r\.live\?\.feedTs \?\? r\.live\?\.feedAt, serverNowMs: r\.now\)/);
  assert.match(WIDGETS, /e\.dataAt = dataAt/);
  // A trip in progress from the app ages from the card's own updated time.
  assert.match(WIDGETS, /if let u = c\.updated, u > 0 \{ e\.dataAt = /);
  // Stop board: each row from its own liveAt.
  assert.match(WIDGETS, /let \(rows, oldest\) = Self\.settle\(e\.rows, at: x\.date\)/);
  assert.match(WIDGETS, /feedMs: d\.liveAt \?\? boardFeed/);
  // Footers say how old, not "Updated 8:21am", once a time stopped being live.
  assert.equal((WIDGETS.match(/entry\.ago \?\? "Updated/g) || []).length, 2);
  // Optional fields only, so older answers and caches written by builds before 209 still decode.
  assert.match(MODELS, /public var feedTs: Double\?/);
  assert.match(MODELS, /public var liveAt: Double\?/);
  assert.equal((MODELS.match(/public var now: Double\?/g) || []).length, 2);
  assert.match(WIDGETS, /var timetable: Date\?\n/);
});

test('Android widgets settle trips and board rows when read, and the trip widget refresh never outlives a live countdown', () => {
  assert.equal((API.match(/settle\(leave0,/g) || []).length, 2, 'single trips and multi leg trips');
  assert.match(API, /WidgetLive\.isFresh\(at, t, now\)/, 'board rows');
  assert.match(API, /optLong\("liveAt", 0L\)/);
  assert.match(TRIPW, /WidgetLive\.staleAt\(dataAt, first\.leave\)/);
  assert.match(TRIPW, /next\.coerceIn\(now \+ 60_000, now \+ 15 \* 60_000\)/, 'still never sooner than a minute');
  assert.match(BOARDW, /board\.dataAt\.takeIf/);
});

test('battery: no new timer or alarm kind in the widget code', () => {
  const kt = fs.readdirSync(path.join(app, 'plugins/widget/kotlin')).map((f) => read(`plugins/widget/kotlin/${f}`)).join('\n');
  assert.doesNotMatch(kt, /setRepeating|setExact|setAlarmClock|Timer\(|Handler\(\)\.postDelayed/);
  assert.equal((kt.match(/AlarmManager\.RTC\b/g) || []).length, (kt.match(/am\.set\(/g) || []).length, 'only non waking alarms');
  const sw = fs.readdirSync(path.join(app, 'targets/widget')).filter((f) => f.endsWith('.swift')).map((f) => read(`targets/widget/${f}`)).join('\n');
  assert.doesNotMatch(sw, /Timer\.scheduledTimer|Timer\.publish|DispatchSourceTimer/);
  // owner-stations: guard (checks the names are absent from the native code)
  assert.doesNotMatch(SWIFT + KT, /Strathfield|Burwood|Kings Cross|Redfern/);
});
