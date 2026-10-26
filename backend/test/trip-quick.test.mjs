// A slow Trip Planner and the phone's trip deadline (27 Oct, 8:35 AM incident): the app gives up on a trip at 10 s, the
// server waited up to 12 s (and a retry) for the planner, so a slow morning showed "No live times". Now a plain trip
// from now with no copy waits TRIP_QUICK_MS for the planner, then answers with labelled timetable trips; the planner's
// answer still finishes behind it and is stored, so the next poll is live.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { efaTrip } from "./helpers/efa.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/ttplan.js", "utf8") +
  "\nexport { __default, ttPlan, ttNearby, ttUpstreamDown, timetableTrip, engDayKey, boardKey, fromSaved, tripCopyOk };\n";
const tmp = `/tmp/trip-quick-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

let nswCalls = 0, plannerDelay = 0, plannerFail = false;
globalThis.fetch = async (u, init) => {
  nswCalls++;
  const url = new URL(typeof u === "string" ? u : u.url);
  if (!url.pathname.endsWith("/trip")) return new Response("{}", { status: 404 });
  if (plannerDelay) await new Promise((r, j) => { const t = setTimeout(r, plannerDelay); init && init.signal && init.signal.addEventListener("abort", () => { clearTimeout(t); j(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })); }); });
  if (plannerFail) return new Response("upstream down", { status: 503 });
  const now = Date.now();
  return new Response(JSON.stringify(efaTrip([3, 13, 23, 33, 43].map((m) => [{ from: "kingscross", to: "strathfield", dep: now + m * 60000, min: 20, delay: 1, trip: "live" + m }]))));
};
const edge = new Map();
globalThis.caches = { default: { match: async (req) => (edge.has(String(req.url || req)) ? new Response(edge.get(String(req.url || req))) : undefined), put: async (req, res) => { edge.set(String(req.url || req), await res.text()); }, delete: async () => true } };

// ---- a small network around now ----
const day = W.engDayKey(Date.now());
const base = Math.floor(new Date(new Date().toLocaleString("en-US", { timeZone: "Australia/Sydney" }).replace(/,.*/, "") + " 00:00").getTime() / 1000);
const nowS = Math.floor(Date.now() / 1000);
const sec = (m) => nowS + m * 60 - base;
const meta = {
  days: { [day]: base },
  routes: [["T4", 1, "#005AA3", "train", "", "Eastern Suburbs"], ["T1", 1, "#F99D1C", "train", "", "Western"], ["M1", 2, "#168388", "metro", "", "Metro"], ["333", 5, "#00B5EF", "bus", "", "Bondi"]],
  heads: ["Bondi Junction", "Penrith", "Bankstown", "Empty Train", "Bondi Beach"],
};
// [name, parent, platform code, lat, lon]
const stops = {
  "201110": ["Kings Cross Station", "", "", -33.87448, 151.22223], KX1: ["Kings Cross Station Platform 1", "201110", "1", -33.87448, 151.22223],
  "200060": ["Central Station", "", "", -33.88402, 151.2062], C1: ["Central Station Platform 24", "200060", "24", -33.88402, 151.2062],
  C2: ["Central Station Platform 16", "200060", "16", -33.88402, 151.2062], C3: ["Central Station Platform 26", "200060", "26", -33.88402, 151.2062],
  "213510": ["Strathfield Station", "", "", -33.87167, 151.09429], S1: ["Strathfield Station Platform 3", "213510", "3", -33.87167, 151.09429],
  M: ["Campsie Station", "", "", -33.9105, 151.1035], M1: ["Campsie Station Platform 1", "M", "1", -33.9105, 151.1035],
  B1: ["Oxford St at Taylor Sq", "", "", -33.8812, 151.2163], G9: ["Pitt St", "", "", -33.8841, 151.2061], "2009191": ["Pitt St Stand A", "G9", "", -33.8842, 151.2062], B2: ["Bondi Rd at Wellington St", "", "", -33.8915, 151.2620],
};
const rows = {
  // T4 Kings Cross to Central (and on), every 10 minutes; one empty train that must never be offered.
  KX1: [[sec(4), "t4a", 0, 0, 10], [sec(14), "t4b", 0, 0, 10], [sec(24), "t4c", 0, 0, 10], [sec(9), "t4x", 0, 3, 10]],
  C1: [[sec(9), "t4a", 0, 0, 12], [sec(19), "t4b", 0, 0, 12], [sec(29), "t4c", 0, 0, 12], [sec(14), "t4x", 0, 3, 12]],
  // T1 Central to Strathfield.
  C2: [[sec(11), "t1a", 1, 1, 5], [sec(15), "t1b", 1, 1, 5], [sec(30), "t1c", 1, 1, 5], [sec(36), "t1d", 1, 1, 5]],
  S1: [[sec(25), "t1a", 1, 1, 9], [sec(29), "t1b", 1, 1, 9], [sec(44), "t1c", 1, 1, 9], [sec(50), "t1d", 1, 1, 9]],
  // Metro Central to Campsie (the metro keeps no stop order: the Central hub finds it).
  C3: [[sec(16), "m1", 2, 2, 3], [sec(26), "m2", 2, 2, 3]],
  M1: [[sec(34), "m1", 2, 2, 9], [sec(44), "m2", 2, 2, 9]],
  // A direct bus.
  B1: [[sec(6), "b1", 3, 4, 2], [sec(21), "b2", 3, 4, 2]],
  B2: [[sec(18), "b1", 3, 4, 14], [sec(33), "b2", 3, 4, 14]],
};
const seq = (pairs) => new Map(pairs);
const tripSeq = {
  t4a: seq([["KX1", 10], ["C1", 12]]), t4b: seq([["KX1", 10], ["C1", 12]]), t4c: seq([["KX1", 10], ["C1", 12]]), t4x: seq([["KX1", 10], ["C1", 12]]),
  t1a: seq([["C2", 5], ["S1", 9]]), t1b: seq([["C2", 5], ["S1", 9]]), t1c: seq([["C2", 5], ["S1", 9]]), t1d: seq([["C2", 5], ["S1", 9]]),
};
const fakeSrc = {
  stop: (id) => stops[id] || null, children: (id) => Object.keys(stops).filter((k) => stops[k][1] === id),
  rows: (id, d) => (d === day ? rows[id] || [] : null), days: () => meta.days, route: (i) => meta.routes[i], head: (i) => meta.heads[i] || "",
  tripSeq: (f, t) => (f === "train" ? tripSeq[t] || null : null), plat: () => "",
};
// The engine object: /ttplan from the fake timetable, /nearby from a SQLite stop table.
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE stops (ver INTEGER, id TEXT, parent TEXT, name TEXT, plat TEXT, lat REAL, lon REAL)");
for (const [id, s] of Object.entries(stops)) db.prepare("INSERT INTO stops VALUES (1, ?, ?, ?, ?, ?, ?)").run(id, s[1], s[0], s[2], s[3], s[4]);
const sql = { exec: (q, ...a) => ({ toArray: () => db.prepare(q).all(...a) }) };
let engineUp = true;
const engine = {
  fetch: async (u) => {
    const url = new URL(u);
    if (!engineUp) return Response.json({ error: "no timetable" }, { status: 503 });
    if (url.pathname === "/ttplan") return Response.json(W.ttPlan(fakeSrc, { from: url.searchParams.get("from"), to: url.searchParams.get("to"), at: Number(url.searchParams.get("at")) || Date.now() - 60000, count: url.searchParams.get("count") }));
    if (url.pathname === "/nearby") return Response.json({ stops: W.ttNearby(sql, 1, Number(url.searchParams.get("lat")), Number(url.searchParams.get("lon"))) });
    return new Response("not found", { status: 404 });
  },
};
const env = { TFNSW_API_KEY: "t", ENGINE: { idFromName: () => "core", get: () => engine } };
const behind = [];
// Everything the runtime was asked to finish after the answer, including what that work itself queues.
async function settle() { for (let n = -1; n !== behind.length;) { n = behind.length; await Promise.all(behind); await new Promise((r) => setTimeout(r, 20)); } }
const exec = { waitUntil: (p) => { behind.push(Promise.resolve(p).catch(() => null)); } };
let ip = 1;
const call = async (path, envX = env) => { const res = await W.__default.fetch(new Request("https://api.transportsydney.app" + path, { headers: { "cf-connecting-ip": "10.8.0." + (ip++ % 250) } }), envX, exec); return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }; };


const PHONE = "/api/trip?from=201110&to=213510&fromName=Kings%20Cross&toName=Strathfield&count=5&fare=adult&device=d1&profile=p1";
// Each test its own count, so no test reads another one's copy (copies are also kept 15 s in memory).
const phone = (n) => PHONE.replace("count=5", "count=" + n);

test("a slow Trip Planner: the phone gets labelled timetable trips before its 10 s deadline, then the live answer on the next poll", { timeout: 30000 }, async () => {
  edge.clear(); behind.length = 0; plannerDelay = 8000; plannerFail = false;
  const t0 = Date.now();
  const r = await call(PHONE);
  const took = Date.now() - t0;
  assert.equal(r.status, 200);
  assert.ok(took < 9000, `answered in ${took} ms, inside the app's 10 s`);
  assert.ok(took >= 6000, "the planner had its chance first");
  assert.equal(r.body.source, "timetable");
  assert.equal(r.body.fallback, "planner-slow");
  assert.equal(r.headers.get("x-edge-cache"), "stand-in");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.ok(r.body.journeys.length >= 2);
  assert.ok(r.body.journeys.every((j) => j.live === false));
  // The planner's answer finishes behind the stand in and is stored as the copy for the next poll.
  await settle();
  assert.ok([...edge.keys()].some((k) => k.includes("/api/trip")), "the live answer is kept");
  plannerDelay = 0;
  const calls = nswCalls;
  const r2 = await call(PHONE);
  assert.equal(r2.status, 200);
  assert.notEqual(r2.body.source, "timetable");
  assert.equal(r2.body.journeys[0].live, true);
  assert.equal(nswCalls, calls, "served from the kept copy, no second planner call");
});

test("a timetable stand in is never stored: no edge copy and no saved copy of it", { timeout: 30000 }, async () => {
  edge.clear(); behind.length = 0; plannerDelay = 7000; plannerFail = true;
  const r = await call(phone(4));
  assert.equal(r.body.source, "timetable");
  await settle();
  assert.ok(![...edge.keys()].some((k) => k.includes("/api/trip")), "an error or stand in is never kept");
  plannerFail = false; plannerDelay = 0;
});

test("a fast Trip Planner is unchanged: the live answer, no stand in", async () => {
  edge.clear(); behind.length = 0; plannerDelay = 0; plannerFail = false;
  const r = await call(phone(3));
  assert.equal(r.status, 200);
  assert.notEqual(r.body.source, "timetable");
  assert.equal(r.headers.get("x-edge-cache"), "miss");
});

test("TRIP_QUICK=off keeps the old wait (the planner answer however long it takes up to its own limit)", { timeout: 30000 }, async () => {
  edge.clear(); behind.length = 0; plannerDelay = 7000; plannerFail = false;
  const t0 = Date.now();
  const r = await call(phone(6), { ...env, TRIP_QUICK: "off" });
  assert.ok(Date.now() - t0 >= 7000);
  assert.notEqual(r.body.source, "timetable");
  plannerDelay = 0;
});

test("only plain trips from now get the quick answer: a timed trip waits for the planner", { timeout: 30000 }, async () => {
  edge.clear(); behind.length = 0; plannerDelay = 7000; plannerFail = false;
  const t0 = Date.now();
  const r = await call(phone(2) + "&time=2359");
  assert.ok(Date.now() - t0 >= 7000);
  assert.notEqual(r.body.fallback, "planner-slow");
  plannerDelay = 0;
});
