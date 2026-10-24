// Car park "usually full by": weekday morning readings kept as one row per car park per day, and the
// words built from them. Real SQL (node:sqlite).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./helpers/d1.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { __default, usualFull, sampleParking, withUsual, facSchema, parkDayMem, parkMem, sydneyNow };\n";
const tmp = `/tmp/parkfull-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

// Weekdays in October and November 2026.
const WD = ["20261012", "20261013", "20261014", "20261015", "20261016", "20261019", "20261020", "20261021", "20261022", "20261023"];
const row = (day, full) => ({ day, full_tod: full });

test("learning until 5 weekday mornings, weekends and an unfinished today left out", () => {
  const r = W.usualFull([row(WD[0], 460), row(WD[1], 470), row("20261017", 500), row("20261024", null)], "20261024", 600);
  assert.equal(r.state, "learning"); assert.equal(r.n, 2);
  assert.equal(r.text, "Learning when it fills: 2 of 5 weekday mornings recorded");
  // Today, still before 11am and not full yet, does not count; once full it does.
  assert.equal(W.usualFull([row(WD[0], 460), row(WD[1], 460), row(WD[2], 460), row(WD[3], 460), row("20261026", null)], "20261026", 500).n, 4);
  assert.equal(W.usualFull([row(WD[0], 460), row(WD[1], 460), row(WD[2], 460), row(WD[3], 460), row("20261026", 455)], "20261026", 500).state, "full");
});

test("usually full by: the time it was full by on 70 percent of mornings, rounded up to 5 minutes", () => {
  const rows = [458, 461, 455, 470, 452, 466, 480, null, 459, 463].map((t, i) => row(WD[i], t));
  const r = W.usualFull(rows, "20261030", 700);
  assert.equal(r.state, "full"); assert.equal(r.n, 10);
  // Sorted: 452 455 458 459 461 463 466 470 480; the 7th of 10 mornings is 466, so 7:50am.
  assert.equal(r.text, "Usually full by 7:50am on weekdays");
});

test("sometimes full, never full", () => {
  const some = W.usualFull([480, null, null, 500, null, null].map((t, i) => row(WD[i], t)), "20261030", 700);
  assert.equal(some.state, "some"); assert.equal(some.text, "Full by 8:00am on 2 of the last 6 weekdays");
  const none = W.usualFull(WD.slice(0, 6).map((d) => row(d, null)), "20261030", 700);
  assert.equal(none.state, "space"); assert.equal(none.text, "Had spaces every weekday morning lately (6 days)");
});

test("the tick: a quarter of the car parks each weekday morning minute, one row per day, full time once", async () => {
  const env = { TFNSW_API_KEY: "t", DB: makeD1(), ASSETS: { fetch: async () => Response.json({ carparks: [
    { id: "1", name: "A", tsn: "1", spots: 100 }, { id: "2", name: "B", tsn: "2", spots: 100 }, { id: "3", name: "C", tsn: "3", spots: 100 },
    { id: "4", name: "D", tsn: "4", spots: 100 }, { id: "5", name: "E", tsn: "5", spots: 100 },
  ] }) } };
  await W.facSchema(env);
  let used = 60;
  const stamp = () => { const d = new Date(Date.now() + 11 * 3600000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:00`; };
  const fetched = [];
  globalThis.fetch = async (u) => { const id = new URL(String(u)).searchParams.get("facility"); fetched.push(id); return Response.json({ spots: "100", occupancy: { total: String(used) }, MessageDate: stamp() }); };
  const day = W.sydneyNow().day;
  const sn = { dow: 2, tod: 7 * 60 + 1, day };
  W.parkDayMem.clear(); W.parkMem.clear();
  // tod % 4 == 1: car parks at index 1 and 5 (none) -> "2"; index 1 only.
  let r = await W.sampleParking(env, Date.now(), sn);
  assert.deepEqual(fetched, ["2"]); assert.equal(r.writes, 1); assert.equal(r.full, 0);
  // Full on the next reading: the full time is set once; later readings skip it.
  used = 100; W.parkMem.clear(); fetched.length = 0;
  r = await W.sampleParking(env, Date.now(), { ...sn, tod: 7 * 60 + 5 });
  assert.equal(r.full, 1); assert.equal(r.writes, 1);
  fetched.length = 0; W.parkMem.clear();
  r = await W.sampleParking(env, Date.now(), { ...sn, tod: 7 * 60 + 9 });
  assert.deepEqual(fetched, []);
  const rows = await env.DB.prepare("SELECT * FROM park_full").all();
  assert.deepEqual(rows.results.map((x) => [x.facility, x.first_tod, x.full_tod]), [["2", 421, 425]]);
  // Weekends and outside 5 to 11am: nothing read.
  assert.equal(await W.sampleParking(env, Date.now(), { ...sn, dow: 6 }), null);
  assert.equal(await W.sampleParking(env, Date.now(), { ...sn, tod: 11 * 60 }), null);
  // The route adds usual from the rows; a database without the table leaves the car parks as they are.
  const withU = await W.withUsual(env, [{ id: "2" }, { id: "9" }]);
  assert.equal(withU[0].usual.state, "learning"); assert.equal(withU[1].usual.n, 0);
  const bare = await W.withUsual({ DB: makeD1() }, [{ id: "2" }]);
  assert.equal(bare[0].usual, undefined);
});
