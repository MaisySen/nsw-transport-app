// Background sampling (sampleStops) asks departures for sampleOnly: rows the Trip Planner already
// has a live time for skip the realtime feed merge, and feeds are loaded only for rows without one.
// The live rows it records must be exactly the ones the full merge gives.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { departures, feedMem };\n";
const tmp = `/tmp/sample-only-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

// A minimal GTFS-realtime encoder: just the fields the worker reads.
const varint = (n) => { const o = []; n = BigInt(n); if (n < 0n) n += 1n << 64n; do { let b = Number(n & 0x7fn); n >>= 7n; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const tag = (f, w) => varint((f << 3) | w);
const vint = (f, n) => [...tag(f, 0), ...varint(n)];
const bytes = (f, b) => [...tag(f, 2), ...varint(b.length), ...b];
const str = (f, s) => bytes(f, [...Buffer.from(s)]);
const feed = (entities) => new Uint8Array([...bytes(1, [...str(1, "2.0"), ...vint(3, Math.floor(Date.now() / 1000))]), ...entities.flatMap((e) => bytes(2, e))]);
const tripUpdate = (tripId, stopId, depS, delay) => [...str(1, tripId), ...bytes(3, [...bytes(1, str(1, tripId)), ...vint(4, Math.floor(Date.now() / 1000)),
  ...bytes(2, [...vint(1, 1), ...str(4, "other"), ...bytes(3, [...vint(1, delay), ...vint(2, depS - 300)])]),
  ...bytes(2, [...vint(1, 2), ...str(4, stopId), ...bytes(3, [...vint(1, delay), ...vint(2, depS)])])])];

const MIN = 60000;
const base = Math.floor((Date.now() + 3 * MIN) / 1000) * 1000;
const ev = (line, tripId, planned, est) => ({
  location: { id: "2000447", name: "Central Station, Stand A", properties: {}, parent: { id: "200060", name: "Central Station" } },
  departureTimePlanned: new Date(planned).toISOString(), ...(est ? { departureTimeEstimated: new Date(est).toISOString(), isRealtimeControlled: true } : {}),
  transportation: { disassembledName: line, number: line, product: { class: 5 }, destination: { name: "Coogee", id: "1" } },
  properties: { RealtimeTripId: tripId },
});
let events = [];
let feedCalls = 0;
globalThis.fetch = async (u) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (url.pathname.endsWith("/departure_mon")) return new Response(JSON.stringify({ locations: [{ id: "200060", name: "Central Station" }], stopEvents: events }));
  if (url.pathname.includes("/gtfs/")) {
    feedCalls++;
    if (url.pathname.includes("realtime/buses")) return new Response(feed([tripUpdate("B2", "2000447", base / 1000 + 120, 120), tripUpdate("B1", "2000447", base / 1000 + 60, 60)]));
    return new Response(feed([]));
  }
  return new Response("{}", { status: 404 });
};
const env = { TFNSW_API_KEY: "t" };
const live = (r) => r.items.filter((i) => i.realtime && i.tripId && i.estimated)
  .map((i) => [i.tripId, i.stopId, i.line, i.mode, i.planned, i.estimated, i.source || "planner"]);

test("sampleOnly records the same live rows as the full merge, a feed-filled row included", async () => {
  events = [ev("373", "B1", base, base + 60 * 1000), ev("374", "B2", base + MIN, null), ev("372", "B3", base + 2 * MIN, null)];
  W.feedMem.clear();
  const full = await W.departures(env, "200060", { log: false });
  W.feedMem.clear();
  const sample = await W.departures(env, "200060", { log: false, sampleOnly: true });
  assert.ok(full.items.find((i) => i.tripId === "B2").realtime, "the feed fills B2 in the full merge");
  assert.equal(live(full).length, 2);
  assert.deepEqual(live(sample), live(full));
});

test("sampleOnly loads no feed when every row already has a live time", async () => {
  events = [ev("373", "B1", base, base + 60 * 1000), ev("374", "B2", base + MIN, base + MIN)];
  W.feedMem.clear(); feedCalls = 0;
  const full = await W.departures(env, "200060", { log: false });
  assert.ok(feedCalls > 0);
  W.feedMem.clear(); feedCalls = 0;
  const sample = await W.departures(env, "200060", { log: false, sampleOnly: true });
  assert.equal(feedCalls, 0);
  assert.deepEqual(live(sample), live(full));
});
