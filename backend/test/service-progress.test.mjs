// Where a train is on its run, and how that is known (service(): progress, carried delays, the vehicle over the clock),
// and the trip watch never saying "change here" or "arriving" on the timetable alone. Runs offline with a fake feed and
// a fake planner. Cases on the T4 Illawarra line.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { service, oneStopCheck };\n";
const tmp = `/tmp/service-progress-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const varint = (n) => { const o = []; n = BigInt(n); if (n < 0n) n += 1n << 64n; do { let b = Number(n & 0x7fn); n >>= 7n; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const tag = (f, w) => varint((f << 3) | w);
const vint = (f, n) => [...tag(f, 0), ...varint(n)];
const bytes = (f, b) => [...tag(f, 2), ...varint(b.length), ...b];
const str = (f, s) => bytes(f, [...Buffer.from(s)]);
const f32 = (f, v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return [...tag(f, 5), ...b]; };
const nowS = () => Math.floor(Date.now() / 1000);
const feed = (entities) => new Uint8Array([...bytes(1, [...str(1, "2.0"), ...vint(3, nowS())]), ...entities.flatMap((e) => bytes(2, e))]);
const tripUpdate = (tripId, stus) => [...str(1, tripId), ...bytes(3, [...bytes(1, str(1, tripId)), ...vint(4, nowS()),
  ...stus.flatMap(([seq, stopId, delay]) => bytes(2, [...vint(1, seq), ...str(4, stopId), ...bytes(3, [...vint(1, delay)])]))])];
const vehicle = (tripId, lat, lon) => [...str(1, "v-" + tripId), ...bytes(4, [...bytes(1, str(1, tripId)), ...bytes(2, [...f32(1, lat), ...f32(2, lon)]), ...vint(5, nowS())])];

const MIN = 60000;
const RUN = [["2220111", "Hurstville Station, Platform 1", -33.9675, 151.1022, 0], ["2217111", "Kogarah Station, Platform 1", -33.9632, 151.1335, 3],
  ["2216111", "Rockdale Station, Platform 1", -33.9524, 151.1371, 5], ["2205111", "Wolli Creek Station, Platform 1", -33.9286, 151.1545, 9]];
const shards = {};
for (const [id, name, lat, lon] of RUN) (shards["/stops/" + id.slice(0, 3) + ".json"] ||= {})[id] = [name, lat, lon];
const lists = { "/stations/train.json": [["200060", "Central Station", -33.88, 151.2]], "/stations/metro.json": [] };
const env = { ASSETS: { fetch: async (req) => { const p = new URL(req.url).pathname; const v = shards[p] || lists[p]; return v ? new Response(JSON.stringify(v)) : new Response("no", { status: 404 }); } } };

// Per case: the run's start time, the feed entities (null: the feed does not answer) and the planner's run.
let cur = null;
globalThis.fetch = async (u) => {
  const url = new URL(String(u));
  if (url.pathname.includes("realtime/sydneytrains")) return cur.tu ? new Response(feed(cur.tu)) : new Response("no", { status: 503 });
  if (url.pathname.includes("vehiclepos/sydneytrains")) return cur.vp ? new Response(feed(cur.vp)) : new Response("no", { status: 503 });
  if (url.pathname.endsWith("/tp/trip")) {
    const at = (m) => new Date(cur.base + m * MIN).toISOString();
    return new Response(JSON.stringify({ journeys: [{ legs: [{
      isRealtimeControlled: false,
      transportation: { disassembledName: "T4", destination: { name: "Central" }, properties: { RealtimeTripId: cur.trip } },
      origin: { departureTimePlanned: at(0) },
      stopSequence: RUN.map(([id, name, lat, lon, m], k) => ({ id, name, disassembledName: name, coord: [lat, lon], ...(k === RUN.length - 1 ? { arrivalTimePlanned: at(m) } : { departureTimePlanned: at(m) }) })),
    }] }] }), { status: 200 });
  }
  return new Response("{}", { status: 503 });
};
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const ask = (c) => { cur = c; return W.service(env, { trip: c.trip, mode: "train", line: "T4", stop: "2220111", to: "2205111", destId: "200060", planned: new Date(c.base).toISOString() }); };

test("a delay the feed gives only at your stop carries on to your stop off, and progress follows live times", async () => {
  const base = Math.floor((Date.now() + 2 * MIN) / 1000) * 1000;
  const d = await ask({ trip: "t4-carry", base, tu: [tripUpdate("t4-carry", [[1, "2220111", 540]])], vp: null });
  assert.equal(d.progress, "live");
  assert.equal(d.alightIndex, 3);
  assert.equal(d.stops[3].estimated, new Date(base + 18 * MIN).toISOString(), "Wolli Creek 9 + 9 min");
  assert.equal(d.stops[3].carried, true);
  assert.equal(d.nextIndex, 0, "the late train has not left your stop");
});

test("a fresh vehicle position behind the clock wins, even only 2 stops behind", async () => {
  // On time by the feed, so the clock says Rockdale is next, but the train is standing at Hurstville.
  const base = Math.floor((Date.now() - 4 * MIN) / 1000) * 1000;
  const d = await ask({ trip: "t4-veh", base, tu: [tripUpdate("t4-veh", [[1, "2220111", 0]])], vp: [vehicle("t4-veh", -33.9676, 151.1023)] });
  assert.equal(d.progress, "vehicle");
  assert.equal(d.nextIndex, 0);
});

test("no live data: progress is the timetable, and the watch's one stop check never says the next stop is yours", async () => {
  const base = Math.floor((Date.now() - 7 * MIN) / 1000) * 1000;
  const d = await ask({ trip: "t4-tt", base, tu: null, vp: null });
  assert.equal(d.progress, "timetable");
  assert.equal(d.nextIndex, 3, "the clock alone says Wolli Creek is next");
  cur = { trip: "t4-tt2", base, tu: null, vp: null };
  const c = await W.oneStopCheck(env, { mode: "train", line: "T4", tripId: "t4-tt2", stopId: "2220111", toStopId: "2205111", destId: "200060", planned: new Date(base).toISOString() });
  assert.equal(c.nextIsYours, false);
  assert.equal(c.notLive, true);
});
