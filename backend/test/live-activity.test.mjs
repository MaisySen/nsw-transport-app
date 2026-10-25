// iPhone trip cards updated by push (build 205): the content state Apple gets, which cards a tick updates, the
// signed provider token, and the routes and minute tick end to end with Apple stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { makeD1 } from "./helpers/d1.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") +
  "\nexport { __default, appleDate, laContentState, laPayload, laDue, laTripFrom, laLook, signApnsJwt, liveActivityRoute, tickLiveActivities, LIVECARD };\n";
const tmp = `/tmp/live-activity-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const TOKEN = "ab".repeat(32);

// Apple and Transport for NSW stubbed: Apple answers from `apple`, everything else fails, so cards use planned times.
let sent = [];
let apple = () => new Response(null, { status: 200, headers: { "apns-id": "id-1" } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("https://api.push.apple.com/")) { sent.push({ url: u, headers: init.headers, body: JSON.parse(init.body) }); return apple(); }
  return new Response("{}", { status: 503 });
};
function makeEnv() {
  const DB = makeD1();
  DB.sql.exec("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT)");
  return { DB, APNS_KEY: PEM, APNS_BUNDLE: ["com", "maisy" + "sen", "nswtransport"].join("."), TFNSW_API_KEY: "t" };
}
const post = (path, body) => new Request("https://api.transportsydney.app" + path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const NOW = Date.parse("2026-10-25T08:00:00+11:00");
const trip = (o = {}) => ({
  id: "t1", title: "Strathfield to Kings Cross", origin: { id: "213510", name: "Strathfield" }, to: { id: "201110", name: "Kings Cross" },
  legs: [
    { mode: "train", line: "T1", tripId: "A.1", stopId: "2135223", toStopId: "2000336", from: "Strathfield", to: "Central", planned: "2026-10-25T08:10:00+11:00", arrPlanned: "2026-10-25T08:22:00+11:00", color: "#F99D1C", towards: "Hornsby" },
    { mode: "train", line: "T4", tripId: "B.2", stopId: "2000339", toStopId: "2011131", from: "Central", to: "Kings Cross", planned: "2026-10-25T08:26:00+11:00", arrPlanned: "2026-10-25T08:31:00+11:00", color: "#0098CD" },
  ],
  rode: {}, arrivedAt: null, ...o,
});

test("dates go to Apple as seconds since 2001, nulls are left out, required fields always there", () => {
  assert.equal(W.appleDate(Date.UTC(2001, 0, 1)), 0);
  assert.equal(W.appleDate(Date.UTC(2001, 0, 1, 0, 1)), 60);
  const cs = W.laContentState({ line: "T1", lineColorHex: "#F99D1C", mode: "train", nextStop: null, stopsLeft: 3, getOffAt: "Central", arrival: NOW, phase: "ride",
    warning: null, progress: 1.4, departs: NOW - 60000, legArrives: NOW + 60000, updated: NOW, platform: undefined, destination: "Kings Cross" });
  assert.deepEqual(Object.keys(cs).sort(), ["arrival", "departs", "destination", "getOffAt", "legArrives", "line", "lineColorHex", "mode", "phase", "progress", "stopsLeft", "updated"]);
  assert.equal(cs.arrival, Math.round(NOW / 1000 - 978307200));
  assert.equal(cs.progress, 1);
  assert.equal(cs.departs, cs.arrival - 60);
});

test("update carries a stale date, end carries a dismissal date", () => {
  const card = { line: "T1", lineColorHex: "#000", mode: "train", getOffAt: "Central", arrival: NOW, phase: "ride", progress: 0.5 };
  const u = W.laPayload(card, { now: NOW, staleMs: NOW + 120000 });
  assert.equal(u.aps.event, "update");
  assert.equal(u.aps.timestamp, Math.floor(NOW / 1000));
  assert.equal(u.aps["stale-date"], Math.floor(NOW / 1000) + 120);
  assert.equal(u.aps["dismissal-date"], undefined);
  const e = W.laPayload({ ...card, phase: "arrived" }, { now: NOW, event: "end" });
  assert.equal(e.aps.event, "end");
  assert.equal(e.aps["dismissal-date"], Math.floor(NOW / 1000) + 120);
  assert.equal(e.aps["stale-date"], undefined);
});

test("a tick updates active, unexpired cards not pushed in the last 50 s, longest waiting first", () => {
  const rows = [
    { token: "a", active: 1, expires: NOW + 1, last_push: NOW - 60000 },
    { token: "b", active: 1, expires: NOW + 1, last_push: NOW - 20000 },
    { token: "c", active: 0, expires: NOW + 1, last_push: null },
    { token: "d", active: 1, expires: NOW - 1, last_push: null },
    { token: "e", active: 1, expires: NOW + 1, last_push: null },
  ];
  assert.deepEqual(W.laDue(rows, NOW).map((r) => r.token), ["e", "a"]);
  assert.deepEqual(W.laDue(rows, NOW, 1).map((r) => r.token), ["e"]);
});

test("the look ignores the update time and small progress steps", () => {
  const a = { line: "T1", progress: 0.51, updated: 1, arrival: 5 };
  assert.equal(W.laLook(a), W.laLook({ ...a, progress: 0.52, updated: 2 }));
  assert.notEqual(W.laLook(a), W.laLook({ ...a, arrival: 6 }));
});

test("trips from the app are checked and trimmed", () => {
  assert.equal(W.laTripFrom(null), null);
  assert.equal(W.laTripFrom({ legs: [] }), null);
  assert.equal(W.laTripFrom({ legs: [{ mode: "train" }] }), null);
  assert.equal(W.laTripFrom({ legs: Array(9).fill(trip().legs[0]) }), null);
  const t = W.laTripFrom({ ...trip(), extra: "x".repeat(5000), rode: { 0: 123, x: 1, 1: "bad" }, legs: [{ ...trip().legs[0], junk: 1, from: "y".repeat(500) }] });
  assert.equal(t.legs[0].junk, undefined);
  assert.equal(t.legs[0].from.length, 120);
  assert.deepEqual(t.rode, { 0: 123 });
  assert.equal(t.extra, undefined);
});

test("the provider token is an ES256 JWT Apple can check with the key", async () => {
  const jwt = await W.signApnsJwt(PEM, "69AK74573Z", "B85KQRQZW7", NOW);
  const [h, b, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "ES256", kid: "69AK74573Z" });
  assert.deepEqual(JSON.parse(Buffer.from(b, "base64url")), { iss: "B85KQRQZW7", iat: Math.floor(NOW / 1000) });
  assert.ok(crypto.verify("sha256", Buffer.from(h + "." + b), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
});

test("register, tick, skip within 50 s, end on arrival", async () => {
  const env = makeEnv();
  sent = [];
  apple = () => new Response(null, { status: 200, headers: { "apns-id": "id-1" } });
  assert.equal((await W.liveActivityRoute(env, post("/api/live-activity", { token: "zz", trip: trip() }), "/api/live-activity", NOW)).status, 400);
  assert.equal((await W.liveActivityRoute(env, post("/api/live-activity", { token: TOKEN, trip: { legs: [] } }), "/api/live-activity", NOW)).status, 400);
  const r = await W.liveActivityRoute(env, post("/api/live-activity", { token: TOKEN.toUpperCase(), activity: "act-1", device: "dev1", trip: trip() }), "/api/live-activity", NOW);
  assert.deepEqual(await r.json(), { ok: true, push: true });

  const t1 = await W.tickLiveActivities(env, NOW);
  assert.equal(t1.sent, 1);
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.url, "https://api.push.apple.com/3/device/" + TOKEN);
  assert.equal(m.headers["apns-topic"], env.APNS_BUNDLE + ".push-type.liveactivity");
  assert.equal(m.headers["apns-push-type"], "liveactivity");
  assert.match(m.headers.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(m.body.aps.event, "update");
  const cs = m.body.aps["content-state"];
  assert.equal(cs.line, "T1");
  assert.equal(cs.phase, "wait");
  assert.equal(cs.departs, W.appleDate(Date.parse("2026-10-25T08:10:00+11:00")));
  assert.equal(cs.updated, W.appleDate(NOW));
  assert.ok(m.body.aps["stale-date"] > Math.floor(NOW / 1000));

  assert.equal((await W.tickLiveActivities(env, NOW + 20000)).sent, 0);
  assert.equal(sent.length, 1);
  // The same provider token is used again (kept in meta).
  await W.tickLiveActivities(env, NOW + 60000);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].headers.authorization, m.headers.authorization);
  assert.equal(sent[1].headers["apns-priority"], "5");

  // The phone says the trip arrived: the next tick sends the final card and stops.
  await W.liveActivityRoute(env, post("/api/live-activity", { token: TOKEN, trip: trip({ arrivedAt: NOW + 100000 }) }), "/api/live-activity", NOW + 100000);
  await W.tickLiveActivities(env, NOW + 130000);
  assert.equal(sent.length, 3);
  assert.equal(sent[2].body.aps.event, "end");
  assert.equal(sent[2].body.aps["content-state"].phase, "arrived");
  assert.equal(sent[2].headers["apns-priority"], "10");
  assert.equal((await W.tickLiveActivities(env, NOW + 200000)).sent, 0);
  const row = env.DB.sql.prepare("SELECT active, pushes, last_status FROM live_activities").get();
  assert.deepEqual({ ...row }, { active: 0, pushes: 3, last_status: 200 });
});

test("a token Apple no longer takes stops the card; ended on the phone deletes it", async () => {
  const env = makeEnv();
  sent = [];
  await W.liveActivityRoute(env, post("/api/live-activity", { token: TOKEN, trip: trip() }), "/api/live-activity", NOW);
  apple = () => new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 });
  const t = await W.tickLiveActivities(env, NOW);
  assert.equal(t.items[0].reason, "BadDeviceToken");
  assert.equal(env.DB.sql.prepare("SELECT active FROM live_activities").get().active, 0);
  apple = () => new Response(null, { status: 200 });
  await W.liveActivityRoute(env, post("/api/live-activity", { token: TOKEN, trip: trip() }), "/api/live-activity", NOW + 1000);
  assert.equal(env.DB.sql.prepare("SELECT active FROM live_activities").get().active, 1);
  await W.liveActivityRoute(env, post("/api/live-activity/end", { token: TOKEN }), "/api/live-activity/end", NOW + 2000);
  // Ended on the phone: the token is deleted, not kept (privacy, 25 Oct).
  assert.equal(env.DB.sql.prepare("SELECT COUNT(*) AS n FROM live_activities").get().n, 0);
  assert.equal((await W.tickLiveActivities(env, NOW + 120000)).sent, 0);
});

test("no push key: the tick does nothing, the phone's token is still saved", async () => {
  const env = { ...makeEnv(), APNS_KEY: undefined };
  sent = [];
  assert.deepEqual(await W.tickLiveActivities(env, NOW), { skipped: "no push key" });
  const r = await W.liveActivityRoute(env, post("/api/apns/device", { token: TOKEN, device: "dev1" }), "/api/apns/device", NOW);
  assert.equal(r.status, 200);
  assert.equal(env.DB.sql.prepare("SELECT env FROM apns_devices").get().env, "production");
  assert.equal(sent.length, 0);
});

test("routes are reachable through the worker, the admin route needs the key", async () => {
  const env = { ...makeEnv(), ADMIN_KEY: "k".repeat(24), ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
  const ctx = { waitUntil() {} };
  const r = await W.__default.fetch(post("/api/live-activity", { token: TOKEN, trip: trip() }), env, ctx);
  assert.equal(r.status, 200);
  const no = await W.__default.fetch(new Request("https://api.transportsydney.app/api/admin/live-activity"), env, ctx);
  assert.equal(no.status, 403);
  const yes = await W.__default.fetch(new Request("https://api.transportsydney.app/api/admin/live-activity", { headers: { "x-admin-key": "k".repeat(24) } }), env, ctx);
  const d = await yes.json();
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].token, TOKEN.slice(0, 8));
  assert.equal(d.items[0].trip.legs, 2);
});
