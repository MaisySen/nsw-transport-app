// Board engine, Sydney Metro (28 Oct): the metro timetable and its trip update feed are different versions (trip ids
// 0273-001-... against 0160-006-...), so the feed's copy is listed as the board (ENGINE_FEED_ONLY) and the other
// version's timetable rows are dropped up to the last live time the copy gives at the stop. Offline fakes only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine, BoardShard \};\s*$/, "\n") +
  "\nexport { __default, engBuildBoard, engLive, engDayKey, engPlatform, BoardEngine, BoardShard, engineWanted, engTrim, engShardOf, engNotePublish, engNextPublish, engPushKey, engineSocket, engEmptyLive, engAsAdded, engRun, engLabels, engPlannerLabels, engVersionOff };\n";
const tmp = `/tmp/engine-metro-test-${process.pid}-${Date.now()}.mjs`;
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

const day = W.engDayKey(Date.now());
const base = Math.floor(new Date(new Date().toLocaleString("en-US", { timeZone: "Australia/Sydney" }).replace(/,.*/, "") + " 00:00").getTime() / 1000);
const nowS = Math.floor(Date.now() / 1000);
const sec = (minFromNow) => nowS + minFromNow * 60 - base;
const meta = { days: { [day]: base }, routes: [["M1", 2, "#168388", "metro", "", "Metro North West & Bankstown Line"], ["T1", 1, "#F99D1C", "train", "", "North Shore"]], heads: ["Sydenham", "Hornsby"], routeIds: { metro: { SMNW_M1: 0 }, train: { NSN_1a: 1 } } };
const stops = {
  M: ["Metroville Station", "", "", 0, 0], M1: ["Metroville Station Platform 1", "M", "1", 0, 0], M2: ["Metroville Station Platform 2", "M", "2", 0, 0],
  T3: ["Metroville Station Platform 3", "M", "3", 0, 0], MZ: ["Sydenham Station Platform 1", "", "1", 0, 0],
};
// Version A of the metro timetable: Sydenham bound at +7, +17 and +60 minutes; one train on platform 3.
const rows = {
  M1: [[sec(7), "0273-001-A1", 0, 0, 5], [sec(17), "0273-001-A2", 0, 0, 5], [sec(60), "0273-001-A3", 0, 0, 5]],
  T3: [[sec(9), "T-A", 1, 1, 10]],
};
// Version B in the feed: the running trains, 7 minutes earlier, one on the other platform.
const at = (min, extraS = 0) => nowS + min * 60 + extraS;
const vB = [
  { tripId: "0160-006-B1", routeId: "SMNW_M1", startDate: day, stus: [{ stopId: "M1", dep: { time: at(0, 20 + 60), delay: 60 } }, { stopId: "MZ", arr: { time: at(30) } }] },
  { tripId: "0160-006-B2", routeId: "SMNW_M1", startDate: day, stus: [{ stopId: "M2", dep: { time: at(10, 20), delay: 0 } }, { stopId: "MZ", arr: { time: at(40) } }] },
  { tripId: "0160-006-B3", routeId: "SMNW_M1", startDate: day, stus: [{ stopId: "M1", dep: { time: at(20, 20), delay: 0 } }, { stopId: "MZ", arr: { time: at(50) } }] },
  { tripId: "0160-006-B4", routeId: "SMNW_M1", startDate: day, rel: 3, stus: [{ stopId: "M1", dep: { time: at(25) } }] },
];
function fakeSrc(live = {}, added = {}) {
  return {
    stop: (id) => stops[id] || null, children: (id) => Object.keys(stops).filter((k) => stops[k][1] === id),
    rows: (id, d) => (d === day ? rows[id] || [] : null), days: () => meta.days, route: (i) => meta.routes[i], head: (i) => meta.heads[i] || "",
    routeOf: (f, r) => (meta.routeIds[f] && r in meta.routeIds[f] ? meta.routeIds[f][r] : -1),
    tripSeq: () => null, tu: (f, t) => live[t] || null, vp: () => null, feedAt: () => Date.now() - 3000, added: (f) => added[f] || [],
  };
}
function fakeState() {
  const db = new DatabaseSync(":memory:");
  let alarm = null;
  return {
    storage: {
      sql: { exec(q, ...args) { if (/^\s*(SELECT)/i.test(q)) { const r = db.prepare(q).all(...args); return { toArray: () => r }; } if (args.length) db.prepare(q).run(...args); else db.exec(q); return { toArray: () => [] }; } },
      getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; },
    },
  };
}
// The core object with the version A timetable; the metro feed answers `metro`, the train feed `train`.
async function loaded(metro, train = [], env = {}) {
  globalThis.fetch = async (u) => {
    const url = String(u);
    if (/vehiclepos/.test(url)) return new Response(feed([]));
    return new Response(feed(/\/metro/.test(url) ? metro : train));
  };
  const E = new W.BoardEngine(fakeState(), { TFNSW_API_KEY: "k", ...env });
  const post = (p, body) => E.fetch(new Request("https://engine" + p, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
  await post("/load/begin", { ...meta, builtAt: "2026-10-28T00:00:00Z" });
  await post("/load/stops", Object.entries(stops).map(([id, s]) => [id, s[0], s[1], s[2], s[3], s[4]]));
  await post("/load/days", Object.entries(rows).map(([s, r]) => JSON.stringify({ s, d: day, r })).join("\n"));
  await post("/load/trips", JSON.stringify({ t: "T-A", s: ["T3", 10] }));
  const c = await (await post("/load/commit", {})).json();
  assert.equal(c.ver, 1);
  return E;
}
const board = async (E, q = "stop=M") => (await E.fetch(new Request("https://engine/board?" + q))).json();
const ids = (b) => b.items.map((i) => i.tripId);

test("engVersionOff: another version when almost none of the sampled trip ids are in the timetable; a matching copy or too few trips is not", () => {
  const tus = (n, pre) => Array.from({ length: n }, (_, i) => ({ tripId: pre + i, stus: [{ stopId: "M1", dep: { time: at(i) } }] }));
  assert.equal(W.engVersionOff(tus(5, "B"), () => false), true);
  assert.equal(W.engVersionOff(tus(5, "A"), () => true), false);
  assert.equal(W.engVersionOff(tus(2, "B"), () => false), false, "fewer than 3 sampled: not decided");
  let calls = 0;
  assert.equal(W.engVersionOff(tus(40, "B"), () => { calls++; return false; }), true);
  assert.equal(calls, 12, "at most 12 lookups a copy");
  assert.equal(W.engVersionOff([...tus(4, "B"), ...tus(1, "A")], (id) => id.startsWith("A")), true, "one in five found (20%) is another version");
  assert.equal(W.engVersionOff([...tus(3, "B"), ...tus(2, "A")], (id) => id.startsWith("A")), false, "two in five found is not");
});

test("a board from a feed marked fo: the feed's trips live on their own platform at the whole planned minute, the other version's rows dropped up to the copy's last time there, rows after it and trains kept", () => {
  const now = Date.now();
  const fo = vB.filter((t) => t.rel !== 3).map((t) => W.engAsAdded(t, now, fakeSrc(), true));
  assert.ok(fo.every((a) => a.fo === 1 && a.unk === 1));
  assert.equal(W.engAsAdded(vB[0], now, fakeSrc()).fo, undefined, "only the feed only path marks fo");
  const b = W.engBuildBoard(fakeSrc({}, { metro: fo }), "M", { now });
  const got = ids(b);
  assert.ok(got.includes("0160-006-B1") && got.includes("0160-006-B2") && got.includes("0160-006-B3"));
  assert.ok(!got.includes("0273-001-A1") && !got.includes("0273-001-A2"), "version A rows inside the span are gone");
  assert.ok(got.includes("0273-001-A3"), "a timetable row after the copy's last time at this stop stays");
  assert.ok(got.includes("T-A"), "trains are untouched");
  const b1 = b.items.find((i) => i.tripId === "0160-006-B1");
  assert.equal(b1.mode, "metro"); assert.equal(b1.line, "M1"); assert.equal(b1.platform, "Platform 1"); assert.equal(b1.realtime, true);
  assert.equal(b1.dest, "Sydenham Station");
  assert.equal(Date.parse(b1.planned) % 60000, 0);
  assert.equal(b1.planned, new Date((at(0, 20) * 1000) - ((at(0, 20) * 1000) % 60000)).toISOString(), "planned is the time less the delay, to the minute");
  assert.equal(Date.parse(b1.estimated) - Date.parse(b1.planned), 60000);
  assert.equal(b.items.find((i) => i.tripId === "0160-006-B2").platform, "Platform 2");
  // A platform's own board: platform 1 shows the feed's platform 1 trains and the timetable row after them.
  const p1 = W.engBuildBoard(fakeSrc({}, { metro: fo }), "M1", { now });
  assert.deepEqual(ids(p1), ["0160-006-B1", "0160-006-B3", "0273-001-A3"]);
  // Without fo (an ordinary unknown trip) the timetable rows stay as before.
  const plain = vB.filter((t) => t.rel !== 3).map((t) => W.engAsAdded(t, now, fakeSrc()));
  const b2 = W.engBuildBoard(fakeSrc({}, { metro: plain }), "M", { now });
  assert.ok(ids(b2).includes("0273-001-A1") && ids(b2).includes("0160-006-B1"));
});

test("the core: a metro copy of another version is listed whole (fo), cancelled trips left off, an unknown route id takes the feed's one route, and shards get the same rows", async () => {
  const other = vB.map((t, i) => (i === 2 ? { ...t, routeId: "0160_M1" } : t));
  const E = await loaded(other);
  const b = await board(E);
  const st = E.status().feeds.metro;
  assert.equal(st.feedOnly, 1); assert.equal(st.unknownListed, 3);
  const got = ids(b);
  assert.ok(got.includes("0160-006-B1") && got.includes("0160-006-B2") && got.includes("0160-006-B3"), got.join(","));
  assert.ok(!got.includes("0160-006-B4"), "a cancelled trip is not listed");
  assert.ok(!got.includes("0273-001-A1") && !got.includes("0273-001-A2"));
  assert.ok(got.includes("0273-001-A3") && got.includes("T-A"));
  const core = { fetch: (u, init) => E.fetch(new Request(u, init)) };
  const S = new W.BoardShard(fakeState(), { ENGINE: { idFromName: () => "core", get: () => core } });
  const sb = await (await S.fetch(new Request("https://engine/board?stop=M&name=nsw-2-s1"))).json();
  assert.deepEqual(ids(sb), got, "the shard's board is the core's");
  assert.equal(sb.items.find((i) => i.tripId === "0160-006-B1").estimated, b.items.find((i) => i.tripId === "0160-006-B1").estimated);
});

test("the core: a metro copy whose trip ids match the timetable is used as before (live delays on the timetable rows, nothing added)", async () => {
  const same = [
    { tripId: "0273-001-A1", startDate: day, stus: [{ stopId: "M1", dep: { delay: 120 } }] },
    { tripId: "0273-001-A2", startDate: day, stus: [{ stopId: "M1", dep: { delay: 0 } }] },
    { tripId: "0273-001-A3", startDate: day, stus: [{ stopId: "M1", dep: { delay: 0 } }] },
  ];
  // Times so the sample can look the trips up at their stop.
  for (const [i, t] of same.entries()) t.stus[0].dep.time = at([7, 17, 60][i]);
  const E = await loaded(same);
  const b = await board(E);
  assert.equal(E.status().feeds.metro.feedOnly, 0);
  assert.equal(E.status().feeds.metro.unknownListed, 0);
  assert.deepEqual(ids(b).filter((t) => t.startsWith("0273")), ["0273-001-A1", "0273-001-A2", "0273-001-A3"]);
  assert.equal(b.items.find((i) => i.tripId === "0273-001-A1").delayMin, 2);
});

test("trains are unchanged: a train copy of another version still lists none and keeps the timetable; ENGINE_FEED_ONLY off leaves metro as before", async () => {
  const trainV2 = Array.from({ length: 12 }, (_, i) => ({ tripId: "V2-" + i, routeId: "NSN_1a", rel: 0, stus: [{ stopId: "T3", dep: { time: at(5 + i), delay: 0 } }] }));
  const E = await loaded([], trainV2);
  const b = await board(E);
  const st = E.status().feeds.train;
  assert.equal(st.feedOnly, 0); assert.equal(st.unknownListed, 0);
  assert.ok(!ids(b).some((t) => t.startsWith("V2-"))); assert.ok(ids(b).includes("T-A"));
  const E2 = await loaded(vB, [], { ENGINE_FEED_ONLY: "off" });
  const b2 = await board(E2);
  assert.equal(E2.status().feeds.metro.feedOnly, 0);
  assert.ok(!ids(b2).some((t) => t.startsWith("0160")));
  assert.ok(ids(b2).includes("0273-001-A1"));
});
