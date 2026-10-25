// Live traffic on bus legs: Live Traffic NSW incidents near the route a bus drives.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { hazardOut, hazardOnPath, addTraffic, segDistM, hazardRelevant };\n";
const tmp = `/tmp/traffic-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

// Victoria Road through Gladesville, roughly west to east, as [lat, lon].
const PATH = [[-33.8325, 151.1200], [-33.8330, 151.1250], [-33.8338, 151.1300], [-33.8345, 151.1350]];
const feature = (lat, lon, props = {}) => ({ type: "Feature", id: 123, geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { mainCategory: "CRASH", roads: [{ mainStreet: "Victoria Road", suburb: "Gladesville" }], isMajor: false, lastUpdated: Date.now() - 600000, ...props } });

test("an incident in the words the app shows", () => {
  const h = W.hazardOut(feature(-33.8331, 151.1262));
  assert.equal(h.text, "Crash on Victoria Road at Gladesville");
  assert.equal(h.kind, "Crash");
  assert.equal(h.lat, -33.8331);
  assert.equal(W.hazardOut(feature(-33.8, 151.1, { ended: true })), null);
  assert.equal(W.hazardOut({ geometry: { type: "LineString", coordinates: [] }, properties: {} }), null);
  assert.equal(W.hazardOut(feature(-33.8, 151.1, { mainCategory: "BREAKDOWN", roads: [{ suburb: "Ryde" }] })).text, "Breakdown at Ryde");
});

test("matched only when it sits on the route", () => {
  const on = W.hazardOut(feature(-33.8331, 151.1262));
  const off = W.hazardOut(feature(-33.8400, 151.1262)); // about 750 m south
  assert.equal(W.hazardOnPath(PATH, [off]), null);
  assert.equal(W.hazardOnPath(PATH, [off, on]).id, "123");
  assert.ok(W.segDistM([-33.8331, 151.1262], PATH[1], PATH[2]) < 60);
});

test("a major incident wins over a nearer minor one", () => {
  const minor = { ...W.hazardOut(feature(-33.8331, 151.1262)), id: "a" };
  const major = { ...W.hazardOut(feature(-33.8339, 151.1305, { isMajor: true })), id: "b" };
  assert.equal(W.hazardOnPath(PATH, [minor, major]).id, "b");
});

test("only bus and coach legs get a traffic note", async () => {
  const h = W.hazardOut(feature(-33.8331, 151.1262));
  const d = { journeys: [{ legs: [
    { kind: "transit", mode: "bus", line: "501", path: PATH },
    { kind: "transit", mode: "train", line: "T9", path: PATH },
    { kind: "walk", mode: "walk", path: PATH },
  ] }] };
  await W.addTraffic({}, d, async () => [h]);
  assert.equal(d.journeys[0].legs[0].traffic.text, "Crash on Victoria Road at Gladesville");
  assert.equal(d.journeys[0].legs[1].traffic, undefined);
  assert.equal(d.journeys[0].legs[2].traffic, undefined);
  let called = false;
  await W.addTraffic({}, { journeys: [{ legs: [{ kind: "transit", mode: "train", path: PATH }] }] }, async () => { called = true; return []; });
  assert.equal(called, false, "no Live Traffic read without a bus leg");
});

test("old road notices and 4WD tracks are left out", async () => {
  const now = Date.now();
  assert.equal(W.hazardRelevant({ kind: "Open to 4wd only", updated: now }, now), false);
  assert.equal(W.hazardRelevant({ kind: "Changed traffic conditions", updated: now - 40 * 3600000 }, now), false);
  assert.equal(W.hazardRelevant({ kind: "Changed traffic conditions", updated: now - 40 * 3600000, major: true }, now), true);
  assert.equal(W.hazardRelevant({ kind: "Crash", updated: now - 600000 }, now), true);
  const old = W.hazardOut(feature(-33.8331, 151.1262, { lastUpdated: now - 50 * 3600000 }));
  const d = { journeys: [{ legs: [{ kind: "transit", mode: "bus", line: "501", path: PATH }] }] };
  await W.addTraffic({}, d, async () => [old]);
  assert.equal(d.journeys[0].legs[0].traffic, undefined);
  assert.equal(W.hazardOut(feature(-33.8, 151.1, { mainCategory: "OPEN TO  4WD ONLY" })).kind, "Open to 4wd only");
});
