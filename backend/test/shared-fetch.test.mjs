// Shared fetching for many phones (scaling, 26 Oct 2026): a burst for one stop makes one upstream call, a copy is
// shared without profile or device, a busy or refusing Transport for NSW serves the last copy instead of an error,
// and the load test key only lifts the per address limits.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
let src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default, budget, budgetStats, upstreamBusy, upstreamRefused, inFlight, upstreamSlot, slotTimes };\n";
const tmp = `/tmp/shared-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

let upstream = 0, refuse = null, gate = null, refuseTimes = 0;
globalThis.fetch = async (u) => {
  const url = String(u);
  if (!/\/v1\/tp\/departure_mon/.test(url)) return new Response("{}", { status: 503 });
  upstream++;
  if (gate) await gate;
  if (refuseTimes > 0) { refuseTimes--; return new Response('{"ErrorDetails":{"Message":"Your API quota or rate limit has been exceeded. If you"}}', { status: 429 }); }
  if (refuse) return new Response('{"code":403,"message":"Account over rate limit"}', { status: 403, headers: { "x-error-detail": refuse } });
  const stop = new URL(url).searchParams.get("name_dm");
  return new Response(JSON.stringify({ locations: [{ name: "Stop " + stop, disassembledName: "Stop " + stop }], stopEvents: [] }), { headers: { "content-type": "application/json", "x-ratelimit-limit": "5" } });
};
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), run: async () => ({ meta: { changes: 0 } }), all: async () => ({ results: [] }), first: async () => (/ip_rate/.test(q) ? { n: 999 } : null) });
const env = { TFNSW_API_KEY: "t", LOAD_TEST_KEY: "load-key-0123456789", DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) }, ASSETS: { fetch: async () => new Response("[]") } };
const store = new Map();
globalThis.caches = { default: { match: async (req) => { const r = store.get(req.url); return r ? r.clone() : undefined; }, put: async (req, res) => { store.set(req.url, res); } } };
const waits = [];
const ex = { waitUntil(p) { waits.push(p); } };
const call = (p, ip = "10.7.0.1", h = {}) => W.__default.fetch(new Request("https://t.example" + p, { headers: { "cf-connecting-ip": ip, ...h } }), env, ex);
const L = { "x-load-key": "load-key-0123456789" };

test("50 phones asking for one stop at once make one upstream call; every phone gets the answer", async () => {
  let open; gate = new Promise((r) => { open = r; });
  const n0 = upstream;
  const all = Array.from({ length: 50 }, (_, i) => call(`/api/departures?stop=219910&profile=p${i}x&device=d${i}`, "10.7.1." + i, L));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(W.inFlight.size >= 1, true, "one answer in flight");
  open(); gate = null;
  const res = await Promise.all(all);
  assert.equal(upstream - n0, 1, "one call to Transport for NSW");
  assert.ok(res.every((r) => r.status === 200));
  const tags = res.map((r) => r.headers.get("x-edge-cache"));
  assert.equal(tags.filter((t) => t === "miss").length, 1);
  assert.equal(tags.filter((t) => t === "shared").length, 49);
  const bodies = await Promise.all(res.map((r) => r.json()));
  assert.ok(bodies.every((b) => b.stop && b.stop.id === "219910"));
  await Promise.all(waits);
  assert.ok(store.get("https://t.example/api/departures?stop=219910"), "stored once, keyed by the stop only");
  assert.equal(W.inFlight.size, 0, "nothing left in flight");
});

test("a second stop is its own key and its own call", async () => {
  const n0 = upstream;
  const [a, b] = await Promise.all([call("/api/departures?stop=219920", "10.7.2.1", L), call("/api/departures?stop=219921", "10.7.2.2", L)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(upstream - n0, 2);
});

const putCopy = (k, ageMs, body = { kind: "departures", items: [], copy: true, now: 1792960000000 }) =>
  store.set(k, new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "x-stored-at": String(Date.now() - ageMs) } }));

test("a refresh skips a 20 s old copy while upstream has room, and is served that copy when upstream is busy", async () => {
  const k = "https://t.example/api/departures?stop=219930";
  W.slotTimes.length = 0;
  putCopy(k, 20000);
  const n0 = upstream;
  let r = await call("/api/departures?stop=219930&refresh=1", "10.7.3.1", L);
  assert.equal(r.headers.get("x-edge-cache"), "miss");
  assert.equal(upstream - n0, 1);
  // Fill this copy's budget for the last 10 s.
  for (let i = 0; i < 40; i++) W.budget.calls.push(Date.now());
  assert.equal(W.upstreamBusy(), true);
  const k2 = "https://t.example/api/departures?stop=219931";
  putCopy(k2, 20000);
  const n1 = upstream;
  r = await call("/api/departures?stop=219931&refresh=1", "10.7.3.2", L);
  assert.equal(r.headers.get("x-edge-cache"), "stale");
  assert.equal(upstream - n1, 0, "no upstream call while busy");
  const d = await r.json();
  assert.equal(d.copy, true);
  assert.ok(Date.now() - d.dataAt >= 19000, "dataAt says how old the times are");
  // Older than a minute is never served just for being busy.
  putCopy("https://t.example/api/departures?stop=219932", 70000);
  r = await call("/api/departures?stop=219932&refresh=1", "10.7.3.3", L);
  assert.equal(r.headers.get("x-edge-cache"), "miss");
  W.budget.calls.length = 0;
});

test("Transport for NSW over its rate limit: the last copy instead of an error, then a 2 s back off", async () => {
  const k = "https://t.example/api/departures?stop=219940";
  putCopy(k, 30000);
  refuse = "Account Over Rate Limit";
  const r = await call("/api/departures?stop=219940&refresh=1", "10.7.4.1", L);
  refuse = null;
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-edge-cache"), "stale");
  assert.equal((await r.json()).copy, true);
  assert.equal(W.upstreamBusy(), true, "backs off after a 403 over the limit");
  assert.ok(W.budget.overUntil - Date.now() <= 2000);
  assert.ok(W.budgetStats().refused >= 1);
  W.budget.overUntil = 0;
  // With no copy at all the phone gets the usual error answer.
  refuse = "Account Over Rate Limit";
  const e = await call("/api/departures?stop=219941", "10.7.4.2", L);
  refuse = null; W.budget.overUntil = 0;
  assert.equal(e.status, 502);
});

test("a load test request counts as busy from 1 call a second, a phone from 3", () => {
  W.budget.calls.length = 0; W.budget.overUntil = 0;
  for (let i = 0; i < 12; i++) W.budget.calls.push(Date.now());
  assert.equal(W.upstreamBusy(true), true);
  assert.equal(W.upstreamBusy(false), false);
  W.budget.calls.length = 0;
});

test("over the day's quota backs off a minute; other 403s do not count; the hub's 429 counts", () => {
  W.budget.overUntil = 0; W.budget.lastOkAt = Date.now();
  W.upstreamRefused(429, '{"ErrorDetails":{"Message":"Your API quota or rate limit has been exceeded. If you"}}');
  assert.ok(W.budget.overUntil - Date.now() <= 2000 && W.budget.overUntil > Date.now(), "429 with a good answer in the last minute: 2 s");
  W.budget.overUntil = 0; W.budget.lastOkAt = Date.now() - 120000;
  W.upstreamRefused(429, "Your API quota or rate limit has been exceeded.");
  assert.ok(W.budget.overUntil - Date.now() > 50000, "no good answer for a minute: taken as the quota");
  W.budget.overUntil = 0; W.budget.lastOkAt = Date.now();
  W.upstreamRefused(403, "Account Over Quota Limit");
  assert.ok(W.budget.overUntil - Date.now() > 50000);
  W.budget.overUntil = 0;
  W.upstreamRefused(403, "The calling application is unauthenticated.");
  assert.equal(W.budget.overUntil, 0);
  W.upstreamRefused(500, "rate");
  assert.equal(W.budget.overUntil, 0);
});

test("rate and quota headers from the hub are kept for /api/health", () => {
  assert.equal(W.budgetStats().headers["x-ratelimit-limit"], "5");
});

test("the per address limit turns a phone away; the load test key is counted the same but not turned away", async () => {
  // The D1 counter in this test answers 999 for every address (over 120 a minute).
  const r = await call("/api/departures?stop=219950", "10.7.5.1");
  assert.equal(r.status, 429);
  const ok = await call("/api/departures?stop=219950", "10.7.5.1", L);
  assert.equal(ok.status, 200);
  const wrong = await call("/api/departures?stop=219951", "10.7.5.1", { "x-load-key": "nope" });
  assert.equal(wrong.status, 429);
  const noSecret = { ...env, LOAD_TEST_KEY: undefined };
  const r2 = await W.__default.fetch(new Request("https://t.example/api/departures?stop=219952", { headers: { "cf-connecting-ip": "10.7.5.2", "x-load-key": "" } }), noSecret, ex);
  assert.equal(r2.status, 429, "no secret set: nothing matches");
});

test("with a copy in hand a slow upstream answer is waited for 700 ms at most, then the copy; the answer is stored for the next poll", async () => {
  W.budget.calls.length = 0; W.budget.overUntil = 0;
  const k = "https://t.example/api/departures?stop=219960";
  putCopy(k, 30000);
  let open; gate = new Promise((r) => { open = r; });
  const n0 = waits.length;
  const t0 = Date.now();
  const r = await call("/api/departures?stop=219960&refresh=1", "10.7.6.1", L);
  const took = Date.now() - t0;
  assert.equal(r.headers.get("x-edge-cache"), "stale");
  assert.ok(took >= 650 && took < 1500, "waited about 700 ms: " + took);
  assert.equal((await r.json()).copy, true);
  assert.ok(waits.length > n0, "the answer keeps going in the background");
  open(); gate = null;
  await Promise.all(waits); await new Promise((r) => setTimeout(r, 20)); await Promise.all(waits);
  const stored = store.get(k);
  const d = await stored.clone().json();
  assert.equal(d.copy, undefined, "the new answer replaced the copy");
  const r2 = await call("/api/departures?stop=219960&refresh=1", "10.7.6.2", L);
  assert.equal(r2.headers.get("x-edge-cache"), "hit");
});

test("with no copy a phone waits for the answer however long it takes", async () => {
  let open; gate = new Promise((r) => { open = r; });
  setTimeout(() => { open(); gate = null; }, 900);
  const t0 = Date.now();
  const r = await call("/api/departures?stop=219970", "10.7.7.1", L);
  assert.equal(r.headers.get("x-edge-cache"), "miss");
  assert.ok(Date.now() - t0 >= 850);
});

test("a 429 over the hub limit is asked again after a short wait; a phone with no copy gets the answer, not an error", async () => {
  W.budget.overUntil = 0; W.budget.calls.length = 0;
  refuseTimes = 2;
  const n0 = upstream;
  const r = await call("/api/departures?stop=219980", "10.7.8.1", L);
  assert.equal(r.status, 200);
  assert.equal(upstream - n0, 3, "refused twice, answered the third time");
  W.budget.overUntil = 0;
});

test("over the day's quota is not asked again", async () => {
  refuse = "Account Over Quota Limit";
  const n0 = upstream;
  const r = await call("/api/departures?stop=219981", "10.7.8.2", L);
  refuse = null; W.budget.overUntil = 0;
  assert.equal(r.status, 502);
  assert.equal(upstream - n0, 1);
});

test("at most 4 Trip Planner calls start in any second in one copy; the fifth waits for room", async () => {
  W.slotTimes.length = 0;
  const t0 = Date.now();
  for (let i = 0; i < 4; i++) await W.upstreamSlot();
  assert.ok(Date.now() - t0 < 100);
  await W.upstreamSlot();
  assert.ok(Date.now() - t0 >= 900, "waited for the second to pass");
  W.slotTimes.length = 0;
});
