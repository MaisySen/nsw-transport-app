// Trip legs marked live only with a live reading (27 Oct 2026): the Trip Planner marks some services hours away as
// realtime controlled and echoes the timetable as the estimate. tripLegsOf marks a leg realtime only when the estimate
// differs from the timetable or the trip leaves within 60 min. Estimate and delay are passed on unchanged.
// Run: TZ=Australia/Sydney node --test test/trip-realtime.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { efaLeg } from "./helpers/efa.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { __default, trip, tripLegsOf, tripLegLive, TRIP_LIVE_HORIZON_MS };\n";
const tmp = `/tmp/trip-realtime-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const MIN = 60000;
const NOW = Date.now();
const legsOf = (journeys, now = NOW) => W.tripLegsOf({ journeys: journeys.map((legs) => ({ legs: legs.map(efaLeg) })) }, now)[0];

test("the horizon is an hour", () => {
  assert.equal(W.TRIP_LIVE_HORIZON_MS, 60 * MIN);
});

test("an echoed estimate hours away is not live; its estimate and zero delay stay", () => {
  const [l] = legsOf([[{ from: "chatswood", to: "central", dep: NOW + 3 * 60 * MIN, delay: 0 }]]);
  assert.equal(l.realtime, false);
  assert.equal(l.delayMin, 0);
  assert.equal(Date.parse(l.estimated), NOW + 3 * 60 * MIN);
});

test("an estimate that moved is live however far away (late and early)", () => {
  assert.equal(legsOf([[{ from: "chatswood", to: "central", dep: NOW + 3 * 60 * MIN, delay: 4 }]])[0].realtime, true);
  assert.equal(legsOf([[{ from: "parramatta", to: "epping", dep: NOW + 2 * 60 * MIN, delay: -2 }]])[0].realtime, true);
});

test("a trip leaving within the hour is live with a zero delay; just past the hour it is not", () => {
  assert.equal(legsOf([[{ from: "homebush", to: "martinplace", dep: NOW + 20 * MIN, delay: 0 }]])[0].realtime, true);
  assert.equal(legsOf([[{ from: "homebush", to: "martinplace", dep: NOW + 60 * MIN, delay: 0 }]])[0].realtime, true);
  assert.equal(legsOf([[{ from: "homebush", to: "martinplace", dep: NOW + 61 * MIN, delay: 0 }]])[0].realtime, false);
  // A late first service counts from its live time: planned 70 min out, running 15 late.
  assert.equal(legsOf([[{ from: "homebush", to: "martinplace", dep: NOW + 70 * MIN, delay: 15 }]])[0].realtime, true);
});

test("the trip's departure counts for every leg: a second service later on a trip leaving soon stays live", () => {
  const legs = legsOf([[
    { from: "chatswood", to: "central", dep: NOW + 10 * MIN, delay: 0, min: 15 },
    { from: "central", to: "bondijunction", dep: NOW + 80 * MIN, delay: 0, cls: 5 },
  ]]);
  assert.equal(legs[0].realtime, true);
  assert.equal(legs[1].realtime, true);
  const later = legsOf([[
    { from: "chatswood", to: "central", dep: NOW + 90 * MIN, delay: 0, min: 15 },
    { from: "central", to: "bondijunction", dep: NOW + 110 * MIN, delay: 3, cls: 5 },
  ]]);
  assert.equal(later[0].realtime, false);
  assert.equal(later[1].realtime, true);
});

test("no estimate is never live", () => {
  const [l] = legsOf([[{ from: "chatswood", to: "central", dep: NOW + 5 * MIN, delay: null }]]);
  assert.equal(l.realtime, false);
  assert.equal(l.delayMin, null);
  assert.equal(l.estimated, null);
  assert.equal(W.tripLegLive(null, new Date(NOW).toISOString(), NOW, NOW), false);
});

test("trip: the same rule comes through the whole trip answer", async () => {
  const far = efaLeg({ from: "epping", to: "central", dep: NOW + 3 * 60 * MIN, delay: 0 });
  const soon = efaLeg({ from: "epping", to: "central", dep: NOW + 10 * MIN, delay: 0 });
  const answer = { journeys: [{ legs: [far] }, { legs: [soon] }] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const url = new URL(typeof u === "string" ? u : u.url);
    if (url.pathname.endsWith("/trip")) return new Response(JSON.stringify(answer));
    return new Response("{}", { status: 404 });
  };
  try {
    const r = await W.trip({ TFNSW_API_KEY: "t" }, "212110", "200060", {});
    const byDep = new Map(r.journeys.map((j) => [Date.parse(j.legs[0].planned), j.legs[0]]));
    assert.equal(byDep.get(NOW + 3 * 60 * MIN).realtime, false);
    assert.equal(byDep.get(NOW + 10 * MIN).realtime, true);
  } finally { globalThis.fetch = realFetch; }
});
