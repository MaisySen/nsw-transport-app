// Local stand in for api.transportsydney.app for the button check (g23): the real worker code from this clone,
// in node, with an in memory D1 and a fake Transport for NSW that answers from the GTFS stop list. No call leaves
// this machine: globalThis.fetch is replaced, so a URL this file does not answer gets a 404.
import fs from "node:fs";
import http from "node:http";
// node test/e2e/mockapi.mjs <repo root> <port> [stops.json]
const [,, REPO, PORT, STOPS] = process.argv;
// The clock: the harness moves it with POST /__clock {t, mode} so the worker and the browser agree on "now".
const RealDate = Date;
let OFF = 0;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now() + OFF); else super(...a); }
  static now() { return RealDate.now() + OFF; }
}
globalThis.Date = FakeDate;
let MODE = "ok"; // ok | down (every NSW call 503) | quota (403 over quota)
let HEADWAY = 10; // minutes between the fake services
let LATENCY = 0; // ms added to every API answer, to look like a slow day
// Stops: a JSON map { id: [name, lat, lon, parentId, platform] } (for example made from the GTFS stops.txt), or
// without one the station lists this repo already publishes (train, metro, ferry, light rail and bus route stops).
function repoStops() {
  const dir = REPO + "/backend/src/public/stations/", out = {};
  for (const m of ["train", "metro", "ferry", "lightrail"]) for (const [id, name, lat, lon] of JSON.parse(fs.readFileSync(dir + m + ".json", "utf8"))) out[id] = [name, lat, lon, "", ""];
  for (const f of fs.readdirSync(dir + "bus")) for (const dirs of Object.values(JSON.parse(fs.readFileSync(dir + "bus/" + f, "utf8")))) for (const d of dirs) for (const [id, name, lat, lon] of d.stops || []) if (!out[id]) out[id] = [name, lat, lon, "", ""];
  return out;
}
const S = STOPS ? JSON.parse(fs.readFileSync(STOPS, "utf8")) : repoStops();
const ids = Object.keys(S);
const parents = ids.filter((i) => !S[i][3]);
const R = 6371;
const dist = (a, b) => { const r = Math.PI / 180, dl = (b[1] - a[1]) * r, dp = (b[0] - a[0]) * r; const h = Math.sin(dp / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dl / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const isStation = (id) => / Station$/.test(S[id][0]);
const suburb = (n) => (n.split(", ")[1] || n.replace(/ Station$/, ""));
function loc(id, extra = {}) { const s = S[id]; return { id, name: s[0], disassembledName: s[0], type: "stop", coord: [s[1], s[2]], parent: { id: s[3] || id, name: s[3] ? S[s[3]]?.[0] : s[0] }, ...extra }; }
function sydParse(d, t) { const y = +d.slice(0, 4), mo = +d.slice(4, 6), da = +d.slice(6, 8), h = +t.slice(0, 2), mi = +t.slice(2, 4); return RealDate.UTC(y, mo - 1, da, h, mi) - 11 * 3600000; }
function resolve(q) {
  if (S[q]) return q;
  const m = /^([\d.]+):(-?[\d.]+):EPSG:4326$/.exec(q);
  if (m) { const p = [+m[2], +m[1]]; let best = null, bd = 1e9; for (const i of parents) { const d = dist(p, [S[i][1], S[i][2]]); if (d < bd) { bd = d; best = i; } } return best; }
  return null;
}
function find(q) {
  const id = resolve(q);
  if (id) return [id];
  const ql = q.toLowerCase().trim();
  const hits = parents.filter((i) => S[i][0].toLowerCase().includes(ql));
  hits.sort((a, b) => (isStation(b) - isStation(a)) || (S[a][0].toLowerCase().startsWith(ql) ? -1 : 1) || S[a][0].length - S[b][0].length);
  return hits.slice(0, 12);
}
const iso = (t) => new RealDate(t).toISOString();
function leg(o, d, dep, min, line, cls, delay, k) {
  const arr = dep + min * 60000, live = delay != null;
  const plat = cls === 1 ? { platformName: "Platform " + (1 + (k % 4)) } : {};
  return {
    transportation: { disassembledName: line, number: line, product: { class: cls, name: cls === 1 ? "Sydney Trains Network" : "Sydney Buses Network" }, destination: { name: S[d][0].replace(/ Station$/, ""), id: d }, properties: { RealtimeTripId: "fake-" + line + "-" + dep } },
    origin: { ...loc(o), name: S[o][0] + (plat.platformName ? ", " + plat.platformName : ""), departureTimePlanned: iso(dep), ...(live ? { departureTimeEstimated: iso(dep + delay * 60000) } : {}), properties: plat },
    destination: { ...loc(d), arrivalTimePlanned: iso(arr), ...(live ? { arrivalTimeEstimated: iso(arr + delay * 60000) } : {}), properties: cls === 1 ? { platformName: "Platform 2" } : {} },
    isRealtimeControlled: live, isCancelled: false, duration: min * 60,
    stopSequence: [
      { ...loc(o), departureTimePlanned: iso(dep), ...(live ? { departureTimeEstimated: iso(dep + delay * 60000) } : {}), properties: plat },
      { ...loc(d), arrivalTimePlanned: iso(arr), ...(live ? { arrivalTimeEstimated: iso(arr + delay * 60000) } : {}) },
    ],
    coords: [[S[o][1], S[o][2]], [S[d][1], S[d][2]]],
    infos: [],
  };
}
function trip(p) {
  const o = resolve(p.get("name_origin") || ""), d = resolve(p.get("name_destination") || "");
  if (!o || !d) return { journeys: [], systemMessages: [{ type: "error", code: -8011, text: "no stop" }] };
  const at = p.get("itdDate") && p.get("itdTime") ? sydParse(p.get("itdDate"), p.get("itdTime")) : FakeDate.now();
  const arrBy = p.get("itdTripDateTimeDepArr") === "arr" || p.get("depArrMacro") === "arr";
  const km = dist([S[o][1], S[o][2]], [S[d][1], S[d][2]]);
  const train = isStation(o) && isStation(d);
  const min = Math.max(3, Math.round(km * (train ? 1.4 : 3)));
  const n = +(p.get("calcNumberOfTrips") || 5);
  const step = HEADWAY * 60000;
  const first = Math.ceil((arrBy ? at - min * 60000 - n * step : at) / step) * step + 2 * 60000;
  const line = train ? "T" + (1 + (parseInt(o, 10) % 9)) : String(400 + (parseInt(o, 10) % 99));
  const out = [];
  for (let k = 0; k < n; k++) {
    const dep = first + k * step;
    const delay = (k % 3 === 0) ? 2 : (k % 3 === 1 ? 0 : null);
    out.push({ legs: [leg(o, d, dep, min, line, train ? 1 : 5, delay, k)] });
  }
  return { journeys: out };
}
function dm(p) {
  const id = resolve(p.get("name_dm") || "");
  if (!id) return { locations: [], stopEvents: [] };
  const at = p.get("itdDate") && p.get("itdTime") ? sydParse(p.get("itdDate"), p.get("itdTime")) : FakeDate.now();
  const near = parents.filter((i) => i !== id && isStation(i) === isStation(id)).map((i) => [i, dist([S[id][1], S[id][2]], [S[i][1], S[i][2]])]).sort((a, b) => a[1] - b[1]).slice(5, 9).map((x) => x[0]);
  const ev = [];
  const cls = isStation(id) ? 1 : 5;
  for (let k = 0; k < 12; k++) {
    const dep = Math.ceil(at / 60000) * 60000 + (k * 6 + 1) * 60000;
    const dest = near[k % near.length] || id;
    const line = cls === 1 ? "T" + (1 + (k % 3)) : String(400 + (k % 4) * 11);
    const delay = (k % 3 === 0) ? 2 : (k % 3 === 1 ? 0 : null);
    ev.push({ location: { ...loc(id), properties: cls === 1 ? { platformName: "Platform " + (1 + (k % 4)) } : {} }, departureTimePlanned: iso(dep), ...(delay != null ? { departureTimeEstimated: iso(dep + delay * 60000) } : {}), isRealtimeControlled: delay != null,
      transportation: { disassembledName: line, number: line, product: { class: cls }, destination: { name: S[dest][0].replace(/ Station$/, ""), id: dest }, properties: {} }, properties: { RealtimeTripId: "fake-dm-" + id + "-" + dep }, infos: [] });
  }
  return { locations: [loc(id)], stopEvents: ev };
}
const nswCalls = { n: 0 };
globalThis.fetch = async (u, init) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (url.hostname.endsWith("transport.nsw.gov.au")) {
    nswCalls.n++;
    if (MODE === "down") return new Response("Service Unavailable", { status: 503 });
    if (MODE === "quota") return new Response("Account Over Quota Limit", { status: 403, headers: { "x-error-detail": "Account Over Quota Limit" } });
    const p = url.searchParams, ep = url.pathname.split("/").pop();
    if (ep === "stop_finder") return Response.json({ locations: find(p.get("name_sf") || "").map((i, k) => ({ ...loc(i), matchQuality: 1000 - k, isBest: k === 0, modes: [isStation(i) ? 1 : 5] })) });
    if (ep === "trip") return Response.json(trip(p));
    if (ep === "departure_mon") return Response.json(dm(p));
    if (ep === "add_info") return Response.json({ infos: { current: [], historic: [], affected: {} } });
    return new Response("{}", { status: 404 });
  }
  return new Response("not on this test machine", { status: 404 });
};
const root = REPO + "/backend/";
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default };\n";
const tmp = root + "src/.mock-worker-" + process.pid + ".mjs";
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
const { makeD1 } = await import(root + "test/helpers/d1.mjs");
const env = { TFNSW_API_KEY: "fake-not-a-key", DB: makeD1(), REQ_LOG: "off",
  ASSETS: { fetch: async (req) => { const p = root + "src/public" + new URL(req.url).pathname; return fs.existsSync(p) && fs.statSync(p).isFile() ? new Response(fs.readFileSync(p)) : new Response("", { status: 404 }); } } };
const log = [];
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/__clock") { const j = JSON.parse(body.toString() || "{}"); if (j.t) OFF = j.t - RealDate.now(); if (j.mode) MODE = j.mode; if (j.headway) HEADWAY = +j.headway; if (j.latency != null) LATENCY = +j.latency; res.end(JSON.stringify({ now: FakeDate.now(), mode: MODE, headway: HEADWAY, latency: LATENCY, nswCalls: nswCalls.n })); return; }
  if (u.pathname === "/__log") { res.end(JSON.stringify(log.slice(-400))); return; }
  if (LATENCY) await new Promise((r) => setTimeout(r, LATENCY));
  try {
    const r = await W.__default.fetch(new Request("https://api.transportsydney.app" + req.url, { method: req.method, headers: { ...req.headers, "cf-connecting-ip": "10.1.2.3" }, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), env, { waitUntil() {}, passThroughOnException() {} });
    const buf = Buffer.from(await r.arrayBuffer());
    log.push([req.method, req.url.slice(0, 160), r.status]);
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    h["access-control-allow-origin"] = "*";
    res.writeHead(r.status, h); res.end(buf);
  } catch (e) { log.push([req.method, req.url.slice(0, 160), "ERR " + String(e).slice(0, 200)]); res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); }
}).listen(+PORT, "127.0.0.1");
console.log("mock api on", PORT);
