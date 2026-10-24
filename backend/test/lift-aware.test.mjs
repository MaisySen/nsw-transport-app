// Lift aware routing: /api/trip and /api/plan with acc=1 drop a trip that uses a station with a
// lift out of service when another trip avoids it, and put trips that are step free at every
// station first. Uses the real station access data; Transport for NSW answers are stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { efaTrip, liftInfo } from "./helpers/efa.mjs";

const root = new URL("..", import.meta.url).pathname;
let src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default, liftMem, serverCfg, liftAwareRank };\n";
const tmp = `/tmp/liftaware-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const MIN = 60000;
const t0 = Date.now() + 10 * MIN;
let lifts = [];
let tripAnswer = null;
const tripCalls = [];
globalThis.fetch = async (u) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (url.pathname.endsWith("/add_info")) return new Response(JSON.stringify({ infos: { current: lifts } }));
  if (url.pathname.endsWith("/trip")) { tripCalls.push(url.searchParams); return new Response(JSON.stringify(tripAnswer)); }
  return new Response("{}", { status: 404 });
};
let serverBody = null;
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), run: async () => ({ meta: { changes: 1, last_row_id: 1 } }), all: async () => ({ results: [] }),
  first: async () => (/FROM app_config WHERE platform = 'server'/.test(q) && serverBody ? { body: serverBody } : null) });
const env = {
  TFNSW_API_KEY: "t",
  DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) },
  ASSETS: { fetch: async (req) => { const p = root + "src/public" + new URL(req.url).pathname; return fs.existsSync(p) ? new Response(fs.readFileSync(p)) : new Response("", { status: 404 }); } },
};
let ip = 1;
const get = async (path) => { const r = await W.__default.fetch(new Request("https://t.example" + path, { headers: { "cf-connecting-ip": "10.8.0." + (ip++ % 250) } }), env, { waitUntil() {} }); return { status: r.status, body: await r.json() }; };
const fresh = (outages, body = null) => { lifts = outages; W.liftMem.list = null; W.liftMem.at = 0; serverBody = body; W.serverCfg.at = 0; };

// Three ways from Burwood to Kings Cross: via Redfern (not step free), via Central, via Town Hall.
const viaRedfern = [{ from: "burwood", to: "redfern", dep: t0, min: 12 }, { line: "T4", from: "redfern", to: "kingscross", dep: t0 + 16 * MIN, min: 7 }];
const viaCentral = [{ from: "burwood", to: "central", dep: t0 + 4 * MIN, min: 13 }, { line: "T4", from: "central", to: "kingscross", dep: t0 + 21 * MIN, min: 6 }];
const viaTownHall = [{ from: "burwood", to: "townhall", dep: t0 + 8 * MIN, min: 16 }, { line: "T4", from: "townhall", to: "kingscross", dep: t0 + 28 * MIN, min: 5 }];
const firstChange = (j) => j.legs.filter((l) => l.kind === "transit")[0].to;

test("acc=1 drops the trip through a station with a lift out and puts step free trips first", async () => {
  fresh([liftInfo("200060")]);
  tripAnswer = efaTrip([viaRedfern, viaCentral, viaTownHall]);
  const r = await get("/api/trip?from=213410&to=201110&acc=1");
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const order = r.body.journeys.map(firstChange);
  assert.deepEqual(order, ["Town Hall", "Redfern"]);
  assert.equal(r.body.journeys[0].stepFree, true);
  assert.equal(r.body.journeys[1].stepFree, false);
  assert.deepEqual(r.body.liftAware, { avoided: 1, allAffected: false, stations: ["Central"] });
  assert.equal(r.body.accessible, true);
  // The Trip Planner was asked for step free trips, and for a few more than shown.
  const q = tripCalls[tripCalls.length - 1];
  assert.equal(q.get("wheelchair"), "on");
  assert.equal(q.get("calcNumberOfTrips"), "8");
});

test("count is kept after ranking", async () => {
  fresh([]);
  tripAnswer = efaTrip([viaRedfern, viaCentral, viaTownHall]);
  const r = await get("/api/trip?from=213410&to=201110&acc=1&count=1");
  assert.equal(r.body.journeys.length, 1);
  assert.equal(firstChange(r.body.journeys[0]), "Central");
  assert.equal(r.body.liftAware.avoided, 0);
});

test("when every trip meets a lift outage, they are all kept and each says where", async () => {
  fresh([liftInfo("201110")]);
  tripAnswer = efaTrip([viaCentral, viaTownHall]);
  const r = await get("/api/trip?from=213410&to=201110&acc=1&t=3");
  assert.equal(r.body.journeys.length, 2);
  assert.equal(r.body.liftAware.allAffected, true);
  for (const j of r.body.journeys) assert.equal(j.liftOutages[0].name, "Kings Cross");
});

test("an escalator outage does not count as a lift outage", async () => {
  fresh([liftInfo("200060", "ESCALATOR", "Escalator 3 is not available")]);
  tripAnswer = efaTrip([viaCentral, viaTownHall]);
  const r = await get("/api/trip?from=213410&to=201110&acc=1&t=4");
  assert.equal(r.body.journeys.length, 2);
  assert.equal(r.body.liftAware.avoided, 0);
});

test("without acc=1, or with the flag off, trips are left in time order", async () => {
  fresh([liftInfo("200060")]);
  tripAnswer = efaTrip([viaRedfern, viaCentral, viaTownHall]);
  const plain = await get("/api/trip?from=213410&to=201110");
  assert.deepEqual(plain.body.journeys.map(firstChange), ["Redfern", "Central", "Town Hall"]);
  assert.equal(plain.body.liftAware, undefined);
  fresh([liftInfo("200060")], JSON.stringify({ flags: { liftAwareRouting: false } }));
  const off = await get("/api/trip?from=213410&to=201110&acc=1&x=off");
  assert.deepEqual(off.body.journeys.map(firstChange), ["Redfern", "Central", "Town Hall"]);
  assert.equal(off.body.liftAware, undefined);
  fresh([]);
});

test("/api/plan with acc=1 is lift aware too", async () => {
  fresh([liftInfo("201510")]);
  tripAnswer = efaTrip([viaRedfern, viaTownHall]);
  const legs = encodeURIComponent(JSON.stringify([{ f: "213410", fn: "Burwood", t: "201110", tn: "Kings Cross" }]));
  const r = await get(`/api/plan?legs=${legs}&acc=1`);
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  assert.deepEqual(r.body.journeys.map(firstChange), ["Town Hall"]);
  assert.equal(r.body.liftAware.avoided, 1);
});

test("a bus from the street outside a station is not held back by the station lift", async () => {
  fresh([liftInfo("200060")]);
  const busViaCentral = [{ line: "311", cls: 5, from: "burwood", to: "central", dep: t0 + 2 * MIN, min: 30 }, { line: "324", cls: 5, from: "central", to: "kingscross", dep: t0 + 35 * MIN, min: 10 }];
  tripAnswer = efaTrip([busViaCentral, viaCentral]);
  const r = await get("/api/trip?from=213410&to=201110&acc=1&t=7");
  assert.deepEqual(r.body.journeys.map((j) => j.legs.find((l) => l.kind === "transit").line), ["311"]);
  assert.deepEqual(r.body.journeys[0].liftOutages, []);
  assert.equal(r.body.liftAware.avoided, 1);
});
