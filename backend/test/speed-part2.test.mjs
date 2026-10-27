// Speed pass part 2 (27 Oct): the app's contract (e441749c) and the server's side of it. x-serves on every /api answer,
// device and profile read from x-device and x-profile (never part of a cache key), GET /api/trip/live re-timing held legs
// from the realtime feed with no Trip Planner call, strong ETags with 304s on station lists and packs, and no error
// answer kept in any cache. Runs offline with a fake feed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/raptor.js", "utf8") +
  "\nexport { __default, edgeKey, reqDevice, tripLiveParse, inmMatches, etagOf, TRIP_LIVE_MAX, workersCacheHeader, errorBody, serverCfg, service };\n";
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
// The same as Sydney Trains really sends it: no stop sequences either.
const delayOnlyNoSeq = (tripId, stus) => [...str(1, tripId), ...bytes(3, [...bytes(1, str(1, tripId)), ...vint(4, Math.floor(Date.now() / 1000)),
  ...stus.flatMap(([stopId, delay]) => bytes(2, [...str(4, stopId), ...bytes(3, vint(1, delay))]))])];
const MIN = 60000;
const nowS = Math.floor(Date.now() / 1000);
const stops = { "/stops/213.json": { "2135113": ["Strathfield Station, Platform 3", -33.87, 151.09], "2135114": ["Strathfield Station, Platform 4", -33.87, 151.09] },
  "/stops/200.json": { "2000331": ["Central Station, Platform 17", -33.88, 151.2] }, "/stops/201.json": { "2011104": ["Kings Cross Station, Platform 1", -33.87, 151.22] } };
const lists = { "/stations/train.json": [["200060", "Central Station", -33.88, 151.2], ["213510", "Strathfield Station", -33.87, 151.09]] };
// The board engine's timetable (/timetable): planned times and stop sequences at Strathfield P3 (seq 5), Lidcombe (seq 2)
// and Central P17 (seq 9), for the trips in the feed.
const dayStart = Math.floor(Date.now() / 1000) - 3600;
const planned = { live: nowS + 4 * 60 - 120, moved: nowS + 7 * 60 - 60, delay: nowS + 8 * 60, past: nowS - 5 * 60 };
let ttAsks = 0;
const row = (t, trip, seq) => [t - dayStart, trip, 0, 0, 0, seq];
const ENGINE = { idFromName: (n) => n, get: () => ({ fetch: async (u) => {
  const url = new URL(u);
  if (url.pathname === "/trip") {
    ttAsks++;
    const tr = url.searchParams.get("trip"), p = planned[{ "t1-live": "live", "t1-moved": "moved", "t1-delay": "delay", "t1-past": "past" }[tr]];
    if (!p) return Response.json({ v: 1, trip: tr, stops: [] });
    return Response.json({ v: 1, trip: tr, stops: [
      { id: "2135101", seq: 2, planned: (p - 6 * 60) * 1000, name: "Lidcombe Station, Platform 1", lat: -33.86, lon: 151.04 },
      { id: "2135113", seq: 5, planned: p * 1000, name: "Strathfield Station, Platform 3", lat: -33.87, lon: 151.09 },
      { id: "2000331", seq: 9, planned: (p + 16 * 60) * 1000, name: "Central Station, Platform 17", lat: -33.88, lon: 151.2 }] });
  }
  if (url.pathname !== "/timetable") return new Response("no", { status: 404 });
  ttAsks++;
  const day = (rows) => ({ "20261027": { start: dayStart, rows } });
  const stops = {
    "2135113": { stops: ["2135113"], days: day([row(planned.live, "t1-live", 5), row(planned.moved, "t1-moved", 5), row(planned.delay, "t1-delay", 5)]) },
    "2000331": { stops: ["2000331"], days: day([row(planned.live + 16 * 60, "t1-live", 9), row(planned.moved + 16 * 60, "t1-moved", 9), row(planned.delay + 16 * 60, "t1-delay", 9)]) },
  };
  const want = (url.searchParams.get("stops") || "").split(",");
  return Response.json({ v: 1, routes: [], heads: [], stops: Object.fromEntries(Object.entries(stops).filter(([k]) => want.includes(k))) });
} }) };
const env = { TFNSW_API_KEY: "t", ENGINE, ASSETS: { fetch: async (req) => { const p = new URL(req.url).pathname; const v = stops[p] || lists[p]; return v ? new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } }) : new Response("no", { status: 404 }); } } };
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
      delayOnlyNoSeq("t1-delay", [["2135101", 180]]),
      delayOnlyNoSeq("t1-past", [["2000331", 120]]),
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
  assert.deepEqual(r.headers.get("x-serves").split(","), ["id-headers", "trip-live", "home-bundle", "poll-tags"]);
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
  assert.equal(r.headers.get("x-serves"), "id-headers,home-bundle,poll-tags");
  const both = await call("/api/trip/live?legs=x", {}, { ...env, TRIP_LIVE: "off", ID_HEADERS: "off", HOME_BUNDLE: "off", POLL_TAGS: "off" });
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

test("a kept station list copy made before tags existed is tagged on the way out, and a weak form of the tag matches", async () => {
  edge.clear();
  const key = W.edgeKey(new URL("https://api.transportsydney.app/api/stations?mode=ferry")).url;
  const storedAt = Date.now() - 60000;
  edge.set(key, { body: JSON.stringify([["F1", "Circular Quay", -33.86, 151.21]]), headers: [["content-type", "application/json"], ["x-stored-at", String(storedAt)]] });
  const r = await call("/api/stations?mode=ferry", { headers: { "x-device": "dev-new" } });
  assert.equal(r.status, 200);
  const tagged = r.headers.get("etag");
  assert.match(tagged, /^"[0-9a-f]{24}"$/);
  assert.equal(tagged, await W.etagOf(r.text));
  // Cloudflare weakens a strong tag when it compresses the answer; the phone sends back what it got.
  const r2 = await call("/api/stations?mode=ferry", { headers: { "if-none-match": "W/" + tagged, "x-device": "dev-new" } });
  assert.equal(r2.status, 304);
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

test("trip-live: a delay with no clock time is laid on the timetable's planned time, carried from the last listed stop before", async () => {
  plannerCalls = 0; ttAsks = 0; edge.clear();
  const r = await call("/api/trip/live?legs=" + leg("t1-delay", "2135113", "2000331", "train", "T1"));
  const x = r.body.legs[0];
  assert.equal(x.realtime, true);
  assert.equal(Date.parse(x.estimated), (planned.delay + 180) * 1000, "planned plus the 3 min delay from Lidcombe (seq 2, before seq 5)");
  assert.equal(Date.parse(x.arrEstimated), (planned.delay + 16 * 60 + 180) * 1000);
  assert.equal(x.delayMin, 3);
  assert.equal(x.platform, "Platform 3");
  assert.equal(ttAsks, 1, "one engine ask for the trip");
  assert.equal(plannerCalls, 0, "no Trip Planner call");
  await call("/api/trip/live?legs=" + leg("t1-delay", "2135113", "2000331", "train", "T1"));
  assert.equal(ttAsks, 1, "the trip's list is kept (30 min)");
});

test("trip-live with no engine: the feed's own clock times; a delay with no time and no planned time is not live", async () => {
  const noEngine = { ...env }; delete noEngine.ENGINE;
  const r = await call("/api/trip/live?legs=" + [leg("t1-live", "2135113", "2000331", "train", "T1"), leg("t1-delay", "2135113", "2000331", "train", "T1")].join(","), {}, noEngine);
  assert.equal(r.body.legs[0].realtime, true);
  assert.equal(Date.parse(r.body.legs[0].estimated), (nowS + 4 * 60) * 1000);
  assert.equal(r.body.legs[1].realtime, false);
  assert.equal(r.body.legs[1].estimated, null);
});

test("service quick answer for a train with no run: the trip's stops from the engine's timetable with the feed's delays", async () => {
  edge.clear(); plannerCalls = 0;
  const t0 = Date.now();
  const r = await W.service(env, { quick: true, ttQuick: true, mode: "train", line: "T1", trip: "t1-delay", stop: "2135113" });
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(r.source, "timetable");
  assert.deepEqual(r.stops.map((s) => s.id), ["2135101", "2135113", "2000331"]);
  assert.equal(Date.parse(r.stops[0].estimated), (planned.delay - 6 * 60 + 180) * 1000);
  assert.equal(Date.parse(r.stops[1].estimated), (planned.delay + 180) * 1000, "Lidcombe's delay carried on");
  assert.equal(Date.parse(r.stops[2].estimated), (planned.delay + 16 * 60 + 180) * 1000);
  assert.equal(plannerCalls, 0, "no Trip Planner call");
  // A train with nothing in the engine's timetable gives no quick list (the full answer follows).
  const none = await W.service(env, { quick: true, ttQuick: true, mode: "train", line: "T1", trip: "no-such-trip", stop: "2135113" });
  assert.equal(none.stops.length, 0);
});

test("trip-live: a boarding stop the train has passed takes the delay at the first listed stop, so the arrival stays live", async () => {
  edge.clear();
  const r = await call("/api/trip/live?legs=" + leg("t1-past", "2135113", "2000331", "train", "T1"));
  const x = r.body.legs[0];
  assert.equal(x.realtime, true);
  assert.equal(Date.parse(x.estimated), (planned.past + 120) * 1000);
  assert.equal(Date.parse(x.arrEstimated), (planned.past + 16 * 60 + 120) * 1000);
  assert.equal(x.delayMin, 2);
});
