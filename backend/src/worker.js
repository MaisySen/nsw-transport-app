// Transport Bot v2: a Cloudflare Worker that answers transport questions with live
// Transport for NSW data. It merges the Trip Planner API with the GTFS realtime feeds
// (trip updates and vehicle positions) so that every time shown is either truly live
// or clearly marked as scheduled. The API key stays on the server side.

const API = "https://api.transport.nsw.gov.au";
const TZ = "Australia/Sydney";
const API_KEY_PLACEHOLDER = "__TFNSW_API_KEY__";
const FEED_TTL_MS = 15000;
const FEED_WAIT_MS = 2500;
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
};

function feedKey(mode, line) {
  if (mode === "lightrail") {
    if (line === "L1") return "lr_iw";
    if (line === "L4") return "lr_par";
    if (/^NLR|newcastle/i.test(line || "")) return "lr_new";
    return "lr_cse";
  }
  return FEEDS[mode] ? mode : null;
}

function apiKey(env) {
  return (env && env.TFNSW_API_KEY) || API_KEY_PLACEHOLDER;
}

function sydneyParts(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-AU", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const hh = p.hour === "24" ? "00" : p.hour;
  return { date: `${p.year}${p.month}${p.day}`, time: `${hh}${p.minute}` };
}

async function tp(env, endpoint, params) {
  const qs = new URLSearchParams({
    outputFormat: "rapidJSON", coordOutputFormat: "EPSG:4326", version: "10.2.1.42", ...params,
  });
  upstream.calls++;
  const res = await fetch(API + "/v1/tp/" + endpoint + "?" + qs.toString(), {
    headers: { Authorization: "apikey " + apiKey(env) },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Transport data answered ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
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
  uint() { const v = this.varint(); return v.hi * 4294967296 + v.lo; }
  int32() { return this.varint().lo | 0; }
  int64() { const v = this.varint(); return v.hi & 0x80000000 ? -((~v.hi >>> 0) * 4294967296 + ((~v.lo >>> 0) + 1)) : v.hi * 4294967296 + v.lo; }
  float() { const dv = new DataView(this.b.buffer, this.b.byteOffset + this.p, 4); this.p += 4; return dv.getFloat32(0, true); }
  double() { const dv = new DataView(this.b.buffer, this.b.byteOffset + this.p, 8); this.p += 8; return dv.getFloat64(0, true); }
  bytes() { const n = this.uint(); const s = this.p; this.p += n; return [s, this.p]; }
  str() { const [s, e] = this.bytes(); return TD.decode(this.b.subarray(s, e)); }
  skip(wt) {
    if (wt === 0) this.varint();
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

function readTripDescriptor(pb) {
  const t = {};
  pb.each((f) => {
    if (f === 1) t.tripId = pb.str();
    else if (f === 2) t.startTime = pb.str();
    else if (f === 3) t.startDate = pb.str();
    else if (f === 4) t.rel = pb.uint();
    else if (f === 5) t.routeId = pb.str();
    else return false;
  });
  return t;
}
function readVehicleDescriptor(pb) {
  const v = {};
  pb.each((f) => {
    if (f === 1) v.id = pb.str();
    else if (f === 2) v.label = pb.str();
    else if (f === 3) v.plate = pb.str();
    else return false;
  });
  return v;
}
function readStopTimeEvent(pb) {
  const ev = {};
  pb.each((f) => {
    if (f === 1) ev.delay = pb.int32();
    else if (f === 2) ev.time = pb.int64();
    else return false;
  });
  return ev;
}
function readTripUpdate(pb) {
  const tu = { stus: [], ts: 0 };
  pb.each((f) => {
    if (f === 1) Object.assign(tu, readTripDescriptor(pb.sub()));
    else if (f === 2) {
      const s = pb.sub(); const u = {};
      s.each((g) => {
        if (g === 1) u.seq = s.uint();
        else if (g === 2) u.arr = readStopTimeEvent(s.sub());
        else if (g === 3) u.dep = readStopTimeEvent(s.sub());
        else if (g === 4) u.stopId = s.str();
        else if (g === 5) u.rel = s.uint();
        else return false;
      });
      tu.stus.push(u);
    }
    else if (f === 3) tu.vehicle = readVehicleDescriptor(pb.sub());
    else if (f === 4) tu.ts = pb.uint();
    else if (f === 5) tu.delay = pb.int32();
    else return false;
  });
  return tu;
}
function readVehiclePosition(pb) {
  const v = {};
  pb.each((f) => {
    if (f === 1) v.trip = readTripDescriptor(pb.sub());
    else if (f === 2) {
      const s = pb.sub();
      s.each((g, wt) => {
        if (g === 1 && wt === 5) v.lat = s.float();
        else if (g === 2 && wt === 5) v.lon = s.float();
        else if (g === 3 && wt === 5) v.bearing = s.float();
        else if (g === 5 && wt === 5) v.speed = s.float();
        else return false;
      });
    }
    else if (f === 3) v.stopSeq = pb.uint();
    else if (f === 4) v.status = pb.uint();
    else if (f === 5) v.ts = pb.uint();
    else if (f === 6) v.congestion = pb.uint();
    else if (f === 7) v.stopId = pb.str();
    else if (f === 8) v.vehicle = readVehicleDescriptor(pb.sub());
    else if (f === 9) v.occupancy = pb.uint();
    else return false;
  });
  return v;
}

// Quick pass: map trip_id -> [start, end] of the trip_update (field 3) or vehicle (field 4).
function indexFeed(buf, kind) {
  const want = kind === "tu" ? 3 : 4;
  const idx = new Map();
  let headerTs = 0;
  const top = new PB(buf);
  top.each((f) => {
    if (f === 1) {
      const h = top.sub();
      h.each((g) => { if (g === 3) { headerTs = h.uint(); return; } return false; });
      return;
    }
    if (f !== 2) return false;
    const ent = top.sub();
    ent.each((g) => {
      if (g !== want) return false;
      const [s, e] = ent.bytes();
      const inner = new PB(buf, s, e);
      let tripId = null;
      inner.each((h) => {
        if (h === 1 && tripId === null) {
          const td = inner.sub();
          td.each((k) => { if (k === 1) { tripId = td.str(); return; } return false; });
          return;
        }
        return false;
      });
      if (tripId) idx.set(tripId, [s, e]);
    });
  });
  return { idx, headerTs };
}

// ---------- shared feed cache ----------
// Each feed is fetched at most once per FEED_TTL_MS per worker instance, and the raw bytes
// are also put in a named edge cache so other instances in the same location can reuse them.

const feedMem = new Map(); // path -> { at, buf, idx, headerTs, promise }
const feedStats = { fetched: 0, edgeHits: 0, memHits: 0, edgeMiss: 0, edgeErr: 0, edgePutErr: 0, requests: 0, isolate: Math.random().toString(36).slice(2, 8), born: Date.now() };

async function loadFeed(env, path, kind) {
  const now = Date.now();
  const hit = feedMem.get(path);
  if (hit && hit.buf && now - hit.at < FEED_TTL_MS) { feedStats.memHits++; return hit; }
  if (hit && hit.promise) return hit.promise;
  const promise = (async () => {
    let buf = null, at = now;
    const cacheKey = new Request("https://feed-cache.transport-bot.internal" + path);
    let cache = null;
    try { cache = await caches.open("feeds"); } catch (e) { cache = null; }
    if (cache) {
      try {
        const c = await cache.match(cacheKey);
        if (c) {
          const t = Number(c.headers.get("x-fetched-at") || 0);
          if (now - t < FEED_TTL_MS) { buf = new Uint8Array(await c.arrayBuffer()); at = t; feedStats.edgeHits++; }
        } else feedStats.edgeMiss++;
      } catch (e) { feedStats.edgeErr++; feedStats.lastErr = String(e && e.message || e).slice(0, 120); }
    }
    if (!buf) {
      upstream.calls++;
      const res = await fetch(API + path, { headers: { Authorization: "apikey " + apiKey(env) } });
      if (!res.ok) throw new Error(`Realtime feed ${path} answered ${res.status}`);
      buf = new Uint8Array(await res.arrayBuffer());
      at = Date.now();
      feedStats.fetched++;
      if (cache) {
        try {
          await cache.put(cacheKey, new Response(buf, { headers: { "cache-control": "max-age=15", "x-fetched-at": String(at) } }));
        } catch (e) { feedStats.edgePutErr++; feedStats.lastErr = String(e && e.message || e).slice(0, 120); }
      }
    }
    const { idx, headerTs } = indexFeed(buf, kind);
    const entry = { at, buf, idx, headerTs, kind, cache: new Map() };
    feedMem.set(path, entry);
    return entry;
  })();
  feedMem.set(path, { ...(hit || {}), promise });
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
  for (const [mode, line] of pairs) { const k = feedKey(mode, line); if (k) keys.add(k); }
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
  return {
    feeds: out,
    tu(mode, line, tripId) { const k = feedKey(mode, line); return tripId && out[k] ? decodeFrom(out[k].tu, tripId) : null; },
    vp(mode, line, tripId) { const k = feedKey(mode, line); return tripId && out[k] ? decodeFrom(out[k].vp, tripId) : null; },
    fetchedAt() { let m = 0; for (const k in out) { if (out[k].tu) m = Math.max(m, out[k].tu.at); if (out[k].vp) m = Math.max(m, out[k].vp.at); } return m || null; },
  };
}

// ---------- static stop names and coordinates ----------
// Shards built from the TfNSW GTFS static stops.txt, served as assets under /stops/.

const shardMem = new Map();
async function loadShard(env, key) {
  if (shardMem.has(key)) return shardMem.get(key);
  const p = (async () => {
    try {
      const r = await env.ASSETS.fetch(new Request("https://assets.local/stops/" + key + ".json"));
      if (!r.ok) return {};
      return await r.json();
    } catch (e) { return {}; }
  })();
  shardMem.set(key, p);
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
  const tu = rt.tu(item.mode, item.line, item.tripId);
  const vp = rt.vp(item.mode, item.line, item.tripId);
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
      if (mine >= 0 && nxt >= 0 && mine >= nxt) item.stopsAway = mine - nxt;
    }
  }
  return item;
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
  }));
  if (stopCache.size > 500) stopCache.clear();
  stopCache.set(k, { at: Date.now(), data: list });
  return list;
}
function isNswStop(l) { return !/South Australia|Victoria|Queensland|\bACT\b/.test(l.name); }
async function findStops(env, q) {
  const all = await findLocations(env, q);
  const stops = all.filter((l) => (l.type === "stop" || l.type === "platform") && isNswStop(l));
  stops.sort((a, b) => b.quality - a.quality);
  return { stops, all };
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
function shortName(n) {
  const s = String(n || "").replace(/,\s*(Sydney|NSW)$/i, "");
  const parts = s.split(", ");
  if (parts.length === 2 && parts[0].toLowerCase().startsWith(parts[1].toLowerCase())) return parts[0];
  return s;
}

// ---------- departures ----------

async function departures(env, stopId, opts = {}) {
  const { date, time } = sydneyParts();
  const data = await tp(env, "departure_mon", {
    mode: "direct", type_dm: "stop", name_dm: stopId,
    departureMonitorMacro: "true", TfNSWDM: "true", itdDate: date, itdTime: time,
    ...(opts.extra || {}),
  });
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
      if (!alerts.has(k)) alerts.set(k, { id: k, title: info.subtitle || info.title || "", url: httpsUrl(info.url), priority: info.priority || "", lines: new Set() });
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
    });
  }
  const rt = await realtimeFor(env, items.map((i) => [i.mode, i.line]));
  let filled = 0;
  for (const it of items) {
    const was = it.realtime;
    enrich(it, rt);
    if (!was && it.realtime) filled++;
    it.status = statusOf(it);
  }
  items = items.filter((i) => ms(i.estimated || i.planned) >= now - 45000);
  items.sort((a, b) => ms(a.estimated || a.planned) - ms(b.estimated || b.planned));
  const modes = [...new Set(items.map((i) => i.mode))];
  if (opts.mode) items = items.filter((i) => i.mode === opts.mode || (opts.mode === "bus" && i.mode === "coach"));
  const first = data.stopEvents && data.stopEvents[0] && data.stopEvents[0].location;
  const exactName = first && first.properties && first.properties.platformName ? first.properties.platformName : null;
  if (opts.log !== false) logObservations(env, opts.ctx, items, stopId);
  return {
    stop: { id: stopId, name: shortName(loc.disassembledName || loc.name || stopId), fullName: loc.name || "", exactName },
    items, modes,
    alerts: [...alerts.values()].map((a) => ({ ...a, lines: [...a.lines].filter(Boolean) })).slice(0, 10),
    live: { feedAt: rt.fetchedAt(), filledFromFeed: filled, liveCount: items.filter((i) => i.realtime).length, total: items.length },
    now,
  };
}

// ---------- trips ----------

function stopName(p) {
  const strip = (n) => String(n || "").replace(/,\s*(Platform|Stand|Wharf|Side)\s+\w+.*$/i, "").trim();
  // Some platforms carry only ", Platform 2" as their short name; fall back to the full name then.
  return (p && (strip(p.disassembledName) || strip(p.name) || strip(p.parent && p.parent.name))) || "";
}
function legKind(t) {
  const cls = t && t.product ? t.product.class : null;
  if (cls === 99 || cls === 100 || cls === 107) return "walk";
  return "transit";
}

async function trip(env, fromId, toId, opts = {}) {
  let { date, time } = sydneyParts();
  let tomorrow = false;
  if (opts.time) {
    const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2));
    if (toMin(opts.time) < toMin(time) - 30) { date = sydneyParts(new Date(Date.now() + 86400000)).date; tomorrow = true; }
    time = opts.time;
  }
  const data = await tp(env, "trip", {
    depArrMacro: opts.arriveBy ? "arr" : "dep", itdDate: date, itdTime: time,
    type_origin: opts.fromType || "any", name_origin: fromId,
    type_destination: opts.toType || "any", name_destination: toId,
    calcNumberOfTrips: String(opts.count || 5), TfNSWTR: "true",
    ...(opts.via ? { type_via: opts.viaType || "any", name_via: opts.via } : {}),
    // Step free trips only (Settings > Accessible trips): the Trip Planner's wheelchair option.
    ...(opts.accessible ? { wheelchair: "on" } : {}),
  });
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
        alerts: (lg.infos || []).map((i) => ({ title: i.subtitle || "", url: httpsUrl(i.url), priority: i.priority || "" })).filter((a) => a.title).slice(0, 3),
        path: (lg.coords || []).map((c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5]),
      };
    });
    if (legs.length) journeys.push(legs);
  }
  const transitLegs = journeys.flat().filter((l) => l.kind === "transit");
  const rt = await realtimeFor(env, transitLegs.map((l) => [l.mode, l.line]));
  const out = [];
  for (const legs of journeys) {
    for (const l of legs) {
      if (l.kind !== "transit") continue;
      enrich(l, rt);
      // Arrival from the feed when the planner has none.
      if (!l.arrEstimated) {
        const tu = rt.tu(l.mode, l.line, l.tripId);
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
function fareKm(l, family) {
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
    const fam = fareFamily(l.mode);
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

function distM(aLat, aLon, bLat, bLon) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLon = (bLon - aLon) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function baseName(n) { return String(n || "").split(",")[0].trim().toLowerCase(); }

async function service(env, q) {
  const mode = q.mode || "bus", line = q.line || "", tripId = q.trip || null;
  const rt = await realtimeFor(env, [[mode, line]]);
  const tu = tripId ? rt.tu(mode, line, tripId) : null;
  const veh = tripId ? vehicleOf(rt.vp(mode, line, tripId)) : null;
  const now = Date.now();
  let stops = [], path = [], source = "feed", dest = q.dest || "";
  const tuLive = !!(tu && tu.ts && tu.rel !== 3);

  if (tu && tu.stus.length >= 2 && hasTimes(tu)) {
    stops = tu.stus.map((u) => {
      const st = stuTime(u) || { t: null, delay: null };
      const live = tuLive && u.rel !== 2 && st.t != null;
      const planned = st.t != null ? st.t - (st.delay || 0) * 1000 : null;
      return { id: u.stopId, seq: u.seq, planned: iso(planned), estimated: live ? iso(st.t) : null, skipped: u.rel === 1 };
    });
  } else if (q.stop && q.destId && q.planned) {
    // Fall back to the trip planner for the stop list from your stop onwards.
    source = "planner";
    const p = sydneyParts(new Date(ms(q.planned) - 60000));
    try {
      const data = await tp(env, "trip", {
        depArrMacro: "dep", itdDate: p.date, itdTime: p.time, type_origin: "any", name_origin: q.stop,
        type_destination: "any", name_destination: q.destId, calcNumberOfTrips: "4", TfNSWTR: "true",
      });
      let leg = null;
      for (const j of data.journeys || []) {
        for (const lg of j.legs || []) {
          const t = lg.transportation || {};
          const id = t.properties && (t.properties.RealtimeTripId || t.properties.AVMSTripID);
          if ((tripId && id === tripId) || (!leg && (t.disassembledName || t.number) === line && Math.abs(ms(lg.origin && lg.origin.departureTimePlanned) - ms(q.planned)) < 90000)) { leg = lg; break; }
        }
        if (leg && (leg.transportation.properties || {}).RealtimeTripId === tripId) break;
      }
      if (leg) {
        stops = (leg.stopSequence || []).map((s) => ({
          id: s.id, name: shortName(s.disassembledName || s.name), lat: s.coord ? s.coord[0] : null, lon: s.coord ? s.coord[1] : null,
          planned: iso(s.departureTimePlanned || s.arrivalTimePlanned),
          estimated: leg.isRealtimeControlled ? iso(s.departureTimeEstimated || s.arrivalTimeEstimated) : null,
        }));
        path = (leg.coords || []).map((c) => [c[0], c[1]]);
        // Trains publish delays without clock times; apply them to the planned times.
        if (tu && tuLive) {
          for (const st of stops) {
            if (st.estimated) continue;
            const u = tu.stus.find((x) => x.stopId === st.id);
            const ev = u && u.rel !== 2 && ((u.dep && u.dep.delay != null) ? u.dep : u.arr);
            if (ev && ev.delay != null && st.planned) st.estimated = iso(ms(st.planned) + ev.delay * 1000);
          }
        }
        dest = dest || (leg.transportation.destination && leg.transportation.destination.name) || "";
      }
    } catch (e) { /* stop list unavailable */ }
  }

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

  // Where is the vehicle along the route?
  let nextIdx = -1;
  if (tu && tu.stus.length >= 2) {
    const ni = nextStopIndex(tu, veh, now);
    const id = ni >= 0 && tu.stus[ni] ? tu.stus[ni].stopId : null;
    if (id) nextIdx = stops.findIndex((s) => s.id === id);
  }
  if (nextIdx < 0 && stops.some((s) => s.estimated)) {
    nextIdx = stops.findIndex((s) => ms(s.estimated || s.planned) >= now - 20000);
    // Trust the clock, but if the vehicle is clearly elsewhere, use its position.
    if (veh && nextIdx >= 0) {
      const g = locateGeom(veh, stops);
      if (g >= 0 && Math.abs(g - nextIdx) > 2) nextIdx = g;
    }
  }
  if (nextIdx < 0 && veh) nextIdx = locateGeom(veh, stops);
  if (nextIdx < 0) nextIdx = Math.max(0, stops.findIndex((s) => ms(s.estimated || s.planned) >= now - 20000));
  stops.forEach((s, i) => { s.passed = i < nextIdx; });

  let mine = q.stop ? stops.findIndex((s) => s.id === q.stop) : -1;
  if (mine < 0 && q.stopName) mine = stops.findIndex((s) => baseName(s.name) === baseName(q.stopName));
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
    nextIndex: nextIdx, mineIndex: mine, alightIndex: alight, stopsAway,
    mine: mineStop ? { name: mineStop.name, planned: mineStop.planned, estimated: mineStop.estimated, passed: mineStop.passed } : null,
    stops: stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, planned: s.planned, estimated: s.estimated, passed: s.passed, mine: !!s.mine, alight: !!s.alight, skipped: !!s.skipped })),
    path, source, feedAt: rt.fetchedAt(), now,
  };
}

// ---------- nearby and alerts ----------

async function nearby(env, lat, lon) {
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
  const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
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
  const top = stops[0];
  const r = await departures(env, top.id, { mode, ctx: ctx.exec });
  const close = stops.slice(1, 4).filter((s) => s.quality >= top.quality - 10).map((s) => ({ id: s.id, name: shortName(s.name) }));
  return { kind: "departures", mode, ...r, alternatives: close };
}



// ---- ask v2 start
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
function askLegOut(l) {
  return {
    kind: l.kind, mode: l.mode || null, line: l.line || null, color: l.color || null, towards: l.towards || null,
    from: l.from || null, fromPlatform: l.fromPlatform || null, to: l.to || null, planned: l.planned || null,
    estimated: l.estimated || null, realtime: !!l.realtime, delayMin: l.delayMin || 0, cancelled: !!l.cancelled,
    durationMin: l.durationMin || null, link: l.kind === "transit" && l.tripId ? askSvc(l) : null,
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

async function askLast(env, fromQ, toQ, ctx, mode) {
  const [a, b] = await Promise.all([typeof fromQ === "object" ? fromQ : askResolve(env, fromQ, ctx), typeof toQ === "object" ? toQ : askResolve(env, toQ, ctx)]);
  const lastP = { prefix: `last ${mode === "lightrail" ? "light rail" : mode || "train"} ` };
  if (a && a.ambiguous) return askDidYouMean("from", a, { from: null, to: typeof toQ === "string" ? toQ : b && b.name }, lastP);
  if (b && b.ambiguous) return askDidYouMean("to", b, { from: typeof fromQ === "string" ? fromQ : a && (a.label || a.name), to: null }, lastP);
  if (!a || a.needLocation) return { kind: "needOrigin", to: b && !b.needLocation ? b : null, last: true, mode };
  if (!b || b.needLocation) return { kind: "text", text: `I couldn't find a station, suburb or stop called "${toQ}".` };
  const sn = sydneyNow();
  const base = { fromType: a.coord ? "coord" : undefined, count: 8, accessible: !!ctx.accessible };
  const late = sn.tod >= 23 * 60 || sn.tod < 3 * 60;
  if (b.coord) base.toType = "coord";
  const first = await trip(env, a.id, b.id, late ? base : { ...base, time: "2300" });
  const okMode = (j) => askTransit(j).length && (!mode || askTransit(j).every((l) => l.mode === mode || (mode === "train" && l.mode === "metro")));
  let all = (first.journeys || []).slice();
  const pickLast = (list) => {
    const s = list.filter(okMode).sort((x, y) => ms(x.leave) - ms(y.leave));
    const last = s[s.length - 1];
    if (!last) return null;
    const later = list.filter((j) => ms(j.leave) > ms(last.leave) && !okMode(j)).sort((x, y) => ms(x.leave) - ms(y.leave));
    const sure = list.some((j) => ms(j.leave) > ms(last.leave) + 60 * 60000);
    return { last, prev: s[s.length - 2] || null, next: later[0] || null, sure };
  };
  let found = pickLast(all);
  if ((!found || !found.sure) && all.length) {
    const lastLeave = new Date(Math.max(...all.map((j) => ms(j.leave))) + 60000);
    const p = sydneyParts(lastLeave);
    const more = await trip(env, a.id, b.id, { ...base, time: p.time });
    all = all.concat(more.journeys || []).filter((j, i, arr) => arr.findIndex((x) => x.leave === j.leave && x.arrive === j.arrive) === i);
    found = pickLast(all);
  }
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

async function askRoute(env, raw, ctx) {
  const text = askClean(raw);
  const lower = text.toLowerCase();
  if (!text) return { kind: "help" };
  if (/^(thanks|thank you|cheers|ta|thx)$/i.test(lower)) return { kind: "text", text: "No worries." };

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
          ? `Next: the ${tl.line} from ${tl.from || askShort(d.from.name)}${askPlat(tl.fromPlatform)} at ${hm(tl.estimated || tl.planned)}${ms(j.leave) < ms(tl.planned) - 60000 ? ` (leave ${askWhen(j.leave)})` : ` (${askWhen(tl.estimated || tl.planned)})`}, arriving ${d.to.name} ${hm(j.arrive)}${ch}. ${cap(askStatusWords(tl))}.`
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
      const role = d.role === "from" ? "start" : d.role === "via" ? "via stop" : "destination";
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
          (gone ? "" : `leave ${hm(l.leave)}, arrive ${hm(l.arrive)}` + (tl ? ` (${tl.line}${askPlat(tl.fromPlatform)})` : "") + ".") +
          (d.after ? ` After that: ${askTransit(d.after).filter((x) => x.mode === "bus").map((x) => x.line).join(" then ") || askTransit(d.after).map((x) => x.line).join(" then ")} ${askTransit(d.after).some((x) => x.mode === "bus") ? "bus " : ""}at ${hm(askTransit(d.after).filter((x) => x.mode === "bus")[0] ? askTransit(d.after).filter((x) => x.mode === "bus")[0].planned : d.after.leave)}.` : "");
      }
      const js = [d.before, d.last, d.after].filter(Boolean);
      if (js.length) cards.push({ type: "trip", title: `Last ${noun}`, from: d.from, to: d.to, highlight: d.before ? 1 : 0, journeys: js.map(askJourneyOut), link: /EPSG/.test(String(d.from.id)) ? null : askTripLink(d.from, d.to) });
      if (!/EPSG/.test(String(d.from.id))) links.push({ label: "Open trip", ...askTripLink(d.from, d.to) });
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
  catch (e) { d = { kind: "error", text: "I couldn't reach live data just now. Try again in a moment.", detail: String(e && e.message || e).slice(0, 200) }; }
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
// ---- ask v2 end

// ---------- plain text answers (WhatsApp, Telegram, SMS) ----------

function hm(t) {
  return new Date(t).toLocaleTimeString("en-AU", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();
}
function hms(t) {
  return new Date(t).toLocaleTimeString("en-AU", { timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit" }).replace(/\s/g, "").toLowerCase();
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
  const tu = rt.tu(it.mode, it.line, it.tripId);
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
      return "Hi, I'm Transport Bot. Send a stop number from the sign (like 213516), a station (like Strathfield), or a trip like Burwood to Central. Save a trip with: save Burwood to Central as home. Then just send home.";
    case "text": case "error":
      return d.text;
    case "needLocation":
      return "Send a station name or stop number instead (location only works in the web version).";
    case "savedList":
      return d.items.length ? "Saved trips:\n" + d.items.map((s) => `${s.name}: ${s.from.name} to ${s.to.name}`).join("\n") : "No saved trips yet. Try: save Burwood to Central as home";
    case "departures": {
      const title = d.byNumber && d.stop.exactName ? d.stop.exactName : d.stop.name;
      const items = d.items.slice(0, limit);
      const rt = await realtimeFor(env, items.filter((i) => i.vehicle).slice(0, 3).map((i) => [i.mode, i.line]));
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

// ---------- proactive layer (v3): Web Push, watched trips, commutes, predictions ----------
// A minute scheduler (GET /api/tick?key=...) follows every watched trip and commute
// through the shared feed cache and sends phone notifications with Web Push.

const VAPID_PUBLIC = "__VAPID_PUBLIC_KEY__";
const VAPID_PRIVATE = "__VAPID_PRIVATE_KEY__";
const VAPID_SUBJECT = "__VAPID_SUBJECT__";
const TICK_KEY = "__TICK_KEY__";
const ADMIN_KEY = "__ADMIN_KEY__";

// ---------- security helpers ----------
// Admin and scheduler keys are compared in constant time. The key can come from the
// x-admin-key header (preferred, kept out of logs and history) or the ?key= query (cron).
function safeEq(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || !b) return false;
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
  [/^\/api\/history\/delete$/, "delete", 10, 600000],
  [/^\/api\/hit$/, "hit", 120, 600000],
  [/^\/api\/share$/, "share", 20, 600000, "POST"],
  [/^\/api\/share\/update$/, "shareup", 240, 600000],
  [/^\/api\/share$/, "read", 600, 60000],
  [/^\/api\/(lifts\/alerts|parking\/watch)$/, "write", 60, 600000, "POST"],
  [/^\/api\/(ask|trip|plan|departures|service|status|next|search|nearby|alerts|predict|obs|stations|station|parking|topup|lifts)$/, "read", 600, 60000],
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

function sydneyNow(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const dow = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday] || 1;
  const h = p.hour === "24" ? 0 : Number(p.hour);
  return { day: `${p.year}${p.month}${p.day}`, dow, tod: h * 60 + Number(p.minute) };
}
function clock(t) {
  return new Date(t).toLocaleTimeString("en-AU", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();
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
  let res;
  try {
    res = await d.batch(pairs.map((it) => d.prepare(
      "SELECT route, stop_id, planned, est, delay_s, last_seen, day FROM obs WHERE route = ?1 AND stop_id = ?2 AND planned > ?3 AND planned < ?4 AND last_seen >= est - 600000 ORDER BY planned DESC LIMIT 600"
    ).bind(it.line, it.stopId, since, Date.now() - 60000)));
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
  const rt = await realtimeFor(env, legs.map((l) => [l.mode, l.line]));
  const out = legs.map((l, i) => {
    const it = { mode: l.mode, line: l.line, tripId: l.tripId, stopId: l.stopId, planned: l.planned, estimated: l.estimated || null, realtime: false };
    try { enrich(it, rt); } catch (e) { /* no feed */ }
    const tu = rt.tu(l.mode, l.line, l.tripId);
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
    const veh = vehicleOf(rt.vp(l.mode, l.line, l.tripId));
    return { i, dep, depLive, arr, arrLive, cancelled: !!it.cancelled, platform: l.fromPlatform || "", platformFrom: null, vehicle: veh ? { lat: veh.lat, lon: veh.lon } : null };
  });
  // Board leg: refine with the departure board (platform changes, cancellations).
  const bi = out.findIndex((o) => o.dep > now - 60000);
  if (bi >= 0 && out[bi].dep - now < 45 * 60000 && opts.board !== false) {
    const l = legs[bi];
    try {
      const b = await departures(env, l.stopId, { log: false });
      const m = b.items.find((x) => (l.tripId && x.tripId === l.tripId) || (x.line === l.line && Math.abs(ms(x.planned) - ms(l.planned)) < 90000));
      if (m) {
        if (m.realtime && m.estimated) {
          const shift = ms(m.estimated) - out[bi].dep;
          out[bi].dep = ms(m.estimated); out[bi].depLive = true;
          if (out[bi].arr && !out[bi].arrLive) { out[bi].arr += shift; out[bi].arrLive = true; }
        }
        if (m.platform) out[bi].platform = m.platform;
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
    if (spec.sim.platform) { s.platformFrom = s.platform || "the planned one"; s.platform = spec.sim.platform; }
  }
  for (const o of out) {
    const l = legs[o.i];
    o.delay = o.depLive ? Math.round((o.dep - ms(l.planned)) / 60000) : null;
    o.arrDelay = o.arrLive && l.arrPlanned ? Math.round((o.arr - ms(l.arrPlanned)) / 60000) : null;
  }
  return out;
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
  const r = await trip(env, fromId, toId, { time: t.time, count: 5 });
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
  flags: { ask: true, parkRide: true, opalMachines: true, liveTrip: true, shareTrip: true, weekdayReminder: true, nearby: true },
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
        await d.prepare("INSERT INTO app_config (platform, body, at) VALUES (?1, ?2, ?3) ON CONFLICT(platform) DO UPDATE SET body = ?2, at = ?3").bind(platform, JSON.stringify(body), Date.now()).run();
        over = body;
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
  if (bi >= 0 && !live[bi].cancelled) {
    const o = live[bi], l = legs[bi];
    const key = `${bi}:${o.platform}`;
    if (o.platform && (o.platformFrom || (st.lastPlatform && st.lastPlatformLeg === bi && st.lastPlatform !== o.platform)) && st.platformKey !== key) {
      const was = o.platformFrom || st.lastPlatform;
      await push(`Platform changed to ${o.platform.replace(/^Platform /, "")}`, `The ${clock(o.dep)} ${l.line} to ${l.towards || l.to} now leaves from ${o.platform}${was ? `, not ${was}` : ""}.`, { once: `plat:${key}` });
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
    if (now <= fin.arr + 10 * 60000) {
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
  };
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
  const r = await trip(env, c.from_id, c.to_id, { count: 5, time: dt < -10 ? hhmmOf(c.tod - 10) : null });
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
      const r = await departures(env, stop, { log: false });
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
  // Commutes
  if (!opts.device && use.calls < WATCH_BUDGET) {
    const days = String(sn.dow);
    for (const c of await d1all(env, "SELECT * FROM commutes WHERE active = 1")) {
      if (!String(c.days || "").includes(days)) continue;
      try { out.commutes.push(await processCommute(env, c, Date.now(), sn)); }
      catch (e) { out.commutes.push({ id: c.id, error: String(e && e.message || e).slice(0, 160) }); }
    }
  }
  // Lift outages on saved trip stations, car park nearly full watches
  if (!opts.device) out.facilities = await facTick(env, Date.now(), sn, opts).catch((e) => ({ error: String(e && e.message || e).slice(0, 160) }));
  // Background sampling for predictions
  if (!opts.device && !opts.noSample) out.sample = await sampleStops(env, sn, use.calls < SAMPLE_BUDGET);
  // Housekeeping once an hour
  if (!opts.device && sn.tod % 60 === 7) {
    await db(env).prepare("DELETE FROM notes WHERE at < ?1").bind(now - 3 * 86400000).run().catch(() => null);
    await db(env).prepare("UPDATE watches SET active = 0, ended = 'expired' WHERE active = 1 AND expires < ?1").bind(now).run().catch(() => null);
    // Retention promised in the privacy policy: trip searches 90 days, finished watches 30 days.
    await db(env).prepare("DELETE FROM searches WHERE at < ?1").bind(now - 90 * 86400000).run().catch(() => null);
    await db(env).prepare("DELETE FROM ip_rate WHERE win < ?1").bind(Math.floor(now / 60000) - 5).run().catch(() => null);
    await db(env).prepare("DELETE FROM watches WHERE active = 0 AND updated < ?1").bind(now - 30 * 86400000).run().catch(() => null);
    // Shared live trips: deleted, positions included, once the trip is over.
    await db(env).prepare("DELETE FROM shares WHERE expires < ?1").bind(now).run().catch(() => null);
    // Contact form messages: deleted within 12 months, as the privacy policy says.
    await db(env).prepare("DELETE FROM feedback WHERE at < ?1").bind(now - 365 * 86400000).run().catch(() => null);
  }
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
  for (const k of ["trip", "mode", "line", "stop", "destId", "planned", "to", "stopName", "dest", "color"]) if (p.get(k)) q[k] = p.get(k);
  return q;
}

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
  const s = await service(env, { mode: l.mode, line: l.line, trip: l.tripId, stop: l.stopId, to: l.toStopId, destId: l.destId, planned: l.planned });
  if (!s || s.alightIndex == null || s.alightIndex < 1) return null;
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
let facOrigin = "https://nsw-transport-bot.sites.tab.bot";
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
function facStrip(h) { return String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(); }
function facDist(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180, x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r), y = (bLat - aLat) * r;
  return Math.round(Math.sqrt(x * x + y * y) * 6371000);
}
function sydneyLocalMs(s) {
  // "2026-10-24T15:39:23" in Sydney time to epoch ms.
  const asUtc = Date.parse(String(s || "") + "Z");
  if (!Number.isFinite(asUtc)) return null;
  const d = new Date(asUtc);
  const syd = new Date(d.toLocaleString("en-US", { timeZone: TZ })), utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return asUtc - (syd - utc);
}

// Lift and escalator outages, all stations, cached 5 minutes.
const liftMem = { at: 0, list: null, p: null };
async function liftOutages(env) {
  if (liftMem.list && Date.now() - liftMem.at < 300000) return liftMem.list;
  if (!liftMem.p) {
    liftMem.p = (async () => {
      const now = sydneyParts(new Date());
      const [y, m, dd] = String(now.date).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3").split("-");
      const data = await tp(env, "add_info", { filterDateValid: `${dd}-${m}-${y}`, filterPublicationStatus: "current" });
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
    })().finally(() => { liftMem.p = null; });
  }
  try { return await liftMem.p; } catch (e) { return liftMem.list || []; }
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

async function stationInfo(env, id, live = true) {
  const fac = await facData(env, "facilities");
  const s = fac && fac.stations ? fac.stations[String(id)] : null;
  if (!s) return null;
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
    if (!s) return null;
    const b = { id: String(id), level: ACCESS_LEVEL[s.a] || "unknown", lift: (s.x || []).includes("lift") };
    const o = outs.filter((x) => x.stops.includes(String(id)));
    if (o.length) { b.outage = o[0].title; b.outages = o.length; }
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
  const ent = Object.entries(fac.stations);
  const exact = ent.find(([, s]) => s.n.toLowerCase().replace(/\s+(station|wharf|light rail|b-line)$/, "") === want);
  if (exact) return exact[0];
  try {
    const { stops } = await findStops(env, q);
    for (const s of (stops || []).slice(0, 4)) if (fac.stations[String(s.id)]) return String(s.id);
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
    ]).then(() => true).catch((e) => { facSchemaReady = null; throw e; });
  }
  return facSchemaReady;
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
  if (sn.tod % 60 === 8) await db(env).prepare("DELETE FROM park_watches WHERE expires < ?1").bind(now - 86400000).run().catch(() => null);
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
      return cache({ carpark: await carparkLive(env, c), source: FAC_SRC.parking }, 60);
    }
    if (p.get("stop")) {
      const id = cleanId(p.get("stop"), 12);
      return cache({ station: id, carparks: await parkingFor(env, id), source: FAC_SRC.parking }, 60);
    }
    const items = p.get("live") === "0" ? (await carparkList(env)).map((c) => parkOut(c, null)) : await parkingAll(env);
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

async function handleRequest(request, env, exec) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS", "access-control-allow-headers": "content-type, x-profile", "access-control-max-age": "86400" } });
    if (/^\/(worker\.m?js|_worker\.js|tab-site\.json)$/.test(url.pathname)) return new Response("Not found", { status: 404 });
    if (/^\/download\/[A-Za-z0-9._-]+\.apk$/.test(url.pathname)) return serveFile(env, url.pathname.slice("/download/".length), request);
    if (!url.pathname.startsWith("/api/")) {
      if (url.pathname !== "/404.html") { const page = servePage(request, url); if (page) return page; }
      const res = await env.ASSETS.fetch(request);
      if (res.status === 404) { const nf = notFoundPage(request); if (nf) return nf; }
      return withSec(res, false);
    }
    if (!rateOk(request, url.pathname)) return json({ error: "Too many requests. Wait a minute and try again." }, 429);
    const bad = badInput(url.searchParams);
    if (bad) return url.searchParams.get("format") === "text" ? textRes(bad) : json({ error: bad, text: bad }, 400);
    if (!(await ipLimitOk(env, request, url.pathname))) return json({ error: "Too many requests. Wait a minute and try again." }, 429);
    if (/^\/api\/share(\/update)?$/.test(url.pathname)) {
      try { return await shareRoutes(request, env, url); }
      catch (e) { return json({ error: "Sharing is not available right now." }, 500); }
    }
    if (/^\/api\/(hit|stats|feedback)$/.test(url.pathname)) {
      try { const s = await siteRoutes(request, env, url, exec); if (s) return s; }
      catch (e) { return json({ ok: false, error: "server", errors: { form: "We could not save that right now. Please email contact@fintex.au instead." } }, 500); }
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
          if (fs && d.reply) { d.reply += "\n" + fs; d.fare = fj.fare; }
          if (asTxt) { const tx = await askText(env, d); return textRes(fs && !tx.includes(fs) ? tx + "\n" + fs : tx); }
          return json(askSlim(d));
        }
        case "/api/departures": {
          const depKey = (p.get("stop") || "") + "|" + (p.get("mode") || "");
          const depHit = depMem.get(depKey);
          let r;
          if (depHit && Date.now() - depHit.at < 12000) r = await depHit.p;
          else {
            const pr = departures(env, p.get("stop"), { mode: p.get("mode") || null, ctx: exec });
            depMem.set(depKey, { at: Date.now(), p: pr });
            if (depMem.size > 300) depMem.delete(depMem.keys().next().value);
            try { r = await pr; } catch (e) { depMem.delete(depKey); throw e; }
          }
          const d = { kind: "departures", ...r };
          await afterAnswer(env, d, { profile, device: p.get("device"), exec });
          return asTxt ? textRes(await asText(env, d)) : json(d);
        }
        case "/api/trip": {
          const acc = p.get("acc") === "1";
          const r = await trip(env, p.get("from"), p.get("to"), { time: p.get("time") || null, arriveBy: p.get("arriveBy") === "1", count: Number(p.get("count") || 5), accessible: acc });
          // A link with stop ids and no names takes the names from the first trip found.
          const given = (k) => { const v = (p.get(k) || "").trim(); return v && !/^\d+$/.test(v) ? v : null; };
          const d = { kind: "trip", from: { id: p.get("from"), name: given("fromName") || tripEndName(r, "from") || p.get("from") }, to: { id: p.get("to"), name: given("toName") || tripEndName(r, "to") || p.get("to") }, ...r };
          pickFares(d, fareType(p));
          await addAccess(env, d, { accessible: acc }).catch(() => null);
          await afterAnswer(env, d, { profile, device: p.get("device"), exec, log: p.get("refresh") !== "1" });
          return asTxt ? textRes(await asText(env, d)) : json(d);
        }
        case "/api/plan": {
          // A trip with any number of legs: legs=[{f, fn, t, tn, m, c, a, w}] (from, to, mode, change minutes, all services, walk minutes).
          let raw = null;
          try { raw = JSON.parse(p.get("legs") || "null"); } catch (e) { raw = null; }
          const legs = chainLegs(raw);
          if (!legs) return json({ error: "legs must be a list of 1 to 6 legs, each with f and t, and the first leg not a walk" }, 400);
          const acc = p.get("acc") === "1";
          const r = await planChain(env, legs, { time: p.get("time") || null, count: Math.max(1, Math.min(8, Number(p.get("count") || 5))), all: p.get("all") === "1", accessible: acc });
          const z = legs[legs.length - 1];
          pickFares(r, fareType(p));
          await addAccess(env, r, { accessible: acc }).catch(() => null);
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
        case "/api/search": {
          const q = (p.get("q") || "").trim();
          if (q.length < 2) return json({ items: [] });
          const { stops } = await findStops(env, q);
          return json({ items: stops.slice(0, 8).map((s) => ({ id: s.id, name: shortName(s.name), modes: s.modes })) });
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
          return json({ android: apk, expoGo: "exp://u.expo.dev/cf1f4c4c-5157-41bf-a254-4480223f6368?channel-name=expo-go&runtime-version=exposdk%3A58.0.0", page: "https://" + url.host + "/download/" });
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
          // too). scope "all": also saved trips, commutes, watches, alerts, push sign ups and live
          // trip shares for this device. A valid profile id is required, and searches this
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
              if (await facSchema(env).catch(() => false)) {
                await del("alerts", "DELETE FROM lift_alerts WHERE device = ?1", dev);
                await del("watches", "DELETE FROM park_watches WHERE device = ?1", dev);
              }
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
        case "/api/predict": {
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
          return json({ ok: true, at: new Date().toISOString(), feeds: feedStats, cachedFeeds: [...feedMem.entries()].filter(([, v]) => v.buf).map(([k, v]) => ({ feed: k, ageS: Math.round((Date.now() - v.at) / 1000), trips: v.idx.size, bytes: v.buf.length })), storage: !!db(env) });
        default:
          return json({ error: "not found" }, 404);
      }
    } catch (e) {
      const msg = "Live data didn't answer just now. Try again in a moment.";
      console.error("api error", url.pathname, String((e && e.message) || e).slice(0, 300));
      return asTxt ? textRes(msg) : json({ kind: "error", text: msg }, 502);
    }
}

// ---------- edge cache, shared limits and input checks ----------
// Shared live answers are cached at the edge for 15 seconds, keyed on the query without the
// profile and device, so many phones looking at the same board cost one upstream call.
const EDGE_CACHE_RE = /^\/api\/(departures|trip|plan|service|status|alerts|stations|search|nearby|station|parking|topup|lifts)$/;
const EDGE_CACHE_S = 15;
const EDGE_SKIP = new Set(["profile", "device", "refresh", "_"]);
function edgeKey(url) {
  const u = new URL(url.origin + url.pathname);
  for (const k of [...new Set(url.searchParams.keys())].filter((k) => !EDGE_SKIP.has(k)).sort()) u.searchParams.append(k, url.searchParams.get(k));
  return new Request(u.toString(), { method: "GET" });
}
// The Cache API is not available on every host (it does nothing on some), so each copy of the
// worker also keeps the same answers in memory for 15 seconds.
const memCacheMap = new Map();
const memCache = {
  async match(req) {
    const e = memCacheMap.get(req.url);
    if (!e || Date.now() - e.at > EDGE_CACHE_S * 1000) { if (e) memCacheMap.delete(req.url); return undefined; }
    return new Response(e.body, { status: e.status, headers: e.headers });
  },
  async put(req, res) {
    const body = await res.arrayBuffer();
    if (body.byteLength > 512 * 1024) return;
    memCacheMap.set(req.url, { at: Date.now(), body, status: res.status, headers: [...res.headers] });
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
  [/^\/api\/(saved|commutes|commutes\/dismiss|watch|push\/subscribe|push\/expo|push\/expo\/unregister|push\/unsubscribe|push\/test|share|share\/update|history\/delete|lifts\/alerts|parking\/watch|feedback)$/, "w", 60, null],
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
  async fetch(request, env, exec) {
    const url = new URL(request.url);
    const cache = request.method === "GET" && EDGE_CACHE_RE.test(url.pathname) && !badInput(url.searchParams) ? edgeCache() : null;
    if (cache) {
      const key = edgeKey(url);
      const hit = await cache.match(key).catch(() => null);
      if (hit) {
        if (!rateOk(request, url.pathname)) return json({ error: "Too many requests. Wait a minute and try again." }, 429);
        // A trip from the cache still counts toward commute memory.
        const p = url.searchParams, profile = profileId(request.headers.get("x-profile") || p.get("profile"));
        if (url.pathname === "/api/trip" && profile && p.get("refresh") !== "1" && /^\d{4,10}$/.test(p.get("from") || "") && /^\d{4,10}$/.test(p.get("to") || "") && !p.get("time")) {
          const s = { profile, device: cleanId(p.get("device")) || null, from: { id: p.get("from"), name: p.get("fromName") || p.get("from") }, to: { id: p.get("to"), name: p.get("toName") || p.get("to") }, src: "search" };
          if (exec && exec.waitUntil) exec.waitUntil(logSearch(env, s));
        }
        // Answers carry the server clock in "now" for the countdowns; a cached one gets the current time.
        let body = await hit.text();
        if (/json/.test(hit.headers.get("content-type") || "")) body = body.replace(/"now":\d{13}/g, '"now":' + Date.now());
        const r = new Response(body, hit);
        r.headers.set("cache-control", "no-store");
        r.headers.set("x-edge-cache", "hit");
        return r;
      }
      const res = await handleRequest(request, env, exec);
      if (res.status === 200) {
        const copy = new Response(res.clone().body, res);
        copy.headers.set("cache-control", `public, max-age=${EDGE_CACHE_S}`);
        const put = cache.put(key, copy).catch(() => null);
        if (exec && exec.waitUntil) exec.waitUntil(put);
      }
      return res;
    }
    return handleRequest(request, env, exec);
  },
};
