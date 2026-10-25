// Trip legs as the app gets them (Bidur, 26 Oct 8:50 AM, Strathfield to Five Dock Shops): the D400 on demand service
// is flagged as one (booked, not a timetable departure), and each leg's delay is its own live time against its own
// timetable time.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { efaLeg } from "./helpers/efa.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { __default, trip, onDemandOf };\n";
const tmp = `/tmp/trip-legs-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const MIN = 60000;
let answer = { journeys: [] };
globalThis.fetch = async (u) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (url.pathname.endsWith("/trip")) return new Response(JSON.stringify(answer));
  return new Response("{}", { status: 404 });
};

test("on demand: class 10 legs are flagged with booking and operator; other legs are not", () => {
  const t = { product: { class: 10, name: "On Demand" }, operator: { name: "Bridj" }, properties: { attributes: ["BOOKINGREQUIRED", "AREA_ON_DEMAND"] } };
  assert.deepEqual(W.onDemandOf(t), { onDemand: true, booking: true, operator: "Bridj", modeName: "On demand" });
  assert.deepEqual(W.onDemandOf({ product: { class: 5 }, properties: { attributes: [] } }), {});
});

test("trip: the D400 comes through as on demand, the T2 then bus carries the train's own delay", async () => {
  const now = Date.now() + 2 * MIN;
  const d400 = efaLeg({ from: "strathfield", to: "burwood", dep: now, min: 10, line: "D400", cls: 10 });
  d400.transportation.operator = { name: "Bridj" };
  d400.transportation.properties = { attributes: ["BOOKINGREQUIRED", "AREA_ON_DEMAND"] };
  const train = efaLeg({ from: "strathfield", to: "burwood", dep: now - 27 * MIN, delay: 27, min: 2, line: "T2" });
  const bus = efaLeg({ from: "burwood", to: "homebush", dep: now + 8 * MIN, delay: 0, min: 15, line: "530", cls: 5 });
  answer = { journeys: [{ legs: [d400] }, { legs: [train, bus] }] };
  const r = await W.trip({ TFNSW_API_KEY: "t" }, "213510", "G2046100", {});
  const [od, tb] = r.journeys;
  assert.equal(od.legs[0].onDemand, true);
  assert.equal(od.legs[0].booking, true);
  assert.equal(od.legs[0].operator, "Bridj");
  assert.equal(od.legs[0].realtime, false);
  assert.equal(tb.legs[0].onDemand, undefined);
  assert.equal(tb.legs[0].delayMin, 27);
  assert.equal(tb.legs[1].delayMin, 0);
  assert.equal(Date.parse(tb.legs[0].estimated), now);
});
