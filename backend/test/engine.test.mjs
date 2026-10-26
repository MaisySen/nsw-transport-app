// Board engine (src/engine.js, docs/ENGINE.md): boards from the timetable plus the trip update feeds, live delays carried
// down the line, cancelled and skipped stops, platform changes, added services, the Durable Object's timetable load,
// feeds fetched per feed (not per phone or stop), and the on phone timetable pack.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine, BoardShard \};\s*$/, "\n") +
  "\nexport { __default, engBuildBoard, engLive, engDayKey, engPlatform, BoardEngine, BoardShard, engineWanted, engTrim, engShardOf, engNotePublish, engNextPublish, engPushKey, engineSocket, engEmptyLive, engAsAdded, engRun };\n";
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

test("a bus after midnight: the timetable keeps it on the day before, the feed gives the calendar date", () => {
  // The run is on yesterday's timetable at a time past 24:00; the Sydney buses feed says today's date for it.
  const prev = W.engDayKey((base - 43200) * 1000), next = W.engDayKey((base + 86400 + 43200) * 1000);
  const late = { "N-1": [[sec(4) + 86400, "N-1", 1, 1, 3]], "N-2": [[sec(9) + 86400, "N-2", 1, 1, 3]] };
  const src = (live) => ({ ...fakeSrc(live), rows: (id, d) => (d === prev && id === "B" ? [...late["N-1"], ...late["N-2"]] : d === day ? [] : null), days: () => ({ [prev]: base - 86400, [day]: base }) });
  const b = W.engBuildBoard(src({
    "N-1": { tripId: "N-1", ts: 1, startDate: day, stus: [{ seq: 3, stopId: "B", dep: { delay: 180 } }] },
    "N-2": { tripId: "N-2", ts: 1, startDate: next, stus: [{ seq: 3, stopId: "B", dep: { delay: 300 } }] },
  }), "P");
  const by = (id) => b.items.find((i) => i.tripId === id);
  assert.equal(by("N-1").realtime, true); assert.equal(by("N-1").delayMin, 3);
  assert.equal(by("N-2").realtime, false, "two days on is another run");
  const same = W.engBuildBoard(src({ "N-1": { tripId: "N-1", ts: 1, startDate: prev, stus: [{ seq: 3, stopId: "B", dep: { delay: 60 } }] } }), "P");
  assert.equal(same.items.find((i) => i.tripId === "N-1").delayMin, 1, "the timetable's own date still counts");
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

test("a delay wins over the update's time (the time can count from the operator's own schedule); a NO_DATA stop stays scheduled", () => {
  const r = { stopId: "B", seq: 7, planned: Date.now() + 300000 };
  // Light rail on 26 Oct: planned 02:00:00, departure delay 307 s with time 02:06:02; the Trip Planner said 02:04:54.
  assert.equal(W.engLive({ stus: [{ seq: 7, stopId: "B", dep: { time: nowS + 400, delay: 9 } }] }, r).est, r.planned + 9000);
  assert.equal(W.engLive({ stus: [{ seq: 7, stopId: "B", dep: { time: nowS + 400 } }] }, r).est, (nowS + 400) * 1000);
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
  // 200 waits on the same fetches cost the bucket the fetches, not the waits.
  assert.ok(st.tokens >= -4, "bucket after a crowd of first reads: " + st.tokens);
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

test("trains run with no passengers (Empty Train) are left off boards", () => {
  const save = rows.P1;
  meta.heads.push("Empty Train");
  rows.P1 = [...save, [sec(7), "T-empty", 0, meta.heads.length - 1, 10]];
  try {
    const b = W.engBuildBoard(fakeSrc(), "P");
    assert.ok(!b.items.some((i) => i.tripId === "T-empty"));
    assert.ok(b.items.some((i) => i.tripId === "T-A"));
  } finally { rows.P1 = save; meta.heads.pop(); }
});

test("a trimmed update keeps the stop, the last update before it and the next after it, so boards come out the same", () => {
  const stus = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => ({ seq: s, stopId: "s" + s, dep: { delay: s * 10 } }));
  const t = W.engTrim({ tripId: "x", rel: 0, stus }, [5]);
  assert.deepEqual(t.stus.map((u) => u.seq), [4, 5, 6]);
  // No update at the stop: the one before carries on, as with the whole update.
  const gap = stus.filter((u) => u.seq !== 5);
  const row = { stopId: "s5", seq: 5, planned: Date.now() };
  assert.equal(W.engLive(W.engTrim({ stus: gap }, [5]), row).est, W.engLive({ stus: gap }, row).est);
  // Updates without stop sequences are kept whole.
  assert.equal(W.engTrim({ stus: [{ stopId: "a" }, { stopId: "b" }] }, [3]).stus.length, 2);
});

test("stops spread over the shards and always land in the same one", () => {
  const n = 16, count = new Array(n).fill(0);
  for (let i = 0; i < 3200; i++) count[W.engShardOf(String(200000 + i * 7), n)]++;
  assert.ok(Math.min(...count) > 120 && Math.max(...count) < 280, "spread: " + count.join(","));
  assert.equal(W.engShardOf("200060", n), W.engShardOf("200060", n));
});

test("a shard builds the same board as the core object, from the core's one copy of each feed", async () => {
  const calls = [];
  const E = await loaded(calls);
  const core = { fetch: (u, init) => E.fetch(new Request(u, init)) };
  const env = { ENGINE: { idFromName: () => "core", get: () => core } };
  const S = new W.BoardShard(fakeState(), env);
  const r = await S.fetch(new Request("https://engine/board?stop=P&name=nsw-2-s3"));
  assert.equal(r.status, 200);
  const b = await r.json();
  const c = await (await E.fetch(new Request("https://engine/board?stop=P"))).json();
  assert.deepEqual(b.items.map((i) => [i.tripId, i.estimated, i.platform]), c.items.map((i) => [i.tripId, i.estimated, i.platform]));
  assert.equal(b.items.find((i) => i.tripId === "B-2").delayMin, 3);
  assert.equal(b.engine.shard, "nsw-2-s3");
  assert.equal((await S.fetch(new Request("https://engine/board?stop=nowhere"))).status, 404);
  // A second shard and a tick: still one copy of each feed in the core.
  const S2 = new W.BoardShard(fakeState(), env);
  await S2.fetch(new Request("https://engine/board?stop=P1"));
  const n0 = calls.length;
  await S.tick(); await S2.tick();
  assert.equal(calls.length, n0, "shards never call Transport for NSW");
  const st = S.status();
  assert.equal(st.role, "shard"); assert.equal(st.boots, 1); assert.equal(st.hotBoards, 2);
});

test("planned times are whole minutes as the Trip Planner gives them, and the live time is that minute plus the delay", () => {
  const save = rows.B;
  rows.B = [[sec(4) + 35, "B-sec", 1, 1, 7]];
  try {
    const b = W.engBuildBoard(fakeSrc({ "B-sec": { stus: [{ seq: 7, stopId: "B", dep: { delay: 60 } }] } }), "B");
    const it = b.items.find((i) => i.tripId === "B-sec");
    const p = Date.parse(it.planned);
    assert.equal(p % 60000, 0);
    assert.equal(Date.parse(it.estimated) - p, 60000);
  } finally { rows.B = save; }
});

test("feed timing: the period is the median gap of the feed's header times, the next copy is asked just after it", () => {
  const f = {};
  for (const t of [1000, 1015, 1015, 1030, 1046, 1060]) W.engNotePublish(f, t);
  assert.equal(f.period, 15000);
  assert.equal(W.engNextPublish(f), (1060 + 15) * 1000 + 2000);
  const g = {};
  W.engNotePublish(g, 1000); W.engNotePublish(g, 1010);
  assert.equal(W.engNextPublish(g), null, "not enough copies to know the rhythm");
});

test("a live row says when its live time was read (liveAt, the feed copy's time); a timetable row has none", () => {
  const save = rows.B;
  rows.B = [[sec(4), "B-at", 1, 1, 7], [sec(6), "B-tt", 1, 1, 7]];
  try {
    const src = fakeSrc({ "B-at": { stus: [{ seq: 7, stopId: "B", dep: { delay: 60 } }] } });
    const b = W.engBuildBoard(src, "B");
    const live = b.items.find((i) => i.tripId === "B-at"), tt = b.items.find((i) => i.tripId === "B-tt");
    assert.ok(Math.abs(live.liveAt - src.feedAt("bus")) < 100);
    assert.equal(tt.liveAt, null);
  } finally { rows.B = save; }
});

test("push: a phone's socket gets the whole board, then only the rows that changed; the board stays hot while it is open", async () => {
  const E = await loaded([]);
  const core = { fetch: (u, init) => E.fetch(new Request(u, init)) };
  const env = { ENGINE: { idFromName: () => "core", get: () => core } };
  const st = fakeState();
  const socks = [];
  st.acceptWebSocket = (ws, tags) => { ws.tags = tags; socks.push(ws); };
  st.getWebSockets = (tag) => socks.filter((w) => !tag || w.tags.includes(tag));
  st.getTags = (ws) => ws.tags;
  const mkSock = () => ({ sent: [], send(t) { this.sent.push(t); }, close() {} });
  const RealResponse = globalThis.Response, RealPair = globalThis.WebSocketPair;
  // Node's Response refuses status 101; the Workers runtime takes it with the client end of the pair.
  globalThis.Response = class extends RealResponse { constructor(b, i = {}) { super(b, i.status === 101 ? { ...i, status: 200 } : i); this.ws = i.webSocket; this.s101 = i.status === 101; } get status() { return this.s101 ? 101 : super.status; } };
  globalThis.WebSocketPair = function () { return { 0: mkSock(), 1: mkSock() }; };
  try {
    const S = new W.BoardShard(st, env);
    assert.equal((await S.fetch(new Request("https://engine/ws?stop=P&name=nsw-2-b1"))).status, 426);
    const r = await S.fetch(new Request("https://engine/ws?stop=P&name=nsw-2-b1", { headers: { upgrade: "websocket" } }));
    assert.equal(r.status, 101);
    const server = socks[0];
    const first = JSON.parse(server.sent[0]);
    assert.equal(first.type, "board");
    assert.ok(first.board.items.length >= 4);
    // The same board again: nothing sent. One row later: a diff with that row only.
    const body = JSON.stringify(first.board);
    S.pushBoard("P|", body);
    assert.equal(server.sent.length, 1);
    const b2 = JSON.parse(body);
    b2.engine.builtAt += 5000;
    b2.items[0] = { ...b2.items[0], estimated: new Date(Date.parse(b2.items[0].planned) + 120000).toISOString(), realtime: true };
    S.pushBoard("P|", JSON.stringify(b2));
    const d = JSON.parse(server.sent[1]);
    assert.equal(d.type, "diff");
    assert.equal(d.base, first.board.engine.builtAt);
    assert.deepEqual(Object.keys(d.rows), [W.engPushKey(b2.items[0])]);
    assert.equal(d.order, undefined);
    // A phone asking for the whole board gets it.
    await S.webSocketMessage(server, "full");
    assert.equal(JSON.parse(server.sent[2]).type, "board");
    await S.webSocketMessage(server, "ping");
    assert.equal(server.sent[3], "pong");
    // Open sockets keep the board hot through a tick, even with no reads for longer than the hot window.
    S.hot.set("P|", Date.now() - 3600000);
    await S.tick();
    assert.ok(Date.now() - S.hot.get("P|") < 5000);
  } finally { globalThis.Response = RealResponse; globalThis.WebSocketPair = RealPair; }
});

test("push: /api/live is 404 unless ENGINE_PUSH is on, and needs a WebSocket upgrade and a stop id", async () => {
  const u = (q) => new URL("https://api.transportsydney.app/api/live?" + q);
  assert.equal((await W.engineSocket(new Request(u("stop=200060")), {}, u("stop=200060"))).status, 404);
  const env = { ENGINE_PUSH: "on", SHARDS: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response("ok") }) } };
  assert.equal((await W.engineSocket(new Request(u("stop=200060")), env, u("stop=200060"))).status, 426);
  const up = { headers: { upgrade: "websocket" } };
  assert.equal((await W.engineSocket(new Request(u("stop=a%20b"), up), env, u("stop=a%20b"))).status, 400);
  assert.equal((await W.engineSocket(new Request(u("stop=200060"), up), env, u("stop=200060"))).status, 200);
});

// ---- g14, 27 Oct night match: Empty Train runs with live times, and trains the timetable does not have ----
test("an Empty Train run the train feed gives a live time here is listed (to the update's last stop); without one, cancelled, or with ENGINE_EMPTY_LIVE off it is not", () => {
  const save = rows.P1;
  meta.heads.push("Empty Train");
  rows.P1 = [...save, [sec(20), "T-E", 0, meta.heads.length - 1, 10]];
  tripSeq["T-E"] = new Map([["P1", 10], ["Z", 20]]);
  try {
    const liveE = { "T-E": { tripId: "T-E", rel: 0, stus: [{ stopId: "P1", dep: { delay: 120, time: nowS + 1320 } }, { stopId: "Z", arr: { delay: 120, time: nowS + 1800 } }] } };
    const b = W.engBuildBoard(fakeSrc(liveE), "P");
    const e = b.items.find((i) => i.tripId === "T-E");
    assert.ok(e, "listed"); assert.equal(e.realtime, true); assert.equal(e.delayMin, 2); assert.equal(e.dest, "Endtown Station"); assert.equal(e.line, "T1");
    assert.ok(!W.engBuildBoard(fakeSrc(liveE), "P", { emptyLive: false }).items.some((i) => i.tripId === "T-E"), "off by the var");
    assert.ok(!W.engBuildBoard(fakeSrc(), "P").items.some((i) => i.tripId === "T-E"), "no update: off");
    const cancelled = { "T-E": { ...liveE["T-E"], rel: 3 } };
    assert.ok(!W.engBuildBoard(fakeSrc(cancelled), "P").items.some((i) => i.tripId === "T-E"), "cancelled: off");
    const noData = { "T-E": { tripId: "T-E", rel: 0, stus: [{ stopId: "P1", rel: 2 }] } };
    assert.ok(!W.engBuildBoard(fakeSrc(noData), "P").items.some((i) => i.tripId === "T-E"), "no live time: off");
    assert.equal(W.engEmptyLive({ ENGINE_EMPTY_LIVE: "off" }), false); assert.equal(W.engEmptyLive({}), true);
  } finally { rows.P1 = save; meta.heads.pop(); delete tripSeq["T-E"]; }
});

test("a train the timetable does not have (listed by the core as unk): whole minute planned time plus the delay, its platform, only on train boards, and an older trip id of the same run with no live data dropped", () => {
  const save = rows.P1;
  rows.P1 = [...save, [sec(30), "77X.1324.165.4.A.8.1", 0, 0, 10]];
  try {
    const t = (nowS + 30 * 60 + 25) * 1000; // 25 s past a minute
    const unk = W.engAsAdded({ tripId: "77X.1324.165.8.A.8.2", routeId: "NSN_1a", rel: 0, stus: [
      { stopId: "Far", dep: { time: nowS - 3 * 3600, delay: 60 } }, { stopId: "P2", dep: { time: t / 1000 + 60, delay: 60 } }, { stopId: "Z", arr: { time: t / 1000 + 900, delay: 60 } }] }, Date.now(), fakeSrc());
    assert.deepEqual(unk.stus.map((u) => [u.stopId, u.seq]), [["P2", 2], ["Z", 3]], "stops long gone are not kept; the sequence is the update's order");
    assert.equal(unk.destName, "Endtown Station");
    const b = W.engBuildBoard(fakeSrc({}, { train: [unk] }), "P");
    const a = b.items.find((i) => i.tripId === "77X.1324.165.8.A.8.2");
    assert.ok(a); assert.equal(a.line, "T1"); assert.equal(a.platform, "Platform 2"); assert.equal(a.dest, "Endtown Station");
    assert.equal(Date.parse(a.planned) % 60000, 0);
    assert.equal(Date.parse(a.estimated) - Date.parse(a.planned), 60000);
    assert.equal(a.planned, new Date(t - (t % 60000)).toISOString());
    assert.ok(!b.items.some((i) => i.tripId === "77X.1324.165.4.A.8.1"), "the old trip id of run 77X is dropped");
    assert.ok(b.items.some((i) => i.tripId === "T-A"), "other trains stay");
    assert.ok(!W.engBuildBoard(fakeSrc({}, { train: [unk] }), "P", { mode: "bus" }).items.some((i) => i.mode === "train"), "a bus board has no trains");
    assert.equal(W.engRun("158T.1324.165.4.A.8.92001745"), "158T"); assert.equal(W.engRun("2554197"), "");
  } finally { rows.P1 = save; }
});

test("the core lists a train feed trip the timetable lacks once per copy, through shards too; a copy that is mostly unknown lists none; ENGINE_ADD_UNKNOWN off lists none", async () => {
  const mk = (env, trips) => {
    globalThis.fetch = async (u) => new Response(feed(/vehiclepos/.test(String(u)) ? [] : trips));
    return env;
  };
  const known = [{ tripId: "T-A", rel: 0, stus: [{ stopId: "P1", dep: { delay: 60 } }] }, { tripId: "T-B", rel: 0, stus: [{ stopId: "P1", dep: { delay: 0 } }] }];
  const fresh = { tripId: "NEW-1", routeId: "NSN_1a", rel: 0, stus: [{ stopId: "P2", dep: { time: nowS + 900, delay: 120 } }, { stopId: "Z", arr: { time: nowS + 1500, delay: 120 } }] };
  const gone = { tripId: "NEW-X", routeId: "NSN_1a", rel: 3, stus: [{ stopId: "P2", dep: { time: nowS + 600 } }] };
  const E = await loaded([]);
  mk({}, [...known, fresh, gone]);
  const b = await (await E.fetch(new Request("https://engine/board?stop=P"))).json();
  const a = b.items.find((i) => i.tripId === "NEW-1");
  assert.ok(a, "listed"); assert.equal(a.delayMin, 2); assert.equal(a.platform, "Platform 2"); assert.equal(a.dest, "Endtown Station");
  assert.ok(!b.items.some((i) => i.tripId === "NEW-X"), "a cancelled unknown trip is not listed");
  const st = E.status().feeds.train;
  assert.equal(st.unknown, 1); assert.equal(st.unknownListed, 1);
  // Through a shard: the same row from the core's copy.
  const core = { fetch: (u, init) => E.fetch(new Request(u, init)) };
  const S = new W.BoardShard(fakeState(), { ENGINE: { idFromName: () => "core", get: () => core } });
  const sb = await (await S.fetch(new Request("https://engine/board?stop=P&name=nsw-2-s1"))).json();
  const sa = sb.items.find((i) => i.tripId === "NEW-1");
  assert.ok(sa); assert.equal(sa.estimated, a.estimated); assert.equal(sa.dest, "Endtown Station");
  // A copy where most trips are unknown (another timetable version): none listed.
  const E2 = await loaded([]);
  mk({}, Array.from({ length: 12 }, (_, i) => ({ ...fresh, tripId: "V2-" + i })));
  const b2 = await (await E2.fetch(new Request("https://engine/board?stop=P"))).json();
  assert.ok(!b2.items.some((i) => /^V2-/.test(i.tripId)));
  assert.equal(E2.status().feeds.train.unknownListed, 0);
  // Switched off.
  const E3 = await loaded([]);
  E3.env.ENGINE_ADD_UNKNOWN = "off";
  mk({}, [...known, fresh]);
  const b3 = await (await E3.fetch(new Request("https://engine/board?stop=P"))).json();
  assert.ok(!b3.items.some((i) => i.tripId === "NEW-1"));
});
