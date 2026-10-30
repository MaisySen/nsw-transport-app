// Trips from or to a position (Current location, Get me home: lon:lat:EPSG:4326) skip the shared 10 min trip window
// (tripWinSkip, 31 Oct): a moving phone never gets a kept answer for another point, and the point is not held.
// Stop to stop trips keep the window as before. The answer's shape is unchanged for every build.
// Transport for NSW answers are stubbed: a train every 10 minutes, 20 minutes Parramatta to Central.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { efaTrip } from "./helpers/efa.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default, tripWinMem, budget, tripWinSkip };\n";
const tmp = `/tmp/trip-point-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const MIN = 60000;
const realNow = Date.now;
let shift = 0;
Date.now = () => realNow() + shift;
const EVERY = 10 * MIN, RIDE = 20;
const base = Math.floor(realNow() / EVERY) * EVERY - 6 * 3600000; // the timetable's grid
let delay = null;
const calls = [];
// Sydney wall clock (itdDate, itdTime) to ms.
function sydMs(d, t) {
  const guess = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4));
  for (const off of [10, 11]) {
    const x = guess - off * 3600000;
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(x)).replace(":", "");
    if (f === t) return x;
  }
  return guess - 11 * 3600000;
}
globalThis.fetch = async (u) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (url.pathname.endsWith("/trip")) {
    const q = url.searchParams;
    calls.push(q);
    const n = Number(q.get("calcNumberOfTrips"));
    const at = sydMs(q.get("itdDate"), q.get("itdTime"));
    let deps = [];
    if (q.get("depArrMacro") === "arr") {
      // The n trips that get there by `at`, latest first found.
      let d = Math.floor((at - RIDE * MIN - base) / EVERY) * EVERY + base;
      for (let i = 0; i < n; i++, d -= EVERY) deps.unshift(d);
    } else {
      let d = Math.ceil((at - base) / EVERY) * EVERY + base;
      for (let i = 0; i < n; i++, d += EVERY) deps.push(d);
    }
    return new Response(JSON.stringify(efaTrip(deps.map((dep) => [{ from: "parramatta", to: "central", dep, min: RIDE, delay, trip: "t" + dep }]))));
  }
  return new Response("{}", { status: 404 });
};
const env = {
  TFNSW_API_KEY: "t",
  ASSETS: { fetch: async (req) => { const p = root + "src/public" + new URL(req.url).pathname; return fs.existsSync(p) ? new Response(fs.readFileSync(p)) : new Response("", { status: 404 }); } },
};
let ip = 1;
const get = async (path) => {
  const r = await W.__default.fetch(new Request("https://t.example" + path, { headers: { "cf-connecting-ip": "10.9.0." + (ip++ % 250) } }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json() };
};
const PT = "151.18066:-33.79677:EPSG:4326"; // a Chatswood fixture, as app/test/fromloc.test.mjs
let tag = 0;
const fresh = () => { W.tripWinMem.clear(); calls.length = 0; delay = null; shift = 0; tag++; };
// A chosen time an hour on, so two asks are the same planner answer whatever the clock does.
const hh = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(realNow() + 3600000)).replace(":", "");

test("tripWinSkip: a position at either end skips the window, stop ids and place names do not", () => {
  assert.equal(W.tripWinSkip(PT, "200060"), true);
  assert.equal(W.tripWinSkip("200060", PT), true);
  assert.equal(W.tripWinSkip("-33.8:151.2:EPSG:4326".replace("-33.8:151.2", "151.2:-33.8"), "x"), true);
  assert.equal(W.tripWinSkip("215020", "200060"), false);
  assert.equal(W.tripWinSkip("", null), false);
  assert.equal(W.tripWinSkip("151.2:-33.8", "200060"), false, "not a planner point without EPSG:4326");
});

test("a trip page from Current location asks the planner every time and keeps nothing", async () => {
  fresh();
  const P = `/api/trip?from=${encodeURIComponent(PT)}&to=200060&page=1&time=${hh()}`;
  const a = await get(`${P}&fromName=Current%20location&n1=${tag}`);
  assert.equal(a.status, 200, JSON.stringify(a.body).slice(0, 300));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].get("type_origin"), "coord");
  assert.equal(W.tripWinMem.size, 0, "the point is not kept");
  // Another ask for the same point and time (another phone, or the same phone a moment later): asked again.
  const b = await get(`${P}&fromName=Current%20location&n2=${tag}`);
  assert.equal(b.status, 200);
  assert.equal(calls.length, 2, "no kept window for a position");
  assert.equal(W.tripWinMem.size, 0);
  // The answer has the same shape as a stop to stop page: journeys and the page cursors.
  assert.ok(a.body.journeys.length >= 8);
  assert.equal(a.body.page.dir, "first");
  assert.equal(typeof a.body.page.next, "number");
  assert.equal(a.body.kind, "trip");
});

test("a trip page to Current location keeps nothing either", async () => {
  fresh();
  const P = `/api/trip?from=215020&to=${encodeURIComponent(PT)}&page=1&time=${hh()}`;
  await get(`${P}&n1=${tag}`);
  await get(`${P}&n2=${tag}`);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].get("type_destination"), "coord");
  assert.equal(W.tripWinMem.size, 0);
});

test("stop to stop pages still share the 10 min window (unchanged)", async () => {
  fresh();
  const P = `/api/trip?from=215020&to=200060&page=1&time=${hh()}`;
  await get(`${P}&fromName=s${tag}`);
  await get(`${P}&fromName=t${tag}`);
  assert.equal(calls.length, 1, "the second phone gets the kept window");
  assert.equal(W.tripWinMem.size, 1);
});
