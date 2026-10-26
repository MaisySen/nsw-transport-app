// ---------- Saved trip alerts (roadmap item 6, docs/FEATURES.md, docs/API.md /api/trip-alerts) ----------
// A push only when a service alert or planned work touches one of the trips the phone has on Home (saved trips,
// Home and Work, the usual commute), and only near the time it matters. Nothing for other lines or stops.
//
// The phone sends its trips once when the switch is turned on and again when they change (POST /api/trip-alerts):
// for each trip its name, the legs of the services its Home card shows (line, mode, where it boards and gets off)
// and the times it is travelled (its trip reminders and morning checks). Stored as one row in meta ("ta:<device>"),
// so there is no new table. The minute tick, one minute after the service alerts digest is refreshed (every
// ALERT_EVERY_MIN minutes), matches the digest against every phone's trips here on the server, so the phone polls
// nothing and makes no request in the background. It makes no Transport for NSW call (the digest is already read).
//
// Matching, per leg: an alert naming the leg's line touches it when it lists no stops (the whole line) or lists a
// station the leg passes between where it boards and where it gets off (stations in running order from
// data/lineorder.json for trains, metro, light rail and ferries, the route's stop list for buses); an alert naming
// no line touches it when it lists the stop where the leg boards or gets off.
//
// When: a live problem (delays, fewer services, a detour) is sent from TA_LEAD_MIN before one of the trip's times to
// TA_SPAN_MIN after it, once per alert per day; a trip with no times gets none. Planned work is sent once, from
// TA_EVE_TOD the evening before the first time it touches (a trip with no times: the evening before the work
// starts). Nothing is sent between 10pm and 6am unless it is inside a travel time. Several at once are one push.
const TA_MAX_TRIPS = 8, TA_MAX_LEGS = 8, TA_MAX_TIMES = 12;
const TA_LEAD_MIN = 60, TA_SPAN_MIN = 120, TA_EVE_TOD = 18 * 60, TA_QUIET_FROM = 22 * 60, TA_QUIET_TO = 6 * 60;
const TA_AHEAD_DAYS = 8, TA_KEEP_SENT_MS = 10 * 86400000, TA_PER_TICK = 400;
const TA_RAIL = new Set(["train", "metro", "lightrail", "ferry"]);
const TA_DAY_MS = 86400000;

/** The trips a phone sends, kept to what matching needs. times: d = days (0 Sunday to 6 Saturday), m = minute of day. */
function taClean(list) {
  const id = (s) => cleanId(s, 20);
  const out = [];
  for (const t of Array.isArray(list) ? list.slice(0, TA_MAX_TRIPS) : []) {
    if (!t || typeof t !== "object") continue;
    const legs = (Array.isArray(t.legs) ? t.legs : []).slice(0, TA_MAX_LEGS)
      .map((l) => ({ l: String((l && l.l) || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 8), m: String((l && l.m) || "").replace(/[^a-z]/g, "").slice(0, 10), f: id(l && l.f), t: id(l && l.t) }))
      .filter((l) => l.l && l.f && l.t);
    const times = (Array.isArray(t.times) ? t.times : []).slice(0, TA_MAX_TIMES)
      .map((x) => ({ d: [...new Set((Array.isArray(x && x.d) ? x.d : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(), m: Math.floor(Number(x && x.m)) }))
      .filter((x) => x.d.length && x.m >= 0 && x.m < 1440);
    if (!legs.length) continue;
    out.push({ n: String(t.n || "").replace(/[\u0000-\u001f]/g, "").slice(0, 60) || "Your trip", f: id(t.f), t: id(t.t), legs, times });
  }
  return out;
}

/** Stations a leg passes, ends included: every running order of the line that has the boarding stop before the stop off. */
function taPathOf(orders, f, t) {
  const out = new Set([f, t]);
  for (const o of orders || []) {
    const i = o.indexOf(f);
    if (i < 0) continue;
    const j = o.indexOf(t, i + 1);
    if (j < 0) continue;
    for (let k = i; k <= j; k++) out.add(o[k]);
  }
  return out;
}
async function taLegPath(env, leg, lo, memo) {
  const norm = (s) => (lo.parent && lo.parent[s]) || s;
  const f = norm(leg.f), t = norm(leg.t);
  const k = [leg.l, leg.m, f, t].join("|");
  if (memo && memo.has(k)) return memo.get(k);
  let orders = lo.lines && lo.lines[leg.l];
  if (!orders && !TA_RAIL.has(leg.m)) {
    const file = await askAsset(env, null, "/stations/bus/" + leg.l.slice(0, 2).replace(/[^A-Z0-9]/gi, "_") + ".json");
    const dirs = file && !Array.isArray(file) ? file[leg.l] : null;
    orders = (Array.isArray(dirs) ? dirs : dirs ? [dirs] : []).map((d) => ((d && d.stops) || []).map((s) => String(s[0])));
  }
  const path = taPathOf(orders || [], f, t);
  if (memo) memo.set(k, path);
  return path;
}

/** The digest items (alertDigest) that touch a trip. paths[i] is the station set of leg i (taLegPath). */
function taHits(items, trip, paths, parent = {}) {
  const out = [];
  for (const it of items || []) {
    const lines = it.l || [], stops = new Set();
    for (const s of it.s || []) { stops.add(s); if (parent[s]) stops.add(parent[s]); }
    const leg = trip.legs.findIndex((lg, i) => {
      if (lines.includes(lg.l)) return !stops.size || [...paths[i]].some((s) => stops.has(s));
      if (lines.length) return false;
      return stops.has(lg.f) || stops.has(lg.t) || stops.has(parent[lg.f] || "") || stops.has(parent[lg.t] || "");
    });
    if (leg >= 0) out.push({ id: it.id, title: it.h, url: it.u || null, planned: !!it.pl, effect: it.e || "", periods: it.p || [], line: trip.legs[leg].l });
  }
  return out;
}

// Epoch ms of minute `tod` on the Sydney day `k` days after the day of `base`.
function taDayAt(base, k, tod) {
  const sn = sydneyNow(base);
  const b = base - (base % 60000);
  const guess = b + k * TA_DAY_MS + (tod - sn.tod) * 60000;
  return guess + (sydOffsetMin(b) - sydOffsetMin(guess)) * 60000;
}
/** Start times of the trip's travel times from yesterday to TA_AHEAD_DAYS ahead, in order. */
function taOccurrences(times, now) {
  const sn = sydneyNow(now);
  const today = sn.dow % 7; // 0 Sunday
  const out = [];
  for (let k = -1; k <= TA_AHEAD_DAYS; k++) {
    const dow = (((today + k) % 7) + 7) % 7;
    for (const x of times || []) if (x.d.includes(dow)) out.push(taDayAt(now, k, x.m));
  }
  return out.sort((a, b) => a - b);
}
function taActive(periods, a, b) {
  if (!periods || !periods.length) return true;
  return periods.some(([s, e]) => s < b && (!e || e > a));
}
/** The key to send this hit under now (marks it sent), or null when it is not due or was already sent. */
function taDue(hit, trip, now, sent = {}) {
  const tod = sydneyNow(now).tod;
  const quiet = tod >= TA_QUIET_FROM || tod < TA_QUIET_TO;
  const occ = taOccurrences(trip.times, now);
  const inTime = occ.some((o) => now >= o - TA_LEAD_MIN * 60000 && now <= o + TA_SPAN_MIN * 60000);
  if (!hit.planned) {
    for (const o of occ) {
      if (now < o - TA_LEAD_MIN * 60000 || now > o + TA_SPAN_MIN * 60000) continue;
      if (!taActive(hit.periods, o - TA_LEAD_MIN * 60000, o + TA_SPAN_MIN * 60000)) continue;
      const key = hit.id + "|" + sydneyNow(o).day;
      return sent[key] ? null : key;
    }
    return null;
  }
  if (sent[hit.id]) return null;
  let start = null;
  if (occ.length) start = occ.find((o) => o + TA_SPAN_MIN * 60000 >= now && taActive(hit.periods, o, o + TA_SPAN_MIN * 60000)) ?? null;
  else {
    const per = hit.periods && hit.periods.length ? hit.periods : [[now, 0]];
    for (const [s, e] of per) {
      if (e && e <= now) continue;
      const at = Math.max(s, now);
      if (at < now + TA_AHEAD_DAYS * TA_DAY_MS && (start == null || at < start)) start = at;
    }
  }
  if (start == null) return null;
  if (now < taDayAt(start, -1, TA_EVE_TOD)) return null;
  if (quiet && !inTime) return null;
  return hit.id;
}
const TA_WORDS = { delays: "Delays", reduced: "Fewer services", detour: "Detour", modified: "Service changes", stopMoved: "Stop moved", none: "Service alert" };
function taWord(h) { return h.planned ? "Planned work" : TA_WORDS[h.effect] || "Service alert"; }
/** One push for everything due on one phone at once. */
function taText(due) {
  const first = due[0];
  const title = due.length === 1 ? `${first.trip.n}: ${taWord(first.hit)}` : `${due.length} changes on your trips`;
  const more = due.length > 1 ? ` And ${due.length - 1} more.` : "";
  return { title: wordCut(title, 80), body: wordCut(`${String(first.hit.title || "").replace(/[.\s]+$/, "")}.${more}`, 240) };
}

async function taTripHits(env, items, trip, lo, memo) {
  const paths = [];
  for (const leg of trip.legs) paths.push(await taLegPath(env, leg, lo, memo));
  return taHits(items, trip, paths, lo.parent || {});
}

/** Minute tick: every phone's trips against the digest; sends what is due. */
async function processTripAlerts(env, now = Date.now(), opts = {}) {
  const dg = await alertDigest(env);
  const items = dg.items || [];
  const rows = await d1all(env, "SELECT k, v FROM meta WHERE k >= 'ta:' AND k < 'ta;' LIMIT ?1", TA_PER_TICK);
  if (!items.length || !rows.length) return { phones: rows.length, sent: 0 };
  const lo = (await facData(env, "lineorder")) || { lines: {}, parent: {} };
  const memo = new Map();
  let sent = 0;
  for (const row of rows) {
    let reg;
    try { reg = JSON.parse(row.v); } catch (e) { continue; }
    const marks = reg.sent || {};
    const due = [], keys = new Set();
    for (const trip of reg.trips || []) {
      for (const hit of await taTripHits(env, items, trip, lo, memo)) {
        const key = taDue(hit, trip, now, marks);
        if (key && !keys.has(key)) { keys.add(key); due.push({ trip, hit, key }); }
      }
    }
    if (!due.length) continue;
    const n = taText(due);
    await (opts.notify || notify)(env, { device: row.k.slice(3) }, { title: n.title, body: n.body, url: "/", tag: "ta", ttl: 3 * 3600 }).catch(() => null);
    sent++;
    for (const d of due) marks[d.key] = now;
    for (const [k, at] of Object.entries(marks)) if (at < now - TA_KEEP_SENT_MS) delete marks[k];
    reg.sent = marks;
    await db(env).prepare("UPDATE meta SET v = ?2 WHERE k = ?1").bind(row.k, JSON.stringify(reg)).run().catch(() => null);
  }
  return { phones: rows.length, sent };
}

/**
 * GET /api/trip-alerts?device=   whether this phone has trip alerts on, and what touches its trips now.
 * POST /api/trip-alerts { device, profile, on, trips }   on false (or no trips) turns them off and deletes the row.
 * The first time it is turned on, what already touches the trips is answered here and not pushed.
 */
async function tripAlertsRoute(request, env, url) {
  await ensureSchema3(env);
  const enabled = await serverOn(env, "tripAlerts");
  const now = Date.now();
  const nowList = async (trips) => {
    const items = (await alertDigest(env)).items || [];
    const lo = (await facData(env, "lineorder")) || { lines: {}, parent: {} };
    const memo = new Map(), out = [];
    for (const trip of trips) for (const h of await taTripHits(env, items, trip, lo, memo)) out.push({ trip: trip.n, id: h.id, title: h.title, url: h.url, planned: h.planned });
    return out;
  };
  if (request.method === "GET") {
    const dev = cleanId(url.searchParams.get("device"));
    const r = dev.length >= 8 ? await db(env).prepare("SELECT v FROM meta WHERE k = ?1").bind("ta:" + dev).first() : null;
    const reg = r ? JSON.parse(r.v) : null;
    return json({ on: !!reg, enabled, trips: reg ? reg.trips.length : 0, now: reg ? await nowList(reg.trips) : [] });
  }
  if (request.method !== "POST") return json({ error: "method" }, 405);
  const b = await request.json().catch(() => ({}));
  const dev = cleanId(b.device);
  if (dev.length < 8) return json({ error: "device needed" }, 400);
  const trips = b.on === false ? [] : taClean(b.trips);
  if (!trips.length) { await db(env).prepare("DELETE FROM meta WHERE k = ?1").bind("ta:" + dev).run(); return json({ ok: true, on: false, enabled }); }
  const old = await db(env).prepare("SELECT v FROM meta WHERE k = ?1").bind("ta:" + dev).first();
  let sent = {};
  try { sent = old ? JSON.parse(old.v).sent || {} : {}; } catch (e) { sent = {}; }
  const list = await nowList(trips);
  if (!old) for (const h of list) sent[h.planned ? h.id : h.id + "|" + sydneyNow(now).day] = now;
  const reg = { v: 1, profile: profileId(b.profile), trips, sent, at: now };
  await db(env).prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?1, ?2)").bind("ta:" + dev, JSON.stringify(reg)).run();
  return json({ ok: true, on: true, enabled, trips: trips.length, now: list.slice(0, 10) });
}
