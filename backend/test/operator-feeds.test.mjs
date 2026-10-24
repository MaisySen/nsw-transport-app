// Realtime for operators outside the Sydney feeds: Manly Fast Ferry, NSW TrainLink trains and
// coaches, and regional buses, chosen per service from the planner's operator and network names.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { feedHint, feedKeys, realtimeFor };\n";
const tmp = `/tmp/feeds-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

// Transportation objects as the Trip Planner returned them on 25 Oct 2026.
const MFF = { id: "nsw:05MFF: :H:sj2", operator: { name: "Manly Fast Ferries" }, product: { class: 9, name: "Private ferry and fast ferry services" } };
const F1 = { id: "nsw:090F1: :H:sj2", operator: { name: "Sydney Ferries" }, product: { class: 9, name: "Sydney Ferries Network" } };
const XPT = { id: "nsw:76621: :H:sj2", operator: { name: "NSW TrainLink" }, product: { class: 1, name: "Regional Trains and Coaches Network" } };
const COACH = { id: "nsw:76569: :H:sj2", operator: { name: "NSW TrainLink" }, product: { class: 7, name: "Regional Trains and Coaches Network" } };
const BMT = { id: "nsw:02BMT: :H:sj2", operator: { name: "NSW Trains" }, product: { class: 1, name: "Intercity Trains Network" } };
const COFFS = { id: "nsw:55366: :H:sj2", operator: { name: "Busways" }, product: { class: 5, name: "North Coast Network" } };
const ORANGE = { id: "nsw:71540: :R:sj2", operator: { name: "Orange Buslines" }, product: { class: 5, name: "Central West and Orana Network" } };
const NOWRA = { id: "nsw:58101: :R:sj2", operator: { name: "Nowra Coaches" }, product: { class: 5, name: "Sydney and Surrounds Network" } };
const SYD575 = { id: "nsw:37575: :H:sj2", operator: { name: "CDC NSW R14" }, product: { class: 5, name: "Sydney Buses Network" } };

test("feed per service from operator and network, never from the line name", () => {
  assert.equal(W.feedHint(9, MFF), "ferry_mff");
  assert.equal(W.feedHint(9, F1), null);
  assert.equal(W.feedHint(1, XPT), "nswtrains");
  assert.equal(W.feedHint(7, COACH), "nswtrains");
  assert.equal(W.feedHint(1, BMT), null); // intercity trains are in the Sydney Trains feed
  assert.equal(W.feedHint(5, COFFS), "rb_northcoast");
  assert.equal(W.feedHint(5, ORANGE), "rb_centralwestandorana");
  assert.equal(W.feedHint(5, NOWRA), "rb_sydneysurrounds");
  assert.equal(W.feedHint(5, SYD575), null);
  assert.equal(W.feedHint(5, null), null);
  assert.deepEqual(W.feedKeys("bus", "366", "rb_northcoast"), ["rb_northcoast", "rb_northcoast2", "rb_northcoast3"]);
  assert.deepEqual(W.feedKeys("bus", "575", null), ["bus"]);
  assert.deepEqual(W.feedKeys("train", "621", "nswtrains"), ["nswtrains"]);
});

test("only the feeds a trip needs are read", async () => {
  const got = [];
  globalThis.fetch = async (u) => { got.push(new URL(String(u)).pathname); return new Response(new Uint8Array(0)); };
  const rt = await W.realtimeFor({ TFNSW_API_KEY: "t" }, [["bus", "366", "rb_northcoast"], ["ferry", "MFF", "ferry_mff"], ["train", "T1"]]);
  const paths = got.map((p) => p.replace(/^.*\/v\d\/gtfs\//, "")).sort();
  assert.deepEqual(paths, [
    "realtime/ferries/MFF", "realtime/regionbuses/northcoast", "realtime/regionbuses/northcoast2", "realtime/regionbuses/northcoast3", "realtime/sydneytrains",
    "vehiclepos/ferries/MFF", "vehiclepos/regionbuses/northcoast", "vehiclepos/regionbuses/northcoast2", "vehiclepos/regionbuses/northcoast3", "vehiclepos/sydneytrains",
  ]);
  assert.equal(rt.tu("bus", "366", "2004854", "rb_northcoast"), null);
});
