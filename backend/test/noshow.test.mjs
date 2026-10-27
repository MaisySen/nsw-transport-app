// Often does not run (28 Oct): bus no show counts per line, day type and hour, folded once a day from the recorded
// live times (obs) into two meta rows, and noShow on departures and bus legs in an hour that often does not run.
// Real SQL (node:sqlite), offline, no Transport for NSW call.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./helpers/d1.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { __default, ensureSchema, serverCfg, noShowTick, nsFold, nsFlagged, nsOf, nsNextDay, nsWindowDays, markNoShow, nsReset, NS_MIN_W, NS_MIN_DAYS, NS_SHARE };\n";
const tmp = `/tmp/noshow-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
globalThis.fetch = async () => new Response("{}", { status: 404 });

const MIN = 60000;
// Sydney is UTC+11 (daylight time) for every day used here. Local h:mm on a "YYYYMMDD" day, in ms.
const at = (day, h, m = 0) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)), h - 11, m);
// Monday 2 Nov 2026, 9:00am Sydney: the tick folds 19 Oct to 1 Nov, one day per call.
const NOW = at("20261102", 9);

const sharedDB = makeD1();
function env() {
  for (const t of ["obs", "meta"]) { try { sharedDB.sql.exec("DELETE FROM " + t); } catch (e) { /* not made yet */ } }
  W.serverCfg.at = 0; W.serverCfg.cfg = null; W.serverCfg.budget = null; W.nsReset();
  return { TFNSW_API_KEY: "t", DB: sharedDB };
}
// One recorded live time: read first `lead` minutes before its planned time and last `lastLead` minutes before it.
async function seen(e, day, trip, stop, line, h, m, lead = 40, lastLead = 0) {
  await W.ensureSchema(e);
  const planned = at(day, h, m);
  await e.DB.prepare("INSERT INTO obs (day, trip_id, stop_id, route, mode, planned, est, delay_s, source, first_seen, last_seen, n) VALUES (?1, ?2, ?3, ?4, 'bus', ?5, ?5, 0, 'test', ?6, ?7, 2)")
    .bind(day, trip, stop, line, planned, planned - lead * MIN, planned - lastLead * MIN).run();
}
// A line every 15 minutes from 7:00 to 9:00 at one stop; `skip` lists the trips that never showed live that day.
async function dayOf(e, day, line, stop, skip = [], lead = 40) {
  for (let k = 0; k <= 8; k++) {
    const h = 7 + Math.floor((k * 15) / 60), m = (k * 15) % 60;
    const trip = `${line}-${h}${String(m).padStart(2, "0")}`;
    if (!skip.includes(trip)) await seen(e, day, trip, stop, line, h, m, lead);
  }
}
async function foldAll(e, now = NOW) {
  const out = [];
  for (let i = 0; i < 30; i++) {
    const r = await W.noShowTick(e, now);
    out.push(r);
    if (!r.folded) break;
  }
  return out;
}
const meta = async (e, k) => { const r = await e.DB.prepare("SELECT v FROM meta WHERE k = ?1").bind(k).first(); return r ? JSON.parse(r.v) : null; };

test("next day to fold, and the days a service is known from", () => {
  assert.equal(W.nsNextDay("", { day: "20261102", tod: 600 }), "20261019");
  assert.equal(W.nsNextDay("20261031", { day: "20261102", tod: 30 }), null, "yesterday waits for 1am");
  assert.equal(W.nsNextDay("20261031", { day: "20261102", tod: 61 }), "20261101");
  assert.equal(W.nsNextDay("20261101", { day: "20261102", tod: 900 }), null, "never today");
  const wk = W.nsWindowDays("20261030");
  assert.equal(wk.length, 10, "weekdays in the 14 days ending on a Friday");
  assert.ok(wk.every((d) => !["20261024", "20261025", "20261018", "20261017"].includes(d)));
  assert.equal(wk[wk.length - 1], "20261030");
  assert.deepEqual(W.nsWindowDays("20261101"), ["20261024", "20261025", "20261031", "20261101"]);
});

test("pure fold: older counts fade, a day's rows add, faded keys go, and only busy hours with many misses are marked", () => {
  const a = W.nsFold(null, [{ route: "R1", slot: 8, w: 4, m: 2 }, { route: "R1", slot: 7, w: 4, m: 0 }], "20261026", 0);
  assert.deepEqual(a.n, { "R1|0|8": [4, 2, 1, 20261026], "R1|0|7": [4, 0, 1, 20261026] });
  const b = W.nsFold(a, [{ route: "R1", slot: 8, w: 4, m: 2 }], "20261027", 0);
  assert.deepEqual(b.n["R1|0|8"], [7.8, 3.9, 2, 20261027]);
  assert.deepEqual(b.n["R1|0|7"], [3.8, 0, 1, 20261026], "a day with nothing counted adds no day");
  assert.equal(b.upTo, "20261027");
  const tiny = W.nsFold({ n: { "X|0|1": [0.51, 0.5] } }, [], "20261028", 0);
  assert.equal(tiny.n["X|0|1"], undefined, "under half a service after fading is dropped");
  assert.deepEqual(W.nsFlagged({ "A|0|8": [14, 7, 4, 1], "B|0|8": [14, 2, 6, 1], "C|0|8": [11, 11, 9, 1], "D|1|23": [12, 3.6, 4, 1],
    "E|0|8": [20, 10, 3, 1], "F|0|8": [20, 10] }), { "A|0|8": [50, 14], "D|1|23": [30, 12] });
  assert.equal(W.NS_MIN_W, 12);
  assert.equal(W.NS_MIN_DAYS, 4);
  assert.equal(W.NS_SHARE, 30);
});

test("two of four buses in the 8 o'clock hour never show live on four weekdays: that hour is marked, 7 o'clock is not", async () => {
  const e = env();
  await dayOf(e, "20261026", "R1", "S1");
  for (const d of ["20261027", "20261028", "20261029", "20261030"]) await dayOf(e, d, "R1", "S1", ["R1-800", "R1-830"]);
  const runs = await foldAll(e);
  const folded = runs.filter((r) => r.folded).map((r) => r.folded);
  assert.equal(folded[0], "20261019");
  assert.equal(folded[folded.length - 1], "20261101");
  assert.equal(folded.length, 14, "one day per tick, every day from the backfill start to yesterday");
  const tue = runs.find((r) => r.folded === "20261027");
  assert.equal(tue.watched, 8);
  assert.equal(tue.missed, 2);
  const mon = runs.find((r) => r.folded === "20261026");
  assert.equal(mon.missed, 0);
  assert.equal(mon.watched, 8, "the 9:00 bus has no later bus to show someone was looking, so it is not counted");
  const agg = await meta(e, "noshow_agg2");
  assert.equal(agg.upTo, "20261101");
  assert.ok(agg.n["R1|0|8"][0] >= 12 && agg.n["R1|0|8"][1] > 0);
  assert.equal(agg.n["R1|0|8"][2], 5, "counted on five weekdays");
  assert.equal(agg.n["R1|0|7"][1], 0);
  const f = (await meta(e, "noshow")).f;
  assert.deepEqual(Object.keys(f), ["R1|0|8"]);
  assert.ok(f["R1|0|8"][0] >= 40 && f["R1|0|8"][0] <= 50, "share " + f["R1|0|8"][0]);
  // Done for today: no D1 read on later ticks in this isolate.
  assert.deepEqual(await W.noShowTick(e, NOW + MIN), { idle: true });

  // Departures: a weekday 8 o'clock R1 bus gets noShow; 7 o'clock, another line, a train and a weekend do not.
  const items = [
    { mode: "bus", line: "R1", planned: new Date(at("20261103", 8, 15)).toISOString(), stopId: "S1" },
    { mode: "bus", line: "R1", planned: new Date(at("20261103", 7, 45)).toISOString(), stopId: "S1" },
    { mode: "bus", line: "R2", planned: new Date(at("20261103", 8, 15)).toISOString(), stopId: "S1" },
    { mode: "train", line: "R1", planned: new Date(at("20261103", 8, 15)).toISOString(), stopId: "S1" },
    { mode: "bus", line: "R1", planned: new Date(at("20261107", 8, 15)).toISOString(), stopId: "S1" },
  ];
  const before = JSON.parse(JSON.stringify(items));
  await W.markNoShow(e, items);
  assert.deepEqual(items[0].noShow, { share: f["R1|0|8"][0], n: f["R1|0|8"][1] });
  for (let i = 1; i < items.length; i++) assert.deepEqual(items[i], before[i], "unmarked rows keep exactly their shape");
});

test("a service nobody was watching is not a miss", async () => {
  const e = env();
  await dayOf(e, "20261026", "R1", "S1");
  // Later days: the 7 o'clock buses were read up to their time, the 9:00 bus once at 7:30 and never again, so nobody
  // was looking at the stop during the 8 o'clock hour: its missing buses are not misses.
  for (const d of ["20261027", "20261028", "20261029", "20261030"]) {
    for (const m of [0, 15, 30, 45]) await seen(e, d, `R1-7${String(m).padStart(2, "0")}`, "S1", "R1", 7, m, 20, 0);
    await seen(e, d, "R1-900", "S1", "R1", 9, 0, 90, 90);
  }
  const runs = await foldAll(e);
  assert.equal(runs.find((r) => r.folded === "20261027").missed, 0);
  const agg = await meta(e, "noshow_agg2");
  assert.equal(agg.n["R1|0|8"][1], 0, "the 8 o'clock hour counts only Monday, when every bus showed");
  assert.deepEqual((await meta(e, "noshow")).f, {});
});

test("a day where nearly everything missed is another timetable (a public holiday) and is skipped", async () => {
  const e = env();
  const lines = Array.from({ length: 16 }, (_, i) => "L" + i);
  for (const l of lines) await dayOf(e, "20261026", l, "S" + l);
  // Tuesday: every line's 8 o'clock buses missing but the 9:00 read on time: 16 lines x 4 watched, all missed.
  for (const l of lines) await dayOf(e, "20261027", l, "S" + l, [`${l}-800`, `${l}-815`, `${l}-830`, `${l}-845`, `${l}-700`, `${l}-715`, `${l}-730`, `${l}-745`], 70);
  const runs = await foldAll(e, at("20261028", 9));
  const tue = runs.find((r) => r.folded === "20261027");
  assert.equal(tue.skipped, "another timetable");
  assert.ok(tue.missed / tue.watched > 0.35);
  assert.deepEqual((await meta(e, "noshow")).f, {});
});

test("switch noShow off: no fold and no noShow on any answer", async () => {
  const e = env();
  await dayOf(e, "20261026", "R1", "S1");
  W.serverCfg.cfg = { flags: { noShow: false }, kill: {}, copy: {}, timing: {}, tabs: [] }; W.serverCfg.at = Date.now() + 3600000;
  assert.deepEqual(await W.noShowTick(e, NOW), { skipped: "off" });
  assert.equal(await meta(e, "noshow_day2"), null);
  await e.DB.prepare("INSERT INTO meta (k, v) VALUES ('noshow', ?1)").bind(JSON.stringify({ v: 2, f: { "R1|0|8": [60, 20] } })).run();
  const it = { mode: "bus", line: "R1", planned: new Date(at("20261103", 8, 15)).toISOString() };
  await W.markNoShow(e, [it]);
  assert.equal(it.noShow, undefined);
  W.serverCfg.at = 0; W.serverCfg.cfg = null;
});

test("budget guard: the fold waits while a D1 meter is projected over the hold; a Durable Object hold does not stop it", async () => {
  const e = env();
  await dayOf(e, "20261026", "R1", "S1");
  W.serverCfg.cfg = { flags: {}, kill: {}, copy: {}, timing: {}, tabs: [] }; W.serverCfg.at = Date.now() + 3600000;
  W.serverCfg.budget = { hold: true, meters: { d1RowsRead: { projectedPct: 95 }, doRequests: { projectedPct: 170 } } };
  assert.deepEqual(await W.noShowTick(e, NOW), { skipped: "budget" });
  W.serverCfg.budget = { hold: true, meters: { d1RowsRead: { projectedPct: 1.4 }, doRequests: { projectedPct: 176.9 } } };
  const r = await W.noShowTick(e, NOW);
  assert.equal(r.folded, "20261019");
  W.serverCfg.at = 0; W.serverCfg.cfg = null; W.serverCfg.budget = null;
});

test("pure nsOf: buses only, by line, day type and Sydney hour", () => {
  const f = { "R1|0|8": [55, 12], "R1|1|23": [40, 9] };
  assert.deepEqual(W.nsOf(f, { mode: "bus", line: "R1", planned: new Date(at("20261103", 8, 59)).toISOString() }), { share: 55, n: 12 });
  assert.equal(W.nsOf(f, { mode: "bus", line: "R1", planned: new Date(at("20261103", 9, 0)).toISOString() }), null);
  assert.deepEqual(W.nsOf(f, { mode: "bus", line: "R1", planned: new Date(at("20261108", 23, 10)).toISOString() }), { share: 40, n: 9 });
  assert.equal(W.nsOf(f, { mode: "lightrail", line: "R1", planned: new Date(at("20261103", 8, 5)).toISOString() }), null);
  assert.equal(W.nsOf(f, { mode: "bus", line: "R1" }), null);
  assert.equal(W.nsOf(f, null), null);
});

// The bar (28 Oct): at least NS_MIN_W counted buses AND those counted on at least NS_MIN_DAYS distinct service days.
test("3 of 9 buses missing over only 2 days gets no label (the old bar of 8 would have marked it)", () => {
  const a = W.nsFold(null, [{ route: "R9", slot: 0, w: 5, m: 2 }], "20261026", 0);
  const b = W.nsFold(a, [{ route: "R9", slot: 0, w: 4, m: 1 }], "20261027", 0);
  const v = b.n["R9|0|0"];
  assert.equal(v[2], 2, "two distinct days");
  assert.ok(v[0] >= 8 && v[0] < 9, "about 9 counted after fading: " + v[0]);
  assert.ok(v[1] / v[0] >= 0.3, "a third never showed");
  assert.deepEqual(W.nsFlagged(b.n), {});
  // Many buses but on only three days: still no label.
  let c = null;
  for (const d of ["20261026", "20261027", "20261028"]) c = W.nsFold(c, [{ route: "R9", slot: 0, w: 8, m: 4 }], d, 0);
  assert.ok(c.n["R9|0|0"][0] >= 12);
  assert.deepEqual(W.nsFlagged(c.n), {}, "three days is not enough");
});

test("12 or more counted buses over 4 or more days with 30 percent missing gets the label", () => {
  let a = null;
  for (const d of ["20261026", "20261027", "20261028", "20261029"]) a = W.nsFold(a, [{ route: "R9", slot: 0, w: 4, m: 2 }], d, 0);
  const v = a.n["R9|0|0"];
  assert.equal(v[2], 4);
  assert.ok(v[0] >= 12, "counted " + v[0]);
  assert.deepEqual(W.nsFlagged(a.n), { "R9|0|0": [50, Math.round(v[0])] });
  // Four days but under 12 counted: no label.
  let s = null;
  for (const d of ["20261026", "20261027", "20261028", "20261029"]) s = W.nsFold(s, [{ route: "R9", slot: 0, w: 2, m: 1 }], d, 0);
  assert.deepEqual(W.nsFlagged(s.n), {});
});

test("after the change: marks made on the old bar stop at once and every stored day is folded again", async () => {
  const e = env();
  await W.ensureSchema(e);
  // What the old version left in meta: a mark on 2 days of data, its counts and its claim.
  const put = "INSERT INTO meta (k, v) VALUES (?1, ?2)";
  await e.DB.prepare(put).bind("noshow", JSON.stringify({ v: 1, upTo: "20261101", f: { "R1|0|8": [33, 9] } })).run();
  await e.DB.prepare(put).bind("noshow_agg", JSON.stringify({ v: 1, upTo: "20261101", n: { "R1|0|8": [9, 3] } })).run();
  await e.DB.prepare(put).bind("noshow_day", "20261101").run();
  const it = { mode: "bus", line: "R1", planned: new Date(at("20261103", 8, 15)).toISOString() };
  await W.markNoShow(e, [it]);
  assert.equal(it.noShow, undefined, "a v 1 mark is never read");
  await dayOf(e, "20261026", "R1", "S1");
  for (const d of ["20261027", "20261028"]) await dayOf(e, d, "R1", "S1", ["R1-800", "R1-830"]);
  W.nsReset();
  const runs = await foldAll(e);
  assert.equal(runs[0].folded, "20261019", "folds again from the backfill start");
  assert.equal(runs.filter((r) => r.folded).length, 14);
  for (const k of ["noshow_agg", "noshow_day"]) assert.equal(await meta(e, k), null, k + " dropped");
  const agg = await meta(e, "noshow_agg2");
  assert.equal(agg.v, 2);
  assert.equal(agg.n["R1|0|8"][2], 3);
  const ns = await meta(e, "noshow");
  assert.equal(ns.v, 2);
  assert.deepEqual(ns.f, {}, "three days of data marks nothing");
});
