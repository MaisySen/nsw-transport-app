// Build 210 stop track in the iPhone trip card push (30 Oct). The server copies the optional stopTrack into the content
// state Apple gets, checked and small; builds 201 to 209 decode the card and skip the key; without it the card is
// exactly as before; a push near Apple's 4 KB limit leaves the track out.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") +
  "\nexport { laContentState, laPayload, laStopTrack, LIVECARD, LA_PAYLOAD_SOFT_MAX, laLook };\n";
const tmp = `/tmp/live-stops-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const NOW = Date.parse("2026-10-30T18:00:00+11:00");
const base = { line: "501", lineColorHex: "#00B5EF", mode: "bus", nextStop: "Ryde Hospital", stopsLeft: 4, getOffAt: "Top Ryde City", arrival: NOW + 600000,
  phase: "ride", warning: "4 min late", progress: 0.4, departs: NOW - 300000, legArrives: NOW + 480000, destination: "Top Ryde City", updated: NOW };
const track = { passed: 3, next: ["Ryde Hospital", "Blaxland Rd at Pope St", "Church St", "Top Ryde City"], hidden: 0, hiddenAt: 0, live: true };

test("a card without the track is exactly the old content state (builds 201 to 209 unchanged)", () => {
  const cs = W.laContentState(base);
  assert.ok(!("stopTrack" in cs));
  assert.deepEqual(Object.keys(cs).sort(), ["arrival", "departs", "destination", "getOffAt", "legArrives", "line", "lineColorHex", "mode", "nextStop", "phase",
    "progress", "stopsLeft", "updated", "warning"]);
});

test("the track goes to Apple as sent when it is well formed, beside every old field", () => {
  const cs = W.laContentState({ ...base, stopTrack: track });
  assert.deepEqual(cs.stopTrack, track);
  const old = W.laContentState(base);
  for (const [k, v] of Object.entries(old)) assert.deepEqual(cs[k], v, k);
});

test("bad values are checked: whole numbers, at most 10 names of 32 characters, live only when true", () => {
  const t = W.laStopTrack({ passed: -4.6, next: Array.from({ length: 14 }, (_, i) => "N".repeat(50) + i), hidden: "7", hiddenAt: 99, live: "yes" });
  assert.equal(t.passed, 0);
  assert.equal(t.next.length, 10);
  for (const n of t.next) assert.ok(n.length <= 32);
  assert.equal(t.hidden, 7);
  assert.equal(t.hiddenAt, 9);
  assert.equal(t.live, false);
  assert.equal(W.laStopTrack(null), null);
  assert.equal(W.laStopTrack({ next: [] }), null);
  assert.equal(W.laStopTrack({ next: ["A", ""] }), null);
  assert.equal(W.laStopTrack({ next: "A" }), null);
  assert.equal(W.laStopTrack({ passed: 2, next: ["A"], hidden: 0, hiddenAt: 5, live: true }).hiddenAt, 0);
});

test("payload size: the largest track measured under Apple's 4 KB, and a push near the limit drops only the track", () => {
  const big = { passed: 300, next: Array.from({ length: 10 }, () => "\u00e9".repeat(32)), hidden: 300, hiddenAt: 8, live: true };
  const card = { ...base, warning: "W".repeat(140), destination: "D".repeat(60), towards: "T".repeat(60), platform: "Platform 12", stopTrack: big };
  const p = W.laPayload(card, { now: NOW, staleMs: NOW + 120000 });
  const bytes = new TextEncoder().encode(JSON.stringify(p)).length;
  assert.ok(p.aps["content-state"].stopTrack, "kept");
  assert.ok(bytes < W.LA_PAYLOAD_SOFT_MAX && bytes < 4096, String(bytes));
  // A normal card with a track, as measured for the report.
  const normal = new TextEncoder().encode(JSON.stringify(W.laPayload({ ...base, stopTrack: track }, { now: NOW, staleMs: NOW + 120000 }))).length;
  const without = new TextEncoder().encode(JSON.stringify(W.laPayload(base, { now: NOW, staleMs: NOW + 120000 }))).length;
  assert.ok(normal - without < 200, `${normal} vs ${without}`);
  // Something else on the card grown past the soft limit: the track goes, the card stays.
  const huge = W.laPayload({ ...card, warning: "W".repeat(3400) }, { now: NOW });
  assert.ok(!("stopTrack" in huge.aps["content-state"]));
  assert.equal(huge.aps["content-state"].line, "501");
});

test("the card look changes when the run passes a stop, so the push goes at the same moment the next stop changes", () => {
  const a = W.laLook(W.laContentState({ ...base, stopTrack: track }));
  const b = W.laLook(W.laContentState({ ...base, stopTrack: { ...track, passed: 4, next: track.next.slice(1) } }));
  assert.notEqual(a, b);
});

test("the server works out the track exactly like the app (shared card code): live run, then timetable only", () => {
  const iso = (m) => new Date(NOW + m * 60000).toISOString();
  const names = ["Parramatta Interchange, Parramatta", "Victoria Rd at Belmore St, Ermington", "Ryde Hospital, Eastwood", "Church St, Ryde", "Top Ryde City, Ryde"];
  const leg = { mode: "bus", line: "501", tripId: "B1", stopId: "S0", toStopId: "S4", from: names[0], to: names[4], planned: iso(0), arrPlanned: iso(8), color: "#00B5EF" };
  const d = { kind: "service", live: true, mode: "bus", line: "501", tripId: "B1", mineIndex: 0, alightIndex: 4, progress: "live",
    stops: names.map((name, i) => ({ id: "S" + i, name, planned: iso(i * 2), estimated: iso(i * 2 + 1) })) };
  const t = NOW + 4 * 60000;
  const c = W.LIVECARD.cardFor({ legs: [leg], to: { id: "S4", name: names[4] } }, W.LIVECARD.computeLive([leg], [d], t), t);
  assert.equal(c.phase, "ride");
  assert.deepEqual(c.stopTrack, { passed: 2, next: ["Ryde Hospital", "Church St", "Top Ryde City"], hidden: 0, hiddenAt: 0, live: true });
  assert.equal(c.stopsLeft, 3);
  const tt = { ...d, live: false, progress: "timetable", nextIndex: 3, stops: d.stops.map(({ estimated, ...s }) => s) };
  // Phase 2: with no live data the card is on board only when it was seen riding before (rode), never by the clock.
  const c2 = W.LIVECARD.cardFor({ legs: [leg], to: { id: "S4", name: names[4] } }, W.LIVECARD.computeLive([leg], [tt], t, { rode: { 0: NOW + 8 * 60000 } }), t);
  assert.equal(c2.phase, "ride");
  assert.equal(c2.stopTrack.live, false);
  assert.equal(c2.nextStop, null);
});
