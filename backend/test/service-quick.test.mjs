// The service detail screen's first answer (27 Oct, 9:10 AM: "T1 to Berowra" stuck on "Loading live times" and "Finding
// the vehicle"). A train's whole stop list waits on the Trip Planner (four tries of up to 8 s; 18 s measured at 9:22 AM on
// production). Now a service with no copy waits at most SERVICE_QUICK_MS for the full answer, then gets the feed's own
// answer (stops with live times, vehicle), marked partial and never stored; the full answer is stored behind it for the
// next poll. Runs offline with a fake feed and a slow fake planner.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default, SERVICE_QUICK_MS, plannerLegMem, memCacheMap };\n";
const tmp = `/tmp/service-quick-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

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
const env = { TFNSW_API_KEY: "t", ASSETS: { fetch: async (req) => { const p = new URL(req.url).pathname; const v = stops[p] || lists[p]; return v ? new Response(JSON.stringify(v)) : new Response("no", { status: 404 }); } } };
let plannerDelay = 0, plannerCalls = 0, feedTrips = ["run-a", "run-b", "run-c"];
globalThis.fetch = async (u, init) => {
  const url = new URL(String(u.url || u));
  if (url.pathname.includes("realtime/sydneytrains")) {
    return new Response(feed(feedTrips.map((t) => tripUpdate(t, [[1, "2500211", s(-5) + 120, 120], [2, "2515111", s(0) + 120, 120], [9, "2000323", s(60) + 120, 120]]))));
  }
  if (url.pathname.endsWith("/tp/trip")) {
    plannerCalls++;
    if (plannerDelay) await new Promise((r) => setTimeout(r, plannerDelay));
    return new Response(JSON.stringify({ journeys: [{ legs: [{
      isRealtimeControlled: false,
      transportation: { disassembledName: "SCO", destination: { name: "Central" }, properties: { RealtimeTripId: (url.searchParams.get("itdTime") && globalThis.__trip) || "run-a" } },
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
const edge = new Map();
globalThis.caches = { default: { match: async (req) => { const e = edge.get(String(req.url || req)); return e ? new Response(e.body, { headers: e.headers }) : undefined; }, put: async (req, res) => { edge.set(String(req.url || req), { body: await res.text(), headers: [...res.headers] }); }, delete: async () => true } };
const behind = [];
async function settle() { for (let n = -1; n !== behind.length;) { n = behind.length; await Promise.all(behind); await new Promise((r) => setTimeout(r, 20)); } }
const exec = { waitUntil: (p) => { behind.push(Promise.resolve(p).catch(() => null)); } };
let ip = 1;
const get = async (path, envX = env) => {
  const t0 = Date.now();
  const r = await W.__default.fetch(new Request("https://api.transportsydney.app" + path, { headers: { "cf-connecting-ip": "10.11.0." + (ip++ % 250) } }), envX, exec);
  return { status: r.status, body: await r.json(), tag: r.headers.get("x-edge-cache"), cc: r.headers.get("cache-control"), ms: Date.now() - t0 };
};
const path = (trip) => `/api/service?trip=${trip}&mode=train&line=SCO&stop=2515111&destId=200060&dest=Central&planned=${encodeURIComponent(at(0))}&profile=p1&device=d1`;

test("a slow planner: the feed's stops and live times come first, marked partial and not stored; the full list follows", { timeout: 30000 }, async () => {
  globalThis.__trip = "run-a"; plannerDelay = 4000; plannerCalls = 0;
  const r = await get(path("run-a"));
  assert.equal(r.status, 200);
  assert.ok(r.ms < W.SERVICE_QUICK_MS + 1500, `answered in ${r.ms} ms`);
  assert.equal(r.tag, "quick");
  assert.equal(r.cc, "no-store");
  assert.equal(r.body.partial, true);
  assert.deepEqual(r.body.stops.map((x) => x.id), ["2500211", "2515111", "2000323"]);
  assert.ok(r.body.stops.some((x) => x.estimated), "live times from the feed");
  assert.equal(r.body.mineIndex, 1);
  await settle();
  // The full answer finished behind it and is the copy for the next poll.
  plannerDelay = 0;
  const calls = plannerCalls;
  const r2 = await get(path("run-a"));
  assert.notEqual(r2.body.partial, true);
  assert.equal(r2.body.source, "planner");
  assert.deepEqual(r2.body.stops.map((x) => x.id), ["2500211", "2515111", "2515112", "2000323"]);
  assert.equal(plannerCalls, calls, "no second planner call");
});

test("a fast planner is unchanged: the full answer, no partial", { timeout: 30000 }, async () => {
  globalThis.__trip = "run-b"; plannerDelay = 0;
  const r = await get(path("run-b"));
  assert.equal(r.tag, "miss");
  assert.notEqual(r.body.partial, true);
  assert.equal(r.body.stops.length, 4);
});

test("no feed stops for the trip: it waits for the full answer as before; SERVICE_QUICK=off waits too", { timeout: 30000 }, async () => {
  globalThis.__trip = "run-z"; plannerDelay = 1500; feedTrips = ["run-a"];
  const r = await get(path("run-z"));
  assert.ok(r.ms >= 1400);
  assert.notEqual(r.tag, "quick");
  globalThis.__trip = "run-c"; feedTrips = ["run-c"];
  const r2 = await get(path("run-c"), { ...env, SERVICE_QUICK: "off" });
  assert.ok(r2.ms >= 1400);
  assert.notEqual(r2.body.partial, true);
  plannerDelay = 0;
});

test("a plain open with a kept copy under a minute old gets it at once (labelled), a poll still waits briefly for fresh", { timeout: 30000 }, async () => {
  globalThis.__trip = "run-k"; plannerDelay = 4000; feedTrips = ["run-k"];
  const p = path("run-k");
  const key = new URL("https://api.transportsydney.app" + p);
  for (const k of ["profile", "device"]) key.searchParams.delete(k);
  const sorted = new URL(key.origin + key.pathname);
  [...key.searchParams.keys()].sort().forEach((k) => sorted.searchParams.append(k, key.searchParams.get(k)));
  const storedAt = Date.now() - 30000;
  edge.set(sorted.toString(), { body: JSON.stringify({ kind: "service", stops: [{ id: "a" }, { id: "b" }], now: storedAt }), headers: [["content-type", "application/json"], ["x-stored-at", String(storedAt)]] });
  const r = await get(p);
  assert.ok(r.ms < 400, `plain open answered in ${r.ms} ms`);
  assert.equal(r.tag, "stale");
  assert.equal(r.body.dataAt, storedAt, "labelled with the copy's age");
  const r2 = await get(p + "&refresh=1");
  assert.ok(r2.ms >= 600, `a poll waited ${r2.ms} ms for fresh times first`);
  plannerDelay = 0;
  await settle();
});
