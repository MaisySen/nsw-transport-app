// Locked screens live (1 Nov 2026, the owner at 7:09 PM on build 214: "App still doesnt pull live data on locked
// screens yet"). His 6:30 PM Town Hall to Strathfield trip (T1 858N): the train carries on as 858P after Central, the
// feed drops 858N once it is past the change, and the trip flow read only 858N, so the Lock Screen card said "Timetable
// times, not live" for 32 min and no heads-up, Get off now or arrival came. A card the phone registered just after an
// arrival was pushed "Due now" for an hour. The widgets and the Watch had no way to read the live card. Offline, against
// the fake feeds (tools/simtrip.mjs), as build214-server.test.mjs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { runCase, stopFake, loadWorker } from "../tools/simtrip.mjs";

after(() => stopFake());
const hms = (s) => { const [h, m, x = 0] = s.split(":").map(Number); return h * 3600 + m * 60 + x; };
// The train's run from our own timetable (raptor.js ownRun, not in worker.js alone): the leg's trip, then its ".b" trip.
const runs = [];
globalThis.ownRun = async (env, tripId, stopId) => { runs.push(tripId); return { trips: [tripId, tripId + ".b"], stops: [{ id: stopId, trip: tripId }, { id: "x", trip: tripId + ".b" }], reached: true, mine: 0 }; };

test("tfRunTu: one trip update for the run, the change stop's timed event kept, a cancelled own trip left alone", async () => {
  const W = await loadWorker();
  assert.equal(typeof W.tfRunTu, "function");
  const a = { ts: 100, rel: 0, stus: [{ stopId: "A", dep: { time: 1 } }, { stopId: "C" }] };
  const b = { ts: 120, rel: 0, stus: [{ stopId: "C", dep: { time: 5 } }, { stopId: "D", arr: { time: 9 } }] };
  const r = W.tfRunTu(["t1", "t1.b"], "t1", (t) => (t === "t1.b" ? b : null), a);
  assert.deepEqual(r.tu.stus.map((u) => u.stopId), ["A", "C", "D"]);
  assert.equal(r.tu.stus[1].dep.time, 5, "the change stop takes the event with a time");
  assert.equal(r.tu.ts, 120);
  const gone = W.tfRunTu(["t1", "t1.b"], "t1", (t) => (t === "t1.b" ? b : null), null);
  assert.deepEqual(gone.tu.stus.map((u) => u.stopId), ["C", "D"], "the first trip already left the feed");
  assert.equal(W.tfRunTu(["t1", "t1.b"], "t1", () => null, a), null, "nothing after the first trip: unchanged");
  assert.equal(W.tfRunTu(["t1", "t1.b"], "t1", () => b, { ...a, rel: 3 }), null, "a cancelled trip stays cancelled");
  assert.equal(W.tfRunTu(["t0", "t1"], "t1", () => b, a), null, "the run must start at the leg's trip");
});

test("S3 with the run split at Auburn: Get off now from the second trip id's live arrival, 6 min late, card live to the stop", { timeout: 90000 }, async () => {
  runs.length = 0;
  const r = await runCase("S3", { handover: { leg: 0, at: 1 } });
  const off = r.alerts.filter((a) => /^Get off now/.test(a.title));
  assert.equal(off.length >= 1, true, JSON.stringify(r.alerts.map((a) => [a.t, a.title])));
  assert.ok(Math.abs(off[0].t - hms("20:00:20")) <= 5, `Get off now sent at ${off[0].t} (${hms("20:00:20")} wanted: live arrival 8:01 minus 40 s, not the 7:55 timetable)`);
  assert.ok(r.alerts.some((a) => /^Arrived|You've arrived/.test(a.title) && a.t >= hms("20:01") - 5), "Arrived when the train is at Clyde");
  const late = r.pushes.filter((p) => p.t >= hms("19:59:30") && p.t < hms("20:01") && p.event !== "end");
  assert.ok(late.length >= 1, "card pushes on the last stretch");
  for (const p of late) assert.doesNotMatch(String(p.warning), /Timetable|No live data/, `push at ${p.t}: ${p.warning}`);
  assert.ok(runs.length >= 1 && runs.length <= 3, `the run is looked up once per trip id (${runs.length})`);
});

test("the run's next trip by Sydney Trains' naming: 858N then 858P (I and O left out), never a guess", async () => {
  const W = await loadWorker();
  assert.equal(W.tfNextRunPrefix("858N.1417.150.2.A.8.92149684"), "858P.1417.150.2.A.8.");
  assert.equal(W.tfNextRunPrefix("858H.1417.150.2.A.8.91975039"), "858J.1417.150.2.A.8.");
  assert.equal(W.tfNextRunPrefix("859L.1417.150.2.A.8.92149595"), "859M.1417.150.2.A.8.");
  assert.equal(W.tfNextRunPrefix("2780928"), null, "a bus trip id");
  assert.equal(W.tfNextRunPrefix("SIM.leg0"), null);
  const feed = ["858P.1417.150.2.A.8.92107490", "871P.1417.150.2.A.8.92149680"];
  const like = (pre) => feed.filter((x) => x.startsWith(pre));
  assert.deepEqual(W.tfFeedRun("858N.1417.150.2.A.8.92149684", like), ["858N.1417.150.2.A.8.92149684", "858P.1417.150.2.A.8.92107490"]);
  assert.deepEqual(W.tfFeedRun("858P.1417.150.2.A.8.92107490", like), [], "nothing follows");
  assert.deepEqual(W.tfFeedRun("858N.1417.150.2.A.8.1", () => ["858P.1417.150.2.A.8.1", "858P.1417.150.2.A.8.2"]), [], "two candidates: no guess");
});

test("the owner's 858N: our timetable does not link the split, the feed's next run letter carries the trip to the stop", { timeout: 90000 }, async () => {
  const keep = globalThis.ownRun;
  globalThis.ownRun = async () => null; // 1 Nov: our pack's run for 858N ended at Central
  try {
    const r = await runCase("S3", { handover: { leg: 0, at: 1 }, tripId: { leg: 0, id: "858N.1417.150.2.A.8.92149684" } });
    const off = r.alerts.filter((a) => /^Get off now/.test(a.title));
    assert.ok(off.length >= 1 && Math.abs(off[0].t - hms("20:00:20")) <= 5, JSON.stringify(r.alerts.map((a) => [a.t, a.title])));
    const late = r.pushes.filter((p) => p.t >= hms("19:59:30") && p.t < hms("20:01") && p.event !== "end");
    for (const p of late) assert.doesNotMatch(String(p.warning), /Timetable|No live data/, `push at ${p.t}: ${p.warning}`);
  } finally { globalThis.ownRun = keep; }
});

test("S1 with no split: the run is never needed (own trip reaches the stop)", { timeout: 60000 }, async () => {
  runs.length = 0;
  const r = await runCase("S1");
  assert.ok(r.alerts.some((a) => /^Get off now/.test(a.title)));
  assert.ok(runs.length <= 1, `run lookups: ${runs.length}`);
});

test("GET /api/live-card: the widget and the Watch read the server's live card for the install's trip", { timeout: 60000 }, async () => {
  const profile = "u0123456789abcdef0";
  const r = await runCase("S3", { profile, endAt: hms("19:53"), get: `/api/live-card?profile=${profile}` });
  assert.equal(r.got.status, 200);
  const c = r.got.body.card;
  assert.ok(c, JSON.stringify(r.got.body));
  assert.equal(c.phase, "wait");
  assert.ok(c.departs > 0 && c.arrival > 0 && c.until > c.arrival, "times in ms with until, as the app's liveCard");
  assert.equal(new Date(c.departs).getMinutes() % 60, 56, "counts to the live 7:56 departure, not 7:50");
  assert.equal(r.got.body.ended, false);
  const none = await runCase("S3", { profile, endAt: hms("19:47"), get: `/api/live-card?profile=uzzzzzzzzzzzzzzzz9` });
  assert.equal(none.got.body.card, null, "another install's profile gets nothing");
  const bad = await runCase("S1", { endAt: hms("19:47"), get: `/api/live-card?profile=bidur` });
  assert.equal(bad.got.status, 400, "a short or shared profile is refused");
});

test("a card registered again with arrivedAt (the owner's 6:23 PM card) ends at its next push, then nothing more", { timeout: 60000 }, async () => {
  const r = await runCase("S1", { cardOnly: { arrivedAt: hms("19:45:30") }, endAt: hms("20:00") });
  assert.ok(r.pushes.length >= 1, "pushed once");
  assert.equal(r.pushes[0].event, "end", JSON.stringify(r.pushes.slice(0, 3)));
  assert.equal(r.pushes.filter((p) => p.event !== "end").length, 0, `no more updates: ${JSON.stringify(r.pushes.slice(0, 4))}`);
});

test("a card alone whose train has left the feed ends 30 min after its planned arrival, not 2 h later", { timeout: 120000 }, async () => {
  const r = await runCase("S8", { cardOnly: {}, endAt: hms("20:40") });
  const end = r.pushes.findIndex((p) => p.event === "end");
  assert.ok(end >= 0, `an end push: last ${JSON.stringify(r.pushes.slice(-2))}`);
  assert.ok(r.pushes[end].t <= hms("20:27") && r.pushes[end].t >= hms("19:55"), `ended at ${r.pushes[end].t}`);
  assert.equal(r.pushes.slice(end + 1).length, 0, "nothing after the end");
  const W = await loadWorker();
  assert.equal(W.tfArrivedOnPhone({ arrivedAt: 10 * 60000 }, 0), false, "an arrivedAt to come is not an arrival");
});
