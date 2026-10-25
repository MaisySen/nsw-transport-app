// Bus and coach board rows and trip legs carry `ahead`: the live delays (minutes) from the bus's next stop to this
// stop, which the app's slow traffic rule reads (app/src/lib/busLiveCore.ts). Runs offline against the worker source.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
async function loadWorker() {
  let src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {");
  src += "\nexport { __default, aheadDelays, enrich };\n";
  const tmp = `/tmp/bus-ahead-test-${process.pid}-${Date.now()}.mjs`;
  fs.writeFileSync(tmp, src);
  try { return await import(tmp); } finally { fs.unlinkSync(tmp); }
}
globalThis.fetch = async () => new Response("{}", { status: 503 });
const W = await loadWorker();

const now = Math.floor(Date.now() / 1000);
const stu = (i, delayS, rel = 0) => ({ seq: i + 1, stopId: "S" + i, rel, dep: { time: now + i * 120 + delayS, delay: delayS } });
const tuOf = (delays) => ({ ts: now, rel: 0, stus: delays.map((d, i) => (d == null ? { seq: i + 1, stopId: "S" + i, rel: 2 } : stu(i, d))) });

test("delays from the next stop to this stop, in minutes with one decimal", () => {
  const tu = tuOf([60, 90, 180, 300, 420]);
  assert.deepEqual(W.aheadDelays(tu, 1, 4), [1.5, 3, 5, 7]);
  assert.deepEqual(W.aheadDelays(tuOf([60, null, 180, 300]), 0, 3), [1, null, 3, 5]);
});

test("nothing with fewer than three live stops, no feed time, or a cancelled trip", () => {
  assert.equal(W.aheadDelays(tuOf([60, 120]), 0, 1), null);
  assert.equal(W.aheadDelays(tuOf([60, null, null, 120]), 0, 3), null);
  assert.equal(W.aheadDelays({ ...tuOf([60, 90, 120]), ts: 0 }, 0, 2), null);
  assert.equal(W.aheadDelays({ ...tuOf([60, 90, 120]), rel: 3 }, 0, 2), null);
  assert.equal(W.aheadDelays(tuOf([60, 90, 120]), 2, 1), null);
});

test("a long stretch is cut to 24 values, keeping the first two and last two", () => {
  const d = Array.from({ length: 60 }, (_, i) => i * 6);
  const a = W.aheadDelays(tuOf(d), 0, 59);
  assert.ok(a.length <= 24);
  assert.deepEqual(a.slice(0, 2), [0, 0.1]);
  assert.deepEqual(a.slice(-2), [5.8, 5.9]);
  for (let i = 1; i < a.length; i++) assert.ok(a[i] > a[i - 1]);
});

test("enrich adds ahead to live bus rows with a vehicle, never to trains", () => {
  const tu = tuOf([0, 60, 200, 330]);
  const vp = { lat: -33.87, lon: 151.09, ts: now, stopId: "S0" };
  const rt = { tu: () => tu, vp: () => vp };
  const bus = W.enrich({ mode: "bus", line: "410", tripId: "x", stopId: "S3", planned: new Date((now + 360) * 1000).toISOString(), estimated: new Date((now + 690) * 1000).toISOString(), realtime: true, delayMin: 5 }, rt);
  assert.equal(bus.stopsAway, 3);
  assert.deepEqual(bus.ahead, [0, 1, 3.3, 5.5]);
  const train = W.enrich({ mode: "train", line: "T1", tripId: "y", stopId: "S3", planned: new Date((now + 360) * 1000).toISOString(), realtime: true, delayMin: 5 }, rt);
  assert.equal(train.ahead, undefined);
});
