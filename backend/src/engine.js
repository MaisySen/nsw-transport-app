
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
const ENGINE_SLOW_FEED_MS = 30000;     // regional bus feeds
const ENGINE_FEED_HOT_MS = 5 * 60000;  // a feed is fetched while a board needed it this recently
const ENGINE_BOARD_HOT_MS = 5 * 60000; // a board is rebuilt every tick while read this recently
const ENGINE_IDLE_MS = 15 * 60000;     // no reads for this long: the alarm stops until the next read
const ENGINE_HORIZON_MS = 90 * 60000;  // boards cover the next 90 minutes
const ENGINE_LOOKBACK_MS = 120 * 60000; // a service planned up to 2 hours ago can still be running late
const ENGINE_MAX_ROWS = 60;
const ENGINE_DAILY_BUDGET = 30000;     // feed calls a day the engine aims to stay under (ENGINE_BUDGET overrides)
const ENGINE_HOT_MAX = 3000;

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

// Delay in seconds that a trip update gives for one stop (departure first), or null.
function engDelay(u) {
  if (!u) return null;
  if (u.dep && u.dep.delay != null) return u.dep.delay;
  if (u.arr && u.arr.delay != null) return u.arr.delay;
  return null;
}
function engTime(u) {
  if (u && u.dep && u.dep.time) return u.dep.time * 1000;
  if (u && u.arr && u.arr.time) return u.arr.time * 1000;
  return null;
}

// What the live trip update says about one timetabled stop of a trip.
// seqOf(stopId) gives the timetable stop sequence for a stop of this trip (updates from feeds without sequences).
// Returns null (no live data), { cancelled }, { skipped }, or { est, delay, stopId } with stopId set when the
// service now uses another platform of the same station.
function engLive(tu, row, seqOf) {
  if (!tu) return null;
  if (tu.rel === 3) return { cancelled: true };
  const stus = tu.stus || [];
  if (!stus.length) return tu.delay != null ? { est: row.planned + tu.delay * 1000, delay: tu.delay } : null;
  let exact = null, before = null, beforeSeq = -1, after = false;
  for (const u of stus) {
    const sq = u.seq != null ? u.seq : (seqOf ? seqOf(u.stopId) : null);
    if (u.stopId === row.stopId || (sq != null && sq === row.seq)) { exact = u; break; }
    if (sq != null && sq < row.seq && sq > beforeSeq) { before = u; beforeSeq = sq; }
    if (sq != null && sq > row.seq) after = true;
  }
  if (exact) {
    if (exact.rel === 1) return { skipped: true };
    if (exact.rel === 2) return null;
    const t = engTime(exact), d = engDelay(exact);
    const est = t || (d != null ? row.planned + d * 1000 : null);
    if (est == null) return null;
    const out = { est, delay: d != null ? d : Math.round((est - row.planned) / 1000) };
    if (exact.stopId && exact.stopId !== row.stopId) out.stopId = exact.stopId;
    return out;
  }
  // No update for this stop: the last update before it carries on down the line (GTFS realtime rule).
  if (before && before.rel !== 2) {
    const d = engDelay(before);
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
function engBuildBoard(src, stopId, opts = {}) {
  const now = opts.now || Date.now();
  const me = src.stop(stopId);
  if (!me) return null;
  const ids = [stopId, ...src.children(stopId)];
  // A platform's own board stays on that platform; a station's board covers all its platforms and stands.
  const idSet = new Set(ids);
  const days = src.days();
  const from = now - ENGINE_LOOKBACK_MS, to = now + (opts.horizonMs || ENGINE_HORIZON_MS);
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
        cand.push({ planned, tripId: r[1], ri: r[2], hi: r[3], seq: r[4], stopId: id, day: dk });
      }
    }
  }
  if (!covered) return null; // no timetable for this stop: the caller asks the Trip Planner instead
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
      ...(live && live.skipped ? { skipped: true } : {}),
      ...(feed === "ferry_mff" || feed === "nswtrains" || /^rb_/.test(feed) ? { feed } : {}),
    };
    const vp = src.vp(feed, c.tripId);
    const veh = vp ? vehicleOf(vp) : null;
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
    const feed = route[3];
    if (opts.mode && !(modeOf(route[1]).key === opts.mode || (opts.mode === "bus" && modeOf(route[1]).key === "coach"))) continue;
    feedsUsed.add(feed);
    const tu = src.tu(feed, c.tripId);
    if (tu && tu.startDate && tu.startDate !== c.day) { items.push(mk(c, route, null)); continue; }
    const live = engLive(tu, c, (s) => { const m = src.tripSeq(feed, c.tripId); return m ? m.get(s) : null; });
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
      const c = { planned: t - d * 1000, tripId: tu.tripId, ri, hi: -1, seq: u.seq || 0, stopId: u.stopId, day: engDayKey(t), dest: last ? engPlaceName(last[0]) : "" };
      items.push(mk(c, src.route(ri), { est: t, delay: d }));
    }
  }
  const t0 = (i) => Date.parse(i.estimated || i.planned);
  let list = items.filter((i) => t0(i) >= now - 45000 && Date.parse(i.planned) <= to);
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
    this.stopMem = new Map(); this.kidsMem = new Map(); this.rowMem = new Map(); this.seqMem = new Map();
    this.meta = null; this.lastRead = 0; this.alarmSet = false;
    this.stats = { calls: 0, refused: 0, ticks: 0, built: 0, served: 0, cacheHits: 0, tickMs: 0, day: engDayKey(Date.now()), dayCalls: 0 };
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
  dropMem() { this.meta = null; this.stopMem.clear(); this.kidsMem.clear(); this.rowMem.clear(); this.seqMem.clear(); this.boards.clear(); }
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
        if (self.rowMem.size > 6000) self.rowMem.clear();
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
      needFeed(feed) { self.want(feed); },
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
  async fetchFeed(path, kind) {
    const res = await fetch(API + path, { headers: { Authorization: "apikey " + apiKey(this.env) }, signal: AbortSignal.timeout(8000) });
    this.stats.calls++; this.stats.dayCalls++;
    if (!res.ok) { this.stats.refused++; throw new Error("feed " + path + " " + res.status); }
    const buf = new Uint8Array(await res.arrayBuffer());
    const { idx, headerTs } = indexFeed(buf, kind);
    return { at: Date.now(), buf, idx, headerTs, kind, cache: new Map() };
  }
  // One refresh per feed at a time: a crowd of first reads waits for the same fetch.
  refreshFeed(key, f, now, force) {
    if (f.pending) return f.pending;
    f.pending = this.refreshFeedNow(key, f, now, force).finally(() => { f.pending = null; });
    return f.pending;
  }
  async refreshFeedNow(key, f, now, force) {
    const def = FEEDS[key];
    if (!def) return;
    const k = this.stretch(now);
    const tuEvery = (/^rb_/.test(key) ? ENGINE_SLOW_FEED_MS : ENGINE_TICK_MS) * k;
    const jobs = [];
    if (force || now - f.tuAt >= tuEvery - 1500) {
      f.tuAt = now;
      jobs.push(this.fetchFeed(def.tu, "tu").then((e) => {
        f.tu = e; f.fails = 0;
        // Added services are few: decode them once per copy so boards can list them.
        const added = [];
        if (e.idx.size < 2500) for (const id of e.idx.keys()) { const tu = decodeFrom(e, id); if (tu && tu.rel === 1) added.push(tu); }
        f.added = added;
      }).catch(() => { f.fails++; }));
    }
    if (force || now - f.vpAt >= ENGINE_VP_MS * k - 1500) {
      f.vpAt = now;
      jobs.push(this.fetchFeed(def.vp, "vp").then((e) => { f.vp = e; }).catch(() => {}));
    }
    await Promise.all(jobs);
  }
  async tick() {
    const t0 = Date.now();
    this.stats.ticks++;
    const jobs = [];
    for (const [key, f] of this.feeds) if (t0 - f.wantAt < ENGINE_FEED_HOT_MS) jobs.push(this.refreshFeed(key, f, t0, false));
    await Promise.all(jobs);
    const src = this.source();
    for (const [bk, at] of this.hot) {
      if (t0 - at > ENGINE_BOARD_HOT_MS) { this.hot.delete(bk); this.boards.delete(bk); continue; }
      this.build(src, bk);
    }
    this.kvSet("calls", JSON.stringify({ day: this.stats.day, n: this.stats.dayCalls }));
    this.stats.tickMs = Date.now() - t0;
  }
  build(src, bk) {
    const [stop, mode] = bk.split("|");
    const b = engBuildBoard(src, stop, { mode: mode || null });
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
    try { if (this.loadMeta()) await this.tick(); } finally {
      if (Date.now() - this.lastRead < ENGINE_IDLE_MS) await this.state.storage.setAlarm(Date.now() + ENGINE_TICK_MS);
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
    const probe = engBuildBoard(src, stop, { mode: mode || null });
    if (!probe) { this.boards.set(bk, { at: now, body: null }); return null; }
    const cold = probe.engine.feeds.filter((f) => { const x = this.feeds.get(f); return !x || !x.tu; });
    if (cold.length) {
      await Promise.race([Promise.all(cold.map((f) => this.refreshFeed(f, this.want(f), now, true))), new Promise((r) => setTimeout(r, 3000))]);
      src = this.source();
    }
    return this.build(src, bk);
  }
  status() {
    const m = this.loadMeta(), now = Date.now();
    const feeds = {};
    for (const [k, f] of this.feeds) feeds[k] = { tuAgeS: f.tu ? Math.round((now - f.tu.at) / 1000) : null, vpAgeS: f.vp ? Math.round((now - f.vp.at) / 1000) : null, trips: f.tu ? f.tu.idx.size : 0, added: (f.added || []).length, hot: now - f.wantAt < ENGINE_FEED_HOT_MS, fails: f.fails };
    return { ver: m ? m.ver : 0, builtAt: m ? m.builtAt : null, days: m ? Object.keys(m.days) : [], hotBoards: this.hot.size, stretch: Math.round(this.stretch(now) * 100) / 100, budget: this.budget(), ...this.stats, feeds };
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
      if (p === "/timetable") return Response.json(this.timetable(u.searchParams.get("stops") || "", Number(u.searchParams.get("days")) || 2));
      if (p === "/status") return Response.json(this.status());
      if (p === "/learn" && req.method === "POST") {
        const pairs = await req.json(); let n = 0;
        if (!this.platMem) this.source().plat("");
        for (const [stop, label] of Array.isArray(pairs) ? pairs.slice(0, 200) : []) {
          if (typeof stop !== "string" || typeof label !== "string" || !/^(Platform|Stand|Wharf) [A-Za-z0-9]{1,4}(, Side \w)?$/.test(label)) continue;
          if (this.platMem.get(stop) === label) continue;
          this.sql.exec("INSERT OR REPLACE INTO plat VALUES (?, ?, ?)", stop, label, Date.now()); this.platMem.set(stop, label); n++;
        }
        if (n) this.boards.clear();
        return Response.json({ n });
      }
      if (req.method !== "POST") return new Response("not found", { status: 404 });
      return await this.load(p, req);
    } catch (e) {
      return Response.json({ error: String(e && e.message || e) }, { status: 500 });
    }
  }
  // Loading a new timetable version: /load/begin, then stops, days and trips in parts, then /load/commit.
  async load(p, req) {
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

// ---------- worker side ----------
function engineStub(env) {
  if (!env || !env.ENGINE) return null;
  return env.ENGINE.get(env.ENGINE.idFromName("nsw"), { locationHint: "oc" });
}
// Whether /api/departures answers from the engine: ENGINE_BOARDS "on", or engine=1 on the request (checks).
function engineWanted(env, url) {
  const q = url.searchParams.get("engine");
  if (q === "0") return false;
  if (q === "1") return true;
  return String(env.ENGINE_BOARDS || "").toLowerCase() === "on";
}
const engMem = new Map(); // board key -> { at, text } for this isolate, 2 s
// A board from the engine as JSON text, or null when the engine has no timetable for this stop (or is off).
// Boards are shared through Cloudflare's cache for ENGINE_EDGE_S seconds, so 10,000 phones at one stop make one
// request to the engine every few seconds per Cloudflare location.
const ENGINE_EDGE_S = 4;
async function engineBoard(env, ctx, stop, mode) {
  const stub = engineStub(env);
  if (!stub || !/^[A-Za-z0-9_-]{1,20}$/.test(stop || "")) return null;
  const bk = stop + "|" + (mode || "");
  const now = Date.now();
  const mem = engMem.get(bk);
  if (mem && now - mem.at < 2000) return mem.text;
  const ck = new Request("https://engine-cache.transportsydney.app/board?stop=" + encodeURIComponent(stop) + "&mode=" + encodeURIComponent(mode || ""));
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    try {
      const hit = await cache.match(ck);
      if (hit) { const text = await hit.text(); engMem.set(bk, { at: now, text }); return text || null; }
    } catch (e) { /* no cache here */ }
  }
  const r = await stub.fetch("https://engine/board?stop=" + encodeURIComponent(stop) + "&mode=" + encodeURIComponent(mode || ""));
  const text = r.status === 200 ? await r.text() : "";
  if (r.status !== 200 && r.status !== 404) return null;
  if (engMem.size > 2000) engMem.clear();
  engMem.set(bk, { at: now, text });
  if (cache) {
    const put = cache.put(ck, new Response(text, { headers: { "content-type": "application/json", "cache-control": "public, max-age=" + ENGINE_EDGE_S } })).catch(() => {});
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
  if (!pairs.length) return;
  const p = stub.fetch("https://engine/learn", { method: "POST", body: JSON.stringify(pairs) }).catch(() => null);
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
}
async function engineCall(env, path, init) {
  const stub = engineStub(env);
  if (!stub) return Response.json({ error: "engine not configured" }, { status: 503 });
  return stub.fetch("https://engine" + path, init);
}

export { BoardEngine };
