// Watched trips keep each leg's realtime feed (TrainLink, regional buses, Manly Fast Ferry), older watches get it
// looked up from the board, and long distance plans have their own timeout and a short cache key.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { legFromInput, cleanFeed, backfillFeeds, laTripFrom, longTripCacheKey, LONG_TRIP_TIMEOUT_MS, plainText };\n";
const tmp = `/tmp/watch-feed-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const NOW = Date.parse("2026-10-25T00:00:00Z");
const at = (min) => new Date(NOW + min * 60000).toISOString();

test("a watch leg keeps a known feed and drops anything else", () => {
  assert.equal(W.legFromInput({ mode: "train", line: "ST22", stopId: "200060", planned: at(10), feed: "nswtrains" }).feed, "nswtrains");
  assert.equal(W.legFromInput({ mode: "bus", line: "902", stopId: "26401", planned: at(10), feed: "rb_riverinamurray" }).feed, "rb_riverinamurray");
  assert.equal(W.legFromInput({ mode: "train", line: "T1", stopId: "200060", planned: at(10), feed: "" }).feed, "");
  assert.equal("feed" in W.legFromInput({ mode: "train", line: "T1", stopId: "200060", planned: at(10) }), false);
  assert.equal("feed" in W.legFromInput({ mode: "train", line: "T1", stopId: "200060", planned: at(10), feed: "/v1/evil" }), false);
  assert.equal(W.cleanFeed("ferry_mff"), "ferry_mff");
  assert.equal(W.cleanFeed(42), undefined);
});

test("the lock screen trip card keeps the feed too", () => {
  const t = W.laTripFrom({ id: "g1", legs: [{ mode: "train", line: "ST22", stopId: "200060", planned: at(5), feed: "nswtrains" }, { mode: "bus", line: "1", stopId: "2000338", planned: at(40), feed: "nope" }] });
  assert.equal(t.legs[0].feed, "nswtrains");
  assert.equal(t.legs[1].feed, undefined);
});

test("older watches get the feed from the stop's board, once", async () => {
  const boards = {
    "26401": { items: [{ line: "902", tripId: "rb1", planned: at(20), feed: "rb_riverinamurray" }] },
    "200060": { items: [{ line: "T1", tripId: "t1", planned: at(5) }] },
  };
  let calls = 0;
  const board = async (id) => { calls++; return boards[id] || { items: [] }; };
  const spec = { legs: [
    { mode: "train", line: "T1", tripId: "t1", stopId: "200060", planned: at(5) },
    { mode: "metro", line: "M1", stopId: "2000400", planned: at(30) },
    { mode: "bus", line: "902", tripId: "rb1", stopId: "26401", planned: at(20) },
    { mode: "coach", line: "C1", stopId: "999", planned: at(300) },
  ] };
  assert.equal(await W.backfillFeeds({}, spec, NOW, board), true);
  assert.equal(spec.legs[0].feed, "");
  assert.equal(spec.legs[1].feed, "");
  assert.equal(spec.legs[2].feed, "rb_riverinamurray");
  assert.equal(spec.legs[3].feed, undefined, "a leg 5 hours away is looked up later");
  assert.equal(calls, 2);
  calls = 0;
  assert.equal(await W.backfillFeeds({}, spec, NOW, board), false);
  assert.equal(calls, 0, "legs with a feed are not looked up again");
});

test("a leg not on the board keeps its mode's feed after three looks", async () => {
  const spec = { legs: [{ mode: "bus", line: "333", stopId: "1", planned: at(10) }] };
  const board = async () => ({ items: [] });
  await W.backfillFeeds({}, spec, NOW, board);
  await W.backfillFeeds({}, spec, NOW, board);
  assert.equal(spec.legs[0].feed, undefined);
  await W.backfillFeeds({}, spec, NOW, board);
  assert.equal(spec.legs[0].feed, "");
  assert.equal(spec.legs[0].feedTries, undefined);
});

test("a board that does not answer changes nothing", async () => {
  const spec = { legs: [{ mode: "train", line: "ST22", stopId: "200060", planned: at(10) }] };
  assert.equal(await W.backfillFeeds({}, spec, NOW, async () => { throw new Error("down"); }), false);
  assert.equal(spec.legs[0].feed, undefined);
});

test("long trips: longer planner timeout and a cache key without the device or refresh", () => {
  assert.ok(W.LONG_TRIP_TIMEOUT_MS >= 30000);
  const a = W.longTripCacheKey(new URLSearchParams("from=200060&to=26401&count=6&device=abc&profile=p&refresh=1&long=1"));
  const b = W.longTripCacheKey(new URLSearchParams("from=200060&to=26401&count=6&long=1"));
  assert.equal(a, b);
  assert.notEqual(b, W.longTripCacheKey(new URLSearchParams("from=200060&to=28301&count=6&long=1")));
  assert.notEqual(b, W.longTripCacheKey(new URLSearchParams("from=200060&to=26401&count=6&time=0900&long=1")));
});

test("leg alert titles lose their HTML", () => {
  assert.equal(W.plainText('<a href="https://transportnsw.info/regional-bookings/" target="_blank">Book your seat with NSW TrainLink</a>'), "Book your seat with NSW TrainLink");
  assert.equal(W.plainText("Lifts &amp; ramps"), "Lifts & ramps");
});
