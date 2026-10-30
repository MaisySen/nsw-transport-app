// Last way home: from the Ask "Last train home" answer, one push 15 min before the last service home, found by
// the server, looked at again live as the time comes near, sent once, cancelable, gone with Delete all data.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./helpers/d1.mjs";
import { efaTrip } from "./helpers/efa.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { __default, processLastHome, lastHomeMessage, lastHomeService, askDecorate, ensureSchema3, lastHomeSchema, serverCfg, runTick };\n";
const tmp = `/tmp/lasthome-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const MIN = 60000;
let tripAnswer = { journeys: [] };
const expoSent = [];
globalThis.fetch = async (u, init) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (url.hostname === "exp.host") { const b = JSON.parse(init.body); expoSent.push(...b); return new Response(JSON.stringify({ data: b.map(() => ({ status: "ok" })) })); }
  if (url.pathname.endsWith("/trip")) return new Response(JSON.stringify(tripAnswer));
  return new Response("{}", { status: 404 });
};
const sharedDB = makeD1();
function freshEnv() {
  for (const t of ["last_home", "notes", "expo_tokens", "push_subs", "app_config"]) { try { sharedDB.sql.exec("DELETE FROM " + t); } catch (e) { /* not made yet */ } }
  W.serverCfg.at = 0; expoSent.length = 0;
  return { TFNSW_API_KEY: "t", DB: sharedDB };
}
let ip = 1;
async function call(env, method, path, body) {
  const r = await W.__default.fetch(new Request("https://t.example" + path, { method, headers: { "cf-connecting-ip": "10.7.0." + (ip++ % 250), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json() };
}
const DEV = "dev-lasthome-1";
const FROM = { id: "200060", name: "Central Station" }, TO = { id: "215020", name: "Parramatta Station" };
async function withToken(env) {
  await W.ensureSchema3(env);
  await env.DB.prepare("INSERT INTO expo_tokens (token, device, profile, platform, created, fails) VALUES ('ExponentPushToken[lasthome12345]', ?1, '', 'ios', 0, 0)").bind(DEV).run();
}
// A journey as the worker keeps it after reading the Trip Planner.
const j = (dep, o = {}) => ({ leave: new Date(o.walk ? dep - o.walk * MIN : dep).toISOString(), arrive: new Date(dep + 20 * MIN).toISOString(),
  legs: [...(o.walk ? [{ kind: "walk", durationMin: o.walk }] : []), { kind: "transit", mode: o.mode || "train", line: o.line || "T1", from: "Central Station", fromPlatform: o.plat || "Platform 16",
    planned: new Date(dep).toISOString(), estimated: o.late ? new Date(dep + o.late * MIN).toISOString() : null, realtime: o.late != null }] });

test("register: the server finds the last service itself, one reminder per device, GET shows it, DELETE cancels", async () => {
  const env = freshEnv();
  await withToken(env);
  const now = Date.now();
  // 40 and 70 min from now tonight, then the first one tomorrow morning: the last one tonight is the 70 min one.
  tripAnswer = efaTrip([[{ from: "central", to: "parramatta", dep: now + 40 * MIN, plat: "Platform 16" }], [{ from: "central", to: "parramatta", dep: now + 70 * MIN, plat: "Platform 16" }], [{ from: "central", to: "parramatta", dep: now + 7 * 60 * MIN }]]);
  const r = await call(env, "POST", "/api/last-home", { device: DEV, from: FROM, to: TO, mode: "train" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(Math.abs(Date.parse(r.body.item.board) - (now + 70 * MIN)) < 1000, r.body.item.board);
  assert.equal(Date.parse(r.body.item.remindAt), Date.parse(r.body.item.leave) - 15 * MIN);
  assert.equal(r.body.item.status, "waiting");
  assert.equal(r.body.item.lead, 15);
  assert.deepEqual(r.body.push, { web: 0, expo: 1 });
  // A second one replaces the first.
  const r2 = await call(env, "POST", "/api/last-home", { device: DEV, from: FROM, to: TO });
  assert.equal(r2.status, 200);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM last_home WHERE device = ?1").bind(DEV).first()).n, 1);
  const g = await call(env, "GET", `/api/last-home?device=${DEV}`);
  assert.equal(g.body.item.id, r2.body.item.id);
  assert.equal(g.body.enabled, true);
  const del = await call(env, "DELETE", `/api/last-home?device=${DEV}`);
  assert.equal(del.body.deleted, 1);
  assert.equal((await call(env, "GET", `/api/last-home?device=${DEV}`)).body.item, null);
});

test("refuses honestly: no service, too soon, bad input, flag off", async () => {
  const env = freshEnv();
  const now = Date.now();
  tripAnswer = { journeys: [] };
  let r = await call(env, "POST", "/api/last-home", { device: DEV, from: FROM, to: TO });
  assert.equal(r.status, 409); assert.equal(r.body.reason, "none");
  tripAnswer = efaTrip([[{ from: "central", to: "parramatta", dep: now + 9 * MIN }], [{ from: "central", to: "parramatta", dep: now + 7 * 60 * MIN }]]);
  r = await call(env, "POST", "/api/last-home", { device: DEV, from: FROM, to: TO });
  assert.equal(r.status, 409); assert.equal(r.body.reason, "soon"); assert.match(r.body.error, /too soon/);
  assert.equal((await call(env, "POST", "/api/last-home", { device: "x", from: FROM, to: TO })).status, 400);
  assert.equal((await call(env, "POST", "/api/last-home", { device: DEV, from: FROM, to: FROM })).status, 400);
  assert.equal((await call(env, "POST", "/api/last-home", { device: DEV, from: FROM, to: TO, mode: "rocket" })).status, 400);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS app_config (platform TEXT PRIMARY KEY, body TEXT NOT NULL, at INTEGER)").run();
  await env.DB.prepare("INSERT OR REPLACE INTO app_config (platform, body, at) VALUES ('server', ?1, 0)").bind(JSON.stringify({ flags: { lastWayHome: false } })).run();
  W.serverCfg.at = 0;
  r = await call(env, "POST", "/api/last-home", { device: DEV, from: FROM, to: TO });
  assert.equal(r.status, 503); assert.equal(r.body.enabled, false);
});

async function seed(env, leave, extra = {}) {
  await W.lastHomeSchema(env);
  await env.DB.prepare(`INSERT INTO last_home (id, device, from_id, from_name, to_id, to_name, mode, svc_mode, lead, leave, first_leave, board, line, stop, platform, status, created, checked, sent, sent_text)
    VALUES ('lh1', ?1, '200060', 'Central Station', '215020', 'Parramatta Station', NULL, 'train', 15, ?2, ?2, ?2, 'T1', 'Central', 'Platform 16', 'waiting', 0, ?3, NULL, NULL)`).bind(DEV, leave, extra.checked ?? 0).run();
}
const row = async (env) => env.DB.prepare("SELECT * FROM last_home WHERE id = 'lh1'").first();

test("tick: quiet until 15 min before, looks again live, follows a later service, sends once", async () => {
  const env = freshEnv();
  await withToken(env);
  const t0 = Date.now();
  const leave = t0 + 40 * MIN;
  await seed(env, leave);
  let looks = 0;
  let svc = leave;
  const find = async () => { looks++; return { last: j(svc), sure: true }; };
  // 25 min before: nothing at all (outside the 20 min window).
  let out = await W.processLastHome(env, leave - 36 * MIN, { find });
  assert.equal(out.length, 0); assert.equal(looks, 0);
  // 20 min before: one live look, nothing sent.
  out = await W.processLastHome(env, leave - 20 * MIN, { find });
  assert.equal(looks, 1); assert.equal(out[0].result, "waiting");
  // A minute later: no new look (every 5 min).
  await W.processLastHome(env, leave - 19 * MIN, { find });
  assert.equal(looks, 1);
  // The service now runs 6 min late: the reminder moves with it, so 15 min before the old time is still quiet.
  svc = leave + 6 * MIN;
  out = await W.processLastHome(env, leave - 15 * MIN, { find });
  assert.equal(looks, 2); assert.equal(out[0].result, "waiting");
  assert.equal((await row(env)).leave, leave + 6 * MIN);
  assert.equal(expoSent.length, 0);
  // 15 min before the new time: one more look, then one push.
  out = await W.processLastHome(env, leave - 9 * MIN, { find });
  assert.equal(out[0].result, "sent");
  assert.equal(expoSent.length, 1);
  assert.match(expoSent[0].title, /^Last train to Parramatta$/);
  assert.match(expoSent[0].body, /^Leaves in 15 min: the \d{1,2}:\d{2}(am|pm) T1 from Central, Platform 16\. It changed from \d{1,2}:\d{2}(am|pm)\.$/);
  assert.doesNotMatch(expoSent[0].body, /[\u2013\u2014]/);
  // Never twice.
  await W.processLastHome(env, leave - 8 * MIN, { find });
  await W.processLastHome(env, leave - 7 * MIN, { find });
  assert.equal(expoSent.length, 1);
  const r = await row(env);
  assert.equal(r.status, "sent"); assert.ok(r.sent);
  const g = await call(env, "GET", `/api/last-home?device=${DEV}`);
  assert.equal(g.body.item.status, "sent");
  assert.ok(g.body.item.changedFrom);
  assert.equal(g.body.item.text, expoSent[0].body);
});

test("tick: a walk first says leave by; no service any more says so once; a live data failure tries again; gone after it left", async () => {
  let env = freshEnv();
  await withToken(env);
  const t0 = Date.now();
  await seed(env, t0 + 30 * MIN);
  await W.processLastHome(env, t0 + 15 * MIN, { find: async () => ({ last: j(t0 + 38 * MIN, { walk: 8 }), sure: true }) });
  assert.match(expoSent[0].body, /^Leave by \d{1,2}:\d{2}(am|pm): the /);

  env = freshEnv();
  await withToken(env);
  await seed(env, t0 + 30 * MIN);
  let out = await W.processLastHome(env, t0 + 15 * MIN, { find: async () => { throw new Error("planner busy"); } });
  assert.ok(out[0].error); assert.equal(expoSent.length, 0);
  assert.equal((await row(env)).sent, null);
  out = await W.processLastHome(env, t0 + 15 * MIN + 30000, { find: async () => null });
  assert.equal(out[0].result, "none");
  assert.equal(expoSent.length, 1);
  assert.match(expoSent[0].body, /^No service from Central to Parramatta shows for the rest of tonight\. Open Plan for other ways home\.$/);

  env = freshEnv();
  await seed(env, t0 - 10 * MIN);
  out = await W.processLastHome(env, t0, { find: async () => { throw new Error("should not look"); } });
  assert.equal(out[0].result, "gone");
  assert.equal((await row(env)).status, "gone");
});

test("the Ask last train answer carries lastHome only when there is time for the reminder", () => {
  const now = Date.now();
  const d = (leave) => W.askDecorate({ kind: "lastService", mode: "train", from: FROM, to: TO, last: j(leave), before: null, after: null, sure: true, now }, {});
  const a = d(now + 60 * MIN);
  assert.deepEqual(a.lastHome.from, FROM); assert.deepEqual(a.lastHome.to, TO);
  assert.equal(a.lastHome.mode, "train"); assert.equal(a.lastHome.lead, 15);
  assert.equal(d(now + 10 * MIN).lastHome, undefined);
  assert.equal(d(now - 10 * MIN).lastHome, undefined);
});

test("Delete all data removes the reminder for that device", async () => {
  const env = freshEnv();
  await seed(env, Date.now() + 60 * MIN);
  const r = await call(env, "POST", "/api/history/delete", { profile: "lasthomeprofile01", device: DEV, scope: "all" });
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted.lastHome, 1);
  assert.equal(await row(env), null);
});
