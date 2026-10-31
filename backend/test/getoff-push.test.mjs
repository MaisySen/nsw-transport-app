// Get off now from the server (30 Oct, owner: "we are a live trip viewer, we can't mess up"). With the phone locked
// the phone's own Get off now rings at the time worked out when the app was last open, so a bus running late after
// that made it ring early. Build 210 starts its trip watch with getOff: 1; when the server accepts, the watch sends
// Get off now from the live times the minute tick already reads (no extra request), once per leg, and that leg's
// Next stop or Arriving alert is not sent beside it. No live time for over 5 min: one alert worded as timetable.
// Builds 201 to 209 never send getOff and get exactly the alerts they had. No NSW call: liveLegs and oneStopCheck
// are stubbed and fetch answers only the Expo push service.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const raw = fs.readFileSync(root + "src/worker.js", "utf8");
const src = raw
  .replace(/export default\s*\{/, "const __default = {")
  .replace("async function liveLegs(env, spec, now, opts = {}) {", "async function liveLegs(env, spec, now, opts = {}) {\n  if (globalThis.__fakeLive) return globalThis.__fakeLive(spec, now);")
  .replace("async function oneStopCheck(env, l) {", "async function oneStopCheck(env, l) {\n  if (globalThis.__fakeOne) return globalThis.__fakeOne(l);")
  + "\nexport { processWatch, createWatch, getOffDecide, getOffPushWords, getOffAccept, getOffNoFeedPass, serverCfg, GETOFF_WATCH_CAP };\n";
const tmp = `/tmp/getoff-push-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const expo = [];
let nswCalls = 0;
globalThis.fetch = async (u, init) => {
  if (String(u).startsWith("https://exp.host/")) {
    const msgs = JSON.parse(init.body);
    expo.push(...msgs);
    return new Response(JSON.stringify({ data: msgs.map(() => ({ status: "ok" })) }), { status: 200 });
  }
  nswCalls++;
  return new Response("{}", { status: 503 });
};

const MIN = 60000;
const T = Date.UTC(2026, 9, 30, 6, 0, 0); // Friday 5:00pm Sydney
const iso = (t) => new Date(t).toISOString();
const busLeg = { mode: "bus", line: "530", tripId: "530-1700", stopId: "2000111", toStopId: "2000222", from: "Stop A", to: "Stop B", towards: "Five Dock",
  planned: iso(T), arrPlanned: iso(T + 20 * MIN), feed: "" };

const ON = JSON.stringify({ flags: { getOffPush: true, liveStops: true } }); // opt in (31 Oct): off until an admin turns it on
function fakeDB({ tokens = 1, active = 1, serverBody = ON } = {}) {
  const sentKeys = new Set();
  const notes = [];
  const updates = [];
  let id = 0;
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    run: async () => {
      if (/INSERT OR IGNORE INTO watch_sent/.test(q)) {
        const k = args[0] + "|" + args[1];
        if (sentKeys.has(k)) return { meta: { changes: 0 } };
        sentKeys.add(k);
        return { meta: { changes: 1 } };
      }
      if (/INSERT INTO notes/.test(q)) { notes.push({ title: args[4], body: args[5], at: globalThis.__now, tag: args[7] }); return { meta: { changes: 1, last_row_id: ++id } }; }
      if (/^UPDATE watches SET spec/.test(q)) { updates.push(args); return { meta: { changes: 1 } }; }
      if (/^UPDATE watches SET state/.test(q)) { updates.push([args[0], null, args[1]]); return { meta: { changes: 1 } }; }
      return { meta: { changes: 1, last_row_id: ++id } };
    },
    all: async () => {
      if (/FROM expo_tokens WHERE device/.test(q)) return { results: /COUNT/.test(q) ? [{ n: tokens }] : tokens ? [{ token: "ExponentPushToken[t]", device: args[0] }] : [] };
      if (/COUNT\(\*\) AS n FROM watches WHERE active = 1/.test(q)) return { results: [{ n: active }] };
      if (/FROM watches WHERE active = 1 ORDER BY created/.test(q)) return { results: globalThis.__rows || [] };
      return { results: [] };
    },
    first: async () => (/FROM app_config WHERE platform = 'server'/.test(q) && serverBody ? { body: serverBody } : null),
  });
  return { notes, updates, DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({ meta: { changes: 1 } })) } };
}

/**
 * Runs the minute tick (two checks at the same moment, as the tick and an open app can) from `from` to `to`.
 * arrAt(now): the live arrival at your stop (null: no live time this tick). next(now): the vehicle has left the stop
 * before yours.
 */
async function ride({ spec = {}, arrAt, next = () => false, from = T + 2 * MIN, to = T + 26 * MIN, step = MIN, legs = [busLeg] } = {}) {
  W.serverCfg.at = 0;
  expo.length = 0;
  let ones = 0;
  globalThis.__fakeLive = (sp, now) => sp.legs.map((l, i) => {
    const a = arrAt(now, i);
    return { i, dep: Date.parse(l.planned), depLive: a != null, arr: a != null ? a : Date.parse(l.arrPlanned), arrLive: a != null, delay: 0, arrDelay: 0,
      cancelled: false, platform: "", platformFrom: null, platformSeen: true, vehicle: null, boardItems: [] };
  });
  globalThis.__fakeOne = (l) => { ones++; return { nextIsYours: !!next(globalThis.__now), stopsLeft: next(globalThis.__now) ? 1 : 3, eta: null }; };
  const f = fakeDB();
  const env = { TFNSW_API_KEY: "t", DB: f.DB };
  const w = { id: "wgo", device: "dGo", spec: JSON.stringify({ legs, track: true, to: { name: "Stop B" }, ...spec }), state: JSON.stringify({ started: T, leaveSent: true }), expires: T + 90 * MIN, active: 1 };
  for (let now = from; now <= to; now += step) {
    if (!w.active) break;
    globalThis.__now = now;
    await Promise.all([W.processWatch(env, { ...w }, now), W.processWatch(env, { ...w }, now)]);
    const u = f.updates[f.updates.length - 1];
    if (u) { w.spec = u[1]; w.state = u[2]; w.active = u[4]; }
  }
  globalThis.__fakeLive = null; globalThis.__fakeOne = null;
  return { notes: f.notes, ones, state: JSON.parse(w.state || "{}"), expo: [...expo] };
}

const getOff = (notes) => notes.filter((n) => /^Get off (now|soon)/.test(n.title));
const arrivals = (notes) => notes.filter((n) => /^(Next stop|Arriving|Change at)/.test(n.title));

test("a bus running 6 min late after the phone locked: Get off now comes from the live arrival, not the old time", async () => {
  // At the last app open the bus was on time (in at T+20); it then ran 6 min late (in at T+26).
  const r = await ride({ spec: { getOff: 1 }, arrAt: (now) => T + 26 * MIN, to: T + 30 * MIN });
  const g = getOff(r.notes);
  assert.equal(g.length, 1, JSON.stringify(r.notes));
  assert.equal(g[0].title, "Get off now: Stop B");
  assert.match(g[0].body, /This is your stop, due/);
  const sentAt = g[0].at;
  assert.ok(sentAt >= T + 26 * MIN - 90000 && sentAt < T + 26 * MIN, "within the 90 s before the live arrival: " + (T + 26 * MIN - sentAt) / 1000);
  assert.equal(arrivals(r.notes).length, 0, "no Arriving in 2 min a minute before it");
  assert.equal(g[0].tag, "wwgooff0");
});

test("the vehicle leaves the stop before yours 2.5 min out: Get off now at once, instead of Next stop", async () => {
  const arr = T + 20 * MIN;
  const r = await ride({ spec: { getOff: 1 }, arrAt: () => arr, next: (now) => now >= arr - 150000 });
  const g = getOff(r.notes);
  assert.equal(g.length, 1);
  assert.ok(g[0].at >= arr - 150000 && g[0].at <= arr - 90000, "at the Next stop moment");
  assert.equal(arrivals(r.notes).length, 0, "no Next stop beside it");
});

test("a long gap before your stop: Next stop as before, then Get off now 90 s out", async () => {
  const arr = T + 20 * MIN;
  const r = await ride({ spec: { getOff: 1 }, arrAt: () => arr, next: (now) => now >= arr - 6 * MIN });
  assert.deepEqual(r.notes.filter((n) => !/^You've arrived/.test(n.title)).map((n) => n.title.replace(/:.*/, "")), ["Next stop", "Get off now"]);
});

test("builds 201 to 209 (no getOff): no server Get off now, the alerts they had", async () => {
  const arr = T + 20 * MIN;
  const r = await ride({ arrAt: () => arr, next: (now) => now >= arr - 150000 });
  assert.equal(getOff(r.notes).length, 0);
  assert.deepEqual(arrivals(r.notes).map((n) => n.title), ["Next stop: Stop B"]);
});

test("no extra request: the same oneStopCheck count with and without getOff", async () => {
  const arr = T + 20 * MIN;
  const a = await ride({ arrAt: () => arr, next: (now) => now >= arr - 4 * MIN });
  const b = await ride({ spec: { getOff: 1 }, arrAt: () => arr, next: (now) => now >= arr - 4 * MIN });
  assert.equal(b.ones, a.ones);
  assert.equal(nswCalls, 0, "no NSW call");
});

test("live times gone for over 5 min: one alert worded as timetable, a minute before the timetable arrival", async () => {
  const r = await ride({ spec: { getOff: 1 }, arrAt: (now) => (now < T + 5 * MIN ? T + 20 * MIN : null) });
  const g = getOff(r.notes);
  assert.equal(g.length, 1, JSON.stringify(r.notes));
  assert.equal(g[0].title, "Get off soon: Stop B");
  assert.match(g[0].body, /No live times right now\. By the timetable you get in at/);
  assert.ok(g[0].at >= T + 19 * MIN && g[0].at < T + 20 * MIN);
});

test("a live time missing for one tick: the last live arrival (under 5 min old) stands", async () => {
  const arr = T + 24 * MIN;
  const r = await ride({ spec: { getOff: 1 }, arrAt: (now) => (now >= T + 22 * MIN && now < T + 24 * MIN ? null : arr) });
  const g = getOff(r.notes);
  assert.equal(g.length, 1, JSON.stringify(r));
  assert.equal(g[0].title, "Get off now: Stop B");
  assert.match(g[0].body, /\(last live time\)/);
  assert.ok(g[0].at >= arr - 90000 && g[0].at < arr);
  assert.ok(r.notes.some((n) => /^You've arrived/.test(n.title)), "the watch did not end at the timetable arrival");
});

test("the spoken sound only for an app that has it on; time sensitive; tagged for the app", async () => {
  const arr = T + 20 * MIN;
  const a = await ride({ spec: { getOff: 1, getOffVoice: 1 }, arrAt: () => arr });
  const m = a.expo.find((x) => /^Get off now/.test(x.title));
  assert.equal(m.sound, "getoff_now.wav");
  assert.equal(m.channelId, "getoff_now");
  assert.equal(m.interruptionLevel, "time-sensitive");
  assert.equal(m.data.getOff, "0");
  assert.equal(m.ttl, 180);
  const b = await ride({ spec: { getOff: 1 }, arrAt: () => arr });
  const n = b.expo.find((x) => /^Get off now/.test(x.title));
  assert.equal(n.sound, "default");
  assert.equal(n.channelId, "default");
  const c = await ride({ spec: { getOff: 1, getOffVoice: 1 }, arrAt: (now) => (now < T + 5 * MIN ? arr : null) });
  assert.equal(c.expo.find((x) => /^Get off soon/.test(x.title)).sound, "getoff_soon.wav", "a timetable alert says your stop is coming up, not get off at the next stop");
  const d = await ride({ arrAt: () => arr, next: (now) => now >= arr - 150000 });
  assert.equal(d.expo[0].interruptionLevel, undefined, "other alerts unchanged");
  assert.equal(d.expo[0].data.getOff, undefined);
});

test("a change: Get off now names the next service, one per leg", async () => {
  const leg2 = { mode: "train", line: "T1", tripId: "T1-1730", stopId: "2000222", toStopId: "2000333", from: "Stop B", to: "Stop C", towards: "Hornsby",
    planned: iso(T + 25 * MIN), arrPlanned: iso(T + 40 * MIN), feed: "" };
  const r = await ride({ spec: { getOff: 1 }, legs: [busLeg, leg2], arrAt: (now, i) => (i === 0 ? T + 21 * MIN : T + 41 * MIN), to: T + 45 * MIN });
  const g = getOff(r.notes);
  assert.equal(g.length, 2, JSON.stringify(r.notes));
  assert.equal(g[0].title, "Get off now: Stop B");
  assert.match(g[0].body, /^Change here to the .* T1\. Due /);
  assert.equal(g[1].title, "Get off now: Stop C");
});

test("the rule itself", () => {
  const now = T;
  const D = (o) => W.getOffDecide({ planned: T + 10 * MIN, seen: null, c: null, now, ...o });
  assert.equal(D({ o: { arr: T + 91000, arrLive: true } }), null);
  assert.deepEqual(D({ o: { arr: T + 90000, arrLive: true } }), { kind: "live", eta: T + 90000 });
  assert.equal(D({ o: { arr: T + 170000, arrLive: true } }), null);
  assert.equal(D({ o: { arr: T + 170000, arrLive: true }, c: { nextIsYours: true } }).kind, "live");
  assert.equal(D({ o: { arr: T + 190000, arrLive: true }, c: { nextIsYours: true } }), null, "a long gap waits");
  assert.equal(D({ o: { arr: T - 61000, arrLive: true } }), null, "never after the arrival");
  assert.equal(D({ o: { arr: T + 5 * MIN, arrLive: false } }), null, "timetable 10 min away");
  assert.equal(D({ o: { arrLive: false }, planned: T + 59000 }).kind, "timetable");
  assert.equal(D({ o: { arrLive: false }, planned: T + 59000, seen: { eta: T + 8 * MIN, at: T - 4 * MIN } }), null, "a fresh last live time beats the timetable");
  assert.equal(D({ o: { arrLive: false }, planned: T + 59000, seen: { eta: T + 80000, at: T - 4 * MIN } }).kind, "last");
  assert.equal(D({ o: { arrLive: false }, planned: T + 59000, seen: { eta: T + 80000, at: T - 6 * MIN } }).kind, "timetable", "over 5 min old (R2)");
});

test("accepted only when asked, switched on, with a push token and room in the minute tick", async () => {
  const b = { getOff: 1, track: true };
  const env = (o) => ({ DB: fakeDB(o).DB });
  W.serverCfg.at = 0;
  assert.equal(await W.getOffAccept(env({}), b, "d1"), true);
  assert.equal(await W.getOffAccept(env({}), { track: true }, "d1"), false, "older builds never ask");
  assert.equal(await W.getOffAccept(env({}), { getOff: 1 }, "d1"), false, "Start trip only");
  assert.equal(await W.getOffAccept(env({ tokens: 0 }), b, "d1"), false, "no push token: the phone keeps its own");
  assert.equal(await W.getOffAccept(env({ active: W.GETOFF_WATCH_CAP }), b, "d1"), false, "the tick would not read it");
  assert.equal(await W.getOffAccept({ ...env({}), GETOFF_PUSH: "off" }, b, "d1"), false);
  W.serverCfg.at = 0;
  assert.equal(await W.getOffAccept(env({ serverBody: JSON.stringify({ flags: { getOffPush: false } }) }), b, "d1"), false);
  W.serverCfg.at = 0;
  assert.equal(await W.getOffAccept(env({ serverBody: null }), b, "d1"), false, "opt in: no server config, off");
  W.serverCfg.at = 0;
  assert.equal(await W.getOffAccept(env({ serverBody: JSON.stringify({ flags: {} }) }), b, "d1"), false, "opt in: a deploy alone never starts it");
  W.serverCfg.at = 0;
  assert.equal(await W.getOffAccept(env({ serverBody: JSON.stringify({ flags: { getOffPush: true }, kill: { getOffPush: true } }) }), b, "d1"), false, "kill wins");
  W.serverCfg.at = 0;
});

test("createWatch stores it and says so; the voice only with it", async () => {
  W.serverCfg.at = 0;
  globalThis.__fakeLive = (sp) => sp.legs.map((l, i) => ({ i, dep: Date.parse(l.planned), depLive: false, arr: Date.parse(l.arrPlanned), arrLive: false, cancelled: false, platform: "", platformSeen: true, boardItems: [] }));
  const mk = async (body, o) => {
    const f = fakeDB(o);
    let stored = null;
    const DB = { ...f.DB, prepare: (q) => {
      const s = f.DB.prepare(q);
      if (/^INSERT INTO watches/.test(q)) return { bind: (...a) => { stored = JSON.parse(a[5]); return s; } };
      if (/SELECT \* FROM watches WHERE id/.test(q)) return { bind: () => ({ first: async () => ({ id: "x", device: "d1", spec: JSON.stringify(stored), state: "{}", expires: Date.now() + 3600000, active: 1 }) }) };
      return s;
    } };
    const r = await W.createWatch({ DB }, { device: "d1", legs: [busLeg], track: true, silentStart: true, ...body }, T - 5 * MIN);
    return { r, stored };
  };
  const a = await mk({ getOff: 1, getOffVoice: 1 });
  assert.equal(a.r.getOff, true);
  assert.equal(a.stored.getOff, 1);
  assert.equal(a.stored.getOffVoice, 1);
  const b = await mk({ getOff: 1, getOffVoice: 1 }, { tokens: 0 });
  assert.equal(b.r.getOff, undefined, "not accepted: the answer says nothing, the phone keeps its own");
  assert.equal(b.stored.getOff, undefined);
  assert.equal(b.stored.getOffVoice, undefined);
  const c = await mk({});
  assert.equal(c.r.getOff, undefined);
  globalThis.__fakeLive = null;
});

test("over the NSW budget: the no feed pass still sends it, with no request", async () => {
  W.serverCfg.at = 0;
  expo.length = 0;
  const before = nswCalls;
  const f = fakeDB();
  const spec = { legs: [busLeg], track: true, getOff: 1 };
  const row = (st) => ({ id: "wnf", device: "dNf", spec: JSON.stringify(spec), state: JSON.stringify(st), active: 1 });
  globalThis.__rows = [row({ offSeen: { [`0:${busLeg.tripId}`]: { eta: T + 23 * MIN, at: T + 20 * MIN } } })];
  assert.deepEqual(await W.getOffNoFeedPass({ DB: f.DB }, T + 21 * MIN), [], "last live arrival 2 min away: not yet");
  const out = await W.getOffNoFeedPass({ DB: f.DB }, T + 21 * MIN + 40000);
  assert.deepEqual(out, [{ id: "wnf", leg: 0, kind: "last" }]);
  assert.equal(f.notes[0].title, "Get off now: Stop B");
  globalThis.__rows = [row({ off: { [`0:${busLeg.tripId}`]: "last" } })];
  assert.deepEqual(await W.getOffNoFeedPass({ DB: f.DB }, T + 22 * MIN), [], "once");
  globalThis.__rows = [{ ...row({}), spec: JSON.stringify({ legs: [busLeg], track: true }) }];
  assert.deepEqual(await W.getOffNoFeedPass({ DB: f.DB }, T + 19 * MIN + 30000), [], "a watch that did not take it");
  assert.equal(nswCalls, before);
  globalThis.__rows = null;
});

test("the wiring", () => {
  // The old path unchanged; the new trip flow (tripFlow 2 and tripflow2 on) takes it only with a working route (G14).
  assert.match(raw, /if \(tf \? \(b\.getOff === 1 && !!b\.track && \(await tfRoute\(env, device\)\)\.any\) : await getOffAccept\(env, b, device\)\) \{ spec\.getOff = 1; if \(b\.getOffVoice === 1\) spec\.getOffVoice = 1; \}/);
  assert.match(raw, /\.\.\.\(n\.timeSensitive \? \{ interruptionLevel: "time-sensitive" \} : \{\}\)/);
  assert.match(raw, /out\.getOffNoFeed = await getOffNoFeedPass\(env, Date\.now\(\)\)/);
});
