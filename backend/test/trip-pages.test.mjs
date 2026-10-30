// Trip pages (the trip list's endless scroll): /api/trip?page=1 with after= and before= cursors, more trips per
// planner call, and the shared window copy of each planner answer (timetable part kept 10 min, live part 15 s).
// Transport for NSW answers are stubbed: a train every 10 minutes, 20 minutes Parramatta to Central.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { efaTrip } from "./helpers/efa.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default, tripWinMem, budget };\n";
const tmp = `/tmp/trip-pages-test-${process.pid}-${Date.now()}.mjs`;
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
const dep = (j) => Date.parse(j.legs.find((l) => l.kind === "transit").planned);
const P = "/api/trip?from=215020&to=200060&page=1";
let tag = 0;
const fresh = () => { W.tripWinMem.clear(); calls.length = 0; delay = null; shift = 0; tag++; };

test("a first page asks the planner once for 10 trips (its most) and gives cursors for the next pages", async () => {
  fresh();
  const r = await get(`${P}&fromName=a${tag}`);
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].get("calcNumberOfTrips"), "10");
  assert.equal(calls[0].get("depArrMacro"), "dep");
  const js = r.body.journeys;
  assert.ok(js.length >= 8, "about 10 trips, gone ones left out: " + js.length);
  for (let i = 1; i < js.length; i++) assert.ok(dep(js[i]) > dep(js[i - 1]), "in time order");
  assert.equal(r.body.page.dir, "first");
  assert.equal(r.body.page.next, dep(js[js.length - 1]));
  assert.equal(r.body.page.prev, dep(js[0]));
  assert.equal(r.body.page.prevArr, dep(js[0]) + RIDE * MIN);
});

test("after= gives the next 10 trips from the last one, with no gap", async () => {
  fresh();
  const a = await get(`${P}&fromName=b${tag}`);
  const b = await get(`${P}&fromName=b${tag}&after=${a.body.page.next}`);
  assert.equal(b.body.page.dir, "later");
  assert.equal(calls.length, 2);
  const first = dep(b.body.journeys[0]);
  assert.equal(first, a.body.page.next, "starts at the last trip shown (the phone drops the one it has)");
  assert.equal(dep(b.body.journeys[1]) - a.body.page.next, EVERY);
  assert.ok(b.body.journeys.length >= 9);
});

test("before= with arr= gives the trips just before the first one shown, ending right there", async () => {
  fresh();
  const a = await get(`${P}&fromName=c${tag}`);
  const e = await get(`${P}&fromName=c${tag}&before=${a.body.page.prev}&arr=${a.body.page.prevArr}`);
  assert.equal(e.body.page.dir, "earlier");
  assert.equal(calls[calls.length - 1].get("depArrMacro"), "arr");
  const js = e.body.journeys;
  assert.ok(js.length >= 9, "a full page earlier: " + js.length);
  assert.ok(js.every((j) => dep(j) < a.body.page.prev));
  assert.equal(a.body.page.prev - dep(js[js.length - 1]), EVERY, "no gap before the first trip shown");
  for (let i = 1; i < js.length; i++) assert.equal(dep(js[i]) - dep(js[i - 1]), EVERY);
});

test("50 trips scrolled cost 6 planner calls, and another phone scrolling the same pair costs none", async () => {
  fresh();
  const seen = new Set();
  // A chosen time (an hour on), so both phones' first pages are the same planner answer whatever the clock does.
  const hh = new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(realNow() + 3600000)).replace(":", "");
  let r = await get(`${P}&fromName=d${tag}&time=${hh}`);
  for (const j of r.body.journeys) seen.add(dep(j));
  while (seen.size < 50) {
    r = await get(`${P}&fromName=d${tag}&after=${r.body.page.next}`);
    for (const j of r.body.journeys) seen.add(dep(j));
  }
  assert.equal(calls.length, 6, "planner calls for " + seen.size + " trips");
  // Another phone (another name in its query, so not the 15 s answer copy): the same pages from the window copy.
  const before = calls.length;
  let s = await get(`${P}&fromName=e${tag}&time=${hh}`);
  s = await get(`${P}&fromName=e${tag}&after=${s.body.page.next}`);
  s = await get(`${P}&fromName=e${tag}&after=${s.body.page.next}`);
  assert.equal(calls.length, before, "shared across phones");
  assert.ok(W.budget.tripWinHits >= 3);
});

test("a kept window keeps the planner's live times only for 15 s, the timetable part for 10 min", async () => {
  fresh();
  delay = 3;
  const first = await get(`${P}&fromName=f${tag}`);
  const after = first.body.page.next;
  calls.length = 0;
  const a = await get(`${P}&fromName=f${tag}&after=${after}`);
  assert.equal(calls.length, 1);
  const l0 = a.body.journeys[1].legs[0];
  assert.equal(l0.realtime, true);
  assert.equal(l0.delayMin, 3);
  // 20 s later, another phone: no planner call, and the 3 min delay is not served as live any more (the feeds have
  // nothing in this test, so the trips show timetable times).
  shift = 20000;
  const b = await get(`${P}&fromName=g${tag}&after=${after}`);
  assert.equal(calls.length, 1, "the kept window answers");
  const l1 = b.body.journeys.find((j) => dep(j) === dep(a.body.journeys[1])).legs[0];
  assert.equal(l1.realtime, false);
  assert.equal(l1.estimated, null);
  assert.equal(l1.delayMin, null);
  // Past 10 minutes the planner is asked again.
  shift = 11 * MIN;
  await get(`${P}&fromName=h${tag}&after=${after}`);
  assert.equal(calls.length, 2, "asked again after 10 min");
  shift = 0;
});

test("windows are kept per options: step free and modes are their own copies", async () => {
  fresh();
  await get(`${P}&fromName=j${tag}`);
  await get(`${P}&fromName=j${tag}&acc=1`);
  await get(`${P}&fromName=j${tag}&modes=train`);
  assert.equal(calls.length, 3);
});

test("cursors must be times in ms, and a page asks nothing more than 7 days back", async () => {
  fresh();
  const bad = await get(`${P}&after=tomorrow`);
  assert.equal(bad.status, 400);
  const old = await get(`${P}&fromName=k${tag}&after=${realNow() - 9 * 86400000}`);
  assert.equal(old.body.page.dir, "first", "a cursor out of range is a first page");
});

test("n= asks the planner for that many trips a page (4 to 20), anything else is the default", async () => {
  fresh();
  const r = await get(`${P}&fromName=n${tag}&n=8`);
  assert.equal(calls[0].get("calcNumberOfTrips"), "8");
  assert.equal(r.body.page.n, 8);
  await get(`${P}&fromName=n${tag}&n=99`);
  assert.equal(calls[1].get("calcNumberOfTrips"), "10");
});

test("a plain trip request is as before (count, no page)", async () => {
  fresh();
  const r = await get(`/api/trip?from=215020&to=200060&count=6&fromName=l${tag}`);
  assert.equal(calls[0].get("calcNumberOfTrips"), "6");
  assert.equal(r.body.page, undefined);
  assert.ok(r.body.journeys.length <= 6);
});
