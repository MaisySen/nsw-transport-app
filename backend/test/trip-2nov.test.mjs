// 2 Nov 2026, Bidur's first real trip on build 214 (files/day-2nov/trip-0452-diagnosis.md). The 4:26 T9 ran as one
// trip id to the big change station and carried on under another (the run split); the feed dropped the boarding stop once
// the train had left and the first trip id's update ended before the stop off. Generic stops (no real stations).
//  (a) /api/service gives the open app the run's vehicle when the asked trip id has none (B1: the phone never saw the
//      train reach the stop off and, woken after the change, warned about a change already made);
//  (b) the trip flow places the train on the trip when the first trip id ends before the stop off (B6b: the Lock Screen
//      card sat on Due for 6 min 42 s while he rode);
//  (c) Get off now's words carry no clock time (B4, Bidur OK 9:19 AM), so they never clash with the heads-up's time.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadWorker, setClock, stopFake } from "../tools/simtrip.mjs";

after(() => stopFake());
const T = (hms) => Date.parse(`2026-11-02T${hms}+11:00`);
const STOPS = {
  A0P4: ["Aston Station, Platform 4", -33.8000, 151.0000],
  M1: ["Marton Station", -33.8000, 151.0200],
  C2: ["Centra Station", -33.8000, 151.0400],
  H3: ["Hubton Station", -33.8000, 151.0600],
  K4: ["Kelso Station", -33.8000, 151.0800],
};
const info = Object.fromEntries(Object.entries(STOPS).map(([id, v]) => [id, { name: v[0], lat: v[1], lon: v[2] }]));
const d = (s) => ({ delay: s });
const leg = { mode: "train", line: "L9", tripId: "142A.SIM", stopId: "A0P4", toStopId: "H3", from: "Aston Station", to: "Hubton Station",
  planned: new Date(T("04:26:00")).toISOString(), arrPlanned: new Date(T("04:42:36")).toISOString(), fromPlatform: "Platform 4" };
// the first trip id after the train left Aston: Aston dropped, the update ends at the change station (no stop off)
const firstTrip = (ts) => ({ ts: ts / 1000, rel: 0, stus: [{ stopId: "M1", arr: d(0), dep: d(0) }, { stopId: "C2", arr: d(0), dep: d(0) }] });
const veh = (lon, ts, ageS = 20) => ({ lat: -33.8, lon, ts, ageS, stopId: "Aston.X Loc", status: null });
const src = fs.readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");

test("(a) the run's vehicle: the asked trip id has none, the run's next trip id has it; its stop sequence is not used", async () => {
  const W = await loadWorker();
  assert.equal(typeof W.svcRunVehicle, "function", "svcRunVehicle");
  setClock(T("04:55:15"));
  const vp = { lat: -33.8, lon: 151.07, ts: Math.floor(T("04:55:00") / 1000), stopSeq: 7, stopId: "Hubton.X Loc", status: 2 };
  const asked = [];
  const rt = { vp: (mode, line, t) => { asked.push(t); return t === "142B.SIM" ? vp : null; } };
  const v = W.svcRunVehicle(rt, "train", "L9", "142A.SIM", null, ["142A.SIM", "142B.SIM"]);
  assert.ok(v, "the vehicle of 142B");
  assert.equal(v.runTrip, "142B.SIM");
  assert.equal(v.stopSeq, null, "another trip's stop sequence is never matched against the asked trip's update");
  assert.equal(v.lon, 151.07);
  assert.equal(W.svcRunVehicle(rt, "train", "L9", "142A.SIM", null, ["142A.SIM"]), null, "no run: nothing");
  assert.equal(W.svcRunVehicle({ vp: () => null }, "train", "L9", "142A.SIM", null, ["142A.SIM", "142B.SIM"]), null);
  assert.equal(W.svcRunVehicle(rt, "train", "L9", "142A.SIM", null, null), null);
  assert.ok(!asked.includes("142A.SIM"), "the asked trip id is not asked again");
});

test("(a) /api/service takes the run's vehicle only when the asked trip id has none", () => {
  const body = src.slice(src.indexOf("async function service(env, q)"), src.indexOf("async function service(env, q)") + 16000);
  assert.match(body, /let veh = tripId \? vehicleOf\(rt\.vp\(mode, line, tripId, feed\)\) : null;/);
  const k = body.indexOf("if (list) { run = r; runList = list; }");
  const j = body.indexOf("if (!veh && tripId && run) veh = svcRunVehicle(rt, mode, line, tripId, feed, run.trips);");
  assert.ok(k > 0 && j > k, "after the run is found, before the stop list's progress is worked out");
  assert.ok(j < body.indexOf("let nextIdx = -1, progress"), "before progress (the vehicle places the train)");
});

test("(b) B6b: the first trip id ends before the stop off and the boarding stop has dropped: a position past it reads as left", async () => {
  const W = await loadWorker();
  setClock(T("04:31:20"));
  const r = W.tfLegRaw(leg, firstTrip(T("04:31:11")), veh(151.01, T("04:31:00")), info, T("04:31:11"));
  assert.deepEqual(r.vehicle && [r.vehicle.stop, r.vehicle.state], [0, "left"], "between Aston and Marton: left Aston");
  // the trip flow leaves Due within the same step
  const pl = W.tfPlanLeg(leg, r, { li: 0 });
  const L = W.tfLegReading(pl, r, null);
  const plan = { legs: [pl] };
  const M = W.LIVECARD.newTripMemory(plan);
  M.legs[0].phase = W.LIVECARD.PHASE_INDEX.due;
  W.LIVECARD.tripStep(plan, M, T("04:31:20"), { asOf: T("04:31:11"), legs: [L] }, { lead: 2000 });
  assert.ok(M.legs[0].phase >= W.LIVECARD.PHASE_INDEX.onTheWay, "on the way, not Due");
});

test("(b) kept: no placement before a minute past the live departure, nor at the boarding stop, nor with no position", async () => {
  const W = await loadWorker();
  setClock(T("04:26:30"));
  assert.equal(W.tfLegRaw(leg, firstTrip(T("04:26:20")), veh(151.01, T("04:26:20")), info, T("04:26:20")).vehicle, null, "30 s after the departure: not yet");
  setClock(T("04:31:20"));
  assert.equal(W.tfLegRaw(leg, firstTrip(T("04:31:11")), veh(151.001, T("04:31:00")), info, T("04:31:11")).vehicle, null, "standing at the boarding stop (under 300 m)");
  assert.equal(W.tfLegRaw(leg, firstTrip(T("04:31:11")), null, info, T("04:31:11")).vehicle, null);
  // with the stop off in the update the placement is as before (a minute before the live departure)
  const withOff = { ts: T("04:25:40") / 1000, rel: 0, stus: [{ stopId: "M1", arr: d(0), dep: d(0) }, { stopId: "C2", arr: d(0), dep: d(0) }, { stopId: "H3", arr: d(0), dep: d(0) }] };
  setClock(T("04:25:50"));
  const r = W.tfLegRaw(leg, withOff, veh(151.01, T("04:25:30")), info, T("04:25:40"));
  assert.deepEqual(r.vehicle && [r.vehicle.stop, r.vehicle.state], [0, "left"], "unchanged rule with the stop off listed");
});

test("(c) B4: Get off now's words have no clock time; the heads-up keeps its time (server copy of the trip state)", async () => {
  const W = await loadWorker();
  const X = W.LIVECARD;
  const iso = (hms) => new Date(T(hms)).toISOString();
  const l = { mode: "train", line: "L4", tripId: "L4-SIM", stopId: "AST5", toStopId: "COV2", from: "Aston Station", to: "Cove Station", planned: iso("04:52:00"), arrPlanned: iso("04:56:00"), fromPlatform: "Platform 5" };
  const svc = (cov) => ({ kind: "service", tripId: "L4-SIM", line: "L4", live: true, mineIndex: 0, alightIndex: 2, stops: [
    { id: "AST5", name: "Aston Station", planned: iso("04:52:00"), estimated: iso("04:52:30"), platform: "Platform 5", passed: true },
    { id: "MRT1", name: "Marton Station", planned: iso("04:54:00"), estimated: iso("04:54:00"), passed: true },
    { id: "COV2", name: "Cove Station", planned: iso("04:56:00"), estimated: iso(cov) }] });
  const plan = X.tripPlanFrom([l], [svc("04:56:00")]);
  const M = X.newTripMemory(plan);
  M.legs[0].phase = X.PHASE_INDEX.onTheWay;
  const rings = [];
  for (const [hm, cov] of [["04:54:00", "04:56:00"], ["04:54:20", "04:55:05"], ["04:54:27", "04:55:05"]]) {
    for (const x of X.tripStep(plan, M, T(hm), X.tripReadingFrom(plan, [l], [svc(cov)], T(hm) - 3000), { lead: 0 }).moments) rings.push(x.ring);
  }
  const hu = rings.find((x) => x.kind === "headsup"), go = rings.find((x) => x.kind === "getoff");
  assert.ok(hu && go, JSON.stringify(rings.map((x) => x.kind)));
  assert.match(hu.body, /Arriving about 4:56/);
  assert.doesNotMatch(go.body, /\d{1,2}:\d{2}/, `Get off now body: "${go.body}"`);
  assert.match(go.body, /^Get off now\. Cove/);
});
