// The new live trip flow on the server (docs/TRIP_FLOW_SPEC.md 2.6, phase 2, 31 Oct 2026): every journey simulator
// case (app/sim/cases.mjs, referred to here by id only) runs through the real worker routes (/api/push/expo,
// /api/live-activity, /api/watch, /api/watches) and the cron's trip flow pass, against the fake NSW feeds built from the
// case (tools/fake-nsw.mjs mode case). Each alert the simulator says the server sends must go out with the same title,
// body and sound within 5 s of its time and nothing else may ring; each card push must never show 0:00, never have a
// stale date past its own target, carry no banned words, count down to the simulator's live departure, and never leave
// the card over 61 s without a push. The decisions are the app's own trip state (LIVECARD, I6).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { CASES } from "../../app/sim/cases.mjs";
import { runCase, compare, checkPushes, SERVER_CASES, stopFake, loadWorker, setClock, BASE } from "../tools/simtrip.mjs";

after(() => stopFake());

test("all the simulator's server cases are run (30 cases less those with no server)", () => {
  assert.ok(SERVER_CASES.length >= 28, `only ${SERVER_CASES.length} cases`);
});

for (const id of SERVER_CASES) {
  test(`case ${id}: the server sends what the simulator says, when it says, and the card never lies`, { timeout: 60000 }, async () => {
    const r = await runCase(id);
    if (r.skipped) return;
    assert.equal(r.reg && r.reg.watch && r.reg.watch.tripFlow, 2, "the watch runs the new trip flow");
    const cmp = compare(id, r);
    const miss = cmp.rows.filter((x) => !x.match).map((x) => `${x.kind} at ${x.simAt}: want "${x.title}" / "${x.body}" (${x.wantSound}), got ${x.serverT == null ? "nothing" : `"${x.serverBody}" at ${x.serverT}`}`);
    assert.deepEqual(miss, [], "alerts that did not match");
    assert.deepEqual(cmp.extra.map((x) => `${x.t} ${x.via} ${x.title}`), [], "alerts the simulator does not send");
    assert.deepEqual(checkPushes(id, r, cmp.sim), [], "card push problems");
    // G32: alerts given again on open are silent, under 90 s old
    for (const n of (r.catchUp && r.catchUp.notes) || []) if (String(n.kind || "").startsWith("tf")) assert.equal(n.silent, true, `catch-up note ${n.title} is silent`);
  });
}

test("G29: a 24 hour phone hears 24 hour times, a 12 hour phone am and pm", { timeout: 120000 }, async () => {
  const id24 = CASES.find((c) => (c.phone || []).some((p) => p.c24) && SERVER_CASES.includes(c.id));
  assert.ok(id24, "a case with a 24 hour phone");
  const r24 = await runCase(id24.id);
  const w24 = r24.alerts.map((a) => a.body).join(" ");
  assert.match(w24, /\b(1\d|2[0-3]):\d\d\b/);
  assert.doesNotMatch(w24, /\d[ap]m\b/);
  const r12 = await runCase("S2");
  assert.match(r12.alerts.map((a) => a.body).join(" "), /\d:\d\d[ap]m/);
});

test("switch tripflow2 off: a new app's trip runs the old path, untouched", { timeout: 60000 }, async () => {
  const r = await runCase("S2", { flags: { getOffPush: true, liveStops: true } });
  assert.notEqual(r.reg && r.reg.watch && r.reg.watch.tripFlow, 2);
  assert.ok(!r.alerts.some((a) => / is next$/.test(a.title)), "no heads-up from the new flow");
});

test("an old app (no tripFlow) with the switch on runs the old path", { timeout: 60000 }, async () => {
  const r = await runCase("S2", { flow: 1 });
  assert.notEqual(r.reg && r.reg.watch && r.reg.watch.tripFlow, 2);
  assert.ok(!r.alerts.some((a) => / is next$/.test(a.title)));
});

test("G18: the boarding stop is matched by station name when the feed's platform id differs; no match is timetable only", async () => {
  const W = await loadWorker();
  const t0 = BASE + 20 * 3600000;
  setClock(t0);
  const leg = { mode: "train", line: "T2", stopId: "2150001", from: "Sample Park Station", toStopId: "215010", to: "Sample Vale Station", planned: new Date(t0 + 300000).toISOString(), arrPlanned: new Date(t0 + 1500000).toISOString(), fromPlatform: "Platform 1" };
  const info = { "2150002": { name: "Sample Park Station" }, "2150101": { name: "Sample Vale Station" }, "2150050": { name: "Middle Station" } };
  const ev = (t, d) => ({ time: Math.round(t / 1000), delay: d });
  const tu = { ts: t0 / 1000, stus: [
    { stopId: "2150002", dep: ev(t0 + 420000, 120) },
    { stopId: "2150050", dep: ev(t0 + 1020000, 120) },
    { stopId: "2150101", arr: ev(t0 + 1620000, 120) },
  ] };
  const r = W.tfLegRaw(leg, tu, null, info, t0);
  assert.equal(r.unmatched, false);
  assert.equal(r.est[0], t0 + 420000, "boarding stop matched by name (platform 2150002, registered 2150001)");
  assert.equal(r.runDelay, 120);
  assert.equal(r.before && r.before.name, "Middle Station");
  assert.equal(r.est[2], t0 + 1620000, "your stop matched by name too");
  const other = W.tfLegRaw({ ...leg, from: "Elsewhere Station" }, tu, null, info, t0);
  assert.equal(other.est[0], undefined, "no boarding time from a stop that is not yours");
  const pl = W.tfPlanLeg(leg, r, { li: 0 });
  assert.deepEqual(pl.stops.map((s) => s.name), ["Sample Park", "Middle", "Sample Vale"]);
  const L = W.tfLegReading(pl, r, null);
  assert.deepEqual(L.est, [t0 + 420000, t0 + 1020000, t0 + 1620000]);
  assert.equal(L.run[0], 120000);
});
