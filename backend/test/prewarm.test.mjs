// Commute pre-warm (27 Oct speed pass): the minute tick keeps the trip pairs, boards and car park copies people use
// fresh in the hours they use them, from the last 7 days of asks, with a daily cap on Transport for NSW calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./helpers/d1.mjs";
import { efaTrip } from "./helpers/efa.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") +
  "\nexport { __default, prewarm, prewarmPick, prewarmUrl, prewarmPrune, prewarmAdd, prewarmMem, sydneyNow, PREWARM_DAY_CAP, PREWARM_PER_TICK, PREWARM_EVERY_MS, upstream };\n";
const tmp = `/tmp/prewarm-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

let calls = [];
globalThis.fetch = async (u) => {
  const url = new URL(String(u.url || u));
  calls.push(url.pathname);
  W.upstream.calls++;
  if (url.pathname.endsWith("/tp/trip")) {
    const now = Date.now();
    return new Response(JSON.stringify(efaTrip([3, 13, 23].map((m) => [{ from: "kingscross", to: "strathfield", dep: now + m * 60000, min: 20, delay: 1, trip: "t" + m }]))));
  }
  return new Response("{}", { status: 503 });
};
globalThis.caches = { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };
const behind = [];
const exec = { waitUntil: (p) => { behind.push(Promise.resolve(p).catch(() => null)); } };
async function settle() { for (let n = -1; n !== behind.length;) { n = behind.length; await Promise.all(behind); await new Promise((r) => setTimeout(r, 20)); } }
// One database for the whole file (the worker makes its tables once per copy), emptied per test.
const D0 = makeD1();
const fresh = () => { for (const t of ["searches", "board_copies", "meta"]) { try { D0.sql.exec("DELETE FROM " + t); } catch (e) { /* not made yet */ } } return { D: D0, env: { TFNSW_API_KEY: "t", DB: D0 } }; };
const sn = () => W.sydneyNow();
const dayBefore = (day, n) => { const t = Date.parse(day.slice(0, 4) + "-" + day.slice(4, 6) + "-" + day.slice(6) + "T12:00:00Z") - n * 86400000; return new Date(t).toISOString().slice(0, 10).replace(/-/g, ""); };

test("usual hours: a key asked on 2 of the last 7 days in an hour is warm from 30 min before that hour to its end, never at night", () => {
  const map = { "trip:1>2": { 8: ["20261026", "20261027"] }, "trip:3>4": { 8: ["20261027"] }, "5|": { 23: ["20261025", "20261026", "20261027"] } };
  assert.deepEqual(W.prewarmPick([map], 7 * 60 + 29), []);
  assert.deepEqual(W.prewarmPick([map], 7 * 60 + 30).map((x) => x.k), ["trip:1>2", "1|"], "the pair and its first stop's board, trips first");
  assert.deepEqual(W.prewarmPick([map], 8 * 60 + 59).map((x) => x.k), ["trip:1>2", "1|"]);
  assert.deepEqual(W.prewarmPick([map], 9 * 60), []);
  assert.deepEqual(W.prewarmPick([map], 23 * 60 + 10).map((x) => x.k), ["5|"]);
  assert.deepEqual(W.prewarmPick([{ "6|": { 2: ["20261026", "20261027"] } }], 2 * 60 + 10), [], "never 1 AM to 4:30 AM");
  assert.deepEqual(W.prewarmPick([{ "7|": { 0: ["20261026", "20261027"] } }], 23 * 60 + 40).map((x) => x.k), ["7|"], "the lead time wraps past midnight");
});

test("history keeps 7 days and a bounded number of keys; the refresh request for each kind of key", () => {
  const m = {};
  W.prewarmAdd(m, "1|", "20261027", "8"); W.prewarmAdd(m, "1|", "20261019", "8"); W.prewarmAdd(m, "1|", "20261027", "8");
  W.prewarmPrune(m, "20261027");
  assert.deepEqual(m, { "1|": { 8: ["20261027"] } });
  const big = {};
  for (let i = 0; i < 400; i++) W.prewarmAdd(big, i + "|", "20261027", "8");
  assert.equal(Object.keys(W.prewarmPrune(big, "20261027")).length, 300);
  const u = (k) => { const x = W.prewarmUrl("h.example", k); return x ? x.pathname + x.search : null; };
  assert.equal(u("trip:213510>201110"), "/api/trip?from=213510&to=201110&count=6");
  assert.equal(u("213516|"), "/api/departures?stop=213516");
  assert.equal(u("213510|train"), "/api/departures?stop=213510&mode=train");
  assert.equal(u("park:all"), "/api/parking");
  assert.equal(u("park:stop:2155384"), "/api/parking?stop=2155384");
  assert.equal(u("trip:a b>c"), null);
});

test("the tick warms a pair asked on 2 days at this hour, saves it, counts its calls, and leaves a fresh copy alone", { timeout: 30000 }, async () => {
  const { D, env } = fresh();
  const s = sn();
  if (s.tod >= 50 && s.tod < 280) return; // the night pause: nothing to check at this hour
  // The schema the worker makes on first use, and two days of the same trip at this hour by two people.
  await W.prewarm(env, exec, { calls: 0 }, { ...s, tod: 120 });
  for (const [p, day] of [["prof01", s.day], ["prof02", dayBefore(s.day, 1)]]) {
    D.sql.prepare("INSERT INTO searches (profile, device, day, dow, tod, from_id, from_name, to_id, to_name, src, at) VALUES (?, NULL, ?, 1, ?, '201110', 'Kings Cross', '213510', 'Strathfield', 'search', ?)").run(p, day, s.tod, Date.now() - 3600000);
  }
  // One asked on 1 day only stays cold.
  D.sql.prepare("INSERT INTO searches (profile, device, day, dow, tod, from_id, from_name, to_id, to_name, src, at) VALUES ('prof03', NULL, ?, 1, ?, '200060', 'Central', '213510', 'Strathfield', 'search', ?)").run(s.day, s.tod, Date.now() - 3600000);
  W.prewarmMem.trips = null;
  calls = [];
  const r = await W.prewarm(env, exec, { calls: 0 }, s);
  assert.equal(r.keys, 2, "the pair and its first stop's board");
  assert.ok(r.due <= W.PREWARM_PER_TICK);
  assert.ok(calls.some((p) => p.endsWith("/tp/trip")), "the pair was fetched");
  await settle();
  const row = D.sql.prepare("SELECT k, opened FROM board_copies WHERE k = 'trip:201110>213510'").get();
  assert.ok(row, "and saved for the next first open");
  assert.equal(Number(row.opened), 0, "a warm fetch is not an open (it does not feed its own history)");
  const count = JSON.parse(D.sql.prepare("SELECT v FROM meta WHERE k = 'prewarm_day'").get().v);
  assert.equal(count.day, s.day);
  assert.equal(count.calls, r.calls);
  assert.ok(!calls.some((p) => /200060/.test(p)));
  // A minute later the trip copy is fresh: not fetched again.
  calls = [];
  const r2 = await W.prewarm(env, exec, { calls: 0 }, s);
  assert.ok(!calls.some((p) => p.endsWith("/tp/trip")), "a fresh copy is left alone");
  assert.ok(r2.keys === 2);
});

test("the daily cap and the off switch stop it", async () => {
  const { D, env } = fresh();
  const s = sn();
  if (s.tod >= 50 && s.tod < 280) return;
  await W.prewarm(env, exec, { calls: 0 }, { ...s, tod: 120 });
  for (const day of [s.day, dayBefore(s.day, 2)]) D.sql.prepare("INSERT INTO searches (profile, device, day, dow, tod, from_id, from_name, to_id, to_name, src, at) VALUES ('prof01', NULL, ?, 1, ?, '201110', 'Kings Cross', '213510', 'Strathfield', 'search', ?)").run(day, s.tod, Date.now() - 3600000);
  W.prewarmMem.trips = null;
  D.sql.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('prewarm_day', ?)").run(JSON.stringify({ day: s.day, calls: W.PREWARM_DAY_CAP, fetches: 1 }));
  calls = [];
  const r = await W.prewarm(env, exec, { calls: 0 }, s);
  assert.equal(r.skipped, "cap");
  assert.equal(calls.length, 0);
  assert.equal((await W.prewarm({ ...env, PREWARM: "off" }, exec, { calls: 0 }, s)).skipped, "off");
  assert.equal((await W.prewarm(env, exec, { calls: 999999 }, s)).skipped, "day count");
});
