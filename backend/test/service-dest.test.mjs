// A train's destination stop for its stop list. The departure board can carry the stop id of a station on the way
// (Central's id on T1 trains running through the city to Hornsby), so the stop list ended at Central or the train was
// not found. The id now comes from the destination's own name when that is one of our stations, and the planner is
// asked for direct services only. Runs offline against the worker source with a fake data service.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
async function loadWorker() {
  let src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {");
  src += "\nexport { service, departures, railDestKey, railDestId, railDestMap, feedEndsShort };\n";
  const tmp = `/tmp/service-dest-test-${process.pid}-${Date.now()}.mjs`;
  fs.writeFileSync(tmp, src);
  try { return await import(tmp); } finally { fs.unlinkSync(tmp); }
}

// The station lists the server publishes, read through the assets binding (a few rows).
const lists = {
  "/stations/train.json": [["207720", "Hornsby Station", -33.70347, 151.09836], ["200060", "Central Station", -33.88, 151.2], ["214810", "Blacktown Station", -33.77, 150.9], ["228810", "Newcastle Interchange", -32.92, 151.76]],
  "/stations/metro.json": [["2155384", "Tallawong Station", -33.69, 150.9]],
  "/stops/200.json": { "2000323": ["Central Station, Platform 23", -33.88, 151.2] },
  "/stops/207.json": { "2077211": ["Hornsby Station, Platform 1", -33.70, 151.09] },
};
const env = { ASSETS: { fetch: async (req) => { const p = new URL(req.url).pathname; return lists[p] ? new Response(JSON.stringify(lists[p]), { status: 200 }) : new Response("no", { status: 404 }); } } };

const base = Date.now() + 10 * 60000;
const at = (m) => new Date(base + m * 60000).toISOString();
let tripAsked = [];
let tripPlan = [];
const leg = (id, line, t0) => ({
  isRealtimeControlled: false,
  transportation: { disassembledName: line, destination: { name: "Hornsby via Gordon" }, properties: { RealtimeTripId: id } },
  origin: { departureTimePlanned: at(t0) },
  stopSequence: [
    { id: "2148535", name: "Blacktown Station, Platform 5", disassembledName: "Blacktown Station, Platform 5", coord: [-33.77, 150.9], departureTimePlanned: at(t0) },
    { id: "2077211", name: "Hornsby Station, Platform 1", disassembledName: "Hornsby Station, Platform 1", coord: [-33.70, 151.09], arrivalTimePlanned: at(t0 + 70) },
  ],
});
globalThis.fetch = async (u) => {
  const url = new URL(String(u));
  if (url.pathname.endsWith("/tp/trip") && tripPlan.length) {
    tripAsked.push(Object.fromEntries(url.searchParams));
    return new Response(JSON.stringify(tripPlan.shift()), { status: 200 });
  }
  if (url.pathname.endsWith("/tp/trip")) {
    tripAsked.push(Object.fromEntries(url.searchParams));
    return new Response(JSON.stringify({ journeys: [{ legs: [{
      isRealtimeControlled: false,
      transportation: { disassembledName: "T1", destination: { name: "Hornsby via Gordon" }, properties: { RealtimeTripId: "run-p1" } },
      origin: { departureTimePlanned: at(0) },
      stopSequence: [
        { id: "2148531", name: "Blacktown Station, Platform 1", disassembledName: "Blacktown Station, Platform 1", coord: [-33.77, 150.9], departureTimePlanned: at(0) },
        { id: "2147421", name: "Seven Hills Station, Platform 1", disassembledName: "Seven Hills Station, Platform 1", coord: [-33.77, 150.93], departureTimePlanned: at(3) },
        { id: "2077211", name: "Hornsby Station, Platform 1", disassembledName: "Hornsby Station, Platform 1", coord: [-33.70, 151.09], arrivalTimePlanned: at(70) },
      ],
    }] }] }), { status: 200 });
  }
  if (url.pathname.endsWith("/tp/departure_mon")) {
    const ev = (cls, line, name, id, trip) => ({
      location: { id: "2148531", name: "Blacktown Station, Platform 1", properties: { platformName: "Platform 1" } },
      departureTimePlanned: at(0), isRealtimeControlled: false,
      transportation: { disassembledName: line, number: line, product: { class: cls }, destination: { id, name } },
      properties: { RealtimeTripId: trip },
    });
    return new Response(JSON.stringify({ locations: [{ id: "214810", name: "Blacktown Station" }], stopEvents: [
      ev(1, "T1", "Hornsby via Gordon", "10101100", "run-p1"),
      ev(1, "T2", "City Circle via Museum", "10101100", "run-cc"),
      ev(5, "734", "Schofields", "10115603", "run-bus"),
    ] }), { status: 200 });
  }
  return new Response("{}", { status: 503 });
};
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const W = await loadWorker();

test("destination names map to station names", () => {
  assert.equal(W.railDestKey("Hornsby via Gordon"), "hornsby");
  assert.equal(W.railDestKey("Hornsby Station"), "hornsby");
  assert.equal(W.railDestKey("Newcastle Interchange"), "newcastle");
  assert.equal(W.railDestKey("North Sydney via Central"), "north sydney");
});

test("a train's destination id comes from its name; an unknown name, a bus or no list keeps the id sent", async () => {
  const map = await W.railDestMap(env);
  assert.equal(W.railDestId(map, "train", "Hornsby via Gordon", "10101100"), "207720");
  assert.equal(W.railDestId(map, "metro", "Tallawong", "x"), "2155384");
  assert.equal(W.railDestId(map, "train", "City Circle via Museum", "10101100"), "10101100");
  assert.equal(W.railDestId(map, "bus", "Hornsby", "2077100"), "2077100");
  assert.equal(W.railDestId(new Map(), "train", "Hornsby via Gordon", "10101100"), "10101100");
});

test("departures carry the destination station's id for trains and leave buses alone", async () => {
  const d = await W.departures(env, "214810", { log: false });
  const by = Object.fromEntries(d.items.map((i) => [i.tripId, i.destId]));
  assert.equal(by["run-p1"], "207720");
  assert.equal(by["run-cc"], "10101100");
  assert.equal(by["run-bus"], "10115603");
});

test("the stop list is asked to the named station, direct services only, and runs to the end of the line", async () => {
  tripAsked = [];
  const d = await W.service(env, { trip: "run-p1", mode: "train", line: "T1", stop: "2148531", destId: "10101100", dest: "Hornsby via Gordon", planned: at(0) });
  assert.equal(tripAsked.length, 1);
  assert.equal(tripAsked[0].name_destination, "207720");
  assert.equal(tripAsked[0].maxChanges, "0");
  assert.equal(d.stopsStatus, "ok");
  assert.equal(d.mineIndex, 0);
  assert.match(d.stops[d.stops.length - 1].name, /^Hornsby/);
});

test("an app that sends no destination name still gets direct services only", async () => {
  tripAsked = [];
  await W.service(env, { trip: "run-p1", mode: "train", line: "T1", stop: "2148531", destId: "207720", planned: at(1) });
  assert.equal(tripAsked[0].name_destination, "207720");
  assert.equal(tripAsked[0].maxChanges, "0");
});

test("a run the live planner leaves out is found in the timetable, this mode only; another train in the same minute is never used", async () => {
  tripAsked = [];
  // Live answer: only the other T1 leaving the same minute from platform 5. Timetable answer: this run.
  tripPlan = [{ journeys: [{ legs: [leg("run-p5", "T1", 0)] }] }, { journeys: [{ legs: [leg("run-p5", "T1", 0)] }, { legs: [leg("run-x", "T1", 0)] }] }];
  const d = await W.service(env, { trip: "run-x", mode: "train", line: "T1", stop: "2148535", destId: "207720", planned: at(2) });
  assert.equal(tripAsked.length, 2);
  assert.equal(tripAsked[0].TfNSWTR, "true");
  assert.equal(tripAsked[1].TfNSWTR, undefined);
  assert.equal(tripAsked[1].calcNumberOfTrips, "6");
  assert.equal(tripAsked[1].excludedMeans, "checkbox");
  assert.equal(tripAsked[1].exclMOT_2, "1");
  assert.equal(tripAsked[1].exclMOT_1, undefined);
  assert.equal(d.stopsStatus, "ok");
  assert.equal(d.stops.length, 2);

  // Neither answer has the run: no stop list, rather than the other train's.
  tripAsked = [];
  tripPlan = [{ journeys: [{ legs: [leg("run-p5", "T1", 0)] }] }, { journeys: [{ legs: [leg("run-p5", "T1", 0)] }] }];
  const e = await W.service(env, { trip: "run-y", mode: "train", line: "T1", stop: "2148535", destId: "207720", planned: at(0) });
  assert.equal(e.stops.length, 0);
  assert.equal(e.stopsStatus, "notFound");
});

test("a train's live list that stops before its destination station is called short; one that reaches it, or an unknown end, is not", async () => {
  const q = { stop: "2148535", destId: "207720", planned: at(0) };
  const toCentral = [{ id: "2148535" }, { id: "2000323" }];
  const toHornsby = [{ id: "2148535" }, { id: "2077211" }];
  assert.equal(await W.feedEndsShort(env, q, "train", toCentral), true);
  assert.equal(await W.feedEndsShort(env, q, "train", toHornsby), false);
  assert.equal(await W.feedEndsShort(env, { ...q, dest: "Hornsby via Gordon", destId: "10101100" }, "train", toCentral), true);
  assert.equal(await W.feedEndsShort(env, { ...q, destId: "999" }, "train", toCentral), false);
  assert.equal(await W.feedEndsShort(env, q, "bus", toCentral), false);
});
