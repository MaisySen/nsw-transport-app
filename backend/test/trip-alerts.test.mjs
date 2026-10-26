// Saved trip alerts (src/tripalerts.js): a push only when a service alert or planned work touches one of the phone's
// trips, near the time it is travelled. Lines and stops here are made up (L7 a rail line, 610 a bus route) so the
// rules are what is tested, not one route.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./helpers/d1.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/tripalerts.js", "utf8") +
  "\nexport { __default, taClean, taPathOf, taHits, taDue, taOccurrences, taText, processTripAlerts, tripAlertsRoute, alertDigestMem };\n";
const tmp = `/tmp/trip-alerts-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const H = 3600000, MIN = 60000;
// Tuesday 27 Oct 2026 in Sydney (AEDT, UTC+11).
const TUE = (h, m = 0) => Date.parse("2026-10-26T13:00:00Z") + h * H + m * MIN;
const LINES = { lines: { L7: [["s1", "s2", "s3", "s4", "s5", "s6"], ["s6", "s5", "s4", "s3", "s2", "s1"]] }, parent: { "s3p1": "s3", "s5p2": "s5" } };
const BUS = { "610": [{ to: "End", stops: [["b1", "One"], ["b2", "Two"], ["b3", "Three"], ["b4", "Four"]] }] };
const ASSETS = { fetch: async (req) => {
  const u = new URL(req.url).pathname;
  if (u === "/data/lineorder.json") return Response.json(LINES);
  if (u === "/stations/bus/61.json") return Response.json(BUS);
  return new Response("no", { status: 404 });
} };
// Weekdays at 8:00, rail from s2 to s5 (boarding at a platform of s2 is the station's id here), then the 610 b1 to b3.
const TRIP = { n: "To work", f: "s2", t: "b3", legs: [{ l: "L7", m: "train", f: "s2", t: "s5p2" }, { l: "610", m: "bus", f: "b1", t: "b3" }], times: [{ d: [1, 2, 3, 4, 5], m: 480 }] };
const item = (id, extra) => ({ id, h: "Alert " + id, u: null, e: "delays", pl: 0, p: [], l: [], s: [], ...extra });

test("the phone's trips are kept to what matching needs", () => {
  const c = W.taClean([TRIP, { n: "x", legs: [{ l: "", f: "a", t: "b" }] }, null, { n: "y".repeat(90), legs: [{ l: "T9!", m: "train", f: "1", t: "2" }], times: [{ d: [9, 1], m: 2000 }, { d: [0], m: 600 }] }]);
  assert.equal(c.length, 2);
  assert.equal(c[1].n.length, 60);
  assert.deepEqual(c[1].legs[0], { l: "T9", m: "train", f: "1", t: "2" });
  assert.deepEqual(c[1].times, [{ d: [0], m: 600 }]);
});

test("which alerts touch a trip: its line on its stretch, the whole line, or its own stops", () => {
  const paths = [W.taPathOf(LINES.lines.L7, "s2", "s5"), W.taPathOf([["b1", "b2", "b3", "b4"]], "b1", "b3")];
  assert.deepEqual([...paths[0]].sort(), ["s2", "s3", "s4", "s5"]);
  const items = [
    item("mid", { l: ["L7"], s: ["s3p1"], pl: 1 }),       // work at a station in the middle of the ride (platform id)
    item("far", { l: ["L7"], s: ["s6"], pl: 1 }),         // the same line, past where the trip gets off
    item("line", { l: ["L7"] }),                          // the whole line
    item("other", { l: ["L9"], s: ["s3"] }),              // another line at a station the trip passes
    item("stop", { s: ["b1"], e: "stopMoved" }),          // the trip's own bus stop, no line named
    item("bus", { l: ["610"], s: ["b4"] }),               // the bus route after the trip's stop
    item("busmid", { l: ["610"], s: ["b2"] }),            // the bus route on the trip's stretch
  ];
  const hits = W.taHits(items, TRIP, paths, LINES.parent);
  assert.deepEqual(hits.map((h) => h.id), ["mid", "line", "stop", "busmid"]);
});

test("live problems: from an hour before a travel time to two hours after, once a day; none for a trip with no times", () => {
  const h = { id: "d1", planned: false, periods: [] };
  assert.equal(W.taDue(h, TRIP, TUE(7, 30)), "d1|20261027");
  assert.equal(W.taDue(h, TRIP, TUE(6, 30)), null);
  assert.equal(W.taDue(h, TRIP, TUE(10, 30)), null);
  assert.equal(W.taDue(h, TRIP, TUE(7, 30), { "d1|20261027": 1 }), null);
  assert.equal(W.taDue(h, { ...TRIP, times: [] }, TUE(7, 30)), null);
  // An alert that ended before the travel time is not sent.
  assert.equal(W.taDue({ ...h, periods: [[TUE(5), TUE(6, 30)]] }, TRIP, TUE(7, 30)), null);
  // Saturday is not one of this trip's days.
  assert.equal(W.taDue(h, TRIP, TUE(7, 30) + 4 * 24 * H), null);
});

test("planned work: once, from 6pm the evening before the first travel time it touches", () => {
  const thu = [[TUE(24 + 21), TUE(48 + 12)]];  // Wednesday 9pm to Thursday noon
  const p = { id: "w1", planned: true, periods: thu };
  assert.equal(W.taDue(p, TRIP, TUE(7, 30)), null);
  assert.equal(W.taDue(p, TRIP, TUE(24 + 17)), null);
  assert.equal(W.taDue(p, TRIP, TUE(24 + 18, 30)), "w1");
  assert.equal(W.taDue(p, TRIP, TUE(24 + 18, 30), { w1: 1 }), null);
  // Weekend work does not touch a weekday trip.
  assert.equal(W.taDue({ ...p, periods: [[TUE(96), TUE(120)]] }, TRIP, TUE(72 + 19)), null);
  // A trip with no times: the evening before the work starts, never at night.
  const none = { ...TRIP, times: [] };
  const sat = { ...p, periods: [[TUE(96 + 1), TUE(120)]] };   // from Saturday 1am
  assert.equal(W.taDue(sat, none, TUE(72 + 17)), null);
  assert.equal(W.taDue(sat, none, TUE(72 + 18, 10)), "w1");
  assert.equal(W.taDue(sat, none, TUE(72 + 23)), null, "quiet after 10pm");
  assert.equal(W.taDue(sat, none, TUE(96 + 7)), "w1");
});

test("one push for several, with the trip's name", () => {
  const one = W.taText([{ trip: TRIP, hit: { title: "Buses replace trains between s3 and s4.", planned: true } }]);
  assert.deepEqual(one, { title: "To work: Planned work", body: "Buses replace trains between s3 and s4." });
  const two = W.taText([{ trip: TRIP, hit: { title: "Delays", effect: "delays" } }, { trip: TRIP, hit: { title: "x" } }]);
  assert.equal(two.title, "2 changes on your trips");
  assert.equal(two.body, "Delays. And 1 more.");
});

test("turn on, push when due, once, then turn off", async () => {
  const DB = makeD1();
  const env = { DB, ASSETS };
  const digest = (items) => { W.alertDigestMem.items = null; W.alertDigestMem.read = 0; return DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('alert_digest', ?1)").bind(JSON.stringify({ at: Date.now(), items })).run(); };
  const call = (method, body, qs = "") => W.tripAlertsRoute(new Request("https://x/api/trip-alerts" + qs, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), env, new URL("https://x/api/trip-alerts" + qs));
  // The schema exists once the route has run once.
  const off = await (await call("POST", { device: "phone-0001", on: false })).json();
  assert.equal(off.on, false);
  await digest([item("old", { l: ["L7"], e: "delays" })]);
  const on = await (await call("POST", { device: "phone-0001", trips: [TRIP] })).json();
  assert.equal(on.on, true);
  assert.deepEqual(on.now.map((x) => x.id), ["old"], "what already touches the trips is listed, not pushed");
  await digest([item("old", { l: ["L7"], e: "delays" }), item("new", { l: ["610"], e: "detour" }), item("else", { l: ["L9"] })]);
  const pushes = [];
  const notify = async (e, target, n) => { pushes.push({ target, n }); return {}; };
  // Only near a travel time, and everything due at once is one push.
  const r1 = await W.processTripAlerts(env, TUE(3), { notify });
  assert.equal(r1.sent, 0, "3am is not near a travel time");
  const r2 = await W.processTripAlerts(env, TUE(7, 40), { notify });
  assert.equal(r2.sent, 1);
  assert.equal(pushes[0].target.device, "phone-0001");
  assert.ok(pushes[0].n.title.startsWith("To work") || pushes[0].n.title.includes("changes"));
  assert.ok(!JSON.stringify(pushes).includes("Alert else"));
  const r3 = await W.processTripAlerts(env, TUE(7, 50), { notify });
  assert.equal(r3.sent, 0, "sent once");
  const st = await (await call("GET", null, "?device=phone-0001")).json();
  assert.equal(st.on, true);
  await call("POST", { device: "phone-0001", on: false });
  const gone = await (await call("GET", null, "?device=phone-0001")).json();
  assert.equal(gone.on, false);
});
