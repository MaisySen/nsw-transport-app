// Timetable fallback for the new trip flow (6 Nov). Bidur's trip of 6 Nov 4:54 AM ran with no live train data at all:
// the card was pushed 39 times and every push said "waiting" at Strathfield, because the new trip state only went on
// board from live evidence (a live train, your location, your tap). This replays that trip every 30 s on timetable
// times only and checks the card goes on board at the planned departure, moves to the change at the planned arrival,
// and finishes, while still saying the times are not live. Live evidence keeps the live behaviour exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") +
  "\nexport { LIVECARD };\n";
const tmp = `/tmp/tt-fallback-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
const { computeLive, cardFor } = W.LIVECARD;

const at = (hm) => Date.parse(`2026-11-06T${hm}:00+11:00`);
const iso = (hm) => new Date(at(hm)).toISOString();
// T1 Strathfield platform 4 at 4:59 to Town Hall (arrival time here is the plan's, about 5:14), then T4 5:22 to Kings Cross 5:26.
const T1 = [["Strathfield", "04:59"], ["Redfern", "05:09"], ["Central", "05:11"], ["Town Hall", "05:14"]];
const T4 = [["Town Hall", "05:22"], ["Martin Place", "05:24"], ["Kings Cross", "05:26"]];
const legOf = (line, run, stops, tripId) => ({ mode: "train", line, tripId, stopId: run + "0", toStopId: run + (stops.length - 1), from: stops[0][0],
  to: stops[stops.length - 1][0], planned: iso(stops[0][1]), arrPlanned: iso(stops[stops.length - 1][1]), platform: "4", color: "#F99D1C" });
const svcOf = (line, run, stops, tripId) => ({ kind: "service", live: false, mode: "train", line, tripId, mineIndex: 0, alightIndex: stops.length - 1,
  progress: "timetable", stops: stops.map(([name, hm], i) => ({ id: run + i, name, planned: iso(hm) })) });
const legs = [legOf("T1", "A", T1, "T1RUN"), { ...legOf("T4", "B", T4, "T4RUN"), walkBefore: 3 }];
const svc = [svcOf("T1", "A", T1, "T1RUN"), svcOf("T4", "B", T4, "T4RUN")];
const trip = { legs, to: { id: "B2", name: "Kings Cross" } };

function replay(svcs) {
  const out = [];
  for (let t = at("04:54"); t <= at("05:30"); t += 30000) {
    const s = computeLive(legs, svcs, t, {}, null, { asOf: at("04:54"), plannerAt: at("04:54") });
    out.push({ t, s, c: s.done ? null : cardFor(trip, s, t) });
  }
  return out;
}

for (const [name, svcs] of [["timetable stop lists", svc], ["no stop lists at all", [null, null]]]) {
  test(`the 4:54 trip with no live data (${name}) goes on board by the timetable, changes at Town Hall and finishes`, () => {
    const r = replay(svcs);
    const when = (hm) => r.find((x) => x.t === at(hm));
    for (const hm of ["04:54", "04:58"]) assert.equal(when(hm).s.phase, "wait", hm + " still waiting at Strathfield");
    for (const hm of ["04:59", "05:05", "05:13"]) {
      const x = when(hm);
      assert.equal(x.s.cur, 0, hm); assert.equal(x.s.phase, "ride", hm + " on board the T1");
      assert.equal(x.s.track, "timetable", hm + " still labelled timetable");
      assert.equal(x.c.phase, "ride", hm + " the card shows on board");
    }
    for (const hm of ["05:15", "05:21"]) { const x = when(hm); assert.equal(x.s.cur, 1, hm + " at the change"); assert.equal(x.s.phase, "wait", hm); }
    for (const hm of ["05:22", "05:25"]) { const x = when(hm); assert.equal(x.s.cur, 1, hm); assert.equal(x.s.phase, "ride", hm + " on board the T4"); }
    assert.equal(when("05:27").s.done, true, "the trip is done after the 5:26 arrival");
    // never a live claim: no delay minutes and no stop count on timetable times
    for (const x of r) if (!x.s.done) { assert.equal(x.s.delayMin, null); assert.equal(x.s.stopsLeft, null); }
    assert.ok(r.filter((x) => !x.s.done && x.s.phase === "wait").length < r.length / 2, "not stuck on waiting");
  });
}

test("live evidence is unchanged: a live train still at the platform after its timetable time keeps the card waiting", () => {
  const live = { ...svc[0], live: true, progress: "live", stops: svc[0].stops.map((s, i) => ({ ...s, estimated: new Date(Date.parse(s.planned) + 5 * 60000).toISOString() })) };
  const s = computeLive(legs, [live, svc[1]], at("05:01"), {}, null, { asOf: at("05:01") - 5000, plannerAt: at("04:54") });
  assert.equal(s.phase, "wait", "5 min late live train has not left: still waiting");
  assert.notEqual(s.track, "timetable");
});

test("seen riding before (rode) still rides on timetable times, as before the fallback", () => {
  const s = computeLive(legs, svc, at("04:57"), { rode: { 0: at("05:14") } }, null, { asOf: at("04:54"), plannerAt: at("04:54") });
  assert.equal(s.phase, "ride");
});
