// Security review, 5 Nov 2026: limits that keep one script from spending the Transport for NSW quota, filling the
// minute tick or reaching other hosts, and the trip copy that no longer carries one person's text to the next.
// Runs offline: Apple, Transport for NSW and the push services are stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { makeD1 } from "./helpers/d1.mjs";
import { OWNER_IDS } from "../tools/owner-stations.mjs";

const root = new URL("..", import.meta.url).pathname;
const SRC = fs.readFileSync(root + "src/worker.js", "utf8");
const src = SRC.replace(/export default\s*\{/, "const __default = {") +
  "\nexport { __default, laDue, liveActivityRoute, tickLiveActivities, rateIp, pushEndpointOk, sendPush, tripCopyPlain, fromSaved, tripCopyKey, obsCount, LA_NEW_PER_PASS };\n";
const tmp = `/tmp/audit-nov5-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const REAL = "ab".repeat(32);

// Apple takes only the REAL token; every other token is refused as a made up one. Transport for NSW fails, and every
// call to it is counted by path.
let tfnsw = [];
let pushed = [];
let other = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("https://api.push.apple.com/3/device/")) {
    pushed.push(u);
    return u.endsWith("/" + REAL) ? new Response(null, { status: 200, headers: { "apns-id": "ok" } })
      : new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 });
  }
  if (u.startsWith("https://api.transport.nsw.gov.au/")) { tfnsw.push(new URL(u).pathname); return new Response("{}", { status: 503 }); }
  other.push(u);
  return new Response("{}", { status: 503 });
};

function makeEnv(extra = {}) {
  const DB = makeD1();
  DB.sql.exec("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT)");
  return { DB, APNS_KEY: PEM, APNS_BUNDLE: ["com", "example", "app"].join("."), TFNSW_API_KEY: "t", ...extra };
}
const NOW = Date.parse("2026-11-05T08:00:00+11:00");
const post = (path, body, ip = "10.0.0.1") => new Request("https://api.transportsydney.app" + path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "cf-connecting-ip": ip } });
const trip = () => ({
  id: "t1", title: "Parramatta to Epping", origin: { id: "215020", name: "Parramatta" }, to: { id: "212110", name: "Epping" },
  legs: [{ mode: "bus", line: "M54", tripId: "X.9", stopId: "2150103", toStopId: "2121191", destId: "212110", from: "Parramatta", to: "Epping",
    planned: "2026-11-05T08:10:00+11:00", arrPlanned: "2026-11-05T08:40:00+11:00", towards: "Macquarie Park" }],
  rode: {}, arrivedAt: null,
});
const token = (i) => (i.toString(16).padStart(4, "0") + "cd".repeat(30)).slice(0, 64);
const planner = () => tfnsw.filter((p) => p.startsWith("/v1/tp/")).length;

test("made up trip card tokens cost no Trip Planner call, at most LA_NEW_PER_PASS a pass, and end on Apple's refusal", async () => {
  const env = makeEnv();
  for (let i = 1; i <= 50; i++) await W.liveActivityRoute(env, post("/api/live-activity", { token: token(i), device: "dev" + i, trip: trip() }), "/api/live-activity", NOW);
  tfnsw = []; pushed = [];
  const t = await W.tickLiveActivities(env, NOW);
  assert.equal(t.sent, W.LA_NEW_PER_PASS);
  assert.equal(planner(), 0, "quick answers only for cards Apple has not taken a push for");
  const left = env.DB.sql.prepare("SELECT COUNT(*) AS n FROM live_activities WHERE active = 1").get().n;
  assert.equal(left, 50 - W.LA_NEW_PER_PASS, "each refused token is ended");
});

test("a card Apple has taken is pushed on every pass however many new tokens arrive", async () => {
  const env = makeEnv();
  await W.liveActivityRoute(env, post("/api/live-activity", { token: REAL, device: "me", trip: trip() }), "/api/live-activity", NOW);
  await W.tickLiveActivities(env, NOW);
  assert.equal(env.DB.sql.prepare("SELECT last_status FROM live_activities WHERE token = ?").get(REAL).last_status, 200);
  for (let i = 1; i <= 400; i++) await W.liveActivityRoute(env, post("/api/live-activity", { token: token(i), trip: trip() }), "/api/live-activity", NOW + 1000);
  pushed = [];
  await W.tickLiveActivities(env, NOW + 30000);
  assert.ok(pushed.some((u) => u.endsWith("/" + REAL)), "the real card is in the pass");
  assert.ok(pushed.length <= W.LA_NEW_PER_PASS + 1);
});

test("laDue keeps every proven card and caps the new ones", () => {
  const rows = [
    ...Array.from({ length: 30 }, (_, i) => ({ token: "n" + i, active: 1, expires: NOW + 1, last_push: null, last_status: null })),
    { token: "p", active: 1, expires: NOW + 1, last_push: NOW - 60000, last_status: 200 },
  ];
  const due = W.laDue(rows, NOW);
  assert.ok(due.some((r) => r.token === "p"));
  assert.equal(due.filter((r) => r.token.startsWith("n")).length, W.LA_NEW_PER_PASS);
});

test("limits count an IPv6 /64 as one address", () => {
  const ip = (a) => ({ headers: { get: (k) => (k === "cf-connecting-ip" ? a : null) } });
  assert.equal(W.rateIp(ip("2001:db8:abcd:12::1")), W.rateIp(ip("2001:db8:abcd:12:ffff:1:2:3")));
  assert.notEqual(W.rateIp(ip("2001:db8:abcd:12::1")), W.rateIp(ip("2001:db8:abcd:13::1")));
  assert.equal(W.rateIp(ip("203.0.113.9")), "203.0.113.9");
  assert.equal(W.rateIp(ip("::ffff:203.0.113.9")), "203.0.113.9");
});

const postDev = (path, body, ip, dev) => { const r = post(path, body, ip); r.headers.set("x-device", dev); return r; };

test("trip card registrations are limited per phone (x-device), 40 in 10 minutes; the /64 counts as one address", async () => {
  const env = { ...makeEnv(), ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
  const ctx = { waitUntil() {} };
  const codes = [];
  for (let i = 0; i < 45; i++) {
    const r = await W.__default.fetch(postDev("/api/live-activity", { token: token(i + 1), trip: trip() }, `2001:db8:77:1::${(i + 1).toString(16)}`, "phoneA123"), env, ctx);
    codes.push(r.status);
  }
  assert.ok(codes.slice(0, 40).every((c) => c === 200), codes.join(","));
  assert.ok(codes.slice(40).every((c) => c === 429), codes.join(","));
});

test("100 phones behind one mobile carrier address (one IPv4, different devices) all get their trip cards (6 Nov)", async () => {
  const env = { ...makeEnv(), ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
  const ctx = { waitUntil() {} };
  const codes = [];
  for (let i = 0; i < 100; i++) {
    const r = await W.__default.fetch(postDev("/api/live-activity", { token: token(i + 1), trip: trip() }, "198.51.100.77", "phone" + String(i).padStart(4, "0")), env, ctx);
    codes.push(r.status);
  }
  assert.deepEqual(codes.filter((c) => c !== 200), [], "every card accepted");
  // and the timetable pack misses from the same 100 phones are not refused by the address either
  const pk = [];
  for (let i = 0; i < 100; i++) {
    const r = new Request("https://api.transportsydney.app/api/pack?stop=200060", { headers: { "cf-connecting-ip": "198.51.100.77", "x-device": "phone" + String(i).padStart(4, "0") } });
    pk.push((await W.__default.fetch(r, env, ctx)).status);
  }
  assert.equal(pk.filter((c) => c === 429).length, 0, "no pack read refused: " + pk.join(","));
});

test("a script with no device id on one address still meets a ceiling", async () => {
  const env = { ...makeEnv(), ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
  const ctx = { waitUntil() {} };
  let refused = 0;
  for (let i = 0; i < 405; i++) {
    const r = await W.__default.fetch(post("/api/live-activity", { token: token(i + 1), trip: trip() }, "198.51.100.200"), env, ctx);
    if (r.status === 429) refused++;
  }
  assert.equal(refused, 5, "400 in 10 minutes per address without a device id");
});

test("Web Push goes only to the browsers' push services", async () => {
  for (const ok of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/QF", "https://wns2-par02p.notify.windows.com/w/?token=x"]) assert.ok(W.pushEndpointOk(ok), ok);
  for (const bad of ["https://internal-victim.example:8443/admin", "https://fcm.googleapis.com:8443/x", "http://fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.example/x", "https://u:p@fcm.googleapis.com/x", "not a url"]) assert.ok(!W.pushEndpointOk(bad), bad);
  other = [];
  const r = await W.sendPush({ endpoint: "https://internal-victim.example:8443/admin", keys: {} }, { title: "x" });
  assert.equal(r.status, 410);
  assert.equal(other.length, 0, "nothing was fetched");
  const env = { ...makeEnv(), ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
  const sub = (endpoint) => post("/api/push/subscribe", { device: "dev12345", subscription: { endpoint, keys: { p256dh: "x", auth: "y" } } });
  assert.equal((await W.__default.fetch(sub("https://internal-victim.example:8443/admin"), env, { waitUntil() {} })).status, 400);
});

test("a saved trip copy keeps no names from the request, and gives each person their own", () => {
  const body = JSON.stringify({ kind: "trip", from: { id: "200060", name: "Central - STATION CLOSED use buses" }, to: { id: "206710", name: "Chatswood" },
    journeys: [{ board: new Date(Date.now() + 600000).toISOString(), legs: [{ from: "Central Station, Platform 18", to: "Chatswood Station, Platform 1" }] }] });
  const plain = JSON.parse(W.tripCopyPlain(body));
  assert.equal(plain.from.name, "Central Station");
  assert.equal(plain.to.name, "Chatswood Station");
  const saved = { body: JSON.stringify(plain), at: Date.now() };
  const mine = async (q) => JSON.parse(await W.fromSaved(saved, new URL("https://x/api/trip?from=200060&to=206710" + q)).text());
  return Promise.all([mine(""), mine("&fromName=Central&toName=Chatswood")]).then(([a, b]) => {
    assert.equal(a.from.name, "Central Station");
    assert.equal(b.from.name, "Central");
    assert.equal(b.to.name, "Chatswood");
  });
});

test("the fare type is part of the trip copy key; adult keeps the plain key", () => {
  const k = (q) => W.tripCopyKey(new URL("https://x/api/trip?from=200060&to=206710" + q)).k;
  assert.equal(k(""), "trip:200060>206710");
  assert.equal(k("&fare=adult&fromName=Anything"), "trip:200060>206710");
  assert.equal(k("&fare=concession"), "trip:200060>206710$concession");
  assert.notEqual(k("&fare=child"), k(""));
});

test("the public count of recorded live times is counted at most once in 10 minutes", async () => {
  const env = makeEnv();
  env.DB.sql.exec("CREATE TABLE obs (trip_id TEXT, day TEXT)");
  env.DB.sql.exec("INSERT INTO obs VALUES ('a','1'),('b','1'),('c','2')");
  const t0 = Date.now() + 3600000 * 24;
  assert.equal(await W.obsCount(env, t0), 3);
  env.DB.sql.exec("INSERT INTO obs VALUES ('d','2')");
  assert.equal(await W.obsCount(env, t0 + 60000), 3, "the kept count");
  assert.equal(await W.obsCount(env, t0 + 11 * 60000), 4);
});

test("tick and route limits are in the source", () => {
  // Watches: least recently worked on first, not the 25 oldest for ever.
  assert.ok(SRC.includes('"SELECT * FROM watches WHERE active = 1 ORDER BY updated LIMIT 25"'));
  assert.ok(!SRC.includes('"SELECT * FROM watches WHERE active = 1 ORDER BY created LIMIT 25"'));
  // Commutes: a cap per profile, a wait after no journey, and idle profiles left out.
  assert.match(SRC, /COMMUTE_MAX_PER_PROFILE = 10;/);
  assert.match(SRC, /st\.noneAt && now - st\.noneAt < COMMUTE_NONE_WAIT_MS/);
  assert.match(SRC, /LEFT JOIN meta m ON m\.k = 'cseen:' \|\| c\.profile/);
  // Watches per device, morning checks already claimed.
  assert.match(SRC, /WATCH_ACTIVE_PER_DEVICE = 8;/);
  assert.match(SRC, /AND id NOT IN \(SELECT check_id FROM morning_sent WHERE at > \?2\)/);
  // Share owner key from the header only; watch errors are not echoed.
  assert.ok(!/x-share-key"\) \|\| p\.get\("key"\)/.test(SRC));
  assert.match(SRC, /"This trip could not be watched\."/);
  // No owner stop ids in the sampled stops (the list comes from OWNER_STATIONS or the ignored local file).
  const sample = JSON.parse(SRC.match(/const SAMPLE_STOPS = (\[[^\]]*\])/)[1]);
  for (const id of OWNER_IDS) assert.ok(!sample.includes(id), "an owner stop id is sampled");
});

test("a watch POST with a broken body gets a plain error, not the exception text", async () => {
  const env = { ...makeEnv(), ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
  const r = await W.__default.fetch(post("/api/watch", { device: "dev12345", legs: { 0: 1 } }, "10.9.9.9"), env, { waitUntil() {} });
  const d = await r.json();
  assert.equal(r.status, 400);
  assert.ok(!/is not a function|TypeError/.test(d.error), d.error);
});

test("/api/obs needs the admin key; /api/usage without it is only the kept count", async () => {
  const env = { ...makeEnv(), ADMIN_KEY: "k".repeat(24), ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
  // The worker makes its tables once per copy, and an earlier test's copy already did, so this database gets its own.
  env.DB.sql.exec("CREATE TABLE obs (day TEXT NOT NULL, trip_id TEXT NOT NULL, stop_id TEXT NOT NULL, route TEXT, mode TEXT, planned INTEGER, est INTEGER, delay_s INTEGER, source TEXT, first_seen INTEGER, last_seen INTEGER, n INTEGER DEFAULT 1, PRIMARY KEY (day, trip_id, stop_id))");
  const ctx = { waitUntil() {} };
  const get = (p, h = {}) => W.__default.fetch(new Request("https://api.transportsydney.app" + p, { headers: { "cf-connecting-ip": "10.1.1.1", ...h } }), env, ctx);
  assert.equal((await get("/api/obs")).status, 403);
  assert.equal((await get("/api/obs", { "x-admin-key": "k".repeat(24) })).status, 200);
  const u = await (await get("/api/usage")).json();
  assert.deepEqual(Object.keys(u), ["observations"]);
});
