// ---------- Our own trip planner: RAPTOR over the GTFS timetable (OWN_PLANNER, off) ----------
// Written 26 Oct 2026 after Bidur's 3:09 PM message: plan everything as if a million people use the app at the same
// time. Every trip search used to be one call to Transport for NSW's Trip Planner, so searches grew NSW calls one for
// one with users. This file answers trip searches from our own copy of the timetable with RAPTOR (Delling, Pajor,
// Werneck, "Round-Based Public Transit Routing", 2012): round k finds the earliest arrival at every stop with k
// services, so the answer holds the fastest trip for each number of changes. The pack it reads is built by
// tools/build_planner.py (format in that file). docs/SCALE_1M.md has the design and the capacity numbers.
//
// Appended to worker.js after ttplan.js by build.mjs (same module). Pure functions first (rp*), then the Durable
// Object (TripPlanner) that holds the pack, then the worker side (ownTrip). With OWN_PLANNER off nothing here runs
// for phones; /api/raptor (engine load key) asks it directly for checks.

const RP_INF = 0x7fffffff;
const RP_ROUNDS = 5;            // services in one trip at most (4 changes)
const RP_CHANGE_S = 60;         // least time to change services at the same stop
const RP_ACCESS_M = 1000;       // walk to or from a point: stops up to this far
const RP_ACCESS_N = 24;         // and at most this many of them
const RP_HORIZON_S = 4 * 3600;  // later departures looked at for a list of trips
const RP_STEP_S = 60;           // next search starts this long after the last trip found leaves

// Reads a pack. parts: { header (object), arrays: { name: TypedArray } }, or one ArrayBuffer / Uint8Array of the
// whole file. Returns the planner's view of it with its search buffers.
function rpOpen(parts) {
  let h, A = {};
  if (parts && parts.header) { h = parts.header; A = parts.arrays; }
  else {
    const u8 = parts instanceof Uint8Array ? parts : new Uint8Array(parts);
    if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "RPK1") throw new Error("not a planner pack");
    const hl = new DataView(u8.buffer, u8.byteOffset, 8).getUint32(4, true);
    h = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hl)));
    const base = 8 + hl;
    const own = u8.byteOffset % 8 === 0 ? u8 : u8.slice();
    for (const a of h.arrays) {
      const T = a.type === "f32" ? Float32Array : a.type === "u8" ? Uint8Array : Int32Array;
      A[a.name] = new T(own.buffer, own.byteOffset + base + a.offset, a.length);
    }
  }
  const lines = (s) => { const o = [0]; for (let i = s.indexOf("\n"); i >= 0; i = s.indexOf("\n", i + 1)) o.push(i + 1); return o; };
  const pk = { h, ...A, S: h.counts.stops, P: h.counts.patterns, T: h.counts.trips, dayStart: h.dayStart, day: h.day };
  // One string per list, read by line offset (holding 160,000 small strings would cost far more memory).
  const list = (s) => { const off = lines(s); return { n: off.length, at: (i) => (i < 0 || i >= off.length ? "" : s.slice(off[i], i + 1 < off.length ? off[i + 1] - 1 : s.length)) }; };
  pk.stopId = list(h.stopIds); pk.name = list(h.names); pk.plat = list(h.plats); pk.tripId = list(h.tripIds);
  pk.idx = new Map();
  for (let i = 0; i < pk.stopId.n; i++) pk.idx.set(pk.stopId.at(i), i);
  // Children of each station (stops whose parent it is).
  const nk = new Int32Array(pk.S + 1);
  for (let i = 0; i < pk.S; i++) if (pk.parent[i] >= 0) nk[pk.parent[i] + 1]++;
  for (let i = 0; i < pk.S; i++) nk[i + 1] += nk[i];
  const kid = new Int32Array(nk[pk.S]), fill = nk.slice(0, pk.S);
  for (let i = 0; i < pk.S; i++) if (pk.parent[i] >= 0) kid[fill[pk.parent[i]]++] = i;
  pk.kidOff = nk; pk.kid = kid;
  return pk;
}

// Search buffers, made once per pack and reused (a search is synchronous, so two never share them at once).
function rpBuffers(pk, K) {
  if (pk.buf && pk.buf.K === K) return pk.buf;
  const n = (K + 1) * pk.S;
  pk.buf = {
    K, tau: new Int32Array(n), best: new Int32Array(pk.S), bestT: new Int32Array(pk.S),
    // A stop's best label each round: 1 start (ld: walk seconds), 2 a service (its details in the t* arrays of round
    // lr), 3 a walk (la: the stop walked from, reached by a service in round lr; ld: seconds). Labels carry to later rounds.
    lt: new Int8Array(n), lr: new Int8Array(n), la: new Int32Array(n), ld: new Int32Array(n),
    // Getting off a service at a stop, each round (kept apart from the best label: a walk may beat it, and a walk
    // onwards from this stop still starts from it): trip, position boarded, position left, stop boarded.
    tTrip: new Int32Array(n), tBi: new Int16Array(n), tBj: new Int16Array(n), tBs: new Int32Array(n),
    qPos: new Int32Array(pk.P).fill(-1), qList: new Int32Array(pk.P),
    mark: new Uint8Array(pk.S), marked: new Int32Array(pk.S), next: new Int32Array(pk.S),
    tmark: new Uint8Array(pk.S), tlist: new Int32Array(pk.S),
  };
  return pk.buf;
}

// The earliest trip of pattern p leaving position i at or after t that may be boarded there, or -1.
function rpEarliest(pk, p, i, t) {
  const t0 = pk.patTripOff[p], nt = pk.patTripOff[p + 1] - t0;
  const ns = pk.patStopOff[p + 1] - pk.patStopOff[p], ev = pk.patEvOff[p];
  let lo = 0, hi = nt;
  while (lo < hi) { const m = (lo + hi) >> 1; if (pk.dep[ev + m * ns + i] < t) lo = m + 1; else hi = m; }
  for (let k = lo; k < nt; k++) if (!(pk.flags[ev + k * ns + i] & 1)) return t0 + k;
  return -1;
}

// One RAPTOR search. from / to: [[stop index, walk seconds], ...]; t: seconds after the pack's day start.
// Returns the Pareto set at the destination: for each number of services, the earliest arrival that beats every trip
// with fewer services, as { arrive, services, legs } (service legs { trip, from, to, dep, arr, i, j }, walks { walk,
// from, to, sec }, the start and end walks { access, to, sec } / { egress, from, sec }; stops as indexes).
// One walk at most between two services (footpaths are not chained), as on the Trip Planner.
function rpSearch(pk, from, to, t, o = {}) {
  const K = Math.max(1, Math.min(8, o.rounds || RP_ROUNDS));
  const change = o.change == null ? RP_CHANGE_S : o.change;
  const B = rpBuffers(pk, K), S = pk.S;
  const { tau, best, bestT, lt, lr, la, ld, tTrip, tBi, tBj, tBs, qPos, qList, mark, marked, next, tmark, tlist } = B;
  tau.fill(RP_INF, 0, S); best.fill(RP_INF); bestT.fill(RP_INF); lt.fill(0, 0, S);
  let nm = 0;
  const isTo = new Map();
  for (const [s, w] of to) if (!isTo.has(s) || w < isTo.get(s)) isTo.set(s, w);
  for (const [s, w] of from) {
    const a = t + w;
    if (a < tau[s]) { tau[s] = a; best[s] = a; lt[s] = 1; lr[s] = 0; ld[s] = w; if (!mark[s]) { mark[s] = 1; marked[nm++] = s; } }
  }
  let target = RP_INF;
  const atTarget = (k) => { let b = RP_INF; for (const [s, w] of isTo) { const a = tau[k * S + s]; if (a !== RP_INF && a + w < b) b = a + w; } return b; };
  // Walks from stops reached by a service this round (from the start stops in round 0). A walk that ties a service
  // arrival wins (no change time after a walk).
  const walk = (k, src, ns, srcT, list, n) => {
    const r = k * S;
    let m = n;
    for (let x = 0; x < ns; x++) {
      const s = src[x], ts = srcT ? srcT[s] : tau[r + s];
      for (let e = pk.xferOff[s]; e < pk.xferOff[s + 1]; e++) {
        const j = pk.xferTo[e], a = ts + pk.xferSec[e];
        if (a >= target) continue;
        if (a < best[j] || (a === best[j] && lt[r + j] === 2 && lr[r + j] === k)) {
          tau[r + j] = a; best[j] = a; lt[r + j] = 3; lr[r + j] = k; la[r + j] = s; ld[r + j] = pk.xferSec[e];
          if (!mark[j]) { mark[j] = 1; list[m++] = j; }
        }
      }
    }
    return m;
  };
  { const start = marked.slice(0, nm); nm = walk(0, start, start.length, null, marked, nm); }
  target = atTarget(0);
  const found = [];
  let bestSoFar = target;
  if (target !== RP_INF) found.push({ k: 0, arrive: target });
  for (let k = 1; k <= K && nm > 0; k++) {
    const r = k * S, rp = (k - 1) * S;
    // Carry the last round's labels (a stop not improved this round keeps them).
    tau.copyWithin(r, rp, rp + S); lt.copyWithin(r, rp, rp + S); lr.copyWithin(r, rp, rp + S);
    la.copyWithin(r, rp, rp + S); ld.copyWithin(r, rp, rp + S);
    // Patterns through a stop marked last round, from the first such stop.
    let nq = 0;
    for (let x = 0; x < nm; x++) {
      const s = marked[x]; mark[s] = 0;
      for (let e = pk.stopPatOff[s]; e < pk.stopPatOff[s + 1]; e++) {
        const p = pk.stopPat[e], i = pk.stopPatIdx[e];
        if (qPos[p] < 0) { qPos[p] = i; qList[nq++] = p; } else if (i < qPos[p]) qPos[p] = i;
      }
    }
    let nn = 0, nt = 0;
    for (let q = 0; q < nq; q++) {
      const p = qList[q], i0 = qPos[p]; qPos[p] = -1;
      const so = pk.patStopOff[p], ns = pk.patStopOff[p + 1] - so, ev = pk.patEvOff[p], t0 = pk.patTripOff[p];
      let trip = -1, bi = 0, bs = 0, row = 0;
      for (let i = i0; i < ns; i++) {
        const s = pk.patStops[so + i];
        if (trip >= 0) {
          const e = row + i, a = pk.arr[e];
          if (!(pk.flags[e] & 2) && a < bestT[s] && a < target) {
            bestT[s] = a; tTrip[r + s] = trip; tBi[r + s] = bi; tBj[r + s] = i; tBs[r + s] = bs;
            if (!tmark[s]) { tmark[s] = 1; tlist[nt++] = s; }
            if (a < best[s]) {
              tau[r + s] = a; best[s] = a; lt[r + s] = 2; lr[r + s] = k;
              if (!mark[s]) { mark[s] = 1; next[nn++] = s; }
            }
          }
        }
        const prev = tau[rp + s];
        if (prev === RP_INF) continue;
        const ready = prev + (lt[rp + s] === 2 ? change : 0);
        if (trip < 0 || ready <= pk.dep[row + i]) {
          const ntp = rpEarliest(pk, p, i, ready);
          if (ntp >= 0 && (trip < 0 || ntp < trip)) { trip = ntp; bi = i; bs = s; row = ev + (ntp - t0) * ns; }
        }
      }
    }
    // Walks start from the arrival by service (bestT is this round's for every stop in tlist).
    for (let x = 0; x < nt; x++) tmark[tlist[x]] = 0;
    nn = walk(k, tlist, nt, bestT, next, nn);
    const b = atTarget(k);
    if (b < target) target = b;
    if (b < bestSoFar) { found.push({ k, arrive: b }); bestSoFar = b; }
    nm = nn; marked.set(next.subarray(0, nn));
  }
  for (let x = 0; x < nm; x++) mark[marked[x]] = 0;
  // Read each trip back from its labels.
  const out = [];
  for (const f of found) {
    const r = f.k * S;
    let bs = -1, bw = RP_INF;
    for (const [s, w] of isTo) { const a = tau[r + s]; if (a !== RP_INF && a + w < bw) { bw = a + w; bs = s; } }
    if (bs < 0) continue;
    const legs = [{ egress: true, from: bs, sec: isTo.get(bs) }];
    let s = bs, k = f.k, guard = 0, ok = false;
    const service = (s, q) => {
      const x = q * S + s, trip = tTrip[x], p = pk.tripPat[trip], ns = pk.patStopOff[p + 1] - pk.patStopOff[p];
      const row = pk.patEvOff[p] + (trip - pk.patTripOff[p]) * ns;
      legs.push({ trip, from: tBs[x], to: s, i: tBi[x], j: tBj[x], dep: pk.dep[row + tBi[x]], arr: pk.arr[row + tBj[x]] });
      return tBs[x];
    };
    while (guard++ < 40) {
      const x = k * S + s, type = lt[x];
      if (type === 1) { legs.push({ access: true, to: s, sec: ld[x] }); ok = true; break; }
      if (type === 3) { legs.push({ walk: true, from: la[x], to: s, sec: ld[x] }); const q = lr[x]; if (q === 0) { s = la[x]; k = 0; continue; } s = service(la[x], q); k = q - 1; continue; }
      if (type === 2) { const q = lr[x]; s = service(s, q); k = q - 1; continue; }
      break;
    }
    if (!ok) continue;
    legs.reverse();
    out.push({ arrive: f.arrive, services: legs.filter((l) => l.trip != null).length, legs });
  }
  return out;
}

// Where a search starts or ends: a stop id (a station means all its platforms and stands), or a point
// ("lon:lat:EPSG:4326" as the Trip Planner writes it, or { lat, lon }) with the stops in walking distance.
function rpEnds(pk, id, walk) {
  const w = walk || pk.h.walk || { mps: 1.2, detour: 1.3, findS: 60 };
  let pt = null;
  if (id && typeof id === "object") pt = id;
  else {
    const m = String(id || "").match(/^(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?):EPSG:4326$/);
    if (m) pt = { lon: Number(m[1]), lat: Number(m[2]) };
  }
  if (pt) {
    const out = [];
    const dLat = RP_ACCESS_M / 111320, dLon = RP_ACCESS_M / (111320 * Math.cos((pt.lat * Math.PI) / 180));
    for (let i = 0; i < pk.S; i++) {
      const la = pk.lat[i], lo = pk.lon[i];
      if (la < pt.lat - dLat || la > pt.lat + dLat || lo < pt.lon - dLon || lo > pt.lon + dLon) continue;
      if (pk.stopPatOff[i + 1] === pk.stopPatOff[i]) continue;
      const m = rpMetres(pt.lat, pt.lon, la, lo);
      if (m <= RP_ACCESS_M) out.push([i, Math.round(w.findS + (m * w.detour) / w.mps), m]);
    }
    out.sort((a, b) => a[2] - b[2]);
    return out.slice(0, RP_ACCESS_N).map((x) => [x[0], x[1]]);
  }
  const i = pk.idx.get(String(id));
  if (i == null) return [];
  const out = [];
  if (pk.stopPatOff[i + 1] > pk.stopPatOff[i]) out.push([i, 0]);
  for (let e = pk.kidOff[i]; e < pk.kidOff[i + 1]; e++) out.push([pk.kid[e], 0]);
  return out;
}
function rpMetres(a, b, c, d) {
  const r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}

// A journey's times: leave (start walking), board, arrive (end of the last walk), services.
function rpTimes(j) {
  const sv = j.legs.filter((l) => l.trip != null);
  if (!sv.length) return null;
  let before = 0;
  for (const l of j.legs) { if (l.trip != null) break; before += l.sec || 0; }
  let after = 0;
  for (let x = j.legs.length - 1; x >= 0; x--) { const l = j.legs[x]; if (l.trip != null) break; after += l.sec || 0; }
  return { leave: sv[0].dep - before, board: sv[0].dep, arrive: sv[sv.length - 1].arr + after, services: sv.length };
}

// A list of trips like the Trip Planner's: q = { from, to, at (seconds after the pack's day start), arriveBy,
// count, rounds, change }. Departures: searches from the asked time, each next one just after the last trip found
// leaves, so later trips and trips with fewer changes both appear; trips nobody would pick (another leaves no
// earlier, arrives no later, with no more changes) are dropped. Arrive by: searches from earlier and keeps the
// trips arriving in time, the latest leaving last.
function rpPlan(pk, q) {
  const from = Array.isArray(q.from) ? q.from : rpEnds(pk, q.from), to = Array.isArray(q.to) ? q.to : rpEnds(pk, q.to);
  const count = Math.max(1, Math.min(8, Number(q.count) || 5));
  if (!from.length || !to.length) return { journeys: [], error: !from.length ? "from" : "to", searches: 0 };
  const T = Number(q.at) || 0;
  const all = new Map();
  let searches = 0;
  let lastStart = -RP_INF;
  const run = (t0, until, enough) => {
    let t = t0;
    while (t <= until && searches < 40) {
      searches++; lastStart = t;
      const res = rpSearch(pk, from, to, t, q);
      if (!res.length) break;
      let first = RP_INF;
      for (const j of res) {
        const tm = rpTimes(j);
        if (!tm) continue;
        j.t = tm;
        const key = j.legs.filter((l) => l.trip != null).map((l) => l.trip + "@" + l.i + ">" + l.j).join("|");
        if (!all.has(key)) all.set(key, j);
        if (tm.leave < first) first = tm.leave;
      }
      if (first === RP_INF) break;
      if (enough()) break;
      t = Math.max(t + RP_STEP_S, first + RP_STEP_S);
    }
  };
  const pareto = (list) => list.filter((j) => !list.some((o) => o !== j && o.t.leave >= j.t.leave && o.t.arrive <= j.t.arrive && o.t.services <= j.t.services &&
    (o.t.leave > j.t.leave || o.t.arrive < j.t.arrive || o.t.services < j.t.services)));
  let list;
  if (q.arriveBy) {
    for (const back of [5400, 3 * 3600, 6 * 3600]) {
      run(T - back, T, () => [...all.values()].some((j) => j.t.arrive > T));
      list = pareto([...all.values()].filter((j) => j.t.arrive <= T));
      if (list.length >= count) break;
    }
    list.sort((a, b) => a.t.leave - b.t.leave || a.t.arrive - b.t.arrive);
    list = list.slice(-count);
  } else {
    const horizon = Number(q.horizon) || RP_HORIZON_S;
    // Enough once a search has started after the last trip to be shown leaves: a trip leaving later and arriving no
    // later would have been found by it.
    run(T, T + horizon, () => {
      const l = pareto([...all.values()].filter((j) => j.t.leave >= T)).sort((a, b) => a.t.leave - b.t.leave);
      return l.length >= count && lastStart > l[count - 1].t.leave;
    });
    list = pareto([...all.values()].filter((j) => j.t.leave >= T));
    list.sort((a, b) => a.t.leave - b.t.leave || a.t.arrive - b.t.arrive);
    list = list.slice(0, count);
  }
  return { journeys: list, searches };
}

// ---- answer shape (the trip answer's legs, as worker.js trip() and ttplan.js make them) ----
function rpStopPlace(pk, i) {
  const p = pk.parent[i] >= 0 ? pk.parent[i] : i;
  const n = pk.name.at(p) || pk.name.at(i);
  return typeof engPlaceName === "function" ? engPlaceName(n) : n;
}
function rpLegs(pk, j) {
  const iso = (s) => new Date((pk.dayStart + s) * 1000).toISOString();
  const legs = [];
  let clock = j.t.leave;
  for (const l of j.legs) {
    if (l.trip == null) {
      if (!l.sec) continue;
      const a = l.access ? null : l.egress ? l.from : l.from, b = l.access ? l.to : l.egress ? null : l.to;
      legs.push({ kind: "walk", mode: "walk", modeName: "Walk", line: "", color: "#646974", towards: "",
        stopId: a != null ? pk.stopId.at(a) : null, toStopId: b != null ? pk.stopId.at(b) : null,
        from: a != null ? rpStopPlace(pk, a) : "", to: b != null ? rpStopPlace(pk, b) : "",
        planned: iso(clock), arrPlanned: iso(clock + l.sec), durationMin: Math.max(1, Math.round(l.sec / 60)), realtime: false, path: [] });
      clock += l.sec;
      continue;
    }
    const r = pk.h.routes[pk.tripRoute[l.trip]] || ["", 5, "", "", ""];
    const mode = typeof modeOf === "function" ? modeOf(r[1]) : { key: "bus", name: "Bus", color: "" };
    const plat = (i) => {
      const own = typeof engPlatform === "function" ? engPlatform(pk.name.at(i), pk.plat.at(i), r[1]) : pk.plat.at(i);
      return own || null;
    };
    legs.push({
      kind: "transit", mode: mode.key, modeName: mode.name, line: r[0],
      color: (typeof lineColor === "function" ? lineColor(r[0], r[1]) : "") || r[2] || mode.color || "",
      towards: pk.h.heads[pk.tripHead[l.trip]] || "", destId: null, tripId: pk.tripId.at(l.trip),
      // The live feed to read when it is not the mode's own (worker.js feedHint does the same from the planner's names).
      ...(/manly fast ferr/i.test(r[4] || "") ? { feed: "ferry_mff" } : /nsw trainlink/i.test(r[4] || "") ? { feed: "nswtrains" } : {}),
      stopId: pk.stopId.at(l.from), toStopId: pk.stopId.at(l.to),
      fromParent: pk.parent[l.from] >= 0 ? pk.stopId.at(pk.parent[l.from]) : null, toParent: pk.parent[l.to] >= 0 ? pk.stopId.at(pk.parent[l.to]) : null,
      from: rpStopPlace(pk, l.from), fromPlatform: plat(l.from), to: rpStopPlace(pk, l.to), toPlatform: plat(l.to),
      planned: iso(l.dep), estimated: null, arrPlanned: iso(l.arr), arrEstimated: null,
      realtime: false, delayMin: null, durationMin: Math.round((l.arr - l.dep) / 60), stops: Math.max(0, l.j - l.i),
      cancelled: false, occupancy: null, platformChangedFrom: null, source: "own", alerts: [], path: [],
    });
    clock = l.arr;
  }
  return legs;
}
// Journeys in the trip answer's shape ({ leave, board, arrive, durationMin, changes, legs, ... }).
function rpAnswer(pk, plan) {
  const iso = (s) => new Date((pk.dayStart + s) * 1000).toISOString();
  return plan.journeys.map((j) => {
    const legs = rpLegs(pk, j);
    const tl = legs.filter((l) => l.kind === "transit");
    for (let i = 1; i < tl.length; i++) {
      const a = tl[i - 1], b = tl[i];
      const between = legs.slice(legs.indexOf(a) + 1, legs.indexOf(b));
      const walk = between.reduce((s, x) => s + (x.durationMin || 0), 0);
      const gap = Math.round((Date.parse(b.planned) - Date.parse(a.arrPlanned)) / 60000);
      b.transfer = { minutes: gap, walkMin: walk, spare: gap - walk, at: a.to, risk: gap - walk < 0 ? "miss" : gap - walk < 2 ? "tight" : "ok" };
    }
    for (const l of tl) l.status = { key: "scheduled", text: "Scheduled" };
    return {
      leave: iso(j.t.leave), board: iso(j.t.board), arrive: iso(j.t.arrive),
      durationMin: Math.round((j.t.arrive - j.t.leave) / 60), changes: Math.max(0, tl.length - 1), live: false, anyCancelled: false,
      risk: tl.some((l) => l.transfer && l.transfer.risk === "miss") ? "miss" : tl.some((l) => l.transfer && l.transfer.risk === "tight") ? "tight" : "ok",
      legs, source: "own",
    };
  });
}

// ---- the Durable Object that holds the pack ----
// TripPlanner (binding PLANNER, SQLite storage, near Sydney): the pack is stored as parts (1 MB each, a SQLite value
// holds at most 2 MB) and read into memory on the first search after a start. Replicas (OWN_PLANNER_REPLICAS, default
// 1) copy the pack from the first object the first time they start, so one load serves them all.
const RP_PART = 1 << 20;
const RP_PRIMARY = "planner-r0";
function rpReplicaName(i) { return "planner-r" + i; }
function rpReplicas(env) { return Math.max(1, Math.min(32, Number(env && env.OWN_PLANNER_REPLICAS) || 1)); }
function rpStub(env, name) {
  if (!env || !env.PLANNER) return null;
  return env.PLANNER.get(env.PLANNER.idFromName(name), { locationHint: "oc" });
}

class TripPlanner {
  constructor(state, env) {
    this.state = state; this.env = env; this.sql = state.storage.sql; this.pk = null; this.opening = null; this.stats = { plans: 0, ms: 0, opens: 0, openMs: 0 };
    this.sql.exec("CREATE TABLE IF NOT EXISTS part (ver INTEGER, name TEXT, i INTEGER, data BLOB, PRIMARY KEY (ver, name, i))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)");
  }
  kv(k) { const r = this.sql.exec("SELECT v FROM kv WHERE k = ?", k).toArray(); return r.length ? r[0].v : null; }
  setKv(k, v) { this.sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", k, String(v)); }
  bytes(ver, name) {
    const rows = this.sql.exec("SELECT data FROM part WHERE ver = ? AND name = ? ORDER BY i", ver, name).toArray();
    // An empty array is stored as one empty part, which SQLite may hand back as null.
    let n = 0; for (const r of rows) n += r.data ? r.data.byteLength : 0;
    const out = new Uint8Array(n); let o = 0;
    for (const r of rows) if (r.data) { out.set(new Uint8Array(r.data), o); o += r.data.byteLength; }
    return out;
  }
  // The pack in memory, from storage (or, on a replica with none, copied from the first object).
  async open(name) {
    if (this.pk) return this.pk;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const t0 = Date.now();
      let ver = Number(this.kv("cur") || 0);
      if (!ver && name && name !== RP_PRIMARY) ver = await this.pull();
      if (!ver) return null;
      const head = JSON.parse(new TextDecoder().decode(this.bytes(ver, "head")));
      const arrays = {};
      for (const a of head.arrays) {
        const b = this.bytes(ver, a.name);
        const T = a.type === "f32" ? Float32Array : a.type === "u8" ? Uint8Array : Int32Array;
        if (b.byteLength !== a.length * T.BYTES_PER_ELEMENT) throw new Error("pack part " + a.name + " is incomplete");
        arrays[a.name] = new T(b.buffer, 0, a.length);
      }
      this.pk = rpOpen({ header: head, arrays });
      this.pk.ver = ver;
      this.stats.opens++; this.stats.openMs = Date.now() - t0;
      return this.pk;
    })();
    try { return await this.opening; } finally { this.opening = null; }
  }
  async pull() {
    const src = rpStub(this.env, RP_PRIMARY);
    if (!src) return 0;
    const m = await src.fetch("https://planner/manifest?name=" + RP_PRIMARY).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!m || !m.ver) return 0;
    this.sql.exec("DELETE FROM part WHERE ver = ?", m.ver);
    for (const p of m.parts) {
      const r = await src.fetch(`https://planner/dump?name=${RP_PRIMARY}&ver=${m.ver}&part=${encodeURIComponent(p.name)}&i=${p.i}`);
      if (!r.ok) return 0;
      this.sql.exec("INSERT OR REPLACE INTO part (ver, name, i, data) VALUES (?, ?, ?, ?)", m.ver, p.name, p.i, await r.arrayBuffer());
    }
    this.setKv("cur", m.ver);
    this.sql.exec("DELETE FROM part WHERE ver != ?", m.ver);
    return m.ver;
  }
  async fetch(req) {
    const u = new URL(req.url), q = Object.fromEntries(u.searchParams);
    const name = q.name || "";
    try {
      if (u.pathname === "/plan") {
        const pk = await this.open(name);
        if (!pk) return Response.json({ error: "no pack" }, { status: 503 });
        const t0 = Date.now();
        // at: a Sydney day (YYYYMMDD) and time (HHMM). The pack holds its own day and the next morning.
        let at = null;
        if (/^\d{8}$/.test(q.day || "") && /^\d{4}$/.test(q.time || "")) {
          const hm = Number(q.time.slice(0, 2)) * 3600 + Number(q.time.slice(2)) * 60;
          if (q.day === pk.day) at = hm;
          else if (q.day === rpNextDay(pk.day) && hm < 6 * 3600) at = 86400 + hm;
        }
        if (at == null) return Response.json({ journeys: [], error: "day", day: pk.day });
        const plan = rpPlan(pk, { from: q.from, to: q.to, at, arriveBy: q.arriveBy === "1", count: q.count });
        const ms = Date.now() - t0;
        this.stats.plans++; this.stats.ms += ms;
        return Response.json({ day: pk.day, ver: pk.ver, searches: plan.searches, ms, error: plan.error || null, journeys: rpAnswer(pk, plan) });
      }
      if (u.pathname === "/status") {
        const pk = q.open === "1" ? await this.open(name) : this.pk;
        return Response.json({ name, ver: Number(this.kv("cur") || 0), loaded: !!pk, day: pk ? pk.day : null, builtAt: pk ? pk.h.builtAt : null, counts: pk ? pk.h.counts : null, stats: this.stats });
      }
      if (u.pathname === "/manifest") {
        const ver = Number(this.kv("cur") || 0);
        const parts = ver ? this.sql.exec("SELECT name, i FROM part WHERE ver = ? ORDER BY name, i", ver).toArray() : [];
        return Response.json({ ver, parts });
      }
      if (u.pathname === "/dump") {
        const r = this.sql.exec("SELECT data FROM part WHERE ver = ? AND name = ? AND i = ?", Number(q.ver), q.part, Number(q.i)).toArray();
        return r.length ? new Response(r[0].data) : new Response("no part", { status: 404 });
      }
      if (u.pathname === "/restart" && req.method === "POST") { this.pk = null; return Response.json({ ok: true }); }
      if (u.pathname.startsWith("/load/") && req.method === "POST") {
        const ver = Number(q.ver);
        if (!Number.isInteger(ver) || ver <= 0) return Response.json({ error: "ver" }, { status: 400 });
        if (u.pathname === "/load/begin") { this.sql.exec("DELETE FROM part WHERE ver = ?", ver); return Response.json({ ok: true }); }
        if (u.pathname === "/load/part") {
          const body = await req.arrayBuffer();
          if (!/^[A-Za-z]{1,20}$/.test(q.part || "") || !(Number(q.i) >= 0) || body.byteLength > RP_PART) return Response.json({ error: "part" }, { status: 400 });
          this.sql.exec("INSERT OR REPLACE INTO part (ver, name, i, data) VALUES (?, ?, ?, ?)", ver, q.part, Number(q.i), body);
          return Response.json({ ok: true, bytes: body.byteLength });
        }
        if (u.pathname === "/load/pull") { this.setKv("cur", 0); this.pk = null; const v = await this.pull(); return Response.json({ ok: !!v, ver: v }); }
        if (u.pathname === "/load/commit") {
          const prev = Number(this.kv("cur") || 0);
          this.setKv("cur", ver); this.pk = null;
          try { await this.open(RP_PRIMARY); }
          catch (e) { this.setKv("cur", prev); this.pk = null; return Response.json({ error: String((e && e.message) || e) }, { status: 400 }); }
          this.sql.exec("DELETE FROM part WHERE ver != ?", ver);
          return Response.json({ ok: true, ver, day: this.pk.day, counts: this.pk.h.counts, openMs: this.stats.openMs });
        }
      }
      return Response.json({ error: "not found" }, { status: 404 });
    } catch (e) {
      return Response.json({ error: String((e && e.message) || e) }, { status: 500 });
    }
  }
}
function rpNextDay(d) {
  const t = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8))) + 86400000;
  const x = new Date(t);
  return String(x.getUTCFullYear()) + String(x.getUTCMonth() + 1).padStart(2, "0") + String(x.getUTCDate()).padStart(2, "0");
}

// ---- worker side ----
// Whether a trip search may be answered by our own planner: OWN_PLANNER "on", or own=1 on a check. Step free trips,
// trips via a stop and trips leaving out a mode stay on the Trip Planner until the planner does them.
function ownPlannerWanted(env, opts) {
  if (!env || !env.PLANNER) return false;
  if (env.OWN_PLANNER !== "on" && !(opts && opts.own)) return false;
  if (opts && (opts.accessible || opts.via || opts.long)) return false;
  if (opts && opts.exclude && Object.keys(opts.exclude).length) return false;
  return true;
}
// Legs of up to count trips from our own planner, each journey a list of legs in trip()'s leg shape, or null (no
// pack for that day, no stop, an error or over 4 s), so the caller asks the Trip Planner as before.
async function ownTripLegs(env, fromId, toId, o = {}) {
  const okId = (s) => /^[A-Za-z0-9_.:-]{1,60}$/.test(String(s || ""));
  if (!okId(fromId) || !okId(toId) || !/^\d{8}$/.test(o.date || "") || !/^\d{4}$/.test(o.time || "")) return null;
  const n = rpReplicas(env);
  let h = 2166136261; for (const c of fromId + ">" + toId) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const name = rpReplicaName(h % n);
  const stub = rpStub(env, name);
  if (!stub) return null;
  const qs = new URLSearchParams({ name, from: String(fromId), to: String(toId), day: o.date, time: o.time, count: String(o.count || 5) });
  if (o.arriveBy) qs.set("arriveBy", "1");
  const r = await Promise.race([stub.fetch("https://planner/plan?" + qs.toString()), new Promise((res) => setTimeout(() => res(null), 4000))]).catch(() => null);
  if (!r || r.status !== 200) return null;
  const d = await r.json().catch(() => null);
  if (!d || !Array.isArray(d.journeys) || !d.journeys.length) return null;
  if (typeof budget === "object" && budget) budget.ownTrips = (budget.ownTrips || 0) + 1;
  return d.journeys.map((j) => j.legs);
}
// /api/raptor: loading (tools/load_planner.mjs) and checks, engine load key or admin key.
//   POST /api/raptor/load/{begin,part,commit}?ver=N[&part=&i=]   GET /api/raptor/status   POST /api/raptor/replicas
//   GET /api/raptor/plan?from=&to=&day=YYYYMMDD&time=HHMM[&arriveBy=1][&count=]   our planner's own answer
async function plannerRoutes(request, env, url) {
  const keyed = (typeof adminOk === "function" && adminOk(request)) || (env.ENGINE_LOAD_KEY && typeof keyOk === "function" && keyOk(request, null, env.ENGINE_LOAD_KEY));
  if (!keyed) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!env.PLANNER) return Response.json({ error: "planner not configured" }, { status: 503 });
  const sub = url.pathname.slice("/api/raptor".length);
  const fwd = (name, path, init) => rpStub(env, name).fetch("https://planner" + path + (path.includes("?") ? "&" : "?") + "name=" + name, init);
  const pass = async (r) => new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  if (sub.startsWith("/load/") && request.method === "POST") return pass(await fwd(RP_PRIMARY, sub + url.search, { method: "POST", body: await request.arrayBuffer() }));
  if (sub === "/replicas" && request.method === "POST") {
    const n = rpReplicas(env), out = [];
    for (let i = 1; i < n; i++) out.push(await fwd(rpReplicaName(i), "/load/pull?ver=1", { method: "POST" }).then((r) => r.json(), (e) => ({ error: String(e) })));
    return Response.json({ replicas: n, answers: out });
  }
  if (sub === "/status") {
    const n = rpReplicas(env);
    const all = await Promise.all(Array.from({ length: n }, (_, i) => fwd(rpReplicaName(i), "/status" + (url.searchParams.get("open") === "1" ? "?open=1" : "")).then((r) => r.json(), (e) => ({ error: String(e) }))));
    return Response.json({ flag: env.OWN_PLANNER === "on" ? "on" : "off", replicas: all });
  }
  if (sub === "/plan") {
    const p = url.searchParams;
    let date = p.get("day"), time = p.get("time");
    if (!date || !time) { const s = sydneyParts(); date = date || s.date; time = time || s.time; }
    const qs = new URLSearchParams({ from: p.get("from") || "", to: p.get("to") || "", day: date, time, count: p.get("count") || "5" });
    if (p.get("arriveBy") === "1") qs.set("arriveBy", "1");
    return pass(await fwd(RP_PRIMARY, "/plan?" + qs.toString()));
  }
  return Response.json({ error: "not found" }, { status: 404 });
}

export { TripPlanner };
