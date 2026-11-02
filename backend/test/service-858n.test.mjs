// 858N (1 Nov 2026, 6:30 PM): the open app's train details screen for the owner's T1 stopped at Central. Sydney Trains ran
// the train as one trip id to Central and the next (858N then 858P) on to its headsign's station, and our timetable pack
// did not link the two (no block link for that split), so the pack's run "ended" at Central: with no trip carrying on,
// rpRun calls the trip the whole run (reached), and /api/service listed its stops to Central only. The trip flow already
// asks the feed for the run's next trip by Sydney Trains' own naming (tfFeedRun, 858N -> 858P); the service screen now
// does the same when a train's run stops short of its headsign's station, and reads that next trip's stops from the
// pack (no Transport for NSW call). Offline, on the fixture cut of the 23 Oct GTFS (the T9 206E -> 206F run, its link
// taken out to make the 858N shape).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const worker = fs.readFileSync(root + "src/worker.js", "utf8");
const src = worker.replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/ttplan.js", "utf8") + "\n" +
  fs.readFileSync(root + "src/raptor.js", "utf8").replace(/\nexport \{ TripPlanner \};\s*$/, "\n") +
  "\nexport { rpOpen, rpRun, runStops, tfFeedRun, " + (/function svcRunOn\(/.test(worker) ? "svcRunOn, svcRunShort" : "") + " };\n";
const tmp = `/tmp/service-858n-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "858n-"));
const packFile = path.join(dir, "pack.bin");
execFileSync("python3", [root + "tools/build_planner.py", root + "test/fixtures/gtfs-runs", packFile, "20261026"], { stdio: "pipe" });
const pk = W.rpOpen(new Uint8Array(fs.readFileSync(packFile)));
fs.rmSync(dir, { recursive: true, force: true });

const FIRST = "206E.1324.165.4.H.8.92003872", NEXT = "206F.1324.165.4.H.8.92003365", GORDON = "207210";
// The 858N shape: the same pack with this split's link taken out.
const cut = { ...pk, tripNext: Int32Array.from(pk.tripNext) };
cut.tripNext[pk.tripId.find(FIRST)[0]] = -1;
const names = (r) => r.stops.map((s) => s.name.replace(/ Station$/, ""));
// ownRun as the planner object answers it (epoch ms in, rpRun's answer out), on the cut pack
const runOf = (p) => async (trip, stop, atMs) => W.rpRun(p, { trip, stop, at: Math.round(atMs / 1000) - p.dayStart });
const feedHas = (...ids) => (prefix) => ids.filter((t) => t.startsWith(prefix));

test("the 858N shape: with the split not linked the run ends at Central, called whole (reached) though it heads further", () => {
  const r = W.rpRun(cut, { trip: FIRST, stop: GORDON });
  assert.equal(names(r)[r.mine], "Gordon");
  assert.equal(names(r).at(-1), "Central", "the stop list ends at Central: the screen the owner saw");
  assert.equal(r.reached, true);
  assert.match(r.lastHead, /Hornsby/i);
  assert.equal(typeof W.svcRunOn, "function", "svcRunOn");
  assert.equal(W.svcRunShort(r), true, "a train run short of its headsign's station");
  assert.equal(W.svcRunShort(W.rpRun(pk, { trip: FIRST, stop: GORDON })), false, "the linked run is not short");
});

test("the service follows the run on: the feed names the next trip (206F), the pack gives its stops, Central once", async () => {
  const r = W.rpRun(cut, { trip: FIRST, stop: GORDON });
  const on = await W.svcRunOn(r, feedHas(NEXT, "999X.1.2.3.A.8.1"), runOf(cut));
  assert.ok(on, "followed on");
  const n = names(on);
  assert.equal(n[on.mine], "Gordon", "your stop unchanged");
  assert.equal(n.at(-1), "Hornsby");
  assert.equal(n.filter((x) => x === "Central").length, 1, "the station where the trips hand over, once");
  assert.deepEqual(on.trips, [FIRST, NEXT]);
  assert.equal(on.reached, true);
  for (let i = 1; i < on.stops.length; i++) assert.ok(on.stops[i].dep >= on.stops[i - 1].dep, n[i]);
  // the same list as the pack gives when it links the split itself
  assert.deepEqual(n, names(W.rpRun(pk, { trip: FIRST, stop: GORDON })));
  // and the service's own shape of it, each trip's live feed on its own stops
  const tuOf = (t) => (t === NEXT ? { ts: 1, rel: 0, stus: [] } : { ts: 1, rel: 0, stus: [] });
  const list = W.runStops(on, tuOf, FIRST, true);
  assert.ok(list && list.length === on.stops.length, "runStops reads the followed run");
});

test("never guessed: no next trip, two candidates, no pack answer, a far-off time, a run that is not short, another naming", async () => {
  const r = W.rpRun(cut, { trip: FIRST, stop: GORDON });
  assert.equal(await W.svcRunOn(r, feedHas(), runOf(cut)), null, "the feed lists no next trip");
  assert.equal(await W.svcRunOn(r, feedHas(NEXT, "206F.1324.165.4.H.8.92009999"), runOf(cut)), null, "two trains: not one run");
  assert.equal(await W.svcRunOn(r, feedHas(NEXT), async () => null), null, "the pack does not hold it");
  assert.equal(await W.svcRunOn(r, feedHas(NEXT), async () => { throw new Error("planner"); }), null);
  const far = async (t, s, atMs) => { const x = await runOf(cut)(t, s, atMs); return x && { ...x, stops: x.stops.map((s2) => ({ ...s2, arr: s2.arr + 3 * 3600000, dep: s2.dep + 3 * 3600000 })) }; };
  assert.equal(await W.svcRunOn(r, feedHas(NEXT), far), null, "the next trip leaves Central hours later: another train");
  assert.equal(await W.svcRunOn(W.rpRun(pk, { trip: FIRST, stop: GORDON }), feedHas(NEXT), runOf(pk)), null, "already reaches Hornsby");
  const bus = { ...r, trips: ["ML0850-OUT-WD.261026.1.0850"] };
  assert.equal(await W.svcRunOn(bus, feedHas(NEXT), runOf(cut)), null, "an id not in Sydney Trains' naming");
  assert.equal(W.svcRunShort(null), false);
  assert.equal(W.svcRunShort({ ...r, lastHead: "", head: "" }), false, "no headsign: nothing to reach");
});

test("/api/service: followed after the run is found, for trains, not on the quick answer, and a followed run is used", () => {
  const body = worker.slice(worker.indexOf("async function service(env, q)"), worker.indexOf("async function service(env, q)") + 14000);
  const k = body.indexOf("if (list) { run = r; runList = list; }");
  const f = body.indexOf("svcRunOn(run,");
  const v = body.indexOf("if (!veh && tripId && run) veh = svcRunVehicle(");
  const u = body.indexOf("const useRun =");
  assert.ok(k > 0 && f > k && f < v && v < u, "after the run, before the vehicle (so the next trip's train is found) and before useRun");
  const call = body.slice(body.lastIndexOf("if (", f), f);
  assert.match(call, /mode === "train"/);
  assert.match(call, /!q\.quick/);
  assert.match(body.slice(u, u + 200), /run\.runOn/);
});
