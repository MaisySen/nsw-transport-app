// Feed freshness and "never stale as live" on the server (28 Oct liveness pass, docs/LIVE-LABELS.md "How fresh live is").
// Every live time comes from a feed copy; the copy's own time is its GTFS realtime header timestamp (never later than
// the fetch). A copy over FEED_LIVE_MAX_MS old gives no live times; kept board copies send rows whose live time is
// that old as timetable rows; each feed's last good fetch, age and errors are counted per server copy and shown on
// /api/health (admin) and /api/engine/status. All offline: fetch is faked, no Transport for NSW call.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { __default, loadFeed, feedMem, feedFresh, feedFreshness, feedDataTs, realtimeFor, capLiveRows, copyMayHaveOldLive, oldAppText, FEED_LIVE_MAX_MS, FEED_TTL_MS };\n";
const tmp = `/tmp/feedfresh-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

// A tiny GTFS realtime feed: header (version, timestamp) and one trip update.
const varint = (n) => { const o = []; n = BigInt(n); do { let b = Number(n & 0x7fn); n >>= 7n; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const tag = (f, w) => varint((f << 3) | w);
const vint = (f, n) => [...tag(f, 0), ...varint(n)];
const bytes = (f, b) => [...tag(f, 2), ...varint(b.length), ...b];
const str = (f, s) => bytes(f, [...Buffer.from(s)]);
const feed = (headerS, tripId = "trip-1") => new Uint8Array([...bytes(1, [...str(1, "2.0"), ...vint(3, headerS)]),
  ...bytes(2, [...str(1, "e1"), ...bytes(3, [...bytes(1, str(1, tripId)), ...vint(4, headerS)])])]);

let answer = () => new Response(feed(Math.floor(Date.now() / 1000)), { status: 200 });
let calls = 0;
globalThis.fetch = async (u) => { calls++; return answer(String(u)); };
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;
const reset = () => { W.feedMem.clear(); W.feedFresh.clear(); skew = 0; calls = 0; };
const ENV = {};

test("a good fetch is counted with the copy's own header time, per feed and per mode", async () => {
  reset();
  const lagS = 40;
  answer = () => new Response(feed(Math.floor(Date.now() / 1000) - lagS), { status: 200 });
  const e = await W.loadFeed(ENV, "/v1/gtfs/realtime/buses", "tu");
  assert.ok(e && e.buf);
  const ts = W.feedDataTs(e);
  assert.ok(e.at - ts >= (lagS - 1) * 1000 && e.at - ts <= (lagS + 1) * 1000, "header time, not fetch time");
  const f = W.feedFreshness();
  const row = f.feeds.find((x) => x.feed === "/v1/gtfs/realtime/buses");
  assert.equal(row.mode, "bus");
  assert.equal(row.ok, 1);
  assert.equal(row.errors, 0);
  assert.ok(row.headerLagS >= lagS - 1 && row.headerLagS <= lagS + 1);
  assert.ok(row.ageS >= lagS - 1 && row.ageS <= lagS + 1);
  assert.equal(row.live, true);
  assert.ok(f.byMode.bus && f.byMode.bus.ok === 1 && f.byMode.bus.live === true);
  assert.equal(f.maxAgeS, W.FEED_LIVE_MAX_MS / 1000);
});

test("a header in the future (clock skew) is not trusted: the fetch time stands", async () => {
  reset();
  answer = () => new Response(feed(Math.floor(Date.now() / 1000) + 3600), { status: 200 });
  const e = await W.loadFeed(ENV, "/v2/gtfs/realtime/metro", "tu");
  assert.equal(W.feedDataTs(e), e.at);
  assert.equal(W.feedDataTs({ at: 1000, headerTs: 0 }), 1000);
  assert.equal(W.feedDataTs(null), 0);
});

test("a failed fetch is counted, its words carry no key, and the last good copy is marked served old", async () => {
  reset();
  answer = () => new Response(feed(Math.floor(Date.now() / 1000)), { status: 200 });
  await W.loadFeed(ENV, "/v1/gtfs/realtime/ferries/sydneyferries", "tu");
  skew = W.FEED_TTL_MS + 1000;
  answer = () => new Response("nope", { status: 503 });
  const e = await W.loadFeed(ENV, "/v1/gtfs/realtime/ferries/sydneyferries", "tu");
  assert.ok(e && e.buf, "the last good copy");
  const row = W.feedFreshness().feeds.find((x) => x.feed.endsWith("sydneyferries"));
  assert.equal(row.mode, "ferry");
  assert.equal(row.errors, 1);
  assert.equal(row.servedOld, 1);
  assert.match(row.lastError, /503/);
  assert.doesNotMatch(row.lastError, /apikey\s+[^*]/i);
});

test("a feed copy older than FEED_LIVE_MAX_MS gives no live times; a fresh one does", async () => {
  reset();
  // Light rail copy whose header is 6 minutes old (the feed stopped updating): fetched now, but too old to call live.
  answer = (u) => new Response(feed(Math.floor(Date.now() / 1000) - (u.includes("lightrail") ? 360 : 10), "trip-1"), { status: 200 });
  const old = await W.realtimeFor(ENV, [["lightrail", "L2", "lr_cse"]]);
  assert.equal(old.tu("lightrail", "L2", "trip-1", "lr_cse"), null, "no live time from a 6 minute old copy");
  assert.equal(old.dataTs(), null);
  const row = W.feedFreshness().feeds.find((x) => x.feed.includes("lightrail") && x.kind === "tu");
  assert.equal(row.staleDropped, 1);
  assert.equal(row.live, false);
  assert.equal(W.feedFreshness().byMode.lightrail.live, false);
  // A train copy 10 s old is used, and dataTs says how old it is.
  const fresh = await W.realtimeFor(ENV, [["train", "T1", null]]);
  assert.ok(fresh.tu("train", "T1", "trip-1", null), "a live time from a fresh copy");
  const age = Date.now() - fresh.dataTs();
  assert.ok(age >= 9000 && age <= 12000, `dataTs is the header time (${age} ms)`);
});

test("the last good copy stops giving live times once it is too old", async () => {
  reset();
  answer = () => new Response(feed(Math.floor(Date.now() / 1000)), { status: 200 });
  const a = await W.realtimeFor(ENV, [["metro", "M1", null]]);
  assert.ok(a.tu("metro", "M1", "trip-1", null));
  answer = () => new Response("down", { status: 500 });
  skew = W.FEED_LIVE_MAX_MS + 5000;
  const b = await W.realtimeFor(ENV, [["metro", "M1", null]]);
  assert.equal(b.tu("metro", "M1", "trip-1", null), null, "a 5 minute old last good copy is not live");
  assert.ok(W.feedFreshness().byMode.metro.errors >= 1);
});

test("kept board rows with a live time past the limit go out as timetable rows; fresh, timetable and cancelled rows do not change", () => {
  const now = Date.now();
  const row = (o) => ({ planned: new Date(now + 600000).toISOString(), estimated: new Date(now + 720000).toISOString(), realtime: true, delayMin: 2, vehicle: { lat: -33.8, lon: 151.2, ageS: 20 }, status: { key: "late", text: "2 min late" }, ...o });
  const d = { dataAt: now - 30000, live: { liveCount: 4, total: 5 }, items: [
    row({ liveAt: now - W.FEED_LIVE_MAX_MS - 1000 }),
    row({ liveAt: now - 20000 }),
    row({ realtime: false, estimated: null, liveAt: null }),
    row({ cancelled: true, liveAt: now - W.FEED_LIVE_MAX_MS - 1000 }),
    row({ liveAt: undefined }),
  ] };
  assert.equal(W.capLiveRows(d, now), 1);
  assert.equal(d.items[0].realtime, false);
  assert.equal(d.items[0].estimated, null);
  assert.equal(d.items[0].delayMin, null);
  assert.equal(d.items[0].vehicle, null);
  assert.equal(d.items[0].liveOld, true);
  assert.equal(d.items[0].status.key, "scheduled");
  assert.equal(d.items[1].realtime, true);
  assert.equal(d.items[3].cancelled, true);
  assert.equal(d.items[4].realtime, true, "no liveAt: the copy's dataAt (30 s) decides");
  assert.equal(d.live.liveCount, 3);
  // A whole copy older than the limit (no liveAt on its rows): every live row goes.
  const e = { dataAt: now - W.FEED_LIVE_MAX_MS - 60000, items: [row({}), row({})] };
  assert.equal(W.capLiveRows(e, now), 2);
});

test("the cheap check reads a kept copy only when a live time in it may be past the limit", () => {
  const now = Date.now();
  assert.equal(W.copyMayHaveOldLive('{"items":[{"realtime":false}]}', now - 900000, now), false);
  assert.equal(W.copyMayHaveOldLive(`{"items":[{"realtime":true,"liveAt":${now - 10000}}]}`, now - 20000, now), false);
  assert.equal(W.copyMayHaveOldLive(`{"items":[{"realtime":true,"liveAt":${now - W.FEED_LIVE_MAX_MS - 1}}]}`, now - 20000, now), true);
  assert.equal(W.copyMayHaveOldLive('{"items":[{"realtime":true}]}', now - W.FEED_LIVE_MAX_MS - 1, now), true);
});

test("older apps never see the new fields: feedTs and liveOld are taken out of their answers", () => {
  const text = JSON.stringify({ kind: "departures", items: [{ planned: "x", realtime: false, liveOld: true, liveAt: null }], live: { feedAt: 5, feedTs: 4, liveCount: 0 }, feedTs: null, now: 1 });
  const out = JSON.parse(W.oldAppText(text));
  assert.equal("liveOld" in out.items[0], false);
  assert.equal("feedTs" in out.live, false);
  assert.equal("feedTs" in out, false);
  assert.equal(out.live.feedAt, 5);
  assert.equal(W.oldAppText('{"a":1}'), '{"a":1}');
});

test("/api/health shows feed freshness to the admin key only", async () => {
  reset();
  answer = () => new Response(feed(Math.floor(Date.now() / 1000) - 5), { status: 200 });
  await W.loadFeed(ENV, "/v2/gtfs/realtime/sydneytrains", "tu");
  const env = { ADMIN_KEY: "test-admin-key-28oct" };
  const exec = { waitUntil() {}, passThroughOnException() {} };
  const no = await W.__default.fetch(new Request("https://api.example/api/health"), env, exec);
  assert.equal(no.status, 403);
  const r = await W.__default.fetch(new Request("https://api.example/api/health", { headers: { "x-admin-key": env.ADMIN_KEY } }), env, exec);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.feedFresh && body.feedFresh.byMode.train, "per mode freshness");
  assert.equal(body.feedFresh.byMode.train.live, true);
  assert.ok(body.feedFresh.byMode.train.ageS <= 7);
});
