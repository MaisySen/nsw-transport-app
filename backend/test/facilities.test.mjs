// Station access, lifts, Opal machines and Park and Ride: /api/station, /api/parking, /api/topup,
// /api/lifts, lift outage alerts, car park watches, the accessible trips option and Ask.
// Transport for NSW answers are stubbed; the facility data files are the real built ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => fs.readFileSync(root + p, "utf8");
let src = read("src/worker.js").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default, parkStatus, parkOut, facTick };\n";
const tmp = `/tmp/fac-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const fixtures = JSON.parse(read("test/fixtures/stopfinder.json"));
const calls = [];
const LIFT = { infos: { current: [
  { id: "ems-1", subtitle: "Central Station Lift 6 between Central Walk and Platform 24/25 is not available", content: "<p>Out of service.</p>", url: "https://transportnsw.info/alerts/details#/ems-1", priority: "low",
    properties: { announcementType: "liftsEscalators" }, affected: { stops: [{ id: "200060", name: "Central Station" }], Infrastructures: [{ type: "ELEVATOR" }] } },
  { id: "ems-1b", subtitle: "Central Station Lift 6 between Central Walk and Platform 24/25 is not available", properties: { announcementType: "liftsEscalators" }, affected: { stops: [{ id: "200060" }] } },
  { id: "other", subtitle: "Trackwork on the T1", properties: { announcementType: "serviceChange" }, affected: { lines: [] } },
] } };
const syd = new Intl.DateTimeFormat("sv-SE", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()).replace(" ", "T");
const PARK = { 26: { spots: "123", total: "111" }, 27: { spots: "455", total: "410" }, 28: { spots: "397", total: "142" } };
globalThis.fetch = async (u) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  calls.push(url);
  if (url.pathname.endsWith("/add_info")) return new Response(JSON.stringify(LIFT));
  if (url.pathname === "/v1/carpark") {
    const p = PARK[url.searchParams.get("facility")] || { spots: "100", total: "10" };
    return new Response(JSON.stringify({ spots: p.spots, occupancy: { total: p.total }, MessageDate: syd }));
  }
  if (url.pathname.endsWith("/stop_finder")) return new Response(JSON.stringify(fixtures[url.searchParams.get("name_sf")] || { locations: [] }));
  if (url.pathname.endsWith("/trip")) return new Response(JSON.stringify({ journeys: [] }));
  return new Response("{}", { status: 404 });
};
const runs = [];
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), run: async () => { runs.push({ q, args }); return { meta: { changes: 1, last_row_id: 1 } }; }, all: async () => ({ results: [] }), first: async () => null });
const env = {
  TFNSW_API_KEY: "test",
  DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) },
  ASSETS: { fetch: async (req) => { const p = root + "src/public" + new URL(req.url).pathname; return fs.existsSync(p) ? new Response(fs.readFileSync(p)) : new Response("", { status: 404 }); } },
};
let ip = 1;
const get = async (path) => { const r = await W.__default.fetch(new Request("https://t.example" + path, { headers: { "cf-connecting-ip": "10.7.0." + (ip++ % 250) } }), env, { waitUntil() {} }); return { status: r.status, body: await r.json() }; };
const post = async (path, body) => { const r = await W.__default.fetch(new Request("https://t.example" + path, { method: "POST", headers: { "cf-connecting-ip": "10.8.0." + (ip++ % 250), "content-type": "application/json" }, body: JSON.stringify(body) }), env, { waitUntil() {} }); return { status: r.status, body: await r.json() }; };

test("facility data files are built from the open data and look right", () => {
  const f = JSON.parse(read("src/public/data/facilities.json"));
  assert.ok(Object.keys(f.stations).length > 700, "about 797 locations");
  assert.match(f.source, /Location Facilities/);
  const c = f.stations["200060"];
  assert.equal(c.n, "Central Station");
  assert.equal(c.a, "I");
  assert.ok(c.x.includes("lift"));
  assert.equal(c.t, "cash");
  const cp = JSON.parse(read("src/public/data/carparks.json")).carparks;
  assert.ok(cp.length >= 30);
  assert.ok(cp.filter((x) => x.tsn === "2155384").length === 3, "Tallawong has 3 car parks");
  assert.ok(!cp.some((x) => /historical/i.test(x.name)));
  assert.ok(fs.existsSync(root + "tools/build_facilities.py"));
});

test("nearly full and full thresholds", () => {
  assert.equal(W.parkStatus(200, 1000), "ok");
  assert.equal(W.parkStatus(100, 1000), "nearly");
  assert.equal(W.parkStatus(9, 50), "nearly", "10 spaces or fewer is nearly full on a small car park");
  assert.equal(W.parkStatus(0, 50), "full");
  assert.equal(W.parkStatus(null, 50), "unknown");
  const o = W.parkOut({ id: "1", name: "X", tsn: "1", spots: 100 }, { spots: "100", occupancy: { total: "130" }, MessageDate: syd });
  assert.equal(o.free, 0, "over capacity counts as full, never negative");
  assert.equal(o.status, "full");
  const stale = W.parkOut({ id: "1", name: "X", tsn: "1", spots: 100 }, { spots: "100", occupancy: { total: "10" }, MessageDate: "2020-01-01T08:00:00" });
  assert.equal(stale.status, "unknown", "an old reading is not shown as live");
});

test("GET /api/station gives access, lifts with live outages, ticket machine and sources", async () => {
  const { status, body } = await get("/api/station?id=200060");
  assert.equal(status, 200);
  assert.equal(body.name, "Central Station");
  assert.equal(body.access.level, "independent");
  assert.equal(body.access.lift, true);
  assert.equal(body.ticket.kind, "cash");
  assert.equal(body.outages.length, 1, "duplicate alerts for the same lift show once");
  assert.match(body.outages[0].title, /Lift 6/);
  assert.ok(body.sources.some((s) => /Location Facilities/.test(s)) && body.sources.some((s) => /alerts/.test(s)));
  assert.equal((await get("/api/station?id=abc")).status, 400);
  assert.equal((await get("/api/station?id=999999")).status, 404);
});

test("Park and Ride: live spaces per station with a nearly full flag", async () => {
  const { body } = await get("/api/parking?stop=2155384");
  assert.equal(body.carparks.length, 3);
  const p1 = body.carparks.find((c) => c.id === "26");
  assert.equal(p1.free, 12);
  assert.equal(p1.status, "nearly");
  assert.equal(body.carparks.find((c) => c.id === "28").status, "ok");
  assert.match(body.source, /Car Park API/);
  const st = await get("/api/station?id=2155384");
  assert.equal(st.body.parking.length, 3, "the station screen carries its car parks");
});

test("top up finder lists stations with machines, closest first", async () => {
  const { body } = await get("/api/topup?lat=-33.8840&lon=151.2060&limit=3");
  assert.equal(body.items.length, 3);
  assert.equal(body.items[0].id, "200060");
  assert.ok(body.items.every((r) => r.kind !== "none"));
  assert.ok(body.items[0].distance <= body.items[1].distance);
  const all = await get("/api/topup");
  assert.ok(all.body.items.length >= 240, "about 250 stations have a machine");
});

test("accessible trips send the Trip Planner wheelchair option", async () => {
  calls.length = 0;
  await get("/api/trip?from=2155384&to=200060&acc=1");
  const t = calls.find((u) => u.pathname.endsWith("/trip"));
  assert.equal(t.searchParams.get("wheelchair"), "on");
  calls.length = 0;
  await get("/api/trip?from=2155384&to=200060");
  assert.equal(calls.find((u) => u.pathname.endsWith("/trip")).searchParams.get("wheelchair"), null);
  calls.length = 0;
  await get("/api/plan?acc=1&legs=" + encodeURIComponent(JSON.stringify([{ f: "2155384", fn: "Tallawong", t: "206710", tn: "Chatswood" }, { f: "206710", fn: "Chatswood", t: "200060", tn: "Central" }])));
  assert.equal(calls.find((u) => u.pathname.endsWith("/trip")).searchParams.get("wheelchair"), "on");
});

test("Ask answers parking, lifts, top up and accessible trips", async () => {
  const a = (await get("/api/ask?q=" + encodeURIComponent("parking at Tallawong"))).body;
  assert.equal(a.kind, "facility");
  assert.match(a.reply, /Tallawong P1: 12 of 123 spaces free, nearly full/);
  assert.equal(a.cards[0].type, "parking");
  const b = (await get("/api/ask?q=" + encodeURIComponent("is the lift working at central"))).body;
  assert.match(b.reply, /out of service now: Lift 6/);
  assert.equal(b.cards[0].type, "station");
  const c = (await get("/api/ask?q=" + encodeURIComponent("top up at central"))).body;
  assert.match(c.reply, /cash or card/);
  const d = (await get("/api/ask?q=" + encodeURIComponent("parking at Epping"))).body;
  assert.match(d.reply, /no Park and Ride car park with live spaces/);
  calls.length = 0;
  await get("/api/ask?q=" + encodeURIComponent("accessible trip from parramatta to central"));
  const t = calls.find((u) => u.pathname.endsWith("/trip"));
  assert.ok(t, "planned a trip");
  assert.equal(t.searchParams.get("wheelchair"), "on");
  // A place called Park is a trip, not a parking question.
  calls.length = 0;
  const e = (await get("/api/ask?q=" + encodeURIComponent("parramatta to olympic park"))).body;
  assert.notEqual(e.kind, "facility");
});

test("lift outage alerts and car park watches validate input", async () => {
  assert.equal((await post("/api/lifts/alerts", { stations: ["200060"] })).status, 400, "device needed");
  runs.length = 0;
  const on = await post("/api/lifts/alerts", { device: "dtestdevice01", profile: "ptest01", stations: ["200060", "bad", "2155384"] });
  assert.equal(on.status, 200);
  assert.equal(on.body.stations, 2);
  assert.equal(on.body.now.length, 1, "outages already showing are listed, not pushed");
  assert.ok(runs.some((r) => /INSERT INTO lift_alerts/.test(r.q)));
  assert.equal((await post("/api/parking/watch", { device: "dtestdevice01", facility: "999" })).status, 400);
  const w = await post("/api/parking/watch", { device: "dtestdevice01", facility: "26" });
  assert.equal(w.status, 200);
  assert.equal(w.body.now.status, "nearly");
  assert.ok(runs.some((r) => /INSERT INTO park_watches/.test(r.q)));
});

test("the tick pushes a lift outage on a saved trip station once", async () => {
  const sent = [];
  const rows = { lift: [{ device: "dtestdevice01", stations: JSON.stringify(["200060"]), seen: "[]" }] };
  const env2 = { ...env, DB: { prepare: (q) => ({ bind: (...a) => ({ all: async () => ({ results: /FROM lift_alerts/.test(q) ? rows.lift : /FROM (push_subs|expo_tokens)/.test(q) ? [] : [] }), run: async () => { if (/INSERT INTO notes/.test(q)) sent.push(a[4]); if (/UPDATE lift_alerts/.test(q)) rows.lift[0].seen = a[1]; return { meta: { last_row_id: 1, changes: 1 } }; }, first: async () => null }), all: async () => ({ results: [] }), run: async () => ({ meta: {} }) }), batch: async (l) => l.map(() => ({})) } };
  const r1 = await W.facTick(env2, Date.now(), { tod: 4 * 60 + 4 }, {});
  assert.equal(r1.lifts.length, 1);
  assert.match(sent[0], /Lift out at Central Station/);
  const r2 = await W.facTick(env2, Date.now(), { tod: 4 * 60 + 14 }, {});
  assert.equal(r2.lifts.length, 0, "not sent twice");
});

test("web app: station screen, accessible trips toggle, finders and Ask cards", () => {
  const app = read("src/public/app.js"), ask = read("src/public/ask.js");
  assert.match(app, /\/api\/station\?/);
  assert.match(app, /Accessible trips/);
  assert.match(app, /acc: accOn\(\) \? 1 : null/);
  assert.match(app, /Lift outage alerts/);
  assert.match(app, /path === "\/topup"/);
  assert.match(app, /path === "\/parking"/);
  assert.match(app, /Nearly full/);
  assert.match(ask, /c\.type === "parking"/);
  assert.match(ask, /c\.type === "station"/);
  for (const p of ["src/public/app.js", "src/public/ask.js", "src/public/style.css", "tools/build_facilities.py", "test/facilities.test.mjs"]) assert.ok(!/[\u2013\u2014]/.test(read(p)), p);
  const w = read("src/worker.js");
  const block = w.slice(w.indexOf("// ---- facilities start"), w.indexOf("// ---- facilities end"));
  assert.ok(block.length > 2000 && !/[\u2013\u2014]/.test(block));
});
