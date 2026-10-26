// A train's stop list when Sydney Trains' feed lists only some of its stops (on 26 Oct an all stops South Coast train
// had 9 of its 41 stops): the stops from your stop onwards come from the trip planner, with the feed's live times on
// them, and the feed's stops before yours stay. Runs offline with a fake feed and a fake planner.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { service };\n";
const tmp = `/tmp/service-train-feed-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

// A minimal GTFS-realtime encoder (as in sample-only.test.mjs), one trip with several stops.
const varint = (n) => { const o = []; n = BigInt(n); if (n < 0n) n += 1n << 64n; do { let b = Number(n & 0x7fn); n >>= 7n; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const tag = (f, w) => varint((f << 3) | w);
const vint = (f, n) => [...tag(f, 0), ...varint(n)];
const bytes = (f, b) => [...tag(f, 2), ...varint(b.length), ...b];
const str = (f, s) => bytes(f, [...Buffer.from(s)]);
const feed = (entities) => new Uint8Array([...bytes(1, [...str(1, "2.0"), ...vint(3, Math.floor(Date.now() / 1000))]), ...entities.flatMap((e) => bytes(2, e))]);
const tripUpdate = (tripId, stus) => [...str(1, tripId), ...bytes(3, [...bytes(1, str(1, tripId)), ...vint(4, Math.floor(Date.now() / 1000)),
  ...stus.flatMap(([seq, stopId, depS, delay]) => bytes(2, [...vint(1, seq), ...str(4, stopId), ...bytes(3, [...vint(1, delay), ...vint(2, depS)])]))])];

const MIN = 60000;
const base = Math.floor((Date.now() + 10 * MIN) / 1000) * 1000;
const at = (m) => new Date(base + m * MIN).toISOString();
const s = (m) => Math.floor((base + m * MIN) / 1000);
const stops = { "/stops/250.json": { "2500211": ["Thirroul Station, Platform 1", -34.3, 150.9] }, "/stops/251.json": { "2515111": ["Coledale Station, Platform 1", -34.29, 150.94], "2515112": ["Austinmer Station, Platform 1", -34.3, 150.93] }, "/stops/200.json": { "2000323": ["Central Station, Platform 23", -33.88, 151.2] } };
const lists = { "/stations/train.json": [["200060", "Central Station", -33.88, 151.2]], "/stations/metro.json": [] };
const env = { ASSETS: { fetch: async (req) => { const p = new URL(req.url).pathname; const v = stops[p] || lists[p]; return v ? new Response(JSON.stringify(v)) : new Response("no", { status: 404 }); } } };
let plannerAnswers = true;
globalThis.fetch = async (u) => {
  const url = new URL(String(u));
  if (url.pathname.includes("realtime/sydneytrains")) {
    // The feed has news for Thirroul (before yours), Coledale (yours, 2 min late) and Central only.
    return new Response(feed([tripUpdate("run-sco", [[1, "2500211", s(-5) + 120, 120], [2, "2515111", s(0) + 120, 120], [9, "2000323", s(60) + 120, 120]])]));
  }
  if (url.pathname.endsWith("/tp/trip")) {
    if (!plannerAnswers) return new Response("{}", { status: 200 });
    return new Response(JSON.stringify({ journeys: [{ legs: [{
      isRealtimeControlled: false,
      transportation: { disassembledName: "SCO", destination: { name: "Central" }, properties: { RealtimeTripId: "run-sco" } },
      origin: { departureTimePlanned: at(0) },
      stopSequence: [
        { id: "2515111", name: "Coledale Station, Platform 1", disassembledName: "Coledale Station, Platform 1", coord: [-34.29, 150.94], departureTimePlanned: at(0) },
        { id: "2515112", name: "Austinmer Station, Platform 1", disassembledName: "Austinmer Station, Platform 1", coord: [-34.3, 150.93], departureTimePlanned: at(3) },
        { id: "2000323", name: "Central Station, Platform 23", disassembledName: "Central Station, Platform 23", coord: [-33.88, 151.2], arrivalTimePlanned: at(60) },
      ],
    }] }] }), { status: 200 });
  }
  return new Response("{}", { status: 503 });
};
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const q = { trip: "run-sco", mode: "train", line: "SCO", stop: "2515111", destId: "200060", planned: at(0) };

test("stops from yours onwards from the planner, the feed's earlier stops kept, live times from the feed", async () => {
  const d = await W.service(env, q);
  assert.deepEqual(d.stops.map((x) => x.id), ["2500211", "2515111", "2515112", "2000323"]);
  assert.equal(d.mineIndex, 1);
  assert.equal(d.source, "planner");
  assert.equal(d.stopsStatus, "ok");
  assert.equal(d.stops[1].estimated, new Date((s(0) + 120) * 1000).toISOString());
  // GTFS realtime: a delay holds for later stops the feed does not list, so Austinmer is 2 min late too, marked carried.
  assert.equal(d.stops[2].estimated, new Date(Date.parse(at(3)) + 120000).toISOString(), "the latest delay before a stop the feed has no news for carries on");
  assert.equal(d.stops[2].carried, true);
  assert.equal(d.stops[1].carried, false);
  assert.equal(d.progress, "live");
});

test("the planner without this run: the feed's list stays as it was", async () => {
  plannerAnswers = false;
  const d = await W.service(env, { ...q, planned: at(1) });
  assert.deepEqual(d.stops.map((x) => x.id), ["2500211", "2515111", "2000323"]);
  assert.equal(d.source, "feed");
  assert.equal(d.stopsStatus, "ok");
});
