// Train stop lists that read whole (item 3 D, 26 Oct): a train the feed marks as not stopping at some stations shows
// the timetable's full list with those stops marked, and a City Circle run shows the loop back to Central, whether the
// app names it (City Circle trains at Central) or the planner does (T2s from Liverpool). Offline, fake feed and planner.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { service };\n";
const tmp = `/tmp/service-loops-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const varint = (n) => { const o = []; n = BigInt(n); if (n < 0n) n += 1n << 64n; do { let b = Number(n & 0x7fn); n >>= 7n; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const tag = (f, w) => varint((f << 3) | w);
const vint = (f, n) => [...tag(f, 0), ...varint(n)];
const bytes = (f, b) => [...tag(f, 2), ...varint(b.length), ...b];
const str = (f, s) => bytes(f, [...Buffer.from(s)]);
const feed = (entities) => new Uint8Array([...bytes(1, [...str(1, "2.0"), ...vint(3, Math.floor(Date.now() / 1000))]), ...entities.flatMap((e) => bytes(2, e))]);
// stus: [seq, stopId, depS, delay, rel] (rel 1 = skipped)
const tripUpdate = (tripId, stus) => [...str(1, tripId), ...bytes(3, [...bytes(1, str(1, tripId)), ...vint(4, Math.floor(Date.now() / 1000)),
  ...stus.flatMap(([seq, stopId, depS, delay, rel]) => bytes(2, [...vint(1, seq), ...str(4, stopId), ...(rel ? vint(5, rel) : bytes(3, [...vint(1, delay), ...vint(2, depS)]))]))])];

const MIN = 60000;
const base = Math.floor((Date.now() + 10 * MIN) / 1000) * 1000;
const at = (m) => new Date(base + m * MIN).toISOString();
const s = (m) => Math.floor((base + m * MIN) / 1000);
const ST = {
  "2000323": ["Central Station, Platform 23", -33.883, 151.206], "2000317": ["Central Station, Platform 17", -33.883, 151.206],
  "2000071": ["Town Hall Station, Platform 6", -33.873, 151.207], "2000011": ["Wynyard Station, Platform 4", -33.866, 151.206],
  "2000021": ["Circular Quay Station, Platform 2", -33.861, 151.21], "2000271": ["St James Station, Platform 2", -33.871, 151.211],
  "2000411": ["Museum Station, Platform 2", -33.876, 151.21], "2000318": ["Central Station, Platform 18", -33.883, 151.206],
  "2150311": ["Redfern Station, Platform 3", -33.892, 151.199], "2042111": ["Erskineville Station, Platform 1", -33.9, 151.186],
  "2043111": ["St Peters Station, Platform 1", -33.907, 151.18], "2044111": ["Sydenham Station, Platform 1", -33.914, 151.167],
};
const lists = { "/stations/train.json": [["200060", "Central Station", -33.88, 151.2], ["200020", "Circular Quay Station", -33.86, 151.21], ["204410", "Sydenham Station", -33.91, 151.16]], "/stations/metro.json": [] };
const env = { ASSETS: { fetch: async (req) => { const p = new URL(req.url).pathname; if (lists[p]) return new Response(JSON.stringify(lists[p])); if (p.startsWith("/stops/")) return new Response(JSON.stringify(ST)); return new Response("no", { status: 404 }); } } };
const seqOf = (ids, start) => ids.map((id, i) => ({ id, name: ST[id][0] + ", Sydney", disassembledName: ST[id][0], coord: [ST[id][1], ST[id][2]], departureTimePlanned: at(start + i * 2), arrivalTimePlanned: at(start + i * 2) }));
const legOf = (trip, dest, ids, start, live) => ({ isRealtimeControlled: !!live, transportation: { disassembledName: "T8", destination: { name: dest }, properties: { RealtimeTripId: trip } }, origin: { departureTimePlanned: at(start) }, stopSequence: seqOf(ids, start) });
let feedTrips = [];
let planner = () => ({ journeys: [] });
const asked = [];
globalThis.fetch = async (u) => {
  const url = new URL(String(u));
  if (url.pathname.includes("realtime/sydneytrains")) return new Response(feed(feedTrips));
  if (url.pathname.endsWith("/tp/trip")) {
    const p = Object.fromEntries(url.searchParams);
    asked.push(p);
    return new Response(JSON.stringify(planner(p)), { status: 200 });
  }
  return new Response("{}", { status: 503 });
};
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

test("a train not stopping at some stations: the timetable's whole list, those stops marked skipped", async () => {
  // Central to Sydenham, all stops; the feed says it runs past Erskineville and St Peters today.
  feedTrips = [tripUpdate("run-skip", [[1, "2000323", s(0) + 60, 60], [2, "2150311", s(2) + 60, 60], [3, "2042111", 0, 0, 1], [4, "2043111", 0, 0, 1], [5, "2044111", s(8) + 60, 60]])];
  planner = (p) => {
    const all = ["2000323", "2150311", "2042111", "2043111", "2044111"];
    // The live planner leaves the stations the train runs past out of its list.
    return { journeys: [{ legs: [legOf("run-skip", "Sydenham", p.TfNSWTR ? ["2000323", "2150311", "2044111"] : all, 0, !!p.TfNSWTR)] }] };
  };
  const d = await W.service(env, { trip: "run-skip", mode: "train", line: "T8", stop: "2000323", destId: "204410", planned: at(0) });
  assert.deepEqual(d.stops.map((x) => x.id), ["2000323", "2150311", "2042111", "2043111", "2044111"]);
  assert.deepEqual(d.stops.map((x) => x.skipped), [false, false, true, true, false]);
  assert.equal(d.stops[1].estimated, at(3), "kept stops keep their live times");
});

test("City Circle at Central, named by the app: Central round the loop and back to Central", async () => {
  feedTrips = [];
  asked.length = 0;
  planner = (p) => {
    if (p.name_origin === "2000317" && p.name_destination === "200020") return { journeys: [{ legs: [legOf("run-cc", "City Circle via Town Hall", ["2000317", "2000071", "2000011", "2000021"], 0, true)] }] };
    if (p.name_origin === "2000021" && p.name_destination === "200060") return { journeys: [{ legs: [legOf("run-cc", "City Circle via Town Hall", ["2000021", "2000271", "2000411", "2000318"], 6, true)] }] };
    return { journeys: [] };
  };
  const d = await W.service(env, { trip: "run-cc", mode: "train", line: "T8", stop: "2000317", destId: "200060", dest: "City Circle via Town Hall", planned: at(0) });
  assert.deepEqual(d.stops.map((x) => x.id), ["2000317", "2000071", "2000011", "2000021", "2000271", "2000411", "2000318"]);
  assert.equal(d.stopsStatus, "ok");
  assert.ok(d.stops.every((x) => x.name && !x.name.startsWith(",")));
});

test("City Circle named only by the planner (a T2 from Liverpool): the list goes on past Central round the loop", async () => {
  feedTrips = [];
  planner = (p) => {
    if (p.name_origin === "2150311" && p.name_destination === "200060") return { journeys: [{ legs: [legOf("run-lv", "City Circle via Granville", ["2150311", "2000323"], 0, true)] }] };
    if (p.name_origin === "2150311" && p.name_destination === "200020") return { journeys: [{ legs: [legOf("run-lv", "City Circle via Town Hall", ["2150311", "2000323", "2000071", "2000011", "2000021"], 0, true)] }] };
    if (p.name_origin === "2000021" && p.name_destination === "200060") return { journeys: [{ legs: [legOf("run-lv", "City Circle via Town Hall", ["2000021", "2000271", "2000411", "2000318"], 8, true)] }] };
    return { journeys: [] };
  };
  const d = await W.service(env, { trip: "run-lv", mode: "train", line: "T2", stop: "2150311", destId: "200060", planned: at(0) });
  assert.deepEqual(d.stops.map((x) => x.id), ["2150311", "2000323", "2000071", "2000011", "2000021", "2000271", "2000411", "2000318"]);
});

test("a run that is not a City Circle asks once, as before", async () => {
  asked.length = 0;
  planner = (p) => (p.name_destination === "204410" ? { journeys: [{ legs: [legOf("run-x", "Sydenham", ["2150311", "2042111", "2044111"], 0, true)] }] } : { journeys: [] });
  const d = await W.service(env, { trip: "run-x", mode: "train", line: "T8", stop: "2150311", destId: "204410", planned: at(1) });
  assert.equal(d.stops.length, 3);
  assert.equal(asked.length, 1);
});
