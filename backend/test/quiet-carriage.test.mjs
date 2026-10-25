// Quieter carriage hint from live carriage occupancy (GTFS realtime multi_carriage_details).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { quietHint, readVehiclePosition, PB };\n";
const tmp = `/tmp/quiet-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const cars = (levels) => levels.map((s, i) => ({ seq: i + 1, status: s }));
// GTFS occupancy: 1 many seats, 2 few seats, 3 standing, 4 crushed, 5 full.

test("quieter at the back when the front is standing room", () => {
  assert.deepEqual(W.quietHint(cars([3, 3, 3, 2, 2, 1, 1, 1])), { where: "back", text: "Quieter at the back" });
  assert.deepEqual(W.quietHint(cars([1, 1, 3, 4, 4, 3, 3, 3])), { where: "front", text: "Quieter at the front" });
});

test("nothing when the train is not crowded, evenly full, or there is too little data", () => {
  assert.equal(W.quietHint(cars([1, 2, 1, 2, 1, 2, 1, 2])), null);
  assert.equal(W.quietHint(cars([3, 3, 3, 3])), null);
  assert.equal(W.quietHint(cars([3, 1])), null);
  assert.equal(W.quietHint(cars([7, 7, 7, 7])), null, "no data available");
  assert.equal(W.quietHint(null), null);
});

test("carriage details are read from the vehicle position", () => {
  // field 18 (multi_carriage_details), length 4: field 3 (occupancy_status) = 3, field 5 (carriage_sequence) = 2
  const bytes = new Uint8Array([0x92, 0x01, 0x04, 0x18, 0x03, 0x28, 0x02]);
  const pb = new W.PB(bytes, 0, bytes.length);
  const v = W.readVehiclePosition(pb);
  assert.deepEqual(v.carriages, [{ status: 3, seq: 2 }]);
});
