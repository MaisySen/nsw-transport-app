// Live correctness, night of 1 Nov 2026 (shadow trips through the deployed server, 31 Oct 11:40 PM onwards): the real
// Sydney Trains feed gives a delay with no clock time at each stop and names the train's place ("Lidcombe.Lidcombe 3
// Loc"), not a stop id. Captured from /api/service at 11:12 PM on 31 Oct (the T1 due 11:17 PM at Strathfield, train
// at Lidcombe 3.5 min late): the departure board said 11:29:06, the stop's own delay 11:20:30. Failing first on
// server-tripflow cc2d9c0: the card counted to the board's 11:29:06 (no stop time) and the server never saw the train
// move (no vehicle on the trip), and /api/service found no stop off for a stop id of another platform or the station.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { loadWorker, setClock, stopFake } from "../tools/simtrip.mjs";

after(() => stopFake());
const T = (hms) => Date.parse(`2026-10-31T${hms}.000Z`);
// The 11:17 PM T1 from the 31 Oct capture (stops and coordinates as /api/service gave them).
const STOPS = {
  "2141313": ["Lidcombe Station", -33.864898, 151.047134], "214063": ["Flemington Station", -33.866112, 151.071533],
  "214074": ["Homebush Station", -33.866573, 151.086411], "2135237": ["Strathfield Station", -33.871651, 151.093826],
  "213495": ["Burwood Station", -33.87727, 151.104202], "213284": ["Croydon Station", -33.883232, 151.115372],
  "2131123": ["Ashfield Station", -33.887868, 151.125893], "213210": ["Croydon Station", -33.883, 151.1152],
};
const info = Object.fromEntries(Object.entries(STOPS).map(([id, v]) => [id, { name: v[0], lat: v[1], lon: v[2] }]));
const d = (s) => ({ delay: s });
const tu = { ts: T("12:12:40") / 1000, stus: [
  { stopId: "2141313", arr: d(240), dep: d(240) }, { stopId: "214063", arr: d(240), dep: d(240) }, { stopId: "214074", arr: d(240), dep: d(240) },
  { stopId: "2135237", arr: d(210), dep: d(210) }, { stopId: "213495", arr: d(210), dep: d(210) }, { stopId: "213284", arr: d(210), dep: d(210) },
  { stopId: "2131123", arr: d(210), dep: d(210) },
] };
const leg = { mode: "train", line: "T1", tripId: "802U.1417.150.128.A.8.91992562", stopId: "2135237", toStopId: "213284", from: "Strathfield Station", to: "Croydon Station",
  planned: "2026-10-31T12:17:00.000Z", arrPlanned: "2026-10-31T12:22:30.000Z", fromPlatform: "Platform 7" };
const veh = (stopName, ts, ageS = 20) => ({ lat: STOPS[stopName][1], lon: STOPS[stopName][2], ts, ageS, stopId: "Lidcombe.Lidcombe 3 Loc", status: null });

test("31 Oct T1: a stop's delay with no clock time is that stop's live time; it beats the board's 8 min later time", async () => {
  const W = await loadWorker();
  const now = T("12:12:55");
  setClock(now);
  const r = W.tfLegRaw(leg, tu, { lat: -33.864204, lon: 151.046295, ts: T("12:12:00"), ageS: 56, stopId: "Lidcombe.Lidcombe 3 Loc", status: null }, info, T("12:12:40"));
  assert.equal(r.unmatched, false);
  assert.equal(r.est[0], T("12:20:30"), "Strathfield: 11:17 planned + 210 s");
  assert.equal(r.est[1], T("12:26:00"), "Croydon: arrival 11:22:30 planned + 210 s");
  assert.deepEqual(r.vehicle && { stop: r.vehicle.stop, state: r.vehicle.state }, { stop: -1, state: "left" }, "the train is at Lidcombe, before your stop: not left");
  r.board = T("12:29:06"); // the departure board's time
  const pl = W.tfPlanLeg(leg, r, { li: 0 });
  const L = W.tfLegReading(pl, r, null);
  const plan = { legs: [pl] };
  const M = W.LIVECARD.newTripMemory(plan);
  const tm = W.LIVECARD.tripLegTimes(plan, M, { asOf: T("12:12:40"), legs: [L] }, 0, now);
  assert.equal(tm.dep.at, T("12:20:30"), "the card counts to 11:20:30, not the board's 11:29:06");
  assert.equal(tm.dep.source, "stop");
  assert.equal(tm.arr.at, T("12:26:00"));
  assert.ok(tm.arr.at > tm.dep.at, "arrival after departure");
});

test("31 Oct T1: the train's position (a place name, not a stop id) places it on the trip: left, at your stop, past it", async () => {
  const W = await loadWorker();
  const at = (name, ts) => { const r = W.tfLegRaw(leg, tu, veh(name, ts), info, ts); return r.vehicle && [r.vehicle.stop, r.vehicle.state]; };
  setClock(T("12:21:00"));
  assert.deepEqual(at("2135237", T("12:20:40")), [0, "at"], "at Strathfield");
  assert.deepEqual(at("213495", T("12:23:40")), [0, "left"], "at Burwood: left Strathfield");
  assert.deepEqual(at("213284", T("12:26:05")), [1, "at"], "at Croydon: arrived on live evidence");
  assert.deepEqual(at("2131123", T("12:28:10")), [1, "left"], "at Ashfield: past your stop");
  // half way between Burwood and Croydon: on its way to Croydon
  const mid = { lat: (STOPS["213495"][1] + STOPS["213284"][1]) / 2, lon: (STOPS["213495"][2] + STOPS["213284"][2]) / 2, ts: T("12:25:00"), ageS: 10, stopId: "Burwood.X Loc", status: null };
  const rm = W.tfLegRaw(leg, tu, mid, info, T("12:25:00"));
  assert.deepEqual([rm.vehicle.stop, rm.vehicle.state], [0, "left"]);
  // a position older than 3 min is not used
  const old = W.tfLegRaw(leg, tu, { ...veh("213284", T("12:20:00")), ageS: 400 }, info, T("12:26:40"));
  assert.equal(old.vehicle, null);
  // the stop off registered by the station's id (213210, not the platform 213284) matches by name
  const st = W.tfLegRaw({ ...leg, toStopId: "213210" }, tu, veh("213284", T("12:26:05")), info, T("12:26:05"));
  assert.equal(st.est[1], T("12:26:00"));
  assert.deepEqual([st.vehicle.stop, st.vehicle.state], [1, "at"]);
});

test("/api/service: the stop off is found by the station's id (Croydon 213210) or another platform's id, by its name", async () => {
  const W = await loadWorker();
  // the 31 Oct run's stops from Lidcombe to Ashfield (Croydon listed as its platform 213284)
  const stops = ["2141313", "214063", "214074", "2135237", "213495", "213284", "2131123"].map((id) => ({ id, name: STOPS[id][0] }));
  const mine = 3;
  assert.equal(W.svcOffIndex(stops, "213284", mine, null), 5, "the platform id as listed");
  assert.equal(W.svcOffIndex(stops, "213210", mine, null), -1, "the station id alone: not listed");
  assert.equal(W.svcOffIndex(stops, "213210", mine, "Croydon Station"), 5, "the station id with its name: Croydon");
  assert.equal(W.svcOffIndex(stops, "2132849", mine, "Croydon Station, Platform 9"), 5, "another platform's id with its name");
  assert.equal(W.svcOffIndex(stops, "2141310", mine, "Lidcombe Station"), -1, "a station before your stop is never your stop off");
  assert.equal(W.svcOffIndex(stops, "999999", mine, "Nowhere Station"), -1);
  assert.equal(W.svcOffIndex(stops, null, mine, "Croydon Station"), -1);
  // a loop lists a station twice: the visit after your stop
  const loop = stops.concat([{ id: "2135237", name: "Strathfield Station" }]);
  assert.equal(W.svcOffIndex(loop, "2135237", 0, null), 3);
  assert.equal(W.svcOffIndex(loop, "2135237", 4, null), 7);
});

test("31 Oct 11:51 PM shadow trip: after the train leaves your stop the feed drops it; the position still says left, then at your stop", async () => {
  const W = await loadWorker();
  // T1 820R planned 11:45 PM Strathfield, Croydon arrival 11:50 PM; the feed after it left lists Burwood on only
  const legA = { ...leg, tripId: "820R.1417.150.128.A.8.91992563", planned: "2026-10-31T12:45:00.000Z", arrPlanned: "2026-10-31T12:50:00.000Z" };
  const after = { ts: T("12:51:30") / 1000, stus: [{ stopId: "213495", arr: d(352), dep: d(352) }, { stopId: "213284", arr: d(347), dep: d(347) }, { stopId: "2131123", arr: d(347), dep: d(347) }] };
  setClock(T("12:52:00"));
  const midSB = { lat: (STOPS["2135237"][1] + STOPS["213495"][1]) / 2, lon: (STOPS["2135237"][2] + STOPS["213495"][2]) / 2, ts: T("12:51:17"), ageS: 40, stopId: "Strathfield.X Loc", status: null };
  const r1 = W.tfLegRaw(legA, after, midSB, info, T("12:51:30"));
  assert.equal(r1.est[1], T("12:55:47"), "Croydon 11:50 + 347 s");
  assert.deepEqual([r1.vehicle.stop, r1.vehicle.state], [0, "left"], "between Strathfield and Burwood: left your stop");
  const r2 = W.tfLegRaw(legA, after, veh("213284", T("12:55:50")), info, T("12:55:55"));
  assert.deepEqual([r2.vehicle.stop, r2.vehicle.state], [1, "at"], "at Croydon");
  // long before the live departure a feed without your stop says nothing about the train against it
  const early = W.tfLegRaw(legA, after, veh("214074", T("12:30:00")), info, T("12:30:10"));
  assert.equal(early.vehicle, null);
});

test("1 Nov 12:04 AM shadow trip: a train still short of your stop (the feed lists your stop first) is not read as left", async () => {
  const W = await loadWorker();
  const legC = { ...leg, tripId: "808T.1417.150.128.A.8.91992567", planned: "2026-10-31T13:00:30.000Z", arrPlanned: "2026-10-31T13:05:00.000Z" };
  const fromS = { ts: T("13:04:30") / 1000, stus: [{ stopId: "2135237", arr: d(341), dep: d(341) }, { stopId: "213495", arr: d(341), dep: d(341) }, { stopId: "213284", arr: d(341), dep: d(341) }] };
  setClock(T("13:04:47"));
  // between Homebush and Strathfield, about 700 m short of Strathfield
  const approach = { lat: (STOPS["214074"][1] + STOPS["2135237"][1]) / 2, lon: (STOPS["214074"][2] + STOPS["2135237"][2]) / 2, ts: T("13:03:43"), ageS: 60, stopId: "Homebush.X Loc", status: null };
  const r = W.tfLegRaw(legC, fromS, approach, info, T("13:04:30"));
  assert.deepEqual([r.vehicle.stop, r.vehicle.state], [-1, "left"], "on its way to your stop, not left");
  const atS = W.tfLegRaw(legC, fromS, veh("2135237", T("13:05:08")), info, T("13:05:20"));
  assert.deepEqual([atS.vehicle.stop, atS.vehicle.state], [0, "at"]);
});

test("1 Nov 12:21 AM shadow trip: on the last stretch the train's position gives the arrival when the feed's is later (owner's rule 3)", async () => {
  const W = await loadWorker();
  const legF = { ...leg, tripId: "852T.1417.150.128.A.8.91992569", planned: "2026-10-31T13:17:00.000Z", arrPlanned: "2026-10-31T13:22:00.000Z" };
  // after Strathfield the feed lists Burwood on; its arrival at Croydon said 12:22:22 while the train reached it 12:21:34
  const fd = { ts: T("13:21:00") / 1000, stus: [{ stopId: "213495", arr: d(22), dep: d(22) }, { stopId: "213284", arr: d(22), dep: d(22) }, { stopId: "2131123", arr: d(22), dep: d(22) }] };
  setClock(T("13:21:19"));
  // the position report 406 m short of Croydon, between Burwood and Croydon
  const k = 406 / 1248; // Burwood is 1248 m from Croydon along the line
  const p = { lat: STOPS["213284"][1] + (STOPS["213495"][1] - STOPS["213284"][1]) * k, lon: STOPS["213284"][2] + (STOPS["213495"][2] - STOPS["213284"][2]) * k, ts: T("13:20:34"), ageS: 30, stopId: "Croydon.X Loc", status: null };
  const r = W.tfLegRaw(legF, fd, p, info, T("13:21:00"));
  assert.deepEqual([r.vehicle.stop, r.vehicle.state], [0, "left"]);
  assert.equal(r.etaBy, "vehicle");
  assert.ok(Math.abs(r.est[1] - T("13:21:35")) < 6000, `arrival from the position about 12:21:35, got ${new Date(r.est[1]).toISOString()}`);
  // Get off now from it: arrival minus 30 s, before the train is at the platform (12:21:34)
  const pl = W.tfPlanLeg(legF, r, { li: 0 });
  const L = W.tfLegReading(pl, r, null);
  const plan = { legs: [pl] };
  const tm = W.LIVECARD.tripLegTimes(plan, W.LIVECARD.newTripMemory(plan), { asOf: T("13:21:00"), legs: [L] }, 0, T("13:21:19"));
  assert.ok(tm.arr.at - 30000 < T("13:21:34") - 20000, "Get off now lands 20 s or more before the platform report");
  // the feed's earlier arrival is kept; a position far out or stale changes nothing
  const early = W.tfLegRaw(legF, { ...fd, stus: fd.stus.map((u) => ({ ...u, arr: d(-60), dep: d(-60) })) }, p, info, T("13:21:00"));
  assert.equal(early.est[1], T("13:21:00"), "feed 12:21:00 is earlier than the position's");
  const stale = W.tfLegRaw(legF, fd, { ...p, ageS: 200 }, info, T("13:21:00"));
  assert.equal(stale.est[1], T("13:22:22"));
  const atB = W.tfLegRaw(legF, fd, veh("213495", T("13:19:22")), info, T("13:19:40"));
  assert.equal(atB.est[1], T("13:22:22"), "at Burwood (not on the last stretch yet by position): the feed's arrival");
});
