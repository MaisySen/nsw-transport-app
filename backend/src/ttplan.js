// ---------- Timetable trips and nearby stops from our own timetable (outage fallback) ----------
// Written 26 Oct 2026 after Bidur's screenshots at 2:52 PM: with the Transport for NSW key over its daily limit, Home's
// commute card said "No more services today", Nearby showed a raw 502 and Ask blamed the phone's signal. When the Trip
// Planner refuses, fails or times out, trips are planned from the GTFS timetable the board engine already holds
// (direct trips on one service, and trips with one change at a station both services call at), every leg a timetable
// time (realtime false), the answer marked source "timetable". Nearby stops come from the same timetable's stop list
// with no Transport for NSW call at all. This file is appended to worker.js after pack.js by build.mjs (same module)
// and adds the object's /ttplan and /nearby paths without changing engine.js. docs/API.md has the answer shapes.
//
// Known gaps, said in the answer by having no trip rather than a wrong one: the timetable keeps no row for a trip's
// last stop (nobody boards there), so a trip to a terminus (Manly Wharf on the F1, a bus's last stop) is found only
// with a change before it; walks between two different stops are not planned.

const TT_NOTE = "Live trips unavailable, showing timetable times";
const TT_AHEAD_MS = 3 * 3600000;      // departures looked at after the asked time
const TT_RIDE_MS = 4 * 3600000;       // longest ride looked for on one service
const TT_CHANGE_MS = 4 * 60000;       // least time between two services at a change
const TT_MAX_CHANGES = 8;             // change stations tried at most
const TT_NOT_IN_SERVICE = /^(empty train|not in service)$/i;
// Interchanges tried when the services are not trains (whose stop order the timetable keeps): the big stations where
// trains, metro, light rail, ferries and buses meet. [stop id, lat, lon] from stations/*.json.
const TT_HUBS = [
  ["200060", -33.88402, 151.2062], ["200070", -33.87354, 151.20693], ["200080", -33.86594, 151.2061], ["200020", -33.86135, 151.21081],
  ["200030", -33.86765, 151.21058], ["201510", -33.89205, 151.19842], ["213510", -33.87167, 151.09429], ["215020", -33.81749, 151.00532],
  ["206710", -33.79724, 151.18093], ["206010", -33.84115, 151.20741], ["202210", -33.8912, 151.24838], ["214110", -33.86376, 151.04513],
  ["204420", -33.91446, 151.16653], ["220510", -33.92854, 151.15411], ["222010", -33.96744, 151.10269], ["212110", -33.77284, 151.08208],
  ["207720", -33.70347, 151.09836], ["214810", -33.76854, 150.90708], ["217020", -33.92493, 150.92733], ["214240", -33.83276, 151.01187],
  ["213410", -33.8771, 151.10386], ["220010", -33.91785, 151.03465], ["2155384", -33.69163, 150.90601], ["216710", -33.97221, 150.89307],
  ["223210", -34.03175, 151.05722], ["275010", -33.75015, 150.69652], ["214510", -33.80848, 150.98789], ["200046", -33.85958, 151.20262],
  ["211340", -33.78508, 151.12837], ["213820", -33.83049, 151.08705], ["250020", -34.42702, 150.88819], ["225040", -33.42348, 151.34173],
  ["229310", -32.92404, 151.75908], ["220310", -33.91094, 151.14072], ["256020", -34.06356, 150.81463], ["2000441", -33.86478, 151.20106],
];
function ttKm(a, b, c, d) {
  const r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

// Trips from one stop to another from the timetable. q = { from, to, at (ms), arriveBy, count }. Each journey is a list
// of transit legs in the trip answer's leg shape (worker.js trip()), every time a timetable time.
function ttPlan(src, q) {
  const from = String(q.from || ""), to = String(q.to || "");
  const okId = (s) => /^[A-Za-z0-9_-]{1,20}$/.test(s);
  if (!okId(from) || !okId(to) || from === to) return { error: "bad stops" };
  const meF = src.stop(from), meT = src.stop(to);
  if (!meF || !meT) return { error: "no timetable for this stop", journeys: [] };
  const at = Number(q.at) || Date.now();
  const arriveBy = !!q.arriveBy;
  const count = Math.max(1, Math.min(8, Number(q.count) || 5));
  // Depart window: from the asked time on, or (arrive by) the hours before it.
  const w0 = arriveBy ? at - TT_AHEAD_MS - TT_RIDE_MS / 2 : at, w1 = arriveBy ? at : at + TT_AHEAD_MS;
  const inService = (c) => !TT_NOT_IN_SERVICE.test(src.head(c[3]) || "");
  const A = (engCands(src, from, w0, w1) || []).filter(inService);
  const Braw = (engCands(src, to, w0, w1 + TT_RIDE_MS) || []).filter(inService);
  if (!A.length || !Braw.length) return { journeys: [], from: ttEnd(src, from), to: ttEnd(src, to) };
  const key = (c) => c[1] + "|" + c[6];
  const byTrip = (list) => { const m = new Map(); for (const c of list) { const k = key(c); if (!m.has(k)) m.set(k, []); m.get(k).push(c); } for (const v of m.values()) v.sort((x, y) => x[0] - y[0]); return m; };
  const B = byTrip(Braw);
  const after = (rows, t) => (rows ? rows.find((c) => c[0] > t) : null) || null;
  const found = [];
  // Direct: the same service calls at both stops, the destination after the origin.
  for (const a of A) {
    const b = after(B.get(key(a)), a[0]);
    if (b && b[0] - a[0] <= TT_RIDE_MS) found.push([[a, b]]);
  }
  // One change: stations both services call at. Trains' stop order is in the timetable; other modes try the hubs
  // closest to the straight line between the two stops.
  const station = (id) => { const s = src.stop(id); return s && s[1] ? s[1] : id; };
  const fromSt = station(from), toSt = station(to);
  const reachF = new Map(), reachT = new Map();
  const seqOf = (c) => { const r = src.route(c[2]); return r && ENGINE_NO_SEQ.has(r[3]) ? src.tripSeq(r[3], c[1]) : null; };
  for (const a of A.slice(0, 40)) {
    const sm = seqOf(a); if (!sm) continue;
    for (const [sid, seq] of sm) if (seq > a[4]) { const st = station(sid); reachF.set(st, (reachF.get(st) || 0) + 1); }
  }
  const seenB = new Set();
  for (const b of Braw) {
    if (seenB.size >= 40 || seenB.has(key(b))) continue;
    seenB.add(key(b));
    const sm = seqOf(b); if (!sm) continue;
    for (const [sid, seq] of sm) if (seq < b[4]) { const st = station(sid); reachT.set(st, (reachT.get(st) || 0) + 1); }
  }
  const cands = [...reachF.keys()].filter((s) => reachT.has(s) && s !== fromSt && s !== toSt)
    .sort((x, y) => reachF.get(y) * reachT.get(y) - reachF.get(x) * reachT.get(x)).slice(0, TT_MAX_CHANGES);
  const pf = src.stop(fromSt) || meF, pt = src.stop(toSt) || meT;
  if (cands.length < 3 && pf[3] && pt[3]) {
    const direct = ttKm(pf[3], pf[4], pt[3], pt[4]);
    const hubs = TT_HUBS.filter((h) => h[0] !== fromSt && h[0] !== toSt && !cands.includes(h[0]))
      .map((h) => [h[0], ttKm(pf[3], pf[4], h[1], h[2]) + ttKm(h[1], h[2], pt[3], pt[4]) - direct])
      .filter((h) => h[1] <= direct + 5).sort((x, y) => x[1] - y[1]);
    for (const h of hubs) { if (cands.length >= Math.min(TT_MAX_CHANGES, 6)) break; cands.push(h[0]); }
  }
  for (const H of cands) {
    const R = byTrip((engCands(src, H, w0, w1 + TT_RIDE_MS) || []).filter(inService));
    if (!R.size) continue;
    // Second services: leave H and reach the destination later, by time leaving H.
    const second = [];
    for (const [k, rows] of R) {
      const bs = B.get(k); if (!bs) continue;
      for (const r of rows) { const b = after(bs, r[0]); if (b && b[0] - r[0] <= TT_RIDE_MS) { second.push([r, b]); break; } }
    }
    if (!second.length) continue;
    second.sort((x, y) => x[0][0] - y[0][0]);
    // Earliest arrival among second services leaving at index i or later.
    const best = new Array(second.length);
    for (let i = second.length - 1; i >= 0; i--) best[i] = i + 1 < second.length && second[best[i + 1]][1][0] < second[i][1][0] ? best[i + 1] : i;
    for (const a of A) {
      const h = after(R.get(key(a)), a[0]);
      if (!h) continue;
      const ready = h[0] + TT_CHANGE_MS;
      let lo = 0, hi = second.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (second[mid][0][0] < ready) lo = mid + 1; else hi = mid; }
      if (lo >= second.length) continue;
      const s = second[best[lo]];
      if (s[0][1] === a[1]) continue;
      if (s[1][0] - a[0] > TT_RIDE_MS + TT_AHEAD_MS) continue;
      found.push([[a, h], s]);
    }
  }
  // Keep the trips nobody would skip: none leaves later and arrives earlier (or the same with fewer changes).
  const dep = (j) => j[0][0][0], arr = (j) => j[j.length - 1][1][0];
  const uniq = new Map();
  for (const j of found) { const k = j.map((l) => l[0][1] + "@" + l[0][0]).join(">"); if (!uniq.has(k)) uniq.set(k, j); }
  let list = [...uniq.values()].filter((j) => !arriveBy || arr(j) <= at);
  list = list.filter((j) => !list.some((o) => o !== j && dep(o) >= dep(j) && arr(o) <= arr(j) && (dep(o) > dep(j) || arr(o) < arr(j) || o.length < j.length)));
  // Same departure and arrival: the first one found (direct before a change).
  const sameSeen = new Set();
  list = list.filter((j) => { const k = dep(j) + "|" + arr(j); if (sameSeen.has(k)) return false; sameSeen.add(k); return true; });
  list.sort((x, y) => dep(x) - dep(y) || arr(x) - arr(y));
  if (arriveBy) list = list.slice(-count); else list = list.slice(0, count);
  return { journeys: list.map((j) => j.map(([a, b]) => ttLeg(src, a, b))), from: ttEnd(src, from), to: ttEnd(src, to) };
}
function ttEnd(src, id) {
  const s = src.stop(id);
  return { id, name: s ? (s[1] ? engPlaceName((src.stop(s[1]) || s)[0]) : s[0]) : id };
}
function ttLeg(src, a, b) {
  const r = src.route(a[2]) || ["", 5, "", "", "", ""];
  const mode = modeOf(r[1]);
  const so = src.stop(a[5]) || ["", "", ""], sd = src.stop(b[5]) || ["", "", ""];
  const place = (s) => engPlaceName(s[1] ? ((src.stop(s[1]) || s)[0]) : s[0]);
  const plat = (id, s) => src.plat(id) || engPlatform(s[0], s[2], r[1]);
  const iso = (t) => new Date(t).toISOString();
  return {
    kind: "transit", mode: mode.key, modeName: mode.name, line: r[0], color: lineColor(r[0], r[1]) || r[2] || mode.color,
    towards: src.head(a[3]) || "", destId: null, tripId: a[1],
    stopId: a[5], toStopId: b[5], fromParent: so[1] || null, toParent: sd[1] || null,
    from: place(so), fromPlatform: plat(a[5], so), to: place(sd), toPlatform: plat(b[5], sd),
    planned: iso(a[0]), estimated: null, arrPlanned: iso(b[0]), arrEstimated: null,
    realtime: false, delayMin: null, durationMin: Math.round((b[0] - a[0]) / 60000),
    stops: a[4] != null && b[4] != null ? Math.max(0, b[4] - a[4]) : 0,
    cancelled: false, occupancy: null, platformChangedFrom: null, source: "timetable",
    alerts: [], path: [],
  };
}
// Stops within radius metres of a point from the timetable's stop list (platforms and stands as their station), the
// Trip Planner's nearby answer shape: [{ id, name, distance }].
function ttNearby(sql, ver, lat, lon, radius = 800, max = 8) {
  const dLat = radius / 111320, dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const rows = sql.exec("SELECT id, parent, name, lat, lon FROM stops WHERE ver = ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
    ver, lat - dLat, lat + dLat, lon - dLon, lon + dLon).toArray();
  const groups = new Map();
  for (const s of rows) {
    if ((!s.lat && !s.lon) || /^G/.test(s.id)) continue; // a "G" row is a stop pair's centre, its stops are listed
    const d = Math.round(ttKm(lat, lon, s.lat, s.lon) * 1000);
    if (d > radius) continue;
    // A station's platforms and stands count as the station. "G" parents are stop pairs the Trip Planner does not
    // know by that id, so each stop stands for itself there (the nearest of the pair is kept).
    const grouped = s.parent && !/^G/.test(s.parent);
    const id = grouped ? s.parent : s.id, gk = s.parent || s.id;
    const g = groups.get(gk);
    if (!g || d < g.distance) groups.set(gk, { id, distance: d, name: grouped ? null : s.name });
  }
  const out = [...groups.values()].sort((a, b) => a.distance - b.distance).slice(0, max);
  for (const g of out) {
    if (g.name) continue;
    const p = sql.exec("SELECT name FROM stops WHERE ver = ? AND id = ?", ver, g.id).toArray();
    g.name = p.length ? p[0].name : g.id;
  }
  return out.map((g) => ({ id: g.id, name: engPlaceName(g.name), distance: g.distance }));
}

if (typeof BoardEngine === "function") {
  const ttFetch = BoardEngine.prototype.fetch;
  BoardEngine.prototype.fetch = async function (req) {
    const u = new URL(req.url);
    if (u.pathname === "/ttplan" || u.pathname === "/nearby") {
      try {
        const m = this.loadMeta();
        if (!m) return Response.json({ error: "no timetable" }, { status: 503 });
        const q = Object.fromEntries(u.searchParams);
        if (u.pathname === "/nearby") {
          const lat = Number(q.lat), lon = Number(q.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return Response.json({ error: "bad point" }, { status: 400 });
          return Response.json({ stops: ttNearby(this.sql, m.ver, lat, lon, Math.max(100, Math.min(2000, Number(q.radius) || 800))) });
        }
        // at: epoch ms, or a Sydney day (YYYYMMDD) and time (HHMM) on the timetable's own day starts.
        let at = Number(q.at) || 0;
        if (!at && q.day && m.days[q.day] != null && /^\d{4}$/.test(q.time || "")) at = (m.days[q.day] + Number(q.time.slice(0, 2)) * 3600 + Number(q.time.slice(2)) * 60) * 1000;
        const out = ttPlan(this.source(), { from: q.from, to: q.to, at: at || Date.now() - 60000, arriveBy: q.arriveBy === "1", count: q.count });
        return Response.json({ ver: m.ver, builtAt: m.builtAt, ...out }, { status: out.error === "bad stops" ? 400 : 200 });
      } catch (e) {
        return Response.json({ error: String((e && e.message) || e) }, { status: 500 });
      }
    }
    return ttFetch.call(this, req);
  };
}

// ---- worker side ----
// The Trip Planner failed in a way a timetable answer can stand in for: refused (403, 429), down (5xx), slow (timeout)
// or unreachable. A 400 (a stop it does not know) is not one.
function ttUpstreamDown(e) {
  const m = String((e && e.message) || e || "");
  if (/Transport data answered (403|408|429|5\d\d)\b/.test(m)) return true;
  if (e && (e.name === "TimeoutError" || e.name === "AbortError")) return true;
  return /network|fetch failed|timed? ?out|connection|aborted/i.test(m) && !/answered 4\d\d/.test(m);
}
const TT_EDGE_S = 60;
// Trips from the timetable in the trip answer's shape ({ journeys, live, now, source: "timetable" }), or null when the
// timetable has none (or no engine). o = { date (YYYYMMDD), time (HHMM or null for now), arriveBy, count }.
async function timetableTrip(env, fromId, toId, o = {}) {
  if (typeof engineCall !== "function" || !env || !env.ENGINE) return null;
  const okId = (s) => /^[A-Za-z0-9_-]{1,20}$/.test(String(s || ""));
  if (!okId(fromId) || !okId(toId)) return null;
  const count = Math.max(1, Math.min(8, Number(o.count) || 5));
  const qs = new URLSearchParams({ from: String(fromId), to: String(toId), count: String(count) });
  if (o.time && o.date) { qs.set("day", o.date); qs.set("time", o.time); }
  else qs.set("at", String(Math.floor(Date.now() / 60000) * 60000 - 60000));
  if (o.arriveBy) qs.set("arriveBy", "1");
  const ck = new Request("https://engine-cache.transportsydney.app/ttplan?" + qs.toString());
  const cache = typeof caches !== "undefined" ? caches.default : null;
  let d = null;
  const hit = cache ? await cache.match(ck).catch(() => null) : null;
  if (hit) d = await hit.json().catch(() => null);
  if (!d) {
    const r = await Promise.race([engineCall(env, "/ttplan?" + qs.toString()), new Promise((res) => setTimeout(() => res(null), 8000))]);
    if (!r || r.status !== 200) return null;
    d = await r.json().catch(() => null);
    if (!d || !Array.isArray(d.journeys)) return null;
    if (cache) await cache.put(ck, new Response(JSON.stringify(d), { headers: { "content-type": "application/json", "cache-control": "public, max-age=" + TT_EDGE_S } })).catch(() => null);
  }
  if (!Array.isArray(d.journeys) || !d.journeys.length) return null;
  const note = { title: TT_NOTE, url: null, priority: "high" };
  const t = (x) => new Date(x).getTime();
  const journeys = d.journeys.map((legs) => {
    const tl = legs.filter((l) => l.kind === "transit");
    // The label rides on the first leg too, so a phone that only shows leg alerts still says these are timetable times.
    tl[0].alerts = [note, ...(tl[0].alerts || [])];
    for (const l of tl) l.status = { key: "scheduled", text: "Scheduled" };
    for (let i = 1; i < tl.length; i++) {
      const gap = Math.round((t(tl[i].planned) - t(tl[i - 1].arrPlanned)) / 60000);
      tl[i].transfer = { minutes: gap, walkMin: 0, spare: gap, at: tl[i - 1].to, risk: gap < 2 ? "tight" : "ok" };
    }
    const board = t(tl[0].planned), arrive = t(tl[tl.length - 1].arrPlanned);
    return {
      leave: new Date(board).toISOString(), board: new Date(board).toISOString(), arrive: new Date(arrive).toISOString(),
      durationMin: Math.round((arrive - board) / 60000), changes: Math.max(0, tl.length - 1), live: false, anyCancelled: false,
      risk: tl.some((l) => l.transfer && l.transfer.risk === "tight") ? "tight" : "ok", legs,
      // No fare: Opal fares need the distance along the route, which a timetable leg does not carry.
      source: "timetable",
    };
  });
  for (const j of journeys) j.beaten = journeys.some((x) => x !== j && t(x.leave) > t(j.leave) && t(x.arrive) < t(j.arrive));
  if (typeof budget === "object" && budget) budget.ttTrips = (budget.ttTrips || 0) + 1;
  return { journeys, live: { feedAt: null }, now: Date.now(), source: "timetable", fallback: "planner-unavailable", alerts: [note] };
}
// Nearby stops from our own timetable's stop list (no Transport for NSW call), or null with no engine.
async function ttNearbyStops(env, lat, lon) {
  if (typeof engineCall !== "function" || !env || !env.ENGINE) return null;
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  const r = await Promise.race([engineCall(env, `/nearby?lat=${la.toFixed(5)}&lon=${lo.toFixed(5)}`), new Promise((res) => setTimeout(() => res(null), 6000))]);
  if (!r || r.status !== 200) return null;
  const d = await r.json().catch(() => null);
  return d && Array.isArray(d.stops) ? d.stops.map((s) => ({ ...s, name: typeof shortName === "function" ? shortName(s.name) : s.name })) : null;
}
// A stop's board from the engine as timetable times (the same rows /api/departures serves in an outage), for the
// worker's own departures() callers (Ask, text answers) when the Trip Planner is down. Null without the engine.
async function ttBoard(env, ctx, stopId, mode) {
  if (typeof engineBoard !== "function" || !env || !env.ENGINE) return null;
  const et = await engineBoard(env, ctx, String(stopId || ""), mode || "");
  const eb = et ? JSON.parse(et) : null;
  if (!eb || !Array.isArray(eb.items)) return null;
  const feedAt = (eb.live && eb.live.feedAt) || 0;
  const liveOk = feedAt && Date.now() - feedAt <= ENGINE_STALE_MS;
  const items = eb.items.map((x) => (liveOk && x.realtime ? { ...x, liveSource: "feed" }
    : { ...x, estimated: null, realtime: false, delayMin: null, vehicle: null, occupancy: null, source: "timetable", status: { key: "scheduled", text: "Scheduled" } }));
  const note = { id: "timetable-fallback", title: "Live times unavailable, showing timetable times", url: null, priority: "high", lines: [] };
  const d = { ...eb, items, alerts: [note, ...(eb.alerts || [])], source: "timetable", fallback: "planner-unavailable", now: Date.now() };
  delete d.live; delete d.engine;
  return d;
}
