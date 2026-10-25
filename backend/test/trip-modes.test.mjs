// Mode chips on the trip screen: /api/trip?modes=bus asks the planner for bus only journeys
// (excludedMeans=checkbox with exclMOT_n) and checks every journey again; date= plans another day.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { tripModesParse, tripModesExclude, tripModesKeep, tripDate, longTripCacheKey };\n";
const tmp = `/tmp/trip-modes-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const leg = (mode) => ({ kind: "transit", mode, line: mode === "bus" ? "461" : "T1" });
const walk = { kind: "walk", mode: "walk" };

test("modes: known keys only, sorted, no repeats", () => {
  assert.deepEqual(W.tripModesParse("bus,Train,bus,plane,"), ["bus", "train"]);
  assert.deepEqual(W.tripModesParse(""), []);
  assert.deepEqual(W.tripModesParse(null), []);
});

test("bus only leaves out train, metro, light rail and ferry, keeps bus, coach and school bus", () => {
  const ex = W.tripModesExclude(["bus"]);
  assert.equal(ex.excludedMeans, "checkbox");
  for (const c of [1, 2, 4, 9]) assert.equal(ex["exclMOT_" + c], "1");
  for (const c of [5, 7, 11]) assert.equal(ex["exclMOT_" + c], undefined);
  assert.equal(W.tripModesExclude([]), null);
});

test("train and bus together keep both", () => {
  const ex = W.tripModesExclude(["bus", "train"]);
  assert.equal(ex.exclMOT_1, undefined);
  assert.equal(ex.exclMOT_5, undefined);
  assert.equal(ex.exclMOT_2, "1");
});

test("journeys are checked again: a train leg in a bus only answer is dropped, walks are fine", () => {
  const js = [{ legs: [walk, leg("bus"), walk] }, { legs: [leg("train")] }, { legs: [leg("bus"), leg("train")] }, { legs: [walk] }, { legs: [leg("coach")] }];
  assert.equal(W.tripModesKeep(js, ["bus"]).length, 2);
  assert.equal(W.tripModesKeep(js, []).length, 5);
  assert.equal(W.tripModesKeep(js, ["bus", "train"]).length, 4);
});

test("date: today up to 14 days ahead in Sydney, anything else ignored", () => {
  const now = Date.parse("2026-10-25T06:00:00Z"); // 5pm Sunday in Sydney
  assert.equal(W.tripDate("20261025", now), "20261025");
  assert.equal(W.tripDate("20261108", now), "20261108");
  assert.equal(W.tripDate("20261109", now), null);
  assert.equal(W.tripDate("20261024", now), null);
  assert.equal(W.tripDate("2026-10-26", now), null);
});

test("the long trip cache keeps modes and date apart", () => {
  const a = W.longTripCacheKey(new URLSearchParams("from=1&to=2&modes=bus"));
  const b = W.longTripCacheKey(new URLSearchParams("from=1&to=2"));
  const c = W.longTripCacheKey(new URLSearchParams("from=1&to=2&date=20261026"));
  assert.notEqual(a, b); assert.notEqual(b, c);
});
