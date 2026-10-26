// Our own trip planner (src/raptor.js, 26 Oct 2026): RAPTOR over the timetable pack, behind OWN_PLANNER (off).
// Checks the search on small hand made networks (direct, changes, walks, stops nobody may board or leave at, arrive
// by, stations and points), against a brute force earliest arrival on random networks, the planner object's load and
// search, and that with OWN_PLANNER on a trip search makes no Trip Planner call.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/ttplan.js", "utf8") + "\n" +
  fs.readFileSync(root + "src/raptor.js", "utf8").replace(/\nexport \{ TripPlanner \};\s*$/, "\n") +
  "\nexport { __default, rpOpen, rpSearch, rpPlan, rpEnds, rpAnswer, rpTimes, TripPlanner, ownPlannerWanted, sydneyParts };\n";
const tmp = `/tmp/raptor-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

// A pack the way tools/build_planner.py writes it. stops: [id, name, parent id, lat, lon, platform];
// trips: { id, route, head, calls: [[stop id, arrive s, depart s, flags (1 no boarding, 2 no getting off)]] };
// walks: [[stop, stop, seconds]] both ways.
function mkPack({ stops, trips, walks = [], routes, heads, dayStart = 1792933200 }) {
  const ids = stops.map((s) => s[0]), idx = new Map(ids.map((s, i) => [s, i]));
  const pats = new Map();
  for (const t of trips) {
    const key = (t.pat || t.route) + "|" + t.calls.map((c) => c[0] + ":" + (c[3] || 0)).join(",");
    if (!pats.has(key)) pats.set(key, []);
    pats.get(key).push(t);
  }
  const A = { patStopOff: [0], patStops: [], patTripOff: [0], patEvOff: [0], tripRoute: [], tripHead: [], tripPat: [], arr: [], dep: [], flags: [] };
  const tripIds = [];
  let p = 0;
  for (const list of pats.values()) {
    list.sort((a, b) => a.calls[0][2] - b.calls[0][2]);
    for (const c of list[0].calls) A.patStops.push(idx.get(c[0]));
    A.patStopOff.push(A.patStops.length);
    for (const t of list) {
      tripIds.push(t.id); A.tripRoute.push(t.route); A.tripHead.push(t.head || 0); A.tripPat.push(p);
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
    parent: Int32Array.from(stops.map((s) => (s[2] ? idx.get(s[2]) : -1))), flags: Uint8Array.from(A.flags),
  };
  for (const k of ["patStopOff", "patStops", "patTripOff", "patEvOff", "tripRoute", "tripHead", "tripPat", "arr", "dep", "stopPatOff", "stopPat", "stopPatIdx", "xferOff", "xferTo", "xferSec"]) arrays[k] = Int32Array.from(A[k]);
  const header = {
    v: 1, day: "20261026", dayStart, builtAt: "test", walk: { mps: 1.2, detour: 1.3, findS: 60, stationMinS: 120, maxM: 400 },
    counts: { stops: ids.length, patterns: p, trips: tripIds.length, events: A.arr.length, footpaths: A.xferTo.length },
    routes: routes || [["T1", 1, "#F99D1C", "", "Sydney Trains"], ["M1", 2, "#168388", "", "Metro"], ["333", 5, "", "", "Bus"]],
    heads: heads || ["City", "Bondi"], arrays: [],
    stopIds: ids.join("\n"), names: stops.map((s) => s[1]).join("\n"), plats: stops.map((s) => s[5] || "").join("\n"), tripIds: tripIds.join("\n"),
  };
  for (const [name, a] of Object.entries(arrays)) header.arrays.push({ name, type: a instanceof Float32Array ? "f32" : a instanceof Uint8Array ? "u8" : "i32", length: a.length });
  return { header, arrays };
}
const H = 3600, M = 60;
// Stations A, X (change), B; platforms A1, X1, X2, B1; a bus stop Y next to X; a stop C only the bus reaches.
const STOPS = [
  ["A", "Alpha Station", "", -33.80, 151.00], ["A1", "Alpha Station Platform 1", "A", -33.80, 151.00, "1"],
  ["X", "Xing Station", "", -33.85, 151.10], ["X1", "Xing Station Platform 1", "X", -33.85, 151.10, "1"], ["X2", "Xing Station Platform 2", "X", -33.85, 151.1003, "2"],
  ["B", "Beta Station", "", -33.90, 151.20], ["B1", "Beta Station Platform 1", "B", -33.90, 151.20, "1"],
  ["Y", "Xing Rd at Main St", "", -33.8505, 151.1010], ["C", "Gamma Beach", "", -33.95, 151.25],
];
function net(extra = []) {
  return mkPack({
    stops: STOPS,
    trips: [
      // T1 A to X every 10 minutes from 8:00, 12 minutes ride.
      ...[0, 10, 20, 30].map((m) => ({ id: "t1-" + m, route: 0, head: 0, calls: [["A1", 8 * H + m * M, 8 * H + m * M], ["X1", 8 * H + (m + 12) * M, 8 * H + (m + 12) * M]] })),
      // M1 X to B at :13, :23, :33, :43 (8 minutes).
      ...[13, 23, 33, 43].map((m) => ({ id: "m1-" + m, route: 1, head: 0, calls: [["X2", 8 * H + m * M, 8 * H + m * M], ["B1", 8 * H + (m + 8) * M, 8 * H + (m + 8) * M]] })),
      // A slow direct T1 A to B at 8:05, 40 minutes.
      { id: "slow", route: 0, head: 0, calls: [["A1", 8 * H + 5 * M, 8 * H + 5 * M], ["X1", 8 * H + 20 * M, 8 * H + 20 * M, 1], ["B1", 8 * H + 45 * M, 8 * H + 45 * M]] },
      // Bus Y to C at 8:30.
      { id: "bus", route: 2, head: 1, calls: [["Y", 8 * H + 30 * M, 8 * H + 30 * M], ["C", 8 * H + 50 * M, 8 * H + 50 * M]] },
      ...extra,
    ],
    walks: [["X1", "X2", 120], ["X2", "Y", 180], ["X1", "Y", 240]],
  });
}
const hm = (s) => String(Math.floor(s / H)).padStart(2, "0") + ":" + String(Math.floor(s / M) % 60).padStart(2, "0");
const sig = (j) => j.legs.filter((l) => l.trip != null).map((l) => l.trip).join(">");

test("direct and one change: the fastest trip for each number of services", () => {
  const pk = W.rpOpen(net());
  const res = W.rpSearch(pk, W.rpEnds(pk, "A"), W.rpEnds(pk, "B"), 8 * H);
  // One service: the slow direct train (arrives 8:45). Two: T1 8:00 to X 8:12, walk 2 min, M1 8:23 (8:13 left 1 minute: too tight with the walk), 8:31.
  assert.equal(res.length, 2);
  assert.equal(hm(res[0].arrive), "08:45");
  assert.equal(res[0].services, 1);
  assert.equal(hm(res[1].arrive), "08:31");
  assert.equal(res[1].services, 2);
  const w = res[1].legs.find((l) => l.walk);
  assert.ok(w && w.sec === 120, "walks between the two platforms");
});

test("a change at the same stop needs the change time", () => {
  const extra = [
    { id: "a", route: 0, calls: [["A1", 9 * H, 9 * H], ["Y", 9 * H + 10 * M, 9 * H + 10 * M]] },
    { id: "b0", route: 2, calls: [["Y", 9 * H + 10 * M, 9 * H + 10 * M], ["C", 9 * H + 20 * M, 9 * H + 20 * M]] },
    { id: "b1", route: 2, calls: [["Y", 9 * H + 11 * M, 9 * H + 11 * M], ["C", 9 * H + 22 * M, 9 * H + 22 * M]] },
  ];
  const pk = W.rpOpen(net(extra));
  const res = W.rpSearch(pk, W.rpEnds(pk, "A"), W.rpEnds(pk, "C"), 9 * H);
  assert.equal(hm(res[res.length - 1].arrive), "09:22");
  const none = W.rpSearch(pk, W.rpEnds(pk, "A"), W.rpEnds(pk, "C"), 9 * H, { change: 0 });
  assert.equal(hm(none[none.length - 1].arrive), "09:20");
});

test("never boards or leaves where the timetable says nobody may", () => {
  const pk = W.rpOpen(net());
  // The slow train passes X without letting anyone on (flag 1): from X at 8:15 the 8:23 metro is the trip.
  const res = W.rpSearch(pk, W.rpEnds(pk, "X"), W.rpEnds(pk, "B"), 8 * H + 15 * M);
  assert.ok(res.every((j) => !sig(j).includes(String(pk.tripId.at(0)).includes("slow") ? 0 : -1)));
  const legs = res[res.length - 1].legs.filter((l) => l.trip != null);
  assert.ok(legs.every((l) => !pk.tripId.at(l.trip).startsWith("slow")), "the slow train does not stop for boarding at X");
  assert.equal(hm(res[res.length - 1].arrive), "08:31");
  // No getting off: the same train with flag 2 at B never reaches B.
  const pk2 = W.rpOpen(mkPack({ stops: STOPS, trips: [{ id: "s", route: 0, calls: [["A1", 8 * H, 8 * H], ["B1", 8 * H + 20 * M, 8 * H + 20 * M, 2]] }] }));
  assert.equal(W.rpSearch(pk2, W.rpEnds(pk2, "A"), W.rpEnds(pk2, "B"), 7 * H).length, 0);
});

test("walks to a stop of another station, and from a point", () => {
  const pk = W.rpOpen(net());
  const res = W.rpSearch(pk, W.rpEnds(pk, "A"), W.rpEnds(pk, "C"), 8 * H);
  const j = res[res.length - 1];
  assert.equal(hm(j.arrive), "08:50");
  assert.deepEqual(j.legs.filter((l) => l.walk).map((l) => pk.stopId.at(l.to)), ["Y"]);
  // From a point about 100 m from Y: walk there, then the bus.
  const from = W.rpEnds(pk, "151.1010:-33.8515:EPSG:4326");
  assert.ok(from.length >= 1 && pk.stopId.at(from[0][0]) === "Y" && from[0][1] > 60 && from[0][1] < 300);
  const p = W.rpPlan(pk, { from: "151.1010:-33.8515:EPSG:4326", to: "C", at: 8 * H + 10 * M });
  assert.equal(p.journeys.length, 1);
  const ans = W.rpAnswer(pk, p)[0];
  assert.equal(ans.legs[0].kind, "walk");
  assert.equal(ans.legs[1].line, "333");
  assert.equal(new Date(ans.arrive).getTime() / 1000 - pk.dayStart, 8 * H + 50 * M);
});

test("a list of trips: later trips, trips nobody would pick dropped, arrive by", () => {
  const pk = W.rpOpen(net());
  const p = W.rpPlan(pk, { from: "A", to: "B", at: 8 * H, count: 4 });
  const times = p.journeys.map((j) => hm(j.t.leave) + "-" + hm(j.t.arrive) + "/" + j.t.services);
  // The slow 8:05 gets off at X (nobody may board there, getting off is fine) for the 8:23 metro: 8:31, which beats
  // the 8:00 T1 (same arrival, leaves earlier), so the 8:00 is dropped. The slow train all the way (8:45) stays: it has
  // no change. Then 8:10 T1 and the 8:33 metro (8:41), 8:20 and the 8:43 (8:51).
  assert.deepEqual(times, ["08:05-08:31/2", "08:05-08:45/1", "08:10-08:41/2", "08:20-08:51/2"]);
  const ab = W.rpPlan(pk, { from: "A", to: "B", at: 8 * H + 45 * M, arriveBy: true, count: 2 });
  assert.ok(ab.journeys.every((j) => j.t.arrive <= 8 * H + 45 * M), "arrive by keeps only trips arriving in time");
  assert.equal(hm(ab.journeys[ab.journeys.length - 1].t.arrive), "08:41", "the latest trip arriving in time comes last");
});

test("answer shape: legs as trip() makes them, names from the station, changes and timetable times", () => {
  const pk = W.rpOpen(net());
  const ans = W.rpAnswer(pk, W.rpPlan(pk, { from: "A", to: "B", at: 8 * H, count: 1 }))[0];
  assert.equal(ans.changes, 1);
  assert.equal(ans.source, "own");
  const tl = ans.legs.filter((l) => l.kind === "transit");
  assert.equal(tl[0].mode, "train");
  assert.match(tl[0].from, /^Alpha/);
  assert.equal(tl[0].tripId, "slow");
  assert.equal(tl[1].mode, "metro");
  assert.equal(tl[1].transfer.minutes, 3);
  assert.equal(tl[1].transfer.walkMin, 2);
  assert.equal(tl[0].realtime, false);
  assert.ok(ans.legs.some((l) => l.kind === "walk"));
  assert.equal(ans.durationMin, 26);
});

// Brute force earliest arrival (all stop events relaxed until nothing changes) on random networks.
function brute(pk, from, to, t, change) {
  // One walk at most between services: walks start from a stop's arrival by service (tauT), as in rpSearch.
  const INF = 0x7fffffff, tau = new Array(pk.S).fill(INF), tauT = new Array(pk.S).fill(INF), how = new Array(pk.S).fill(0);
  const walkFrom = (s, a0) => { for (let e = pk.xferOff[s]; e < pk.xferOff[s + 1]; e++) { const j = pk.xferTo[e], a = a0 + pk.xferSec[e]; if (a < tau[j] || (a === tau[j] && how[j] === 2)) { tau[j] = a; how[j] = 1; } } };
  for (const [s, w] of from) if (t + w < tau[s]) { tau[s] = t + w; how[s] = 1; }
  for (const [s, w] of from) walkFrom(s, t + w);
  let changed = true;
  while (changed) {
    changed = false;
    for (let p = 0; p < pk.P; p++) {
      const so = pk.patStopOff[p], ns = pk.patStopOff[p + 1] - so;
      for (let tr = pk.patTripOff[p]; tr < pk.patTripOff[p + 1]; tr++) {
        const row = pk.patEvOff[p] + (tr - pk.patTripOff[p]) * ns;
        let on = false;
        for (let i = 0; i < ns; i++) {
          const s = pk.patStops[so + i], a = pk.arr[row + i];
          if (on && !(pk.flags[row + i] & 2) && a < tauT[s]) {
            tauT[s] = a; changed = true;
            if (a < tau[s]) { tau[s] = a; how[s] = 2; }
            walkFrom(s, a);
          }
          if (!on && !(pk.flags[row + i] & 1) && tau[s] !== INF && tau[s] + (how[s] === 2 ? change : 0) <= pk.dep[row + i]) on = true;
        }
      }
    }
  }
  let b = INF; for (const [s, w] of to) if (tau[s] !== INF) b = Math.min(b, tau[s] + w);
  return b;
}
test("random networks: RAPTOR's earliest arrival equals a brute force search", () => {
  let seed = 42; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor((seed / 2147483648) * n); };
  let checked = 0, reached = 0;
  for (let g = 0; g < 12; g++) {
    const n = 25 + rnd(20);
    const stops = Array.from({ length: n }, (_, i) => ["s" + i, "Stop " + i, "", -33.8 - i * 0.001, 151 + (i % 7) * 0.001]);
    const trips = [];
    for (let r = 0; r < 14; r++) {
      const len = 2 + rnd(6), seq = [];
      while (seq.length < len) { const s = rnd(n); if (!seq.includes(s)) seq.push(s); }
      const hops = seq.map(() => 60 + rnd(600));
      const first = 6 * H + rnd(2 * H), every = 300 + rnd(1200);
      for (let k = 0; k < 6; k++) {
        let t = first + k * every;
        trips.push({ id: `r${r}-${k}`, pat: "r" + r, route: rnd(3), calls: seq.map((s, i) => { if (i) t += hops[i]; const fl = rnd(20) === 0 ? 1 + rnd(2) : 0; return ["s" + s, t, t + (i && i < seq.length - 1 ? 30 : 0), fl]; }) });
      }
    }
    const walks = [];
    for (let w = 0; w < n / 2; w++) { const a = rnd(n), b = rnd(n); if (a !== b) walks.push(["s" + a, "s" + b, 60 + rnd(400)]); }
    const pk = W.rpOpen(mkPack({ stops, trips, walks }));
    for (let q = 0; q < 25; q++) {
      const a = rnd(n), b = rnd(n); if (a === b) continue;
      const t = 6 * H + rnd(3 * H);
      for (const change of [0, 60]) {
        const res = W.rpSearch(pk, [[a, 0]], [[b, 0]], t, { rounds: 8, change });
        const got = res.length ? Math.min(...res.map((x) => x.arrive)) : 0x7fffffff;
        const want = brute(pk, [[a, 0]], [[b, 0]], t, change);
        assert.equal(got, want, `network ${g} ${a} to ${b} at ${hm(t)} change ${change}`);
        checked++; if (want !== 0x7fffffff) reached++;
        // Every trip read back is real: times only go forward and each service leg runs on its trip.
        for (const j of res) { let c = t; for (const l of j.legs) { if (l.trip != null) { assert.ok(l.dep >= c, "boards after reaching the stop"); c = l.arr; } else c += l.sec || 0; } }
      }
    }
  }
  assert.ok(checked > 400 && reached > 100, `checked ${checked}, reached ${reached}`);
});

// ---- the planner object and the worker ----
function fakeState() {
  const db = new DatabaseSync(":memory:");
  return { storage: { sql: { exec: (q, ...a) => { const st = db.prepare(q); if (/^\s*(SELECT)/i.test(q)) { const rows = st.all(...a.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x))); return { toArray: () => rows.map((r) => ({ ...r, ...(r.data ? { data: r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength) } : {}) })) }; } st.run(...a.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x))); return { toArray: () => [] }; } } } };
}
async function loadInto(obj, pack) {
  const post = (path, body) => obj.fetch(new Request("https://planner" + path, { method: "POST", body }));
  const ver = 7;
  await post(`/load/begin?ver=${ver}`, "");
  const enc = new TextEncoder().encode(JSON.stringify(pack.header));
  await post(`/load/part?ver=${ver}&part=head&i=0`, enc);
  for (const a of pack.header.arrays) { const t = pack.arrays[a.name]; await post(`/load/part?ver=${ver}&part=${a.name}&i=0`, new Uint8Array(t.buffer, t.byteOffset, t.byteLength).slice()); }
  return (await post(`/load/commit?ver=${ver}`, "")).json();
}
test("the planner object loads a pack in parts, commits it and plans from it", async () => {
  const obj = new W.TripPlanner(fakeState(), {});
  const c = await loadInto(obj, net());
  assert.equal(c.ok, true);
  assert.equal(c.day, "20261026");
  const r = await obj.fetch(new Request("https://planner/plan?from=A&to=B&day=20261026&time=0800&count=2"));
  const d = await r.json();
  assert.equal(d.journeys.length, 2);
  assert.equal(d.journeys[0].legs.find((l) => l.kind === "transit").tripId, "slow");
  // Another day is not this pack's: no journeys, so the worker asks the Trip Planner.
  const other = await (await obj.fetch(new Request("https://planner/plan?from=A&to=B&day=20261028&time=0800"))).json();
  assert.equal(other.journeys.length, 0);
  assert.equal(other.error, "day");
  // A broken pack (an array short) is refused and the old one stays.
  const bad = net(); bad.arrays.dep = bad.arrays.dep.slice(1);
  const post = (path, body) => obj.fetch(new Request("https://planner" + path, { method: "POST", body }));
  await post("/load/begin?ver=8", "");
  await post("/load/part?ver=8&part=head&i=0", new TextEncoder().encode(JSON.stringify(bad.header)));
  for (const a of bad.header.arrays) { const t = bad.arrays[a.name]; await post(`/load/part?ver=8&part=${a.name}&i=0`, new Uint8Array(t.buffer, t.byteOffset, t.byteLength).slice()); }
  const br = await post("/load/commit?ver=8", "");
  assert.equal(br.status, 400);
  const st = await (await obj.fetch(new Request("https://planner/status?open=1"))).json();
  assert.equal(st.ver, 7);
});

test("OWN_PLANNER: off by default; on, a trip search makes no Trip Planner call", async () => {
  assert.equal(W.ownPlannerWanted({ PLANNER: {} }, {}), false);
  assert.equal(W.ownPlannerWanted({ PLANNER: {}, OWN_PLANNER: "on" }, {}), true);
  assert.equal(W.ownPlannerWanted({ PLANNER: {}, OWN_PLANNER: "on" }, { accessible: true }), false);
  assert.equal(W.ownPlannerWanted({ OWN_PLANNER: "on" }, {}), false);
  const obj = new W.TripPlanner(fakeState(), {});
  // A pack for today, with trips around now.
  const s = W.sydneyParts();
  const now = Number(s.time.slice(0, 2)) * H + Number(s.time.slice(2)) * M;
  const base = Math.floor(Date.now() / 1000) - now - (Math.floor(Date.now() / 1000) % 60);
  const pack = mkPack({ stops: STOPS, dayStart: base, trips: [0, 15, 30].map((m) => ({ id: "t" + m, route: 0, calls: [["A1", now + m * M + 120, now + m * M + 120], ["B1", now + m * M + 1500, now + m * M + 1500]] })) });
  pack.header.day = s.date;
  await loadInto(obj, pack);
  let tpCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { if (/\/tp\//.test(String(u.url || u))) tpCalls++; return new Response("{}", { status: 503 }); };
  const edge = new Map();
  globalThis.caches = { default: { match: async (q) => (edge.has(String(q.url || q)) ? new Response(edge.get(String(q.url || q))) : undefined), put: async (q, r) => { edge.set(String(q.url || q), await r.text()); }, delete: async () => true } };
  const planner = { idFromName: (n) => n, get: () => ({ fetch: (u, init) => obj.fetch(new Request(u, init)) }) };
  const env = { PLANNER: planner, OWN_PLANNER: "on", API_ONLY: "1" };
  try {
    const res = await W.__default.fetch(new Request("https://api.transportsydney.app/api/trip?from=A&to=B"), env, { waitUntil: () => {} });
    const d = await res.json();
    assert.equal(res.status, 200, JSON.stringify(d).slice(0, 300));
    assert.ok(d.journeys.length >= 1, "journeys from our own planner");
    assert.equal(d.journeys[0].legs.find((l) => l.kind === "transit").tripId, "t0");
    assert.equal(tpCalls, 0, "no Trip Planner call");
    // Off: the same search is the Trip Planner's (refused here), never our planner's.
    const off = await W.__default.fetch(new Request("https://api.transportsydney.app/api/trip?from=A&to=B&refresh=1"), { ...env, OWN_PLANNER: "off" }, { waitUntil: () => {} });
    const od = await off.json();
    assert.ok(!(od.journeys || []).some((j) => j.legs.some((l) => l.source === "own")), "flag off never answers from our planner");
  } finally { globalThis.fetch = realFetch; }
});
