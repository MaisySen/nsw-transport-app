// Journey replay: a whole Start trip followed by the server watch, minute by minute, on a fake
// clock and fake live data. Strathfield to Redfern on the T1 (running 3 min late), change at
// Redfern to the T4 (running 1 min early), off at Kings Cross. It checks every alert the phone
// would get: each one once, times that agree, the trip ends at Kings Cross and nothing after.
// REPLAY_LOG=path writes the timeline.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
let src = fs.readFileSync(root + "src/worker.js", "utf8")
  .replace(/export default\s*\{/, "const __default = {")
  .replace("async function liveLegs(env, spec, now, opts = {}) {", "async function liveLegs(env, spec, now, opts = {}) {\n  if (globalThis.__fakeLive) return globalThis.__fakeLive(spec, now);")
  + "\nexport { __default, processWatch };\n";
const tmp = `/tmp/replay-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
globalThis.fetch = async () => new Response("{}", { status: 503 });

const MIN = 60000;
const T = Date.UTC(2026, 9, 24, 10, 30, 0); // 9:30pm Sydney
const legs = [
  { mode: "train", line: "T1", tripId: "T1-930", stopId: "213510", toStopId: "201510", from: "Strathfield Station", to: "Redfern Station", towards: "Hornsby",
    planned: new Date(T).toISOString(), arrPlanned: new Date(T + 9 * MIN).toISOString(), fromPlatform: "Platform 5" },
  { mode: "train", line: "T4", tripId: "T4-941", stopId: "201511", toStopId: "201110", from: "Redfern Station", to: "Kings Cross Station", towards: "Bondi Junction",
    planned: new Date(T + 15 * MIN).toISOString(), arrPlanned: new Date(T + 22 * MIN).toISOString(), fromPlatform: "Platform 11", walkBefore: 2 },
];

// Live data: the T1 runs 3 min late from the start, the T4 runs 1 min early.
function fakeLive(spec, now) {
  const late = 3 * MIN, early = -1 * MIN;
  return spec.legs.map((l, i) => {
    const d = i === 0 ? late : early;
    const dep = Date.parse(l.planned) + d, arr = Date.parse(l.arrPlanned) + d;
    return { i, dep, depLive: true, arr, arrLive: true, delay: Math.round(d / MIN), arrDelay: Math.round(d / MIN), cancelled: false, platform: l.fromPlatform, platformFrom: null, vehicle: null, boardItems: [] };
  });
}

function fakeDB() {
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
    first: async () => null,
  });
  return { notes, updates, DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({ meta: { changes: 1 } })) } };
}

test("replay: Strathfield to Kings Cross via Redfern, each alert once, ends at Kings Cross", async () => {
  globalThis.__fakeLive = fakeLive;
  const f = fakeDB();
  const env = { TFNSW_API_KEY: "t", DB: f.DB };
  const w = { id: "wreplay1", device: "dReplay", spec: JSON.stringify({ legs, track: true, to: { name: "Kings Cross Station" } }), state: null, expires: T + 4 * 60 * MIN, active: 1 };
  const timeline = [];
  let notesSeen = 0;
  const finArr = Date.parse(legs[1].arrPlanned) - MIN;
  for (let now = T - 6 * MIN; now <= finArr + 15 * MIN; now += 20000) {
    if (!w.active) break;
    // Two checks at the same moment (the minute tick and the open app) around each arrival.
    const racing = Math.abs(now - (Date.parse(legs[0].arrPlanned) + 3 * MIN - 2 * MIN)) < 10000 || Math.abs(now - (finArr - 2 * MIN)) < 10000;
    const runs = racing ? [W.processWatch(env, { ...w }, now), W.processWatch(env, { ...w }, now)] : [W.processWatch(env, { ...w }, now)];
    const results = await Promise.all(runs);
    const u = f.updates[f.updates.length - 1];
    if (u) { w.spec = u[1]; w.state = u[2]; w.active = u[4]; w.ended = u[5]; }
    for (const n of f.notes.slice(notesSeen)) timeline.push({ at: now, title: n.title, body: n.body });
    notesSeen = f.notes.length;
    if (results.some((r) => r.ended)) timeline.push({ at: now, title: "(watch ended)", body: results.find((r) => r.ended).phase });
  }
  globalThis.__fakeLive = null;

  const clock = (ms) => new Date(ms).toLocaleTimeString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" });
  const lines = timeline.map((e) => `${clock(e.at)}  ${e.title}${e.body ? "  |  " + e.body : ""}`);
  if (process.env.REPLAY_LOG) fs.writeFileSync(process.env.REPLAY_LOG, lines.join("\n") + "\n");

  const alerts = timeline.filter((e) => e.title !== "(watch ended)");
  const titles = alerts.map((e) => e.title.replace(/ in \d+ min$/, ""));
  assert.equal(new Set(titles).size, titles.length, "each alert once:\n" + lines.join("\n"));
  assert.equal(alerts.filter((e) => /^(Next stop: Redfern|Change at Redfern)/.test(e.title)).length, 1, "one change alert at Redfern");
  assert.equal(alerts.filter((e) => /^(Next stop: Kings Cross|Arriving at Kings Cross)/.test(e.title)).length, 1, "one get ready alert for Kings Cross");
  const arrived = alerts.filter((e) => /^You've arrived at Kings Cross$/.test(e.title));
  assert.equal(arrived.length, 1, "one arrived alert");
  assert.ok(arrived[0].at >= finArr, "arrived is said once the train is in, not before");
  assert.equal(alerts[alerts.length - 1].title, "You've arrived at Kings Cross", "nothing after arrived");
  // Times agree: the get ready alert and the arrived alert name the same arrival time.
  const at = clock(finArr).replace(/\s/g, "").toLowerCase();
  const ready = alerts.find((e) => /^(Next stop: Kings Cross|Arriving at Kings Cross)/.test(e.title));
  assert.match(ready.body.replace(/\s/g, "").toLowerCase(), new RegExp(at.replace(":", ":")), "get ready names " + at);
  assert.match(arrived[0].body.replace(/\s/g, "").toLowerCase(), new RegExp(at), "arrived names " + at);
  // The watch ends at Kings Cross, not later and not on a later train.
  assert.equal(w.active, 0, "watch ended");
  const endAt = timeline.find((e) => e.title === "(watch ended)").at;
  assert.ok(endAt <= finArr + 60000, "ended within a minute of arrival");
});
