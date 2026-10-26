
// ---------- Board engine (docs/ENGINE.md) ----------
// Departure boards for every NSW stop from the network wide GTFS realtime feeds and the GTFS timetable, built in one
// Durable Object (BoardEngine) next to Transport for NSW in Sydney. The timetable (tools/build_timetable.py) is loaded
// into the object's SQLite storage, one row per stop and service day. An alarm every ENGINE_TICK_MS fetches the trip
// update feeds that boards have needed in the last few minutes (vehicle positions less often) and rebuilds every
// board read in the last few minutes, so a phone's request is a read of a board that is already made. Transport for
// NSW calls depend on the number of feeds, never on the number of phones or stops.
// This file is appended to worker.js by build.mjs (same module): it uses worker.js helpers (FEEDS, indexFeed, PB,
// readTripUpdate, readVehiclePosition, modeOf, lineColor, statusOf, iso, vehicleOf, apiKey, API).

const ENGINE_TICK_MS = 10000;          // feeds and hot boards refresh this often
const ENGINE_VP_MS = 30000;            // vehicle positions (occupancy, stops away) this often
const ENGINE_SLOW_FEED_MS = 45000;     // regional bus feeds
const ENGINE_FEED_HOT_MS = 5 * 60000;  // a feed is fetched while a board needed it this recently
const ENGINE_BOARD_HOT_MS = 5 * 60000; // a board is rebuilt every tick while read this recently
const ENGINE_IDLE_MS = 15 * 60000;     // no reads for this long: the alarm stops until the next read
const ENGINE_HORIZON_MS = 90 * 60000;  // boards cover the next 90 minutes
const ENGINE_LOOKBACK_MS = 120 * 60000; // a service planned up to 2 hours ago can still be running late
const ENGINE_MAX_ROWS = 60;
const ENGINE_DAILY_BUDGET = 40000;     // feed calls a day the engine aims to stay under (ENGINE_BUDGET overrides)
const ENGINE_HOT_MAX = 1500;           // boards kept built; the object restarted at 500 and 990 with bigger caches (26 Oct)
const ENGINE_GAP_MS = 300;
const ENGINE_OPEN = 5;                 // open connections to Transport for NSW at a time
const ENGINE_PER_MIN = 45;             // feed calls a minute at most (ENGINE_PER_MIN overrides); the daily budget stretches the gaps
const ENGINE_VP_FEEDS = /^(bus|train|metro|ferry|lr_)/; // vehicle positions (occupancy, stops away) for Sydney feeds only

// Sydney date key (YYYYMMDD) for a moment.
const ENG_DAYFMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" });
function engDayKey(t) { return ENG_DAYFMT.format(new Date(t)).replace(/-/g, ""); }

function engPlatform(name, code, cls) {
  const m = String(name || "").match(/(Platform \w+|Stand \w+|Wharf \d\w*(?:, Side \w)?)/i);
  if (m) return m[1];
  if (code) {
    if (cls === 5 || cls === 11 || cls === 7) return "Stand " + code;
    const n = String(code).replace(/^[A-Z]+/, "");
    return n ? "Platform " + n : String(code);
  }
  return "";
}
// "Central Station Platform 16" -> "Central Station"; "Strathfield Station, Stand A" -> "Strathfield Station".
function engPlaceName(name) {
  return String(name || "").replace(/,?\s+(Platform|Stand|Wharf|Side)\s+\w+.*$/i, "").trim();
}

// Delay in seconds that a trip update gives for one stop, or null; arrFirst reads the arrival before the departure.
function engDelay(u, arrFirst) {
  if (!u) return null;
  const a = u.arr && u.arr.delay != null ? u.arr.delay : null, d = u.dep && u.dep.delay != null ? u.dep.delay : null;
  return arrFirst ? (a != null ? a : d) : (d != null ? d : a);
}
function engTime(u, arrFirst) {
  const a = u && u.arr && u.arr.time ? u.arr.time * 1000 : null, d = u && u.dep && u.dep.time ? u.dep.time * 1000 : null;
  return arrFirst ? (a || d) : (d || a);
}
// Feeds whose boards read the arrival estimate before the departure. None: on 26 Oct 2026 (30 stops, 358 services)
// departure first agreed with the Trip Planner within 60 s for 331, arrival first for buses 327, for everything 320.
const ENGINE_ARRIVAL_FIRST = new Set();
function engArrFirst(feed) { return ENGINE_ARRIVAL_FIRST.has(feed); }

// What the live trip update says about one timetabled stop of a trip.
// seqOf(stopId) gives the timetable stop sequence for a stop of this trip (updates from feeds without sequences).
// Returns null (no live data), { cancelled }, { skipped }, or { est, delay, stopId } with stopId set when the
// service now uses another platform of the same station.
function engLive(tu, row, seqOf, arrFirst) {
  if (!tu) return null;
  if (tu.rel === 3) return { cancelled: true };
  const stus = tu.stus || [];
  if (!stus.length) return tu.delay != null ? { est: row.planned + tu.delay * 1000, delay: tu.delay } : null;
  let exact = null, before = null, beforeSeq = -1, after = false;
  for (const u of stus) {
    const sq = u.seq != null ? u.seq : (seqOf ? seqOf(u.stopId) : null);
    // A stop sequence on both sides decides (a loop service calls at its first stop again at the end); the stop id
    // decides only when either side has none.
    if (sq != null && row.seq) { if (sq === row.seq) { exact = u; break; } }
    else if (u.stopId === row.stopId) { exact = u; break; }
    if (sq != null && sq < row.seq && sq > beforeSeq) { before = u; beforeSeq = sq; }
    if (sq != null && sq > row.seq) after = true;
  }
  if (exact) {
    if (exact.rel === 1) return { skipped: true };
    if (exact.rel === 2) return null;
    const t = engTime(exact, arrFirst), d = engDelay(exact, arrFirst);
    // The delay wins over the absolute time. Light rail, metro and some train updates give a time measured from the
    // operator's own schedule (often 30 to 75 s after the GTFS time), and the Trip Planner shows the timetable time
    // plus the delay: on 26 Oct 2026 (319 services live on both) planned plus delay agreed within 60 s for 298, the
    // update's time for 237 (g14, diag in the task folder).
    const est = d != null ? row.planned + d * 1000 : (t || null);
    if (est == null) return null;
    const out = { est, delay: d != null ? d : Math.round((est - row.planned) / 1000) };
    if (exact.stopId && exact.stopId !== row.stopId) out.stopId = exact.stopId;
    return out;
  }
  // No update for this stop: the last update before it carries on down the line (GTFS realtime rule).
  if (before && before.rel !== 2) {
    const d = engDelay(before, arrFirst);
    if (d != null) return { est: row.planned + d * 1000, delay: d };
  }
  // A replacement timetable that lists stops on both sides of this one but not this one: it no longer calls here.
  if (tu.rel === 5 && before && after) return { skipped: true, gone: true };
  return null;
}

// Builds one board. src gives the timetable and live data:
//   stop(id) -> [name, parent, platform code, lat, lon] or null      children(id) -> [stop ids]
//   rows(id, day) -> [[secs, tripId, routeIdx, headIdx, seq], ...]   days() -> { YYYYMMDD: day start epoch s }
//   route(i) -> [line, cls, color, feed, network, long name]         head(i) -> headsign
//   tripSeq(feed, tripId) -> Map stopId -> seq or null               tu(feed, tripId), vp(feed, tripId)
//   feedAt(feed) -> ms of the copy in use or 0                        added(feed) -> [trip updates of added trips]
//   routeOf(feed, routeId) -> route index or -1                       needFeed(feed) marks a feed as wanted
// Timetable rows of a stop and its platforms and stands between two moments, as [planned ms, trip id, route index,
// headsign index, stop sequence, stop id, service day], or null when the timetable has no rows for the stop.
function engCands(src, stopId, from, to) {
  const ids = [stopId, ...src.children(stopId)];
  const days = src.days();
  const cand = [];
  let covered = false;
  for (const [dk, base] of Object.entries(days)) {
    if (base * 1000 > to || base * 1000 + 36 * 3600000 < from) continue;
    for (const id of ids) {
      const rows = src.rows(id, dk);
      if (rows === null) continue;
      covered = true;
      for (const r of rows) {
        const planned = (base + r[0]) * 1000;
        if (planned < from || planned > to) continue;
        cand.push([planned, r[1], r[2], r[3], r[4], id, dk]);
      }
    }
  }
  return covered ? cand : null;
}
// Trains run with no passengers are in the timetable with the headsign "Empty Train" but on no planner board.
const ENGINE_NOT_IN_SERVICE = /^(empty train|not in service)$/i;

function engBuildBoard(src, stopId, opts = {}) {
  const now = opts.now || Date.now();
  const me = src.stop(stopId);
  if (!me) return null;
  const ids = [stopId, ...src.children(stopId)];
  // A platform's own board stays on that platform; a station's board covers all its platforms and stands.
  const idSet = new Set(ids);
  const from = now - ENGINE_LOOKBACK_MS, to = now + (opts.horizonMs || ENGINE_HORIZON_MS);
  // The timetable rows in the window: src.cands (a shard's window from the core object), else read here and kept per
  // stop for 5 minutes (opts.candCache). A tick only lays live data on.
  let hit = src.cands ? src.cands(stopId, from, to) : null;
  if (!src.cands) {
    const cc = opts.candCache;
    hit = cc ? cc.get(stopId) : null;
    if (!hit || hit.from > from || hit.to < to) {
      const wTo = to + 5 * 60000;
      hit = { from, to: wTo, cand: engCands(src, stopId, from, wTo) };
      if (cc) { if (cc.size > 2000) cc.clear(); cc.set(stopId, hit); }
    }
  }
  if (!hit || !hit.cand) return null; // no timetable for this stop: the caller asks the Trip Planner instead
  const cand = [];
  // Planned times in whole minutes, as the Trip Planner gives them (it drops the seconds of the GTFS time: 02:16:35 is
  // 02:16, and its live time is that minute plus the delay). With the seconds kept, light rail and metro boards came out
  // up to 59 s later than the planner's (26 Oct, g14).
  for (const a of hit.cand) if (a[0] >= from && a[0] <= to) cand.push({ planned: a[0] - (a[0] % 60000), tripId: a[1], ri: a[2], hi: a[3], seq: a[4], stopId: a[5], day: a[6] });
  const feedsUsed = new Set();
  const items = [];
  const seen = new Set();
  const mk = (c, route, live) => {
    const [line, cls, color, feed] = route;
    const mode = modeOf(cls);
    let sid = c.stopId, platFrom = null;
    if (live && live.stopId && live.stopId !== c.stopId) {
      const now2 = src.stop(live.stopId), was = src.stop(c.stopId);
      if (now2) { sid = live.stopId; platFrom = (src.plat && src.plat(c.stopId)) || engPlatform(was && was[0], was && was[2], cls) || null; }
    }
    const st = src.stop(sid) || ["", "", ""];
    const est = live && live.est ? live.est : null;
    const it = {
      mode: mode.key, modeName: mode.name, line, color: lineColor(line, cls) || color || mode.color,
      dest: c.dest != null ? c.dest : (src.head(c.hi) || ""), destId: null, description: route[5] || "",
      platform: (src.plat && src.plat(sid)) || engPlatform(st[0], st[2], cls), platformChangedFrom: platFrom,
      stopId: sid, stopName: st[0] || "",
      tripId: c.tripId, planned: iso(c.planned),
      estimated: est ? iso(est) : null, realtime: !!est,
      delayMin: est ? Math.round((est - c.planned) / 60000) : null,
      cancelled: !!(live && live.cancelled), wheelchair: false, occupancy: null, alerts: [],
      source: est ? "feed" : null,
      // When this row's live time was read (the feed copy's time), so a phone can say "live 12 s ago" per row.
      liveAt: est ? (src.feedAt(feed) || null) : null,
      ...(live && live.skipped ? { skipped: true } : {}),
      ...(feed === "ferry_mff" || feed === "nswtrains" || /^rb_/.test(feed) ? { feed } : {}),
    };
    let veh = null;
    if (src.veh) veh = src.veh(feed, c.tripId);
    else { const vp = src.vp(feed, c.tripId); veh = vp ? vehicleOf(vp) : null; }
    if (veh) {
      it.vehicle = veh;
      if (veh.occupancy) it.occupancy = veh.occupancy;
      if (veh.stopSeq && c.seq >= veh.stopSeq && it.realtime) it.stopsAway = c.seq - veh.stopSeq;
    }
    it.status = statusOf(it);
    return it;
  };
  for (const c of cand) {
    const route = src.route(c.ri);
    if (!route) continue;
    if (ENGINE_NOT_IN_SERVICE.test(src.head(c.hi) || "")) continue;
    const feed = route[3];
    if (opts.mode && !(modeOf(route[1]).key === opts.mode || (opts.mode === "bus" && modeOf(route[1]).key === "coach"))) continue;
    feedsUsed.add(feed);
    const tu = src.tu(feed, c.tripId);
    if (tu && tu.startDate && tu.startDate !== c.day) { items.push(mk(c, route, null)); continue; }
    const live = engLive(tu, c, (s) => { const m = src.tripSeq(feed, c.tripId); return m ? m.get(s) : null; }, engArrFirst(feed));
    if (live && live.gone) continue;
    seen.add(c.tripId + "|" + c.day);
    items.push(mk(c, route, live));
  }
  // Services added on the day (not in the timetable) that call here, from the trip update feeds already in use.
  for (const feed of feedsUsed) {
    for (const tu of src.added(feed) || []) {
      const u = (tu.stus || []).find((x) => idSet.has(x.stopId) && x.rel !== 1);
      if (!u) continue;
      const t = engTime(u);
      if (!t || t < from || t > to) continue;
      const d = engDelay(u) || 0;
      const ri = src.routeOf(feed, tu.routeId);
      if (ri < 0) continue;
      const lastU = tu.stus[tu.stus.length - 1];
      const last = lastU && src.stop(lastU.stopId);
      const c = { planned: t - d * 1000, tripId: tu.tripId, ri, hi: -1, seq: u.seq || 0, stopId: u.stopId, day: engDayKey(t), dest: last ? engPlaceName(last[0]) : (tu.destName || "") };
      items.push(mk(c, src.route(ri), { est: t, delay: d }));
    }
  }
  const t0 = (i) => Date.parse(i.estimated || i.planned);
  // The same service from two timetables (NSW TrainLink trips are in both the train and the regional bundle): one row,
  // the one with live data.
  const byKey = new Map();
  for (const i of items) {
    const k = i.line + "|" + i.planned + "|" + i.stopId;
    const o = byKey.get(k);
    if (!o || (!o.realtime && i.realtime)) byKey.set(k, i);
  }
  const uniq = new Set(byKey.values());
  let list = items.filter((i) => uniq.has(i)).filter((i) => t0(i) >= now - 45000 && Date.parse(i.planned) <= to);
  list.sort((a, b) => t0(a) - t0(b));
  const modes = [...new Set(list.map((i) => i.mode))];
  list = list.slice(0, opts.n || ENGINE_MAX_ROWS);
  let feedAt = 0;
  for (const f of feedsUsed) { src.needFeed && src.needFeed(f); feedAt = Math.max(feedAt, src.feedAt(f) || 0); }
  const name = me[1] ? engPlaceName(me[0]) : me[0];
  return {
    stop: { id: stopId, name: name || stopId, fullName: me[0] || "", exactName: me[1] ? me[0] : null },
    items: list, modes, alerts: [],
    live: { feedAt: feedAt || null, filledFromFeed: list.filter((i) => i.realtime).length, liveCount: list.filter((i) => i.realtime).length, total: list.length },
    now,
    engine: { builtAt: now, feeds: [...feedsUsed] },
  };
}

// The parts of a trip update that boards need for some stops of the trip (their stop sequences): the update at each
// stop, the last one before it (its delay carries on down the line) and the next one after it (a replacement timetable
// that no longer calls there). Updates without stop sequences are kept whole.
function engTrim(tu, seqs) {
  const out = { tripId: tu.tripId, rel: tu.rel, delay: tu.delay, startDate: tu.startDate, stus: tu.stus };
  const st = tu.stus;
  if (!seqs || !seqs.length || seqs.some((s) => !s) || st.some((u) => u.seq == null)) return out;
  const keep = new Set();
  for (const s of seqs) {
    let before = -1, after = -1;
    for (let i = 0; i < st.length; i++) {
      const q = st[i].seq;
      if (q === s) keep.add(i);
      else if (q < s) { if (before < 0 || q > st[before].seq) before = i; }
      else if (after < 0 || q < st[after].seq) after = i;
    }
    if (before >= 0) keep.add(before);
    if (after >= 0) keep.add(after);
  }
  out.stus = st.filter((_, i) => keep.has(i));
  return out;
}

// Feeds without a stop sequence on their updates: the timetable's stop order is loaded to carry delays on.
const ENGINE_NO_SEQ = new Set(["train"]);

class BoardEngine {
  constructor(state, env) {
    this.state = state; this.env = env; this.sql = state.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS dep (ver INTEGER, stop TEXT, day TEXT, data TEXT, PRIMARY KEY (ver, stop, day))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS stops (ver INTEGER, id TEXT, parent TEXT, name TEXT, plat TEXT, lat REAL, lon REAL, PRIMARY KEY (ver, id))");
    this.sql.exec("CREATE INDEX IF NOT EXISTS stops_parent ON stops (ver, parent)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS trips (ver INTEGER, trip TEXT, data TEXT, PRIMARY KEY (ver, trip))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)");
    // Platform names as the Trip Planner gives them (its codes differ from the timetable's at some light rail stops),
    // learnt from planner boards the worker still asks for.
    this.sql.exec("CREATE TABLE IF NOT EXISTS plat (stop TEXT PRIMARY KEY, label TEXT, at INTEGER)");
    this.platMem = null;
    this.feeds = new Map();     // feed key -> { tu, vp, tuAt, vpAt, added, wantAt, fails }
    this.boards = new Map();    // board key -> { at, body }
    this.hot = new Map();       // board key -> last read ms
    this.stopMem = new Map(); this.kidsMem = new Map(); this.rowMem = new Map(); this.seqMem = new Map(); this.candMem = new Map();
    this.meta = null; this.lastRead = 0; this.alarmSet = false;
    this.stats = { calls: 0, refused: 0, ticks: 0, built: 0, served: 0, cacheHits: 0, tickMs: 0, day: engDayKey(Date.now()), dayCalls: 0, liveCalls: 0, liveMs: 0, windows: 0 };
    // Each start of the object counts once (a deploy, an eviction after idle, or a reset), so a restart under load
    // shows in /api/engine/status as a boot during the test window.
    this.bootAt = Date.now(); this.boots = Number(this.kvGet("boots") || 0) + 1; this.kvSet("boots", String(this.boots));
    this.open = 0; this.openWait = [];
  }
  kvGet(k) { const r = this.sql.exec("SELECT v FROM kv WHERE k = ?", k).toArray(); return r.length ? r[0].v : null; }
  kvSet(k, v) { this.sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", k, v); }
  loadMeta() {
    if (this.meta) return this.meta;
    const ver = Number(this.kvGet("ver") || 0);
    if (!ver) return null;
    const j = (k) => { const v = this.kvGet(k + ":" + ver); return v ? JSON.parse(v) : null; };
    this.meta = { ver, days: j("days") || {}, routes: j("routes") || [], heads: j("heads") || [], routeIds: j("routeIds") || {}, builtAt: this.kvGet("builtAt:" + ver) };
    if (!this.stats.dayCallsLoaded) { const c = JSON.parse(this.kvGet("calls") || "{}"); if (c.day === this.stats.day) this.stats.dayCalls = c.n || 0; this.stats.dayCallsLoaded = true; }
    return this.meta;
  }
  dropMem() { this.meta = null; this.stopMem.clear(); this.kidsMem.clear(); this.rowMem.clear(); this.seqMem.clear(); this.candMem.clear(); this.boards.clear(); }
  source() {
    const m = this.loadMeta(), sql = this.sql, self = this;
    return {
      stop(id) {
        if (self.stopMem.has(id)) return self.stopMem.get(id);
        const r = sql.exec("SELECT name, parent, plat, lat, lon FROM stops WHERE ver = ? AND id = ?", m.ver, id).toArray();
        const v = r.length ? [r[0].name, r[0].parent, r[0].plat, r[0].lat, r[0].lon] : null;
        if (self.stopMem.size > 20000) self.stopMem.clear();
        self.stopMem.set(id, v); return v;
      },
      children(id) {
        if (self.kidsMem.has(id)) return self.kidsMem.get(id);
        const v = sql.exec("SELECT id FROM stops WHERE ver = ? AND parent = ?", m.ver, id).toArray().map((r) => r.id);
        if (self.kidsMem.size > 20000) self.kidsMem.clear();
        self.kidsMem.set(id, v); return v;
      },
      rows(id, day) {
        const k = id + "|" + day;
        if (self.rowMem.has(k)) return self.rowMem.get(k);
        const r = sql.exec("SELECT data FROM dep WHERE ver = ? AND stop = ? AND day = ?", m.ver, id, day).toArray();
        const v = r.length ? JSON.parse(r[0].data) : null;
        if (self.rowMem.size > 200) self.rowMem.clear(); // whole stop days are big; the window rows live in candMem
        self.rowMem.set(k, v); return v;
      },
      days() { return m.days; },
      route(i) { return m.routes[i] || null; },
      head(i) { return i >= 0 ? m.heads[i] || "" : ""; },
      routeOf(feed, rid) { const t = m.routeIds[feed]; return t && rid in t ? t[rid] : -1; },
      tripSeq(feed, tripId) {
        if (!ENGINE_NO_SEQ.has(feed)) return null;
        if (self.seqMem.has(tripId)) return self.seqMem.get(tripId);
        const r = sql.exec("SELECT data FROM trips WHERE ver = ? AND trip = ?", m.ver, tripId).toArray();
        let v = null;
        if (r.length) { const a = JSON.parse(r[0].data); v = new Map(); for (let i = 0; i < a.length; i += 2) v.set(a[i], a[i + 1]); }
        if (self.seqMem.size > 5000) self.seqMem.clear();
        self.seqMem.set(tripId, v); return v;
      },
      tu(feed, tripId) { const f = self.feeds.get(feed); return f && f.tu ? decodeFrom(f.tu, tripId) : null; },
      vp(feed, tripId) { const f = self.feeds.get(feed); return f && f.vp ? decodeFrom(f.vp, tripId) : null; },
      feedAt(feed) { const f = self.feeds.get(feed); return f && f.tu ? f.tu.at : 0; },
      added(feed) { const f = self.feeds.get(feed); return f ? f.added || [] : []; },
      needFeed(feed) { const f = self.want(feed); f.uses = (f.uses || 0) + 1; },
      plat(id) {
        if (!self.platMem) { self.platMem = new Map(); for (const r of sql.exec("SELECT stop, label FROM plat").toArray()) self.platMem.set(r.stop, r.label); }
        return self.platMem.get(id) || "";
      },
    };
  }
  want(feed) {
    let f = this.feeds.get(feed);
    if (!f) { f = { tu: null, vp: null, tuAt: 0, vpAt: 0, added: [], wantAt: 0, fails: 0 }; this.feeds.set(feed, f); }
    f.wantAt = Date.now();
    return f;
  }
  budget() { return Number(this.env.ENGINE_BUDGET) || ENGINE_DAILY_BUDGET; }
  // Interval stretch so the day's feed calls stay under the budget: 1 while on track, up to 6.
  stretch(now = Date.now()) {
    const day = engDayKey(now);
    if (day !== this.stats.day) { this.stats.day = day; this.stats.dayCalls = 0; }
    const m = this.loadMeta();
    const base = m && m.days[day] ? m.days[day] * 1000 : now - 12 * 3600000;
    const frac = Math.min(1, Math.max(0.05, (now - base) / 86400000));
    return Math.min(6, Math.max(1, this.stats.dayCalls / (this.budget() * frac)));
  }
  // Calls start at least ENGINE_GAP_MS apart (about 3 a second at most), so a tick never bursts past the key's
  // 5 a second with the worker's own Trip Planner calls beside it. A refused call is asked once more 1.5 s later.
  async slot() {
    const now = Date.now();
    const at = Math.max(now, this.nextSlot || 0);
    this.nextSlot = at + ENGINE_GAP_MS;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
  // At most ENGINE_OPEN connections to Transport for NSW at a time (Workers allow 6 open per invocation).
  async conn(fn) {
    while (this.open >= ENGINE_OPEN) await new Promise((r) => this.openWait.push(r));
    this.open++;
    try { return await fn(); } finally { this.open--; const w = this.openWait.shift(); if (w) w(); }
  }
  async fetchFeed(path, kind, again = true, prev = null) {
    if (Date.now() < (this.pauseUntil || 0)) throw new Error("feed calls paused after refusals");
    await this.slot();
    // With feed timing on, the copy held is named (If-None-Match / If-Modified-Since) so an unchanged feed can answer
    // 304 with no body.
    const headers = { Authorization: "apikey " + apiKey(this.env) };
    if (prev && engTimingOn(this.env)) {
      if (prev.etag) headers["If-None-Match"] = prev.etag;
      else if (prev.lastMod) headers["If-Modified-Since"] = prev.lastMod;
    }
    const res = await this.conn(async () => {
      const r = await fetch(API + path, { headers, signal: AbortSignal.timeout(8000) });
      if (r.status === 304) return { ok: true, status: 304 };
      return r.ok ? { ok: true, status: r.status, buf: new Uint8Array(await r.arrayBuffer()), etag: r.headers.get("etag"), lastMod: r.headers.get("last-modified") } : { ok: false, status: r.status };
    });
    this.stats.calls++; this.stats.dayCalls++;
    if ((res.status === 429 || res.status === 403) && again) {
      this.stats.refused++;
      await new Promise((r) => setTimeout(r, 1500));
      return this.fetchFeed(path, kind, false, prev);
    }
    if (res.status === 304) { this.stats.notModified = (this.stats.notModified || 0) + 1; this.refusedRun = 0; return { notModified: true }; }
    if (!res.ok) {
      this.stats.refused++; this.stats.lastRefusal = res.status + " " + path;
      // Refused twice running (the key over its rate or daily quota): no feed calls for 30 s, doubling to 10 minutes
      // while the refusals go on (26 Oct, g14: the key was over its daily quota and every tick asked again).
      if (res.status === 429 || res.status === 403) {
        this.refusedRun = (this.refusedRun || 0) + 1;
        this.pauseUntil = Date.now() + Math.min(600000, 30000 * Math.pow(2, Math.min(5, this.refusedRun - 1)));
        this.stats.pausedUntil = this.pauseUntil;
      }
      throw new Error("feed " + path + " " + res.status);
    }
    this.refusedRun = 0;
    const buf = res.buf;
    const { idx, headerTs } = indexFeed(buf, kind);
    return { at: Date.now(), buf, idx, headerTs, kind, cache: new Map(), etag: res.etag || null, lastMod: res.lastMod || null };
  }
  // One refresh per feed at a time: a crowd of first reads waits for the same fetch.
  refreshFeed(key, f, now, force) {
    if (f.pending) return f.pending;
    f.pending = this.refreshFeedNow(key, f, now, force).finally(() => { f.pending = null; });
    return f.pending;
  }
  async refreshFeedNow(key, f, now, force, only) {
    const def = FEEDS[key];
    if (!def) return;
    const k = this.stretch(now);
    const tuEvery = (/^rb_/.test(key) ? ENGINE_SLOW_FEED_MS : ENGINE_TICK_MS) * k;
    const jobs = [];
    if (only !== "vp" && (force || now - f.tuAt >= tuEvery - 1500)) {
      f.tuAt = now;
      jobs.push(this.fetchFeed(def.tu, "tu", true, f.tu).then((e) => {
        f.fails = 0;
        // Unchanged (304, or the same header time): the copy held is still the feed's latest, as of now.
        if (e.notModified || (f.tu && e.headerTs && e.headerTs === f.tu.headerTs)) {
          f.same = (f.same || 0) + 1;
          if (f.tu) f.tu.at = Date.now();
          if (e.notModified) return;
        }
        engNotePublish(f, e.headerTs);
        f.tu = e;
        // Added services are few: decode them once per copy so boards can list them.
        const added = [];
        if (e.idx.size < 2500) for (const id of e.idx.keys()) { const tu = decodeFrom(e, id); if (tu && tu.rel === 1) added.push(tu); }
        f.added = added;
      }).catch(() => { f.fails++; f.tuAt = 0; }));
    }
    if (only !== "tu" && ENGINE_VP_FEEDS.test(key) && (force || now - f.vpAt >= ENGINE_VP_MS * k - 1500)) {
      f.vpAt = now;
      jobs.push(this.fetchFeed(def.vp, "vp").then((e) => { f.vp = e; }).catch(() => {}));
    }
    await Promise.all(jobs);
  }
  async tick() {
    const t0 = Date.now();
    this.stats.ticks++;
    const jobs = [];
    // Feed calls per minute are capped (ENGINE_PER_MIN, a token bucket), whatever the number of phones, stops or
    // feeds in use. Due trip updates go first, the feeds most boards use first; vehicle positions (Sydney feeds only)
    // after. A feed that misses its turn keeps its last copy and goes first next tick.
    const perMin = Number(this.env.ENGINE_PER_MIN) || ENGINE_PER_MIN;
    this.tokens = Math.max(-perMin / 6, Math.min(perMin / 3, (this.tokens == null ? perMin / 6 : this.tokens) + ((t0 - (this.tokenAt || t0)) / 60000) * perMin));
    this.tokenAt = t0;
    const k = this.stretch(t0);
    const due = [];
    // Every wanted feed gets its turn (26 Oct, g14: ranked by use, the four busiest feeds took every call and light
    // rail and ferry copies went 3 minutes old). The busiest feeds aim for a copy every 10 s, the others every 20 s
    // (regional buses 45 s); the most overdue for its aim goes first, trip updates before vehicle positions. With
    // 1,000 stops across NSW watched, 19 trip update feeds were wanted at once (26 Oct).
    let maxUses = 0, soonest = Infinity;
    const timing = engTimingOn(this.env);
    for (const f of this.feeds.values()) maxUses = Math.max(maxUses, f.uses || 0);
    for (const [key, f] of this.feeds) {
      if (t0 - f.wantAt >= ENGINE_FEED_HOT_MS || f.pending || !FEEDS[key]) continue;
      const aim = (/^rb_/.test(key) ? ENGINE_SLOW_FEED_MS : (f.uses || 0) >= maxUses / 4 ? ENGINE_TICK_MS : 2 * ENGINE_TICK_MS) * k;
      const age = t0 - f.tuAt;
      // Feed timing (ENGINE_FEED_TIMING on): a feed whose publish rhythm is known is asked just after its next copy is
      // expected (header time + its period + ENGINE_PUBLISH_LAG_MS), not on a fixed beat; a late copy is asked again
      // at the aim at most twice its period later.
      const next = timing ? engNextPublish(f) : null;
      const at = next ? Math.max(f.tuAt + Math.min(aim, 5000), next) : f.tuAt + aim - 1500;
      f.nextAt = at;
      if (t0 >= at || (next && age >= Math.max(aim, 2 * f.period))) due.push({ key, f, kind: "tu", rank: age > ENGINE_STALE_MS * 0.75 ? -1 : 0, over: age / aim });
      else if (timing) soonest = Math.min(soonest, at);
      if (ENGINE_VP_FEEDS.test(key) && t0 - f.vpAt >= ENGINE_VP_MS * k - 1500) due.push({ key, f, kind: "vp", rank: 1, over: (t0 - f.vpAt) / (ENGINE_VP_MS * k) });
      f.uses = (f.uses || 0) / 2;
    }
    due.sort((a, b) => a.rank - b.rank || b.over - a.over);
    for (const d of due) {
      if (this.tokens < 1) { this.stats.deferred = (this.stats.deferred || 0) + 1; continue; }
      this.tokens -= 1;
      jobs.push(this.refreshFeedNow(d.key, d.f, t0, true, d.kind));
    }
    await Promise.all(jobs);
    const src = this.source();
    let n = 0;
    for (const [bk, at] of [...this.hot]) {
      if (t0 - at > ENGINE_BOARD_HOT_MS) { this.hot.delete(bk); this.boards.delete(bk); continue; }
      this.build(src, bk);
      // Let waiting board requests in between builds.
      if (++n % 25 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    this.kvSet("calls", JSON.stringify({ day: this.stats.day, n: this.stats.dayCalls }));
    this.nextDue = soonest;
    this.stats.tickMs = Date.now() - t0;
  }
  build(src, bk) {
    const [stop, mode] = bk.split("|");
    const b = engBuildBoard(src, stop, { mode: mode || null, candCache: this.candMem });
    const body = b ? JSON.stringify(b) : null;
    this.boards.set(bk, { at: Date.now(), body });
    this.stats.built++;
    return body;
  }
  async ensureAlarm() {
    if (this.alarmSet) return;
    const a = await this.state.storage.getAlarm();
    if (!a) await this.state.storage.setAlarm(Date.now() + ENGINE_TICK_MS);
    this.alarmSet = true;
  }
  async alarm() {
    this.alarmSet = true;
    const t0 = Date.now();
    try { if (this.loadMeta()) await this.tick(); } finally {
      // With feed timing, the next beat is when the next feed copy is expected (1 to 10 s away).
      const at = Math.min(t0 + ENGINE_TICK_MS, Number.isFinite(this.nextDue) ? this.nextDue : Infinity);
      if (Date.now() - this.lastRead < ENGINE_IDLE_MS) await this.state.storage.setAlarm(Math.max(Date.now() + 1000, at));
      else this.alarmSet = false;
    }
  }
  async board(stop, mode) {
    const m = this.loadMeta();
    if (!m) return null;
    const bk = stop + "|" + (mode || "");
    const now = Date.now();
    this.lastRead = now;
    if (this.hot.size < ENGINE_HOT_MAX || this.hot.has(bk)) this.hot.set(bk, now);
    const have = this.boards.get(bk);
    if (have && now - have.at < ENGINE_TICK_MS + 2000) { this.stats.cacheHits++; return have.body; }
    let src = this.source();
    // First read of a feed (a cold object): fetch the feeds this board needs before answering, at most 3 s.
    const probe = engBuildBoard(src, stop, { mode: mode || null, candCache: this.candMem });
    if (!probe) { this.boards.set(bk, { at: now, body: null }); return null; }
    const cold = probe.engine.feeds.filter((f) => { const x = this.feeds.get(f); return !x || !x.tu; });
    if (cold.length) {
      // Only a feed nobody is already fetching costs a call: after a restart hundreds of first reads wait on the
      // same few fetches, and counting each wait put the bucket minutes into debt (26 Oct, 1,000 phone test).
      const perMin = Number(this.env.ENGINE_PER_MIN) || ENGINE_PER_MIN;
      const starting = cold.filter((f) => { const x = this.feeds.get(f); return !(x && x.pending); }).length;
      if (starting) this.tokens = Math.max(-perMin / 6, (this.tokens == null ? 0 : this.tokens) - starting);
      await Promise.race([Promise.all(cold.map((f) => this.refreshFeed(f, this.want(f), now, true))), new Promise((r) => setTimeout(r, 3000))]);
      src = this.source();
    }
    return this.build(src, bk);
  }
  status() {
    const m = this.loadMeta(), now = Date.now();
    const feeds = {};
    for (const [k, f] of this.feeds) feeds[k] = { tuAgeS: f.tu ? Math.round((now - f.tu.at) / 1000) : null, vpAgeS: f.vp ? Math.round((now - f.vp.at) / 1000) : null, trips: f.tu ? f.tu.idx.size : 0, added: (f.added || []).length, hot: now - f.wantAt < ENGINE_FEED_HOT_MS, fails: f.fails, periodS: f.period ? f.period / 1000 : null, same: f.same || 0, madeAgoS: f.hdrs && f.hdrs.length ? Math.round(now / 1000 - f.hdrs[f.hdrs.length - 1]) : null, nextInS: f.nextAt ? Math.round((f.nextAt - now) / 1000) : null };
    return { role: "core", boots: this.boots, bootAt: this.bootAt, ver: m ? m.ver : 0, builtAt: m ? m.builtAt : null, days: m ? Object.keys(m.days) : [], hotBoards: this.hot.size, stretch: Math.round(this.stretch(now) * 100) / 100, budget: this.budget(), perMin: Number(this.env.ENGINE_PER_MIN) || ENGINE_PER_MIN, tokens: Math.round((this.tokens || 0) * 10) / 10, gaps: this.gaps ? [...this.gaps].slice(0, 50).map(([s, g]) => [s, g.lines]) : [], pausedUntil: this.pauseUntil || null, ...this.stats, feeds };
  }
  async fetch(req) {
    const u = new URL(req.url);
    const p = u.pathname;
    try {
      if (p === "/board") {
        await this.ensureAlarm();
        const body = await this.board(u.searchParams.get("stop") || "", u.searchParams.get("mode") || "");
        this.stats.served++;
        if (!body) return new Response('{"error":"no timetable for this stop"}', { status: 404, headers: { "content-type": "application/json" } });
        return new Response(body, { headers: { "content-type": "application/json" } });
      }
      // Board shards (BoardShard) ask the core object for timetable windows, the timetable's tables and live data.
      if (p === "/window" && req.method === "POST") return Response.json(this.window(await req.json()));
      if (p === "/meta") { const m = this.loadMeta(); return Response.json(m ? { ver: m.ver, days: m.days, routes: m.routes, heads: m.heads, routeIds: m.routeIds, builtAt: m.builtAt } : { error: "no timetable" }, { status: m ? 200 : 503 }); }
      if (p === "/live" && req.method === "POST") return Response.json(await this.live(await req.json()));
      if (p === "/timetable") return Response.json(this.timetable(u.searchParams.get("stops") || "", Number(u.searchParams.get("days")) || 2));
      if (p === "/status") return Response.json(this.status());
      if (p === "/learn" && req.method === "POST") {
        const q = await req.json(); let n = 0;
        const pairs = Array.isArray(q) ? q : (q && q.pairs) || [];
        if (q && q.lines && typeof q.lines.stop === "string") this.checkGap(q.lines.stop, q.lines.lines);
        if (!this.platMem) this.source().plat("");
        for (const [stop, label] of Array.isArray(pairs) ? pairs.slice(0, 200) : []) {
          if (typeof stop !== "string" || typeof label !== "string" || !/^(Platform|Stand|Wharf) [A-Za-z0-9]{1,4}(, Side \w)?$/.test(label)) continue;
          if (this.platMem.get(stop) === label) continue;
          this.sql.exec("INSERT OR REPLACE INTO plat VALUES (?, ?, ?)", stop, label, Date.now()); this.platMem.set(stop, label); n++;
        }
        if (n) { this.boards.clear(); this.platVer = (this.platVer || 0) + 1; }
        return Response.json({ n, gap: this.gapOf(q && q.lines && q.lines.stop) });
      }
      if (req.method !== "POST") return new Response("not found", { status: 404 });
      return await this.load(p, req);
    } catch (e) {
      return Response.json({ error: String(e && e.message || e) }, { status: 500 });
    }
  }
  // Services the Trip Planner lists at a stop that our GTFS bundles do not have (26 Oct: the private Watsons Bay ferry,
  // coach 855 and SH100 at Goulburn, 700-1 at Bomaderry). The worker sends the lines of the next 90 minutes of a planner
  // board; a line with no timetable row at the stop in that time marks the stop for 6 hours, and its boards then come
  // from the Trip Planner (the board says engine.gap). The next planner board with every line known clears it.
  checkGap(stop, lines) {
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(stop) || !Array.isArray(lines)) return;
    const m = this.loadMeta(), src = m && this.source();
    if (!src || !src.stop(stop)) return;
    const now = Date.now();
    const have = new Set();
    for (const a of engCands(src, stop, now - ENGINE_LOOKBACK_MS, now + ENGINE_HORIZON_MS + 30 * 60000)) { const r = m.routes[a[2]]; if (r) have.add(String(r[0]).toUpperCase()); }
    const missing = [...new Set(lines.map((l) => String(l).slice(0, 12).toUpperCase()))].filter((l) => l && !have.has(l)).slice(0, 10);
    if (!this.gaps) this.gaps = new Map();
    const was = this.gaps.get(stop);
    if (missing.length) this.gaps.set(stop, { at: now, lines: missing });
    else this.gaps.delete(stop);
    if (this.gaps.size > 2000) this.gaps.delete(this.gaps.keys().next().value);
    if (!!was !== !!missing.length) { this.boards.clear(); this.platVer = (this.platVer || 0) + 1; }
  }
  gapOf(stop) {
    const g = stop && this.gaps && this.gaps.get(stop);
    if (!g) return null;
    if (Date.now() - g.at > 6 * 3600000) { this.gaps.delete(stop); return null; }
    return g.lines;
  }
  // A shard's window: the timetable rows of one stop and its platforms and stands between two moments, with the stop
  // names a board needs (the stop, its platforms and stands, the other platforms of its station).
  window(q) {
    const m = this.loadMeta();
    if (!m) return { error: "no timetable" };
    this.stats.windows++;
    const src = this.source();
    const stop = String(q.stop || "");
    const me = /^[A-Za-z0-9_-]{1,20}$/.test(stop) ? src.stop(stop) : null;
    if (!me) return { ver: m.ver, me: null, cand: null };
    const kids = src.children(stop);
    const ids = new Set([stop, ...kids]);
    if (me[1]) { ids.add(me[1]); for (const k of src.children(me[1])) ids.add(k); }
    const info = {};
    for (const id of ids) { const s = src.stop(id); if (s) info[id] = [s[0], s[1], s[2], s[3], s[4], src.plat(id) || ""]; }
    const now = Date.now();
    const from = Number(q.from) || now - ENGINE_LOOKBACK_MS, to = Number(q.to) || now + ENGINE_HORIZON_MS;
    return { ver: m.ver, me, kids, info, from, to, gap: this.gapOf(stop), cand: engCands(src, stop, from, to) };
  }
  // Live data for a shard: the trimmed trip update and the vehicle of each asked trip, per feed, from the copy in use.
  // q = { feeds: { feed: [[tripId, [stop sequences]]] }, have: { feed: [tu copy ms, vp copy ms] } }; a feed the shard
  // already holds this copy of (same trips) comes back in same[]. Decoded per call and not kept, so the object's
  // memory holds the feed bytes only.
  async live(q) {
    const t0 = Date.now();
    const m = this.loadMeta();
    if (!m) return { error: "no timetable" };
    this.lastRead = t0;
    await this.ensureAlarm();
    const asked = Object.keys((q && q.feeds) || {}).filter((f) => FEEDS[f]);
    for (const f of asked) { const x = this.want(f); x.uses = (x.uses || 0) + 1; }
    const cold = asked.filter((f) => !this.feeds.get(f).tu);
    if (cold.length) {
      const perMin = Number(this.env.ENGINE_PER_MIN) || ENGINE_PER_MIN;
      const starting = cold.filter((f) => !this.feeds.get(f).pending).length;
      if (starting) this.tokens = Math.max(-perMin / 6, (this.tokens == null ? 0 : this.tokens) - starting);
      await Promise.race([Promise.all(cold.map((f) => this.refreshFeed(f, this.feeds.get(f), t0, true))), new Promise((r) => setTimeout(r, 3000))]);
    }
    const src = this.source();
    const out = { ver: m.ver, platVer: (this.bootAt % 100000) * 1000 + (this.platVer || 0), at: {}, vpAt: {}, same: [], tu: {}, veh: {}, added: {}, next: {} };
    // When each asked feed's next copy is expected here (feed timing), so a shard can ask just after it.
    if (engTimingOn(this.env)) for (const feed of asked) { const f = this.feeds.get(feed); const n = f && engNextPublish(f); if (n) out.next[feed] = n + 1500; }
    for (const feed of asked) {
      const f = this.feeds.get(feed);
      if (!f || !f.tu) continue;
      out.at[feed] = f.tu.at; out.vpAt[feed] = f.vp ? f.vp.at : 0;
      const have = q.have && q.have[feed];
      if (have && have[0] === out.at[feed] && have[1] === out.vpAt[feed]) { out.same.push(feed); continue; }
      const tus = {}, vehs = {};
      const fill = ENGINE_NO_SEQ.has(feed);
      for (const [tripId, seqs] of q.feeds[feed] || []) {
        const loc = f.tu.idx.get(tripId);
        if (loc) {
          const tu = readTripUpdate(new PB(f.tu.buf, loc[0], loc[1]));
          if (fill) { const sm = src.tripSeq(feed, tripId); if (sm) for (const u of tu.stus) if (u.seq == null && sm.has(u.stopId)) u.seq = sm.get(u.stopId); }
          tus[tripId] = engTrim(tu, seqs);
        }
        const vl = f.vp && f.vp.idx.get(tripId);
        if (vl) { const v = vehicleOf(readVehiclePosition(new PB(f.vp.buf, vl[0], vl[1]))); if (v) vehs[tripId] = v; }
      }
      out.tu[feed] = tus; out.veh[feed] = vehs;
      out.added[feed] = (f.added || []).map((tu) => { const lastU = tu.stus[tu.stus.length - 1]; const last = lastU && src.stop(lastU.stopId); return { ...tu, destName: last ? engPlaceName(last[0]) : "" }; });
    }
    this.stats.liveCalls++; this.stats.liveMs += Date.now() - t0;
    return out;
  }
  // Loading a new timetable version: /load/begin, then stops, days and trips in parts, then /load/commit.
  async load(p, req) {
    if (p === "/load/restart") {
      // Takes effect after this answer: the object starts again with the code now deployed.
      setTimeout(() => { try { this.state.abort("restart"); } catch (e) { /* not available */ } }, 50);
      return Response.json({ restarting: true });
    }
    if (p === "/load/begin") {
      const meta = await req.json();
      const ver = Number(this.kvGet("ver") || 0) + 1;
      this.sql.exec("DELETE FROM dep WHERE ver = ?", ver); this.sql.exec("DELETE FROM stops WHERE ver = ?", ver); this.sql.exec("DELETE FROM trips WHERE ver = ?", ver);
      for (const k of ["days", "routes", "heads", "routeIds"]) this.kvSet(k + ":" + ver, JSON.stringify(meta[k] || null));
      this.kvSet("builtAt:" + ver, meta.builtAt || ""); this.kvSet("loading", String(ver));
      return Response.json({ ver });
    }
    const ver = Number(this.kvGet("loading") || 0);
    if (!ver) return Response.json({ error: "no load in progress" }, { status: 409 });
    if (p === "/load/stops") {
      const list = await req.json(); let n = 0;
      for (const s of list) { this.sql.exec("INSERT OR REPLACE INTO stops VALUES (?, ?, ?, ?, ?, ?, ?)", ver, s[0], s[2] || "", s[1] || "", s[3] || "", s[4] || 0, s[5] || 0); n++; }
      return Response.json({ ver, n });
    }
    if (p === "/load/days" || p === "/load/trips") {
      const text = await req.text(); let n = 0;
      for (const line of text.split("\n")) {
        if (!line) continue;
        const o = JSON.parse(line);
        if (p === "/load/days") this.sql.exec("INSERT OR REPLACE INTO dep VALUES (?, ?, ?, ?)", ver, o.s, o.d, JSON.stringify(o.r));
        else this.sql.exec("INSERT OR REPLACE INTO trips VALUES (?, ?, ?)", ver, o.t, JSON.stringify(o.s));
        n++;
      }
      return Response.json({ ver, n });
    }
    if (p === "/load/commit") {
      const counts = this.sql.exec("SELECT (SELECT COUNT(*) FROM dep WHERE ver = ?) AS dep, (SELECT COUNT(*) FROM stops WHERE ver = ?) AS stops", ver, ver).toArray()[0];
      if (!counts.dep || !counts.stops) return Response.json({ error: "empty load", counts }, { status: 409 });
      const old = Number(this.kvGet("ver") || 0);
      this.kvSet("ver", String(ver)); this.kvSet("loading", "0");
      this.dropMem();
      if (old) {
        this.sql.exec("DELETE FROM dep WHERE ver <= ?", old); this.sql.exec("DELETE FROM stops WHERE ver <= ?", old); this.sql.exec("DELETE FROM trips WHERE ver <= ?", old);
        for (const k of ["days", "routes", "heads", "routeIds", "builtAt"]) this.sql.exec("DELETE FROM kv WHERE k = ?", k + ":" + old);
      }
      return Response.json({ ver, counts });
    }
    return new Response("not found", { status: 404 });
  }
  // The on phone timetable pack (/api/timetable): the timetable rows for some stops and their platforms, today and
  // the next day(s), with only the routes and headsigns they use. No live data: the app lays the board's live times on top.
  timetable(stopsParam, ndays) {
    const m = this.loadMeta();
    if (!m) return { error: "no timetable" };
    const src = this.source();
    const ids = stopsParam.split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{1,20}$/.test(s)).slice(0, 40);
    const today = engDayKey(Date.now());
    const keys = Object.keys(m.days).sort().filter((d) => d >= today).slice(0, Math.max(1, Math.min(3, ndays)));
    // Yesterday's rows after midnight belong to today too.
    const prev = Object.keys(m.days).sort().filter((d) => d < today).pop();
    const routes = new Map(), heads = new Map(), out = {};
    const ri = (i) => { if (!routes.has(i)) routes.set(i, routes.size); return routes.get(i); };
    const hi = (i) => { if (!heads.has(i)) heads.set(i, heads.size); return heads.get(i); };
    for (const id of ids) {
      const me = src.stop(id);
      if (!me) continue;
      const kids = [id, ...src.children(id)];
      const stops = {};
      for (const k of kids) { const s = src.stop(k); if (s) stops[k] = [s[0], s[2]]; }
      const days = {};
      for (const d of prev ? [prev, ...keys] : keys) {
        const rows = [];
        for (const k of kids) for (const r of src.rows(k, d) || []) if (d !== prev || r[0] >= 86400) rows.push([r[0], r[1], ri(r[2]), hi(r[3]), k === id ? 0 : kids.indexOf(k)]);
        rows.sort((a, b) => a[0] - b[0]);
        days[d] = { start: m.days[d], rows };
      }
      out[id] = { name: me[1] ? engPlaceName(me[0]) : me[0], stops: kids, stopInfo: stops, days };
    }
    const rl = [], hl = [];
    for (const [i, j] of routes) { const r = m.routes[i] || ["", 5, "", "", "", ""]; const mode = modeOf(r[1]); rl[j] = [r[0], mode.key, lineColor(r[0], r[1]) || r[2] || mode.color, mode.name]; }
    for (const [i, j] of heads) hl[j] = m.heads[i] || "";
    return { v: 1, builtAt: m.builtAt, generatedAt: Date.now(), routes: rl, heads: hl, stops: out };
  }
}

// ---------- board shards ----------
// Boards are built in ENGINE_SHARDS objects (BoardShard), a stop's board always in the same one (engShardOf). The core
// object (BoardEngine, above) keeps the timetable and the one copy of each feed, so Transport for NSW calls stay flat
// however many shards there are; a shard asks it for the timetable rows of its stops (a window, kept 20 minutes) and,
// every tick, for the live data of just the trips on its boards, trimmed to the stops it shows. A shard keeps no feed
// bytes and no whole stop days, so its memory is its boards. Each tick writes the boards to Cloudflare's cache, where
// the worker reads them first; a phone's request reaches a shard only on a cache miss.
// Why (26 Oct 2026): the one object holding every board restarted once in every load test (at 500 to 990 hot boards).
const ENGINE_SHARDS_DEFAULT = 16;
const ENGINE_SHARD_TICK_MS = 5000;      // a shard checks the core's copies this often and rebuilds when one changed
const ENGINE_SHARD_REBUILD_MS = 15000;  // and rebuilds at least this often (departures leave the board)
const ENGINE_WINDOW_MS = 20 * 60000;    // a window covers the board's horizon plus this, then is asked again
const ENGINE_SHARD_HOT_MAX = 800;
const ENGINE_SHARD_PUTS = 400;          // cache writes per tick at most (Workers allow 1,000 subrequests per invocation)
const ENGINE_BOARD_TTL_S = 15;          // boards in Cloudflare's cache: never longer than the 15 s freshness phones expect
function engShardOf(stop, n) {
  let h = 2166136261;
  for (let i = 0; i < stop.length; i++) { h ^= stop.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % n;
}
function engCacheKey(stop, mode) {
  return new Request("https://engine-cache.transportsydney.app/board?stop=" + encodeURIComponent(stop) + "&mode=" + encodeURIComponent(mode || ""));
}

class BoardShard {
  constructor(state, env) {
    this.state = state; this.env = env; this.sql = state.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)");
    const r = this.sql.exec("SELECT v FROM kv WHERE k = 'boots'").toArray();
    this.boots = (r.length ? Number(r[0].v) : 0) + 1;
    this.sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES ('boots', ?)", String(this.boots));
    this.bootAt = Date.now();
    this.meta = null;
    this.win = new Map();     // stop -> window from the core
    this.info = new Map();    // stop id -> [name, parent, platform code, lat, lon, platform label] from the windows
    this.boards = new Map();  // board key -> { at, body }
    this.hot = new Map();     // board key -> last read or touch
    this.live = new Map();    // feed -> { at, vpAt, trips: Set, tu: Map, veh: Map, added: [] }
    this.lastRead = 0; this.alarmSet = false; this.lastBuild = 0; this.name = ""; this.platVer = null; this.learnAsked = new Map();
    this.pushed = new Map();  // board key -> what the phones on its sockets hold (engPushState)
    this.stats = { ticks: 0, built: 0, served: 0, cacheHits: 0, puts: 0, putErrors: 0, liveCalls: 0, liveSame: 0, windows: 0, tickMs: 0, liveMs: 0, buildMs: 0, coreErrors: 0, sockets: 0, pushes: 0, pushBytes: 0 };
  }
  core() { return engineStub(this.env); }
  // ---- push (ENGINE_PUSH, /api/live): phones on a board's WebSocket get a diff the moment the shard rebuilds it ----
  sockets(bk) { try { return this.state.getWebSockets(bk); } catch (e) { return []; } }
  // Sends the change from what the board's sockets hold to this body (except to `skip`, a phone just sent the whole
  // board), and keeps this body as what they hold.
  pushBoard(bk, body, skip) {
    const socks = this.sockets(bk).filter((w) => w !== skip);
    let board;
    try { board = JSON.parse(body); } catch (e) { return; }
    const prev = this.pushed.get(bk);
    const { state, msg } = engPushDiff(prev, board);
    this.pushed.set(bk, state);
    if (!socks.length || (!msg && prev !== null)) return;
    const text = prev === null ? '{"type":"board","board":' + body + "}" : JSON.stringify(msg);
    for (const w of socks) { try { w.send(text); this.stats.pushes++; this.stats.pushBytes += text.length; } catch (e) { /* closed */ } }
  }
  async openSocket(req, u) {
    if ((req.headers.get("upgrade") || "").toLowerCase() !== "websocket") return new Response('{"error":"websocket only"}', { status: 426, headers: { "content-type": "application/json" } });
    const stop = u.searchParams.get("stop") || "", mode = u.searchParams.get("mode") || "";
    const bk = stop + "|" + mode;
    // Sockets per address and per object (liveLimit, src/livehub.js): over the limit the phone keeps polling.
    const lim = typeof liveLimit === "function" ? liveLimit(this.state, req) : { tag: null, res: null };
    if (lim.res) return lim.res;
    await this.ensureAlarm();
    let body = await this.board(stop, mode);
    if (!body) return new Response('{"error":"no timetable for this stop"}', { status: 404, headers: { "content-type": "application/json" } });
    body = body.replace(',"learn":true', "");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server, lim.tag ? [bk, lim.tag] : [bk]);
    try { server.serializeAttachment({ at: Date.now() }); } catch (e) { /* attachments not on this host */ }
    this.stats.sockets++;
    this.pushBoard(bk, body, server);
    server.send('{"type":"board","board":' + body + "}");
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, msg) {
    const bk = (this.state.getTags(ws) || [])[0] || "";
    if (msg === "ping") { ws.send("pong"); return; }
    if (msg === "full" && bk) {
      const [stop, mode] = bk.split("|");
      const body = await this.board(stop, mode);
      if (body) ws.send('{"type":"board","board":' + body.replace(',"learn":true', "") + "}");
    }
  }
  async webSocketClose(ws, code) { try { ws.close(code === 1005 ? 1000 : code, "closed"); } catch (e) { /* already closed */ } }
  async webSocketError() { /* the phone falls back to polling */ }
  async coreJson(path, body) {
    const r = await this.core().fetch("https://engine" + path, body ? { method: "POST", body: JSON.stringify(body) } : undefined);
    if (r.status !== 200) { this.stats.coreErrors++; throw new Error("core " + path + " " + r.status); }
    return r.json();
  }
  async ensureMeta(ver) {
    if (this.meta && (!ver || this.meta.ver === ver)) return this.meta;
    const m = await this.coreJson("/meta");
    if (!this.meta || this.meta.ver !== m.ver) { this.win.clear(); this.info.clear(); this.boards.clear(); }
    this.meta = m;
    return m;
  }
  // Windows for these stops, asked of the core when missing or about to run out (6 at a time).
  async ensureWindows(stops, now) {
    const need = stops.filter((s) => { const w = this.win.get(s); return !w || w.to < now + ENGINE_HORIZON_MS + 60000; });
    for (let i = 0; i < need.length; i += 6) {
      await Promise.all(need.slice(i, i + 6).map(async (s) => {
        const w = await this.coreJson("/window", { stop: s, from: now - ENGINE_LOOKBACK_MS - 60000, to: now + ENGINE_HORIZON_MS + ENGINE_WINDOW_MS }).catch(() => null);
        if (!w || w.error) return;
        this.stats.windows++;
        if (this.meta && w.ver !== this.meta.ver) { this.meta = null; this.win.clear(); this.info.clear(); }
        this.win.set(s, w);
        for (const [id, v] of Object.entries(w.info || {})) this.info.set(id, v);
      }));
    }
    if (this.win.size > ENGINE_SHARD_HOT_MAX * 2) {
      const keep = new Set([...this.hot.keys()].map((k) => k.split("|")[0]));
      for (const s of this.win.keys()) if (!keep.has(s)) this.win.delete(s);
      this.info.clear();
      for (const w of this.win.values()) for (const [id, v] of Object.entries(w.info || {})) this.info.set(id, v);
    }
  }
  // The trips on these stops' boards: feed -> Map trip -> Set of stop sequences.
  tripsFor(stops, now) {
    const m = this.meta, need = new Map();
    const from = now - ENGINE_LOOKBACK_MS, to = now + ENGINE_HORIZON_MS;
    for (const s of stops) {
      const w = this.win.get(s);
      if (!w || !w.cand) continue;
      for (const a of w.cand) {
        if (a[0] < from || a[0] > to) continue;
        const route = m.routes[a[2]];
        if (!route || !FEEDS[route[3]]) continue;
        let f = need.get(route[3]);
        if (!f) { f = new Map(); need.set(route[3], f); }
        let q = f.get(a[1]);
        if (!q) { q = new Set(); f.set(a[1], q); }
        q.add(a[4] || 0);
      }
    }
    return need;
  }
  // Live data for the trips in need from the core. merge keeps what is held for other trips (a first read).
  async fetchLive(need, merge) {
    const t0 = Date.now();
    const feeds = {}, have = {};
    for (const [feed, trips] of need) {
      const held = this.live.get(feed);
      if (held && !merge) {
        let all = true;
        for (const t of trips.keys()) if (!held.trips.has(t)) { all = false; break; }
        if (all) have[feed] = [held.at, held.vpAt];
      }
      feeds[feed] = [...trips].map(([t, s]) => [t, [...s]]);
    }
    if (!Object.keys(feeds).length) return false;
    const r = await this.coreJson("/live", { feeds, have });
    this.stats.liveCalls++; this.stats.liveMs += Date.now() - t0;
    if (r.error) return false;
    if (this.meta && r.ver !== this.meta.ver) { await this.ensureMeta(r.ver); return true; }
    if (!merge) this.nextCopy = Object.values(r.next || {}).reduce((a, b) => Math.min(a, b), Infinity);
    // Platform names learnt from the Trip Planner since the windows were read: read the windows again.
    if (this.platVer != null && r.platVer !== this.platVer) { this.win.clear(); this.info.clear(); }
    this.platVer = r.platVer;
    let changed = false;
    for (const feed of Object.keys(feeds)) {
      if (r.same.includes(feed)) { this.stats.liveSame++; continue; }
      if (!(feed in r.tu)) continue;
      const old = this.live.get(feed);
      const e = merge && old ? old : { trips: new Set(), tu: new Map(), veh: new Map() };
      for (const t of need.get(feed).keys()) e.trips.add(t);
      for (const [t, tu] of Object.entries(r.tu[feed])) e.tu.set(t, tu);
      for (const [t, v] of Object.entries(r.veh[feed] || {})) e.veh.set(t, v);
      if (!merge || !old || old.at !== r.at[feed]) changed = true;
      e.at = r.at[feed]; e.vpAt = r.vpAt[feed]; e.added = r.added[feed] || [];
      this.live.set(feed, e);
    }
    return changed;
  }
  source() {
    const m = this.meta, self = this;
    const info = (id) => self.info.get(id) || null;
    return {
      stop(id) { const w = self.win.get(id); if (w && w.me) return w.me; return info(id); },
      children(id) { const w = self.win.get(id); return w && w.kids ? w.kids : []; },
      days() { return m.days; },
      route(i) { return m.routes[i] || null; },
      head(i) { return i >= 0 ? m.heads[i] || "" : ""; },
      routeOf(feed, rid) { const t = m.routeIds[feed]; return t && rid in t ? t[rid] : -1; },
      tripSeq() { return null; },
      tu(feed, t) { const e = self.live.get(feed); return e ? e.tu.get(t) || null : null; },
      veh(feed, t) { const e = self.live.get(feed); return e ? e.veh.get(t) || null : null; },
      vp() { return null; },
      feedAt(feed) { const e = self.live.get(feed); return e ? e.at : 0; },
      added(feed) { const e = self.live.get(feed); return e ? e.added || [] : []; },
      plat(id) { const s = info(id); return s ? s[5] || "" : ""; },
      cands(stop) { const w = self.win.get(stop); return w ? { cand: w.cand } : null; },
    };
  }
  build(src, bk, now, first) {
    const [stop, mode] = bk.split("|");
    const b = engBuildBoard(src, stop, { mode: mode || null, now });
    if (b) b.engine.shard = this.name;
    const w = this.win.get(stop);
    if (b && w && w.gap) b.engine.gap = w.gap;
    // A first read of a board: ask the worker to read the Trip Planner's board once, whose platform and stand names
    // and lines the core object learns (/learn): once in 6 hours for a stop with services that have no platform name,
    // else once a day, at most 2 stops a minute per shard so a crowd of first reads does not become planner calls.
    const last = this.learnAsked.get(stop) || 0;
    const due = now - last > (b && b.items.some((i) => !i.platform) ? 6 : 24) * 3600000;
    if (now - (this.learnMin || 0) > 60000) { this.learnMin = now; this.learnN = 0; }
    if (b && first && due && this.learnN < 2) {
      this.learnN++;
      this.learnAsked.set(stop, now);
      if (this.learnAsked.size > 5000) this.learnAsked.clear();
      b.engine.learn = true;
    }
    const body = b ? JSON.stringify(b) : null;
    this.boards.set(bk, { at: now, body });
    this.stats.built++;
    return body;
  }
  async putCache(list) {
    const cache = typeof caches !== "undefined" ? caches.default : null;
    if (!cache || !list.length) return;
    const hdr = { "content-type": "application/json", "cache-control": "public, max-age=" + ENGINE_BOARD_TTL_S };
    for (let i = 0; i < list.length; i += 50) {
      await Promise.all(list.slice(i, i + 50).map(([bk, body]) => {
        const [stop, mode] = bk.split("|");
        return cache.put(engCacheKey(stop, mode), new Response(body, { headers: hdr })).then(() => { this.stats.puts++; }, () => { this.stats.putErrors++; });
      }));
    }
  }
  async tick() {
    const t0 = Date.now();
    this.stats.ticks++;
    // A board with phones on its socket is being read (also after the object woke from hibernation).
    let open = [];
    // Sockets open over 10 minutes are closed ("renew", liveSweep in src/livehub.js); a phone still on view reopens.
    if (typeof liveSweep === "function") liveSweep(this.state, t0);
    try { open = this.state.getWebSockets(); } catch (e) { /* no sockets */ }
    // After a wake from hibernation nothing is known of what those phones hold (null): they get the whole board next.
    for (const w of open) for (const t of (this.state.getTags(w) || []).filter((x) => !x.startsWith("ip:"))) { this.mark(t, t0); if (!this.pushed.has(t)) this.pushed.set(t, null); }
    for (const bk of this.pushed.keys()) if (!this.sockets(bk).length) this.pushed.delete(bk);
    for (const [bk, at] of this.hot) if (t0 - at > ENGINE_BOARD_HOT_MS) { this.hot.delete(bk); this.boards.delete(bk); }
    if (!this.hot.size) return;
    await this.ensureMeta();
    const stops = [...new Set([...this.hot.keys()].map((k) => k.split("|")[0]))];
    await this.ensureWindows(stops, t0);
    const changed = await this.fetchLive(this.tripsFor(stops, t0), false);
    if (!changed && t0 - this.lastBuild < ENGINE_SHARD_REBUILD_MS) { this.stats.tickMs = Date.now() - t0; return; }
    const b0 = Date.now();
    const src = this.source();
    const put = [];
    let n = 0;
    // Most read first, so the cache write cap drops the least read boards.
    for (const bk of [...this.hot.keys()].sort((a, b) => this.hot.get(b) - this.hot.get(a))) {
      const body = this.build(src, bk, b0);
      if (body && put.length < ENGINE_SHARD_PUTS) put.push([bk, body]);
      if (body && this.pushed.has(bk)) this.pushBoard(bk, body.replace(',"learn":true', ""));
      if (++n % 20 === 0) await new Promise((r) => setTimeout(r, 0)); // let waiting reads in between builds
    }
    this.lastBuild = b0;
    this.stats.buildMs = Date.now() - b0;
    await this.putCache(put);
    this.stats.tickMs = Date.now() - t0;
  }
  mark(bk, now) {
    this.lastRead = now;
    if (this.hot.size < ENGINE_SHARD_HOT_MAX || this.hot.has(bk)) this.hot.set(bk, now);
  }
  async board(stop, mode) {
    const now = Date.now();
    const bk = stop + "|" + (mode || "");
    this.mark(bk, now);
    const have = this.boards.get(bk);
    if (have && now - have.at < ENGINE_SHARD_REBUILD_MS + 2000) { this.stats.cacheHits++; return have.body; }
    await this.ensureMeta();
    await this.ensureWindows([stop], now);
    const w = this.win.get(stop);
    if (!w || !w.cand) { this.boards.set(bk, { at: now, body: null }); return null; }
    // Live data for the trips this board needs that the shard does not hold yet.
    const need = this.tripsFor([stop], now);
    for (const [feed, trips] of need) {
      const e = this.live.get(feed);
      if (e && now - e.at < 30000) for (const t of [...trips.keys()]) if (e.trips.has(t)) trips.delete(t);
      if (!trips.size) need.delete(feed);
    }
    if (need.size) await this.fetchLive(need, true).catch(() => false);
    const body = this.build(this.source(), bk, Date.now(), true);
    if (body && body.includes('"learn":true')) { this.boards.delete(bk); return body; } // not cached with the flag
    if (body) { const p = this.putCache([[bk, body]]); this.state.waitUntil ? this.state.waitUntil(p) : await p; }
    return body;
  }
  async ensureAlarm() {
    if (this.alarmSet) return;
    const a = await this.state.storage.getAlarm();
    if (!a) await this.state.storage.setAlarm(Date.now() + ENGINE_SHARD_TICK_MS);
    this.alarmSet = true;
  }
  async alarm() {
    this.alarmSet = true;
    const t0 = Date.now();
    try { await this.tick(); } catch (e) { this.stats.lastError = String((e && e.message) || e); } finally {
      // With feed timing, the next beat is just after the core expects its next feed copy (1 to 5 s away).
      const next = Number.isFinite(this.nextCopy) && this.nextCopy > Date.now() ? this.nextCopy : Infinity;
      if (Date.now() - this.lastRead < ENGINE_IDLE_MS) await this.state.storage.setAlarm(Math.max(Date.now() + 1000, Math.min(t0 + ENGINE_SHARD_TICK_MS, next)));
      else this.alarmSet = false;
    }
  }
  status() {
    let trips = 0;
    for (const e of this.live.values()) trips += e.tu.size;
    return { role: "shard", code: ENGINE_SHARD_GEN + 2, name: this.name, boots: this.boots, bootAt: this.bootAt, hotBoards: this.hot.size, windows: this.win.size, liveTrips: trips, ver: this.meta ? this.meta.ver : 0, lastBuildAgeS: this.lastBuild ? Math.round((Date.now() - this.lastBuild) / 1000) : null, ...this.stats };
  }
  async fetch(req) {
    const u = new URL(req.url);
    if (u.searchParams.get("name")) this.name = u.searchParams.get("name");
    try {
      if (u.pathname === "/board") {
        await this.ensureAlarm();
        const body = await this.board(u.searchParams.get("stop") || "", u.searchParams.get("mode") || "");
        this.stats.served++;
        if (!body) return new Response('{"error":"no timetable for this stop"}', { status: 404, headers: { "content-type": "application/json" } });
        return new Response(body, { headers: { "content-type": "application/json" } });
      }
      if (u.pathname === "/touch") {
        await this.ensureAlarm();
        this.mark((u.searchParams.get("stop") || "") + "|" + (u.searchParams.get("mode") || ""), Date.now());
        return new Response(null, { status: 204 });
      }
      if (u.pathname === "/ws") return await this.openSocket(req, u);
      if (u.pathname === "/status") return Response.json({ ...this.status(), openSockets: (() => { try { return this.state.getWebSockets().length; } catch (e) { return 0; } })() });
      if (u.pathname === "/restart" && req.method === "POST") {
        setTimeout(() => { try { this.state.abort("restart"); } catch (e) { /* not available */ } }, 50);
        return Response.json({ restarting: true, name: this.name });
      }
      return new Response("not found", { status: 404 });
    } catch (e) {
      return Response.json({ error: String((e && e.message) || e) }, { status: 500 });
    }
  }
}

// Push diffs (ENGINE_PUSH): a board's rows keyed by service (trip, stop, planned time). What the phones hold is
// { builtAt, rows: key -> row JSON, order }; a diff names the builtAt it applies to (base), the rows that changed or are
// new, the keys gone, the new order when it changed, and the board without its rows (head). A phone whose board is not
// at base sends "full" and gets the whole board.
function engPushKey(it) { return (it.tripId || it.line) + "|" + it.stopId + "|" + it.planned; }
function engPushDiff(prev, board) {
  const rows = new Map(), order = [];
  for (const it of board.items || []) { const k = engPushKey(it); if (rows.has(k)) continue; rows.set(k, JSON.stringify(it)); order.push(k); }
  const state = { builtAt: (board.engine && board.engine.builtAt) || 0, rows, order };
  if (!prev) return { state, msg: null };
  const changed = {};
  let n = 0;
  for (const [k, j] of rows) if (prev.rows.get(k) !== j) { changed[k] = JSON.parse(j); n++; }
  const gone = [];
  for (const k of prev.rows.keys()) if (!rows.has(k)) gone.push(k);
  const sameOrder = order.length === prev.order.length && order.every((k, i) => k === prev.order[i]);
  if (!n && !gone.length && sameOrder) { state.builtAt = prev.builtAt; return { state, msg: null }; }
  const head = { ...board };
  delete head.items;
  return { state, msg: { type: "diff", base: prev.builtAt, builtAt: state.builtAt, head, rows: changed, gone, ...(sameOrder ? {} : { order }) } };
}

// Feed timing (26 Oct, g14, root's steer): each feed's copies carry the time NSW made them (the GTFS realtime header
// timestamp). The last 8 distinct header times give the feed's period (the median gap, 5 to 120 s); the next copy is
// expected one period after the last, and is asked for ENGINE_PUBLISH_LAG_MS after that. Off unless
// ENGINE_FEED_TIMING is "on".
const ENGINE_PUBLISH_LAG_MS = 2000;
function engTimingOn(env) { return String((env && env.ENGINE_FEED_TIMING) || "").toLowerCase() === "on"; }
function engNotePublish(f, headerTs) {
  if (!headerTs) return;
  if (!f.hdrs) f.hdrs = [];
  if (f.hdrs[f.hdrs.length - 1] === headerTs) return;
  f.hdrs.push(headerTs);
  if (f.hdrs.length > 8) f.hdrs.shift();
  const gaps = [];
  for (let i = 1; i < f.hdrs.length; i++) { const g = f.hdrs[i] - f.hdrs[i - 1]; if (g > 0) gaps.push(g); }
  if (gaps.length >= 3) { gaps.sort((a, b) => a - b); f.period = Math.min(120, Math.max(5, gaps[Math.floor(gaps.length / 2)])) * 1000; }
}
function engNextPublish(f) {
  if (!f.period || !f.hdrs || !f.hdrs.length) return null;
  return f.hdrs[f.hdrs.length - 1] * 1000 + f.period + ENGINE_PUBLISH_LAG_MS;
}

// ---------- worker side ----------
// The object's name. A running object can keep its old code across deploys while its alarm keeps it busy; a new
// name starts a new object (load the timetable into it), and /api/engine/load/restart resets the current one.
const ENGINE_OBJECT = "nsw-2";
function engineStub(env) {
  if (!env || !env.ENGINE) return null;
  return env.ENGINE.get(env.ENGINE.idFromName(ENGINE_OBJECT), { locationHint: "oc" });
}
// Whether /api/departures answers from the engine: ENGINE_BOARDS "on", or engine=1 on the request (checks).
function engineWanted(env, url) {
  const q = url.searchParams.get("engine");
  if (q === "0") return false;
  if (q === "1") return true;
  return String(env.ENGINE_BOARDS || "").toLowerCase() === "on";
}
// The shard that builds a stop's board (BoardShard): ENGINE_SHARDS objects (16 unless set; "0" builds every board in the
// core object as before).
function engineShards(env) { const n = env && env.ENGINE_SHARDS != null && env.ENGINE_SHARDS !== "" ? Number(env.ENGINE_SHARDS) : ENGINE_SHARDS_DEFAULT; return env && env.SHARDS && n > 0 ? Math.min(64, Math.floor(n)) : 0; }
// A running object can keep its old code across a deploy while its alarm keeps it busy (seen 26 Oct: a shard kept
// its 02:06 code after the 02:20 deploy). /api/engine/load/restart-shards restarts them all; a new generation letter
// starts new objects.
const ENGINE_SHARD_GEN = "b";
function engShardName(i) { return ENGINE_OBJECT + "-" + ENGINE_SHARD_GEN + i; }
function engineShardStub(env, stop) {
  const n = engineShards(env);
  if (!n) return null;
  const i = engShardOf(stop, n);
  const name = engShardName(i);
  return { name, stub: env.SHARDS.get(env.SHARDS.idFromName(name), { locationHint: "oc" }) };
}
const engMem = new Map(); // board key -> { at, text } for this isolate, 2 s
const engTouched = new Map(); // board key -> when this isolate last told the shard the board is still read
// A board from the engine as JSON text, or null when the engine has no timetable for this stop (or is off).
// Boards are shared through Cloudflare's cache for ENGINE_EDGE_S seconds, so 10,000 phones at one stop make one
// request to the engine every few seconds per Cloudflare location.
const ENGINE_EDGE_S = 4;
const ENGINE_STALE_MS = 60000; // older engine boards fall back to the Trip Planner
const ENGINE_HOLD_MS = 10 * 60000; // ...but are still served when the Trip Planner refuses or fails, up to this old
async function engineBoard(env, ctx, stop, mode) {
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(stop || "")) return null;
  const sh = engineShardStub(env, stop);
  const stub = sh ? sh.stub : engineStub(env);
  if (!stub) return null;
  const bk = stop + "|" + (mode || "");
  const now = Date.now();
  const mem = engMem.get(bk);
  if (mem && now - mem.at < 2000) return mem.text;
  const ck = engCacheKey(stop, mode);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    try {
      const hit = await cache.match(ck);
      if (hit) {
        const text = await hit.text();
        engMem.set(bk, { at: now, text });
        // Served from the cache, the shard never sees this read: tell it once a minute that the board is still read,
        // so it keeps building it.
        if (sh && now - (engTouched.get(bk) || 0) > 60000) {
          engTouched.set(bk, now);
          if (engTouched.size > 5000) engTouched.clear();
          const t = stub.fetch("https://engine/touch?stop=" + encodeURIComponent(stop) + "&mode=" + encodeURIComponent(mode || "") + "&name=" + sh.name).catch(() => null);
          if (ctx && ctx.waitUntil) ctx.waitUntil(t);
        }
        return text || null;
      }
    } catch (e) { /* no cache here */ }
  }
  const r = await stub.fetch("https://engine/board?stop=" + encodeURIComponent(stop) + "&mode=" + encodeURIComponent(mode || "") + (sh ? "&name=" + sh.name : ""));
  const text = r.status === 200 ? await r.text() : "";
  if (r.status !== 200 && r.status !== 404) return null;
  if (sh) engTouched.set(bk, now);
  if (engMem.size > 2000) engMem.clear();
  // The learn flag is for this one answer only.
  const shared = text.replace(',"learn":true', "");
  engMem.set(bk, { at: now, text: shared });
  if (cache) {
    const put = cache.put(ck, new Response(shared, { headers: { "content-type": "application/json", "cache-control": "public, max-age=" + ENGINE_EDGE_S } })).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(put);
  }
  return text || null;
}
// Platform names from a Trip Planner board, sent to the engine at most once an hour per stop from this isolate.
const engLearnt = new Map();
function engineLearn(env, ctx, board) {
  const stub = engineStub(env);
  if (!stub || !board || !Array.isArray(board.items)) return;
  const now = Date.now(), pairs = [];
  for (const it of board.items) {
    if (!it.stopId || !it.platform || it.platformChangedFrom) continue;
    const k = it.stopId + "|" + it.platform;
    if (now - (engLearnt.get(k) || 0) < 3600000) continue;
    engLearnt.set(k, now); pairs.push([String(it.stopId), String(it.platform)]);
  }
  if (engLearnt.size > 5000) engLearnt.clear();
  // The lines of the next 90 minutes, once in 10 minutes per stop from this isolate, so the engine can tell a stop
  // with services missing from our bundles (checkGap).
  const stop = board.stop && board.stop.id ? String(board.stop.id) : "";
  let lines = null;
  if (stop && now - (engLearnt.get("lines|" + stop) || 0) > 600000) {
    engLearnt.set("lines|" + stop, now);
    lines = [...new Set(board.items.filter((i) => i.line && !i.cancelled && Date.parse(i.planned) < now + ENGINE_HORIZON_MS).map((i) => String(i.line)))];
  }
  if (!pairs.length && !lines) return;
  const p = stub.fetch("https://engine/learn", { method: "POST", body: JSON.stringify(lines ? { pairs, lines: { stop, lines } } : pairs) }).catch(() => null);
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
}
// GET /api/live?stop=ID[&mode=] with Upgrade: websocket (ENGINE_PUSH "on", else 404): the board's shard answers the
// upgrade, sends the whole board, then a diff (engPushDiff) each time it rebuilds the board. The HTTP board stays the
// fallback; a phone sends "full" for the whole board again and "ping" to check the line.
async function engineSocket(request, env, url) {
  const hdr = { "content-type": "application/json", "access-control-allow-origin": "*" };
  if (String((env && env.ENGINE_PUSH) || "").toLowerCase() !== "on") return new Response('{"error":"not available"}', { status: 404, headers: hdr });
  if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") return new Response('{"error":"websocket only"}', { status: 426, headers: hdr });
  const stop = url.searchParams.get("stop") || "", mode = url.searchParams.get("mode") || "";
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(stop) || (mode && !/^[a-z]{1,12}$/.test(mode))) return new Response('{"error":"bad stop"}', { status: 400, headers: hdr });
  const sh = engineShardStub(env, stop);
  if (!sh) return new Response('{"error":"not available"}', { status: 404, headers: hdr });
  return sh.stub.fetch("https://engine/ws?stop=" + encodeURIComponent(stop) + "&mode=" + encodeURIComponent(mode) + "&name=" + sh.name, request);
}
async function engineCall(env, path, init) {
  const stub = engineStub(env);
  if (!stub) return Response.json({ error: "engine not configured" }, { status: 503 });
  return stub.fetch("https://engine" + path, init);
}

export { BoardEngine, BoardShard };
