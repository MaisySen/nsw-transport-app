// Usual lateness: "Usually 3 min late" per line and stop, folded once a day from the recorded live times (obs) into
// late_agg (counts only). Real SQL (node:sqlite).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./helpers/d1.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { __default, ensureSchema, serverCfg, lateTick, lateOf, lateNextDay, lateBand, lateMem, dayAdd, sydneyNow, APP_CONFIG_DEFAULTS };\n";
const tmp = `/tmp/usual-late-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
globalThis.fetch = async () => new Response("{}", { status: 404 });

const MIN = 60000, DAY = 86400000;
const dayOf = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date(t)).replace(/-/g, "");
// Weekday 8:00am Sydney (AEDT, UTC+11): Tue 20 Oct 2026 21:00 UTC is Wed 21 Oct 8:00am.
const WED_8AM = Date.parse("2026-10-20T21:00:00Z");

const sharedDB = makeD1();
function env() {
  for (const t of ["obs", "late_agg", "meta"]) { try { sharedDB.sql.exec("DELETE FROM " + t); } catch (e) { /* not made yet */ } }
  W.serverCfg.at = 0; W.serverCfg.cfg = null; W.lateMem.clear();
  return { TFNSW_API_KEY: "t", DB: sharedDB };
}
const weekdayBack = (k) => { const w = new Date(WED_8AM - k * DAY + 11 * 3600000).getUTCDay(); return w !== 0 && w !== 6; };
let tripN = 0;
async function obs(e, line, stop, planned, delayS, tracked = true) {
  await W.ensureSchema(e);
  const est = planned + delayS * 1000;
  await e.DB.prepare("INSERT INTO obs (day, trip_id, stop_id, route, mode, planned, est, delay_s, source, first_seen, last_seen, n) VALUES (?1, ?2, ?3, ?4, 'bus', ?5, ?6, ?7, 'test', ?8, ?8, 1)")
    .bind(dayOf(planned), "t" + tripN++, stop, line, planned, est, delayS, tracked ? est - 2 * MIN : est - 30 * MIN).run();
}
let ip = 1;
async function get(e, path) {
  const r = await W.__default.fetch(new Request("https://t.example" + path, { headers: { "cf-connecting-ip": "10.9.0." + (ip++ % 250) } }), e, { waitUntil() {} });
  return { status: r.status, body: await r.json(), cache: r.headers.get("cache-control") };
}

test("parts of the day and the next day to fold", () => {
  assert.equal(W.lateBand(7 * 60), 0);
  assert.equal(W.lateBand(12 * 60), 1);
  assert.equal(W.lateBand(17 * 60), 2);
  assert.equal(W.lateBand(22 * 60), 3);
  assert.equal(W.lateBand(3 * 60), 3);
  assert.equal(W.dayAdd("20261031", 1), "20261101");
  // First run: 28 days back. Yesterday only from 1am. Never today.
  assert.equal(W.lateNextDay("", { day: "20261025", tod: 600 }), "20260927");
  assert.equal(W.lateNextDay("20261023", { day: "20261025", tod: 30 }), null);
  assert.equal(W.lateNextDay("20261023", { day: "20261025", tod: 61 }), "20261024");
  assert.equal(W.lateNextDay("20261024", { day: "20261025", tod: 900 }), null);
});

test("pure summary: the median minute, null under 8 services, the day type when the part of the day is thin", () => {
  const row = (band, counts) => { const o = { band, n: 0 }; ["e","m0","m1","m2","m3","m4","m5","m6","m7","m8","m9","m10"].forEach((c, i) => { o[c] = counts[i] || 0; o.n += counts[i] || 0; }); return o; };
  const a = W.lateOf([row(0, [0, 2, 1, 1, 5, 1])], 0, 0);
  assert.equal(a.lateMin, 3);
  assert.equal(a.text, "Usually 3 min late on weekday mornings");
  assert.equal(a.short, "usually 3 min late");
  assert.equal(a.n, 10);
  assert.equal(a.lateShare, 60);
  assert.equal(W.lateOf([row(0, [0, 3, 1])], 0, 0), null);
  const day = W.lateOf([row(0, [0, 3]), row(2, [0, 6, 1])], 0, 1);
  assert.equal(day.text, "Usually on time on weekends");
  assert.equal(day.band, null);
  const lots = W.lateOf([row(1, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9])], 1, 0);
  assert.equal(lots.text, "Usually 10+ min late on weekdays around midday");
});

test("the tick folds one day per run into counts, ignores rows not tracked to departure, and the route answers", async () => {
  const e = env();
  // Five weekdays of the 410 at 2046100 around 8am: 4 min late, plus one row read 30 min early (not counted).
  for (const k of [1, 2, 5, 6, 7]) {
    assert.ok(weekdayBack(k));
    await obs(e, "410", "2046100", WED_8AM - k * DAY, 4 * 60 + 10);
    await obs(e, "410", "2046100", WED_8AM - k * DAY + 15 * MIN, 3 * 60 + 30);
  }
  await obs(e, "410", "2046100", WED_8AM - DAY + 20 * MIN, 20 * 60, false);
  const now = WED_8AM + 3 * 60 * MIN; // 11am on the Wednesday
  let folded = 0;
  for (let i = 0; i < 40; i++) { const r = await W.lateTick(e, now); if (r.folded) folded++; else break; }
  assert.equal(folded, 28);
  assert.equal((await W.lateTick(e, now)).upTo, W.dayAdd(dayOf(now), -1));
  const rows = (await e.DB.prepare("SELECT * FROM late_agg").all()).results;
  assert.equal(rows.length, 1);
  assert.ok(rows[0].n > 8 && rows[0].n <= 10, String(rows[0].n));
  assert.equal(Object.keys(rows[0]).filter((k) => /trip|device|profile|planned/.test(k)).length, 0);
  // Asked about a weekday morning: usually 3 min late (median of 4:10 and 3:30 rows).
  const r = await get(e, "/api/usual?s=" + encodeURIComponent("410~2046100") + "&s=" + encodeURIComponent("D400~2046100") + "&at=" + encodeURIComponent(new Date(WED_8AM).toISOString()));
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, true);
  assert.equal(r.body.items[0].lateMin, 3);
  assert.match(r.body.items[0].text, /^Usually 3 min late on weekday mornings$/);
  assert.equal(r.body.items[1], null);
  assert.match(r.cache, /max-age=600/);
  const one = await get(e, "/api/usual?line=410&stop=2046100&at=" + encodeURIComponent(new Date(WED_8AM).toISOString()));
  assert.equal(one.body.usual.lateMin, 3);
  assert.equal((await get(e, "/api/usual?line=410")).status, 400);
});

test("old days fade and rows under half a service go", async () => {
  const e = env();
  await obs(e, "T1", "2135223", WED_8AM - 27 * DAY, 120);
  const now = WED_8AM + 3 * 60 * MIN;
  for (let i = 0; i < 40; i++) { const r = await W.lateTick(e, now); if (!r.folded) break; }
  const rows = (await e.DB.prepare("SELECT * FROM late_agg").all()).results;
  assert.equal(rows.length, 0);
});

test("server flag usualLate off: nulls and enabled false, nothing folded", async () => {
  const e = env();
  await W.ensureSchema(e);
  W.serverCfg.at = Date.now(); W.serverCfg.cfg = { flags: { ...W.APP_CONFIG_DEFAULTS.flags, usualLate: false }, kill: {} };
  const r = await get(e, "/api/usual?line=410&stop=2046100");
  assert.equal(r.body.enabled, false);
  assert.equal(r.body.usual, null);
  assert.deepEqual(await W.lateTick(e, WED_8AM), { skipped: "off" });
  W.serverCfg.at = 0; W.serverCfg.cfg = null;
});
