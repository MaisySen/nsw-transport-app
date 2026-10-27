// Boards at another time and the car park list paint at once (27 Oct speed pass 4). A board for another moment
// (/api/departures with time or date) asked the Trip Planner and the stop screen showed a spinner for 3.4 s; now the
// newer app gets the engine's timetable rows for that moment after at most DEP_AT_QUICK_MS while the planner's board
// finishes behind it (kept at the edge for the app's ask again), and older apps wait for the planner as before. The car
// park list with no copy from the last 30 minutes took 9.5 s; the newer app now gets the last saved list (or the list
// with no counts) after at most PARK_QUICK_MS, marked counts-loading, and the live read is kept for its ask again.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./helpers/d1.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/ttplan.js", "utf8") +
  "\nexport { __default, engDayKey, BoardEngine, ttBoardAt, boardAt, memCacheMap, parkMem, parkAllMem, DEP_AT_QUICK_MS, PARK_QUICK_MS };\n";
const tmp = `/tmp/speed4-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const MIN = 60000;
const now = Date.now();
const hhmm = (t) => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)); const o = Object.fromEntries(p.map((x) => [x.type, x.value])); return o.hour + o.minute; };
const sydStr = (ms) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(ms)).replace(" ", "T");

// ---- a small timetable around now (made up stops) ----
const day = W.engDayKey(now);
const base = Math.floor(new Date(new Date().toLocaleString("en-US", { timeZone: "Australia/Sydney" }).replace(/,.*/, "") + " 00:00").getTime() / 1000);
const nowS = Math.floor(now / 1000);
const sec = (m) => nowS + m * 60 - base;
const meta = { ver: 1, days: { [day]: base }, routes: [["T1", 1, "#F99D1C", "train", "", "North Shore"], ["400", 5, "#00B5EF", "bus", "", "Bondi to Airport"]], heads: ["Hornsby", "Airport"], routeIds: {} };
const stops = { P: ["Testville Station", "", "", 0, 0], P1: ["Testville Station Platform 1", "P", "1", 0, 0], B: ["Testville Station, Stand A", "P", "", 0, 0] };
// Services around 90 minutes from now (the asked moment) and one around now, which a board at +90 min must not show.
const rows = {
  P1: [[sec(2), "T-now", 0, 0, 10], [sec(88), "T-a", 0, 0, 10], [sec(95), "T-b", 0, 0, 10], [sec(110), "T-c", 0, 0, 10]],
  B: [[sec(91), "B-1", 1, 1, 7], [sec(101), "B-2", 1, 1, 7]],
};
let feedsWanted = 0;
const fakeSrc = () => ({
  stop: (id) => stops[id] || null, children: (id) => Object.keys(stops).filter((k) => stops[k][1] === id),
  rows: (id, d) => (d === day ? rows[id] || [] : null), days: () => meta.days, route: (i) => meta.routes[i], head: (i) => meta.heads[i] || "",
  routeOf: () => -1, tripSeq: () => null, tu: () => null, vp: () => null, feedAt: () => 0, added: () => [], needFeed: () => { feedsWanted++; },
});
// The engine object: its own fetch (with the /boardat path ttplan.js adds) on a fake timetable.
let engineCalls = 0, engineDelay = 0;
const core = { loadMeta: () => meta, source: fakeSrc };
const engine = { fetch: async (u) => { engineCalls++; if (engineDelay) await new Promise((r) => setTimeout(r, engineDelay)); return W.BoardEngine.prototype.fetch.call(core, new Request(u)); } };

// ---- the Trip Planner and the car park API ----
let plannerDelay = 0, plannerCalls = 0, parkDelay = 0, parkCalls = 0;
const ev = (line, planned) => ({
  location: { id: "P1", name: "Testville Station, Platform 1", properties: { platformName: "Platform 1" }, parent: { id: "P", name: "Testville Station" } },
  departureTimePlanned: new Date(planned).toISOString(), departureTimeEstimated: new Date(planned + MIN).toISOString(), isRealtimeControlled: true,
  transportation: { disassembledName: line, number: line, product: { class: 1 }, destination: { name: "Hornsby", id: "1" }, properties: {} },
  properties: { RealtimeTripId: line + planned },
});
globalThis.fetch = async (u, init) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (url.pathname.endsWith("/departure_mon")) {
    plannerCalls++;
    if (plannerDelay) await new Promise((r) => setTimeout(r, plannerDelay));
    return new Response(JSON.stringify({ locations: [{ id: "P", name: "Testville Station", disassembledName: "Testville" }], stopEvents: [ev("PLAN", now + 90 * MIN), ev("PLAN", now + 100 * MIN)] }));
  }
  if (url.pathname === "/v1/carpark") {
    parkCalls++;
    if (parkDelay) await new Promise((r) => setTimeout(r, parkDelay));
    return new Response(JSON.stringify({ spots: "200", occupancy: { total: "150" }, MessageDate: sydStr(Date.now()) }));
  }
  return new Response("{}", { status: 404 });
};
const edge = new Map();
globalThis.caches = { default: { match: async (req) => { const e = edge.get(String(req.url || req)); return e ? new Response(e.body, { headers: e.headers }) : undefined; }, put: async (req, res) => { edge.set(String(req.url || req), { body: await res.text(), headers: [...res.headers] }); }, delete: async () => true } };
const D = makeD1();
const env = {
  TFNSW_API_KEY: "t", DB: D, ENGINE: { idFromName: () => "core", get: () => engine },
  ASSETS: { fetch: async (req) => { const p = root + "src/public" + new URL(req.url).pathname; return fs.existsSync(p) ? new Response(fs.readFileSync(p)) : new Response("", { status: 404 }); } },
};
const behind = [];
async function settle() { for (let n = -1; n !== behind.length;) { n = behind.length; await Promise.all(behind); await new Promise((r) => setTimeout(r, 20)); } }
const exec = { waitUntil: (p) => { behind.push(Promise.resolve(p).catch(() => null)); } };
const NEW_APP = { "x-device": "tabtestdev", "x-profile": "tabtestprof" };
let ip = 1;
const get = async (path, hdr = NEW_APP, envX = env) => {
  const t0 = Date.now();
  const r = await W.__default.fetch(new Request("https://api.transportsydney.app" + path, { headers: { "cf-connecting-ip": "10.6.0." + (ip++ % 250), ...hdr } }), envX, exec);
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch (e) { body = text; }
  return { status: r.status, body, headers: r.headers, ms: Date.now() - t0 };
};
function clearCopies() { try { D.sql.exec("DELETE FROM board_copies"); } catch (e) { /* the table is made on first use */ } }
function newPlace() { edge.clear(); W.memCacheMap.clear(); W.parkMem.clear(); W.parkAllMem.v = null; W.parkAllMem.at = 0; W.parkAllMem.readAt = 0; }
const later = hhmm(now + 90 * MIN);
const atPath = (extra = "", plus = 0) => `/api/departures?stop=P&time=${hhmm(now + (90 + plus) * MIN)}${extra}`;

test("the engine's /boardat: timetable rows from the asked moment, no feed asked for", async () => {
  feedsWanted = 0;
  const at = now + 90 * MIN;
  const r = await engine.fetch(`https://engine/boardat?stop=P&at=${at}`);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.deepEqual(d.items.map((i) => i.tripId), ["B-1", "T-b", "B-2", "T-c"], "from the moment on, as the planner board is");
  assert.equal(feedsWanted, 0, "a board at another time never marks a feed as wanted");
  const bus = await (await engine.fetch(`https://engine/boardat?stop=P&at=${at}&mode=bus`)).json();
  assert.deepEqual(bus.items.map((i) => i.tripId), ["B-1", "B-2"]);
  assert.equal((await engine.fetch("https://engine/boardat?stop=nowhere&at=" + at)).status, 404);
  assert.equal((await engine.fetch("https://engine/boardat?stop=P&at=x")).status, 400);
});

test("slow planner, newer app: timetable rows for that moment at once, labelled, never kept; the planner's board is the next answer", { timeout: 30000 }, async () => {
  newPlace(); behind.length = 0; plannerDelay = 3000; plannerCalls = 0;
  const r = await get(atPath("&n=31"));
  assert.equal(r.status, 200);
  assert.ok(r.ms < 1500, `answered in ${r.ms} ms`);
  assert.ok(r.ms >= W.DEP_AT_QUICK_MS - 50, "the planner had its first moment");
  assert.equal(r.body.source, "timetable");
  assert.equal(r.body.fallback, "planner-slow");
  assert.equal(r.body.at.time, later, "the moment is echoed, so the app knows the server honoured it");
  assert.equal(r.headers.get("x-edge-cache"), "stand-in");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.ok(r.body.items.length >= 4);
  assert.ok(!r.body.items.some((i) => i.tripId === "T-now"), "only services from the asked moment");
  assert.ok(r.body.items.every((i) => i.realtime === false && i.estimated === null && i.status.key === "scheduled" && i.departed === false));
  assert.equal(plannerCalls, 1, "the planner was asked once, as before");
  await settle();
  const again = await get(atPath("&n=31"));
  assert.equal(again.body.source, undefined, "the ask again gets the planner's board");
  assert.deepEqual(again.body.items.map((i) => i.line), ["PLAN", "PLAN"]);
  assert.equal(plannerCalls, 1, "from the edge copy, no second planner call");
  plannerDelay = 0;
});

test("a quick planner still wins, and older apps and text answers wait for the planner as before", { timeout: 30000 }, async () => {
  newPlace(); behind.length = 0; plannerDelay = 100;
  const fast = await get(atPath("&n=32"));
  assert.equal(fast.body.source, undefined);
  assert.deepEqual(fast.body.items.map((i) => i.line), ["PLAN", "PLAN"]);
  plannerDelay = 2500;
  newPlace();
  const old = await get(atPath("", 3), {});
  assert.ok(old.ms >= 2400, `older app waited for the planner (${old.ms} ms)`);
  assert.equal(old.body.source, undefined);
  assert.deepEqual(old.body.items.map((i) => i.line), ["PLAN", "PLAN"]);
  newPlace();
  const txt = await get(atPath("&format=text", 6));
  assert.ok(txt.ms >= 2400, "text answers are unchanged");
  assert.equal(typeof txt.body, "string");
  // Off switch.
  newPlace();
  const off = await get(atPath("", 9), NEW_APP, { ...env, DEP_AT_QUICK: "off" });
  assert.ok(off.ms >= 2400 && off.body.source === undefined, "DEP_AT_QUICK=off waits for the planner");
  // No engine: the planner as before.
  newPlace();
  const none = await get(atPath("", 12), NEW_APP, { ...env, ENGINE: undefined });
  assert.ok(none.ms >= 2400 && none.body.source === undefined);
  await settle();
  plannerDelay = 0;
});

test("the board for now is unchanged by any of this", { timeout: 30000 }, async () => {
  newPlace(); behind.length = 0; plannerDelay = 1500;
  const r = await get("/api/departures?stop=P&n=37");
  assert.ok(r.ms >= 1400, "a board for now has no timetable stand in here");
  assert.equal(r.body.at, undefined);
  await settle();
  plannerDelay = 0;
});

test("car park list, no copy from the last 30 minutes: the last saved list at once, marked counts-loading; the live read is the next answer", { timeout: 40000 }, async () => {
  newPlace(); behind.length = 0; parkDelay = 0;
  clearCopies();
  const first = await get("/api/parking", {});
  assert.equal(first.status, 200);
  assert.ok(first.body.carparks.some((c) => c.free != null));
  await settle();
  // An hour later (the saved copy is over 30 minutes old) on a cold edge, with the car park API slow.
  D.sql.exec("UPDATE board_copies SET at = at - 3600000 WHERE k = 'park:all'");
  newPlace(); parkDelay = 1200; parkCalls = 0;
  const r = await get("/api/parking");
  assert.ok(r.ms < W.PARK_QUICK_MS + 600, `answered in ${r.ms} ms`);
  assert.ok(r.ms >= W.PARK_QUICK_MS - 50, "the live read had its first moment");
  assert.equal(r.body.fallback, "counts-loading");
  assert.equal(r.headers.get("x-edge-cache"), "stand-in");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.ok(r.body.carparks.length >= 3, "the whole list");
  assert.ok(Number(r.body.dataAt) > 0 && Date.now() - Number(r.body.dataAt) >= 3500000, "labelled with when its counts were read");
  assert.ok(r.body.carparks.every((c) => c.stale && c.label === "No live count"), "hour old counts are never shown as live");
  await settle();
  assert.ok(parkCalls >= 3, "the live counts were read behind it (the same read a first open always made)");
  const again = await get("/api/parking");
  assert.equal(again.body.fallback, undefined);
  assert.ok(again.body.carparks.some((c) => c.free != null && !c.stale), "the ask again has live counts");
  parkDelay = 0;
});

test("car park list with nothing saved: the car parks with no counts, still at once; older apps wait as before", { timeout: 40000 }, async () => {
  newPlace(); behind.length = 0; clearCopies(); parkDelay = 1200;
  const r = await get("/api/parking");
  assert.ok(r.ms < W.PARK_QUICK_MS + 600, `answered in ${r.ms} ms`);
  assert.equal(r.body.fallback, "counts-loading");
  assert.equal(r.body.dataAt, undefined);
  assert.ok(r.body.carparks.length >= 3 && r.body.carparks.every((c) => c.free == null));
  await settle();
  newPlace(); clearCopies(); parkDelay = 0;
  const old = await get("/api/parking", {});
  assert.equal(old.body.fallback, undefined, "an older app gets the live read, however long it takes");
  assert.ok(old.body.carparks.some((c) => c.free != null));
  await settle();
  parkDelay = 0;
});
