// Server speed, offline (28 Oct liveness pass): times each main /api endpoint of the built worker against the fake
// Transport for NSW (tools/fake-nsw.mjs), no key, no network, no NSW calls. Each endpoint is asked as the newer app
// asks (x-device), once cold (a new key in this copy of the worker), then again (warm: the server's own copies), then
// as a poll (refresh=1). Times are this machine's wall clock in node, not Cloudflare's: they show the server's own
// work and waits, not the network to a phone.
//   node backend/tools/speed-local.mjs [runs 5] [fake port 8799] [fake mode ok]
// Prints one line, SPEED_RESULT and JSON: per endpoint the median and worst of cold, warm and poll in ms, and the budget (1000 ms).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { makeD1 } from "../test/helpers/d1.mjs";

const backend = path.resolve(new URL("..", import.meta.url).pathname);
const runs = +(process.argv[2] || 5), port = +(process.argv[3] || 8799), fakeMode = process.argv[4] || "ok";
const BUDGET_MS = 1000;
process.env.TZ = process.env.TZ || "Australia/Sydney";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "tsl-speed-"));
execFileSync(process.execPath, [path.join(backend, "build.mjs"), "--cloudflare", path.join(work, "dist")], { stdio: "ignore" });
const wf = path.join(work, "dist", "worker.mjs");
let src = fs.readFileSync(wf, "utf8").split('"https://api.transport.nsw.gov.au"').join(`"http://127.0.0.1:${port}"`);
fs.writeFileSync(wf, src);
const pub = path.join(work, "dist", "public");

const fake = spawn(process.execPath, [path.join(backend, "tools", "fake-nsw.mjs"), String(port)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((res, rej) => { fake.stdout.on("data", (b) => { if (String(b).includes("fake nsw on")) res(); }); fake.on("exit", () => rej(new Error("fake nsw exited"))); setTimeout(() => rej(new Error("fake nsw did not start")), 10000); });
await fetch(`http://127.0.0.1:${port}/__mode?set=${encodeURIComponent(fakeMode)}`);

const DB = makeD1();
for (const f of fs.readdirSync(path.join(backend, "migrations")).filter((n) => n.endsWith(".sql")).sort()) {
  try { DB.sql.exec(fs.readFileSync(path.join(backend, "migrations", f), "utf8")); } catch (e) { /* a statement node:sqlite does not take */ }
}
const ASSETS = { fetch: async (req) => {
  const p = path.join(pub, decodeURIComponent(new URL(req.url).pathname));
  if (!p.startsWith(pub) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return new Response("not found", { status: 404 });
  return new Response(fs.readFileSync(p), { headers: { "content-type": p.endsWith(".json") ? "application/json" : "application/octet-stream" } });
} };
const env = { DB, ASSETS, TFNSW_API_KEY: "fake-local-key", ADMIN_KEY: "local-admin-key", TICK_KEY: "local-tick", VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_KEY: "x" };
const W = (await import(pathToFileURL(wf).href)).default;
// SPEED_TRACE=1: each outside call the worker makes, with its time, on stderr.
if (process.env.SPEED_TRACE) {
  const f0 = globalThis.fetch;
  globalThis.fetch = async (u, init) => { const t = performance.now(); try { return await f0(u, init); } finally { console.error("fetch", Math.round(performance.now() - t), "ms", String(u && u.url || u).slice(0, 120)); } };
}
const pending = [];
const exec = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => null)), passThroughOnException() {} };
const H = { "x-device": "speedlocal0001", "x-profile": "speedlocal0001" };

async function ask(p) {
  const t0 = performance.now();
  const r = await W.fetch(new Request("https://api.transportsydney.app" + p, { headers: H }), env, exec);
  const text = await r.text();
  return { ms: performance.now() - t0, status: r.status, bytes: text.length, copy: r.headers.get("x-edge-cache") || "-", text };
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.floor((s.length - 1) / 2)]) : null; };
const worst = (a) => (a.length ? Math.round(Math.max(...a)) : null);

// A trip and a service to ask about come from the fake planner's own answers.
const trip0 = JSON.parse((await ask("/api/trip?from=2150106&to=200060")).text);
const leg = trip0 && trip0.journeys && trip0.journeys[0] && trip0.journeys[0].legs.find((l) => l.kind === "transit");
const dep0 = JSON.parse((await ask("/api/departures?stop=200060")).text);
const row = dep0 && dep0.items && dep0.items[0];
const legRef = leg ? [leg.tripId, leg.stopId, leg.toStopId, leg.mode, leg.line].map((x) => encodeURIComponent(x || "")).join("@") : "";
const endpoints = [
  ["stop board", (k) => `/api/departures?stop=${["200060", "200070", "2000441", "2150106", "10101100", "2067141", "2022100"][k % 7]}`],
  ["trip list", (k) => `/api/trip?from=${["2000441", "2150106", "2067141", "2022100", "200070"][k % 5]}&to=200060`],
  ["trip list page 2", (k) => `/api/trip?from=${["2000441", "2150106", "2067141", "2022100", "200070"][k % 5]}&to=200060&page=1`],
  ["service", (k) => row ? `/api/service?trip=${encodeURIComponent(row.tripId || "")}&mode=${row.mode}&line=${encodeURIComponent(row.line || "")}&stop=${encodeURIComponent(row.stopId || "")}&k=${k}` : null],
  ["trip live legs", (k) => legRef ? `/api/trip/live?legs=${legRef}&k=${k}` : null],
  ["nearby", (k) => `/api/nearby?lat=${(-33.88 + k * 0.01).toFixed(3)}&lon=151.2`],
  ["alerts", () => `/api/alerts`],
  ["lines", () => `/api/lines`],
  ["stop search", (k) => `/api/search?q=${["central", "town", "wynyard", "parra", "manly"][k % 5]}`],
  ["car park", (k) => `/api/parking?id=${["486", "487", "488", "489", "490"][k % 5]}`],
];
const out = { at: new Date().toISOString(), fakeMode, runs, budgetMs: BUDGET_MS, node: process.version, endpoints: {} };
for (const [name, mk] of endpoints) {
  const cold = [], warm = [], poll = [], status = new Set(), copies = new Set();
  for (let k = 0; k < runs; k++) {
    const p = mk(k);
    if (!p) break;
    // The worker paces its own Trip Planner calls (upstreamSlot: at most 4 start in any second, by design for the NSW
    // limit); a gap before each cold ask keeps that wait out of the server's own time.
    await new Promise((r) => setTimeout(r, 1100));
    const a = await ask(p); cold.push(a.ms); status.add(a.status);
    const b = await ask(p); warm.push(b.ms); copies.add(b.copy);
    const c = await ask(p + (p.includes("?") ? "&" : "?") + "refresh=1"); poll.push(c.ms);
  }
  out.endpoints[name] = { cold: cold.map(Math.round), poll: poll.map(Math.round), coldMs: med(cold), coldWorstMs: worst(cold), warmMs: med(warm), pollMs: med(poll), pollWorstMs: worst(poll), status: [...status], warmCopy: [...copies], overBudget: worst(cold) > BUDGET_MS || worst(poll) > BUDGET_MS };
}
await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 3000))]);
fake.kill();
fs.rmSync(work, { recursive: true, force: true });
// The worker writes its own request log lines to stdout; the result is the one line that starts with SPEED_RESULT.
console.log("SPEED_RESULT " + JSON.stringify(out));
process.exit(0);
