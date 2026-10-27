// Max walk chips (28 Oct): /api/trip?maxWalk=10&lessWalk=1 asks the Trip Planner with its own walking options
// (itOptionsActive, trITMOT=100, trITMOTvalue100, ptOptionsActive, routeType=leastwalking) in the same one call;
// a refusal of them or an empty answer is asked once more without them (walk.dropped). Without maxWalk and lessWalk
// the call and the answer are as before. No NSW call: fetch is a stub.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { efaTrip } from "./helpers/efa.mjs";
import { makeD1 } from "./helpers/d1.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { __default, tripWalkParse, tripWalkParams, tripWalkTag, tripWalkRefused, tripWinKey, longTripCacheKey, boardKey };\n";
const tmp = `/tmp/trip-walk-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const asked = [];
let refuseWalk = false, emptyWalk = false;
globalThis.fetch = async (u) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (!url.pathname.endsWith("/trip")) return new Response("{}", { status: 404 });
  asked.push(url.searchParams);
  const withWalk = url.searchParams.has("itOptionsActive") || url.searchParams.has("routeType");
  if (withWalk && refuseWalk) return new Response(JSON.stringify({ error: "bad option" }), { status: 400 });
  if (withWalk && emptyWalk) return new Response(JSON.stringify({ journeys: [] }));
  const now = Date.now();
  return new Response(JSON.stringify(efaTrip([4, 14].map((m) => [{ from: "central", to: "townhall", dep: now + m * 60000, min: 4, delay: 0, trip: "w" + m }]))));
};
const edge = new Map();
globalThis.caches = { default: { match: async (r) => (edge.has(String(r.url || r)) ? new Response(edge.get(String(r.url || r))) : undefined), put: async (r, res) => { edge.set(String(r.url || r), await res.text()); }, delete: async () => true } };
const env = { TFNSW_API_KEY: "t", DB: makeD1() };
const exec = { waitUntil: () => {} };
let ip = 1, pair = 0;
// Each test its own pair, so no test reads another one's copy.
const call = async (q, envX = env) => {
  const res = await W.__default.fetch(new Request(`https://api.transportsydney.app/api/trip?from=20006${pair}&to=20007${pair}&count=8&${q}`, { headers: { "cf-connecting-ip": "10.9.0." + (ip++ % 250), "x-device": "d1", "x-profile": "p1" } }), envX, exec);
  return { status: res.status, body: await res.json().catch(() => null) };
};
const P = (q) => new URLSearchParams(q);

test("parse: 5, 10, 15 or 20 and lessWalk=1 only; anything else is no walking choice", () => {
  assert.deepEqual(W.tripWalkParse(P("maxWalk=10&lessWalk=1")), { max: 10, less: true });
  assert.deepEqual(W.tripWalkParse(P("maxWalk=20")), { max: 20, less: false });
  assert.deepEqual(W.tripWalkParse(P("lessWalk=1")), { max: 0, less: true });
  assert.equal(W.tripWalkParse(P("maxWalk=7")), null);
  assert.equal(W.tripWalkParse(P("maxWalk=abc&lessWalk=yes")), null);
  assert.equal(W.tripWalkParse(P("")), null);
  assert.equal(W.tripWalkParse(P("maxWalk=10&lessWalk=1"), { WALK_PLANNER: "off" }), null, "WALK_PLANNER=off sends nothing");
});

test("planner options: the longest walk to and from the stops, and least walking", () => {
  assert.deepEqual(W.tripWalkParams({ max: 10, less: false }), { itOptionsActive: "1", trITMOT: "100", trITMOTvalue100: "10" });
  assert.deepEqual(W.tripWalkParams({ max: 0, less: true }), { ptOptionsActive: "1", routeType: "leastwalking" });
  assert.deepEqual(W.tripWalkParams(null), {});
  assert.equal(W.tripWalkTag({ max: 15, less: true }), "w15l");
  assert.equal(W.tripWalkTag(null), "");
});

test("refused means the planner turned the options down, not its limit, quota or an outage", () => {
  assert.equal(W.tripWalkRefused(new Error("Transport data answered 400: bad")), true);
  for (const c of [403, 408, 429, 500, 503]) assert.equal(W.tripWalkRefused(new Error(`Transport data answered ${c}: x`)), false, String(c));
  assert.equal(W.tripWalkRefused(Object.assign(new Error("timed out"), { name: "TimeoutError" })), false);
});

test("caches and copies keep a walking choice apart from the plain trip", () => {
  const plain = W.tripWinKey("1", "2", "20261028", "0900", { count: 8 });
  assert.notEqual(W.tripWinKey("1", "2", "20261028", "0900", { count: 8, walk: { max: 10, less: false } }), plain);
  assert.notEqual(W.longTripCacheKey(P("from=1&to=2&maxWalk=10")), W.longTripCacheKey(P("from=1&to=2")));
  const U = (q) => new URL("https://api.transportsydney.app/api/trip?" + q);
  assert.deepEqual(W.boardKey(U("from=200060&to=200070")), { k: "trip:200060>200070", stop: "trip" });
  assert.deepEqual(W.boardKey(U("from=200060&to=200070&maxWalk=10&lessWalk=1")), { k: "trip:200060>200070~w10l", stop: "trip" });
  assert.equal(W.boardKey(U("from=200060&to=200070&maxWalk=9")).k, "trip:200060>200070", "an unknown limit is no choice");
  const pg = W.boardKey(U("from=200060&to=200070&page=1&lessWalk=1"));
  assert.equal(pg.k, "tripp:200060>200070~w0l");
  assert.equal(pg.plain, "trip:200060>200070~w0l");
});

test("an older app (no maxWalk, no lessWalk): one planner call without walking options, no walk in the answer", async () => {
  pair = 1; asked.length = 0;
  const r = await call("fare=adult");
  assert.equal(r.status, 200);
  assert.equal(asked.length, 1);
  for (const k of ["itOptionsActive", "trITMOT", "trITMOTvalue100", "ptOptionsActive", "routeType"]) assert.equal(asked[0].get(k), null, k);
  assert.equal(r.body.walk, undefined);
  assert.ok(r.body.journeys.length >= 1);
});

test("the chips: one planner call carries the walking options and the answer echoes them", async () => {
  pair = 2; asked.length = 0;
  const r = await call("maxWalk=10&lessWalk=1");
  assert.equal(r.status, 200);
  assert.equal(asked.length, 1, "no extra planner call");
  assert.equal(asked[0].get("itOptionsActive"), "1");
  assert.equal(asked[0].get("trITMOT"), "100");
  assert.equal(asked[0].get("trITMOTvalue100"), "10");
  assert.equal(asked[0].get("ptOptionsActive"), "1");
  assert.equal(asked[0].get("routeType"), "leastwalking");
  assert.deepEqual(r.body.walk, { max: 10, less: true, dropped: false });
});

test("a refused or empty answer to the options is asked once more without them", async () => {
  pair = 3; asked.length = 0; refuseWalk = true;
  let r = await call("maxWalk=5");
  refuseWalk = false;
  assert.equal(r.status, 200);
  assert.equal(asked.length, 2);
  assert.equal(asked[1].get("trITMOTvalue100"), null);
  assert.equal(r.body.walk.dropped, true);
  assert.ok(r.body.journeys.length >= 1);
  pair = 4; asked.length = 0; emptyWalk = true;
  r = await call("lessWalk=1");
  emptyWalk = false;
  assert.equal(asked.length, 2);
  assert.equal(asked[1].get("routeType"), null);
  assert.equal(r.body.walk.dropped, true);
  assert.ok(r.body.journeys.length >= 1);
});

test("WALK_PLANNER=off: the planner is asked as before even when the app sends a choice", async () => {
  pair = 5; asked.length = 0;
  const r = await call("maxWalk=10&lessWalk=1", { ...env, WALK_PLANNER: "off" });
  assert.equal(r.status, 200);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].get("routeType"), null);
  assert.equal(r.body.walk, undefined);
});
