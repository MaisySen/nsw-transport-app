// Request numbers (DIAGNOSIS_LAG.md item 10): one JSON line per /api request with path, status, time, NSW time and
// calls, copy tag and app or watch/widget; never the query. Watch and widget asks (item 4) take a kept copy at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default, extInstant, reqLine };\n";
const tmp = `/tmp/reqlog-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

let delay = 0;
globalThis.fetch = async () => { await new Promise((r) => setTimeout(r, delay)); return new Response('{"ErrorDetails":{"Message":"Your API quota or rate limit has been exceeded"}}', { status: 429 }); };
const edge = new Map();
globalThis.caches = { default: { match: async (req) => { const r = edge.get(String(req.url || req)); return r ? r.clone() : undefined; }, put: async (req, res) => { edge.set(String(req.url || req), res); } } };
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), run: async () => ({ meta: { changes: 0 } }), all: async () => ({ results: [] }), first: async () => null });
const env = { TFNSW_API_KEY: "t", DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) },
  ASSETS: { fetch: async () => new Response("[]", { headers: { "content-type": "application/json" } }) } };
const lines = [];
const log0 = console.log;
console.log = (...a) => { const s = String(a[0]); if (s.startsWith('{"t":"req"')) lines.push(JSON.parse(s)); else log0(...a); };
const ex = { waitUntil() {} };
const call = (p, ip, h = {}, e = env) => W.__default.fetch(new Request("https://t.example" + p, { headers: { "cf-connecting-ip": ip, ...h } }), e, ex);

test("one line per /api request: path, status, time, copy tag, app or ext; never the query", async () => {
  lines.length = 0;
  const r = await call("/api/stations?mode=ferry&profile=secretprofile123", "10.8.0.1");
  assert.equal(r.status, 200);
  assert.equal(lines.length, 1);
  const l = lines[0];
  assert.equal(l.p, "/api/stations"); assert.equal(l.s, 200); assert.equal(l.k, "app"); assert.equal(l.m, "GET");
  assert.ok(l.ms >= 0); assert.equal(l.un, 0); assert.ok(["miss", "hit", "shared"].includes(l.c));
  assert.ok(!JSON.stringify(l).includes("secretprofile123"), "no query in the line");
  await call("/api/stations?mode=ferry", "10.8.0.2");
  assert.equal(lines[1].k, "ext");
});

test("watch or widget ask takes a kept copy at once; the phone app waits up to 700 ms for the fresh one", async () => {
  delay = 2500;
  const put = (stop) => edge.set("https://t.example/api/departures?stop=" + stop, new Response(JSON.stringify({ kind: "departures", now: Date.now(), items: [] }), { headers: { "content-type": "application/json", "x-stored-at": String(Date.now() - 30000) } }));
  put("200097");
  let t0 = Date.now();
  let r = await call("/api/departures?stop=200097", "10.8.0.5");
  const ext = Date.now() - t0;
  assert.equal(r.headers.get("x-edge-cache"), "stale");
  assert.ok(ext < 400, "watch waited " + ext + " ms");
  put("200096");
  t0 = Date.now();
  r = await call("/api/departures?stop=200096&profile=p2", "10.8.0.6");
  const app = Date.now() - t0;
  assert.equal(r.headers.get("x-edge-cache"), "stale");
  assert.ok(app >= 600, "app waited " + app + " ms");
  delay = 0;
  assert.equal(W.extInstant(new URL("https://t.example/api/trip?from=1&to=2"), new Request("https://t.example")), true);
  assert.equal(W.extInstant(new URL("https://t.example/api/trip?from=1&to=2&refresh=1"), new Request("https://t.example")), false);
  assert.equal(W.extInstant(new URL("https://t.example/api/plan?from=1&to=2"), new Request("https://t.example")), false);
  assert.equal(W.extInstant(new URL("https://t.example/api/departures?stop=1"), new Request("https://t.example", { headers: { "x-profile": "p" } })), false);
});

test("NSW calls are counted and timed in the request that made them", async () => {
  lines.length = 0; delay = 30;
  await call("/api/departures?stop=200099&profile=p1", "10.8.0.3");
  const l = lines.at(-1);
  assert.equal(l.p, "/api/departures");
  assert.ok(l.un >= 1, "at least one NSW call");
  assert.ok(l.up >= 25, "NSW time counted: " + l.up);
  delay = 0;
});

test("REQ_LOG off: no line; paths outside /api: no line", async () => {
  lines.length = 0;
  await call("/api/stations?mode=bus", "10.8.0.4", {}, { ...env, REQ_LOG: "off" });
  assert.equal(lines.length, 0);
  assert.equal(W.reqLine(new Request("https://t.example/robots.txt"), env, null, 1, { up: 0, n: 0 }), null);
});

test("Workers Logs on, sampled, and the line is on by default", () => {
  const t = fs.readFileSync(root + "wrangler.toml.template", "utf8");
  assert.match(t, /\[observability\]\nenabled = true\nhead_sampling_rate = 0\.1/);
  assert.match(t, /REQ_LOG = "on"/);
});
