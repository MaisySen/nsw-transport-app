// Fake Transport for NSW Open Data for local runs: no key, no network, no NSW calls (docs/REVERSE_ENGINEERING.md, g28).
// node backend/tools/fake-nsw.mjs 8799. Upstream behaviour via GET /__mode?set=NAME: ok, 429, 403quota, 500, 502html,
// empty, malformed, nulljson, huge, slow, slowfeed, weird. GET /__mode also shows the last 20 calls the worker made.
// backend/tools/local-dev.mjs builds a worker that talks to this and runs it under wrangler dev.
import http from "node:http";
const PORT = +process.argv[2] || 8799;
let mode = "ok"; const hits = [];
const STOPS = [["200060","Central Station"],["2000338","Central Station, Platform 16"],["200070","Town Hall Station"],["213510","Strathfield Station"],["2150106","Parramatta Station"],["10101100","Manly Wharf"],["10101101","Circular Quay"],["2067141","Chatswood Station"],["2022100","Bondi Junction Station"],["2000441","Wynyard Station"]];
const nameOf = (id) => (STOPS.find((s) => s[0] === String(id)) || [String(id), "Stop " + id])[1];
const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
function stopEvents(id, n) {
  const now = Date.now(), out = [];
  const lines = [["T1", 1, "Hornsby"], ["T9", 1, "Gordon"], ["M1", 2, "Tallawong"], ["F1", 9, "Manly"], ["L2", 4, "Randwick"], ["333", 5, "Bondi Beach"]];
  for (let i = 0; i < n; i++) {
    const [ln, cls, dest] = lines[i % lines.length];
    const planned = now + (i * 3 + 1) * 60000;
    const live = i % 3 !== 2;
    out.push({ location: { id: id + (i % 2 ? "1" : "2"), name: nameOf(id), properties: { platformName: cls === 5 ? "Stand A" : "Platform " + (1 + (i % 4)), occupancy: "MANY_SEATS" } },
      departureTimePlanned: iso(planned), ...(live ? { departureTimeEstimated: iso(planned + (i % 4) * 60000) } : {}), isRealtimeControlled: live,
      transportation: { id: "nsw:" + ln, name: ln, disassembledName: ln, number: ln, description: "Line " + ln, product: { class: cls, name: "x" }, destination: { id: "9" + i, name: dest } },
      properties: { RealtimeTripId: ln + "-" + planned, WheelchairAccess: "true" },
      infos: i === 0 ? [{ id: "alert-1", subtitle: "Trackwork <b>this weekend</b>", url: "https://transportnsw.info/x", priority: "normal" }] : [] });
  }
  return out;
}
function leg(from, to, dep, min, ln, cls) {
  return { transportation: { disassembledName: ln, number: ln, product: { class: cls }, destination: { name: nameOf(to), id: to }, properties: { RealtimeTripId: ln + "-" + dep } },
    origin: { id: from + "1", name: nameOf(from) + ", Platform 1", disassembledName: nameOf(from), parent: { id: from, name: nameOf(from) }, departureTimePlanned: iso(dep), departureTimeEstimated: iso(dep + 60000), properties: { platformName: "Platform 1" } },
    destination: { id: to + "2", name: nameOf(to) + ", Platform 2", disassembledName: nameOf(to), parent: { id: to, name: nameOf(to) }, arrivalTimePlanned: iso(dep + min * 60000), arrivalTimeEstimated: iso(dep + min * 60000 + 60000), properties: { platformName: "Platform 2" } },
    isRealtimeControlled: true, isCancelled: false, duration: min * 60, stopSequence: [{ id: from, name: nameOf(from) }, { id: to, name: nameOf(to) }], infos: [] };
}
function journeys(from, to) {
  const now = Date.now(), out = [];
  for (let k = 0; k < 4; k++) { const d = now + (5 + k * 10) * 60000; out.push({ legs: [leg(from, "200060", d, 9, "T1", 1), leg("200060", to, d + 14 * 60000, 12, "T4", 1)] }); }
  return { journeys: out };
}
function body(path, q) {
  if (path.includes("/tp/stop_finder")) { const s = (q.get("name_sf") || "").toLowerCase(); return { locations: STOPS.filter((x) => x[1].toLowerCase().includes(s.split(" ")[0] || "")).map(([id, name], i) => ({ id, name, disassembledName: name, type: "stop", matchQuality: 900 - i, isBest: i === 0, productClasses: [1], coord: [-33.88, 151.2], parent: { name: "Sydney", type: "locality" } })) }; }
  if (path.includes("/tp/departure_mon")) { const id = q.get("name_dm"); return { locations: [{ id, name: nameOf(id), type: "stop" }], stopEvents: stopEvents(id, 12) }; }
  if (path.includes("/tp/trip")) return journeys(q.get("name_origin"), q.get("name_destination"));
  if (path.includes("/tp/coord")) return { locations: STOPS.slice(0, 5).map(([id, name], i) => ({ id, name, type: "stop", coord: [-33.88 + i * 0.001, 151.2], properties: { distance: 100 * (i + 1) } })) };
  if (path.includes("/tp/add_info")) return { infos: { current: [] } };
  if (path.includes("/carpark")) return { facility_id: q.get("facility"), spots: "100", occupancy: { total: "40" } };
  if (path.includes("hazards")) return { type: "FeatureCollection", features: [] };
  return null;
}
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/__mode") { if (u.searchParams.get("set")) mode = u.searchParams.get("set"); res.end(JSON.stringify({ mode, hits: hits.length, last: hits.slice(-20) })); return; }
  hits.push({ t: Date.now(), p: u.pathname, auth: req.headers.authorization ? "apikey set" : "none", mode });
  const isFeed = u.pathname.includes("/gtfs/");
  const send = (code, b, type = "application/json", h = {}) => { res.writeHead(code, { "content-type": type, ...h }); res.end(b); };
  if (mode === "429") return send(429, JSON.stringify({ ErrorDetails: { Message: "Your API quota or rate limit has been exceeded" } }));
  if (mode === "403quota") return send(403, "Account Over Quota Limit", "text/plain", { "x-error-detail": "Account Over Quota Limit" });
  if (mode === "500") return send(500, "Internal Server Error", "text/plain");
  if (mode === "502html") return send(200, "<html><body>Bad gateway maintenance</body></html>", "text/html");
  if (mode === "slowfeed" && isFeed) { setTimeout(() => send(200, Buffer.alloc(0), "application/x-google-protobuf"), 8000); return; }
  if (mode === "slow") { setTimeout(() => send(200, JSON.stringify(body(u.pathname, u.searchParams) || {})), 20000); return; }
  if (isFeed) return send(200, mode === "malformed" ? Buffer.from([0x0a, 0xff, 0xff, 0xff, 0x0f, 1, 2]) : Buffer.alloc(0), "application/x-google-protobuf");
  if (mode === "empty") return send(200, "{}");
  if (mode === "nulljson") return send(200, "null");
  if (mode === "malformed") return send(200, '{"stopEvents":[{"transportation":');
  if (mode === "weird") return send(200, JSON.stringify({ locations: "x", stopEvents: [null, 5, { transportation: null, departureTimePlanned: "garbage" }, { location: null, infos: "x", transportation: { product: null, destination: null } }], journeys: [null, { legs: null }, { legs: [null, {}] }] }));
  let b = body(u.pathname, u.searchParams);
  if (mode === "huge" && b) { if (b.stopEvents) b.stopEvents = stopEvents(u.searchParams.get("name_dm"), 5000); if (b.journeys) b.journeys = Array(300).fill(b.journeys[0]); if (b.locations && u.pathname.includes("stop_finder")) b.locations = Array(5000).fill(b.locations[0] || { id: "1", name: "x" }); }
  if (b == null) return send(404, "{}");
  send(200, JSON.stringify(b));
}).listen(PORT, "127.0.0.1", () => console.log("fake nsw on " + PORT));
