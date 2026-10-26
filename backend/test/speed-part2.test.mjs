// Speed pass part 2 (27 Oct): the app's contract (e441749c) and the server's side of it. x-serves on every /api answer,
// device and profile read from x-device and x-profile (never part of a cache key), GET /api/trip/live re-timing held legs
// from the realtime feed with no Trip Planner call, strong ETags with 304s on station lists and packs, and no error
// answer kept in any cache. Runs offline with a fake feed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/raptor.js", "utf8") +
  "\nexport { __default, edgeKey, reqDevice, tripLiveParse, inmMatches, etagOf, TRIP_LIVE_MAX, workersCacheHeader, errorBody, serverCfg };\n";
const tmp = `/tmp/speed-part2-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const varint = (n) => { const o = []; n = BigInt(n); if (n < 0n) n += 1n << 64n; do { let b = Number(n & 0x7fn); n >>= 7n; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const tag = (f, w) => varint((f << 3) | w);
const vint = (f, n) => [...tag(f, 0), ...varint(n)];
const bytes = (f, b) => [...tag(f, 2), ...varint(b.length), ...b];
const str = (f, s) => bytes(f, [...Buffer.from(s)]);
const feed = (entities) => new Uint8Array([...bytes(1, [...str(1, "2.0"), ...vint(3, Math.floor(Date.now() / 1000))]), ...entities.flatMap((e) => bytes(2, e))]);
// stus: [seq, stopId, timeS, delayS]; rel 3 marks the whole trip cancelled.
const tripUpdate = (tripId, stus, rel) => [...str(1, tripId), ...bytes(3, [...bytes(1, [...str(1, tripId), ...(rel ? vint(4, rel) : [])]), ...vint(4, Math.floor(Date.now() / 1000)),
  ...stus.flatMap(([seq, stopId, depS, delay]) => bytes(2, [...vint(1, seq), ...str(4, stopId), ...bytes(3, [...vint(1, delay), ...vint(2, depS)])]))])];

// A trip update with delays only (no clock times), as Sydney Trains often sends, and only the stops it has news for.
const delayOnly = (tripId, stus) => [...str(1, tripId), ...bytes(3, [...bytes(1, str(1, tripId)), ...vint(4, Math.floor(Date.now() / 1000)),
  ...stus.flatMap(([seq, stopId, delay]) => bytes(2, [...vint(1, seq), ...str(4, stopId), ...bytes(3, vint(1, delay))]))])];
const MIN = 60000;
const nowS = Math.floor(Date.now() / 1000);
const stops = { "/stops/213.json": { "2135113": ["Strathfield Station, Platform 3", -33.87, 151.09], "2135114": ["Strathfield Station, Platform 4", -33.87, 151.09] },
  "/stops/200.json": { "2000331": ["Central Station, Platform 17", -33.88, 151.2] }, "/stops/201.json": { "2011104": ["Kings Cross Station, Platform 1", -33.87, 151.22] } };
const lists = { "/stations/train.json": [["200060", "Central Station", -33.88, 151.2], ["213510", "Strathfield Station", -33.87, 151.09]] };
// Our own timetable's run for t1-delay (the planner object): Lidcombe, Strathfield P3, Central P17, planned times.
const runPlanned = { lid: Date.now() + 2 * MIN, str: Date.now() + 8 * MIN, cen: Date.now() + 24 * MIN };
let runAsks = 0;
const PLANNER = { idFromName: (n) => n, get: () => ({ fetch: async (u) => { runAsks++; const q = new URL(u).searchParams; if (q.get("trip") !== "t1-delay") return Response.json({ error: "trip" });
  return Response.json({ ver: 1, trip: "t1-delay", trips: ["t1-delay"], reached: true, mine: 1, alt: { "213510": ["2135113", "2135114"] }, stops: [
    { id: "2135101", parent: null, arr: runPlanned.lid, dep: runPlanned.lid, trip: "t1-delay" },
    { id: "2135113", parent: "213510", arr: runPlanned.str, dep: runPlanned.str, trip: "t1-delay" },
    { id: "2000331", parent: null, arr: runPlanned.cen, dep: runPlanned.cen, trip: "t1-delay" }] }); } }) };
const env = { TFNSW_API_KEY: "t", PLANNER, ASSETS: { fetch: async (req) => { const p = new URL(req.url).pathname; const v = stops[p] || lists[p]; return v ? new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } }) : new Response("no", { status: 404 }); } } };
let plannerCalls = 0, feedCalls = 0;
globalThis.fetch = async (u) => {
  const url = new URL(String(u.url || u));
  if (url.pathname.includes("realtime/sydneytrains")) {
    feedCalls++;
    return new Response(feed([
      tripUpdate("t1-live", [[5, "2135113", nowS + 4 * 60, 120], [9, "2000331", nowS + 20 * 60, 120]]),
      // The feed shows this train at platform 4 instead of the planned 3.
      tripUpdate("t1-moved", [[5, "2135114", nowS + 7 * 60, 60], [9, "2000331", nowS + 23 * 60, 60]]),
      tripUpdate("t1-gone", [], 3),
      delayOnly("t1-delay", [[2, "2135101", 180]]),
    ]));
  }
  if (url.pathname.endsWith("/tp/trip") || url.pathname.endsWith("/tp/departure_mon")) { plannerCalls++; return new Response("{}", { status: 503 }); }
  return new Response("{}", { status: 503 });
};
const edge = new Map();
globalThis.caches = { default: { match: async (req) => { const e = edge.get(String(req.url || req)); return e ? new Response(e.body, { status: e.status || 200, headers: e.headers }) : undefined; }, put: async (req, res) => { edge.set(String(req.url || req), { body: await res.text(), status: res.status, headers: [...res.headers] }); }, delete: async () => true } };
const exec = { waitUntil: () => {} };
let ip = 1;
const call = async (path, init = {}, envX = env) => {
  const h = new Headers(init.headers || {}); h.set("cf-connecting-ip", "10.12.0." + (ip++ % 250));
  const r = await W.__default.fetch(new Request("https://api.transportsydney.app" + path, { ...init, headers: h }), envX, exec);
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch (e) { body = null; }
  return { status: r.status, body, text, headers: r.headers };
};
const leg = (...p) => p.map(encodeURIComponent).join("@");

test("x-serves on every /api answer names id-headers and trip-live; CORS allows x-device and exposes x-serves", async () => {
  const r = await call("/api/trip/live?legs=" + leg("t1-live", "2135113", "2000331", "train", "T1"));
  assert.equal(r.status, 200);
  assert.deepEqual(r.headers.get("x-serves").split(","), ["id-headers", "trip-live"]);
  assert.match(r.headers.get("access-control-expose-headers"), /x-serves/);
  const bad = await call("/api/trip/live");
  assert.equal(bad.status, 400);
  assert.ok(bad.headers.get("x-serves"), "error answers carry it too");
  const pre = await call("/api/departures", { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-headers"), /x-device/);
  assert.match(pre.headers.get("access-control-allow-headers"), /x-profile/);
});

test("a word whose flag is off (or killed by the server switches) leaves x-serves; trip-live off is a 404", async () => {
  const r = await call("/api/trip/live?legs=" + leg("t1-live", "2135113", "2000331", "train", "T1"), {}, { ...env, TRIP_LIVE: "off" });
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("x-serves"), "id-headers");
  const both = await call("/api/trip/live?legs=x", {}, { ...env, TRIP_LIVE: "off", ID_HEADERS: "off" });
  assert.equal(both.headers.get("x-serves"), null, "no words: the app turns both off");
  W.serverCfg.cfg = { flags: {}, kill: { tripLive: true } }; W.serverCfg.at = Date.now();
  try { assert.doesNotMatch(String(W.__default && (await call("/api/lines")).headers.get("x-serves")), /trip-live/); }
  finally { W.serverCfg.cfg = null; W.serverCfg.at = 0; }
});

test("id-headers: the device comes from x-device (or device= from an old install) and never reaches a cache key", () => {
  const req = new Request("https://api.transportsydney.app/api/trip?from=1&to=2", { headers: { "x-device": "dev-abc" } });
  assert.equal(W.reqDevice(req, new URL(req.url).searchParams), "dev-abc");
  const old = new Request("https://api.transportsydney.app/api/trip?from=1&to=2&device=dev-old");
  assert.equal(W.reqDevice(old, new URL(old.url).searchParams), "dev-old");
  const a = W.edgeKey(new URL("https://api.transportsydney.app/api/departures?stop=213510&device=d1&profile=p1&refresh=1")).url;
  const b = W.edgeKey(new URL("https://api.transportsydney.app/api/departures?stop=213510")).url;
  assert.equal(a, b, "old install addresses share the new installs' copies");
  const w = fs.readFileSync(root + "src/worker.js", "utf8");
  assert.doesNotMatch(w, /device: p\.get\("device"\)/, "every trip and board log reads reqDevice");
});

test("trip-live: legs in request order from the feed, live times and platform; no feed news is realtime false; no planner call", async () => {
  plannerCalls = 0;
  const legs = [leg("t1-moved", "2135113", "2000331", "train", "T1"), leg("no-such-trip", "2135113", "2000331", "train", "T1"), leg("t1-live", "2135113", "2000331", "train", "T1"), leg("t1-gone", "2135113", "2000331", "train", "T1")];
  const r = await call("/api/trip/live?legs=" + legs.join(","));
  assert.equal(r.status, 200);
  assert.equal(r.body.kind, "triplive");
  assert.ok(r.body.now > 0 && r.body.dataAt > 0);
  assert.deepEqual(r.body.legs.map((x) => x.tripId), ["t1-moved", "no-such-trip", "t1-live", "t1-gone"]);
  const [moved, none, live, gone] = r.body.legs;
  assert.equal(live.realtime, true);
  assert.equal(live.stopId, "2135113", "the stop the phone sent comes back as sent");
  assert.equal(Date.parse(live.estimated), (nowS + 4 * 60) * 1000);
  assert.equal(Date.parse(live.arrEstimated), (nowS + 20 * 60) * 1000);
  assert.equal(live.delayMin, 2);
  assert.equal(live.platform, "Platform 3");
  assert.equal(moved.realtime, true);
  assert.equal(moved.platform, "Platform 4", "the feed's platform when it differs from the planned one");
  assert.equal(Date.parse(moved.estimated), (nowS + 7 * 60) * 1000);
  assert.equal(none.realtime, false);
  assert.equal(none.estimated, null);
  assert.equal(gone.cancelled, true);
  assert.equal(gone.realtime, false);
  assert.equal(plannerCalls, 0, "no Trip Planner call");
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("trip-live checks its input: at most 12 legs, five parts each", async () => {
  const many = Array.from({ length: W.TRIP_LIVE_MAX + 1 }, (_, i) => leg("t" + i, "1", "2", "bus", "333")).join(",");
  assert.equal((await call("/api/trip/live?legs=" + many)).status, 400);
  assert.equal((await call("/api/trip/live?legs=" + encodeURIComponent("a@b"))).status, 400);
  assert.ok(W.tripLiveParse(Array.from({ length: 12 }, (_, i) => leg("t" + i, "1", "2", "bus", "333")).join(",")).legs.length === 12);
  assert.equal(W.tripLiveParse(leg("a b@c", "1", "", "ferry", "F1")).legs[0].tripId, "a b@c", "parts are URI decoded");
});

test("ETags: station lists answer 200 with a strong tag, then 304 with no body when the phone sends it back", async () => {
  const r = await call("/api/stations?mode=train");
  assert.equal(r.status, 200);
  const etag = r.headers.get("etag");
  assert.match(etag, /^"[0-9a-f]{24}"$/, "strong tag");
  assert.equal(etag, await W.etagOf(r.text), "a hash of the exact bytes");
  const r2 = await call("/api/stations?mode=train", { headers: { "if-none-match": etag } });
  assert.equal(r2.status, 304);
  assert.equal(r2.text, "");
  assert.equal(r2.headers.get("etag"), etag);
  assert.ok(r2.headers.get("x-serves"));
  const f = await call("/stations/train.json");
  assert.equal(f.status, 200);
  const ft = f.headers.get("etag");
  assert.match(ft, /^"[0-9a-f]{24}"$/);
  assert.equal((await call("/stations/train.json", { headers: { "if-none-match": ft } })).status, 304);
  assert.equal((await call("/stations/train.json", { headers: { "if-none-match": '"other"' } })).status, 200);
  assert.ok(W.inmMatches('W/"abc", "def"', '"def"') && W.inmMatches("*", '"x"') && !W.inmMatches('"abc"', '"abd"'));
});

test("packs carry a strong ETag (pack.js) and only good packs are kept", () => {
  const p = fs.readFileSync(root + "src/pack.js", "utf8");
  assert.match(p, /etag = await packTag\(body\)/);
  assert.doesNotMatch(p, /status: 404, headers: \{ "content-type": "application\/json", "cache-control": "public/, "a 404 is never put in the cache");
  assert.match(p, /hit && hit\.status === 200/);
});

test("no error answer is kept anywhere: the copy layer, planner runs, trackwork look ups and engine boards", () => {
  assert.ok(W.errorBody('{"error":"Transport for NSW is not answering"}'));
  assert.ok(!W.errorBody('{"kind":"trip","journeys":[]}'));
  const r = fs.readFileSync(root + "src/raptor.js", "utf8");
  assert.doesNotMatch(r, /d\.error \? 60/, "raptor.js no longer keeps an error run for 60 s");
  assert.match(r, /if \(cache && !d\.error\) await cache\.put/);
  const w = fs.readFileSync(root + "src/worker.js", "utf8");
  assert.match(w, /if \(shape\) await cache\.put\(ck/);
  assert.match(w, /!emptyPark && !errorBody\(body\)/);
  const e = fs.readFileSync(root + "src/engine.js", "utf8");
  assert.match(e, /if \(r\.status !== 200 \|\| !text\) return null;/);
});

test("Workers Cache stays off by default; on, only shared answers get an edge only header and never a per person one", () => {
  const ok = new Response("{}", { status: 200 });
  const u = (q) => new URL("https://api.transportsydney.app" + q);
  const g = (q) => new Request(u(q).toString());
  assert.equal(W.workersCacheHeader(env, g("/api/departures?stop=1"), u("/api/departures?stop=1"), ok), null);
  const on = { ...env, WORKERS_CACHE: "on" };
  assert.equal(W.workersCacheHeader(on, g("/api/departures?stop=1"), u("/api/departures?stop=1"), ok), "max-age=15, stale-while-revalidate=45");
  assert.equal(W.workersCacheHeader(on, g("/api/departures?stop=1&device=d"), u("/api/departures?stop=1&device=d"), ok), null);
  assert.equal(W.workersCacheHeader(on, g("/api/departures?stop=1&refresh=1"), u("/api/departures?stop=1&refresh=1"), ok), null);
  assert.equal(W.workersCacheHeader(on, g("/api/saved"), u("/api/saved"), ok), null);
  assert.equal(W.workersCacheHeader(on, g("/api/departures?stop=1"), u("/api/departures?stop=1"), new Response("{}", { status: 503 })), null);
  const tpl = fs.readFileSync(root + "wrangler.toml.template", "utf8");
  assert.doesNotMatch(tpl, /^\[cache\]/m, "the wrangler cache block stays off");
});

test("trip-live: a delay with no clock time is laid on our timetable's run and carried to the boarding and get off stops", async () => {
  plannerCalls = 0; runAsks = 0;
  const r = await call("/api/trip/live?legs=" + leg("t1-delay", "2135113", "2000331", "train", "T1"));
  const x = r.body.legs[0];
  assert.equal(x.realtime, true);
  assert.equal(Date.parse(x.estimated), runPlanned.str + 180000, "planned plus the carried 3 min delay");
  assert.equal(Date.parse(x.arrEstimated), runPlanned.cen + 180000);
  assert.equal(x.delayMin, 3);
  assert.equal(runAsks, 1, "one planner object ask for the run");
  assert.equal(plannerCalls, 0, "no Trip Planner call");
  // A second ask in the same half hour reads the kept run.
  await call("/api/trip/live?legs=" + leg("t1-delay", "2135113", "2000331", "train", "T1"));
  assert.equal(runAsks, 1);
});
