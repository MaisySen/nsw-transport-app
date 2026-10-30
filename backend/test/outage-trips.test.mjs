// Outage trips and nearby (src/ttplan.js, 26 Oct 2026): when the Trip Planner refuses, /api/trip answers with trips
// from our own timetable (direct and one change), labelled, and /api/nearby answers from our own stop list with no
// Trip Planner call. Every Transport for NSW call here is refused (429), as on 26 Oct from 1:25 PM.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/ttplan.js", "utf8") +
  "\nexport { __default, ttPlan, ttNearby, ttUpstreamDown, timetableTrip, engDayKey, boardKey, fromSaved, tripCopyOk };\n";
const tmp = `/tmp/outage-trips-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

let nswCalls = 0;
globalThis.fetch = async () => { nswCalls++; return new Response('{"ErrorDetails":{"Message":"Your API quota or rate limit has been exceeded"}}', { status: 429 }); };
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
  KX: ["Martin Place Station", "", "", -33.87448, 151.22223], KX1: ["Martin Place Station Platform 1", "KX", "1", -33.87448, 151.22223],
  "200060": ["Central Station", "", "", -33.88402, 151.2062], C1: ["Central Station Platform 24", "200060", "24", -33.88402, 151.2062],
  C2: ["Central Station Platform 16", "200060", "16", -33.88402, 151.2062], C3: ["Central Station Platform 26", "200060", "26", -33.88402, 151.2062],
  S: ["Chatswood Station", "", "", -33.87167, 151.09429], S1: ["Chatswood Station Platform 3", "S", "3", -33.87167, 151.09429],
  M: ["Lakemba Station", "", "", -33.9105, 151.1035], M1: ["Lakemba Station Platform 1", "M", "1", -33.9105, 151.1035],
  B1: ["Oxford St at Taylor Sq", "", "", -33.8812, 151.2163], G9: ["Pitt St", "", "", -33.8841, 151.2061], "2009191": ["Pitt St Stand A", "G9", "", -33.8842, 151.2062], B2: ["Bondi Rd at Wellington St", "", "", -33.8915, 151.2620],
};
const rows = {
  // T4 Martin Place to Central (and on), every 10 minutes; one empty train that must never be offered.
  KX1: [[sec(4), "t4a", 0, 0, 10], [sec(14), "t4b", 0, 0, 10], [sec(24), "t4c", 0, 0, 10], [sec(9), "t4x", 0, 3, 10]],
  C1: [[sec(9), "t4a", 0, 0, 12], [sec(19), "t4b", 0, 0, 12], [sec(29), "t4c", 0, 0, 12], [sec(14), "t4x", 0, 3, 12]],
  // T1 Central to Chatswood.
  C2: [[sec(11), "t1a", 1, 1, 5], [sec(15), "t1b", 1, 1, 5], [sec(30), "t1c", 1, 1, 5], [sec(36), "t1d", 1, 1, 5]],
  S1: [[sec(25), "t1a", 1, 1, 9], [sec(29), "t1b", 1, 1, 9], [sec(44), "t1c", 1, 1, 9], [sec(50), "t1d", 1, 1, 9]],
  // Metro Central to Lakemba (the metro keeps no stop order: the Central hub finds it).
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
const env = { ENGINE: { idFromName: () => "core", get: () => engine } };
const exec = { waitUntil: () => {} };
const call = async (path) => { const res = await W.__default.fetch(new Request("https://api.transportsydney.app" + path), env, exec); return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }; };

test("a direct trip on one service: departure, arrival, line and platform from the timetable", () => {
  const r = W.ttPlan(fakeSrc, { from: "B1", to: "B2", at: Date.now() - 60000 });
  assert.equal(r.journeys.length, 2);
  const l = r.journeys[0][0];
  assert.equal(l.line, "333"); assert.equal(l.mode, "bus"); assert.equal(l.towards, "Bondi Beach");
  assert.equal(l.realtime, false); assert.equal(l.estimated, null); assert.equal(l.source, "timetable");
  assert.equal(new Date(l.arrPlanned) - new Date(l.planned), 12 * 60000);
});

test("Martin Place to Chatswood: one change at Central, enough time to change, never an Empty Train", () => {
  const r = W.ttPlan(fakeSrc, { from: "KX", to: "S", at: Date.now() - 60000 });
  assert.ok(r.journeys.length >= 2);
  for (const j of r.journeys) {
    assert.equal(j.length, 2);
    assert.equal(j[0].line, "T4"); assert.equal(j[1].line, "T1");
    assert.equal(j[0].to, "Central Station"); assert.equal(j[1].from, "Central Station");
    assert.ok(new Date(j[1].planned) - new Date(j[0].arrPlanned) >= 4 * 60000, "at least 4 minutes to change");
    assert.notEqual(j[0].tripId, "t4x");
  }
  // 4 min T4 (Central 9) -> 15 min T1 (Chatswood 29); 14 -> 30 (44); 24 -> 36 (50).
  assert.deepEqual(r.journeys.map((j) => j[1].tripId), ["t1b", "t1c", "t1d"]);
  assert.equal(r.journeys[0][1].fromPlatform, "Platform 16");
});

test("a change from train to metro is found through the Central hub (the metro keeps no stop order)", () => {
  const r = W.ttPlan(fakeSrc, { from: "KX", to: "M", at: Date.now() - 60000 });
  assert.ok(r.journeys.length >= 1);
  assert.deepEqual(r.journeys[0].map((l) => l.line), ["T4", "M1"]);
});

test("no service between two stops gives no trips, not a made up one", () => {
  const r = W.ttPlan(fakeSrc, { from: "B1", to: "M", at: Date.now() - 60000 });
  assert.equal(r.journeys.length, 0);
});

test("/api/trip with the Trip Planner refused answers 200 with labelled timetable trips", async () => {
  edge.clear();
  const r = await call("/api/trip?from=KX&to=S");
  assert.equal(r.status, 200);
  assert.equal(r.body.source, "timetable");
  assert.equal(r.body.fallback, "planner-unavailable");
  assert.equal(r.body.alerts[0].title, "Live trips unavailable, showing timetable times");
  assert.ok(r.body.journeys.length >= 2);
  const j = r.body.journeys[0];
  assert.equal(j.live, false); assert.equal(j.changes, 1);
  assert.equal(j.legs[0].alerts[0].title, "Live trips unavailable, showing timetable times");
  assert.ok(j.legs.every((l) => l.realtime === false && l.status.key === "scheduled"));
  assert.equal(r.body.from.name, "Martin Place Station");
});

test("/api/trip with no timetable answer is an honest error, never an empty list", async () => {
  edge.clear();
  const r = await call("/api/trip?from=B1&to=M");
  assert.ok(r.status >= 500);
  assert.equal(r.body.unavailable, true);
  assert.equal(r.body.upstream, true);
  assert.match(r.body.error, /Live trips are unavailable right now/);
  assert.ok(!("journeys" in r.body));
  assert.doesNotMatch(r.body.error, /signal|connection/i);
});

test("/api/nearby answers from our own stop list, stations grouped, nearest first, with no Trip Planner call", async () => {
  edge.clear();
  const before = nswCalls;
  const r = await call("/api/nearby?lat=-33.8840&lon=151.2060");
  assert.equal(r.status, 200);
  assert.equal(r.body.stops[0].id, "200060");
  assert.equal(r.body.stops[0].name, "Central Station");
  assert.ok(r.body.stops[0].distance < 50);
  assert.equal(r.body.stops.filter((s) => s.id === "200060").length, 1, "platforms grouped as their station");
  assert.equal(nswCalls, before, "no Transport for NSW call");
  assert.ok(r.body.stops.some((s) => s.id === "2009191") && !r.body.stops.some((s) => s.id === "G9"), "a stop pair lists its stop, not its G centre");
});

test("errors never carry a bare status, and an upstream failure does not blame the phone", async () => {
  edge.clear();
  engineUp = false;
  const r = await call("/api/nearby?lat=-33.70&lon=151.10");
  engineUp = true;
  assert.ok(r.status >= 500);
  assert.match(r.body.error, /Transport for NSW/);
  assert.doesNotMatch(r.body.error, /\(\d{3}\)|signal/);
});

test("which failures a timetable answer stands in for", () => {
  assert.ok(W.ttUpstreamDown(new Error("Transport data answered 429: quota")));
  assert.ok(W.ttUpstreamDown(new Error("Transport data answered 503: down")));
  assert.ok(W.ttUpstreamDown(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })));
  assert.ok(!W.ttUpstreamDown(new Error("Transport data answered 400: bad stop")));
});

test("a timetable stand in is never kept as a copy", async () => {
  edge.clear();
  const r = await call("/api/trip?from=KX&to=S&count=3");
  assert.equal(r.body.source, "timetable");
  assert.ok(![...edge.keys()].some((k) => k.includes("/api/trip")), "no edge copy of timetable trips");
});

test("trip copies: plain trips from now are saved per from and to pair, timed or step free trips are not", () => {
  const k = (q) => W.boardKey(new URL("https://api.transportsydney.app/api/trip?" + q));
  assert.deepEqual(k("from=200030&to=206710&count=6&fromName=Kings%20Cross"), { k: "trip:200030>206710", stop: "trip" });
  assert.equal(k("from=200030&to=206710&time=0830"), null);
  assert.equal(k("from=200030&to=206710&acc=1"), null);
  assert.equal(k("from=200030&to=200030"), null);
});

test("a saved trip copy is served only with trips still to leave, never a timetable answer", () => {
  const soon = (m) => new Date(Date.now() + m * 60000).toISOString();
  const live = { kind: "trip", journeys: [{ board: soon(-10) }, { board: soon(3) }, { board: soon(12) }] };
  assert.equal(W.tripCopyOk(JSON.stringify(live)), true);
  assert.equal(W.tripCopyOk(JSON.stringify({ ...live, source: "timetable" })), false);
  assert.equal(W.tripCopyOk(JSON.stringify({ kind: "trip", journeys: [{ board: soon(-10) }, { board: soon(2) }] })), false);
  return W.fromSaved({ at: Date.now() - 120000, body: JSON.stringify(live) }).text().then((t) => {
    const d = JSON.parse(t);
    assert.equal(d.journeys.length, 2, "the departed trip is left out");
    assert.ok(d.dataAt <= Date.now() - 119000, "says how old it is");
  });
});
