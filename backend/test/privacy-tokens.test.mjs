// Delete all my data and clean up for push tokens (iPhone trip card tokens, the phone push token, Expo and web push
// tokens), and pruning of raw recorded live times (obs). Real SQL on node:sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./helpers/d1.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") +
  "\nexport { __default, forgetDeviceTokens, prunePushTokens, pruneObs, obsKeepFrom, OBS_KEEP_DAYS, REL_DAYS, ensureSchema, ensureSchema3, ensureLiveActivities, morningSchema, lastHomeSchema, facSchema };\n";
const tmp = `/tmp/privacy-tokens-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
globalThis.fetch = async () => new Response("{}", { status: 503 });

const NOW = Date.parse("2026-10-25T17:00:00+11:00");
const DAY = 86400000;
const TOKEN = (c) => c.repeat(64);
const DEV = "app_dev_one_123456", OTHER = "app_dev_two_654321";
const ctx = { waitUntil() {} };
let ip = 1;
const post = (path, body) => new Request("https://api.transportsydney.app" + path, { method: "POST", body: JSON.stringify(body),
  headers: { "content-type": "application/json", "cf-connecting-ip": `10.55.0.${ip++}` } });

// The worker keeps its "schema made" promises per isolate, so every test shares one database, emptied first.
const shared = { DB: makeD1(), TFNSW_API_KEY: "t" };
const TABLES = ["live_activities", "apns_devices", "expo_tokens", "push_subs", "watches", "morning_checks", "lift_alerts", "park_watches", "last_home", "obs", "searches"];
async function makeEnv() {
  await W.ensureSchema(shared);
  await W.ensureSchema3(shared);
  await W.ensureLiveActivities(shared);
  await W.morningSchema(shared);
  await W.lastHomeSchema(shared);
  await W.facSchema(shared);
  for (const t of TABLES) shared.DB.sql.exec(`DELETE FROM ${t}`);
  return shared;
}
const count = (env, t, where = "1") => env.DB.sql.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${where}`).get().n;
function addCard(env, token, device, o = {}) {
  const r = { created: NOW - 3600000, updated: NOW - 60000, expires: NOW + 3600000, active: 1, ...o };
  env.DB.sql.prepare("INSERT INTO live_activities (token, activity, device, trip, created, updated, expires, active, pushes) VALUES (?, 'a', ?, '{}', ?, ?, ?, ?, 0)")
    .run(token, device, r.created, r.updated, r.expires, r.active);
}
function addDevice(env, token, device, updated = NOW - DAY) {
  env.DB.sql.prepare("INSERT INTO apns_devices (token, device, env, created, updated) VALUES (?, ?, 'production', ?, ?)").run(token, device, updated, updated);
}

test("POST /api/live-activity/forget deletes this device's trip cards and phone push token, nobody else's", async () => {
  const env = await makeEnv();
  addCard(env, TOKEN("a"), DEV); addCard(env, TOKEN("b"), DEV, { active: 0 }); addCard(env, TOKEN("c"), OTHER);
  addDevice(env, TOKEN("d"), DEV); addDevice(env, TOKEN("e"), OTHER);
  const r = await W.__default.fetch(post("/api/live-activity/forget", { device: DEV }), env, ctx);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j, { ok: true, deleted: { liveActivities: 2, apnsDevices: 1 } });
  assert.equal(count(env, "live_activities", `device = '${DEV}'`), 0);
  assert.equal(count(env, "apns_devices", `device = '${DEV}'`), 0);
  assert.equal(count(env, "live_activities"), 1);
  assert.equal(count(env, "apns_devices"), 1);
});

test("forget without a device is refused and deletes nothing", async () => {
  const env = await makeEnv();
  addCard(env, TOKEN("a"), DEV); addDevice(env, TOKEN("d"), DEV);
  const r = await W.__default.fetch(post("/api/live-activity/forget", {}), env, ctx);
  assert.equal(r.status, 400);
  assert.equal(count(env, "live_activities"), 1);
  assert.equal(count(env, "apns_devices"), 1);
  const g = await W.__default.fetch(new Request("https://api.transportsydney.app/api/live-activity/forget", { headers: { "cf-connecting-ip": "10.56.0.1" } }), env, ctx);
  assert.equal(g.status, 405);
});

test("Delete all my data (scope all) also deletes the trip card and phone push tokens", async () => {
  const env = await makeEnv();
  addCard(env, TOKEN("a"), DEV); addCard(env, TOKEN("c"), OTHER);
  addDevice(env, TOKEN("d"), DEV); addDevice(env, TOKEN("e"), OTHER);
  env.DB.sql.prepare("INSERT INTO expo_tokens (token, device, profile, platform, created, fails) VALUES ('ExponentPushToken[abcdefghijkl]', ?, 'p', 'ios', ?, 0)").run(DEV, NOW);
  const r = await W.__default.fetch(post("/api/history/delete", { profile: "prof_abcdef_123456", device: DEV, scope: "all" }), env, ctx);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.deleted.liveActivities, 1);
  assert.equal(j.deleted.push, 2); // the Expo token and the phone push token
  assert.equal(count(env, "live_activities"), 1);
  assert.equal(count(env, "apns_devices"), 1);
  assert.equal(count(env, "expo_tokens"), 0);
});

test("scope history keeps push tokens", async () => {
  const env = await makeEnv();
  addCard(env, TOKEN("a"), DEV); addDevice(env, TOKEN("d"), DEV);
  const r = await W.__default.fetch(post("/api/history/delete", { profile: "prof_abcdef_123456", device: DEV, scope: "history" }), env, ctx);
  assert.equal(r.status, 200);
  assert.equal(count(env, "live_activities"), 1);
  assert.equal(count(env, "apns_devices"), 1);
});

test("/end deletes the trip card token instead of keeping it", async () => {
  const env = await makeEnv();
  addCard(env, TOKEN("a"), DEV);
  const r = await W.__default.fetch(post("/api/live-activity/end", { token: TOKEN("a") }), env, ctx);
  assert.equal(r.status, 200);
  assert.equal(count(env, "live_activities"), 0);
});

test("clean up: trip cards go when ended, expired or 24 h old; phone tokens after 30 days without the app sending them", async () => {
  const env = await makeEnv();
  addCard(env, TOKEN("1"), DEV);                                              // riding now: kept
  addCard(env, TOKEN("2"), DEV, { active: 0 });                                // ended
  addCard(env, TOKEN("3"), DEV, { expires: NOW - 3600000 });                   // trip over, never ended on the phone
  addCard(env, TOKEN("4"), DEV, { created: NOW - 25 * 3600000, expires: NOW + 3600000 }); // over 24 h old
  addCard(env, TOKEN("5"), DEV, { expires: NOW - 5 * 60000 });                 // just past expiry, the tick may still end it
  addDevice(env, TOKEN("6"), DEV, NOW - 29 * DAY);                             // kept
  addDevice(env, TOKEN("7"), OTHER, NOW - 31 * DAY);                           // gone
  const out = await W.prunePushTokens(env, NOW);
  assert.equal(out.liveActivities, 3);
  assert.equal(out.apnsDevices, 1);
  assert.deepEqual(env.DB.sql.prepare("SELECT token FROM live_activities ORDER BY token").all().map((r) => r.token[0]), ["1", "5"]);
  assert.deepEqual(env.DB.sql.prepare("SELECT token FROM apns_devices").all().map((r) => r.token[0]), ["6"]);
});

test("clean up: an Expo or web push token unused for 30 days goes, unless something on the server still pushes to it", async () => {
  const env = await makeEnv();
  const old = NOW - 40 * DAY;
  const ins = env.DB.sql.prepare("INSERT INTO expo_tokens (token, device, profile, platform, created, last_ok, fails) VALUES (?, ?, 'p', 'ios', ?, ?, 0)");
  ins.run("ExponentPushToken[idle00000000]", "dev_idle_000001", old, null);         // idle: gone
  ins.run("ExponentPushToken[recentok0000]", "dev_ok_00000001", old, NOW - 2 * DAY); // a push worked lately: kept
  ins.run("ExponentPushToken[newtoken0000]", "dev_new_0000001", NOW - DAY, null);     // new: kept
  ins.run("ExponentPushToken[morning00000]", "dev_morning_001", old, null);          // has a morning check: kept
  ins.run("ExponentPushToken[watchactive0]", "dev_watch_00001", old, null);          // has a live watch: kept
  env.DB.sql.prepare("INSERT INTO morning_checks (id, device, active, created) VALUES ('m1', 'dev_morning_001', 1, ?)").run(old);
  env.DB.sql.prepare("INSERT INTO watches (id, device, profile, active, created, updated, expires) VALUES ('w1', 'dev_watch_00001', 'p', 1, ?, ?, ?)").run(old, old, NOW + DAY);
  // A watch kept by profile only (no device) must not stop the clean up for everyone.
  env.DB.sql.prepare("INSERT INTO watches (id, device, profile, active, created, updated, expires) VALUES ('w2', NULL, 'p', 1, ?, ?, ?)").run(NOW, NOW, NOW + DAY);
  env.DB.sql.prepare("INSERT INTO push_subs (endpoint, device, profile, created, last_ok, fails) VALUES ('https://push.example/x', 'dev_web_000001', 'p', ?, NULL, 0)").run(old);
  const out = await W.prunePushTokens(env, NOW);
  assert.equal(out.expoTokens, 1);
  assert.equal(out.pushSubs, 1);
  assert.deepEqual(env.DB.sql.prepare("SELECT device FROM expo_tokens ORDER BY device").all().map((r) => r.device),
    ["dev_morning_001", "dev_new_0000001", "dev_ok_00000001", "dev_watch_00001"]);
});

test("obs keeps what reliability (42 days) and predictions (28 days) read, deletes older days in bounded runs", async () => {
  assert.ok(W.OBS_KEEP_DAYS > W.REL_DAYS);
  assert.ok(W.OBS_KEEP_DAYS >= 28);
  const env = await makeEnv();
  const keepFrom = W.obsKeepFrom(NOW);
  assert.equal(keepFrom, "20260910"); // 45 days before 25 Oct 2026, Sydney time
  const ins = env.DB.sql.prepare("INSERT INTO obs (day, trip_id, stop_id, route, mode, planned, est, delay_s, source, first_seen, last_seen, n) VALUES (?, ?, 's1', 'T1', 'train', 0, 0, 60, 'rt', 0, 0, 1)");
  for (let i = 0; i < 7; i++) ins.run("20260801", "old" + i);
  for (let i = 0; i < 3; i++) ins.run("20260909", "edge" + i);
  for (let i = 0; i < 4; i++) ins.run(keepFrom, "kept" + i);
  ins.run("20261025", "today");
  const r = await W.pruneObs(env, NOW);
  assert.deepEqual(r, { keepFrom, deleted: 10 });
  assert.equal(count(env, "obs"), 5);
  assert.equal(count(env, "obs", `day < '${keepFrom}'`), 0);
  const again = await W.pruneObs(env, NOW);
  assert.equal(again.deleted, 0);
});
