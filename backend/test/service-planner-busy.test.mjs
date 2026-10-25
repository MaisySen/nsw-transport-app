// The service view's stop list when the data service is busy. A 429 from the trip planner used to leave an empty
// stop list with no word why; now the worker retries, keeps a recent list, and says what happened in stopsStatus.
// Runs offline against the worker source with a fake data service.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
async function loadWorker() {
  let src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {");
  src += "\nexport { __default, service, plannerLeg, plannerLegMem };\n";
  const tmp = `/tmp/service-busy-test-${process.pid}-${Date.now()}.mjs`;
  fs.writeFileSync(tmp, src);
  try { return await import(tmp); } finally { fs.unlinkSync(tmp); }
}

const base = Date.now() + 10 * 60000;
const at = (m) => new Date(base + m * 60000).toISOString();
const journey = (tripId) => ({
  journeys: [{ legs: [{
    isRealtimeControlled: false,
    transportation: { disassembledName: "T4", destination: { name: "Far End Station" }, properties: { RealtimeTripId: tripId } },
    origin: { departureTimePlanned: at(0) },
    coords: [[-33.9, 151.2], [-33.95, 151.21]],
    stopSequence: [
      { id: "P1", name: "First Station, Platform 1", disassembledName: "First Station, Platform 1", coord: [-33.9, 151.2], departureTimePlanned: at(0) },
      { id: "P2", name: "Second Station, Platform 2", disassembledName: "Second Station, Platform 2", coord: [-33.92, 151.2], departureTimePlanned: at(3) },
      { id: "P3", name: "Far End Station, Platform 1", disassembledName: "Far End Station, Platform 1", coord: [-33.95, 151.21], arrivalTimePlanned: at(7) },
    ],
  }] }],
});

let plan = [];
let tripCalls = 0;
globalThis.fetch = async (u) => {
  const url = String(u);
  if (url.includes("/v1/tp/trip")) {
    tripCalls++;
    const next = plan.length ? plan.shift() : 429;
    if (next === 429) return new Response('{"ErrorDetails":{"Message":"rate limit"}}', { status: 429 });
    return new Response(JSON.stringify(next), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("{}", { status: 503 });
};
// A fake edge cache (the Cache API), shared like the data centre's cache is between isolates.
const edge = new Map();
globalThis.caches = { default: {
  match: async (req) => (edge.has(req.url) ? new Response(edge.get(req.url)) : undefined),
  put: async (req, res) => { edge.set(req.url, await res.text()); },
} };
const W = await loadWorker();
const q = (trip) => ({ trip, mode: "train", line: "T4", stop: "P1", destId: "D9", planned: at(0) });

test("a busy answer is retried and the stop list comes back", async () => {
  plan = [429, journey("trip-a")];
  tripCalls = 0;
  const d = await W.service({}, q("trip-a"));
  assert.equal(tripCalls, 2);
  assert.equal(d.stops.length, 3);
  assert.equal(d.mineIndex, 0);
  assert.equal(d.stopsStatus, "ok");
  assert.equal(d.dest, "Far End Station");
});

test("still busy after the retries: empty list said as busy, not as a train with no stops", async () => {
  plan = [429, 429, 429, 429];
  const r = await W.plannerLeg({}, q("trip-b"), "trip-b", "T4", { waitMs: 1 });
  assert.equal(r.leg, null);
  assert.equal(r.status, "busy");
});

test("a list seen in the last minute is reused without asking again", async () => {
  plan = [journey("trip-c")];
  await W.plannerLeg({}, q("trip-c"), "trip-c", "T4", { waitMs: 1 });
  tripCalls = 0;
  const r = await W.plannerLeg({}, q("trip-c"), "trip-c", "T4", { waitMs: 1 });
  assert.equal(tripCalls, 0);
  assert.equal(r.status, "ok");
  assert.equal(r.leg.stopSequence.length, 3);
});

test("when the planner is busy later, the kept list is used and marked stale", async () => {
  plan = [journey("trip-d")];
  await W.plannerLeg({}, q("trip-d"), "trip-d", "T4", { waitMs: 1 });
  const k = [...W.plannerLegMem.keys()].find((x) => x.startsWith("trip-d|"));
  W.plannerLegMem.get(k).at -= 5 * 60000;
  for (const u of [...edge.keys()]) if (u.includes("trip-d")) edge.delete(u);
  plan = [429, 429, 429, 429];
  const r = await W.plannerLeg({}, q("trip-d"), "trip-d", "T4", { waitMs: 1 });
  assert.equal(r.status, "stale");
  assert.equal(r.leg.stopSequence.length, 3);
});

test("the planner answering without this run is notFound", async () => {
  plan = [{ journeys: [] }];
  const r = await W.plannerLeg({}, q("trip-e"), "trip-e", "T4", { waitMs: 1 });
  assert.equal(r.status, "notFound");
});

test("two questions for the same service at once share one planner call", async () => {
  plan = [journey("trip-f")];
  tripCalls = 0;
  const [a, b] = await Promise.all([W.plannerLeg({}, q("trip-f"), "trip-f", "T4"), W.plannerLeg({}, q("trip-f"), "trip-f", "T4")]);
  assert.equal(tripCalls, 1);
  assert.equal(a.leg.stopSequence.length, 3);
  assert.equal(b.leg.stopSequence.length, 3);
});

test("a list another isolate read (the edge cache) is used without asking the planner", async () => {
  plan = [journey("trip-g")];
  await W.plannerLeg({}, q("trip-g"), "trip-g", "T4", { waitMs: 1 });
  assert.ok([...edge.keys()].some((u) => u.includes("/__edge/planner-leg/trip-g")));
  W.plannerLegMem.clear();
  tripCalls = 0;
  const r = await W.plannerLeg({}, q("trip-g"), "trip-g", "T4", { waitMs: 1 });
  assert.equal(tripCalls, 0);
  assert.equal(r.status, "ok");
  assert.equal(r.leg.stopSequence.length, 3);
});
