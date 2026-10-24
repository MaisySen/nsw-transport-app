// Reliability pick: "Left on time 9 of the last 10 weekdays" for one timetabled service at one stop, from the
// recorded live times (obs). Null under 5 days seen. Real SQL (node:sqlite).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./helpers/d1.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { __default, reliabilityOf, ensureSchema, serverCfg, relMem, APP_CONFIG_DEFAULTS };\n";
const tmp = `/tmp/reliability-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
globalThis.fetch = async () => new Response("{}", { status: 404 });

const DAY = 86400000, MIN = 60000;
const dow = (t) => ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "short" }).format(new Date(t))];
const dayOf = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date(t)).replace(/-/g, "");
// The same clock time on earlier days (the last 14 days, so no daylight saving change falls inside).
const base = Math.floor(Date.now() / MIN) * MIN + 2 * MIN;
function past(kind, count) {
  const out = [];
  for (let k = 1; k <= 14 && out.length < count; k++) { const t = base - k * DAY; if ((dow(t) >= 6) === (kind === "weekend")) out.push(t); }
  return out;
}
const nextOf = (kind) => { for (let k = 0; k < 8; k++) { const t = base + k * DAY; if ((dow(t) >= 6) === (kind === "weekend")) return t; } };

const sharedDB = makeD1();
function freshEnv() {
  try { sharedDB.sql.exec("DELETE FROM obs"); } catch (e) { /* not made yet */ }
  try { sharedDB.sql.exec("DELETE FROM app_config"); } catch (e) { /* not made yet */ }
  W.serverCfg.at = 0; W.relMem.clear();
  return { TFNSW_API_KEY: "t", DB: sharedDB };
}
async function addObs(env, line, stop, planned, delayS, trip) {
  await W.ensureSchema(env);
  await env.DB.prepare("INSERT INTO obs (day, trip_id, stop_id, route, mode, planned, est, delay_s, source, first_seen, last_seen, n) VALUES (?1, ?2, ?3, ?4, 'train', ?5, ?6, ?7, 'test', ?8, ?8, 1)")
    .bind(dayOf(planned), trip || "t" + planned, stop, line, planned, planned + delayS * 1000, delayS, planned + delayS * 1000 - 2 * MIN).run();
}
let ip = 1;
async function get(env, path) {
  const r = await W.__default.fetch(new Request("https://t.example" + path, { headers: { "cf-connecting-ip": "10.8.0." + (ip++ % 250) } }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json() };
}

test("the pure summary: one sample per day, on time is under 3 min late and not over 1 min early, null under 5", () => {
  const days = past("weekday", 10);
  const rows = days.map((t, i) => ({ day: dayOf(t), planned: t, delay_s: i === 0 ? 400 : i === 1 ? -90 : 30, last_seen: t }));
  const r = W.reliabilityOf(rows, nextOf("weekday"));
  assert.equal(r.n, days.length);
  assert.equal(r.onTime, days.length - 2);
  assert.equal(r.text, `Left on time ${days.length - 2} of the last ${days.length} weekdays`);
  assert.equal(r.usualLateMin, 7);
  // A second reading of the same day counts once (the later one).
  const dup = rows.concat([{ day: rows[2].day, planned: rows[2].planned, delay_s: 600, last_seen: rows[2].last_seen + MIN }]);
  assert.equal(W.reliabilityOf(dup, nextOf("weekday")).onTime, days.length - 3);
  assert.equal(W.reliabilityOf(rows.slice(0, 4), nextOf("weekday")), null);
  assert.equal(W.reliabilityOf([], nextOf("weekday")), null);
});

test("other timetable times and the other kind of day are not mixed in", () => {
  const days = past("weekday", 6);
  const off = days.map((t) => ({ day: dayOf(t), planned: t + 10 * MIN, delay_s: 0, last_seen: t }));
  assert.equal(W.reliabilityOf(off, nextOf("weekday")), null, "10 min away is another service");
  const near = days.map((t) => ({ day: dayOf(t), planned: t + 2 * MIN, delay_s: 0, last_seen: t }));
  assert.equal(W.reliabilityOf(near, nextOf("weekday")).n, days.length, "within 2 min is the same service");
  assert.equal(W.reliabilityOf(near, nextOf("weekend")), null, "weekday history says nothing about a weekend");
});

test("GET /api/reliability from recorded live times, single and batch, null when too few", async () => {
  const env = freshEnv();
  const days = past("weekday", 10);
  for (const [i, t] of days.entries()) await addObs(env, "T1", "2134101", t, i === 3 ? 300 : 20);
  const planned = new Date(nextOf("weekday")).toISOString();
  const one = await get(env, `/api/reliability?line=T1&stop=2134101&planned=${encodeURIComponent(planned)}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.enabled, true);
  assert.ok(one.body.reliability, JSON.stringify(one.body));
  assert.equal(one.body.reliability.n, days.length);
  assert.equal(one.body.reliability.onTime, days.length - 1);
  assert.match(one.body.reliability.text, /^Left on time \d+ of the last \d+ weekdays$/);
  const s = (line, stop, p) => `s=${encodeURIComponent([line, stop, p].join("~"))}`;
  const many = await get(env, `/api/reliability?${s("T1", "2134101", planned)}&${s("T9", "2134101", planned)}&${s("T1", "999", planned)}`);
  assert.equal(many.body.items.length, 3);
  assert.equal(many.body.items[0] && many.body.items[0].n, days.length, JSON.stringify(many.body));
  assert.equal(many.body.items[1], null, "no history for that line");
  assert.equal(many.body.items[2], null, "no history at that stop");
  const bad = await get(env, `/api/reliability?line=T1&stop=2134101&planned=nope`);
  assert.equal(bad.body.reliability, null);
});

test("never counts the future or a reading taken long before departure", async () => {
  const env = freshEnv();
  const days = past("weekday", 6);
  // Seen 20 min before it left: that estimate says nothing about how it ran.
  for (const t of days) {
    await W.ensureSchema(env);
    await env.DB.prepare("INSERT INTO obs (day, trip_id, stop_id, route, mode, planned, est, delay_s, source, first_seen, last_seen, n) VALUES (?1, ?2, '1', 'T2', 'train', ?3, ?3, 0, 'test', ?4, ?4, 1)")
      .bind(dayOf(t), "x" + t, t, t - 20 * MIN).run();
  }
  const planned = new Date(nextOf("weekday")).toISOString();
  assert.equal((await get(env, `/api/reliability?line=T2&stop=1&planned=${encodeURIComponent(planned)}`)).body.reliability, null);
});

test("server flag reliabilityPick off: null for every service; the flag is in the app config", async () => {
  const env = freshEnv();
  assert.equal(W.APP_CONFIG_DEFAULTS.flags.reliabilityPick, true);
  for (const t of past("weekday", 8)) await addObs(env, "T1", "5", t, 0);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS app_config (platform TEXT PRIMARY KEY, body TEXT NOT NULL, at INTEGER)").run();
  await env.DB.prepare("INSERT OR REPLACE INTO app_config (platform, body, at) VALUES ('server', ?1, 0)").bind(JSON.stringify({ flags: { reliabilityPick: false } })).run();
  W.serverCfg.at = 0;
  const r = await get(env, `/api/reliability?line=T1&stop=5&planned=${encodeURIComponent(new Date(nextOf("weekday")).toISOString())}`);
  assert.equal(r.body.enabled, false);
  assert.equal(r.body.reliability, null);
  const cfg = await get(env, "/api/app/config?platform=android");
  assert.equal(cfg.body.flags.reliabilityPick, true);
  assert.equal(cfg.body.flags.lastWayHome, true);
});
