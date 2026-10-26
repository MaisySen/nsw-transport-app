// Outage fallback (root's decision, 26 Oct): with the Trip Planner refusing and no copy kept or saved, a stop board is
// the engine's board as timetable times, labelled, and never stored as a copy. Runs offline with a fake data service
// (every call refused), a fake edge cache and a fake board shard.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") +
  "\nexport { __default, engineOutage };\n";
const tmp = `/tmp/outage-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

globalThis.fetch = async () => new Response('{"ErrorDetails":{"Message":"Your API quota or rate limit has been exceeded"}}', { status: 429 });
const edge = new Map();
globalThis.caches = { default: { match: async (req) => (edge.has(String(req.url || req)) ? new Response(edge.get(String(req.url || req))) : undefined), put: async (req, res) => { edge.set(String(req.url || req), await res.text()); }, delete: async () => true } };

const soon = (m) => new Date(Date.now() + m * 60000).toISOString();
function board(feedAt) {
  return {
    stop: { id: "200060", name: "Central Station" }, modes: ["train"], alerts: [],
    items: [
      { mode: "train", line: "T1", dest: "Hornsby", planned: soon(5), estimated: soon(7), realtime: true, delayMin: 2, platform: "Platform 16", stopId: "2000336", tripId: "A", status: { key: "late", text: "2 min late" }, vehicle: { lat: 1, lon: 2 } },
      { mode: "train", line: "T2", dest: "Leppington", planned: soon(9), estimated: null, realtime: false, delayMin: null, platform: "Platform 18", stopId: "2000338", tripId: "B", status: { key: "scheduled", text: "Scheduled" } },
    ],
    live: { feedAt, liveCount: 1, total: 2 }, engine: { builtAt: Date.now(), feeds: ["train"], shard: "nsw-2-b1" },
  };
}
let shardBody = null;
const shard = { fetch: async () => new Response(JSON.stringify(shardBody), { status: 200 }) };
const env = { ENGINE: { idFromName: () => "core", get: () => shard }, SHARDS: { idFromName: (n) => n, get: () => shard } };
const exec = { waitUntil: () => {} };
const url = new URL("https://api.transportsydney.app/api/departures?stop=200060");

test("with old feed data every row is a timetable row, the answer says source timetable and leads with the label", async () => {
  shardBody = board(Date.now() - 10 * 60000);
  const res = await W.engineOutage(new Request(url), env, exec, url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const d = await res.json();
  assert.equal(d.source, "timetable");
  assert.equal(d.alerts[0].title, "Live times unavailable, showing timetable times");
  assert.ok(d.items.length === 2 && d.items.every((i) => i.realtime === false && i.estimated === null && i.status.key === "scheduled" && !i.vehicle));
});

test("feed data under 60 s old keeps a live row, marked liveSource feed", async () => {
  shardBody = board(Date.now() - 20000);
  const u2 = new URL("https://api.transportsydney.app/api/departures?stop=200070");
  const d = await (await W.engineOutage(new Request(u2), env, exec, u2)).json();
  const a = d.items.find((i) => i.tripId === "A");
  assert.equal(a.realtime, true);
  assert.equal(a.liveSource, "feed");
  assert.equal(d.items.find((i) => i.tripId === "B").realtime, false);
});

test("a board for a set time is not answered from the engine", async () => {
  const u = new URL(url + "&time=0830");
  assert.equal(await W.engineOutage(new Request(u), env, exec, u), null);
});

test("the worker serves the fallback when the planner refuses and nothing is kept, and stores no copy of it", async () => {
  shardBody = board(Date.now() - 10 * 60000);
  edge.clear();
  const u = "https://api.transportsydney.app/api/departures?stop=200060&mode=";
  const res = await W.__default.fetch(new Request(u), env, exec);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.source, "timetable");
  assert.ok(![...edge.keys()].some((k) => k.includes("/api/departures")), "no edge copy of a fallback board");
});
