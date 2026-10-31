// Server-path simulation of the new trip flow (31 Oct 2026, phase 2): a journey simulator case (app/sim/cases.mjs) run
// through the worker's real routes (POST /api/live-activity, /api/push/expo, /api/watch, GET /api/watches) and its
// trip flow scheduler (tfPass, with the run's own clock), against tools/fake-nsw.mjs mode "case" (the case's feeds and
// board, tools/case-feed.mjs). No Transport for NSW, no Apple, no Expo: every push is caught and written down. Then the
// server's alerts are compared with the simulator's (same kind and words, sent within 5 s) and its card pushes checked.
//   node backend/tools/simtrip.mjs [CASE ...]     (all cases where the server acts when none named)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { makeD1 } from "../test/helpers/d1.mjs";
import { caseById, caseNet, platformId, stationId } from "./case-feed.mjs";
import { simulate, clock as simClock } from "../../app/sim/journeySim.mjs";
import { CASES } from "../../app/sim/cases.mjs";
// The app and the server name stops short everywhere ("Burwood", not "Burwood Station": tripState stopShort); the
// simulator keeps the case's name. Words are compared with the station word taken out (as app/test/journeysim-real does).
const short = (s) => (s == null ? s : String(s).replace(/ Station\b(, Stand \w+)?/g, ""));

const backend = path.resolve(new URL("..", import.meta.url).pathname);
export const BASE = Date.parse("2026-11-02T00:00:00+11:00"); // a Monday, Sydney midnight
let clock = BASE;
const RealDate = Date;
class SimDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } }
SimDate.UTC = RealDate.UTC; SimDate.parse = RealDate.parse;
globalThis.Date = SimDate;

const raw = fs.readFileSync(path.join(backend, "src/worker.js"), "utf8").replace(/export default\s*\{/, "const __default = {");
// Only the names this worker has (an older branch has no trip flow pass: the run then drives its minute tick, which is
// how a failing-first run on server-211-rc shows what the old server does with each case).
const WANT = ["tfPass", "tfPassStep", "serverCfg", "TF", "LIVECARD", "tfLegRaw", "tfLegReading", "tfPlanLeg", "tfState", "tfCard", "tfNext", "runTick", "svcOffIndex"];
const src = raw + "\nexport { __default, " + WANT.filter((n) => new RegExp("\\n(?:async )?(?:function|const|let) " + n + "\\b").test(raw)).join(", ") + " };\n";
// A fresh copy of the worker for each case: its feed copies and shared jobs are kept in memory by the clock, and each
// case starts its clock again.
let W = null, loads = 0;
async function freshWorker() {
  const tmp = path.join(backend, `.simtrip-${process.pid}-${loads++}.mjs`);
  fs.writeFileSync(tmp, src);
  try { W = await import(tmp); } finally { fs.unlinkSync(tmp); }
}

let fake = null, FAKE = null;
async function startFake() {
  if (fake) return;
  const PORT = 8900 + Math.floor(Math.random() * 90);
  FAKE = `http://127.0.0.1:${PORT}`;
  fake = spawn(process.execPath, [path.join(backend, "tools/fake-nsw.mjs"), String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  process.on("exit", () => { try { fake.kill(); } catch {} });
  await new Promise((r) => fake.stdout.once("data", r));
}
/** A fresh copy of the worker with the trip flow parts exported (for unit tests). */
export async function loadWorker() { await freshWorker(); return W; }
/** Sets the virtual clock the worker copy reads (Date.now()). */
export function setClock(ms) { clock = ms; }
export function stopFake() { if (fake) { fake.kill(); fake = null; } }

const realFetch = globalThis.fetch;
let caught = null;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  if (u.startsWith("https://api.transport.nsw.gov.au/")) { caught.nsw++; const k = u.slice(31).split("?")[0].replace(/\/[^/]*$/, (x) => (/departure_mon|trip|stop_finder/.test(x) ? x : "")); caught.nswBy = caught.nswBy || {}; caught.nswBy[k] = (caught.nswBy[k] || 0) + 1; return realFetch(FAKE + u.slice("https://api.transport.nsw.gov.au".length), { headers: { ...(init.headers || {}), "x-sim-now": String(clock) } }); }
  if (/^https:\/\/api(\.sandbox|\.development)?\.push\.apple\.com\//.test(u)) {
    caught.apple.push({ at: clock, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(null, { status: 200, headers: { "apns-id": "sim-" + caught.apple.length } });
  }
  if (u.startsWith("https://exp.host/")) {
    const msgs = JSON.parse(init.body); for (const m of msgs) caught.expo.push({ at: clock, ...m });
    return new Response(JSON.stringify({ data: msgs.map(() => ({ status: "ok", id: "sim" })) }), { status: 200 });
  }
  caught.other.push(u);
  return new Response("{}", { status: 503 });
};

const DEVICE = "simdevice0000000001";
const LA_TOKEN = "a".repeat(64);
const EXPO = "ExponentPushToken[simsimsimsimsim01]";

function makeEnv(net, flags) {
  const DB = makeD1();
  for (const f of fs.readdirSync(path.join(backend, "migrations")).sort()) DB.sql.exec(fs.readFileSync(path.join(backend, "migrations", f), "utf8"));
  try { DB.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)"); } catch {}
  DB.sql.exec("CREATE TABLE IF NOT EXISTS app_config (platform TEXT PRIMARY KEY, body TEXT NOT NULL, at INTEGER)");
  DB.sql.prepare("INSERT INTO app_config (platform, body, at) VALUES ('server', ?, ?)").run(JSON.stringify({ flags }), clock);
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const ASSETS = { fetch: async (rq) => {
    const m = new URL(rq.url).pathname.match(/^\/stops\/(.+)\.json$/);
    if (!m) return new Response("{}", { status: 404 });
    const shard = {};
    for (const [id, v] of Object.entries(net.names)) if (id.slice(0, 3).replace(/[^A-Za-z0-9]/g, "_") === m[1]) shard[id] = v;
    return new Response(JSON.stringify(shard), { headers: { "content-type": "application/json" } });
  } };
  return { DB, ASSETS, APNS_KEY: privateKey.export({ type: "pkcs8", format: "pem" }), APNS_BUNDLE: ["com", "maisy" + "sen", "nswtransport"].join("."), TFNSW_API_KEY: "fake-local-key", ADMIN_KEY: "s".repeat(24), API_ONLY: "1" };
}
const exec = { pending: [], waitUntil(p) { this.pending.push(Promise.resolve(p).catch(() => null)); }, passThroughOnException() {} };
async function call(env, method, p, body) {
  const res = await W.__default.fetch(new Request("https://api.transportsydney.app" + p, { method, headers: { "content-type": "application/json", "x-device": DEVICE }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, exec);
  await Promise.all(exec.pending.splice(0));
  let j = null; try { j = await res.json(); } catch {}
  return { status: res.status, body: j };
}

const at = (s) => BASE + s * 1000;
const sec = (msT) => Math.round((msT - BASE) / 1000);

/** The legs the new app would register for a case (its visible legs, sample stop ids from tools/case-feed.mjs). */
function legsFor(net) {
  return net.P.legs.filter((l) => !l.alt).map((l) => ({
    mode: l.mode, line: l.line, tripId: l.tripId, stopId: platformId(l.stops[0].name, l), toStopId: stationId(l.stops[l.off].name),
    from: l.stops[0].name.replace(/,.*$/, "") + (l.mode === "bus" ? "" : " Station"), to: l.stops[l.off].name.replace(/,.*$/, "") + (l.mode === "bus" ? "" : " Station"),
    planned: new RealDate(at(l.stops[0].tt)).toISOString(), arrPlanned: new RealDate(at(l.stops[l.off].tt)).toISOString(),
    fromPlatform: l.mode === "bus" ? (l.stand || "Stand A") : "Platform " + l.platform, towards: "Sample terminus", color: "#F99D1C", feed: "",
  }));
}

/** Runs one case through the server. opts: { flags } (server switches), { flow: 1 } registers as an old app. */
export async function runCase(id, opts = {}) {
  await startFake();
  await freshWorker();
  const c = caseById(id);
  const net = caseNet(c);
  const P = net.P;
  caught = { apple: [], expo: [], nsw: 0, other: [] };
  clock = at(P.start);
  await realFetch(`${FAKE}/__mode?set=case&case=${encodeURIComponent(id)}&base=${BASE}`);
  const direct = P.server.direct !== false;
  const reachable = P.server.reachable !== false;
  const flags = opts.flags || { tripflow2: true, getOffPush: true, liveStops: true, ...(direct ? {} : { apnsAlerts: false }) };
  const env = makeEnv(net, flags);
  W.serverCfg.at = 0;
  const c24 = !!(P.phone || []).find((p) => p.c24);
  const legs = legsFor(net);
  const flow = opts.flow === 1 ? {} : { tripFlow: 2, c24 };
  if (!reachable) return { id, skipped: "server not reachable in this case" };
  if (direct) await call(env, "POST", "/api/push/expo", { device: DEVICE, token: EXPO, platform: "ios" });
  await call(env, "POST", "/api/live-activity", { token: LA_TOKEN, device: DEVICE, activity: "sim", trip: { id: "sim", title: "sim", to: { id: "x", name: legs[legs.length - 1].to }, legs, rode: {}, ...flow } });
  const reg = await call(env, "POST", "/api/watch", { device: DEVICE, kind: "trip", legs, track: true, getOff: 1, getOffVoice: 1, to: { id: "x", name: legs[legs.length - 1].to }, ...flow });
  const wait = async (msW) => { clock += Math.max(0, msW); };
  let minute = Math.ceil(clock / 60000) * 60000;
  let catchUp = null;
  while (clock < at(P.end)) {
    if (clock < minute) clock = minute;
    W.serverCfg.at = 0;
    if (W.tfPass) await W.tfPass(env, minute, wait);
    else await W.runTick(env, { skipLa: true });
    minute += 60000;
    // the app opened: its catch-up ask (spec 2.6 G32), once, at the first open after locking
    const open = (P.phone || []).find((p) => p.app === "open" && at(p.at) > at(P.start) + 1000 && at(p.at) <= clock && at(p.at) > clock - 60000);
    if (open && !catchUp) { const r = await call(env, "GET", `/api/watches?device=${DEVICE}&since=1`); catchUp = { at: clock, notes: r.body ? r.body.notes : null }; }
  }
  return { id, net, reg: reg.body, caught, catchUp, ...summarise(caught, P) };
}

/** The server's alerts (Expo, Apple alert pushes, card pushes carrying an alert) and card pushes, in case time. */
function summarise(caught, P) {
  const alerts = [], pushes = [];
  for (const m of caught.expo) alerts.push({ t: sec(m.at), via: "expo", title: m.title, body: m.body, sound: m.sound, passive: m.interruptionLevel === "passive", ttl: m.ttl });
  for (const a of caught.apple) {
    const aps = a.body.aps || {};
    if (a.headers["apns-push-type"] === "alert") alerts.push({ t: sec(a.at), via: "apns", title: aps.alert.title, body: aps.alert.body, sound: aps.sound || null, passive: aps["interruption-level"] === "passive", expires: Number(a.headers["apns-expiration"]) * 1000 });
    else {
      const cs = aps["content-state"] || {};
      const A = (x) => (x == null ? null : sec((x + 978307200) * 1000));
      const p = { t: sec(a.at), event: aps.event, priority: Number(a.headers["apns-priority"]), phase: cs.phase, departs: A(cs.departs), legArrives: A(cs.legArrives), arrival: A(cs.arrival), updated: A(cs.updated), warning: cs.warning || null, platform: cs.platform || null, nextStop: cs.nextStop || null, stale: aps["stale-date"] ? sec(aps["stale-date"] * 1000) : null, alert: aps.alert || null };
      pushes.push(p);
      if (aps.alert) alerts.push({ t: sec(a.at), via: "card", title: aps.alert.title, body: aps.alert.body, sound: aps.alert.sound || null, passive: false });
    }
  }
  alerts.sort((a, b) => a.t - b.t);
  return { alerts, pushes };
}

/** The simulator's server alerts for a case: every ring the server sends (not the phone's backup, not in-app only). */
export function simAlerts(id) {
  const run = simulate(caseById(id));
  return { run, rings: run.rings.filter((r) => !r.backup && r.via !== "none (no route to the phone)" && !(r.via === "in-app note")) };
}

const KIND_SOUND = { headsup: "getoff_soon", getoff: "getoff_now", atstop: "getoff_now" };
/** Server alerts against the simulator's: same title and body, sent within 5 s (the simulator's decision moment). */
export function compare(id, server) {
  const { run, rings } = simAlerts(id);
  const used = new Set();
  const rows = [];
  for (const r of rings) {
    const k = server.alerts.findIndex((a, i) => !used.has(i) && short(a.title) === short(r.title) && short(a.body) === short(r.body) && Math.abs(a.t - r.t) <= 5);
    const near = server.alerts.findIndex((a, i) => !used.has(i) && short(a.title) === short(r.title) && Math.abs(a.t - r.t) <= 60);
    if (k >= 0) used.add(k);
    const a = k >= 0 ? server.alerts[k] : null;
    const wantSound = r.quiet ? null : KIND_SOUND[r.kind] || "default";
    const gotSound = a ? (a.passive ? null : String(a.sound || "default").replace(/\.wav$/, "")) : undefined;
    rows.push({ kind: r.kind, simT: r.t, simAt: simClock(r.t) + ":" + String(r.t % 60).padStart(2, "0"), title: r.title, body: r.body, serverT: a ? a.t : near >= 0 ? server.alerts[near].t : null, serverBody: a ? a.body : near >= 0 ? server.alerts[near].body : null, via: a ? a.via : null, match: !!a, sound: a ? gotSound === wantSound : false, wantSound, gotSound });
  }
  // nothing extra: every server alert is one the simulator also sends (ignoring the copy on the card when Expo also went)
  const extra = server.alerts.filter((a, i) => !used.has(i) && !(a.via === "card" && server.alerts.some((b, j) => used.has(j) && short(b.title) === short(a.title))));
  return { id, rows, extra, ok: rows.every((x) => x.match && x.sound) && extra.length === 0, sim: run };
}

/** The card pushes checked against the rules a phone shows (I2 and the 60 s cadence) and the simulator's countdown. */
export function checkPushes(id, server, simRun) {
  const bad = [];
  const ps = server.pushes;
  ps.forEach((p, i) => {
    const target = p.phase === "wait" ? p.departs : p.phase === "ride" ? (p.legArrives || p.arrival) : null;
    if (target != null && p.stale != null && p.stale > p.t && target < p.t - 1) bad.push(`push at ${p.t}: countdown target ${target} in the past while not stale (0:00)`);
    if (p.stale != null && target != null && p.stale > Math.max(target, p.t) + 1) bad.push(`push at ${p.t}: stale date ${p.stale} after the target ${target} (the timer would reach 0:00)`);
    if (/Trip started|Checking for the next one|Wake up/.test(String(p.warning))) bad.push(`push at ${p.t}: banned words ${p.warning}`);
    const next = ps[i + 1];
    if (next && p.event !== "end" && next.t - p.t > 61) bad.push(`gap of ${next.t - p.t} s after the push at ${p.t}`);
  });
  // wait phase: the card counts to the simulator's live departure (I1, G19)
  for (const f of simRun.frames) {
    if (!f.card || f.card.phase !== "waiting" || f.card.timer == null || f.card.step !== "live") continue;
    const p = [...ps].reverse().find((x) => x.t <= f.t);
    if (!p || f.t - p.t > 35 || p.phase !== "wait") continue;
    if (Math.abs(p.departs - f.card.timer) > 5) { bad.push(`at ${f.t}: card counts to ${p.departs}, simulator to ${f.card.timer}`); break; }
  }
  return bad;
}


/**
 * One /api/service answer for a case's leg at case time tSec, as the app asks it (board=1 for a trip flow 2 app before
 * the train leaves). For the board row contract test (backend/test/service-board.test.mjs).
 */
export async function serviceAt(id, tSec, extra = {}, li = 0, opts = {}) {
  await startFake();
  await freshWorker();
  const net = caseNet(caseById(id));
  // opts.names: more stop index entries (a stop id the case's feed does not list, for matching by name)
  if (opts.names) Object.assign(net.names, opts.names);
  caught = { apple: [], expo: [], nsw: 0, other: [] };
  clock = at(tSec);
  await realFetch(`${FAKE}/__mode?set=case&case=${encodeURIComponent(id)}&base=${BASE}`);
  const env = makeEnv(net, { tripflow2: true, getOffPush: true, liveStops: true });
  W.serverCfg.at = 0;
  const l = legsFor(net)[li];
  const q = { trip: l.tripId, stop: l.stopId, planned: l.planned, mode: l.mode, line: l.line, to: l.toStopId, ...extra };
  const r = await call(env, "GET", "/api/service?" + new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== "")).toString());
  return { leg: l, status: r.status, body: r.body, nsw: caught.nswBy || {} };
}

/** Cases where the server acts (a server it can reach). */
export const SERVER_CASES = CASES.filter((c) => !(c.server && c.server.reachable === false)).map((c) => c.id);

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const out = [];
  for (const id of ids.length ? ids : SERVER_CASES) {
    const r = await runCase(id);
    if (r.skipped) { console.log(id, "skipped:", r.skipped); continue; }
    const cmp = compare(id, r);
    const bad = checkPushes(id, r, cmp.sim);
    out.push({ id, ok: cmp.ok && !bad.length, rows: cmp.rows, extra: cmp.extra, pushes: r.pushes.length, pushProblems: bad });
    console.log(`${id}: ${cmp.ok && !bad.length ? "ok" : "DIFF"}  alerts ${cmp.rows.filter((x) => x.match).length}/${cmp.rows.length} extra ${cmp.extra.length} pushes ${r.pushes.length} push problems ${bad.length}`);
    if (process.argv.includes("-v")) { for (const x of cmp.rows) console.log("   ", JSON.stringify(x)); for (const x of cmp.extra) console.log("    extra", JSON.stringify(x)); for (const b of bad) console.log("    push:", b); }
  }
  if (process.argv.includes("--json")) fs.writeFileSync("/tmp/simtrip.json", JSON.stringify(out, null, 1));
  stopFake();
}
