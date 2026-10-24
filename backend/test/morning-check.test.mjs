// Morning check: a device registers a usual trip; shortly before the usual time the tick looks
// at live data once and sends one alert only if something is wrong. Real SQL (node:sqlite).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./helpers/d1.mjs";
import { efaTrip, liftInfo } from "./helpers/efa.mjs";

const root = new URL("..", import.meta.url).pathname;
let src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { __default, processMorningChecks, morningIssues, morningJourney, ensureSchema3, morningSchema, liftMem, serverCfg, runTick };\n";
const tmp = `/tmp/morning-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const MIN = 60000;
// Monday 26 Oct 2026, 7:45am Sydney (UTC+11).
const MON_0745 = Date.UTC(2026, 9, 25, 20, 45, 0);
const sydMs = (h, m) => MON_0745 + ((h * 60 + m) - (7 * 60 + 45)) * MIN;

let tripAnswer = { journeys: [] };
let liftAnswer = { infos: { current: [] } };
let upstreamDown = false;
const expoSent = [];
globalThis.fetch = async (u, init) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (url.hostname === "exp.host") { const b = JSON.parse(init.body); expoSent.push(...b); return new Response(JSON.stringify({ data: b.map(() => ({ status: "ok" })) })); }
  if (upstreamDown && url.pathname.endsWith("/trip")) return new Response("busy", { status: 503 });
  if (url.pathname.endsWith("/trip")) return new Response(JSON.stringify(tripAnswer));
  if (url.pathname.endsWith("/add_info")) return new Response(JSON.stringify(liftAnswer));
  return new Response("{}", { status: 404 });
};

// The worker remembers that its tables exist, so every test shares one database and clears it.
const sharedDB = makeD1();
function freshEnv() {
  const DB = sharedDB;
  for (const t of ["morning_checks", "morning_sent", "notes", "expo_tokens", "app_config"]) { try { DB.sql.exec("DELETE FROM " + t); } catch (e) { /* not made yet */ } }
  W.serverCfg.at = 0;
  return { TFNSW_API_KEY: "t", DB, ASSETS: { fetch: async (req) => { const p = root + "src/public" + new URL(req.url).pathname; return fs.existsSync(p) ? new Response(fs.readFileSync(p)) : new Response("", { status: 404 }); } } };
}
let ip = 1;
async function call(env, method, path, body) {
  const r = await W.__default.fetch(new Request("https://t.example" + path, { method, headers: { "cf-connecting-ip": "10.9.0." + (ip++ % 250), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json() };
}
const DEV = "dev-morning-1";
async function setup(env, extra = {}) {
  await W.ensureSchema3(env);
  await env.DB.prepare("INSERT INTO expo_tokens (token, device, profile, platform, created, fails) VALUES ('ExponentPushToken[abcdefghijkl]', ?1, '', 'android', 0, 0)").bind(DEV).run();
  const r = await call(env, "POST", "/api/morning-check", { device: DEV, from: { id: "213410", name: "Burwood Station" }, to: { id: "213510", name: "Strathfield Station" }, time: "08:00", days: [1, 2, 3, 4, 5], ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.item;
}
const notes = async (env) => (await env.DB.prepare("SELECT title, body FROM notes WHERE device = ?1").bind(DEV).all()).results;
const resetLifts = () => { W.liftMem.list = null; W.liftMem.at = 0; };

test("register, list, update and delete, keyed by device with no login", async () => {
  const env = freshEnv();
  const item = await setup(env);
  assert.equal(item.time, "08:00");
  assert.equal(item.timeText, "8:00am");
  assert.deepEqual(item.days, [1, 2, 3, 4, 5]);
  assert.equal(item.lead, 15);
  assert.equal(item.from.name, "Burwood Station");
  const list = await call(env, "GET", "/api/morning-check?device=" + DEV);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.push.expo, 1);
  assert.equal(list.body.enabled, true);
  // Another device sees nothing and cannot delete it.
  assert.equal((await call(env, "GET", "/api/morning-check?device=other-device")).body.items.length, 0);
  assert.equal((await call(env, "DELETE", `/api/morning-check?device=other-device&id=${item.id}`)).body.deleted, 0);
  const up = await call(env, "POST", "/api/morning-check", { id: item.id, device: DEV, from: { id: "213410", name: "Burwood Station" }, to: { id: "200060", name: "Central Station" }, time: "7:30", days: [6, 7], lead: 20 });
  assert.equal(up.body.item.to.id, "200060");
  assert.equal(up.body.item.time, "07:30");
  assert.deepEqual(up.body.item.days, [6, 7]);
  const del = await call(env, "DELETE", `/api/morning-check?device=${DEV}&id=${item.id}`);
  assert.equal(del.body.deleted, 1);
  assert.equal((await call(env, "GET", "/api/morning-check?device=" + DEV)).body.items.length, 0);
});

test("bad input is refused with a reason", async () => {
  const env = freshEnv();
  const base = { device: DEV, from: { id: "213410" }, to: { id: "213510" }, time: "08:00" };
  assert.equal((await call(env, "POST", "/api/morning-check", { ...base, device: "x" })).status, 400);
  assert.equal((await call(env, "POST", "/api/morning-check", { ...base, time: "25:00" })).status, 400);
  assert.equal((await call(env, "POST", "/api/morning-check", { ...base, days: [0, 9] })).status, 400);
  assert.equal((await call(env, "POST", "/api/morning-check", { ...base, to: { id: "213410" } })).status, 400);
  assert.equal((await call(env, "POST", "/api/morning-check", { ...base, lead: 2 })).status, 400);
  for (let i = 0; i < 6; i++) assert.equal((await call(env, "POST", "/api/morning-check", { ...base, time: `0${i}:00` })).status, 200);
  assert.equal((await call(env, "POST", "/api/morning-check", base)).status, 409);
  assert.equal((await call(env, "DELETE", "/api/morning-check?device=" + DEV)).body.deleted, 6);
});

test("clearing all data for the device removes its morning checks", async () => {
  const env = freshEnv();
  await setup(env);
  const r = await call(env, "POST", "/api/history/delete", { profile: "profile-abc", device: DEV, scope: "all" });
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted.morningChecks, 1);
  assert.equal((await call(env, "GET", "/api/morning-check?device=" + DEV)).body.items.length, 0);
});

test("all fine: silent, and the check runs once", async () => {
  const env = freshEnv(); resetLifts();
  await setup(env);
  tripAnswer = efaTrip([[{ from: "burwood", to: "strathfield", dep: sydMs(8, 0), delay: 1, plat: "Platform 3" }]]);
  const out = await W.processMorningChecks(env, sydMs(7, 45));
  assert.equal(out.length, 1);
  assert.equal(out[0].result, "ok");
  assert.equal((await notes(env)).length, 0);
  assert.equal(expoSent.length, 0);
  // The next minutes find the claim and do nothing.
  assert.equal((await W.processMorningChecks(env, sydMs(7, 46))).length, 0);
  const list = await call(env, "GET", "/api/morning-check?device=" + DEV);
  assert.equal(list.body.items[0].last.result, "ok");
});

test("a delay over 5 min sends one alert, never two", async () => {
  const env = freshEnv(); resetLifts(); expoSent.length = 0;
  await setup(env);
  tripAnswer = efaTrip([[{ from: "burwood", to: "strathfield", dep: sydMs(8, 0), delay: 7, plat: "Platform 3" }]]);
  const now = sydMs(7, 45);
  // Two ticks at the same moment (a slow tick and the next one) still send once.
  const [a, b] = await Promise.all([W.processMorningChecks(env, now), W.processMorningChecks(env, now)]);
  const ran = [...a, ...b].filter((x) => x.result);
  assert.equal(ran.length, 1);
  assert.equal(ran[0].result, "alert");
  const n = await notes(env);
  assert.equal(n.length, 1);
  assert.equal(n[0].title, "Check before you go: Burwood to Strathfield");
  assert.match(n[0].body, /8:00am T1 is 7 min late/);
  assert.equal(expoSent.length, 1);
  await W.processMorningChecks(env, sydMs(7, 50));
  assert.equal((await notes(env)).length, 1);
});

test("exactly 5 min late is not an alert", async () => {
  const env = freshEnv(); resetLifts();
  await setup(env);
  tripAnswer = efaTrip([[{ from: "burwood", to: "strathfield", dep: sydMs(8, 0), delay: 5 }]]);
  const out = await W.processMorningChecks(env, sydMs(7, 45));
  assert.equal(out[0].result, "ok");
});

test("outside the window, on a day not chosen, or switched off: nothing", async () => {
  const env = freshEnv(); resetLifts();
  await setup(env, { days: [6, 7] });
  tripAnswer = efaTrip([[{ from: "burwood", to: "strathfield", dep: sydMs(8, 0), delay: 9 }]]);
  assert.equal((await W.processMorningChecks(env, sydMs(7, 45)))[0].skipped, "not today");
  const env2 = freshEnv();
  await setup(env2);
  assert.equal((await W.processMorningChecks(env2, sydMs(7, 30))).length, 0);   // 30 min early
  assert.equal((await W.processMorningChecks(env2, sydMs(7, 58))).length, 0);   // 2 min before
  assert.equal((await notes(env2)).length, 0);
});

const todIn = (mins) => { const p = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(Date.now() + mins * MIN)); const g = (t) => Number(p.find((x) => x.type === t).value) % 24; return `${String(g("hour")).padStart(2, "0")}:${String(g("minute")).padStart(2, "0")}`; };

test("the minute tick runs morning checks, and the server flag switches them off", async () => {
  const env = freshEnv(); resetLifts();
  await setup(env, { time: todIn(10), days: [1, 2, 3, 4, 5, 6, 7] });
  tripAnswer = efaTrip([[{ from: "burwood", to: "strathfield", dep: Date.now() + 10 * MIN, delay: 9 }]]);
  // Off: an admin stores flags.morningCheck false for platform "server".
  env.DB.sql.exec("CREATE TABLE IF NOT EXISTS app_config (platform TEXT PRIMARY KEY, body TEXT NOT NULL, at INTEGER)");
  await env.DB.prepare("INSERT INTO app_config (platform, body, at) VALUES ('server', ?1, 0)").bind(JSON.stringify({ flags: { morningCheck: false } })).run();
  W.serverCfg.at = 0;
  const off = await W.runTick(env, { force: true, noSample: true });
  assert.equal(off.morning, undefined);
  assert.equal((await notes(env)).length, 0);
  await env.DB.prepare("DELETE FROM app_config").run();
  W.serverCfg.at = 0;
  const on = await W.runTick(env, { force: true, noSample: true });
  assert.equal(on.morning.length, 1, JSON.stringify(on.morning));
  assert.equal(on.morning[0].result, "alert");
  assert.equal((await notes(env)).length, 1);
});

test("live data down: the claim is given back and the next minute tries again", async () => {
  const env = freshEnv(); resetLifts();
  await setup(env);
  upstreamDown = true;
  const a = await W.processMorningChecks(env, sydMs(7, 45));
  assert.ok(a[0].error);
  upstreamDown = false;
  tripAnswer = efaTrip([[{ from: "burwood", to: "strathfield", dep: sydMs(8, 0), cancelled: true, delay: 0 }]]);
  const b = await W.processMorningChecks(env, sydMs(7, 46));
  assert.equal(b[0].result, "alert");
  assert.match((await notes(env))[0].body, /8:00am T1 is cancelled/);
});

test("trackwork, platform change and lift outage are each named", async () => {
  const env = freshEnv(); resetLifts();
  await setup(env);
  liftAnswer = { infos: { current: [liftInfo("213510"), liftInfo("213410", "ESCALATOR", "Escalator 1 is not available")] } };
  tripAnswer = efaTrip([[{ from: "burwood", to: "strathfield", dep: sydMs(8, 0), delay: 0, plat: "Platform 4", platPlanned: "Platform 3", infos: ["Buses replace trains between Lidcombe and Parramatta"] }]]);
  const out = await W.processMorningChecks(env, sydMs(7, 47));
  assert.equal(out[0].result, "alert");
  assert.deepEqual(out[0].issues.sort(), ["lift", "platform", "trackwork"]);
  const body = (await notes(env))[0].body;
  assert.match(body, /now leaves from Platform 4, not Platform 3/);
  assert.match(body, /Lift out of service at Strathfield/);
  assert.doesNotMatch(body, /Burwood\./);   // an escalator outage is not a lift outage
  liftAnswer = { infos: { current: [] } }; resetLifts();
});

test("a lift outage is not named for a trip that starts by bus", () => {
  const c = { from_id: "213410", from_name: "Burwood Station", to_id: "213510", to_name: "Strathfield Station" };
  const outs = [{ kind: "lift", stops: ["213410"], title: "Lift 1 is not available" }];
  const leg = (mode) => ({ kind: "transit", mode, line: "X", planned: new Date(sydMs(8, 0)).toISOString(), fromParent: "213410", toParent: "999999" });
  assert.deepEqual(W.morningIssues({ legs: [leg("bus")] }, c, outs), []);
  assert.deepEqual(W.morningIssues({ legs: [leg("train")] }, c, outs).map((i) => i.kind), ["lift"]);
});

test("a departure just after midnight is checked on the right day", async () => {
  const env = freshEnv(); resetLifts();
  // Saturday only, 00:05. Friday 23:55 is 10 min before.
  await setup(env, { time: "00:05", days: [6] });
  const fri2355 = sydMs(7, 45) + 4 * 1440 * MIN + (16 * 60 + 10) * MIN;
  tripAnswer = efaTrip([[{ from: "burwood", to: "strathfield", dep: fri2355 + 10 * MIN, delay: 12 }]]);
  const out = await W.processMorningChecks(env, fri2355);
  assert.equal(out[0].result, "alert");
});

test("issues come only from data: no realtime means no delay claim", () => {
  const c = { from_id: "213410", from_name: "Burwood Station", to_id: "213510", to_name: "Strathfield Station" };
  const leg = { kind: "transit", line: "T1", planned: new Date(sydMs(8, 0)).toISOString(), realtime: false, delayMin: null, fromPlatform: "Platform 3", fromParent: "213410", toParent: "213510", alerts: [{ title: "Opal readers upgraded at Burwood" }] };
  assert.deepEqual(W.morningIssues({ legs: [leg] }, c, []), []);
  const j = W.morningJourney([{ board: new Date(sydMs(8, 30)).toISOString(), legs: [{ ...leg, planned: new Date(sydMs(8, 30)).toISOString() }] }, { board: new Date(sydMs(8, 2)).toISOString(), legs: [{ ...leg, planned: new Date(sydMs(8, 2)).toISOString() }] }], 480, sydMs(7, 45));
  assert.equal(j.board, new Date(sydMs(8, 2)).toISOString());
  // Nothing within 45 min of the usual time: no journey, so no guess.
  assert.equal(W.morningJourney([{ board: new Date(sydMs(10, 0)).toISOString(), legs: [{ ...leg, planned: new Date(sydMs(10, 0)).toISOString() }] }], 480, sydMs(7, 45)), null);
});

test("preview checks now without sending or claiming", async () => {
  const env = freshEnv(); resetLifts();
  const item = await setup(env);
  tripAnswer = efaTrip([[{ from: "burwood", to: "strathfield", dep: Date.now() + 20 * MIN, delay: 8 }]]);
  // Preview looks at the usual time; point the check at a time near now.
  const tod = todIn(20);
  await call(env, "POST", "/api/morning-check", { id: item.id, device: DEV, from: { id: "213410", name: "Burwood Station" }, to: { id: "213510", name: "Strathfield Station" }, time: tod });
  const r = await call(env, "GET", `/api/morning-check/preview?device=${DEV}&id=${item.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.found, true);
  assert.equal(r.body.sent, false);
  assert.deepEqual(r.body.issues.map((i) => i.kind), ["delay"]);
  assert.match(r.body.alert.body, /8 min late/);
  assert.equal((await notes(env)).length, 0);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM morning_sent").first()).n, 0);
});

test("usual mode first, unknown kinds of service last, long alerts cut at a word", async () => {
  const leg = (mode, line, h, m) => ({ kind: "transit", mode, line, planned: new Date(sydMs(h, m)).toISOString() });
  const J = (l) => ({ board: l.planned, legs: [l] });
  const js = [J(leg("other", "D400", 8, 0)), J(leg("train", "T1", 8, 7)), J(leg("bus", "47T2", 8, 2))];
  assert.equal(W.morningJourney(js, 480, sydMs(7, 45)).legs[0].line, "47T2");
  assert.equal(W.morningJourney(js, 480, sydMs(7, 45), "train").legs[0].line, "T1");
  assert.equal(W.morningJourney([js[0]], 480, sydMs(7, 45)).legs[0].line, "D400");
  const env = freshEnv(); resetLifts();
  await setup(env, { mode: "train" });
  assert.equal((await call(env, "POST", "/api/morning-check", { device: DEV, from: { id: "1" }, to: { id: "2" }, time: "08:00", mode: "rocket" })).status, 400);
  const long = "T1 Western Line: Trains run to a changed timetable and stopping pattern between Lidcombe and Penrith because of trackwork, with buses replacing trains between Parramatta and Penrith all weekend";
  tripAnswer = efaTrip([[{ from: "burwood", to: "strathfield", dep: sydMs(8, 0), delay: 0, infos: [long] }]]);
  const out = await W.processMorningChecks(env, sydMs(7, 45));
  assert.equal(out[0].result, "alert");
  const body = (await notes(env))[0].body;
  assert.ok(body.length <= 160, body);
  assert.match(body, /^T1 Western Line: Trains run to a changed timetable .*\w\.\.\.$/);
  const list = await call(env, "GET", "/api/morning-check?device=" + DEV);
  assert.equal(list.body.items[0].mode, "train");
});
