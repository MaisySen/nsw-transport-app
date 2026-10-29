// New trip first look (30 Oct 2026, x-serves word trip-tt): a brand new A to B search used to show nothing until the
// Trip Planner answered. The newer app now sends a second request with tt=1 beside its normal one; the server answers
// it from our timetable only (never a Trip Planner call, never stored, never live), and the normal request's live
// answer replaces it on the phone. Older apps (builds 201 to 208) never send tt=1 and keep server B's answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { efaTrip } from "./helpers/efa.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/ttplan.js", "utf8") +
  "\nexport { __default, ttPlan, engDayKey, serverCfg, BUDGET_HOLD_FLAGS, TRIP_TT_FIRST_MS };\n";
const tmp = `/tmp/trip-tt-first-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

// The Trip Planner (fake): counts every call, answers after plannerDelay ms.
let nswCalls = 0, otherCalls = 0, plannerDelay = 0;
globalThis.fetch = async (u, init) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (!url.pathname.endsWith("/trip")) { otherCalls++; return new Response("{}", { status: 404 }); }
  nswCalls++;
  if (plannerDelay) await new Promise((r, j) => { const t = setTimeout(r, plannerDelay); init && init.signal && init.signal.addEventListener("abort", () => { clearTimeout(t); j(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })); }); });
  const now = Date.now();
  return new Response(JSON.stringify(efaTrip([4, 14, 24, 34].map((m) => [{ from: "central", to: "townhall", dep: now + m * 60000, min: 3, delay: 1, trip: "tt" + m }]))));
};
const edge = new Map();
globalThis.caches = { default: { match: async (req) => (edge.has(String(req.url || req)) ? new Response(edge.get(String(req.url || req))) : undefined), put: async (req, res) => { edge.set(String(req.url || req), await res.text()); }, delete: async () => true } };

// ---- a small timetable around now: one train line A to B, every 10 minutes ----
const day = W.engDayKey(Date.now());
const base = Math.floor(new Date(new Date().toLocaleString("en-US", { timeZone: "Australia/Sydney" }).replace(/,.*/, "") + " 00:00").getTime() / 1000);
const nowS = Math.floor(Date.now() / 1000);
const sec = (m) => nowS + m * 60 - base;
const meta = { days: { [day]: base }, routes: [["T9", 1, "#005AA3", "train", "", "Test Line"]], heads: ["Line End"] };
const stops = {
  "200060": ["Central Station", "", "", -33.88402, 151.2062], A1: ["Central Station Platform 18", "200060", "18", -33.88402, 151.2062],
  "200070": ["Town Hall Station", "", "", -33.8731, 151.2066], B1: ["Town Hall Station Platform 4", "200070", "4", -33.8731, 151.2066],
};
const rows = {
  A1: [[sec(4), "tt4", 0, 0, 3], [sec(14), "tt14", 0, 0, 3], [sec(24), "tt24", 0, 0, 3], [sec(34), "tt34", 0, 0, 3]],
  B1: [[sec(7), "tt4", 0, 0, 5], [sec(17), "tt14", 0, 0, 5], [sec(27), "tt24", 0, 0, 5], [sec(37), "tt34", 0, 0, 5]],
};
const seqs = Object.fromEntries(["tt4", "tt14", "tt24", "tt34"].map((t) => [t, new Map([["A1", 3], ["B1", 5]])]));
const fakeSrc = {
  stop: (id) => stops[id] || null, children: (id) => Object.keys(stops).filter((k) => stops[k][1] === id),
  rows: (id, d) => (d === day ? rows[id] || [] : null), days: () => meta.days, route: (i) => meta.routes[i], head: (i) => meta.heads[i] || "",
  tripSeq: (f, t) => (f === "train" ? seqs[t] || null : null), plat: () => "",
};
let engineUp = true, engineCalls = 0;
const engine = {
  fetch: async (u) => {
    engineCalls++;
    const url = new URL(u);
    if (!engineUp) return Response.json({ error: "no timetable" }, { status: 503 });
    if (url.pathname === "/ttplan") return Response.json(W.ttPlan(fakeSrc, { from: url.searchParams.get("from"), to: url.searchParams.get("to"), at: Number(url.searchParams.get("at")) || Date.now() - 60000, count: url.searchParams.get("count") }));
    return new Response("not found", { status: 404 });
  },
};
const env = { TFNSW_API_KEY: "t", ENGINE: { idFromName: () => "core", get: () => engine } };
const behind = [];
async function settle() { for (let n = -1; n !== behind.length;) { n = behind.length; await Promise.all(behind); await new Promise((r) => setTimeout(r, 20)); } }
const exec = { waitUntil: (p) => { behind.push(Promise.resolve(p).catch(() => null)); } };
let ip = 1;
const NEW_APP = { "x-device": "d1", "x-profile": "p1" };
const OLD_APP = {};
const call = async (path, envX = env, extra = NEW_APP) => {
  const res = await W.__default.fetch(new Request("https://api.transportsydney.app" + path, { headers: { "cf-connecting-ip": "10.9.0." + (ip++ % 250), ...extra } }), envX, exec);
  const text = await res.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
  return { status: res.status, body, headers: res.headers };
};
// Each test its own count, so no test reads another one's copy.
const q = (n, more = "") => `/api/trip?from=200060&to=200070&fromName=Central&toName=Town%20Hall&count=${n}&fare=adult${more}`;
const reset = () => { edge.clear(); behind.length = 0; plannerDelay = 0; engineUp = true; W.serverCfg.budget = null; };

test("tt=1, newer app: timetable trips at once, no Trip Planner call, nothing live, never stored", { timeout: 20000 }, async () => {
  reset(); plannerDelay = 8000;
  const calls = nswCalls, others = otherCalls;
  const t0 = Date.now();
  const r = await call(q(5, "&tt=1"));
  const took = Date.now() - t0;
  assert.equal(r.status, 200);
  assert.ok(took < 800, `answered in ${took} ms, not after the planner`);
  assert.equal(nswCalls, calls, "no Trip Planner call");
  assert.equal(r.body.source, "timetable");
  assert.equal(r.headers.get("x-edge-cache"), "tt-first");
  assert.equal(r.headers.get("x-stand-in"), "timetable");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.ok(Number(r.headers.get("x-quick-ms")) >= 0);
  assert.ok(r.body.journeys.length >= 2);
  // R1 on the server side: nothing in a first look reads as live.
  for (const j of r.body.journeys) {
    assert.equal(j.live, false);
    assert.equal(j.source, "timetable");
    for (const l of j.legs.filter((x) => x.kind === "transit")) {
      assert.equal(l.status.key, "scheduled");
      assert.ok(!l.realtime, "no live flag on a timetable leg");
      assert.ok(!l.estimated && !l.arrEstimated, "no live times on a timetable leg");
    }
  }
  await settle();
  assert.ok(![...edge.keys()].some((k) => k.includes("/api/trip")), "a first look is never kept as a copy");
  assert.equal(nswCalls, calls, "still no Trip Planner call after the answer");
  assert.equal(otherCalls, others, "no live feed read either: a first look carries no live times");
});

test("tt=1 beside the normal request: one Trip Planner call, and the normal answer is live", { timeout: 20000 }, async () => {
  reset(); plannerDelay = 300;
  const calls = nswCalls;
  const [tt, live] = await Promise.all([call(q(6, "&tt=1")), call(q(6))]);
  assert.equal(tt.status, 200);
  assert.equal(tt.body.source, "timetable");
  assert.equal(live.status, 200);
  assert.notEqual(live.body.source, "timetable");
  assert.equal(live.body.journeys[0].live, true);
  await settle();
  assert.equal(nswCalls - calls, 1, "the first look adds no Trip Planner call");
});

test("tt=1 strips paging and day lists and answers the plain first page", { timeout: 20000 }, async () => {
  reset(); plannerDelay = 8000;
  const calls = nswCalls;
  const r = await call(q(4, "&tt=1&page=1&days=1&refresh=1"));
  assert.equal(r.status, 200);
  assert.equal(r.body.source, "timetable");
  assert.equal(nswCalls, calls);
});

test("older apps: tt=1 is 204 and the normal trip answer has no new fields", { timeout: 20000 }, async () => {
  reset();
  const calls = nswCalls;
  const r = await call(q(3, "&tt=1&device=d1&profile=p1"), env, OLD_APP);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("x-tt-first"), "app");
  assert.equal(nswCalls, calls, "no Trip Planner call");
  const n = await call(q(3, "&device=d1&profile=p1"), env, OLD_APP);
  assert.equal(n.status, 200);
  assert.notEqual(n.body.source, "timetable");
  assert.equal(n.headers.get("x-edge-cache") === "tt-first", false);
  assert.ok(!("ttFirst" in n.body), "no new field in server B's answer");
});

test("x-serves names trip-tt; TRIP_TT=off and kill tripTt take it away and tt=1 answers 204 off", { timeout: 20000 }, async () => {
  reset();
  const on = await call(q(2, "&tt=1"));
  assert.match(on.headers.get("x-serves") || "", /(^|,)trip-tt(,|$)/);
  const calls = nswCalls;
  const off = await call(q(2, "&tt=1"), { ...env, TRIP_TT: "off" });
  assert.equal(off.status, 204);
  assert.equal(off.headers.get("x-tt-first"), "off");
  assert.doesNotMatch(off.headers.get("x-serves") || "", /trip-tt/);
  assert.equal(nswCalls, calls);
});

test("the budget guard holds trip-tt like its other switches", { timeout: 20000 }, async () => {
  reset();
  assert.ok(W.BUDGET_HOLD_FLAGS.includes("TRIP_TT"));
  W.serverCfg.budget = { hold: true };
  try {
    const r = await call(q(7, "&tt=1"));
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("x-tt-first"), "off");
    assert.doesNotMatch(r.headers.get("x-serves") || "", /trip-tt/);
  } finally { W.serverCfg.budget = null; }
});

test("kinds it does not do (step free, long, via) and a timetable with nothing: 204, never a planner call", { timeout: 20000 }, async () => {
  reset(); plannerDelay = 8000;
  const calls = nswCalls;
  for (const more of ["&acc=1", "&long=1", "&via=200080"]) {
    const r = await call(q(8, "&tt=1" + more));
    assert.equal(r.status, 204, more);
    assert.equal(r.headers.get("x-tt-first"), "kind");
    // A 2xx with no x-serves would turn the phone's newer paths off (servesCore.ts): a 204 carries the words too.
    assert.match(r.headers.get("x-serves") || "", /id-headers/);
  }
  engineUp = false;
  const none = await call(q(8, "&tt=1"));
  assert.equal(none.status, 204);
  assert.equal(none.headers.get("x-tt-first"), "none");
  assert.equal(nswCalls, calls, "no Trip Planner call for any of them");
});

test("a slow timetable gives up at TRIP_TT_FIRST_MS with 204 (the normal request still answers)", { timeout: 20000 }, async () => {
  reset();
  const slow = { fetch: async (u) => { await new Promise((r) => setTimeout(r, W.TRIP_TT_FIRST_MS + 800)); return engine.fetch(u); } };
  const envSlow = { ...env, ENGINE: { idFromName: () => "core", get: () => slow } };
  const t0 = Date.now();
  const r = await call(q(1, "&tt=1"), envSlow);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("x-tt-first"), "none");
  assert.ok(Date.now() - t0 < W.TRIP_TT_FIRST_MS + 600);
  await settle();
});
