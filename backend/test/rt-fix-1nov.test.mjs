// Real-time harness fixes, server (1 Nov 2026, task e0bf4652; harness report files/day-1nov/rt-harness.md, bugs #2-#5).
// #4 POST /api/watch waited for its first live reading: with the feed slow or hanging it answered in 14.6 s against the
//    app's 15 s, so the app took a running watch as failed (double Get off now; End trip never stopped the server's).
//    Now it answers at once and reads after the answer (waitUntil).
// #3 the app sends its watch again until it hears back: the same key gives back the same watch (never a second one), and
//    a key the phone already ended makes nothing.
// #2 the trip card's push token can ride with the watch, so either registration getting through gives the server both.
// #5 feed down while locked: "1 min late, updated 5:26pm" from 2 min, "No live data since 5:26pm" from 5 min and
//    "No live data. Open the app to refresh." from 10 min (it said "Timetable times, not live" at 10 min).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { makeD1 } from "./helpers/d1.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") +
  "\nexport { __default, tfCard, tfState, LIVECARD };\n";
const tmp = `/tmp/rt-fix-1nov-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
let feed = "hang";
let nswCalls = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  if (u.startsWith("https://api.transport.nsw.gov.au/")) {
    nswCalls++;
    if (feed === "hang") return new Promise((_, rej) => { const h = setTimeout(() => rej(new TypeError("fetch failed")), 20000); if (init.signal) init.signal.addEventListener("abort", () => { clearTimeout(h); rej(new DOMException("aborted", "AbortError")); }); });
    return new Response("{}", { status: 503 });
  }
  if (u.startsWith("https://api.push.apple.com/")) return new Response(null, { status: 200, headers: { "apns-id": "x" } });
  return new Response("{}", { status: 503 });
};
function makeEnv() {
  const DB = makeD1();
  for (const f of fs.readdirSync(root + "migrations").sort()) DB.sql.exec(fs.readFileSync(root + "migrations/" + f, "utf8"));
  try { DB.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)"); } catch {}
  DB.sql.exec("CREATE TABLE IF NOT EXISTS app_config (platform TEXT PRIMARY KEY, body TEXT NOT NULL, at INTEGER)");
  DB.sql.prepare("INSERT OR REPLACE INTO app_config (platform, body, at) VALUES ('server', ?, ?)").run(JSON.stringify({ flags: { tripflow2: true, getOffPush: true, apnsAlerts: true } }), Date.now());
  return { DB, APNS_KEY: privateKey.export({ type: "pkcs8", format: "pem" }), APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_BUNDLE: ["com", "maisy" + "sen", "nswtransport"].join("."), TFNSW_API_KEY: "t", API_ONLY: "1" };
}
function makeExec() {
  const pending = new Set();
  return { pending, waitUntil(p) { const q = Promise.resolve(p).catch(() => null); pending.add(q); q.finally(() => pending.delete(q)); }, passThroughOnException() {} };
}
async function call(env, method, path, body) {
  const exec = makeExec();
  const t0 = performance.now();
  const res = await W.__default.fetch(new Request("https://api.transportsydney.app" + path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, exec);
  const ms = performance.now() - t0;
  const j = await res.json().catch(() => null);
  return { status: res.status, body: j, ms, exec };
}
const DEVICE = "d" + "1".repeat(20);
const inMin = (m) => new Date(Date.now() + m * 60000).toISOString();
const legs = () => [{ mode: "train", line: "T1", tripId: "SIM.leg0", stopId: "2135223", toStopId: "2000336", from: "Lidcombe Station", to: "Clyde Station", planned: inMin(6), arrPlanned: inMin(12), fromPlatform: "Platform 7", towards: "Sample terminus", color: "#F99D1C", feed: "" }];
const watchBody = (o = {}) => ({ device: DEVICE, kind: "trip", legs: legs(), track: true, getOff: 1, to: { id: "x", name: "Clyde Station" }, tripFlow: 2, c24: false, ...o });

test("#4: POST /api/watch answers at once with the feed hanging; the first reading runs after the answer", { timeout: 40000 }, async () => {
  const env = makeEnv();
  feed = "hang"; nswCalls = 0;
  const r = await call(env, "POST", "/api/watch", watchBody({ key: "g1abc-dev1" }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.watch && r.body.watch.id, "a watch id");
  assert.ok(r.ms < 3000, `answered in ${Math.round(r.ms)} ms (the app gives a write 15 s; it took 14.6 s with the feed slow)`);
  assert.equal(r.body.watch.key, "g1abc-dev1", "the key is said back (the app knows this server keeps one watch per key)");
  assert.ok(r.exec.pending.size >= 1, "the first reading was handed to waitUntil");
  const row = env.DB.sql.prepare("SELECT active FROM watches WHERE id = ?").get(r.body.watch.id);
  assert.equal(row.active, 1, "stored before the answer");
});

test("#3: the same key again gives back the same watch, never a second one; DELETE by key stops it and a late retry makes nothing", { timeout: 40000 }, async () => {
  const env = makeEnv();
  feed = "down";
  const a = await call(env, "POST", "/api/watch", watchBody({ key: "g2abc-dev1" }));
  const b = await call(env, "POST", "/api/watch", watchBody({ key: "g2abc-dev1" }));
  assert.equal(b.status, 200);
  assert.equal(b.body.watch.id, a.body.watch.id, "same watch");
  assert.equal(b.body.watch.again, true);
  assert.equal(b.body.watch.getOff, a.body.watch.getOff, "the Get off now answer is the same");
  const n = env.DB.sql.prepare("SELECT COUNT(*) AS n FROM watches WHERE device = ? AND active = 1").get(DEVICE).n;
  assert.equal(n, 1, "one active watch");
  const other = await call(env, "POST", "/api/watch", watchBody({ key: "g3abc-dev1" }));
  assert.notEqual(other.body.watch.id, a.body.watch.id, "another trip's key is another watch");
  const d = await call(env, "DELETE", `/api/watch?device=${DEVICE}&key=g2abc-dev1`);
  assert.equal(d.status, 200);
  assert.equal(env.DB.sql.prepare("SELECT active FROM watches WHERE id = ?").get(a.body.watch.id).active, 0, "stopped by key");
  const late = await call(env, "POST", "/api/watch", watchBody({ key: "g2abc-dev1" }));
  assert.equal(late.body.watch, null, "a Start trip retry after End trip makes no watch");
  assert.equal(late.body.ended, true);
  // End trip before Start trip ever reached the server (both from a locked phone's queue, out of order)
  await call(env, "DELETE", `/api/watch?device=${DEVICE}&key=g4abc-dev1`);
  const never = await call(env, "POST", "/api/watch", watchBody({ key: "g4abc-dev1" }));
  assert.equal(never.body.watch, null);
  // the old way still works: by id, and a watch with no key
  const old = await call(env, "POST", "/api/watch", watchBody());
  assert.ok(old.body.watch.id && !old.body.watch.key);
  await call(env, "DELETE", `/api/watch?device=${DEVICE}&id=${old.body.watch.id}`);
  assert.equal(env.DB.sql.prepare("SELECT active FROM watches WHERE id = ?").get(old.body.watch.id).active, 0);
  const bad = await call(env, "POST", "/api/watch", watchBody({ key: "x y" }));
  assert.ok(bad.body.watch.id && !bad.body.watch.key, "a malformed key is ignored, not refused");
});

test("#2: the trip card's push token riding with the watch registers the card too", { timeout: 40000 }, async () => {
  const env = makeEnv();
  feed = "down";
  const token = "ab".repeat(32);
  const r = await call(env, "POST", "/api/watch", watchBody({ key: "g5abc-dev1", title: "Lidcombe to Clyde", la: { token, activity: "act-1", trip: "g5abc" } }));
  assert.equal(r.status, 200);
  const row = env.DB.sql.prepare("SELECT * FROM live_activities WHERE token = ?").get(token);
  assert.ok(row, "card registered");
  assert.equal(row.active, 1);
  assert.equal(row.device, DEVICE);
  const trip = JSON.parse(row.trip);
  assert.equal(trip.legs.length, 1);
  assert.equal(trip.tripFlow, 2, "the trip flow travels with it");
  // a bad token does not cost the watch
  const r2 = await call(env, "POST", "/api/watch", watchBody({ key: "g6abc-dev1", la: { token: "nope" } }));
  assert.ok(r2.body.watch.id);
  // the plain card route is unchanged
  const r3 = await call(env, "POST", "/api/live-activity", { token: "cd".repeat(32), device: DEVICE, activity: "a", trip: { id: "t", legs: legs() } });
  assert.equal(r3.status, 200); assert.equal(r3.body.ok, true);
  const r4 = await call(env, "POST", "/api/live-activity", { token: "cd".repeat(32), device: DEVICE, activity: "a", trip: { id: "t", legs: [] } });
  assert.equal(r4.status, 400); assert.equal(r4.body.error, "bad trip");
});

test("#5: the card's words when the feed is down while locked follow the stale ladder (2, 5, 10 min)", async () => {
  const spec = { legs: legs(), track: true, tripFlow: 2, c24: false };
  const dep = Date.parse(spec.legs[0].planned), arr = Date.parse(spec.legs[0].arrPlanned);
  const asOf = dep - 4 * 60000; // the last good reading, 4 min before the train
  const live = { asOf, at: asOf, legs: [{ est: { 0: dep + 60000, 1: arr + 60000 }, runDelay: 60, board: null, vehicle: null, platform: "7", cancelled: false }], alts: [], cands: [] };
  const gone = { asOf, at: asOf, legs: [{ est: {}, unmatched: true }], alts: [], cands: [] }; // past 5 min: tfState's timetable-only copy
  const st = {};
  W.tfCard(spec, W.tfState(spec, st, live), asOf, {}); // the memory starts on the live reading
  const at = (raw, min) => W.tfCard(spec, W.tfState(spec, st, raw), asOf + min * 60000, {});
  const fresh = at(live, 0.5);
  assert.equal(fresh.step, "live");
  assert.equal(fresh.card.warning, "1 min late");
  const two = at(live, 2.5);
  assert.equal(two.step, "about");
  assert.match(two.card.warning, /^1 min late, updated \d{1,2}:\d{2}[ap]m$/, "2 min: says the time is from the last reading");
  assert.ok(two.card.warning.length <= 30, "fits the card's warning line");
  const five = at(gone, 5.5);
  assert.equal(five.step, "timetable");
  assert.match(five.card.warning, /^No live data since \d{1,2}:\d{2}[ap]m$/);
  const ten = at(gone, 10.5);
  assert.equal(ten.step, "no-data");
  assert.equal(ten.card.warning, "No live data. Open the app to refresh.");
  // a service the feed never had, read just now: still "Timetable times, not live" (not the ladder)
  const st2 = {};
  const never = W.tfCard(spec, W.tfState(spec, st2, { asOf: asOf + 600000, at: asOf + 600000, legs: [{ est: {}, unmatched: true }], alts: [], cands: [] }), asOf + 601000, {});
  assert.equal(never.step, "timetable-only");
  assert.equal(never.card.warning, "Timetable times, not live");
});
