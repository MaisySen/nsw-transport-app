// Build 210 end to end run on this machine (31 Oct 2026, final check before build 210): no real Transport for NSW,
// no production, no Apple, no Expo. tools/fake-nsw.mjs (mode trains) serves a synthetic Sydney Trains network and its
// trip update feed; the worker runs in this process on a node:sqlite D1, with the clock moved by the run, and every push
// to Apple (Live Activity) and to Expo (Get off now) is caught and written down instead of sent.
// What it checks, per scenario:
//   on    switches on (platform=server flags getOffPush and liveStops true): the card pushes carry the stop track (under
//         4 KB), Get off now goes once per leg when the live arrival is 90 s or less away, and moves when the run falls
//         4 min behind after the phone locked;
//   stale the feed stops updating mid ride: past the 5 min live cap the card and the alert fall back to the timetable,
//         and the alert says so;
//   off   no server config (a plain deploy): no Get off now from the server, no stop track (the card draws the bar);
//   kill  switches on but killed (kill.getOffPush, kill.liveStops): same as off.
// node backend/tools/sim210.mjs [out.json]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { makeD1 } from "../test/helpers/d1.mjs";

const backend = path.resolve(new URL("..", import.meta.url).pathname);
const PORT = 8800 + Math.floor(Math.random() * 100);
const FAKE = `http://127.0.0.1:${PORT}`;
const SIM0 = Date.parse("2026-11-02T08:00:00+11:00"); // a Monday morning
const MIN = 60000;

let clock = SIM0;
const realNow = Date.now.bind(Date);
Date.now = () => clock;

const src = fs.readFileSync(path.join(backend, "src/worker.js"), "utf8").replace(/export default\s*\{/, "const __default = {") +
  "\nexport { __default, processWatch, tickLiveActivities, serverCfg, service };\n";
const tmp = path.join(backend, `.sim210-${process.pid}.mjs`);
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const fake = spawn(process.execPath, [path.join(backend, "tools/fake-nsw.mjs"), String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
process.on("exit", () => fake.kill());
await new Promise((r) => fake.stdout.once("data", r));
const realFetch = globalThis.fetch;
const caught = { apple: [], expo: [], nsw: 0, other: [] };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  if (u.startsWith("https://api.transport.nsw.gov.au/")) { caught.nsw++; return realFetch(FAKE + u.slice("https://api.transport.nsw.gov.au".length), { headers: init.headers }); }
  if (/^https:\/\/api(\.sandbox|\.development)?\.push\.apple\.com\//.test(u)) {
    caught.apple.push({ at: clock, bytes: Buffer.byteLength(init.body), headers: init.headers, body: JSON.parse(init.body) });
    return new Response(null, { status: 200, headers: { "apns-id": "sim-" + caught.apple.length } });
  }
  if (u.startsWith("https://exp.host/")) {
    const msgs = JSON.parse(init.body); for (const m of msgs) caught.expo.push({ at: clock, ...m });
    return new Response(JSON.stringify({ data: msgs.map(() => ({ status: "ok", id: "sim" })) }), { status: 200 });
  }
  caught.other.push(u);
  return new Response("{}", { status: 503 });
};

// The network: 20 trips over 30 stations, 10 stops each; trip 12 runs ST4 to ST13 (platform 1), starting 15 min after
// SIM0, 60 s late in the feed. The rider boards at ST5 and gets off at ST11.
const NET = { trips: 20, stations: 30, perTrip: 10, at: SIM0 };
const TRIP = "R12.1324.165.4.A.8.90000012";
const startS = Math.floor(SIM0 / 1000) - 45 * 60 + Math.floor((12 * 6000) / 20);
const plannedAt = (k) => (startS + k * 150 + 30) * 1000, arrAt = (k) => (startS + k * 150) * 1000;
const iso = (t) => new Date(t).toISOString();
const leg = { mode: "train", line: "T1", tripId: TRIP, stopId: "ST5P1", toStopId: "ST11P1", from: "Fake 5 Station", to: "Fake 11 Station",
  towards: "Fake Terminus", planned: iso(plannedAt(1)), arrPlanned: iso(arrAt(7)), color: "#F99D1C", feed: "" };
const trip = { id: "sim210", title: "Fake 5 Station to Fake 11 Station", origin: { id: "ST5", name: "Fake 5 Station" }, to: { id: "ST11", name: "Fake 11 Station" }, legs: [leg], rode: {}, arrivedAt: null };

async function setFeed(o) {
  const q = new URLSearchParams({ set: "trains", ...Object.fromEntries(Object.entries({ ...NET, ...o }).map(([k, v]) => [k, String(v)])) });
  await realFetch(`${FAKE}/__mode?${q}`);
}

function makeEnv(serverBody) {
  const DB = makeD1();
  for (const f of fs.readdirSync(path.join(backend, "migrations")).sort()) DB.sql.exec(fs.readFileSync(path.join(backend, "migrations", f), "utf8"));
  try { DB.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)"); } catch {}
  if (serverBody) DB.sql.prepare("INSERT INTO app_config (platform, body, at) VALUES ('server', ?, ?)").run(JSON.stringify(serverBody), clock);
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  // The static stop shards the worker reads from its assets (/stops/<key>.json) for the fake stations ST0 to ST29.
  const ASSETS = { fetch: async (rq) => {
    const m = new URL(rq.url).pathname.match(/^\/stops\/(.+)\.json$/);
    if (!m) return new Response("{}", { status: 404 });
    const shard = {};
    for (let s = 0; s < 30; s++) for (const p of ["", "P1", "P2"]) {
      const id = "ST" + s + p;
      if (id.slice(0, 3).replace(/[^A-Za-z0-9]/g, "_") === m[1]) shard[id] = ["Fake " + s + " Station" + (p ? ", Platform " + p.slice(1) : ""), -33.80 - s * 0.01, 151.00 + s * 0.01];
    }
    return new Response(JSON.stringify(shard), { headers: { "content-type": "application/json" } });
  } };
  return { DB, ASSETS, APNS_KEY: privateKey.export({ type: "pkcs8", format: "pem" }), APNS_BUNDLE: ["com", "maisy" + "sen", "nswtransport"].join("."), TFNSW_API_KEY: "fake-local-key", ADMIN_KEY: "s".repeat(24) };
}
const req = (p, body) => new Request("https://api.transportsydney.app" + p, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function run(name, serverBody, { lateAt = null, staleAt = null } = {}) {
  caught.apple = []; caught.expo = []; caught.nsw = 0; caught.other = [];
  W.serverCfg.at = 0; W.serverCfg.cfg = null;
  clock = SIM0 + 10 * MIN;
  const env = makeEnv(serverBody);
  const device = "simdevice210";
  await setFeed({ ts: clock });
  let r = await W.__default.fetch(req("/api/push/expo", { device, token: "ExponentPushToken[sim210sim210sim210]", platform: "ios" }), env, ctx);
  const tokOk = r.status;
  r = await W.__default.fetch(req("/api/watch", { device, kind: "trip", legs: [leg], track: true, getOff: 1, getOffVoice: 1, voice: "soon", silentStart: true, origin: trip.origin, to: trip.to }), env, ctx);
  const watchAns = await r.json();
  const LA = "ab".repeat(32);
  r = await W.__default.fetch(req("/api/live-activity", { token: LA, trip }), env, ctx);
  const laAns = r.status;
  if (process.env.SIM_DEBUG) { clock = SIM0 + 20 * MIN; await setFeed({ ts: clock }); console.error(JSON.stringify(await W.service(env, { trip: leg.tripId, mode: leg.mode, line: leg.line, feed: leg.feed, stop: leg.stopId, planned: leg.planned, to: leg.toStopId, dest: leg.towards, stopName: leg.from })).slice(0, 3000)); process.exit(0); }
  const end = arrAt(7) + 5 * MIN;
  let feedTs = clock, late = 0;
  console.error(name, 'watch', JSON.stringify(watchAns).slice(0, 300), 'la', laAns);
  for (; clock <= end; clock += 30000) {
    if (lateAt != null && clock >= lateAt) late = 240;
    if (staleAt == null || clock < staleAt) feedTs = clock;
    await setFeed({ ts: feedTs, late });
    const ws = await env.DB.prepare("SELECT * FROM watches WHERE active = 1").all();
    for (const w of ws.results) await W.processWatch(env, w, clock);
    await W.tickLiveActivities(env, clock);
    if (process.env.SIM_TRACE) console.error(iso(clock).slice(11, 19), 'apple', caught.apple.length, 'expo', caught.expo.length, 'nsw', caught.nsw);
  }
  const getOff = caught.expo.filter((m) => /^Get off/.test(m.title || ""));
  const pushes = caught.apple.map((a) => ({ at: iso(a.at), bytes: a.bytes, event: a.body.aps.event, priority: a.headers["apns-priority"],
    stopTrack: a.body.aps["content-state"].stopTrack || null, nextStop: a.body.aps["content-state"].nextStop ?? null, stopsLeft: a.body.aps["content-state"].stopsLeft ?? null,
    arrival: a.body.aps["content-state"].arrival, warning: a.body.aps["content-state"].warning ?? null, updated: a.body.aps["content-state"].updated ?? null, phase: a.body.aps["content-state"].phase, stale: a.body.aps["stale-date"] ?? null }));
  return {
    name, serverBody, tokenRegistered: tokOk, watch: { getOff: watchAns.watch && watchAns.watch.getOff === true, error: watchAns.error || null }, liveActivity: laAns,
    fakeNswCalls: caught.nsw, otherCalls: caught.other, expo: caught.expo.map((m) => ({ at: iso(m.at), title: m.title, body: m.body, sound: m.sound, priority: m.priority, interruptionLevel: m.interruptionLevel })),
    getOff: getOff.map((m) => ({ at: iso(m.at), title: m.title, body: m.body, sound: m.sound })),
    livePlannedArrival: iso(arrAt(7)), liveArrivalInFeed: iso(arrAt(7) + 60000), lateArrival: lateAt ? iso(arrAt(7) + 300000) : null,
    pushes, maxBytes: Math.max(0, ...caught.apple.map((a) => a.bytes)), withTrack: pushes.filter((p) => p.stopTrack).length,
  };
}

const ON = { flags: { getOffPush: true, liveStops: true } };
const SCENARIOS = {
  on: () => run("on", ON),
  late: () => run("on, 4 min late after the phone locked", ON, { lateAt: SIM0 + 25 * MIN }),
  stale: () => run("stale feed from 22 min (live times stop)", ON, { staleAt: SIM0 + 22 * MIN }),
  off: () => run("off (no server config, a plain deploy)", null),
  kill: () => run("kill (switches on, killed)", { flags: { getOffPush: true, liveStops: true }, kill: { getOffPush: true, liveStops: true } }),
};
// One scenario per process (the worker keeps state per isolate, as a fresh Worker would): node tools/sim210.mjs out.json on
const which = process.argv[3] ? process.argv[3].split(",") : Object.keys(SCENARIOS);
if (which.length > 1) {
  const { execFileSync } = await import("node:child_process");
  const all = { at: new Date(realNow()).toISOString(), sim0: iso(SIM0), trip: TRIP, leg, scenarios: [] };
  const f0 = (process.argv[2] || path.join(backend, ".sim210.json"));
  fake.kill();
  for (const k of which) {
    execFileSync(process.execPath, [new URL(import.meta.url).pathname, f0 + "." + k, k], { stdio: ["ignore", "inherit", "inherit"], timeout: 120000 });
    all.scenarios.push(...JSON.parse(fs.readFileSync(f0 + "." + k, "utf8")).scenarios); fs.unlinkSync(f0 + "." + k);
  }
  fs.writeFileSync(f0, JSON.stringify(all, null, 1));
  process.exit(0);
}
const out = { at: new Date(realNow()).toISOString(), sim0: iso(SIM0), trip: TRIP, leg, scenarios: [] };
try { out.scenarios.push(await SCENARIOS[which[0]]()); } finally { fake.kill(); }
const file = process.argv[2] || path.join(backend, ".sim210.json");
fs.writeFileSync(file, JSON.stringify(out, null, 1));
for (const s of out.scenarios) console.log(`${s.name}: watch getOff ${s.watch.getOff}${s.watch.error ? " (" + s.watch.error + ")" : ""}, LA ${s.liveActivity}, pushes ${s.pushes.length} (with track ${s.withTrack}, max ${s.maxBytes} B), Get off now ${s.getOff.length} ${s.getOff.map((g) => g.at.slice(11, 19) + " " + JSON.stringify(g.body)).join("; ")}, expo ${s.expo.length}, fake NSW calls ${s.fakeNswCalls}, other ${s.otherCalls.length}`);
process.exit(0);
