// GET /api/home (27 Oct, home-bundle in x-serves): Home's reads in one request. Each part is the same answer its own
// request gets, run through the same path (so no extra Trip Planner call), side by side; only Home's reads are taken;
// a slow part is answered late and carries on; the HOME_BUNDLE flag and the homeBundle kill switch turn it off.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default };\n";
const tmp = `/tmp/home-bundle-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const MIN = 60000;
const now = Date.now();
const ev = (line, cls, mins, stop) => ({
  location: { id: stop + "1", name: "Stand A", properties: { platformName: "Platform 1" }, parent: { id: stop, name: "Station " + stop } },
  departureTimePlanned: new Date(now + mins * MIN).toISOString(),
  transportation: { disassembledName: line, number: line, product: { class: cls }, destination: { name: "Somewhere", id: "1" }, properties: {} },
  properties: { RealtimeTripId: line + stop + mins },
});
const upstream = [];
let hang = false;
globalThis.fetch = async (u) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  upstream.push(url.pathname);
  if (url.pathname.endsWith("/departure_mon")) {
    const stop = url.searchParams.get("name_dm");
    return new Response(JSON.stringify({ locations: [{ id: stop, name: "Station " + stop }], stopEvents: [ev("T1", 1, 3, stop), ev("415", 5, 7, stop)] }));
  }
  if (url.pathname.endsWith("/trip") && hang) return new Promise(() => {});
  return new Response("{}", { status: 503 });
};
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), run: async () => ({ meta: { changes: 1, last_row_id: 1 } }), all: async () => ({ results: [] }), first: async () => null });
const baseEnv = { TFNSW_API_KEY: "t", DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) }, ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
let ip = 1;
const waits = [];
const get = async (path, env = baseEnv, headers = {}) => {
  const r = await W.__default.fetch(new Request("https://t.example" + path, { headers: { "cf-connecting-ip": "10.9.0." + (ip++ % 250), ...headers } }), env, { waitUntil(p) { waits.push(p); } });
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, headers: r.headers };
};
const bundle = (paths, env, headers) => get("/api/home?" + paths.map((p) => "p=" + encodeURIComponent(p)).join("&"), env, headers);
const strip = (b) => JSON.parse(JSON.stringify(b, (k, v) => (k === "dataAt" || k === "at" || k === "now" || k === "seenAt" ? undefined : v)));

test("x-serves lists home-bundle on every /api answer", async () => {
  const r = await get("/api/app/config?platform=android");
  assert.match(r.headers.get("x-serves") || "", /(^|,)home-bundle(,|$)/);
});

test("parts come back in order, each the same answer as its own request", async () => {
  const paths = ["/api/departures?stop=200060", "/api/app/config?platform=android", "/api/departures?stop=213510&mode=bus"];
  upstream.length = 0;
  const b = await bundle(paths, baseEnv, { "x-device": "dev-home-1", "x-profile": "prof-home-1" });
  assert.equal(b.status, 200);
  assert.equal(b.body.v, 1);
  assert.deepEqual(b.body.parts.map((x) => x.p), paths);
  assert.ok(b.body.parts.every((x) => x.status === 200 && x.body), JSON.stringify(b.body.parts.map((x) => x.status)));
  assert.equal(upstream.filter((p) => p.endsWith("/departure_mon")).length, 2, "one Trip Planner call per board, as separate requests make");
  assert.equal(b.headers.get("cache-control"), "no-store");
  for (const [i, p] of paths.entries()) {
    const own = await get(p, baseEnv, { "x-device": "dev-home-1", "x-profile": "prof-home-1" });
    assert.equal(own.status, 200);
    assert.deepEqual(strip(b.body.parts[i].body), strip(own.body), p);
  }
});

test("the same read twice is run once", async () => {
  upstream.length = 0;
  const b = await bundle(["/api/departures?stop=201110", "/api/departures?stop=201110"]);
  assert.equal(b.body.parts.length, 2);
  assert.equal(upstream.filter((p) => p.endsWith("/departure_mon")).length, 1);
});

test("only Home's reads: anything else is refused per part with no upstream call", async () => {
  upstream.length = 0;
  const b = await bundle(["/api/ask?q=central", "/api/budget", "https://evil.example/api/trip?from=1&to=2", "//evil.example/api/saved", "/api/departures?stop=200060&format=text", "/api/trip/live?legs=x", "api/saved"]);
  assert.equal(b.status, 200);
  assert.ok(b.body.parts.every((x) => x.status === 400), JSON.stringify(b.body.parts));
  assert.equal(upstream.length, 0);
});

test("no reads or more than ten: 400", async () => {
  assert.equal((await get("/api/home")).status, 400);
  const many = Array.from({ length: 11 }, (_, i) => "/api/departures?stop=2000" + (10 + i));
  assert.equal((await bundle(many)).status, 400);
});

test("a part still waiting after 2.5 s is answered late and carries on behind the answer", async () => {
  hang = true;
  waits.length = 0;
  const t0 = Date.now();
  const b = await bundle(["/api/trip?from=213410&to=213510&count=6&time=0930", "/api/app/config?platform=android"]);
  hang = false;
  const ms = Date.now() - t0;
  assert.ok(ms < 4000, "answered in " + ms + " ms");
  assert.equal(b.body.parts[0].status, 0);
  assert.equal(b.body.parts[0].late, true);
  assert.equal(b.body.parts[1].status, 200);
  assert.ok(waits.length >= 1, "the slow part was handed to waitUntil");
});

test("HOME_BUNDLE=off: 404 and the word is gone from x-serves", async () => {
  const env = { ...baseEnv, HOME_BUNDLE: "off" };
  const b = await bundle(["/api/app/config?platform=android"], env);
  assert.equal(b.status, 404);
  const r = await get("/api/app/config?platform=android", env);
  assert.doesNotMatch(r.headers.get("x-serves") || "", /home-bundle/);
});
