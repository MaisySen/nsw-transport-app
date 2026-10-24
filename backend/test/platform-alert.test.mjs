// Platform change while waiting: a followed trip whose departure platform changes before you
// board gets one alert per new platform, never a second for the same change, nothing when the
// departure board drops out for a minute, nothing after departure, and nothing when the server
// flag platformAlerts is off.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
let src = fs.readFileSync(root + "src/worker.js", "utf8")
  .replace(/export default\s*\{/, "const __default = {")
  .replace("async function liveLegs(env, spec, now, opts = {}) {", "async function liveLegs(env, spec, now, opts = {}) {\n  if (globalThis.__fakeLive) return globalThis.__fakeLive(spec, now);")
  + "\nexport { __default, processWatch, serverCfg };\n";
const tmp = `/tmp/platform-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
globalThis.fetch = async () => new Response("{}", { status: 503 });

const MIN = 60000;
const T = Date.UTC(2026, 9, 25, 21, 0, 0); // Monday 8:00am Sydney
const legs = [{ mode: "train", line: "T1", tripId: "T1-800", stopId: "2134103", toStopId: "2135102", from: "Burwood Station", to: "Strathfield Station", towards: "Hornsby",
  planned: new Date(T).toISOString(), arrPlanned: new Date(T + 5 * MIN).toISOString(), fromPlatform: "Platform 3" }];

function fakeDB(serverBody) {
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
      if (/INSERT INTO notes/.test(q)) { notes.push({ title: args[4], body: args[5], at: args[3] }); return { meta: { changes: 1, last_row_id: ++id } }; }
      if (/^UPDATE watches SET spec/.test(q)) { updates.push(args); return { meta: { changes: 1 } }; }
      return { meta: { changes: 1, last_row_id: ++id } };
    },
    all: async () => ({ results: [] }),
    first: async () => (/FROM app_config WHERE platform = 'server'/.test(q) && serverBody ? { body: serverBody } : null),
  });
  return { notes, updates, DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({ meta: { changes: 1 } })) } };
}

// plat(now) gives { platform, platformFrom, seen } for the board at that moment.
async function run(plat, { serverBody = null, from = T - 12 * MIN, to = T + 3 * MIN } = {}) {
  W.serverCfg.at = 0;
  globalThis.__fakeLive = (spec, now) => spec.legs.map((l, i) => {
    const p = plat(now);
    return { i, dep: Date.parse(l.planned), depLive: true, arr: Date.parse(l.arrPlanned), arrLive: true, delay: 0, arrDelay: 0, cancelled: false,
      platform: p.platform, platformFrom: p.platformFrom || null, platformSeen: p.seen !== false, vehicle: null, boardItems: [] };
  });
  const f = fakeDB(serverBody);
  const env = { TFNSW_API_KEY: "t", DB: f.DB };
  const w = { id: "wplat", device: "dPlat", spec: JSON.stringify({ legs, track: true, to: { name: "Strathfield Station" } }), state: null, expires: T + 60 * MIN, active: 1 };
  for (let now = from; now <= to; now += 30000) {
    if (!w.active) break;
    // The minute tick and an open app can check at the same moment.
    await Promise.all([W.processWatch(env, { ...w }, now), W.processWatch(env, { ...w }, now)]);
    const u = f.updates[f.updates.length - 1];
    if (u) { w.spec = u[1]; w.state = u[2]; w.active = u[4]; }
  }
  globalThis.__fakeLive = null;
  return f.notes.filter((n) => /^Platform changed/.test(n.title));
}

test("a change 5 min before departure sends one alert", async () => {
  const alerts = await run((now) => (now >= T - 5 * MIN ? { platform: "Platform 4", platformFrom: "Platform 3" } : { platform: "Platform 3" }));
  assert.equal(alerts.length, 1, JSON.stringify(alerts));
  assert.equal(alerts[0].title, "Platform changed to 4");
  assert.match(alerts[0].body, /now leaves from Platform 4, not Platform 3/);
});

test("a board that drops out does not read as a change", async () => {
  // Board reports Platform 4 (changed), then for a few minutes does not answer: the planned
  // Platform 3 stands in, marked not seen. One alert only, no false change back to 3.
  const alerts = await run((now) => {
    if (now < T - 8 * MIN) return { platform: "Platform 3" };
    if (now >= T - 6 * MIN && now < T - 3 * MIN) return { platform: "Platform 3", seen: false };
    return { platform: "Platform 4", platformFrom: "Platform 3" };
  });
  assert.equal(alerts.length, 1, JSON.stringify(alerts));
});

test("a second real change is its own alert", async () => {
  const alerts = await run((now) => (now >= T - 3 * MIN ? { platform: "Platform 1", platformFrom: "Platform 3" } : now >= T - 8 * MIN ? { platform: "Platform 4", platformFrom: "Platform 3" } : { platform: "Platform 3" }));
  assert.deepEqual(alerts.map((a) => a.title), ["Platform changed to 4", "Platform changed to 1"]);
});

test("no alert after departure", async () => {
  const alerts = await run((now) => (now > T ? { platform: "Platform 4", platformFrom: "Platform 3" } : { platform: "Platform 3" }));
  assert.equal(alerts.length, 0);
});

test("switched off with the server flag: no platform alerts", async () => {
  const alerts = await run((now) => (now >= T - 5 * MIN ? { platform: "Platform 4", platformFrom: "Platform 3" } : { platform: "Platform 3" }), { serverBody: JSON.stringify({ flags: { platformAlerts: false } }) });
  assert.equal(alerts.length, 0);
  W.serverCfg.at = 0;
});
