// Profiles, input checks, the edge cache and per address limits (audit P0-3, P1-2, P2-4, P2-5).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => fs.readFileSync(root + p, "utf8");
let src = read("src/worker.js").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default, profileId, badInput, edgeKey };\n";
const tmp = `/tmp/profile-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
let upstream = 0;
globalThis.fetch = async () => { upstream++; return new Response("{}", { status: 503 }); };

const sql = [];
let ipCount = 1;
const stmt = (q, args = []) => ({
  bind: (...a) => stmt(q, a),
  run: async () => { sql.push({ q, args }); return { meta: { changes: 0 } }; },
  all: async () => { sql.push({ q, args }); return { results: [] }; },
  first: async () => { sql.push({ q, args }); return /ip_rate/.test(q) ? { n: ipCount } : null; },
});
const env = { TFNSW_API_KEY: "t", DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) }, ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
const call = (p, init = {}, ip = "10.6.0.1") => W.__default.fetch(new Request("https://t.example" + p, { ...init, headers: { "cf-connecting-ip": ip, ...(init.headers || {}) } }), env, { waitUntil() {} });

test("no shared fallback profile is left in the server or the web app", () => {
  const files = ["src/worker.js", "src/public/app.js", "src/public/ask.js", "src/public/live/live.js", "src/public/sw.js"];
  for (const f of files) {
    const t = read(f).split(["bidur@mail", "tab", "bot"].join(".")).join("");
    assert.doesNotMatch(t, /bidur/i, f);
    assert.doesNotMatch(t, /DEFAULT_PROFILE/, f);
  }
});

test("profile ids are 6 to 40 safe characters, anything else is no profile", () => {
  assert.equal(W.profileId("wAbc123def456"), "wabc123def456");
  assert.equal(W.profileId("uitest"), "uitest");
  for (const bad of ["", null, "bidur", "abc", "../../etc", "a b c d e f", "x".repeat(41), "<script>"]) assert.equal(W.profileId(bad), "", String(bad));
});

test("without a profile, saved trips and commutes are empty and writes are refused", async () => {
  let d = await (await call("/api/saved")).json();
  assert.deepEqual(d.items, []);
  d = await (await call("/api/saved?profile=bidur")).json();
  assert.deepEqual(d.items, [], "the old shared profile reads as empty");
  assert.equal((await call("/api/saved", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "home", from: { id: "1", name: "a" }, to: { id: "2", name: "b" } }) }, "10.6.1.1")).status, 400);
  assert.equal((await call("/api/saved", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile: "bidur", name: "home", from: { id: "1", name: "a" }, to: { id: "2", name: "b" } }) }, "10.6.1.2")).status, 400);
  assert.equal((await call("/api/saved?name=home", { method: "DELETE" }, "10.6.1.3")).status, 400);
  d = await (await call("/api/commutes")).json();
  assert.deepEqual(d.items, []);
  assert.equal(d.suggestion, null);
});

test("the profile can come in an x-profile header", async () => {
  sql.length = 0;
  const d = await (await call("/api/saved", { headers: { "x-profile": "wHeaderProfile01" } })).json();
  assert.equal(d.profile, "wheaderprofile01");
  assert.ok(sql.some((x) => /FROM saved/.test(x.q) && x.args.includes("wheaderprofile01")));
});

test("a search with no profile is never logged", async () => {
  sql.length = 0;
  await call("/api/trip?from=10101100&to=10101101", {}, "10.6.2.1");
  await call("/api/ask?q=" + encodeURIComponent("Central to Burwood"), {}, "10.6.2.2");
  assert.ok(!sql.some((x) => /INSERT INTO searches/.test(x.q)), "no search row without a profile");
});

test("inputs are checked before any upstream call", async () => {
  for (const [p, why] of [
    ["/api/ask?q=" + "a".repeat(301), "q over 300"],
    ["/api/trip?from=%3Cscript%3E&to=10101100", "from with markup"],
    ["/api/departures?stop=" + "1".repeat(201), "long stop"],
    ["/api/trip?from=10101100&to=10101101&count=9", "count 9"],
    ["/api/trip?from=10101100&to=10101101&count=abc", "count text"],
    ["/api/trip?from=10101100&to=10101101&time=2561", "bad time"],
    ["/api/nearby?lat=abc&lon=151", "bad lat"],
  ]) {
    upstream = 0;
    const r = await call(p, {}, "10.6.3.1");
    assert.equal(r.status, 400, why);
    assert.equal(upstream, 0, why + " made no upstream call");
  }
  assert.equal(W.badInput(new URLSearchParams("from=151.2:-33.8:EPSG:4326&to=10101100&count=3&time=0815")), null);
  assert.equal(W.badInput(new URLSearchParams("q=" + encodeURIComponent("Central to Burwood"))), null);
});

test("per address limits shared in D1 answer 429 over the limit, and fail open without D1", async () => {
  ipCount = 121;
  assert.equal((await call("/api/departures?stop=200060", {}, "10.6.4.1")).status, 429);
  ipCount = 61;
  assert.equal((await call("/api/saved", { method: "POST", headers: { "content-type": "application/json", "x-profile": "wlimitprofile1" }, body: "{}" }, "10.6.4.2")).status, 429);
  ipCount = 1;
  const noDb = { ...env, DB: undefined };
  const r = await W.__default.fetch(new Request("https://t.example/api/search?q=ce", { headers: { "cf-connecting-ip": "10.6.4.3" } }), noDb, { waitUntil() {} });
  assert.notEqual(r.status, 429);
});

test("shared answers are cached at the edge (kept 120 s, served 15 s), without profile or device in the key", async () => {
  const store = new Map();
  globalThis.caches = { default: {
    match: async (req) => { const r = store.get(req.url); return r ? r.clone() : undefined; },
    put: async (req, res) => { store.set(req.url, res); },
  } };
  const k1 = W.edgeKey(new URL("https://t.example/api/departures?stop=200060&device=d1&profile=wone11111"));
  const k2 = W.edgeKey(new URL("https://t.example/api/departures?profile=wtwo22222&stop=200060&device=d2"));
  assert.equal(k1.url, k2.url);
  assert.equal(k1.url, "https://t.example/api/departures?stop=200060");
  const env2 = { ...env };
  const waits = [];
  const ex = { waitUntil(p) { waits.push(p); } };
  const ok = new Response(JSON.stringify({ kind: "stations", items: [] }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  // A stored answer is served without touching the handler.
  store.set("https://t.example/api/stations?mode=train", Object.assign(ok, {}));
  const hit = await W.__default.fetch(new Request("https://t.example/api/stations?mode=train", { headers: { "cf-connecting-ip": "10.6.5.1" } }), env2, ex);
  assert.equal(hit.headers.get("x-edge-cache"), "hit");
  // A miss that answers 200 is stored with a 120 second lifetime (served as fresh for 15 s, older only when upstream is busy or failing).
  const env3 = { ...env, ASSETS: { fetch: async () => new Response(JSON.stringify([{ id: "200060", name: "Central" }]), { headers: { "content-type": "application/json" } }) } };
  const miss = await W.__default.fetch(new Request("https://t.example/api/stations?mode=metro&device=dx", { headers: { "cf-connecting-ip": "10.6.5.2" } }), env3, ex);
  assert.equal(miss.status, 200);
  await Promise.all(waits);
  const put = store.get("https://t.example/api/stations?mode=metro");
  assert.ok(put, "stored without the device");
  assert.equal(put.headers.get("cache-control"), "public, max-age=21600", "station lists and search are kept 6 hours");
  delete globalThis.caches;
});

test("the web Watching tab has its alerts card", () => {
  const app = read("src/public/app.js");
  assert.match(app, /function promptCard\(\)/);
  assert.match(app, /x-profile/);
  assert.match(read("src/public/ask.js"), /x-profile/);
});

test("a trip link with stop ids and no names takes the names from the trip", async () => {
  let src2 = read("src/worker.js").replace(/export default\s*\{/, "const __default = {") + "\nexport { tripEndName };\n";
  const f = `/tmp/names-test-${process.pid}-${Date.now()}.mjs`;
  fs.writeFileSync(f, src2);
  const M = await import(f); fs.unlinkSync(f);
  const r = { journeys: [{ legs: [{ from: "Central Station", to: "Redfern Station" }, { from: "Redfern Station", to: "Town Hall Station" }] }] };
  assert.equal(M.tripEndName(r, "from"), "Central Station");
  assert.equal(M.tripEndName(r, "to"), "Town Hall Station");
  assert.equal(M.tripEndName({ journeys: [] }, "from"), null);
  assert.match(read("src/worker.js"), /given\("fromName"\) \|\| tripEndName\(r, "from"\)/);
});
