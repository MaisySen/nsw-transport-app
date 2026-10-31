// Build 210 stop track on the trip Live Activity (Bidur, 30 Oct: "add stops here rather than a plain loading bar").
// platform/tripCard.ts stopTrackFor and cardFor: the leg's stops from the same stop list, next stop and live evidence the
// countdown and "N stops" use; timetable only is marked not live (R1); old shapes stay as they were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linkTs } from './tsLink.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require(path.join(here, '..', 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-stops-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, linkTs(js, out, ts));
  return import(pathToFileURL(f).href);
}
const live = await load('src/lib/liveCalc.ts');
const { cardFor, stopTrackFor, TRACK_MAX, TRACK_NAME_MAX } = await load('platform/tripCard.ts');

const T0 = Date.parse('2026-10-30T07:00:00Z');
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();
const NAMES = ['Parramatta Interchange, Parramatta', 'Victoria Rd at Belmore St, Ermington', 'Ryde Hospital, Eastwood', 'Blaxland Rd at Pope St, Ryde',
  'Church St, Ryde', 'Devlin St, Ryde', 'Top Ryde City, Ryde', 'Lane Cove Rd, North Ryde'];
// A bus with stops 2 minutes apart; you board at 0 and get off at 6 (Top Ryde City).
const svc = (o = {}) => ({
  kind: 'service', mode: 'bus', line: '501', tripId: 'B501.1', live: true, mineIndex: 0, alightIndex: 6, nextIndex: 0, progress: 'live',
  stops: NAMES.map((name, i) => ({ id: 'S' + i, name, planned: iso(at(i * 2)), ...(o.estimated !== false ? { estimated: iso(at(i * 2 + 4)) } : {}) })),
  ...o,
});
const leg = { mode: 'bus', line: '501', tripId: 'B501.1', stopId: 'S0', toStopId: 'S6', from: NAMES[0], to: NAMES[6], planned: iso(at(0)), arrPlanned: iso(at(12)), color: '#00B5EF', towards: 'Top Ryde' };
const trip = { legs: [leg], to: { id: 'S6', name: NAMES[6] } };
const cardAt = (d, t, memo) => cardFor(trip, live.computeLive(trip.legs, [d], t, memo), t);

test('on board with live times: passed stops, next first, your stop last, count matches "N stops"', () => {
  // Live times run 4 min late: at +9 the bus has left stop 2 (live 8) and stop 3 (live 10) is next.
  const c = cardAt(svc(), at(9));
  assert.equal(c.phase, 'ride');
  assert.ok(c.stopTrack, 'stop track');
  assert.equal(c.stopTrack.live, true);
  assert.equal(c.stopTrack.passed, 3);
  assert.deepEqual(c.stopTrack.next, ['Blaxland Rd at Pope St', 'Church St', 'Devlin St', 'Top Ryde City']);
  assert.equal(c.stopTrack.next[0], c.nextStop, 'the track and the card name the same next stop');
  assert.equal(c.stopTrack.next.length + c.stopTrack.hidden, c.stopsLeft);
  assert.equal(c.stopTrack.next.at(-1), c.getOffAt);
  // The old fields are all still there for builds 201 to 209.
  for (const k of ['line', 'lineColorHex', 'mode', 'getOffAt', 'arrival', 'phase', 'progress', 'stopsLeft', 'nextStop']) assert.ok(c[k] != null, k);
});

test('timetable only: the track is marked not live and the card still names no next stop (R1)', () => {
  const d = svc({ live: false, progress: 'timetable', nextIndex: 4, estimated: false });
  // Phase 2 (G6): with nothing live the card is on board only when it was seen riding before (memo.rode), and the stop
  // list is never moved along by the timetable: it stays at the first stop after yours.
  assert.equal(cardAt(d, at(7)).phase, 'wait');
  const c = cardAt(d, at(7), { rode: { 0: at(20) } });
  assert.equal(c.phase, 'ride');
  assert.equal(c.nextStop, null);
  assert.equal(c.stopsLeft, null);
  assert.equal(c.warning, 'Timetable times, not live');
  assert.ok(c.stopTrack);
  assert.equal(c.stopTrack.live, false);
  assert.equal(c.stopTrack.passed, 1);
});

test('waiting: you are at your boarding stop, every stop of the leg still to come', () => {
  const c = cardAt(svc({ nextIndex: 0 }), at(-3));
  assert.equal(c.phase, 'wait');
  assert.equal(c.stopTrack.passed, 1);
  assert.equal(c.stopTrack.next.length, 6);
  assert.equal(c.stopTrack.next.at(-1), 'Top Ryde City');
});

test('stops the service runs through and names past your stop off are left out', () => {
  const d = svc();
  d.stops[4] = { ...d.stops[4], skipped: true };
  d.stops[5] = { id: 'S5', name: NAMES[5] };
  const t = stopTrackFor(d, 1, 'ride', true);
  assert.deepEqual(t.next, ['Victoria Rd at Belmore St', 'Ryde Hospital', 'Blaxland Rd at Pope St', 'Top Ryde City']);
  assert.ok(!t.next.includes('Lane Cove Rd'));
});

test('a long ride folds the middle: at most TRACK_MAX names, the first ones and your stop off, hidden counted', () => {
  const stops = Array.from({ length: 30 }, (_, i) => ({ id: 'L' + i, name: `Stop number ${i} on the long road, Suburb`, planned: iso(at(i)) }));
  const t = stopTrackFor({ kind: 'service', stops, mineIndex: 0, alightIndex: 25 }, 3, 'ride', true);
  // The first TRACK_MAX - 2 names, the folded count, then your stop off: TRACK_MAX dots and the "+N" in all.
  assert.equal(t.next.length, TRACK_MAX - 1);
  assert.equal(t.hiddenAt, TRACK_MAX - 2);
  assert.equal(t.next.length + t.hidden, 25 - 3 + 1);
  assert.equal(t.next[0], 'Stop number 3 on the long road');
  assert.equal(t.next.at(-1), 'Stop number 25 on the long road');
  assert.equal(t.passed, 3);
  for (const n of t.next) assert.ok(n.length <= TRACK_NAME_MAX, n);
});

test('names are cut to TRACK_NAME_MAX, with no dashes', () => {
  const stops = [{ name: 'A', planned: iso(at(0)) }, { name: 'Macquarie University Station Bus Interchange Stand Q, Macquarie Park', planned: iso(at(3)) }];
  const t = stopTrackFor({ kind: 'service', stops, mineIndex: 0, alightIndex: 1 }, 1, 'ride', true);
  assert.ok(t.next[0].length <= TRACK_NAME_MAX);
  assert.match(t.next[0], /\.$/);
  assert.doesNotMatch(t.next[0], /[\u2013\u2014]/);
});

test('no stop list, no indexes or indexes outside the list: no track, the card keeps the plain bar', () => {
  assert.equal(stopTrackFor(null, 2, 'ride', true), null);
  assert.equal(stopTrackFor({ kind: 'service', stops: [] }, 0, 'ride', true), null);
  const d = svc();
  assert.equal(stopTrackFor({ ...d, mineIndex: undefined }, 2, 'ride', true), null);
  assert.equal(stopTrackFor({ ...d, alightIndex: 40 }, 2, 'ride', true), null);
  assert.equal(stopTrackFor({ ...d, mineIndex: 5, alightIndex: 3 }, 2, 'ride', true), null);
  // A leg with no stop list at all: no stopTrack key on the card.
  const c = cardFor(trip, live.computeLive(trip.legs, [null], at(5)), at(5));
  assert.ok(!('stopTrack' in c));
});

test('a next stop past your stop off clamps to your stop; before your boarding stop clamps to the first after it', () => {
  const d = svc();
  assert.deepEqual(stopTrackFor(d, 7, 'ride', true).next, ['Top Ryde City']);
  assert.equal(stopTrackFor(d, -1, 'ride', true).passed, 1);
});

test('arrived cards carry no track (the bar shows full)', () => {
  const c = cardFor(trip, { done: true, L2: [], eta: at(12) }, at(13));
  assert.equal(c.phase, 'arrived');
  assert.ok(!('stopTrack' in c));
});

test('the card with the track stays well under the 4 KB push even at the limits', () => {
  const stops = Array.from({ length: 40 }, (_, i) => ({ name: 'W'.repeat(60) + i, planned: iso(at(i)) }));
  const t = stopTrackFor({ kind: 'service', stops, mineIndex: 0, alightIndex: 39 }, 1, 'ride', true);
  assert.ok(Buffer.byteLength(JSON.stringify(t)) < 600, String(Buffer.byteLength(JSON.stringify(t))));
});

test('the Swift card decodes the same keys: StopTrack fields match, and both struct copies carry stopTrack', () => {
  const w = fs.readFileSync(path.join(here, '..', 'targets/widget/LiveTripActivity.swift'), 'utf8');
  const m = fs.readFileSync(path.join(here, '..', 'modules/transport-ios/ios/LiveTripAttributes.swift'), 'utf8');
  const struct = (s) => s.slice(s.indexOf('public struct LiveTripAttributes'), s.indexOf('public var title: String'));
  assert.equal(struct(w), struct(m), 'the two LiveTripAttributes copies must stay identical');
  for (const k of ['passed', 'next', 'hidden', 'hiddenAt', 'live']) assert.match(w, new RegExp(`case[^\\n]*\\b${k}\\b`), k);
  assert.match(w, /public var stopTrack: StopTrack\?/);
  // A field the app or server sends wrong never fails the whole card: each field is read with try?.
  assert.match(w, /passed = max\(0, \(try\? c\.decode\(Int\.self/);
  const v = fs.readFileSync(path.join(here, '..', 'targets/widget/LiveTripActivityWidget.swift'), 'utf8');
  assert.match(v, /struct StopTrackView: View/);
  assert.match(v, /state\.showsTrack\(stale: stale\)/);
  // The stop off name keeps two lines before "6 stops" and the warning lose their own lines (owner: "Get off at Five...").
  assert.ok(v.indexOf('card(lines: 2, track: true, merged: true)') < v.indexOf('card(lines: 1, track: true, merged: true)'));
  // Cards without the track keep the plain bar.
  assert.match(v, /ProgressView\(value:/);
});
