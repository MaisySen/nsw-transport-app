// Address search (/api/places), coordinates as trip ends, and four Ask fixes from QA part B:
// fare questions, nonsense, the last service sentence and station facilities at bus interchanges.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const root = new URL("..", import.meta.url).pathname;
const read = (p) => fs.readFileSync(root + p, "utf8");

async function load() {
  let src = read("src/worker.js").replace(/export default\s*\{/, "const __default = {");
  src += "\nexport { __default, placesFrom, isCoordId, askFareQ, askLinesWords, askLegOut, askLineName, facBusOnly, askRoute, askV2, askDecorate, ASK_NOT_UNDERSTOOD };\n";
  const tmp = `/tmp/places-test-${process.pid}-${Date.now()}.mjs`;
  fs.writeFileSync(tmp, src);
  try { return await import(tmp); } finally { fs.unlinkSync(tmp); }
}

// Trip Planner stop_finder answers, shaped like the live API (rapidJSON).
const SF = {
  "1 Martin Place": { locations: [
    { id: "poiID:858280056:95301001:-1:No 1 Martin Place:Sydney:No 1 Martin Place:ANY:POI:4889364:3755462:GDAV:nsw", name: "No 1 Martin Place, Sydney", type: "poi", matchQuality: 950, isBest: true, coord: [-33.86760, 151.21070], parent: { name: "Sydney" } },
    { id: "streetID:1500000851:1:95301001:-1:Martin Place:Sydney:Martin Place::Martin Place:2000:ANY:DIVA_SINGLEHOUSE:4889400:3755480:GDAV:nsw", name: "1 Martin Place, Sydney", type: "singlehouse", matchQuality: 900, coord: [-33.86771, 151.20902], parent: { name: "Sydney" } },
    { id: "10101331", name: "Martin Place Station, Sydney", type: "stop", matchQuality: 800, modes: [1], coord: [-33.8679, 151.2113], parent: { name: "Sydney" } },
    { id: "10101331", name: "Martin Place Station, Sydney", type: "stop", matchQuality: 790, modes: [1] },
    { id: "x1", name: "1 Martin Place, Ballarat, Victoria", type: "singlehouse", matchQuality: 700, parent: { name: "Ballarat" } },
  ] },
  "Pitt St": { locations: [
    { id: "streetID:1:Pitt Street:Sydney", name: "Pitt Street, Sydney", type: "street", matchQuality: 900, coord: [-33.87, 151.208], parent: { name: "Sydney" } },
    { id: "G2370172", name: "30 Pitt St, Glen Innes", type: "stop", matchQuality: 500, modes: [5], parent: { name: "Glen Innes" } },
    { id: "streetID:2:Pitt Street:Hornsby", name: "Pitt Street, Hornsby", type: "street", matchQuality: 850, parent: { name: "Hornsby" } },
  ] },
  "asdfgh qwerty": { locations: [
    { id: "2354131", name: "Ashfield Property, Oxley Hwy", type: "stop", matchQuality: 120, modes: [5] },
  ] },
};
const tripCalls = [];
globalThis.fetch = async (u) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (url.pathname.endsWith("/stop_finder")) return new Response(JSON.stringify(SF[url.searchParams.get("name_sf")] || { locations: [] }));
  if (url.pathname.endsWith("/trip")) { tripCalls.push(Object.fromEntries(url.searchParams)); return new Response(JSON.stringify({ journeys: [] })); }
  return new Response("{}", { status: 404 });
};
const env = {
  TFNSW_API_KEY: "test",
  ASSETS: { fetch: async (req) => { const p = root + "src/public" + new URL(req.url).pathname; return fs.existsSync(p) ? new Response(fs.readFileSync(p)) : new Response("", { status: 404 }); } },
};
const W = await load();
const call = async (path) => W.__default.fetch(new Request("https://api.transportsydney.app" + path, { headers: { "cf-connecting-ip": "10.9.8.7" } }), env, { waitUntil() {} });

test("/api/places returns addresses, landmarks and stops with a kind, NSW only, no duplicates", async () => {
  const r = await call("/api/places?q=" + encodeURIComponent("1 Martin Place"));
  assert.equal(r.status, 200);
  const { items } = await r.json();
  assert.deepEqual(items.map((i) => i.kind), ["place", "address", "stop"]);
  assert.equal(items[0].name, "No 1 Martin Place");
  assert.ok(items[0].id.startsWith("poiID:"), "the planner's own id, usable as a trip end");
  assert.equal(items[0].lat, -33.8676);
  assert.equal(items[0].lon, 151.2107);
  assert.equal(items[2].id, "10101331");
  assert.ok(!items.some((i) => /Ballarat/.test(i.name)), "Victoria is left out");
  assert.ok(Array.isArray(items[2].modes));
});

test("/api/places: streets keep their suburb, sorted by the planner's match", async () => {
  const { items } = await (await call("/api/places?q=Pitt%20St")).json();
  assert.deepEqual(items.map((i) => [i.kind, i.name]), [["street", "Pitt Street"], ["street", "Pitt Street, Hornsby"], ["stop", "30 Pitt St, Glen Innes"]]);
  assert.equal(items[0].area, "Sydney", "the suburb line when the name has none");
  assert.equal(items[1].area, undefined, "no repeat of the suburb already in the name");
});

test("/api/places: short queries answer an empty list without asking upstream", async () => {
  const { items } = await (await call("/api/places?q=a")).json();
  assert.deepEqual(items, []);
});

test("coordinates are trip ends with type coord; ids keep type any", async () => {
  assert.equal(W.isCoordId("151.21070:-33.86760:EPSG:4326"), true);
  assert.equal(W.isCoordId("10101331"), false);
  assert.equal(W.isCoordId("poiID:1:x"), false);
  tripCalls.length = 0;
  await call("/api/trip?from=151.21070:-33.86760:EPSG:4326&to=10101100&count=1");
  assert.equal(tripCalls[0].type_origin, "coord");
  assert.equal(tripCalls[0].type_destination, "any");
  tripCalls.length = 0;
  await call("/api/trip?from=" + encodeURIComponent(SF["1 Martin Place"].locations[0].id) + "&to=10101100&count=1");
  assert.equal(tripCalls[0].type_origin, "any");
  assert.equal(tripCalls[0].name_origin, SF["1 Martin Place"].locations[0].id);
});

test("fare questions are read as trips", () => {
  const cases = [
    ["How much is the fare from Central to Parramatta", "Central to Parramatta"],
    ["how much is the fare from Central to Parramatta?", "Central to Parramatta"],
    ["fare Central to Parramatta", "Central to Parramatta"],
    ["Opal fare Central to Parramatta", "Central to Parramatta"],
    ["How much does it cost to go from Epping to Central", "Epping to Central"],
    ["what's the fare to Bondi Junction from Central", "Bondi Junction from Central"],
  ];
  for (const [q, want] of cases) assert.equal(W.askFareQ(q), want, q);
  assert.equal(W.askFareQ("next train Central to Parramatta"), null);
  assert.equal(W.askFareQ("fares"), null);
});

test("a fare question plans the trip and is marked as a fare question", async () => {
  tripCalls.length = 0;
  const d = await W.askRoute(env, "How much is the fare from Central to Parramatta", { origin: "https://local" });
  assert.equal(d.kind, "trip");
  assert.equal(d.fareAsked, true);
  assert.equal(tripCalls.length, 1);
  assert.equal(tripCalls[0].name_origin, "200060");
  assert.notEqual(tripCalls[0].name_destination, tripCalls[0].name_origin);
  assert.ok(!/How much/i.test(JSON.stringify(d.understood)), "no question words in the place names");
});

test("nonsense says it did not understand instead of a far away stop", async () => {
  const d = await W.askV2(env, "asdfgh qwerty", { origin: "https://local" });
  assert.equal(d.reply, W.ASK_NOT_UNDERSTOOD);
  assert.ok(!/Walcha|Ashfield Property/.test(JSON.stringify(d)));
});

test("the last service sentence names every service of the same journey", () => {
  const leg = (line, from, plat) => ({ kind: "transit", mode: "train", line, from, fromPlatform: plat });
  const j = { legs: [leg("T4", "Milsons Point Station", "Platform 1"), { kind: "walk" }, leg("T9", "Hornsby Station, Platform 7", "Platform 7")] };
  assert.equal(W.askLinesWords(j), " (T4 then T9, Plat 1, change at Hornsby)");
  assert.equal(W.askLinesWords({ legs: [leg("T1", "Central Station", "Platform 6")] }), " (T1, Plat 6)");
  assert.equal(W.askLinesWords({ legs: [leg("T4", "Milsons Point Station", "Platform 1"), leg("BMT", "Central Station", "Platform 4")] }), " (T4 then Blue Mountains Line, Plat 1, change at Central)");
  const now = Date.now();
  const iso = (m) => new Date(now + m * 60000).toISOString();
  const last = { leave: iso(30), arrive: iso(55), changes: 1, legs: [{ ...leg("T4", "Milsons Point Station", "Platform 1"), planned: iso(30) }, { ...leg("T9", "Hornsby Station", "Platform 7"), planned: iso(42) }] };
  const d = W.askDecorate({ kind: "lastService", mode: "train", from: { id: "206110", name: "Milsons Point Station" }, to: { id: "206710", name: "Chatswood Station" }, last, before: null, after: null, sure: true, now }, {});
  assert.match(d.reply, /\(T4 then T9, Plat 1, change at Hornsby\)/);
  assert.deepEqual(d.cards[0].journeys[0].legs.map((l) => l.line), ["T4", "T9"], "card row is the same journey");
});

test("intercity legs carry the line's name", () => {
  assert.equal(W.askLegOut({ kind: "transit", line: "BMT" }).lineName, "Blue Mountains Line");
  assert.equal(W.askLegOut({ kind: "transit", line: "T1" }).lineName, undefined);
  assert.equal(W.askLineName("CCN"), "Central Coast and Newcastle Line");
});

test("bus interchanges get no station facilities", () => {
  assert.equal(W.facBusOnly({ n: "Railway Square Bus Interchange" }), true);
  assert.equal(W.facBusOnly({ n: "Central Station" }), false);
  assert.equal(W.facBusOnly({ n: "Parramatta Station" }), false);
  assert.equal(W.facBusOnly({ n: "Circular Quay Wharf" }), false);
});

test("no em or en dashes in this test", () => assert.ok(!/[\u2013\u2014]/.test(read("test/places-askfix.test.mjs"))));
