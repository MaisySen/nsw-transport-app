// Outage trips to a last stop (28 Oct 2026, plan-28oct "Open bugs"): the board engine's timetable kept no row at a
// trip's last stop (nobody boards there), so with the Trip Planner down a trip to a terminus had no timetable answer.
// build_timetable.py now keeps those rows apart (stop id plus "~a", arrival time) and the outage planner ends trips on
// them; boards never read them. Real pipeline here: a tiny GTFS bundle per mode, built by tools/build_timetable.py,
// loaded into the board engine object (real SQLite), then /ttplan, /board, /trip and /api/trip. Every Transport for
// NSW call is refused (429); no outside request is made.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine, BoardShard \};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/ttplan.js", "utf8") +
  "\nexport { __default, ttPlan, engCands, engDayKey, BoardEngine };\n";
const tmp = `/tmp/outage-terminus-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

let nswCalls = 0;
globalThis.fetch = async () => { nswCalls++; return new Response('{"ErrorDetails":{"Message":"Your API quota or rate limit has been exceeded"}}', { status: 429 }); };
const edge = new Map();
globalThis.caches = { default: { match: async (req) => (edge.has(String(req.url || req)) ? new Response(edge.get(String(req.url || req))) : undefined), put: async (req, res) => { edge.set(String(req.url || req), await res.text()); }, delete: async () => true } };

// ---- a small network, times from now (Sydney service day) ----
const day = W.engDayKey(Date.now());
const sydMidnight = (() => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).reduce((o, x) => ((o[x.type] = x.value), o), {}); return Math.floor(Date.now() / 1000) - (Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second)); })();
const nowS = Math.floor(Date.now() / 1000);
const hms = (min) => { const s = nowS + Math.round(min * 60) - sydMidnight; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return [h, m, x].map((v) => String(v).padStart(2, "0")).join(":"); };

// One bundle per feed: stops [id, name, parent, platform code, lat, lon], routes [id, short name, type], trips
// [trip id, route id, headsign, [[stop id, arrival min, departure min, pickup type, drop off type], ...]].
const csv = (rows) => rows.map((r) => r.map((v) => (/[,"]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v))).join(",")).join("\n") + "\n";
function bundle(stops, routes, trips) {
  const ymd = day;
  return {
    "agency.txt": csv([["agency_id", "agency_name", "agency_url", "agency_timezone"], ["X", "Test", "https://example.org", "Australia/Sydney"]]),
    "calendar.txt": csv([["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"], ["ALL", 1, 1, 1, 1, 1, 1, 1, "20200101", "20991231"]]),
    "calendar_dates.txt": csv([["service_id", "date", "exception_type"], ["ALL", ymd, 1]]),
    "routes.txt": csv([["route_id", "agency_id", "route_short_name", "route_long_name", "route_desc", "route_type", "route_color"], ...routes.map((r) => [r[0], "X", r[1], r[1] + " line", "", r[2], "336699"])]),
    "stops.txt": csv([["stop_id", "stop_name", "parent_station", "platform_code", "stop_lat", "stop_lon"], ...stops]),
    "trips.txt": csv([["route_id", "service_id", "trip_id", "trip_headsign"], ...trips.map((t) => [t[1], "ALL", t[0], t[2]])]),
    "stop_times.txt": csv([["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "pickup_type", "drop_off_type"],
      ...trips.flatMap((t) => t[3].map((s, i) => [t[0], hms(s[1]), hms(s[2] != null ? s[2] : s[1]), s[0], i + 1, s[3] || 0, s[4] || 0]))]),
  };
}
const every = (n, gap, start, make) => Array.from({ length: n }, (_, i) => make(i, start + i * gap));
const feeds = {
  // Ferry: Harbour Wharf (first stop) to Point Wharf (last stop), and back from Point Wharf.
  ferry: bundle(
    [["HW", "Harbour Wharf", "", "", -33.86, 151.21], ["MW", "Mid Wharf", "", "", -33.84, 151.24], ["PW", "Point Wharf", "", "", -33.80, 151.28]],
    [["F9", "F9", 4]],
    [...every(3, 20, 3, (i, t) => ["f9out" + i, "F9", "Point Wharf", [["HW", t], ["MW", t + 10], ["PW", t + 22, t + 22]]]),
     ...every(3, 20, 8, (i, t) => ["f9back" + i, "F9", "Harbour Wharf", [["PW", t], ["MW", t + 12], ["HW", t + 22]]])]),
  buses: bundle(
    [["L0", "Loop Rd at Depot", "", "", -33.90, 151.10], ["L1", "Loop Rd at Park", "", "", -33.901, 151.11], ["L2", "Loop Rd at Shops", "", "", -33.905, 151.105],
     ["S0", "Main St at Bridge", "", "", -33.95, 151.0], ["IX", "Testfield Interchange", "", "", -33.97, 151.02], ["IXA", "Testfield Interchange, Stand A", "IX", "", -33.97, 151.02],
     ["IXB", "Testfield Interchange, Stand B", "IX", "", -33.97, 151.021], ["Q1", "Coast Rd at Beach", "", "", -33.7, 151.3], ["SD", "Coast Rd set down", "", "", -33.71, 151.31],
     ["PU", "Coast Rd pick up", "", "", -33.72, 151.32], ["Q9", "Coast Rd at Cape", "", "", -33.73, 151.33]],
    [["990", "990", 700], ["610", "610", 700], ["611", "611", 700], ["700", "700", 700]],
    [// A loop: starts and ends at the depot stop.
     ...every(2, 15, 2, (i, t) => ["loop" + i, "990", "Loop", [["L0", t], ["L1", t + 4], ["L2", t + 8], ["L0", t + 13, t + 13]]]),
     // Two lines that both end at the interchange, at different stands.
     ...every(2, 20, 4, (i, t) => ["r610_" + i, "610", "Testfield Interchange", [["S0", t], ["IXA", t + 11]]]),
     ...every(2, 20, 9, (i, t) => ["r611_" + i, "611", "Testfield Interchange", [["S0", t], ["IXB", t + 9]]]),
     // Set down only before the last stop, and a pick up only stop where nobody gets off.
     ["c700", "700", "Cape", [["Q1", 5], ["PU", 8, 8, 0, 1], ["SD", 12, 12, 1, 0], ["Q9", 16]]]]),
  sydneytrains: bundle(
    [["UP", "Upton Station", "", "", -33.8, 151.0], ["UP1", "Upton Station Platform 1", "UP", "1", -33.8, 151.0],
     ["HB", "Hubton Station", "", "", -33.85, 151.05], ["HB1", "Hubton Station Platform 1", "HB", "1", -33.85, 151.05], ["HB2", "Hubton Station Platform 2", "HB", "2", -33.85, 151.05],
     ["ZE", "Zedfield Station", "", "", -33.9, 151.1], ["ZE1", "Zedfield Station Platform 1", "ZE", "1", -33.9, 151.1]],
    [["T9", "T9", 2], ["T8", "T8", 2]],
    // T9 ends at Hubton; T8 starts at Hubton and ends at Zedfield.
    [...every(2, 15, 3, (i, t) => ["t9_" + i, "T9", "Hubton", [["UP1", t], ["HB1", t + 10]]]),
     ...every(3, 15, 18, (i, t) => ["t8_" + i, "T8", "Zedfield", [["HB2", t], ["ZE1", t + 12]]])]),
  metro: bundle([["MA", "Metroton Station", "", "", -33.7, 150.9], ["ME", "Metro End Station", "", "", -33.69, 150.88]], [["M9", "M9", 401]],
    every(3, 4, 2, (i, t) => ["m9_" + i, "M9", "Metro End", [["MA", t], ["ME", t + 6]]])),
  lr_cse: bundle([["RA", "Tram Square", "", "", -33.88, 151.2], ["RE", "Tram End", "", "", -33.9, 151.24]], [["L9", "L9", 0]],
    every(3, 8, 1, (i, t) => ["l9_" + i, "L9", "Tram End", [["RA", t], ["RE", t + 14]]])),
};

// ---- build with tools/build_timetable.py, then load into the engine object ----
const work = fs.mkdtempSync(path.join(os.tmpdir(), "terminus-"));
const gtfs = path.join(work, "gtfs"), out = path.join(work, "tt");
fs.mkdirSync(gtfs);
fs.writeFileSync(path.join(work, "bundles.json"), JSON.stringify(feeds));
const zip = spawnSync("python3", ["-c", "import json,sys,zipfile,os\nb=json.load(open(sys.argv[1]))\nfor n,f in b.items():\n  z=zipfile.ZipFile(os.path.join(sys.argv[2],n+'.zip'),'w')\n  [z.writestr(k,v) for k,v in f.items()]\n  z.close()", path.join(work, "bundles.json"), gtfs], { encoding: "utf8" });
assert.equal(zip.status, 0, zip.stderr);
const built = spawnSync("python3", [root + "tools/build_timetable.py", gtfs, out, day, "1"], { encoding: "utf8", env: { ...process.env, TZ: "Australia/Sydney" } });
assert.equal(built.status, 0, built.stderr);
const meta = JSON.parse(fs.readFileSync(path.join(out, "meta.json"), "utf8"));
const days = zlib.gunzipSync(fs.readFileSync(path.join(out, "days.ndjson.gz"))).toString().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const tripsNd = zlib.gunzipSync(fs.readFileSync(path.join(out, "trips.ndjson.gz"))).toString();
fs.rmSync(work, { recursive: true, force: true });
const line = (s) => days.find((o) => o.s === s);

function fakeState() {
  const db = new DatabaseSync(":memory:");
  let alarm = null;
  return { storage: {
    sql: { exec(q, ...args) { if (/^\s*(SELECT)/i.test(q)) { const r = db.prepare(q).all(...args); return { toArray: () => r }; } if (args.length) db.prepare(q).run(...args); else db.exec(q); return { toArray: () => [] }; } },
    getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; },
  } };
}
async function load(dayLines) {
  const E = new W.BoardEngine(fakeState(), { TFNSW_API_KEY: "k" });
  const post = (p, body) => E.fetch(new Request("https://engine" + p, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
  await post("/load/begin", meta);
  await post("/load/stops", Object.entries(meta.stops).map(([id, s]) => [id, s[0], s[1], s[2], s[3], s[4]]));
  await post("/load/days", dayLines.map((o) => JSON.stringify(o)).join("\n"));
  await post("/load/trips", tripsNd);
  const c = await (await post("/load/commit", {})).json();
  assert.equal(c.ver, 1);
  return E;
}
const E = await load(days);
// The same build with the arrival only lines taken out: a timetable as built before 28 Oct.
const Eold = await load(days.filter((o) => !o.s.endsWith("~a")));
const plan = async (eng, from, to, extra = "") => (await eng.fetch(new Request(`https://engine/ttplan?from=${from}&to=${to}&at=${Date.now() - 60000}${extra}`))).json();
const trips = (r) => r.journeys.map((j) => j.map((l) => l.tripId).join(">"));

test("the build keeps a last stop's and a set down only stop's rows apart, with the arrival time, and marks rows where nobody gets off", () => {
  // Board rows: never the last stop, never a set down only stop.
  assert.equal(line("PW").r.every((r) => r[1].startsWith("f9back")), true);
  assert.equal(line("SD"), undefined);
  assert.equal(line("IXA"), undefined);
  // Arrival only rows, under the stop id plus ~a.
  assert.deepEqual(line("PW~a").r.map((r) => r[1]), ["f9out0", "f9out1", "f9out2"]);
  assert.deepEqual(line("SD~a").r.map((r) => r[1]), ["c700"]);
  assert.deepEqual(line("Q9~a").r.map((r) => r[1]), ["c700"]);
  assert.deepEqual(line("L0~a").r.map((r) => r[4]), [4, 4], "the loop's arrival at its own first stop, at the last stop sequence");
  assert.deepEqual(line("L0").r.map((r) => r[4]), [1, 1]);
  // A pick up only row carries a 6th value 1; other rows keep the five values old engines read.
  assert.deepEqual(line("PU").r[0].slice(5), [1]);
  assert.equal(line("Q1").r[0].length, 5);
  // A stop that is only ever a last stop is still in the stop list (its station too).
  assert.ok(meta.stops.IXA && meta.stops.IXB && meta.stops.IX && meta.stops.ZE1);
  assert.equal(meta.feeds.ferry.alight, 6, "one last stop per ferry trip, both ways");
});

test("every mode: a trip to the line's last stop has timetable trips (none before the fix)", async () => {
  for (const [from, to, line, mode] of [["HW", "PW", "F9", "ferry"], ["MA", "ME", "M9", "metro"], ["RA", "RE", "L9", "lightrail"], ["S0", "IX", "610", "bus"], ["UP", "HB", "T9", "train"]]) {
    const r = await plan(E, from, to);
    assert.ok(r.journeys.length >= 2, `${mode}: ${from} to ${to}`);
    const l = r.journeys[0][0];
    assert.equal(l.line, line); assert.equal(l.mode, mode); assert.equal(l.realtime, false); assert.equal(l.source, "timetable");
    assert.equal((await plan(Eold, from, to)).journeys.length, 0, `${mode}: an old timetable has no answer, as in the bug`);
  }
  const r = await plan(E, "HW", "PW");
  assert.deepEqual(trips(r), ["f9out0", "f9out1", "f9out2"]);
  assert.equal(new Date(r.journeys[0][0].arrPlanned) - new Date(r.journeys[0][0].planned), 22 * 60000, "arrival at the last stop is its own arrival time");
  assert.equal(r.journeys[0][0].stops, 2);
});

test("a trip from a first stop that is also a last stop boards only services leaving there, never one arriving", async () => {
  const r = await plan(E, "PW", "HW");
  assert.ok(r.journeys.length >= 2);
  assert.ok(r.journeys.every((j) => j[0].tripId.startsWith("f9back")));
  const r2 = await plan(E, "HW", "MW");
  assert.ok(r2.journeys.every((j) => j[0].tripId.startsWith("f9out")));
  // Nothing leaves a set down only stop or a stop that is only ever a last stop.
  assert.equal((await plan(E, "SD", "Q9")).journeys.length, 0);
  assert.equal((await plan(E, "IXA", "S0")).journeys.length, 0);
});

test("a loop: back to where it began ends at the loop's last call, and from the first stop works", async () => {
  const r = await plan(E, "L1", "L0");
  assert.deepEqual(trips(r), ["loop0", "loop1"]);
  const l = r.journeys[0][0];
  assert.equal(new Date(l.arrPlanned) - new Date(l.planned), 9 * 60000, "L1 at +6, back at the depot at +15");
  assert.equal(l.stops, 2);
  const r2 = await plan(E, "L0", "L2");
  assert.deepEqual(trips(r2), ["loop0", "loop1"]);
  assert.equal(new Date(r2.journeys[0][0].arrPlanned) - new Date(r2.journeys[0][0].planned), 8 * 60000);
});

test("a last stop served by more than one line: the station's every line, each to its own stand", async () => {
  const r = await plan(E, "S0", "IX", "&count=8");
  assert.deepEqual(r.journeys.map((j) => j[0].line), ["610", "611", "610", "611"]);
  assert.deepEqual(r.journeys.map((j) => j[0].toStopId), ["IXA", "IXB", "IXA", "IXB"]);
  assert.equal(r.to.name, "Testfield Interchange");
  // One stand alone gives only its own line.
  assert.deepEqual([...new Set((await plan(E, "S0", "IXB")).journeys.map((j) => j[0].line))], ["611"]);
});

test("set down only and pick up only stops: a trip can end where only setting down is allowed, never where nobody gets off", async () => {
  assert.deepEqual(trips(await plan(E, "Q1", "SD")), ["c700"]);
  assert.equal((await plan(E, "Q1", "PU")).journeys.length, 0);
  assert.deepEqual(trips(await plan(E, "PU", "Q9")), ["c700"], "boarding where nobody gets off is fine");
});

test("one change at a station where the first service ends, then on to the second service's last stop", async () => {
  const r = await plan(E, "UP", "ZE");
  assert.ok(r.journeys.length >= 1);
  for (const j of r.journeys) {
    assert.deepEqual(j.map((l) => l.line), ["T9", "T8"]);
    assert.equal(j[0].to, "Hubton Station"); assert.equal(j[1].from, "Hubton Station"); assert.equal(j[1].to, "Zedfield Station");
    assert.ok(new Date(j[1].planned) - new Date(j[0].arrPlanned) >= 4 * 60000);
  }
  // T9 at +3 reaches Hubton +13, T8 +18; T9 at +18 reaches +28, T8 +33.
  assert.deepEqual(trips(r), ["t9_0>t8_0", "t9_1>t8_1"]);
});

test("boards never show a service ending at the stop, and the arrival only rows reach no board", async () => {
  const b = await (await E.fetch(new Request("https://engine/board?stop=PW"))).json();
  assert.ok(b.items.length >= 1);
  assert.ok(b.items.every((i) => i.tripId.startsWith("f9back")), "only services leaving Point Wharf");
  assert.equal((await E.fetch(new Request("https://engine/board?stop=IX"))).status, 404, "a stop where every service ends has no board, as before");
  const L0 = await (await E.fetch(new Request("https://engine/board?stop=L0"))).json();
  assert.equal(L0.items.length, 2, "the loop's start, once per trip");
  // engCands without alight (boards, windows, shards) gives the five value rows only.
  const now = Date.now();
  const src = { stop: () => ["x"], children: () => [], days: () => ({ [day]: sydMidnight }), rows: (id) => (id === "P" ? [[nowS - sydMidnight + 60, "t", 0, 0, 1, 1]] : id === "P~a" ? [[nowS - sydMidnight + 120, "u", 0, 0, 9]] : null) };
  assert.deepEqual(W.engCands(src, "P", now - 60000, now + 600000).map((c) => c[1]), ["t"]);
  assert.equal(W.engCands(src, "P", now - 60000, now + 600000)[0].length, 7);
  assert.deepEqual(W.engCands(src, "P", now - 60000, now + 600000, true).map((c) => [c[1], c[7], c[8]]), [["t", 0, 1], ["u", 1, 0]]);
});

test("a train's stop list from the timetable gives its last stop a planned time", async () => {
  const t = await (await E.fetch(new Request("https://engine/trip?trip=t9_0"))).json();
  assert.deepEqual(t.stops.map((s) => s.id), ["UP1", "HB1"]);
  assert.ok(t.stops.every((s) => s.planned != null));
  assert.equal(t.stops[1].planned - t.stops[0].planned, 10 * 60000);
  const old = await (await Eold.fetch(new Request("https://engine/trip?trip=t9_0"))).json();
  assert.equal(old.stops[1].planned, null);
});

test("/api/trip to a last stop with the Trip Planner refused: 200, labelled timetable trips, no Transport for NSW answer used", async () => {
  edge.clear();
  const env = { ENGINE: { idFromName: () => "core", get: () => ({ fetch: (u, init) => E.fetch(u instanceof Request ? u : new Request(u, init)) }) } };
  const res = await W.__default.fetch(new Request("https://api.transportsydney.app/api/trip?from=HW&to=PW"), env, { waitUntil: () => {} });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.source, "timetable");
  assert.equal(d.fallback, "planner-unavailable");
  assert.equal(d.alerts[0].title, "Live trips unavailable, showing timetable times");
  assert.ok(d.journeys.length >= 2);
  assert.equal(d.journeys[0].legs.find((l) => l.kind === "transit").to, "Point Wharf");
  assert.ok(d.journeys.every((j) => j.live === false));
  assert.ok(nswCalls >= 1, "the planner was asked and refused");
});
