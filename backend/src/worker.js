// Transport: Sydney Live server. A Cloudflare Worker that answers transport questions with live
// Transport for NSW data. It merges the Trip Planner API with the GTFS realtime feeds
// (trip updates and vehicle positions) so that every time shown is either truly live
// or clearly marked as scheduled. The API key stays on the server side.

import { AsyncLocalStorage } from "node:async_hooks";

const API = "https://api.transport.nsw.gov.au";
const TZ = "Australia/Sydney";
const API_KEY_PLACEHOLDER = "__TFNSW_API_KEY__";
const FEED_TTL_MS = 15000;
const FEED_WAIT_MS = 2500;
const FEED_JOB_MAX_MS = 20000;
const depMem = new Map();          // stop board answers, shared for 12 s         // a slow realtime feed never holds an answer longer than this          // shared realtime feed cache
const VEHICLE_MAX_AGE_S = 600;      // ignore vehicle positions older than this

const MODES = {
  1: { key: "train", name: "Train", color: "#F6891F", noun: "train" },
  2: { key: "metro", name: "Metro", color: "#168388", noun: "metro" },
  4: { key: "lightrail", name: "Light rail", color: "#E4022D", noun: "tram" },
  5: { key: "bus", name: "Bus", color: "#00B5EF", noun: "bus" },
  7: { key: "coach", name: "Coach", color: "#742282", noun: "coach" },
  9: { key: "ferry", name: "Ferry", color: "#5AB031", noun: "ferry" },
  11: { key: "bus", name: "School bus", color: "#00B5EF", noun: "bus" },
};

const LINE_COLORS = {
  T1: "#F99D1C", T2: "#0098CD", T3: "#F37021", T4: "#005AA3", T5: "#C4258F",
  T6: "#7C3E21", T7: "#6F818E", T8: "#00954C", T9: "#D11F2F",
  M1: "#168388", L1: "#BE1622", L2: "#DD1E25", L3: "#781140", L4: "#BB2043",
  CCN: "#D11F2F", BMT: "#F99D1C", SCO: "#005AA3", HUN: "#833134", SHL: "#00954C",
};

// GTFS realtime feeds per mode. Light rail is split by network.
const FEEDS = {
  bus: { tu: "/v1/gtfs/realtime/buses", vp: "/v1/gtfs/vehiclepos/buses" },
  coach: { tu: "/v1/gtfs/realtime/buses", vp: "/v1/gtfs/vehiclepos/buses" },
  train: { tu: "/v2/gtfs/realtime/sydneytrains", vp: "/v2/gtfs/vehiclepos/sydneytrains" },
  metro: { tu: "/v2/gtfs/realtime/metro", vp: "/v2/gtfs/vehiclepos/metro" },
  ferry: { tu: "/v1/gtfs/realtime/ferries/sydneyferries", vp: "/v1/gtfs/vehiclepos/ferries/sydneyferries" },
  lr_cse: { tu: "/v1/gtfs/realtime/lightrail/cbdandsoutheast", vp: "/v1/gtfs/vehiclepos/lightrail/cbdandsoutheast" },
  lr_iw: { tu: "/v2/gtfs/realtime/lightrail/innerwest", vp: "/v2/gtfs/vehiclepos/lightrail/innerwest" },
  lr_par: { tu: "/v1/gtfs/realtime/lightrail/parramatta", vp: "/v1/gtfs/vehiclepos/lightrail/parramatta" },
  lr_new: { tu: "/v1/gtfs/realtime/lightrail/newcastle", vp: "/v1/gtfs/vehiclepos/lightrail/newcastle" },
  // Operators outside the Sydney feeds, chosen per service by feedHint (operator and network names
  // from the Trip Planner), never by line name alone: regional route numbers repeat Sydney ones.
  ferry_mff: { tu: "/v1/gtfs/realtime/ferries/MFF", vp: "/v1/gtfs/vehiclepos/ferries/MFF" },
  nswtrains: { tu: "/v1/gtfs/realtime/nswtrains", vp: "/v1/gtfs/vehiclepos/nswtrains" },
};
// Regional buses: each network publishes one to three feeds under /regionbuses/.
const REGION_FEEDS = [
  [/north coast/i, ["northcoast", "northcoast2", "northcoast3"]],
  [/central west|orana/i, ["centralwestandorana", "centralwestandorana2"]],
  [/riverina|murray/i, ["riverinamurray", "riverinamurray2"]],
  [/south east|tablelands/i, ["southeasttablelands", "southeasttablelands2"]],
  [/new england|north west/i, ["newenglandnorthwest"]],
  // Only "Newcastle and Hunter Network": "Hunter Buses Network" services are in the Sydney buses feed.
  [/^newcastle and hunter/i, ["newcastlehunter"]],
  [/far west/i, ["farwest"]],
  [/sydney and surrounds/i, ["sydneysurrounds"]],
];
const FEED_GROUPS = {};
for (const [, names] of REGION_FEEDS) {
  const g = "rb_" + names[0];
  FEED_GROUPS[g] = names.map((n) => { FEEDS["rb_" + n] = { tu: "/v1/gtfs/realtime/regionbuses/" + n, vp: "/v1/gtfs/vehiclepos/regionbuses/" + n }; return "rb_" + n; });
}
// Which non-Sydney feed carries this service, from the planner's transportation object, or null
// (the mode's usual feed).
// A key from a request (mode, feed, a typed word) looked up in a plain table: own entries only, so "__proto__" or
// "constructor" is not found instead of reading Object.prototype (26 Oct, g28: /api/search?q=constructor and
// /api/service?mode=__proto__ answered 502).
function own(o, k) { return k != null && Object.prototype.hasOwnProperty.call(o, k); }
function feedHint(cls, t) {
  if (!t) return null;
  const op = (t.operator && t.operator.name) || "", net = (t.product && t.product.name) || "", id = String(t.id || "");
  if (cls === 9 && (/manly fast ferr/i.test(op) || /^nsw:\d*MFF:/.test(id))) return "ferry_mff";
  if ((cls === 1 || cls === 7) && (/nsw trainlink/i.test(op) || /^regional trains and coaches/i.test(net))) return "nswtrains";
  if (cls === 5 || cls === 7 || cls === 11) { for (const [re, names] of REGION_FEEDS) if (re.test(net)) return "rb_" + names[0]; }
  return null;
}

function feedKey(mode, line) {
  if (mode === "lightrail") {
    if (line === "L1") return "lr_iw";
    if (line === "L4") return "lr_par";
    if (/^NLR|newcastle/i.test(line || "")) return "lr_new";
    return "lr_cse";
  }
  return own(FEEDS, mode) ? mode : null;
}
// The feed keys to read for a service: its hinted feed (or group) when known, else the mode's feed.
function feedKeys(mode, line, feed) {
  if (feed && own(FEED_GROUPS, feed)) return FEED_GROUPS[feed];
  if (feed && own(FEEDS, feed)) return [feed];
  const k = feedKey(mode, line);
  return k ? [k] : [];
}

function apiKey(env) {
  return (env && env.TFNSW_API_KEY) || API_KEY_PLACEHOLDER;
}

// Intl formatters are costly to build (well over a millisecond each on a cold isolate), so each
// one is made once per isolate and reused.
const DTF = new Map(); // opts object -> { locale: formatter }
function dtf(locale, opts) {
  let byLocale = DTF.get(opts);
  if (!byLocale) { byLocale = {}; DTF.set(opts, byLocale); }
  return byLocale[locale] || (byLocale[locale] = new Intl.DateTimeFormat(locale, opts));
}
const CLOCK_OPTS = { timeZone: TZ, hour: "numeric", minute: "2-digit" };
const CLOCK_S_OPTS = { timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit" };
const SYD_PARTS_OPTS = { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false };
function sydneyPartsIntl(d) {
  const f = dtf("en-AU", SYD_PARTS_OPTS);
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const hh = p.hour === "24" ? "00" : p.hour;
  return { date: `${p.year}${p.month}${p.day}`, time: `${hh}${p.minute}` };
}
// The same answer from the per hour memo in sydneyNow (below).
function sydneyParts(d = new Date()) {
  if (!Number.isFinite(+d)) return sydneyPartsIntl(d);
  const s = sydneyNow(d);
  return { date: s.day, time: String(Math.floor(s.tod / 60)).padStart(2, "0") + String(s.tod % 60).padStart(2, "0") };
}

async function tp(env, endpoint, params, timeoutMs = 12000) {
  const qs = new URLSearchParams({
    outputFormat: "rapidJSON", coordOutputFormat: "EPSG:4326", version: "10.2.1.42", ...params,
  });
  // Over the hub's limit the call is asked again up to 4 times after a short wait (about 5 s in all), because the per second limit
  // frees up within the second. The hub's answer does not say which limit (429 "Your API quota or rate limit has
  // been exceeded", seen 26 Oct 2026), so with no good answer for a minute it is taken as the day's quota and not
  // asked again.
  for (let attempt = 0; ; attempt++) {
    await upstreamSlot();
    upstream.calls++;
    upstreamNote();
    const t0 = Date.now();
    const res = await fetch(API + "/v1/tp/" + endpoint + "?" + qs.toString(), {
      headers: { Authorization: "apikey " + apiKey(env) },
      signal: AbortSignal.timeout(timeoutMs),
    }).finally(() => reqUpstream(Date.now() - t0));
    upstreamHeaders(res);
    if (res.ok) {
      // A 200 that is not a JSON object (an HTML maintenance or gateway page, "null", a cut off body) is the hub being
      // down, not an answer: it gets the outage path (timetable board, kept copy, "Transport for NSW isn't answering")
      // instead of "Something went wrong on our side" (26 Oct, g28, docs/REVERSE_ENGINEERING.md).
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) { data = null; }
      if (!data || typeof data !== "object") {
        throw new Error(`Transport data answered 502: a 200 that is not JSON (${String((res.headers && res.headers.get("content-type")) || "no type").slice(0, 40)})`);
      }
      budget.lastOkAt = Date.now();
      return data;
    }
    const body = await res.text();
    const detail = (res.headers && res.headers.get("x-error-detail")) || body;
    upstreamRefused(res.status, detail);
    if (overLimit(res.status, detail) && !/quota limit/i.test(detail) && Date.now() - budget.lastOkAt < 60000 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 400 + attempt * 600 + Math.floor(Math.random() * 400)));
      continue;
    }
    throw new Error(`Transport data answered ${res.status}: ${body.slice(0, 200)}`);
  }
}

// ---------- upstream budget ----------
// Transport for NSW Open Data, Bronze plan (the default; checked 26 Oct 2026 on opendata.transport.nsw.gov.au,
// API basics): 60,000 calls a day and 5 a second for the whole key, shared by every copy of this worker. Over
// either, the hub answers 403 with X-Error-Detail "Account Over Rate Limit" or "Account Over Quota Limit".
// Each copy counts its own Trip Planner calls over the last 10 s. At UPSTREAM_PER_S or more (or for a while after
// a 403 over the limit) it is busy: a live answer that already has a shared copy up to STALE_MAX_MS old is served
// from that copy (it says how old it is in dataAt) instead of asking again, and a refused or failed upstream call
// also serves the last copy instead of an error. A first answer for a stop with no copy still asks.
const UPSTREAM_PER_S = 3;
const UPSTREAM_WINDOW_MS = 10000;
const STALE_MAX_MS = 60000;
const budget = { calls: [], overUntil: 0, refused: 0, staleServed: 0, shared: 0, seen: {}, lastOkAt: Date.now() };
// Pacing inside one copy: at most UPSTREAM_BURST Trip Planner calls start in any second; the next waits for room
// (up to 2 s, then it goes anyway), so a burst of first opens is spread instead of refused by the hub.
const UPSTREAM_BURST = 4;
const slotTimes = [];
async function upstreamSlot() {
  const until = Date.now() + 2000;
  for (;;) {
    const now = Date.now();
    while (slotTimes.length && now - slotTimes[0] >= 1000) slotTimes.shift();
    if (slotTimes.length < UPSTREAM_BURST || now >= until) { slotTimes.push(now); return; }
    await new Promise((r) => setTimeout(r, Math.min(until - now, 1000 - (now - slotTimes[0]) + 5)));
  }
}
function upstreamTrim(now) { while (budget.calls.length && now - budget.calls[0] > UPSTREAM_WINDOW_MS) budget.calls.shift(); }
function upstreamNote() { const now = Date.now(); budget.calls.push(now); upstreamTrim(now); }
// A load test request (loadOk) counts as busy from 1 call a second, so a test leaves the key's room to real phones.
function upstreamBusy(test = false) {
  const now = Date.now();
  if (now < budget.overUntil) return true;
  upstreamTrim(now);
  return budget.calls.length >= (test ? 1 : UPSTREAM_PER_S) * (UPSTREAM_WINDOW_MS / 1000);
}
// The documented answer over a limit is 403 with X-Error-Detail "Account Over Rate Limit" or "Account Over Quota
// Limit"; the hub answered 429 "Your API quota or rate limit has been exceeded" on 26 Oct 2026. Both count.
function overLimit(status, detail) { return (status === 403 || status === 429) && /rate|quota/i.test(String(detail || "")); }
function upstreamRefused(status, detail) {
  if (!overLimit(status, detail)) return;
  budget.refused++;
  const d = String(detail || "");
  // Over the per second limit: back off 2 s. Over the day's quota (said so, or no good answer for a minute): a
  // minute at a time (the hub resets at midnight).
  const quota = /quota limit/i.test(d) || Date.now() - budget.lastOkAt > 60000;
  budget.overUntil = Date.now() + (quota ? 60000 : 2000);
}
// Any rate or quota header the hub sends back, kept so /api/health can show what the key is allowed.
function upstreamHeaders(res) {
  if (!res || !res.headers || typeof res.headers.forEach !== "function") return;
  res.headers.forEach((v, k) => { if (/ratelimit|rate-limit|quota|x-error-detail/i.test(k)) budget.seen[k] = String(v).slice(0, 120); });
}
function budgetStats() {
  const now = Date.now(); upstreamTrim(now);
  return { perS: UPSTREAM_PER_S, last10s: budget.calls.length, busy: upstreamBusy(), refused: budget.refused, staleServed: budget.staleServed, shared: budget.shared, headers: budget.seen };
}

function modeOf(cls) {
  return MODES[cls] || { key: "other", name: "Service", color: "#495054", noun: "service" };
}
function lineColor(line, cls) {
  if (line && LINE_COLORS[line]) return LINE_COLORS[line];
  return modeOf(cls).color;
}
function platformLabel(props, cls) {
  if (!props) return "";
  const pn = props.platformName || "";
  const code = props.platform || "";
  if (/^platform \w+$/i.test(pn) || /^wharf \w+/i.test(pn)) return pn;
  if (/^Stand \w+$/i.test(pn)) return pn;
  const m = pn.match(/(Platform \w+|Stand \w+|Wharf \w+(?:, Side \w)?)/i);
  if (m) return m[1];
  if (code) {
    if (cls === 5 || cls === 11 || cls === 7) return "Stand " + code;
    const n = code.replace(/^[A-Z]+/, "");
    return n ? "Platform " + n : code;
  }
  return "";
}
function platformChange(props, cls) {
  if (!props || !props.plannedPlatformName || !props.platformName) return null;
  if (props.plannedPlatformName === props.platformName) return null;
  return platformLabel({ platformName: props.plannedPlatformName }, cls) || props.plannedPlatformName;
}
function iso(t) { return t ? new Date(t).toISOString() : null; }
// Alert titles from the planner can carry HTML ("<a href=...>Book your seat with NSW TrainLink</a>"): plain words only.
function plainText(h) {
  const tags = (x) => x
    .replace(/<[^>]*>/g, " ")
    // A tag cut off by a length limit ("<a href=...") has no closing bracket: drop it to the end.
    .replace(/<\/?[a-z][^<]*$/i, " ");
  const ents = (x) => x
    .replace(/&#(\d+);/g, (m, n) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : " "; })
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => { const c = parseInt(n, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : " "; })
    .replace(/&(nbsp|amp|quot|apos|lt|gt|ndash|mdash|rsquo|lsquo|rdquo|ldquo|hellip);/gi, (m, n) => PLAIN_ENTITIES[n.toLowerCase()]);
  // Twice: some alerts carry their HTML encoded ("&lt;a href=...&gt;"), which reads as a tag only once decoded.
  return tags(ents(tags(String(h || ""))))
    // No en or em dashes in what the app shows.
    .replace(/\s*[\u2013\u2014]\s*/g, ", ")
    .replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/,(\s*,)+/g, ",").trim();
}
const PLAIN_ENTITIES = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", ndash: ", ", mdash: ", ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: "..." };
function ms(t) { return t ? new Date(t).getTime() : null; }

const OCC_EFA = {
  MANY_SEATS: { level: 1, text: "Many seats" },
  FEW_SEATS: { level: 2, text: "Few seats" },
  STANDING_ONLY: { level: 3, text: "Standing room" },
  STANDING_ROOM_ONLY: { level: 3, text: "Standing room" },
  CRUSHED_STANDING_ROOM_ONLY: { level: 4, text: "Very full" },
  FULL: { level: 4, text: "Full" },
};
const OCC_GTFS = [
  { level: 1, text: "Empty" }, { level: 1, text: "Many seats" }, { level: 2, text: "Few seats" },
  { level: 3, text: "Standing room" }, { level: 4, text: "Very full" }, { level: 4, text: "Full" },
  { level: 4, text: "Not taking passengers" },
];

// ---------- protobuf reading (GTFS realtime) ----------
// A small reader for the protobuf wire format. Big feeds are indexed lazily: one quick
// pass records where each trip lives in the buffer, and a trip is decoded in full only
// when someone asks for it.

class PB {
  constructor(buf, pos = 0, end = buf.length) { this.b = buf; this.p = pos; this.e = end; }
  varint() {
    const b = this.b;
    let lo = 0, hi = 0, x, i = 0;
    for (; i < 4; i++) { x = b[this.p++]; lo |= (x & 127) << (i * 7); if (x < 128) return { lo: lo >>> 0, hi: 0 }; }
    x = b[this.p++]; lo |= (x & 127) << 28; hi = (x & 127) >> 4; if (x < 128) return { lo: lo >>> 0, hi };
    for (i = 0; i < 5; i++) { x = b[this.p++]; hi |= (x & 127) << (i * 7 + 3); if (x < 128) break; }
    return { lo: lo >>> 0, hi: hi >>> 0 };
  }
  // Plain number for varints up to 7 bytes (under 2^49), which is every id, count and timestamp in
  // these feeds; longer ones (negative numbers) go through varint() as before. Returns -1 to say so.
  small() {
    const b = this.b, s = this.p;
    let x = b[s];
    if (x < 128) { this.p = s + 1; return x; }
    let v = x & 127, m = 128;
    for (let i = 1; i < 7; i++) {
      x = b[s + i]; v += (x & 127) * m;
      if (x < 128) { this.p = s + i + 1; return v; }
      m *= 128;
    }
    return -1;
  }
  uint() { const n = this.small(); if (n >= 0) return n; const v = this.varint(); return v.hi * 4294967296 + v.lo; }
  int32() { const s = this.p, n = this.small(); if (n >= 0 && n < 2147483648) return n; this.p = s; return this.varint().lo | 0; }
  int64() { const n = this.small(); if (n >= 0) return n; const v = this.varint(); return v.hi & 0x80000000 ? -((~v.hi >>> 0) * 4294967296 + ((~v.lo >>> 0) + 1)) : v.hi * 4294967296 + v.lo; }
  float() { const dv = new DataView(this.b.buffer, this.b.byteOffset + this.p, 4); this.p += 4; return dv.getFloat32(0, true); }
  double() { const dv = new DataView(this.b.buffer, this.b.byteOffset + this.p, 8); this.p += 8; return dv.getFloat64(0, true); }
  bytes() { const n = this.uint(); const s = this.p; this.p += n; return [s, this.p]; }
  str() { const [s, e] = this.bytes(); return TD.decode(this.b.subarray(s, e)); }
  skip(wt) {
    if (wt === 0) { while (this.b[this.p++] >= 128); }
    else if (wt === 1) this.p += 8;
    else if (wt === 2) this.bytes();
    else if (wt === 5) this.p += 4;
    else throw new Error("bad wire type " + wt);
  }
  // Iterate fields: calls fn(fieldNumber, wireType) which must consume the value or return false.
  each(fn) {
    while (this.p < this.e) {
      const tag = this.uint();
      const f = Math.floor(tag / 8), wt = tag & 7;
      if (fn(f, wt) === false) this.skip(wt);
    }
  }
  sub() { const [s, e] = this.bytes(); return new PB(this.b, s, e); }
}
const TD = new TextDecoder();

// The readers below loop over fields directly (no callback per field): a board decodes about
// eighty trips per request, and this shape is much cheaper before the JIT has warmed up.
function readTripDescriptor(pb) {
  const t = {};
  while (pb.p < pb.e) {
    const tag = pb.uint(), f = Math.floor(tag / 8);
    if (f === 1) t.tripId = pb.str();
    else if (f === 2) t.startTime = pb.str();
    else if (f === 3) t.startDate = pb.str();
    else if (f === 4) t.rel = pb.uint();
    else if (f === 5) t.routeId = pb.str();
    else pb.skip(tag & 7);
  }
  return t;
}
function readVehicleDescriptor(pb) {
  const v = {};
  while (pb.p < pb.e) {
    const tag = pb.uint(), f = Math.floor(tag / 8);
    if (f === 1) v.id = pb.str();
    else if (f === 2) v.label = pb.str();
    else if (f === 3) v.plate = pb.str();
    else pb.skip(tag & 7);
  }
  return v;
}
function readStopTimeEvent(pb) {
  const ev = {};
  while (pb.p < pb.e) {
    const tag = pb.uint(), f = Math.floor(tag / 8);
    if (f === 1) ev.delay = pb.int32();
    else if (f === 2) ev.time = pb.int64();
    else pb.skip(tag & 7);
  }
  return ev;
}
function readTripUpdate(pb) {
  const tu = { stus: [], ts: 0 };
  while (pb.p < pb.e) {
    const tag = pb.uint(), f = Math.floor(tag / 8);
    if (f === 1) Object.assign(tu, readTripDescriptor(pb.sub()));
    else if (f === 2) {
      const s = pb.sub(); const u = {};
      while (s.p < s.e) {
        const t2 = s.uint(), g = Math.floor(t2 / 8);
        if (g === 1) u.seq = s.uint();
        else if (g === 2) u.arr = readStopTimeEvent(s.sub());
        else if (g === 3) u.dep = readStopTimeEvent(s.sub());
        else if (g === 4) u.stopId = s.str();
        else if (g === 5) u.rel = s.uint();
        else s.skip(t2 & 7);
      }
      tu.stus.push(u);
    }
    else if (f === 3) tu.vehicle = readVehicleDescriptor(pb.sub());
    else if (f === 4) tu.ts = pb.uint();
    else if (f === 5) tu.delay = pb.int32();
    else pb.skip(tag & 7);
  }
  return tu;
}
function readVehiclePosition(pb) {
  const v = {};
  while (pb.p < pb.e) {
    const tag = pb.uint(), f = Math.floor(tag / 8);
    if (f === 1) v.trip = readTripDescriptor(pb.sub());
    else if (f === 2) {
      const s = pb.sub();
      while (s.p < s.e) {
        const t2 = s.uint(), g = Math.floor(t2 / 8), wt = t2 & 7;
        if (g === 1 && wt === 5) v.lat = s.float();
        else if (g === 2 && wt === 5) v.lon = s.float();
        else if (g === 3 && wt === 5) v.bearing = s.float();
        else if (g === 5 && wt === 5) v.speed = s.float();
        else s.skip(wt);
      }
    }
    else if (f === 3) v.stopSeq = pb.uint();
    else if (f === 4) v.status = pb.uint();
    else if (f === 5) v.ts = pb.uint();
    else if (f === 6) v.congestion = pb.uint();
    else if (f === 7) v.stopId = pb.str();
    else if (f === 8) v.vehicle = readVehicleDescriptor(pb.sub());
    else if (f === 9) v.occupancy = pb.uint();
    else if (f === 18) (v.carriages || (v.carriages = [])).push(readCarriage(pb.sub()));
    else if (f === 1007 && (tag & 7) === 2) (v.consist || (v.consist = [])).push(readConsistCar(pb.sub()));
    else pb.skip(tag & 7);
  }
  return v;
}
// GTFS realtime CarriageDetails (multi_carriage_details): sequence 1 is the first carriage in the direction of travel.
function readCarriage(pb) {
  const c = { status: null, seq: null };
  while (pb.p < pb.e) {
    const tag = pb.uint(), f = Math.floor(tag / 8);
    if (f === 2) c.label = pb.str();
    else if (f === 3) c.status = pb.uint();
    else if (f === 5) c.seq = pb.uint();
    else pb.skip(tag & 7);
  }
  return c;
}
// Transport for NSW extension 1007 on VehiclePosition (CarriageDescriptor): name, position_in_consist,
// occupancy_status, quiet_carriage. Read so the cars of Sydney Trains and NSW TrainLink services can be shown.
function readConsistCar(pb) {
  const c = { status: null, seq: null };
  while (pb.p < pb.e) {
    const tag = pb.uint(), f = Math.floor(tag / 8), wt = tag & 7;
    if (f === 1 && wt === 2) c.name = pb.str();
    else if (f === 2 && wt === 0) c.seq = pb.uint();
    else if (f === 3 && wt === 0) c.status = pb.uint();
    else if (f === 4 && wt === 0) c.quiet = !!pb.uint();
    else pb.skip(wt);
  }
  return c;
}
/** The carriages of a vehicle in order from the front: the standard field when sent, else the TfNSW consist. */
function carsOf(vp) {
  if (!vp) return [];
  if (vp._cars) return vp._cars;
  const src = vp.carriages && vp.carriages.length ? vp.carriages : vp.consist || [];
  // Metro sends position 0 for every car, in order: then the order sent is the order.
  const allSeq = src.length && src.every((c) => c.seq > 0);
  vp._cars = src.map((c, i) => ({ seq: allSeq ? c.seq : i + 1, status: c.status }));
  return vp._cars;
}
/**
 * Where the train is quieter, from live carriage occupancy: "front", "middle", "back" or "ends", only when that part
 * is at least one level emptier than the fullest third and some of the train has only few seats or less. Null when
 * there is no carriage data or nothing worth saying.
 */
function quietHint(cars) {
  const ok = (cars || []).filter((c) => c && c.seq != null && c.status != null && c.status <= 6).sort((a, b) => a.seq - b.seq);
  if (ok.length < 3) return null;
  const lvl = (s) => (OCC_GTFS[s] || { level: 0 }).level;
  const n = ok.length, k = Math.ceil(n / 3);
  const parts = { front: ok.slice(0, k), middle: ok.slice(k, n - k), back: ok.slice(n - k) };
  const avg = (xs) => (xs.length ? xs.reduce((s, c) => s + lvl(c.status), 0) / xs.length : null);
  const sc = Object.fromEntries(Object.entries(parts).map(([w, xs]) => [w, avg(xs)]).filter(([, v]) => v != null));
  const vals = Object.values(sc), max = Math.max(...vals), min = Math.min(...vals);
  if (max < 2 || max - min < 1) return null;
  if (sc.middle === max && sc.front != null && sc.back != null && Math.abs(sc.front - sc.back) < 0.5) return { where: "ends", text: "Quieter at either end" };
  const where = ["front", "back", "middle"].find((w) => sc[w] === min);
  return { where, text: `Quieter at the ${where}` };
}

// Quick pass: map trip_id -> [start, end] of the trip_update (field 3) or vehicle (field 4).
// Hand rolled for speed: it walks only the entity level and the first bytes of each entity,
// so a 2 MB bus feed costs one short loop per trip instead of a step per stop time update.
let QP = 0;
function qv(b) { // varint at QP, as a plain number (exact up to 2^53)
  let x = b[QP++];
  if (x < 128) return x;
  let v = x & 127, m = 128;
  for (;;) { x = b[QP++]; v += (x & 127) * m; if (x < 128) return v; m *= 128; }
}
function qskip(b, wt) {
  if (wt === 0) { while (b[QP++] >= 128); }
  else if (wt === 1) QP += 8;
  else if (wt === 2) { const n = qv(b); QP += n; }
  else if (wt === 5) QP += 4;
  else throw new Error("bad wire type " + wt);
}
function indexFeed(buf, kind) {
  const want = kind === "tu" ? 3 : 4;
  const idx = new Map();
  let headerTs = 0;
  const end = buf.length;
  QP = 0;
  while (QP < end) {
    const tag = qv(buf), f = Math.floor(tag / 8), wt = tag & 7;
    if (f === 1) {
      const he = qv(buf) + QP;
      while (QP < he) { const t = qv(buf); if (Math.floor(t / 8) === 3) headerTs = qv(buf); else qskip(buf, t & 7); }
      continue;
    }
    if (f !== 2) { qskip(buf, wt); continue; }
    const ee = qv(buf) + QP;
    while (QP < ee) {
      const t = qv(buf);
      if (Math.floor(t / 8) !== want) { qskip(buf, t & 7); continue; }
      const n = qv(buf), s = QP, e = s + n;
      let tripId = null;
      while (QP < e) {
        const t2 = qv(buf);
        if (Math.floor(t2 / 8) === 1) {
          const de = qv(buf) + QP;
          while (QP < de) {
            const t3 = qv(buf);
            if (Math.floor(t3 / 8) === 1) { const l = qv(buf); tripId = TD.decode(buf.subarray(QP, QP + l)); QP += l; }
            else qskip(buf, t3 & 7);
          }
          break; // the descriptor is all this pass needs; the rest of the message is skipped below
        }
        qskip(buf, t2 & 7);
      }
      QP = e;
      if (tripId) idx.set(tripId, [s, e]);
    }
    QP = ee;
  }
  return { idx, headerTs };
}

// ---------- shared feed cache ----------
// Each feed is fetched at most once per FEED_TTL_MS per worker instance, and Cloudflare's fetch
// cache keeps the bytes for the same time so other instances in the same location can reuse them.

// ---------- one answer shared by several requests in this copy of the worker ----------
// Cloudflare runs each request in its own context. A request that awaits a promise another request started has no
// I/O of its own, so the runtime cancels it as hung, or its answer is built inside the other request's context and
// cannot be sent ("Cannot perform I/O on behalf of a different request"). On wrangler dev (the same runtime) 9 of 10
// identical first opens of a board failed this way with a 500 (26 Oct, g28, docs/REVERSE_ENGINEERING.md). So a
// shared job keeps its result as plain data, and a request that did not start it waits on its own short timers and
// reads that data. The request that started the job awaits its promise as before.
function sharedJob(promise) {
  const job = { done: false, ok: false, value: undefined, promise, at: Date.now() };
  promise.then((v) => { job.done = true; job.ok = true; job.value = v; }, (e) => { job.done = true; job.value = e; });
  return job;
}
// True once the job has settled, false if maxMs passed first. Only this request's own timers are awaited.
async function waitJob(job, maxMs) {
  const until = Date.now() + Math.max(0, maxMs);
  for (let wait = 5; !job.done; wait = Math.min(wait * 2, 100)) {
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, Math.min(wait, Math.max(1, until - Date.now()))));
  }
  return true;
}
// The job's value for a request that did not start it (throws its error, or a time out after maxMs).
async function joinJob(job, maxMs = 30000) {
  if (!(await waitJob(job, maxMs))) throw new Error("A shared answer took too long");
  if (!job.ok) throw job.value;
  return job.value;
}

const feedMem = new Map(); // path -> { at, buf, idx, headerTs, job }
const feedStats = { fetched: 0, edgeHits: 0, memHits: 0, edgeMiss: 0, edgeErr: 0, edgePutErr: 0, requests: 0, isolate: Math.random().toString(36).slice(2, 8), born: Date.now() };

async function loadFeed(env, path, kind) {
  const now = Date.now();
  const hit = feedMem.get(path);
  if (hit && hit.buf && now - hit.at < FEED_TTL_MS) { feedStats.memHits++; return hit; }
  // A fetch still running after FEED_JOB_MAX_MS is taken as lost and asked again: the request that started it may have
  // answered before it finished (realtimeFor waits FEED_WAIT_MS at most), and the runtime can drop its unfinished work.
  // Before 26 Oct (g28) such a fetch stayed in feedMem for the life of the copy: no fresh feed again, and every later
  // board waited FEED_WAIT_MS for it.
  if (hit && hit.job && (hit.job.done || now - hit.job.at < FEED_JOB_MAX_MS)) return joinJob(hit.job, FEED_JOB_MAX_MS);
  const promise = (async () => {
    // One copy per location is shared through Cloudflare's own fetch cache (good answers only): the same 15 s
    // sharing the Cache API gave, but the copy is stored outside this isolate, so it costs no CPU here.
    // Putting a 2.3 MB feed into the Cache API took about 25 ms of CPU on every fresh fetch, and most
    // requests run in a fresh isolate. A copy from that cache says how old it is in Age.
    const f0 = Date.now();
    const res = await fetch(API + path, { headers: { Authorization: "apikey " + apiKey(env) }, signal: AbortSignal.timeout(FEED_JOB_MAX_MS - 2000), cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": Math.round(FEED_TTL_MS / 1000), "300-599": 0 } } }).finally(() => reqUpstream(Date.now() - f0));
    const shared = res.headers && res.headers.get("cf-cache-status") === "HIT";
    if (shared) feedStats.edgeHits++; else { upstream.calls++; feedStats.fetched++; }
    if (!res.ok) { upstreamRefused(res.status, res.headers && res.headers.get("x-error-detail")); throw new Error(`Realtime feed ${path} answered ${res.status}`); }
    const buf = new Uint8Array(await res.arrayBuffer());
    const age = shared ? Number(res.headers.get("age")) || 0 : 0;
    const at = Date.now() - Math.min(age, FEED_TTL_MS / 1000) * 1000;
    const { idx, headerTs } = indexFeed(buf, kind);
    const entry = { at, buf, idx, headerTs, kind, cache: new Map() };
    feedMem.set(path, entry);
    return entry;
  })();
  feedMem.set(path, { ...(hit || {}), job: sharedJob(promise) });
  // The fetch finishes and is kept even when this request answers first (reqLogged keeps the request's waitUntil).
  reqKeep(promise);
  try { return await promise; }
  catch (e) {
    if (hit && hit.buf) { feedMem.set(path, hit); return hit; } // serve the last good copy
    feedMem.delete(path);
    throw e;
  }
}

function decodeFrom(feed, tripId) {
  if (!feed) return null;
  if (feed.cache.has(tripId)) return feed.cache.get(tripId);
  const loc = feed.idx.get(tripId);
  let out = null;
  if (loc) out = feed.kind === "tu" ? readTripUpdate(new PB(feed.buf, loc[0], loc[1])) : readVehiclePosition(new PB(feed.buf, loc[0], loc[1]));
  feed.cache.set(tripId, out);
  return out;
}

// Loads the trip update and vehicle feeds needed for a set of (mode, line) pairs.
async function realtimeFor(env, pairs) {
  const keys = new Set();
  for (const [mode, line, feed] of pairs) for (const k of feedKeys(mode, line, feed)) keys.add(k);
  const out = {};
  await Promise.all([...keys].map(async (k) => {
    const f = FEEDS[k];
    const late = () => new Promise((r) => setTimeout(() => r(null), FEED_WAIT_MS));
    const [tu, vp] = await Promise.all([
      Promise.race([loadFeed(env, f.tu, "tu").catch(() => null), late()]),
      Promise.race([loadFeed(env, f.vp, "vp").catch(() => null), late()]),
    ]);
    out[k] = { tu, vp };
  }));
  const pick = (mode, line, tripId, feed, kind) => {
    if (!tripId) return null;
    for (const k of feedKeys(mode, line, feed)) { const r = out[k] ? decodeFrom(out[k][kind], tripId) : null; if (r) return r; }
    return null;
  };
  return {
    feeds: out,
    tu(mode, line, tripId, feed) { return pick(mode, line, tripId, feed, "tu"); },
    vp(mode, line, tripId, feed) { return pick(mode, line, tripId, feed, "vp"); },
    fetchedAt() { let m = 0; for (const k in out) { if (out[k].tu) m = Math.max(m, out[k].tu.at); if (out[k].vp) m = Math.max(m, out[k].vp.at); } return m || null; },
  };
}

// ---------- static stop names and coordinates ----------
// Shards built from the TfNSW GTFS static stops.txt, served as assets under /stops/.

const shardMem = new Map();
async function loadShard(env, key) {
  const known = shardMem.get(key);
  if (known) return known.done ? known.value : joinJob(known);
  const p = (async () => {
    try {
      const r = await env.ASSETS.fetch(new Request("https://assets.local/stops/" + key + ".json"));
      if (!r.ok) return {};
      return await r.json();
    } catch (e) { return {}; }
  })();
  shardMem.set(key, sharedJob(p));
  return p;
}
function shardKey(id) { return String(id).slice(0, 3).replace(/[^A-Za-z0-9]/g, "_"); }
async function stopInfo(env, ids) {
  const keys = [...new Set(ids.filter(Boolean).map(shardKey))];
  const shards = await Promise.all(keys.map((k) => loadShard(env, k)));
  const byKey = Object.fromEntries(keys.map((k, i) => [k, shards[i]]));
  const out = {};
  for (const id of ids) {
    const s = id && byKey[shardKey(id)] && byKey[shardKey(id)][id];
    if (s) out[id] = { name: s[0], lat: s[1], lon: s[2] };
  }
  return out;
}

// ---------- realtime merge ----------

function stuTime(u) {
  const ev = (u.dep && u.dep.time) ? u.dep : (u.arr && u.arr.time ? u.arr : null);
  return ev ? { t: ev.time * 1000, delay: ev.delay != null ? ev.delay : null } : null;
}

// What the realtime feed says about one trip at one stop.
function feedAtStop(tu, stopId) {
  if (!tu) return null;
  if (tu.rel === 3) return { cancelled: true };
  if (!tu.ts) return null; // no data published for this trip yet
  const u = tu.stus.find((x) => x.stopId === stopId);
  if (!u) return null;
  if (u.rel === 1) return { skipped: true };
  if (u.rel === 2) return null; // NO_DATA
  const st = stuTime(u);
  if (!st) return null;
  return { est: st.t, delay: st.delay };
}

function vehicleOf(vp) {
  if (!vp || vp.lat == null || vp.lon == null) return null;
  const age = vp.ts ? Math.round(Date.now() / 1000 - vp.ts) : null;
  if (age != null && age > VEHICLE_MAX_AGE_S) return null;
  return {
    lat: Math.round(vp.lat * 1e6) / 1e6, lon: Math.round(vp.lon * 1e6) / 1e6,
    bearing: vp.bearing != null ? Math.round(vp.bearing) : null,
    speedKmh: vp.speed != null ? Math.round(vp.speed * 3.6) : null,
    ts: vp.ts ? vp.ts * 1000 : null, ageS: age,
    stopSeq: vp.stopSeq || null, stopId: vp.stopId || null, status: vp.status != null ? vp.status : null,
    occupancy: vp.occupancy != null ? OCC_GTFS[vp.occupancy] || null : null,
    label: (vp.vehicle && (vp.vehicle.label || null)) || null,
    ...(carsOf(vp).length ? { cars: carsOf(vp).length } : {}),
    ...(quietHint(carsOf(vp)) ? { quiet: quietHint(carsOf(vp)) } : {}),
  };
}

// Index of the next stop the vehicle will reach, from the vehicle state or the trip update
// times. Returns -1 when neither says.
function nextStopIndex(tu, veh, now = Date.now()) {
  if (!tu || !tu.stus.length) return -1;
  if (veh && veh.stopSeq) {
    const i = tu.stus.findIndex((u) => u.seq === veh.stopSeq);
    if (i >= 0) return veh.status === 1 && i + 1 < tu.stus.length ? i + 1 : i; // 1 = STOPPED_AT
  }
  if (veh && veh.stopId) {
    const i = tu.stus.findIndex((u) => u.stopId === veh.stopId);
    if (i >= 0) return veh.status === 1 && i + 1 < tu.stus.length ? i + 1 : i;
  }
  if (!hasTimes(tu)) return -1;
  for (let i = 0; i < tu.stus.length; i++) {
    const st = stuTime(tu.stus[i]);
    if (st && st.t >= now - 20000) return i;
  }
  return tu.stus.length - 1;
}
function hasTimes(tu) {
  if (!tu || !tu.stus.length) return false;
  return tu.stus.filter((u) => stuTime(u)).length >= tu.stus.length * 0.6;
}
// Nearest route segment to the vehicle: returns the index of the stop it is heading to.
function locateGeom(veh, stops) {
  if (!veh || stops.length < 2) return -1;
  let best = Infinity, bi = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    const d = distM(veh.lat, veh.lon, a.lat, a.lon) + distM(veh.lat, veh.lon, b.lat, b.lon) - distM(a.lat, a.lon, b.lat, b.lon);
    if (d < best) { best = d; bi = i + 1; }
  }
  let ni = -1, nd = Infinity;
  stops.forEach((s, i) => { const d = distM(veh.lat, veh.lon, s.lat, s.lon); if (d < nd) { nd = d; ni = i; } });
  if (nd < 150) return ni; // at (or pulling into) this stop
  if (best > 1500) return 0; // not on this part of the route yet
  return bi;
}

// Applies feed data to a departure-like item (works for board rows and trip legs).
// item needs: mode, line, tripId, stopId, planned, estimated, realtime.
function enrich(item, rt) {
  const tu = rt.tu(item.mode, item.line, item.tripId, item.feed);
  const vp = rt.vp(item.mode, item.line, item.tripId, item.feed);
  const veh = vehicleOf(vp);
  item.source = item.realtime ? "planner" : null;
  const f = feedAtStop(tu, item.stopId);
  if (f && f.cancelled) item.cancelled = true;
  if (f && f.skipped) item.skipped = true;
  if (!item.realtime && f && f.est) {
    item.estimated = iso(f.est);
    item.realtime = true;
    item.source = "feed";
    item.delayMin = Math.round((f.est - ms(item.planned)) / 60000);
  }
  if (veh) {
    item.vehicle = veh;
    if (!item.occupancy && veh.occupancy) item.occupancy = veh.occupancy;
    if (tu && tu.stus.length && item.realtime) {
      const mine = tu.stus.findIndex((u) => u.stopId === item.stopId);
      const nxt = nextStopIndex(tu, veh);
      if (mine >= 0 && nxt >= 0 && mine >= nxt) {
        item.stopsAway = mine - nxt;
        // Bus and coach rows: the live delays from the bus's next stop to this stop, for the app's slow traffic rule.
        if (item.mode === "bus" || item.mode === "coach" || item.mode === "school") {
          const a = aheadDelays(tu, nxt, mine);
          if (a) item.ahead = a;
        }
      }
    }
  }
  return item;
}

// Live delays in minutes (one decimal) at the stops from index `from` to `to` of a trip update, null where a stop has
// no live time. At most 24 values: the first two and last two are always kept, the stops between are sampled evenly.
// Null when fewer than 3 stops have a live delay.
function aheadDelays(tu, from, to) {
  if (!tu || !tu.ts || tu.rel === 3 || from < 0 || to < from) return null;
  const all = [];
  for (let i = from; i <= Math.min(to, tu.stus.length - 1); i++) {
    const u = tu.stus[i];
    const st = u && u.rel !== 1 && u.rel !== 2 ? stuTime(u) : null;
    all.push(st && st.delay != null ? Math.round(st.delay / 6) / 10 : null);
  }
  if (all.filter((v) => v != null).length < 3) return null;
  if (all.length <= 24) return all;
  const n = all.length, keep = [0, 1];
  for (let k = 1; k <= 19; k++) keep.push(1 + Math.round((k * (n - 3)) / 20));
  keep.push(n - 2, n - 1);
  return [...new Set(keep)].sort((a, b) => a - b).map((i) => all[i]);
}

function statusOf(it) {
  if (it.cancelled) return { key: "cancelled", text: "Cancelled" };
  if (it.skipped) return { key: "cancelled", text: "Not stopping here" };
  if (!it.realtime) return { key: "scheduled", text: "Scheduled" };
  if (it.delayMin >= 2) return { key: "late", text: it.delayMin + " min late" };
  if (it.delayMin <= -2) return { key: "early", text: -it.delayMin + " min early" };
  return { key: "ontime", text: "On time" };
}

// ---------- stop search ----------

const stopCache = new Map();
async function findLocations(env, q, max = 20) {
  const k = q.toLowerCase() + "|" + max;
  const hit = stopCache.get(k);
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.data;
  const data = await tp(env, "stop_finder", { type_sf: "any", name_sf: q, TfNSWSF: "true", anyMaxSizeHitList: String(max) });
  const list = (data.locations || []).map((l) => ({
    id: l.id, name: l.name, type: l.type, quality: l.matchQuality || 0, best: !!l.isBest, modes: l.modes || [],
    area: (l.parent && l.parent.name) || null, coord: Array.isArray(l.coord) && l.coord.length === 2 ? l.coord : null,
  }));
  if (stopCache.size > 500) stopCache.clear();
  stopCache.set(k, { at: Date.now(), data: list });
  return list;
}
function isNswStop(l) { return !/South Australia|Victoria|Queensland|\bACT\b/.test(l.name); }
async function findStops(env, q) {
  let all;
  try { all = await findLocations(env, q); }
  catch (e) {
    // Trip Planner down (ttplan.js): stops from our own index, so Ask can still name a stop.
    if (typeof ttUpstreamDown !== "function" || !ttUpstreamDown(e)) throw e;
    const idx = await stopIndex(env, null).catch(() => null);
    const own = idx ? indexSearch(idx, q, 8).items : [];
    if (!own.length) throw e;
    const stops = own.map((x, i) => ({ id: x.id, name: x.name, type: "stop", modes: x.modes, quality: 1000 - i }));
    return { stops, all: stops };
  }
  const stops = all.filter((l) => (l.type === "stop" || l.type === "platform") && isNswStop(l));
  stops.sort((a, b) => b.quality - a.quality);
  return { stops, all };
}
// Places for the app's search box: stops plus addresses, streets, landmarks and suburbs, each with a kind,
// in the Trip Planner's own match order. Every id is one the Trip Planner takes back as a trip end (type any),
// so a result can be a trip origin or destination as it is. NSW only.
const PLACE_KINDS = { stop: "stop", platform: "stop", singlehouse: "address", street: "street", poi: "place", suburb: "suburb", locality: "suburb" };
function placesFrom(all, max = 10) {
  const out = [];
  const seen = new Set();
  const list = all.filter((l) => PLACE_KINDS[l.type] && isNswStop(l)).sort((a, b) => (b.best ? 1 : 0) - (a.best ? 1 : 0) || b.quality - a.quality);
  for (const l of list) {
    const kind = PLACE_KINDS[l.type];
    const name = shortName(l.name);
    const key = kind + "|" + name.toLowerCase();
    if (!l.id || seen.has(key)) continue;
    seen.add(key);
    // The suburb line under the name, unless the name already ends with it.
    const area = l.area && !name.toLowerCase().endsWith(String(l.area).toLowerCase()) ? shortName(l.area) : null;
    out.push({ id: String(l.id), name, kind, ...(kind === "stop" ? { modes: l.modes || [] } : {}), ...(area && kind !== "stop" && kind !== "suburb" ? { area } : {}),
      ...(l.coord ? { lat: Math.round(l.coord[0] * 1e5) / 1e5, lon: Math.round(l.coord[1] * 1e5) / 1e5 } : {}) });
    if (out.length >= max) break;
  }
  return out;
}
async function bestPlace(env, q) {
  if (/^\d{5,8}$/.test(q)) return { place: { id: q, name: "Stop " + q, type: "stop" }, others: [] };
  const { stops, all } = await findStops(env, q);
  const top = all.slice().sort((a, b) => b.quality - a.quality)[0];
  if (stops.length && (!top || stops[0].quality >= top.quality * 0.9)) return { place: stops[0], others: stops.slice(1, 4) };
  if (top) return { place: top, others: stops.slice(0, 3) };
  return { place: null, others: [] };
}
// The stop name at one end of the first journey, without the platform or stand part.
function tripEndName(r, end) {
  const legs = (((r && r.journeys) || [])[0] || {}).legs || [];
  const l = end === "from" ? legs[0] : legs[legs.length - 1];
  const n = l && (end === "from" ? l.from : l.to);
  return n ? String(n).split(/,\s*(Platform|Stand|Wharf \d|Stop)\b/i)[0].trim() || null : null;
}
// A stop's name from a planner stop: its short name, unless that short name has no station in it. At both airport
// stations every platform's short name is only ", Platform 2" (seen 26 Oct), so stop lists showed a blank row; the
// full name "Domestic Airport Station, Platform 2, Mascot" without its suburb is used then.
function seqStopName(s) {
  const d = String((s && s.disassembledName) || "").trim();
  if (d && !d.startsWith(",")) return shortName(d);
  const n = String((s && s.name) || "").trim();
  if (!d) return shortName(n);
  const parts = n.split(", ");
  if (parts[0]) return shortName(parts.length >= 3 ? parts.slice(0, -1).join(", ") : n);
  return d.replace(/^,\s*/, "");
}
function shortName(n) {
  const s = String(n || "").replace(/,\s*(Sydney|NSW)$/i, "");
  const parts = s.split(", ");
  if (parts.length === 2 && parts[0].toLowerCase().startsWith(parts[1].toLowerCase())) return parts[0];
  return s;
}

// ---------- departures ----------

// The moment a board asks for (/api/departures `time` and optional `date`, docs/API.md): HHMM Sydney time on that
// day, or with no date in the current service day (4am to 4am, so 1:30am means tonight, not tomorrow night).
// Never before the start of the service day of now (4am, the day before when it is now before 4am), never more
// than 14 days ahead. Null when there is no valid time: the board is for now, as before.
function sydneyMomentOf(day, hhmm) {
  const wall = Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8), +hhmm.slice(0, 2), +hhmm.slice(2, 4));
  let t = wall - 660 * 60000;
  for (let i = 0; i < 2; i++) t = wall - sydOffsetMin(t) * 60000;
  return t;
}
function boardAt(rawTime, rawDate, now = Date.now()) {
  const time = String(rawTime || "");
  if (!/^([01]\d|2[0-3])[0-5]\d$/.test(time)) return null;
  const s = sydneyNow(new Date(now));
  const startDay = s.tod >= 240 ? s.day : sydneyNow(new Date(now - 12 * 3600000)).day;
  const floor = sydneyMomentOf(startDay, "0400");
  let t;
  const day = String(rawDate || "");
  if (/^\d{8}$/.test(day)) t = sydneyMomentOf(day, time);
  else {
    t = sydneyMomentOf(startDay, time);
    if (t < floor) t = sydneyMomentOf(sydneyNow(new Date(floor + 24 * 3600000)).day, time);
  }
  if (!Number.isFinite(t)) return null;
  const clamped = t < floor;
  t = Math.min(Math.max(t, floor), now + 14 * 86400000);
  const p = sydneyParts(new Date(t));
  return { t, date: p.date, time: p.time, clamped };
}

// A board for one mode (`mode` on /api/departures) asks the Trip Planner for that mode only. Its answer is 40
// services, so at a station with trains and many bus stands a mixed list covers about 15 minutes and the buses in
// it fewer still; asked for buses alone, the 40 reach about 50 minutes ahead (Strathfield, 26 Oct 2026, 7:51am).
// Bus includes coach and school bus, as the filter below does. An unknown mode asks for everything, as before.
const DM_CLASSES = [1, 2, 4, 5, 7, 9, 11];
function modeOnly(mode) {
  if (!mode) return {};
  const keep = (cls) => modeOf(cls).key === mode || (mode === "bus" && modeOf(cls).key === "coach");
  if (!DM_CLASSES.some(keep)) return {};
  const out = { excludedMeans: "checkbox" };
  for (const cls of DM_CLASSES) if (!keep(cls)) out["exclMOT_" + cls] = "1";
  return out;
}

async function departures(env, stopId, opts = {}) {
  // opts.at (boardAt): the board from that moment, services that have already left included.
  const { date, time } = opts.at ? { date: opts.at.date, time: opts.at.time } : sydneyParts();
  let data;
  try {
    data = await tp(env, "departure_mon", {
      mode: "direct", type_dm: "stop", name_dm: stopId,
      departureMonitorMacro: "true", TfNSWDM: "true", itdDate: date, itdTime: time,
      ...modeOnly(opts.mode),
      ...(opts.extra || {}),
    });
  } catch (e) {
    // Trip Planner down: the engine's timetable board, labelled (ttplan.js), for Ask and the text answers. Background
    // checks pass timetable: false and keep the error.
    if (opts.at || opts.extra || opts.timetable === false || typeof ttBoard !== "function" || !ttUpstreamDown(e)) throw e;
    const b = await ttBoard(env, opts.ctx, stopId, opts.mode).catch(() => null);
    if (b) return b;
    throw e;
  }
  const now = Date.now();
  const loc = (data.locations || [])[0] || {};
  const alerts = new Map();
  let items = [];
  for (const e of data.stopEvents || []) {
    const t = e.transportation || {};
    const cls = t.product ? t.product.class : 0;
    const planned = e.departureTimePlanned;
    const est = e.departureTimeEstimated || null;
    const line = t.disassembledName || t.number || "";
    const mode = modeOf(cls);
    const lp = (e.location && e.location.properties) || {};
    const alertIds = [];
    for (const info of e.infos || []) {
      const k = info.id || info.subtitle;
      if (!k) continue;
      alertIds.push(k);
      if (!alerts.has(k)) alerts.set(k, { id: k, title: plainText(info.subtitle || info.title || ""), url: httpsUrl(info.url), priority: info.priority || "", lines: new Set() });
      alerts.get(k).lines.add(line);
    }
    items.push({
      mode: mode.key, modeName: mode.name, line, color: lineColor(line, cls),
      dest: (t.destination && t.destination.name) || "",
      destId: (t.destination && t.destination.id) || null,
      description: t.description || "",
      platform: platformLabel(lp, cls),
      platformChangedFrom: platformChange(lp, cls),
      stopId: (e.location && e.location.id) || stopId,
      stopName: lp.platformName || (e.location && e.location.name) || "",
      tripId: (e.properties && (e.properties.RealtimeTripId || e.properties.AVMSTripID)) || null,
      planned: iso(planned),
      estimated: est && e.isRealtimeControlled ? iso(est) : null,
      realtime: !!est && !!e.isRealtimeControlled,
      delayMin: est && e.isRealtimeControlled ? Math.round((ms(est) - ms(planned)) / 60000) : null,
      cancelled: !!e.isCancelled || (Array.isArray(e.realtimeStatus) && e.realtimeStatus.includes("CANCELLED")),
      wheelchair: !!(e.properties && e.properties.WheelchairAccess === "true"),
      occupancy: OCC_EFA[lp.occupancy] || null,
      alerts: alertIds,
      ...(feedHint(cls, t) ? { feed: feedHint(cls, t) } : {}),
    });
  }
  // A train or metro's stop id for its destination, from the destination's own name (railDestId).
  if (items.some((i) => i.mode === "train" || i.mode === "metro")) {
    const dmap = await railDestMap(env);
    for (const it of items) it.destId = railDestId(dmap, it.mode, it.dest, it.destId);
  }
  // Background sampling (opts.sampleOnly) keeps only live times, and the feeds can change a row's
  // time only when the Trip Planner has no live time for it; rows that already have one skip the
  // feed work there. Every other caller gets the full merge.
  const needFeed = opts.sampleOnly ? items.filter((i) => !i.realtime) : items;
  const rt = await realtimeFor(env, needFeed.map((i) => [i.mode, i.line, i.feed]));
  let filled = 0;
  for (const it of items) {
    const was = it.realtime;
    if (opts.sampleOnly && was) it.source = "planner";
    else enrich(it, rt);
    if (!was && it.realtime) filled++;
    it.status = statusOf(it);
  }
  // Now drops services gone over 45 s ago, as before. A chosen moment keeps every service from it, gone or not;
  // a gone one carries departed: true (left over a minute ago) with the live time and delay it left with, when known.
  if (opts.at) for (const it of items) it.departed = ms(it.estimated || it.planned) < now - 60000;
  else items = items.filter((i) => ms(i.estimated || i.planned) >= now - 45000);
  items.sort((a, b) => ms(a.estimated || a.planned) - ms(b.estimated || b.planned));
  const modes = [...new Set(items.map((i) => i.mode))];
  if (opts.mode) items = items.filter((i) => i.mode === opts.mode || (opts.mode === "bus" && i.mode === "coach"));
  const first = data.stopEvents && data.stopEvents[0] && data.stopEvents[0].location;
  const exactName = first && first.properties && first.properties.platformName ? first.properties.platformName : null;
  // Delay samples are live times read close to departure: a board for another moment records none.
  if (opts.log !== false && !opts.at) logObservations(env, opts.ctx, items, stopId);
  // When each live row's time was read: the realtime feed copy for rows filled from it, else this answer.
  const feedRead = rt.fetchedAt() || now;
  for (const it of items) it.liveAt = it.realtime ? (it.source === "feed" ? feedRead : now) : null;
  return {
    stop: { id: stopId, name: (loc.disassembledName || loc.name) ? seqStopName(loc) : stopId, fullName: loc.name || "", exactName },
    items, modes,
    alerts: [...alerts.values()].map((a) => ({ ...a, lines: [...a.lines].filter(Boolean) })).slice(0, 10),
    live: { feedAt: rt.fetchedAt(), filledFromFeed: filled, liveCount: items.filter((i) => i.realtime).length, total: items.length },
    now,
    // Echoed so the app knows this server honoured the moment (an older server ignores time and answers for now).
    ...(opts.at ? { at: { date: opts.at.date, time: opts.at.time, clamped: opts.at.clamped } } : {}),
  };
}

// ---------- trips ----------

function stopName(p) {
  const strip = (n) => String(n || "").replace(/,\s*(Platform|Stand|Wharf|Side)\s+\w+.*$/i, "").trim();
  // Some platforms carry only ", Platform 2" as their short name; fall back to the full name then.
  return (p && (strip(p.disassembledName) || strip(p.name) || strip(p.parent && p.parent.name))) || "";
}
// An on demand service (product class 10, the D400 in the Inner West run by Bridj): it runs when booked, so the
// planner's times every few minutes are not timetabled departures. The app labels it "On demand, book ahead".
function onDemandOf(t) {
  const cls = t && t.product ? t.product.class : null;
  const attrs = (t && t.properties && t.properties.attributes) || [];
  if (cls !== 10 && !attrs.includes("AREA_ON_DEMAND")) return {};
  const op = t.operator && t.operator.name ? String(t.operator.name) : "";
  return { onDemand: true, booking: attrs.includes("BOOKINGREQUIRED") || cls === 10, ...(op ? { operator: op } : {}), modeName: "On demand" };
}
function legKind(t) {
  const cls = t && t.product ? t.product.class : null;
  if (cls === 99 || cls === 100 || cls === 107) return "walk";
  return "transit";
}

// "151.21070:-33.86760:EPSG:4326": a point (longitude:latitude) the Trip Planner takes with type coord.
function isCoordId(id) { return /^-?\d{1,3}(\.\d+)?:-?\d{1,2}(\.\d+)?:EPSG:4326$/.test(String(id || "")); }
// ---------- live traffic on bus legs ----------
// Open incidents from Live Traffic NSW (crashes, breakdowns, hazards), read at most every 2 minutes, and matched to
// the route of each bus or coach leg: within HAZ_NEAR_M of the line the bus drives. Nothing is made up: no
// incident on the route means no note.
const HAZ_TTL_MS = 120000;
const HAZ_NEAR_M = 120;
let hazMem = null; // { at, items, promise }
function hazCat(s) {
  const t = String(s || "").replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : "Incident";
}
/** One Live Traffic feature in the words the app shows: "Crash on Victoria Road at Gladesville". */
function hazardOut(f) {
  if (!f || typeof f !== "object") return null;
  const p = f.properties || {}, g = f.geometry || {};
  if (p.ended === true || p.isEnded === true) return null;
  const c = g.type === "Point" && Array.isArray(g.coordinates) ? g.coordinates : null;
  const lon = c ? Number(c[0]) : NaN, lat = c ? Number(c[1]) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const road = (Array.isArray(p.roads) && p.roads[0]) || {};
  const what = hazCat(p.mainCategory || p.displayName || p.subCategoryA);
  const street = plainText(road.mainStreet || ""), suburb = plainText(road.suburb || "");
  const text = street ? `${what} on ${street}${suburb ? ` at ${suburb}` : ""}` : `${what}${suburb ? ` at ${suburb}` : ""}`;
  return { id: String(f.id != null ? f.id : p.id || `${lat},${lon}`), lat, lon, kind: what, text, major: !!p.isMajor, updated: p.lastUpdated || p.created || null };
}
async function trafficHazards(env) {
  const now = Date.now();
  if (hazMem && hazMem.items && now - hazMem.at < HAZ_TTL_MS) return hazMem.items;
  if (hazMem && hazMem.job) return joinJob(hazMem.job);
  const promise = (async () => {
    upstream.calls++;
    const res = await fetch(API + "/v1/live/hazards/incident/open", { headers: { Authorization: "apikey " + apiKey(env) }, signal: AbortSignal.timeout(8000), cf: { cacheTtl: 120, cacheEverything: true } });
    if (!res.ok) throw new Error(`Live Traffic answered ${res.status}`);
    const data = await res.json();
    const items = (Array.isArray(data && data.features) ? data.features : []).map(hazardOut).filter(Boolean);
    hazMem = { at: Date.now(), items };
    return items;
  })();
  hazMem = { ...(hazMem || {}), job: sharedJob(promise) };
  try { return await promise; }
  catch (e) { const old = hazMem && hazMem.items; hazMem = old ? { at: Date.now() - HAZ_TTL_MS + 30000, items: old } : null; if (old) return old; throw e; }
}
/** Metres from point p to segment a-b, all [lat, lon], on a flat local projection (fine at these distances). */
function segDistM(p, a, b) {
  const k = 111320, kx = k * Math.cos((p[0] * Math.PI) / 180);
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * k, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * k;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  const x = ax + t * dx, y = ay + t * dy;
  return Math.sqrt(x * x + y * y);
}
/** The incident on this leg's route, or null: major ones first, then the nearest. path is [[lat, lon], ...]. */
function hazardOnPath(path, hazards, nearM = HAZ_NEAR_M) {
  if (!Array.isArray(path) || path.length < 2 || !hazards || !hazards.length) return null;
  let s = 90, n = -90, w = 180, e = -180;
  for (const [la, lo] of path) { if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo; }
  const pad = 0.002;
  let best = null;
  for (const h of hazards) {
    if (h.lat < s - pad || h.lat > n + pad || h.lon < w - pad || h.lon > e + pad) continue;
    let d = Infinity;
    for (let i = 1; i < path.length && d > nearM; i++) d = Math.min(d, segDistM([h.lat, h.lon], path[i - 1], path[i]));
    if (d > nearM) continue;
    if (!best || (h.major && !best.h.major) || (h.major === best.h.major && d < best.d)) best = { h, d };
  }
  return best ? best.h : null;
}
const TRAFFIC_MODES = new Set(["bus", "coach"]);
// Long running road notices (a 4WD only track, conditions changed months ago) are not why a bus is late today.
const HAZ_FRESH_MS = 12 * 3600000;
function hazardRelevant(h, now = Date.now()) {
  if (!h || /4wd/i.test(h.kind)) return false;
  const u = Number(h.updated);
  return h.major || !Number.isFinite(u) || now - u < HAZ_FRESH_MS;
}
/** Adds traffic: { text, kind, id } to bus and coach legs of trip answers that have an incident on their route. */
async function addTraffic(env, d, hazardsFn = trafficHazards) {
  const legs = ((d && d.journeys) || []).flatMap((j) => j.legs || []).filter((l) => l.kind === "transit" && TRAFFIC_MODES.has(l.mode) && Array.isArray(l.path) && l.path.length > 1);
  if (!legs.length) return d;
  const now = Date.now();
  const hz = (await hazardsFn(env)).filter((h) => hazardRelevant(h, now));
  for (const l of legs) {
    const h = hazardOnPath(l.path, hz);
    if (h) l.traffic = { id: h.id, kind: h.kind, text: h.text, major: h.major };
  }
  return d;
}

// Long distance plans (Central to Albury or Dubbo) can take the Trip Planner up to about 30 s. The app asks
// with long=1 for those; the answer is kept for LONG_TRIP_CACHE_S so the next refresh is instant.
const LONG_TRIP_TIMEOUT_MS = 35000;
const LONG_TRIP_CACHE_S = 120;
function longTripCacheKey(p) {
  const keep = ["from", "to", "time", "date", "modes", "arriveBy", "count", "acc", "fare"];
  const u = new URL("https://cache.internal/long-trip");
  for (const k of keep) { const v = p.get(k); if (v) u.searchParams.set(k, v); }
  return u.toString();
}

// Mode chips on the trip screen (modes=bus,train): which planner product classes to keep, the rest left out
// with excludedMeans=checkbox and exclMOT_n (Trip Planner manual), then every journey checked again here.
const TRIP_MODE_CLASSES = { train: [1], metro: [2], lightrail: [4], bus: [5, 7, 11], coach: [7], ferry: [9] };
function tripModesParse(raw) {
  const out = [];
  for (const m of String(raw || "").toLowerCase().split(",").map((x) => x.trim())) if (own(TRIP_MODE_CLASSES, m) && !out.includes(m)) out.push(m);
  return out.sort();
}
function tripModesExclude(modes) {
  if (!modes.length) return null;
  const keep = new Set(modes.flatMap((m) => TRIP_MODE_CLASSES[m]));
  const ex = { excludedMeans: "checkbox" };
  for (const c of [1, 2, 4, 5, 7, 9, 11]) if (!keep.has(c)) ex["exclMOT_" + c] = "1";
  return ex;
}
function tripModesKeep(journeys, modes) {
  if (!modes.length) return journeys;
  const ok = new Set(modes.flatMap((m) => (m === "bus" ? ["bus", "coach"] : [m])));
  return (journeys || []).filter((j) => {
    const tl = (j.legs || []).filter((l) => l.kind === "transit");
    return tl.length > 0 && tl.every((l) => ok.has(l.mode));
  });
}
// A day for the planner: YYYYMMDD from today to 14 days ahead (Sydney), else null.
function tripDate(raw, now = Date.now()) {
  const v = String(raw || "");
  if (!/^\d{8}$/.test(v)) return null;
  const today = sydneyParts(new Date(now)).date, last = sydneyParts(new Date(now + 14 * 86400000)).date;
  return v >= today && v <= last ? v : null;
}

// ---------- trip pages (the trip list's endless scroll) ----------
// GET /api/trip?page=1 answers a page of up to TRIP_PAGE_N trips (as many as one Trip Planner call gives, 10), and
// after=<ms> or before=<ms> (with arr=<ms>, the earliest arrival the phone has) ask for the next page later or
// earlier. One planner call per page. Each planner answer (the timetable part: the trips and their legs) is kept and
// shared by every phone for TRIP_WIN_KEEP_S per pair, day, minute and options (tripWinKey); the live part is never
// kept longer than the 15 s live rule: an answer older than that has the planner's live times taken off and the
// feeds' current ones put back (tripLegUnlive, enrich), and the whole page answer goes through the usual 15 s edge
// copy. Nothing is written to D1 or KV for a page.
// The live Trip Planner gives at most 10 trips a call: asked for 8 or 10 it gave 8 or 10, asked for 12, 14 or 20 it
// gave its default 4 or 5 (27 Oct 2026, 2 AM, Parramatta to Central). So a page is 10 trips, one call.
const TRIP_PAGE_N = 10;
const TRIP_WIN_KEEP_S = 600;
const TRIP_WIN_LIVE_MS = FEED_TTL_MS;
// Pages reach 7 days back and 14 days ahead of now (the planner's own range for a chosen day).
const TRIP_PAGE_BACK_MS = 7 * 86400000;
const TRIP_PAGE_AHEAD_MS = 14 * 86400000;
const tripWinMem = new Map(); // key -> { at, text }
const TRIP_WIN_MEM_MAX = 80;
function tripWinKey(fromId, toId, date, time, o) {
  const u = new URL("https://cache.internal/trip-win");
  const v = { f: fromId, t: toId, d: date, h: time, a: o.arriveBy ? "1" : "", n: String(o.count || 5), acc: o.accessible ? "1" : "", x: o.exclude ? JSON.stringify(o.exclude) : "", l: o.long ? "1" : "" };
  for (const k of Object.keys(v)) if (v[k]) u.searchParams.set(k, v[k]);
  return u.toString();
}
async function tripWinGet(key) {
  const m = tripWinMem.get(key);
  if (m && Date.now() - m.at <= TRIP_WIN_KEEP_S * 1000) { budget.tripWinHits = (budget.tripWinHits || 0) + 1; return { at: m.at, journeys: JSON.parse(m.text) }; }
  if (m) tripWinMem.delete(key);
  try {
    const edge = typeof caches !== "undefined" && caches.default ? caches.default : null;
    const hit = edge ? await edge.match(new Request(key)) : null;
    if (!hit) return null;
    const at = Number(hit.headers.get("x-stored-at")) || 0;
    if (!at || Date.now() - at > TRIP_WIN_KEEP_S * 1000) return null;
    const text = await hit.text();
    tripWinRemember(key, at, text);
    budget.tripWinHits = (budget.tripWinHits || 0) + 1;
    return { at, journeys: JSON.parse(text) };
  } catch (e) { return null; }
}
function tripWinRemember(key, at, text) {
  if (text.length > 1024 * 1024) return;
  tripWinMem.delete(key);
  tripWinMem.set(key, { at, text });
  while (tripWinMem.size > TRIP_WIN_MEM_MAX) tripWinMem.delete(tripWinMem.keys().next().value);
}
function tripWinPut(key, journeys) {
  const at = Date.now(), text = JSON.stringify(journeys);
  tripWinRemember(key, at, text);
  budget.tripWinPuts = (budget.tripWinPuts || 0) + 1;
  try {
    const edge = typeof caches !== "undefined" && caches.default ? caches.default : null;
    if (!edge) return;
    const put = edge.put(new Request(key), new Response(text, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${TRIP_WIN_KEEP_S}`, "x-stored-at": String(at) } })).catch(() => null);
    reqKeep(put);
  } catch (e) { /* the memory copy stands */ }
}
// A kept leg back to its timetable part (the feeds add the live part again).
function tripLegUnlive(l) {
  l.estimated = null; l.arrEstimated = null; l.realtime = false; l.delayMin = null; l.occupancy = null;
  delete l.source; delete l.vehicle; delete l.stopsAway; delete l.ahead;
}
const floorMin = (t) => Math.floor(t / 60000) * 60000;
// When a journey's first service leaves by the timetable (the page cursors are timetable times, so a late service
// does not move a page's edge), and when it gets there.
function tripPlannedDep(j) {
  const l = (j.legs || []).find((x) => x.kind === "transit");
  return ms((l && l.planned) || j.board || j.leave);
}
function tripPlannedArr(j) {
  const tl = (j.legs || []).filter((x) => x.kind === "transit");
  const l = tl[tl.length - 1];
  return ms((l && l.arrPlanned) || j.arrive);
}
/** The page query of /api/trip, or null when the request is not a page (page, after, before, arr). */
function tripPageQuery(p, now = Date.now()) {
  if (p.get("page") !== "1") return null;
  const num = (k) => { const v = p.get(k); return v && /^\d{13}$/.test(v) ? Number(v) : null; };
  const lo = now - TRIP_PAGE_BACK_MS, hi = now + TRIP_PAGE_AHEAD_MS;
  const inRange = (t) => (t != null && t >= lo && t <= hi ? t : null);
  // n: trips asked of the planner for this page (4 to 20, else TRIP_PAGE_N), for checking what the planner gives.
  const n = /^\d{1,2}$/.test(p.get("n") || "") && +p.get("n") >= 4 && +p.get("n") <= 20 ? +p.get("n") : null;
  return { after: inRange(num("after")), before: inRange(num("before")), arr: inRange(num("arr")), n };
}
// One page: later (after: trips leaving at or after it), earlier (before and arr: the trips that get there by the
// earliest arrival the phone has, so the page ends right where the list starts, with no gap and no guess of how
// often the service runs), or the first page (the chosen time, or now from the start of the 5 minutes so phones
// opening the same pair in the same 5 minutes share one planner answer).
async function tripPage(env, fromId, toId, q, base) {
  const now = Date.now();
  const N = q.n || TRIP_PAGE_N;
  const at = (t, arriveBy) => { const s = sydneyParts(new Date(t)); return trip(env, fromId, toId, { ...base, date: s.date, time: s.time, arriveBy, count: N, win: true }); };
  let r, dir;
  if (q.after != null) {
    dir = "later";
    r = await at(floorMin(q.after), false);
    r.journeys = r.journeys.filter((j) => tripPlannedDep(j) >= q.after);
  } else if (q.before != null) {
    dir = "earlier";
    r = await at(floorMin(q.arr != null ? q.arr : q.before), true);
    r.journeys = r.journeys.filter((j) => tripPlannedDep(j) < q.before);
    // Nothing that leaves earlier among the trips that get there first (a faster trip leaving later): the trips that
    // get there by the cursor itself leave before it, so ask once more for those.
    if (!r.journeys.length && q.arr != null && q.arr > q.before) {
      r = await at(floorMin(q.before), true);
      r.journeys = r.journeys.filter((j) => tripPlannedDep(j) < q.before);
    }
  } else {
    dir = "first";
    const chosen = base.time || base.date;
    if (chosen) r = await trip(env, fromId, toId, { ...base, count: N, win: true });
    else {
      r = await at(Math.floor(now / 300000) * 300000, false);
      r.journeys = r.journeys.filter((j) => ms(j.board) >= now - 60000);
    }
  }
  r.journeys.sort((a, b) => tripPlannedDep(a) - tripPlannedDep(b));
  const deps = r.journeys.map(tripPlannedDep).filter(Number.isFinite);
  const arrs = r.journeys.map(tripPlannedArr).filter(Number.isFinite);
  r.page = {
    dir, n: N,
    // The next page later starts at this page's last departure (the same minute again, trips seen twice are the same
    // trip ids); the next page earlier ends before this page's first departure and arrival.
    next: deps.length ? Math.max(...deps) : null,
    prev: deps.length ? Math.min(...deps) : null,
    prevArr: arrs.length ? Math.min(...arrs) : null,
    // No more trips that way: an earlier page that found nothing before the cursor, or a later one with nothing new.
    end: !r.journeys.length,
  };
  return r;
}

// The planner's journeys as our legs (before any live times from the feeds are added).
function tripLegsOf(data) {
  const journeys = [];
  for (const j of data.journeys || []) {
    const legs = (j.legs || []).map((lg) => {
      const t = lg.transportation || {};
      const cls = t.product ? t.product.class : null;
      const o = lg.origin || {}, d = lg.destination || {};
      const kind = legKind(t);
      const line = t.disassembledName || t.number || "";
      const oEst = o.departureTimeEstimated && lg.isRealtimeControlled ? o.departureTimeEstimated : null;
      const dEst = d.arrivalTimeEstimated && lg.isRealtimeControlled ? d.arrivalTimeEstimated : null;
      return {
        kind,
        mode: kind === "walk" ? "walk" : modeOf(cls).key,
        modeName: kind === "walk" ? "Walk" : modeOf(cls).name,
        line, color: kind === "walk" ? "#646974" : lineColor(line, cls),
        towards: (t.destination && t.destination.name) || "",
        destId: (t.destination && t.destination.id) || null,
        tripId: (t.properties && (t.properties.RealtimeTripId || t.properties.AVMSTripID)) || null,
        ...(kind !== "walk" && feedHint(cls, t) ? { feed: feedHint(cls, t) } : {}),
        ...(kind !== "walk" ? onDemandOf(t) : {}),
        stopId: o.id || null, toStopId: d.id || null, fromParent: (o.parent && o.parent.id) || null, toParent: (d.parent && d.parent.id) || null,
        from: stopName(o), fromPlatform: platformLabel(o.properties, cls),
        to: stopName(d), toPlatform: platformLabel(d.properties, cls),
        planned: iso(o.departureTimePlanned), estimated: oEst ? iso(oEst) : null,
        arrPlanned: iso(d.arrivalTimePlanned), arrEstimated: dEst ? iso(dEst) : null,
        realtime: !!oEst,
        delayMin: oEst ? Math.round((ms(oEst) - ms(o.departureTimePlanned)) / 60000) : null,
        durationMin: Math.round((lg.duration || 0) / 60),
        stops: Math.max(0, (lg.stopSequence || []).length - 1),
        cancelled: !!lg.isCancelled,
        occupancy: OCC_EFA[(o.properties && o.properties.occupancy) || ""] || null,
        platformChangedFrom: platformChange(o.properties, cls),
        alerts: (lg.infos || []).map((i) => ({ title: plainText(i.subtitle || ""), url: httpsUrl(i.url), priority: i.priority || "" })).filter((a) => a.title).slice(0, 3),
        path: (lg.coords || []).map((c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5]),
      };
    });
    if (legs.length) journeys.push(legs);
  }
  return journeys;
}

async function trip(env, fromId, toId, opts = {}) {
  let { date, time } = sydneyParts();
  let tomorrow = false;
  if (opts.date) {
    // A chosen day (trip screen time picker): that day at the given time, or from midnight.
    date = opts.date;
    time = opts.time || "0000";
  } else if (opts.time) {
    const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2));
    if (toMin(opts.time) < toMin(time) - 30) { date = sydneyParts(new Date(Date.now() + 86400000)).date; tomorrow = true; }
    time = opts.time;
  }
  const tpCall = () => tp(env, "trip", {
    depArrMacro: opts.arriveBy ? "arr" : "dep", itdDate: date, itdTime: time,
    type_origin: opts.fromType || (isCoordId(fromId) ? "coord" : "any"), name_origin: fromId,
    type_destination: opts.toType || (isCoordId(toId) ? "coord" : "any"), name_destination: toId,
    calcNumberOfTrips: String(opts.count || 5), TfNSWTR: "true",
    ...(opts.via ? { type_via: opts.viaType || "any", name_via: opts.via } : {}),
    // Step free trips only (Settings > Accessible trips): the Trip Planner's wheelchair option.
    ...(opts.accessible ? { wheelchair: "on" } : {}),
    // Plan B: leave out the means of transport that is disrupted (exclMOT_n, Trip Planner manual).
    ...(opts.exclude || {}),
  }, opts.long ? LONG_TRIP_TIMEOUT_MS : 12000);
  let data;
  // Our own planner (raptor.js, OWN_PLANNER): answered from our timetable, so no Transport for NSW call; the legs go
  // through the same live times below. No answer (another day, a stop it does not know) asks the Trip Planner as before.
  const own = typeof ownPlannerWanted === "function" && ownPlannerWanted(env, opts)
    ? await ownTripLegs(env, fromId, toId, { date, time, arriveBy: !!opts.arriveBy, count: opts.count || 5 }).catch(() => null) : null;
  // Trip pages (opts.win): the planner's answer for this pair, time and options is kept and shared (tripWinGet).
  const win = opts.win && !own ? tripWinKey(fromId, toId, date, time, opts) : null;
  const kept = win ? await tripWinGet(win) : null;
  if (own || kept) data = { journeys: [] };
  else try { data = await tpCall(); }
  catch (e) {
    // Outage fallback (ttplan.js): the Trip Planner refused, failed or timed out, so trips from our own timetable,
    // labelled. Background checks (push alerts, morning check, rescue) pass timetable: false and keep the error.
    if (opts.timetable === false || opts.accessible || typeof timetableTrip !== "function" || !ttUpstreamDown(e)) throw e;
    const tt = await timetableTrip(env, fromId, toId, { date, time: opts.time || opts.date ? time : null, arriveBy: !!opts.arriveBy, count: opts.count || 5, accessible: !!opts.accessible, exclude: opts.exclude }).catch(() => null)
      // Our own planner's timetable (raptor.js) where the board engine's has none: a trip to a service's last stop (the
      // engine keeps no row for it), more than one change, a walk between nearby stops, or a point to start from.
      || (typeof ownTimetableTrip === "function" ? await ownTimetableTrip(env, fromId, toId, { date, time, arriveBy: !!opts.arriveBy, count: opts.count || 5, exclude: opts.exclude }).catch(() => null) : null);
    if (tt) return { ...tt, tomorrow };
    throw Object.assign(e, { tripsUnavailable: true });
  }
  let journeys = kept ? kept.journeys : tripLegsOf(data);
  if (win && !own && !kept && journeys.length) tripWinPut(win, journeys);
  // A kept window older than the live rule (15 s) keeps its timetable part only: the planner's own live times and
  // occupancy are taken off, and the feeds below put the current ones back.
  if (kept && Date.now() - kept.at > TRIP_WIN_LIVE_MS) for (const legs of journeys) for (const l of legs) if (l.kind === "transit") tripLegUnlive(l);
  if (own) journeys = journeys.concat(own);
  const transitLegs = journeys.flat().filter((l) => l.kind === "transit");
  // A train or metro's stop id for its destination, from the destination's own name (railDestId).
  if (transitLegs.some((l) => l.mode === "train" || l.mode === "metro")) {
    const dmap = await railDestMap(env);
    for (const l of transitLegs) l.destId = railDestId(dmap, l.mode, l.towards, l.destId);
  }
  const rt = await realtimeFor(env, transitLegs.map((l) => [l.mode, l.line, l.feed]));
  const out = [];
  for (const legs of journeys) {
    for (const l of legs) {
      if (l.kind !== "transit") continue;
      enrich(l, rt);
      // Arrival from the feed when the planner has none.
      if (!l.arrEstimated) {
        const tu = rt.tu(l.mode, l.line, l.tripId, l.feed);
        const fa = feedAtStop(tu, l.toStopId);
        if (fa && fa.est) l.arrEstimated = iso(fa.est);
        else if (l.realtime && l.delayMin) l.arrEstimated = iso(ms(l.arrPlanned) + l.delayMin * 60000);
      }
      l.status = statusOf(l);
    }
    // Walk legs shift with the live time of the leg they connect to.
    const dep = (l) => ms(l.estimated || l.planned);
    const arr = (l) => ms(l.arrEstimated || l.arrPlanned);
    const tl = legs.filter((l) => l.kind === "transit");
    for (let i = 0; i < tl.length - 1; i++) {
      const a = tl[i], b = tl[i + 1];
      const between = legs.slice(legs.indexOf(a) + 1, legs.indexOf(b));
      const walk = between.filter((x) => x.kind === "walk").reduce((s, x) => s + x.durationMin, 0);
      const gap = Math.round((dep(b) - arr(a)) / 60000);
      b.transfer = { minutes: gap, walkMin: walk, spare: gap - walk, at: a.to, risk: gap - walk < 0 ? "miss" : gap - walk < 2 ? "tight" : "ok" };
    }
    const first = legs[0], last = legs[legs.length - 1];
    const firstTransit = tl[0] || null;
    const lastTransit = tl[tl.length - 1] || null;
    const walkBefore = firstTransit ? legs.slice(0, legs.indexOf(firstTransit)).reduce((s, x) => s + x.durationMin, 0) : 0;
    const walkAfter = lastTransit ? legs.slice(legs.indexOf(lastTransit) + 1).reduce((s, x) => s + x.durationMin, 0) : 0;
    const boardAt = firstTransit ? dep(firstTransit) : ms(first.planned);
    const arriveAt = lastTransit ? arr(lastTransit) + walkAfter * 60000 : ms(last.arrPlanned);
    const leaveAt = boardAt - walkBefore * 60000;
    out.push({
      leave: iso(leaveAt), board: iso(boardAt), arrive: iso(arriveAt),
      durationMin: Math.round((arriveAt - leaveAt) / 60000),
      changes: Math.max(0, tl.length - 1),
      live: !!(firstTransit && firstTransit.realtime),
      anyCancelled: tl.some((l) => l.cancelled),
      risk: tl.some((l) => l.transfer && l.transfer.risk === "miss") ? "miss" : tl.some((l) => l.transfer && l.transfer.risk === "tight") ? "tight" : "ok",
      legs,
      fares: faresAll(legs),
    });
  }
  const now = Date.now();
  const list = out.filter((j) => ms(j.board) >= now - 60000 || opts.time);
  for (const j of list) j.beaten = list.some((o) => o !== j && ms(o.leave) > ms(j.leave) && ms(o.arrive) < ms(j.arrive));
  return { journeys: list, tomorrow, live: { feedAt: rt.fetchedAt() }, now };
}

// ---- opal fares start
// Opal fare estimates, worked out from the published fare tables because our Trip Planner key
// returns no fare tickets (journeys[].fare.tickets is empty). Fares read 24 Oct 2026 from
// transportnsw.info (adult, concession, caps, peak times, airport fee pages) and the Opal Fares open
// data (fare values from 29 June 2026). Child or Youth and Gold Senior or Pensioner pay the
// concession per trip fares; Gold is capped at $2.50 a day. Distance: train, metro and ferry along
// the route, bus and light rail in a straight line between where you board and get off. Always an
// estimate, never your card's charge.
const FARE_TYPES = { adult: "Adult", child: "Child or Youth", concession: "Concession", gold: "Gold Senior or Pensioner" };
// [up to km, adult peak, adult off peak, concession peak, concession off peak]
const FARE_BANDS = {
  rail: [[10, 4.33, 3.03, 2.16, 1.51], [20, 5.38, 3.76, 2.69, 1.88], [35, 6.20, 4.34, 3.10, 2.17], [65, 8.28, 5.79, 4.14, 2.89], [Infinity, 10.66, 7.46, 5.33, 3.73]],
  bus: [[3, 3.30, 2.31, 1.65, 1.15], [8, 4.49, 3.14, 2.24, 1.56], [Infinity, 5.77, 4.03, 2.88, 2.01]],
  ferry: [[9, 7.35, 7.35, 3.67, 3.67], [Infinity, 9.20, 9.20, 4.60, 4.60]],
};
// [daily cap Mon to Thu, daily cap Fri to Sun and public holidays, weekly cap]
const FARE_CAPS = { adult: [19.30, 9.65, 50], child: [9.65, 4.80, 25], concession: [9.65, 4.80, 25], gold: [2.50, 2.50, 17.50] };
const FARE_TRANSFER_OFF = { adult: 2, child: 1, concession: 1, gold: 1 };
const FARE_AIRPORT = { adult: 18.61, child: 16.64, concession: 16.64, gold: 16.64 };
// NSW public holidays that fall Monday to Thursday (the only days with peak fares).
const FARE_HOLIDAYS = new Set(["20261228", "20270126", "20270329", "20270614", "20271004"]);
const fareFamily = (mode) => (mode === "train" || mode === "metro" ? "rail" : mode === "bus" ? "bus" : mode === "lightrail" ? "lr" : mode === "ferry" ? "ferry" : null);
const round2 = (x) => Math.round(x * 100) / 100;
function farePeak(t, family) {
  if (family === "ferry") return false;
  const s = sydneyNow(new Date(t));
  if (s.dow > 4 || FARE_HOLIDAYS.has(s.day)) return false;
  return (s.tod >= 390 && s.tod < 600) || (s.tod >= 900 && s.tod < 1140);
}
// fareOf runs once per fare type (and again for the off peak price), so the distance along a
// leg's path, the costly part, is worked out once per leg and family.
const fareKmMemo = new WeakMap();
function fareKm(l, family) {
  if (!l || typeof l !== "object") return fareKmRaw(l, family);
  const hit = fareKmMemo.get(l);
  if (hit && hit.path === l.path && hit.km0 === l.km && hit.family === family) return hit.v;
  const v = fareKmRaw(l, family);
  fareKmMemo.set(l, { path: l.path, km0: l.km, family, v });
  return v;
}
function fareKmRaw(l, family) {
  const p = l.path || [];
  if (p.length < 2) return l.km != null ? l.km : null;
  if (family === "bus" || family === "lr") return distM(p[0][0], p[0][1], p[p.length - 1][0], p[p.length - 1][1]) / 1000;
  let m = 0;
  for (let i = 1; i < p.length; i++) m += distM(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
  return m / 1000;
}
function fareBand(family, km, type, peak) {
  const bands = FARE_BANDS[family === "lr" ? "bus" : family];
  const b = bands.find((x) => km <= x[0]) || bands[bands.length - 1];
  const conc = type !== "adult";
  return conc ? (peak ? b[3] : b[4]) : (peak ? b[1] : b[2]);
}
const AIRPORT_RE = /\b(domestic|international) airport\b/i;
// Domestic Airport Station is 202020 and International 202030; their platforms are 2020[23]1 to 9.
const isAirport = (name, id) => AIRPORT_RE.test(String(name || "")) || /^2020[23]\d$/.test(String(id || ""));
function fareAirport(group, type) {
  const ends = [[group.from, group.fromId], [group.to, group.toId]];
  const air = ends.filter((e) => isAirport(e[0], e[1])).length;
  if (!air) return 0;
  if (air === 2) return 5.20;
  const other = (ends.find((e) => !isAirport(e[0], e[1])) || [])[0] || "";
  if (/\bmascot\b/i.test(other)) return 10.34;
  if (/\bgreen square\b/i.test(other)) return 12.74;
  return FARE_AIRPORT[type];
}
// One fare type for one journey's legs.
function fareOf(legs, type = "adult", forcePeak = null) {
  if (!FARE_TYPES[type]) type = "adult";
  const tl = (legs || []).filter((l) => l.kind === "transit");
  if (!tl.length) return null;
  const groups = [];
  const perLeg = [];
  for (const l of tl) {
    // NSW TrainLink regional trains and coaches are booked fares, not Opal.
    const fam = l.feed === "nswtrains" ? null : fareFamily(l.mode);
    const dep = ms(l.estimated || l.planned), arr = ms(l.arrEstimated || l.arrPlanned);
    const km = fam ? fareKm(l, fam) : null;
    const prev = groups[groups.length - 1];
    const gap = prev ? (dep - prev.lastArr) / 60000 : Infinity;
    if (!fam || km == null) { perLeg.push({ line: l.line, mode: l.mode, amount: null, km: null, peak: null, joined: false }); groups.push({ fam: null, lastArr: arr }); continue; }
    // Same mode within 60 minutes is one journey on the total distance; trains and metro count as one mode.
    if (prev && prev.fam === fam && gap <= 60) {
      prev.km += km; prev.lastArr = arr; prev.to = l.to; prev.toId = l.toParent || l.toStopId; prev.legs.push(perLeg.length);
      perLeg.push({ line: l.line, mode: l.mode, amount: 0, km: round2(km), peak: prev.peak, joined: true });
      continue;
    }
    const peak = forcePeak != null ? (forcePeak && fam !== "ferry") : farePeak(dep, fam);
    groups.push({ fam, km, peak, first: dep, lastArr: arr, from: l.from, to: l.to, fromId: l.fromParent || l.stopId, toId: l.toParent || l.toStopId, legs: [perLeg.length], transfer: prev && prev.fam && gap <= 60 });
    perLeg.push({ line: l.line, mode: l.mode, amount: 0, km: round2(km), peak, joined: false });
  }
  let total = 0, transfer = 0, airportFee = 0, unknown = false, anyPeak = false;
  for (const g of groups) {
    if (!g.fam) { unknown = true; continue; }
    let f = fareBand(g.fam, g.km, type, g.peak);
    let off = 0;
    if (g.transfer) { off = Math.min(f, FARE_TRANSFER_OFF[type]); transfer += off; }
    const a = g.fam === "rail" ? fareAirport(g, type) : 0;
    airportFee += a;
    perLeg[g.legs[0]].amount = round2(f - off + a);
    perLeg[g.legs[0]].fare = round2(f); if (off) perLeg[g.legs[0]].transferOff = round2(off); if (a) perLeg[g.legs[0]].airportFee = round2(a);
    if (g.peak) anyPeak = true;
    total += f - off;
  }
  const first = ms(tl[0].estimated || tl[0].planned);
  const s = sydneyNow(new Date(first));
  const cap = FARE_CAPS[type][s.dow <= 4 && !FARE_HOLIDAYS.has(s.day) ? 0 : 1];
  const capped = total > cap;
  if (capped) total = cap;
  total = round2(total + airportFee);
  const out = { type, typeName: FARE_TYPES[type], total, peak: anyPeak, transfer: round2(transfer), airportFee: round2(airportFee), capped, unknown, legs: perLeg, estimate: true };
  if (anyPeak && forcePeak == null) {
    const offTotal = fareOf(legs, type, false).total;
    const save = round2(total - offTotal);
    if (save > 0) out.offPeak = { from: s.tod < 600 ? "10am" : "7pm", save };
  }
  return out;
}
function faresAll(legs) { const r = {}; for (const t of Object.keys(FARE_TYPES)) r[t] = fareOf(legs, t); return r; }
// Each response carries one fare type: the client's `fare` setting, Adult by default.
function fareType(p) { const t = String((p && p.get && p.get("fare")) || "adult").toLowerCase(); return FARE_TYPES[t] ? t : "adult"; }
function pickFares(o, type, depth = 0) {
  if (!o || typeof o !== "object" || depth > 4) return o;
  if (Array.isArray(o)) { for (const x of o) pickFares(x, type, depth + 1); return o; }
  if (o.fares && typeof o.fares === "object" && !Array.isArray(o.fares)) { o.fare = o.fares[type] || o.fares.adult || null; delete o.fares; }
  for (const k of ["journeys", "cards", "before", "last", "after"]) if (o[k]) pickFares(o[k], type, depth + 1);
  return o;
}
const money = (x) => "$" + Number(x).toFixed(2);
function fareSentence(f) {
  if (!f || f.total == null) return "";
  const bits = [`Opal fare estimate ${money(f.total)} (${f.typeName}, ${f.peak ? "peak" : "off peak"}${f.transfer ? `, ${money(f.transfer)} transfer discount` : ""}${f.airportFee ? `, includes ${money(f.airportFee)} airport station fee` : ""}${f.capped ? ", daily cap reached" : ""})`];
  if (f.offPeak) bits.push(`Off peak from ${f.offPeak.from}, save ${money(f.offPeak.save)}`);
  return bits.join(". ") + ".";
}
// ---- opal fares end

// ---------- chained trips: any number of legs ----------
// Each service on the first leg is paired with the first connection on every next leg that can be made
// after the change time. Pairing follows the timetable; live times then mark a change as tight, or as
// missed because of a delay, in which case the chain moves to the first connection still catchable.
const CHAIN_MAX_LEGS = 6;
function chainLegs(raw) {
  const out = [];
  for (const l of Array.isArray(raw) ? raw.slice(0, CHAIN_MAX_LEGS) : []) {
    if (!l || !l.f || !l.t) return null;
    const m = ["train", "metro", "bus", "ferry", "lightrail", "walk"].includes(l.m) ? l.m : "";
    out.push({ f: String(l.f).slice(0, 40), fn: String(l.fn || l.f).slice(0, 80), t: String(l.t).slice(0, 40), tn: String(l.tn || l.t).slice(0, 80), m,
      c: Math.max(0, Math.min(60, Number(l.c == null ? 5 : l.c) || 0)), a: l.a ? 1 : 0, w: Math.max(1, Math.min(90, Number(l.w == null ? 5 : l.w) || 5)) });
  }
  return out.length && out[0].m !== "walk" ? out : null;
}
function chainTimes(j) {
  const legs = j.legs || [];
  const tl = legs.filter((l) => l.kind === "transit");
  const f = tl[0], z = tl[tl.length - 1];
  if (!f) return { pLeave: ms(j.leave), pArr: ms(j.arrive), leave: ms(j.leave), arr: ms(j.arrive), cancelled: false };
  const wb = ms(j.board) - ms(j.leave);
  const wa = ms(j.arrive) - ms(z.arrEstimated || z.arrPlanned);
  return { pLeave: ms(f.planned) - wb, pArr: ms(z.arrPlanned) + wa, leave: ms(j.leave), arr: ms(j.arrive), cancelled: tl.some((x) => x.cancelled) };
}
// Direct services only (one service for the leg), on the leg's own mode, unless the leg or the trip allows all.
function chainFilter(js, leg, all) {
  if (all || leg.a) return { list: js, fallback: false };
  const tc = (j) => j.legs.filter((l) => l.kind === "transit");
  let d = js.filter((j) => tc(j).length === 1);
  if (leg.m && d.length) {
    const mm = d.filter((j) => tc(j).every((l) => l.mode === leg.m || (leg.m === "bus" && l.mode === "coach")));
    if (mm.length) d = mm;
  }
  return d.length ? { list: d, fallback: false } : { list: js, fallback: js.length > 0 };
}
async function chainLegJourneys(env, leg, fromMs, untilMs) {
  const seen = new Set(), out = [];
  let t = fromMs;
  for (let page = 0; page < 3; page++) {
    const r = await trip(env, leg.f, leg.t, { time: sydneyParts(new Date(t)).time, count: 8, accessible: !!leg.acc });
    const js = r.journeys || [];
    for (const j of js) {
      const k = j.legs.map((l) => `${l.tripId || l.line}@${l.planned}`).join("|");
      if (!seen.has(k)) { seen.add(k); out.push(j); }
    }
    if (!js.length) break;
    const last = Math.max(...js.map((j) => ms(j.leave)));
    if (last >= untilMs || last + 60000 <= t) break;
    t = last + 60000;
  }
  return out;
}
async function planChain(env, legs, opts = {}) {
  const all = !!opts.all;
  if (opts.accessible) legs = legs.map((l) => ({ ...l, acc: true }));
  const L0 = legs[0];
  const r0 = await trip(env, L0.f, L0.t, { time: opts.time || null, count: opts.count || 5, accessible: !!opts.accessible });
  const f0 = chainFilter(r0.journeys || [], L0, all);
  const fallback = [f0.fallback];
  let chains = f0.list.map((j) => ({ legs: j.legs.map((l) => ({ ...l, seg: 0 })), t: chainTimes(j), lens: [Math.max(1, j.legs.filter((l) => l.kind === "transit").length)] }));
  for (let k = 1; k < legs.length && chains.length; k++) {
    const L = legs[k];
    const at = shortName(L.fn);
    if (L.m === "walk") {
      const w = L.w * 60000;
      for (const c of chains) {
        c.legs.push({ kind: "walk", mode: "walk", modeName: "Walk", line: "", color: "#646974", towards: "", from: shortName(L.fn), to: shortName(L.tn), stopId: L.f, toStopId: L.t,
          planned: iso(c.t.pArr), arrPlanned: iso(c.t.pArr + w), estimated: iso(c.t.arr), arrEstimated: iso(c.t.arr + w), durationMin: L.w, stops: 0, seg: k, chainWalk: true, alerts: [] });
        c.t = { ...c.t, pArr: c.t.pArr + w, arr: c.t.arr + w };
        c.lens.push(0);
      }
      fallback.push(false);
      continue;
    }
    const conn = L.c * 60000;
    const lo = Math.min(...chains.map((c) => Math.min(c.t.arr, c.t.pArr))) + conn;
    const hi = Math.max(...chains.map((c) => Math.max(c.t.arr, c.t.pArr))) + conn;
    const raw = await chainLegJourneys(env, L, lo, hi);
    const fk = chainFilter(raw, L, all);
    fallback.push(fk.fallback);
    const live = fk.list.map((j) => ({ j, t: chainTimes(j) })).filter((o) => !o.t.cancelled).sort((a, b) => a.t.leave - b.t.leave);
    const plan = [...live].sort((a, b) => a.t.pLeave - b.t.pLeave);
    const next = [];
    for (const c of chains) {
      const P = plan.find((o) => o.t.pLeave >= c.t.pArr + conn);
      let pick = P, risk = "ok", missed = null;
      if (P) {
        const g = P.t.leave - c.t.arr;
        if (g < 0) { missed = P; risk = "miss"; pick = live.find((o) => o.t.leave >= c.t.arr + conn); }
        else if (g < conn) risk = "tight";
      } else pick = live.find((o) => o.t.leave >= c.t.arr + conn);
      if (!pick) continue;
      const nl = pick.j.legs.map((l) => ({ ...l, seg: k }));
      const ft = nl.find((l) => l.kind === "transit");
      const gap = Math.round((pick.t.leave - c.t.arr) / 60000);
      if (ft) {
        const mt = missed && missed.j.legs.find((l) => l.kind === "transit");
        ft.transfer = { minutes: gap, conn: L.c, spare: gap - L.c, at, risk, chain: true, walkMin: Math.round((ms(pick.j.board) - ms(pick.j.leave)) / 60000),
          missed: mt ? { line: mt.line, planned: mt.planned, estimated: mt.estimated } : null };
      }
      next.push({ legs: [...c.legs, ...nl], t: { ...c.t, pArr: pick.t.pArr, arr: pick.t.arr }, lens: [...c.lens, Math.max(1, nl.filter((l) => l.kind === "transit").length)] });
    }
    chains = next;
  }
  const out = chains.map((c) => {
    const tl = c.legs.filter((l) => l.kind === "transit");
    const first = tl[0] || null;
    const trs = tl.map((l) => l.transfer).filter(Boolean);
    const risk = trs.some((x) => x.risk === "miss") ? "miss" : trs.some((x) => x.risk === "tight") ? "tight" : "ok";
    const bad = trs.find((x) => x.chain && x.risk === "miss") || trs.find((x) => x.chain && x.risk === "tight") || trs.find((x) => x.risk === "miss");
    let warn = null;
    if (bad && bad.risk === "miss" && bad.missed) warn = `Delays mean you miss the ${hm(bad.missed.planned)} ${bad.missed.line} at ${bad.at}. Next connection shown.`;
    else if (bad && bad.risk === "miss") warn = `Connection at risk at ${bad.at}`;
    else if (bad) warn = `Tight change at ${bad.at}: ${Math.max(0, bad.minutes)} min`;
    if (tl.some((l) => l.cancelled)) warn = "A service on this trip is cancelled";
    return {
      leave: iso(c.t.leave), board: first ? first.estimated || first.planned : iso(c.t.leave), arrive: iso(c.t.arr),
      durationMin: Math.round((c.t.arr - c.t.leave) / 60000), changes: Math.max(0, tl.length - 1),
      live: !!(first && first.realtime), anyCancelled: tl.some((l) => l.cancelled), risk, warn, segs: c.lens, legs: c.legs,
      fares: faresAll(c.legs),
    };
  });
  for (const j of out) j.beaten = out.some((o) => o !== j && ms(o.leave) > ms(j.leave) && ms(o.arrive) < ms(j.arrive));
  return { journeys: out, chain: true, legCount: legs.length, fallback, now: Date.now() };
}

// ---------- service view (live vehicle tracking) ----------

// The departure board names a through train's destination right ("Hornsby via Gordon") but can carry the stop id of a
// station on the way (Central's id on T1 trains that run through the city). The stop list was asked from the trip
// planner to that id, so it ended at Central, or the planner offered a faster train to Central and this one was not
// found ("Full stop list not available yet"). A train or metro destination is now taken from its own name when that
// name is one of the stations in the server's /stations lists; any other name keeps the id as sent.
const RAIL_DEST_TTL_MS = 86400000;
let railDestMem = null;
function railDestKey(name) {
  return String(name || "").split(/\s+via\s+/i)[0].replace(/\s+(station|interchange)$/i, "").trim().toLowerCase();
}
async function railDestMap(env) {
  if (railDestMem && Date.now() - railDestMem.at < (railDestMem.map.size ? RAIL_DEST_TTL_MS : 60000)) return railDestMem.map;
  const lists = await Promise.all(["train", "metro"].map((m) => askAsset(env, null, `/stations/${m}.json`)));
  const map = new Map();
  for (const list of lists) for (const row of Array.isArray(list) ? list : []) {
    const k = railDestKey(row && row[1]);
    if (k && !map.has(k)) map.set(k, String(row[0]));
  }
  railDestMem = { at: Date.now(), map };
  return map;
}
/** Whether a train or metro's list from the live feed ends before the destination station (both known as stations). */
async function feedEndsShort(env, q, mode, stops) {
  if ((mode !== "train" && mode !== "metro") || !q.stop || !q.destId || !q.planned || stops.length < 2) return false;
  const map = await railDestMap(env);
  let want = q.dest ? railDestKey(q.dest) : null;
  if (!want || !map.has(want)) { want = null; for (const [k, id] of map) if (id === String(q.destId)) { want = k; break; } }
  if (!want) return false;
  const last = stops[stops.length - 1];
  const info = await stopInfo(env, [last.id]);
  const name = info[last.id] && info[last.id].name;
  return !!name && railDestKey(String(name).split(",")[0]) !== want;
}
/** The stop id to ask the trip planner for: the station named by the destination when we know it, else the id sent. */
function railDestId(map, mode, name, id) {
  if (mode !== "train" && mode !== "metro") return id || null;
  const hit = map && map.get(railDestKey(name));
  return hit || id || null;
}

// The planner's stop list for one service. The data service answers 429 when too many questions arrive in the same
// second (several people opening boards at once), which used to leave an empty stop list. So: up to three retries a
// short wait apart, one question at a time per service in this isolate, a stop list kept for a minute (in memory and in
// the edge cache), and when the planner still cannot answer, the last stop list seen for that service in the past 20
// minutes (its planned times only).
// status: "ok", "stale" (kept list), "busy" (planner unavailable, nothing kept), "notFound" (the planner had no such run).
const PLANNER_LEG_FRESH_MS = 60000, PLANNER_LEG_KEEP_MS = 20 * 60000, PLANNER_LEG_MAX = 150;
const plannerLegMem = new Map();
const plannerLegFlight = new Map();
const pause = (n) => new Promise((r) => setTimeout(r, n));
// One run asked in parts, when one question cannot get its whole list: `ids` are stations on the run in order, each
// asked from where the last part ended, on the same run id, and the lists are joined. A part whose last stop has no
// departure time is where the run ends: the list stops there. `partial`: when a later part has no answer, the parts so
// far are returned (else null). Null when the first part has no answer for this run.
async function chainLeg(env, q, tripId, line, ids, partial) {
  if (!tripId || !ids.length) return null;
  let cur = q, seq = [], coords = [], live = true, stale = false, head = null;
  for (let i = 0; i < ids.length; i++) {
    const g = await plannerLeg(env, { ...cur, destId: ids[i] }, tripId, line);
    const sq = (g.leg && g.leg.stopSequence) || [];
    if (!g.leg || sq.length < 2) { if (i === 0 || !partial) return null; break; }
    head = head || g.leg;
    live = live && !!g.leg.isRealtimeControlled;
    stale = stale || g.stale;
    coords = coords.concat(g.leg.coords || []);
    if (!seq.length) seq = sq.slice();
    else { const joint = seq[seq.length - 1]; seq = seq.slice(0, -1).concat([{ ...sq[0], arrivalTimePlanned: joint.arrivalTimePlanned || sq[0].arrivalTimePlanned, arrivalTimeEstimated: joint.arrivalTimeEstimated || sq[0].arrivalTimeEstimated }], sq.slice(1)); }
    const last = sq[sq.length - 1];
    if (!last.departureTimePlanned || i === ids.length - 1) break;
    cur = { ...q, stop: last.id, planned: iso(last.departureTimePlanned) };
  }
  return { leg: { ...head, isRealtimeControlled: live, coords, stopSequence: seq }, status: stale ? "stale" : "ok", stale };
}
// The station a train's destination names after "via" ("Central via Strathfield": Strathfield), or null.
async function viaStationId(env, dest) {
  const m = /\bvia\s+(.+)$/i.exec(String(dest || ""));
  return m ? (await railDestMap(env)).get(railDestKey(m[1])) || null : null;
}
// A City Circle train runs into the city and round the loop, so the planner, asked from your stop to Central, ends the
// list at its first call at Central (Liverpool T2 and T3 runs on 26 Oct), and from Central to Central has no answer at
// all (City Circle trains at Central). It is asked in parts: to the station it runs via when that is named, to Circular
// Quay (on the loop whichever way it runs), then to Central. A run from the suburbs ends at Circular Quay (the train
// goes on under another run id), so the list ends there; a run that goes on is followed back to Central. Only when
// the run to Circular Quay has no answer is it asked by way of the station it runs via, and then only a whole list counts.
const isCircleName = (n) => /^city circle\b/i.test(String(n || "").trim());
async function circleLeg(env, q, tripId, line, dest) {
  const map = await railDestMap(env);
  const quay = map.get(railDestKey("Circular Quay")), central = map.get(railDestKey("Central"));
  if (!quay || !central) return null;
  const direct = await chainLeg(env, q, tripId, line, [quay, central], true);
  if (direct) return direct;
  // A faster train to Circular Quay can push this one out of the answer: asked to the station it runs via first.
  const via = await viaStationId(env, dest);
  return via && via !== quay && via !== central ? chainLeg(env, q, tripId, line, [via, quay, central], false) : null;
}
function plannerLegKey(q, tripId, line) { return [tripId || "", line || "", q.stop, q.destId, q.planned].join("|"); }
async function plannerLeg(env, q, tripId, line, opts = {}) {
  // opts.timetable: the timetable's run only (no live times), for the stops a live answer leaves out.
  const key = plannerLegKey(q, tripId, line) + (opts.timetable ? "|tt" : "");
  const now = Date.now();
  const hit = plannerLegMem.get(key);
  if (hit && hit.leg && now - hit.at < PLANNER_LEG_FRESH_MS) return { leg: hit.leg, status: "ok", stale: false };
  if (plannerLegFlight.has(key)) return joinJob(plannerLegFlight.get(key));
  const run = (async () => {
    // Other isolates in this data centre may have asked already: the edge cache holds the list for everyone.
    const shared = await edgeLegGet(env, key);
    if (shared && shared.leg && Date.now() - shared.at < PLANNER_LEG_FRESH_MS) {
      plannerLegMem.set(key, shared);
      return { leg: shared.leg, status: "ok", stale: false };
    }
    const p = sydneyParts(new Date(ms(q.planned) - 60000));
    const tries = opts.tries || 4;
    let failed = false;
    const ask = async (extra, at = p) => {
      for (let i = 0; i < tries; i++) {
        try {
          const d = await tp(env, "trip", {
            depArrMacro: "dep", itdDate: at.date, itdTime: at.time, type_origin: "any", name_origin: q.stop,
            type_destination: "any", name_destination: q.destId, calcNumberOfTrips: "6",
            // Direct services only: the run asked for is one service, and with changes allowed the planner can prefer
            // a faster pair of trains and leave this one out of its answer.
            maxChanges: "0", ...extra,
          }, 8000);
          failed = false;
          return d;
        } catch (e) {
          failed = true;
          // Only a busy or failing answer is worth a second go; a timeout already used the wait.
          if (!/answered (429|5\d\d)/.test(String(e && e.message))) return null;
          if (i < tries - 1) await pause((opts.waitMs != null ? opts.waitMs : 450) * (i + 1) + Math.floor(Math.random() * 400));
        }
      }
      return null;
    };
    // First with live times. A run the live planner leaves out (running late behind others, a faster service of
    // another mode, two trains in the same minute) is then looked for in the timetable, this mode only, six runs.
    let data = opts.timetable ? null : await ask({ TfNSWTR: "true" });
    let leg = data ? plannerPick(data, tripId, line, q.planned) : null;
    if (!leg && tripId && (data || opts.timetable)) {
      const again = await ask({ calcNumberOfTrips: "6", ...(tripModesExclude(tripModesParse(q.mode)) || {}) });
      const l2 = again ? plannerPick(again, tripId, line, q.planned) : null;
      if (l2) { data = again; leg = l2; }
    }
    // Asked a minute early, a slower train can lose out to a faster one that leaves in that minute and gets there
    // first (a T5 at Parramatta on 26 Oct); asked at its own minute, live, it is the first answer.
    if (!leg && tripId && !opts.timetable && (data || failed === false)) {
      const exact = await ask({ TfNSWTR: "true", calcNumberOfTrips: "6" }, sydneyParts(new Date(ms(q.planned))));
      const l3 = exact ? plannerPick(exact, tripId, line, q.planned) : null;
      if (l3) { data = exact; leg = l3; }
    }
    if (leg) {
      const slim = plannerSlim(leg);
      if (plannerLegMem.size >= PLANNER_LEG_MAX) plannerLegMem.delete(plannerLegMem.keys().next().value);
      const rec = { leg: slim, at: Date.now() };
      plannerLegMem.set(key, rec);
      await edgeLegPut(env, key, rec);
      return { leg, status: "ok", stale: false };
    }
    const kept = [hit, shared].filter((x) => x && x.leg && Date.now() - x.at < PLANNER_LEG_KEEP_MS).sort((a, b) => b.at - a.at)[0];
    if (kept) return { leg: kept.leg, status: "stale", stale: true };
    return { leg: null, status: failed ? "busy" : "notFound", stale: false };
  })();
  plannerLegFlight.set(key, sharedJob(run));
  try { return await run; } finally { plannerLegFlight.delete(key); }
}
// The edge cache (Cache API) shares a stop list between isolates in one data centre for up to 20 minutes; the
// record carries the time it was read, so fresh and kept lists are told apart the same way as in memory.
const edgeLegUrl = (env, key) => `https://${(env && env.API_HOST) || "api.transportsydney.app"}/__edge/planner-leg/${encodeURIComponent(key)}`;
async function edgeLegGet(env, key) {
  try {
    if (typeof caches === "undefined" || !caches.default) return null;
    const r = await caches.default.match(new Request(edgeLegUrl(env, key)));
    return r ? await r.json() : null;
  } catch (e) { return null; }
}
async function edgeLegPut(env, key, rec) {
  try {
    if (typeof caches === "undefined" || !caches.default) return;
    await caches.default.put(new Request(edgeLegUrl(env, key)),
      new Response(JSON.stringify(rec), { headers: { "content-type": "application/json", "cache-control": `max-age=${PLANNER_LEG_KEEP_MS / 1000}` } }));
  } catch (e) { /* the memory copy still works */ }
}
// Only the parts the service view reads, so a kept list stays small.
function plannerSlim(leg) {
  const t = leg.transportation || {};
  return {
    isRealtimeControlled: !!leg.isRealtimeControlled,
    coords: Array.isArray(leg.coords) ? leg.coords : [],
    transportation: { destination: { name: (t.destination && t.destination.name) || "" }, properties: { RealtimeTripId: (t.properties || {}).RealtimeTripId || null } },
    stopSequence: (leg.stopSequence || []).map((s) => ({ id: s.id, name: s.name, disassembledName: s.disassembledName, coord: s.coord,
      departureTimePlanned: s.departureTimePlanned, arrivalTimePlanned: s.arrivalTimePlanned, departureTimeEstimated: s.departureTimeEstimated, arrivalTimeEstimated: s.arrivalTimeEstimated })),
  };
}
function plannerPick(data, tripId, line, planned) {
  // With a run id, only that run: a guess by line and time can pick another train leaving in the same minute (two T1
  // trains to Hornsby leave Blacktown at the same minute from platforms 1 and 5) and show its stops under this one.
  // The guess stays for services the planner gives no id.
  const ids = tripId && (data.journeys || []).some((j) => (j.legs || []).some((lg) => { const pr = (lg.transportation || {}).properties || {}; return pr.RealtimeTripId || pr.AVMSTripID; }));
  let leg = null;
  for (const j of data.journeys || []) {
    for (const lg of j.legs || []) {
      const t = lg.transportation || {};
      const id = t.properties && (t.properties.RealtimeTripId || t.properties.AVMSTripID);
      if ((tripId && id === tripId) || (!ids && !leg && (t.disassembledName || t.number) === line && Math.abs(ms(lg.origin && lg.origin.departureTimePlanned) - ms(planned)) < 90000)) { leg = lg; break; }
    }
    if (leg && ((leg.transportation || {}).properties || {}).RealtimeTripId === tripId) break;
  }
  return leg;
}

function distM(aLat, aLon, bLat, bLon) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLon = (bLon - aLon) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function baseName(n) { return String(n || "").split(",")[0].trim().toLowerCase(); }

async function service(env, q) {
  const mode = q.mode || "bus", line = q.line || "", tripId = q.trip || null;
  const feed = q.feed && (own(FEEDS, q.feed) || own(FEED_GROUPS, q.feed)) ? q.feed : null;
  const rt = await realtimeFor(env, [[mode, line, feed]]);
  const tu = tripId ? rt.tu(mode, line, tripId, feed) : null;
  const veh = tripId ? vehicleOf(rt.vp(mode, line, tripId, feed)) : null;
  const now = Date.now();
  let stops = [], path = [], source = "feed", dest = q.dest || "", stopsStatus = "ok";
  const tuLive = !!(tu && tu.ts && tu.rel !== 3);

  if (tu && tu.stus.length >= 2 && hasTimes(tu)) {
    stops = tu.stus.map((u) => {
      const st = stuTime(u) || { t: null, delay: null };
      const live = tuLive && u.rel !== 2 && st.t != null;
      const planned = st.t != null ? st.t - (st.delay || 0) * 1000 : null;
      return { id: u.stopId, seq: u.seq, planned: iso(planned), estimated: live ? iso(st.t) : null, skipped: u.rel === 1 };
    });
  }
  // An app that sends the destination's name gets the stop list to that station (railDestId).
  if (q.dest && q.destId) q = { ...q, destId: railDestId(await railDestMap(env), mode, q.dest, q.destId) };
  // A train's live feed can list only part of the run (on 26 Oct T1 trains to Hornsby were listed to Central): when
  // its last stop is not the destination station, the planner's list is used, with the feed's live times on it.
  // Sydney Trains' feed lists only the stops it has news for (on 26 Oct an all stops South Coast train had 9 of its
  // 41 stops), so a train's stops from your stop onwards always come from the planner when it can be asked; the feed's
  // stops before yours stay, so where the train is and how many stops away still read as before.
  // The trip's whole run from our own timetable (raptor.js ownRun/rpRun), every mode: the stops of this trip and of the
  // trips that carry on the same train's run to the station its headsign names (Sydney Trains splits a run into trip
  // ids at Central), with the feed's live times laid on by stop. No Transport for NSW call. The Trip Planner's list was
  // the list of whatever service its trip search offered, so a slower train (a T5 from Parramatta to Blacktown, T9 runs
  // to Hornsby) came back as another train or not at all (26 Oct 2026). When the run continues under another
  // destination (reached false) a train keeps the old way and the run is used only if that finds nothing.
  let run = null, runList = null;
  if (tripId && q.stop && typeof ownRun === "function") {
    const r = await ownRun(env, tripId, q.stop, q.planned ? ms(q.planned) : null).catch(() => null);
    const list = r ? runStops(r, (t) => (t === tripId ? tu : rt.tu(mode, line, t, feed)), tripId, tuLive) : null;
    if (list) { run = r; runList = list; }
  }
  const useRun = !!(run && (run.reached || mode !== "train"));
  if (useRun) { stops = runList; source = "own"; }
  const feedShort = stops.length && !useRun ? (mode === "train" || await feedEndsShort(env, q, mode, stops)) : false;
  const feedStops = stops;
  let plannerFrom = -1;
  if (run && useRun) plannerFrom = run.mine;
  if ((!stops.length || feedShort) && !useRun && q.stop && q.destId && q.planned) {
    // Fall back to the trip planner for the stop list from your stop onwards; a City Circle run is asked in two halves
    // (circleLeg), named by the app or by the planner's own answer.
    let got = mode === "train" && isCircleName(q.dest) ? (await circleLeg(env, q, tripId, line, q.dest)) : null;
    if (!got || !got.leg) got = await plannerLeg(env, q, tripId, line);
    const plannerDest = got.leg && ((got.leg.transportation || {}).destination || {}).name;
    if (got.leg && mode === "train" && !isCircleName(q.dest) && isCircleName(plannerDest)) {
      const c = await circleLeg(env, q, tripId, line, plannerDest);
      if (c && c.leg) got = c;
    }
    // A slow train the planner leaves out for a faster one to the same place (a T9 to Central via Strathfield at
    // Hornsby, a T5 at Parramatta): asked again to the station it runs via, then on to its destination.
    if (!got.leg && mode === "train" && q.dest && !isCircleName(q.dest)) {
      const via = await viaStationId(env, q.dest);
      const c = via && via !== q.destId ? await chainLeg(env, q, tripId, line, [via, q.destId], false) : null;
      if (c && c.leg) got = c;
    }
    const leg = got.leg;
    if (leg || !feedStops.length) { source = "planner"; stopsStatus = got.status; stops = []; }
    if (leg) {
      const k = feedStops.findIndex((s) => s.id === q.stop);
      plannerFrom = k > 0 ? k : 0;
      stops = (k > 0 ? feedStops.slice(0, k) : []).concat((leg.stopSequence || []).map((s) => ({
        id: s.id, name: seqStopName(s), lat: s.coord ? s.coord[0] : null, lon: s.coord ? s.coord[1] : null,
        planned: iso(s.departureTimePlanned || s.arrivalTimePlanned),
        // A stop list kept from an earlier answer has its own planned times; live times come from the feed below.
        estimated: leg.isRealtimeControlled && !got.stale ? iso(s.departureTimeEstimated || s.arrivalTimeEstimated) : null,
      })));
      if (k <= 0) path = (leg.coords || []).map((c) => [c[0], c[1]]);
      // A train the feed marks as not stopping somewhere: the live planner leaves those stops out of its list (a T2 at
      // Central on 26 Oct showed 11 of its 30 stops). The timetable's list is used then, with the stops the live list
      // has kept as they are and the rest marked not stopping, so the run reads whole.
      const lost = tu && tuLive && !got.stale ? tu.stus.filter((u) => u.rel === 1 && !stops.some((st) => st.id === u.stopId)).length : 0;
      if (lost && mode === "train") {
        const tt = await plannerLeg(env, q, tripId, line, { timetable: true });
        const ttSeq = (tt.leg && tt.leg.stopSequence) || [];
        const liveById = new Map(stops.slice(k > 0 ? k : 0).map((st) => [st.id, st]));
        if (ttSeq.length > liveById.size) {
          stops = (k > 0 ? feedStops.slice(0, k) : []).concat(ttSeq.map((x) => liveById.get(x.id) || {
            id: x.id, name: seqStopName(x), lat: x.coord ? x.coord[0] : null, lon: x.coord ? x.coord[1] : null,
            planned: iso(x.departureTimePlanned || x.arrivalTimePlanned), estimated: null, skipped: true,
          }));
          if (k <= 0 && Array.isArray(tt.leg.coords) && tt.leg.coords.length) path = tt.leg.coords.map((c) => [c[0], c[1]]);
        }
      }
      // Trains publish delays without clock times; apply them to the planned times.
      if (tu && tuLive) {
        for (const st of stops) {
          const u = tu.stus.find((x) => x.stopId === st.id);
          if (u && u.rel === 1) st.skipped = true;
          if (st.estimated) continue;
          // A clock time from the feed where it has one (a list that replaced a short feed list), else its delay.
          const at = u && u.rel !== 2 && feedShort ? stuTime(u) : null;
          if (at && at.t != null) { st.estimated = iso(at.t); continue; }
          const ev = u && u.rel !== 2 && ((u.dep && u.dep.delay != null) ? u.dep : u.arr);
          if (ev && ev.delay != null && st.planned) st.estimated = iso(ms(st.planned) + ev.delay * 1000);
        }
      }
      dest = dest || (leg.transportation && leg.transportation.destination && leg.transportation.destination.name) || "";
    }
  }

  // The old way found no list for a train whose run carries on under another destination: the run to the end of
  // this trip id, from the timetable.
  if (run && !useRun && (source !== "planner" || !stops.length)) { stops = runList; source = "own"; stopsStatus = "ok"; plannerFrom = run.mine; }
  if (run && source === "own") dest = runDest(q.dest || dest || run.head, stops, plannerFrom);

  // A feed's delay carries on to later stops it does not list (GTFS realtime). Sydney Trains lists only the stops it
  // has news for, and a train's trip can end at Central and carry on to Town Hall under another trip id (the 8:46 T1
  // from Strathfield, 26 Oct 2026): without this the stop you get off at kept its timetable time while the train ran
  // late, and the trip screen moved you on to your change by the clock.
  carryDelays(stops, tuLive || stops.some((s) => s.estimated));

  const missing = stops.filter((s) => s.lat == null).map((s) => s.id);
  if (missing.length) {
    const info = await stopInfo(env, missing);
    for (const s of stops) {
      const i = info[s.id];
      if (i) { s.name = s.name || i.name; s.lat = i.lat; s.lon = i.lon; }
    }
  }
  stops = stops.filter((s) => s.lat != null);
  for (const s of stops) if (!s.name) s.name = "Stop " + s.id;

  // Where is the vehicle along the route? progress says what that rests on: the vehicle (its position or the stop the
  // feed has it at), live times (with delays carried on), or only the timetable clock. The app never moves anyone on
  // to their stop or change on the timetable clock alone.
  let nextIdx = -1, progress = "timetable";
  const vehFresh = veh && (veh.ageS == null || veh.ageS <= 180) ? veh : null;
  if (tu && tu.stus.length >= 2) {
    const ni = nextStopIndex(tu, veh, now);
    const id = ni >= 0 && tu.stus[ni] ? tu.stus[ni].stopId : null;
    if (id) {
      nextIdx = stops.findIndex((s) => s.id === id);
      const byVeh = !!veh && tu.stus.some((u) => (veh.stopSeq && u.seq === veh.stopSeq) || (veh.stopId && u.stopId === veh.stopId));
      if (nextIdx >= 0) progress = byVeh ? "vehicle" : "live";
    }
  }
  if (nextIdx < 0 && stops.some((s) => s.estimated)) {
    nextIdx = stops.findIndex((s) => !s.skipped && ms(s.estimated || s.planned) >= now - 20000);
    if (nextIdx < 0) nextIdx = stops.length;
    progress = "live";
  }
  // A fresh vehicle position wins over the clock when they disagree: a train is never ahead of where it is (on a short
  // run like Strathfield to Town Hall, 4 stops, the clock could run a whole leg ahead without ever being 3 stops off).
  if (vehFresh && stops.length >= 2) {
    const g = locateGeom(vehFresh, stops);
    if (g >= 0 && (nextIdx < 0 || g < nextIdx || g - nextIdx > 2)) { nextIdx = g; progress = "vehicle"; }
    else if (g >= 0 && g === nextIdx) progress = "vehicle";
  }
  if (nextIdx < 0) nextIdx = Math.max(0, stops.findIndex((s) => ms(s.estimated || s.planned) >= now - 20000));
  nextIdx = Math.min(nextIdx, Math.max(0, stops.length));
  stops.forEach((s, i) => { s.passed = i < nextIdx; });

  let mine = q.stop ? stops.findIndex((s) => s.id === q.stop) : -1;
  // On a run the stop asked about is the visit nearest the planned time (a loop calls at a stop twice).
  if (source === "own" && plannerFrom >= 0 && stops[plannerFrom] && (mine < 0 || stops[plannerFrom].id === q.stop)) mine = plannerFrom;
  if (mine < 0 && q.stopName) mine = stops.findIndex((s) => baseName(s.name) === baseName(q.stopName));
  // The planner's run starts where it was asked from: your stop, even when it names another platform of the station
  // (a platform change, or a City Circle run asked from Central to Central).
  if (mine < 0 && plannerFrom >= 0 && stops[plannerFrom]) mine = plannerFrom;
  if (mine >= 0) stops[mine].mine = true;
  let alight = q.to ? stops.findIndex((s) => s.id === q.to) : -1;
  if (alight >= 0) stops[alight].alight = true;

  let where = null;
  if (veh && stops.length) {
    let ni = 0, nd = Infinity;
    stops.forEach((s, i) => { const d = distM(veh.lat, veh.lon, s.lat, s.lon); if (d < nd) { nd = d; ni = i; } });
    const next = stops[nextIdx] || null;
    const prev = nextIdx > 0 ? stops[nextIdx - 1] : null;
    if (nd < 120) where = { text: `At ${stops[ni].name}`, near: stops[ni].name };
    else if (prev && next) where = { text: `Between ${prev.name} and ${next.name}`, near: next.name };
    else if (next) where = { text: `Approaching ${next.name}`, near: next.name };
    else where = { text: `Near ${stops[ni].name}`, near: stops[ni].name };
    if (next) where.next = next.name;
  }
  const mineStop = mine >= 0 ? stops[mine] : null;
  const live = mineStop ? !!mineStop.estimated : !!(stops[nextIdx] && stops[nextIdx].estimated);
  const ref = mineStop || stops[nextIdx] || null;
  const delayMin = ref && ref.estimated && ref.planned ? Math.round((ms(ref.estimated) - ms(ref.planned)) / 60000) : null;
  const stopsAway = veh && mineStop && nextIdx >= 0 && mine >= nextIdx ? mine - nextIdx : null;
  if (!path.length) path = stops.map((s) => [s.lat, s.lon]);
  let lineAlerts = [];
  if (line && /^[a-z]{0,3}\d{1,3}[a-z]?$/i.test(line)) {
    try { lineAlerts = (await alertsCached(env, line)).items.slice(0, 3).map((a) => ({ title: a.title, priority: a.priority, url: httpsUrl(a.url) })); } catch (e) { lineAlerts = []; }
  }
  return {
    alerts: lineAlerts,
    kind: "service", tripId, mode, line, color: q.color || LINE_COLORS[line] || (Object.values(MODES).find((m) => m.key === mode) || {}).color || "#495054",
    dest, live, delayMin, cancelled: !!(tu && tu.rel === 3), vehicle: veh, where,
    nextIndex: nextIdx, mineIndex: mine, alightIndex: alight, stopsAway, progress,
    mine: mineStop ? { name: mineStop.name, planned: mineStop.planned, estimated: mineStop.estimated, passed: mineStop.passed } : null,
    stops: stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, planned: s.planned, estimated: s.estimated, passed: s.passed, mine: !!s.mine, alight: !!s.alight, skipped: !!s.skipped, carried: !!s.carried })),
    path, source, stopsStatus: stops.length ? stopsStatus : tu && tu.rel === 3 ? "cancelled" : stopsStatus === "ok" ? "none" : stopsStatus, feedAt: rt.fetchedAt(), now,
  };
}

// ---------- nearby and alerts ----------

async function nearby(env, lat, lon) {
  // Our own stop list first (ttplan.js): no Transport for NSW call, so Nearby works when the key is refused.
  const own = typeof ttNearbyStops === "function" ? await ttNearbyStops(env, lat, lon).catch(() => null) : null;
  if (own) return own;
  const data = await tp(env, "coord", {
    coord: `${lon}:${lat}:EPSG:4326`, inclFilter: "1", type_1: "BUS_POINT", radius_1: "800", PoisOnMapMacro: "true",
  });
  const groups = new Map();
  for (const l of data.locations || []) {
    const parent = l.parent && l.parent.id ? l.parent : null;
    const id = parent ? parent.id : l.id;
    const dist = (l.properties && Number(l.properties.distance)) || 0;
    let name = (parent && parent.name) || l.name || "";
    if (parent && !parent.name) name = (l.name || "").replace(/, (Platform|Stand) \w+/, "");
    const g = groups.get(id);
    if (!g || dist < g.distance) groups.set(id, { id, name: shortName(name), distance: dist });
  }
  return [...groups.values()].sort((a, b) => a.distance - b.distance).slice(0, 8);
}

const alertMem = new Map();
async function alertsCached(env, q) {
  const k = (q || "").toLowerCase();
  const hit = alertMem.get(k);
  if (hit && Date.now() - hit.at < 300000) return hit.data;
  const data = await alerts(env, q);
  alertMem.set(k, { at: Date.now(), data });
  return data;
}
async function alerts(env, q) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0"), mm = String(now.getMonth() + 1).padStart(2, "0");
  const params = { filterDateValid: `${dd}-${mm}-${now.getFullYear()}`, filterPublicationStatus: "current" };
  const modeMap = { train: "1", trains: "1", metro: "2", "light rail": "4", bus: "5", buses: "5", ferry: "9", ferries: "9" };
  const mot = q && modeMap[q.toLowerCase()];
  if (mot) params.filterMOTType = mot;
  const data = await tp(env, "add_info", params);
  const strip = plainText;
  const list = ((data.infos && data.infos.current) || []).map((i) => {
    const head = strip(i.subtitle || i.urlText || "");
    const body = strip(i.content || "");
    const text = (body.toLowerCase().startsWith(head.toLowerCase()) ? body : (head + " " + body)).trim();
    return {
      title: text.length > 260 ? text.slice(0, 257) + "..." : text,
      priority: i.priority || "normal",
      updated: (i.timestamps && i.timestamps.lastModification) || null,
      lines: [...new Set(((i.affected && i.affected.lines) || []).map((l) => {
        const n = String(l.disassembledName || l.number || "");
        const m = n.match(/^([A-Z]{1,3}\d{0,3})\b/);
        return m ? m[1] : n;
      }).filter(Boolean))].slice(0, 6),
      url: httpsUrl(i.url),
    };
  });
  const lineQ = q && /^[a-z]{0,3}\d{1,3}[a-z]?$/i.test(q) ? q.toUpperCase() : null;
  let out = list;
  if (lineQ) out = list.filter((i) => i.lines.includes(lineQ));
  const rank = { veryHigh: 0, high: 1, normal: 2, low: 3 };
  out.sort((a, b) => ((rank[a.priority] ?? 2) - (rank[b.priority] ?? 2)) || (new Date(b.updated || 0) - new Date(a.updated || 0)));
  return { items: out.slice(0, 12), total: out.length, filter: lineQ || (mot ? q.toLowerCase() : null) };
}

// ---------- storage (D1): realtime observations and saved trips ----------

let schemaReady = null;
function db(env) { return env && env.DB ? env.DB : null; }
async function ensureSchema(env) {
  const d = db(env);
  if (!d) return false;
  if (!schemaReady) {
    schemaReady = d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS obs (day TEXT NOT NULL, trip_id TEXT NOT NULL, stop_id TEXT NOT NULL, route TEXT, mode TEXT,
        planned INTEGER, est INTEGER, delay_s INTEGER, source TEXT, first_seen INTEGER, last_seen INTEGER, n INTEGER DEFAULT 1,
        PRIMARY KEY (day, trip_id, stop_id))`),
      d.prepare(`CREATE INDEX IF NOT EXISTS obs_route ON obs (route, stop_id, planned)`),
      d.prepare(`CREATE TABLE IF NOT EXISTS saved (profile TEXT NOT NULL, name TEXT NOT NULL, from_id TEXT, from_name TEXT,
        to_id TEXT, to_name TEXT, created INTEGER, PRIMARY KEY (profile, name))`),
      d.prepare(`CREATE TABLE IF NOT EXISTS saved_legs (profile TEXT NOT NULL, name TEXT NOT NULL, legs TEXT, PRIMARY KEY (profile, name))`),
    ]).then(() => true).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

const lastLogged = new Map();
function logObservations(env, ctx, items, stopId) {
  const d = db(env);
  if (!d || !ctx) return;
  const now = Date.now();
  if (now - (lastLogged.get(stopId) || 0) < 60000) return;
  lastLogged.set(stopId, now);
  const rows = items.filter((i) => i.realtime && i.tripId && i.estimated);
  if (!rows.length) return;
  ctx.waitUntil((async () => {
    try {
      await ensureSchema(env);
      const stmt = d.prepare(`INSERT INTO obs (day, trip_id, stop_id, route, mode, planned, est, delay_s, source, first_seen, last_seen, n)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, 1)
        ON CONFLICT (day, trip_id, stop_id) DO UPDATE SET est = excluded.est, delay_s = excluded.delay_s, source = excluded.source,
        last_seen = excluded.last_seen, n = obs.n + 1`);
      await d.batch(rows.slice(0, 60).map((i) => stmt.bind(
        sydneyParts(new Date(i.planned)).date, i.tripId, i.stopId, i.line, i.mode, ms(i.planned), ms(i.estimated),
        Math.round((ms(i.estimated) - ms(i.planned)) / 1000), i.source || "planner", now)));
    } catch (e) { /* logging is best effort */ }
  })());
}

async function savedList(env, profile) {
  if (!profile) return [];
  if (!(await ensureSchema(env).catch(() => false))) return [];
  const r = await db(env).prepare("SELECT s.name, s.from_id, s.from_name, s.to_id, s.to_name, s.created, l.legs FROM saved s LEFT JOIN saved_legs l ON l.profile = s.profile AND l.name = s.name WHERE s.profile = ?1 ORDER BY s.created").bind(profile).all();
  return (r.results || []).map((x) => withLegs({ name: x.name, from: { id: x.from_id, name: x.from_name }, to: { id: x.to_id, name: x.to_name }, created: x.created }, x.legs));
}
async function savedGet(env, profile, name) {
  if (!profile) return null;
  if (!(await ensureSchema(env).catch(() => false))) return null;
  const x = await db(env).prepare("SELECT s.name, s.from_id, s.from_name, s.to_id, s.to_name, l.legs FROM saved s LEFT JOIN saved_legs l ON l.profile = s.profile AND l.name = s.name WHERE s.profile = ?1 AND s.name = ?2").bind(profile, name.toLowerCase()).first();
  return x ? withLegs({ name: x.name, from: { id: x.from_id, name: x.from_name }, to: { id: x.to_id, name: x.to_name } }, x.legs) : null;
}
// A saved trip with more than one leg keeps its legs in saved_legs; one leg trips have none.
function withLegs(s, legsJson) {
  if (!legsJson) return s;
  try { const legs = chainLegs(JSON.parse(legsJson)); if (legs && legs.length > 1) s.legs = legs; } catch (e) { /* keep the one leg form */ }
  return s;
}
async function savedPut(env, profile, name, from, to, legs = null) {
  if (!profile) throw new Error("profile needed");
  await ensureSchema(env);
  if (legs && legs.length > 1) await db(env).prepare("INSERT INTO saved_legs (profile, name, legs) VALUES (?1, ?2, ?3) ON CONFLICT (profile, name) DO UPDATE SET legs = excluded.legs").bind(profile, name.toLowerCase(), JSON.stringify(legs)).run();
  else await db(env).prepare("DELETE FROM saved_legs WHERE profile = ?1 AND name = ?2").bind(profile, name.toLowerCase()).run();
  await db(env).prepare(`INSERT INTO saved (profile, name, from_id, from_name, to_id, to_name, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT (profile, name) DO UPDATE SET from_id = excluded.from_id, from_name = excluded.from_name, to_id = excluded.to_id, to_name = excluded.to_name`)
    .bind(profile, name.toLowerCase(), from.id, from.name, to.id, to.name, Date.now()).run();
  return legs && legs.length > 1 ? { name: name.toLowerCase(), from, to, legs } : { name: name.toLowerCase(), from, to };
}
async function savedDelete(env, profile, name) {
  await ensureSchema(env);
  await db(env).prepare("DELETE FROM saved WHERE profile = ?1 AND name = ?2").bind(profile, name.toLowerCase()).run();
  await db(env).prepare("DELETE FROM saved_legs WHERE profile = ?1 AND name = ?2").bind(profile, name.toLowerCase()).run();
}
async function resolvePlace(env, p) {
  if (p && typeof p === "object" && p.id) return { id: String(p.id), name: p.name || String(p.id) };
  const r = await bestPlace(env, String(p || "").trim());
  return r.place ? { id: r.place.id, name: shortName(r.place.name) } : null;
}

// ---------- understanding the message ----------

const MODE_WORDS = [
  [/\b(trains?|rail)\b/i, "train"], [/\bmetro\b/i, "metro"], [/\blight ?rail\b|\btram\b/i, "lightrail"],
  [/\bbus(es)?\b/i, "bus"], [/\bferr(y|ies)\b/i, "ferry"],
];

function parseTime(s) {
  const m = s.match(/\b(at|by|after|before)\s+(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?\b/i);
  if (!m) return { rest: s };
  let h = Number(m[2]); const min = m[3] ? Number(m[3]) : 0; const ap = (m[4] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && h < 7 && h !== 0) h += 12;
  if (h > 23 || min > 59) return { rest: s };
  const arriveBy = /^(by|before)$/i.test(m[1]) || /\barrive\b/i.test(s);
  const rest = s.replace(m[0], " ").replace(/\barrive\b/i, " ").replace(/\s+/g, " ").trim();
  return { rest, time: String(h).padStart(2, "0") + String(min).padStart(2, "0"), arriveBy };
}
function cleanPlace(s) { return s.replace(/^(the\s+)/i, "").replace(/[?.!]+$/, "").trim(); }
const TRIP_RE = /^(?:trip\s+)?(?:from\s+)?(.+?)\s+(?:to|>|->|\u2192)\s+(.+)$/i;

async function planTrip(env, text, ctx) {
  const m = text.match(TRIP_RE);
  if (!m) return null;
  const t = parseTime(m[2]);
  const fromQ = cleanPlace(m[1]);
  const toQ = cleanPlace(t.rest);
  const here = /^(here|my location|me|current location)$/i;
  let fromP = null; const opt = {};
  if (here.test(fromQ)) {
    if (!(ctx.lat && ctx.lon)) return { kind: "needLocation", then: text };
    fromP = { id: `${ctx.lon}:${ctx.lat}:EPSG:4326`, name: "Your location" };
    opt.fromType = "coord";
  }
  const [a, b] = await Promise.all([fromP ? { place: fromP } : bestPlace(env, fromQ), bestPlace(env, toQ)]);
  if (!a.place) return { kind: "text", text: `I couldn't find a stop or place called "${fromQ}". Try the station name or a stop number.` };
  if (!b.place) return { kind: "text", text: `I couldn't find a stop or place called "${toQ}". Try the station name or a stop number.` };
  const r = await trip(env, a.place.id, b.place.id, { ...opt, time: t.time, arriveBy: t.arriveBy, accessible: !!ctx.accessible });
  return {
    kind: "trip",
    from: { id: a.place.id, name: shortName(a.place.name) }, to: { id: b.place.id, name: shortName(b.place.name) },
    ...r,
    when: t.time ? { time: t.time, arriveBy: !!t.arriveBy, tomorrow: !!r.tomorrow } : null,
  };
}

async function savedTrip(env, s, count = 5, accessible = false) {
  if (s.legs && s.legs.length > 1) {
    const r = await planChain(env, s.legs, { count, accessible });
    return { kind: "trip", saved: s.name, from: s.from, to: s.to, stops: s.legs.slice(0, -1).map((l) => ({ id: l.t, name: l.tn })), ...r, when: null };
  }
  const r = await trip(env, s.from.id, s.to.id, { count, accessible });
  return { kind: "trip", saved: s.name, from: s.from, to: s.to, ...r, when: null };
}

async function answer(env, raw, ctx = {}) {
  const text = (raw || "").trim();
  if (!text) return { kind: "help" };
  const lower = text.toLowerCase();
  const profile = profileId(ctx.profile);

  if (/^(hi|hey|hello|start|get started|help|menu|what can you do\??|\?)$/i.test(lower)) return { kind: "help" };

  if (/^(alerts?|status|service alerts?|disruptions?|trackwork)\b/i.test(lower)) {
    const q = lower.replace(/^(service\s+)?(alerts?|status|disruptions?|trackwork)\s*(for|on)?\s*/i, "").trim();
    return { kind: "alerts", ...(await alerts(env, q)) };
  }
  if (/^(near me|nearby|stops near me|closest stop|nearest stop)$/i.test(lower)) {
    if (ctx.lat && ctx.lon) return { kind: "nearby", stops: await nearby(env, ctx.lat, ctx.lon) };
    return { kind: "needLocation" };
  }

  // "save Burwood to Central as home"
  const sv = text.match(/^save\s+(.+?)\s+as\s+["']?([\w ]{1,24}?)["']?$/i);
  if (sv && TRIP_RE.test(sv[1])) {
    if (!profile) return { kind: "text", text: "Open the app to save trips. They are saved to your phone and your own private profile." };
    const tm = sv[1].match(TRIP_RE);
    const [from, to] = await Promise.all([resolvePlace(env, cleanPlace(tm[1])), resolvePlace(env, cleanPlace(tm[2]))]);
    if (!from || !to) return { kind: "text", text: "I couldn't find one of those stops. Try station names or stop numbers." };
    const s = await savedPut(env, profile, sv[2].trim(), from, to);
    const r = await savedTrip(env, s);
    return { ...r, savedNow: true };
  }
  if (/^(saved|my trips|saved trips)$/i.test(lower)) return { kind: "savedList", items: await savedList(env, profile) };

  // A saved trip name, like "home" or "work"
  if (/^[\w ]{2,24}$/.test(lower) && !/^\d+$/.test(lower)) {
    const s = await savedGet(env, profile, lower).catch(() => null);
    if (s) return savedTrip(env, s);
  }

  if (/\s(to|>|->)$/i.test(lower)) {
    return { kind: "text", text: "Where to? Send it as one message, like " + text.replace(/\s(to|>|->)$/i, "") + " to Central." };
  }
  if (TRIP_RE.test(text) && !/^(next|departures?)\b/i.test(lower)) return planTrip(env, text, ctx);

  let mode = null;
  let q = text;
  for (const [re, m] of MODE_WORDS) if (re.test(q)) { mode = m; break; }
  q = q.replace(/^(when'?s|when is|what'?s)\s+(the\s+)?/i, "")
    .replace(/^(next|upcoming)\s+/i, "")
    .replace(/^(trains?|metro|light ?rail|buses|bus|ferry|ferries|services?|departures?)\s*/i, "")
    .replace(/^(from|at|for)\s+/i, "")
    .replace(/\s+(trains?|metro|light ?rail|buses|bus|ferry|ferries|departures?)$/i, "");
  q = cleanPlace(q);

  if (/^\d{5,8}$/.test(q)) {
    const r = await departures(env, q, { mode, ctx: ctx.exec });
    if (!r.items.length && !r.stop.fullName) return { kind: "text", text: `I couldn't find stop number ${q}. Check the number on the stop sign and try again.` };
    const allBus = r.items.length && r.items.every((i) => i.mode === "bus" || i.mode === "coach");
    return { kind: "departures", byNumber: true, stopType: allBus ? "bus stop" : "stop", mode, ...r };
  }
  if (q.length < 2) return { kind: "help" };
  const { stops } = await findStops(env, q);
  if (!stops.length) return { kind: "text", text: `I couldn't find a stop called "${q}". Try a station name like "Strathfield", a stop number from the sign, or a trip like "Burwood to Central".` };
  let top = stops[0];
  // The Trip Planner always offers something, even for "asdfgh qwerty". Take its stop only when the words
  // asked are in the stop's name; otherwise try the station, suburb and typo matching, then say so plainly.
  if (!askHasAll(askWords(q), top.name)) {
    const pl = await askPlace(env, q, ctx.origin).catch(() => null);
    if (pl && pl.ambiguous) return { kind: "didYouMean", role: "stop", q, options: pl.options, suggestions: pl.options.slice(0, 3).map((o) => "Departures " + o.name) };
    if (!pl || !pl.id || /EPSG/.test(String(pl.id)) || pl.type === "poi" || pl.type === "street") return { kind: "text", text: ASK_NOT_UNDERSTOOD };
    top = { id: pl.id, name: pl.name, quality: top.quality };
  }
  const r = await departures(env, top.id, { mode, ctx: ctx.exec });
  const close = stops.slice(1, 4).filter((s) => s.quality >= top.quality - 10).map((s) => ({ id: s.id, name: shortName(s.name) }));
  return { kind: "departures", mode, ...r, alternatives: close };
}



// ---- ask start
// Ask tab: reads a natural question, answers it from live Transport for NSW data, and adds
// a short reply, cards and deep links on top of the classic answer() result. Nothing here
// is made up: every time, platform and status comes from departures(), trip() or alerts().

const ASK_LINE = /\b(T[1-9]|M1|L[1-4]|F[1-9]\d?|BMT|CCN|SCO|HUN|SHL|BNT|[0-9]{3}[A-Z]?|[A-Z][0-9]{2,3}[A-Z]?)\b/i;
const ASK_STATUS_WORDS = /\b(late|delay(s|ed)?|running|on time|status|ok(ay)?|working|problems?|issues?|trackwork|disruptions?|alerts?|slow|cancel+ed|how'?s|how is)\b/i;
const ASK_LINE_HOME = {
  T1: ["200060", "213510"], T2: ["200060", "213510"], T9: ["200060", "213510"], T3: "200060", T4: "200060", T8: "200060",
  BMT: "200060", CCN: "200060", SCO: "200060", SHL: "200060", M1: "200060",
  T5: "Parramatta Station", T7: "Lidcombe Station", HUN: "Newcastle Interchange",
  L1: "Central Light Rail", L2: "Central Chalmers Street Light Rail", L3: "Central Chalmers Street Light Rail",
  L4: "Westmead Light Rail",
};
const ASK_EXCL = {
  train: { excludedMeans: "checkbox", exclMOT_4: "1", exclMOT_5: "1", exclMOT_7: "1", exclMOT_9: "1", exclMOT_11: "1" },
  lightrail: { excludedMeans: "checkbox", exclMOT_1: "1", exclMOT_2: "1", exclMOT_5: "1", exclMOT_7: "1", exclMOT_9: "1", exclMOT_11: "1" },
  ferry: { excludedMeans: "checkbox", exclMOT_1: "1", exclMOT_2: "1", exclMOT_4: "1", exclMOT_5: "1", exclMOT_7: "1", exclMOT_11: "1" },
  bus: { excludedMeans: "checkbox", exclMOT_1: "1", exclMOT_2: "1", exclMOT_4: "1", exclMOT_9: "1" },
};
function askLineMode(line) { return /^(T\d|M1|BMT|CCN|SCO|HUN|SHL|BNT)$/.test(line) ? "train" : /^L\d$/.test(line) ? "lightrail" : /^F\d/.test(line) ? "ferry" : "bus"; }
const ASK_MODE_OF = { train: "train", trains: "train", rail: "train", metro: "metro", bus: "bus", buses: "bus", ferry: "ferry", ferries: "ferry", "light rail": "lightrail", tram: "lightrail" };

function askHref(path, q) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(q || {})) if (v != null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return path + (s ? "?" + s : "");
}
function askStopLink(id, name) { return { kind: "stop", id: String(id), name: name || String(id), href: askHref("#/stop/" + encodeURIComponent(id), { name }) }; }
function askTripLink(from, to) { return { kind: "trip", from: from.id, to: to.id, fn: from.name, tn: to.name, href: askHref("#/trip", { from: from.id, to: to.id, fn: from.name, tn: to.name }) }; }
function askSvc(it) {
  const q = { trip: it.tripId, mode: it.mode, line: it.line, stop: it.stopId, destId: it.destId, planned: it.planned, dest: it.dest || it.towards, stopName: it.stopName || it.from, color: it.color, platform: it.platform || it.fromPlatform };
  return { kind: "service", ...q, href: askHref("#/svc", q) };
}
function askDep(it) {
  return {
    line: it.line, color: it.color, mode: it.mode, dest: it.dest, platform: it.platform || null,
    planned: it.planned, estimated: it.estimated || null, realtime: !!it.realtime, delayMin: it.delayMin || 0,
    cancelled: !!it.cancelled, status: it.status || statusOf(it), stopsAway: it.stopsAway == null ? null : it.stopsAway,
    occupancy: it.occupancy ? it.occupancy.text : null, link: askSvc(it),
  };
}
// Intercity lines by name: the codes alone ("BMT") mean little to most people.
const ASK_LINE_NAMES = { BMT: "Blue Mountains Line", CCN: "Central Coast and Newcastle Line", SCO: "South Coast Line", SHL: "Southern Highlands Line", HUN: "Hunter Line" };
function askLineName(line) { return ASK_LINE_NAMES[String(line || "").toUpperCase()] || null; }
// " (T4 then T9, Plat 1, change at Redfern)": every service of one journey, so the sentence matches its card row.
function askLinesWords(j) {
  const tl = askTransit(j || {});
  if (!tl.length) return "";
  const names = tl.map((l) => askLineName(l.line) || l.line).filter(Boolean);
  const at = [...new Set(tl.slice(1).map((l) => askShort(String(l.from || "").split(",")[0].trim())).filter(Boolean))];
  return ` (${names.join(" then ")}${askPlat(tl[0].fromPlatform)}${at.length ? `, change at ${askJoin(at)}` : ""})`;
}
function askLegOut(l) {
  return {
    kind: l.kind, mode: l.mode || null, line: l.line || null, color: l.color || null, towards: l.towards || null,
    from: l.from || null, fromPlatform: l.fromPlatform || null, to: l.to || null, planned: l.planned || null,
    estimated: l.estimated || null, realtime: !!l.realtime, delayMin: l.delayMin || 0, cancelled: !!l.cancelled,
    durationMin: l.durationMin || null, link: l.kind === "transit" && l.tripId ? askSvc(l) : null,
    ...(askLineName(l.line) ? { lineName: askLineName(l.line) } : {}),
  };
}
function askJourneyOut(j) {
  return { leave: j.leave, board: j.board || null, arrive: j.arrive, durationMin: j.durationMin, changes: j.changes, live: !!j.live, cancelled: !!j.anyCancelled, legs: (j.legs || []).map(askLegOut), fares: j.fares || null };
}
function askStatusWords(it) {
  if (it.cancelled) return "cancelled";
  if (!it.realtime) return "scheduled";
  const d = Math.round(it.delayMin || 0);
  if (d >= 2) return `${d} min late`;
  if (d <= -2) return `${-d} min early`;
  return "on time";
}
function askFromName(p) { return p && /EPSG/.test(String(p.id)) ? "where you are" : p.name; }
function askWhen(t) { const m = inMins(t); return m === "now" ? "now" : "in " + m; }
function askPlat(p) { return p ? ", " + p.replace(/^Platform /, "Plat ") : ""; }
function askNotPast(items, now) { return items.filter((i) => ms(i.estimated || i.planned) >= now - 30000); }
function askTransit(j) { return (j.legs || []).filter((l) => l.kind === "transit"); }
function askPlaceArg(s) {
  if (!s) return null;
  const [id, ...rest] = String(s).split("|");
  const cid = cleanId(id, 40);
  return cid ? { id: cid, name: rest.join("|").slice(0, 80) || cid } : null;
}
function askClean(s) {
  return String(s || "").replace(/[\u2018\u2019]/g, "'").replace(/^(hey|hi|ok|okay|so|um|please)[,\s]+/i, "")
    .replace(/\s*(please|pls|plz|thanks|thank you|mate)[.!?]*$/i, "").replace(/[?!.]+$/, "").replace(/\s+/g, " ").trim();
}
function askModeIn(s) {
  const m = s.match(/\b(trains?|rail|metro|bus(es)?|ferr(y|ies)|light rail|tram)\b/i);
  return m ? ASK_MODE_OF[m[1].toLowerCase()] || null : null;
}
// Place resolution for Ask. Never a silent guess: a bare suburb or city name means its station
// or the suburb itself, never a business. Order: known landmarks, exact station names (the same
// lists /api/stations serves), aliases, every NSW suburb and locality (stations/places.json),
// typo fixes against those names, then stops, and named places or streets only when every word
// asked is in their name. Anything unclear comes back as "Did you mean" choices.
const ASK_STATION_MODES = ["train", "metro", "lightrail", "ferry"];
const ASK_ALIASES = {
  "city": "200060", "the city": "200060", "cbd": "200060", "sydney": "200060", "sydney cbd": "200060", "sydney city": "200060",
  "sydney central": "200060", "central station": "200060", "town": "200060",
  "the quay": "Circular Quay", "quay": "Circular Quay", "parra": "Parramatta Station", "sydney olympic park": "Olympic Park Station",
  "olympic stadium": "Olympic Park Station", "accor stadium": "Olympic Park Station", "stadium australia": "Olympic Park Station",
  "international airport": "202030", "intl airport": "202030", "domestic airport": "202020",
  "macquarie uni": "Macquarie University Station", "mq uni": "Macquarie University Station",
  "harbour bridge": "Milsons Point Station", "barangaroo": "Barangaroo Station",
};
// Landmarks: label shown on a choice chip -> what it resolves to (a station name, or a place query).
const ASK_LANDMARKS = {
  "unsw": { q: "UNSW Anzac Parade Light Rail", name: "UNSW (Kensington)" },
  "sydney uni": { q: "Redfern Station", name: "Sydney Uni (Redfern Station)" }, "usyd": { q: "Redfern Station", name: "Sydney Uni (Redfern Station)" },
  "university of sydney": { q: "Redfern Station", name: "Sydney Uni (Redfern Station)" },
  "western sydney uni": { q: "Parramatta Station", name: "Western Sydney Uni (Parramatta)" },
  "uts": { q: "Central Station", name: "UTS (Central Station)" },
  "opera house": { q: "Circular Quay", name: "Circular Quay (Opera House)" }, "sydney opera house": { q: "Circular Quay", name: "Circular Quay (Opera House)" },
  "scg": { q: "Moore Park Light Rail", name: "Moore Park (SCG)" }, "allianz stadium": { q: "Moore Park Light Rail", name: "Moore Park (Allianz Stadium)" },
  "taronga zoo": { q: "Taronga Zoo Wharf", name: "Taronga Zoo Wharf" }, "the zoo": { q: "Taronga Zoo Wharf", name: "Taronga Zoo Wharf" },
};
const ASK_AMBIGUOUS = {
  "uni": ["UNSW", "Sydney Uni", "Macquarie Uni", "UTS", "Western Sydney Uni"],
  "university": ["UNSW", "Sydney Uni", "Macquarie Uni", "UTS", "Western Sydney Uni"],
  "airport": ["International Airport", "Domestic Airport", "Newcastle Airport"],
  "the airport": ["International Airport", "Domestic Airport", "Newcastle Airport"],
  "sydney airport": ["International Airport", "Domestic Airport"],
  "stadium": ["Accor Stadium", "Allianz Stadium", "SCG"],
  "beach": ["Bondi Beach", "Manly", "Coogee", "Cronulla"],
};
const ASK_STOPWORDS = new Set(["the", "to", "from", "at", "in", "nsw", "australia", "station", "stn"]);
const ASK_STREET_WORD = /\b(st|street|rd|road|ave|avenue|ln|lane|pde|parade|hwy|highway|dr|drive|pl|place|cres|crescent|blvd|tce|terrace|way|cl|close|ct|court)\b|\d/i;
let askGazMem = null;
function askNorm(s) {
  return String(s || "").toLowerCase().replace(/&/g, " and ").replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, " ")
    .replace(/\bsaint\b/g, "st").replace(/\bmount\b/g, "mt").replace(/\s+/g, " ").trim();
}
function askBase(s) {
  return askNorm(s).replace(/\s+(railway station|train station|metro station|station|stn|light rail stop|light rail station|light rail|ferry wharf|wharf|interchange)$/, "").trim();
}
async function askAsset(env, origin, path) {
  try {
    const req = new Request(new URL(path, origin || "https://assets.local"));
    const r = env && env.ASSETS ? await env.ASSETS.fetch(req) : await fetch(req);
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
// The gazetteer: every station (train, metro, light rail, ferry) and every NSW suburb.
async function askGazetteer(env, origin) {
  if (askGazMem && Date.now() - askGazMem.at < 86400000) return askGazMem;
  const [places, ...lists] = await Promise.all([askAsset(env, origin, "/stations/places.json"), ...ASK_STATION_MODES.map((m) => askAsset(env, origin, `/stations/${m}.json`))]);
  const keys = new Map(), byId = new Map(), byName = new Map(), subs = new Map();
  lists.forEach((list, rank) => {
    for (const row of Array.isArray(list) ? list : []) {
      const st = { id: String(row[0]), name: String(row[1]), mode: ASK_STATION_MODES[rank], rank, lat: row[2], lon: row[3] };
      if (!byId.has(st.id)) byId.set(st.id, st);
      if (!byName.has(st.name)) byName.set(st.name, st);
      for (const k of new Set([askNorm(st.name), askBase(st.name)])) if (k && !keys.has(k)) keys.set(k, st);
    }
  });
  for (const row of Array.isArray(places) ? places : []) { const k = askNorm(row[0]); if (k && !subs.has(k)) subs.set(k, { name: String(row[0]), lat: row[1], lon: row[2] }); }
  const fuzzy = [];
  for (const [k, st] of keys) if (k === askBase(st.name)) fuzzy.push({ k, label: st.name, station: st });
  for (const [k, sb] of subs) if (!keys.has(k)) fuzzy.push({ k, label: sb.name, suburb: sb });
  const mem = { at: Date.now(), keys, byId, byName, subs, fuzzy };
  if (keys.size && subs.size) askGazMem = mem;
  return mem;
}
// Optimal string alignment distance (a swap of two letters counts as one edit), capped.
function askEdits(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d = [];
  for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
  }
  return d[a.length][b.length];
}
function askWords(s) { return askNorm(s).split(" ").filter((w) => w && !ASK_STOPWORDS.has(w)); }
function askHasAll(words, name) {
  const toks = askNorm(name).split(" ");
  return words.length > 0 && words.every((w) => toks.includes(w) || (w.length >= 4 && toks.some((t) => t.startsWith(w))));
}
function askStationOut(st, how) { return { id: st.id, name: st.name, station: true, mode: st.mode, how: how || "station" }; }
async function askSuburbOut(env, sb, how) {
  const all = (await findLocations(env, sb.name).catch(() => [])).filter(isNswStop);
  const hit = all.filter((l) => (l.type === "suburb" || l.type === "locality") && askNorm(String(l.name).split(",")[0]) === askNorm(sb.name)).sort((a, b) => b.quality - a.quality)[0];
  if (hit) return { id: hit.id, name: sb.name, suburb: true, how: how || "suburb" };
  return { id: `${sb.lon}:${sb.lat}:EPSG:4326`, name: sb.name, suburb: true, coord: true, how: how || "suburb" };
}
function askChoice(label) { return { name: label }; }
async function askPlace(env, q, origin) {
  const raw = String(q || "").trim().replace(/\s+/g, " ");
  if (!raw) return null;
  if (/^\d{5,8}$/.test(raw)) return { id: raw, name: "Stop " + raw, how: "stop" };
  const g = await askGazetteer(env, origin);
  const nq = askNorm(raw), nb = askBase(raw), noThe = askNorm(raw.replace(/^the\s+/i, ""));
  const byLabel = (v) => g.byName.get(v) || g.byId.get(v) || g.keys.get(askNorm(v)) || g.keys.get(askBase(v));
  if (ASK_AMBIGUOUS[nq]) return { ambiguous: true, q: raw, options: ASK_AMBIGUOUS[nq].map(askChoice) };
  const lm = ASK_LANDMARKS[nq] || ASK_LANDMARKS[noThe];
  if (lm) { const st = byLabel(lm.q); if (st) return { ...askStationOut(st, "landmark"), label: lm.name }; }
  for (const k of [nq, nb, noThe]) { const st = g.keys.get(k); if (st) return askStationOut(st); }
  const al = ASK_ALIASES[nq];
  if (al) { const st = byLabel(al); if (st) return askStationOut(st, "alias"); }
  const sb = g.subs.get(nq) || g.subs.get(nb);
  if (sb) return askSuburbOut(env, sb);
  // "bondi junction" style: one train or metro station whose name starts with the words asked.
  const pre = [...new Set([...g.keys.entries()].filter(([k, st]) => k.startsWith(nb + " ") && st.rank < 2).map(([, st]) => st))];
  if (pre.length === 1) return askStationOut(pre[0], "prefix");
  // Typos ("campsei", "newcasle"): only against station and suburb names, never businesses.
  const cap = nb.length >= 8 ? 2 : nb.length >= 5 ? 1 : 0;
  let near = [];
  if (cap) {
    for (const f of g.fuzzy) { if (f.k[0] !== nb[0]) continue; const e = askEdits(nb, f.k, cap); if (e <= cap) near.push({ ...f, e }); }
    near.sort((a, b) => a.e - b.e || (a.station ? 0 : 1) - (b.station ? 0 : 1));
    const best = near.filter((x) => x.e === (near[0] && near[0].e));
    if (best.length === 1) return best[0].station ? askStationOut(best[0].station, "typo") : askSuburbOut(env, best[0].suburb, "typo");
    if (best.length > 1) return { ambiguous: true, q: raw, options: best.slice(0, 4).map((x) => askChoice(x.label)) };
  }
  const words = askWords(raw.replace(/^the\s+/i, ""));
  const all = (await findLocations(env, raw)).filter(isNswStop);
  const byQ = (list) => list.slice().sort((a, b) => b.quality - a.quality);
  const place = (l, how) => ({ id: l.id, name: shortName(l.name), type: l.type, how });
  const isLoc = (l) => l.type === "suburb" || l.type === "locality";
  // One word that only partly matches ("rocks" in "Dog Rocks") is a guess, so it becomes a choice.
  const sure = (l) => words.length >= 2 || askBase(String(l.name).split(",")[0]) === askBase(words.join(" "));
  const stop = byQ(all.filter((l) => (l.type === "stop" || l.type === "platform") && askHasAll(words, l.name)))[0];
  if (stop && sure(stop)) return place(stop, "stop");
  const loc = byQ(all.filter((l) => isLoc(l) && askHasAll(words, l.name)))[0];
  if (loc && sure(loc)) return place(loc, "suburb");
  const poi = byQ(all.filter((l) => l.type === "poi" && askHasAll(words, l.name)))[0];
  if (poi && words.length >= 2) return place(poi, "poi");
  const street = ASK_STREET_WORD.test(raw) ? byQ(all.filter((l) => (l.type === "street" || l.type === "singlehouse") && askHasAll(words, l.name)))[0] : null;
  if (street) return place(street, "street");
  // Nothing clear: offer what came closest instead of picking one.
  const opts = [];
  const add = (n) => { const s = shortName(n); if (s && !opts.some((o) => askNorm(o.name) === askNorm(s)) && opts.length < 4) opts.push(askChoice(s)); };
  const wide = cap ? [] : g.fuzzy.map((f) => ({ ...f, e: askEdits(nb, f.k, 2) })).filter((x) => x.e <= 2 && nb.length >= 3).sort((a, b) => a.e - b.e);
  for (const x of near.concat(wide)) add(x.label);
  for (const x of g.fuzzy.filter((f) => askHasAll(words, f.label)).sort((a, b) => (a.station ? 0 : 1) - (b.station ? 0 : 1) || a.label.length - b.label.length)) add(x.label);
  for (const l of [loc, stop, poi]) if (l) add(l.name);
  for (const l of byQ(all.filter((l) => l.type === "stop" || isLoc(l) || l.type === "poi"))) if (words.some((w) => askNorm(l.name).split(" ").includes(w))) add(l.name);
  return opts.length ? { ambiguous: true, q: raw, options: opts } : null;
}
function askShort(name) { return String(name || "").replace(/\s+(Station|Light Rail)$/i, ""); }

// Trip phrasing: "A to B", "from A to B", "to B from A", "go to A to B" (means A to B),
// "B from A" after a travel verb, and "via C" anywhere ("A via C to B", "A to B via C").
function askPlaceQ(s) {
  return String(s || "").replace(/[?.!,]+$/, "").replace(/\s+(?:by|on|using|with|taking)\s+(?:the\s+)?(?:trains?|bus(?:es)?|metro|ferr(?:y|ies)|light rail|tram|public transport)$/i, "")
    .replace(/\s+(?:please|pls|now|today|tonight|asap)$/i, "").replace(/^(?:the\s+)?(?:next\s+)?(?:trains?|bus(?:es)?|metro|ferry|light rail|tram)\s+(?:from\s+)?/i, "").trim();
}
// Several stops: "A to B via C and D", "via C via D", "changing at C and D", "stopping at C, D",
// "A then C then D then B", "A, C, D, B", "A to C to D to B". One stop keeps the single via path.
const ASK_VIA_WORDS = "via|through|thru|by way of|going through|stopping at|stop at|changing at|change at";
const ASK_VIA_RE = new RegExp(`\\s+(?:${ASK_VIA_WORDS})\\s+(.+?)(?=\\s+(?:to|from|${ASK_VIA_WORDS})\\s+|\\s*(?:->|>|\\u2192)\\s*|$)`, "i");
const ASK_LIST_SPLIT = /\s*,\s*(?:and\s+)?(?:then\s+)?|\s+(?:and\s+then|and|then|&|\+)\s+/i;
function askParseTrip(s, travel) {
  let rest = String(s || "").trim(), vm;
  const stops = [];
  while ((vm = rest.match(ASK_VIA_RE))) {
    for (const x of vm[1].split(ASK_LIST_SPLIT)) { const q = askPlaceQ(x); if (q) stops.push(q); }
    rest = (rest.slice(0, vm.index) + " " + rest.slice(vm.index + vm[0].length)).replace(/\s+/g, " ").trim();
  }
  const via = stops.length === 1 ? stops[0] : null;
  const TO = "(?:to|>|->|\u2192)";
  let m;
  const out = (from, to, mid = []) => {
    const st = [...mid, ...stops];
    return { from: from == null ? null : askPlaceQ(from), to: to == null ? null : askPlaceQ(to), via: st.length === 1 ? st[0] : null, stops: st };
  };
  // A chain of stops in travel order. "to B from A" and plain "A to B" fall through to the patterns below.
  const body = rest.replace(/^(?:from|to)\s+/i, "");
  if (!/\s+from\s+/i.test(body)) {
    const arrows = /\s+(?:to|then)\s+|\s*(?:->|>|\u2192)\s*/i.test(body);
    const seq = body.split(arrows ? /\s*,?\s+(?:and\s+)?then\s+|\s+to\s+|\s*(?:->|>|\u2192)\s*/i : /\s*,\s*(?:and\s+)?(?:then\s+)?/).map(askPlaceQ).filter(Boolean);
    if (seq.length >= 3 || (seq.length === 2 && /\s+then\s+/i.test(body))) return out(seq[0], seq[seq.length - 1], seq.slice(1, -1));
  }
  if ((m = rest.match(new RegExp(`^from\\s+(.+?)\\s+${TO}\\s+(.+)$`, "i")))) return out(m[1], m[2]);
  if ((m = rest.match(/^to\s+(.+?)\s+from\s+(.+)$/i))) return out(m[2], m[1]);
  if ((m = rest.match(new RegExp(`^to\\s+(.+?)\\s+${TO}\\s+(.+)$`, "i")))) return out(m[1], m[2]);
  if ((m = rest.match(new RegExp(`^(.+?)\\s+${TO}\\s+(.+)$`, "i")))) return out(m[1], m[2]);
  if ((m = rest.match(/^to\s+(.+)$/i))) return out(null, m[1]);
  if ((m = rest.match(/^(.+?)\s+from\s+(.+)$/i)) && (travel || !/\b(departures?|next|bus(es)?|trains?|services?|times?|board|line|route|stop|platform|late|status|delays?|alerts?|last|first)\b/i.test(m[1]))) return out(m[2], m[1]);
  if (stops.length) return out(null, rest.replace(/^to\s+/i, "") || null);
  return null;
}

async function askResolve(env, q, ctx) {
  const k = String(q || "").trim().toLowerCase().replace(/^(my\s+)/, "");
  if ((k === "home" || k === "work") && ctx[k]) return ctx[k];
  if (/^(here|my location|me|current location|where i am)$/i.test(k)) {
    if (ctx.lat && ctx.lon) return { id: `${ctx.lon}:${ctx.lat}:EPSG:4326`, name: "Your location", coord: true };
    return { needLocation: true };
  }
  return askPlace(env, askPlaceQ(q), ctx.origin);
}
function askIsHere(p) { return !!p && /EPSG/.test(String(p.id)) && !p.suburb; }
function askLabel(p) { return p ? (askIsHere(p) ? "your location" : p.label || p.name) : ""; }
function askPlaceOut(p) { return p ? { id: p.id, name: p.name, ...(p.label ? { label: p.label } : {}), ...(p.suburb ? { suburb: true } : {}), ...(p.station ? { station: true } : {}), ...(p.how ? { how: p.how } : {}) } : null; }
// A "Did you mean" answer: one chip per choice, each a full question that resolves cleanly.
function askDidYouMean(role, amb, parts, o) {
  const when = o && o.time ? `${o.arriveBy ? " by " : " at "}${Number(o.time.slice(0, 2))}:${o.time.slice(2)}` : "";
  const text = (sub) => {
    const f = role === "from" ? sub : parts.from, t = role === "to" ? sub : parts.to, v = role === "via" ? sub : parts.via;
    return ((o && o.prefix) || "") + (f ? `${f} to ${t}` : `to ${t}`) + (v ? ` via ${v}` : "") + when;
  };
  return { kind: "didYouMean", role, q: amb.q, options: amb.options, suggestions: amb.options.map((x) => text(x.name)) };
}

async function askTrip(env, fromQ, toQ, ctx, o = {}) {
  const res = (q) => (q == null ? null : typeof q === "object" ? q : askResolve(env, q, ctx));
  const [a, b, v] = await Promise.all([res(fromQ), res(toQ), res(o.via)]);
  const nameOf = (p, q) => (p && !p.ambiguous && !p.needLocation ? askLabel(p) === "your location" ? null : p.label || p.name : typeof q === "string" ? q : q && q.name);
  const parts = { from: a && a.needLocation ? null : nameOf(a, fromQ), to: nameOf(b, toQ), via: o.via ? nameOf(v, o.via) : null };
  if (a && a.ambiguous) return askDidYouMean("from", a, parts, o);
  if (b && b.ambiguous) return askDidYouMean("to", b, parts, o);
  if (v && v.ambiguous) return askDidYouMean("via", v, parts, o);
  if (a && a.needLocation) return { kind: "needOrigin", to: b && !b.needLocation ? b : null };
  if (!a) return { kind: "text", text: `I couldn't find a station, suburb or stop called "${fromQ}". Try the station name or a stop number.` };
  if (!b || b.needLocation) return { kind: "text", text: `I couldn't find a station, suburb or stop called "${toQ}". Try the station name or a stop number.` };
  if (o.via && (!v || v.needLocation)) return { kind: "text", text: `I couldn't find a station, suburb or stop called "${o.via}" for the via. Try the station name.` };
  if (a.id === b.id) return { kind: "text", text: (askLabel(a) === askLabel(b) ? `${askLabel(a)} is both the start and the destination` : `${askLabel(a)} and ${askLabel(b)} are the same stop`) + ", so there is no trip to plan. Ask with another start or destination." };
  const opt = { time: o.time, arriveBy: o.arriveBy, count: o.count || 6, accessible: !!ctx.accessible };
  if (a.coord) opt.fromType = "coord";
  if (b.coord) opt.toType = "coord";
  if (v) { opt.via = v.id; if (v.coord) opt.viaType = "coord"; }
  const r = await trip(env, a.id, b.id, opt);
  let journeys = r.journeys || [];
  let modeNote = null;
  if (o.mode && journeys.length) {
    const only = journeys.filter((j) => askTransit(j).length && askTransit(j).every((l) => l.mode === o.mode || (o.mode === "train" && l.mode === "metro")));
    if (only.length) journeys = only; else modeNote = `No ${o.mode === "lightrail" ? "light rail" : o.mode} only trips there, so here are the best options.`;
  }
  return {
    kind: "trip", from: askPlaceOut(a), to: askPlaceOut(b), ...r, journeys, modeNote,
    ...(v ? { via: askPlaceOut(v) } : {}),
    understood: { from: askLabel(a), to: askLabel(b), via: v ? askLabel(v) : null },
    when: o.time ? { time: o.time, arriveBy: !!o.arriveBy, tomorrow: !!r.tomorrow } : null,
  };
}

// A trip with stops on the way, planned leg by leg with planChain (the same planner as /api/plan):
// for each first leg service, the first connection you can catch at every stop after the change time.
function askJoin(a) { return a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : a[0] || ""; }
function askChainQ(names) { return `${names[0]} to ${names[names.length - 1]} via ${askJoin(names.slice(1, -1))}`; }
async function askChain(env, qs, ctx, o = {}) {
  if (qs.length - 1 > CHAIN_MAX_LEGS) return { kind: "text", text: `That is ${qs.length - 1} legs. I can plan up to ${CHAIN_MAX_LEGS} legs (${CHAIN_MAX_LEGS - 1} stops on the way) in one trip.` };
  const P = await Promise.all(qs.map((q) => askResolve(env, q, ctx)));
  const names = P.map((p, i) => (p && !p.ambiguous && !p.needLocation ? askLabel(p) : qs[i]));
  const when = o.time ? `${o.arriveBy ? " by " : " at "}${Number(o.time.slice(0, 2))}:${o.time.slice(2)}` : "";
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (p && p.ambiguous) return { kind: "didYouMean", role: i === 0 ? "from" : i === P.length - 1 ? "to" : "via", q: p.q, options: p.options, suggestions: p.options.map((x) => askChainQ(names.map((n, k) => (k === i ? x.name : n))) + when) };
  }
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (!p) return { kind: "text", text: `I couldn't find a station, suburb or stop called "${qs[i]}". Try the station name or a stop number.` };
    if (p.needLocation || p.coord) return { kind: "text", text: `For a trip with stops, name each stop, like "${askChainQ(["Burwood", ...names.slice(1).map((n) => (n === "your location" ? "Central" : askShort(n)))])}".` };
    if (i && p.id === P[i - 1].id) return { kind: "text", text: `${askLabel(p)} is listed twice in a row, so there is no leg to plan between them. Ask again without the repeat.` };
  }
  const legs = chainLegs(P.slice(1).map((b, i) => ({ f: P[i].id, fn: P[i].name, t: b.id, tn: b.name, m: o.mode || "", c: 5 })));
  const r = await planChain(env, legs, { time: o.time || null, count: o.count || 6, accessible: !!ctx.accessible });
  const z = P[P.length - 1];
  return {
    kind: "trip", chain: true, from: askPlaceOut(P[0]), to: askPlaceOut(z), stops: P.slice(1, -1).map(askPlaceOut), plan: legs, ...r,
    modeNote: o.arriveBy ? `Arrive by times don't work for trips with stops yet, so these leave from ${Number(o.time.slice(0, 2)) % 12 || 12}:${o.time.slice(2)}${Number(o.time.slice(0, 2)) < 12 ? "am" : "pm"}.` : null,
    understood: { from: askLabel(P[0]), to: askLabel(z), via: null, stops: P.slice(1, -1).map(askLabel) },
    when: o.time ? { time: o.time, arriveBy: !!o.arriveBy, tomorrow: !!r.tomorrow } : null,
  };
}
// Trip screen legs as the web and Expo apps read them: [{ mode, from, to, conn }].
function askLegsJson(places, mode) {
  return JSON.stringify(places.slice(1).map((b, i) => ({ mode: mode || "", from: { id: places[i].id, name: places[i].name }, to: { id: b.id, name: b.name }, ...(i ? { conn: 5 } : {}) })));
}
function askTripLinks(places, mode) {
  const a = places[0], z = places[places.length - 1], legs = askLegsJson(places, mode);
  const base = { from: a.id, to: z.id, fn: a.name, tn: z.name, legs };
  return {
    open: { kind: "trip", ...base, ...(places.length === 3 ? { via: places[1].id, vn: places[1].name } : {}), href: askHref("#/trip", { ...base, ...(places.length === 3 ? { via: places[1].id, vn: places[1].name } : {}) }) },
    save: { kind: "saveTrip", ...base, href: askHref("#/trip", { ...base, save: 1 }) },
  };
}
function askChainDecorate(d, now, cards, links) {
  const js = askNotPast((d.journeys || []).map((j) => ({ ...j, planned: j.leave })), now - 60000);
  // Lead with the first trip that no later departure beats on arrival.
  const j = js.find((x) => !x.beaten) || js[0];
  const U = d.understood;
  const all = [U.from, ...U.stops, U.to].map(askShort);
  const lines = [`${U.from} to ${U.to} via ${askJoin(U.stops.map(askShort))}.${d.modeNote ? " " + d.modeNote : ""}`, all.join(" > ")];
  if (!j) lines.push("No connecting trips found right now. Try a later time.");
  else {
    d.plan.forEach((L, k) => {
      const seg = j.legs.filter((l) => l.seg === k);
      const tl = seg.filter((l) => l.kind === "transit");
      const f = tl[0], z = tl[tl.length - 1];
      if (k && f && f.transfer) lines.push(`Change at ${askShort(L.fn)}: ${Math.max(0, f.transfer.minutes)} min${f.transfer.risk === "tight" ? ", tight" : f.transfer.risk === "miss" ? ", at risk" : ""}`);
      if (!f) { lines.push(`${k + 1}. Walk ${seg[0] ? seg[0].durationMin : L.w} min to ${askShort(L.tn)}`); return; }
      const svc = tl.map((l) => l.line || (l.modeName || l.mode || "service")).join(" then ");
      const st = askStatusWords(f);
      const stS = k === 0 ? ` ${cap(st)}.` : /late|early|cancel/.test(st) ? ` ${cap(st)}.` : "";
      lines.push(`${k + 1}. ${svc} from ${f.from || askShort(L.fn)}${askPlat(f.fromPlatform)} at ${hm(f.estimated || f.planned)}${k === 0 ? ` (${askWhen(f.estimated || f.planned)})` : ""}, arrive ${askShort(L.tn)} ${hm(z.arrEstimated || z.arrPlanned)}.${stS}${d.fallback && d.fallback[k] ? " No direct service on this leg, so it has a change." : ""}`);
    });
    lines.push(`Total ${j.durationMin} min, arriving ${askShort(U.to)} ${hm(j.arrive)}.`);
    if (j.warn && !/^Tight change/.test(j.warn)) lines.push(j.warn.replace(/\.$/, "") + ".");
  }
  const places = [d.from, ...d.stops, d.to];
  const geo = places.some((p) => /EPSG/.test(String(p && p.id)));
  const tl = geo ? null : askTripLinks(places, d.plan[0] && d.plan[0].m);
  cards.push({ type: "trip", title: all.join(" > "), titleOnly: true, from: d.from, to: d.to, stops: d.stops, chain: true, journeys: js.slice(0, 4).map((x) => ({ ...askJourneyOut(x), warn: x.warn || null, segs: x.segs || null })), link: tl ? tl.open : null });
  if (tl) { links.push({ label: "Open trip", ...tl.open }); links.push({ label: "Save trip", ...tl.save }); }
  return { reply: lines.join("\n").replace(/\.\./g, "."), sugg: [askChainQ([U.to, ...[...U.stops].reverse().map(askShort), U.from])] };
}

// The last service tonight from a to b (any transit, or only `mode`): {last, prev, next, sure} or null.
// opts.time ("HHMM", Sydney) asks from that time; without it from 11pm (or now, when it is already late).
async function lastFind(env, a, b, mode, opts = {}) {
  const sn = sydneyNow();
  const base = { fromType: a.coord ? "coord" : undefined, count: 8, accessible: !!opts.accessible, timetable: false };
  const late = sn.tod >= 23 * 60 || sn.tod < 3 * 60;
  if (b.coord) base.toType = "coord";
  const first = await trip(env, a.id, b.id, opts.time ? { ...base, time: opts.time } : late ? base : { ...base, time: "2300" });
  const okMode = (j) => askTransit(j).length && (!mode || askTransit(j).every((l) => l.mode === mode || (mode === "train" && l.mode === "metro")));
  let all = (first.journeys || []).slice();
  const pickLast = (list) => {
    const s = list.filter(okMode).sort((x, y) => ms(x.leave) - ms(y.leave));
    // A gap of 3 hours or more is the night: the service before it is the last one tonight, not
    // the first one tomorrow morning that the planner may also list.
    const gap = s.findIndex((j, i) => i + 1 < s.length && ms(s[i + 1].leave) - ms(j.leave) >= 3 * 3600000);
    const li = gap >= 0 ? gap : s.length - 1;
    const last = s[li];
    if (!last) return null;
    const later = list.filter((j) => ms(j.leave) > ms(last.leave) && !okMode(j)).sort((x, y) => ms(x.leave) - ms(y.leave));
    const sure = gap >= 0 || list.some((j) => ms(j.leave) > ms(last.leave) + 60 * 60000);
    return { last, prev: s[li - 1] || null, next: later[0] || null, sure };
  };
  let found = pickLast(all);
  if ((!found || !found.sure) && all.length) {
    const lastLeave = new Date(Math.max(...all.map((j) => ms(j.leave))) + 60000);
    const p = sydneyParts(lastLeave);
    const more = await trip(env, a.id, b.id, { ...base, time: p.time });
    all = all.concat(more.journeys || []).filter((j, i, arr) => arr.findIndex((x) => x.leave === j.leave && x.arrive === j.arrive) === i);
    found = pickLast(all);
  }
  return found || null;
}

async function askLast(env, fromQ, toQ, ctx, mode) {
  const [a, b] = await Promise.all([typeof fromQ === "object" ? fromQ : askResolve(env, fromQ, ctx), typeof toQ === "object" ? toQ : askResolve(env, toQ, ctx)]);
  const lastP = { prefix: `last ${mode === "lightrail" ? "light rail" : mode || "train"} ` };
  if (a && a.ambiguous) return askDidYouMean("from", a, { from: null, to: typeof toQ === "string" ? toQ : b && b.name }, lastP);
  if (b && b.ambiguous) return askDidYouMean("to", b, { from: typeof fromQ === "string" ? fromQ : a && (a.label || a.name), to: null }, lastP);
  if (!a || a.needLocation) return { kind: "needOrigin", to: b && !b.needLocation ? b : null, last: true, mode };
  if (!b || b.needLocation) return { kind: "text", text: `I couldn't find a station, suburb or stop called "${toQ}".` };
  const found = await lastFind(env, a, b, mode, { accessible: !!ctx.accessible });
  return {
    kind: "lastService", mode: mode || null, from: { id: a.id, name: a.name }, to: { id: b.id, name: b.name },
    last: found ? found.last : null, before: found ? found.prev : null, after: found ? found.next : null, sure: !!(found && found.sure), now: Date.now(),
  };
}

async function askLineStatus(env, line, placeQ, ctx) {
  line = line.toUpperCase();
  let stops = [];
  if (placeQ) { const s = await findStops(env, placeQ); if (s.stops.length) stops = [{ id: s.stops[0].id, name: shortName(s.stops[0].name) }]; }
  if (!stops.length) {
    const h = ASK_LINE_HOME[line] || (/^F\d/.test(line) ? "Circular Quay Wharf" : null);
    const list = Array.isArray(h) ? h : h ? [h] : [];
    for (const x of list) {
      if (/^\d+$/.test(x)) stops.push({ id: x, name: x });
      else { const s = await findStops(env, x); if (s.stops.length) stops.push({ id: s.stops[0].id, name: shortName(s.stops[0].name) }); }
    }
  }
  const excl = ASK_EXCL[askLineMode(line)];
  const [al, ...deps] = await Promise.all([alertsCached(env, line).catch(() => ({ items: [], total: 0 })), ...stops.map((s) => departures(env, s.id, { log: false, extra: excl }).catch(() => null))]);
  const now = Date.now();
  const hot = (a) => (/\b(late|delay|cancel|replac|not run|changed timetable|trackwork|disrupt|suspend)/i.test(a.title) ? 0 : 1) + (a.lines && a.lines.length && a.lines[0] === line ? 0 : 0.5);
  if (al.items) al.items = al.items.slice().sort((x, y) => hot(x) - hot(y));
  const seen = new Set();
  let items = [];
  const used = [];
  deps.forEach((dep, i) => {
    if (!dep) return;
    const mine = askNotPast(dep.items.filter((it) => String(it.line).toUpperCase() === line), now).filter((it) => ms(it.estimated || it.planned) - now < 90 * 60000);
    if (mine.length) used.push({ id: stops[i].id, name: dep.stop.name || stops[i].name });
    for (const it of mine) { const k = it.tripId || it.planned + it.dest; if (!seen.has(k)) { seen.add(k); items.push(it); } }
  });
  items.sort((a, b) => ms(a.estimated || a.planned) - ms(b.estimated || b.planned));
  items = items.slice(0, 10);
  const first = used[0] || (stops[0] ? { id: stops[0].id, name: (deps[0] && deps[0].stop.name) || stops[0].name } : null);
  return { kind: "lineStatus", line, color: items[0] ? items[0].color : lineColor(line, null), stop: first, stops: used, items, alerts: al.items || [], alertTotal: al.total || 0, now };
}

async function askRouteAt(env, line, placeQ, ctx) {
  line = line.toUpperCase();
  let cands = [];
  if (placeQ && /^\d{5,8}$/.test(placeQ)) cands = [{ id: placeQ, name: placeQ }];
  else if (placeQ) cands = (await findStops(env, placeQ)).stops.slice(0, 3).map((s) => ({ id: s.id, name: shortName(s.name) }));
  else if (ctx.lat && ctx.lon) cands = (await nearby(env, ctx.lat, ctx.lon)).slice(0, 4);
  if (!cands.length) return placeQ ? { kind: "text", text: `I couldn't find a stop called "${placeQ}".` } : { kind: "needStop", line };
  const now = Date.now();
  for (const c of cands) {
    const d = await departures(env, c.id, { log: false, extra: ASK_EXCL[askLineMode(line)] }).catch(() => null);
    if (!d) continue;
    let items = askNotPast(d.items.filter((i) => String(i.line).toUpperCase() === line), now);
    if (!items.length) items = askNotPast(d.items.filter((i) => String(i.line).toUpperCase().startsWith(line)), now);
    const base = String(d.stop.name || c.name).split(",")[0].replace(/\s+Station$/i, "").toLowerCase();
    const going = items.filter((i) => !String(i.dest || "").toLowerCase().startsWith(base));
    if (going.length) items = going;
    if (items.length) return { kind: "routeAt", line, stop: { id: c.id, name: d.stop.name || c.name }, items: items.slice(0, 6), alerts: d.alerts.filter((a) => a.lines.includes(line)).slice(0, 3), now };
  }
  return { kind: "routeAt", line, stop: { id: cands[0].id, name: cands[0].name }, items: [], alerts: [], now, nearbyTried: !placeQ };
}

// The trip inside a fare question, or null: "how much is the fare from Central to Parramatta" gives
// "Central to Parramatta"; "Opal fare to Bondi from Central" gives "Bondi from Central".
function askFareQ(text) {
  const t = String(text || "").trim().replace(/[?.!]+$/, "");
  if (!/\b(fares?|how much|costs?|price)\b/i.test(t) || !/\s(to|>|->)\s/i.test(t)) return null;
  const fm = t.match(/\bfrom\s+(.+?\s(?:to|>|->)\s.+)$/i);
  let rest = fm ? fm[1] : t.replace(/^.*?\b(?:fares?|costs?|price|how much)\b\s*/i, "");
  for (let k = 0; k < 4; k++) rest = rest.replace(/^(?:is it|does it cost|would it cost|will it cost|it cost|it|is|be|of|for|the|a|an|to go|to get|to travel|trip|ride|journey|opal|fares?)\s+/i, "");
  if (/^to\s/i.test(rest) && /\sfrom\s/i.test(rest)) rest = rest.replace(/^to\s+/i, "");
  rest = rest.trim();
  return rest && /\s(to|>|->|from)\s/i.test(rest) ? rest : null;
}
const ASK_NOT_UNDERSTOOD = `I didn't get that. Try a station like "Strathfield", a trip like "Burwood to Central", "Is the T1 late" or a stop number from the sign.`;
async function askRoute(env, raw, ctx) {
  const text = askClean(raw);
  const lower = text.toLowerCase();
  if (!text) return { kind: "help" };
  if (/^(thanks|thank you|cheers|ta|thx)$/i.test(lower)) return { kind: "text", text: "No worries." };

  // Fare questions ("how much is the fare from Central to Parramatta", "fare Central to Parramatta") are trips that lead with the fare.
  const fq = askFareQ(text);
  if (fq) { const r = await askRoute(env, fq, ctx); if (r && r.kind === "trip") r.fareAsked = true; return r; }

  // Parking, lifts and step free access, top up machines (facilities block below).
  const fx = await askFacilities(env, text, ctx);
  if (fx) return fx;

  // "last train home", "last bus to Central", "when's the last train from Central to Burwood"
  const lm = lower.match(/^(?:when(?:'s| is)\s+|what time is\s+)?(?:the\s+)?last\s+(train|bus|metro|ferry|light rail|service|one)?\s*(.*)$/i);
  if (lm) {
    const mode = lm[1] && ASK_MODE_OF[lm[1]] ? ASK_MODE_OF[lm[1]] : null;
    let rest = lm[2].replace(/\b(tonight|today)\b/g, "").trim();
    let fromQ = null, toQ = null;
    const ft = rest.match(/^from\s+(.+?)\s+to\s+(.+)$/) || rest.match(/^(.+?)\s+to\s+(.+)$/);
    if (ft && !/^home$/.test(ft[1])) { fromQ = ft[1]; toQ = ft[2]; }
    else {
      const hf = rest.match(/^(?:to\s+)?(.+?)(?:\s+from\s+(.+))?$/);
      toQ = hf ? hf[1] : rest; fromQ = hf && hf[2] ? hf[2] : null;
    }
    toQ = (toQ || "home").trim();
    if (/^home$/.test(toQ) && !ctx.home) return { kind: "needHome" };
    const from = fromQ ? fromQ : ctx.lat && ctx.lon ? { id: `${ctx.lon}:${ctx.lat}:EPSG:4326`, name: "Your location", coord: true } : (toQ === "home" && ctx.work ? ctx.work : null);
    if (!from) return { kind: "needOrigin", to: toQ === "home" ? ctx.home : null, toQ, last: true, mode };
    return askLast(env, from, toQ, ctx, mode);
  }

  // Trips: "next train Burwood to Central", "how do I get from A to B", "Burwood to Central at 9am",
  // "I need to go to Campsie to Newcastle via Chatswood", "to Central from Burwood".
  let tripText = text.replace(/^(?:(?:when(?:'s| is)|what(?:'s| is))\s+)?(?:the\s+(?=(?:next|first|earliest|fastest|train|bus|metro|ferry|light rail|tram|service|trip|way)\b))?(?:next|first|earliest|fastest)?\s*(?:train|bus|metro|ferry|light rail|tram|service|trip|way)?\s*(?:from\s+)?/i, "");
  const tv = tripText.match(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:tell me\s+)?(?:how (?:do|can|would|should) i (?:get|go|travel)|how to (?:get|go)|how (?:long|far) (?:is it|does it take)(?: to get)?|get me|take me|show me (?:how to get|the way)|directions|route|plan (?:a |my )?(?:trip|journey|route)|i (?:need|want|have|got) to (?:get|go|travel|head)|i (?:wanna|gotta) (?:get|go)|i(?:'m| am) (?:going|heading|travelling|traveling)|going|heading|travel|get)\b\s*/i);
  const travel = !!(tv && tv[0].trim());
  if (travel) tripText = tripText.slice(tv[0].length);
  const mode = askModeIn(text);
  const t = parseTime(tripText);
  const lineQ = /^(is|are|any|hows?|how's)\b/i.test(text) && ASK_LINE.test(text);
  const pt = /^(save|alerts?)\b/i.test(lower) || lineQ ? null : askParseTrip(t.rest, travel);
  const lineTok = (s) => /^(T\d|M1|L\d|F\d+|\d{3}[A-Z]?)$/i.test(String(s || ""));
  const topt = { mode, time: t.time, arriveBy: t.arriveBy, via: pt && pt.via };
  if (pt && pt.from && pt.to && pt.stops.length > 1 && !lineTok(pt.from)) return askChain(env, [pt.from, ...pt.stops, pt.to], ctx, topt);
  if (pt && pt.from && pt.to && !lineTok(pt.from)) return askTrip(env, pt.from, pt.to, ctx, topt);
  if (pt && !pt.from && pt.to && (travel || tripText !== text || /^to\s/i.test(t.rest) || pt.stops.length)) {
    if (ctx.lat && ctx.lon && pt.stops.length < 2) return askTrip(env, "here", pt.to, ctx, topt);
    const b = await askResolve(env, pt.to, ctx);
    if (b && b.ambiguous) return askDidYouMean("to", b, { from: null, to: null, via: pt.via }, topt);
    if (!b) return { kind: "text", text: `I couldn't find a station, suburb or stop called "${pt.to}".` };
    const vt = pt.stops.length ? askJoin(pt.stops) : null;
    return { kind: "needOrigin", to: askPlaceOut(b), via: vt ? vt.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/ And /g, " and ") : null };
  }
  const fo = text.match(/^(?:i'?m\s+|i am\s+)?(?:leaving\s+|going\s+)?from\s+(.+)$/i);
  if (fo && !/\s(to|via)\s/i.test(fo[1]) && !lineTok(fo[1])) {
    const a = await askResolve(env, fo[1], ctx);
    if (a && a.ambiguous) return askDidYouMean("from", a, { from: null, to: "Central" }, topt);
    if (a && !a.needLocation) return { kind: "needDest", from: askPlaceOut(a) };
  }

  // A line: "is the T1 late", "T4 status", "when's the 461 from Burwood", "461 at Burwood"
  const lineM = text.match(ASK_LINE);
  if (lineM && !/^\d{5,8}$/.test(text)) {
    const line = lineM[1].toUpperCase();
    const placePart = text.replace(lineM[0], " ").replace(/\b(is|are|the|a|an|when'?s|when|what'?s|whats|what time|next|upcoming|line|route|bus|buses|train|trains|metro|ferry|light rail|service|services|running|late|delay(s|ed)?|on time|status|ok(ay)?|working|problems?|issues?|trackwork|disruptions?|alerts?|slow|any|how'?s|how|today|now|leaving|leave|coming|come|does|do|it)\b/gi, " ")
      .replace(/^\s*(from|at|near|for|on)\s+/i, "").replace(/\s+/g, " ").trim().replace(/^(from|at|near|for|on)\s+/i, "");
    const isStatus = ASK_STATUS_WORDS.test(text) || text.trim().toUpperCase() === line;
    const trainish = /^(T\d|M1|L\d|F\d+|BMT|CCN|SCO|HUN|SHL|BNT)$/.test(line);
    if (isStatus && (trainish || !placePart)) return askLineStatus(env, line, placePart || null, ctx);
    return askRouteAt(env, line, placePart || null, ctx);
  }

  return answer(env, text, ctx);
}

function askDecorate(d, ctx) {
  const now = Date.now();
  d.v = 2;
  const cards = [], links = [];
  let reply = "", sugg = [];
  switch (d.kind) {
    case "help":
      reply = "Ask me about any train, bus, ferry or light rail in NSW. I answer from live Transport for NSW data.";
      sugg = ["Next train Burwood to Central", "When's the 461 from Burwood", "Is the T1 late", "Departures Strathfield", "Last train home"];
      break;
    case "text": case "error":
      reply = d.text; break;
    case "facility":
      reply = d.text;
      for (const c of d.cards || []) cards.push(c);
      for (const l of d.links || []) links.push(l);
      sugg = d.suggestions || [];
      break;
    case "needLocation":
      reply = "I need your location for that. Allow location, or name a station."; d.ask = "location"; break;
    case "needOrigin":
      reply = d.to ? `Where from? Share your location, or ask like "Burwood to ${d.to.label || d.to.name}${d.via ? " via " + d.via : ""}".` : "Where from? Share your location, or name the start station.";
      d.ask = "location"; break;
    case "needHome":
      reply = "Set your home station first, then ask again. You can set Home on the Trips screen, or say \"save Central to Burwood as home\".";
      sugg = ["Save Central to Burwood as home"]; break;
    case "needStop":
      reply = `Which stop? Ask like "${d.line} from Burwood", or allow location and I'll check stops near you.`; d.ask = "location"; break;
    case "savedList":
      reply = d.items.length ? "Your saved trips: " + d.items.map((s) => s.name).join(", ") + "." : "No saved trips yet.";
      for (const s of d.items) links.push({ label: `${cap(s.name)}: ${s.from.name} to ${s.to.name}`, ...askTripLink(s.from, s.to) });
      break;
    case "departures": {
      const items = askNotPast(d.items || [], now).filter((i) => !i.cancelled || true).slice(0, 6);
      const title = d.byNumber && d.stop.exactName ? d.stop.exactName : d.stop.name;
      const f = items.find((i) => !i.cancelled);
      reply = f ? `${title}: next is the ${f.line} to ${f.dest} ${askWhen(f.estimated || f.planned)} (${hm(f.estimated || f.planned)}${askPlat(f.platform)}), ${askStatusWords(f)}.` : `${title}: no upcoming services found right now.`;
      cards.push({ type: "departures", title, stop: { id: d.stop.id, name: title }, items: items.map(askDep), link: askStopLink(d.stop.id, title) });
      links.push({ label: "Open board", ...askStopLink(d.stop.id, title) });
      if (d.alternatives && d.alternatives.length) sugg = d.alternatives.slice(0, 2).map((a) => "Departures " + a.name);
      break;
    }
    case "routeAt": {
      const f = d.items.find((i) => !i.cancelled);
      if (f) {
        const nx = d.items.filter((i) => i !== f && !i.cancelled).slice(0, 2).map((i) => hm(i.estimated || i.planned));
        reply = `The next ${f.line} from ${d.stop.name} leaves ${askWhen(f.estimated || f.planned)} (${hm(f.estimated || f.planned)}${askPlat(f.platform)}) to ${f.dest}, ${askStatusWords(f)}.` + (nx.length ? ` Then ${nx.join(" and ")}.` : "");
      } else reply = d.nearbyTried ? `I couldn't see a ${d.line} at the stops near you in the next hour. Ask like "${d.line} from Burwood".` : `No ${d.line} departures from ${d.stop.name} in the next hour or so. It may stop at another stand nearby.`;
      if (d.alerts && d.alerts.length) reply += ` ${d.alerts.length} alert${d.alerts.length > 1 ? "s" : ""} for this route.`;
      if (d.items.length) cards.push({ type: "departures", title: `${d.line} from ${d.stop.name}`, stop: d.stop, items: d.items.map(askDep), link: askStopLink(d.stop.id, d.stop.name) });
      if (d.alerts && d.alerts.length) cards.push({ type: "alerts", items: d.alerts.map((a) => ({ title: a.title, url: httpsUrl(a.url), lines: a.lines || [] })) });
      links.push({ label: "Open board", ...askStopLink(d.stop.id, d.stop.name) });
      if (f) links.push({ label: `Track this ${d.line}`, ...askSvc(f) });
      break;
    }
    case "lineStatus": {
      const live = d.items.filter((i) => i.realtime && !i.cancelled);
      const late = live.filter((i) => (i.delayMin || 0) >= 3).sort((a, b) => b.delayMin - a.delayMin);
      const canc = d.items.filter((i) => i.cancelled);
      const at = d.stops && d.stops.length > 1 ? ` at ${d.stops.map((s) => s.name.replace(/ Station$/, "")).join(" and ")}` : d.stop ? ` from ${d.stop.name}` : "";
      if (!d.stop) reply = `Live times for the ${d.line} need a stop. Ask like "${d.line} from Burwood".`;
      else if (!d.items.length) reply = `No ${d.line} services${at} in the next 90 min.`;
      else if (!live.length && !canc.length) reply = `No live data for the ${d.line}${at} right now, only timetable times.`;
      else if (!late.length && !canc.length) reply = `The ${d.line} looks on time. ${live.length === 1 ? "The one live service" : live.length === 2 ? "Both live services" : `All ${live.length} live services`}${at} ${live.length === 1 ? "is" : "are"} within 2 min.`;
      else {
        const w = late[0];
        reply = `The ${d.line} has some delays${at}: ` + [late.length ? `${late.length} of ${live.length} live services late, the worst ${w.delayMin} min (${hm(w.planned)} to ${w.dest})` : "", canc.length ? `${canc.length} cancelled` : ""].filter(Boolean).join(", ") + ".";
      }
      if (d.alertTotal) reply += ` ${d.alertTotal} alert${d.alertTotal > 1 ? "s" : ""}: ${d.alerts[0].title.length > 110 ? d.alerts[0].title.slice(0, 107).replace(/\s+\S*$/, "") + "..." : d.alerts[0].title}`;
      else reply += " No alerts for this line.";
      if (d.items.length) cards.push({ type: "departures", title: `${d.line}${at}`, stop: d.stop, items: d.items.slice(0, 6).map(askDep), link: askStopLink(d.stop.id, d.stop.name) });
      if (d.alerts.length) cards.push({ type: "alerts", items: d.alerts.slice(0, 2).map((a) => ({ title: a.title, url: httpsUrl(a.url), lines: a.lines || [] })) });
      if (d.stop) links.push({ label: "Open board", ...askStopLink(d.stop.id, d.stop.name) });
      if (d.alerts.length) links.push({ kind: "alerts", label: "All alerts", href: "#/alerts" });
      break;
    }
    case "trip": {
      if (d.chain && d.understood && d.plan) { ({ reply, sugg } = askChainDecorate(d, now, cards, links)); break; }
      const js = askNotPast((d.journeys || []).map((j) => ({ ...j, planned: j.leave })), now - 60000);
      const j = js[0];
      const U = d.understood || { from: askLabel(d.from), to: askLabel(d.to), via: d.via ? askLabel(d.via) : null };
      const viaS = U.via ? ` via ${askShort(U.via)}` : "";
      const head = U.from === "your location" ? `From your location to ${U.to}${viaS}.` : `${U.from} to ${U.to}${viaS}.`;
      const geo = (p) => /EPSG/.test(String(p && p.id));
      if (!j) reply = `${head} No trips found right now.`;
      else {
        const tl = askTransit(j)[0];
        const ch = j.changes ? ` with ${j.changes} change${j.changes > 1 ? "s" : ""}` : "";
        reply = head + " " + (d.modeNote ? d.modeNote + " " : "") + (tl
          ? `Next: the ${askLineName(tl.line) || tl.line} from ${tl.from || askShort(d.from.name)}${askPlat(tl.fromPlatform)} at ${hm(tl.estimated || tl.planned)}${ms(j.leave) < ms(tl.planned) - 60000 ? ` (leave ${askWhen(j.leave)})` : ` (${askWhen(tl.estimated || tl.planned)})`}, arriving ${d.to.name} ${hm(j.arrive)}${ch}. ${cap(askStatusWords(tl))}.`
          : `Leave ${askWhen(j.leave)} (${hm(j.leave)}), arrive ${hm(j.arrive)}.`);
      }
      const tlink = geo(d.from) || geo(d.to) ? null : askTripLink(d.from, d.to);
      // A via trip opens and saves as a two leg trip.
      const vlinks = tlink && d.via && !geo(d.via) ? askTripLinks([d.from, d.via, d.to]) : null;
      if (vlinks) Object.assign(tlink, vlinks.open);
      cards.push({ type: "trip", ...(viaS ? { title: viaS.trim().replace(/^v/, "V") } : {}), from: d.from, to: d.to, via: d.via || null, journeys: js.slice(0, 4).map(askJourneyOut), link: tlink });
      if (tlink) links.push({ label: "Open trip", ...tlink });
      if (vlinks) links.push({ label: "Save trip", ...vlinks.save });
      if (j && askTransit(j)[0] && askTransit(j)[0].tripId) links.push({ label: "Live map", ...askSvc(askTransit(j)[0]) });
      if (!askIsHere(d.from)) sugg = [`${U.to} to ${U.from}${viaS}`];
      break;
    }
    case "didYouMean": {
      const names = d.options.map((x) => x.name);
      const list = names.length > 1 ? names.slice(0, -1).join(", ") + " or " + names[names.length - 1] : names[0];
      const role = d.role === "from" ? "start" : d.role === "via" ? "via stop" : d.role === "stop" ? "stop" : "destination";
      reply = `I'm not sure which ${role} you mean by "${d.q}". Did you mean ${list}?`;
      sugg = d.suggestions || [];
      break;
    }
    case "needDest":
      reply = `Where to from ${askLabel(d.from)}? Ask like "${askShort(askLabel(d.from))} to Central".`;
      sugg = [`${askLabel(d.from)} to Central`, `Departures ${askLabel(d.from)}`];
      break;
    case "lastService": {
      const noun = d.mode === "train" ? "train" : d.mode || "service";
      const l = d.last;
      if (!l) reply = `I couldn't find a late ${noun} from ${d.from.name} to ${d.to.name} tonight.`;
      else {
        const tl = askTransit(l)[0];
        const gone = ms(l.leave) < now;
        reply = (gone ? `The last ${noun} from ${askFromName(d.from)} to ${d.to.name} has gone. ` : `${d.sure ? "Last" : "Latest I can see for the last"} ${noun} from ${askFromName(d.from)} to ${d.to.name}: `) +
          (gone ? "" : `leave ${hm(l.leave)}, arrive ${hm(l.arrive)}` + askLinesWords(l) + ".") +
          (d.after ? ` After that: ${askTransit(d.after).filter((x) => x.mode === "bus").map((x) => x.line).join(" then ") || askTransit(d.after).map((x) => x.line).join(" then ")} ${askTransit(d.after).some((x) => x.mode === "bus") ? "bus " : ""}at ${hm(askTransit(d.after).filter((x) => x.mode === "bus")[0] ? askTransit(d.after).filter((x) => x.mode === "bus")[0].planned : d.after.leave)}.` : "");
      }
      const js = [d.before, d.last, d.after].filter(Boolean);
      if (js.length) cards.push({ type: "trip", title: `Last ${noun}`, from: d.from, to: d.to, highlight: d.before ? 1 : 0, journeys: js.map(askJourneyOut), link: /EPSG/.test(String(d.from.id)) ? null : askTripLink(d.from, d.to) });
      if (!/EPSG/.test(String(d.from.id))) links.push({ label: "Open trip", ...askTripLink(d.from, d.to) });
      // Last way home: the app offers "Remind me 15 min before" only when this is here (POST /api/last-home).
      if (l && ms(l.leave) - now > (LAST_HOME_LEAD + 1) * 60000 && ms(l.leave) - now < LAST_HOME_MAX_AHEAD) {
        d.lastHome = { from: d.from, to: d.to, mode: d.mode || null, leave: l.leave, lead: LAST_HOME_LEAD };
      }
      break;
    }
    case "alerts":
      reply = d.items.length ? `${d.total} current alert${d.total > 1 ? "s" : ""}${d.filter ? " for " + d.filter : ""}. Top one: ${d.items[0].title}` : "No current alerts for that.";
      if (d.items.length) cards.push({ type: "alerts", items: d.items.slice(0, 5).map((a) => ({ title: a.title, url: httpsUrl(a.url), lines: a.lines || [] })) });
      links.push({ kind: "alerts", label: "All alerts", href: "#/alerts" });
      break;
    case "nearby":
      reply = d.stops.length ? `Closest to you: ${d.stops.slice(0, 3).map((s) => `${s.name} (${s.distance} m)`).join(", ")}.` : "No stops found near you.";
      cards.push({ type: "stops", items: d.stops.slice(0, 5).map((s) => ({ id: s.id, name: s.name, distance: s.distance, link: askStopLink(s.id, s.name) })) });
      break;
    default:
      reply = "Something went wrong there. Try again in a moment.";
  }
  d.reply = reply; d.cards = cards; d.links = links; d.suggestions = sugg;
  return d;
}

async function askV2(env, q, ctx) {
  let d;
  try { d = await askRoute(env, q, ctx); }
  catch (e) {
    const down = typeof ttUpstreamDown === "function" && ttUpstreamDown(e);
    d = { kind: "error", upstream: !!down, text: down ? "Transport for NSW's live data isn't answering right now, so I can't check that. It's not your connection. Try again soon." : "Something went wrong on our side. Try again in a moment.", detail: String(e && e.message || e).slice(0, 200) };
  }
  return askDecorate(d || { kind: "help" }, ctx);
}
const ASK_V2_KINDS = new Set(["lineStatus", "routeAt", "lastService", "needOrigin", "needHome", "needStop"]);
async function askText(env, d) {
  if (ASK_V2_KINDS.has(d.kind)) {
    const extra = (d.cards || []).filter((c) => c.type === "departures").flatMap((c) => c.items.slice(0, 4).map((i) => `${i.line} to ${i.dest}${i.platform ? " (" + i.platform + ")" : ""}: ${inMins(i.estimated || i.planned)}, ${hm(i.estimated || i.planned)}, ${askStatusWords(i)}`));
    return [d.reply, ...extra].join("\n");
  }
  if (d.kind === "didYouMean" || d.kind === "needDest") return [d.reply, ...(d.suggestions || [])].join("\n");
  if (d.kind === "trip" && d.chain && d.reply) return d.reply;
  if (d.kind === "trip" && (d.modeNote || d.via)) return [d.via ? `Via ${askShort(askLabel(d.via))}` : "", d.modeNote || "", await asText(env, d)].filter(Boolean).join("\n");
  return asText(env, d);
}
// ---- ask end

// ---------- plain text answers (WhatsApp, Telegram, SMS) ----------

function hm(t) {
  if (Number.isFinite(+t) && t !== null && t !== "") return clockOf(t, false);
  return dtf("en-AU", CLOCK_OPTS).format(new Date(t)).replace(/\s/g, "").toLowerCase();
}
function hms(t) {
  if (Number.isFinite(+t) && t !== null && t !== "") return clockOf(t, true);
  return dtf("en-AU", CLOCK_S_OPTS).format(new Date(t)).replace(/\s/g, "").toLowerCase();
}
function inMins(t) {
  const m = Math.round((ms(t) - Date.now()) / 60000);
  if (m <= 0) return "now";
  if (m < 60) return m + " min";
  return Math.floor(m / 60) + " h " + (m % 60) + " min";
}
function liveWord(it) {
  if (it.cancelled) return "CANCELLED";
  if (it.skipped) return "not stopping here";
  if (!it.realtime) return "scheduled, no live data";
  const s = statusOf(it);
  return "Live, " + s.text.toLowerCase();
}

// Short description of where a live vehicle is, using the trip update stop list.
async function vehicleWhere(env, rt, it) {
  if (!it.vehicle) return null;
  const tu = rt.tu(it.mode, it.line, it.tripId, it.feed);
  if (!tu || !tu.stus.length) return null;
  let ni = nextStopIndex(tu, it.vehicle);
  const ids = tu.stus.map((u) => u.stopId);
  const info = await stopInfo(env, ni >= 0 ? [ids[ni]] : ids);
  if (ni < 0) {
    const pts = ids.map((id) => info[id] ? { id, ...info[id] } : null).filter(Boolean);
    const g = locateGeom(it.vehicle, pts);
    if (g < 0) return null;
    ni = ids.indexOf(pts[g].id);
  }
  const noun = (Object.values(MODES).find((m) => m.key === it.mode) || { noun: "service" }).noun;
  const mine = ids.indexOf(it.stopId);
  if (mine >= 0 && ni > mine && ms(it.estimated || it.planned) > Date.now()) ni = mine;
  const nextId = ids[ni];
  const name = info[nextId] ? info[nextId].name.split(",").slice(0, 2).join(",") : null;
  if (!name) return null;
  const away = mine >= 0 && mine >= ni ? mine - ni : it.stopsAway;
  if (away === 0) return `${noun} is arriving`;
  return `${noun} next stop ${name}${away ? ", " + away + " stop" + (away > 1 ? "s" : "") + " away" : ""}`;
}

async function asText(env, d, limit = 6) {
  switch (d.kind) {
    case "help":
      return "Hi, this is Transport: Sydney Live. Send a stop number from the sign (like 213516), a station (like Strathfield), or a trip like Burwood to Central. Save a trip with: save Burwood to Central as home. Then just send home.";
    case "text": case "error":
      return d.text;
    case "needLocation":
      return "Send a station name or stop number instead (location only works in the app).";
    case "savedList":
      return d.items.length ? "Saved trips:\n" + d.items.map((s) => `${s.name}: ${s.from.name} to ${s.to.name}`).join("\n") : "No saved trips yet. Try: save Burwood to Central as home";
    case "departures": {
      const title = d.byNumber && d.stop.exactName ? d.stop.exactName : d.stop.name;
      const items = d.items.slice(0, limit);
      const rt = await realtimeFor(env, items.filter((i) => i.vehicle).slice(0, 3).map((i) => [i.mode, i.line, i.feed]));
      const lines = [];
      let described = 0;
      for (const it of items) {
        const t = it.estimated || it.planned;
        let s = `${it.line} to ${it.dest}${it.platform ? " (" + it.platform + ")" : ""}: ${inMins(t)}, ${hm(t)}, ${liveWord(it)}`;
        if (it.platformChangedFrom) s += `, platform changed from ${it.platformChangedFrom}`;
        if (it.realtime && it.vehicle && described < 2) {
          const w = await vehicleWhere(env, rt, it).catch(() => null);
          if (w) { s += `. ${w[0].toUpperCase() + w.slice(1)}`; described++; }
        }
        lines.push(s);
      }
      const head = (d.byNumber ? `It looks like you have entered a ${d.stopType || "stop"} number.\n` : "") + `${title} (${d.stop.id})`;
      return [head, ...(lines.length ? lines : ["No upcoming services found right now."]), `Updated ${hms(d.now || Date.now())}`].join("\n");
    }
    case "trip": {
      const name = d.saved ? d.saved[0].toUpperCase() + d.saved.slice(1) + ": " : "";
      if (!d.journeys.length) return `${name}No trips found from ${d.from.name} to ${d.to.name} right now.`;
      const when = d.when ? (d.when.arriveBy ? ", arrive by " : ", leave at ") + d.when.time.slice(0, 2) + ":" + d.when.time.slice(2) + (d.when.tomorrow ? " tomorrow" : "") : "";
      const out = [(d.savedNow ? "Saved. " : "") + `${name}${d.from.name} to ${d.to.name}${when}`];
      d.journeys.slice(0, 4).forEach((j, i) => {
        const tl = j.legs.filter((l) => l.kind === "transit");
        const first = tl[0];
        const legs = tl.map((l) => `${l.line}${l.fromPlatform ? " " + l.fromPlatform : ""} ${hm(l.estimated || l.planned)} ${l.realtime ? "Live" : "Sched"}${l.delayMin >= 2 ? " +" + l.delayMin : ""}${l.cancelled ? " CANCELLED" : ""}${l.transfer && l.transfer.risk !== "ok" ? " (" + (l.transfer.risk === "miss" ? "connection at risk" : "tight change") + ")" : ""}`);
        const leave = d.when ? hm(j.leave) : `leave in ${inMins(j.leave)} (${hm(j.leave)})`;
        const noun = first ? (Object.values(MODES).find((m) => m.key === first.mode) || { noun: "service" }).noun : "";
        const where = i < 2 && first && first.realtime && first.vehicle && first.stopsAway != null ? ` Your ${noun} is ${first.stopsAway === 0 ? "arriving" : first.stopsAway + " stop" + (first.stopsAway > 1 ? "s" : "") + " away"}.` : "";
        out.push(`${i + 1}. ${leave}, arrive ${hm(j.arrive)}, ${j.durationMin} min. ${legs.join(", then ")}.${where}`);
      });
      out.push(`Updated ${hms(d.now || Date.now())}`);
      return out.join("\n");
    }
    case "service": {
      const s = d;
      const noun = (Object.values(MODES).find((m) => m.key === s.mode) || { noun: "service" }).noun;
      const parts = [`${s.line}${s.dest ? " to " + s.dest : ""}: ${s.cancelled ? "CANCELLED" : s.live ? "Live" + (s.delayMin >= 2 ? ", " + s.delayMin + " min late" : s.delayMin <= -2 ? ", " + -s.delayMin + " min early" : ", on time") : "scheduled, no live data"}.`];
      if (s.where) parts.push(`${noun[0].toUpperCase() + noun.slice(1)} now: ${s.where.text}.`);
      else if (!s.vehicle) parts.push(`No live position for this ${noun} yet.`);
      if (s.mine && !s.mine.passed) parts.push(`At ${s.mine.name.split(",")[0]} ${hm(s.mine.estimated || s.mine.planned)} (${inMins(s.mine.estimated || s.mine.planned)}${s.stopsAway != null ? ", " + (s.stopsAway === 0 ? "arriving" : s.stopsAway + " stop" + (s.stopsAway > 1 ? "s" : "") + " away") : ""}).`);
      if (s.vehicle && s.vehicle.occupancy) parts.push(s.vehicle.occupancy.text + ".");
      return parts.join(" ");
    }
    case "alerts":
      if (!d.items.length) return "No current alerts for that.";
      return ["Current alerts:", ...d.items.slice(0, 5).map((a) => `${a.lines.length ? a.lines.join(", ") + ": " : ""}${a.title}`)].join("\n");
    case "nearby":
      return ["Closest stops:", ...d.stops.map((s) => `${s.name} (${s.id}), ${s.distance} m`)].join("\n");
    default:
      return "Something went wrong there. Try again in a moment.";
  }
}

// ---------- HTTP ----------

// ---------- proactive layer: Web Push, watched trips, commutes, predictions ----------
// A minute scheduler (GET /api/tick?key=...) follows every watched trip and commute
// through the shared feed cache and sends phone notifications with Web Push.

// Secrets: build.mjs writes them in for a single file deploy; a wrangler deploy leaves the
// placeholders and sets Worker secrets of the same names instead, read by applyEnv on each request.
let VAPID_PUBLIC = "__VAPID_PUBLIC_KEY__";
let VAPID_PRIVATE = "__VAPID_PRIVATE_KEY__";
let VAPID_SUBJECT = "__VAPID_SUBJECT__";
let TICK_KEY = "__TICK_KEY__";
let ADMIN_KEY = "__ADMIN_KEY__";
// A placeholder that was never filled is no secret at all, so it can never match a request.
const unfilled = (v) => !v || /^__[A-Z0-9_]+__$/.test(String(v));
function applyEnv(env) {
  if (!env) return;
  if (env.VAPID_PUBLIC_KEY) VAPID_PUBLIC = env.VAPID_PUBLIC_KEY;
  if (env.VAPID_PRIVATE_KEY) VAPID_PRIVATE = env.VAPID_PRIVATE_KEY;
  if (env.VAPID_SUBJECT) VAPID_SUBJECT = env.VAPID_SUBJECT;
  if (env.TICK_KEY) TICK_KEY = env.TICK_KEY;
  if (env.ADMIN_KEY) ADMIN_KEY = env.ADMIN_KEY;
}

// ---------- security helpers ----------
// Admin and scheduler keys are compared in constant time. The key can come from the
// x-admin-key header (preferred, kept out of logs and history) or the ?key= query (cron).
function safeEq(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || !b || unfilled(b)) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i % a.length) || 0) ^ (b.charCodeAt(i % b.length) || 0);
  return diff === 0;
}
// Keys are only read from the x-admin-key header, never from the address, so they stay out of
// access logs and browser history. The cron service sends TICK_KEY the same way.
function keyOk(request, p, secret) { return safeEq(request && request.headers.get("x-admin-key"), secret); }
function adminOk(request) { return keyOk(request, null, ADMIN_KEY); }
// Per isolate request limits: a cheap brake on scripted abuse of the shared Transport for NSW
// quota, the contact form and test pushes. Keyed by client IP, never stored.
const rateMem = new Map();
const RATE_RULES = [
  [/^\/api\/feedback$/, "feedback", 5, 600000, "POST"],
  [/^\/api\/push\/test$/, "pushtest", 5, 600000],
  [/^\/api\/watch$/, "watch", 30, 600000, "POST"],
  [/^\/api\/(saved|commutes|commutes\/dismiss|push\/subscribe|push\/expo|push\/expo\/unregister|push\/unsubscribe)$/, "write", 60, 600000, "POST"],
  [/^\/api\/(history\/delete|live-activity\/forget)$/, "delete", 10, 600000],
  [/^\/api\/hit$/, "hit", 120, 600000],
  [/^\/api\/pack$/, "pack", 300, 60000],
  [/^\/api\/share$/, "share", 20, 600000, "POST"],
  [/^\/api\/share\/update$/, "shareup", 240, 600000],
  [/^\/api\/share$/, "read", 600, 60000],
  [/^\/api\/(lifts\/alerts|parking\/watch|trip-alerts)$/, "write", 60, 600000, "POST"],
  [/^\/api\/morning-check$/, "write", 60, 600000, "POST"],
  [/^\/api\/morning-check$/, "write", 60, 600000, "DELETE"],
  [/^\/api\/morning-check\/preview$/, "mpreview", 20, 600000],
  // Live sockets (/api/live): opening one is a handful a minute per phone (a screen, a renewal every 10 minutes).
  [/^\/api\/live$/, "live", 30, 60000],
  [/^\/api\/(ask|trip|plan|departures|service|status|next|search|nearby|alerts|predict|obs|stations|station|parking|topup|lifts|usual)$/, "read", 600, 60000],
];
function rateOk(request, pathname) {
  const rule = RATE_RULES.find((r) => r[0].test(pathname) && (!r[4] || request.method === r[4]));
  if (!rule) return true;
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "?";
  const k = rule[1] + "|" + ip, now = Date.now();
  let e = rateMem.get(k);
  if (!e || now - e.at > rule[3]) { e = { at: now, n: 0 }; rateMem.set(k, e); }
  e.n++;
  if (rateMem.size > 5000) { for (const [kk, v] of rateMem) { if (now - v.at > 600000) rateMem.delete(kk); } if (rateMem.size > 5000) rateMem.clear(); }
  return e.n <= rule[2];
}
const API_SEC_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};
// Every HTML page is served by the worker, with the full header set. build.mjs fills PAGES with
// the built pages (path to html) and PAGE_CSP with the page policy, and leaves the html files out
// of the static assets, because the host serves static files before the worker runs and ignores
// a _headers file.
const PAGES = {} /*__PAGES__*/;
const PAGE_CSP = "default-src 'self'; frame-ancestors 'none'" /*__PAGE_CSP__*/;
const PAGE_SEC_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(self), microphone=(self), camera=(), payment=(), usb=(), browsing-topics=()",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
};
function pageHeaders(extra = {}) {
  return { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate", "content-security-policy": PAGE_CSP, ...PAGE_SEC_HEADERS, ...extra };
}
// Returns the page response for a path, a redirect to its canonical form, or null.
function servePage(request, url, status = 200) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const p = url.pathname;
  let html = PAGES[p];
  if (html == null) {
    let to = null;
    if (/\/index\.html?$/.test(p) && PAGES[p.replace(/index\.html?$/, "")] != null) to = p.replace(/index\.html?$/, "");
    else if (!p.endsWith("/") && PAGES[p + "/"] != null) to = p + "/";
    if (to) return new Response(null, { status: 301, headers: pageHeaders({ location: to + url.search }) });
    return null;
  }
  return new Response(request.method === "HEAD" ? null : html, { status, headers: pageHeaders() });
}
function notFoundPage(request) {
  const html = PAGES["/404.html"];
  if (html == null) return null;
  return new Response(request.method === "HEAD" ? null : html, { status: 404, headers: pageHeaders({ "cache-control": "no-store" }) });
}
function withSec(res, api) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(API_SEC_HEADERS)) {
    if (!api && k === "content-security-policy") continue;
    if (!r.headers.has(k)) r.headers.set(k, v);
  }
  return r;
}
const DAILY_BUDGET = 60000;           // Transport for NSW Bronze plan, calls per day
const SAMPLE_BUDGET = 40000;          // background sampling stops above this many calls
const WATCH_BUDGET = 56000;           // watches stop polling above this many calls
const SAMPLE_STOPS = ["213516", "213510", "213410", "200060", "200070", "200080", "214110"];

const upstream = { calls: 0 };

function b64u(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concatBytes(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const enc = new TextEncoder();
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

let vapidKeyP = null;
function vapidSigningKey() {
  if (!vapidKeyP) {
    const pub = unb64u(VAPID_PUBLIC);
    vapidKeyP = crypto.subtle.importKey("jwk", {
      kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: VAPID_PRIVATE, ext: true,
    }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  }
  return vapidKeyP;
}
const jwtMem = new Map();
async function vapidAuth(endpoint) {
  const aud = new URL(endpoint).origin;
  const hit = jwtMem.get(aud);
  if (hit && hit.exp - Date.now() / 1000 > 3600) return hit.header;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp, sub: VAPID_SUBJECT })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await vapidSigningKey(), enc.encode(head + "." + body));
  const header = `vapid t=${head}.${body}.${b64u(sig)}, k=${VAPID_PUBLIC}`;
  jwtMem.set(aud, { exp, header });
  return header;
}

// RFC 8291 message encryption with the aes128gcm content coding (RFC 8188).
async function encryptPush(sub, payload) {
  const uaPublic = unb64u(sub.p256dh);
  const authSecret = unb64u(sub.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const prkKey = await hmac(authSecret, ecdh);
  const keyInfo = concatBytes(enc.encode("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic, new Uint8Array([1]));
  const ikm = await hmac(prkKey, keyInfo);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concatBytes(enc.encode("Content-Encoding: aes128gcm"), new Uint8Array([0, 1])))).slice(0, 16);
  const nonce = (await hmac(prk, concatBytes(enc.encode("Content-Encoding: nonce"), new Uint8Array([0, 1])))).slice(0, 12);
  const plain = concatBytes(enc.encode(payload), new Uint8Array([2]));
  const aes = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aes, plain));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concatBytes(header, cipher);
}

async function sendPush(sub, msg, opts = {}) {
  const body = await encryptPush(sub, JSON.stringify(msg));
  const headers = {
    Authorization: await vapidAuth(sub.endpoint),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(opts.ttl || 900),
    Urgency: opts.urgency || "high",
  };
  if (opts.topic) headers.Topic = String(opts.topic).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const res = await fetch(sub.endpoint, { method: "POST", headers, body });
  let text = "";
  if (!res.ok) { try { text = (await res.text()).slice(0, 200); } catch (e) { text = ""; } }
  return { status: res.status, ok: res.ok, text };
}

// ---------- storage for the proactive layer ----------

// ---------- site analytics and feedback ----------
// Analytics are first party and aggregated: one counter per day, page and referring site.
// No cookies, no IP address, no user agent and no install ID are stored.
let siteSchemaReady = null;
async function ensureSiteSchema(env) {
  const d = db(env);
  if (!d) return false;
  if (!siteSchemaReady) {
    siteSchemaReady = d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS hits (day TEXT, path TEXT, ref TEXT, n INTEGER DEFAULT 0, PRIMARY KEY (day, path, ref))`),
      d.prepare(`CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, topic TEXT, email TEXT, message TEXT, install TEXT, page TEXT, done INTEGER DEFAULT 0)`),
    ]).then(() => true).catch((e) => { siteSchemaReady = null; throw e; });
  }
  return siteSchemaReady;
}
const HIT_PATHS = /^(|download\/|privacy\/|terms\/|support\/|support\/thanks\/|404|app\/(home|search|chat|watching|settings|trip|stop|svc|ask|alerts|near|watch))$/;
function cleanRef(ref, host) {
  try {
    const h = new URL(ref).hostname.replace(/^www\./, "").toLowerCase().slice(0, 60);
    return !h || h === host ? "" : h;
  } catch (e) { return ""; }
}
async function siteRoutes(request, env, url, exec) {
  const p = url.searchParams;
  if (url.pathname === "/api/hit") {
    if (request.method !== "POST") return json({ error: "method" }, 405);
    const b = await request.json().catch(() => ({}));
    const path = String(b.p || "").slice(0, 40);
    if (!HIT_PATHS.test(path)) return new Response(null, { status: 204 });
    const day = new Date(Date.now() + 11 * 3600e3).toISOString().slice(0, 10);
    const ref = cleanRef(String(b.r || ""), url.hostname);
    const job = ensureSiteSchema(env).then(() => db(env).prepare(`INSERT INTO hits (day, path, ref, n) VALUES (?1, ?2, ?3, 1)
      ON CONFLICT (day, path, ref) DO UPDATE SET n = n + 1`).bind(day, path, ref).run()).catch(() => null);
    if (exec && exec.waitUntil) exec.waitUntil(job); else await job;
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
  if (url.pathname === "/api/stats") {
    if (!adminOk(request, p)) return json({ error: "forbidden" }, 403);
    await ensureSiteSchema(env);
    if (request.method === "DELETE") {
      await db(env).prepare(`DELETE FROM hits WHERE day = ?1`).bind(String(p.get("day") || "")).run();
      return json({ ok: true });
    }
    const days = Math.min(90, Math.max(1, Number(p.get("days") || 30)));
    const since = new Date(Date.now() + 11 * 3600e3 - days * 864e5).toISOString().slice(0, 10);
    const q = (sql) => db(env).prepare(sql).bind(since).all().then((r) => r.results || []);
    const [byDay, byPath, byRef] = await Promise.all([
      q(`SELECT day, SUM(n) AS views FROM hits WHERE day >= ?1 GROUP BY day ORDER BY day`),
      q(`SELECT path, SUM(n) AS views FROM hits WHERE day >= ?1 GROUP BY path ORDER BY views DESC`),
      q(`SELECT ref, SUM(n) AS views FROM hits WHERE day >= ?1 AND ref != '' GROUP BY ref ORDER BY views DESC LIMIT 30`),
    ]);
    return json({ since, byDay, byPath, byRef });
  }
  if (url.pathname === "/api/feedback") {
    if (request.method === "GET") {
      if (!adminOk(request, p)) return json({ error: "forbidden" }, 403);
      await ensureSiteSchema(env);
      const r = await db(env).prepare(`SELECT * FROM feedback ORDER BY id DESC LIMIT 200`).all();
      return json({ items: r.results || [] });
    }
    if (request.method === "DELETE") {
      if (!adminOk(request, p)) return json({ error: "forbidden" }, 403);
      await ensureSiteSchema(env);
      await db(env).prepare(`DELETE FROM feedback WHERE id = ?1`).bind(Number(p.get("id") || 0)).run();
      return json({ ok: true });
    }
    if (request.method !== "POST") return json({ error: "method" }, 405);
    const ct = request.headers.get("content-type") || "";
    const isForm = !ct.includes("application/json");
    let b = {};
    if (isForm) { const f = await request.formData().catch(() => null); if (f) for (const [k, v] of f.entries()) b[k] = String(v); }
    else b = await request.json().catch(() => ({}));
    const back = (q) => Response.redirect(new URL("/support/" + q, url.origin).toString(), 303);
    if (b.website) return isForm ? Response.redirect(new URL("/support/thanks/", url.origin).toString(), 303) : json({ ok: true });
    const message = String(b.message || "").trim().slice(0, 4000);
    const email = String(b.email || "").trim().slice(0, 200);
    const topic = ["question", "problem", "idea", "data"].includes(b.topic) ? b.topic : "question";
    const errors = {};
    if (message.length < 10) errors.message = "Write a few words so we know what to fix or answer.";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "That email address does not look right.";
    if (Object.keys(errors).length) return isForm ? back("?error=" + Object.keys(errors).join(",") + "#contact") : json({ ok: false, errors }, 400);
    if (!(await ensureSiteSchema(env).catch(() => false))) return isForm ? back("?error=server#contact") : json({ ok: false, errors: { form: "We could not save that right now. Please email contact@fintex.au instead." } }, 503);
    await db(env).prepare(`INSERT INTO feedback (at, topic, email, message, install, page) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
      .bind(Date.now(), topic, email, message, String(b.install || "").slice(0, 40), String(b.page || "").slice(0, 80)).run();
    return isForm ? Response.redirect(new URL("/support/thanks/", url.origin).toString(), 303) : json({ ok: true });
  }
  return null;
}
let schema3Ready = null;
async function ensureSchema3(env) {
  const d = db(env);
  if (!d) return false;
  await ensureSchema(env);
  if (!schema3Ready) {
    schema3Ready = d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, device TEXT, profile TEXT, p256dh TEXT, auth TEXT,
        ua TEXT, created INTEGER, last_ok INTEGER, last_status INTEGER, fails INTEGER DEFAULT 0)`),
      d.prepare(`CREATE INDEX IF NOT EXISTS push_subs_dev ON push_subs (device)`),
      d.prepare(`CREATE TABLE IF NOT EXISTS watches (id TEXT PRIMARY KEY, device TEXT, profile TEXT, kind TEXT, title TEXT, spec TEXT,
        state TEXT, created INTEGER, updated INTEGER, expires INTEGER, active INTEGER DEFAULT 1, ended TEXT)`),
      d.prepare(`CREATE INDEX IF NOT EXISTS watches_active ON watches (active, device)`),
      d.prepare(`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, device TEXT, profile TEXT, watch_id TEXT,
        at INTEGER, title TEXT, body TEXT, url TEXT, tag TEXT, pushed INTEGER DEFAULT 0, push_status TEXT)`),
      d.prepare(`CREATE INDEX IF NOT EXISTS notes_dev ON notes (device, id)`),
      d.prepare(`CREATE TABLE IF NOT EXISTS watch_sent (watch_id TEXT NOT NULL, k TEXT NOT NULL, at INTEGER, PRIMARY KEY (watch_id, k))`),
      d.prepare(`CREATE TABLE IF NOT EXISTS searches (profile TEXT, device TEXT, day TEXT, dow INTEGER, tod INTEGER,
        from_id TEXT, from_name TEXT, to_id TEXT, to_name TEXT, src TEXT, at INTEGER)`),
      d.prepare(`CREATE INDEX IF NOT EXISTS searches_prof ON searches (profile, at)`),
      d.prepare(`CREATE TABLE IF NOT EXISTS commutes (id TEXT PRIMARY KEY, profile TEXT, name TEXT, from_id TEXT, from_name TEXT,
        to_id TEXT, to_name TEXT, tod INTEGER, days TEXT, active INTEGER DEFAULT 1, created INTEGER, state TEXT)`),
      d.prepare(`CREATE TABLE IF NOT EXISTS dismissed (profile TEXT, k TEXT, at INTEGER, PRIMARY KEY (profile, k))`),
      d.prepare(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`),
      d.prepare(`CREATE TABLE IF NOT EXISTS expo_tokens (token TEXT PRIMARY KEY, device TEXT, profile TEXT, platform TEXT, created INTEGER, last_ok INTEGER, last_status TEXT, fails INTEGER DEFAULT 0)`),
      d.prepare(`CREATE INDEX IF NOT EXISTS expo_tokens_dev ON expo_tokens (device)`),
      d.prepare(`CREATE TABLE IF NOT EXISTS usage (day TEXT PRIMARY KEY, calls INTEGER DEFAULT 0, ticks INTEGER DEFAULT 0, rows INTEGER DEFAULT 0, pushes INTEGER DEFAULT 0)`),
    ]).then(() => true).catch((e) => { schema3Ready = null; throw e; });
  }
  return schema3Ready;
}

const SYD_NOW_OPTS = { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" };
function sydneyNowIntl(d) {
  const f = dtf("en-AU", SYD_NOW_OPTS);
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const dow = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday] || 1;
  const h = p.hour === "24" ? 0 : Number(p.hour);
  return { day: `${p.year}${p.month}${p.day}`, dow, tod: h * 60 + Number(p.minute) };
}
// Australia/Sydney is UTC+10, and UTC+11 from the first Sunday in October 2:00 standard time until
// the first Sunday in April 3:00 daylight time (the NSW rule since 2008; both changes fall on a
// Saturday at 16:00 UTC). Worked out with plain date arithmetic: most requests here run in a fresh
// isolate, where the first Intl time zone formatter alone costs several milliseconds of CPU, and
// predictions ask this for every recorded row. test/sydney-time.test.mjs checks it against Intl.
function firstSundayUtc(y, m) { const w = new Date(Date.UTC(y, m, 1)).getUTCDay(); return Date.UTC(y, m, 1 + ((7 - w) % 7)); }
const sydDst = new Map(); // UTC year -> [daylight saving ends, daylight saving starts] in epoch ms
function sydOffsetMin(t) {
  const y = new Date(t).getUTCFullYear();
  let b = sydDst.get(y);
  if (!b) { b = [firstSundayUtc(y, 3) - 8 * 3600000, firstSundayUtc(y, 9) - 8 * 3600000]; sydDst.set(y, b); }
  return t >= b[0] && t < b[1] ? 600 : 660;
}
const pad2 = (n) => (n < 10 ? "0" : "") + n;
function sydneyNow(d = new Date()) {
  const t = +d;
  if (!Number.isFinite(t)) return sydneyNowIntl(d);
  const l = new Date(t + sydOffsetMin(t) * 60000);
  return { day: `${l.getUTCFullYear()}${pad2(l.getUTCMonth() + 1)}${pad2(l.getUTCDate())}`, dow: l.getUTCDay() || 7, tod: l.getUTCHours() * 60 + l.getUTCMinutes() };
}
// "7:30am", as the en-AU Intl format with spaces removed and lower case.
function clockOf(t, withSeconds) {
  const l = new Date(+t + sydOffsetMin(+t) * 60000);
  const h = l.getUTCHours();
  return `${h % 12 || 12}:${pad2(l.getUTCMinutes())}${withSeconds ? ":" + pad2(l.getUTCSeconds()) : ""}${h < 12 ? "am" : "pm"}`;
}
function clock(t) {
  if (Number.isFinite(+t) && t !== null && t !== "") return clockOf(t, false);
  return dtf("en-AU", CLOCK_OPTS).format(new Date(t)).replace(/\s/g, "").toLowerCase();
}
function hhmmOf(tod) { tod = ((tod % 1440) + 1440) % 1440; return String(Math.floor(tod / 60)).padStart(2, "0") + String(tod % 60).padStart(2, "0"); }
function todText(tod) {
  const h = Math.floor(tod / 60), m = tod % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}
function rid(n = 10) { return b64u(crypto.getRandomValues(new Uint8Array(n))); }
function cleanId(s, n = 64) { return String(s || "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, n); }
// A profile id is the only key to its saved trips, so only long random ids are accepted:
// 6 to 40 of a to z, 0 to 9, "_", ".", ":" or "-". Anything else counts as no profile, which
// means no trip search is logged and saved trips and commutes come back empty.
function profileId(v) { const s = String(v == null ? "" : v).trim().toLowerCase(); return /^[a-z0-9_.:-]{6,40}$/.test(s) ? s : ""; }
// Alert links from TfNSW become tappable links only when they are plain https URLs.
function httpsUrl(u) { const s = String(u || "").trim(); return /^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 500 ? s : null; }

// /api/ask replies carry only what the web, Android and iPhone Ask screens read. The full
// planner output (every leg's path, top level journeys, items and alerts) was 180 to 490 KB.
const ASK_DEP_KEYS = ["line", "color", "mode", "dest", "platform", "planned", "estimated", "realtime", "delayMin", "cancelled", "link"];
const ASK_LEG_KEYS = ["kind", "mode", "line", "color", "from", "to", "fromPlatform", "planned", "estimated", "realtime", "delayMin", "cancelled", "durationMin", "link", "access"];
const ASK_DROP = new Set(["journeys", "items", "alerts", "detail", "path"]);
function pickKeys(o, keys) { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; }
function askSlimCard(c) {
  if (!c || typeof c !== "object") return c;
  const r = {};
  for (const [k, v] of Object.entries(c)) if (k !== "items" && k !== "journeys") r[k] = v;
  if (c.type === "departures" && Array.isArray(c.items)) r.items = c.items.map((i) => ({ ...pickKeys(i, ASK_DEP_KEYS), realtime: !!i.realtime, cancelled: !!i.cancelled }));
  else if (c.type === "alerts" && Array.isArray(c.items)) r.items = c.items.map((a) => ({ title: a.title || "", url: httpsUrl(a.url), lines: a.lines || [] }));
  else if (c.type === "stops" && Array.isArray(c.items)) r.items = c.items.map((s) => pickKeys(s, ["id", "name", "distance", "link"]));
  else if (c.items !== undefined) r.items = c.items;
  if (Array.isArray(c.journeys)) r.journeys = c.journeys.map((j) => ({
    leave: j.leave, arrive: j.arrive, durationMin: j.durationMin, changes: j.changes || 0, warn: j.warn || null,
    legs: (j.legs || []).map((l) => ({ ...pickKeys(l, ASK_LEG_KEYS), realtime: !!l.realtime, cancelled: !!l.cancelled })),
    fare: j.fare || null,
  }));
  return r;
}
function askSlim(d) {
  if (!d || typeof d !== "object") return d;
  const r = {};
  for (const [k, v] of Object.entries(d)) if (!ASK_DROP.has(k)) r[k] = v;
  if (Array.isArray(d.cards)) r.cards = d.cards.map(askSlimCard);
  return r;
}

async function bumpUsage(env, f) {
  const d = db(env);
  if (!d) return;
  const { day } = sydneyNow();
  try {
    await d.prepare(`INSERT INTO usage (day, calls, ticks, rows, pushes) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT (day) DO UPDATE SET calls = calls + ?2, ticks = ticks + ?3, rows = rows + ?4, pushes = pushes + ?5`)
      .bind(day, f.calls || 0, f.ticks || 0, f.rows || 0, f.pushes || 0).run();
  } catch (e) { /* best effort */ }
}
async function usageToday(env) {
  const d = db(env);
  if (!d) return { calls: 0 };
  const r = await d.prepare("SELECT * FROM usage WHERE day = ?1").bind(sydneyNow().day).first().catch(() => null);
  return r || { calls: 0, ticks: 0, rows: 0, pushes: 0 };
}

// ---------- notifications ----------

async function notify(env, target, n) {
  // target: { device } or { profile }. n: { title, body, url, tag, watchId }
  const d = db(env);
  const now = Date.now();
  const subs = target.device
    ? (await d.prepare("SELECT * FROM push_subs WHERE device = ?1").bind(target.device).all()).results || []
    : (await d.prepare("SELECT * FROM push_subs WHERE profile = ?1").bind(target.profile).all()).results || [];
  const ins = await d.prepare(`INSERT INTO notes (device, profile, watch_id, at, title, body, url, tag) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
    .bind(target.device || null, target.profile || null, n.watchId || null, now, n.title, n.body, n.url || "/", n.tag || null).run();
  const noteId = ins.meta && ins.meta.last_row_id;
  const results = [];
  for (const s of subs.slice(0, 6)) {
    try {
      const r = await sendPush(s, { title: n.title, body: n.body, url: n.url || "/", tag: n.tag || "tb", id: noteId, at: now }, { topic: n.tag, ttl: n.ttl || 900 });
      results.push(r.status);
      if (r.status === 404 || r.status === 410) await d.prepare("DELETE FROM push_subs WHERE endpoint = ?1").bind(s.endpoint).run();
      else await d.prepare("UPDATE push_subs SET last_status = ?2, last_ok = CASE WHEN ?3 THEN ?4 ELSE last_ok END, fails = CASE WHEN ?3 THEN 0 ELSE fails + 1 END WHERE endpoint = ?1")
        .bind(s.endpoint, r.status, r.ok ? 1 : 0, now).run();
    } catch (e) { results.push("error: " + String(e && e.message || e).slice(0, 80)); }
  }
  // Native app phones: Expo push service (APNs for iPhone, FCM for Android).
  const expo = await sendExpo(env, target, { ...n, id: noteId, at: now }).catch((e) => ["error: " + String(e && e.message || e).slice(0, 80)]);
  const okCount = results.filter((x) => x === 201 || x === 200).length + expo.filter((x) => x === "ok").length;
  await d.prepare("UPDATE notes SET pushed = ?2, push_status = ?3 WHERE id = ?1").bind(noteId, okCount, JSON.stringify({ web: results, expo })).run();
  return { noteId, pushed: results, expo };
}


async function sendExpo(env, target, n) {
  const d = db(env);
  const toks = target.device
    ? (await d.prepare("SELECT * FROM expo_tokens WHERE device = ?1").bind(target.device).all()).results || []
    : (await d.prepare("SELECT * FROM expo_tokens WHERE profile = ?1").bind(target.profile).all()).results || [];
  if (!toks.length) return [];
  const msgs = toks.slice(0, 6).map((t) => ({
    to: t.token, title: n.title, body: n.body, sound: "default", priority: "high", channelId: "default",
    ttl: n.ttl || 900, data: { url: n.url || "/", watch: n.watchId || null, id: n.id, tag: n.tag || "tb" },
  }));
  const r = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(msgs),
  });
  const body = await r.json().catch(() => ({}));
  const tickets = Array.isArray(body.data) ? body.data : [];
  const out = [];
  for (let i = 0; i < msgs.length; i++) {
    const t = tickets[i] || {};
    const tok = msgs[i].to;
    if (t.status === "ok") {
      out.push("ok");
      await d.prepare("UPDATE expo_tokens SET last_ok = ?2, last_status = 'ok', fails = 0 WHERE token = ?1").bind(tok, Date.now()).run();
    } else {
      const why = (t.details && t.details.error) || t.message || ("http " + r.status);
      out.push("error: " + String(why).slice(0, 80));
      if (why === "DeviceNotRegistered") await d.prepare("DELETE FROM expo_tokens WHERE token = ?1").bind(tok).run();
      else await d.prepare("UPDATE expo_tokens SET last_status = ?2, fails = fails + 1 WHERE token = ?1").bind(tok, String(why).slice(0, 120)).run();
    }
  }
  return out;
}


// ---------- app downloads (Android APK from R2) ----------

async function serveFile(env, name, request) {
  if (!env.FILES) return new Response("Downloads are not set up yet", { status: 503 });
  const obj = await env.FILES.get(name, { range: request.headers, onlyIf: request.headers });
  if (!obj) return new Response("Not found", { status: 404 });
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("etag", obj.httpEtag);
  h.set("content-type", "application/vnd.android.package-archive");
  h.set("content-disposition", `attachment; filename="${name}"`);
  h.set("cache-control", "public, max-age=300");
  h.set("accept-ranges", "bytes");
  if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers: h });
  if (obj.range && request.headers.get("range")) {
    const off = obj.range.offset || 0, len = obj.range.length != null ? obj.range.length : obj.size - off;
    h.set("content-range", `bytes ${off}-${off + len - 1}/${obj.size}`);
    h.set("content-length", String(len));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set("content-length", String(obj.size));
  return new Response(obj.body, { headers: h });
}

// ---------- predictions from the observation log ----------

const predMem = new Map();
function todOfMs(t) { const s = sydneyNow(new Date(t)); return { tod: s.tod, weekend: s.dow >= 6 }; }
async function predictions(env, items, max = 14) {
  const d = db(env);
  if (!d || !items.length) return;
  if (!(await ensureSchema(env).catch(() => false))) return;
  const want = [];
  for (const it of items.slice(0, max)) {
    if (!it.line || !it.stopId || !it.planned) continue;
    const { tod, weekend } = todOfMs(ms(it.planned));
    const key = `${it.line}|${it.stopId}|${Math.round(tod / 30)}|${weekend ? 1 : 0}`;
    const hit = predMem.get(key);
    if (hit && Date.now() - hit.at < 10 * 60000) { if (hit.p) it.pred = hit.p; continue; }
    want.push({ it, key, tod, weekend });
  }
  if (!want.length) return;
  const pairs = [...new Map(want.map((w) => [w.it.line + "|" + w.it.stopId, w.it])).values()];
  const since = Date.now() - 28 * 86400000;
  // Same 600 latest rows per line and stop as always; from those, only rows that can be within
  // 75 min of a wanted time of day come back (Sydney is UTC+10 or +11, so a 210 min window in UTC
  // minutes covers both), and only the three columns used below. The exact check stays in JS.
  // This keeps the answer identical and cuts the rows read back from D1 by about 85%.
  const todsBy = new Map();
  for (const w of want) {
    const k = w.it.line + "|" + w.it.stopId;
    if (!todsBy.has(k)) todsBy.set(k, new Set());
    todsBy.get(k).add(w.tod);
  }
  let res;
  try {
    res = await d.batch(pairs.map((it) => {
      const tods = [...todsBy.get(it.line + "|" + it.stopId)];
      const win = tods.map((_, i) => `(((m - ?${5 + i}) % 1440) + 1440) % 1440 <= 210`).join(" OR ");
      return d.prepare(
        "SELECT planned, delay_s, day FROM (SELECT planned, delay_s, day, planned / 60000 AS m FROM obs WHERE route = ?1 AND stop_id = ?2 AND planned > ?3 AND planned < ?4 AND last_seen >= est - 600000 ORDER BY planned DESC LIMIT 600) WHERE " + win
      ).bind(it.line, it.stopId, since, Date.now() - 60000, ...tods.map((t) => (((t - 735) % 1440) + 1440) % 1440));
    }));
  } catch (e) { return; }
  const rowsBy = new Map();
  pairs.forEach((it, i) => rowsBy.set(it.line + "|" + it.stopId, (res[i] && res[i].results) || []));
  for (const w of want) {
    const rows = rowsBy.get(w.it.line + "|" + w.it.stopId) || [];
    const near = rows.filter((r) => {
      const o = todOfMs(r.planned);
      const dt = Math.min(Math.abs(o.tod - w.tod), 1440 - Math.abs(o.tod - w.tod));
      return dt <= 75 && o.weekend === w.weekend;
    });
    let p = null;
    if (near.length >= 5) {
      const ds = near.map((r) => r.delay_s / 60).sort((a, b) => a - b);
      const med = ds[Math.floor(ds.length / 2)];
      const days = new Set(near.map((r) => r.day)).size;
      const m = Math.round(med);
      const text = m >= 1 ? `Usually about ${m} min late around this time` : m <= -1 ? `Usually about ${-m} min early around this time` : "Usually on time around this time";
      const short = m >= 1 ? `usually ${m} min late` : m <= -1 ? `usually ${-m} min early` : "usually on time";
      p = { delayMin: m, n: near.length, days, text, short, basis: `from ${near.length} trips seen over ${days} day${days > 1 ? "s" : ""}`, kind: "prediction" };
    }
    predMem.set(w.key, { at: Date.now(), p });
    if (p) w.it.pred = p;
  }
}

// ---------- usual lateness: "Usually 3 min late" per line and stop ----------
// Built from the live times the server already records (obs: one row per service, stop and day, from the public
// Transport for NSW realtime data in /api/departures answers and the minute tick's samples). Once a day, per day,
// the minute tick folds that day's rows into late_agg: one row per line, stop, day type (weekday, weekend) and part
// of the day, holding a count per minute of lateness (early, 0 to 9 min, 10 or more). Older days fade (each day
// multiplies the counts by LATE_DECAY, so the last 3 weeks or so count most) and rows that fade below half a
// service are deleted, so the table stays small: counts only, no service, trip, time or device. All the work is
// one batch of SQL in D1 (the Free plan's 10 ms of CPU per run is not spent in JavaScript).
const LATE_DECAY = 0.95;
const LATE_MIN_N = 8;          // services seen (after fading) before a line and stop gets a line
const LATE_BACKFILL_DAYS = 28; // first run: fold the days obs already holds, one day per minute tick
const LATE_COLS = ["e", "m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10"];
const LATE_BANDS = ["mornings", "middle of the day", "afternoons", "evenings"];
let lateSchemaReady = null;
async function ensureLateSchema(env) {
  const d = db(env);
  if (!d) return false;
  if (!lateSchemaReady) {
    lateSchemaReady = d.batch([
      // Columns e, m0 ... m10 are LATE_COLS (written out so tools/schema.mjs can read the statement).
      d.prepare(`CREATE TABLE IF NOT EXISTS late_agg (route TEXT NOT NULL, stop_id TEXT NOT NULL, dt INTEGER NOT NULL, band INTEGER NOT NULL,
        n REAL NOT NULL DEFAULT 0, e REAL NOT NULL DEFAULT 0, m0 REAL NOT NULL DEFAULT 0, m1 REAL NOT NULL DEFAULT 0, m2 REAL NOT NULL DEFAULT 0,
        m3 REAL NOT NULL DEFAULT 0, m4 REAL NOT NULL DEFAULT 0, m5 REAL NOT NULL DEFAULT 0, m6 REAL NOT NULL DEFAULT 0, m7 REAL NOT NULL DEFAULT 0,
        m8 REAL NOT NULL DEFAULT 0, m9 REAL NOT NULL DEFAULT 0, m10 REAL NOT NULL DEFAULT 0, upd INTEGER,
        PRIMARY KEY (route, stop_id, dt, band)) WITHOUT ROWID`),
      d.prepare(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`),
    ]).then(() => true).catch((e) => { lateSchemaReady = null; throw e; });
  }
  return lateSchemaReady;
}
/** "20261024" plus n days. */
function dayAdd(day, n) {
  const t = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))) + n * 86400000;
  const x = new Date(t);
  return `${x.getUTCFullYear()}${pad2(x.getUTCMonth() + 1)}${pad2(x.getUTCDate())}`;
}
/** Weekday (0) or weekend (1) of a "YYYYMMDD" day. */
function dayType(day) {
  const w = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)))).getUTCDay();
  return w === 0 || w === 6 ? 1 : 0;
}
/** Part of the day from Sydney minutes after midnight: 0 6am to 10am, 1 to 3pm, 2 to 7pm, 3 evening and night. */
function lateBand(tod) { return tod >= 360 && tod < 600 ? 0 : tod >= 600 && tod < 900 ? 1 : tod >= 900 && tod < 1140 ? 2 : 3; }
/** The next day to fold, or null when it is not due yet (yesterday is folded from 1am, after late night services). */
function lateNextDay(last, sn) {
  const today = sn.day;
  const next = last ? dayAdd(last, 1) : dayAdd(today, -LATE_BACKFILL_DAYS);
  if (next >= today) return null;
  if (next === dayAdd(today, -1) && sn.tod < 60) return null;
  return next;
}
/** One day's fold: fade every row, add the day's counts, drop faded rows. One D1 batch (a transaction). */
function lateFoldStatements(d, day, now) {
  const off = sydOffsetMin(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)), 2));
  const m = `(((planned / 60000) + ${off}) % 1440)`;
  const band = `CASE WHEN ${m} >= 360 AND ${m} < 600 THEN 0 WHEN ${m} >= 600 AND ${m} < 900 THEN 1 WHEN ${m} >= 900 AND ${m} < 1140 THEN 2 ELSE 3 END`;
  const buckets = ["SUM(delay_s <= -60)", "SUM(delay_s > -60 AND delay_s < 60)"];
  for (let k = 1; k <= 9; k++) buckets.push(`SUM(delay_s >= ${k * 60} AND delay_s < ${(k + 1) * 60})`);
  buckets.push("SUM(delay_s >= 600)");
  return [
    d.prepare(`UPDATE late_agg SET n = n * ${LATE_DECAY}, ${LATE_COLS.map((c) => `${c} = ${c} * ${LATE_DECAY}`).join(", ")}`),
    d.prepare(`INSERT INTO late_agg (route, stop_id, dt, band, n, ${LATE_COLS.join(", ")}, upd)
      SELECT route, stop_id, ?2, band, COUNT(*), ${buckets.join(", ")}, ?3
      FROM (SELECT route, stop_id, delay_s, ${band} AS band FROM obs
        WHERE day = ?1 AND route IS NOT NULL AND route != '' AND delay_s IS NOT NULL AND last_seen >= est - 600000)
      WHERE 1 GROUP BY route, stop_id, band
      ON CONFLICT (route, stop_id, dt, band) DO UPDATE SET n = late_agg.n + excluded.n,
        ${LATE_COLS.map((c) => `${c} = late_agg.${c} + excluded.${c}`).join(", ")}, upd = excluded.upd`).bind(day, dayType(day), now),
    d.prepare("DELETE FROM late_agg WHERE n < 0.5"),
  ];
}
/** Minute tick: fold the next due day, claimed in meta so two ticks never fold one day twice. */
async function lateTick(env, now = Date.now()) {
  const d = db(env);
  if (!d || !(await serverOn(env, "usualLate"))) return { skipped: "off" };
  await ensureLateSchema(env);
  await d.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('late_day', '')").run();
  const row = await d.prepare("SELECT v FROM meta WHERE k = 'late_day'").first();
  const last = row && row.v ? String(row.v) : "";
  const day = lateNextDay(last, sydneyNow(new Date(now)));
  if (!day) return { upTo: last || null };
  const claim = await d.prepare("UPDATE meta SET v = ?1 WHERE k = 'late_day' AND v = ?2").bind(day, last).run();
  if (!((claim.meta && claim.meta.changes) > 0)) return { skipped: "claimed" };
  try {
    await d.batch(lateFoldStatements(d, day, now));
    lateMem.clear();
    return { folded: day };
  } catch (e) {
    await d.prepare("UPDATE meta SET v = ?1 WHERE k = 'late_day' AND v = ?2").bind(last, day).run().catch(() => null);
    return { error: String(e && e.message || e).slice(0, 160) };
  }
}
/** Pure: the answer from one row of counts (or the sum of several), or null under LATE_MIN_N. */
function lateOf(rows, band, dt) {
  const sum = (rs) => {
    const o = { n: 0 };
    for (const c of LATE_COLS) o[c] = 0;
    for (const r of rs) { o.n += Number(r.n) || 0; for (const c of LATE_COLS) o[c] += Number(r[c]) || 0; }
    return o;
  };
  const inBand = rows.filter((r) => Number(r.band) === band);
  let a = sum(inBand), scope = "band";
  if (a.n < LATE_MIN_N) { a = sum(rows); scope = "day"; }
  if (a.n < LATE_MIN_N) return null;
  // The median minute of lateness: early (-1), 0 to 9, or 10 meaning 10 or more.
  let acc = 0, med = 10;
  for (let i = 0; i < LATE_COLS.length; i++) { acc += a[LATE_COLS[i]]; if (acc >= a.n / 2) { med = i - 1; break; } }
  const late3 = LATE_COLS.slice(4).reduce((s, c) => s + a[c], 0);
  const when = scope === "band" ? (band === 1 ? `on ${dt ? "weekends" : "weekdays"} around midday` : `on ${dt ? "weekend" : "weekday"} ${LATE_BANDS[band]}`) : `on ${dt ? "weekends" : "weekdays"}`;
  const lateMin = Math.max(0, med);
  const text = lateMin >= 2 ? `Usually ${lateMin}${med === 10 ? "+" : ""} min late ${when}` : `Usually on time ${when}`;
  const short = lateMin >= 2 ? `usually ${lateMin}${med === 10 ? "+" : ""} min late` : "usually on time";
  return { lateMin, plus: med === 10, n: Math.round(a.n), lateShare: Math.round((late3 / a.n) * 100), dayType: dt ? "weekend" : "weekday",
    band: scope === "band" ? LATE_BANDS[band] : null, text, short, basis: "median lateness of recorded live departures, recent weeks weighted most", kind: "usual" };
}
const lateMem = new Map(); // "route|stop|dt|band" -> { at, v }
async function usualLate(env, pairs, at) {
  const d = db(env);
  const sn = sydneyNow(new Date(at));
  const dt = sn.dow >= 6 ? 1 : 0, band = lateBand(sn.tod);
  const out = pairs.map(() => null);
  const want = [];
  pairs.forEach((p, i) => {
    const k = `${p.line}|${p.stop}|${dt}|${band}`;
    const hit = lateMem.get(k);
    if (hit && Date.now() - hit.at < 600000) out[i] = hit.v;
    else want.push({ i, k, p });
  });
  if (want.length && d) {
    await ensureLateSchema(env);
    const res = await d.batch(want.map((w) => d.prepare("SELECT * FROM late_agg WHERE route = ?1 AND stop_id = ?2 AND dt = ?3").bind(w.p.line, w.p.stop, dt)));
    want.forEach((w, j) => {
      const v = lateOf((res[j] && res[j].results) || [], band, dt);
      lateMem.set(w.k, { at: Date.now(), v });
      if (lateMem.size > 2000) lateMem.delete(lateMem.keys().next().value);
      out[w.i] = v;
    });
  }
  return out;
}
// GET /api/usual?s=LINE~STOP (repeat, up to 12)[&at=ISO time]: {items, enabled} in the same order, null where fewer
// than LATE_MIN_N services were seen. Also ?line=&stop= for one: {usual, enabled}. Server flag usualLate off: nulls.
async function usualRoute(env, p) {
  const enabled = await serverOn(env, "usualLate");
  const single = !p.getAll("s").length;
  const raw = single ? [[p.get("line"), p.get("stop")]] : p.getAll("s").slice(0, 12).map((s) => String(s).split("~"));
  const pairs = raw.map(([line, stop]) => ({ line: String(line || "").trim().slice(0, 16), stop: String(stop || "").trim().slice(0, 24) }));
  if (pairs.some((x) => !x.line || !/^[A-Za-z0-9_:.-]+$/.test(x.stop))) return json({ error: "line and stop are needed" }, 400);
  const atMs = p.get("at") ? Date.parse(p.get("at")) : Date.now();
  const r = enabled ? await usualLate(env, pairs, Number.isFinite(atMs) ? atMs : Date.now()) : pairs.map(() => null);
  const res = single ? json({ usual: r[0], enabled }) : json({ items: r, enabled });
  res.headers.set("cache-control", "public, max-age=600");
  return res;
}

// ---------- service alerts digest: planned trackwork and line status ----------
// Transport for NSW's GTFS realtime service alerts (v2, every mode in one feed, about 500 KB of
// protobuf) are read by the minute tick every ALERT_EVERY_MIN minutes, cut down to what the
// trackwork card and line status use, and kept as one row in meta. Requests read only that row
// (tens of KB of JSON, kept in memory for a minute), so no request decodes the feed.
const ALERT_FEED = "/v2/gtfs/alerts/all";
const ALERT_EVERY_MIN = 10;
const ALERT_STALE_MS = 2 * 3600000; // an older digest is not used for line status
// GTFS realtime Alert.Effect values kept, by name. Accessibility notes, "other" and unknown effects
// (mostly station notices) are left out.
const ALERT_EFFECTS = { 1: "none", 2: "reduced", 3: "delays", 4: "detour", 6: "modified", 9: "stopMoved" };
const ALERT_PLANNED_CAUSES = new Set([9, 10]); // MAINTENANCE, CONSTRUCTION
const PLANNED_WORDS = /buses replace|trackwork|changed timetable|track work|planned work/i;

function readText(pb) { // TranslatedString: the first translation's text
  let text = null;
  while (pb.p < pb.e) {
    const tag = pb.uint();
    if (tag >>> 3 === 1 && (tag & 7) === 2 && text === null) {
      const t = pb.sub();
      while (t.p < t.e) { const g = t.uint(); if (g >>> 3 === 1 && (g & 7) === 2) { text = t.str(); break; } t.skip(g & 7); }
    } else pb.skip(tag & 7);
  }
  return text;
}
// FeedMessage -> [{ id, cause, effect, periods: [[startMs, endMs or 0]], routes: [route ids], stops: [stop ids], header, url }]
function decodeAlerts(buf) {
  const out = [];
  const pb = new PB(buf);
  while (pb.p < pb.e) {
    const tag = pb.uint();
    if (tag >>> 3 !== 2 || (tag & 7) !== 2) { pb.skip(tag & 7); continue; }
    const ent = pb.sub();
    let id = "", al = null;
    while (ent.p < ent.e) {
      const t = ent.uint(), f = t >>> 3;
      if (f === 1) id = ent.str();
      else if (f === 5 && (t & 7) === 2) al = ent.sub();
      else ent.skip(t & 7);
    }
    if (!al) continue;
    const a = { id, cause: 1, effect: 8, periods: [], routes: [], stops: [], header: "", url: null };
    while (al.p < al.e) {
      const t = al.uint(), f = t >>> 3, wt = t & 7;
      if (f === 1 && wt === 2) {
        const r = al.sub(); let s = 0, e = 0;
        while (r.p < r.e) { const g = r.uint(); if (g >>> 3 === 1) s = r.uint(); else if (g >>> 3 === 2) e = r.uint(); else r.skip(g & 7); }
        a.periods.push([s * 1000, e * 1000]);
      } else if (f === 5 && wt === 2) {
        const r = al.sub();
        while (r.p < r.e) {
          const g = r.uint(), gf = g >>> 3;
          if (gf === 2) { const v = r.str(); if (!a.routes.includes(v)) a.routes.push(v); }
          else if (gf === 5) { const v = r.str(); if (!a.stops.includes(v)) a.stops.push(v); }
          else r.skip(g & 7);
        }
      } else if (f === 6 && wt === 0) a.cause = al.uint();
      else if (f === 7 && wt === 0) a.effect = al.uint();
      else if (f === 8 && wt === 2) a.url = readText(al.sub());
      else if (f === 10 && wt === 2) a.header = readText(al.sub()) || "";
      else al.skip(wt);
    }
    out.push(a);
  }
  return out;
}
// The line a GTFS route id belongs to: from the table built from the timetables (tools/build_routes.py),
// else the bus form "<operator>_<line>". Station ids lose their "G" group prefix.
function lineOfRoute(id, table) {
  if (!id) return null;
  if (table && table[id]) return table[id];
  const m = /^\d{3,5}_([A-Za-z0-9]{1,6})$/.exec(id);
  return m ? m[1] : null;
}
function digestAlerts(raw, table, now) {
  const items = [];
  for (const a of raw) {
    // Unknown effect counts as changed service when the cause is maintenance or construction (Transport
    // for NSW files some closures that way), except station notices. Extra services are not a problem.
    const effect = ALERT_EFFECTS[a.effect] || (a.effect === 8 && ALERT_PLANNED_CAUSES.has(a.cause) && !/^station update/i.test(a.header) ? "modified" : null);
    if (!effect || !a.header || /^(extra|additional) /i.test(a.header)) continue;
    const periods = a.periods.filter(([s, e]) => !e || e > now - 6 * 3600000).filter(([s]) => s < now + 10 * 86400000);
    if (a.periods.length && !periods.length) continue;
    const lines = [...new Set(a.routes.map((r) => lineOfRoute(r, table)).filter(Boolean))].slice(0, 12);
    const stops = [...new Set(a.stops.map((s) => String(s).replace(/^G/, "")))].slice(0, 80);
    if (!lines.length && !stops.length) continue;
    const planned = ALERT_PLANNED_CAUSES.has(a.cause) || PLANNED_WORDS.test(a.header);
    items.push({ id: a.id.slice(0, 64), h: plainText(a.header).slice(0, 240), u: httpsUrl(a.url), e: effect, pl: planned ? 1 : 0,
      p: periods.map(([s, e]) => [s, e]).slice(0, 12), l: lines, s: stops });
  }
  return items;
}
async function refreshAlertDigest(env, now = Date.now()) {
  const res = await fetch(API + ALERT_FEED, { headers: { Authorization: "apikey " + apiKey(env) }, signal: AbortSignal.timeout(15000) });
  upstream.calls++;
  if (!res.ok) throw new Error(`Alerts feed answered ${res.status}`);
  const raw = decodeAlerts(new Uint8Array(await res.arrayBuffer()));
  const table = ((await facData(env, "routes")) || {}).routes || {};
  const items = digestAlerts(raw, table, now);
  const v = JSON.stringify({ at: now, items });
  await ensureSchema3(env);
  await db(env).prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('alert_digest', ?1)").bind(v).run();
  alertDigestMem.at = now; alertDigestMem.read = Date.now(); alertDigestMem.items = items;
  return { alerts: raw.length, kept: items.length, bytes: v.length };
}
const alertDigestMem = { at: 0, read: 0, items: null };
async function alertDigest(env) {
  if (alertDigestMem.items && Date.now() - alertDigestMem.read < 60000) return alertDigestMem;
  let row = null;
  // A plain read: the meta table exists once the tick has run (no schema batch on this path).
  try { row = await db(env).prepare("SELECT v FROM meta WHERE k = 'alert_digest'").first(); } catch (e) { row = null; }
  if (row && row.v) {
    const d = JSON.parse(row.v);
    alertDigestMem.at = d.at; alertDigestMem.items = d.items || []; alertDigestMem.read = Date.now();
    return alertDigestMem;
  }
  // First use on a new database, before the tick has made one.
  await refreshAlertDigest(env);
  return alertDigestMem;
}

// The coming weekend in Sydney time: Saturday and Sunday dates, and the window planned work is
// matched against (Friday 8pm to Monday 3am, since weekend closures often start Friday night).
// On Saturday and Sunday it is the weekend under way.
function weekendWindow(now = Date.now()) {
  now -= now % 60000;
  const sn = sydneyNow(now);
  const toSat = sn.dow === 7 ? -1 : 6 - sn.dow;
  const dayAt = (k, tod) => { // epoch ms of Sydney day (today + k) at minute tod
    const guess = now + k * 86400000 + (tod - sn.tod) * 60000;
    return guess + (sydOffsetMin(now) - sydOffsetMin(guess)) * 60000;
  };
  const sat = dayAt(toSat, 0);
  const sun = dayAt(toSat + 1, 0);
  const mon = dayAt(toSat + 2, 0);
  const from = dayAt(toSat - 1, 20 * 60), to = mon + 3 * 3600000;
  return { sat: sydneyNow(sat).day, sun: sydneyNow(sun).day, from, satEnd: sun, to, satStart: sat };
}
function weekendDays(item, w) { // "sat", "sun" or both, for an alert's periods inside the window
  const per = item.p && item.p.length ? item.p : [[0, 0]];
  let sat = false, sun = false;
  for (const [s, e0] of per) {
    const e = e0 || Infinity;
    if (s < w.satEnd && e > w.from) sat = true;
    if (s < w.to && e > w.satEnd) sun = true;
  }
  return { sat, sun };
}
// Places named in an alert header ("Buses replace trains between Berowra and Hornsby").
function alertPlaces(h) {
  const m = /between ([A-Z][A-Za-z' .-]{1,40}?) and ([A-Z][A-Za-z' .-]{1,40}?)(?=$|[,.;:]| only| stations| platforms|\s\()/.exec(h || "");
  return m ? [m[1].replace(/ or .*$/, "").trim(), m[2].trim()] : [];
}
const plainStop = (n) => String(n || "").split(",")[0].replace(/ (Station|Wharf|Light Rail|Metro Station)$/i, "").trim().toLowerCase();

// Planned work this weekend on each trip's lines. trips: [{ f, t, lines: [..], h }].
// Matched by line (the trip's lines in the alert) or by stop (the trip's start or end in it).
function trackworkMatches(items, trips, w) {
  return trips.map((tr) => {
    const hits = [];
    for (const it of items) {
      if (!it.pl) continue;
      const d = weekendDays(it, w);
      if (!d.sat && !d.sun) continue;
      const byLine = tr.lines.some((l) => it.l.includes(l));
      const byStop = it.s.includes(tr.f) || it.s.includes(tr.t);
      if (!byLine && !byStop) continue;
      hits.push({ id: it.id, title: it.h, url: it.u, lines: it.l.filter((l) => tr.lines.includes(l)), sat: d.sat, sun: d.sun, s: it.s });
    }
    return hits;
  });
}
function daysWord(sat, sun) { return sat && sun ? "Sat and Sun" : sat ? "Saturday" : "Sunday"; }

// One trip planned for one day at one time: arrival minus departure of the first journey, the stops
// it passes (parent ids and plain names), and the first leg on temporary buses (trackwork buses).
async function planShape(env, f, t, day, hhmm) {
  const data = await tp(env, "trip", { depArrMacro: "dep", itdDate: day, itdTime: hhmm, type_origin: "any", name_origin: f, type_destination: "any", name_destination: t, calcNumberOfTrips: "2", TfNSWTR: "true" });
  const j = (data.journeys || [])[0];
  if (!j || !j.legs || !j.legs.length) return null;
  const legs = j.legs;
  const dep = ms(legs[0].origin && legs[0].origin.departureTimePlanned), arr = ms(legs[legs.length - 1].destination && legs[legs.length - 1].destination.arrivalTimePlanned);
  const stops = new Set(), names = new Set();
  let bus = null;
  for (const lg of legs) {
    const tr = lg.transportation || {};
    for (const s of lg.stopSequence || []) {
      const pid = (s.parent && s.parent.id) || s.id;
      if (pid) stops.add(String(pid));
      names.add(plainStop((s.parent && seqStopName(s.parent)) || s.name));
    }
    const ttb = tr.properties && tr.properties.isTTB;
    if (!bus && (ttb || /temporary bus/i.test((tr.product && tr.product.name) || ""))) bus = { from: shortName((lg.origin || {}).name || "").replace(/ Station$/, ""), to: shortName((lg.destination || {}).name || "").replace(/ Station$/, "") };
  }
  return { min: dep && arr ? Math.round((arr - dep) / 60000) : null, stops: [...stops], names: [...names], bus };
}
function dayPlus(day, k) { const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8) + k)); return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`; }
// Whether an alert is on this trip's path: its stops on the path, or a place it names on the path,
// or (no stops and no named places) the whole line.
function onPath(hit, shape) {
  if (!shape) return true;
  if (hit.s && hit.s.length) return hit.s.some((s) => shape.stops.includes(s));
  const places = alertPlaces(hit.title).map(plainStop);
  if (!places.length) return true;
  return places.some((p) => shape.names.includes(p));
}

// ---------- weekend trackwork push ----------
// Thursday 6pm to 9pm Sydney time: for each phone with a morning check (it asked for alerts about that trip),
// one push per weekend when planned work this weekend sits on the trip's path. At most WEEKEND_PUSH_PER_TICK
// trips are looked at each minute (one planner call each), and each phone is pushed once per weekend.
const WEEKEND_PUSH_PER_TICK = 4;
function weekendPushDue(now) { const sn = sydneyNow(now); return sn.dow === 4 && sn.tod >= 18 * 60 && sn.tod < 21 * 60; }
/** Planned work this weekend on the stops a trip passes (shape from planShape), first the one that touches both days. */
function weekendPushHits(items, shape, w) {
  if (!shape || !shape.stops || !shape.stops.length) return [];
  const out = [];
  for (const it of items || []) {
    if (!it.pl) continue;
    const d = weekendDays(it, w);
    if (!d.sat && !d.sun) continue;
    const onTrip = it.s && it.s.length ? it.s.some((s) => shape.stops.includes(s)) : alertPlaces(it.h).map(plainStop).some((p) => shape.names.includes(p));
    if (onTrip) out.push({ id: it.id, title: it.h, sat: d.sat, sun: d.sun });
  }
  return out.sort((a, b) => (b.sat && b.sun) - (a.sat && a.sun));
}
function weekendPushText(c, hits) {
  const h = hits[0];
  const from = shortStation(c.from_name), to = shortStation(c.to_name);
  const more = hits.length > 1 ? ` And ${hits.length - 1} more.` : "";
  return { title: `Trackwork this weekend: ${from} to ${to}`, body: wordCut(`${daysWord(h.sat, h.sun)}: ${h.title.replace(/[.\s]+$/, "")}.${more}`, 240) };
}
async function processWeekendPush(env, now, opts = {}) {
  if (!weekendPushDue(now) && !opts.force) return [];
  await morningSchema(env);
  const w = weekendWindow(now);
  const rows = await d1all(env, `SELECT device, from_id, to_id, from_name, to_name, MIN(tod) AS tod FROM morning_checks WHERE active = 1 GROUP BY device, from_id, to_id ORDER BY device LIMIT 200`);
  const dg = await alertDigest(env);
  const out = [];
  let looked = 0;
  for (const c of rows) {
    if (looked >= WEEKEND_PUSH_PER_TICK) break;
    const key = `twk:${c.device}:${w.sat}`;
    const seen = await db(env).prepare("SELECT v FROM meta WHERE k = ?1").bind(key).first().catch(() => null);
    if (seen && String(seen.v).split(",").includes(`${c.from_id}>${c.to_id}`)) continue;
    if (seen && /^sent/.test(seen.v)) continue;
    looked++;
    const shape = await (opts.shape || planShape)(env, c.from_id, c.to_id, w.sat, hhmmOf(c.tod)).catch(() => null);
    const hits = weekendPushHits(dg.items || [], shape, w);
    const tried = seen ? `${seen.v},${c.from_id}>${c.to_id}` : `${c.from_id}>${c.to_id}`;
    if (!hits.length) {
      await db(env).prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?1, ?2)").bind(key, tried.slice(0, 2000)).run();
      out.push({ device: c.device.slice(0, 6), hits: 0 });
      continue;
    }
    const n = weekendPushText(c, hits);
    await db(env).prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?1, ?2)").bind(key, "sent," + tried.slice(0, 2000)).run();
    const r = await (opts.notify || notify)(env, { device: c.device }, { title: n.title, body: n.body, url: "/", tag: "twk" + w.sat, ttl: 86400 });
    out.push({ device: c.device.slice(0, 6), hits: hits.length, note: r && r.noteId || null });
  }
  return out;
}

async function trackworkRoute(env, p) {
  const enabled = await serverOn(env, "weekendTrackwork");
  const w = weekendWindow();
  const head = { enabled, weekend: { sat: w.sat, sun: w.sun, from: w.from, to: w.to } };
  if (!enabled) return json({ ...head, trips: [] });
  const trips = p.getAll("t").slice(0, 6).map((s) => {
    const [f, t, ls, h] = String(s).split("~");
    return { f: cleanId(f, 20), t: cleanId(t, 20), lines: String(ls || "").split(".").map((x) => cleanId(x, 8)).filter(Boolean).slice(0, 8), h: /^\d{1,2}$/.test(h || "") && +h < 24 ? +h : 9 };
  }).filter((x) => x.f && x.t);
  const dg = await alertDigest(env);
  const matches = trackworkMatches(dg.items || [], trips, w);
  const out = await Promise.all(trips.map(async (tr, i) => {
    const hits = matches[i];
    const base = { f: tr.f, t: tr.t, affected: false, items: [], addedMin: null, buses: null };
    if (!hits.length) return base;
    // Saturday when the work touches it and it is not over yet, else Sunday.
    const day = hits.some((x) => x.sat) && Date.now() < w.satEnd ? w.sat : w.sun;
    const hhmm = pad2(tr.h) + "00";
    // Cached per trip, day, hour and the set of alerts, so a phone opening Home again costs a cache read.
    const ck = new Request(`https://cache.local/trackwork/${tr.f}/${tr.t}/${day}/${hhmm}/${hits.map((x) => x.id).sort().join(",").slice(0, 600)}`);
    const cache = edgeCache();
    const hit = await cache.match(ck);
    if (hit) return { ...base, ...(await hit.json()) };
    let works = null, normal = null;
    try { [works, normal] = await Promise.all([planShape(env, tr.f, tr.t, day, hhmm), planShape(env, tr.f, tr.t, dayPlus(day, 7), hhmm)]); } catch (e) { works = normal = null; }
    const shape = normal || works;
    const items = hits.filter((x) => onPath(x, shape)).slice(0, 3).map(({ s, ...x }) => ({ ...x, days: daysWord(x.sat, x.sun) }));
    let addedMin = null;
    if (works && normal && works.min != null && normal.min != null && !normal.bus) {
      const d = works.min - normal.min;
      if (d >= 5) addedMin = d;
    }
    const buses = works && works.bus && !(normal && normal.bus) ? works.bus : null;
    const r = { affected: items.length > 0, items, addedMin: items.length ? addedMin : null, buses: items.length ? buses : null, day };
    await cache.put(ck, new Response(JSON.stringify(r), { headers: { "content-type": "application/json", "cache-control": "max-age=10800" } }));
    return { ...base, ...r };
  }));
  return json({ ...head, at: dg.at || null, trips: out });
}

// Status of my lines: one word per line now, from the same digest. Suspended (no service, not planned),
// Delays (delays, or reduced or changed service that was not planned), Trackwork (planned work under
// way; "Changes" for buses and ferries), else Good service.
const RAIL_LINE = /^(T\d|M\d|L\d|CCN|BMT|SCO|SHL|HUN|NLR)/;
const LINE_RANK = { suspended: 3, delays: 2, trackwork: 1, good: 0 };
function activeNow(it, now) { return !it.p || !it.p.length || it.p.some(([s, e]) => s <= now && (!e || e > now)); }
function lineStatusOf(items, line, now) {
  let best = null, n = 0;
  for (const it of items) {
    if (!it.l.includes(line) || !activeNow(it, now)) continue;
    const st = !it.pl && (it.e === "none" || /\bsuspended\b|not running/i.test(it.h)) ? "suspended"
      : it.e === "delays" || (!it.pl && /^(reduced|modified|detour)$/.test(it.e)) ? "delays"
      : it.pl || it.e === "detour" || it.e === "stopMoved" ? "trackwork" : null;
    if (!st) continue;
    n++;
    if (!best || LINE_RANK[st] > LINE_RANK[best.status]) best = { status: st, title: it.h, url: it.u };
  }
  const rail = RAIL_LINE.test(line);
  if (!best) return { line, status: "good", label: "Good service", title: null, url: null, more: 0 };
  const label = { suspended: "Suspended", delays: "Delays", trackwork: rail ? "Trackwork" : "Changes" }[best.status];
  return { line, status: best.status, label, title: best.title, url: best.url, more: n - 1 };
}
async function linesRoute(env, p) {
  const enabled = await serverOn(env, "lineStatus");
  const lines = [...new Set(String(p.get("l") || "").split(",").map((x) => cleanId(x, 8)).filter(Boolean))].slice(0, 16);
  if (!enabled || !lines.length) return json({ enabled, at: null, items: [] });
  const dg = await alertDigest(env);
  const now = Date.now();
  // A digest older than two hours (the tick stopped) says nothing rather than "Good service".
  if (!dg.at || now - dg.at > ALERT_STALE_MS) return json({ enabled, at: dg.at || null, items: [], stale: true });
  return json({ enabled, at: dg.at, items: lines.map((l) => lineStatusOf(dg.items || [], l, now)) });
}

// ---------- reliability pick: how often one scheduled service left on time ----------
// "Left on time 9 of the last 10 weekdays" for one timetabled service at one stop, from the same recorded
// live times /api/predict reads (obs). A sample is one day on which this service (same line, stop and
// timetable time, within REL_TOD_MIN) was seen close to its departure. On time: no more than REL_EARLY_S
// early and less than REL_LATE_S late. Fewer than REL_MIN samples: null. Nothing is filled in.
const REL_LATE_S = 180;
const REL_EARLY_S = 60;
const REL_TOD_MIN = 2;
const REL_MIN = 5;
const REL_MAX = 10;
const REL_DAYS = 42;
const REL_BATCH = 8;
const relMem = new Map();
function relDayType(t) { return sydneyNow(new Date(t)).dow >= 6 ? "weekend" : "weekday"; }
// Raw recorded live times (obs) are kept only as long as something reads them: reliability looks back REL_DAYS
// (42), predictions 28 days, and usual lateness folds each day into late_agg the day after. So rows older than
// OBS_KEEP_DAYS Sydney days are deleted by the hourly housekeeping, at most OBS_PRUNE_MAX rows a run so a backlog
// never spends the Free plan's daily row writes in one go (about 10,000 rows are recorded a day).
const OBS_KEEP_DAYS = REL_DAYS + 3;
const OBS_PRUNE_MAX = 5000;
/** Pure: the first Sydney day ("YYYYMMDD") still kept. */
function obsKeepFrom(now = Date.now()) { return sydneyNow(new Date(now - OBS_KEEP_DAYS * 86400000)).day; }
async function pruneObs(env, now = Date.now()) {
  const d = db(env);
  if (!d) return { skipped: "no database" };
  const from = obsKeepFrom(now);
  const r = await d.prepare("DELETE FROM obs WHERE rowid IN (SELECT rowid FROM obs WHERE day < ?1 LIMIT ?2)").bind(from, OBS_PRUNE_MAX).run();
  return { keepFrom: from, deleted: (r && r.meta && r.meta.changes) || 0 };
}
/** Pure: the summary from obs rows for one service, or null. rows: {day, planned, delay_s, last_seen}. */
function reliabilityOf(rows, plannedMs) {
  const want = todOfMs(plannedMs).tod;
  const type = relDayType(plannedMs);
  const byDay = new Map();
  for (const r of rows || []) {
    if (r == null || r.delay_s == null || !r.planned) continue;
    const tod = todOfMs(r.planned).tod;
    const dt = Math.min(Math.abs(tod - want), 1440 - Math.abs(tod - want));
    if (dt > REL_TOD_MIN || relDayType(r.planned) !== type) continue;
    const prev = byDay.get(r.day);
    if (!prev || (r.last_seen || 0) > (prev.last_seen || 0)) byDay.set(r.day, r);
  }
  const days = [...byDay.values()].sort((a, b) => b.planned - a.planned).slice(0, REL_MAX);
  if (days.length < REL_MIN) return null;
  const onTime = days.filter((r) => r.delay_s < REL_LATE_S && r.delay_s >= -REL_EARLY_S).length;
  const late = days.filter((r) => r.delay_s >= REL_LATE_S).map((r) => r.delay_s / 60).sort((a, b) => a - b);
  const n = days.length;
  const span = type === "weekend" ? "weekend days" : "weekdays";
  return {
    onTime, n, dayType: type, lateMin: REL_LATE_S / 60,
    usualLateMin: late.length ? Math.round(late[Math.floor(late.length / 2)]) : null,
    text: `Left on time ${onTime} of the last ${n} ${span}`,
    short: `${onTime} of ${n} on time`,
    basis: `on time means under ${REL_LATE_S / 60} min late, from recorded live times`,
    kind: "reliability",
  };
}
async function reliability(env, items) {
  const d = db(env);
  const out = items.map(() => null);
  if (!d || !items.length) return out;
  if (!(await ensureSchema(env).catch(() => false))) return out;
  const since = Date.now() - REL_DAYS * 86400000;
  const want = [];
  items.forEach((it, i) => {
    const pm = ms(it.planned);
    if (!it.line || !it.stopId || !Number.isFinite(pm)) return;
    const key = `${it.line}|${it.stopId}|${todOfMs(pm).tod}|${relDayType(pm)}`;
    const hit = relMem.get(key);
    if (hit && Date.now() - hit.at < 15 * 60000) { out[i] = hit.r; return; }
    want.push({ i, it, pm, key });
  });
  if (!want.length) return out;
  const pairs = [...new Map(want.map((w) => [w.it.line + "|" + w.it.stopId, w.it])).values()];
  let res;
  try {
    res = await d.batch(pairs.map((it) => d.prepare(
      "SELECT day, planned, delay_s, last_seen FROM obs WHERE route = ?1 AND stop_id = ?2 AND planned > ?3 AND planned < ?4 AND last_seen >= est - 600000 ORDER BY planned DESC LIMIT 900"
    ).bind(it.line, it.stopId, since, Date.now() - 60000)));
  } catch (e) { return out; }
  const rowsBy = new Map();
  pairs.forEach((it, i) => rowsBy.set(it.line + "|" + it.stopId, (res[i] && res[i].results) || []));
  for (const w of want) {
    const r = reliabilityOf(rowsBy.get(w.it.line + "|" + w.it.stopId) || [], w.pm);
    relMem.set(w.key, { at: Date.now(), r });
    out[w.i] = r;
  }
  if (relMem.size > 3000) relMem.clear();
  return out;
}
// GET /api/reliability?line=&stop=&planned= gives {reliability}; with s=LINE~STOP~PLANNED repeated (up to 8)
// it gives {items} in the same order. Server flag reliabilityPick off: every answer is null, enabled false.
async function reliabilityRoute(env, p) {
  const enabled = await serverOn(env, "reliabilityPick");
  const list = p.getAll("s").slice(0, REL_BATCH).map((s) => { const [line, stopId, planned] = String(s).split("~"); return { line, stopId, planned }; });
  const single = !list.length;
  const items = single ? [{ line: p.get("line"), stopId: p.get("stop"), planned: p.get("planned") }] : list;
  const r = enabled ? await reliability(env, items) : items.map(() => null);
  return single ? json({ reliability: r[0], enabled }) : json({ items: r, enabled });
}

// ---------- watched trips ----------
// A watch is a list of transit legs. A single service is a one leg watch.
// spec: { legs: [{ mode, line, tripId, stopId, toStopId, from, to, planned, arrPlanned, fromPlatform, toPlatform, color, towards, destId, walkBefore }],
//         lead, to: { id, name }, origin: { id, name }, sim }

function legLabel(l) {
  const noun = { train: "train", metro: "metro", lightrail: "tram", ferry: "ferry", bus: "bus", coach: "coach" }[l.mode] || "service";
  if (l.mode === "bus" || l.mode === "coach") return `the ${l.line}`;
  return `your ${l.line || noun}`;
}
function lineNoun(l) {
  return { train: "train", metro: "metro", lightrail: "tram", ferry: "ferry", bus: "bus", coach: "coach" }[l.mode] || "service";
}
function lateWords(delay) {
  if (delay == null) return "no live data yet";
  if (delay >= 1) return `running ${delay} late`;
  if (delay <= -1) return `running ${-delay} early`;
  return "on time";
}
function minsFrom(t, now) { return Math.max(0, Math.round((t - now) / 60000)); }

async function liveLegs(env, spec, now, opts = {}) {
  const legs = spec.legs;
  const rt = await realtimeFor(env, legs.map((l) => [l.mode, l.line, l.feed]));
  const out = legs.map((l, i) => {
    const it = { mode: l.mode, line: l.line, feed: l.feed, tripId: l.tripId, stopId: l.stopId, planned: l.planned, estimated: l.estimated || null, realtime: false };
    try { enrich(it, rt); } catch (e) { /* no feed */ }
    const tu = rt.tu(l.mode, l.line, l.tripId, l.feed);
    let dep = ms(it.estimated || l.planned);
    let depLive = !!it.realtime && !!it.estimated;
    if (!depLive) {
      const fe = feedEst(tu, l.stopId, ms(l.planned), false);
      if (fe) { dep = fe; depLive = true; }
    }
    let arr = null, arrLive = false;
    if (l.toStopId && l.arrPlanned) {
      const fa = feedEst(tu, l.toStopId, ms(l.arrPlanned), true);
      if (fa) { arr = fa; arrLive = true; }
      else if (depLive) { arr = ms(l.arrPlanned) + (dep - ms(l.planned)); arrLive = true; }
      else arr = ms(l.arrPlanned);
    }
    const veh = vehicleOf(rt.vp(l.mode, l.line, l.tripId, l.feed));
    return { i, dep, depLive, arr, arrLive, cancelled: !!it.cancelled, platform: l.fromPlatform || "", platformFrom: null, platformSeen: false, vehicle: veh ? { lat: veh.lat, lon: veh.lon } : null };
  });
  // Board leg: refine with the departure board (platform changes, cancellations).
  const bi = out.findIndex((o) => o.dep > now - 60000);
  if (bi >= 0 && out[bi].dep - now < 45 * 60000 && opts.board !== false) {
    const l = legs[bi];
    try {
      const b = await departures(env, l.stopId, { log: false, timetable: false });
      const m = b.items.find((x) => (l.tripId && x.tripId === l.tripId) || (x.line === l.line && Math.abs(ms(x.planned) - ms(l.planned)) < 90000));
      if (m) {
        if (m.realtime && m.estimated) {
          const shift = ms(m.estimated) - out[bi].dep;
          out[bi].dep = ms(m.estimated); out[bi].depLive = true;
          if (out[bi].arr && !out[bi].arrLive) { out[bi].arr += shift; out[bi].arrLive = true; }
        }
        if (m.platform) { out[bi].platform = m.platform; out[bi].platformSeen = true; }
        if (m.platformChangedFrom) out[bi].platformFrom = m.platformChangedFrom;
        if (m.cancelled) out[bi].cancelled = true;
        out[bi].boardItems = b.items.filter((x) => x.line === l.line && ms(x.estimated || x.planned) > ms(x.planned) - 1).slice(0, 4);
      }
    } catch (e) { /* board unavailable, feeds still count */ }
  }
  // Test hook: an admin can add a simulated delay to one leg.
  if (spec.sim && out[spec.sim.leg]) {
    const s = out[spec.sim.leg], add = Number(spec.sim.delay || 0) * 60000;
    s.dep += add; if (s.arr) s.arr += add; s.depLive = true; s.arrLive = !!s.arr; s.simulated = true;
    if (spec.sim.platform) { s.platformFrom = s.platform || "the planned one"; s.platform = spec.sim.platform; s.platformSeen = true; }
  }
  for (const o of out) {
    const l = legs[o.i];
    o.delay = o.depLive ? Math.round((o.dep - ms(l.planned)) / 60000) : null;
    o.arrDelay = o.arrLive && l.arrPlanned ? Math.round((o.arr - ms(l.arrPlanned)) / 60000) : null;
  }
  return out;
}

// A run's stops (ownRun) in the service answer's shape, with each trip's live feed laid on by stop: a feed stop at
// another platform of the same station is a platform change (its id is kept), a skipped stop is marked. tuOf(trip)
// gives a trip update for each trip of the run. null when the feed of the trip asked about lists a stop the run does
// not have (a changed trip): the caller keeps the old way.
function runStops(run, tuOf, tripId, live) {
  if (!run || !Array.isArray(run.stops) || run.stops.length < 2) return null;
  const parentOf = new Map();
  for (const [p, kids] of Object.entries(run.alt || {})) for (const k of kids) parentOf.set(k, p);
  const st = run.stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, planned: iso(s.dep || s.arr), estimated: null, skipped: false }));
  for (const t of run.trips || [tripId]) {
    const tu = tuOf(t);
    if (!tu || !Array.isArray(tu.stus) || !tu.stus.length) continue;
    const tuLive = t === tripId ? live : !!(tu.ts && tu.rel !== 3);
    let from = 0, unmatched = 0;
    for (const u of tu.stus) {
      const stn = parentOf.get(u.stopId) || u.stopId;
      let k = -1;
      for (let i = from; i < st.length; i++) {
        const s = run.stops[i];
        // A stop where one trip hands over to the next carries the next trip's id; the first trip's feed lists it too.
        if (s.trip !== t && !(i > 0 && run.stops[i - 1].trip === t)) continue;
        if (s.id === u.stopId || (s.parent || s.id) === stn) { k = i; break; }
      }
      if (k < 0) { if (u.rel !== 1) unmatched++; continue; }
      from = k + 1;
      const s = st[k];
      if (u.stopId !== s.id) s.id = u.stopId;
      if (u.rel === 1) { s.skipped = true; continue; }
      if (!tuLive || u.rel === 2) continue;
      const tm = stuTime(u);
      if (tm && tm.t != null) { s.estimated = iso(tm.t); continue; }
      const ev = u.dep && u.dep.delay != null ? u.dep : u.arr && u.arr.delay != null ? u.arr : null;
      if (ev && s.planned) s.estimated = iso(ms(s.planned) + ev.delay * 1000);
    }
    if (unmatched && t === tripId) return null;
  }
  return st;
}
// The destination with its "via" dropped once the train is at or past the station it names ("Hornsby via
// Strathfield" seen from Strathfield or Rhodes is a train to Hornsby).
function runDest(dest, stops, mine) {
  const m = /^(.*?)\s+via\s+(.+)$/i.exec(String(dest || ""));
  if (!m || mine < 0) return dest || "";
  const via = railDestKey(m[2]);
  return stops.slice(mine + 1).some((s) => railDestKey(s.name) === via) ? dest : m[1].trim();
}
// Carries a run's latest live delay on to later stops that have no live time of their own (GTFS realtime: a delay holds
// for the stops after it until the feed says otherwise). Stops before the first live time are left as they are.
function carryDelays(stops, on) {
  if (!on || !Array.isArray(stops)) return stops;
  let delay = null;
  for (const s of stops) {
    if (!s || s.skipped) continue;
    if (s.estimated && s.planned) { delay = ms(s.estimated) - ms(s.planned); continue; }
    if (delay != null && s.planned && !s.estimated) { s.estimated = iso(ms(s.planned) + delay); s.carried = true; }
  }
  return stops;
}

// Live time at one stop from a trip update: the clock time when published, otherwise the
// published delay applied to the timetable (Sydney Trains often sends delays only).
function feedEst(tu, stopId, plannedMs, propagate) {
  if (!tu || !tu.ts || tu.rel === 3 || !plannedMs) return null;
  let u = tu.stus.find((x) => x.stopId === stopId);
  if (!u && propagate) {
    const withDelay = tu.stus.filter((x) => (x.arr && x.arr.delay != null) || (x.dep && x.dep.delay != null));
    u = withDelay[withDelay.length - 1];
    if (u) { const ev = u.arr && u.arr.delay != null ? u.arr : u.dep; return plannedMs + ev.delay * 1000; }
    return null;
  }
  if (!u || u.rel === 1 || u.rel === 2) return null;
  const ev = (u.arr && (u.arr.time || u.arr.delay != null)) ? u.arr : u.dep;
  if (!ev) return null;
  if (ev.time) return ev.time * 1000;
  if (ev.delay != null) return plannedMs + ev.delay * 1000;
  return null;
}

function snapshotOf(spec, live, now, phase) {
  return {
    at: now, phase,
    legs: live.map((o) => ({ dep: o.dep, depLive: o.depLive, arr: o.arr, arrLive: o.arrLive, delay: o.delay, platform: o.platform, platformFrom: o.platformFrom, cancelled: o.cancelled, simulated: !!o.simulated })),
  };
}

async function rescuePlan(env, spec, i, live, now) {
  // Your leg i arrives late: find the best way on from where it drops you.
  const l = spec.legs[i];
  const arrive = live[i].arr || live[i].dep;
  const fromId = l.toStopId;
  const toId = (spec.to && spec.to.id) || spec.legs[spec.legs.length - 1].toStopId;
  if (!fromId || !toId) return null;
  const t = sydneyParts(new Date(arrive));
  const r = await trip(env, fromId, toId, { time: t.time, count: 5, timetable: false });
  const ok = (r.journeys || []).filter((j) => ms(j.leave) >= arrive - 30000 && j.legs.some((x) => x.kind === "transit"));
  if (!ok.length) return null;
  ok.sort((a, b) => ms(a.arrive) - ms(b.arrive) || ms(a.leave) - ms(b.leave));
  const j = ok[0];
  const legs = [];
  let walk = 0;
  for (const x of j.legs) {
    if (x.kind === "walk") { walk += x.durationMin; continue; }
    legs.push({ mode: x.mode, line: x.line, tripId: x.tripId, stopId: x.stopId, toStopId: x.toStopId, from: x.from, to: x.to,
      planned: x.planned, arrPlanned: x.arrPlanned, estimated: x.estimated, fromPlatform: x.fromPlatform, toPlatform: x.toPlatform, color: x.color, towards: x.towards, destId: x.destId, walkBefore: walk });
    walk = 0;
  }
  return { legs, arrive: ms(j.arrive), journey: j };
}

// Remote config for the phone apps (GET /api/app/config?platform=ios). Native code cannot be
// replaced over the air, so the apps read this at launch and when they come to the front: which
// features show, a kill switch per feature, copy, alert timings and the tab order. Defaults live
// here; an admin POST stores overrides in D1 (merged over the defaults), so a change needs no app
// build and no deploy. The apps keep the last good copy and fall back to their own defaults.
const APP_CONFIG_DEFAULTS = {
  version: 1,
  flags: { ask: true, parkRide: true, opalMachines: true, liveTrip: true, shareTrip: true, weekdayReminder: true, nearby: true,
    morningCheck: true, platformAlerts: true, occupancy: true, liftAwareRouting: true, reliabilityPick: true, lastWayHome: true, weekendTrackwork: true, lineStatus: true, usualLate: true,
    // Saved trip alerts (src/tripalerts.js): the More switch shows only when the server says it has them.
    tripAlerts: true },
  kill: {},
  copy: {},
  tabs: ["home", "plan", "watching", "more"],
  timing: { liveRefreshSec: 15, alertRepeatWindowMin: 15, arriveLeadSec: 150, sameRunToleranceSec: 120, configRefreshMin: 30 },
};
const APP_CONFIG_SECTIONS = ["flags", "kill", "copy", "timing"];

function mergeAppConfig(over) {
  const out = JSON.parse(JSON.stringify(APP_CONFIG_DEFAULTS));
  if (!over || typeof over !== "object") return out;
  for (const k of APP_CONFIG_SECTIONS) {
    if (over[k] && typeof over[k] === "object" && !Array.isArray(over[k])) Object.assign(out[k], over[k]);
  }
  if (Array.isArray(over.tabs) && over.tabs.length) out.tabs = over.tabs.filter((t) => typeof t === "string").slice(0, 6);
  if (Number.isFinite(over.version)) out.version = over.version;
  return out;
}

// Database export for a move to another host (tools/export-d1.mjs). Admin only, read only.
// Without a table it lists every table with its CREATE statement and row count, plus the
// indexes. With table it returns up to limit rows after the given rowid, in rowid order.
async function exportRoute(env, p) {
  const d = env.DB;
  if (!d) return json({ error: "no database" }, 503);
  const list = await d1all(env, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY type DESC, name");
  const tables = list.filter((x) => x.type === "table" && /^[A-Za-z0-9_]+$/.test(x.name));
  const t = p.get("table");
  if (!t) {
    const out = [];
    for (const x of tables) {
      const n = await d1all(env, `SELECT COUNT(*) AS n FROM "${x.name}"`).catch(() => [{ n: null }]);
      out.push({ name: x.name, sql: x.sql, rows: n[0] ? n[0].n : null });
    }
    return json({ tables: out, indexes: list.filter((x) => x.type === "index").map((x) => ({ name: x.name, table: x.tbl_name, sql: x.sql })) });
  }
  if (!tables.some((x) => x.name === t)) return json({ error: "no such table" }, 404);
  const after = Math.max(0, Math.floor(Number(p.get("after")) || 0));
  const limit = Math.min(1000, Math.max(1, Math.floor(Number(p.get("limit")) || 500)));
  const rows = await d1all(env, `SELECT rowid AS "__rowid", * FROM "${t}" WHERE rowid > ?1 ORDER BY rowid LIMIT ?2`, after, limit);
  const last = rows.length ? rows[rows.length - 1].__rowid : null;
  return json({ table: t, rows, next: rows.length === limit ? last : null });
}

async function appConfigRoute(request, env, p, adminOk) {
  const platform = (p.get("platform") || "ios").toLowerCase().replace(/[^a-z]/g, "").slice(0, 12) || "ios";
  const d = env.DB;
  let over = null;
  if (d) {
    try {
      await d.prepare("CREATE TABLE IF NOT EXISTS app_config (platform TEXT PRIMARY KEY, body TEXT NOT NULL, at INTEGER)").run();
      if (request.method === "POST") {
        if (!adminOk) return json({ error: "forbidden" }, 403);
        const text = await request.text();
        if (text.length > 16000) return json({ error: "too big" }, 413);
        let body;
        try { body = JSON.parse(text); } catch (e) { return json({ error: "not JSON" }, 400); }
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "send an object" }, 400);
        // copy.api_base moves the apps to another server address, so a typo would strand every
        // install: only an https origin (no path) or an empty value is accepted.
        const base = body.copy && typeof body.copy === "object" ? body.copy.api_base : undefined;
        if (base != null && base !== "" && !(typeof base === "string" && /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+\/?$/i.test(base))) {
          return json({ error: "copy.api_base must be an https origin like https://api.example.com, with no path" }, 400);
        }
        await d.prepare("INSERT INTO app_config (platform, body, at) VALUES (?1, ?2, ?3) ON CONFLICT(platform) DO UPDATE SET body = ?2, at = ?3").bind(platform, JSON.stringify(body), Date.now()).run();
        over = body;
        if (platform === "server") serverCfg.at = 0;
      } else {
        const row = await d.prepare("SELECT body FROM app_config WHERE platform = ?1").bind(platform).first();
        if (row && row.body) over = JSON.parse(row.body);
      }
    } catch (e) {
      if (request.method === "POST") return json({ error: "could not save" }, 500);
    }
  } else if (request.method === "POST") {
    return json({ error: "no database" }, 503);
  }
  const res = json({ ...mergeAppConfig(over), platform });
  res.headers.set("cache-control", "public, max-age=300");
  return res;
}

// Claims one alert of one watch before it is sent, so two checks that run at the same time
// (the minute tick and an open app) send it once. True when this check may send it.
async function claimOnce(env, watchId, key) {
  try {
    const r = await db(env).prepare("INSERT OR IGNORE INTO watch_sent (watch_id, k, at) VALUES (?1, ?2, ?3)").bind(watchId, key, Date.now()).run();
    return !(r && r.meta && r.meta.changes === 0);
  } catch (e) {
    return true;
  }
}

const stationWord = (s) => String(s || "your stop").replace(/ Station$/, "");

async function processWatch(env, w, now, opts = {}) {
  const spec = JSON.parse(w.spec);
  const st = w.state ? JSON.parse(w.state) : {};
  const sent = [];
  const target = { device: w.device };
  const url = `/#/watch/${w.id}`;
  // extra.once names the alert (for example "arr:1"): it is sent once per watch, ever.
  const push = async (title, body, extra = {}) => {
    if (extra.once && !(await claimOnce(env, w.id, extra.once))) return false;
    const r = await notify(env, target, { title, body, url, tag: "w" + w.id + (extra.tagSuffix || ""), watchId: w.id });
    sent.push({ title, body, pushed: r.pushed });
    st.count = (st.count || 0) + 1;
    return true;
  };
  // Watches saved before legs carried a feed (app before 25 Oct): look the feed up once.
  if ((spec.legs || []).some((l) => l.feed === undefined || l.feed === null)) await backfillFeeds(env, spec, now).catch(() => false);
  const live = await liveLegs(env, spec, now);
  const legs = spec.legs;
  const last = legs.length - 1;
  const lastEnd = live[last].arr || live[last].dep;
  let phase = "before";
  const bi = live.findIndex((o) => o.dep > now - 30000);
  if (bi === 0) phase = "before";
  else if (bi > 0) phase = "between";
  else phase = legs[last].toStopId ? "riding" : "done";
  if (live[last].arr && now > live[last].arr + 120000) phase = "done";
  if (!legs[last].toStopId && now > live[last].dep + 120000) phase = "done";

  const L0 = legs[0], O0 = live[0];
  const leadMs = ((spec.lead != null ? spec.lead : (L0.walkBefore || 0)) || 0) * 60000;
  const where = O0.platform ? ` from ${O0.platform}` : "";

  if (!st.started) {
    st.started = now; st.lastDelay = O0.delay; st.lastPlatform = O0.platform;
    const away = minsFrom(O0.dep, now);
    const lineTxt = `${L0.line} to ${L0.towards || (spec.to && spec.to.name) || L0.to || ""}`.trim();
    let body = `Leaves ${clock(O0.dep)}${where}, ${O0.depLive ? lateWords(O0.delay) : "scheduled time, no live data yet"}. I'll tell you when to leave, and about delays, platform changes and missed connections.`;
    if (O0.dep - leadMs - now <= 60000 && O0.dep > now) { body = `Leave now: it's ${away} min away${where}, ${O0.depLive ? lateWords(O0.delay) : "scheduled"}.`; st.leaveSent = true; }
    if (O0.dep < now - 30000) {
      const lastLeg = legs[last];
      body = lastLeg.toStopId ? `On board. I'll tell you 2 minutes before ${lastLeg.to || "your stop"}${last > 0 ? ", and about your connections" : ""}.` : "It has already left this stop.";
      st.leaveSent = true;
    }
    if (!opts.silentStart && !(live[last].arr ? now > live[last].arr + 120000 : now > live[last].dep + 120000)) await push(`Watching the ${lineTxt}`, body, { once: "start" });
    else if (opts.leaveSent) st.leaveSent = true;
  }

  if (phase === "before" && !O0.cancelled) {
    // Leave now
    if (!st.leaveSent && O0.dep - leadMs - now <= 60000) {
      const away = minsFrom(O0.dep, now);
      await push("Leave now", `${cap(legLabel(L0))} is ${away} min away, ${O0.depLive ? lateWords(O0.delay) : "on the timetable (no live data)"}${where ? "." + where.replace(" from", " From") : ""}.`.replace("..", "."), { once: "leave" });
      st.leaveSent = true;
    }
    // Delay changes
    if (O0.depLive && O0.delay != null) {
      const prev = st.lastDelay == null ? 0 : st.lastDelay;
      if (Math.abs(O0.delay - prev) >= 3 && (O0.delay >= 3 || prev >= 3)) {
        if (O0.delay >= 1) await push(`Now ${O0.delay} min late`, `${cap(legLabel(L0))} to ${L0.towards || L0.to} now leaves${where} at ${clock(O0.dep)}.`, { once: `delay:${O0.delay}` });
        else await push("Back on time", `${cap(legLabel(L0))} to ${L0.towards || L0.to} leaves${where} at ${clock(O0.dep)}.`, { once: `ontime:${prev}` });
        st.lastDelay = O0.delay;
      }
    }
  }
  // Platform change on whichever leg you are about to board
  // Only a platform the departure board actually reported counts (platformSeen false means the
  // board did not answer and the planned platform stands in), so a board that drops out for a
  // minute never reads as a change. Each new platform of each leg is sent once (claimed in D1).
  if (bi >= 0 && !live[bi].cancelled && live[bi].platformSeen !== false && live[bi].dep > now) {
    const o = live[bi], l = legs[bi];
    const key = `${bi}:${o.platform}`;
    if (o.platform && (o.platformFrom || (st.lastPlatform && st.lastPlatformLeg === bi && st.lastPlatform !== o.platform)) && st.platformKey !== key) {
      const was = o.platformFrom || st.lastPlatform;
      if (await serverOn(env, "platformAlerts")) {
        await push(`Platform changed to ${o.platform.replace(/^Platform /, "")}`, `The ${clock(o.dep)} ${l.line} to ${l.towards || l.to} now leaves from ${o.platform}${was && was !== o.platform ? `, not ${was}` : ""}.`, { once: `plat:${key}` });
      }
      st.platformKey = key;
    }
    st.lastPlatform = o.platform; st.lastPlatformLeg = bi;
  }
  // Cancellation
  if (bi >= 0 && live[bi].cancelled && st.cancelKey !== bi) {
    const l = legs[bi];
    const alt = (live[bi].boardItems || []).find((x) => !x.cancelled && ms(x.estimated || x.planned) > live[bi].dep);
    await push(`Cancelled: the ${clock(ms(l.planned))} ${l.line}`, alt ? `Next ${l.line} leaves ${clock(ms(alt.estimated || alt.planned))}${alt.platform ? " from " + alt.platform : ""}${alt.realtime ? " (live)" : " (scheduled)"}.` : `No replacement found yet. I'll keep checking.`);
    st.cancelKey = bi;
  }
  // Connection rescue
  for (let i = Math.max(0, bi - 1); i >= 0 && i < last; i++) {
    const a = live[i], b = live[i + 1];
    if (!a || !b || b.dep < now - 30000) continue;
    const walk = legs[i + 1].walkBefore || 0;
    const aArr = a.arr || a.dep;
    const spare = (b.dep - aArr) / 60000 - walk;
    const plannedSpare = (ms(legs[i + 1].planned) - ms(legs[i].arrPlanned || legs[i].planned)) / 60000 - walk;
    const atRisk = spare < 0 || (spare < 1 && plannedSpare >= 2);
    if (!atRisk) continue;
    const key = `${i}:${legs[i + 1].tripId || legs[i + 1].planned}`;
    if (st.rescueKey === key) break;
    st.rescueKey = key;
    const delayTxt = a.arrDelay != null ? `${Math.max(a.arrDelay, 1)} late` : a.delay != null ? `${Math.max(a.delay, 1)} late` : "late";
    const missed = legs[i + 1];
    let plan = null;
    try { plan = await rescuePlan(env, spec, i, live, now); } catch (e) { plan = null; }
    const missTxt = `you'll miss the ${clock(b.dep)} ${lineNoun(missed) === "bus" ? "bus" : missed.line}`;
    if (plan && plan.legs.length) {
      const n0 = plan.legs[0];
      const nd = n0.estimated ? ms(n0.estimated) : ms(n0.planned);
      const same = n0.tripId && n0.tripId === missed.tripId;
      if (!same) {
        await push("Connection at risk", `Your ${legs[i].line} is ${delayTxt}, ${missTxt}. Take the ${clock(nd)} ${n0.line}${n0.fromPlatform ? " from " + n0.fromPlatform : ""}. Gets you in at ${clock(plan.arrive)}.`, { tagSuffix: "r" });
        spec.legs = legs.slice(0, i + 1).concat(plan.legs);
        if (spec.sim && spec.sim.leg > i) delete spec.sim;
        st.replanned = (st.replanned || 0) + 1;
        st.leaveSent = st.leaveSent || i >= 0;
      }
    } else {
      await push("Connection at risk", `Your ${legs[i].line} is ${delayTxt}, ${missTxt}. No better option found yet. I'll keep checking.`, { tagSuffix: "r" });
    }
    break;
  }
  // Arrival at a change or at your stop: one alert per leg, either "Next stop" (Start trip, from
  // where the vehicle really is) or "Arriving in N min", never both, and claimed so a second
  // check running at the same moment cannot send it again.
  for (let i = 0; i <= last; i++) {
    const o = live[i], l = legs[i];
    if (!l.toStopId || !o.arr) continue;
    if (o.dep > now) continue;
    if ((st.arrived || {})[i]) continue;
    const left = o.arr - now;
    if (spec.track && l.tripId && left > 0 && left <= 15 * 60000 && !(st.oneStop || {})[i]) {
      const c = await oneStopCheck(env, l).catch(() => null);
      if (c && c.nextIsYours) {
        st.oneStop = st.oneStop || {}; st.oneStop[i] = 1;
        st.arrived = st.arrived || {}; st.arrived[i] = 1;
        const at = c.eta ? ` at ${clock(c.eta)}` : "";
        if (i === last) await push(`Next stop: ${l.to}`, `Get ready to get off. Your ${l.line} gets in${at}.`, { tagSuffix: "a", once: `arr:${i}` });
        else {
          const n = legs[i + 1], no = live[i + 1];
          await push(`Next stop: ${l.to}, change here`, `Get off${at} for the ${clock(no.dep)} ${n.line}${no.platform ? " from " + no.platform : ""}, ${no.depLive ? lateWords(no.delay) : "scheduled"}.`, { tagSuffix: "a", once: `arr:${i}` });
        }
        continue;
      }
    }
    // "Change at Town Hall in 2 min" and "Arriving" only from live times: on the timetable alone the train may be
    // nowhere near (26 Oct 2026, a T1 running 30 minutes late), so nothing is said and the phone shows "not live".
    if (!o.arrLive) continue;
    if (left <= 150000 && left > -60000) {
      st.arrived = st.arrived || {}; st.arrived[i] = 1;
      const mins = Math.max(1, Math.round(left / 60000));
      if (i === last) await push(`Arriving at ${l.to} in ${mins} min`, `Get ready to get off. Your ${l.line} gets in at ${clock(o.arr)}.`, { tagSuffix: "a", once: `arr:${i}` });
      else {
        const n = legs[i + 1], no = live[i + 1];
        await push(`Change at ${l.to} in ${mins} min`, `Next: the ${clock(no.dep)} ${n.line}${no.platform ? " from " + no.platform : ""}, ${no.depLive ? lateWords(no.delay) : "scheduled"}.`, { tagSuffix: "a", once: `arr:${i}` });
      }
    }
  }
  // A trip started with Start trip ends at your stop: one "arrived", then nothing more. It never
  // moves on to a later service.
  const fin = live[last];
  if (spec.track && legs[last].toStopId && fin.arr && fin.dep <= now && now >= fin.arr) {
    if (now <= fin.arr + 10 * 60000 && fin.arrLive) {
      await push(`You've arrived at ${stationWord(legs[last].to)}`, `Your ${legs[last].line} got in at ${clock(fin.arr)}. The trip has ended.`, { tagSuffix: "a", once: "done" });
    }
    phase = "done";
  }
  const ended = phase === "done" || now > w.expires;
  st.snap = snapshotOf(spec, live, now, ended ? "done" : phase);
  await db(env).prepare("UPDATE watches SET spec = ?2, state = ?3, updated = ?4, active = ?5, ended = ?6 WHERE id = ?1")
    .bind(w.id, JSON.stringify(spec), JSON.stringify(st), now, ended ? 0 : 1, ended ? (now > w.expires ? "expired" : "trip ended") : null).run();
  return { id: w.id, phase, ended, sent };
}

function legFromInput(l) {
  const s = (v, n = 80) => (v == null ? null : String(v).slice(0, n));
  return {
    mode: s(l.mode, 12) || "bus", line: s(l.line, 12) || "", tripId: s(l.tripId, 120), stopId: s(l.stopId, 40), toStopId: s(l.toStopId, 40),
    from: s(l.from), to: s(l.to), planned: s(l.planned, 40), arrPlanned: s(l.arrPlanned, 40), estimated: s(l.estimated, 40),
    fromPlatform: s(l.fromPlatform, 30), toPlatform: s(l.toPlatform, 30), color: s(l.color, 10), towards: s(l.towards), destId: s(l.destId, 40),
    walkBefore: Math.max(0, Math.min(60, Number(l.walkBefore) || 0)),
    ...(cleanFeed(l.feed) !== undefined ? { feed: cleanFeed(l.feed) } : {}),
  };
}

// A leg's feed as sent by the app: a known non-Sydney feed key, "" (checked: the mode's usual feed), or
// undefined (an older app that never sent one; backfillFeeds looks it up).
function cleanFeed(v) {
  if (v === "") return "";
  if (typeof v !== "string") return undefined;
  return own(FEEDS, v) || own(FEED_GROUPS, v) ? v : undefined;
}

// Modes whose services can sit in a non-Sydney feed (TrainLink, regional buses and coaches, Manly Fast Ferry).
const FEED_MODES = new Set(["train", "coach", "bus", "ferry"]);
const FEED_TRIES = 3;
/**
 * Watches saved before legs carried a feed: find each leg's feed once from its stop's departure board (the
 * board rows carry it), so TrainLink, regional bus and Manly Fast Ferry legs read the right live times.
 * Only legs leaving within the next hour or left in the last two hours are looked up; a leg not found on the
 * board after FEED_TRIES looks keeps its mode's usual feed. Changes spec.legs in place; true when it changed.
 */
async function backfillFeeds(env, spec, now, board = (stopId) => departures(env, stopId, { log: false })) {
  let changed = false;
  const boards = new Map();
  for (const l of spec.legs || []) {
    if (l.feed !== undefined && l.feed !== null) continue;
    if (!FEED_MODES.has(l.mode)) { l.feed = ""; changed = true; continue; }
    const t = ms(l.planned);
    if (!t || t > now + 3600000 || t < now - 2 * 3600000 || !l.stopId) continue;
    let b = boards.get(l.stopId);
    if (b === undefined) { b = await board(l.stopId).catch(() => null); boards.set(l.stopId, b); }
    if (!b || !Array.isArray(b.items)) continue;
    const m = b.items.find((x) => (l.tripId && x.tripId === l.tripId) || (x.line === l.line && Math.abs(ms(x.planned) - t) < 90000));
    if (m) { l.feed = cleanFeed(m.feed) || ""; delete l.feedTries; changed = true; continue; }
    l.feedTries = (l.feedTries || 0) + 1;
    if (l.feedTries >= FEED_TRIES) { l.feed = ""; delete l.feedTries; }
    changed = true;
  }
  return changed;
}

async function createWatch(env, b, now) {
  const device = cleanId(b.device), profile = profileId(b.profile);
  if (!device) throw new Error("device needed");
  const legs = (b.legs || []).slice(0, 6).map(legFromInput).filter((l) => l.stopId && l.planned);
  if (!legs.length) throw new Error("nothing to watch");
  const spec = {
    legs, lead: b.lead != null ? Math.max(0, Math.min(60, Number(b.lead) || 0)) : null,
    to: b.to ? { id: String(b.to.id || "").slice(0, 60), name: String(b.to.name || "").slice(0, 80) } : null,
    origin: b.origin ? { id: String(b.origin.id || "").slice(0, 60), name: String(b.origin.name || "").slice(0, 80) } : null,

    track: !!b.track,
  };
  const L = legs[legs.length - 1];
  const end = Math.max(ms(L.arrPlanned || L.planned), ms(legs[0].planned)) + 3 * 3600000;
  const title = String(b.title || `${legs[0].line} ${legs[0].towards ? "to " + legs[0].towards : ""}`).slice(0, 90);
  const id = rid(8);
  await db(env).prepare("INSERT INTO watches (id, device, profile, kind, title, spec, state, created, updated, expires, active) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, 1)")
    .bind(id, device, profile, legs.length > 1 || b.kind === "trip" ? "trip" : "svc", title, JSON.stringify(spec), JSON.stringify({}), now, Math.min(end, now + 6 * 3600000)).run();
  if (b.kind === "trip" && b.origin && b.to) await logSearch(env, { profile, device, from: b.origin, to: b.to, src: "watch", at: ms(legs[0].planned) - ((legs[0].walkBefore || 0) * 60000) });
  const w = await db(env).prepare("SELECT * FROM watches WHERE id = ?1").bind(id).first();
  const r = await processWatch(env, w, now, { silentStart: !!b.silentStart, leaveSent: !!b.leaveSent });
  return { id, ...r };
}

function watchOut(w) {
  const spec = JSON.parse(w.spec || "{}"), st = JSON.parse(w.state || "{}");
  return { id: w.id, kind: w.kind, title: w.title, active: !!w.active, ended: w.ended, created: w.created, updated: w.updated, expires: w.expires,
    legs: spec.legs, lead: spec.lead, to: spec.to, origin: spec.origin, snap: st.snap || null, replanned: st.replanned || 0 };
}

// ---------- commute memory ----------

async function logSearch(env, s) {
  const d = db(env);
  if (!d || !s.profile || !s.from || !s.to || !s.from.id || !s.to.id) return;
  // A point ("lon:lat:EPSG:4326", a trip from where you are) is a position, not a stop: trip history keeps stops
  // only, so no position is kept for 90 days (store/apple/app-privacy.md). The search path already skipped points;
  // this covers a watched trip too.
  if (isCoordId(s.from.id) || isCoordId(s.to.id) || /EPSG/.test(String(s.from.id) + String(s.to.id))) return;
  try {
    await ensureSchema3(env);
    const sn = sydneyNow(new Date(s.at || Date.now()));
    await d.prepare("INSERT INTO searches (profile, device, day, dow, tod, from_id, from_name, to_id, to_name, src, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
      .bind(s.profile, s.device || null, sydneyNow().day, sn.dow, sn.tod, String(s.from.id), String(s.from.name || ""), String(s.to.id), String(s.to.name || ""), s.src || "search", Date.now()).run();
  } catch (e) { /* best effort */ }
}
function commuteName(tod) { return tod < 12 * 60 ? "Morning trip" : tod < 16 * 60 ? "Afternoon trip" : "Evening trip"; }

async function commuteSuggestion(env, profile) {
  const d = db(env);
  const since = Date.now() - 21 * 86400000;
  const rows = (await d.prepare("SELECT * FROM searches WHERE profile = ?1 AND at > ?2 ORDER BY at DESC LIMIT 400").bind(profile, since).all()).results || [];
  const commutes = (await d.prepare("SELECT from_id, to_id, tod FROM commutes WHERE profile = ?1").bind(profile).all()).results || [];
  const dis = new Set(((await d.prepare("SELECT k FROM dismissed WHERE profile = ?1").bind(profile).all()).results || []).map((r) => r.k));
  const groups = new Map();
  for (const r of rows) {
    const k = r.from_id + ">" + r.to_id;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  let best = null;
  for (const [k, list] of groups) {
    // Cluster by time of day: each search anchors a window of 60 min.
    for (const anchor of list) {
      const near = list.filter((r) => Math.abs(r.tod - anchor.tod) <= 60);
      const days = new Set(near.map((r) => r.day));
      if (days.size < 2) continue;
      const tods = near.map((r) => r.tod).sort((a, b) => a - b);
      const tod = Math.round(tods[Math.floor(tods.length / 2)] / 5) * 5;
      const key = `${k}@${Math.round(tod / 60)}`;
      if (dis.has(key)) continue;
      if (commutes.some((c) => c.from_id === anchor.from_id && c.to_id === anchor.to_id && Math.abs(c.tod - tod) <= 90)) continue;
      const score = days.size * 10 + near.length;
      if (!best || score > best.score) best = { key, score, from: { id: anchor.from_id, name: anchor.from_name }, to: { id: anchor.to_id, name: anchor.to_name }, tod, todText: todText(tod), days: days.size, name: commuteName(tod) };
    }
  }
  if (best) delete best.score;
  return best;
}

function commuteOut(c) {
  const st = JSON.parse(c.state || "{}");
  return { id: c.id, name: c.name, from: { id: c.from_id, name: c.from_name }, to: { id: c.to_id, name: c.to_name }, tod: c.tod, todText: todText(c.tod), days: c.days, active: !!c.active, plan: st.plan || null, planAt: st.planAt || null };
}

function pickCommuteJourney(journeys, tod, now) {
  const cand = journeys.filter((j) => ms(j.leave) > now + 30000 && !j.anyCancelled);
  if (!cand.length) return null;
  const target = (t) => { const s = sydneyNow(new Date(t)); return Math.abs(s.tod - tod); };
  // Prefer the trip leaving closest to your usual time, but never one beaten by a faster later trip.
  const fair = cand.filter((j) => !j.beaten);
  const pool = fair.length ? fair : cand;
  pool.sort((a, b) => target(ms(a.leave)) - target(ms(b.leave)));
  return pool[0];
}
function journeyLegs(j) {
  const legs = [];
  let walk = 0;
  for (const x of j.legs) {
    if (x.kind === "walk") { walk += x.durationMin; continue; }
    legs.push({ mode: x.mode, line: x.line, tripId: x.tripId, stopId: x.stopId, toStopId: x.toStopId, from: x.from, to: x.to, planned: x.planned, arrPlanned: x.arrPlanned,
      estimated: x.estimated, fromPlatform: x.fromPlatform, toPlatform: x.toPlatform, color: x.color, towards: x.towards, destId: x.destId, walkBefore: walk, delayMin: x.delayMin, realtime: x.realtime, alerts: x.alerts });
    walk = 0;
  }
  return legs;
}

async function processCommute(env, c, now, sn, opts = {}) {
  const st = JSON.parse(c.state || "{}");
  if (st.day !== sn.day) { st.day = sn.day; st.heads = false; st.leave = false; st.plan = null; }
  const dt = sn.tod - c.tod;
  const sent = [];
  if (!opts.force && (dt < -40 || dt > 25 || st.leave)) return { id: c.id, skipped: true };
  if (!opts.force && st.planAt && now - st.planAt < 110000 && st.plan && ms(st.plan.leave) - now > 4 * 60000) return { id: c.id, waiting: true };
  const r = await trip(env, c.from_id, c.to_id, { count: 5, time: dt < -10 ? hhmmOf(c.tod - 10) : null, timetable: false });
  const j = pickCommuteJourney(r.journeys || [], c.tod, now);
  if (!j) return { id: c.id, nothing: true };
  const legs = journeyLegs(j);
  const first = legs[0];
  st.plan = { leave: j.leave, board: j.board, arrive: j.arrive, live: j.live, line: first && first.line, mode: first && first.mode, platform: first && first.fromPlatform, delay: first && first.delayMin, color: first && first.color, changes: j.changes, risk: j.risk };
  st.planAt = now;
  const target = { profile: c.profile };
  const issues = [];
  for (const l of legs) {
    if (l.delayMin != null && l.delayMin >= 3) issues.push(`the ${l.line} is running ${l.delayMin} late`);
    const serious = (l.alerts || []).filter((a) => /high/i.test(a.priority || "") || /delay|cancel|replac|disrupt|not running|suspend|closed|incident|reduced/i.test(a.title || ""));
    if (serious.length) issues.push(serious[0].title.toLowerCase().startsWith(String(l.line).toLowerCase()) ? serious[0].title.replace(/[.\s]+$/, "") : `${l.line}: ${serious[0].title.replace(/[.\s]+$/, "")}`);
  }
  if (j.anyCancelled) issues.push("a service on it is cancelled");
  if (j.risk === "miss") issues.push("the change looks too tight");
  if (!st.heads && (dt >= -35 || opts.force)) {
    st.heads = true;
    if (issues.length) {
      const n = await notify(env, target, { title: `Heads up: your ${c.name.toLowerCase()}`, body: `${cap(issues.slice(0, 2).join(", and "))}. Best option: leave at ${clock(ms(j.leave))}, in by ${clock(ms(j.arrive))}.`, url: "/#/", tag: "c" + c.id + "h" });
      sent.push({ heads: true, pushed: n.pushed });
    }
  }
  const leaveIn = ms(j.leave) - now;
  if (!st.leave && (leaveIn <= 90000 || opts.forceLeave)) {
    st.leave = true;
    const away = minsFrom(ms(j.board), now);
    const body = first
      ? `The ${clock(ms(j.board))} ${first.line}${first.fromPlatform ? " from " + first.fromPlatform : ""} is ${away} min away, ${first.realtime ? lateWords(first.delayMin) : "scheduled"}. In at ${c.to_name.split(",")[0].replace(/ Station$/, "")} by ${clock(ms(j.arrive))}.`
      : `Leave now to reach ${c.to_name} by ${clock(ms(j.arrive))}.`;
    const n = await notify(env, target, { title: `Leave now for ${c.to_name.split(",")[0].replace(/ Station$/, "")}`, body, url: "/#/", tag: "c" + c.id + "l" });
    sent.push({ leave: true, pushed: n.pushed });
    // Keep following the trip for connections and arrival, on every device of this profile.
    const devs = (await db(env).prepare("SELECT DISTINCT device FROM push_subs WHERE profile = ?1").bind(c.profile).all()).results || [];
    for (const dv of devs.slice(0, 3)) {
      try { await createWatch(env, { device: dv.device, profile: c.profile, kind: "trip", legs, origin: { id: c.from_id, name: c.from_name }, to: { id: c.to_id, name: c.to_name }, title: `${c.name}: ${c.from_name.split(",")[0].replace(/ Station$/, "")} to ${c.to_name.split(",")[0].replace(/ Station$/, "")}`, silentStart: true, leaveSent: true }, now); } catch (e) { /* keep going */ }
    }
  }
  await db(env).prepare("UPDATE commutes SET state = ?2 WHERE id = ?1").bind(c.id, JSON.stringify(st)).run();
  return { id: c.id, sent, plan: st.plan };
}

// ---------- morning check ----------
// A device registers a usual trip (from, to, usual departure time, days). About 15 min before
// that time the minute tick checks live data once and sends ONE alert, only if something is
// wrong: a delay over 5 min, a cancellation, trackwork, a platform change, a missed connection
// or a lift outage at either end. Silent when all is fine. The check is claimed in D1
// (morning_sent, one row per check per day) before it runs, so it never sends twice.

const MORNING_MAX_PER_DEVICE = 6;
const MORNING_DELAY_MIN = 5;          // a delay must be over this many minutes
const MORNING_TRACKWORK_RE = /track ?work|buses replace|replac(?:e|ed|es|ement) (?:bus|buses|coach)|not running|no trains|suspend|changed timetable|timetable change|line closure|closed between/i;
const MORNING_CANCEL_RE = /cancel/i;
let morningSchemaReady = null;

async function morningSchema(env) {
  const d = db(env);
  if (!d) return false;
  if (!morningSchemaReady) {
    morningSchemaReady = d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS morning_checks (id TEXT PRIMARY KEY, device TEXT NOT NULL, name TEXT, from_id TEXT, from_name TEXT,
        to_id TEXT, to_name TEXT, tod INTEGER, days TEXT, lead INTEGER DEFAULT 15, active INTEGER DEFAULT 1, created INTEGER, last TEXT)`),
      d.prepare(`CREATE INDEX IF NOT EXISTS morning_checks_dev ON morning_checks (device)`),
      d.prepare(`CREATE TABLE IF NOT EXISTS morning_sent (check_id TEXT NOT NULL, day TEXT NOT NULL, at INTEGER, result TEXT, PRIMARY KEY (check_id, day))`),
    ]).then(async () => {
      // Added after the first release: the mode you usually take (train, bus...), optional.
      await d.prepare("ALTER TABLE morning_checks ADD COLUMN mode TEXT").run().catch(() => null);
      return true;
    }).catch((e) => { morningSchemaReady = null; throw e; });
  }
  return morningSchemaReady;
}

// Server side switches: an admin POST to /api/app/config?platform=server with flags (or kill)
// turns server features off for every app at once. Read at most once a minute per copy.
const serverCfg = { at: 0, cfg: null };
async function serverConfig(env) {
  if (serverCfg.cfg && Date.now() - serverCfg.at < 60000) return serverCfg.cfg;
  let over = null;
  try {
    // The server switches and, beside them, the budget guard's hold (budgetCheck, budgetHeld).
    const [row, brow] = env && env.DB ? await Promise.all([
      env.DB.prepare("SELECT body FROM app_config WHERE platform = 'server'").first(),
      env.DB.prepare("SELECT body FROM app_config WHERE platform = 'budget'").first().catch(() => null),
    ]) : [null, null];
    try { serverCfg.budget = brow && brow.body ? JSON.parse(brow.body) : null; } catch (e) { serverCfg.budget = null; }
    if (row && row.body) over = JSON.parse(row.body);
  } catch (e) { /* no table yet: defaults */ }
  serverCfg.cfg = mergeAppConfig(over); serverCfg.at = Date.now();
  return serverCfg.cfg;
}
async function serverOn(env, flag) {
  const c = await serverConfig(env).catch(() => null);
  if (!c) return true;
  return c.flags[flag] !== false && !c.kill[flag];
}

// ---------- Budget mode (docs/COSTS.md): the Workers Paid base fee and nothing over it ----------
// Owner's rule (26 Oct): US$5 a month, no overage, for up to 1,000 people. The included amounts of the Workers Paid
// plan, read on Cloudflare's pricing pages on 26 Oct 2026 (docs/COSTS.md has the links). Every hour the minute tick
// reads this billing cycle's usage from Cloudflare's GraphQL analytics (a read only Account Analytics token, the
// CF_ANALYTICS_TOKEN secret) and works out the month end at the last 48 hours' rate. Projected over BUDGET_HOLD_PCT
// of any included amount (or used over it): the hold. The costly switches go off for the rest of the billing cycle
// (BUDGET_HOLD_FLAGS, budgetHeld), load test keys stop working and an email goes to the owner. Over BUDGET_WARN_PCT:
// one warning email a cycle. The hold lifts by itself under BUDGET_LIFT_PCT; an admin can clear it (POST
// /api/budget/clear, for 6 hours); a new cycle clears it too.
const BUDGET_INCLUDED = {
  workerRequests: 10e6, workerCpuMs: 30e6, doRequests: 1e6, doGbSeconds: 400000, doRowsRead: 25e9, doRowsWritten: 50e6,
  d1RowsRead: 25e9, d1RowsWritten: 50e6, logEvents: 20e6,
};
const BUDGET_HOLD_PCT = 80, BUDGET_WARN_PCT = 50, BUDGET_LIFT_PCT = 60;
const BUDGET_RATE_MS = 48 * 3600000;
const BUDGET_HOLD_FLAGS = ["ENGINE_BOARDS", "ENGINE_PUSH", "LIVE_PUSH", "OWN_PLANNER", "ENGINE_LEARN", "LOAD_TESTS"];
// Whether the budget guard holds a switch off now (sync: from the copy serverConfig keeps, refreshed once a minute).
function budgetHeld(flag) {
  const b = serverCfg.budget;
  if (!b || !b.hold || !BUDGET_HOLD_FLAGS.includes(flag)) return false;
  return !b.holdCycle || b.holdCycle === budgetCycle(Date.now(), b.billingDay).start;
}
// A wrangler switch read through the guard: "on" only when the var says on and the guard does not hold it.
function flagOn(env, k) { return String((env && env[k]) || "").toLowerCase() === "on" && !budgetHeld(k); }
// The billing cycle around `now`: from day `day` of a month (UTC, 1 to 28, the BILLING_DAY var) to the same day of
// the next month. No day set: the calendar month.
function budgetCycle(now, day) {
  const d = new Date(now);
  const bd = Math.min(28, Math.max(1, Number(day) || 1));
  let y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (d.getUTCDate() < bd) { m -= 1; if (m < 0) { m = 11; y -= 1; } }
  const start = Date.UTC(y, m, bd);
  const end = Date.UTC(m === 11 ? y + 1 : y, (m + 1) % 12, bd);
  return { start, end };
}
// Month end at a day's rate: used + rate x days left. Each meter as a share of its included amount.
function budgetProject(used, perDay, now, cycle) {
  const left = Math.max(0, cycle.end - now) / 86400000;
  const out = {};
  let worst = { meter: null, projectedPct: 0, usedPct: 0 };
  for (const k of Object.keys(BUDGET_INCLUDED)) {
    const u = Number(used[k]) || 0, r = Number(perDay[k]) || 0;
    const projected = u + r * left;
    const m = { used: Math.round(u), perDay: Math.round(r), projected: Math.round(projected), included: BUDGET_INCLUDED[k],
      usedPct: Math.round((u / BUDGET_INCLUDED[k]) * 1000) / 10, projectedPct: Math.round((projected / BUDGET_INCLUDED[k]) * 1000) / 10 };
    out[k] = m;
    if (m.projectedPct > worst.projectedPct) worst = { meter: k, projectedPct: m.projectedPct, usedPct: m.usedPct };
  }
  return { meters: out, worst, daysLeft: Math.round(left * 10) / 10 };
}
// One GraphQL read of the account's usage between two times: Worker requests and CPU (every script), Durable Object
// requests (incoming socket messages count 1 in 20, as billed), duration in GB-s, SQLite rows, D1 rows. Log events
// are not in the analytics API: estimated as (Worker + Durable Object invocations) x 2 lines x the sampling rate.
async function budgetUsage(env, from, to) {
  const q = `query($a: String!, $s: Time!, $e: Time!) { viewer { accounts(filter: { accountTag: $a }) {
    w: workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: $s, datetime_lt: $e }) { sum { requests cpuTimeUs } }
    o: durableObjectsInvocationsAdaptiveGroups(limit: 1, filter: { datetime_geq: $s, datetime_lt: $e }) { sum { requests } }
    p: durableObjectsPeriodicGroups(limit: 1, filter: { datetimeMinute_geq: $s, datetimeMinute_lt: $e }) { sum { duration rowsRead rowsWritten inboundWebsocketMsgCount } }
    d: d1AnalyticsAdaptiveGroups(limit: 1, filter: { datetimeMinute_geq: $s, datetimeMinute_lt: $e }) { sum { rowsRead rowsWritten } }
  } } }`;
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", headers: { authorization: "Bearer " + env.CF_ANALYTICS_TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ query: q, variables: { a: env.CF_ACCOUNT_ID, s: new Date(from).toISOString(), e: new Date(to).toISOString() } }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || (j.errors && j.errors.length) || !j.data) throw new Error("analytics: " + ((j && j.errors && j.errors[0] && j.errors[0].message) || "HTTP " + r.status));
  const a = (j.data.viewer.accounts || [])[0] || {};
  const s = (k) => ((a[k] || [])[0] || {}).sum || {};
  const w = s("w"), o = s("o"), p = s("p"), d = s("d");
  const rate = Math.min(1, Math.max(0, Number(env.LOG_SAMPLING) || 0.1));
  return {
    workerRequests: Number(w.requests) || 0, workerCpuMs: (Number(w.cpuTimeUs) || 0) / 1000,
    doRequests: (Number(o.requests) || 0) + (Number(p.inboundWebsocketMsgCount) || 0) / 20, doGbSeconds: Number(p.duration) || 0,
    doRowsRead: Number(p.rowsRead) || 0, doRowsWritten: Number(p.rowsWritten) || 0,
    d1RowsRead: Number(d.rowsRead) || 0, d1RowsWritten: Number(d.rowsWritten) || 0,
    logEvents: ((Number(w.requests) || 0) + (Number(o.requests) || 0)) * 2 * rate,
  };
}
async function budgetSave(env, b) {
  await db(env).prepare("CREATE TABLE IF NOT EXISTS app_config (platform TEXT PRIMARY KEY, body TEXT NOT NULL, at INTEGER)").run();
  await db(env).prepare("INSERT INTO app_config (platform, body, at) VALUES ('budget', ?1, ?2) ON CONFLICT(platform) DO UPDATE SET body = ?1, at = ?2").bind(JSON.stringify(b), Date.now()).run();
  serverCfg.budget = b;
}
async function budgetLoad(env) {
  const row = await db(env).prepare("SELECT body FROM app_config WHERE platform = 'budget'").first().catch(() => null);
  try { return row && row.body ? JSON.parse(row.body) : null; } catch (e) { return null; }
}
// The owner's email through Email Routing (the ALERT_EMAIL send_email binding, to its verified address). Plain text.
async function budgetMail(env, subject, text) {
  if (!env || !env.ALERT_EMAIL) return "no email binding";
  const from = env.ALERT_FROM || "budget@transportsydney.app";
  const to = env.ALERT_TO || "contact@fintex.au";
  const raw = ['From: "Transport Sydney Live" <' + from + ">", "To: " + to, "Subject: " + subject, "Date: " + new Date().toUTCString(),
    "Message-ID: <" + crypto.randomUUID() + "@transportsydney.app>", "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", text].join("\r\n");
  const EmailMessage = await budgetEmailClass();
  if (!EmailMessage) return "no email module";
  await env.ALERT_EMAIL.send(new EmailMessage(from, to, raw));
  return "sent";
}
// The Workers email class (cloudflare:email); tests outside Workers set globalThis.TestEmailMessage.
async function budgetEmailClass() {
  try { return (await import("cloudflare:email")).EmailMessage; } catch (e) { return globalThis.TestEmailMessage || null; }
}
function budgetText(b) {
  const lines = Object.entries(b.meters || {}).map(([k, m]) => `${k}: ${m.used} used, ${m.projected} by the end of the cycle (${m.projectedPct}% of ${m.included} included)`);
  return lines.join("\n");
}
// The hourly check (runTick) or an admin's POST /api/budget/check.
async function budgetCheck(env, now = Date.now(), opts = {}) {
  if (!env || !env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) return { skipped: "no analytics token" };
  const prev = (await budgetLoad(env)) || {};
  const day = Number(env.BILLING_DAY) || null;
  const cycle = budgetCycle(now, day);
  // The rate is the last 48 hours' as a day's worth, counted over at least a day: it smooths the daily rhythm and the
  // engine timetable load every second night, while a load test (100,000 object requests in two hours) still projects
  // far past the line at once. A burst that has ended stays in what was used.
  const fromR = Math.max(cycle.start, now - BUDGET_RATE_MS);
  const [used, lastR] = await Promise.all([budgetUsage(env, cycle.start, now), budgetUsage(env, fromR, now)]);
  const span = Math.max(86400000, now - fromR);
  const perDay = {};
  for (const k of Object.keys(lastR)) perDay[k] = lastR[k] * (86400000 / span);
  const pr = budgetProject(used, perDay, now, cycle);
  const sameCycle = prev.cycle === cycle.start;
  const b = { at: now, cycle: cycle.start, cycleEnd: cycle.end, billingDay: day, meters: pr.meters, worst: pr.worst, daysLeft: pr.daysLeft,
    hold: sameCycle ? !!prev.hold : false, holdCycle: sameCycle ? prev.holdCycle || null : null, holdAt: sameCycle ? prev.holdAt || null : null,
    holdReason: sameCycle ? prev.holdReason || null : null, warnedCycle: sameCycle ? prev.warnedCycle || null : null,
    clearedAt: sameCycle ? prev.clearedAt || null : null, liftedAt: sameCycle ? prev.liftedAt || null : null, mail: null };
  const over = pr.worst.projectedPct >= BUDGET_HOLD_PCT || pr.worst.usedPct >= BUDGET_HOLD_PCT;
  // An admin's clear holds for 6 hours unless a meter is already used to 95%.
  const cleared = b.clearedAt && now - b.clearedAt < 6 * 3600000 && pr.worst.usedPct < 95;
  // A hold lifts on its own once the month end is back under BUDGET_LIFT_PCT and nothing is used past it.
  if (b.hold && !over && pr.worst.projectedPct < BUDGET_LIFT_PCT && pr.worst.usedPct < BUDGET_LIFT_PCT && !opts.dry) { b.hold = false; b.liftedAt = now; }
  else if (over && !b.hold && !cleared && !opts.dry) {
    b.hold = true; b.holdCycle = cycle.start; b.holdAt = now;
    b.holdReason = `${pr.worst.meter} projected ${pr.worst.projectedPct}% of the included amount (used ${pr.worst.usedPct}%)`;
    const wasOn = BUDGET_HOLD_FLAGS.filter((k) => String(env[k] || "").toLowerCase() === "on");
    const what = wasOn.length ? `switched off ${wasOn.join(", ")}` : `holds ${BUDGET_HOLD_FLAGS.join(", ")} off (none of them was on, so the app does not change)`;
    b.mail = await budgetMail(env, "Sydney Live: Cloudflare usage would pass the included amount this month",
      `At the last 48 hours' rate, ${b.holdReason}. The budget guard ${what} until the billing cycle ends (${new Date(cycle.end).toUTCString()}) or usage falls back under ${BUDGET_LIFT_PCT}%. Nothing has been charged beyond the US$5 plan by this reading.\n\n${budgetText(b)}\n\nThe app keeps working on the Trip Planner path. Admins can clear it with POST /api/budget/clear.`).catch((e) => "mail failed: " + String((e && e.message) || e).slice(0, 120));
  } else if (!over && pr.worst.projectedPct >= BUDGET_WARN_PCT && b.warnedCycle !== cycle.start && !opts.dry) {
    b.warnedCycle = cycle.start;
    b.mail = await budgetMail(env, "Sydney Live: Cloudflare usage past half of the included amount",
      `At the last 48 hours' rate, ${pr.worst.meter} reaches ${pr.worst.projectedPct}% of the Workers Paid included amount by the end of this billing cycle. Nothing is switched off yet; the guard does that at ${BUDGET_HOLD_PCT}%.\n\n${budgetText(b)}`).catch((e) => "mail failed: " + String((e && e.message) || e).slice(0, 120));
  }
  if (!opts.dry) await budgetSave(env, b);
  return b;
}
// GET /api/budget, POST /api/budget/check, POST /api/budget/clear (admin key).
async function budgetRoutes(request, env, url) {
  if (!adminOk(request)) return json({ error: "forbidden" }, 403);
  if (url.pathname === "/api/budget/check" && request.method === "POST") {
    try { return json(await budgetCheck(env, Date.now(), { dry: url.searchParams.get("dry") === "1" })); }
    catch (e) { return json({ error: String((e && e.message) || e).slice(0, 200) }, 502); }
  }
  if (url.pathname === "/api/budget/clear" && request.method === "POST") {
    const b = (await budgetLoad(env)) || {};
    b.hold = false; b.clearedAt = Date.now();
    await budgetSave(env, b);
    return json(b);
  }
  if (url.pathname === "/api/budget/mailcheck" && request.method === "POST") {
    // Builds the message without sending it: shows the binding and the email module are there.
    try { const EmailMessage = await budgetEmailClass(); return json({ binding: !!env.ALERT_EMAIL, module: typeof EmailMessage === "function" }); }
    catch (e) { return json({ binding: !!env.ALERT_EMAIL, module: false, error: String((e && e.message) || e).slice(0, 160) }); }
  }
  const b = await budgetLoad(env);
  const flags = {};
  for (const k of BUDGET_HOLD_FLAGS) flags[k] = { var: String(env[k] || ""), on: flagOn(env, k) };
  return json({ included: BUDGET_INCLUDED, holdPct: BUDGET_HOLD_PCT, warnPct: BUDGET_WARN_PCT, token: !!env.CF_ANALYTICS_TOKEN, email: !!env.ALERT_EMAIL, flags, last: b });
}

function parseTod(v) {
  if (Number.isInteger(v) && v >= 0 && v < 1440) return v;
  const m = /^(\d{1,2}):?(\d{2})$/.exec(String(v == null ? "" : v).trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
function hhmmColon(tod) { return String(Math.floor(tod / 60)).padStart(2, "0") + ":" + String(tod % 60).padStart(2, "0"); }
function cleanDays(v) {
  if (v == null) return [1, 2, 3, 4, 5];
  if (!Array.isArray(v)) return null;
  const s = [...new Set(v.map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= 7))].sort();
  return s.length ? s : null;
}
function shortStation(n) { return String(n || "").split(",")[0].replace(/ Station$/, "").trim(); }

function morningOut(c) {
  let last = null;
  try { last = c.last ? JSON.parse(c.last) : null; } catch (e) { last = null; }
  return { id: c.id, name: c.name || null, from: { id: c.from_id, name: c.from_name }, to: { id: c.to_id, name: c.to_name },
    time: hhmmColon(c.tod), timeText: todText(c.tod), days: String(c.days || "").split("").map(Number).filter(Boolean),
    mode: c.mode || null, lead: c.lead, active: !!c.active, created: c.created, last };
}

// The service you usually take: the journey whose first train, bus or ferry is planned closest
// to your usual time, not one that has already gone.
// With a usual mode (train, bus...) a journey that starts with it comes first; services of an
// unknown kind (on demand, school runs) only when nothing else is near the usual time.
function morningJourney(journeys, tod, now, mode = null) {
  const firstT = (j) => (j.legs || []).find((l) => l.kind === "transit");
  const off = (j) => { const t = sydneyNow(new Date(ms(firstT(j).planned))).tod; const d = Math.abs(t - tod); return Math.min(d, 1440 - d); };
  const cand = (journeys || []).filter((j) => firstT(j) && ms(j.board) > now - 60000 && off(j) <= 45);
  if (!cand.length) return null;
  const rank = (j) => { const m = firstT(j).mode; return (mode && m !== mode ? 2 : 0) + (m === "other" ? 1 : 0); };
  cand.sort((a, b) => rank(a) - rank(b) || off(a) - off(b) || ms(a.board) - ms(b.board));
  return cand[0];
}
const MORNING_MODES = new Set(["train", "metro", "bus", "coach", "ferry", "lightrail"]);
function wordCut(s, n) { s = String(s || ""); if (s.length <= n) return s; const c = s.slice(0, n); const i = c.lastIndexOf(" "); return (i > n * 0.6 ? c.slice(0, i) : c).replace(/[,;:\s]+$/, "") + "..."; }

// What is wrong with a journey right now. Every item comes from live or published data.
function morningIssues(j, c, outs) {
  const issues = [];
  const tl = (j.legs || []).filter((l) => l.kind === "transit");
  for (const l of tl) {
    const name = `${clock(ms(l.planned))} ${l.line}`;
    if (l.cancelled) issues.push({ kind: "cancelled", text: `The ${name} is cancelled.` });
    else if (l.realtime && l.delayMin != null && l.delayMin > MORNING_DELAY_MIN) issues.push({ kind: "delay", minutes: l.delayMin, text: `The ${name} is ${l.delayMin} min late.` });
    if (!l.cancelled && l.platformChangedFrom && l.fromPlatform) issues.push({ kind: "platform", text: `The ${name} now leaves from ${l.fromPlatform}, not ${l.platformChangedFrom}.` });
    if (l.transfer && l.transfer.risk === "miss") issues.push({ kind: "connection", text: `The change at ${shortStation(l.transfer.at)} to the ${name} looks too tight to make.` });
    for (const a of l.alerts || []) {
      const t = String(a.title || "").replace(/[.\s]+$/, "");
      if (!t) continue;
      const said = wordCut(t.toLowerCase().startsWith(String(l.line).toLowerCase()) ? t : `${l.line}: ${t}`, 140).replace(/([^.])$/, "$1.");
      if (MORNING_TRACKWORK_RE.test(t)) { issues.push({ kind: "trackwork", text: said }); break; }
      if (MORNING_CANCEL_RE.test(t) && !l.cancelled) { issues.push({ kind: "cancelled", text: said }); break; }
    }
  }
  if (tl.length) {
    const ends = [
      { ids: [c.from_id, tl[0].fromParent, tl[0].stopId], name: shortStation(c.from_name) || shortStation(tl[0].from), lifts: ["train", "metro"].includes(tl[0].mode) },
      { ids: [c.to_id, tl[tl.length - 1].toParent, tl[tl.length - 1].toStopId], name: shortStation(c.to_name) || shortStation(tl[tl.length - 1].to), lifts: ["train", "metro"].includes(tl[tl.length - 1].mode) },
    ];
    for (const e of ends) {
      if (!e.lifts) continue;
      const ids = e.ids.filter(Boolean).map(String);
      const o = (outs || []).find((x) => x.kind === "lift" && x.stops.some((s) => ids.includes(s)));
      if (o) issues.push({ kind: "lift", station: e.name, text: `Lift out of service at ${e.name}.` });
    }
  }
  // One line per problem.
  const seen = new Set();
  return issues.filter((i) => !seen.has(i.text) && seen.add(i.text));
}

function morningMessage(c, j, issues, planB = null) {
  const from = shortStation(c.from_name), to = shortStation(c.to_name);
  const body = issues.slice(0, 3).map((i) => i.text).join(" ") + (issues.length > 3 ? ` And ${issues.length - 3} more.` : "");
  if (!planB) return { title: `Check before you go: ${from} to ${to}`, body: wordCut(body, 300) };
  return { title: `Check before you go: ${from} to ${to}`, body: `${wordCut(body, 300 - planB.text.length - 4)} ${planB.text}` };
}

// Plan B in the alert: the issues that make the planned service a bad bet. A platform change or a lift is not one.
const PLANB_KINDS = new Set(["cancelled", "delay", "connection", "trackwork"]);
// The planner's means of transport numbers (product class) per mode, for exclMOT_n.
const PLANB_MOT = { train: 1, metro: 2, lightrail: 4, bus: 5, coach: 7, ferry: 9, school: 11 };
const tLegsOf = (j) => (j && j.legs || []).filter((l) => l.kind === "transit");
const firstKey = (j) => { const l = tLegsOf(j)[0]; return l ? `${l.tripId || l.line}@${l.planned}` : ""; };
/** True when the journey itself looks fine: nothing cancelled, no big delay, no change it will miss. */
function journeyOk(j) {
  return tLegsOf(j).every((l) => !l.cancelled && !(l.realtime && l.delayMin != null && l.delayMin > MORNING_DELAY_MIN) && !(l.transfer && l.transfer.risk === "miss"));
}
/** Lines named by a trackwork or suspension issue (only those can be avoided by a different route). */
function blockedLines(j, issues) {
  const out = new Set();
  for (const i of issues) if (i.kind === "trackwork") for (const l of tLegsOf(j)) if (i.text.startsWith(`${l.line}:`) || i.text.includes(` ${l.line} `) || i.text.startsWith(l.line + " ")) out.add(l.line);
  return out;
}
/**
 * The best other way for a morning check alert, or null. From the journeys already planned when it can (a later
 * service on the same line is fine for a cancellation or a delay); for trackwork on the line, one more planner
 * call with that mode left out. Earliest arrival wins. text: "Plan B: the 8:04 M1 from Epping, arrives 8:41."
 */
async function morningPlanB(env, c, j, issues, journeys, now, planner = trip) {
  if (!issues.some((i) => PLANB_KINDS.has(i.kind))) return null;
  const blocked = blockedLines(j, issues);
  const avoids = (x) => tLegsOf(x).every((l) => !blocked.has(l.line));
  const usable = (x) => x && firstKey(x) !== firstKey(j) && tLegsOf(x).length && ms(x.board) > now + 60000 && journeyOk(x) && avoids(x);
  let pool = (journeys || []).filter(usable);
  if (!pool.length && blocked.size) {
    const modes = new Set(tLegsOf(j).filter((l) => blocked.has(l.line)).map((l) => l.mode));
    const exclude = { excludedMeans: "checkbox" };
    for (const m of modes) if (PLANB_MOT[m]) exclude["exclMOT_" + PLANB_MOT[m]] = "1";
    if (Object.keys(exclude).length > 1) {
      const r = await planner(env, c.from_id, c.to_id, { count: 4, time: hhmmOf(sydneyNow(new Date(now)).tod), exclude }).catch(() => null);
      pool = (r && r.journeys || []).filter(usable);
    }
  }
  if (!pool.length) return null;
  pool.sort((a, b) => ms(a.arrive) - ms(b.arrive) || ms(a.board) - ms(b.board));
  const best = pool[0], f = tLegsOf(best)[0];
  const dep = ms(f.realtime && f.estimated ? f.estimated : f.planned);
  const what = f.mode === "bus" || f.mode === "coach" ? `${f.line} bus` : f.mode === "ferry" ? `${f.line} ferry` : f.line;
  const at = shortStation(f.from);
  const text = `Plan B: the ${clock(dep)} ${what}${at ? ` from ${at}` : ""}, arrives ${clock(ms(best.arrive))}.`;
  return { text, leave: best.leave, arrive: best.arrive, line: f.line, mode: f.mode, from: f.from || null, planned: f.planned, changes: best.changes || 0 };
}

async function morningEvaluate(env, c, now) {
  const r = await trip(env, c.from_id, c.to_id, { count: 5, time: hhmmOf(c.tod - 10), timetable: false });
  const j = morningJourney(r.journeys || [], c.tod, now, c.mode || null);
  if (!j) return { found: false, issues: [], service: null, alert: null };
  const outs = await liftOutages(env).catch(() => []);
  const issues = morningIssues(j, c, outs);
  const first = j.legs.find((l) => l.kind === "transit");
  const planB = issues.length ? await morningPlanB(env, c, j, issues, r.journeys || [], now).catch(() => null) : null;
  return {
    found: true, issues,
    service: { line: first.line, mode: first.mode, planned: first.planned, estimated: first.estimated, platform: first.fromPlatform || null, realtime: !!first.realtime,
      leave: j.leave, arrive: j.arrive, changes: j.changes },
    planB,
    alert: issues.length ? morningMessage(c, j, issues, planB) : null,
  };
}

// Run from the minute tick: checks whose usual time is between 3 min and `lead` min away.
async function processMorningChecks(env, now, opts = {}) {
  await morningSchema(env);
  const sn = sydneyNow(new Date(now));
  const out = [];
  const due = await d1all(env, `SELECT * FROM morning_checks WHERE active = 1 AND ((tod - ?1 + 1440) % 1440) BETWEEN 3 AND lead ORDER BY tod LIMIT 30`, sn.tod);
  for (const c of due) {
    const until = (c.tod - sn.tod + 1440) % 1440;
    const dep = sydneyNow(new Date(now + until * 60000));
    if (!String(c.days || "").includes(String(dep.dow))) { out.push({ id: c.id, skipped: "not today" }); continue; }
    const claim = await db(env).prepare("INSERT OR IGNORE INTO morning_sent (check_id, day, at, result) VALUES (?1, ?2, ?3, 'checking')").bind(c.id, dep.day, now).run();
    if (claim && claim.meta && claim.meta.changes === 0) continue; // already checked for this departure
    let ev;
    try { ev = await (opts.evaluate || morningEvaluate)(env, c, now); }
    catch (e) {
      // Live data did not answer: give the claim back so the next minute tries again.
      await db(env).prepare("DELETE FROM morning_sent WHERE check_id = ?1 AND day = ?2 AND result = 'checking'").bind(c.id, dep.day).run();
      out.push({ id: c.id, error: String(e && e.message || e).slice(0, 120) });
      continue;
    }
    let result = ev.found ? "ok" : "no service found";
    let pushed = null;
    if (ev.alert) {
      const n = await notify(env, { device: c.device }, { title: ev.alert.title, body: ev.alert.body, url: "/", tag: "m" + c.id, ttl: 1200 });
      result = "alert"; pushed = n.noteId || null;
    }
    const last = { day: dep.day, at: now, result, issues: ev.issues.map((i) => i.kind), alert: ev.alert || null };
    await db(env).prepare("UPDATE morning_sent SET result = ?3 WHERE check_id = ?1 AND day = ?2").bind(c.id, dep.day, result).run();
    await db(env).prepare("UPDATE morning_checks SET last = ?2 WHERE id = ?1").bind(c.id, JSON.stringify(last)).run();
    out.push({ id: c.id, result, issues: last.issues, note: pushed });
  }
  return out;
}

async function morningRoute(request, env, url) {
  await morningSchema(env);
  const p = url.searchParams;
  const d = db(env);
  const pushCount = async (device) => {
    const w = await d1all(env, "SELECT COUNT(*) AS n FROM push_subs WHERE device = ?1", device).catch(() => []);
    const e = await d1all(env, "SELECT COUNT(*) AS n FROM expo_tokens WHERE device = ?1", device).catch(() => []);
    return { web: (w[0] && w[0].n) || 0, expo: (e[0] && e[0].n) || 0 };
  };
  if (request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const device = cleanId(b.device);
    if (device.length < 6) return json({ error: "device needed" }, 400);
    const from = b.from || {}, to = b.to || {};
    const fromId = cleanId(from.id), toId = cleanId(to.id);
    if (!fromId || !toId) return json({ error: "from.id and to.id needed" }, 400);
    if (fromId === toId) return json({ error: "from and to are the same" }, 400);
    const tod = parseTod(b.time);
    if (tod == null) return json({ error: "time must be HH:MM (24 hour, Sydney time)" }, 400);
    const days = cleanDays(b.days);
    if (!days) return json({ error: "days must be a list of 1 (Monday) to 7 (Sunday)" }, 400);
    const lead = b.lead == null ? 15 : Math.round(Number(b.lead));
    if (!Number.isFinite(lead) || lead < 5 || lead > 45) return json({ error: "lead must be 5 to 45 minutes" }, 400);
    const name = b.name == null ? null : String(b.name).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40) || null;
    const fromName = String(from.name || fromId).trim().slice(0, 80), toName = String(to.name || toId).trim().slice(0, 80);
    const active = b.active === false ? 0 : 1;
    const mode = b.mode == null || b.mode === "" ? null : String(b.mode).toLowerCase();
    if (mode && !MORNING_MODES.has(mode)) return json({ error: "mode must be train, metro, bus, coach, ferry or lightrail" }, 400);
    let id = cleanId(b.id, 24);
    if (id) {
      const row = await d.prepare("SELECT id FROM morning_checks WHERE id = ?1 AND device = ?2").bind(id, device).first();
      if (!row) return json({ error: "not found" }, 404);
      await d.prepare(`UPDATE morning_checks SET name = ?3, from_id = ?4, from_name = ?5, to_id = ?6, to_name = ?7, tod = ?8, days = ?9, lead = ?10, active = ?11, mode = ?12 WHERE id = ?1 AND device = ?2`)
        .bind(id, device, name, fromId, fromName, toId, toName, tod, days.join(""), lead, active, mode).run();
      // A changed time or trip gets a fresh check today.
      await d.prepare("DELETE FROM morning_sent WHERE check_id = ?1").bind(id).run();
    } else {
      const n = await d1all(env, "SELECT COUNT(*) AS n FROM morning_checks WHERE device = ?1", device);
      if (n[0] && n[0].n >= MORNING_MAX_PER_DEVICE) return json({ error: `up to ${MORNING_MAX_PER_DEVICE} morning checks per device` }, 409);
      id = rid(9);
      await d.prepare(`INSERT INTO morning_checks (id, device, name, from_id, from_name, to_id, to_name, tod, days, lead, active, created, last, mode) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, ?13)`)
        .bind(id, device, name, fromId, fromName, toId, toName, tod, days.join(""), lead, active, Date.now(), mode).run();
    }
    const row = await d.prepare("SELECT * FROM morning_checks WHERE id = ?1").bind(id).first();
    return json({ ok: true, item: morningOut(row), push: await pushCount(device), enabled: await serverOn(env, "morningCheck") });
  }
  const device = cleanId(p.get("device"));
  if (device.length < 6) return json({ error: "device needed" }, 400);
  if (request.method === "DELETE") {
    const id = cleanId(p.get("id"), 24);
    const ids = (id ? await d1all(env, "SELECT id FROM morning_checks WHERE id = ?1 AND device = ?2", id, device)
      : await d1all(env, "SELECT id FROM morning_checks WHERE device = ?1", device)).map((r) => r.id);
    for (const x of ids) {
      await d.prepare("DELETE FROM morning_sent WHERE check_id = ?1").bind(x).run();
      await d.prepare("DELETE FROM morning_checks WHERE id = ?1 AND device = ?2").bind(x, device).run();
    }
    return json({ ok: true, deleted: ids.length });
  }
  if (request.method !== "GET") return json({ error: "method" }, 405);
  const items = (await d1all(env, "SELECT * FROM morning_checks WHERE device = ?1 ORDER BY tod", device)).map(morningOut);
  return json({ items, push: await pushCount(device), enabled: await serverOn(env, "morningCheck"), max: MORNING_MAX_PER_DEVICE });
}

// Check now without sending or claiming anything: what the morning check would say.
async function morningPreview(env, url) {
  await morningSchema(env);
  const p = url.searchParams;
  const device = cleanId(p.get("device")), id = cleanId(p.get("id"), 24);
  if (device.length < 6 || !id) return json({ error: "device and id needed" }, 400);
  const c = await db(env).prepare("SELECT * FROM morning_checks WHERE id = ?1 AND device = ?2").bind(id, device).first();
  if (!c) return json({ error: "not found" }, 404);
  const ev = await morningEvaluate(env, c, Date.now());
  return json({ item: morningOut(c), ...ev, sent: false });
}

// ---------- lift aware routing ----------
// With acc=1 the Trip Planner already asks for step free trips. On top of that, a trip that
// boards, changes or gets off at a station with a lift out of service right now is dropped
// when another option avoids it, and trips that are step free at every station come first.
const LIFT_MODES = new Set(["train", "metro"]);
// ---------- last way home reminder ----------
// From the Ask "Last train home" answer (or a trip that is the last one tonight) a device asks for ONE push
// LAST_HOME_LEAD min before the last service home. The server finds that service itself, looks again at live
// data as the time comes near (every 5 min from 20 min before, and once more at the moment), follows it if it
// moves or is replaced, and claims the send in D1 before notifying, so it is sent once. One reminder per device;
// a new one replaces it. DELETE cancels it, and Delete all data removes it. Server flag: lastWayHome.
const LAST_HOME_LEAD = 15;
const LAST_HOME_MAX_AHEAD = 8 * 3600000;
let lastHomeSchemaReady = null;
async function lastHomeSchema(env) {
  const d = db(env);
  if (!d) return false;
  if (!lastHomeSchemaReady) {
    lastHomeSchemaReady = d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS last_home (id TEXT PRIMARY KEY, device TEXT NOT NULL, from_id TEXT, from_name TEXT, to_id TEXT, to_name TEXT,
        mode TEXT, svc_mode TEXT, lead INTEGER DEFAULT 15, leave INTEGER, first_leave INTEGER, board INTEGER, line TEXT, stop TEXT, platform TEXT, status TEXT,
        created INTEGER, checked INTEGER, sent INTEGER, sent_text TEXT)`),
      d.prepare(`CREATE INDEX IF NOT EXISTS last_home_dev ON last_home (device)`),
      d.prepare(`CREATE INDEX IF NOT EXISTS last_home_due ON last_home (status, leave)`),
    ]).then(() => true).catch((e) => { lastHomeSchemaReady = null; throw e; });
  }
  return lastHomeSchemaReady;
}
const LAST_HOME_NOUN = { train: "train", metro: "metro", bus: "bus", ferry: "ferry", lightrail: "light rail", coach: "coach" };
/** The parts of a journey the reminder keeps: when to leave, the first service, its stop and platform. */
function lastHomeService(j) {
  const t = askTransit(j)[0];
  if (!t) return null;
  const board = ms(t.realtime && t.estimated ? t.estimated : t.planned);
  const walkFirst = j.legs && j.legs[0] && j.legs[0].kind !== "transit";
  return { leave: walkFirst ? ms(j.leave) : board, board, line: t.line || null, mode: t.mode || null, stop: t.from ? shortName(t.from).replace(/ Station$/, "") : null, platform: t.fromPlatform || null };
}
function lastHomeOut(r, now = Date.now()) {
  return {
    id: r.id, from: { id: r.from_id, name: r.from_name }, to: { id: r.to_id, name: r.to_name }, mode: r.mode || null, serviceMode: r.svc_mode || null, lead: r.lead,
    leave: r.leave ? new Date(r.leave).toISOString() : null, board: r.board ? new Date(r.board).toISOString() : null,
    remindAt: r.leave ? new Date(r.leave - r.lead * 60000).toISOString() : null,
    line: r.line || null, stop: r.stop || null, platform: r.platform || null,
    changedFrom: r.first_leave && r.leave && Math.abs(r.leave - r.first_leave) >= 2 * 60000 ? new Date(r.first_leave).toISOString() : null,
    status: r.status, checked: r.checked ? new Date(r.checked).toISOString() : null, sent: r.sent ? new Date(r.sent).toISOString() : null, text: r.sent_text || null,
    leaveText: r.leave ? hm(r.leave) : null, remindText: r.leave ? hm(r.leave - r.lead * 60000) : null,
  };
}
/** The push words. "Leave by 11:52pm for the last train home: the 12:04am T1 from Central, Platform 3." */
function lastHomeMessage(r, now) {
  const noun = LAST_HOME_NOUN[r.svc_mode || r.mode] || "service";
  const to = shortName(r.to_name || "").replace(/ Station$/, "");
  const mins = Math.max(0, Math.round((r.leave - now) / 60000));
  const what = [hm(r.board || r.leave), r.line].filter(Boolean).join(" ");
  const plat = r.platform ? `, ${r.platform}` : "";
  const from = r.stop ? ` from ${r.stop}` : "";
  const changed = r.first_leave && Math.abs(r.leave - r.first_leave) >= 2 * 60000 ? ` It changed from ${hm(r.first_leave)}.` : "";
  const lead = r.leave < (r.board || r.leave) ? `Leave by ${hm(r.leave)}` : mins >= 1 ? `Leaves in ${mins} min` : "Leaving now";
  return { title: `Last ${noun} to ${to}`, body: `${lead}: the ${what}${from}${plat}.${changed}`.slice(0, 300) };
}
async function lastHomePush(env, device) {
  const w = await d1all(env, "SELECT COUNT(*) AS n FROM push_subs WHERE device = ?1", device).catch(() => []);
  const e = await d1all(env, "SELECT COUNT(*) AS n FROM expo_tokens WHERE device = ?1", device).catch(() => []);
  return { web: (w[0] && w[0].n) || 0, expo: (e[0] && e[0].n) || 0 };
}
const lastHomePlace = (p) => { const id = cleanId(p && p.id, 80); return id ? { id, name: String((p && p.name) || id).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80), coord: /EPSG/.test(id) } : null; };

async function lastHomeRoute(request, env, url, opts = {}) {
  await ensureSchema3(env);
  await lastHomeSchema(env);
  const d = db(env);
  const p = url.searchParams;
  const enabled = await serverOn(env, "lastWayHome");
  if (request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const device = cleanId(b.device);
    if (device.length < 6) return json({ error: "device needed" }, 400);
    const from = lastHomePlace(b.from), to = lastHomePlace(b.to);
    if (!from || !to) return json({ error: "from.id and to.id needed" }, 400);
    if (from.id === to.id) return json({ error: "from and to are the same" }, 400);
    if (to.coord) return json({ error: "to must be a stop or place" }, 400);
    const mode = b.mode == null || b.mode === "" ? null : String(b.mode).toLowerCase();
    if (mode && !MORNING_MODES.has(mode)) return json({ error: "mode must be train, metro, bus, coach, ferry or lightrail" }, 400);
    if (!enabled) return json({ error: "Last way home reminders are off for now.", enabled: false }, 503);
    const now = Date.now();
    let found;
    try { found = await (opts.find || lastFind)(env, from, to, mode, { accessible: !!b.acc }); }
    catch (e) { return json({ error: "Live times did not answer. Try again in a moment." }, 502); }
    const svc = found && found.last ? lastHomeService(found.last) : null;
    if (!svc) return json({ error: "No service home found for the rest of tonight.", reason: "none" }, 409);
    if (svc.leave - now > LAST_HOME_MAX_AHEAD) return json({ error: "The last service is more than 8 hours away. Set it closer to the time.", reason: "far" }, 409);
    if (svc.leave - now < (LAST_HOME_LEAD + 1) * 60000) {
      return json({ error: svc.leave > now ? `It leaves in ${Math.max(1, Math.round((svc.leave - now) / 60000))} min, too soon for a reminder.` : "The last service has gone.", reason: "soon", leave: new Date(svc.leave).toISOString() }, 409);
    }
    await d.prepare("DELETE FROM last_home WHERE device = ?1").bind(device).run();
    const id = rid(9);
    await d.prepare(`INSERT INTO last_home (id, device, from_id, from_name, to_id, to_name, mode, svc_mode, lead, leave, first_leave, board, line, stop, platform, status, created, checked, sent, sent_text)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?15, ?8, ?9, ?9, ?10, ?11, ?12, ?13, 'waiting', ?14, ?14, NULL, NULL)`)
      .bind(id, device, from.id, from.name, to.id, to.name, mode, LAST_HOME_LEAD, svc.leave, svc.board, svc.line, svc.stop, svc.platform, now, svc.mode).run();
    const row = await d.prepare("SELECT * FROM last_home WHERE id = ?1").bind(id).first();
    return json({ ok: true, item: lastHomeOut(row, now), push: await lastHomePush(env, device), enabled });
  }
  const device = cleanId(p.get("device"));
  if (device.length < 6) return json({ error: "device needed" }, 400);
  if (request.method === "DELETE") {
    const id = cleanId(p.get("id"), 24);
    const r = id ? await d.prepare("DELETE FROM last_home WHERE id = ?1 AND device = ?2").bind(id, device).run()
      : await d.prepare("DELETE FROM last_home WHERE device = ?1").bind(device).run();
    return json({ ok: true, deleted: (r && r.meta && r.meta.changes) || 0 });
  }
  if (request.method !== "GET") return json({ error: "method" }, 405);
  const now = Date.now();
  // Shown until 30 min after the service left; older ones are gone from the answer and cleared hourly.
  const row = await d.prepare("SELECT * FROM last_home WHERE device = ?1 AND leave > ?2 ORDER BY created DESC LIMIT 1").bind(device, now - 30 * 60000).first();
  return json({ item: row ? lastHomeOut(row, now) : null, push: await lastHomePush(env, device), enabled, lead: LAST_HOME_LEAD });
}

// Minute tick: reminders whose time is within 20 min. Looks at live data again (every 5 min, and at the moment
// if the last look is over a minute old), follows the last service if it moved, then claims and sends once.
async function processLastHome(env, now, opts = {}) {
  await lastHomeSchema(env);
  const d = db(env);
  const out = [];
  const due = await d1all(env, "SELECT * FROM last_home WHERE status = 'waiting' AND sent IS NULL AND leave - lead * 60000 - 20 * 60000 <= ?1 ORDER BY leave LIMIT 20", now);
  for (const r of due) {
    if (now > r.leave + 2 * 60000) {
      await d.prepare("UPDATE last_home SET status = 'gone' WHERE id = ?1 AND sent IS NULL").bind(r.id).run();
      out.push({ id: r.id, result: "gone" });
      continue;
    }
    const at = r.leave - r.lead * 60000;
    const stale = !r.checked || now - r.checked >= 5 * 60000 || (now >= at && now - r.checked >= 60000);
    let none = false;
    if (stale) {
      let found = null;
      try { found = await (opts.find || lastFind)(env, { id: r.from_id, name: r.from_name, coord: /EPSG/.test(String(r.from_id)) }, { id: r.to_id, name: r.to_name }, r.mode || null, { time: sydneyParts(new Date(now)).time }); }
      catch (e) { out.push({ id: r.id, error: String(e && e.message || e).slice(0, 120) }); continue; }
      const svc = found && found.last ? lastHomeService(found.last) : null;
      if (svc && svc.leave > now - 60000) {
        r.leave = svc.leave; r.board = svc.board; r.line = svc.line || r.line; r.stop = svc.stop || r.stop; r.platform = svc.platform; r.svc_mode = svc.mode || r.svc_mode;
        await d.prepare("UPDATE last_home SET leave = ?2, board = ?3, line = ?4, stop = ?5, platform = ?6, checked = ?7, svc_mode = ?8 WHERE id = ?1")
          .bind(r.id, r.leave, r.board, r.line, r.stop, r.platform, now, r.svc_mode).run();
      } else {
        none = true;
        await d.prepare("UPDATE last_home SET checked = ?2 WHERE id = ?1").bind(r.id, now).run();
      }
    }
    if (now < r.leave - r.lead * 60000) { out.push({ id: r.id, result: "waiting", leave: r.leave }); continue; }
    const msg = none
      ? { title: "Last way home", body: `No service from ${shortName(r.from_name || "").replace(/ Station$/, "")} to ${shortName(r.to_name || "").replace(/ Station$/, "")} shows for the rest of tonight. Open Plan for other ways home.` }
      : lastHomeMessage(r, now);
    const claim = await d.prepare("UPDATE last_home SET sent = ?2, status = ?3, sent_text = ?4 WHERE id = ?1 AND sent IS NULL").bind(r.id, now, none ? "none" : "sent", msg.body).run();
    if (!claim || !claim.meta || claim.meta.changes !== 1) continue;
    const n = await notify(env, { device: r.device }, { title: msg.title, body: msg.body, url: "/", tag: "h" + r.id, ttl: 1200 });
    out.push({ id: r.id, result: none ? "none" : "sent", note: n.noteId || null });
  }
  return out;
}

function liftAwareRank(d, count) {
  const js = d && d.journeys;
  if (!Array.isArray(js) || !js.length) return d;
  const scored = js.map((j, i) => {
    const out = [], seen = new Set();
    let stepFree = true;
    for (const l of j.legs || []) {
      if (l.kind === "walk") continue;
      const a = l.access || {};
      // A station lift matters for trains and metro; a bus or coach stop outside the station
      // is reached from the street.
      const usesLifts = LIFT_MODES.has(l.mode);
      for (const [s, name] of [[a.from, l.from], [a.to, l.to]]) {
        if (!s) { stepFree = false; continue; }
        if (s.level !== "independent") stepFree = false;
        if (usesLifts && s.liftOut && !seen.has(s.id)) { seen.add(s.id); out.push({ id: s.id, name: shortStation(name), title: s.outage || null }); }
      }
    }
    j.stepFree = stepFree;
    j.liftOutages = out;
    return { j, i, blocked: out.length > 0, stepFree };
  });
  const clear = scored.filter((s) => !s.blocked);
  const keep = clear.length ? clear : scored;
  keep.sort((a, b) => (a.stepFree === b.stepFree ? 0 : a.stepFree ? -1 : 1) || a.i - b.i);
  d.journeys = keep.map((s) => s.j).slice(0, count || keep.length);
  d.liftAware = { avoided: scored.length - keep.length, allAffected: !clear.length,
    stations: [...new Map(scored.flatMap((s) => s.j.liftOutages).map((o) => [o.id, o.name])).values()] };
  return d;
}

// Occupancy switched off from the server config: drop it from every answer.
function stripOccupancy(d) {
  const strip = (x) => { if (x && typeof x === "object") { delete x.occupancy; if (x.vehicle && typeof x.vehicle === "object") { delete x.vehicle.occupancy; delete x.vehicle.quiet; } } };
  for (const it of (d && d.items) || []) strip(it);
  for (const j of (d && d.journeys) || []) for (const l of j.legs || []) strip(l);
  if (d && d.vehicle) strip(d);
  return d;
}

// ---------- the minute scheduler ----------

async function sampleStops(env, sn, budgetOk) {
  if (!budgetOk) return { skipped: "budget" };
  const d = db(env);
  const extra = new Set();
  try {
    for (const r of (await d.prepare("SELECT from_id FROM saved").all()).results || []) extra.add(r.from_id);
    for (const r of (await d.prepare("SELECT from_id FROM commutes WHERE active = 1").all()).results || []) extra.add(r.from_id);
  } catch (e) { /* tables may be new */ }
  const list = [...new Set([...SAMPLE_STOPS, ...extra])].filter((x) => x && /^\d+$/.test(x)).slice(0, 14);
  // Each stop is sampled every 4 minutes, spread across minutes.
  const mine = list.filter((_, i) => i % 4 === sn.tod % 4).slice(0, 4);
  let rows = 0;
  const done = [];
  for (const stop of mine) {
    try {
      const r = await departures(env, stop, { log: false, sampleOnly: true, timetable: false });
      const now = Date.now();
      const keep = r.items.filter((i) => i.realtime && i.tripId && i.estimated && ms(i.estimated) - now < 6 * 60000 && ms(i.estimated) > now - 30000);
      if (keep.length) {
        const stmt = d.prepare(`INSERT INTO obs (day, trip_id, stop_id, route, mode, planned, est, delay_s, source, first_seen, last_seen, n)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, 1)
          ON CONFLICT (day, trip_id, stop_id) DO UPDATE SET est = excluded.est, delay_s = excluded.delay_s, source = excluded.source,
          last_seen = excluded.last_seen, n = obs.n + 1`);
        await d.batch(keep.slice(0, 40).map((i) => stmt.bind(sydneyParts(new Date(i.planned)).date, i.tripId, i.stopId, i.line, i.mode, ms(i.planned), ms(i.estimated),
          Math.round((ms(i.estimated) - ms(i.planned)) / 1000), "sample:" + (i.source || "planner"), now)));
        rows += Math.min(40, keep.length);
      }
      done.push(stop + ":" + keep.length);
    } catch (e) { done.push(stop + ":error"); }
  }
  return { sampled: done, rows };
}

async function tickLease(env, now) {
  const d = db(env);
  await d.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('lease', '0')").run();
  const r = await d.prepare("UPDATE meta SET v = ?1 WHERE k = 'lease' AND CAST(v AS INTEGER) < ?2").bind(String(now), now - 40000).run();
  return (r.meta && r.meta.changes) > 0;
}

async function runTick(env, opts = {}) {
  const t0 = Date.now();
  const c0 = upstream.calls;
  await ensureSchema3(env);
  const now = Date.now();
  if (!opts.force && !(await tickLease(env, now))) return { skipped: "another tick is running" };
  const sn = sydneyNow();
  const use = await usageToday(env);
  const out = { at: new Date(now).toISOString(), sydney: todText(sn.tod), callsToday: use.calls, watches: [], commutes: [] };
  // Watches
  if (use.calls < WATCH_BUDGET) {
    const q = opts.device
      ? d1all(env, "SELECT * FROM watches WHERE active = 1 AND device = ?1 ORDER BY created LIMIT 10", opts.device)
      : d1all(env, "SELECT * FROM watches WHERE active = 1 ORDER BY created LIMIT 25");
    for (const w of await q) {
      try { out.watches.push(await processWatch(env, w, Date.now())); }
      catch (e) { out.watches.push({ id: w.id, error: String(e && e.message || e).slice(0, 160) }); }
    }
  }
  // Trip cards on iPhone lock screens (build 205 and later), updated by push
  if (!opts.device) out.liveActivities = await tickLiveActivities(env, Date.now()).catch((e) => ({ error: String(e && e.message || e).slice(0, 160) }));
  // Commutes
  if (!opts.device && use.calls < WATCH_BUDGET) {
    const days = String(sn.dow);
    for (const c of await d1all(env, "SELECT * FROM commutes WHERE active = 1")) {
      if (!String(c.days || "").includes(days)) continue;
      try { out.commutes.push(await processCommute(env, c, Date.now(), sn)); }
      catch (e) { out.commutes.push({ id: c.id, error: String(e && e.message || e).slice(0, 160) }); }
    }
  }
  // Morning checks: one look at live data shortly before a usual trip, an alert only if something is wrong
  if (!opts.device && use.calls < WATCH_BUDGET && (await serverOn(env, "morningCheck"))) {
    out.morning = await processMorningChecks(env, Date.now()).catch((e) => ({ error: String(e && e.message || e).slice(0, 160) }));
  }
  // Weekend trackwork: one push on Thursday evening when planned work this weekend is on a morning check's trip
  if (!opts.device && use.calls < WATCH_BUDGET && (await serverOn(env, "weekendTrackwork")) && (await serverOn(env, "morningCheck"))) {
    out.weekendPush = await processWeekendPush(env, Date.now()).catch((e) => ({ error: String(e && e.message || e).slice(0, 160) }));
  }
  // Last way home: one push before the last service home, looked at again live as the time comes near
  if (!opts.device && use.calls < WATCH_BUDGET && (await serverOn(env, "lastWayHome"))) {
    out.lastHome = await processLastHome(env, Date.now()).catch((e) => ({ error: String(e && e.message || e).slice(0, 160) }));
  }
  // Lift outages on saved trip stations, car park nearly full watches
  if (!opts.device) out.facilities = await facTick(env, Date.now(), sn, opts).catch((e) => ({ error: String(e && e.message || e).slice(0, 160) }));
  // Usual lateness: fold one day of recorded live times into late_agg when one is due (once a day after the backfill)
  if (!opts.device) out.late = await lateTick(env, Date.now()).catch((e) => ({ error: String(e && e.message || e).slice(0, 160) }));
  // Service alerts digest for the trackwork card and line status, every ALERT_EVERY_MIN minutes
  if (!opts.device && (sn.tod % ALERT_EVERY_MIN === 3 || opts.force)) out.alerts = await refreshAlertDigest(env, now).catch((e) => ({ error: String(e && e.message || e).slice(0, 160) }));
  // Saved trip alerts (src/tripalerts.js): the minute after the digest, every phone's trips against it; no NSW call.
  if (!opts.device && typeof processTripAlerts === "function" && sn.tod % ALERT_EVERY_MIN === 4 && (await serverOn(env, "tripAlerts"))) {
    out.tripAlerts = await processTripAlerts(env, Date.now()).catch((e) => ({ error: String(e && e.message || e).slice(0, 160) }));
  }
  // Budget guard (docs/COSTS.md): this billing cycle's Cloudflare usage once an hour; past 80% of an included amount
  // at month end, the costly switches go off and the owner gets an email.
  if (!opts.device && sn.tod % 60 === 17) {
    await serverConfig(env).catch(() => null);
    out.budget = await budgetCheck(env, now).then((b) => (b && b.worst ? { worst: b.worst, hold: b.hold, mail: b.mail } : b)).catch((e) => ({ error: String(e && e.message || e).slice(0, 160) }));
  }
  // Background sampling for predictions
  if (!opts.device && !opts.noSample) out.sample = await sampleStops(env, sn, use.calls < SAMPLE_BUDGET);
  // Housekeeping once an hour
  if (!opts.device && sn.tod % 60 === 7) {
    await db(env).prepare("DELETE FROM notes WHERE at < ?1").bind(now - 3 * 86400000).run().catch(() => null);
    await db(env).prepare("UPDATE watches SET active = 0, ended = 'expired' WHERE active = 1 AND expires < ?1").bind(now).run().catch(() => null);
    // Retention promised in the privacy policy: trip searches 90 days, finished watches 30 days.
    await db(env).prepare("DELETE FROM searches WHERE at < ?1").bind(now - 90 * 86400000).run().catch(() => null);
    await db(env).prepare("DELETE FROM morning_sent WHERE at < ?1").bind(now - 7 * 86400000).run().catch(() => null);
    await db(env).prepare("DELETE FROM last_home WHERE leave < ?1").bind(now - 12 * 3600000).run().catch(() => null);
    await db(env).prepare("DELETE FROM ip_rate WHERE win < ?1").bind(Math.floor(now / 60000) - 5).run().catch(() => null);
    await db(env).prepare("DELETE FROM watches WHERE active = 0 AND updated < ?1").bind(now - 30 * 86400000).run().catch(() => null);
    // Shared live trips: deleted, positions included, once the trip is over.
    await db(env).prepare("DELETE FROM shares WHERE expires < ?1").bind(now).run().catch(() => null);
    // Contact form messages: deleted within 12 months, as the privacy policy says.
    await db(env).prepare("DELETE FROM feedback WHERE at < ?1").bind(now - 365 * 86400000).run().catch(() => null);
    // Push tokens: trip card tokens once the trip ends (24 h at most), phone push tokens unused for 30 days.
    out.tokens = await prunePushTokens(env, now).catch((e) => ({ error: String(e && e.message || e).slice(0, 160) }));
    // Raw recorded live times older than anything reads.
    out.obs = await pruneObs(env, now).catch((e) => ({ error: String(e && e.message || e).slice(0, 160) }));
  }
  // Saved boards for first opens: the busiest stops and every stop opened in the last 30 min (warmBoards).
  if (!opts.device && !opts.noWarm) out.warm = await warmBoards(env, opts.exec || null, use, sn).catch((e) => ({ error: String(e && e.message || e).slice(0, 160) }));
  if (!opts.device && sn.tod % 60 === 7) await db(env).prepare("DELETE FROM board_copies WHERE at < ?1").bind(now - 86400000).run().catch(() => null);
  if (!opts.device) await db(env).prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('last_tick', ?1)").bind(String(now)).run().catch(() => null);
  const calls = upstream.calls - c0;
  upstream.flushed = Math.max(upstream.flushed || 0, upstream.calls);
  await bumpUsage(env, { calls, ticks: opts.device ? 0 : 1, rows: (out.sample && out.sample.rows) || 0, pushes: out.watches.reduce((n, w) => n + ((w.sent && w.sent.length) || 0), 0) });
  out.calls = calls;
  out.ms = Date.now() - t0;
  return out;
}
async function d1all(env, sql, ...args) {
  const r = await db(env).prepare(sql).bind(...args).all();
  return r.results || [];
}
function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }

function q0(p, k) { return !!p.get(k); }
// Adds predictions to boards and trips, and remembers trip searches for commute memory.
async function afterAnswer(env, d, o) {
  if (!d) return;
  // Limited Stops from our timetable (raptor.js markLimited): a set lookup, never a wait on the planner object.
  if (typeof markLimited === "function") await markLimited(env, d, o.exec).catch(() => 0);
  try {
    if (d.kind === "departures" && d.items) await predictions(env, d.items);
    if (d.kind === "trip" && d.journeys) {
      const legs = d.journeys.flatMap((j) => j.legs.filter((l) => l.kind === "transit"));
      await predictions(env, legs, 16);
      if (o.log !== false && d.from && d.to && d.from.id && !/EPSG/.test(String(d.from.id)) && !/EPSG/.test(String(d.to.id)) && !d.via && !d.chain && !d.when) {
        const s = { profile: o.profile, device: o.device ? cleanId(o.device) : null, from: d.from, to: d.to, src: d.saved ? "saved" : "search" };
        if (o.exec) o.exec.waitUntil(logSearch(env, s)); else await logSearch(env, s);
      }
    }
  } catch (e) { /* predictions are optional */ }
  const n = upstream.calls - (upstream.flushed || 0);
  if (o.exec && n > 0) {
    upstream.flushed = upstream.calls;
    o.exec.waitUntil(ensureSchema3(env).then(() => bumpUsage(env, { calls: n })).catch(() => null));
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*", ...API_SEC_HEADERS } });
}
function textRes(s) { return new Response(s, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*", ...API_SEC_HEADERS } }); }
function serviceQuery(p) {
  const q = {};
  for (const k of ["trip", "mode", "line", "feed", "stop", "destId", "planned", "to", "stopName", "dest", "color"]) if (p.get(k)) q[k] = p.get(k);
  return q;
}

// ---- live card start (generated by tools/gen-livecard.mjs, do not edit by hand)
const LIVECARD = (() => {
  // src/lib/liveCalc.ts
  const tms = (s) => (s ? new Date(s).getTime() : NaN);
  const tOf = (s) => (s ? tms(s.estimated || s.planned) : NaN);
  const timed = (s) => !!s && !!(s.planned || s.estimated) && !s.skipped;
  const idx = (v) => (typeof v === 'number' ? v : -1);
  const hasXY = (s) => !!s && typeof s.lat === 'number' && typeof s.lon === 'number';
  function distM(a, b) {
      const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
      const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
      return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function carriedDelay(d, k) {
      if (!d || !d.stops || !d.stops.length)
          return null;
      const at = (s) => (s && s.estimated && s.planned && !s.skipped ? tms(s.estimated) - tms(s.planned) : null);
      for (let j = Math.min(k, d.stops.length - 1); j >= 0; j--) {
          const v = at(d.stops[j]);
          if (v != null && Number.isFinite(v))
              return v;
      }
      for (let j = Math.max(0, k + 1); j < d.stops.length; j++) {
          const v = at(d.stops[j]);
          if (v != null && Number.isFinite(v))
              return v;
      }
      return null;
  }
  function liveAt(d, k) {
      const s = d.stops[k];
      if (!s || s.skipped)
          return NaN;
      if (s.estimated)
          return tms(s.estimated);
      const dl = carriedDelay(d, k);
      return s.planned ? tms(s.planned) + (dl ?? 0) : NaN;
  }
  function vehicleNext(d) {
      const v = d?.vehicle;
      if (!d || !v || (typeof v.ageS === 'number' && v.ageS > 180) || !hasXY(v))
          return -1;
      const st = d.stops;
      let best = Infinity, bi = -1, near = -1, nd = Infinity;
      for (let i = 0; i < st.length; i++) {
          const a = st[i];
          if (!hasXY(a))
              continue;
          const da = distM(v, a);
          if (da < nd) {
              nd = da;
              near = i;
          }
          let j = i + 1;
          while (j < st.length && !hasXY(st[j]))
              j++;
          const b = st[j];
          if (!hasXY(b))
              continue;
          const ex = da + distM(v, b) - distM(a, b);
          if (ex < best) {
              best = ex;
              bi = j;
          }
      }
      if (near >= 0 && nd < 150)
          return near;
      if (bi < 0 || best > 1500)
          return -1;
      return bi;
  }
  function trackOf(d, t) {
      if (!d || !d.stops || !d.stops.length)
          return { ni: -1, how: 'timetable' };
      const sn = idx(d.nextIndex);
      const p = d.progress;
      if (p === 'vehicle' && sn >= 0)
          return { ni: sn, how: 'vehicle' };
      const g = vehicleNext(d);
      if (g >= 0)
          return { ni: g, how: 'vehicle' };
      if (p === 'timetable')
          return { ni: sn, how: 'timetable' };
      if (d.stops.some((s) => !!s.estimated)) {
          const k = d.stops.findIndex((s, i) => timed(s) && liveAt(d, i) >= t - 20000);
          return { ni: k < 0 ? d.stops.length : k, how: 'live' };
      }
      return { ni: sn, how: 'timetable' };
  }
  function gpsOnRun(pos, d, mi, ai, t) {
      if (!pos || !hasXY(pos) || !d || ai < 0 || !hasXY(d.stops[ai]))
          return null;
      if (pos.at != null && t - pos.at > 120000)
          return null;
      if (pos.acc != null && pos.acc > 500)
          return null;
      const thr = Math.max(300, Math.min(pos.acc || 0, 500));
      if (distM(pos, d.stops[ai]) <= thr)
          return 'at';
      let k = -1, dk = Infinity;
      for (let i = Math.max(0, mi); i < d.stops.length; i++) {
          const s = d.stops[i];
          if (!hasXY(s))
              continue;
          const m = distM(pos, s);
          if (m < dk) {
              dk = m;
              k = i;
          }
      }
      if (k < 0 || dk > 800)
          return null;
      return k < ai ? 'before' : k > ai ? 'after' : 'at';
  }
  function computeLive(legs, svc, t, memo, pos) {
      const last = legs.length - 1;
      const rode = memo?.rode || {};
      const here = memo?.here || {};
      if (memo?.arrivedAt) {
          const L0 = legs.map((l, i) => {
              const arr = here[i] ?? rode[i] ?? (l.arrPlanned ? tms(l.arrPlanned) : tms(l.planned));
              return { dep: tms(l.estimated || l.planned), arr, delay: 0, live: false, d: svc[i] || null };
          });
          return { done: true, L2: L0, eta: here[last] ?? rode[last] ?? memo.arrivedAt };
      }
      const fin = [];
      const L2 = legs.map((l, i) => {
          let d = svc[i] || null;
          if (d && !sameRun(d, l, rode[i] != null))
              d = null;
          if (here[i] != null) {
              fin[i] = true;
              return { dep: tms(l.estimated || l.planned), arr: here[i], delay: 0, live: !!d?.live, d, arrLive: true, track: 'tap', ni: -1 };
          }
          if (!d && rode[i] != null) {
              const a = rode[i];
              fin[i] = t >= a + 45000;
              return { dep: tms(l.estimated || l.planned), arr: a, delay: 0, live: false, d: null, arrLive: true, track: 'live', ni: -1 };
          }
          const mi = idx(d?.mineIndex), ai = idx(d?.alightIndex);
          const mineS = d && mi >= 0 ? d.stops[mi] : null, offS = d && ai >= 0 ? d.stops[ai] : null;
          const trk = trackOf(d, t);
          const dMine = mineS && mineS.estimated && mineS.planned ? tms(mineS.estimated) - tms(mineS.planned) : null;
          const dOff = d ? carriedDelay(d, ai >= 0 ? ai : d.stops.length - 1) : null;
          const dPlan = l.estimated ? tms(l.estimated) - tms(l.planned) : null;
          const delay = dMine ?? dOff ?? dPlan ?? 0;
          const dep = mineS && Number.isFinite(tOf(mineS)) ? tOf(mineS) : tms(l.estimated || l.planned);
          let arr0, arrLive = false, arrDelay;
          if (offS && offS.estimated) {
              arr0 = tms(offS.estimated);
              arrLive = true;
              arrDelay = offS.planned ? arr0 - tms(offS.planned) : undefined;
          }
          else if (offS && offS.planned) {
              arr0 = tms(offS.planned) + (dOff ?? 0);
              arrLive = dOff != null;
              arrDelay = dOff ?? undefined;
          }
          else if (l.arrPlanned) {
              const dl = dOff ?? dMine;
              arr0 = tms(l.arrPlanned) + (dl ?? dPlan ?? 0);
              arrLive = dl != null;
              arrDelay = dl ?? undefined;
          }
          else
              arr0 = dep + 10 * 60000;
          if (!Number.isFinite(arr0) && l.arrPlanned)
              arr0 = tms(l.arrPlanned) + (dOff ?? dMine ?? 0);
          const short = vehicleShort(d, mi, ai);
          const ni = trk.ni;
          const trusted = trk.how !== 'timetable';
          const past = !!d && ai >= 0 && trusted && ni > ai && !short;
          const arr = heldArrival(d, ai, arr0, t, short, trusted ? ni : -1);
          let gps = gpsOnRun(pos, d, mi, ai, t);
          if (!gps && pos && i < last) {
              const n = svc[i + 1] || null, nmi = idx(n?.mineIndex);
              if (n && nmi >= 0 && hasXY(n.stops[nmi]) && hasXY(pos) && (pos.at == null || t - pos.at <= 120000) && (pos.acc == null || pos.acc <= 500)
                  && distM(pos, n.stops[nmi]) <= Math.max(300, Math.min(pos.acc || 0, 500)))
                  gps = 'at';
          }
          let done = false;
          if (gps === 'at' || gps === 'after')
              done = true;
          else if (gps === 'before')
              done = false;
          else if (past)
              done = true;
          else if (arrLive && t >= arr + 45000 && !short)
              done = true;
          fin[i] = done;
          const track = gps === 'at' || gps === 'after' ? 'gps' : trk.how;
          return { dep, arr, delay: delay || 0, live: !!d?.live, d, gone: past, arrLive, arrDelay, track, ni,
              ...(gps === 'at' || gps === 'after' ? { gpsHere: true } : {}), ...(gps === 'before' ? { gpsBefore: true } : {}) };
      });
      for (let i = 1; i < L2.length; i++) {
          const prev = here[i - 1] ?? rode[i - 1];
          if (prev == null || here[i] != null || !Number.isFinite(L2[i].dep))
              continue;
          const ready = prev + (legs[i].walkBefore || 0) * 60000;
          if (connRisk(Math.round((L2[i].dep - ready) / 60000)) !== 'miss')
              continue;
          const lateBy = ready - L2[i].dep;
          L2[i] = { ...L2[i], dep: ready, arr: L2[i].arr + lateBy, gone: false, missed: true, was: L2[i].dep };
          fin[i] = false;
      }
      const cur = L2.findIndex((_, i) => !fin[i]);
      if (cur < 0)
          return { done: true, L2, eta: L2[last].arr };
      const x = L2[cur], d = x.d;
      const mi = idx(d?.mineIndex), ai = idx(d?.alightIndex);
      const ni0 = x.ni ?? -1;
      const how = x.track || 'timetable';
      let phase = 'wait';
      if (x.missed)
          phase = 'wait';
      else if (d && mi >= 0 && how !== 'timetable')
          phase = ni0 > mi || how === 'gps' ? 'ride' : 'wait';
      else
          phase = t >= x.dep ? 'ride' : 'wait';
      let nextIdx = d ? ni0 : -1;
      if (d && nextIdx >= 0) {
          while (nextIdx < d.stops.length - 1 && nextIdx !== ai && !timed(d.stops[nextIdx]))
              nextIdx++;
      }
      const stopsLeft = d && ai >= 0 && phase === 'ride' && how !== 'timetable' ? d.stops.slice(Math.max(nextIdx, mi + 1), ai + 1).filter(timed).length : null;
      const conns = [];
      if (x.missed && cur > 0) {
          conns.push({ i: cur - 1, at: legs[cur - 1].to || '', spare: -1, risk: 'miss', next: legs[cur], nextDep: x.was ?? x.dep });
      }
      for (let i = cur; i < last; i++) {
          const a = L2[i], b = L2[i + 1];
          const spare = Math.round((b.dep - a.arr) / 60000 - (legs[i + 1].walkBefore || 0));
          conns.push({ i, at: legs[i].to || '', spare, risk: connRisk(spare), next: legs[i + 1], nextDep: b.dep });
      }
      const e = etaFrom(legs, L2, cur);
      const lateMs = phase === 'ride' ? (x.arrLive ? x.arrDelay : undefined) : (x.live ? x.delay : undefined);
      const delayMin = how !== 'timetable' && lateMs != null && Number.isFinite(lateMs) ? Math.round(lateMs / 60000) : null;
      return { done: false, cur, phase, nextIdx, stopsLeft, L2, conns, eta: e.eta, live: x.live, track: how, delayMin, ...(e.late ? { etaLate: true } : {}) };
  }
  const connRisk = (spare) => (spare < 0 ? 'miss' : spare < 2 ? 'tight' : 'ok');
  function heldArrival(d, ai, arr, t, short = false, next) {
      if (!d || ai < 0 || !Number.isFinite(arr))
          return arr;
      if (!short) {
          if (!d.live)
              return arr;
          const ni = next != null && next >= 0 ? next : idx(d.nextIndex);
          if (ni < 0 || ni > ai || d.stops[ai]?.passed)
              return arr;
      }
      if (t - arr < 30000 || t - arr > 10 * 60000)
          return arr;
      return t + 30000;
  }
  function vehicleShort(d, mi, ai) {
      const v = d?.vehicle;
      if (!d || !v || ai < 0 || mi < 0 || ai <= mi)
          return false;
      if (typeof v.lat !== 'number' || typeof v.lon !== 'number' || (typeof v.ageS === 'number' && v.ageS > 180))
          return false;
      const A = d.stops[mi], B = d.stops[ai];
      if (typeof A?.lat !== 'number' || typeof A?.lon !== 'number' || typeof B?.lat !== 'number' || typeof B?.lon !== 'number')
          return false;
      const k = Math.cos((B.lat * Math.PI) / 180);
      const ax = A.lon * k, ay = A.lat, bx = B.lon * k, by = B.lat, vx = v.lon * k, vy = v.lat;
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2;
      if (!(L2 > 0))
          return false;
      const f = ((vx - ax) * (bx - ax) + (vy - ay) * (by - ay)) / L2;
      const distM = Math.hypot(vx - bx, vy - by) * 111320;
      return f < 0.9 && distM > 500;
  }
  function etaFrom(legs, L2, cur) {
      let end = L2[cur].arr;
      let late = false;
      for (let i = cur + 1; i < L2.length; i++) {
          const b = L2[i];
          const ready = end + (legs[i].walkBefore || 0) * 60000;
          const spare = Math.round((b.dep - ready) / 60000);
          if (connRisk(spare) !== 'miss' || !Number.isFinite(b.dep)) {
              end = b.arr;
              continue;
          }
          late = true;
          end = b.arr + (ready - b.dep);
      }
      return { eta: end, late };
  }
  function sameRun(d, l, boarded = true) {
      if (d.tripId && l.tripId && d.tripId !== l.tripId)
          return false;
      const mi = idx(d.mineIndex), ni = idx(d.nextIndex);
      const mineS = mi >= 0 ? d.stops[mi] : null;
      if (mineS?.planned && l.planned && Math.abs(tms(mineS.planned) - tms(l.planned)) > 5 * 60000)
          return false;
      if (boarded && mi >= 0 && ni >= 0 && ni <= mi)
          return false;
      return true;
  }
  function nextMemo(memo, s, now) {
      const m = { rode: { ...(memo?.rode || {}) }, arrivedAt: memo?.arrivedAt ?? null };
      const here = { ...(memo?.here || {}) };
      s.L2.forEach((x, i) => { if (x.gpsHere && here[i] == null && now != null)
          here[i] = now; });
      if (Object.keys(here).length)
          m.here = here;
      if (!s.done && s.phase === 'ride' && s.track !== 'timetable' && s.L2[s.cur].arrLive !== false && Number.isFinite(s.L2[s.cur].arr))
          m.rode[s.cur] = s.L2[s.cur].arr;
      return m;
  }
  const notLive = (s) => !s.done && s.track === 'timetable';
  function tripAlerts(legs, s, alerted, serverWatching, f) {
      const out = [];
      const add = (key, title, body) => { if (!alerted[key] && !out.some((a) => a.key === key))
          out.push({ key, title, body }); };
      const last = legs.length - 1;
      if (serverWatching)
          return out;
      if (s.done) {
          add('arrived', "You've arrived", `${f.short(legs[last]?.to)} at ${f.clock(s.eta)}. Trip alerts are off.`);
          return out;
      }
      if (s.phase === 'ride' && !notLive(s)) {
          const d = s.L2[s.cur].d, l = legs[s.cur];
          if (d && (d.alightIndex ?? -1) > 0 && s.nextIdx === d.alightIndex) {
              if (s.cur === last)
                  add('off' + s.cur, `Next stop: ${f.short(l.to)}`, `Get ready to get off. You arrive at ${f.clock(s.eta)}.`);
              else {
                  const n = legs[s.cur + 1];
                  add('off' + s.cur, `Next stop: ${f.short(l.to)}, change here`, `Then the ${f.clock(s.L2[s.cur + 1].dep)} ${n.line}${n.fromPlatform ? ' from ' + f.plat(n.fromPlatform) : ''}.`);
              }
          }
      }
      for (const cn of s.conns) {
          if (cn.risk === 'miss')
              add('conn' + cn.i, 'Connection at risk', `With live times you'll likely miss the ${f.clock(new Date(cn.next.planned).getTime())} ${cn.next.line} at ${f.short(cn.at)}.`);
          else if (cn.risk === 'tight')
              add('conn' + cn.i, `Tight change at ${f.short(cn.at)}`, `${Math.max(0, cn.spare)} min to catch the ${cn.next.line}.`);
      }
      return out;
  }
  function sayName(n) {
      const words = [[/\bStn\b/g, 'Station'], [/\bRd\b/g, 'Road'], [/\bSt\b(?!\.)/g, 'Street'], [/\bAve?\b/g, 'Avenue'], [/\bPde\b/g, 'Parade'],
          [/\bHwy\b/g, 'Highway'], [/\bDr\b/g, 'Drive'], [/\bPl\b/g, 'Place'], [/\bCres\b/g, 'Crescent'], [/\bBvd\b/g, 'Boulevard'], [/\bNr\b/g, 'near'], [/\bOpp\b/g, 'opposite'], [/\bAt\b/g, 'at'], [/\bBefore\b/g, 'before'], [/\bAfter\b/g, 'after']];
      let v = String(n || '').split(',')[0].replace(/ Station$/, '').trim();
      for (const [re, w] of words)
          v = v.replace(re, w);
      return v;
  }
  const NOUN = { train: 'train', metro: 'metro', bus: 'bus', school: 'bus', coach: 'coach', ferry: 'ferry', lightrail: 'light rail' };
  const sayPlat = (p) => {
      const v = String(p || '').trim();
      if (!v)
          return '';
      return /^(platform|stand|wharf|side)\b/i.test(v) ? v.charAt(0).toLowerCase() + v.slice(1) : /^\d+$/.test(v) ? `platform ${v}` : v;
  };
  function sayLineName(line, mode) {
      const l = String(line || '').trim();
      const noun = NOUN[String(mode || '')] || '';
      if (!l)
          return noun ? `the ${noun}` : 'the next service';
      if (noun === 'train' || noun === 'metro')
          return `the ${l} line`;
      return noun ? `the ${l} ${noun}` : `the ${l}`;
  }
  function speechCues(legs, s, now, f) {
      const out = [];
      const last = legs.length - 1;
      if (s.done) {
          out.push({ key: 'arrived', text: `You've arrived at ${sayName(legs[last]?.to)}.` });
          return out;
      }
      const i = s.cur, l = legs[i], x = s.L2[i];
      if (!l || !x)
          return out;
      const noun = NOUN[l.mode] || 'service';
      if (s.phase === 'ride' && !notLive(s)) {
          const d = x.d;
          if (d && (d.alightIndex ?? -1) > 0 && s.nextIdx === d.alightIndex) {
              if (i === last)
                  out.push({ key: 'off' + i, text: `Your stop is next. ${sayName(l.to)}.` });
              else {
                  const n = legs[i + 1];
                  out.push({ key: 'off' + i, text: `Next stop, ${sayName(l.to)}. Change here for ${sayLineName(n.line, n.mode)}.` });
              }
          }
      }
      for (const cn of s.conns) {
          const nl = sayLineName(cn.next.line, cn.next.mode);
          if (cn.risk === 'miss')
              out.push({ key: 'conn' + cn.i, text: `You may miss ${nl} at ${sayName(cn.at)}.` });
          else if (cn.risk === 'tight') {
              const m = Math.max(0, cn.spare);
              out.push({ key: 'conn' + cn.i, text: `Tight change at ${sayName(cn.at)}. ${m} minute${m === 1 ? '' : 's'} to catch ${nl}.` });
          }
      }
      if (s.phase !== 'wait' || x.missed || !Number.isFinite(x.dep))
          return out;
      const d = x.d, mi = idx(d?.mineIndex);
      const livePlat = d && mi >= 0 ? String(d.stops[mi]?.platform || '').trim() : '';
      const norm = (p) => String(p || '').toLowerCase().replace(/^(platform|stand|wharf|side)\s*/, '').trim();
      const plat = livePlat || l.fromPlatform || '';
      if (livePlat && l.fromPlatform && norm(livePlat) !== norm(l.fromPlatform)) {
          const kind = /^stand/i.test(livePlat) ? 'Stand' : 'Platform';
          out.push({ key: `plat${i}:${norm(livePlat)}`, text: `${kind} change. Your ${noun} now leaves from ${sayPlat(livePlat)}.` });
      }
      const late = Math.round(x.delay / 60000);
      if (x.live && late >= 3) {
          const step = late >= 15 ? 15 : late >= 10 ? 10 : late >= 5 ? 5 : 3;
          out.push({ key: `late${i}:${step}`, text: `Your ${noun} is running ${late} minutes late. It now leaves at ${f.clock(x.dep)}.` });
      }
      const dm = (x.dep - now) / 60000;
      if (dm <= 3.5 && dm > -0.5) {
          const m = Math.round(dm);
          const to = sayName(l.to);
          const where = plat ? `, from ${sayPlat(plat)}` : '';
          out.push({ key: `soon${i}`, text: m <= 0 ? `Your ${noun} to ${to} is leaving now${where}.` : `Your ${noun} to ${to} leaves in ${m} minute${m === 1 ? '' : 's'}${where}.` });
      }
      return out;
  }
  function tapMoments(s, now) {
      if (s.done)
          return ['arrived'];
      const x = s.L2[s.cur];
      if (s.phase !== 'wait' || !x || x.missed || !Number.isFinite(x.dep))
          return [];
      const left = x.dep - now;
      return left <= 60000 && left > -30000 ? ['leave' + s.cur] : [];
  }
  function progOf(s, f) {
      if (!s || s.done)
          return { phase: 'done' };
      const d = s.L2[s.cur].d, ns = d && s.nextIdx >= 0 ? d.stops[s.nextIdx] : null;
      return { leg: s.cur, phase: s.phase, next: ns ? f.short(ns.name) : null, stopsLeft: s.stopsLeft, eta: s.eta };
  }
  function liveWords(legs, s, now, f) {
      const last = legs.length - 1;
      if (s.done)
          return { title: "You've arrived", body: `${f.short(legs[last].to)} at ${f.clock(s.eta)}` };
      const l = legs[s.cur], x = s.L2[s.cur], d = x.d;
      const arrive = `Arrive ${f.clock(s.eta)} (${minsWords((s.eta - now) / 60000)})`;
      if (x.missed)
          return { title: `Change at risk at ${f.short(l.from)}`, body: `The ${x.was ? f.clock(x.was) + ' ' : ''}${l.line} has likely left. Open the app for the next way on. Arrive about ${f.clock(s.eta)}` };
      const late = s.delayMin != null && s.delayMin >= 2 ? `${s.delayMin} min late. ` : '';
      if (s.phase === 'wait') {
          const dm = Math.round((x.dep - now) / 60000);
          return { title: `${l.line} to ${f.short(l.towards || l.to)}`, body: `${s.cur ? 'Change to' : 'Board'} the ${l.line} ${dm <= 0 ? 'now' : `at ${f.clock(x.dep)}`}${l.fromPlatform ? `, ${f.plat(l.fromPlatform)}` : ''}. ${late}${arrive}` };
      }
      if (notLive(s))
          return { title: `${l.line} to ${f.short(l.towards || l.to)}`, body: `Not live, running to timetable: due at ${f.short(l.to)} ${f.clock(x.arr)}. Arrive about ${f.clock(s.eta)}` };
      const ns = d && s.nextIdx >= 0 ? d.stops[s.nextIdx] : null;
      const yours = !!d && s.nextIdx === d.alightIndex;
      const left = s.stopsLeft != null ? `${s.stopsLeft} stop${s.stopsLeft === 1 ? '' : 's'} to ${f.short(l.to)}` : `to ${f.short(l.to)}`;
      return { title: `${l.line} to ${f.short(l.towards || l.to)}`, body: `${yours ? `Get off at ${f.short(l.to)}, next stop` : ns ? `Next stop: ${f.short(ns.name)}, ${left}` : `On the ${l.line}, ${left}`}. ${late}${arrive}` };
  }
  function stepLive(g, svc, now, f, pos) {
      const actions = [];
      const memo = { rode: g.rode, here: g.here, arrivedAt: g.arrivedAt };
      const s = computeLive(g.legs, svc, now, memo, pos);
      let n = g;
      const m = nextMemo(memo, s, now);
      if (JSON.stringify(m.rode || {}) !== JSON.stringify(g.rode || {}))
          n = { ...n, rode: m.rode };
      if (JSON.stringify(m.here || {}) !== JSON.stringify(g.here || {}))
          n = { ...n, here: m.here };
      const list = tripAlerts(g.legs, s, n.alerted || {}, !!n.watchId, f).filter((a) => !(g.wake && a.key.startsWith('off')));
      if (list.length) {
          const alerted = { ...(n.alerted || {}) };
          for (const a of list) {
              alerted[a.key] = 1;
              actions.push({ t: 'alert', id: `trip-${g.id}-${a.key}`, key: a.key, title: a.title, body: a.body });
          }
          n = { ...n, alerted };
      }
      if (g.speak) {
          const said = n.spoken || {};
          const say = speechCues(g.legs, s, now, f).filter((a) => !said[a.key]);
          if (say.length) {
              const spoken = { ...said };
              for (const a of say) {
                  spoken[a.key] = 1;
                  actions.push({ t: 'say', key: a.key, text: a.text });
              }
              n = { ...n, spoken };
          }
      }
      if (s.done) {
          if (!n.arrivedAt) {
              if (n.share)
                  actions.push({ t: 'share', prog: progOf(s, f) });
              actions.push({ t: 'clearOngoing' });
              n = { ...n, arrivedAt: now };
          }
          if (now > (n.arrivedAt || now) + 10 * 60000)
              actions.push({ t: 'end' });
          return { g: n, s, actions };
      }
      const w = liveWords(g.legs, s, now, f);
      actions.push({ t: 'ongoing', title: w.title, body: w.body, leg: s.cur });
      if (n.share)
          actions.push({ t: 'share', prog: progOf(s, f) });
      return { g: n, s, actions };
  }
  function noteKey(n) {
      const w = n.watch_id || '';
      const m = /^(?:Next stop: |Arriving at |Change at )(.+?)(?:, change here| in \d+ min)?$/.exec(n.title || '');
      if (w && m) {
          const place = m[1].replace(/ Station$/i, '').trim().toLowerCase();
          return { key: `${w}|stop|${place}`, id: `w${w}-stop` };
      }
      if (w && /^(Connection at risk|Tight change)/i.test(n.title || ''))
          return { key: `${w}|conn|${n.title}`, id: `w${w}-conn` };
      return { key: `note|${n.id}`, id: `note-${n.id}` };
  }
  function cutPath(path, a, b) {
      if (!path || path.length < 2)
          return path || [];
      const near = (s) => {
          if (!s || s.lat == null || s.lon == null)
              return -1;
          let best = -1, bd = Infinity;
          path.forEach(([la, lo], k) => { const dd = (la - s.lat) ** 2 + (lo - s.lon) ** 2; if (dd < bd) {
              bd = dd;
              best = k;
          } });
          return best;
      };
      const i = near(a), j = near(b);
      if (i < 0 || j < 0 || j <= i)
          return path;
      return path.slice(i, j + 1);
  }
  function minsWords(m) {
      const v = Math.max(0, Math.round(m));
      return v < 60 ? `${v} min` : `${Math.floor(v / 60)} h ${v % 60} min`;
  }
  // platform/tripCard.ts
  const shortName = (n) => String(n || '').replace(/,.*$/, '').trim().replace(/ (Station|Light Rail|Wharf)$/i, '').trim();
  const platText = (p) => (p ? p.replace(/^Platform\s*/i, 'Platform ').replace(/^Stand\s*/i, 'Stand ') : null);
  const colorOf = (l) => l.color || '#0A84FF';
  const hhmm = (t) => {
      const s = new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' });
      return s.replace(/\s/g, '').toLowerCase();
  };
  function cardFor(g, s, now = Date.now(), o = {}) {
      const legs = g.legs;
      const last = legs[legs.length - 1];
      const destination = shortName(g.to?.name || last?.to) || null;
      if (s.done) {
          return {
              line: last?.line || '', lineColorHex: last ? colorOf(last) : '#0A84FF', mode: last?.mode || '', nextStop: null, stopsLeft: null,
              getOffAt: shortName(last?.to), arrival: s.eta, phase: 'arrived', warning: null, progress: 1,
              towards: null, platform: null, departs: null, legArrives: s.eta, destination,
          };
      }
      const l = legs[s.cur];
      const x = s.L2[s.cur];
      const d = x?.d || null;
      const next = d && s.nextIdx >= 0 ? d.stops[s.nextIdx] : null;
      let progress = 0;
      if (s.phase === 'ride') {
          const span = x.arr - x.dep;
          progress = span > 0 ? Math.min(1, Math.max(0, (now - x.dep) / span)) : 0;
          if (s.track === 'timetable')
              progress = Math.min(progress, 0.9);
      }
      const c = s.conns.find((k) => k.i === s.cur) || s.conns[0];
      const alt = c && c.risk === 'miss' ? o.alt || null : null;
      const legNote = s.track === 'timetable' ? 'Timetable times, not live' : s.delayMin != null && s.delayMin >= 2 ? `${s.delayMin} min late` : null;
      const warning = cardWarning(c, alt, o.asOf ?? null, legNote);
      return {
          line: l.line, lineColorHex: colorOf(l), mode: l.mode,
          nextStop: s.phase === 'wait' ? shortName(l.from) || null : next && s.track !== 'timetable' ? shortName(next.name) : null,
          stopsLeft: s.stopsLeft, getOffAt: shortName(l.to), arrival: alt && Number.isFinite(alt.arr) ? alt.arr : s.eta, phase: s.phase, warning, progress,
          towards: shortName(l.towards || d?.dest) || null, platform: platText(l.fromPlatform),
          departs: x.missed ? (alt ? alt.dep : null) : Number.isFinite(x.dep) ? x.dep : null,
          legArrives: x.missed ? (alt ? alt.arr : null) : Number.isFinite(x.arr) ? x.arr : null, destination,
          ...(o.updated ? { updated: o.updated } : {}),
      };
  }
  function cardWarning(c, alt, asOf, legNote = null) {
      let w = null;
      if (c && c.risk === 'miss')
          w = alt ? `Change at risk. Next ${alt.line} ${hhmm(alt.dep)}` : `You'll likely miss the ${hhmm(c.nextDep)} ${c.next.line}`;
      else if (c && c.risk === 'tight')
          w = `Tight change at ${shortName(c.at)}`;
      else if (legNote)
          w = legNote;
      if (asOf == null)
          return w;
      return w ? `${w}. Updated ${hhmm(asOf)}` : `Updated ${hhmm(asOf)}. Open the app for live times`;
  }
  function staleAt(card, updated, honestStale, keepMs = 120000) {
      if (card.phase === 'arrived')
          return null;
      if (honestStale && updated)
          return Math.min(updated + 120000, card.arrival + keepMs);
      return card.arrival + keepMs;
  }
  return { computeLive, cardFor, staleAt, cardWarning };
})();
// ---- live card end

// ---- live activity push start
// The iPhone trip card (Live Activity, build 205 and later) updated by push while the phone is locked. The app
// sends the card's push token with its trip (POST /api/live-activity); each minute tick works out the card from
// live times with the app's own code (LIVECARD, generated from the app) and sends it to Apple. On arrival the
// card gets a final update and ends. The push key is the Worker secret APNS_KEY (the .p8 text), never in the repo.
const APNS_HOST = "https://api.push.apple.com";
// The app's bundle id comes from the APNS_BUNDLE var in wrangler.toml (the topic is "<bundle>.push-type.liveactivity").
const apnsLaTopic = (env) => (env.APNS_BUNDLE || "") + ".push-type.liveactivity";
const APPLE_EPOCH_S = 978307200;
const LA_MAX_MS = 7 * 3600000;
const LA_EVERY_MS = 50000;
const LA_PER_TICK = 10;
const LA_ARRIVED_KEEP_S = 120;
const LA_TOKEN_RE = /^[0-9a-f]{32,400}$/;
const laSchema = new WeakMap();
async function ensureLiveActivities(env) {
  const d = db(env);
  if (!d) return false;
  if (!laSchema.has(d)) {
    laSchema.set(d, d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS live_activities (token TEXT PRIMARY KEY, activity TEXT, device TEXT, trip TEXT, created INTEGER, updated INTEGER, expires INTEGER, active INTEGER, last_push INTEGER, last_state TEXT, last_status INTEGER, last_reason TEXT, pushes INTEGER)`),
      d.prepare(`CREATE TABLE IF NOT EXISTS apns_devices (token TEXT PRIMARY KEY, device TEXT, env TEXT, created INTEGER, updated INTEGER)`),
    ]).then(() => true).catch((e) => { laSchema.delete(d); throw e; }));
  }
  return laSchema.get(d);
}

const laStr = (v, n = 120) => (v === undefined || v === null || v === "" ? undefined : String(v).slice(0, n));
/** The trip as the app sent it, kept to the fields the card needs and capped in size. Null when unusable. */
function laTripFrom(t) {
  if (!t || typeof t !== "object" || !Array.isArray(t.legs) || !t.legs.length || t.legs.length > 8) return null;
  const legs = [];
  for (const l of t.legs) {
    if (!l || typeof l !== "object") return null;
    const o = {};
    for (const k of ["mode", "line", "tripId", "stopId", "toStopId", "from", "to", "planned", "arrPlanned", "estimated", "fromPlatform", "toPlatform", "color", "towards", "destId"]) {
      const v = laStr(l[k]);
      if (v !== undefined) o[k] = v;
    }
    const fd = cleanFeed(l.feed);
    if (fd) o.feed = fd;
    if (!o.stopId || !o.planned || !o.mode) return null;
    o.line = o.line || "";
    legs.push(o);
  }
  const place = (p) => (p && typeof p === "object" ? { id: laStr(p.id, 40), name: laStr(p.name) } : null);
  const rode = {};
  if (t.rode && typeof t.rode === "object") for (const [k, v] of Object.entries(t.rode)) if (/^\d$/.test(k) && Number.isFinite(Number(v))) rode[k] = Number(v);
  const arrivedAt = Number.isFinite(Number(t.arrivedAt)) && Number(t.arrivedAt) > 0 ? Number(t.arrivedAt) : null;
  // When the person got off each leg (their tap or their location on the phone): the card moves on with them.
  const here = {};
  if (t.here && typeof t.here === "object") for (const [k, v] of Object.entries(t.here)) if (/^\d$/.test(k) && Number.isFinite(Number(v)) && Number(v) > 0) here[k] = Number(v);
  return { id: laStr(t.id, 64) || "", title: laStr(t.title) || "", origin: place(t.origin), to: place(t.to), legs, rode, arrivedAt, ...(Object.keys(here).length ? { here } : {}) };
}

/** Seconds since 1 Jan 2001: how Swift's default Codable reads a Date in the card's content state. */
const appleDate = (ms) => Math.round(ms / 1000 - APPLE_EPOCH_S);

/** The card (dates in ms, as the app builds it) as LiveTripAttributes.ContentState JSON for Apple. */
function laContentState(card) {
  const cs = {
    line: String(card.line || ""), lineColorHex: String(card.lineColorHex || "#0A84FF"), mode: String(card.mode || "train"),
    getOffAt: String(card.getOffAt || ""), arrival: appleDate(card.arrival), phase: String(card.phase || "wait"),
    progress: Math.max(0, Math.min(1, Number(card.progress) || 0)),
  };
  for (const k of ["nextStop", "warning", "fareLine", "towards", "platform", "destination"]) if (card[k] !== null && card[k] !== undefined && card[k] !== "") cs[k] = String(card[k]);
  if (Number.isFinite(card.stopsLeft)) cs.stopsLeft = Math.round(card.stopsLeft);
  for (const k of ["departs", "legArrives", "updated"]) if (Number.isFinite(card[k])) cs[k] = appleDate(card[k]);
  return cs;
}

/** The APNs body for a card update or end. */
function laPayload(card, o = {}) {
  const now = o.now || Date.now();
  const aps = { timestamp: Math.floor(now / 1000), event: o.event || "update", "content-state": laContentState(card) };
  if (aps.event === "update" && Number.isFinite(o.staleMs)) aps["stale-date"] = Math.floor(o.staleMs / 1000);
  if (aps.event === "end") aps["dismissal-date"] = Math.floor((o.dismissMs || now + LA_ARRIVED_KEEP_S * 1000) / 1000);
  return { aps };
}

/** Which cards this tick updates: active, not expired, not pushed in the last 50 s, longest waiting first. */
function laDue(rows, now, max = LA_PER_TICK) {
  return rows
    .filter((r) => Number(r.active) === 1 && Number(r.expires) > now && (!r.last_push || now - Number(r.last_push) >= LA_EVERY_MS))
    .sort((a, b) => (Number(a.last_push) || 0) - (Number(b.last_push) || 0))
    .slice(0, max);
}

/** What changes the card's look: the state without the time it was made and with progress in 5% steps. */
function laLook(cs) {
  const { updated, progress, ...rest } = cs;
  return JSON.stringify({ ...rest, progress: Math.round((progress || 0) * 20) / 20 });
}

/** The card for a trip now, from live times for each leg (the same /api/service data the app reads). */
async function laCardFor(env, trip, now) {
  const svcs = await Promise.all(trip.legs.map((l) =>
    service(env, { trip: l.tripId, mode: l.mode, line: l.line, feed: l.feed, stop: l.stopId, destId: l.destId, planned: l.planned, to: l.toStopId, dest: l.towards, stopName: l.from, color: l.color })
      .then((r) => (r && !r.error ? r : null)).catch(() => null)));
  const s = LIVECARD.computeLive(trip.legs, svcs, now, { rode: trip.rode, here: trip.here, arrivedAt: trip.arrivedAt });
  const card = LIVECARD.cardFor(trip, s, now, { updated: now });
  return { card, done: !!s.done || card.phase === "arrived", live: svcs.some(Boolean) };
}

// The provider token (a signed JWT) is kept for 40 minutes in the meta table: Apple wants it renewed every 20 to 60
// minutes and refuses renewals more often than that, and each new Worker isolate would otherwise sign a new one.
let apnsJwtMem = null;
async function apnsJwt(env, now = Date.now()) {
  if (apnsJwtMem && now - apnsJwtMem.at < 40 * 60000) return apnsJwtMem.jwt;
  const row = await db(env).prepare("SELECT v FROM meta WHERE k = 'apns_jwt'").first().catch(() => null);
  if (row) {
    try { const j = JSON.parse(row.v); if (j && j.jwt && now - j.at < 40 * 60000 && j.kid === apnsKeyId(env)) { apnsJwtMem = j; return j.jwt; } } catch {}
  }
  const jwt = await signApnsJwt(env.APNS_KEY, apnsKeyId(env), env.APNS_TEAM_ID || "B85KQRQZW7", now);
  apnsJwtMem = { jwt, at: now, kid: apnsKeyId(env) };
  await db(env).prepare("INSERT INTO meta (k, v) VALUES ('apns_jwt', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(apnsJwtMem)).run().catch(() => null);
  return jwt;
}
const apnsKeyId = (env) => env.APNS_KEY_ID || "69AK74573Z";
async function signApnsJwt(pem, kid, team, now = Date.now()) {
  if (!pem) throw new Error("APNS_KEY is not set");
  const der = Uint8Array.from(atob(String(pem).replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = new TextEncoder();
  const head = b64u(enc.encode(JSON.stringify({ alg: "ES256", kid })));
  const body = b64u(enc.encode(JSON.stringify({ iss: team, iat: Math.floor(now / 1000) })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body));
  return head + "." + body + "." + b64u(sig);
}

/** One push to Apple. Returns Apple's status and reason ("BadDeviceToken" and so on). */
async function apnsSend(env, token, payload, o = {}) {
  const jwt = await apnsJwt(env);
  const r = await fetch(`${APNS_HOST}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`, "apns-topic": o.topic || apnsLaTopic(env), "apns-push-type": o.pushType || "liveactivity",
      "apns-priority": String(o.priority || 10), "apns-expiration": String(Math.floor((o.expiresMs || Date.now() + 120000) / 1000)), "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  let reason = null;
  if (r.status !== 200) { try { reason = (await r.json()).reason || null; } catch {} }
  if (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken") { apnsJwtMem = null; await db(env).prepare("DELETE FROM meta WHERE k = 'apns_jwt'").run().catch(() => null); }
  return { status: r.status, reason, id: r.headers.get("apns-id") };
}
/** Apple will not take this token again: the card ended on the phone or the app was removed. */
const apnsGone = (res) => res.status === 410 || res.reason === "BadDeviceToken" || res.reason === "Unregistered" || res.reason === "DeviceTokenNotForTopic";

/** Sends one card its current state (or its final state on arrival). Updates the row with what Apple said. */
async function laPushOne(env, row, now, o = {}) {
  const trip = JSON.parse(row.trip);
  const { card, done } = await laCardFor(env, trip, now);
  if (o.warning) card.warning = o.warning;
  const end = done || now >= Number(row.expires) || !!o.end;
  const cs = laContentState(card);
  const look = laLook(cs);
  const changed = look !== row.last_state;
  const stale = LIVECARD.staleAt(card, now, true, LA_ARRIVED_KEEP_S * 1000);
  const payload = laPayload(card, { event: end ? "end" : "update", now, staleMs: stale ?? undefined });
  const res = await apnsSend(env, row.token, payload, { priority: end || changed || o.warning ? 10 : 5 });
  const active = end || apnsGone(res) ? 0 : 1;
  await db(env).prepare("UPDATE live_activities SET last_push = ?2, last_state = ?3, last_status = ?4, last_reason = ?5, pushes = COALESCE(pushes, 0) + 1, active = ?6 WHERE token = ?1")
    .bind(row.token, now, res.status === 200 ? look : row.last_state, res.status, res.reason, active).run();
  return { token: row.token.slice(0, 8), status: res.status, reason: res.reason, event: payload.aps.event, phase: card.phase, warning: card.warning || null, changed, apnsId: res.id, contentState: cs };
}

/** The minute tick's part: every due card gets its live state. */
async function tickLiveActivities(env, now = Date.now()) {
  if (!env.APNS_KEY || !env.APNS_BUNDLE || !(await ensureLiveActivities(env))) return { skipped: "no push key" };
  await db(env).prepare("UPDATE live_activities SET active = 0 WHERE active = 1 AND expires < ?1").bind(now - 3600000).run().catch(() => null);
  const rows = laDue(await d1all(env, "SELECT * FROM live_activities WHERE active = 1 AND expires > ?1 ORDER BY last_push LIMIT 40", now - 600000), now);
  const out = [];
  for (const r of rows) {
    try { out.push(await laPushOne(env, r, now)); }
    catch (e) { out.push({ token: r.token.slice(0, 8), error: String(e && e.message || e).slice(0, 160) }); }
  }
  return { sent: out.length, items: out.map(({ contentState, ...x }) => x) };
}

/**
 * Delete all my data for one device: its trip card tokens (live_activities) and its phone push token
 * (apns_devices). Used by /api/history/delete (scope all) and POST /api/live-activity/forget, which the app calls
 * on this server whichever address the rest of the app uses. Returns the rows deleted.
 */
async function forgetDeviceTokens(env, device) {
  const dev = cleanId(device);
  const out = { liveActivities: 0, apnsDevices: 0 };
  if (!dev || !(await ensureLiveActivities(env).catch(() => false))) return out;
  const d = db(env);
  const a = await d.prepare("DELETE FROM live_activities WHERE device = ?1").bind(dev).run();
  const b = await d.prepare("DELETE FROM apns_devices WHERE device = ?1").bind(dev).run();
  out.liveActivities = (a && a.meta && a.meta.changes) || 0;
  out.apnsDevices = (b && b.meta && b.meta.changes) || 0;
  return out;
}

// Push token clean up, run by the hourly housekeeping. A trip card token goes once the trip has ended (the card
// ended, or past its expiry) and in any case 24 h after it was first sent. A phone push token (apns_devices) goes
// when the phone has not sent it again for 30 days (the app sends it each time it opens). An Expo or web push
// token goes when no push to it worked for 30 days and nothing on this server can still push to that device
// (no live watch, morning check, lift alert, car park watch or last way home).
const TOKEN_IDLE_MS = 30 * 86400000;
const LA_KEEP_MS = 24 * 3600000;
async function prunePushTokens(env, now = Date.now()) {
  const d = db(env);
  const out = {};
  if (!d) return out;
  const run = async (k, sql, ...a) => {
    try { const r = await d.prepare(sql).bind(...a).run(); out[k] = (out[k] || 0) + ((r && r.meta && r.meta.changes) || 0); }
    catch (e) { /* table not made on this server yet */ }
  };
  if (await ensureLiveActivities(env).catch(() => false)) {
    await run("liveActivities", "DELETE FROM live_activities WHERE active = 0 OR expires < ?1 OR created < ?2", now - 600000, now - LA_KEEP_MS);
    await run("apnsDevices", "DELETE FROM apns_devices WHERE COALESCE(updated, created, 0) < ?1", now - TOKEN_IDLE_MS);
  }
  // A NULL device in a list would make NOT IN unknown and keep every token, so each list leaves NULLs out.
  const standing = `COALESCE(device, '') IN (SELECT device FROM watches WHERE device IS NOT NULL AND (active = 1 OR updated >= ?2))
    OR COALESCE(device, '') IN (SELECT device FROM morning_checks WHERE device IS NOT NULL AND active = 1)
    OR COALESCE(device, '') IN (SELECT device FROM lift_alerts WHERE device IS NOT NULL)
    OR COALESCE(device, '') IN (SELECT device FROM park_watches WHERE device IS NOT NULL AND done = 0 AND expires >= ?3)
    OR COALESCE(device, '') IN (SELECT device FROM last_home WHERE device IS NOT NULL)`;
  for (const [k, t] of [["expoTokens", "expo_tokens"], ["pushSubs", "push_subs"]]) {
    await run(k, `DELETE FROM ${t} WHERE COALESCE(created, 0) < ?1 AND COALESCE(last_ok, 0) < ?1 AND NOT (${standing})`, now - TOKEN_IDLE_MS, now - TOKEN_IDLE_MS, now);
  }
  return out;
}

/** POST /api/live-activity, /api/live-activity/end, /api/live-activity/forget and /api/apns/device. */
async function liveActivityRoute(env, request, path, now = Date.now()) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  if (!(await ensureLiveActivities(env))) return json({ error: "no database" }, 503);
  const b = await request.json().catch(() => ({}));
  if (path === "/api/live-activity/forget") {
    if (!cleanId(b && b.device)) return json({ error: "device needed" }, 400);
    return json({ ok: true, deleted: await forgetDeviceTokens(env, b.device) });
  }
  const token = String(b && b.token || "").trim().toLowerCase();
  if (!LA_TOKEN_RE.test(token)) return json({ error: "bad token" }, 400);
  if (path === "/api/live-activity/end") {
    // The trip ended on the phone: the token is not needed any more, so it is deleted, not kept.
    await db(env).prepare("DELETE FROM live_activities WHERE token = ?1").bind(token).run();
    return json({ ok: true });
  }
  if (path === "/api/apns/device") {
    await db(env).prepare(`INSERT INTO apns_devices (token, device, env, created, updated) VALUES (?1, ?2, ?3, ?4, ?4)
      ON CONFLICT(token) DO UPDATE SET device = excluded.device, env = excluded.env, updated = excluded.updated`)
      .bind(token, cleanId(b.device) || null, b.env === "development" ? "development" : "production", now).run();
    return json({ ok: true });
  }
  const trip = laTripFrom(b.trip);
  if (!trip) return json({ error: "bad trip" }, 400);
  const lastPlanned = Math.max(...trip.legs.map((l) => Date.parse(l.arrPlanned || l.planned) || 0));
  const expires = Math.min(now + LA_MAX_MS, Math.max(now + 3600000, (lastPlanned || now) + 3 * 3600000));
  await db(env).prepare(`INSERT INTO live_activities (token, activity, device, trip, created, updated, expires, active, pushes) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, 1, 0)
    ON CONFLICT(token) DO UPDATE SET activity = excluded.activity, device = excluded.device, trip = excluded.trip, updated = excluded.updated, expires = excluded.expires, active = 1`)
    .bind(token, cleanId(b.activity, 80) || null, cleanId(b.device) || null, JSON.stringify(trip), now, expires).run();
  return json({ ok: true, push: !!env.APNS_KEY });
}

/** Admin: the latest cards (tokens cut short), or a test push to the newest active card (or one by token start). */
async function liveActivityAdmin(env, request, p, now = Date.now()) {
  if (!(await ensureLiveActivities(env))) return json({ error: "no database" }, 503);
  if (request.method === "GET") {
    const rows = await d1all(env, "SELECT token, activity, device, trip, created, updated, expires, active, last_push, last_status, last_reason, pushes FROM live_activities ORDER BY updated DESC LIMIT 10");
    const devices = await d1all(env, "SELECT COUNT(*) AS n, MAX(updated) AS last FROM apns_devices");
    return json({ push: !!env.APNS_KEY, now, devices: devices[0] || null, items: rows.map((r) => {
      let t = null; try { t = JSON.parse(r.trip); } catch {}
      return { ...r, token: r.token.slice(0, 8), trip: t ? { title: t.title, legs: t.legs.length, rode: t.rode, arrivedAt: t.arrivedAt } : null };
    }) });
  }
  if (!env.APNS_KEY) return json({ error: "APNS_KEY is not set" }, 503);
  const b = await request.json().catch(() => ({}));
  const pre = String(b.token || p.get("token") || "").toLowerCase().replace(/[^0-9a-f]/g, "");
  const row = pre
    ? await db(env).prepare("SELECT * FROM live_activities WHERE token LIKE ?1 ORDER BY updated DESC LIMIT 1").bind(pre + "%").first()
    : await db(env).prepare("SELECT * FROM live_activities WHERE active = 1 ORDER BY updated DESC LIMIT 1").first();
  if (!row) return json({ error: "no trip card registered yet: start a trip on the phone (build 205 or later)" }, 404);
  const warning = b.warning === false ? null : (typeof b.warning === "string" ? b.warning.slice(0, 80) : "Server test " + new Date(now).toLocaleTimeString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase());
  return json(await laPushOne(env, row, now, { warning, end: !!b.end }));
}
// ---- live activity push end

// ---- live trip start
// Shared live trips. "Share live trip" makes a link anyone can open to follow a trip, with no
// account. The owner's phone sends its position only while sharing is on, and the row (with every
// position in it) is deleted when the trip ends, when the owner stops sharing, or when it expires.
let shareSchema = null;
async function ensureShares(env) {
  const d = db(env);
  if (!d) return false;
  if (!shareSchema) {
    shareSchema = d.prepare(`CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, okey TEXT, device TEXT, spec TEXT, state TEXT,
      created INTEGER, updated INTEGER, expires INTEGER)`).run().then(() => true).catch((e) => { shareSchema = null; throw e; });
  }
  return shareSchema;
}
const SHARE_MAX_MS = 6 * 3600000;
const SHARE_GRACE_MS = 30 * 60000;
const shareIdOk = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{12,40}$/.test(s);
function sharePos(p, now) {
  if (!p || typeof p !== "object") return null;
  const lat = Number(p.lat), lon = Number(p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // Rounded to about a metre: enough for the map, nothing finer is kept.
  return { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, acc: Math.max(0, Math.min(5000, Math.round(Number(p.acc) || 0))), at: now };
}
function shareProg(p) {
  if (!p || typeof p !== "object") return null;
  const n = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : null);
  const s = (v, k = 80) => (v == null ? null : String(v).replace(/[\u0000-\u001f]/g, " ").slice(0, k));
  return { leg: n(p.leg, 0, 5), phase: s(p.phase, 12), next: s(p.next), stopsLeft: n(p.stopsLeft, 0, 200), eta: n(p.eta, 0, 9e15), note: s(p.note, 140) };
}
function shareExpiry(spec, prog, created, now) {
  const L = spec.legs[spec.legs.length - 1];
  const planned = ms(L.arrPlanned || L.planned) || now;
  const eta = prog && prog.eta ? prog.eta : planned;
  return Math.min(created + SHARE_MAX_MS, Math.max(now, planned, eta) + SHARE_GRACE_MS);
}
function shareOut(row, now) {
  const spec = JSON.parse(row.spec || "{}"), st = JSON.parse(row.state || "{}");
  const pos = st.pos && now - st.pos.at < 5 * 60000 ? st.pos : null;
  return { id: row.id, title: spec.title || "Live trip", from: spec.from || null, to: spec.to || null, legs: spec.legs || [], pos, prog: st.prog || null,
    started: row.created, updated: row.updated, expires: row.expires, now };
}
// TEMP until the apps move to this address: a live trip shared from the old address (Worker secret
// SHARE_FALLBACK_BASE, https only, kept out of the repo), read from there. Null when it is not set, not found there, or does not answer within 5 s.
async function shareFromFallback(env, id) {
  const base = String((env && env.SHARE_FALLBACK_BASE) || "").replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(base) || !shareIdOk(id)) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(`${base}/api/share?id=${encodeURIComponent(id)}`, { signal: ctl.signal, headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const b = await r.json();
    return b && typeof b === "object" && b.id === id && !b.ended ? b : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
async function shareRoutes(request, env, url) {
  const p = url.searchParams, now = Date.now();
  if (!(await ensureShares(env).catch(() => false))) return json({ error: "Sharing is not available right now." }, 503);
  const d = db(env);
  const path = url.pathname;
  if (path === "/api/share" && request.method === "GET") {
    const id = p.get("id") || "";
    if (!shareIdOk(id)) return json({ ended: true, error: "This live trip link is not valid." }, 404);
    const row = await d.prepare("SELECT * FROM shares WHERE id = ?1").bind(id).first();
    if (!row || row.expires < now) {
      if (row) await d.prepare("DELETE FROM shares WHERE id = ?1").bind(id).run();
      // TEMP until the apps move here (copy.api_base): shares are still made on the old address, so a link
      // opened in a browser lands here first. Ask the old address before saying the trip has ended.
      const old = await shareFromFallback(env, id);
      if (old) return json(old);
      return json({ ended: true, error: "This trip has ended." }, 404);
    }
    return json(shareOut(row, now));
  }
  const b = request.method === "DELETE" ? { id: p.get("id"), key: request.headers.get("x-share-key") || p.get("key") } : await request.json().catch(() => ({}));
  if (path === "/api/share" && request.method === "POST") {
    const legs = (Array.isArray(b.legs) ? b.legs : []).slice(0, 6).map(legFromInput).filter((l) => l.stopId && l.planned);
    if (!legs.length) return json({ error: "legs needed" }, 400);
    const place = (x) => (x && typeof x === "object" ? { id: String(x.id || "").slice(0, 60), name: String(x.name || "").slice(0, 80) } : null);
    const spec = { title: String(b.title || "Live trip").slice(0, 90), from: place(b.from), to: place(b.to), legs };
    const prog = shareProg(b.prog), pos = sharePos(b.pos, now);
    const id = rid(12), key = rid(18);
    const expires = shareExpiry(spec, prog, now, now);
    await d.prepare("INSERT INTO shares (id, okey, device, spec, state, created, updated, expires) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)")
      .bind(id, key, cleanId(b.device) || null, JSON.stringify(spec), JSON.stringify({ pos, prog }), now, expires).run();
    return json({ ok: true, id, key, url: `${url.origin}/live/?t=${id}`, expires });
  }
  if (!shareIdOk(String(b.id || ""))) return json({ error: "not found" }, 404);
  const row = await d.prepare("SELECT * FROM shares WHERE id = ?1").bind(String(b.id)).first();
  if (!row || !safeEq(String(b.key || ""), row.okey)) return json({ error: "not found" }, 404);
  if (request.method === "DELETE" || (path === "/api/share/update" && b.end)) {
    await d.prepare("DELETE FROM shares WHERE id = ?1").bind(row.id).run();
    return json({ ok: true, ended: true });
  }
  if (path === "/api/share/update" && request.method === "POST") {
    const spec = JSON.parse(row.spec || "{}");
    if (Array.isArray(b.legs) && b.legs.length) {
      const legs = b.legs.slice(0, 6).map(legFromInput).filter((l) => l.stopId && l.planned);
      if (legs.length) spec.legs = legs;
    }
    const st = JSON.parse(row.state || "{}");
    if ("pos" in b) st.pos = sharePos(b.pos, now);
    if (b.prog) st.prog = shareProg(b.prog);
    const expires = shareExpiry(spec, st.prog, row.created, now);
    await d.prepare("UPDATE shares SET spec = ?2, state = ?3, updated = ?4, expires = ?5 WHERE id = ?1").bind(row.id, JSON.stringify(spec), JSON.stringify(st), now, expires).run();
    return json({ ok: true, expires });
  }
  return json({ error: "method" }, 405);
}
// One stop before you get off: used by watches started from "Start trip".
async function oneStopCheck(env, l) {
  const s = await service(env, { mode: l.mode, line: l.line, feed: l.feed, trip: l.tripId, stop: l.stopId, to: l.toStopId, destId: l.destId, planned: l.planned });
  if (!s || s.alightIndex == null || s.alightIndex < 1) return null;
  // "Next stop: Town Hall, change here" only when the vehicle or live times say so, never by the timetable clock.
  if (s.progress === "timetable") return { nextIsYours: false, stopsLeft: null, eta: null, notLive: true };
  return { nextIsYours: s.nextIndex === s.alightIndex, stopsLeft: s.alightIndex - s.nextIndex, eta: s.stops[s.alightIndex] ? ms(s.stops[s.alightIndex].estimated || s.stops[s.alightIndex].planned) : null };
}
// ---- live trip end

// ---- facilities start
// Station access (lifts, step free), Opal ticket machines and Park and Ride live spaces.
// Static data: /data/facilities.json and /data/carparks.json, built by tools/build_facilities.py
// from Transport for NSW open data. Live data: the Car Park API, and lift and escalator outages
// from the Trip Planner service alerts. Every answer names its source.
const FAC_SRC = {
  facilities: "Transport for NSW open data: Public Transport Location Facilities and Operators",
  parking: "Transport for NSW open data: Car Park API (live)",
  lifts: "Transport for NSW service alerts (live)",
};
const ACCESS_LEVEL = { I: "independent", A: "assisted", N: "none" };
const ACCESS_LABEL = { I: "Step free access", A: "Assisted access", N: "No step free access" };
const ACCESS_NOTE = {
  I: "You can get to the platform without steps.",
  A: "Staff can help with a ramp or the way in. Some steps or gaps may need help.",
  N: "There is no step free way to the platform.",
};
const TICKET_LABEL = {
  cash: "Opal top up and ticket machine, cash or card",
  card: "Opal top up and ticket machine, card only",
  topup: "Opal top up machine, card only",
  none: "No Opal top up or ticket sales",
};
const FAC_LABEL = {
  toilet: "Toilets", atoilet: "Accessible toilet", mlak: "Accessible toilet (MLAK key)", baby: "Baby change",
  carpark: "Commuter car park", parkride: "Park and Ride", accpark: "Accessible parking", bikerack: "Bike racks",
  bikelocker: "Bike lockers", bikeshed: "Bike shed", kiss: "Kiss and ride", taxi: "Taxi rank", help: "Help point",
  phone: "Payphone", info: "Information point", display: "Next service display", charge: "Phone charging", luggage: "Luggage storage",
};
const PARK_WATCH_HOURS = 3;
let facOrigin = "https://assets.local";
const facMem = {};
async function facData(env, name) {
  const hit = facMem[name];
  if (hit && Date.now() - hit.at < 6 * 3600000) return hit.v;
  try {
    const r = await env.ASSETS.fetch(new Request(new URL("/data/" + name + ".json", facOrigin)));
    if (!r.ok) throw new Error("no " + name);
    const v = await r.json();
    facMem[name] = { at: Date.now(), v };
    return v;
  } catch (e) { return hit ? hit.v : null; }
}
function facStrip(h) { return plainText(h); }
function facDist(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180, x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r), y = (bLat - aLat) * r;
  return Math.round(Math.sqrt(x * x + y * y) * 6371000);
}
// The same fields toLocaleString("en-US", { timeZone }) prints, as reusable formatters.
const LOCAL_SYD_OPTS = { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" };
const LOCAL_UTC_OPTS = { ...LOCAL_SYD_OPTS, timeZone: "UTC" };
function sydneyLocalMs(s) {
  // "2026-10-24T15:39:23" in Sydney time to epoch ms.
  const asUtc = Date.parse(String(s || "") + "Z");
  if (!Number.isFinite(asUtc)) return null;
  const d = new Date(asUtc);
  const syd = new Date(dtf("en-US", LOCAL_SYD_OPTS).format(d)), utc = new Date(dtf("en-US", LOCAL_UTC_OPTS).format(d));
  return asUtc - (syd - utc);
}

// Lift and escalator outages, all stations, cached 5 minutes.
const liftMem = { at: 0, list: null, p: null };
async function liftOutages(env) {
  if (liftMem.list && Date.now() - liftMem.at < 300000) return liftMem.list;
  let mine = false;
  if (!liftMem.p) {
    mine = true;
    const run = (async () => {
      const now = sydneyParts(new Date());
      const [y, m, dd] = String(now.date).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3").split("-");
      // Lift and escalator notices are the Trip Planner's "infrastructure" infos. Asking for just
      // those brings about 40 KB instead of the whole 2.5 MB alert list, which was the single
      // biggest parse on the server.
      const data = await tp(env, "add_info", { filterDateValid: `${dd}-${m}-${y}`, filterPublicationStatus: "current", filterInfoType: "infrastructure" });
      const out = [], seen = new Set();
      for (const i of (data.infos && data.infos.current) || []) {
        const inf = (i.affected && i.affected.Infrastructures) || [];
        const at = (i.properties || {}).announcementType;
        if (at !== "liftsEscalators" && !inf.some((x) => /ELEVATOR|ESCALATOR/.test(String(x.type || "")))) continue;
        const title = facStrip(i.subtitle || i.urlText || i.content).slice(0, 200);
        const stops = [...new Set(((i.affected && i.affected.stops) || []).map((s) => String(s.id || "")).filter((s) => /^\d{5,8}$/.test(s)))];
        const k = stops.join(",") + "|" + title.toLowerCase();
        if (!title || !stops.length || seen.has(k)) continue;
        seen.add(k);
        const esc = inf.some((x) => x.type === "ESCALATOR") && !inf.some((x) => x.type === "ELEVATOR");
        out.push({ id: String(i.id || k).slice(0, 80), stops, kind: esc || /escalator/i.test(title) && !/\blift\b/i.test(title) ? "escalator" : "lift", title,
          detail: facStrip(i.content).slice(0, 300), url: httpsUrl(i.url), updated: (i.timestamps && i.timestamps.lastModification) || null });
      }
      liftMem.list = out; liftMem.at = Date.now();
      return out;
    })();
    liftMem.p = sharedJob(run);
    run.then(() => { liftMem.p = null; }, () => { liftMem.p = null; });
  }
  // Only the request that asked the Trip Planner awaits its promise; others wait on their own timers (sharedJob).
  try { return mine ? await liftMem.p.promise : await joinJob(liftMem.p); } catch (e) { return liftMem.list || []; }
}

// One car park, live, cached 90 seconds.
const parkMem = new Map();
function parkStatus(free, spots) {
  if (!spots || free == null) return "unknown";
  if (free <= 0) return "full";
  if (free <= Math.max(10, Math.round(spots * 0.1))) return "nearly";
  return "ok";
}
const PARK_LABEL = { ok: "Spaces free", nearly: "Nearly full", full: "Full", unknown: "No live count" };
function parkOut(c, live) {
  const o = { id: c.id, name: c.name, station: c.tsn, spots: c.spots, lat: c.lat, lon: c.lon, address: c.address || null, free: null, occupied: null, status: "unknown", label: PARK_LABEL.unknown, updated: null, stale: false };
  if (live) {
    const spots = Number(live.spots) || c.spots || 0;
    const used = Number((live.occupancy || {}).total);
    if (Number.isFinite(used)) {
      o.spots = spots; o.occupied = Math.min(used, spots); o.free = Math.max(0, spots - used);
      const at = sydneyLocalMs(live.MessageDate);
      o.updated = at ? new Date(at).toISOString() : null;
      o.stale = !!(at && Date.now() - at > 30 * 60000);
      o.status = o.stale ? "unknown" : parkStatus(o.free, spots);
      o.label = PARK_LABEL[o.status];
    }
  }
  return o;
}
async function carparkLive(env, c) {
  const hit = parkMem.get(c.id);
  if (hit && Date.now() - hit.at < 90000) return hit.v;
  let v = null;
  // The open data API allows a few calls a second; one retry covers a busy moment.
  for (let tryN = 0; tryN < 2 && !v; tryN++) {
    if (tryN) await new Promise((r) => setTimeout(r, 450));
    upstream.calls++;
    try {
      const res = await fetch(API + "/v1/carpark?facility=" + encodeURIComponent(c.id), { headers: { Authorization: "apikey " + apiKey(env) }, signal: AbortSignal.timeout(8000) });
      if (res.ok) v = parkOut(c, await res.json());
    } catch (e) { /* retry once */ }
  }
  if (!v) { v = parkOut(c, null); parkMem.set(c.id, { at: Date.now() - 75000, v }); return v; }
  parkMem.set(c.id, { at: Date.now(), v });
  if (parkMem.size > 200) parkMem.delete(parkMem.keys().next().value);
  return v;
}
async function carparkList(env) { const d = await facData(env, "carparks"); return (d && d.carparks) || []; }
async function parkingFor(env, tsn) {
  const list = (await carparkList(env)).filter((c) => c.tsn === String(tsn));
  return Promise.all(list.map((c) => carparkLive(env, c)));
}
const parkAllMem = { at: 0, v: null };
async function parkingAll(env) {
  if (parkAllMem.v && Date.now() - parkAllMem.at < 600000) return parkAllMem.v;
  const list = await carparkList(env);
  // Four at a time, under a second apart: the open data API allows about 5 calls a second.
  const v = [];
  for (let i = 0; i < list.length; i += 4) {
    const fresh = list.slice(i, i + 4).some((c) => { const h = parkMem.get(c.id); return !h || Date.now() - h.at >= 90000; });
    if (i && fresh) await new Promise((r) => setTimeout(r, 900));
    v.push(...(await Promise.all(list.slice(i, i + 4).map((c) => carparkLive(env, c)))));
  }
  if (v.some((p) => p.free != null)) { parkAllMem.v = v; parkAllMem.at = Date.now() - (v.some((p) => p.free == null) ? 420000 : 0); }
  return v;
}
function parkSentence(p) {
  if (p.status === "unknown" || p.free == null) return `${p.name}: no live count right now (${p.spots} spaces).`;
  if (p.status === "full") return `${p.name}: full (${p.spots} spaces).`;
  return `${p.name}: ${p.free} of ${p.spots} spaces free${p.status === "nearly" ? ", nearly full" : ""}.`;
}

// Station facilities belong to stations. The facilities data also lists bus interchanges such as Railway Square,
// with lifts, escalators and access copied from the station nearby, so those entries are left out.
function facBusOnly(s) { return /\b(bus|coach)\s+(interchange|station|stop|terminal|bay|layover)s?\b/i.test(String((s && s.n) || "")); }
async function stationInfo(env, id, live = true) {
  const fac = await facData(env, "facilities");
  const s = fac && fac.stations ? fac.stations[String(id)] : null;
  if (!s || facBusOnly(s)) return null;
  const x = s.x || [], f = s.f || [];
  const out = {
    id: String(id), name: s.n, lat: s.lat, lon: s.lon, modes: s.m ? s.m.split(/,\s*/) : [],
    access: { level: ACCESS_LEVEL[s.a] || "unknown", label: ACCESS_LABEL[s.a] || "Access not listed", note: ACCESS_NOTE[s.a] || null,
      lift: x.includes("lift"), escalator: x.includes("esc"), stairs: x.includes("stairs"), ramp: x.includes("ramp"),
      hearingLoop: x.includes("loop"), tactile: x.includes("tactile"), stairLift: x.includes("stairlift") },
    ticket: { kind: s.t || "unknown", label: TICKET_LABEL[s.t] || "Ticket machines not listed", topUp: !!s.t && s.t !== "none", cash: s.t === "cash", extraTopUp: !!s.tu },
    facilities: f.map((k) => FAC_LABEL[k]).filter(Boolean),
    parkRide: f.includes("parkride"),
    peak: s.pk || s.pp ? { morning: s.pk || null, afternoon: s.pp || null } : null,
    shortPlatform: !!s.sp, address: s.ad || null, phone: s.ph || null,
    source: FAC_SRC.facilities, read: fac.read || null,
  };
  if (live) {
    const [outs, park] = await Promise.all([liftOutages(env).catch(() => []), parkingFor(env, id).catch(() => [])]);
    out.outages = outs.filter((o) => o.stops.includes(String(id))).map(({ stops, ...o }) => o);
    out.parking = park;
    out.sources = [FAC_SRC.facilities, FAC_SRC.lifts].concat(park.length ? [FAC_SRC.parking] : []);
  }
  return out;
}
async function topupNear(env, lat, lon, limit = 12) {
  const fac = await facData(env, "facilities");
  if (!fac) return [];
  const all = Object.entries(fac.stations).filter(([, s]) => s.t && s.t !== "none");
  const la = Number(lat), lo = Number(lon), has = Number.isFinite(la) && Number.isFinite(lo) && la && lo;
  const rows = all.map(([id, s]) => ({ id, name: s.n, lat: s.lat, lon: s.lon, kind: s.t, label: TICKET_LABEL[s.t], cash: s.t === "cash", ...(has ? { distance: facDist(la, lo, s.lat, s.lon) } : {}) }));
  if (has) rows.sort((a, b) => a.distance - b.distance);
  return has ? rows.slice(0, limit) : rows;
}

// Trip results: access at each transit leg's stations, and Park and Ride spaces at the start.
async function addAccess(env, d, opts = {}) {
  const js = d && d.journeys;
  if (opts.accessible && d) d.accessible = true;
  if (!Array.isArray(js) || !js.length) return d;
  const fac = await facData(env, "facilities");
  if (!fac || !fac.stations) return d;
  const outs = await liftOutages(env).catch(() => []);
  const brief = (id) => {
    const s = fac.stations[String(id || "")];
    if (!s || facBusOnly(s)) return null;
    const b = { id: String(id), level: ACCESS_LEVEL[s.a] || "unknown", lift: (s.x || []).includes("lift") };
    const o = outs.filter((x) => x.stops.includes(String(id)));
    if (o.length) { b.outage = o[0].title; b.outages = o.length; }
    if (o.some((x) => x.kind === "lift")) b.liftOut = true;
    return b;
  };
  const mem = new Map();
  const get = (id) => { if (!mem.has(id)) mem.set(id, brief(id)); return mem.get(id); };
  for (const j of js) {
    for (const l of j.legs || []) {
      if (l.kind === "walk" || !(l.fromParent || l.toParent)) continue;
      const a = get(l.fromParent), b = get(l.toParent);
      if (a || b) l.access = { from: a, to: b };
    }
  }
  if (opts.parking === false) return d;
  const first = (js[0].legs || []).find((l) => l.kind !== "walk" && l.fromParent);
  if (first) {
    const pk = await parkingFor(env, first.fromParent).catch(() => []);
    if (pk.length) d.parking = { station: { id: String(first.fromParent), name: (fac.stations[first.fromParent] || {}).n || first.from }, carparks: pk, source: FAC_SRC.parking };
  }
  return d;
}

// Ask: "parking at Tallawong", "lifts at Central", "top up near me", "accessible trip Burwood to Central".
const ASK_PARK_RE = /\b(parking|park\s*(?:and|&|n)\s*ride|car\s*parks?|carparks?|spaces?\s+(?:left|free|available)|free\s+spaces?)\b/i;
const ASK_LIFT_RE = /\b(lifts?|elevators?|escalators?|wheelchair|accessible|accessibility|step[\s-]?free|pram)\b/i;
const ASK_TOPUP_RE = /\b(top[\s-]?ups?|topup|recharge|ticket\s+machines?|opal\s+machines?|buy\s+(?:an?\s+)?(?:opal\s+)?(?:card|ticket)|single\s+trip\s+tickets?|add\s+(?:money|value))\b/i;
const ASK_FAC_FILLER = /\b(is|are|the|a|an|at|in|near|nearby|around|for|of|on|any|there|how|many|much|what|whats|what's|where|can|i|me|my|do|does|to|free|left|available|spaces?|space|full|now|right|today|status|working|work|out|broken|station|stn|info|information|tell|show|check|please|parking|and|ride|car\s*parks?|carparks?|lifts?|elevators?|escalators?|wheelchair|accessible|accessibility|step[\s-]?free|access|pram|top[\s-]?ups?|topup|recharge|ticket|tickets|machines?|opal|buy|card|single|trip|add|money|value|get|find|closest|nearest|here|with|by|it|has|have|got|still|currently|of\s+service)\b/gi;
function askFacPlace(text) {
  return text.replace(/\bpark\s*(?:and|&|n)\s*ride\b/gi, " ").replace(/[?!.,]/g, " ").replace(ASK_FAC_FILLER, " ").replace(/\s+/g, " ").trim();
}
async function askFacStation(env, q) {
  const fac = await facData(env, "facilities");
  if (!fac || !q) return null;
  const want = q.toLowerCase().replace(/\s+(station|wharf|light rail)$/, "").trim();
  const ent = Object.entries(fac.stations).filter(([, s]) => !facBusOnly(s));
  const exact = ent.find(([, s]) => s.n.toLowerCase().replace(/\s+(station|wharf|light rail|b-line)$/, "") === want);
  if (exact) return exact[0];
  try {
    const { stops } = await findStops(env, q);
    for (const s of (stops || []).slice(0, 4)) if (fac.stations[String(s.id)] && !facBusOnly(fac.stations[String(s.id)])) return String(s.id);
  } catch (e) { /* fall through to a name match */ }
  const part = ent.find(([, s]) => s.n.toLowerCase().startsWith(want));
  return part ? part[0] : null;
}
async function askFacilities(env, text, ctx) {
  const park = ASK_PARK_RE.test(text);
  const lift = ASK_LIFT_RE.test(text);
  const topup = ASK_TOPUP_RE.test(text);
  if (!park && !lift && !topup) return null;
  // "accessible trip from Burwood to Central": plan it with step free trips only.
  if (lift && /\b(to|via)\b/i.test(text) && /\b(accessible|step[\s-]?free|wheelchair|pram)\b/i.test(text) && !topup && !park) {
    const rest = text.replace(/\b(an?\s+)?(accessible|step[\s-]?free|wheelchair(?:\s+friendly)?|pram(?:\s+friendly)?)\b\s*(trips?|routes?|ways?|journeys?)?\s*/gi, " ").replace(/\b(only|please)\b/gi, " ").replace(/\s+/g, " ").trim();
    if (rest && rest !== text) { const r = await askRoute(env, rest, { ...ctx, accessible: true }); if (r && typeof r === "object") r.accessible = true; return r; }
  }
  const placeQ = askFacPlace(text);
  const nearMe = !placeQ || /\b(near me|nearby|closest|nearest|around here|here)\b/i.test(text);
  if (park) {
    const all = await carparkList(env);
    if (!placeQ || nearMe && !placeQ) {
      if (ctx.lat && ctx.lon) {
        const la = Number(ctx.lat), lo = Number(ctx.lon);
        const near = all.map((c) => ({ c, d: facDist(la, lo, c.lat, c.lon) })).sort((a, b) => a.d - b.d).slice(0, 3);
        const live = await Promise.all(near.map((n) => carparkLive(env, n.c)));
        return askFacReply(live.map(parkSentence).join(" "), [{ type: "parking", title: "Park and Ride near you", items: live, source: FAC_SRC.parking }], live[0] ? [{ label: `Open ${live[0].name}`, ...askStopLink(live[0].station, live[0].name) }] : []);
      }
      return { kind: "facility", text: "Which station? Ask like \"parking at Tallawong\", or allow location for the closest Park and Ride.", ask: "location", suggestions: ["Parking at Tallawong", "Parking at Kellyville"] };
    }
    const lowerQ = placeQ.toLowerCase();
    let hits = all.filter((c) => c.name.toLowerCase().startsWith(lowerQ) || c.name.toLowerCase().split(/[\s(]+/)[0] === lowerQ.split(" ")[0] && lowerQ.length > 3);
    let tsn = hits.length ? hits[0].tsn : await askFacStation(env, placeQ);
    if (!hits.length && tsn) hits = all.filter((c) => c.tsn === tsn);
    if (!hits.length) {
      const st = tsn ? await stationInfo(env, tsn, false) : null;
      const nm = st ? st.name : placeQ.replace(/\b[a-z]/g, (c) => c.toUpperCase());
      return { kind: "facility", text: `${nm} has no Park and Ride car park with live spaces.${st && st.facilities.includes("Commuter car park") ? " It does have a commuter car park." : ""} Live counts cover ${all.length} Park and Ride car parks, like Tallawong, Kellyville and Gosford.`, suggestions: ["Parking at Tallawong", "Parking at Gosford"] };
    }
    hits = hits.filter((c) => c.tsn === hits[0].tsn);
    const live = await Promise.all(hits.map((c) => carparkLive(env, c)));
    const free = live.reduce((n, p) => n + (p.free || 0), 0), spots = live.reduce((n, p) => n + p.spots, 0);
    const stName = (await stationInfo(env, hits[0].tsn, false) || {}).name || hits[0].name;
    const lead = live.length > 1 && live.every((p) => p.free != null) ? `${stName}: ${free} of ${spots} spaces free across ${live.length} car parks. ` : "";
    const body = live.length === 1 ? parkSentence({ ...live[0], name: `${stName} Park and Ride` }) : live.map(parkSentence).join(" ");
    return askFacReply(lead + body, [{ type: "parking", title: `${stName} Park and Ride`, items: live, source: FAC_SRC.parking }],
      [{ label: `Open ${stName}`, ...askStopLink(hits[0].tsn, stName) }]);
  }
  if (topup) {
    if (placeQ && !nearMe) {
      const tsn = await askFacStation(env, placeQ);
      const st = tsn ? await stationInfo(env, tsn, false) : null;
      if (!st) return { kind: "facility", text: `I couldn't find a station called "${placeQ}". Opal top up machines are listed for train, metro and light rail stations and some wharves.` };
      const line = st.ticket.kind === "none" ? `${st.name} has no Opal top up or ticket machine.` : st.ticket.kind === "unknown" ? `${st.name} has no ticket machine listed.` : `${st.name}: ${st.ticket.label}.`;
      const near = st.ticket.topUp ? [] : (await topupNear(env, st.lat, st.lon, 3)).filter((r) => r.id !== st.id);
      return askFacReply(line + (near.length ? ` Closest with a machine: ${near.map((r) => `${r.name} (${askKm(r.distance)})`).join(", ")}.` : "") + " You can also top up in the Opal Travel app or at Opal retailers.",
        [{ type: "station", station: askStationCard(st) }], [{ label: `Open ${st.name}`, ...askStopLink(st.id, st.name) }]);
    }
    if (ctx.lat && ctx.lon) {
      const near = await topupNear(env, ctx.lat, ctx.lon, 3);
      if (!near.length) return { kind: "facility", text: "I couldn't find an Opal machine near you." };
      return askFacReply(`Closest Opal machines: ${near.map((r) => `${r.name}, ${askKm(r.distance)} (${r.cash ? "cash or card" : "card only"})`).join("; ")}. You can also top up in the Opal Travel app.`,
        [{ type: "stops", items: near.map((r) => ({ id: r.id, name: r.name, distance: r.distance, link: askStopLink(r.id, r.name) })) }], [{ label: "Open the map", kind: "map", href: "#/topup" }]);
    }
    return { kind: "facility", text: "Where? Ask like \"top up at Campsie\", or allow location for the closest Opal machine.", ask: "location", suggestions: ["Top up at Campsie"] };
  }
  // Lifts and access
  let tsn = placeQ ? await askFacStation(env, placeQ) : null;
  if (!tsn && ctx.lat && ctx.lon) { const n = await topupNear(env, ctx.lat, ctx.lon, 1).catch(() => []); tsn = n[0] ? n[0].id : null; }
  if (!tsn) return { kind: "facility", text: placeQ ? `I couldn't find a station called "${placeQ}".` : "Which station? Ask like \"lifts at Central\".", suggestions: ["Lifts at Central", "Is Redfern step free"] };
  const st = await stationInfo(env, tsn, true);
  if (!st) return { kind: "facility", text: "I don't have access details for that stop." };
  const has = [st.access.lift && "lifts", st.access.escalator && "escalators", st.access.ramp && "boarding ramp help"].filter(Boolean);
  let line = st.access.level === "none" && has.length ? `${st.name} is not listed as step free, so some platforms or exits need stairs. It has ${askList(has)}.`
    : `${st.name}: ${st.access.label.toLowerCase()}.${has.length ? " It has " + askList(has) + "." : ""}`;
  if (st.outages.length) line += ` ${st.outages.length === 1 ? "1 lift or escalator is" : st.outages.length + " lifts or escalators are"} out of service now: ${st.outages.map((o) => o.title.replace(new RegExp("^" + st.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*", "i"), "")).join("; ")}.`;
  else if (st.access.lift) line += " No lift outages reported right now.";
  return askFacReply(line, [{ type: "station", station: askStationCard(st) }], [{ label: `Open ${st.name}`, ...askStopLink(st.id, st.name) }]);
}
function askKm(m) { return m == null ? "" : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`; }
function askList(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
function askStationCard(st) {
  return { id: st.id, name: st.name, access: { level: st.access.level, label: st.access.label, lift: st.access.lift, escalator: st.access.escalator },
    ticket: { kind: st.ticket.kind, label: st.ticket.label }, outages: (st.outages || []).map((o) => ({ title: o.title, url: o.url })), parking: st.parking || [],
    source: (st.sources || [st.source]).join("; ") };
}
function askFacReply(text, cards, links) { return { kind: "facility", text, cards: cards || [], links: links || [] }; }

// Lift outage alerts for saved trip stations, and car park nearly full watches.
let facSchemaReady = null;
async function facSchema(env) {
  const d = db(env);
  if (!d) return false;
  if (!facSchemaReady) {
    facSchemaReady = d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS lift_alerts (device TEXT PRIMARY KEY, profile TEXT, stations TEXT, seen TEXT, created INTEGER, updated INTEGER)`),
      d.prepare(`CREATE TABLE IF NOT EXISTS park_watches (id TEXT PRIMARY KEY, device TEXT, profile TEXT, facility TEXT, name TEXT, station TEXT,
        created INTEGER, expires INTEGER, done INTEGER DEFAULT 0)`),
      d.prepare(`CREATE TABLE IF NOT EXISTS park_full (facility TEXT NOT NULL, day TEXT NOT NULL, first_tod INTEGER, full_tod INTEGER, PRIMARY KEY (facility, day))`),
    ]).then(() => true).catch((e) => { facSchemaReady = null; throw e; });
  }
  return facSchemaReady;
}
// ---------- car park "usually full by" ----------
// Weekday mornings, 5am to 11am, the tick reads the Park and Ride car parks, a quarter of them each
// minute, so each one every PARK_SAMPLE_EVERY minutes. It keeps one row per car park per day: the
// first reading that morning and the first time it read full. At most two row writes per car park per
// day; a car park already full today is not read again.
const PARK_SAMPLE_EVERY = 4, PARK_SAMPLE_FROM = 5 * 60, PARK_SAMPLE_TO = 11 * 60;
const PARK_MIN_DAYS = 5, PARK_DAYS_BACK = 56;
const parkDayMem = new Map(); // facility -> { day, full }, so an isolate skips writes it already made today
async function sampleParking(env, now, sn) {
  if (sn.dow > 5 || sn.tod < PARK_SAMPLE_FROM || sn.tod >= PARK_SAMPLE_TO) return null;
  const list = await carparkList(env);
  const due = list.filter((c, i) => i % PARK_SAMPLE_EVERY === sn.tod % PARK_SAMPLE_EVERY).filter((c) => { const m = parkDayMem.get(c.id); return !(m && m.day === sn.day && m.full); });
  const out = { due: due.length, read: 0, full: 0, writes: 0 };
  for (let i = 0; i < due.length; i += 4) {
    // Four at a time, under a second apart: the open data API allows about 5 calls a second.
    if (i) await new Promise((r) => setTimeout(r, 900));
    const got = await Promise.all(due.slice(i, i + 4).map((c) => carparkLive(env, c).catch(() => null)));
    for (const p of got) {
      if (!p || p.status === "unknown" || p.free == null) continue;
      out.read++;
      let m = parkDayMem.get(p.id);
      if (!m || m.day !== sn.day) {
        const r = await db(env).prepare("INSERT OR IGNORE INTO park_full (facility, day, first_tod, full_tod) VALUES (?1, ?2, ?3, NULL)").bind(p.id, sn.day, sn.tod).run();
        out.writes += (r.meta && r.meta.changes) || 0;
        m = { day: sn.day, full: false }; parkDayMem.set(p.id, m);
      }
      if (p.status === "full") {
        const r = await db(env).prepare("UPDATE park_full SET full_tod = ?3 WHERE facility = ?1 AND day = ?2 AND full_tod IS NULL").bind(p.id, sn.day, sn.tod).run();
        out.writes += (r.meta && r.meta.changes) || 0;
        m.full = true; out.full++;
      }
    }
  }
  if (parkDayMem.size > 200) parkDayMem.clear();
  return out;
}
function weekdayOf(day) { return new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8))).getUTCDay() || 7; }
// The words for one car park from its rows: weekdays only; today counts only once it has filled
// (a morning still under way says nothing yet). Usually full by: the time it was full by on 70
// percent of the mornings recorded, rounded up to 5 minutes.
function usualFull(rows, today, nowTod) {
  const days = rows.filter((r) => weekdayOf(r.day) <= 5 && (r.day !== today || r.full_tod != null || nowTod >= PARK_SAMPLE_TO));
  const n = days.length;
  if (n < PARK_MIN_DAYS) return { state: "learning", n, need: PARK_MIN_DAYS, text: `Learning when it fills: ${n} of ${PARK_MIN_DAYS} weekday mornings recorded` };
  const fulls = days.map((r) => r.full_tod).filter((t) => t != null).sort((a, b) => a - b);
  const k = Math.ceil(0.7 * n);
  const up5 = (t) => Math.ceil(t / 5) * 5;
  if (fulls.length >= k) { const tod = up5(fulls[k - 1]); return { state: "full", n, tod, text: `Usually full by ${todText(tod)} on weekdays` }; }
  if (!fulls.length) return { state: "space", n, text: `Had spaces every weekday morning lately (${n} days)` };
  const mid = up5(fulls[Math.floor((fulls.length - 1) / 2)]);
  return { state: "some", n, tod: mid, text: `Full by ${todText(mid)} on ${fulls.length} of the last ${n} weekdays` };
}
// Adds usual to each car park. A database without the table (or any read error) leaves them as they are.
async function withUsual(env, items) {
  if (!items || !items.length || !db(env)) return items;
  const sn = sydneyNow();
  const from = sydneyNow(Date.now() - PARK_DAYS_BACK * 86400000).day;
  let rows;
  try { rows = await d1all(env, "SELECT facility, day, full_tod FROM park_full WHERE day >= ?1", from); } catch (e) { return items; }
  const by = new Map();
  for (const r of rows) { if (!by.has(r.facility)) by.set(r.facility, []); by.get(r.facility).push(r); }
  return items.map((p) => ({ ...p, usual: usualFull(by.get(p.id) || [], sn.day, sn.tod) }));
}
async function facTick(env, now, sn, opts = {}) {
  if (!(await facSchema(env).catch(() => false))) return { skipped: "no storage" };
  const out = { park: [], lifts: [] };
  const cps = await carparkList(env);
  for (const w of await d1all(env, "SELECT * FROM park_watches WHERE done = 0 AND expires > ?1 ORDER BY created LIMIT 20", now)) {
    const c = cps.find((x) => x.id === w.facility);
    if (!c) continue;
    const p = await carparkLive(env, c);
    if (p.status !== "nearly" && p.status !== "full") continue;
    await notify(env, { device: w.device }, { title: `${p.name} car park ${p.status === "full" ? "is full" : "nearly full"}`, body: p.status === "full" ? `No spaces left of ${p.spots}. Live count from Transport for NSW.` : `${p.free} of ${p.spots} spaces left. Live count from Transport for NSW.`, url: `/#/stop/${encodeURIComponent(p.station)}?name=${encodeURIComponent(p.name)}`, tag: "pk" + w.id, ttl: 1800 });
    await db(env).prepare("UPDATE park_watches SET done = 1 WHERE id = ?1").bind(w.id).run();
    out.park.push({ id: w.id, status: p.status });
  }
  if (opts.force || sn.tod % 10 === 4) {
    const rows = await d1all(env, "SELECT * FROM lift_alerts LIMIT 500");
    if (rows.length) {
      const outs = await liftOutages(env);
      const fac = await facData(env, "facilities");
      for (const r of rows) {
        let stations = [], seen = [];
        try { stations = JSON.parse(r.stations || "[]"); seen = JSON.parse(r.seen || "[]"); } catch (e) { continue; }
        const match = outs.filter((o) => o.stops.some((s) => stations.includes(s)));
        const fresh = match.filter((o) => !seen.includes(o.id)).slice(0, 3);
        for (const o of fresh) {
          const sid = o.stops.find((s) => stations.includes(s));
          const nm = (fac && fac.stations[sid] && fac.stations[sid].n) || "a station on your trips";
          await notify(env, { device: r.device }, { title: `${o.kind === "escalator" ? "Escalator" : "Lift"} out at ${nm}`, body: o.title + ". This station is on one of your saved trips.", url: `/#/stop/${encodeURIComponent(sid)}?name=${encodeURIComponent(nm)}`, tag: "lift" + o.id, ttl: 3600 });
          out.lifts.push({ device: r.device.slice(0, 6), outage: o.id });
        }
        const ids = JSON.stringify(match.map((o) => o.id));
        if (ids !== (r.seen || "[]")) await db(env).prepare("UPDATE lift_alerts SET seen = ?2, updated = ?3 WHERE device = ?1").bind(r.device, ids, now).run();
      }
    }
  }
  if (!opts.noSample) out.parkFull = await sampleParking(env, now, sn).catch((e) => ({ error: String(e && e.message || e).slice(0, 160) }));
  if (sn.tod % 60 === 8) await db(env).prepare("DELETE FROM park_watches WHERE expires < ?1").bind(now - 86400000).run().catch(() => null);
  if (sn.tod === 3 * 60 + 8) await db(env).prepare("DELETE FROM park_full WHERE day < ?1").bind(sydneyNow(now - 70 * 86400000).day).run().catch(() => null);
  return out;
}

async function facRoutes(request, env, url) {
  const p = url.searchParams;
  facOrigin = url.origin;
  const path = url.pathname;
  const cache = (o, s = 60) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${s}`, "access-control-allow-origin": "*", ...API_SEC_HEADERS } });
  if (path === "/api/station") {
    const id = cleanId(p.get("id"), 12);
    if (!/^\d{5,8}$/.test(id)) return json({ error: "id must be a station number, for example 200060" }, 400);
    const st = await stationInfo(env, id, p.get("live") !== "0");
    if (!st) return json({ error: "no facility data for this stop", id }, 404);
    return cache(st, 60);
  }
  if (path === "/api/parking") {
    if (p.get("id")) {
      const c = (await carparkList(env)).find((x) => x.id === cleanId(p.get("id"), 8));
      if (!c) return json({ error: "no such car park" }, 404);
      return cache({ carpark: (await withUsual(env, [await carparkLive(env, c)]))[0], source: FAC_SRC.parking }, 60);
    }
    if (p.get("stop")) {
      const id = cleanId(p.get("stop"), 12);
      return cache({ station: id, carparks: await withUsual(env, await parkingFor(env, id)), source: FAC_SRC.parking }, 60);
    }
    const items = await withUsual(env, p.get("live") === "0" ? (await carparkList(env)).map((c) => parkOut(c, null)) : await parkingAll(env));
    return cache({ carparks: items, source: FAC_SRC.parking }, p.get("live") === "0" ? 86400 : 120);
  }
  if (path === "/api/topup") {
    const lim = Math.max(1, Math.min(40, Math.floor(Number(p.get("limit") || 12)) || 12));
    return cache({ items: await topupNear(env, p.get("lat"), p.get("lon"), lim), source: FAC_SRC.facilities, note: "Opal top up and ticket machines at stations. Opal retailers are not in the open data." }, p.get("lat") ? 300 : 86400);
  }
  if (path === "/api/lifts") {
    return cache({ items: (await liftOutages(env)).map((o) => ({ ...o })), source: FAC_SRC.lifts }, 120);
  }
  if (!(await facSchema(env).catch(() => false))) return json({ error: "storage not available" }, 503);
  if (path === "/api/lifts/alerts") {
    if (request.method === "GET") {
      const r = await db(env).prepare("SELECT stations FROM lift_alerts WHERE device = ?1").bind(cleanId(p.get("device"))).first();
      return json({ on: !!r, stations: r ? JSON.parse(r.stations || "[]") : [] });
    }
    if (request.method !== "POST") return json({ error: "method" }, 405);
    const b = await request.json().catch(() => ({}));
    const dev = cleanId(b.device);
    if (dev.length < 8) return json({ error: "device needed" }, 400);
    if (b.on === false) { await db(env).prepare("DELETE FROM lift_alerts WHERE device = ?1").bind(dev).run(); return json({ ok: true, on: false }); }
    const stations = [...new Set((Array.isArray(b.stations) ? b.stations : []).map((s) => String(s)).filter((s) => /^\d{5,8}$/.test(s)))].slice(0, 40);
    const prof = profileId(b.profile);
    const outs = await liftOutages(env).catch(() => []);
    const now = Date.now();
    const match = outs.filter((o) => o.stops.some((s) => stations.includes(s)));
    // Outages already showing when you turn this on are listed here, not pushed.
    await db(env).prepare(`INSERT INTO lift_alerts (device, profile, stations, seen, created, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
      ON CONFLICT (device) DO UPDATE SET profile = ?2, stations = ?3, updated = ?5`).bind(dev, prof, JSON.stringify(stations), JSON.stringify(match.map((o) => o.id)), now).run();
    return json({ ok: true, on: true, stations: stations.length, now: match.map(({ stops, ...o }) => ({ ...o, station: stops.find((s) => stations.includes(s)) })) });
  }
  if (path === "/api/parking/watch") {
    if (request.method === "DELETE") {
      await db(env).prepare("UPDATE park_watches SET done = 1 WHERE id = ?1 AND device = ?2").bind(cleanId(p.get("id"), 24), cleanId(p.get("device"))).run();
      return json({ ok: true });
    }
    if (request.method === "GET") {
      const rows = await d1all(env, "SELECT id, facility, name, station, expires FROM park_watches WHERE device = ?1 AND done = 0 AND expires > ?2", cleanId(p.get("device")), Date.now());
      return json({ items: rows });
    }
    if (request.method !== "POST") return json({ error: "method" }, 405);
    const b = await request.json().catch(() => ({}));
    const dev = cleanId(b.device);
    if (dev.length < 8) return json({ error: "device needed" }, 400);
    const c = (await carparkList(env)).find((x) => x.id === cleanId(b.facility, 8));
    if (!c) return json({ error: "no such car park" }, 400);
    const open = await d1all(env, "SELECT id FROM park_watches WHERE device = ?1 AND done = 0 AND expires > ?2", dev, Date.now());
    if (open.length >= 5) return json({ error: "You can watch up to 5 car parks at a time." }, 400);
    const id = "p" + rid(9);
    const now = Date.now();
    await db(env).prepare("INSERT INTO park_watches (id, device, profile, facility, name, station, created, expires, done) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)")
      .bind(id, dev, profileId(b.profile), c.id, c.name, c.tsn, now, now + PARK_WATCH_HOURS * 3600000).run();
    return json({ ok: true, watch: { id, facility: c.id, name: c.name, expires: now + PARK_WATCH_HOURS * 3600000 }, now: await carparkLive(env, c) });
  }
  return json({ error: "not found" }, 404);
}
// ---- facilities end

// Hosts. The API lives at api.transportsydney.app and the public site (store links, privacy,
// support, terms) at transportsydney.app as static files. On the API host, or anywhere with
// API_ONLY set (the Cloudflare deploy sets it), this worker serves only the API, the shared live
// trip page and the Android APK: the site's paths redirect to the site and anything else is a
// JSON 404. CORS stays open (*) on every host, so app builds on the old and new address both work.
const API_HOST = "api.transportsydney.app";
const SITE_URL = "https://transportsydney.app";
function siteUrl(env) {
  const s = env && env.SITE_URL;
  return typeof s === "string" && /^https:\/\/[a-z0-9.-]+$/i.test(s) ? s.toLowerCase() : SITE_URL;
}
function apiOnly(env, url) {
  if (env && (env.API_ONLY === "1" || env.API_ONLY === true)) return true;
  return url.hostname.toLowerCase() === String((env && env.API_HOST) || API_HOST).toLowerCase();
}
const LIVE_PATHS = /^\/(live\/|live\/live\.js|style\.css|vendor\/leaflet\.(js|css)|favicon(-16|-32)?\.(png|ico)|apple-touch-icon\.png|icon-(192|512)\.png|badge-96\.png|og\.png)$/;
const SITE_PATHS = /^\/(privacy|support|terms)(\/.*)?$/;
// The station and suburb lists the app keeps for Ask (askPlaces.ts) and its offline "Did you mean": static files, read by phones.
const LIST_PATHS = /^\/stations\/(train|metro|lightrail|ferry|places|bus-routes|bus-stops)\.json$/;
function apiOnlyRoute(request, env, url) {
  const p = url.pathname;
  if (p.startsWith("/api/") || /^\/download\/[A-Za-z0-9._-]+\.apk$/.test(p) || LIVE_PATHS.test(p) || LIST_PATHS.test(p)) return null;
  const go = (to) => new Response(null, { status: 301, headers: { location: to, "cache-control": "public, max-age=3600", ...API_SEC_HEADERS } });
  if (p === "/" || p === "/index.html" || /^\/download(\/.*)?$/.test(p)) return go(siteUrl(env) + "/");
  if (SITE_PATHS.test(p)) return go(siteUrl(env) + "/" + p.split("/")[1] + "/");
  if (p === "/live") return go("/live/" + url.search);
  if (p === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400", ...API_SEC_HEADERS } });
  return json({ error: "Not found. This address serves the Transport: Sydney Live API under /api/.", site: siteUrl(env) }, 404);
}

async function handleRequest(request, env, exec) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS", "access-control-allow-headers": "content-type, x-profile", "access-control-max-age": "86400" } });
    if (apiOnly(env, url)) { const r = apiOnlyRoute(request, env, url); if (r) return r; }
    if (/^\/(worker\.m?js|_worker\.js|[a-z]+-site\.json)$/.test(url.pathname)) return new Response("Not found", { status: 404 });
    if (/^\/download\/[A-Za-z0-9._-]+\.apk$/.test(url.pathname)) return serveFile(env, url.pathname.slice("/download/".length), request);
    if (!url.pathname.startsWith("/api/")) {
      if (url.pathname !== "/404.html") { const page = servePage(request, url); if (page) return page; }
      const res = await env.ASSETS.fetch(request);
      if (res.status === 404) { const nf = notFoundPage(request); if (nf) return nf; }
      if (LIST_PATHS.test(url.pathname)) { const h = new Headers(res.headers); h.set("access-control-allow-origin", "*"); return withSec(new Response(res.body, { status: res.status, headers: h }), false); }
      return withSec(res, false);
    }
    if (!rateOk(request, url.pathname) && !loadOk(request, env)) return json({ error: "Too many requests. Wait a minute and try again." }, 429);
    const bad = badInput(url.searchParams);
    if (bad) return url.searchParams.get("format") === "text" ? textRes(bad) : json({ error: bad, text: bad }, 400);
    if (!(await ipLimitOk(env, request, url.pathname)) && !loadOk(request, env)) return json({ error: "Too many requests. Wait a minute and try again." }, 429);
    if (/^\/api\/share(\/update)?$/.test(url.pathname)) {
      try { return await shareRoutes(request, env, url); }
      catch (e) { return json({ error: "Sharing is not available right now." }, 500); }
    }
    if (/^\/api\/(hit|stats|feedback)$/.test(url.pathname)) {
      try { const s = await siteRoutes(request, env, url, exec); if (s) return s; }
      catch (e) { return json({ ok: false, error: "server", errors: { form: "We could not save that right now. Please email contact@fintex.au instead." } }, 500); }
    }
    // Budget guard (docs/COSTS.md): the last usage reading, a check now, clearing a hold. Admin key.
    if (url.pathname === "/api/budget" || url.pathname.startsWith("/api/budget/")) return withSec(await budgetRoutes(request, env, url), false);
    // Our own trip planner (raptor.js): loading and checks, engine load key or admin key.
    if (url.pathname.startsWith("/api/raptor/") && typeof plannerRoutes === "function") return withSec(await plannerRoutes(request, env, url), false);
    // Loading the engine's timetable (tools/load_timetable.mjs): admin key only.
    if (url.pathname.startsWith("/api/engine/load/") && request.method === "POST") {
      if (!adminOk(request) && !(env.ENGINE_LOAD_KEY && keyOk(request, null, env.ENGINE_LOAD_KEY))) return json({ error: "forbidden" }, 403);
      if (typeof engineCall !== "function") return json({ error: "engine not built in" }, 503);
      if (url.pathname === "/api/engine/load/restart-shards") {
        const n = engineShards(env);
        const out = await Promise.all(Array.from({ length: n }, (_, i) => env.SHARDS.get(env.SHARDS.idFromName(engShardName(i)), { locationHint: "oc" }).fetch("https://engine/restart?name=" + engShardName(i), { method: "POST" }).then((x) => x.status, (e) => String(e))));
        return json({ shards: n, answers: out });
      }
      const r = await engineCall(env, url.pathname.slice("/api/engine".length), { method: "POST", body: await request.arrayBuffer() });
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
    }
    feedStats.requests++;
    const p = url.searchParams;
    const asTxt = p.get("format") === "text";
    const profile = profileId(request.headers.get("x-profile") || p.get("profile"));
    try {
      const ctx = { lat: p.get("lat"), lon: p.get("lon"), profile, exec };
      switch (url.pathname) {
        case "/api/ask": {
          const actx = { ...ctx, origin: url.origin, home: askPlaceArg(p.get("home")), work: askPlaceArg(p.get("work")), accessible: p.get("acc") === "1" };
          const d = await askV2(env, p.get("q") || "", actx);
          if (d.lastHome && !(await serverOn(env, "lastWayHome"))) delete d.lastHome;
          if (d.kind === "trip") {
            await addAccess(env, d, { accessible: actx.accessible || d.accessible }).catch(() => null);
            // Card legs are copies made for the reply: give them the same access notes.
            const accBy = new Map();
            for (const j of d.journeys || []) for (const l of j.legs || []) if (l.access) accBy.set(`${l.line}|${l.planned}`, l.access);
            for (const c of d.cards || []) for (const j of c.journeys || []) for (const l of j.legs || []) { const a = accBy.get(`${l.line}|${l.planned}`); if (a) l.access = a; }
            const lines = [];
            if (d.accessible) lines.push((d.journeys || []).length ? "Step free trips only." : "No step free trips found for that. Turn off Accessible trips in Settings to see all trips.");
            const j0 = (d.journeys || []).find((j) => ms(j.board || j.leave) >= Date.now() - 60000) || (d.journeys || [])[0];
            const out = j0 ? [...new Set((j0.legs || []).flatMap((l) => l.access ? [l.access.from, l.access.to] : []).filter((a) => a && a.outage).map((a) => a.outage))] : [];
            if (out.length) lines.push("Lift outage on this trip: " + out.slice(0, 2).join("; ") + ".");
            if (d.parking && d.parking.carparks.length) { const pk = d.parking.carparks, fr = pk.reduce((n, c) => n + (c.free || 0), 0), sp = pk.reduce((n, c) => n + c.spots, 0); const nf = pk.filter((c) => c.status === "nearly" || c.status === "full").map((c) => c.name.replace(d.parking.station.name.replace(/ Station$/, "") + " ", "")); lines.push(pk.every((c) => c.free == null) ? `${d.parking.station.name} Park and Ride: no live count right now.` : `${d.parking.station.name} Park and Ride: ${fr} of ${sp} spaces free${nf.length ? `, ${askList(nf)} nearly full` : ""}.`); }
            if (lines.length && d.reply) d.reply += "\n" + lines.join("\n");
          }
          await afterAnswer(env, d, { profile, device: p.get("device"), exec });
          pickFares(d, fareType(p));
          const fj = (d.journeys || []).find((j) => j.fare && ms(j.board || j.leave) >= Date.now() - 60000) || (d.journeys || [])[0];
          const fs = d.kind === "trip" && fj ? fareSentence(fj.fare) : "";
          // A fare question leads with the fare.
          if (fs && d.reply) { d.reply = d.fareAsked ? fs + "\n" + d.reply : d.reply + "\n" + fs; d.fare = fj.fare; }
          else if (d.fareAsked && d.reply && d.kind === "trip") d.reply = "I couldn't work out an Opal fare for this trip.\n" + d.reply;
          // Timetable stand ins (Trip Planner down) say so first, and that the phone is not the problem.
          const ttNote = "Live times are unavailable right now because Transport for NSW isn't answering, so these are timetable times.";
          const isTt = d.source === "timetable" || (d.journeys || []).some((j) => (j.legs || []).some((l) => l.source === "timetable")) || (d.items || []).some((i) => i.source === "timetable");
          if (isTt && d.reply) d.reply = ttNote + "\n" + d.reply;
          if (asTxt) { let tx = await askText(env, d); if (isTt && !tx.includes(ttNote)) tx = ttNote + "\n" + tx; return textRes(fs && !tx.includes(fs) ? tx + "\n" + fs : tx); }
          return json(askSlim(d));
        }
        case "/api/departures": {
          const at = boardAt(p.get("time"), p.get("date"));
          // Board engine (src/engine.js, docs/ENGINE.md): a board it has already made, when ENGINE_BOARDS is on or the
          // request says engine=1. A stop it has no timetable for falls through to the Trip Planner below.
          let staleEngine = null;
          if (!at && typeof engineBoard === "function" && engineWanted(env, url)) {
            const et = await engineBoard(env, exec, p.get("stop") || "", p.get("mode") || "").catch(() => null);
            const eb = et ? JSON.parse(et) : null;
            // A board built more than 60 s ago, or from a feed copy more than 60 s old, goes to the Trip Planner instead.
            const engAge = eb ? Date.now() - Math.min((eb.engine && eb.engine.builtAt) || 0, (eb.live && eb.live.feedAt) || Infinity) : Infinity;
            const serveEngine = async () => {
              // Same board as the phone already holds (If-None-Match): 304, no body.
              const etag = 'W/"e' + ((eb.engine && eb.engine.builtAt) || 0) + "-" + et.length + '"';
              if (!asTxt && request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": "no-store", "access-control-allow-origin": "*", ...API_SEC_HEADERS } });
              // The shard asks for the Trip Planner's platform and stand names of a stop it has none for (once in 6 hours).
              if (eb.engine && eb.engine.learn) {
                delete eb.engine.learn;
                const stop = p.get("stop") || "";
                exec.waitUntil(departures(env, stop, { ctx: exec }).then((r) => engineLearn(env, exec, r)).catch(() => {}));
              }
              const d = { kind: "departures", dataAt: (eb.live && eb.live.feedAt) || (eb.engine && eb.engine.builtAt) || Date.now(), ...eb, now: Date.now() };
              if (!(await serverOn(env, "occupancy"))) { d.items = d.items.map((x) => ({ ...x, vehicle: x.vehicle ? { ...x.vehicle } : x.vehicle })); stripOccupancy(d); }
              await afterAnswer(env, d, { profile, device: p.get("device"), exec });
              if (asTxt) return textRes(await asText(env, d));
              const res = json(d);
              res.headers.set("etag", etag);
              return res;
            };
            // Load tests (the load test key) never spend Trip Planner calls: the engine's board whatever its age, or 503.
            if (loadOk(request, env)) {
              if (!eb) return json({ error: "The engine has no board for this stop." }, 503);
              if (eb.engine) delete eb.engine.learn;
              return await serveEngine();
            }
            // A stop where the Trip Planner lists services our bundles do not have (engine.gap): the planner's board.
            const gap = eb && eb.engine && eb.engine.gap;
            if (eb && !gap && engAge <= ENGINE_STALE_MS) return await serveEngine();
            // Stale (over 60 s): the Trip Planner answers instead. If it is refusing us or does not answer, the engine's
            // board is still served, with its own dataAt, up to 10 minutes old (26 Oct, g14: in a 1,000 phone test every
            // stale board went to the Trip Planner at once and it answered 502).
            if (eb && engAge <= ENGINE_HOLD_MS) staleEngine = serveEngine;
          }
          const depKey = (p.get("stop") || "") + "|" + (p.get("mode") || "") + (at ? "|" + at.date + at.time : "");
          const depHit = depMem.get(depKey);
          let r;
          if (depHit && Date.now() - depHit.at < (p.get("refresh") === "1" ? REFRESH_MAX_AGE_MS : 12000)) {
            try { r = await depHit.p; } catch (e) { if (staleEngine) return await staleEngine(); throw e; }
          } else {
            if (staleEngine && upstreamBusy(false)) return await staleEngine();
            const pr = departures(env, p.get("stop"), { mode: p.get("mode") || null, ctx: exec, ...(at ? { at } : {}) });
            depMem.set(depKey, { at: Date.now(), p: pr });
            if (depMem.size > 300) depMem.delete(depMem.keys().next().value);
            try { r = await pr; } catch (e) { depMem.delete(depKey); if (staleEngine) return await staleEngine(); throw e; }
            // Platform names and missing lines for the engine: a Durable Object request each time, so only while the
            // engine serves this board or ENGINE_LEARN is "on" (budget mode, docs/COSTS.md).
            if (!at && typeof engineLearn === "function" && (engineWanted(env, url) || flagOn(env, "ENGINE_LEARN"))) engineLearn(env, exec, r);
          }
          const d = { kind: "departures", ...r };
          if (!(await serverOn(env, "occupancy"))) { d.items = d.items.map((x) => ({ ...x, vehicle: x.vehicle ? { ...x.vehicle } : x.vehicle })); stripOccupancy(d); }
          await afterAnswer(env, d, { profile, device: p.get("device"), exec });
          return asTxt ? textRes(await asText(env, d)) : json(d);
        }
        case "/api/engine/status": {
          if (typeof engineCall !== "function") return json({ error: "engine not built in" }, 503);
          const r = await engineCall(env, "/status");
          const st = await r.json();
          // The board shards: starts (boots) and ticks of each, so a restart under load shows here.
          const n = engineShards(env);
          if (n) {
            st.shards = await Promise.all(Array.from({ length: n }, async (_, i) => {
              const name = engShardName(i);
              try { return await (await env.SHARDS.get(env.SHARDS.idFromName(name), { locationHint: "oc" }).fetch("https://engine/status?name=" + name)).json(); } catch (e) { return { name, error: String(e && e.message || e) }; }
            }));
          }
          return json(st, r.status);
        }
        case "/api/pack":
          // One stop's timetable for the phone (src/pack.js, docs/TIMETABLE_PACKS.md).
          if (typeof packAnswer !== "function") return json({ error: "No timetable right now." }, 503);
          return packAnswer(env, exec, url, API_SEC_HEADERS);
        case "/api/timetable": {
          // The on phone timetable pack: timetable rows for up to 40 stops (and their platforms) for today and the next
          // day, routes and headsigns included. Shared through Cloudflare's cache for 30 minutes per stop list.
          if (typeof engineCall !== "function") return json({ error: "engine not built in" }, 503);
          const ids = [...new Set((p.get("stops") || "").split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{1,20}$/.test(s)))].slice(0, 40).sort();
          if (!ids.length) return json({ error: "Give stops=id,id" }, 400);
          const days = Math.max(1, Math.min(3, Number(p.get("days")) || 2));
          const ck = new Request("https://engine-cache.transportsydney.app/timetable?stops=" + ids.join(",") + "&days=" + days);
          const hit = await caches.default.match(ck).catch(() => null);
          if (hit) return new Response(hit.body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=1800", "access-control-allow-origin": "*", "x-edge-cache": "hit", ...API_SEC_HEADERS } });
          const r = await engineCall(env, "/timetable?stops=" + encodeURIComponent(ids.join(",")) + "&days=" + days);
          const body = await r.text();
          if (r.status !== 200 || /"error"/.test(body.slice(0, 40))) return json({ error: "No timetable right now." }, 503);
          exec.waitUntil(caches.default.put(ck, new Response(body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=1800" } })).catch(() => {}));
          return new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=1800", "access-control-allow-origin": "*", ...API_SEC_HEADERS } });
        }
        case "/api/traffic": {
          // Open Live Traffic incidents as the app words them (for bus legs and checks), at most 300.
          const items = await trafficHazards(env);
          return json({ items: items.slice(0, 300), count: items.length, at: hazMem && hazMem.at ? new Date(hazMem.at).toISOString() : null });
        }
        case "/api/trip": {
          const acc = p.get("acc") === "1";
          const long = p.get("long") === "1";
          const longKey = long && !asTxt ? longTripCacheKey(p) : null;
          if (longKey) {
            const hit = await caches.default.match(longKey).catch(() => null);
            if (hit) { const d = await hit.json().catch(() => null); if (d) return json({ ...d, cached: true }); }
          }
          const want = Math.max(1, Math.min(8, Number(p.get("count") || 5) || 5));
          const liftAware = acc && (await serverOn(env, "liftAwareRouting"));
          // Lift aware: ask for a few more trips so one that avoids a lift outage can be found.
          const modes = tripModesParse(p.get("modes"));
          const day = tripDate(p.get("date"));
          const tbase = { time: p.get("time") || null, date: day, arriveBy: p.get("arriveBy") === "1", count: liftAware ? Math.min(8, want + 3) : want, accessible: acc, long, exclude: tripModesExclude(modes) };
          // A page of the trip list's endless scroll (tripPage): more trips per answer, cursors for the next pages.
          const pq = tripPageQuery(p);
          const r = pq ? await tripPage(env, p.get("from"), p.get("to"), pq, tbase) : await trip(env, p.get("from"), p.get("to"), tbase);
          // modes and date are echoed so the app knows this server honoured them (an older server does not).
          if (modes.length) { r.journeys = tripModesKeep(r.journeys, modes); r.modes = modes; }
          if (day) r.date = day;
          // A link with stop ids and no names takes the names from the first trip found.
          const given = (k) => { const v = (p.get(k) || "").trim(); return v && !/^\d+$/.test(v) ? v : null; };
          const d = { kind: "trip", from: { id: p.get("from"), name: given("fromName") || tripEndName(r, "from") || p.get("from") }, to: { id: p.get("to"), name: given("toName") || tripEndName(r, "to") || p.get("to") }, ...r };
          pickFares(d, fareType(p));
          await addAccess(env, d, { accessible: acc }).catch(() => null);
          await addTraffic(env, d).catch(() => null);
          if (liftAware) liftAwareRank(d, pq ? pq.n || TRIP_PAGE_N : want);
          if (!(await serverOn(env, "occupancy"))) stripOccupancy(d);
          // A later or earlier page is the same search scrolled, so it is not logged again.
          await afterAnswer(env, d, { profile, device: p.get("device"), exec, log: p.get("refresh") !== "1" && !(pq && (pq.after != null || pq.before != null)) });
          if (longKey && (d.journeys || []).length && d.source !== "timetable") {
            const put = caches.default.put(longKey, new Response(JSON.stringify(d), { headers: { "content-type": "application/json", "cache-control": `max-age=${LONG_TRIP_CACHE_S}` } })).catch(() => null);
            if (exec && exec.waitUntil) exec.waitUntil(put); else await put;
          }
          if (asTxt) return textRes(await asText(env, d));
          const res = json(d);
          // Timetable trips stand in for a refused Trip Planner: never kept, so the first live answer replaces them.
          if (d.source === "timetable") res.headers.set("x-stand-in", "timetable");
          return res;
        }
        case "/api/plan": {
          // A trip with any number of legs: legs=[{f, fn, t, tn, m, c, a, w}] (from, to, mode, change minutes, all services, walk minutes).
          let raw = null;
          try { raw = JSON.parse(p.get("legs") || "null"); } catch (e) { raw = null; }
          const legs = chainLegs(raw);
          if (!legs) return json({ error: "legs must be a list of 1 to 6 legs, each with f and t, and the first leg not a walk" }, 400);
          const acc = p.get("acc") === "1";
          const want = Math.max(1, Math.min(8, Number(p.get("count") || 5) || 5));
          const liftAware = acc && (await serverOn(env, "liftAwareRouting"));
          const r = await planChain(env, legs, { time: p.get("time") || null, count: liftAware ? Math.min(8, want + 3) : want, all: p.get("all") === "1", accessible: acc });
          const z = legs[legs.length - 1];
          pickFares(r, fareType(p));
          await addAccess(env, r, { accessible: acc }).catch(() => null);
          await addTraffic(env, r).catch(() => null);
          if (liftAware) liftAwareRank(r, want);
          if (!(await serverOn(env, "occupancy"))) stripOccupancy(r);
          return json({ kind: "trip", from: { id: legs[0].f, name: legs[0].fn }, to: { id: z.t, name: z.tn }, stops: legs.slice(0, -1).map((l) => ({ id: l.t, name: l.tn })), ...r });
        }
        case "/api/service":
        case "/api/status": {
          const d = await service(env, serviceQuery(p));
          if (d.mine && q0(p, "line") && q0(p, "stop")) {
            const it = { line: p.get("line"), stopId: p.get("stop"), planned: d.mine.planned || p.get("planned") };
            await predictions(env, [it]).catch(() => null);
            if (it.pred) d.pred = it.pred;
          }
          if (asTxt) return textRes(await asText(env, d));
          if (url.pathname === "/api/status") {
            const { stops, path, ...rest } = d;
            return json({ ...rest, text: await asText(env, d) });
          }
          return json(d);
        }
        case "/api/next": {
          const s = await savedGet(env, profile, p.get("name") || "");
          if (!s) return asTxt ? textRes(`No saved trip called ${p.get("name") || ""}.`) : json({ error: "not saved", name: p.get("name") }, 404);
          const d = await savedTrip(env, s, Math.min(5, Number(p.get("count") || 5)), p.get("acc") === "1");
          pickFares(d, fareType(p));
          await addAccess(env, d, { accessible: p.get("acc") === "1" }).catch(() => null);
          if (p.get("acc") === "1" && (await serverOn(env, "liftAwareRouting"))) liftAwareRank(d);
          if (!(await serverOn(env, "occupancy"))) stripOccupancy(d);
          await afterAnswer(env, d, { profile, device: p.get("device"), exec });
          return asTxt ? textRes(await asText(env, d)) : json(d);
        }
        case "/api/saved": {
          if (request.method === "GET") return json({ profile: profile || null, items: profile ? await savedList(env, profile) : [] });
          if (request.method === "DELETE") { if (!profile) return json({ error: "profile needed" }, 400); await savedDelete(env, profile, p.get("name") || ""); return json({ ok: true }); }
          if (request.method === "POST") {
            const b = await request.json().catch(() => ({}));
            const prof = profileId(b.profile || profile);
            if (!prof) return json({ error: "profile needed" }, 400);
            const name = String(b.name || "").trim().slice(0, 24);
            if (!name) return json({ error: "name needed" }, 400);
            const legs = b.legs ? chainLegs(b.legs) : null;
            if (legs && legs.length > 1) {
              const z = legs[legs.length - 1];
              return json({ ok: true, saved: await savedPut(env, prof, name, { id: legs[0].f, name: legs[0].fn }, { id: z.t, name: z.tn }, legs) });
            }
            const [from, to] = await Promise.all([resolvePlace(env, b.from), resolvePlace(env, b.to)]);
            if (!from || !to) return json({ error: "could not find one of those stops" }, 400);
            return json({ ok: true, saved: await savedPut(env, prof, name, from, to) });
          }
          return json({ error: "method" }, 405);
        }
        case "/api/stations": {
          // Station lists for New Trip, built from the TfNSW GTFS timetable (tools/build_stations.py).
          const mode = p.get("mode") || "";
          if (!["train", "metro", "ferry", "lightrail", "bus"].includes(mode)) return json({ error: "mode must be train, metro, bus, ferry or lightrail" }, 400);
          const route = (p.get("route") || "").trim().toUpperCase().slice(0, 12);
          const file = mode !== "bus" ? `/stations/${mode}.json` : route ? `/stations/bus/${route.slice(0, 2).replace(/[^A-Z0-9]/g, "_")}.json` : "/stations/bus-routes.json";
          const r = await env.ASSETS.fetch(new Request(new URL(file, url.origin)));
          if (!r.ok) return json({ error: "not found" }, 404);
          let body = await r.json();
          if (mode === "bus" && route) {
            const hit = body[route] || body[Object.keys(body).find((k) => k.toUpperCase() === route) || ""];
            if (!hit) return json({ error: "no such route", route }, 404);
            body = hit;
          }
          return new Response(JSON.stringify(body), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=86400", "access-control-allow-origin": "*" } });
        }
        case "/api/places": {
          // Stops, addresses, streets, landmarks and suburbs for the Plan search box (the app falls back to /api/search on a 404).
          const q = (p.get("q") || "").trim().slice(0, 80);
          if (q.length < 2) return json({ items: [] });
          return json({ items: placesFrom(await findLocations(env, q)) });
        }
        case "/api/search": {
          const q = (p.get("q") || "").trim();
          if (q.length < 2) return json({ items: [] });
          // Our own stop index first; the Trip Planner only when the index has no clear answer, and its extras
          // after the index's stops. If the Trip Planner fails, the index's answer stands.
          const idx = await stopIndex(env, url.origin).catch(() => null);
          const own = idx ? indexSearch(idx, q, 8) : { items: [], clear: false };
          if (own.clear) return json({ items: own.items, source: "index" });
          let stops = [];
          try { stops = (await findStops(env, q)).stops; } catch (e) { if (own.items.length) return json({ items: own.items, source: "index" }); throw e; }
          const items = own.items.slice();
          for (const s of stops) {
            if (items.length >= 8) break;
            const name = shortName(s.name);
            if (items.some((x) => x.id === String(s.id) || idxBase(askNorm(x.name)) === idxBase(askNorm(name)))) continue;
            items.push({ id: s.id, name, modes: s.modes });
          }
          return json({ items });
        }
        case "/api/nearby": {
          const d = { kind: "nearby", stops: await nearby(env, p.get("lat"), p.get("lon")) };
          return asTxt ? textRes(await asText(env, d)) : json(d);
        }
        case "/api/alerts": {
          const d = { kind: "alerts", ...(await alerts(env, p.get("q") || "")) };
          return asTxt ? textRes(await asText(env, d)) : json(d);
        }
        case "/api/obs": {
          if (!(await ensureSchema(env).catch(() => false))) return json({ error: "storage not available" }, 503);
          const where = [], args = [];
          if (p.get("route")) { where.push(`route = ?${args.length + 1}`); args.push(p.get("route")); }
          if (p.get("stop")) { where.push(`stop_id = ?${args.length + 1}`); args.push(p.get("stop")); }
          if (p.get("day")) { where.push(`day = ?${args.length + 1}`); args.push(p.get("day")); }
          const lim = Math.max(1, Math.min(1000, Math.floor(Number(p.get("limit") || 200)) || 200));
          const r = await db(env).prepare(`SELECT * FROM obs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY last_seen DESC LIMIT ${lim}`).bind(...args).all();
          const c = await db(env).prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT trip_id) AS trips, MIN(first_seen) AS since FROM obs").first();
          return json({ total: c, items: r.results || [] });
        }
        case "/api/tick": {
          if (!keyOk(request, p, TICK_KEY) && !adminOk(request, p)) return json({ error: "forbidden" }, 403);
          const r = await runTick(env, { force: p.get("force") === "1" && adminOk(request, p), noSample: p.get("nosample") === "1" });
          return json(r);
        }
        case "/api/app/config":
          return await appConfigRoute(request, env, p, adminOk(request, p));
        case "/api/morning-check":
          return await morningRoute(request, env, url);
        case "/api/morning-check/preview":
          return await morningPreview(env, url);
        case "/api/last-home":
          return await lastHomeRoute(request, env, url);
        case "/api/reliability":
          return await reliabilityRoute(env, p);
        case "/api/usual":
          return await usualRoute(env, p);
        case "/api/trackwork":
          return await trackworkRoute(env, p);
        case "/api/lines":
          return await linesRoute(env, p);
        case "/api/push/key":
          return json({ publicKey: VAPID_PUBLIC });
        case "/api/push/subscribe": {
          if (request.method !== "POST") return json({ error: "method" }, 405);
          await ensureSchema3(env);
          const b = await request.json().catch(() => ({}));
          const device = cleanId(b.device), s = b.subscription || {};
          if (!device || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) return json({ error: "subscription needed" }, 400);
          if (!/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000) return json({ error: "bad endpoint" }, 400);
          const prof = profileId(b.profile || profile);
          await db(env).prepare(`INSERT INTO push_subs (endpoint, device, profile, p256dh, auth, ua, created, fails) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)
            ON CONFLICT (endpoint) DO UPDATE SET device = excluded.device, profile = excluded.profile, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, fails = 0`)
            .bind(s.endpoint, device, prof, String(s.keys.p256dh).slice(0, 200), String(s.keys.auth).slice(0, 100), String(request.headers.get("user-agent") || "").slice(0, 200), Date.now()).run();
          let test = null;
          if (b.welcome) test = await notify(env, { device }, { title: "Notifications are on", body: "Tap Watch on any service or trip and I'll buzz you when to leave, if it runs late, and if a connection is at risk.", url: "/#/", tag: "welcome" });
          return json({ ok: true, test });
        }
        case "/api/push/expo": {
          if (request.method !== "POST") return json({ error: "method" }, 405);
          await ensureSchema3(env);
          const b = await request.json().catch(() => ({}));
          const device = cleanId(b.device), token = String(b.token || "");
          if (!device || !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,}\]$/.test(token)) return json({ error: "device and Expo push token needed" }, 400);
          const prof = profileId(b.profile || profile);
          await db(env).prepare(`INSERT INTO expo_tokens (token, device, profile, platform, created, fails) VALUES (?1, ?2, ?3, ?4, ?5, 0)
            ON CONFLICT (token) DO UPDATE SET device = excluded.device, profile = excluded.profile, platform = excluded.platform, fails = 0`)
            .bind(token, device, prof, String(b.platform || "").slice(0, 20), Date.now()).run();
          let test = null;
          if (b.welcome) test = await notify(env, { device }, { title: "Notifications are on", body: "Swipe left on any service or tap Watch this trip and I'll tell you when to leave, if it runs late, and if a connection is at risk.", url: "/", tag: "welcome" });
          return json({ ok: true, test });
        }
        case "/api/push/expo/unregister": {
          await ensureSchema3(env);
          const b = await request.json().catch(() => ({}));
          if (b.token) await db(env).prepare("DELETE FROM expo_tokens WHERE token = ?1 AND device = ?2").bind(String(b.token), cleanId(b.device)).run();
          return json({ ok: true });
        }
        case "/api/live-activity":
        case "/api/live-activity/end":
        case "/api/live-activity/forget":
        case "/api/apns/device":
          return await liveActivityRoute(env, request, url.pathname);
        case "/api/admin/live-activity": {
          if (!adminOk(request)) return json({ error: "forbidden" }, 403);
          return await liveActivityAdmin(env, request, p);
        }
        case "/api/admin/file": {
          // Upload a release file (the Android APK) into R2. Admin key only.
          if (!adminOk(request, p)) return json({ error: "forbidden" }, 403);
          if (!env.FILES) return json({ error: "no file store bound" }, 500);
          const name = String(p.get("name") || "");
          if (!/^[A-Za-z0-9._-]+\.apk$/.test(name)) return json({ error: "bad name" }, 400);
          if (request.method === "PUT") {
            const o = await env.FILES.put(name, request.body, { httpMetadata: { contentType: "application/vnd.android.package-archive" }, customMetadata: { version: String(p.get("version") || ""), at: String(Date.now()) } });
            return json({ ok: true, name, size: o.size, etag: o.etag });
          }
          const h = await env.FILES.head(name);
          return json(h ? { name, size: h.size, uploaded: h.uploaded, meta: h.customMetadata } : { error: "not found" }, h ? 200 : 404);
        }
        case "/api/app": {
          // What the native app checks to offer an update.
          let apk = null;
          if (env.FILES) { const h = await env.FILES.head("transport.apk").catch(() => null); if (h) apk = { url: "https://" + url.host + "/download/transport.apk", size: h.size, version: (h.customMetadata || {}).version || null, uploaded: h.uploaded }; }
          return json({ android: apk, expoGo: "exp://u.expo.dev/cf1f4c4c-5157-41bf-a254-4480223f6368?channel-name=expo-go&runtime-version=exposdk%3A58.0.0", page: siteUrl(env) + "/" });
        }
        case "/api/push/unsubscribe": {
          await ensureSchema3(env);
          const b = await request.json().catch(() => ({}));
          if (b.endpoint) await db(env).prepare("DELETE FROM push_subs WHERE endpoint = ?1 AND device = ?2").bind(String(b.endpoint), cleanId(b.device)).run();
          return json({ ok: true });
        }
        case "/api/push/test": {
          await ensureSchema3(env);
          const b = request.method === "POST" ? await request.json().catch(() => ({})) : {};
          const device = cleanId(b.device || p.get("device"));
          if (!device) return json({ error: "device needed" }, 400);
          const subs = await d1all(env, "SELECT COUNT(*) AS n FROM push_subs WHERE device = ?1", device);
          const ex = await d1all(env, "SELECT COUNT(*) AS n FROM expo_tokens WHERE device = ?1", device);
          const r = await notify(env, { device }, { title: "Test from Transport", body: "This is how alerts will look. Leave now, delays, platform changes and connections come through here.", url: "/#/", tag: "test" });
          return json({ ok: true, subscriptions: subs[0] ? subs[0].n : 0, expoTokens: ex[0] ? ex[0].n : 0, ...r });
        }
        case "/api/watch": {
          await ensureSchema3(env);
          if (request.method === "POST") {
            const b = await request.json().catch(() => ({}));
            try { return json({ ok: true, watch: await createWatch(env, { ...b, profile: b.profile || profile }, Date.now()) }); }
            catch (e) { return json({ error: String(e && e.message || e) }, 400); }
          }
          if (request.method === "DELETE") {
            await db(env).prepare("UPDATE watches SET active = 0, ended = 'stopped' WHERE id = ?1 AND device = ?2").bind(cleanId(p.get("id")), cleanId(p.get("device"))).run();
            return json({ ok: true });
          }
          const w = await db(env).prepare("SELECT * FROM watches WHERE id = ?1").bind(cleanId(p.get("id"))).first();
          if (!w) return json({ error: "not found" }, 404);
          return json({ watch: watchOut(w), notes: await d1all(env, "SELECT id, at, title, body FROM notes WHERE watch_id = ?1 ORDER BY id DESC LIMIT 20", w.id), now: Date.now() });
        }
        case "/api/watches": {
          await ensureSchema3(env);
          const device = cleanId(p.get("device"));
          if (!device) return json({ items: [], notes: [] });
          // If the minute scheduler has been quiet, an open app keeps its own watches moving.
          const lt = await db(env).prepare("SELECT v FROM meta WHERE k = 'last_tick'").first().catch(() => null);
          let ticked = null;
          if (!lt || Date.now() - Number(lt.v) > 100000) {
            const active = await d1all(env, "SELECT COUNT(*) AS n FROM watches WHERE active = 1 AND device = ?1", device);
            if (active[0] && active[0].n > 0 && exec) {
              const lease = await tickLease(env, Date.now()).catch(() => false);
              if (lease) { ticked = true; exec.waitUntil(runTick(env, { device, force: true }).catch(() => null)); }
            }
          }
          const since = Number(p.get("since") || 0);
          const items = (await d1all(env, "SELECT * FROM watches WHERE device = ?1 AND (active = 1 OR updated > ?2) ORDER BY created DESC LIMIT 12", device, Date.now() - 20 * 60000)).map(watchOut);
          const notes = await d1all(env, "SELECT id, watch_id, at, title, body, url, pushed FROM notes WHERE (device = ?1 OR (?3 <> '' AND profile = ?3)) AND id > ?2 AND at > ?4 ORDER BY id DESC LIMIT 5", device, since, profile, Date.now() - 30 * 60000);
          const subs = await d1all(env, "SELECT COUNT(*) AS n FROM push_subs WHERE device = ?1", device);
          const exs = await d1all(env, "SELECT COUNT(*) AS n FROM expo_tokens WHERE device = ?1", device).catch(() => [{ n: 0 }]);
          return json({ items, notes, push: subs[0] ? subs[0].n : 0, expo: exs[0] ? exs[0].n : 0, lastTick: lt ? Number(lt.v) : null, ticked, now: Date.now() });
        }
        case "/api/commutes": {
          if (!profile) return request.method === "GET" ? json({ items: [], suggestion: null, now: Date.now() }) : json({ error: "profile needed" }, 400);
          await ensureSchema3(env);
          if (request.method === "POST") {
            const b = await request.json().catch(() => ({}));
            const tod = Math.max(0, Math.min(1439, Math.round(Number(b.tod))));
            const days = String(b.days || "12345").replace(/[^1-7]/g, "").slice(0, 7) || "12345";
            if (b.id) {
              const c = await db(env).prepare("SELECT * FROM commutes WHERE id = ?1 AND profile = ?2").bind(cleanId(b.id), profile).first();
              if (!c) return json({ error: "not found" }, 404);
              await db(env).prepare("UPDATE commutes SET name = ?2, tod = ?3, days = ?4, active = ?5, state = '{}' WHERE id = ?1")
                .bind(c.id, String(b.name || c.name).slice(0, 40), Number.isFinite(Number(b.tod)) ? tod : c.tod, b.days != null ? days : c.days, b.active == null ? c.active : (b.active ? 1 : 0)).run();
              return json({ ok: true, item: commuteOut(await db(env).prepare("SELECT * FROM commutes WHERE id = ?1").bind(c.id).first()) });
            }
            const from = b.from || {}, to = b.to || {};
            if (!from.id || !to.id || !Number.isFinite(Number(b.tod))) return json({ error: "from, to and tod needed" }, 400);
            const id = rid(6);
            await db(env).prepare("INSERT INTO commutes (id, profile, name, from_id, from_name, to_id, to_name, tod, days, active, created, state) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, '{}')")
              .bind(id, profile, String(b.name || commuteName(tod)).slice(0, 40), String(from.id).slice(0, 80), String(from.name || "").slice(0, 80), String(to.id).slice(0, 80), String(to.name || "").slice(0, 80), tod, days, Date.now()).run();
            return json({ ok: true, item: commuteOut(await db(env).prepare("SELECT * FROM commutes WHERE id = ?1").bind(id).first()) });
          }
          if (request.method === "DELETE") {
            await db(env).prepare("DELETE FROM commutes WHERE id = ?1 AND profile = ?2").bind(cleanId(p.get("id")), profile).run();
            return json({ ok: true });
          }
          const items = (await d1all(env, "SELECT * FROM commutes WHERE profile = ?1 ORDER BY tod", profile)).map(commuteOut);
          return json({ items, suggestion: await commuteSuggestion(env, profile).catch(() => null), now: Date.now() });
        }
        case "/api/commutes/dismiss": {
          await ensureSchema3(env);
          const b = await request.json().catch(() => ({}));
          if (b.key && profile) await db(env).prepare("INSERT OR REPLACE INTO dismissed (profile, k, at) VALUES (?1, ?2, ?3)").bind(profile, String(b.key).slice(0, 200), Date.now()).run();
          return json({ ok: true });
        }
        case "/api/history/delete": {
          // Deletes what the server stored for one profile. scope "history": trip searches and
          // dismissed commute suggestions (suggestions are worked out from the searches, so they go
          // too). scope "all": also saved trips, commutes, watches, alerts, push sign ups, live
          // trip shares, iPhone trip card tokens and the phone push token for this device. A valid profile id is required, and searches this
          // device made under any older profile id are deleted too.
          if (request.method !== "POST") return json({ error: "method" }, 405);
          await ensureSchema3(env);
          const b = await request.json().catch(() => ({}));
          const prof = profileId(b.profile);
          const dev = cleanId(b.device, 64);
          const scope = b.scope === "all" ? "all" : b.scope === "history" ? "history" : null;
          if (!prof) return json({ error: "profile needed" }, 400);
          if (!scope) return json({ error: "scope must be history or all" }, 400);
          const d = db(env);
          const n = {};
          const del = async (k, q, ...a) => { try { const r = await d.prepare(q).bind(...a).run(); n[k] = (n[k] || 0) + ((r && r.meta && r.meta.changes) || 0); } catch (e) { n[k] = n[k] || 0; } };
          await del("searches", "DELETE FROM searches WHERE profile = ?1", prof);
          await del("dismissed", "DELETE FROM dismissed WHERE profile = ?1", prof);
          // Searches this device made under any older profile id go too.
          if (dev) await del("searches", "DELETE FROM searches WHERE device = ?1", dev);
          if (scope === "all") {
            await del("saved", "DELETE FROM saved WHERE profile = ?1", prof);
            await del("saved", "DELETE FROM saved_legs WHERE profile = ?1", prof);
            await del("commutes", "DELETE FROM commutes WHERE profile = ?1", prof);
            await del("watches", "DELETE FROM watches WHERE profile = ?1", prof);
            await del("alerts", "DELETE FROM notes WHERE profile = ?1", prof);
            if (dev) {
              await del("watches", "DELETE FROM watches WHERE device = ?1", dev);
              await del("alerts", "DELETE FROM notes WHERE device = ?1", dev);
              await del("push", "DELETE FROM push_subs WHERE device = ?1", dev);
              await del("push", "DELETE FROM expo_tokens WHERE device = ?1", dev);
              await del("shares", "DELETE FROM shares WHERE device = ?1", dev);
              await del("morningCheckLog", "DELETE FROM morning_sent WHERE check_id IN (SELECT id FROM morning_checks WHERE device = ?1)", dev);
              await del("morningChecks", "DELETE FROM morning_checks WHERE device = ?1", dev);
              await del("tripAlerts", "DELETE FROM meta WHERE k = ?1", "ta:" + dev);
              if (await lastHomeSchema(env).catch(() => false)) await del("lastHome", "DELETE FROM last_home WHERE device = ?1", dev);
              if (await facSchema(env).catch(() => false)) {
                await del("alerts", "DELETE FROM lift_alerts WHERE device = ?1", dev);
                await del("watches", "DELETE FROM park_watches WHERE device = ?1", dev);
              }
              // iPhone trip card tokens and the phone push token (build 205 and later).
              const t = await forgetDeviceTokens(env, dev).catch(() => null);
              if (t) { n.liveActivities = t.liveActivities; n.push = (n.push || 0) + t.apnsDevices; }
            }
          }
          return json({ ok: true, scope, deleted: n });
        }
        case "/api/station":
        case "/api/parking":
        case "/api/parking/watch":
        case "/api/topup":
        case "/api/lifts":
        case "/api/lifts/alerts":
          return await facRoutes(request, env, url);
        case "/api/trip-alerts":
          // Saved trip alerts (src/tripalerts.js): this phone's trips, matched to service alerts by the minute tick.
          if (typeof tripAlertsRoute !== "function") return json({ error: "not found" }, 404);
          return await tripAlertsRoute(request, env, url);
        case "/api/predict": {
          if (p.get("planned") && !Number.isFinite(Date.parse(p.get("planned")))) return json({ error: "planned must be a date and time" }, 400);
          const it = { line: p.get("line"), stopId: p.get("stop"), planned: p.get("planned") || new Date().toISOString() };
          await predictions(env, [it]);
          return json({ prediction: it.pred || null });
        }
        case "/api/usage": {
          // Without the admin key only the count of recorded live times is shown (Settings).
          await ensureSchema3(env);
          const c = await db(env).prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT day) AS days FROM obs").first().catch(() => null);
          if (!adminOk(request)) return json({ observations: c ? { n: c.n } : null });
          const u = await usageToday(env);
          const lt = await db(env).prepare("SELECT v FROM meta WHERE k = 'last_tick'").first().catch(() => null);
          return json({ today: u, budget: DAILY_BUDGET, observations: c, lastTick: lt ? new Date(Number(lt.v)).toISOString() : null });
        }
        case "/api/admin/sim": {
          if (!adminOk(request, p)) return json({ error: "forbidden" }, 403);
          await ensureSchema3(env);
          const w = await db(env).prepare("SELECT * FROM watches WHERE id = ?1").bind(cleanId(p.get("id"))).first();
          if (!w) return json({ error: "not found" }, 404);
          const spec = JSON.parse(w.spec);
          spec.sim = { leg: Number(p.get("leg") || 0), delay: Number(p.get("delay") || 0), platform: p.get("platform") || null };
          await db(env).prepare("UPDATE watches SET spec = ?2 WHERE id = ?1").bind(w.id, JSON.stringify(spec)).run();
          const w2 = await db(env).prepare("SELECT * FROM watches WHERE id = ?1").bind(w.id).first();
          const r = await processWatch(env, w2, Date.now());
          return json({ ok: true, result: r, watch: watchOut(await db(env).prepare("SELECT * FROM watches WHERE id = ?1").bind(w.id).first()) });
        }
        case "/api/admin/commute": {
          if (!adminOk(request, p)) return json({ error: "forbidden" }, 403);
          await ensureSchema3(env);
          const c = await db(env).prepare("SELECT * FROM commutes WHERE id = ?1").bind(cleanId(p.get("id"))).first();
          if (!c) return json({ error: "not found" }, 404);
          if (p.get("reset") === "1") c.state = "{}";
          return json(await processCommute(env, c, Date.now(), sydneyNow(), { force: true, forceLeave: p.get("leave") === "1" }));
        }
        case "/api/admin/export": {
          if (!adminOk(request, p)) return json({ error: "forbidden" }, 403);
          if (request.method !== "GET") return json({ error: "GET only" }, 405);
          return await exportRoute(env, p);
        }
        case "/api/admin/profile-copy": {
          // Copies everything stored under one profile to a new private profile id (admin only).
          // Device bound rows (push subscriptions, Expo tokens, watches, notes) stay with their
          // device and follow when that device moves to the new profile.
          if (!adminOk(request, p)) return json({ error: "forbidden" }, 403);
          if (request.method !== "POST") return json({ error: "use POST" }, 405);
          const b = await request.json().catch(() => ({}));
          const from = cleanId(String(b.from || "").toLowerCase(), 40), to = cleanId(String(b.to || "").toLowerCase(), 40);
          if (!from || to.length < 20 || from === to) return json({ error: "from and a new id of 20 to 40 characters are needed" }, 400);
          await ensureSchema(env); await ensureSchema3(env);
          const d = db(env);
          const copied = {};
          for (const t of ["saved", "saved_legs", "commutes", "searches", "dismissed"]) {
            const rows = (await d.prepare(`SELECT * FROM ${t} WHERE profile = ?1 LIMIT 2000`).bind(from).all()).results || [];
            let n = 0;
            for (const row of rows) {
              const r = { ...row, profile: to };
              if (t === "commutes") r.id = "c" + [...crypto.getRandomValues(new Uint8Array(9))].map((x) => x.toString(16).padStart(2, "0")).join("");
              const cols = Object.keys(r);
              const res = await d.prepare(`INSERT OR IGNORE INTO ${t} (${cols.join(", ")}) VALUES (${cols.map((_, i) => "?" + (i + 1)).join(", ")})`).bind(...cols.map((c) => r[c])).run();
              n += (res.meta && res.meta.changes) || 0;
            }
            copied[t] = { found: rows.length, copied: n };
          }
          return json({ ok: true, from, to, copied });
        }
        case "/api/admin/searches": {
          if (!adminOk(request, p)) return json({ error: "forbidden" }, 403);
          await ensureSchema3(env);
          if (request.method === "POST") {
            const b = await request.json().catch(() => ({}));
            const d = db(env);
            for (const s of (b.items || []).slice(0, 20)) {
              await d.prepare("INSERT INTO searches (profile, device, day, dow, tod, from_id, from_name, to_id, to_name, src, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
                .bind(s.profile || profile, s.device || null, s.day, s.dow || 1, s.tod, s.from.id, s.from.name, s.to.id, s.to.name, s.src || "test", Date.now()).run();
            }
          }
          if (request.method === "DELETE") await db(env).prepare("DELETE FROM searches WHERE profile = ?1 AND src = 'test'").bind(profile).run();
          return json({ items: await d1all(env, "SELECT * FROM searches WHERE profile = ?1 ORDER BY at DESC LIMIT 50", profile) });
        }
        case "/api/health":
          if (!adminOk(request)) return json({ error: "forbidden" }, 403);
          return json({ ok: true, at: new Date().toISOString(), feeds: feedStats, cachedFeeds: [...feedMem.entries()].filter(([, v]) => v.buf).map(([k, v]) => ({ feed: k, ageS: Math.round((Date.now() - v.at) / 1000), trips: v.idx.size, bytes: v.buf.length })), storage: !!db(env), upstream: budgetStats() });
        default:
          return json({ error: "not found" }, 404);
      }
    } catch (e) {
      console.error("api error", url.pathname, String((e && e.message) || e).slice(0, 300));
      // A text board (?format=text) gets the same timetable board as the JSON one when the Trip Planner is down.
      const down = typeof ttUpstreamDown === "function" && ttUpstreamDown(e);
      if (asTxt && down && url.pathname === "/api/departures") {
        const fb = await engineOutage(request, env, exec, url).catch(() => null);
        if (fb) return fb;
      }
      // Never a bare status: the app shows "error" as it is (docs/API.md, errors). The upstream flag says the fault is
      // Transport for NSW's live data, not the phone's connection.
      const msg = e && e.tripsUnavailable ? "Live trips are unavailable right now because Transport for NSW isn't answering. Try again soon."
        : down ? "Live data from Transport for NSW isn't available right now. Try again soon."
        : "Something went wrong on our side. Try again in a moment.";
      return asTxt ? textRes(msg) : json({ kind: "error", text: msg, error: msg, upstream: !!down, unavailable: !!down }, down ? 503 : 502);
    }
}

// ---------- search from our own stop index ----------
// Stop search answers from the stop lists this server publishes (every train, metro, light rail and ferry stop, and
// every bus and coach stop in stations/bus-stops.json, built by build.mjs), with no Trip Planner call when the lists
// have a clear answer. The app runs the same matching on the phone (app/src/lib/localSearchCore.ts).
const IDX_CODE = { train: 1, metro: 2, lightrail: 4, ferry: 9 };
const IDX_RANK = { 1: 0, 2: 1, 4: 2, 9: 3, 7: 4, 5: 5 };
const IDX_SUFFIX = /\s+(railway station|train station|metro station|light rail station|light rail stop|light rail|ferry wharf|wharf|station|stn|interchange)$/;
const IDX_ABBR = { nth: "north", sth: "south", pt: "point", jn: "junction", jct: "junction", jnct: "junction", junc: "junction", hts: "heights", pk: "park", hosp: "hospital", bch: "beach", hbr: "harbour", sq: "square", uni: "university", ctr: "centre", center: "centre", stn: "station" };
const IDX_ALIAS = { "kings x": "kings cross", kx: "kings cross", cq: "circular quay", quay: "circular quay", "circ quay": "circular quay", parra: "parramatta", "bondi j": "bondi junction", bj: "bondi junction", chatty: "chatswood", newy: "newcastle", gong: "wollongong", "the gong": "wollongong", penno: "penrith", "macq uni": "macquarie university", "mq uni": "macquarie university" };
let stopIdxMem = null;
const idxBase = (k) => { let b = k; for (let i = 0; i < 2; i++) b = b.replace(IDX_SUFFIX, "").trim(); return b.replace(/^the\s+/, ""); };
async function stopIndex(env, origin) {
  if (stopIdxMem && Date.now() - stopIdxMem.at < 86400000) return stopIdxMem;
  const [bus, ...lists] = await Promise.all([askAsset(env, origin, "/stations/bus-stops.json"), ...Object.keys(IDX_CODE).map((m) => askAsset(env, origin, `/stations/${m}.json`))]);
  const byId = new Map(), stations = [], buses = [];
  Object.keys(IDX_CODE).forEach((m, i) => {
    for (const row of Array.isArray(lists[i]) ? lists[i] : []) {
      if (!Array.isArray(row) || !row[0] || !row[1]) continue;
      const id = String(row[0]), had = byId.get(id), code = IDX_CODE[m];
      if (had) { if (!had.modes.includes(code)) { had.modes.push(code); had.rank = Math.min(had.rank, IDX_RANK[code]); } continue; }
      const key = askNorm(row[1]);
      const s = { id, name: String(row[1]), modes: [code], key, base: idxBase(key), rank: IDX_RANK[code] };
      byId.set(id, s); stations.push(s);
    }
  });
  for (const row of Array.isArray(bus) ? bus : []) {
    if (!Array.isArray(row) || !row[0] || !row[1] || byId.has(String(row[0]))) continue;
    const key = askNorm(row[1]);
    const s = { id: String(row[0]), name: String(row[1]), modes: [5], key, base: idxBase(key), rank: 5 };
    byId.set(s.id, s); buses.push(s);
  }
  stopIdxMem = { at: Date.now(), stations, buses, byId };
  return stopIdxMem;
}
function idxKey(q) {
  let k = askNorm(q).replace(/:/g, " ").replace(/\s+/g, " ").trim();
  if (own(IDX_ALIAS, k)) return IDX_ALIAS[k];
  k = k.split(" ").map((w) => (own(IDX_ABBR, w) ? IDX_ABBR[w] : w)).join(" ");
  return own(IDX_ALIAS, k) ? IDX_ALIAS[k] : k;
}
function idxScore(s, k, words) {
  if (s.key === k || s.base === k) return 0;
  if (s.base.startsWith(k + " ") || s.key.startsWith(k + " ")) return 0.9 + (s.key.length - k.length) / 200;
  if (s.base.startsWith(k) || s.key.startsWith(k)) return 1 + (s.key.length - k.length) / 200;
  if (!s.key.includes(words[0].slice(0, 2))) return Infinity;
  const kw = s.key.split(" ");
  if (!words.every((w) => kw.some((t) => t.startsWith(w)))) return Infinity;
  return (kw[0].startsWith(words[0]) ? 2 : 2.5) + (s.key.length - k.length) / 200;
}
/** Stops from our own index, best first, and whether the answer is clear enough to skip the Trip Planner. */
function indexSearch(idx, q, max = 8) {
  const raw = String(q || "").trim();
  const out = [];
  if (/^\d{3,}$/.test(raw)) {
    for (const s of idx.stations.concat(idx.buses)) if (s.id.startsWith(raw)) out.push({ s, sc: s.id.length - raw.length });
  } else {
    const k = idxKey(raw);
    if (!k) return { items: [], clear: false };
    const words = k.split(" ").filter(Boolean);
    for (const s of idx.stations) { const sc = idxScore(s, k, words); if (Number.isFinite(sc)) out.push({ s, sc }); }
    let n = 0;
    for (const s of idx.buses) { const sc = idxScore(s, k, words); if (Number.isFinite(sc)) { out.push({ s, sc: sc + 0.3 }); if (++n > 400) break; } }
  }
  out.sort((a, b) => a.sc - b.sc || a.s.rank - b.s.rank || a.s.name.length - b.s.name.length);
  const others = out.filter((x) => x.s.rank < 5).length;
  const items = [];
  let buses = 0;
  for (const x of out) {
    if (items.length >= max) break;
    if (x.s.rank === 5) { if (others && buses >= Math.max(2, max - Math.min(others, max - 2))) continue; buses++; }
    items.push({ id: x.s.id, name: x.s.name, modes: x.s.modes.slice() });
  }
  // Clear: a stop number, or a station named (or started) by what was typed, or three or more stops at all.
  const clear = /^\d{5,}$/.test(raw) ? items.length > 0 : out.some((x) => x.sc < 2 && x.s.rank < 5) || out.length >= 3;
  return { items, clear };
}
// ---------- saved boards (stale while revalidate) and warming ----------
// A live board fetched for anyone is also saved in D1 (gzip, one row per stop and mode), so a first open of a stop
// with no edge copy gets the saved board at once with its real age (dataAt) while the fresh one is fetched; the app
// asks again a moment later and swaps the fresh times in. Live freshness is unchanged: the edge copy is still 15 s
// and every open still starts a fresh fetch. The minute tick keeps the busiest stops and every stop opened in the
// last 30 minutes saved, at most WARM_PER_TICK Trip Planner calls a minute, and none at night, when the key is busy
// or when the day's count passes WARM_DAY_CAP.
const SAVED_MAX_MS = 15 * 60000;
const SAVED_WAIT_MS = 0;
const SAVED_WRITE_GAP_MS = 20000;
const WARM_EVERY_MS = 6 * 60000;
const WARM_RECENT_MS = 30 * 60000;
const WARM_PER_TICK = 8;
const WARM_DAY_CAP = 40000;
// The busiest interchanges across the network (train, metro, light rail, ferry), by name in our own station lists.
const WARM_HUBS = ["Central Station", "Town Hall Station", "Wynyard Station", "Circular Quay", "Martin Place Station", "Museum Station", "St James Station", "Redfern Station", "Parramatta Station", "Strathfield Station", "Chatswood Station", "North Sydney Station", "Bondi Junction Station", "Kings Cross Station", "Hornsby Station", "Epping Station", "Burwood Station", "Hurstville Station", "Sutherland Station", "Wolli Creek Station", "Sydenham Station", "Liverpool Station", "Blacktown Station", "Penrith Station", "Lidcombe Station", "Granville Station", "Campbelltown Station", "Glenfield Station", "Macquarie University Station", "Macquarie Park Station", "Tallawong Station", "Rouse Hill Station", "Castle Hill Station", "Norwest Station", "Crows Nest Station", "Victoria Cross Station", "Barangaroo Station", "Gadigal Station", "Waterloo Station", "International Airport Station", "Domestic Airport Station", "Mascot Station", "Green Square Station", "Rhodes Station", "Olympic Park Station", "Wollongong Station", "Gosford Station", "Newcastle Interchange", "Manly Wharf", "Randwick Light Rail"];
const savedWrites = new Map();
let boardSchemaOk = false;
async function boardDb(env) {
  const d = db(env);
  if (!d) return null;
  if (!boardSchemaOk) {
    await d.batch([
      d.prepare("CREATE TABLE IF NOT EXISTS board_copies (k TEXT PRIMARY KEY, stop TEXT, at INTEGER, opened INTEGER, body TEXT)"),
      d.prepare("CREATE INDEX IF NOT EXISTS board_copies_opened ON board_copies (opened)"),
    ]);
    boardSchemaOk = true;
  }
  return d;
}
/** The saved board key for a live board request (now, one stop, optional mode); null for anything else. */
function boardKey(url) {
  if (url.pathname === "/api/trip") return tripCopyKey(url);
  if (url.pathname !== "/api/departures") return null;
  const p = url.searchParams;
  if (p.get("time") || p.get("date")) return null;
  const stop = p.get("stop") || "";
  const mode = p.get("mode") || "";
  if (!/^[A-Za-z0-9:_-]{3,24}$/.test(stop) || !/^[a-z]{0,12}$/.test(mode)) return null;
  return { k: stop + "|" + mode, stop };
}
// Trip copies (docs/DIAGNOSIS_LAG.md item 3, 26 Oct): the last live trip answer of a from and to pair is saved like a
// board (board_copies, key "trip:FROM>TO") and a first open gets it at once with its age while the fresh one loads.
// Only plain trips from now (no time, day, arrive by, step free, modes or long trips); never a timetable answer; never
// warmed by the minute tick; served only while at least 2 of its trips are still to leave.
function tripCopyKey(url) {
  const p = url.searchParams;
  for (const k of ["time", "date", "arriveBy", "acc", "modes", "long", "via", "page", "after", "before"]) if (p.get(k)) return null;
  const from = p.get("from") || "", to = p.get("to") || "";
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(from) || !/^[A-Za-z0-9_-]{3,20}$/.test(to) || from === to) return null;
  return { k: "trip:" + from + ">" + to, stop: "trip" };
}
function tripCopyOk(body) {
  try {
    const d = JSON.parse(body);
    if (!d || d.source === "timetable" || !Array.isArray(d.journeys)) return false;
    const cut = Date.now() - 60000;
    return d.journeys.filter((j) => Date.parse(j.board || j.leave || "") >= cut).length >= 2;
  } catch (e) { return false; }
}
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function gzipText(t) { return b64(new Uint8Array(await new Response(new Blob([t]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer())); }
async function gunzipText(s) { return await new Response(new Blob([unb64(s)]).stream().pipeThrough(new DecompressionStream("gzip"))).text(); }
async function boardSaved(env, bk) {
  const d = await boardDb(env).catch(() => null);
  if (!d || !bk) return null;
  const r = await d.prepare("SELECT at, body FROM board_copies WHERE k = ?1").bind(bk.k).first().catch(() => null);
  if (!r || !r.body || !(Date.now() - r.at <= SAVED_MAX_MS)) return null;
  const body = await gunzipText(r.body);
  if (bk.stop === "trip" && !tripCopyOk(body)) return null;
  return { at: Number(r.at), body };
}
async function boardSave(env, bk, body, opened) {
  const now = Date.now();
  const last = savedWrites.get(bk.k) || 0;
  if (now - last < SAVED_WRITE_GAP_MS && !opened) return;
  if (now - last < 5000) return;
  savedWrites.set(bk.k, now);
  if (savedWrites.size > 3000) savedWrites.delete(savedWrites.keys().next().value);
  const d = await boardDb(env).catch(() => null);
  if (!d) return;
  await d.prepare(`INSERT INTO board_copies (k, stop, at, opened, body) VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT (k) DO UPDATE SET at = ?3, body = ?5, opened = MAX(COALESCE(opened, 0), ?4)`)
    .bind(bk.k, bk.stop, now, opened ? now : 0, await gzipText(body)).run().catch(() => null);
}
async function warmHubIds(env) {
  const lists = await Promise.all(["train", "metro", "lightrail", "ferry"].map((m) => askAsset(env, null, `/stations/${m}.json`)));
  const byName = new Map();
  for (const l of lists) for (const row of Array.isArray(l) ? l : []) if (Array.isArray(row) && !byName.has(row[1])) byName.set(row[1], String(row[0]));
  return [...new Set(WARM_HUBS.map((n) => byName.get(n)).filter(Boolean))];
}
async function warmBoards(env, exec, use, sn) {
  if (use.calls >= WARM_DAY_CAP) return { skipped: "day count", calls: use.calls };
  if (sn.tod >= 60 && sn.tod < 270) return { skipped: "night" };
  if (upstreamBusy()) return { skipped: "busy" };
  const d = await boardDb(env).catch(() => null);
  if (!d) return { skipped: "storage" };
  const now = Date.now();
  const rows = (await d.prepare("SELECT k, stop, at, opened FROM board_copies WHERE at > ?1 OR opened > ?2").bind(now - 3600000, now - WARM_RECENT_MS).all().catch(() => ({ results: [] }))).results || [];
  const at = new Map(rows.map((r) => [r.k, Number(r.at) || 0]));
  const recent = rows.filter((r) => Number(r.opened) > now - WARM_RECENT_MS && !String(r.k).startsWith("trip:")).map((r) => r.k);
  const hubs = (await warmHubIds(env)).map((id) => id + "|");
  const due = [...new Set([...hubs, ...recent])].filter((k) => now - (at.get(k) || 0) >= WARM_EVERY_MS).sort((a, b) => (at.get(a) || 0) - (at.get(b) || 0)).slice(0, WARM_PER_TICK);
  const host = (env && env.API_HOST) || "api.transportsydney.app";
  const cache = edgeCache();
  let ok = 0;
  for (let i = 0; i < due.length; i += 4) {
    const part = due.slice(i, i + 4).map(async (k) => {
      const [stop, mode] = k.split("|");
      const url = new URL(`https://${host}/api/departures`);
      url.searchParams.set("stop", stop);
      if (mode) url.searchParams.set("mode", mode);
      const key = edgeKey(url);
      if (inFlight.has(key.url)) return;
      const run = answerAndStore(new Request(url.toString()), env, exec, cache, key, { warm: true });
      inFlight.set(key.url, sharedJob(run));
      run.then(() => inFlight.delete(key.url), () => inFlight.delete(key.url));
      const r = await run.catch(() => null);
      if (r && r.status === 200) ok++;
    });
    await Promise.all(part);
    if (upstreamBusy()) break;
  }
  return { due: due.length, warmed: ok, hubs: hubs.length, recent: recent.length };
}

// ---------- edge cache, shared limits and input checks ----------
// Shared live answers are cached at the edge, keyed on the query without the profile and device, so many phones
// looking at the same board cost one upstream call. A plain open takes a copy up to 15 s old, a refresh up to 5 s;
// copies are kept 120 s for a busy or failed upstream (see the upstream budget and fetch below).
const EDGE_CACHE_RE = /^\/api\/(departures|trip|plan|service|status|alerts|stations|search|places|nearby|station|parking|topup|lifts)$/;
const EDGE_CACHE_S = 15;
// Stop and place search and the station lists change only with the timetable: copies are kept and taken for 6 hours,
// keyed on the query in lower case with single spaces ("Kings  Cross" and "kings cross" are one copy).
const LONG_CACHE_RE = /^\/api\/(search|places|stations)$/;
const LONG_CACHE_S = 6 * 3600;
// A refresh (refresh=1: the app's own polls and pull to refresh) takes a shared answer only while it is at most this
// old, so a realtime change reaches a polling phone within seconds instead of up to 30 (edge copy plus the departures
// copy below). Everyone at the same stop in a data centre still shares one Trip Planner call per 5 s. Measured
// 26 Oct 2026, 9:31am: the departures lag behind the Trip Planner was 5 to 16 s median, 24 s worst, with 15 s.
const REFRESH_MAX_AGE_MS = 5000;
const EDGE_SKIP = new Set(["profile", "device", "refresh", "_"]);
function edgeKey(url) {
  const u = new URL(url.origin + url.pathname);
  const long = LONG_CACHE_RE.test(url.pathname);
  for (const k of [...new Set(url.searchParams.keys())].filter((k) => !EDGE_SKIP.has(k)).sort()) {
    const v = url.searchParams.get(k);
    u.searchParams.append(k, long && k === "q" ? String(v).toLowerCase().replace(/\s+/g, " ").trim() : v);
  }
  return new Request(u.toString(), { method: "GET" });
}
// The Cache API is not available on every host (it does nothing on some), so each copy of the
// worker also keeps the same answers in memory for 15 seconds.
const memCacheMap = new Map();
const memCache = {
  async match(req) {
    const e = memCacheMap.get(req.url);
    if (!e || Date.now() - e.at > (e.keepS || EDGE_KEEP_S) * 1000) { if (e) memCacheMap.delete(req.url); return undefined; }
    return new Response(e.body, { status: e.status, headers: e.headers });
  },
  async put(req, res) {
    const body = await res.arrayBuffer();
    if (body.byteLength > 512 * 1024) return;
    const keepS = Number((/max-age=(\d+)/.exec(res.headers.get("cache-control") || "") || [])[1]) || EDGE_KEEP_S;
    memCacheMap.set(req.url, { at: Date.now(), keepS, body, status: res.status, headers: [...res.headers] });
    if (memCacheMap.size > 300) memCacheMap.delete(memCacheMap.keys().next().value);
  },
};
const layeredCache = (edge) => ({
  async match(req) { return (await memCache.match(req)) || (edge ? await edge.match(req).catch(() => undefined) : undefined); },
  async put(req, res) { const c = res.clone(); await memCache.put(req, res); if (edge) await edge.put(req, c).catch(() => null); },
});
function edgeCache() { let edge = null; try { edge = typeof caches !== "undefined" && caches.default ? caches.default : null; } catch (e) { edge = null; } return layeredCache(edge); }

// Checks every query before any upstream call: place and stop ids, question length, counts.
const PLACE_KEYS = ["from", "to", "stop", "via", "destId", "id"];
function badInput(p) {
  const q = p.get("q");
  if (q != null && q.length > 300) return "Keep it under 300 characters.";
  for (const k of PLACE_KEYS) {
    const v = p.get(k);
    if (v == null || v === "") continue;
    if (v.length > 200 || /[<>"`{}\\\u0000-\u001f]/.test(v)) return `${k} is not a stop or place id`;
  }
  for (const k of ["fromName", "toName", "name"]) { const v = p.get(k); if (v != null && (v.length > 120 || /[<>`{}\u0000-\u001f]/.test(v))) return `${k} is not valid`; }
  const c = p.get("count");
  if (c != null && c !== "" && !(/^\d{1,2}$/.test(c) && Number(c) >= 1 && Number(c) <= 8)) return "count must be 1 to 8";
  const t = p.get("time");
  if (t != null && t !== "" && !/^([01]\d|2[0-3])[0-5]\d$/.test(t)) return "time must be HHMM";
  // Trip pages (page=1): the cursors are times in ms. Other routes use after= for their own paging (rowids).
  if (p.get("page") === "1") for (const k of ["after", "before", "arr"]) { const v = p.get(k); if (v != null && v !== "" && !/^\d{13}$/.test(v)) return `${k} must be a time in ms`; }
  const legs = p.get("legs");
  if (legs != null && legs.length > 4000) return "legs is too long";
  for (const k of ["lat", "lon"]) { const v = p.get(k); if (v != null && v !== "" && !/^-?\d{1,3}(\.\d{1,8})?$/.test(v)) return `${k} must be a number`; }
  return null;
}

// Per address limits shared by every copy of the worker, kept in D1 per minute. They cover
// writes and the routes that spend the Transport for NSW quota (an edge cache hit spends
// nothing, so it is not counted). If D1 does not answer, the per copy limits above still apply.
const IP_LIMITS = [
  [/^\/api\/(ask|trip|plan|departures|service|status|next|search|nearby|alerts|station|parking|topup|lifts)$/, "up", 120, "GET"],
  [/^\/api\/(saved|commutes|commutes\/dismiss|watch|push\/subscribe|push\/expo|push\/expo\/unregister|push\/unsubscribe|push\/test|share|share\/update|history\/delete|live-activity\/forget|lifts\/alerts|parking\/watch|feedback)$/, "w", 60, null],
];
let ipSchemaOk = false;
async function ipLimitOk(env, request, pathname) {
  const rule = IP_LIMITS.find((r) => r[0].test(pathname) && (r[3] ? request.method === r[3] : request.method !== "GET"));
  const d = db(env);
  if (!rule || !d) return true;
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "?";
  const win = Math.floor(Date.now() / 60000);
  try {
    if (!ipSchemaOk) { await d.prepare("CREATE TABLE IF NOT EXISTS ip_rate (k TEXT PRIMARY KEY, win INTEGER, n INTEGER)").run(); ipSchemaOk = true; }
    const r = await d.prepare("INSERT INTO ip_rate (k, win, n) VALUES (?1, ?2, 1) ON CONFLICT (k) DO UPDATE SET n = CASE WHEN win = ?2 THEN n + 1 ELSE 1 END, win = ?2 RETURNING n").bind(rule[1] + "|" + ip.slice(0, 64), win).first();
    return !r || !(Number(r.n) > rule[2]);
  } catch (e) { return true; }
}

export default {
  // Cloudflare Cron Trigger (wrangler.toml): the minute tick, the same work as GET /api/tick.
  async scheduled(event, env, exec) {
    applyEnv(env);
    const run = runTick(env, { exec }).catch(() => null);
    if (exec && exec.waitUntil) exec.waitUntil(run); else await run;
  },
  fetch(request, env, exec) { return reqLogged(request, env, exec, edgeFetch); },
};
// The worker's answer to every request (the copy layer, then handleRequest); reqLogged times it.
async function edgeFetch(request, env, exec) {
    applyEnv(env);
    const url = new URL(request.url);
    // The server switches and the budget guard's hold (once a minute per copy of the Worker): budgetHeld reads them.
    if (url.pathname.startsWith("/api/")) await serverConfig(env).catch(() => null);
    // Live board pushes (ENGINE_PUSH on): a WebSocket to the board's shard, which sends a diff each time it rebuilds it.
    if (url.pathname === "/api/live" && typeof engineSocket === "function") {
      if (!rateOk(request, url.pathname)) return json({ error: "Too many requests. Wait a minute and try again." }, 429);
      // Boards on the Trip Planner path (LIVE_PUSH on, src/livehub.js): the stop's LiveHub.
      if (typeof liveHubWanted === "function" && liveHubWanted(env, url)) return liveHubSocket(request, env, url);
      return engineSocket(request, env, url);
    }
    // Engine boards skip the copy layer below: the engine makes each board every 10 s and keeps its own 4 s copies.
    if (request.method === "GET" && url.pathname === "/api/departures" && !url.searchParams.get("time") && !url.searchParams.get("date") && typeof engineWanted === "function" && env.ENGINE && engineWanted(env, url)) return handleRequest(request, env, exec);
    const cache = request.method === "GET" && EDGE_CACHE_RE.test(url.pathname) && !badInput(url.searchParams) ? edgeCache() : null;
    if (!cache) return handleRequest(request, env, exec);
    const key = edgeKey(url);
    const refresh = url.searchParams.get("refresh") === "1";
    const hit = await cache.match(key).catch(() => null);
    // When the copy was made (x-stored-at). Copies are kept EDGE_KEEP_S, but a plain open takes one only up to
    // EDGE_CACHE_S old and a refresh only up to REFRESH_MAX_AGE_MS; older ones are for a busy or failed upstream.
    const storedAt = hit ? Number(hit.headers.get("x-stored-at")) || 0 : 0;
    const age = storedAt ? Date.now() - storedAt : Infinity;
    const long = LONG_CACHE_RE.test(url.pathname);
    const fresh = !!hit && (storedAt ? age <= (refresh ? REFRESH_MAX_AGE_MS : long ? LONG_CACHE_S * 1000 : EDGE_CACHE_S * 1000) : !refresh);
    const usable = !!hit && !!storedAt && age <= STALE_MAX_MS;
    if (fresh || (usable && !inFlight.has(key.url) && upstreamBusy(loadOk(request, env)))) {
      if (!rateOk(request, url.pathname) && !loadOk(request, env)) return json({ error: "Too many requests. Wait a minute and try again." }, 429);
      if (!fresh) budget.staleServed++;
      cachedTripLog(env, url, request, exec);
      return fromCopy(hit, storedAt, fresh ? "hit" : "stale");
    }
    // One upstream answer per key at a time in this copy of the worker: a burst of phones asking for the same stop
    // while it is being fetched all wait for that one answer (shared), not one call each.
    // The burst waits on its own timers for the first request's answer (sharedJob, joinJob): a request may not await
    // another request's promise in Workers.
    let job = inFlight.get(key.url), leader = false;
    if (!job) {
      leader = true;
      const run = answerAndStore(request, env, exec, cache, key);
      job = sharedJob(run);
      inFlight.set(key.url, job);
      if (inFlight.size > 2000) inFlight.delete(inFlight.keys().next().value);
      run.then(() => inFlight.delete(key.url), () => inFlight.delete(key.url));
    } else {
      if (!rateOk(request, url.pathname) && !loadOk(request, env)) return json({ error: "Too many requests. Wait a minute and try again." }, 429);
      budget.shared++;
    }
    const kept = !!hit && !!storedAt && age <= EDGE_KEEP_S * 1000;
    // No edge copy: a live board saved in the last SAVED_MAX_MS (any server copy, any location) stands in. A first
    // open gets the saved one at once (SAVED_WAIT_MS) with its real age while the fresh one
    // finishes and is stored; a refresh (the app's polls) takes the saved board only if the fresh one fails.
    const bk = kept ? null : boardKey(url);
    const saved = bk ? await boardSaved(env, bk).catch(() => null) : null;
    // With a copy in hand a phone waits at most COPY_WAIT_MS for the new answer: a slow Trip Planner answer keeps
    // going in the background and is stored for the next poll, and this phone gets the copy (dataAt says how old).
    let out = null;
    if (kept || (saved && !refresh)) {
      // Watch and widget requests (no profile, docs/DIAGNOSIS_LAG.md item 4) take a kept copy at once, no wait.
      const wait = kept ? (extInstant(url, request) ? 0 : COPY_WAIT_MS) : SAVED_WAIT_MS;
      if (leader) out = await Promise.race([job.promise, new Promise((r) => setTimeout(() => r(null), wait))]);
      else out = (await waitJob(job, wait)) ? await joinJob(job) : null;
      if (!out) {
        if (leader && exec && exec.waitUntil) exec.waitUntil(job.promise.catch(() => null));
        budget.staleServed++;
        return kept ? fromCopy(hit, storedAt, "stale") : fromSaved(saved);
      }
    } else out = leader ? await job.promise : await joinJob(job, SHARED_WAIT_MS);
    // Transport for NSW refused or failed (over its limit, down, slow): the last copy is better than an error.
    if (out.status >= 500 && kept) {
      budget.staleServed++;
      return fromCopy(hit, storedAt, "stale");
    }
    if (out.status >= 500 && saved) {
      budget.staleServed++;
      return fromSaved(saved);
    }
    // No copy and the Trip Planner refused or failed: the engine's timetable board, labelled (engineOutage).
    if (out.status >= 500 && url.pathname === "/api/departures") {
      const fb = await engineOutage(request, env, exec, url).catch(() => null);
      if (fb) return fb;
    }
    if (!leader) cachedTripLog(env, url, request, exec);
    const r = new Response(out.body, { status: out.status, headers: out.headers });
    if (out.status === 200) r.headers.set("x-edge-cache", leader ? "miss" : "shared");
    return r;
}

// Request numbers (docs/DIAGNOSIS_LAG.md item 10, 26 Oct, g17): one JSON line per /api request in the Worker's logs
// ([observability] in wrangler.toml, sampled there), so p50/p95 and error rates per endpoint can be read:
// {"t":"req","p":path,"m":method,"s":status,"ms":time to the answer,"up":ms spent on NSW calls,"un":NSW calls,
// "c":copy tag (hit, stale, miss, shared, saved, or -),"k":"app" (has a profile) or "ext" (watch, widget, web),
// "colo":data centre,"test":1 for load test traffic}. Only the path, never the query (stop ids, profile ids) or an
// address. REQ_LOG "off" stops it.
const reqStore = new AsyncLocalStorage();
function reqUpstream(ms) { const s = reqStore.getStore(); if (s) { s.up += ms; s.n++; } }
// Keeps work this request started alive after it has answered (the request's waitUntil), when there is a request.
function reqKeep(p) {
  try { const s = reqStore.getStore(); if (s && s.exec && typeof s.exec.waitUntil === "function") s.exec.waitUntil(Promise.resolve(p).catch(() => null)); } catch (e) { /* never in the way */ }
}
async function reqLogged(request, env, exec, inner) {
  const t0 = Date.now(), st = { up: 0, n: 0, exec };
  let res = null;
  try {
    res = await reqStore.run(st, () => inner(request, env, exec));
    return res;
  } finally {
    reqLog(request, env, res, Date.now() - t0, st);
  }
}
function reqLine(request, env, res, ms, st) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;
  const line = { t: "req", p: url.pathname, m: request.method, s: res ? res.status : 500, ms, up: st.up, un: st.n, c: (res && res.headers.get("x-edge-cache")) || "-",
    k: url.searchParams.get("profile") || request.headers.get("x-profile") ? "app" : "ext", colo: (request.cf && request.cf.colo) || null };
  if (loadOk(request, env)) line.test = 1;
  return line;
}
function reqLog(request, env, res, ms, st) {
  try {
    if (String((env && env.REQ_LOG) || "").toLowerCase() === "off") return;
    const line = reqLine(request, env, res, ms, st);
    if (line) console.log(JSON.stringify(line));
  } catch (e) { /* never in the way of an answer */ }
}
// A board or trip asked for by the watch or a widget (no profile, not a refresh): a kept copy is served at once and the
// fresh answer is stored behind it for the next ask. The phone app always sends its profile.
function extInstant(url, request) {
  if (url.pathname !== "/api/departures" && url.pathname !== "/api/trip") return false;
  const p = url.searchParams;
  return !p.get("profile") && !request.headers.get("x-profile") && p.get("refresh") !== "1";
}

// Copies are kept this long, for a busy, slow or failed upstream only (see STALE_MAX_MS, COPY_WAIT_MS and the 5xx
// fallback above).
const EDGE_KEEP_S = 120;
const COPY_WAIT_MS = 700;
const inFlight = new Map(); // edge key -> sharedJob of { status, headers, body }
// A request that joins another one's answer (no copy to fall back on) waits at most this long for it: the Trip
// Planner call times out at 12 s and is asked again for up to about 5 s more.
const SHARED_WAIT_MS = 25000;
async function answerAndStore(request, env, exec, cache, key, opts = {}) {
  const res = await handleRequest(request, env, exec);
  const body = await res.text();
  const headers = [...res.headers];
  // A timetable stand in (no-store) is never kept as a copy, so the first live answer replaces it.
  if (res.status === 200 && res.headers.get("x-stand-in") !== "timetable") {
    const url = new URL(request.url);
    const copy = new Response(body, { status: 200, headers });
    copy.headers.set("cache-control", `public, max-age=${LONG_CACHE_RE.test(url.pathname) ? LONG_CACHE_S : EDGE_KEEP_S}`);
    // A live board is also saved for first opens anywhere (boardSave); a phone's own open marks the stop as opened.
    const bk = boardKey(url);
    if (bk && (bk.stop === "trip" ? tripCopyOk(body) : /"items":\[/.test(body))) {
      const save = boardSave(env, bk, body, !opts.warm).catch(() => null);
      if (exec && exec.waitUntil) exec.waitUntil(save); else await save;
    }
    copy.headers.set("x-stored-at", String(Date.now()));
    const put = cache.put(key, copy).catch(() => null);
    if (exec && exec.waitUntil) exec.waitUntil(put); else await put;
  }
  return { status: res.status, headers, body };
}
// A cached answer: "now" is the current time for the countdowns, and dataAt says when its times were read, so the
// app's "Updated" line is honest about a copy.
async function fromCopy(hit, storedAt, tag) {
  return copyResponse(await hit.text(), hit, storedAt, tag);
}
// A board saved in D1 (boardSaved): the same shape as an edge copy, dataAt when it was fetched, tagged "saved".
// Services that have already left (more than a minute ago) are taken out.
function fromSaved(saved) {
  let text = saved.body;
  try {
    const d = JSON.parse(text);
    if (d && Array.isArray(d.journeys)) {
      const cut = Date.now() - 60000;
      d.journeys = d.journeys.filter((j) => Date.parse((j && (j.board || j.leave)) || "") >= cut);
      text = JSON.stringify(d);
    }
    if (d && Array.isArray(d.items)) {
      const cut = Date.now() - 60000;
      d.items = d.items.filter((x) => { const t = Date.parse((x && (x.estimated || x.planned)) || ""); return !Number.isFinite(t) || t >= cut; });
      text = JSON.stringify(d);
    }
  } catch (e) { /* the saved text as it is */ }
  return copyResponse(text, new Response(null, { headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } }), saved.at, "saved");
}
function copyResponse(text, hit, storedAt, tag) {
  let body = text;
  if (/json/.test(hit.headers.get("content-type") || "")) {
    body = body.replace(/"now":\d{13}/g, '"now":' + Date.now());
    if (storedAt && /^\{\s*"/.test(body) && !/^\{"dataAt":/.test(body)) body = '{"dataAt":' + storedAt + "," + body.slice(1);
  }
  const r = new Response(body, hit);
  r.headers.set("cache-control", "no-store");
  r.headers.set("x-edge-cache", tag);
  return r;
}
// A trip from a copy (cached or shared) still counts toward commute memory.
function cachedTripLog(env, url, request, exec) {
  const p = url.searchParams, profile = profileId(request.headers.get("x-profile") || p.get("profile"));
  if (url.pathname === "/api/trip" && profile && p.get("refresh") !== "1" && /^\d{4,10}$/.test(p.get("from") || "") && /^\d{4,10}$/.test(p.get("to") || "") && !p.get("time")) {
    const s = { profile, device: cleanId(p.get("device")) || null, from: { id: p.get("from"), name: p.get("fromName") || p.get("from") }, to: { id: p.get("to"), name: p.get("toName") || p.get("to") }, src: "search" };
    if (exec && exec.waitUntil) exec.waitUntil(logSearch(env, s));
  }
}
// Load tests only: a request carrying the LOAD_TEST_KEY secret in x-load-key is not turned away by the per address
// limits (every simulated phone comes from one address), and is counted and handled like any other. With no
// secret set nothing matches.
// Outage fallback (root's decision, 26 Oct 1:58 PM, while the NSW key was over its limit): when the Trip Planner
// refuses or fails and no copy of the board is kept or saved, the board engine's board is served instead of an error,
// whatever ENGINE_BOARDS says. Every row is a timetable row (realtime false, status Scheduled) unless the engine's feed
// copy is under 60 s old, when a live row keeps its time and says liveSource "feed". The answer says source
// "timetable" and leads its alerts with "Live times unavailable, showing timetable times" (the stop screen shows the top
// alerts, so phones label it with no app update). Never stored as a copy, so the first planner answer replaces it.
async function engineOutage(request, env, exec, url) {
  const p = url.searchParams;
  if (typeof engineBoard !== "function" || !env.ENGINE || p.get("time") || p.get("date")) return null;
  const et = await engineBoard(env, exec, p.get("stop") || "", p.get("mode") || "");
  const eb = et ? JSON.parse(et) : null;
  if (!eb || !Array.isArray(eb.items)) return null;
  const feedAt = (eb.live && eb.live.feedAt) || 0;
  const liveOk = feedAt && Date.now() - feedAt <= ENGINE_STALE_MS;
  const items = eb.items.map((x) => {
    if (liveOk && x.realtime) return { ...x, liveSource: "feed" };
    return { ...x, estimated: null, realtime: false, delayMin: null, vehicle: null, occupancy: null, source: "timetable", status: { key: "scheduled", text: "Scheduled" } };
  });
  const note = { id: "timetable-fallback", title: "Live times unavailable, showing timetable times", url: null, priority: "high", lines: [] };
  const d = { ...eb, kind: "departures", items, alerts: [note, ...(eb.alerts || [])], source: "timetable", fallback: "planner-unavailable", dataAt: liveOk ? feedAt : Date.now(), now: Date.now() };
  delete d.live;
  if (!liveOk) d.live = { feedAt: null, liveCount: 0, total: items.length };
  budget.engineFallback = (budget.engineFallback || 0) + 1;
  const fmt = p.get("format") === "text";
  if (fmt) return textRes(await asText(env, d));
  const res = json(d);
  res.headers.set("cache-control", "no-store");
  return res;
}
// Budget mode (docs/COSTS.md): a load test key only works while LOAD_TESTS is "on" (off on production; a test there
// spends the month's included Durable Object requests in an hour) and the budget guard does not hold it.
function loadOk(request, env) { return !!env && flagOn(env, "LOAD_TESTS") && safeEq(request.headers.get("x-load-key"), env.LOAD_TEST_KEY); }
