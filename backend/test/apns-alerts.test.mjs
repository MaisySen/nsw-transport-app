// Watch alerts straight to Apple (31 Oct, Bidur on build 210, T1 to Ashfield due 12:06). Our notes table: the watch's
// "Leave now" (11:57:57), "Arriving at Ashfield Station in 2 min" (12:03:56) and "You've arrived" (12:06:55) were all
// written with pushed 0: his iPhone has no Expo token, and the two Expo tokens on file answer InvalidCredentials. When
// he opened the app all three showed at once. Server half, branch server-211-rc, off until the apnsAlerts flag is on:
// (a) with no working Expo token an alert goes to Apple on the phone's own push token (apns_devices), same words,
// sound and time sensitive Get off now, apns-expiration at the moment it is about, one collapse id per watch and kind;
// (b) a Start trip (track) watch never sends Leave now; (c) an Expo token answering InvalidCredentials is marked dead
// and not tried again until the phone registers it again; and the app's catch-up ask (/api/watches since > 0) gets only
// alerts still news that Apple did not already bring to that phone. No NSW call: liveLegs and oneStopCheck are stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const root = new URL("..", import.meta.url).pathname;
const raw = fs.readFileSync(root + "src/worker.js", "utf8");
const src = raw
  .replace(/export default\s*\{/, "const __default = {")
  .replace("async function liveLegs(env, spec, now, opts = {}) {", "async function liveLegs(env, spec, now, opts = {}) {\n  if (globalThis.__fakeLive) return globalThis.__fakeLive(spec, now);")
  .replace("async function oneStopCheck(env, l) {", "async function oneStopCheck(env, l) {\n  if (globalThis.__fakeOne) return globalThis.__fakeOne(l);")
  + "\nexport { processWatch, getOffAccept, sendExpo, noteForCatchUp, alertExpiry, alertKind, serverCfg, notify };\n";
const tmp = `/tmp/apns-alerts-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const BUNDLE = ["com", "maisy" + "sen", "nswtransport"].join(".");
const TOKEN = "4d944fb2d231498b310dba1fe400a7171683e0bf9defff14228de63856464c2a";

const apple = [];
const expo = [];
let expoAnswer = "ok";
let nsw = 0;
globalThis.fetch = async (u, init) => {
  u = String(u);
  if (u.startsWith("https://api.push.apple.com/")) { apple.push({ url: u, headers: init.headers, body: JSON.parse(init.body) }); return new Response("", { status: 200, headers: { "apns-id": "x" } }); }
  if (u.startsWith("https://exp.host/")) {
    const msgs = JSON.parse(init.body);
    expo.push(...msgs);
    return new Response(JSON.stringify({ data: msgs.map(() => (expoAnswer === "ok" ? { status: "ok" } : { status: "error", message: "x", details: { error: expoAnswer } })) }), { status: 200 });
  }
  nsw++;
  return new Response("{}", { status: 503 });
};

const MIN = 60000;
const T = Date.parse("2026-10-31T11:58:30+11:00"); // the T1's departure
const ARR = Date.parse("2026-10-31T12:06:00+11:00");
const iso = (t) => new Date(t).toISOString();
const LEG = { mode: "train", line: "T1", tripId: "808G", stopId: "2135237", toStopId: "2131123", from: "Strathfield Station", to: "Ashfield Station", towards: "Hornsby via Gordon",
  planned: iso(T), arrPlanned: iso(ARR), estimated: iso(T), fromPlatform: "Platform 7", feed: "" };

function fakeDB({ flags = { apnsAlerts: true }, expoRows = [], apnsRows = [TOKEN] } = {}) {
  const sent = new Set();
  const notes = [];
  const updates = [];
  const expoUpdates = [];
  let id = 200;
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    run: async () => {
      if (/INSERT OR IGNORE INTO watch_sent/.test(q)) { const k = args[0] + "|" + args[1]; if (sent.has(k)) return { meta: { changes: 0 } }; sent.add(k); return { meta: { changes: 1 } }; }
      if (/INSERT INTO notes/.test(q)) { notes.push({ id: ++id, title: args[4], body: args[5], at: globalThis.__now }); return { meta: { changes: 1, last_row_id: id } }; }
      if (/^UPDATE notes SET pushed/.test(q)) { const n = notes.find((x) => x.id === args[0]); if (n) { n.pushed = args[1]; n.push_status = args[2]; } return { meta: { changes: 1 } }; }
      if (/^UPDATE expo_tokens SET last_status/.test(q)) { expoUpdates.push(args); const r = expoRows.find((x) => x.token === args[0]); if (r) r.last_status = args[1]; return { meta: { changes: 1 } }; }
      if (/^UPDATE watches SET spec/.test(q)) { updates.push(args); return { meta: { changes: 1 } }; }
      if (/^UPDATE watches SET state/.test(q)) { updates.push([args[0], null, args[1]]); return { meta: { changes: 1 } }; }
      return { meta: { changes: 1, last_row_id: ++id } };
    },
    all: async () => {
      if (/FROM expo_tokens WHERE device/.test(q)) return { results: expoRows.filter((r) => r.device === args[0]) };
      if (/FROM apns_devices WHERE device/.test(q)) return { results: /COUNT/.test(q) ? [{ n: apnsRows.length }] : apnsRows.map((token) => ({ token })) };
      if (/COUNT\(\*\) AS n FROM watches WHERE active = 1/.test(q)) return { results: [{ n: 1 }] };
      return { results: [] };
    },
    first: async () => (/FROM app_config WHERE platform = 'server'/.test(q) && flags ? { body: JSON.stringify({ flags }) } : null),
  });
  return { notes, updates, expoUpdates, DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({ meta: { changes: 1 } })) } };
}

/** Bidur's watch (Start trip, no server Get off now) over the minute tick, on live times that keep the timetable. */
async function ride({ spec = {}, db = {}, from = T - 4 * MIN, to = ARR + 3 * MIN, state = {} } = {}) {
  W.serverCfg.at = 0;
  apple.length = 0; expo.length = 0;
  globalThis.__fakeLive = (sp, now) => sp.legs.map((l) => ({ dep: Date.parse(l.planned), depLive: true, arr: Date.parse(l.arrPlanned), arrLive: true, delay: 0, arrDelay: 0,
    cancelled: false, platform: "Platform 7", platformFrom: null, platformSeen: true, vehicle: null, boardItems: [] }));
  globalThis.__fakeOne = () => ({ nextIsYours: false, stopsLeft: 3, eta: null });
  const f = fakeDB(db);
  const env = { TFNSW_API_KEY: "t", DB: f.DB, APNS_KEY: PEM, APNS_BUNDLE: BUNDLE };
  const w = { id: "EqhCys_trPw", device: "app11493p230x136d1h241h5b6r", spec: JSON.stringify({ legs: [LEG], track: true, to: { name: "Ashfield Station" }, ...spec }), state: JSON.stringify({ started: T - 2 * MIN, ...state }), expires: ARR + 3 * 3600000, active: 1 };
  const realNow = Date.now;
  Date.now = () => globalThis.__now;
  try {
  for (let now = from; now <= to; now += MIN) {
    if (!w.active) break;
    globalThis.__now = now;
    await W.processWatch(env, { ...w }, now);
    const u = f.updates[f.updates.length - 1];
    if (u) { if (u[1]) w.spec = u[1]; w.state = u[2]; if (u[4] != null) w.active = u[4]; }
  }
  } finally { Date.now = realNow; }
  globalThis.__fakeLive = null; globalThis.__fakeOne = null;
  return { ...f, apple: [...apple], expo: [...expo] };
}

test("(b) a Start trip watch never sends Leave now; one planned from Watch this trip still does", async () => {
  const r = await ride();
  assert.deepEqual(r.notes.filter((n) => /^Leave now/.test(n.title)), [], JSON.stringify(r.notes.map((n) => n.title)));
  assert.ok(r.notes.some((n) => /^Arriving at Ashfield/.test(n.title)), "the arrival alert still comes");
  const r2 = await ride({ spec: { track: false } });
  assert.equal(r2.notes.filter((n) => n.title === "Leave now").length, 1);
  assert.equal(nsw, 0);
});

test("(a) no Expo token: each alert goes to Apple on the phone's own token, with expiry at its moment and a collapse id", async () => {
  const r = await ride();
  assert.equal(r.expo.length, 0);
  assert.equal(r.apple.length, r.notes.length, "one Apple push per alert");
  const arr = r.apple.find((m) => /^Arriving at Ashfield/.test(m.body.aps.alert.title));
  assert.ok(arr);
  assert.equal(arr.url, "https://api.push.apple.com/3/device/" + TOKEN);
  assert.equal(arr.headers["apns-push-type"], "alert");
  assert.equal(arr.headers["apns-topic"], BUNDLE, "the app's own topic, not the Live Activity one");
  assert.equal(arr.headers["apns-collapse-id"], "wEqhCys_trPw-arr0");
  assert.equal(Number(arr.headers["apns-expiration"]), Math.floor(ARR / 1000), "Apple drops it once the train is in");
  assert.equal(arr.body.aps.sound, "default");
  assert.equal(arr.body.body.watch, "EqhCys_trPw");
  assert.equal(arr.body.watch, "EqhCys_trPw");
  const done = r.apple.find((m) => /^You've arrived/.test(m.body.aps.alert.title));
  assert.equal(done.headers["apns-collapse-id"], "wEqhCys_trPw-done");
  // Marked pushed, so the app's catch-up ask never shows them again.
  for (const n of r.notes) { assert.equal(n.pushed, 1, n.title); assert.equal(JSON.parse(n.push_status).apnsDevice, "app11493p230x136d1h241h5b6r"); }
});

test("(a) the flag off (as deployed until an admin turns it on): nothing goes to Apple, exactly as before", async () => {
  const r = await ride({ db: { flags: {} } });
  assert.equal(r.apple.length, 0);
  assert.ok(r.notes.length > 0 && r.notes.every((n) => n.pushed === 0));
  const r2 = await ride({ db: { flags: null } });
  assert.equal(r2.apple.length, 0, "no server config row at all");
});

test("(a) a working Expo token is used as before and Apple is not asked", async () => {
  expoAnswer = "ok";
  const r = await ride({ db: { expoRows: [{ token: "ExponentPushToken[abcdefghijk]", device: "app11493p230x136d1h241h5b6r" }] } });
  assert.ok(r.expo.length > 0);
  assert.equal(r.apple.length, 0);
});

test("(c) an Expo token answering InvalidCredentials is marked dead, skipped after, and the alert goes to Apple", async () => {
  expoAnswer = "InvalidCredentials";
  const rows = [{ token: "ExponentPushToken[deadbeefdead]", device: "app11493p230x136d1h241h5b6r" }];
  const r = await ride({ db: { expoRows: rows } });
  expoAnswer = "ok";
  assert.equal(r.expo.length, 1, "tried once");
  assert.equal(rows[0].last_status, "dead: InvalidCredentials");
  assert.equal(r.apple.length, r.notes.length, "every alert reached the phone by Apple");
  // An older row that only says InvalidCredentials counts as dead too.
  const r2 = await ride({ db: { expoRows: [{ token: "ExponentPushToken[olderolder12]", device: "app11493p230x136d1h241h5b6r", last_status: "InvalidCredentials" }] } });
  assert.equal(r2.expo.length, 0);
  // The phone registering the token again clears the mark (POST /api/expo).
  // With the trip flow switch off (every phone today) a register again still clears the mark; with tripflow2 on a dead
  // token stays dead (G14, 31 Oct phase 2).
  assert.match(raw, /fails = 0,\s*last_status = CASE WHEN \?6 = 1 AND expo_tokens\.last_status LIKE 'dead: %' THEN expo_tokens\.last_status ELSE NULL END`\)/);
});

test("(a) server Get off now is accepted with the phone's own token (flag on), time sensitive, Kylie's sound, collapse per leg", async () => {
  const f = fakeDB();
  const env = { TFNSW_API_KEY: "t", DB: f.DB, APNS_KEY: PEM, APNS_BUNDLE: BUNDLE };
  W.serverCfg.at = 0;
  const b = { getOff: 1, track: true };
  const fOn = fakeDB({ flags: { apnsAlerts: true, getOffPush: true } });
  assert.equal(await W.getOffAccept({ ...env, DB: fOn.DB }, b, "app11493p230x136d1h241h5b6r"), true);
  W.serverCfg.at = 0;
  const fOff = fakeDB({ flags: { getOffPush: true } });
  assert.equal(await W.getOffAccept({ ...env, DB: fOff.DB }, b, "app11493p230x136d1h241h5b6r"), false, "apnsAlerts off: as before (needs an Expo token)");
  W.serverCfg.at = 0;
  apple.length = 0;
  globalThis.__now = ARR - 80000;
  await W.notify({ ...env, DB: fOn.DB }, { device: "app11493p230x136d1h241h5b6r" }, { title: "Get off now: Ashfield", body: "This is your stop, due 12:06pm.", url: "/", tag: "wXoff0", watchId: "X", getOff: "0", timeSensitive: true, ttl: 180, sound: "getoff_now", kind: "off0", dueAt: ARR });
  assert.equal(apple.length, 1);
  assert.equal(apple[0].body.aps["interruption-level"], "time-sensitive");
  assert.equal(apple[0].body.aps.sound, "getoff_now.wav");
  assert.equal(apple[0].body.body.getOff, "0");
  assert.equal(apple[0].headers["apns-collapse-id"], "wX-off0");
});

test("expiry and kinds: Leave now at its departure, Get off now a minute after the arrival, You've arrived 45 s, never under 30 s", () => {
  const now = 1000000;
  assert.equal(W.alertExpiry({ kind: "leave", dueAt: now + 5 * MIN }, now), now + 5 * MIN);
  assert.equal(W.alertExpiry({ kind: "leave", dueAt: now - MIN }, now), now + 30000);
  assert.equal(W.alertExpiry({ kind: "off0", dueAt: now + MIN }, now), now + 2 * MIN);
  assert.equal(W.alertExpiry({ kind: "done" }, now), now + 45000);
  assert.equal(W.alertExpiry({ kind: "delay" }, now), now + 2 * MIN);
  assert.equal(W.alertExpiry({ ttl: 1200 }, now), now + 1200000);
  assert.equal(W.alertKind("delay:3"), "delay");
  assert.equal(W.alertKind("plat:0:Platform 7"), "plat");
  assert.equal(W.alertKind("arr:1"), "arr1");
  assert.equal(W.alertKind(undefined, "r"), "conn");
  assert.equal(W.alertKind("off:0", "off0", "0"), "off0");
});

test("catch-up ask: Bidur's three at 12:07:10 are not news; fresh ones are; one Apple brought to this phone is not repeated", () => {
  const dev = "app11493p230x136d1h241h5b6r";
  const at = (s) => Date.parse(`2026-10-31T${s}+11:00`);
  const notes = [
    { id: 207, at: at("11:57:57"), title: "Leave now", body: "Your T1 is 0 min away, on time. From Platform 7.", push_status: '{"web":[],"expo":[]}' },
    { id: 208, at: at("12:03:56"), title: "Arriving at Ashfield Station in 2 min", body: "Get ready to get off. Your T1 gets in at 12:06pm.", push_status: '{"web":[],"expo":[]}' },
    { id: 209, at: at("12:06:55"), title: "You've arrived at Ashfield", body: "Your T1 got in at 12:06pm. The trip has ended.", push_status: '{"web":[],"expo":[]}' },
  ];
  assert.deepEqual(notes.map((n) => W.noteForCatchUp(n, at("12:07:10"), dev)), [false, false, false]);
  assert.equal(W.noteForCatchUp(notes[0], at("11:58:10"), dev), true, "Leave now fresh");
  assert.equal(W.noteForCatchUp(notes[1], at("12:04:30"), dev), true, "Arriving fresh");
  assert.equal(W.noteForCatchUp(notes[1], at("12:06:27"), dev), false, "its arrival passed");
  assert.equal(W.noteForCatchUp(notes[2], at("12:06:40"), dev), true, "40 s after the arrival");
  assert.equal(W.noteForCatchUp({ ...notes[1], push_status: JSON.stringify({ web: [], expo: [], apns: ["ok"], apnsDevice: dev }) }, at("12:04:00"), dev), false, "Apple brought it");
  assert.equal(W.noteForCatchUp({ ...notes[1], push_status: JSON.stringify({ web: [], expo: [], apns: ["ok"], apnsDevice: "other" }) }, at("12:04:00"), dev), true, "another phone of the same profile");
  assert.equal(W.noteForCatchUp({ id: 1, at: null, title: "x", body: "" }, at("12:04:00"), dev), true, "no time: as before");
  // Only the catch-up ask is filtered (the Watching list asks with since 0), and the answer keeps its fields.
  assert.match(raw, /rows\.filter\(\(n\) => !\(since > 0\) \|\| noteForCatchUp\(n, nowMs, device\)\)\.map\(\(\{ push_status, \.\.\.n \}\) => \(since > 0 && \/"tf":1\/\.test\(String\(push_status \|\| ""\)\) \? \{ \.\.\.n, silent: true \} : n\)\)/);
});
