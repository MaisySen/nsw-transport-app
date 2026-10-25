// One mode on /api/departures (`mode`): the Trip Planner is asked for that mode only (excludedMeans with exclMOT_n
// for every other class), so a station's 40 services are all buses, or all trains, and reach further ahead. No mode
// asks for everything, as before. Bus keeps coach and school bus. An unknown mode asks for everything.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
let src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default, modeOnly };\n";
const tmp = `/tmp/dep-mode-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const MIN = 60000;
const now = Date.now();
const ev = (line, cls, mins) => ({
  location: { id: "213516", name: "Stand G", properties: { platformName: cls === 1 ? "Platform 1" : "Stand G" }, parent: { id: "213510", name: "Strathfield Station" } },
  departureTimePlanned: new Date(now + mins * MIN).toISOString(),
  transportation: { disassembledName: line, number: line, product: { class: cls }, destination: { name: "Somewhere", id: "1" }, properties: {} },
  properties: { RealtimeTripId: line + mins },
});
const asked = [];
globalThis.fetch = async (u) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (url.pathname.endsWith("/departure_mon")) {
    const q = Object.fromEntries(url.searchParams);
    asked.push(q);
    const all = [ev("T1", 1, 2), ev("415", 5, 4), ev("568s", 11, 6), ev("M90", 5, 8), ev("T9", 1, 9)];
    const out = all.filter((e) => q["exclMOT_" + e.transportation.product.class] !== "1");
    return new Response(JSON.stringify({ locations: [{ id: "213510", name: "Strathfield Station", disassembledName: "Strathfield" }], stopEvents: out }));
  }
  return new Response("{}", { status: 404 });
};
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), run: async () => ({ meta: { changes: 1, last_row_id: 1 } }), all: async () => ({ results: [] }), first: async () => null });
const env = { TFNSW_API_KEY: "t", DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) }, ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
let ip = 1;
const get = async (path) => { const r = await W.__default.fetch(new Request("https://t.example" + path, { headers: { "cf-connecting-ip": "10.8.0." + (ip++ % 250) } }), env, { waitUntil() {} }); return { status: r.status, body: await r.json() }; };
const excl = (q) => Object.keys(q).filter((k) => k.startsWith("exclMOT_") && q[k] === "1").map((k) => +k.slice(8)).sort((a, b) => a - b);

test("no mode: the planner is asked for every mode (unchanged)", async () => {
  asked.length = 0;
  const r = await get("/api/departures?stop=213510&n=a");
  assert.equal(r.status, 200);
  assert.equal(asked[0].excludedMeans, undefined);
  assert.deepEqual(excl(asked[0]), []);
  assert.deepEqual(r.body.items.map((i) => i.line), ["T1", "415", "568s", "M90", "T9"]);
});

test("mode=bus: trains, metro, light rail and ferries are left out at the planner; school buses stay", async () => {
  asked.length = 0;
  const r = await get("/api/departures?stop=213510&mode=bus&n=b");
  assert.equal(asked[0].excludedMeans, "checkbox");
  assert.deepEqual(excl(asked[0]), [1, 2, 4, 9]);
  assert.deepEqual(r.body.items.map((i) => i.line), ["415", "568s", "M90"]);
  assert.ok(r.body.items.every((i) => i.mode === "bus"));
});

test("mode=train: only trains are asked for", async () => {
  asked.length = 0;
  const r = await get("/api/departures?stop=213510&mode=train&n=c");
  assert.deepEqual(excl(asked[0]), [2, 4, 5, 7, 9, 11]);
  assert.deepEqual(r.body.items.map((i) => i.line), ["T1", "T9"]);
});

test("modeOnly: an unknown mode asks for everything", () => {
  assert.deepEqual(W.modeOnly(null), {});
  assert.deepEqual(W.modeOnly("hovercraft"), {});
  assert.deepEqual(excl(W.modeOnly("coach")), [1, 2, 4, 5, 9, 11]);
  assert.deepEqual(excl(W.modeOnly("ferry")), [1, 2, 4, 5, 7, 11]);
});
