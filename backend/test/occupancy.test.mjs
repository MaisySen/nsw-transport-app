// Occupancy: departures and trip legs carry occupancy only when Transport for NSW sends it for
// that service ({ level, text }, for example { level: 2, text: "Few seats" }); otherwise null,
// never a guess. The server flag occupancy switches it off everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { efaTrip } from "./helpers/efa.mjs";

const root = new URL("..", import.meta.url).pathname;
let src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default, serverCfg };\n";
const tmp = `/tmp/occ-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const MIN = 60000;
const t0 = Date.now() + 6 * MIN;
const ev = (line, dep, occ) => ({
  location: { id: "2134103", name: "Burwood Station, Platform 3", properties: { platformName: "Platform 3", ...(occ ? { occupancy: occ } : {}) }, parent: { id: "213410", name: "Burwood Station" } },
  departureTimePlanned: new Date(dep).toISOString(), departureTimeEstimated: new Date(dep).toISOString(), isRealtimeControlled: true,
  transportation: { disassembledName: line, number: line, product: { class: 1 }, destination: { name: "Hornsby", id: "1" }, properties: { RealtimeTripId: line + dep } },
  properties: {},
});
let tripAnswer = null;
globalThis.fetch = async (u) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (url.pathname.endsWith("/departure_mon")) return new Response(JSON.stringify({ locations: [{ id: "213410", name: "Burwood Station", disassembledName: "Burwood" }], stopEvents: [ev("T1", t0, "FEW_SEATS"), ev("T9", t0 + 3 * MIN, null), ev("T2", t0 + 5 * MIN, "SOMETHING_NEW")] }));
  if (url.pathname.endsWith("/trip")) return new Response(JSON.stringify(tripAnswer));
  return new Response("{}", { status: 404 });
};
let serverBody = null;
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), run: async () => ({ meta: { changes: 1, last_row_id: 1 } }), all: async () => ({ results: [] }),
  first: async () => (/FROM app_config WHERE platform = 'server'/.test(q) && serverBody ? { body: serverBody } : null) });
const env = { TFNSW_API_KEY: "t", DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) }, ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
let ip = 1;
const get = async (path) => { const r = await W.__default.fetch(new Request("https://t.example" + path, { headers: { "cf-connecting-ip": "10.6.0." + (ip++ % 250) } }), env, { waitUntil() {} }); return { status: r.status, body: await r.json() }; };

test("departures: occupancy when sent, null when not, never a guess", async () => {
  serverBody = null; W.serverCfg.at = 0;
  const r = await get("/api/departures?stop=213410&t=1");
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const by = Object.fromEntries(r.body.items.map((i) => [i.line, i.occupancy]));
  assert.deepEqual(by.T1, { level: 2, text: "Few seats" });
  assert.equal(by.T9, null);
  assert.equal(by.T2, null);  // a value we do not know is not mapped to anything
});

test("trip legs: occupancy when sent, null when not", async () => {
  tripAnswer = efaTrip([[{ from: "burwood", to: "strathfield", dep: t0, delay: 0, occupancy: "MANY_SEATS" }], [{ from: "burwood", to: "strathfield", dep: t0 + 10 * MIN, delay: 0 }]]);
  const r = await get("/api/trip?from=213410&to=213510&t=2");
  assert.deepEqual(r.body.journeys[0].legs[0].occupancy, { level: 1, text: "Many seats" });
  assert.equal(r.body.journeys[1].legs[0].occupancy, null);
  const legs = encodeURIComponent(JSON.stringify([{ f: "213410", fn: "Burwood", t: "213510", tn: "Strathfield" }]));
  const p = await get(`/api/plan?legs=${legs}&t=2`);
  assert.deepEqual(p.body.journeys[0].legs.find((l) => l.kind === "transit").occupancy, { level: 1, text: "Many seats" });
});

test("server flag occupancy off: no occupancy in any answer", async () => {
  serverBody = JSON.stringify({ flags: { occupancy: false } }); W.serverCfg.at = 0;
  const d = await get("/api/departures?stop=213410&t=3");
  assert.ok(d.body.items.length);
  assert.ok(d.body.items.every((i) => i.occupancy === undefined));
  const r = await get("/api/trip?from=213410&to=213510&t=3");
  assert.ok(r.body.journeys[0].legs.every((l) => l.occupancy === undefined));
  // The shared board answer was copied, not changed: with the flag back on it carries occupancy.
  serverBody = null; W.serverCfg.at = 0;
  const again = await get("/api/departures?stop=213410&t=4");
  assert.deepEqual(again.body.items.find((i) => i.line === "T1").occupancy, { level: 2, text: "Few seats" });
});
