// Speed (g10, 26 Oct 2026): stop search from our own index, search copies kept 6 hours under a normalised query,
// saved live boards for first opens (stale while revalidate) and the minute tick's warming inside the key's limit.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const src0 = fs.readFileSync(root + "src/worker.js", "utf8");
let src = src0.replace(/export default\s*\{/, "const __default = {") + "\nexport { __default, indexSearch, stopIndex, edgeKey, boardKey, fromSaved, gzipText, gunzipText, WARM_HUBS, WARM_PER_TICK, WARM_DAY_CAP, SAVED_MAX_MS };\n";
const tmp = `/tmp/speed-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
const ST = path.join(root, "src/public/stations");
const bus = new Map();
for (const f of fs.readdirSync(path.join(ST, "bus"))) {
  const d = JSON.parse(fs.readFileSync(path.join(ST, "bus", f), "utf8"));
  for (const dirs of Object.values(d)) for (const one of Array.isArray(dirs) ? dirs : [dirs]) for (const s of one.stops || []) if (!bus.has(s[0])) bus.set(s[0], [s[0], s[1]]);
}
const assetEnv = { ASSETS: { fetch: async (req) => {
  const p = new URL(req.url).pathname;
  if (p === "/stations/bus-stops.json") return new Response(JSON.stringify([...bus.values()]));
  return new Response(fs.readFileSync(path.join(root, "src/public", p)));
} } };

test("stop search answers from our own index without the Trip Planner when the answer is clear", async () => {
  let upstream = 0;
  globalThis.fetch = async () => { upstream++; return new Response("{}", { status: 503 }); };
  const idx = await W.stopIndex(assetEnv, "https://t.example");
  for (const [q, want] of [["wollongong stn", "Wollongong Station"], ["katoomba", "Katoomba Station"], ["kings x", "Kings Cross Station"], ["parra", "Parramatta Station"], ["manly wharf", "Manly Wharf"], ["213516", null]]) {
    const r = W.indexSearch(idx, q);
    assert.ok(r.clear, q);
    if (want) assert.equal(r.items[0].name, want, q);
    else assert.ok(r.items.some((x) => x.id === "213516"));
  }
  assert.equal(W.indexSearch(idx, "zzqx").clear, false);
  const env = { ...assetEnv, TFNSW_API_KEY: "t", DB: null };
  const res = await W.__default.fetch(new Request("https://t.example/api/search?q=albury%20stn", { headers: { "cf-connecting-ip": "10.7.0.1" } }), env, { waitUntil() {} });
  const body = await res.json();
  assert.equal(body.items[0].name, "Albury Station");
  assert.equal(upstream, 0, "no Trip Planner call");
});

test("search copies are one per normalised query and kept 6 hours", () => {
  const a = W.edgeKey(new URL("https://t.example/api/search?q=Kings%20%20Cross%20"));
  const b = W.edgeKey(new URL("https://t.example/api/search?q=kings%20cross"));
  assert.equal(a.url, b.url);
  const c = W.edgeKey(new URL("https://t.example/api/departures?stop=200060&q=Ab"));
  assert.match(c.url, /q=Ab/, "only search queries are folded");
  assert.match(src0, /const LONG_CACHE_S = 6 \* 3600;/);
  assert.match(src0, /const EDGE_CACHE_S = 15;/, "live boards stay at 15 s");
});

test("a live board for now is saved; boards at another time are not", () => {
  assert.deepEqual(W.boardKey(new URL("https://t.example/api/departures?stop=200060")), { k: "200060|", stop: "200060" });
  assert.deepEqual(W.boardKey(new URL("https://t.example/api/departures?stop=200060&mode=bus&refresh=1")), { k: "200060|bus", stop: "200060" });
  assert.equal(W.boardKey(new URL("https://t.example/api/departures?stop=200060&time=0800")), null);
  assert.equal(W.boardKey(new URL("https://t.example/api/trip?from=1&to=2")), null);
});

test("a first open with no edge copy gets the saved board at once, with its real age, gone services taken out", async () => {
  const now = Date.now();
  const board = { kind: "departures", now: now - 180000, items: [
    { line: "T1", planned: new Date(now - 5 * 60000).toISOString() }, { line: "T2", planned: new Date(now + 4 * 60000).toISOString() }] };
  const saved = await W.gzipText(JSON.stringify(board));
  assert.equal(await W.gunzipText(saved), JSON.stringify(board));
  const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), run: async () => ({}), all: async () => ({ results: [] }),
    first: async () => (/FROM board_copies/.test(q) ? { at: now - 180000, body: saved } : /ip_rate/.test(q) ? { n: 1 } : null) });
  const env = { ...assetEnv, TFNSW_API_KEY: "t", DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) } };
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  let release;
  globalThis.fetch = () => new Promise((r) => { release = () => r(new Response("{}", { status: 503 })); });
  const waits = [];
  const t0 = Date.now();
  const r = await W.__default.fetch(new Request("https://t.example/api/departures?stop=206710", { headers: { "cf-connecting-ip": "10.7.0.2" } }), env, { waitUntil(p) { waits.push(p); } });
  assert.ok(Date.now() - t0 < 1500, "answered without waiting for the Trip Planner");
  assert.equal(r.headers.get("x-edge-cache"), "saved");
  const d = await r.json();
  assert.equal(d.dataAt, now - 180000, "honest age");
  assert.deepEqual(d.items.map((x) => x.line), ["T2"]);
  assert.ok(waits.length >= 1, "the fresh board keeps going in the background");
  if (release) release();
  delete globalThis.caches;
});

test("warming stays inside the key's limit", () => {
  assert.equal(W.WARM_HUBS.length, 50);
  assert.ok(W.WARM_PER_TICK <= 8, "at most 8 Trip Planner calls a minute");
  assert.ok(W.WARM_DAY_CAP <= 45000, "stops well before the day's 60,000");
  assert.equal(W.SAVED_MAX_MS, 15 * 60000);
  assert.match(src0, /if \(sn\.tod >= 60 && sn\.tod < 270\) return \{ skipped: "night" \}/);
  assert.match(src0, /if \(upstreamBusy\(\)\) return \{ skipped: "busy" \}/);
  const st = JSON.parse(fs.readFileSync(path.join(ST, "train.json"), "utf8")).concat(...["metro", "lightrail", "ferry"].map((m) => JSON.parse(fs.readFileSync(path.join(ST, m + ".json"), "utf8"))));
  const names = new Set(st.map((r) => r[1]));
  for (const n of W.WARM_HUBS) assert.ok(names.has(n), n);
});

test("Smart Placement is on in the Cloudflare config", () => {
  assert.match(fs.readFileSync(root + "wrangler.toml.template", "utf8"), /\[placement\]\nmode = "smart"/);
});
