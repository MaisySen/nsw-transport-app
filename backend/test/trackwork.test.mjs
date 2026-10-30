// Weekend trackwork card: the service alerts digest (decoded from GTFS realtime protobuf, cut down,
// kept in meta) and GET /api/trackwork, which matches planned work this weekend to saved trips.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./helpers/d1.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { __default, decodeAlerts, digestAlerts, lineOfRoute, weekendWindow, weekendDays, trackworkMatches, alertPlaces, onPath, lineStatusOf, alertDigestMem, refreshAlertDigest, sydneyNow, serverCfg };\n";
const tmp = `/tmp/trackwork-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

// A tiny protobuf writer for GTFS realtime alerts.
const enc = new TextEncoder();
function varint(n) { const o = []; n = Number(n); while (n >= 128) { o.push((n % 128) | 128); n = Math.floor(n / 128); } o.push(n); return o; }
const cat = (...xs) => xs.flat();
const fld = (f, wt) => varint(f * 8 + wt);
const vi = (f, n) => cat(fld(f, 0), varint(n));
const by = (f, bytes) => cat(fld(f, 2), varint(bytes.length), bytes);
const st = (f, s) => by(f, [...enc.encode(s)]);
const tstr = (f, s) => by(f, by(1, st(1, s)));
function alert({ id, start, end, routes = [], stops = [], cause = 9, effect = 6, header, url }) {
  const a = cat(
    ...(start != null ? [by(1, cat(vi(1, Math.floor(start / 1000)), end ? vi(2, Math.floor(end / 1000)) : []))] : []),
    ...routes.map((r) => by(5, cat(st(1, "SydneyTrains"), st(2, r)))),
    ...stops.map((s) => by(5, st(5, s))),
    vi(6, cause), vi(7, effect), url ? tstr(8, url) : [], tstr(10, header), tstr(11, "Long text"),
  );
  return by(2, cat(st(1, id), by(5, a)));
}
const feed = (alerts) => new Uint8Array(cat(by(1, cat(st(1, "2.0"), vi(3, 1))), ...alerts));

const TABLE = { NSN_1a: "T1", WST_1a: "T1", ESI_1a: "T4", SMNW_M1: "M1", "1001_L2": "L2" };
const H = 3600000, D = 86400000;
// A fixed Wednesday 10am in Sydney (daylight time), so the coming weekend is 31 Oct and 1 Nov 2026.
const WED = Date.UTC(2026, 9, 27, 23, 0); // 28 Oct 10:00 Sydney

test("decodes alerts from protobuf: periods, routes, stops, cause, effect, header and link", () => {
  const buf = feed([alert({ id: "a1", start: WED + 2 * D, end: WED + 4 * D, routes: ["NSN_1a", "NSN_1a", "WST_1a"], stops: ["G2000331"], header: "T1 North Shore Line: Buses replace trains between Berowra and Hornsby", url: "https://transportnsw.info/alerts/details#/ems-1" })]);
  const [a] = W.decodeAlerts(buf);
  assert.equal(a.id, "a1");
  assert.deepEqual(a.periods, [[Math.floor((WED + 2 * D) / 1000) * 1000, Math.floor((WED + 4 * D) / 1000) * 1000]]);
  assert.deepEqual(a.routes, ["NSN_1a", "WST_1a"]);
  assert.deepEqual(a.stops, ["G2000331"]);
  assert.equal(a.cause, 9); assert.equal(a.effect, 6);
  assert.match(a.header, /^T1 North Shore/);
  assert.equal(a.url, "https://transportnsw.info/alerts/details#/ems-1");
});

test("route ids become line names: the timetable table first, then the bus form", () => {
  assert.equal(W.lineOfRoute("NSN_1a", TABLE), "T1");
  assert.equal(W.lineOfRoute("2507_540", TABLE), "540");
  assert.equal(W.lineOfRoute("2510_S263", TABLE), "S263");
  assert.equal(W.lineOfRoute("9-F9-sj2-1", TABLE), null);
  assert.equal(W.lineOfRoute("", TABLE), null);
});

test("the digest keeps planned and disruptive alerts with lines or stops, drops station notes and old ones", () => {
  const raw = W.decodeAlerts(feed([
    alert({ id: "work", start: WED + 2 * D, end: WED + 4 * D, routes: ["ESI_1a"], header: "Buses replace trains between Central and Bondi Junction" }),
    alert({ id: "note", routes: ["ESI_1a"], cause: 1, effect: 8, header: "Station Update - Central" }),
    alert({ id: "lift", routes: ["ESI_1a"], effect: 11, header: "Lift out of service" }),
    alert({ id: "old", start: WED - 3 * D, end: WED - 2 * D, routes: ["ESI_1a"], header: "Old trackwork" }),
    alert({ id: "late", cause: 3, effect: 3, routes: ["SMNW_M1"], header: "Metro North West Line: Allow extra travel time" }),
    alert({ id: "bus", cause: 10, effect: 4, routes: ["2507_540"], stops: ["G2141123"], header: "Route 540 diversion" }),
    alert({ id: "extra", cause: 10, effect: 6, routes: ["1001_L2"], header: "Extra L2 and L3 light rail services run during train trackwork in the City" }),
    alert({ id: "nights", cause: 10, effect: 8, routes: ["1001_L2"], header: "L2 Randwick Line weeknight closures due to maintenance" }),
  ]));
  const items = W.digestAlerts(raw, TABLE, WED);
  assert.deepEqual(items.map((i) => i.id), ["work", "late", "bus", "nights"]);
  assert.equal(items[3].e, "modified");
  assert.equal(items[0].pl, 1); assert.deepEqual(items[0].l, ["T4"]);
  assert.equal(items[1].pl, 0); assert.equal(items[1].e, "delays");
  assert.deepEqual(items[2].s, ["2141123"]);
});

test("weekend window: from a weekday it is the coming Saturday and Sunday, on Sunday it is today", () => {
  const w = W.weekendWindow(WED);
  assert.equal(w.sat, "20261031"); assert.equal(w.sun, "20261101");
  assert.equal(W.sydneyNow(w.from).dow, 5); assert.equal(W.sydneyNow(w.from).tod, 20 * 60);
  assert.equal(W.sydneyNow(w.to).dow, 1); assert.equal(W.sydneyNow(w.to).tod, 3 * 60);
  const sun = W.weekendWindow(Date.UTC(2026, 10, 1, 3, 0, 17, 5)); // Sunday 1 Nov 2pm
  assert.equal(sun.sat, "20261031"); assert.equal(sun.sun, "20261101");
  assert.equal(sun.from % 60000, 0); assert.equal(sun.to % 60000, 0);
  const thu = W.weekendWindow(Date.UTC(2026, 9, 29, 8, 0)); // Thursday 7pm
  assert.equal(thu.sat, "20261031");
  // Daylight saving ends on Sunday 5 April 2026: the window still lands on local midnight.
  const apr = W.weekendWindow(Date.UTC(2026, 3, 1, 0, 0));
  assert.equal(apr.sat, "20260404"); assert.equal(W.sydneyNow(apr.to).tod, 3 * 60);
});

test("trackwork matches a trip by its lines or its end stops, only inside the weekend window", () => {
  const w = W.weekendWindow(WED);
  const items = [
    { id: "sat", h: "Buses replace trains between Central and Bondi Junction", pl: 1, p: [[w.satStart + 2 * H, w.satStart + 20 * H]], l: ["T4"], s: [] },
    { id: "next", h: "Trackwork next week", pl: 1, p: [[w.to + 2 * D, w.to + 3 * D]], l: ["T4"], s: [] },
    { id: "delay", h: "Allow extra travel time", pl: 0, p: [], l: ["T4"], s: [] },
    { id: "stop", h: "Martin Place: changed timetable", pl: 1, p: [[w.satEnd + H, w.satEnd + 5 * H]], l: [], s: ["200030"] },
  ];
  const [m] = W.trackworkMatches(items, [{ f: "206710", t: "200030", lines: ["T1", "T4"] }], w);
  assert.deepEqual(m.map((x) => x.id), ["sat", "stop"]);
  assert.equal(m[0].sat, true); assert.equal(m[0].sun, false);
  assert.equal(m[1].sat, false); assert.equal(m[1].sun, true);
  const [none] = W.trackworkMatches(items, [{ f: "1", t: "2", lines: ["M1"] }], w);
  assert.equal(none.length, 0);
});

test("on the trip's path: by stop, by a place the header names, or line wide", () => {
  const shape = { stops: ["206710", "212110", "200060"], names: ["chatswood", "epping", "central"] };
  assert.deepEqual(W.alertPlaces("T1 North Shore Line: Buses replace trains between Berowra and Hornsby"), ["Berowra", "Hornsby"]);
  assert.deepEqual(W.alertPlaces("Trains run between Berowra or Hornsby and Central, platforms 1-14"), ["Berowra", "Central"]);
  assert.equal(W.onPath({ title: "Buses replace trains between Berowra and Hornsby", s: [] }, shape), false);
  assert.equal(W.onPath({ title: "Buses replace trains between Central and Bondi Junction", s: [] }, shape), true);
  assert.equal(W.onPath({ title: "T1 Western Line: Trains run to a changed timetable", s: [] }, shape), true);
  assert.equal(W.onPath({ title: "x", s: ["212110"] }, shape), true);
  assert.equal(W.onPath({ title: "x", s: ["999999"] }, shape), false);
});

// The route end to end: alerts feed, routes table, two planner answers (the weekend, a week later).
function plan(dep, min, legs) {
  return { journeys: [{ legs: legs.map((l, i) => ({
    transportation: { disassembledName: l.line, product: { class: l.bus ? 5 : 1, name: l.bus ? "Temporary buses" : "Sydney Trains Network" }, properties: l.bus ? { isTTB: true } : {} },
    origin: { name: l.from + " Station", departureTimePlanned: new Date(dep).toISOString() },
    destination: { name: l.to + " Station", arrivalTimePlanned: new Date(dep + min * 60000).toISOString() },
    stopSequence: l.stops.map(([id, n]) => ({ id: id + "1", name: n + " Station, Platform 1", parent: { id, disassembledName: n + " Station" } })),
  })) }] };
}
test("GET /api/trackwork: the affected trip gets the alert, buses and the time added; others get nothing", async () => {
  const realNow = Date.now;
  Date.now = () => WED;
  const w = W.weekendWindow(WED);
  const calls = [];
  globalThis.fetch = async (u) => {
    u = String(u); calls.push(u);
    if (u.includes("/v2/gtfs/alerts/all")) return new Response(feed([
      alert({ id: "e1", start: w.satStart + 2 * H, end: w.satStart + 22 * H, routes: ["ESI_1a"], header: "Buses replace trains between Central and Bondi Junction", url: "https://transportnsw.info/alerts/details#/ems-9" }),
    ]));
    if (u.includes("/v1/tp/trip")) {
      const day = new URL(u).searchParams.get("itdDate");
      if (day === w.sat) return Response.json(plan(WED, 55, [{ line: "T1", from: "Chatswood", to: "Central", stops: [["206710", "Chatswood"], ["200060", "Central"]] }, { line: "1T4", bus: true, from: "Central", to: "Martin Place", stops: [["200060", "Central"], ["200030", "Martin Place"]] }]));
      return Response.json(plan(WED, 30, [{ line: "T1", from: "Chatswood", to: "Central", stops: [["206710", "Chatswood"], ["200060", "Central"]] }, { line: "T4", from: "Central", to: "Martin Place", stops: [["200060", "Central"], ["200030", "Martin Place"]] }]));
    }
    return new Response("{}", { status: 404 });
  };
  const env = { TFNSW_API_KEY: "t", DB: makeD1(), ASSETS: { fetch: async (r) => (String(r.url || r).endsWith("/data/routes.json") ? Response.json({ routes: TABLE }) : new Response("", { status: 404 })) } };
  try {
    const r = await W.__default.fetch(new Request("https://t.example/api/trackwork?t=206710~200030~T1.T4~8&t=206710~206110~M1~8", { headers: { "cf-connecting-ip": "10.9.0.1" } }), env, { waitUntil() {} });
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.enabled, true);
    assert.equal(b.weekend.sat, "20261031");
    const [a, other] = b.trips;
    assert.equal(a.affected, true);
    assert.equal(a.items[0].title, "Buses replace trains between Central and Bondi Junction");
    assert.equal(a.items[0].days, "Saturday");
    assert.equal(a.items[0].url, "https://transportnsw.info/alerts/details#/ems-9");
    assert.deepEqual(a.buses, { from: "Central", to: "Martin Place" });
    assert.equal(a.addedMin, 25);
    assert.equal(other.affected, false); assert.deepEqual(other.items, []);
    // The digest is now a meta row; the feed is not read again for the next request, nor the planner.
    const n = calls.length;
    const r2 = await W.__default.fetch(new Request("https://t.example/api/trackwork?t=206710~200030~T1.T4~8", { headers: { "cf-connecting-ip": "10.9.0.2" } }), env, { waitUntil() {} });
    assert.equal((await r2.json()).trips[0].addedMin, 25);
    assert.equal(calls.length, n);
    const row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'alert_digest'").first();
    assert.ok(JSON.parse(row.v).items.length === 1);
  } finally { Date.now = realNow; }
});

test("line status: suspended over delays over trackwork, only what is active now, Changes for buses", () => {
  const now = WED;
  const items = [
    { id: "w", h: "Buses replace trains between Central and Bondi Junction", e: "modified", pl: 1, p: [[now - H, now + H]], l: ["T4"], u: "https://x/w" },
    { id: "d", h: "Allow extra travel time, signal repairs at Epping", e: "delays", pl: 0, p: [], l: ["T4", "T8"], u: "https://x/d" },
    { id: "s", h: "Metro North West Line: Services are suspended", e: "none", pl: 0, p: [[now - H, 0]], l: ["M1"], u: null },
    { id: "f", h: "Weekend trackwork", e: "modified", pl: 1, p: [[now + D, now + 2 * D]], l: ["T1"], u: null },
    { id: "b", h: "Route 540 diversion", e: "detour", pl: 1, p: [], l: ["540"], u: null },
  ];
  const t4 = W.lineStatusOf(items, "T4", now);
  assert.equal(t4.status, "delays"); assert.equal(t4.label, "Delays"); assert.equal(t4.more, 1); assert.equal(t4.url, "https://x/d");
  assert.equal(W.lineStatusOf(items, "M1", now).label, "Suspended");
  assert.equal(W.lineStatusOf(items, "T1", now).label, "Good service");
  assert.equal(W.lineStatusOf(items, "540", now).label, "Changes");
  assert.equal(W.lineStatusOf(items.slice(0, 1), "T4", now).label, "Trackwork");
});

test("GET /api/lines reads the digest row; a stale digest answers no items", async () => {
  const env = { TFNSW_API_KEY: "t", DB: makeD1(), ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
  const realNow = Date.now;
  Date.now = () => WED;
  try {
    W.alertDigestMem.items = null; W.alertDigestMem.read = 0;
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)").run();
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('alert_digest', ?1)").bind(JSON.stringify({ at: WED - 5 * 60000, items: [{ id: "d", h: "Allow extra travel time", e: "delays", pl: 0, p: [], l: ["T4"], s: [], u: null }] })).run();
    const r = await W.__default.fetch(new Request("https://t.example/api/lines?l=T4,T1,T4", { headers: { "cf-connecting-ip": "10.9.1.1" } }), env, { waitUntil() {} });
    const b = await r.json();
    assert.deepEqual(b.items.map((i) => [i.line, i.label]), [["T4", "Delays"], ["T1", "Good service"]]);
    Date.now = () => WED + 3 * H;
    W.alertDigestMem.read = 0;
    const r2 = await W.__default.fetch(new Request("https://t.example/api/lines?l=T4", { headers: { "cf-connecting-ip": "10.9.1.2" } }), env, { waitUntil() {} });
    const b2 = await r2.json();
    assert.equal(b2.stale, true); assert.deepEqual(b2.items, []);
  } finally { Date.now = realNow; }
});
