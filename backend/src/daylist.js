
// ---------- Trip lists a day at a time from our own planner (OWN_PLANNER, off) ----------
// Written 27 Oct 2026 for the Plan tab's endless trip list: Bidur wants any A to B list to scroll a week either way
// and load faster than he scrolls. Asking Transport for NSW's Trip Planner gives 10 trips a call and a new pair waits
// 3 to 5 s on it. Here the list comes from our own timetable pack (raptor.js), a whole day at a time:
//  1. once per pair and pack, which lines connect A to B (dlTemplates): every pattern that calls at A and then at B,
//     plus the lines and changes of the fastest trips RAPTOR finds at times spread over the pack's day;
//  2. a day's trips by a scan of those patterns only (dlScan): each first service of the day that leaves A, then the
//     next service of each later line that can be caught at the change, with the same change and walk times as
//     RAPTOR; trips nobody would pick (another leaves no earlier, arrives no later, with no more changes) are dropped.
// A day's list runs from 3 AM to 3 AM the next day (Sydney), so two days put together have no gap and no repeat. The
// pack holds its own day and, since 27 Oct, every other day from the day before to a week ahead whose services are
// all among its day's (header daysHeld, tools/build_planner.py), so no bigger pack and no other load. The worker side
// (tripDayPage) puts live times, cancellations and added trains on, as for any trip answer. Appended after raptor.js
// by build.mjs (same module).

const DL_EDGE_S = 3 * 3600;          // a day's list starts at 3 AM
const DL_TAIL_S = 3 * 3600;          // trips leaving this long after the list's end still count when dropping trips
const DL_SAMPLES_S = [5, 6.5, 8, 9.5, 11, 12.5, 14, 15.5, 17, 18.5, 20.5, 22.5, 24.5].map((h) => Math.round(h * 3600));
const DL_TPL_MAX = 80;               // templates kept per pair
const DL_MEM_MAX = 400;              // pairs kept per object (their templates)
const DL_SCAN_AHEAD = 400;           // services looked at for one change before giving up

// The days the pack can list: { day: { off, dayStart } }. A pack built before 27 Oct lists its own day only.
function dlDaysHeld(pk) {
  if (pk.dlDays) return pk.dlDays;
  const out = {};
  const list = Array.isArray(pk.h.daysHeld) && pk.tripDays && pk.tripOff ? pk.h.daysHeld : [{ day: pk.day, off: 0, dayStart: pk.dayStart }];
  for (const d of list) if (d && /^\d{8}$/.test(String(d.day))) out[d.day] = { off: Number(d.off) || 0, dayStart: Number(d.dayStart) };
  if (!out[pk.day]) out[pk.day] = { off: 0, dayStart: pk.dayStart };
  pk.dlDays = out;
  return out;
}
function dlShiftDay(d, n) {
  const t = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8))) + n * 86400000;
  const x = new Date(t);
  return String(x.getUTCFullYear()) + String(x.getUTCMonth() + 1).padStart(2, "0") + String(x.getUTCDate()).padStart(2, "0");
}
// A Sydney service day's start in epoch seconds: noon minus 12 hours, as the pack and the board engine count.
function dlDayStart(d) {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(4, 6)) - 1, dd = Number(d.slice(6, 8));
  const f = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" });
  for (const h of [1, 2, 0, 3]) {
    const t = Date.UTC(y, m, dd, h);
    if (Number(f.format(new Date(t))) === 12) return t / 1000 - 12 * 3600;
  }
  return Date.UTC(y, m, dd, 2) / 1000 - 12 * 3600;
}
// Whether a day's list can be made: the day itself and the next one (its trips before 3 AM) must be held; the pack's
// own day always can (the pack has the next morning).
function dlCanList(pk, day) {
  const H = dlDaysHeld(pk);
  if (day === pk.day) return true;
  return !!(H[day] && (H[dlShiftDay(day, 1)] || dlShiftDay(day, 1) === pk.day));
}
// The trip instances of each service day a list needs, as { shift (seconds added to the pack's times), want(ti) }.
// The pack's own day: its own instances. Another held day: the pack day's instances whose trip runs that day, moved
// to that day. The day before and the next morning when not held: the instances the pack has for them (already moved).
function dlCopies(pk, day) {
  const H = dlDaysHeld(pk), off = pk.tripOff, mask = pk.tripDays, out = [];
  for (const d of [dlShiftDay(day, -1), day, dlShiftDay(day, 1)]) {
    if (d === pk.day) { out.push({ shift: 0, want: off ? (ti) => off[ti] === 1 : () => true }); continue; }
    const h = H[d];
    if (h && off && mask && h.off !== 0) {
      const bit = 1 << (h.off + 1), shift = h.dayStart - pk.dayStart;
      out.push({ shift, want: (ti) => off[ti] === 1 && (mask[ti] & bit) !== 0 });
      continue;
    }
    // Not held: the pack's own instances for the day before (0) or the next morning (2), when it has them.
    if (off && (d === dlShiftDay(pk.day, -1) || d === dlShiftDay(pk.day, 1))) {
      const want = d === dlShiftDay(pk.day, -1) ? 0 : 2;
      out.push({ shift: 0, want: (ti) => off[ti] === want });
    }
  }
  return out;
}

const dlStation = (pk, s) => (pk.parent[s] >= 0 ? pk.parent[s] : s);
const dlRouteOf = (pk, p) => pk.tripRoute[pk.patTripOff[p]];

// Which lines connect A to B: [{ legs: [{ r (route), a (board station), b (alight station) }] }]. Direct patterns
// from the pattern lists, the rest from RAPTOR at DL_SAMPLES_S across the pack's day.
function dlTemplates(pk, from, to, o = {}) {
  const fromW = new Map(from), toW = new Map(to);
  const seen = new Map();
  const add = (legs, n) => {
    const key = legs.map((l) => l.r + ":" + l.a + ":" + l.b).join("|");
    const had = seen.get(key);
    if (had) { had.n += n; return; }
    seen.set(key, { key, legs, n });
  };
  // Direct: a pattern through a start stop and later through an end stop.
  for (const [s] of from) {
    for (let e = pk.stopPatOff[s]; e < pk.stopPatOff[s + 1]; e++) {
      const p = pk.stopPat[e], i = pk.stopPatIdx[e], so = pk.patStopOff[p], ns = pk.patStopOff[p + 1] - so;
      for (let j = i + 1; j < ns; j++) {
        const t = pk.patStops[so + j];
        if (toW.has(t)) { add([{ r: dlRouteOf(pk, p), a: dlStation(pk, s), b: dlStation(pk, t) }], 1000); break; }
      }
    }
  }
  // Changes: the lines of RAPTOR's fastest trips through the day.
  let searches = 0;
  const times = o.at != null ? [...DL_SAMPLES_S, Number(o.at)] : DL_SAMPLES_S;
  for (const t of times) {
    searches++;
    const res = rpSearch(pk, from, to, t, {});
    for (const j of res) {
      const sv = j.legs.filter((l) => l.trip != null);
      if (sv.length < 2) continue;
      add(sv.map((l) => ({ r: pk.tripRoute[l.trip], a: dlStation(pk, l.from), b: dlStation(pk, l.to) })), 1);
    }
  }
  const list = [...seen.values()].sort((x, y) => x.legs.length - y.legs.length || y.n - x.n).slice(0, DL_TPL_MAX);
  for (const tpl of list) tpl.pats = dlTemplatePatterns(pk, tpl, fromW, toW);
  return { list: list.filter((t) => t.pats.every((x) => x.length)), searches };
}
// For each leg of a template: the (pattern, board position, alight position) it may use. The first leg boards at a
// start stop and the last gets off at an end stop; legs between board and get off at the stations RAPTOR used.
function dlTemplatePatterns(pk, tpl, fromW, toW) {
  const n = tpl.legs.length;
  return tpl.legs.map((l, x) => {
    const out = [];
    const boardOk = (s) => (x === 0 ? fromW.has(s) : true) && dlStation(pk, s) === l.a;
    const alightOk = (s) => (x === n - 1 ? toW.has(s) : true) && dlStation(pk, s) === l.b;
    const stops = [l.a];
    for (let e = pk.kidOff[l.a]; e < pk.kidOff[l.a + 1]; e++) stops.push(pk.kid[e]);
    const done = new Set();
    for (const s of stops) {
      if (!boardOk(s)) continue;
      for (let e = pk.stopPatOff[s]; e < pk.stopPatOff[s + 1]; e++) {
        const p = pk.stopPat[e], i = pk.stopPatIdx[e];
        if (dlRouteOf(pk, p) !== l.r || done.has(p + ":" + i)) continue;
        const so = pk.patStopOff[p], ns = pk.patStopOff[p + 1] - so;
        for (let j = i + 1; j < ns; j++) if (alightOk(pk.patStops[so + j])) { out.push([p, i, j]); done.add(p + ":" + i); break; }
      }
    }
    return out;
  });
}

// The services a template's leg may use between lo and hi (seconds after the pack's day start), by departure:
// { dep, arr, ti, i, j, bs, as, shift }.
function dlLegServices(pk, pats, copies, lo, hi) {
  const out = [];
  for (const [p, i, j] of pats) {
    const so = pk.patStopOff[p], ns = pk.patStopOff[p + 1] - so, ev = pk.patEvOff[p], t0 = pk.patTripOff[p], nt = pk.patTripOff[p + 1] - t0;
    const bs = pk.patStops[so + i], as = pk.patStops[so + j];
    for (const c of copies) {
      // Trips of a pattern leave in order, so the first one in range is found by halving.
      let a = 0, b = nt;
      while (a < b) { const m = (a + b) >> 1; if (pk.dep[ev + m * ns + i] + c.shift < lo) a = m + 1; else b = m; }
      for (let k = a; k < nt; k++) {
        const row = ev + k * ns, dep = pk.dep[row + i] + c.shift;
        if (dep > hi) break;
        const ti = t0 + k;
        if (!c.want(ti) || (pk.flags[row + i] & 1) || (pk.flags[row + j] & 2)) continue;
        out.push({ dep, arr: pk.arr[row + j] + c.shift, ti, i, j, bs, as, shift: c.shift });
      }
    }
  }
  out.sort((x, y) => x.dep - y.dep || x.arr - y.arr);
  return out;
}
// Seconds to walk from stop x to stop y (a footpath of the pack), or -1.
function dlWalk(pk, x, y) {
  for (let e = pk.xferOff[x]; e < pk.xferOff[x + 1]; e++) if (pk.xferTo[e] === y) return pk.xferSec[e];
  return -1;
}

// One day's list: journeys in rpSearch's shape ({ legs, t }) leaving from 3 AM on `day` to 3 AM the next day, with
// times as seconds after the pack's day start. Returns { journeys, start, end, direct (trip ids of every direct trip
// looked at) }, or null when the pack cannot list that day.
function dlScan(pk, from, to, day, tpls, o = {}) {
  if (!dlCanList(pk, day)) return null;
  const H = dlDaysHeld(pk);
  const ds = day === pk.day ? pk.dayStart : H[day].dayStart;
  const start = ds - pk.dayStart + DL_EDGE_S;
  const next = dlShiftDay(day, 1);
  const end = (H[next] ? H[next].dayStart : dlDayStart(next)) - pk.dayStart + DL_EDGE_S;
  const copies = dlCopies(pk, day);
  const change = o.change == null ? RP_CHANGE_S : o.change;
  const fromW = new Map(from), toW = new Map(to);
  const all = new Map(), direct = new Set();
  for (const tpl of tpls) {
    const n = tpl.legs.length;
    const first = dlLegServices(pk, tpl.pats[0], copies, start - 3600, end + DL_TAIL_S);
    const later = [];
    for (let x = 1; x < n; x++) later.push(dlLegServices(pk, tpl.pats[x], copies, start - 3600, end + DL_TAIL_S + 6 * 3600));
    for (const c1 of first) {
      const access = fromW.get(c1.bs) || 0;
      const leave = c1.dep - access;
      if (leave < start - 3600) continue;
      const chain = [c1];
      let ok = true;
      for (let x = 1; x < n && ok; x++) {
        const prev = chain[x - 1], list = later[x - 1];
        // The service with the earliest arrival among those that can be caught after prev.
        let lo = 0, hi = list.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].dep < prev.arr) lo = m + 1; else hi = m; }
        let best = null;
        for (let k = lo, seen = 0; k < list.length && seen < DL_SCAN_AHEAD; k++, seen++) {
          const c = list[k];
          if (best && c.dep >= best.arr) break;
          const w = c.bs === prev.as ? change : dlWalk(pk, prev.as, c.bs);
          if (w < 0 || prev.arr + w > c.dep) continue;
          if (c.ti === prev.ti && c.shift === prev.shift) continue;
          if (!best || c.arr < best.arr) best = c;
        }
        if (!best) ok = false; else chain.push(best);
      }
      if (!ok) continue;
      const last = chain[n - 1];
      const egress = toW.get(last.as) || 0;
      const legs = [];
      if (access) legs.push({ access: true, to: c1.bs, sec: access });
      for (let x = 0; x < n; x++) {
        const c = chain[x];
        if (x > 0 && c.bs !== chain[x - 1].as) legs.push({ walk: true, from: chain[x - 1].as, to: c.bs, sec: dlWalk(pk, chain[x - 1].as, c.bs) });
        legs.push({ trip: c.ti, from: c.bs, to: c.as, i: c.i, j: c.j, dep: c.dep, arr: c.arr });
      }
      if (egress) legs.push({ egress: true, from: last.as, sec: egress });
      const t = { leave: leave, board: c1.dep, arrive: last.arr + egress, services: n };
      const key = chain.map((c) => c.ti + "+" + c.shift + "@" + c.i + ">" + c.j).join("|");
      if (n === 1) direct.add(pk.tripId.at(c1.ti));
      if (!all.has(key)) all.set(key, { legs, t });
    }
  }
  // Trips nobody would pick: another leaves no earlier, arrives no later and has no more services (and is better in
  // one of them). Latest leaving first, keeping the best arrival so far for each number of services.
  const list = [...all.values()].sort((a, b) => b.t.leave - a.t.leave || a.t.arrive - b.t.arrive || a.t.services - b.t.services);
  const K = 8, bestArr = new Array(K + 1).fill(RP_INF), keep = [];
  for (const j of list) {
    const k = Math.min(K, j.t.services);
    let dominated = false;
    for (let c = 1; c <= k && !dominated; c++) if (bestArr[c] <= j.t.arrive) dominated = true;
    // An equal trip (same leave, arrive and services, another way) is kept once.
    // (An equal trip, the same times and services another way, counts as dominated: it is kept once.)
    if (dominated) continue;
    keep.push(j);
    if (j.t.arrive < bestArr[k]) bestArr[k] = j.t.arrive;
  }
  const journeys = keep.filter((j) => j.t.leave >= start && j.t.leave < end).sort((a, b) => a.t.leave - b.t.leave || a.t.arrive - b.t.arrive);
  return { journeys, start, end, direct: [...direct] };
}

// The planner object's /day: one day's list for a pair, templates kept per pair and pack.
function dlDay(pk, q) {
  const from = rpEnds(pk, q.from), to = rpEnds(pk, q.to);
  if (!from.length || !to.length) return { error: !from.length ? "from" : "to" };
  const H = dlDaysHeld(pk);
  const held = Object.keys(H).filter((d) => dlCanList(pk, d)).sort();
  const day = /^\d{8}$/.test(q.day || "") ? q.day : pk.day;
  if (!dlCanList(pk, day)) return { error: "day", day, held };
  if (!pk.dlMem) pk.dlMem = new Map();
  const key = String(q.from) + ">" + String(q.to);
  let tpl = pk.dlMem.get(key), made = false, searches = 0;
  if (!tpl) {
    const t0 = Date.now();
    const r = dlTemplates(pk, from, to);
    tpl = { list: r.list, ms: Date.now() - t0 };
    searches = r.searches; made = true;
    if (pk.dlMem.size >= DL_MEM_MAX) pk.dlMem.delete(pk.dlMem.keys().next().value);
    pk.dlMem.set(key, tpl);
  } else { pk.dlMem.delete(key); pk.dlMem.set(key, tpl); }
  const t1 = Date.now();
  const scan = dlScan(pk, from, to, day, tpl.list);
  const scanMs = Date.now() - t1;
  const iso = (s) => new Date((pk.dayStart + s) * 1000).toISOString();
  return {
    day, ver: pk.ver, held, prevDay: held.includes(dlShiftDay(day, -1)) ? dlShiftDay(day, -1) : null,
    nextDay: held.includes(dlShiftDay(day, 1)) ? dlShiftDay(day, 1) : null,
    start: iso(scan.start), end: iso(scan.end), templates: tpl.list.length, templatesMade: made, searches,
    templateMs: made ? tpl.ms : 0, scanMs,
    ends: { from: from.map((x) => pk.stopId.at(x[0])), to: to.map((x) => pk.stopId.at(x[0])) },
    direct: scan.direct,
    journeys: rpAnswer(pk, { journeys: scan.journeys }),
  };
}
// TripPlanner.fetch hands /day here (raptor.js).
async function dlRoute(planner, q, name) {
  const pk = await planner.open(name);
  if (!pk) return Response.json({ error: "no pack" }, { status: 503 });
  const t0 = Date.now();
  const r = dlDay(pk, q);
  planner.stats.days = (planner.stats.days || 0) + 1;
  return Response.json({ ...r, ms: Date.now() - t0 });
}

// ---- worker side: GET /api/trip?page=1&days=1 ----
// A phone that can take whole days sends days=1 with its first page (and day=YYYYMMDD for the next ones). With our
// planner on (OWN_PLANNER, or own=1 with the engine load key for checks) and a day the pack holds, the answer is that
// day's list (page.mode "day", with the days before and after it that can be listed the same way); otherwise the
// usual Trip Planner page, so the phone carries on with after= and before= as before. Searches the planner does not
// do (step free, via a stop, leaving out modes, arrive by, long trips) stay on Trip Planner pages.
const DL_MEM_TTL_MS = 10 * 60000;    // a day's timetable part is kept this long per pair (live times are put on fresh)
const DL_ADDED_MAX = 6;              // added trains put on one day's list at most
const dlWorkerMem = new Map();

function tripDayQuery(p, env, request, base) {
  if (p.get("page") !== "1" || p.get("days") !== "1") return null;
  // A Trip Planner page by its cursors (a phone carrying on past the planner's days) stays a Trip Planner page.
  if (p.get("after") || p.get("before")) return null;
  if (base && (base.accessible || base.long || base.arriveBy || (base.exclude && Object.keys(base.exclude).length))) return null;
  if (p.get("via")) return null;
  const keyed = p.get("own") === "1" && ((typeof adminOk === "function" && adminOk(request)) || (env && env.ENGINE_LOAD_KEY && typeof keyOk === "function" && keyOk(request, null, env.ENGINE_LOAD_KEY)));
  if (typeof ownPlannerWanted !== "function" || !ownPlannerWanted(env, { own: keyed })) return null;
  const day = /^\d{8}$/.test(p.get("day") || "") ? p.get("day") : null;
  return { day, more: !!day };
}
// The day whose list (3 AM to 3 AM) holds a moment: the Sydney date 3 hours earlier.
function dlDayOf(t) { return sydneyParts(new Date(t - DL_EDGE_S * 1000)).date; }

async function dlAsk(env, fromId, toId, day) {
  const okId = (s) => /^[A-Za-z0-9_.:-]{1,60}$/.test(String(s || ""));
  if (!okId(fromId) || !okId(toId)) return null;
  const key = fromId + ">" + toId + ">" + day;
  const hit = dlWorkerMem.get(key);
  if (hit && Date.now() - hit.at < DL_MEM_TTL_MS) return hit.d;
  const n = rpReplicas(env);
  let h = 2166136261; for (const c of fromId + ">" + toId) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const name = rpReplicaName(h % n);
  const stub = rpStub(env, name);
  if (!stub) return null;
  const qs = new URLSearchParams({ name, from: String(fromId), to: String(toId), day });
  const r = await Promise.race([stub.fetch("https://planner/day?" + qs.toString()), new Promise((res) => setTimeout(() => res(null), 4000))]).catch(() => null);
  if (!r || r.status !== 200) return null;
  const d = await r.json().catch(() => null);
  if (!d || (d.error && d.error !== "day")) return null;
  if (!d.error) {
    if (dlWorkerMem.size > 300) dlWorkerMem.delete(dlWorkerMem.keys().next().value);
    dlWorkerMem.set(key, { at: Date.now(), d });
  }
  if (typeof budget === "object" && budget) budget.ownDays = (budget.ownDays || 0) + 1;
  return d;
}

// Trains in the live train feed that call at A and then at B and that the day's list does not have (a trip published
// after the timetable, or a run the timetable heads "Empty Train" that runs live): listed as added trips, as the board
// engine does, for the next 2 hours. Times are the feed's; the planned time is the whole minute before the delay.
async function dlAdded(env, d, journeys, now) {
  if (!d || !d.ends || !Array.isArray(d.ends.from) || !Array.isArray(d.ends.to)) return [];
  const proto = journeys.find((j) => j.changes === 0 && j.legs.some((l) => l.kind === "transit" && l.mode === "train"));
  const anyTrain = proto || d.journeys.some((j) => j.legs.some((l) => l.kind === "transit" && l.mode === "train"));
  if (!anyTrain) return [];
  const rt = await realtimeFor(env, [["train", proto ? proto.legs.find((l) => l.kind === "transit").line : "", null]]);
  const known = new Set(d.direct || []);
  for (const j of journeys) for (const l of j.legs) if (l.tripId) known.add(l.tripId);
  const fromSet = new Set(d.ends.from), toSet = new Set(d.ends.to);
  const out = [];
  for (const k of Object.keys(rt.feeds || {})) {
    const f = rt.feeds[k] && rt.feeds[k].tu;
    if (!f || !f.idx) continue;
    let looked = 0;
    for (const tripId of f.idx.keys()) {
      if (out.length >= DL_ADDED_MAX || looked++ > 3000) break;
      if (known.has(tripId)) continue;
      const tu = decodeFrom(f, tripId);
      if (!tu || !tu.ts || tu.rel === 3 || !tu.stus || tu.stus.length < 2) continue;
      let a = -1, b = -1;
      for (let i = 0; i < tu.stus.length; i++) {
        const u = tu.stus[i];
        if (u.rel === 1) continue;
        if (a < 0 && fromSet.has(u.stopId)) a = i;
        else if (a >= 0 && toSet.has(u.stopId)) { b = i; break; }
      }
      if (a < 0 || b < 0) continue;
      const ta = stuTime(tu.stus[a]), tb = stuTime(tu.stus[b]);
      if (!ta || !tb || ta.t < now - 5 * 60000 || ta.t > now + 2 * 3600000 || tb.t < ta.t) continue;
      const plan = (x) => Math.floor((x.t - (x.delay || 0) * 1000) / 60000) * 60000;
      const pl = proto ? proto.legs.find((l) => l.kind === "transit") : null;
      const leg = {
        kind: "transit", mode: "train", modeName: (pl && pl.modeName) || "Train", line: (pl && pl.line) || "", color: (pl && pl.color) || "",
        towards: "", destId: null, tripId, stopId: tu.stus[a].stopId, toStopId: tu.stus[b].stopId,
        fromParent: pl ? pl.fromParent : null, toParent: pl ? pl.toParent : null, from: pl ? pl.from : "", fromPlatform: null, to: pl ? pl.to : "", toPlatform: null,
        planned: iso(plan(ta)), estimated: iso(ta.t), arrPlanned: iso(plan(tb)), arrEstimated: iso(tb.t),
        realtime: true, delayMin: Math.round((ta.t - plan(ta)) / 60000), durationMin: Math.round((tb.t - ta.t) / 60000), stops: b - a,
        cancelled: false, occupancy: null, platformChangedFrom: null, source: "feed", added: true, alerts: [], path: [],
      };
      leg.status = typeof statusOf === "function" ? statusOf(leg) : { key: "ontime", text: "On time" };
      out.push({
        leave: iso(ta.t), board: iso(ta.t), arrive: iso(tb.t), durationMin: Math.round((tb.t - ta.t) / 60000), changes: 0, live: true,
        anyCancelled: false, risk: "ok", legs: [leg], added: true, source: "feed",
        ...(typeof faresAll === "function" ? { fares: faresAll([leg]) } : {}),
      });
    }
  }
  return out;
}

// One day's list for /api/trip (null: not a day the planner can list now, so the caller asks for a Trip Planner page).
async function tripDayPage(env, fromId, toId, q, base) {
  const now = Date.now();
  let day = q.day;
  if (!day) {
    // The chosen day and time (the trip screen's picker), else now; a time alone that is past means tomorrow, as trip().
    let at = now;
    if (base && (base.date || base.time)) {
      const today = sydneyParts(new Date(now));
      let date = base.date || today.date;
      const hhmm = base.time || "0000";
      const min = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(2));
      if (!base.date && min(hhmm) < min(today.time) - 30) date = sydneyParts(new Date(now + 86400000)).date;
      at = (dlDayStart(date) + min(hhmm) * 60) * 1000;
    }
    day = dlDayOf(at);
  }
  const d = await dlAsk(env, fromId, toId, day).catch(() => null);
  if (!d) return null;
  if (d.error === "day") {
    // A day the pack does not hold (a phone asking for a day listed before the night's new pack): the Trip Planner's
    // first page from that day's 3 AM, so the phone carries on with Trip Planner pages that way.
    if (!q.more || typeof tripPage !== "function") return null;
    const from = (dlDayStart(day) + DL_EDGE_S) * 1000;
    return tripPage(env, fromId, toId, { after: from, before: null, arr: null, n: null }, { ...base, time: null, date: null });
  }
  const t0 = Date.now();
  const r = await trip(env, fromId, toId, { ...base, ownJourneys: d.journeys.map((j) => j.legs) });
  const ws = Date.parse(d.start), we = Date.parse(d.end);
  let added = [];
  if (now >= ws - 3600000 && now < we) added = await dlAdded(env, d, r.journeys, now).catch(() => []);
  const journeys = r.journeys.concat(added).sort((a, b) => tripPlannedDep(a) - tripPlannedDep(b));
  const deps = journeys.map(tripPlannedDep).filter(Number.isFinite);
  const arrs = journeys.map(tripPlannedArr).filter(Number.isFinite);
  return {
    ...r, journeys, source: "own",
    page: {
      mode: "day", day: d.day, windowStart: ws, windowEnd: we, prevDay: d.prevDay || null, nextDay: d.nextDay || null, held: d.held || [],
      next: deps.length ? Math.max(...deps) : null, prev: deps.length ? Math.min(...deps) : null, prevArr: arrs.length ? Math.min(...arrs) : null,
      end: false, added: added.length, liveMs: Date.now() - t0, plannerMs: d.ms != null ? d.ms : null,
    },
  };
}
