// Old apps and server steps C and D (27 Oct crash review). Bidur's phone crash looped at 10:42 AM while server D
// (f8c60d91) was live; it ran fine on server B (2aff7f9b) before and after. Phones on builds 201 to 208, the 26 Oct
// update 27efc6bd and the crash net ecb0882d (all "older apps") never send x-device or x-profile headers. This replays
// what such a phone asks and checks every answer has the shape server B gave (test/fixtures/old-client-b.json, made by
// running this file against server B's own source: COMPAT_SRC=<dir with B's worker.js, engine.js, raptor.js>
// COMPAT_WRITE=1). A phone that sends x-device (the newer app) still gets the steps C and D answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { efaTrip } from "./helpers/efa.mjs";

const here = new URL(".", import.meta.url).pathname;
const dir = process.env.COMPAT_SRC || new URL("../src/", import.meta.url).pathname;
const src = fs.readFileSync(dir + "/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(dir + "/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(dir + "/raptor.js", "utf8") + "\nexport { __default, edgeKey };\n";
const tmp = `/tmp/old-client-compat-${process.pid}-${Date.now()}.mjs`;
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
// Sydney Trains as it really sends it: delays with no clock times and no stop sequences.
const delayOnlyNoSeq = (tripId, stus) => [...str(1, tripId), ...bytes(3, [...bytes(1, str(1, tripId)), ...vint(4, Math.floor(Date.now() / 1000)),
  ...stus.flatMap(([stopId, delay]) => bytes(2, [...str(4, stopId), ...bytes(3, vint(1, delay))]))])];

const nowS = Math.floor(Date.now() / 1000);
const dayStart = nowS - 3600;
const planned = nowS + 8 * 60;
const stops = { "/stops/213.json": { "2135113": ["Chatswood Station, Platform 3", -33.87, 151.09], "2135101": ["Lidcombe Station, Platform 1", -33.86, 151.04] },
  "/stops/200.json": { "2000331": ["Central Station, Platform 17", -33.88, 151.2] } };
const lists = { "/stations/train.json": [["200060", "Central Station", -33.88, 151.2], ["206710", "Chatswood Station", -33.87, 151.09]] };
const ENGINE = { idFromName: (n) => n, get: () => ({ fetch: async (u) => {
  const url = new URL(u);
  if (url.pathname === "/trip") {
    if (url.searchParams.get("trip") !== "t1-delay") return Response.json({ v: 1, trip: url.searchParams.get("trip"), stops: [] });
    return Response.json({ v: 1, trip: "t1-delay", stops: [
      { id: "2135101", seq: 2, planned: (planned - 6 * 60) * 1000, name: "Lidcombe Station, Platform 1", lat: -33.86, lon: 151.04 },
      { id: "2135113", seq: 5, planned: planned * 1000, name: "Chatswood Station, Platform 3", lat: -33.87, lon: 151.09 },
      { id: "2000331", seq: 9, planned: (planned + 16 * 60) * 1000, name: "Central Station, Platform 17", lat: -33.88, lon: 151.2 }] });
  }
  if (url.pathname === "/timetable") {
    const seq = url.searchParams.get("seq") === "1";
    const row = (t, trip, sq) => (seq ? [t - dayStart, trip, 0, 0, 0, sq] : [t - dayStart, trip, 0, 0, 0]);
    const all = { "2135113": { stops: ["2135113"], days: { "20261027": { start: dayStart, rows: [row(planned, "t1-delay", 5)] } } },
      "2000331": { stops: ["2000331"], days: { "20261027": { start: dayStart, rows: [row(planned + 16 * 60, "t1-delay", 9)] } } } };
    const want = (url.searchParams.get("stops") || "").split(",");
    return Response.json({ v: 1, routes: [["T1", 1]], heads: ["Hornsby"], stops: Object.fromEntries(Object.entries(all).filter(([k]) => want.includes(k))) });
  }
  return new Response("no", { status: 404 });
} }) };
const env = { TFNSW_API_KEY: "t", ENGINE, ASSETS: { fetch: async (req) => { const p = new URL(req.url).pathname; const v = stops[p] || lists[p]; return v ? new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } }) : new Response("no", { status: 404 }); } } };
let plannerDelay = 0, tripAnswer = null;
globalThis.fetch = async (u) => {
  const url = new URL(String(u.url || u));
  if (url.pathname.includes("realtime/sydneytrains")) {
    return new Response(feed([delayOnlyNoSeq("t1-delay", [["2135101", 180]]), tripUpdate("t1-live", [[5, "2135113", nowS + 4 * 60, 120], [9, "2000331", nowS + 20 * 60, 120]])]));
  }
  if (url.pathname.endsWith("/tp/trip") && tripAnswer) return new Response(JSON.stringify(tripAnswer), { status: 200 });
  if (url.pathname.endsWith("/tp/trip") || url.pathname.endsWith("/tp/departure_mon")) {
    if (plannerDelay) await new Promise((r) => setTimeout(r, plannerDelay));
    return new Response("{}", { status: 503 });
  }
  return new Response("{}", { status: 503 });
};
const edge = new Map();
globalThis.caches = { default: { match: async (req) => { const e = edge.get(String(req.url || req)); return e ? new Response(e.body, { status: e.status || 200, headers: e.headers }) : undefined; }, put: async (req, res) => { edge.set(String(req.url || req), { body: await res.text(), status: res.status, headers: [...res.headers] }); }, delete: async () => true } };
const behind = [];
const exec = { waitUntil: (p) => { behind.push(Promise.resolve(p).catch(() => null)); } };
const settle = async () => { for (let n = -1; n !== behind.length;) { n = behind.length; await Promise.all(behind); await new Promise((r) => setTimeout(r, 20)); } };
let ip = 1;
const call = async (path, headers = {}) => {
  const h = new Headers(headers); h.set("cf-connecting-ip", "10.13.0." + (ip++ % 250));
  const r = await W.__default.fetch(new Request("https://api.transportsydney.app" + path, { headers: h }), env, exec);
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch (e) { body = null; }
  return { status: r.status, body, text, headers: r.headers };
};

// The shape of an answer: every key and the type of its value, arrays by the shapes their items take.
// A list of plain values (a timetable row, a station [id, name, lat, lon]) is a tuple: its length and each place count.
function shape(v) {
  if (v === null) return "null";
  if (Array.isArray(v) && v.length && v.every((x) => x === null || typeof x !== "object")) return { tuple: v.map((x) => (x === null ? "null" : typeof x)) };
  if (Array.isArray(v)) return [...new Set(v.map((x) => JSON.stringify(shape(x))))].sort().map((x) => JSON.parse(x));
  if (typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape(v[k])]));
  return typeof v;
}
// Headers a phone could see (dates and ids that change per run left out).
const SKIP_HEADERS = new Set(["date", "x-quick-ms-skip"]);
const headerNames = (h) => [...h.keys()].filter((k) => !SKIP_HEADERS.has(k)).sort();

const OLD = "&device=app-old&profile=u-old";
const SERVICE_LIVE = "/api/service?trip=t1-live&mode=train&line=T1&stop=2135113&destId=200060&dest=Hornsby&planned=" + encodeURIComponent(new Date((nowS + 2 * 60) * 1000).toISOString());
const SERVICE = "/api/service?trip=t1-delay&mode=train&line=T1&stop=2135113&destId=200060&dest=Hornsby&planned=" + encodeURIComponent(new Date(planned * 1000).toISOString());
const got = {};

async function replay() {
  // 1. The service screen (and the full board's stop names) for a Sydney Trains train with delay only news, the full
  //    answer slow: the quick answer is what an old phone gets first.
  plannerDelay = 1000;
  const svc = await call(SERVICE + OLD);
  got.service = { status: svc.status, tag: svc.headers.get("x-edge-cache"), headers: headerNames(svc.headers), shape: shape(svc.body), source: svc.body && svc.body.source, stops: svc.body && svc.body.stops ? svc.body.stops.length : null };
  await settle();
  // The same for a train whose feed has clock times: the feed's own quick answer, as server B gave it.
  edge.clear();
  const live = await call(SERVICE_LIVE + OLD);
  got.serviceLive = { status: live.status, tag: live.headers.get("x-edge-cache"), headers: headerNames(live.headers), shape: shape(live.body), source: live.body && live.body.source, stops: live.body && live.body.stops ? live.body.stops.map((s) => s.id) : null };
  await settle();
  plannerDelay = 0;
  // 2. A station list copy kept from before tags existed (lists are kept 6 hours).
  edge.clear();
  const key = W.edgeKey(new URL("https://api.transportsydney.app/api/stations?mode=ferry")).url;
  edge.set(key, { body: JSON.stringify([["F1", "Circular Quay", -33.86, 151.21]]), headers: [["content-type", "application/json"], ["x-stored-at", String(Date.now() - 60000)]] });
  const kept = await call("/api/stations?mode=ferry" + OLD);
  got.stationsKept = { status: kept.status, headers: headerNames(kept.headers), shape: shape(kept.body) };
  // 3. A fresh station list.
  const fresh = await call("/api/stations?mode=train" + OLD);
  got.stationsFresh = { status: fresh.status, headers: headerNames(fresh.headers), shape: shape(fresh.body) };
  // 4. /api/timetable for one day after trip-live (a newer phone) asked the engine for the same stops.
  await call("/api/trip/live?legs=" + ["t1-delay", "2135113", "2000331", "train", "T1"].map(encodeURIComponent).join("@"), { "x-device": "app-new" });
  await settle();
  const tt = await call("/api/timetable?stops=2135113,2000331&days=1" + OLD);
  got.timetable = { status: tt.status, shape: shape(tt.body) };
  // 5. Home's commute trip: one service in 20 min running 2 min late, one 3 hours out whose estimate echoes the timetable.
  tripAnswer = efaTrip([[{ from: "chatswood", to: "bondijunction", dep: Date.now() + 20 * 60000, delay: 2, line: "T2" }],
    [{ from: "chatswood", to: "bondijunction", dep: Date.now() + 180 * 60000, delay: 0, line: "T2" }]]);
  const trip = await call("/api/trip?from=206710&to=202210&count=3" + OLD);
  tripAnswer = null;
  got.trip = { status: trip.status, headers: headerNames(trip.headers), shape: shape(trip.body) };
  return got;
}

const fixture = here + "fixtures/old-client-b.json";
if (process.env.COMPAT_WRITE) {
  await replay();
  fs.writeFileSync(fixture, JSON.stringify(got, null, 1) + "\n");
  console.log("wrote", fixture);
} else {
  const want = JSON.parse(fs.readFileSync(fixture, "utf8"));
  await replay();

  test("an old app's service screen gets server B's answer for a delay only train: same shape, headers and stop list", () => {
    assert.deepEqual(got.service, want.service);
  });
  test("an old app's service screen gets server B's quick answer from the feed for a train with clock times", () => {
    assert.deepEqual(got.serviceLive, want.serviceLive);
  });
  test("an old app gets a kept station list copy as server B gave it (no tag added)", () => {
    assert.deepEqual(got.stationsKept, want.stationsKept);
    assert.deepEqual(got.stationsFresh, want.stationsFresh);
  });
  test("/api/timetable keeps five value rows, even after trip-live asked the engine for the same stops", () => {
    assert.deepEqual(got.timetable, want.timetable);
  });
  test("Home's commute trip has the keys and types server B gave (6b461ff: a far echoed leg says realtime false, source null)", () => {
    assert.equal(got.trip.status, want.trip.status);
    assert.deepEqual(got.trip.headers, want.trip.headers);
    const paths = (o, p = "") => (o && typeof o === "object" && !Array.isArray(o) ? (o.tuple ? [p + "=" + o.tuple.join(",")] : Object.entries(o).flatMap(([k, v]) => paths(v, p + "." + k)))
      : Array.isArray(o) ? (o.length ? o.flatMap((x) => paths(x, p + "[]")) : [p + "=[]"]) : [p + "=" + o]);
    const b = new Set(paths(want.trip.shape)), g = new Set(paths(got.trip.shape));
    const keyOf = (x) => x.slice(0, x.lastIndexOf("="));
    assert.deepEqual([...new Set([...g].map(keyOf))].sort(), [...new Set([...b].map(keyOf))].sort(), "same keys");
    // A value is null only where server B could already say null for it (leg source is null on a leg with no live reading).
    for (const x of g) if (!b.has(x)) assert.ok(x.endsWith("=null") && keyOf(x) === ".journeys[].legs[].source", "new type at " + x);
  });
  test("a newer app (x-device) still gets the steps C and D answers", async () => {
    edge.clear(); plannerDelay = 1000;
    const svc = await call(SERVICE.replace("dest=Hornsby", "dest=Hornsby&n=1"), { "x-device": "app-new", "x-profile": "u-new" });
    await settle(); plannerDelay = 0;
    assert.equal(svc.headers.get("x-edge-cache"), "quick");
    assert.equal(svc.body.source, "timetable");
    assert.deepEqual(svc.body.stops.map((s) => s.id), ["2135101", "2135113", "2000331"]);
    assert.match(svc.headers.get("x-quick-ms") || "", /^\d+$/);
    edge.clear();
    const key = W.edgeKey(new URL("https://api.transportsydney.app/api/stations?mode=ferry")).url;
    edge.set(key, { body: JSON.stringify([["F1", "Circular Quay", -33.86, 151.21]]), headers: [["content-type", "application/json"], ["x-stored-at", String(Date.now() - 60000)]] });
    const kept = await call("/api/stations?mode=ferry", { "x-device": "app-new" });
    assert.match(kept.headers.get("etag") || "", /^"[0-9a-f]{24}"$/);
  });
  test("every answer still says x-serves (an old app reads no headers; a newer app finds the paths through it)", () => {
    for (const k of ["service", "serviceLive", "stationsKept", "stationsFresh", "trip"]) assert.ok(got[k].headers.includes("x-serves"), k);
  });
}
