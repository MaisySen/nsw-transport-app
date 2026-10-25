// A refresh (the app's polls) takes a shared answer only while it is at most 5 s old; a cached answer says when its
// times were read (dataAt), so the app's "Updated" line is honest (freshness, 26 Oct 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
let src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default };\n";
const tmp = `/tmp/fresh-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
globalThis.fetch = async () => new Response("{}", { status: 503 });
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), run: async () => ({ meta: { changes: 0 } }), all: async () => ({ results: [] }), first: async () => (/ip_rate/.test(q) ? { n: 1 } : null) });
let assets = 0;
const env = { TFNSW_API_KEY: "t", DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) },
  ASSETS: { fetch: async () => { assets++; return new Response(JSON.stringify([{ id: "200060", name: "Central", n: assets }]), { headers: { "content-type": "application/json" } }); } } };
const store = new Map();
globalThis.caches = { default: { match: async (req) => { const r = store.get(req.url); return r ? r.clone() : undefined; }, put: async (req, res) => { store.set(req.url, res); } } };
const waits = [];
const ex = { waitUntil(p) { waits.push(p); } };
const call = (p, ip) => W.__default.fetch(new Request("https://t.example" + p, { headers: { "cf-connecting-ip": ip } }), env, ex);

test("a stored copy carries the moment it was made", async () => {
  const before = Date.now();
  const r = await call("/api/stations?mode=ferry", "10.9.0.1");
  assert.equal(r.status, 200);
  await Promise.all(waits);
  const put = store.get("https://t.example/api/stations?mode=ferry");
  const at = Number(put.headers.get("x-stored-at"));
  assert.ok(at >= before && at <= Date.now());
});

test("a cached answer says when it was made (dataAt); a body that is not an object is left alone", async () => {
  const at = Date.now() - 3000;
  store.set("https://t.example/api/stations?mode=lightrail", new Response(JSON.stringify({ kind: "stations", now: 1792960000000, items: [] }), { headers: { "content-type": "application/json", "x-stored-at": String(at) } }));
  const r = await call("/api/stations?mode=lightrail", "10.9.0.2");
  assert.equal(r.headers.get("x-edge-cache"), "hit");
  const d = await r.json();
  assert.equal(d.dataAt, at);
  assert.ok(d.now >= at, "now is the current time");
  store.set("https://t.example/api/stations?mode=coach", new Response(JSON.stringify([1, 2]), { headers: { "content-type": "application/json", "x-stored-at": String(at) } }));
  assert.deepEqual(await (await call("/api/stations?mode=coach", "10.9.0.3")).json(), [1, 2]);
});

test("refresh=1 takes a copy up to 5 s old and skips an older one; a plain open takes the older one", async () => {
  const k = "https://t.example/api/stations?mode=bus";
  const fresh = () => new Response(JSON.stringify({ kind: "stations", items: [], old: true }), { headers: { "content-type": "application/json", "x-stored-at": String(Date.now() - 2000) } });
  const old = () => new Response(JSON.stringify({ kind: "stations", items: [], old: true }), { headers: { "content-type": "application/json", "x-stored-at": String(Date.now() - 9000) } });
  store.set(k, fresh());
  let r = await call("/api/stations?mode=bus&refresh=1", "10.9.0.4");
  assert.equal(r.headers.get("x-edge-cache"), "hit", "2 s old copy serves a refresh");
  store.set(k, old());
  r = await call("/api/stations?mode=bus", "10.9.0.5");
  assert.equal(r.headers.get("x-edge-cache"), "hit", "9 s old copy serves a plain open");
  assert.equal((await r.json()).old, true);
  store.set(k, old());
  const n = assets;
  r = await call("/api/stations?mode=bus&refresh=1", "10.9.0.6");
  assert.equal(r.headers.get("x-edge-cache"), "miss", "9 s old copy is skipped by a refresh");
  assert.equal(assets, n + 1, "asked again");
  const legacy = new Response(JSON.stringify({ kind: "stations", items: [] }), { headers: { "content-type": "application/json" } });
  store.set(k, legacy);
  r = await call("/api/stations?mode=bus&refresh=1", "10.9.0.7");
  assert.equal(r.headers.get("x-edge-cache"), "miss", "a copy with no time is skipped by a refresh");
});

test("the departures copy inside the server is 5 s for a refresh, 12 s otherwise", () => {
  const w = fs.readFileSync(root + "src/worker.js", "utf8");
  assert.match(w, /const REFRESH_MAX_AGE_MS = 5000;/);
  assert.match(w, /depHit && Date\.now\(\) - depHit\.at < \(p\.get\("refresh"\) === "1" \? REFRESH_MAX_AGE_MS : 12000\)/);
});
