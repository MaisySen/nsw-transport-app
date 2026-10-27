// Not stopping today (28 Oct): bus detours and closed stops from the kept service alerts digest. Bus departures and
// bus legs get an optional notStopping, and GET /api/detours lists a route's stops not served today. Offline: the
// digest row is written by the test, and every outside fetch fails the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./helpers/d1.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { __default, ensureSchema3, serverCfg, decodeAlerts, digestAlerts, notStopAlerts, notStopHit, markNotStoppingWith, markNotStopping, detoursFor, alertDigestMem };\n";
const tmp = `/tmp/not-stopping-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

// Every request to Transport for NSW is counted: this feature must make none.
const asked = [];
let board = null; // the departure_mon answer the fake planner gives
globalThis.fetch = async (u) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  asked.push(url.pathname);
  if (url.pathname.endsWith("/departure_mon") && board) return new Response(JSON.stringify(board));
  return new Response("{}", { status: 404 });
};

const MIN = 60000, H = 3600000;
const NOW = Date.now();
// Fake stops and lines (no real place names).
const A = "2990101", B = "2990102", C = "2990103", P = "2990100";

// A tiny protobuf writer for GTFS realtime alerts (as in trackwork.test.mjs), with entities that can pair a route and a stop.
const enc = new TextEncoder();
function varint(n) { const o = []; n = Number(n); while (n >= 128) { o.push((n % 128) | 128); n = Math.floor(n / 128); } o.push(n); return o; }
const cat = (...xs) => xs.flat();
const vi = (f, n) => cat(varint(f * 8), varint(n));
const by = (f, bytes) => cat(varint(f * 8 + 2), varint(bytes.length), bytes);
const st = (f, s) => by(f, [...enc.encode(s)]);
const tstr = (f, s) => by(f, by(1, st(1, s)));
function alert({ id, ents, effect = 4, cause = 1, header }) {
  const a = cat(...ents.map((e) => by(5, cat(e.r ? st(2, e.r) : [], e.s ? st(5, e.s) : []))), vi(6, cause), vi(7, effect), tstr(10, header));
  return by(2, cat(st(1, id), by(5, a)));
}
const feed = (alerts) => new Uint8Array(cat(by(1, cat(st(1, "2.0"), vi(3, 1))), ...alerts));

const item = (o) => ({ id: o.id || "x", h: o.h || "Route X91 detour", u: null, e: o.e || "detour", pl: 0, p: o.p || [], l: o.l || [], s: o.s || [], ...(o.ls ? { ls: o.ls } : {}) });

test("digest: a route and a stop named in one entity are kept as a pair; alerts without such entities keep the old shape", () => {
  const raw = W.decodeAlerts(feed([
    alert({ id: "paired", header: "Route X91 and X92 detour", ents: [{ r: "2507_X91", s: A }, { r: "2507_X92", s: B }] }),
    alert({ id: "flat", header: "Route X93 detour", ents: [{ r: "2507_X93" }, { s: C }] }),
  ]));
  assert.deepEqual(raw[0].pairs, [["2507_X91", A], ["2507_X92", B]]);
  assert.equal(raw[1].pairs, undefined);
  const items = W.digestAlerts(raw, {}, NOW);
  assert.deepEqual(items[0].ls, [["X91", A], ["X92", B]]);
  assert.deepEqual(items[0].l, ["X91", "X92"]);
  assert.equal("ls" in items[1], false, "no pairs, no new field");
  assert.deepEqual(items[1].s, [C]);
});

test("which alerts count: detours, stop moved and no service with stops; changed service only with not-stopping words", () => {
  const list = W.notStopAlerts([
    item({ id: "d", e: "detour", l: ["X91"], s: [A] }),
    item({ id: "m", e: "stopMoved", s: [A] }),
    item({ id: "n", e: "none", l: ["X91"], s: [A] }),
    item({ id: "w", e: "modified", h: "Buses will not stop at the stop outside the school", l: ["X91"], s: [A] }),
    item({ id: "plain", e: "modified", h: "Timetable changes from Monday", l: ["X91"], s: [A] }),
    item({ id: "late", e: "delays", h: "Allow extra travel time", l: ["X91"], s: [A] }),
    item({ id: "line", e: "detour", l: ["X91"], s: [] }),
  ]);
  assert.deepEqual(list.map((x) => x.id), ["d", "m", "n", "w"]);
});

test("matching: line and stop, stop only alerts for every bus, pairs as given, and only while a period covers the time", () => {
  const al = [
    item({ id: "line", l: ["X91"], s: [A] }),
    item({ id: "pair", l: ["X92", "X93"], s: [A, B], ls: [["X92", A], ["X93", B]] }),
    item({ id: "closed", e: "stopMoved", s: [C] }),
    item({ id: "later", l: ["X94"], s: [A], p: [[NOW + 2 * H, NOW + 5 * H]] }),
  ];
  assert.equal(W.notStopHit(al, "X91", [A], NOW).id, "line");
  assert.equal(W.notStopHit(al, "X91", [B], NOW), null, "another stop");
  assert.equal(W.notStopHit(al, "X99", [A], NOW), null, "another line at a stop the alert names with its lines");
  assert.equal(W.notStopHit(al, "X92", [A], NOW).id, "pair");
  assert.equal(W.notStopHit(al, "X92", [B], NOW), null, "the pair says X92 is affected at A only");
  assert.equal(W.notStopHit(al, "X93", ["G" + B], NOW).id, "pair", "a G prefix is ignored");
  assert.equal(W.notStopHit(al, "X99", [C], NOW).id, "closed", "a stop closed for every bus");
  assert.equal(W.notStopHit(al, "X94", [A], NOW), null, "not yet");
  assert.equal(W.notStopHit(al, "X94", [A], NOW + 3 * H).id, "later");
  assert.equal(W.notStopHit(al, "X94", [A], NOW + 6 * H), null, "over");
  assert.equal(W.notStopHit(al, "", [A], NOW), null);
  assert.equal(W.notStopHit(al, "X91", [null, undefined], NOW), null);
});

const iso = (m) => new Date(NOW + m * MIN).toISOString();
test("departures: bus and coach rows at the stop are marked with the board's stop name; trains and other lines are not", () => {
  const al = [item({ id: "a1", h: "Route X91 detour, stops on Main St closed", l: ["X91", "X95"], s: [A] })];
  const d = { kind: "departures", stop: { id: A, name: "Main St opp Park Rd" }, items: [
    { mode: "bus", line: "X91", stopId: A, planned: iso(5) },
    { mode: "coach", line: "X95", stopId: A, planned: iso(7) },
    { mode: "bus", line: "X96", stopId: A, planned: iso(8) },
    { mode: "train", line: "X91", stopId: A, planned: iso(9) },
    { mode: "bus", line: "X96", stopId: A, planned: iso(10), notStopping: { stop: "old" } },
  ] };
  assert.equal(W.markNotStoppingWith(al, d), 2);
  assert.deepEqual(d.items[0].notStopping, { stop: "Main St opp Park Rd", id: "a1", title: "Route X91 detour, stops on Main St closed", url: null });
  assert.equal(d.items[1].notStopping.id, "a1");
  assert.equal("notStopping" in d.items[2], false);
  assert.equal("notStopping" in d.items[3], false, "trains keep the realtime skipped stop instead");
  assert.equal("notStopping" in d.items[4], false, "an old mark on a kept copy is cleared");
});

test("trip legs: the stop you get on first, else the stop you get off; walks and trains untouched", () => {
  const al = [item({ id: "on", l: ["X91"], s: [P] }), item({ id: "off", l: ["X92"], s: [B] })];
  const leg = (o) => ({ kind: "transit", mode: "bus", planned: iso(5), arrPlanned: iso(20), ...o });
  const d = { kind: "trip", journeys: [{ legs: [
    { kind: "walk", mode: "walk" },
    leg({ line: "X91", stopId: A, fromParent: P, from: "Main St", toStopId: C, to: "High St" }),
    leg({ line: "X92", stopId: C, from: "High St", toStopId: B, to: "Park Rd" }),
    leg({ mode: "train", line: "X92", stopId: C, toStopId: B }),
  ] }] };
  assert.equal(W.markNotStoppingWith(al, d), 2);
  const [, a, b, t] = d.journeys[0].legs;
  assert.deepEqual(a.notStopping, { at: "from", stop: "Main St", id: "on", title: "Route X91 detour", url: null });
  assert.equal(b.notStopping.at, "to");
  assert.equal(b.notStopping.stop, "Park Rd");
  assert.equal("notStopping" in t, false);
});

const sharedDB = makeD1();
async function env(digest, at = Date.now()) {
  const e = { TFNSW_API_KEY: "t", DB: sharedDB, ASSETS: { fetch: async () => new Response(JSON.stringify({ X91: [{ to: "Town", stops: [[A, "Main St"], [B, "Park Rd"]] }] })) } };
  await W.ensureSchema3(e);
  sharedDB.sql.exec("DELETE FROM meta");
  if (digest) await e.DB.prepare("INSERT INTO meta (k, v) VALUES ('alert_digest', ?1)").bind(JSON.stringify({ at, items: digest })).run();
  W.alertDigestMem.at = 0; W.alertDigestMem.read = 0; W.alertDigestMem.items = null;
  W.serverCfg.at = 0; W.serverCfg.cfg = null;
  return e;
}

test("server: reads only the kept digest, never the alerts feed; an old digest or the switch off marks nothing", async () => {
  const dg = [item({ id: "a1", l: ["X91"], s: [A] })];
  let e = await env(dg);
  asked.length = 0;
  const d = () => ({ kind: "departures", stop: { id: A, name: "Main St" }, items: [{ mode: "bus", line: "X91", stopId: A, planned: iso(5) }] });
  const one = d();
  assert.equal(await W.markNotStopping(e, one), 1);
  assert.equal(one.items[0].notStopping.id, "a1");
  e = await env(null);
  const none = d();
  assert.equal(await W.markNotStopping(e, none), 0, "no digest yet: nothing, and no fetch to make one");
  e = await env(dg, Date.now() - 3 * H);
  const old = d();
  assert.equal(await W.markNotStopping(e, old), 0, "a digest over 2 hours old is not used");
  e = await env(dg);
  W.serverCfg.cfg = { flags: { notStopping: false }, kill: {}, copy: {}, timing: {}, tabs: [] }; W.serverCfg.at = Date.now() + H;
  const off = d();
  assert.equal(await W.markNotStopping(e, off), 0);
  W.serverCfg.at = 0; W.serverCfg.cfg = null;
  assert.deepEqual(asked, [], "no outside request");
});

let ip = 1;
const get = async (e, path) => { const r = await W.__default.fetch(new Request("https://t.example" + path, { headers: { "cf-connecting-ip": "10.7.3." + (ip++ % 250) } }), e, { waitUntil() {} }); return { status: r.status, body: await r.json(), cc: r.headers.get("cache-control") }; };

test("GET /api/departures: a bus row at a detoured stop carries notStopping; other rows keep their old shape", async () => {
  const e = await env([item({ id: "a1", h: "Route X91 detour", l: ["X91"], s: [A] })]);
  const ev = (line, cls, mins) => ({ location: { id: A, name: "Main St opp Park Rd", properties: { platformName: "" } },
    departureTimePlanned: new Date(Date.now() + mins * MIN).toISOString(),
    transportation: { disassembledName: line, number: line, product: { class: cls }, destination: { name: "Town", id: "1" }, properties: {} }, properties: { RealtimeTripId: line + mins } });
  board = { locations: [{ id: A, name: "Main St opp Park Rd", disassembledName: "Main St opp Park Rd" }], stopEvents: [ev("X91", 5, 4), ev("X96", 5, 6)] };
  asked.length = 0;
  const r = await get(e, `/api/departures?stop=${A}&n=ns1`);
  board = null;
  assert.equal(r.status, 200);
  const [a, b] = r.body.items;
  assert.equal(a.line, "X91");
  assert.equal(a.notStopping.title, "Route X91 detour");
  assert.equal(a.notStopping.stop, "Main St opp Park Rd");
  assert.equal("notStopping" in b, false);
  assert.ok(asked.every((p) => !/alerts/.test(p)), "the alerts feed is not read: " + asked.join(","));
});

test("GET /api/detours: the line's stops not served today, stop only alerts limited to the route's own stops", async () => {
  const e = await env([
    item({ id: "a1", h: "Route X91 detour", l: ["X91"], s: [A] }),
    item({ id: "c1", e: "stopMoved", h: "Stop moved", s: [B, C] }),
    item({ id: "x1", h: "Route X97 detour", l: ["X97"], s: [C] }),
    item({ id: "tmr", h: "Route X91 detour tomorrow week", l: ["X91"], s: [B], p: [[Date.now() + 8 * 86400000, 0]] }),
  ]);
  asked.length = 0;
  const r = await get(e, "/api/detours?line=x91&mode=bus");
  assert.equal(r.status, 200);
  assert.equal(r.body.line, "X91");
  assert.deepEqual(r.body.items.map((i) => [i.id, i.stops]), [["a1", [A]], ["c1", [B]]]);
  assert.match(r.cc, /max-age=120/);
  assert.deepEqual((await get(e, "/api/detours?line=X97&mode=train")).body.items, [], "buses only");
  assert.equal((await get(e, "/api/detours")).status, 400);
  assert.ok(asked.every((p) => !/alerts|departure_mon/.test(p)));
});

test("pure detoursFor: an alert whose periods all end later today says until when", () => {
  const end = NOW + 2 * H;
  const out = W.detoursFor([item({ id: "a", l: ["X91"], s: [A], p: [[NOW - H, end]] })], "X91", null, NOW);
  assert.equal(out[0].until, new Date(end).toISOString());
  assert.deepEqual(W.detoursFor([item({ id: "b", l: ["X91"], s: [A] })], "X91", null, NOW)[0].until, null);
});
