// History and data deletion: no hard coded stations on Home, and POST /api/history/delete is
// profile scoped, needs the profile id, and is rate limited.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const app = fs.readFileSync(root + "src/public/app.js", "utf8");
let src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default };\n";
const tmp = `/tmp/history-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
globalThis.fetch = async () => new Response("{}", { status: 503 });

const runs = [];
const stmt = (q, args = []) => ({
  bind: (...a) => stmt(q, a),
  run: async () => { if (/^DELETE/.test(q)) runs.push({ q, args }); return { meta: { changes: /searches/.test(q) ? 3 : 1 } }; },
  all: async () => ({ results: [] }),
  first: async () => null,
});
const env = { TFNSW_API_KEY: "t", DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) }, ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
const call = (body, ip = "10.9.0.1", method = "POST") => W.__default.fetch(new Request("https://t.example/api/history/delete", { method, headers: { "cf-connecting-ip": ip, "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }), env, { waitUntil() {} });

test("no hard coded popular stations anywhere", () => {
  assert.doesNotMatch(app, /POPULAR|Popular stations/);
  assert.doesNotMatch(src, /POPULAR|Popular stations/);
  // Home shows a clean empty state with Add a trip, never a seeded list.
  assert.match(app, /Add a trip/);
  assert.doesNotMatch(app, /tb_saved",\s*\[\s*\{/);
});

test("Home has Clear on Recent trips and Recent stops, and per item remove", () => {
  assert.match(app, /Recent trips<button class="gclear" data-clear="tb_rtrips">Clear<\/button>/);
  assert.match(app, /Recent stops<button class="gclear" data-clear="tb_rstops">Clear<\/button>/);
  assert.match(app, /Remove from Recent/);
  assert.match(app, /label: "Delete trip"/);
  assert.match(app, /label: "Edit trip"/);
  assert.match(app, /Delete my trip history on server/);
  assert.match(app, /Delete all my data/);
});

test("history delete needs POST, a profile id and a scope", async () => {
  assert.equal((await call(null, "10.9.1.1", "GET")).status, 405);
  assert.equal((await call({ scope: "history" }, "10.9.1.2")).status, 400);
  assert.equal((await call({ profile: "ab", scope: "history" }, "10.9.1.3")).status, 400);
  assert.equal((await call({ profile: "wprofile0001", scope: "everything" }, "10.9.1.4")).status, 400);
});

test("history scope deletes searches and dismissed suggestions for that profile only", async () => {
  runs.length = 0;
  const r = await call({ profile: "WProfileAbc123", device: "dDev1", scope: "history" }, "10.9.2.1");
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.deleted.searches, 6);
  assert.deepEqual(runs.map((x) => x.q), ["DELETE FROM searches WHERE profile = ?1", "DELETE FROM dismissed WHERE profile = ?1", "DELETE FROM searches WHERE device = ?1"]);
  assert.deepEqual(runs.map((x) => x.args[0]), ["wprofileabc123", "wprofileabc123", "dDev1"]);
});

test("all scope also deletes saved trips, commutes, watches, alerts and this device's push and shares", async () => {
  runs.length = 0;
  const r = await call({ profile: "wprofileabc123", device: "dDev1", scope: "all" }, "10.9.3.1");
  assert.equal(r.status, 200);
  const qs = runs.map((x) => x.q).join("\n");
  for (const t of ["searches", "dismissed", "saved", "saved_legs", "commutes", "watches", "notes", "push_subs", "expo_tokens", "shares"]) assert.match(qs, new RegExp("DELETE FROM " + t + " WHERE"), t);
  // Saved trip alerts (src/tripalerts.js) keep this device's trips in one meta row, "ta:<device>".
  assert.match(qs, /DELETE FROM meta WHERE k = \?1/);
  for (const x of runs) assert.ok(x.args[0] === "wprofileabc123" || x.args[0] === "dDev1" || x.args[0] === "ta:dDev1", x.q);
  assert.ok(!runs.some((x) => /WHERE 1|WHERE profile IS|without/.test(x.q)));
});

test("a short or shared profile id is refused, and nothing is deleted", async () => {
  runs.length = 0;
  for (const profile of ["bidur", "abc", "../../etc/passwd", "a".repeat(41)]) {
    assert.equal((await call({ profile, device: "dPhone9", scope: "all" }, "10.9.4." + profile.length)).status, 400, profile);
  }
  assert.equal(runs.length, 0);
});

test("history delete is rate limited per address", async () => {
  const ip = "10.9.5.5";
  for (let i = 0; i < 10; i++) assert.equal((await call({ profile: "wprofileabc123", scope: "history" }, ip)).status, 200);
  assert.equal((await call({ profile: "wprofileabc123", scope: "history" }, ip)).status, 429);
  assert.equal((await call({ profile: "wprofileabc123", scope: "history" }, "10.9.5.6")).status, 200);
});
