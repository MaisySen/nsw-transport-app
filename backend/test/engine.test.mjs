// Board engine (src/engine.js, docs/ENGINE.md): boards from the timetable plus the trip update feeds, live delays carried
// down the line, cancelled and skipped stops, platform changes, added services, the Durable Object's timetable load,
// feeds fetched per feed (not per phone or stop), and the on phone timetable pack.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine \};\s*$/, "\n") +
  "\nexport { __default, engBuildBoard, engLive, engDayKey, engPlatform, BoardEngine, engineWanted };\n";
const tmp = `/tmp/engine-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

// ---- a tiny GTFS realtime encoder (protobuf wire format) ----
const vint = (n) => { const out = []; let v = BigInt(n); if (v < 0n) v += 1n << 64n; do { let b = Number(v & 127n); v >>= 7n; if (v) b |= 128; out.push(b); } while (v); return out; };
const fld = (f, wt) => vint(f * 8 + wt);
const num = (f, n) => [...fld(f, 0), ...vint(n)];
const str = (f, s) => { const b = [...Buffer.from(s)]; return [...fld(f, 2), ...vint(b.length), ...b]; };
const msg = (f, bytes) => [...fld(f, 2), ...vint(bytes.length), ...bytes];
const ev = (o) => [...(o.delay != null ? num(1, o.delay) : []), ...(o.time != null ? num(2, o.time) : [])];
function stu(u) { return [...(u.seq != null ? num(1, u.seq) : []), ...(u.arr ? msg(2, ev(u.arr)) : []), ...(u.dep ? msg(3, ev(u.dep)) : []), ...(u.stopId ? str(4, u.stopId) : []), ...(u.rel != null ? num(5, u.rel) : [])]; }
function tripUpdate(t) {
  const desc = [...str(1, t.tripId), ...(t.startDate ? str(3, t.startDate) : []), ...(t.rel != null ? num(4, t.rel) : []), ...(t.routeId ? str(5, t.routeId) : [])];
  return [...msg(1, desc), ...(t.stus || []).flatMap((u) => msg(2, stu(u))), ...num(4, t.ts || 1)];
}
function feed(tus) {
  const header = [...str(1, "2.0"), ...num(3, Math.floor(Date.now() / 1000))];
  return new Uint8Array([...msg(1, header), ...tus.flatMap((t, i) => msg(2, [...str(1, "e" + i), ...msg(3, tripUpdate(t))]))]);
}

// ---- a timetable around a fixed day ----
const day = W.engDayKey(Date.now());
const base = Math.floor(new Date(new Date().toLocaleString("en-US", { timeZone: "Australia/Sydney" }).replace(/,.*/, "") + " 00:00").getTime() / 1000);
const nowS = Math.floor(Date.now() / 1000);
const sec = (minFromNow) => nowS + minFromNow * 60 - base; // seconds after our day start
const meta = { days: { [day]: base }, routes: [["T1", 1, "#F99D1C", "train", "", "North Shore"], ["400", 5, "#00B5EF", "bus", "", "Bondi to Airport"]], heads: ["Hornsby", "Airport"], routeIds: { train: { NSN_1a: 0 }, bus: { "2500_400": 1 } } };
const stops = { P: ["Testville Station", "", "", 0, 0], P1: ["Testville Station Platform 1", "P", "1", 0, 0], P2: ["Testville Station Platform 2", "P", "2", 0, 0], B: ["Testville Station, Stand A", "P", "", 0, 0], Z: ["Endtown Station Platform 1", "", "1", 0, 0] };
const rows = {
  P1: [[sec(5), "T-A", 0, 0, 10], [sec(12), "T-B", 0, 0, 10], [sec(200), "T-far", 0, 0, 10]],
  B: [[sec(3), "B-1", 1, 1, 7], [sec(8), "B-2", 1, 1, 7], [sec(-5), "B-late", 1, 1, 7]],
};
const tripSeq = { "T-A": new Map([["Up", 8], ["P1", 10], ["Z", 20]]), "T-B": new Map([["Up", 8], ["P1", 10], ["Z", 20]]) };
function fakeSrc(live = {}, added = {}) {
  return {
    stop: (id) => stops[id] || null, children: (id) => Object.keys(stops).filter((k) => stops[k][1] === id),
    rows: (id, d) => (d === day ? rows[id] || [] : null), days: () => meta.days, route: (i) => meta.routes[i], head: (i) => meta.heads[i] || "",
    routeOf: (f, r) => (meta.routeIds[f] && r in meta.routeIds[f] ? meta.routeIds[f][r] : -1),
    tripSeq: (f, t) => (f === "train" ? tripSeq[t] || null : null),
    tu: (f, t) => live[t] || null, vp: () => null, feedAt: () => Date.now() - 3000, added: (f) => added[f] || [],
  };
}

test("a station board lists its platforms and stands in time order with timetable times when nothing is live", () => {
  const b = W.engBuildBoard(fakeSrc(), "P");
  assert.deepEqual(b.items.map((i) => i.tripId), ["B-1", "T-A", "B-2", "T-B"]);
  assert.equal(b.items[1].platform, "Platform 1");
  assert.equal(b.items[1].line, "T1");
  assert.equal(b.items[1].dest, "Hornsby");
  assert.equal(b.items[1].realtime, false);
  assert.equal(b.items[1].status.key, "scheduled");
  assert.equal(b.stop.name, "Testville Station");
  assert.deepEqual(b.modes.sort(), ["bus", "train"]);
  assert.ok(!b.items.some((i) => i.tripId === "T-far"), "past the 90 minute horizon");
  assert.ok(!b.items.some((i) => i.tripId === "B-late"), "left 5 minutes ago with no live time");
});

test("a platform's own board and a mode filter", () => {
  assert.deepEqual(W.engBuildBoard(fakeSrc(), "P1").items.map((i) => i.tripId), ["T-A", "T-B"]);
  assert.deepEqual(W.engBuildBoard(fakeSrc(), "P", { mode: "bus" }).items.map((i) => i.tripId), ["B-1", "B-2"]);
});

test("no timetable for a stop gives null so the worker asks the Trip Planner", () => {
  assert.equal(W.engBuildBoard(fakeSrc(), "nowhere"), null);
});

test("live delay at the stop, a delay carried down from an earlier stop, and a late bus still shown", () => {
  const live = {
    "T-A": { tripId: "T-A", ts: 1, stus: [{ stopId: "Up", dep: { delay: 240 } }] },             // no sequence: from the timetable order
    "B-1": { tripId: "B-1", ts: 1, startDate: day, stus: [{ seq: 7, stopId: "B", dep: { delay: 120 } }] },
    "B-late": { tripId: "B-late", ts: 1, startDate: day, stus: [{ seq: 5, stopId: "x", dep: { delay: 420 } }] },
  };
  const b = W.engBuildBoard(fakeSrc(live), "P");
  const ta = b.items.find((i) => i.tripId === "T-A");
  assert.equal(ta.realtime, true); assert.equal(ta.delayMin, 4); assert.equal(ta.status.text, "4 min late");
  assert.equal(b.items.find((i) => i.tripId === "B-1").delayMin, 2);
  const late = b.items.find((i) => i.tripId === "B-late");
  assert.ok(late, "planned 5 min ago, 7 min late: still to come");
  assert.equal(late.delayMin, 7);
});

test("cancelled trip, skipped stop, platform change, and another day's update ignored", () => {
  const live = {
    "T-A": { tripId: "T-A", ts: 1, rel: 3, stus: [] },
    "T-B": { tripId: "T-B", ts: 1, stus: [{ stopId: "P2", dep: { delay: 60 } }] },
    "B-1": { tripId: "B-1", ts: 1, startDate: day, stus: [{ seq: 7, stopId: "B", rel: 1 }] },
    "B-2": { tripId: "B-2", ts: 1, startDate: "19990101", stus: [{ seq: 7, stopId: "B", dep: { delay: 600 } }] },
  };
  const tripSeqSave = tripSeq["T-B"]; tripSeq["T-B"] = new Map([["Up", 8], ["P2", 10], ["Z", 20]]);
  const b = W.engBuildBoard(fakeSrc(live), "P");
  tripSeq["T-B"] = tripSeqSave;
  const by = (id) => b.items.find((i) => i.tripId === id);
  assert.equal(by("T-A").cancelled, true); assert.equal(by("T-A").status.key, "cancelled");
  assert.equal(by("T-B").platform, "Platform 2"); assert.equal(by("T-B").platformChangedFrom, "Platform 1"); assert.equal(by("T-B").stopId, "P2");
  assert.equal(by("B-1").skipped, true);
  assert.equal(by("B-2").realtime, false);
});

test("a replacement timetable that calls before and after this stop but not here drops the row", () => {
  const live = { "T-A": { tripId: "T-A", ts: 1, rel: 5, stus: [{ stopId: "Up", dep: { time: nowS + 60 } }, { stopId: "Z", arr: { time: nowS + 900 } }] } };
  assert.ok(!W.engBuildBoard(fakeSrc(live), "P1").items.some((i) => i.tripId === "T-A"));
});

test("a service added on the day that calls here is listed with its live time", () => {
  const added = { train: [{ tripId: "ADD-1", routeId: "NSN_1a", rel: 1, ts: 1, stus: [{ stopId: "P2", dep: { time: nowS + 600, delay: 0 } }, { stopId: "Z", arr: { time: nowS + 1200 } }] }] };
  const b = W.engBuildBoard(fakeSrc({}, added), "P");
  const a = b.items.find((i) => i.tripId === "ADD-1");
  assert.ok(a); assert.equal(a.line, "T1"); assert.equal(a.dest, "Endtown Station"); assert.equal(a.realtime, true); assert.equal(a.platform, "Platform 2");
});

test("live times win over a delay; a NO_DATA stop stays scheduled", () => {
  const r = { stopId: "B", seq: 7, planned: Date.now() + 300000 };
  assert.equal(W.engLive({ stus: [{ seq: 7, stopId: "B", dep: { time: nowS + 400, delay: 9 } }] }, r).est, (nowS + 400) * 1000);
  assert.equal(W.engLive({ stus: [{ seq: 7, stopId: "B", rel: 2 }] }, r), null);
  assert.equal(W.engLive(null, r), null);
});

test("platform names: a street called Wharf St is not a wharf; a bus stand code says Stand", () => {
  assert.equal(W.engPlatform("Tweed Mall, Wharf St", "", 5), "");
  assert.equal(W.engPlatform("Circular Quay, Wharf 4, Side A", "", 9), "Wharf 4, Side A");
  assert.equal(W.engPlatform("Some Stop", "C", 5), "Stand C");
  assert.equal(W.engPlatform("Royal Randwick Light Rail", "2", 4), "Platform 2");
});

test("engine flag: on, off, and engine=1 or engine=0 on the request", () => {
  const u = (q) => new URL("https://x/api/departures?stop=1" + q);
  assert.equal(W.engineWanted({ ENGINE_BOARDS: "off" }, u("")), false);
  assert.equal(W.engineWanted({ ENGINE_BOARDS: "on" }, u("")), true);
  assert.equal(W.engineWanted({ ENGINE_BOARDS: "off" }, u("&engine=1")), true);
  assert.equal(W.engineWanted({ ENGINE_BOARDS: "on" }, u("&engine=0")), false);
});

// ---- the Durable Object ----
function fakeState() {
  const db = new DatabaseSync(":memory:");
  let alarm = null;
  return {
    storage: {
      sql: { exec(q, ...args) { if (/^\s*(SELECT)/i.test(q)) { const rows = db.prepare(q).all(...args); return { toArray: () => rows }; } if (args.length) db.prepare(q).run(...args); else db.exec(q); return { toArray: () => [] }; } },
      getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; },
    },
  };
}
async function loaded(feedCalls) {
  globalThis.fetch = async (u) => { feedCalls.push(String(u)); const tu = /vehiclepos/.test(String(u)) ? [] : [{ tripId: "B-2", startDate: day, stus: [{ seq: 7, stopId: "B", dep: { delay: 180 } }] }]; return new Response(feed(tu)); };
  const E = new W.BoardEngine(fakeState(), { TFNSW_API_KEY: "k" });
  const post = (p, body) => E.fetch(new Request("https://engine" + p, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
  assert.equal((await (await post("/load/begin", { ...meta, builtAt: "2026-10-26T00:00:00Z" })).json()).ver, 1);
  await post("/load/stops", Object.entries(stops).map(([id, s]) => [id, s[0], s[1], s[2], s[3], s[4]]));
  await post("/load/days", Object.entries(rows).map(([s, r]) => JSON.stringify({ s, d: day, r })).join("\n"));
  await post("/load/trips", Object.entries(tripSeq).map(([t, m]) => JSON.stringify({ t, s: [...m].flat() })).join("\n"));
  const c = await (await post("/load/commit", {})).json();
  assert.equal(c.ver, 1); assert.equal(c.counts.stops, 5);
  return E;
}

test("the object loads a timetable, answers a board with live times, and refuses an empty load", async () => {
  const calls = [];
  const E = await loaded(calls);
  const r = await E.fetch(new Request("https://engine/board?stop=P"));
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.items.find((i) => i.tripId === "B-2").delayMin, 3);
  assert.equal((await E.fetch(new Request("https://engine/board?stop=nowhere"))).status, 404);
  const bad = new W.BoardEngine(fakeState(), {});
  await bad.fetch(new Request("https://engine/load/begin", { method: "POST", body: JSON.stringify(meta) }));
  assert.equal((await bad.fetch(new Request("https://engine/load/commit", { method: "POST", body: "{}" }))).status, 409);
});

test("feed calls depend on feeds, not on phones or stops: 200 reads of 3 boards cost one copy of each feed", async () => {
  const calls = [];
  const E = await loaded(calls);
  const n0 = calls.length;
  await Promise.all(Array.from({ length: 200 }, (_, i) => E.fetch(new Request("https://engine/board?stop=" + ["P", "P1", "B"][i % 3]))));
  const used = calls.slice(n0);
  assert.ok(used.length <= 4, "train and bus feeds, trip updates and vehicles at most once each: " + used.length);
  await E.tick(); // the alarm: refreshes only feeds that are due
  assert.ok(calls.length - n0 <= 8);
  const st = E.status();
  assert.equal(st.hotBoards, 3);
  assert.ok(st.feeds.bus && st.feeds.train);
});

test("the timetable pack for the phone: rows, routes and headsigns for the asked stops only", async () => {
  const E = await loaded([]);
  const t = await (await E.fetch(new Request("https://engine/timetable?stops=P,nowhere&days=1"))).json();
  assert.deepEqual(Object.keys(t.stops), ["P"]);
  const d = t.stops.P.days[day];
  assert.equal(d.start, base);
  assert.equal(d.rows.length, 6);
  assert.deepEqual(t.routes.map((r) => r[0]).sort(), ["400", "T1"]);
  assert.deepEqual([...t.heads].sort(), ["Airport", "Hornsby"]);
  assert.ok(t.stops.P.stops.includes("P1"));
});

test("platform names learnt from Trip Planner boards replace the timetable's", async () => {
  const E = await loaded([]);
  await E.fetch(new Request("https://engine/learn", { method: "POST", body: JSON.stringify([["B", "Stand X1"], ["P1", "<b>x</b>"]]) }));
  const b = await (await E.fetch(new Request("https://engine/board?stop=P"))).json();
  assert.equal(b.items.find((i) => i.tripId === "B-1").platform, "Stand X1");
  assert.equal(b.items.find((i) => i.tripId === "T-A").platform, "Platform 1");
});

test("a loop service: the update for its first call does not land on its last call at the same stop", () => {
  const p = 1792980000000;
  const tu = { rel: 0, stus: [{ seq: 1, stopId: "S", dep: { time: (p - 1800000) / 1000 + 120, delay: 120 } }, { seq: 15, stopId: "M", arr: { delay: 60, time: (p - 900000) / 1000 + 60 } }] };
  const last = W.engLive(tu, { planned: p, stopId: "S", seq: 30 }, null, false);
  assert.equal(last.delay, 60);
  assert.equal(last.est, p + 60000);
  const first = W.engLive(tu, { planned: p - 1800000, stopId: "S", seq: 1 }, null, false);
  assert.equal(first.delay, 120);
});
