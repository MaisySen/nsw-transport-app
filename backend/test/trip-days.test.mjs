// Trip lists a day at a time from our own planner (src/daylist.js, 27 Oct 2026, behind OWN_PLANNER, off): which lines
// connect A to B worked out once, a day's trips by a scan of those patterns (3 AM to 3 AM), trips nobody would pick
// dropped, the days the pack holds besides its own (tripDays, daysHeld), the planner object's /day, and /api/trip with
// days=1 answering whole days only when the planner is on (a Trip Planner page otherwise).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/ttplan.js", "utf8") + "\n" +
  fs.readFileSync(root + "src/raptor.js", "utf8").replace(/\nexport \{ TripPlanner \};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/daylist.js", "utf8") +
  "\nexport { __default, rpOpen, rpSearch, rpPlan, rpEnds, TripPlanner, sydneyParts, dlTemplates, dlScan, dlDay, dlDaysHeld, dlCanList, dlDayStart, dlDayOf, tripDayQuery };\n";
const tmp = `/tmp/trip-days-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const H = 3600, M = 60;
// A pack the way tools/build_planner.py writes it, with the days each trip runs on. trips: { id, route, calls:
// [[stop, arrive s, depart s, flags]], days (offsets from -1 to 7 it runs on, default [0]), off (instance day, default 0) }.
function mkPack({ stops, trips, walks = [], dayStart = 1792933200, day = "20261026", held = null }) {
  const ids = stops.map((s) => s[0]), idx = new Map(ids.map((s, i) => [s, i]));
  const pats = new Map();
  for (const t of trips) {
    const key = t.route + "|" + t.calls.map((c) => c[0] + ":" + (c[3] || 0)).join(",");
    if (!pats.has(key)) pats.set(key, []);
    pats.get(key).push(t);
  }
  const A = { patStopOff: [0], patStops: [], patTripOff: [0], patEvOff: [0], tripRoute: [], tripHead: [], tripPat: [], arr: [], dep: [], flags: [], tripDays: [], tripOff: [] };
  const tripIds = [];
  let p = 0;
  for (const list of pats.values()) {
    list.sort((a, b) => a.calls[0][2] - b.calls[0][2]);
    for (const c of list[0].calls) A.patStops.push(idx.get(c[0]));
    A.patStopOff.push(A.patStops.length);
    for (const t of list) {
      tripIds.push(t.id); A.tripRoute.push(t.route); A.tripHead.push(0); A.tripPat.push(p);
      A.tripDays.push((t.days || [0]).reduce((m, k) => m | (1 << (k + 1)), 0)); A.tripOff.push((t.off || 0) + 1);
      for (const c of t.calls) { A.arr.push(c[1]); A.dep.push(c[2]); A.flags.push(c[3] || 0); }
    }
    A.patTripOff.push(tripIds.length); A.patEvOff.push(A.arr.length);
    p++;
  }
  const sp = ids.map(() => []);
  for (let q = 0; q < p; q++) for (let i = A.patStopOff[q]; i < A.patStopOff[q + 1]; i++) sp[A.patStops[i]].push([q, i - A.patStopOff[q]]);
  A.stopPatOff = [0]; A.stopPat = []; A.stopPatIdx = [];
  for (const l of sp) { for (const [q, i] of l) { A.stopPat.push(q); A.stopPatIdx.push(i); } A.stopPatOff.push(A.stopPat.length); }
  const xf = ids.map(() => []);
  for (const [a, b, s] of walks) { xf[idx.get(a)].push([idx.get(b), s]); xf[idx.get(b)].push([idx.get(a), s]); }
  A.xferOff = [0]; A.xferTo = []; A.xferSec = [];
  for (const l of xf) { for (const [j, s] of l) { A.xferTo.push(j); A.xferSec.push(s); } A.xferOff.push(A.xferTo.length); }
  const arrays = {
    lat: Float32Array.from(stops.map((s) => s[3] || 0)), lon: Float32Array.from(stops.map((s) => s[4] || 0)),
    parent: Int32Array.from(stops.map((s) => (s[2] ? idx.get(s[2]) : -1))), flags: Uint8Array.from(A.flags), tripOff: Uint8Array.from(A.tripOff),
  };
  for (const k of ["patStopOff", "patStops", "patTripOff", "patEvOff", "tripRoute", "tripHead", "tripPat", "arr", "dep", "stopPatOff", "stopPat", "stopPatIdx", "xferOff", "xferTo", "xferSec", "tripDays"]) arrays[k] = Int32Array.from(A[k]);
  const header = {
    v: 1, day, dayStart, builtAt: "test", walk: { mps: 1.2, detour: 1.3, findS: 60, stationMinS: 120, maxM: 400 },
    counts: { stops: ids.length, patterns: p, trips: tripIds.length, events: A.arr.length, footpaths: A.xferTo.length },
    routes: [["T1", 1, "#F99D1C", "", "Sydney Trains"], ["M1", 2, "#168388", "", "Metro"], ["333", 5, "", "", "Bus"]],
    heads: ["City"], arrays: [],
    stopIds: ids.join("\n"), names: stops.map((s) => s[1]).join("\n"), plats: stops.map((s) => s[5] || "").join("\n"), tripIds: tripIds.join("\n"),
    daysHeld: held || [{ day, off: 0, dayStart }],
  };
  for (const [name, a] of Object.entries(arrays)) header.arrays.push({ name, type: a instanceof Float32Array ? "f32" : a instanceof Uint8Array ? "u8" : "i32", length: a.length });
  return { header, arrays };
}
const STOPS = [
  ["A", "Alpha Station", "", -33.80, 151.00], ["A1", "Alpha Station Platform 1", "A", -33.80, 151.00, "1"],
  ["X", "Xing Station", "", -33.85, 151.10], ["X1", "Xing Station Platform 1", "X", -33.85, 151.10, "1"], ["X2", "Xing Station Platform 2", "X", -33.85, 151.1003, "2"],
  ["B", "Beta Station", "", -33.90, 151.20], ["B1", "Beta Station Platform 1", "B", -33.90, 151.20, "1"],
];
const WALKS = [["X1", "X2", 120]];
// T1 A to X every 15 minutes 5 AM to 11:45 PM (12 min), M1 X to B every 15 minutes from :08 (8 min), and a slow direct
// T1 A to B on the hour (40 min).
function day0(extra = [], days = [0], off = 0) {
  const trips = [];
  for (let m = 5 * 60; m < 24 * 60; m += 15) {
    trips.push({ id: `t1-${off}-${m}`, route: 0, days, off, calls: [["A1", m * M, m * M], ["X1", (m + 12) * M, (m + 12) * M]] });
    trips.push({ id: `m1-${off}-${m}`, route: 1, days, off, calls: [["X2", (m + 8 + 7) * M, (m + 8 + 7) * M], ["B1", (m + 23) * M, (m + 23) * M]] });
  }
  for (let h = 6; h < 23; h++) trips.push({ id: `slow-${off}-${h}`, route: 0, days, off, calls: [["A1", h * H, h * H], ["X1", h * H + 15 * M, h * H + 15 * M, 1], ["B1", h * H + 40 * M, h * H + 40 * M]] });
  return trips.concat(extra);
}
const hm = (s) => String(Math.floor(s / H)).padStart(2, "0") + ":" + String(Math.floor(s / M) % 60).padStart(2, "0");
const lines = (j) => j.legs.filter((l) => l.trip != null).map((l) => l.trip);

test("a whole day: every connection found by the scan, not only at the times RAPTOR looked", () => {
  const pk = W.rpOpen(mkPack({ stops: STOPS, trips: day0(), walks: WALKS }));
  const from = W.rpEnds(pk, "A"), to = W.rpEnds(pk, "B");
  const tpl = W.dlTemplates(pk, from, to);
  // The direct line and the change at Xing.
  assert.equal(tpl.list.length, 2);
  assert.ok(tpl.searches > 5 && tpl.searches < 20, "a few RAPTOR searches, once per pair");
  const r = W.dlScan(pk, from, to, "20261026", tpl.list);
  assert.equal(hm(r.start), "03:00"); assert.equal(hm(r.end - 86400), "03:00");
  const changes = r.journeys.filter((j) => j.t.services === 2);
  // Every T1 (5:00 to 11:45 PM) makes the M1 three minutes after it gets in, with the 2 minute walk: 76 trips.
  assert.equal(changes.length, 76);
  for (const j of changes) { const sv = j.legs.filter((l) => l.trip != null); assert.equal(sv[1].dep - sv[0].arr, 3 * M); assert.ok(j.legs.some((l) => l.walk && l.sec === 120)); }
  // RAPTOR's own list at an unsampled time gives the same first trips.
  const at = 13 * H + 7 * M;
  const own = W.rpPlan(pk, { from: "A", to: "B", at, count: 4 }).journeys.map((j) => lines(j).join(">"));
  const mine = r.journeys.filter((j) => j.t.leave >= at).slice(0, 4).map((j) => lines(j).join(">"));
  assert.deepEqual(mine, own);
  // Sorted by when they leave, nothing twice.
  for (let i = 1; i < r.journeys.length; i++) assert.ok(r.journeys[i].t.leave >= r.journeys[i - 1].t.leave);
  assert.equal(new Set(r.journeys.map((j) => lines(j).join(">"))).size, r.journeys.length);
});

test("trips nobody would pick are dropped: the slow direct train stays (fewer changes), a long wait does not", () => {
  // A second M1 two minutes after each one: a trip that waits for it arrives later with no fewer services.
  const extra = [];
  for (let m = 5 * 60; m < 24 * 60; m += 15) extra.push({ id: `m1b-${m}`, route: 1, calls: [["X2", (m + 17) * M, (m + 17) * M], ["B1", (m + 25) * M, (m + 25) * M]] });
  const pk = W.rpOpen(mkPack({ stops: STOPS, trips: day0(extra), walks: WALKS }));
  const from = W.rpEnds(pk, "A"), to = W.rpEnds(pk, "B");
  const r = W.dlScan(pk, from, to, "20261026", W.dlTemplates(pk, from, to).list);
  assert.ok(!r.journeys.some((j) => lines(j).some((t) => pk.tripId.at(t).startsWith("m1b"))), "the later M1 is never the best catch");
  const slow = r.journeys.filter((j) => j.t.services === 1);
  assert.equal(slow.length, 17, "the direct train each hour, kept for no change");
  // No journey is beaten by another that leaves no earlier, arrives no later with no more services.
  for (const j of r.journeys) assert.ok(!r.journeys.some((o) => o !== j && o.t.leave >= j.t.leave && o.t.arrive <= j.t.arrive && o.t.services <= j.t.services && (o.t.leave > j.t.leave || o.t.arrive < j.t.arrive || o.t.services < j.t.services)));
});

test("days held: the next day comes from the pack day's trips that run on it, a day not held is not listed", () => {
  const ds = 1792933200;
  // Day 0 is a Monday; Tuesday's services are all Monday's (held), Wednesday has its own (not held).
  const held = [{ day: "20261026", off: 0, dayStart: ds }, { day: "20261027", off: 1, dayStart: ds + 86400 }];
  const trips = day0([], [0, 1]);
  // A late T1 at 11:55 PM runs Monday only, and the next morning's instance the pack carries anyway (off 1, +24 h).
  trips.push({ id: "late", route: 0, days: [0], calls: [["A1", 23 * H + 55 * M, 23 * H + 55 * M], ["X1", 24 * H + 7 * M, 24 * H + 7 * M]] });
  trips.push({ id: "m1-late", route: 1, days: [0], calls: [["X2", 24 * H + 10 * M, 24 * H + 10 * M], ["B1", 24 * H + 18 * M, 24 * H + 18 * M]] });
  for (const t of day0([], [0, 1], 1).filter((t) => t.calls[0][2] < 8 * H)) { t.calls = t.calls.map((c) => [c[0], c[1] + 86400, c[2] + 86400, c[3]]); trips.push(t); }
  const pk = W.rpOpen(mkPack({ stops: STOPS, trips, walks: WALKS, held }));
  assert.equal(W.dlCanList(pk, "20261026"), true);
  assert.equal(W.dlCanList(pk, "20261027"), false, "Tuesday needs Wednesday's early trips too");
  const pk2 = W.rpOpen(mkPack({ stops: STOPS, trips, walks: WALKS, held: [...held, { day: "20261028", off: 2, dayStart: ds + 2 * 86400 }] }));
  assert.equal(W.dlCanList(pk2, "20261027"), true);
  const from = W.rpEnds(pk2, "A"), to = W.rpEnds(pk2, "B");
  const tpl = W.dlTemplates(pk2, from, to).list;
  const mon = W.dlScan(pk2, from, to, "20261026", tpl), tue = W.dlScan(pk2, from, to, "20261027", tpl);
  // Monday: its own trips, the late one, and none of the next morning's (they are Tuesday's list).
  assert.ok(mon.journeys.some((j) => lines(j).map((t) => pk2.tripId.at(t)).includes("late")));
  assert.ok(mon.journeys.every((j) => j.t.leave < 27 * H));
  // Tuesday: the same timetable a day later, without Monday's late trip, starting where Monday stops.
  assert.equal(tue.start, mon.end);
  assert.equal(tue.journeys.length, mon.journeys.length - 1);
  assert.equal(tue.journeys[0].t.leave - mon.journeys[0].t.leave, 86400);
  assert.ok(!tue.journeys.some((j) => lines(j).map((t) => pk2.tripId.at(t)).includes("late")));
  // No trip is in both lists.
  const ids = (r) => r.journeys.map((j) => lines(j).map((t) => t + "@" + j.t.leave).join(">"));
  assert.equal(ids(mon).filter((x) => ids(tue).includes(x)).length, 0);
});

test("a pack built before 27 Oct lists its own day only", () => {
  const p = mkPack({ stops: STOPS, trips: day0(), walks: WALKS });
  delete p.header.daysHeld;
  const pk = W.rpOpen(p);
  assert.deepEqual(Object.keys(W.dlDaysHeld(pk)), ["20261026"]);
  const d = W.dlDay(pk, { from: "A", to: "B", day: "20261027" });
  assert.equal(d.error, "day");
  const ok = W.dlDay(pk, { from: "A", to: "B" });
  assert.ok(ok.journeys.length > 80);
  assert.equal(ok.prevDay, null); assert.equal(ok.nextDay, null);
  assert.equal(ok.journeys[0].source, "own");
});

test("the day of a moment is 3 AM to 3 AM; a day's start is noon minus 12 hours (summer time too)", () => {
  assert.equal(W.dlDayStart("20261026"), Date.parse("2026-10-25T13:00:00Z") / 1000);
  assert.equal(W.dlDayStart("20260704"), Date.parse("2026-07-03T14:00:00Z") / 1000);
  assert.equal(W.dlDayOf(Date.parse("2026-10-26T15:30:00Z")), "20261026", "2:30 AM on the 27th is still the 26th's list");
  assert.equal(W.dlDayOf(Date.parse("2026-10-26T16:30:00Z")), "20261027");
});

test("the build script writes tripDays, tripOff and daysHeld from the calendar", () => {
  const out = `/tmp/trip-days-pack-${process.pid}.bin`;
  execFileSync("python3", [root + "tools/build_planner.py", root + "test/fixtures/gtfs-runs", out, "20261026"], { stdio: "pipe" });
  const pk = W.rpOpen(fs.readFileSync(out)); fs.unlinkSync(out);
  assert.ok(pk.tripDays && pk.tripOff, "both arrays");
  assert.equal(pk.tripDays.length, pk.T); assert.equal(pk.tripOff.length, pk.T);
  // The fixture's one service runs on Monday 26 Oct only: bit 1 (day 0) on the day's instances.
  for (let i = 0; i < pk.T; i++) if (pk.tripOff[i] === 1) assert.equal(pk.tripDays[i], 2);
  assert.ok(pk.h.daysHeld.some((d) => d.day === "20261026" && d.off === 0 && d.dayStart === pk.dayStart));
});

// ---- the planner object and /api/trip ----
function fakeState() {
  const db = new DatabaseSync(":memory:");
  return { storage: { sql: { exec: (q, ...a) => { const st = db.prepare(q); if (/^\s*(SELECT)/i.test(q)) { const rows = st.all(...a.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x))); return { toArray: () => rows.map((r) => ({ ...r, ...(r.data ? { data: r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength) } : {}) })) }; } st.run(...a.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x))); return { toArray: () => [] }; } } } };
}
async function loadInto(obj, pack) {
  const post = (path, body) => obj.fetch(new Request("https://planner" + path, { method: "POST", body }));
  await post(`/load/begin?ver=3`, "");
  await post(`/load/part?ver=3&part=head&i=0`, new TextEncoder().encode(JSON.stringify(pack.header)));
  for (const a of pack.header.arrays) { const t = pack.arrays[a.name]; await post(`/load/part?ver=3&part=${a.name}&i=0`, new Uint8Array(t.buffer, t.byteOffset, t.byteLength).slice()); }
  return (await post(`/load/commit?ver=3`, "")).json();
}
function todayPack() {
  // The day of this moment (3 AM to 3 AM), not the calendar date: from midnight to 3 AM the planner's day is yesterday's,
  // and a pack on the calendar date failed the days=1 and added train tests in those hours.
  const date = W.dlDayOf(Date.now());
  const ds = W.dlDayStart(date);
  // Today's list: the timetable above on today's date, tomorrow held too.
  const held = [{ day: date, off: 0, dayStart: ds }];
  return mkPack({ stops: STOPS, trips: day0(), walks: WALKS, dayStart: ds, day: date, held });
}

test("the planner object's /day: templates once per pair, then a scan; rows read only when it opens", async () => {
  const st = fakeState();
  let reads = 0;
  const exec = st.storage.sql.exec;
  st.storage.sql.exec = (q, ...a) => { if (/^\s*SELECT data FROM part/i.test(q)) reads++; return exec(q, ...a); };
  const obj = new W.TripPlanner(st, {});
  const pack = todayPack();
  const c = await loadInto(obj, pack);
  assert.equal(c.ok, true);
  const before = reads;
  const d1 = await (await obj.fetch(new Request("https://planner/day?from=A&to=B"))).json();
  assert.equal(d1.templatesMade, true);
  assert.ok(d1.journeys.length > 80);
  const d2 = await (await obj.fetch(new Request("https://planner/day?from=A&to=B"))).json();
  assert.equal(d2.templatesMade, false, "the second ask reuses the pair's lines");
  assert.equal(reads - before, 0, "no storage rows read once the pack is in memory");
  assert.deepEqual(d2.ends.from, ["A1"], "the stops of the station that have services");
  assert.ok(d2.direct.length >= 17);
});

test("/api/trip days=1: whole days with the planner on, the Trip Planner page with it off or for an old phone", async () => {
  const obj = new W.TripPlanner(fakeState(), {});
  await loadInto(obj, todayPack());
  let tpCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { if (/\/tp\//.test(String(u.url || u))) tpCalls++; return new Response("{}", { status: 503 }); };
  const edge = new Map();
  globalThis.caches = { default: { match: async (q) => (edge.has(String(q.url || q)) ? new Response(edge.get(String(q.url || q))) : undefined), put: async (q, r) => { edge.set(String(q.url || q), await r.text()); }, delete: async () => true } };
  const planner = { idFromName: (n) => n, get: () => ({ fetch: (u, init) => obj.fetch(new Request(u, init)) }) };
  const env = { PLANNER: planner, OWN_PLANNER: "on", API_ONLY: "1" };
  // Each ask its own copy key (the 15 s shared copy would answer a repeat of the same query, flag or no flag).
  let n = 0;
  const get = (q, e = env, h = {}) => W.__default.fetch(new Request("https://api.transportsydney.app/api/trip?" + q + "&fromName=t" + n++, { headers: h }), e, { waitUntil: () => {} });
  try {
    const res = await get("from=A&to=B&page=1&days=1");
    const d = await res.json();
    assert.equal(res.status, 200, JSON.stringify(d).slice(0, 300));
    assert.equal(d.page.mode, "day");
    assert.equal(d.page.day, W.dlDayOf(Date.now()));
    assert.ok(d.journeys.length > 80, "the whole day, past trips included");
    assert.equal(tpCalls, 0, "no Trip Planner call");
    assert.ok(Date.parse(d.journeys[0].leave) >= d.page.windowStart && Date.parse(d.journeys[d.journeys.length - 1].leave) < d.page.windowEnd);
    assert.equal(d.page.nextDay, null, "tomorrow is not held in this pack");
    // Live step: every transit leg has a status, as any trip answer.
    assert.ok(d.journeys.every((j) => j.legs.filter((l) => l.kind === "transit").every((l) => l.status)));
    // A day the pack does not hold: the Trip Planner page from that day's 3 AM (refused here, so an error, no planner day).
    const later = W.sydneyParts(new Date(Date.now() + 3 * 86400000)).date;
    const r2 = await get("from=A&to=B&page=1&days=1&day=" + later);
    const d2 = await r2.json().catch(() => ({}));
    assert.ok(!(d2.page && d2.page.mode === "day"));
    // Off: never a planner day, whatever the phone sends.
    tpCalls = 0;
    const off = await get("from=A&to=B&page=1&days=1&refresh=1", { ...env, OWN_PLANNER: "off" });
    const od = await off.json().catch(() => ({}));
    assert.ok(!(od.page && od.page.mode === "day"), JSON.stringify({ s: off.status, h: [...off.headers], p: od.page, src: od.source }).slice(0, 600));
    assert.ok(tpCalls >= 1, "the Trip Planner page as before");
    // own=1 without the key does nothing; with the engine load key it is a check of the planner days.
    const nokey = await (await get("from=A&to=B&page=1&days=1&own=1&refresh=1", { ...env, OWN_PLANNER: "off" })).json().catch(() => ({}));
    assert.ok(!(nokey.page && nokey.page.mode === "day"));
    const keyed = await (await get("from=A&to=B&page=1&days=1&own=1", { ...env, OWN_PLANNER: "off", ENGINE_LOAD_KEY: "k".repeat(32) }, { "x-admin-key": "k".repeat(32) })).json();
    assert.equal(keyed.page.mode, "day");
    // A phone that does not send days=1 gets the Trip Planner page shape even with the planner on.
    assert.equal(W.tripDayQuery(new URLSearchParams("page=1&from=A&to=B"), env, new Request("https://x/"), {}), null);
    assert.equal(W.tripDayQuery(new URLSearchParams("page=1&days=1"), env, new Request("https://x/"), { accessible: true }), null);
    assert.equal(W.tripDayQuery(new URLSearchParams("page=1&days=1"), env, new Request("https://x/"), { arriveBy: true }), null);
    assert.equal(W.tripDayQuery(new URLSearchParams("page=1&days=1&after=1793050000000"), env, new Request("https://x/"), {}), null, "cursor pages stay Trip Planner pages");
    assert.deepEqual(W.tripDayQuery(new URLSearchParams("page=1&days=1&day=20261028"), env, new Request("https://x/"), {}), { day: "20261028", more: true });
  } finally { globalThis.fetch = realFetch; }
});

// A GTFS realtime trip update feed (the fields the worker reads), for the added train test.
const vint = (n) => { const out = []; let v = BigInt(n); if (v < 0n) v += 1n << 64n; do { let b = Number(v & 127n); v >>= 7n; if (v) b |= 128; out.push(b); } while (v); return out; };
const fld = (f, wt) => vint(f * 8 + wt);
const num = (f, n) => [...fld(f, 0), ...vint(n)];
const str = (f, s) => { const b = [...Buffer.from(s)]; return [...fld(f, 2), ...vint(b.length), ...b]; };
const msg = (f, bytes) => [...fld(f, 2), ...vint(bytes.length), ...bytes];
const evt = (o) => [...num(1, o.delay), ...num(2, o.time)];
const stuB = (u) => [...msg(2, evt(u.arr)), ...msg(3, evt(u.dep)), ...str(4, u.stopId)];
const tuB = (t) => [...msg(1, [...str(1, t.tripId), ...num(4, t.rel || 0), ...str(5, t.routeId || "R")]), ...t.stus.flatMap((u) => msg(2, stuB(u))), ...num(4, t.ts)];
const feedOf = (trips) => Uint8Array.from([...msg(1, [...str(1, "2.0"), ...num(3, Math.floor(Date.now() / 1000))]), ...trips.flatMap((t, i) => msg(2, [...str(1, "e" + i), ...msg(3, tuB(t))]))]);

test("added trains: a live train from A to B the day's list lacks is put on (once), a known trip is not", async () => {
  const obj = new W.TripPlanner(fakeState(), {});
  await loadInto(obj, todayPack());
  const now = Math.floor(Date.now() / 60000) * 60; // a whole minute, so the planned minute is exact
  const at = (s, d) => ({ arr: { delay: d, time: now + s }, dep: { delay: d, time: now + s } });
  const feed = feedOf([
    // Published after the timetable: A1 in 10 minutes (2 late), B1 25 minutes later.
    { tripId: "NEW.1", ts: now, stus: [{ stopId: "A1", ...at(600, 120) }, { stopId: "X1", ...at(1200, 120) }, { stopId: "B1", ...at(2100, 120) }] },
    // Not to B: left alone.
    { tripId: "NEW.2", ts: now, stus: [{ stopId: "A1", ...at(700, 0) }, { stopId: "X1", ...at(1300, 0) }] },
    // B before A (the other way): left alone.
    { tripId: "NEW.3", ts: now, stus: [{ stopId: "B1", ...at(700, 0) }, { stopId: "A1", ...at(1300, 0) }] },
    // A known direct trip of today's list.
    { tripId: "slow-0-12", ts: now, stus: [{ stopId: "A1", ...at(800, 0) }, { stopId: "B1", ...at(1900, 0) }] },
  ]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { const s = String(u.url || u); if (/realtime\/sydneytrains/.test(s)) return new Response(feed, { status: 200 }); return new Response("{}", { status: 503 }); };
  globalThis.caches = { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };
  const planner = { idFromName: (n) => n, get: () => ({ fetch: (u, init) => obj.fetch(new Request(u, init)) }) };
  const env = { PLANNER: planner, OWN_PLANNER: "on", API_ONLY: "1", TFNSW_API_KEY: "x" };
  try {
    const d = await (await W.__default.fetch(new Request("https://api.transportsydney.app/api/trip?from=A&to=B&page=1&days=1&fromName=added"), env, { waitUntil: () => {} })).json();
    assert.equal(d.page.mode, "day");
    const added = d.journeys.filter((j) => j.added);
    assert.equal(added.length, 1, JSON.stringify(added.map((j) => j.legs[0].tripId)));
    const l = added[0].legs[0];
    assert.equal(l.tripId, "NEW.1"); assert.equal(l.added, true); assert.equal(l.realtime, true);
    assert.equal(l.delayMin, 2, "planned is the whole minute before the delay");
    assert.equal(Date.parse(l.estimated), (now + 600) * 1000);
    assert.equal(d.page.added, 1);
    // Still in order of planned departure.
    const deps = d.journeys.map((j) => Date.parse(j.legs.find((x) => x.kind === "transit").planned));
    for (let i = 1; i < deps.length; i++) assert.ok(deps[i] >= deps[i - 1]);
  } finally { globalThis.fetch = realFetch; }
});
