// The trip list's first page (27 Oct, speed pass 3): GET /api/trip?page=1 with no cursor is a plain trip from now for
// the quick wait, the timetable stand in and saved copies. Measured on production at 2:35 PM: a first page of Central
// to Chatswood waited 12.5 s (twice) and 8 s, while the plain trip of the same pair answered from its saved copy in
// 0.4 s. Later and earlier pages are unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { efaTrip } from "./helpers/efa.mjs";
import { makeD1 } from "./helpers/d1.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/ttplan.js", "utf8") +
  "\nexport { __default, ttPlan, ttNearby, ttUpstreamDown, timetableTrip, engDayKey, boardKey, fromSaved, tripCopyOk, tripPageFromPlain, gzipText };\n";
const tmp = `/tmp/trip-page-quick-test-${process.pid}-${Date.now()}.mjs`;
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
  return new Response(JSON.stringify(efaTrip([3, 13, 23, 33, 43].map((m) => [{ from: "martinplace", to: "chatswood", dep: now + m * 60000, min: 20, delay: 1, trip: "live" + m }]))));
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
  "200030": ["Martin Place Station", "", "", -33.87448, 151.22223], KX1: ["Martin Place Station Platform 1", "200030", "1", -33.87448, 151.22223],
  "200060": ["Central Station", "", "", -33.88402, 151.2062], C1: ["Central Station Platform 24", "200060", "24", -33.88402, 151.2062],
  C2: ["Central Station Platform 16", "200060", "16", -33.88402, 151.2062], C3: ["Central Station Platform 26", "200060", "26", -33.88402, 151.2062],
  "206710": ["Chatswood Station", "", "", -33.87167, 151.09429], S1: ["Chatswood Station Platform 3", "206710", "3", -33.87167, 151.09429],
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
const D = makeD1();
const env = { TFNSW_API_KEY: "t", DB: D, ENGINE: { idFromName: () => "core", get: () => engine } };
const behind = [];
// Everything the runtime was asked to finish after the answer, including what that work itself queues.
async function settle() { for (let n = -1; n !== behind.length;) { n = behind.length; await Promise.all(behind); await new Promise((r) => setTimeout(r, 20)); } }
const exec = { waitUntil: (p) => { behind.push(Promise.resolve(p).catch(() => null)); } };
let ip = 1;
const call = async (path, envX = env, extra = NEW_APP) => { const res = await W.__default.fetch(new Request("https://api.transportsydney.app" + path, { headers: { "cf-connecting-ip": "10.8.0." + (ip++ % 250), ...extra } }), envX, exec); return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }; };
// The newer app sends its ids as headers (newerApp in worker.js); an older app (builds 201 to 208, updates 27efc6bd
// and ecb0882d) only has device= and profile= in the address.
const NEW_APP = { "x-device": "d1", "x-profile": "p1" };
const OLD_APP = {};



const PAGE = "/api/trip?from=200030&to=206710&fromName=Kings%20Cross&toName=Chatswood&count=6&fare=adult&page=1&after=&before=&arr=&days=1";
// Each test its own pair or fare, so no test reads another one's copy.
const page = (fare) => PAGE.replace("fare=adult", "fare=" + fare);
const U = (p) => new URL("https://api.transportsydney.app" + p);

test("copy keys: the first page has its own key beside the plain trip; later, earlier, day and n pages have none", () => {
  assert.deepEqual(W.boardKey(U("/api/trip?from=200030&to=206710")), { k: "trip:200030>206710", stop: "trip" });
  const k = W.boardKey(U(PAGE));
  assert.equal(k.k, "tripp:200030>206710");
  assert.equal(k.stop, "trip");
  assert.equal(k.plain, "trip:200030>206710");
  assert.equal(W.boardKey(U(PAGE.replace("after=", "after=" + (Date.now() + 600000)))), null);
  assert.equal(W.boardKey(U(PAGE.replace("before=", "before=" + Date.now()))), null);
  assert.equal(W.boardKey(U(PAGE + "&day=2026-10-28")), null);
  assert.equal(W.boardKey(U(PAGE + "&n=6")), null);
  assert.equal(W.boardKey(U(PAGE + "&time=0900")), null);
  assert.equal(W.boardKey(U(PAGE.replace("page=1", "page=2"))), null);
});

const journey = (depMin, arrMin, now) => ({ board: new Date(now + depMin * 60000).toISOString(), leave: new Date(now + depMin * 60000).toISOString(),
  legs: [{ kind: "transit", planned: new Date(now + depMin * 60000).toISOString(), arrPlanned: new Date(now + arrMin * 60000).toISOString() }] });

test("a plain copy as a first page: gone trips out, sorted, cursors from the timetable times", () => {
  const now = Date.now();
  const text = W.tripPageFromPlain(JSON.stringify({ kind: "trip", journeys: [journey(12, 30, now), journey(-5, 10, now), journey(3, 22, now)] }), now);
  const d = JSON.parse(text);
  assert.equal(d.journeys.length, 2);
  assert.ok(Date.parse(d.journeys[0].board) < Date.parse(d.journeys[1].board));
  assert.equal(d.page.dir, "first");
  assert.equal(d.page.prev, now + 3 * 60000);
  assert.equal(d.page.next, now + 12 * 60000);
  assert.equal(d.page.prevArr, now + 22 * 60000);
  assert.equal(d.page.end, false);
  // Never a timetable answer, a page already, or fewer than 2 trips to come.
  assert.equal(W.tripPageFromPlain(JSON.stringify({ source: "timetable", journeys: [journey(3, 20, now), journey(9, 25, now)] }), now), null);
  assert.equal(W.tripPageFromPlain(JSON.stringify({ page: { dir: "first" }, journeys: [journey(3, 20, now), journey(9, 25, now)] }), now), null);
  assert.equal(W.tripPageFromPlain(JSON.stringify({ journeys: [journey(3, 20, now)] }), now), null);
  assert.equal(W.tripPageFromPlain("not json", now), null);
});

test("a slow Trip Planner, first page: labelled timetable trips with page cursors at about 1.5 s, not the planner's 8 s", { timeout: 30000 }, async () => {
  edge.clear(); behind.length = 0; plannerDelay = 8000; plannerFail = false;
  const t0 = Date.now();
  const r = await call(page("child"));
  const took = Date.now() - t0;
  assert.equal(r.status, 200);
  assert.ok(took < 3000 && took >= 1400, `answered in ${took} ms`);
  assert.equal(r.body.source, "timetable");
  assert.equal(r.body.fallback, "planner-slow");
  assert.equal(r.headers.get("x-edge-cache"), "stand-in");
  assert.equal(r.body.page.dir, "first");
  assert.ok(r.body.journeys.length >= 2);
  // The planner's page finishes behind and is the next ask's copy, and it is saved for first opens anywhere.
  await settle();
  plannerDelay = 0;
  const calls = nswCalls;
  const r2 = await call(page("child"));
  assert.notEqual(r2.body.source, "timetable");
  assert.equal(r2.body.page.dir, "first");
  assert.equal(nswCalls, calls, "served from the kept page, no second planner call");
  const row = await D.prepare("SELECT k FROM board_copies WHERE k = ?1").bind("tripp:200030>206710").first();
  assert.ok(row, "the live first page is saved under its own key");
});

test("no page copy but a saved plain trip copy (Home's card, the pre-warm): the first page answers at once from it", { timeout: 30000 }, async () => {
  edge.clear(); behind.length = 0; plannerDelay = 8000; plannerFail = false;
  const now = Date.now();
  const plain = { kind: "trip", from: { id: "200060" }, to: { id: "206710" }, journeys: [journey(4, 18, now), journey(9, 23, now), journey(14, 28, now)].map((j) => ({ ...j, live: true })), now };
  await D.prepare("INSERT OR REPLACE INTO board_copies (k, stop, at, opened, body) VALUES (?1, 'trip', ?2, ?2, ?3)").bind("trip:200060>206710", now - 60000, await W.gzipText(JSON.stringify(plain))).run();
  await D.prepare("DELETE FROM board_copies WHERE k = ?1").bind("tripp:200060>206710").run();
  const t0 = Date.now();
  const r = await call(PAGE.replace("from=200030", "from=200060").replace("Kings%20Cross", "Central"));
  const took = Date.now() - t0;
  assert.equal(r.status, 200);
  assert.ok(took < 1000, `answered in ${took} ms`);
  assert.equal(r.headers.get("x-edge-cache"), "saved");
  assert.equal(r.body.journeys.length, 3);
  assert.equal(r.body.page.dir, "first");
  assert.equal(r.body.page.next, Date.parse(r.body.journeys[2].legs[0].planned));
  plannerDelay = 0;
  await settle();
});

test("a later page is unchanged: it waits for the planner, no stand in and no copy", { timeout: 30000 }, async () => {
  edge.clear(); behind.length = 0; plannerDelay = 3000; plannerFail = false;
  const t0 = Date.now();
  const r = await call(page("senior").replace("after=", "after=" + (Math.floor(Date.now() / 60000) * 60000 + 600000)));
  const took = Date.now() - t0;
  assert.equal(r.status, 200);
  assert.ok(took >= 2900, `waited for the planner (${took} ms)`);
  assert.notEqual(r.body.fallback, "planner-slow");
  assert.equal(r.body.page.dir, "later");
  plannerDelay = 0;
  await settle();
});

test("a fast Trip Planner, first page: the live page, no stand in", { timeout: 30000 }, async () => {
  edge.clear(); behind.length = 0; plannerDelay = 0; plannerFail = false;
  const r = await call(page("gold"));
  assert.equal(r.status, 200);
  assert.notEqual(r.body.source, "timetable");
  assert.equal(r.body.page.dir, "first");
  await settle();
});
