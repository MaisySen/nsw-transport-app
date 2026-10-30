// Weekend trackwork push: Thursday evening, only for trips with a morning check, only when the work is on the path.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { weekendPushHits, weekendPushText, weekendPushDue, weekendWindow };\n";
const tmp = `/tmp/weekend-push-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const THU_7PM = Date.parse("2026-10-29T08:00:00Z"); // Thursday 7pm AEDT
const w = W.weekendWindow(THU_7PM);
const SAT_NOON = Date.parse("2026-10-31T01:00:00Z");
const item = (h, stops, extra = {}) => ({ id: h.slice(0, 8), h, pl: 1, p: [[SAT_NOON - 3600000, SAT_NOON + 30 * 3600000]], l: ["T1"], s: stops, ...extra });
const shape = { stops: ["206710", "200060", "214010"], names: ["chatswood", "central", "parramatta"] };

test("only Thursday 6pm to 9pm", () => {
  assert.equal(W.weekendPushDue(THU_7PM), true);
  assert.equal(W.weekendPushDue(THU_7PM - 2 * 3600000), false);
  assert.equal(W.weekendPushDue(THU_7PM + 3 * 3600000), false);
  assert.equal(W.weekendPushDue(THU_7PM + 86400000), false);
});

test("work on the trip's stops this weekend, not elsewhere or unplanned", () => {
  const on = item("Buses replace trains between Chatswood and Lidcombe", ["206710", "214110"]);
  const off = item("Buses replace trains between Hornsby and Berowra", ["207710"]);
  const unplanned = item("Signal fault at Chatswood", ["206710"], { pl: 0 });
  const later = item("Trackwork at Central next month", ["200060"], { p: [[SAT_NOON + 20 * 86400000, SAT_NOON + 21 * 86400000]] });
  const named = item("Buses replace trains between Parramatta and Ashfield", []);
  const hits = W.weekendPushHits([off, on, unplanned, later, named], shape, w);
  assert.deepEqual(hits.map((x) => x.title), ["Buses replace trains between Chatswood and Lidcombe", "Buses replace trains between Parramatta and Ashfield"]);
  assert.deepEqual(W.weekendPushHits([on], null, w), []);
});

test("one short push", () => {
  const n = W.weekendPushText({ from_name: "Chatswood Station", to_name: "Central Station" }, [{ title: "Buses replace trains between Chatswood and Lidcombe.", sat: true, sun: true }, { title: "x", sat: true }]);
  assert.equal(n.title, "Trackwork this weekend: Chatswood to Central");
  assert.equal(n.body, "Sat and Sun: Buses replace trains between Chatswood and Lidcombe. And 1 more.");
});
