// Live trip maths, shared by the live trip screen and its tests. No React Native imports here.
import type { ServiceResp, ServiceStop, WatchLeg } from './types';
import type { TextSize, TimeSource, TripRender, StaleStep, TripMemory, VoiceState } from './tripState';
import { boardIndexOf, isLiveTime, newTripMemory, offIndexOf, PHASE_INDEX, tripEvidence, tripLegTimes, tripPlanFrom, tripReadingFrom, tripRender, tripStep, TRIP_RULES, voiceGate } from './tripState';

export type LegLive = { dep: number; arr: number; delay: number; live: boolean; d: ServiceResp | null; gone?: boolean;
  /** The change to this leg was missed: dep and arr are the earliest you could go, not this service's times. */
  missed?: boolean; /** The departure of the service you missed. */ was?: number;
  /** The arrival at your stop is from live data: the stop's own live time, or the run's latest live delay carried on. */
  arrLive?: boolean; /** Minutes late at your stop off, from live data (ms). */ arrDelay?: number;
  /** How progress on this leg is known. Timetable means no live data: it never moves you on by the clock alone. */
  track?: Track; /** The run's next stop by that evidence (index into d.stops), -1 without a stop list. */ ni?: number;
  /** Your location shows you at your stop off on this refresh (kept in the memo as here). */ gpsHere?: boolean;
  /** Your location shows you are still before your stop off. */ gpsBefore?: boolean;
  /** What the live train shows for this leg (tripState evidence): still to leave, left your stop, at your stop off. */ phaseEv?: 'wait' | 'left' | 'at' };
export type Conn = { i: number; at: string; spare: number; risk: 'ok' | 'tight' | 'miss'; next: WatchLeg; nextDep: number };
/**
 * What progress on the current leg rests on: the vehicle's position, live times, your location, your own tap, or only
 * the timetable ("running to timetable, not live"). Only the first four ever move you on to the next leg.
 */
export type Track = 'vehicle' | 'live' | 'gps' | 'tap' | 'timetable';
/** The phone's position on the live trip screen (only with permission, only while a trip is on). at: when it was read. */
export type Pos = { lat: number; lon: number; acc?: number | null; at?: number | null };
export type LiveState =
  | { done: true; L2: LegLive[]; eta: number }
  | { done: false; cur: number; phase: 'wait' | 'ride'; nextIdx: number; stopsLeft: number | null; L2: LegLive[]; conns: Conn[]; eta: number; live: boolean;
      /** True when a missed change moved the arrival later than the legs' own times (no next service known yet). */
      etaLate?: boolean;
      /** How the current leg's progress is known (see Track). */
      track?: Track;
      /** Whole minutes late on the current leg from live data (at your stop off while riding, at your stop while waiting); null without live data. */
      delayMin?: number | null;
      /** The render model of the trip state (tripState.tripRender): the words every surface shows. */
      view?: TripRender;
      /** How old the live data is, in the steps of spec 2.4 (live, about, timetable, no-data, timetable-only). */
      step?: StaleStep | null;
      /** Where the current leg's departure and arrival come from (stop, board, run, timetable). */
      depSource?: TimeSource; arrSource?: TimeSource };

const tms = (s?: string | null) => (s ? new Date(s).getTime() : NaN);
export const tOf = (s?: ServiceStop | null) => (s ? tms(s.estimated || s.planned) : NaN);
/** Stops a service runs through without stopping have no time; they are not counted or named. */
export const timed = (s?: ServiceStop | null) => !!s && !!(s.planned || s.estimated) && !s.skipped;
const idx = (v?: number | null) => (typeof v === 'number' ? v : -1);
const hasXY = (s?: { lat?: number | null; lon?: number | null } | null): s is { lat: number; lon: number } => !!s && typeof s.lat === 'number' && typeof s.lon === 'number';

/** Metres between two points (haversine). */
export function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The run's live delay (ms) that applies at stop k: the latest stop at or before k with a live time. A feed's delay
 * carries on to later stops it does not list (GTFS realtime): Sydney Trains lists only the stops it has news for, and a
 * train's trip can end at Central and carry on to Town Hall under another trip (the 8:46 T1 from Strathfield on 26 Oct
 * 2026), so the stop you get off at often has no live time of its own. With nothing at or before k, the first live time
 * after it. Null when the run has no live time at all.
 */
export function carriedDelay(d: ServiceResp | null | undefined, k: number): number | null {
  if (!d || !d.stops || !d.stops.length) return null;
  const at = (s?: ServiceStop) => (s && s.estimated && s.planned && !s.skipped ? tms(s.estimated) - tms(s.planned) : null);
  for (let j = Math.min(k, d.stops.length - 1); j >= 0; j--) { const v = at(d.stops[j]); if (v != null && Number.isFinite(v)) return v; }
  for (let j = Math.max(0, k + 1); j < d.stops.length; j++) { const v = at(d.stops[j]); if (v != null && Number.isFinite(v)) return v; }
  return null;
}

/** A stop's live time: its own, else its timetable time plus the run's latest live delay before it. */
export function liveAt(d: ServiceResp, k: number): number {
  const s = d.stops[k];
  if (!s || s.skipped) return NaN;
  if (s.estimated) return tms(s.estimated);
  const dl = carriedDelay(d, k);
  return s.planned ? tms(s.planned) + (dl ?? 0) : NaN;
}

/**
 * The stop a vehicle is heading to (or standing at), from its position: under 150 m from a stop is at that stop,
 * otherwise the stop at the end of the nearest stretch of the route. -1 without a fresh position (3 minutes) or when
 * the vehicle is not on this part of the route.
 */
export function vehicleNext(d: ServiceResp | null | undefined): number {
  const v = d?.vehicle as { lat?: number; lon?: number; ageS?: number | null } | undefined;
  if (!d || !v || (typeof v.ageS === 'number' && v.ageS > 180) || !hasXY(v)) return -1;
  const st = d.stops;
  let best = Infinity, bi = -1, near = -1, nd = Infinity;
  for (let i = 0; i < st.length; i++) {
    const a = st[i];
    if (!hasXY(a)) continue;
    const da = distM(v, a);
    if (da < nd) { nd = da; near = i; }
    let j = i + 1;
    while (j < st.length && !hasXY(st[j])) j++;
    const b = st[j];
    if (!hasXY(b)) continue;
    const ex = da + distM(v, b) - distM(a, b);
    if (ex < best) { best = ex; bi = j; }
  }
  if (near >= 0 && nd < 150) return near;
  if (bi < 0 || best > 1500) return -1;
  return bi;
}

/**
 * Where the run is, and how that is known. The server says when its next stop came from the vehicle or only from the
 * timetable clock (progress); an older server does not, so a fresh vehicle position is read here, then live times
 * (with delays carried on to stops that have none), and only then the timetable.
 */
export function trackOf(d: ServiceResp | null | undefined, t: number): { ni: number; how: Track } {
  if (!d || !d.stops || !d.stops.length) return { ni: -1, how: 'timetable' };
  const sn = idx(d.nextIndex);
  const p = (d as { progress?: string }).progress;
  if (p === 'vehicle' && sn >= 0) return { ni: sn, how: 'vehicle' };
  const g = vehicleNext(d);
  if (g >= 0) return { ni: g, how: 'vehicle' };
  if (p === 'timetable') return { ni: sn, how: 'timetable' };
  if (d.stops.some((s) => !!s.estimated)) {
    const k = d.stops.findIndex((s, i) => timed(s) && liveAt(d, i) >= t - 20000);
    return { ni: k < 0 ? d.stops.length : k, how: 'live' };
  }
  return { ni: sn, how: 'timetable' };
}

/**
 * Your location against the run: at your stop off, still before it (near an earlier stop of the run), or past it.
 * Null without a fix under 2 minutes old and 500 m accurate, or without the run's stops.
 */
export function gpsOnRun(pos: Pos | null | undefined, d: ServiceResp | null | undefined, mi: number, ai: number, t: number): 'at' | 'before' | 'after' | null {
  if (!pos || !hasXY(pos) || !d || ai < 0 || !hasXY(d.stops[ai])) return null;
  if (pos.at != null && t - pos.at > 120000) return null;
  if (pos.acc != null && pos.acc > 500) return null;
  const thr = Math.max(300, Math.min(pos.acc || 0, 500));
  if (distM(pos, d.stops[ai] as { lat: number; lon: number }) <= thr) return 'at';
  let k = -1, dk = Infinity;
  for (let i = Math.max(0, mi); i < d.stops.length; i++) { const s = d.stops[i]; if (!hasXY(s)) continue; const m = distM(pos, s); if (m < dk) { dk = m; k = i; } }
  if (k < 0 || dk > 800) return null;
  return k < ai ? 'before' : k > ai ? 'after' : 'at';
}

/**
 * Where you are on the trip, from the one live trip state (tripState.ts, docs/TRIP_FLOW_SPEC.md 2.1 and 2.2). Departure,
 * delay and arrival of a leg all come from the same live time (stop live, board live, run live, else timetable; live
 * readings over 5 minutes old are not used), so the countdown and "4 min late" always agree (G1, G2, G17). The trip
 * moves only on live evidence: a leg is boarded when the vehicle or the stop's own live time shows the run has left your
 * stop (or it was seen being ridden before, memo.rode, or your location is on it), and ends when the vehicle or the
 * stop's own live time shows it at or past your stop off, your location is there, or you said so (memo.here). A
 * timetable time passing never moves it, and with no live data it holds where it was (G6, G7, G8). o.asOf: when the
 * live answers were loaded (defaults to now); o.plannerAt: when the planner estimate on the legs was captured.
 */
export type LiveOpts = { asOf?: number | null; plannerAt?: number | null; c24?: boolean; size?: TextSize };
export function computeLive(legs: WatchLeg[], svc: (ServiceResp | null | undefined)[], t: number, memo?: LiveMemo | null, pos?: Pos | null, o: LiveOpts = {}): LiveState {
  const last = legs.length - 1;
  const rode = memo?.rode || {};
  const here = memo?.here || {};
  // A trip that has arrived stays arrived, whatever a later feed says.
  if (memo?.arrivedAt) {
    const L0: LegLive[] = legs.map((l, i) => {
      const arr = here[i] ?? rode[i] ?? (l.arrPlanned ? tms(l.arrPlanned) : tms(l.planned));
      return { dep: tms(l.estimated || l.planned), arr, delay: 0, live: false, d: svc[i] || null };
    });
    return { done: true, L2: L0, eta: here[last] ?? rode[last] ?? memo.arrivedAt };
  }
  const asOf = o.asOf ?? t;
  // After you have been riding a leg, a feed that shows a vehicle still before your boarding stop is the next service
  // on the line, not yours: it is not used (the leg holds where it was).
  const use = legs.map((l, i) => { const d = svc[i] || null; return d && !sameRun(d, l, rode[i] != null) ? null : d; });
  const plan = tripPlanFrom(legs, use);
  const reading = tripReadingFrom(plan, legs, use, asOf, { plannerAt: o.plannerAt ?? null });
  const M = newTripMemory(plan);
  const fin: boolean[] = [];
  const rideEv: boolean[] = [];
  const L2: LegLive[] = legs.map((l, i) => {
    const d = use[i];
    if (here[i] != null) {
      // You said you got off here (or your location showed it): the leg is over at that time.
      fin[i] = true; rideEv[i] = true;
      return { dep: tms(l.estimated || l.planned), arr: here[i], delay: 0, live: !!d?.live, d, arrLive: true, track: 'tap', ni: -1 };
    }
    M.legs[i].phase = rode[i] != null ? PHASE_INDEX.onTheWay : PHASE_INDEX.waiting;
    M.current = i;
    const tm = tripLegTimes(plan, M, reading, i, t);
    const e = tripEvidence(plan, M, reading, i, t);
    const LR = reading.legs[i];
    const mi = d ? boardIndexOf(l, d) : -1, ai = d ? offIndexOf(l, d, mi) : -1;
    const vFresh = !!(LR && LR.vehicle && t - LR.vehicle.at < TRIP_RULES.LIVE_FRESH && t - asOf < TRIP_RULES.LIVE_FRESH);
    const anyLive = isLiveTime(tm.dep) || isLiveTime(tm.arr);
    let track: Track = LR && !LR.unmatched && vFresh ? 'vehicle' : anyLive ? 'live' : 'timetable';
    const dep = tm.dep.at;
    let arr = tm.arr.at;
    const arrLive = isLiveTime(tm.arr);
    const arrDelay = arrLive ? tm.arr.at - tm.arr.planned : undefined;
    const delay = isLiveTime(tm.dep) ? tm.dep.at - tm.dep.planned : 0;
    // the run's next stop by live evidence, as an index into the answer's stops
    const pi = Math.min(e.next, plan.legs[i].off);
    const sid = plan.legs[i].stops[pi]?.id;
    let ni = d && sid ? d.stops.findIndex((s) => s.id === sid) : -1;
    // Your location, when the live trip screen has it: at the stop off ends the leg, before it holds the leg.
    let gps = gpsOnRun(pos, d, mi, ai, t);
    if (!gps && pos && i < last) {
      // No stop list for this leg: being at the next leg's boarding stop is being at this leg's stop off.
      const n = use[i + 1] || null, nmi = n ? boardIndexOf(legs[i + 1], n) : -1;
      if (n && nmi >= 0 && hasXY(n.stops[nmi]) && hasXY(pos) && (pos.at == null || t - pos.at <= 120000) && (pos.acc == null || pos.acc <= 500)
        && distM(pos, n.stops[nmi] as { lat: number; lon: number }) <= Math.max(300, Math.min(pos.acc || 0, 500))) gps = 'at';
    }
    const past = !!e.passed;
    let done = false;
    // The live arrival has passed but nothing shows the train there yet (a vehicle still before the stop, a feed that
    // lags): held 30 s ahead once it is 30 s old, so nothing counts to a time behind you or says "Get off now" early.
    if (!(e.passed || e.arrived) && gps !== 'at' && gps !== 'after' && arrLive && t - arr >= 30000) arr = t + 30000;
    if (gps === 'at' || gps === 'after') done = true;
    else if (gps === 'before') done = false;
    else if (e.passed || e.arrived) done = true;
    fin[i] = done;
    rideEv[i] = done || !!e.leftBoard || rode[i] != null || gps === 'before' && !!e.leftBoard;
    if (gps === 'at' || gps === 'after') track = 'gps';
    if (!rideEv[i]) ni = mi;
    return { dep, arr, delay, live: anyLive, d, gone: past, arrLive, arrDelay, track, ni, phaseEv: e.arrived ? 'at' : e.leftBoard || rode[i] != null ? 'left' : 'wait',
      ...(gps === 'at' || gps === 'after' ? { gpsHere: true } : {}), ...(gps === 'before' ? { gpsBefore: true } : {}) };
  });
  // A change you missed: you got off the leg before (your tap or location), or rode it on live times, and the live
  // times say this leg left before you could get to it. It is not your train any more, so it neither counts down nor
  // ends the trip; its times move to the earliest you could leave, and the next service found for the change
  // (CardAlt, NextOption) replaces that guess. A leg that only ran to the timetable never counts as a change made.
  for (let i = 1; i < L2.length; i++) {
    const prev = here[i - 1] ?? rode[i - 1];
    if (prev == null || here[i] != null || !Number.isFinite(L2[i].dep)) continue;
    const ready = prev + (legs[i].walkBefore || 0) * 60000;
    if (connRisk(Math.round((L2[i].dep - ready) / 60000)) !== 'miss') continue;
    const lateBy = ready - L2[i].dep;
    L2[i] = { ...L2[i], dep: ready, arr: L2[i].arr + lateBy, gone: false, missed: true, was: L2[i].dep };
    fin[i] = false; rideEv[i] = false;
  }
  const cur = L2.findIndex((_, i) => !fin[i]);
  if (cur < 0) return { done: true, L2, eta: L2[last].arr };
  const x = L2[cur], d = x.d;
  const ai = d ? offIndexOf(legs[cur], d, boardIndexOf(legs[cur], d)) : -1;
  const mi = d ? boardIndexOf(legs[cur], d) : -1;
  const how: Track = x.track || 'timetable';
  const phase: 'wait' | 'ride' = x.missed ? 'wait' : rideEv[cur] ? 'ride' : 'wait';
  let nextIdx = d ? (x.ni ?? -1) : -1;
  if (d && nextIdx >= 0) { while (nextIdx < d.stops.length - 1 && nextIdx !== ai && !timed(d.stops[nextIdx])) nextIdx++; }
  // Stops left only when something real says where the run is.
  const stopsLeft = d && ai >= 0 && phase === 'ride' && how !== 'timetable' ? d.stops.slice(Math.max(nextIdx, mi + 1), ai + 1).filter(timed).length : null;
  const conns: Conn[] = [];
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
  // The render model every surface draws (one trip state): the same words on the card, the screen and the server push.
  for (let i = 0; i < legs.length; i++) {
    M.legs[i].phase = fin[i] ? PHASE_INDEX.arrived : rideEv[i] && !L2[i].missed ? PHASE_INDEX.onTheWay : PHASE_INDEX.waiting;
    if (fin[i]) { M.legs[i].arrivedAt = here[i] ?? t; M.legs[i].arrivedTime = here[i] ?? L2[i].arr; }
  }
  M.current = cur;
  const view = tripRender(plan, M, reading, t, { c24: !!o.c24, size: o.size || 'normal' });
  const tmc = tripLegTimes(plan, M, reading, cur, t);
  return { done: false, cur, phase, nextIdx, stopsLeft, L2, conns, eta: e.eta, live: x.live, track: how, delayMin, view, step: view.step || null,
    depSource: tmc.dep.source, arrSource: tmc.arr.source, ...(e.late ? { etaLate: true } : {}) };
}

/** A change with less than 2 minutes to spare is tight; a negative spare means the next leg leaves before you get there. */
export const connRisk = (spare: number): Conn['risk'] => (spare < 0 ? 'miss' : spare < 2 ? 'tight' : 'ok');

/**
 * The arrival time to count to while the live feed still shows the vehicle before your stop. An estimate that has
 * passed while the train is still on its way is wrong, so once the estimate is 30 seconds old the arrival stays 30 seconds ahead of now until the feed
 * shows the train at or past your stop (for at most 10 minutes past the estimate). This is what keeps "Get off now"
 * from showing before the train gets there.
 */
export function heldArrival(d: ServiceResp | null, ai: number, arr: number, t: number, short = false, next?: number) {
  if (!d || ai < 0 || !Number.isFinite(arr)) return arr;
  if (!short) {
    if (!d.live) return arr;
    const ni = next != null && next >= 0 ? next : idx(d.nextIndex);
    if (ni < 0 || ni > ai || d.stops[ai]?.passed) return arr;
  }
  // Feeds trail the train by up to half a minute, so an estimate under 30 seconds old stands.
  if (t - arr < 30000 || t - arr > 10 * 60000) return arr;
  return t + 30000;
}

/**
 * True when the feed has a vehicle position under 3 minutes old that is clearly before the stop you get off at: more
 * than 500 m from it and less than 90% of the way along the straight line from your boarding stop. The stop list's
 * "next stop" falls back to the timetable clock when a feed has no live times for it, which moved a 4 minute late T1
 * past Redfern on time (25 Oct 2026); the train's own position does not lie that way.
 */
export function vehicleShort(d: ServiceResp | null, mi: number, ai: number) {
  const v = d?.vehicle as { lat?: number; lon?: number; ageS?: number | null } | undefined;
  if (!d || !v || ai < 0 || mi < 0 || ai <= mi) return false;
  if (typeof v.lat !== 'number' || typeof v.lon !== 'number' || (typeof v.ageS === 'number' && v.ageS > 180)) return false;
  const A = d.stops[mi], B = d.stops[ai];
  if (typeof A?.lat !== 'number' || typeof A?.lon !== 'number' || typeof B?.lat !== 'number' || typeof B?.lon !== 'number') return false;
  const k = Math.cos((B.lat * Math.PI) / 180);
  const ax = A.lon * k, ay = A.lat, bx = B.lon * k, by = B.lat, vx = v.lon * k, vy = v.lat;
  const L2 = (bx - ax) ** 2 + (by - ay) ** 2;
  if (!(L2 > 0)) return false;
  const f = ((vx - ax) * (bx - ax) + (vy - ay) * (by - ay)) / L2;
  const distM = Math.hypot(vx - bx, vy - by) * 111320;
  return f < 0.9 && distM > 500;
}

/**
 * When you get to the end, from the leg you are on. A change you will make keeps the next leg's live arrival. A change
 * the live times say you will miss moves everything after it later by at least the time you are short, so the
 * arrival never reads earlier than you can get there; the next service found for that change replaces this guess.
 */
export function etaFrom(legs: WatchLeg[], L2: LegLive[], cur: number) {
  let end = L2[cur].arr;
  let late = false;
  for (let i = cur + 1; i < L2.length; i++) {
    const b = L2[i];
    const ready = end + (legs[i].walkBefore || 0) * 60000;
    const spare = Math.round((b.dep - ready) / 60000);
    if (connRisk(spare) !== 'miss' || !Number.isFinite(b.dep)) { end = b.arr; continue; }
    late = true;
    end = b.arr + (ready - b.dep);
  }
  return { eta: end, late };
}

/**
 * What the live trip remembers between refreshes: when each leg was last seen being ridden on live data, and its
 * arrival then (rode); when you got off each leg, by your tap or your location (here); and when the trip arrived.
 */
export type LiveMemo = { rode?: Record<number, number>; here?: Record<number, number>; arrivedAt?: number | null };

/**
 * True while a feed still describes your service: its timetable time at your stop matches the leg, and once you
 * have boarded, the vehicle is past your boarding stop. A feed for the next service on the line fails this.
 */
export function sameRun(d: ServiceResp, l: WatchLeg, boarded = true) {
  if (d.tripId && l.tripId && d.tripId !== l.tripId) return false;
  const mi = idx(d.mineIndex), ni = idx(d.nextIndex);
  // Timetable times never move with delays, so a boarding time more than 5 minutes off the planned one is another run.
  const mineS = mi >= 0 ? d.stops[mi] : null;
  if (mineS?.planned && l.planned && Math.abs(tms(mineS.planned) - tms(l.planned)) > 5 * 60000) return false;
  if (boarded && mi >= 0 && ni >= 0 && ni <= mi) return false;
  return true;
}

/** The memo after a refresh: the leg you are riding now records its arrival time. */
export function nextMemo(memo: LiveMemo | null | undefined, s: LiveState, now?: number): LiveMemo {
  const m: LiveMemo = { rode: { ...(memo?.rode || {}) }, arrivedAt: memo?.arrivedAt ?? null };
  const here: Record<number, number> = { ...(memo?.here || {}) };
  // Your location at a stop off is kept, so the leg stays over once the screen (and with it location) is closed.
  s.L2.forEach((x, i) => { if (x.gpsHere && here[i] == null && now != null) here[i] = now; });
  // A leg the live train showed at or past your stop off stays over (the feed may roll on to the next run or go quiet):
  // kept at its live arrival, never later than now (tripState evidence, never the clock).
  s.L2.forEach((x, i) => { if (x.phaseEv === 'at' && here[i] == null && now != null) here[i] = Number.isFinite(x.arr) ? Math.min(now, x.arr) : now; });
  if (Object.keys(here).length) m.here = here;
  // Only an arrival from live data is remembered: a timetable time must never later count as a change you made.
  if (!s.done && s.phase === 'ride' && s.track !== 'timetable' && s.L2[s.cur].arrLive !== false && Number.isFinite(s.L2[s.cur].arr)) m.rode![s.cur] = s.L2[s.cur].arr;
  return m;
}

/** True when the leg you are on has no live data: the screen, card and notification say "not live". */
export const notLive = (s: LiveState) => !s.done && s.track === 'timetable';

export type TripAlert = { key: string; title: string; body: string };
type Fmt = { clock: (t: number) => string; short: (n?: string | null) => string; plat: (p?: string | null) => string };

/**
 * The alerts this refresh should show, each once per trip: get off or change one stop before, tight or missed
 * connections, and one "You've arrived" at the end. When the server is watching the trip it sends all of these
 * itself (each once, and its watch ends at your stop), so the phone posts none. Keys are stable, so a key already in
 * `alerted` never fires again.
 */
export function tripAlerts(legs: WatchLeg[], s: LiveState, alerted: Record<string, 1>, serverWatching: boolean, f: Fmt): TripAlert[] {
  const out: TripAlert[] = [];
  const add = (key: string, title: string, body: string) => { if (!alerted[key] && !out.some((a) => a.key === key)) out.push({ key, title, body }); };
  const last = legs.length - 1;
  if (serverWatching) return out;
  if (s.done) {
    add('arrived', "You've arrived", `${f.short(legs[last]?.to)} at ${f.clock(s.eta)}. Trip alerts are off.`);
    return out;
  }
  // "Next stop" and "change here" only when the vehicle or live times say so, never by the timetable clock.
  if (s.phase === 'ride' && !notLive(s)) {
    const d = s.L2[s.cur].d, l = legs[s.cur];
    if (d && (d.alightIndex ?? -1) > 0 && s.nextIdx === d.alightIndex) {
      if (s.cur === last) add('off' + s.cur, `Next stop: ${f.short(l.to)}`, `Get ready to get off. You arrive at ${f.clock(s.eta)}.`);
      else { const n = legs[s.cur + 1]; add('off' + s.cur, `Next stop: ${f.short(l.to)}, change here`, `Then the ${f.clock(s.L2[s.cur + 1].dep)} ${n.line}${n.fromPlatform ? ' from ' + f.plat(n.fromPlatform) : ''}.`); }
    }
  }
  for (const cn of s.conns) {
    if (cn.risk === 'miss') add('conn' + cn.i, 'Connection at risk', `With live times you'll likely miss the ${f.clock(new Date(cn.next.planned).getTime())} ${cn.next.line} at ${f.short(cn.at)}.`);
    else if (cn.risk === 'tight') add('conn' + cn.i, `Tight change at ${f.short(cn.at)}`, `${Math.max(0, cn.spare)} min to catch the ${cn.next.line}.`);
  }
  return out;
}

/** A stop name as it should be heard: the part before the comma, with the sign abbreviations spelt out. */
export function sayName(n?: string | null): string {
  const words: [RegExp, string][] = [[/\bStn\b/g, 'Station'], [/\bRd\b/g, 'Road'], [/\bSt\b(?!\.)/g, 'Street'], [/\bAve?\b/g, 'Avenue'], [/\bPde\b/g, 'Parade'],
    [/\bHwy\b/g, 'Highway'], [/\bDr\b/g, 'Drive'], [/\bPl\b/g, 'Place'], [/\bCres\b/g, 'Crescent'], [/\bBvd\b/g, 'Boulevard'], [/\bNr\b/g, 'near'], [/\bOpp\b/g, 'opposite'], [/\bAt\b/g, 'at'], [/\bBefore\b/g, 'before'], [/\bAfter\b/g, 'after']];
  let v = String(n || '').split(',')[0].replace(/ Station$/, '').trim();
  for (const [re, w] of words) v = v.replace(re, w);
  return v;
}
const NOUN: Record<string, string> = { train: 'train', metro: 'metro', bus: 'bus', school: 'bus', coach: 'coach', ferry: 'ferry', lightrail: 'light rail' };
/** "platform 1", "stand X1", "wharf 2": lower case, as said in the middle of a sentence. */
const sayPlat = (p?: string | null) => {
  const v = String(p || '').trim();
  if (!v) return '';
  return /^(platform|stand|wharf|side)\b/i.test(v) ? v.charAt(0).toLowerCase() + v.slice(1) : /^\d+$/.test(v) ? `platform ${v}` : v;
};

/** "the T4 line", "the 410 bus", "the F1 ferry", "the L2 light rail": a line as an announcer says it. */
export function sayLineName(line?: string | null, mode?: string | null): string {
  const l = String(line || '').trim();
  const noun = NOUN[String(mode || '')] || '';
  if (!l) return noun ? `the ${noun}` : 'the next service';
  if (noun === 'train' || noun === 'metro') return `the ${l} line`;
  return noun ? `the ${l} ${noun}` : `the ${l}`;
}

/**
 * What trip guidance (Speak alerts) reads out, each once per trip (by key). Short announcer style sentences, in the
 * best installed voice (nativeExtras.speak), modelled on Sydney Trains and the newer buses:
 * "Your train to Redfern leaves in 3 minutes, from platform 1.", "Next stop, Redfern. Change here for the T4 line.",
 * "Your stop is next. Five Dock Shops.", a platform or stand change, running late (at 3, 5, 10 and 15 minutes),
 * a tight or missed change, and "You've arrived at Kings Cross." Keys match tripAlerts, so one moment is one line.
 */
export function speechCues(legs: WatchLeg[], s: LiveState, now: number, f: Fmt): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  const last = legs.length - 1;
  if (s.done) { out.push({ key: 'arrived', text: `You've arrived at ${sayName(legs[last]?.to)}.` }); return out; }
  const i = s.cur, l = legs[i], x = s.L2[i];
  if (!l || !x) return out;
  const noun = NOUN[l.mode] || 'service';
  if (s.phase === 'ride' && !notLive(s)) {
    const d = x.d;
    if (d && (d.alightIndex ?? -1) > 0 && s.nextIdx === d.alightIndex) {
      if (i === last) out.push({ key: 'off' + i, text: `Your stop is next. ${sayName(l.to)}.` });
      else { const n = legs[i + 1]; out.push({ key: 'off' + i, text: `Next stop, ${sayName(l.to)}. Change here for ${sayLineName(n.line, n.mode)}.` }); }
    }
  }
  for (const cn of s.conns) {
    const nl = sayLineName(cn.next.line, cn.next.mode);
    if (cn.risk === 'miss') out.push({ key: 'conn' + cn.i, text: `You may miss ${nl} at ${sayName(cn.at)}.` });
    else if (cn.risk === 'tight') { const m = Math.max(0, cn.spare); out.push({ key: 'conn' + cn.i, text: `Tight change at ${sayName(cn.at)}. ${m} minute${m === 1 ? '' : 's'} to catch ${nl}.` }); }
  }
  if (s.phase !== 'wait' || x.missed || !Number.isFinite(x.dep)) return out;
  const d = x.d, mi = idx(d?.mineIndex);
  const livePlat = d && mi >= 0 ? String(d.stops[mi]?.platform || '').trim() : '';
  const norm = (p?: string | null) => String(p || '').toLowerCase().replace(/^(platform|stand|wharf|side)\s*/, '').trim();
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

/**
 * The two moments that get one light haptic tap on a live trip: "leave now" (the service you are waiting for leaves
 * within a minute) and arrival. Keys, so each is felt once per trip.
 */
export function tapMoments(s: LiveState, now: number): string[] {
  if (s.done) return ['arrived'];
  const x = s.L2[s.cur];
  if (s.phase !== 'wait' || !x || x.missed || !Number.isFinite(x.dep)) return [];
  const left = x.dep - now;
  return left <= 60000 && left > -30000 ? ['leave' + s.cur] : [];
}

/** A moment read out or shown this long after it happened is still news; later it is not (getOffCore SAY_LATE_MS). */
export const CUE_LATE_MS = 45000;

/**
 * Whether a trip alert or spoken cue (by key) is too late to give (31 Oct): "You've arrived" more than 45 s after the
 * arrival, and "Next stop" / "Your stop is next" (off<k>) once the arrival at that stop has passed by the phone's clock
 * (R3, the same rule as departed services). Every other cue is about the state right now, so it is never stale.
 */
export function cueStale(key: string, s: LiveState, now: number): boolean {
  if (key === 'arrived') return !(s.done && Number.isFinite(s.eta) && now - s.eta <= CUE_LATE_MS);
  const m = /^off(\d+)$/.exec(key);
  if (!m) return false;
  if (s.done) return true;
  const a = s.L2[Number(m[1])]?.arr;
  return typeof a === 'number' && Number.isFinite(a) && a <= now;
}

/**
 * "Next stop" / "change here" for leg k (off<k>) when that stop's alert is already on the phone (31 Oct, Bidur: one
 * moment, one alert): the server's Get off now push (gnow<k>), or a location alert that rang while the app was closed
 * (rsoon<k>, rnow<k>). `shown` is what the phone shows now (getOffCore serverRungKeys, ownRungKeys), read before the
 * refresh, so the first refresh after opening the app does not post it a second time.
 */
export function offShownFor(shown: Record<string, 1> | null | undefined, key: string): boolean {
  const m = /^off(\d+)$/.exec(key);
  if (!m || !shown) return false;
  return !!(shown['gnow' + m[1]] || shown['rnow' + m[1]] || shown['rsoon' + m[1]]);
}

/** The phone's own "Next stop" alert for leg k (getOffCore next<k>, set ahead so it rings locked) has rung. */
function nextRung(g: LiveTripLike, k: string, now: number): boolean {
  const key = 'next' + k;
  const at = g.offSet?.[key];
  return !!g.alerted?.[key] || (typeof at === 'number' && at <= now);
}
function nextRang(g: LiveTripLike, key: string, now: number): boolean {
  const m = /^off(\d+)$/.exec(key);
  return !!m && nextRung(g, m[1], now);
}
/** Not read out again when that alert rang with its spoken sound, or the app already read it out. */
function nextSaid(g: LiveTripLike, key: string, now: number): boolean {
  const m = /^off(\d+)$/.exec(key);
  if (!m) return false;
  const k2 = 'next' + m[1];
  const at = g.offSet?.[k2];
  return !!g.spoken?.[k2] || (typeof at === 'number' && at <= now && !!g.offVoice?.[k2]);
}

export type LiveTripLike = {
  id: string; legs: WatchLeg[]; alerted: Record<string, 1>; watchId: string | null; share: { id: string; key: string; pos: boolean } | null;
  rode?: Record<number, number>; arrivedAt?: number | null;
  /** When you got off each leg, by your tap ("I'm at Town Hall") or your location. */
  here?: Record<number, number>;
  /** Wake me before my stop is on: its alarm replaces the plain "Next stop" alert for each leg. */
  wake?: boolean;
  /** Speak alerts is on, and the alerts already read out (their own memory, apart from the notifications). */
  speak?: boolean; spoken?: Record<string, 1>;
  /** The get off alerts set on the phone (getOffCore offSet, offVoice): read here only for "Next stop" (next<k>). */
  offSet?: Record<string, number>; offVoice?: Record<string, 1>;
  /** When the trip was started (the planner estimate on the legs is from then). */
  started?: number;
  /** The trip state's memory (tripState.TripMemory): phases from the live train and the calm steps already rung. */
  flow?: TripMemory;
};
export type LiveAction =
  | { t: 'ongoing'; title: string; body: string; leg: number }
  | { t: 'alert'; id: string; key: string; title: string; body: string; /** One light tap (the calm steps). */ haptic?: 'light'; /** A note with no sound. */ quiet?: boolean; expires?: number }
  | { t: 'say'; key: string; text: string }
  | { t: 'clearOngoing' }
  | { t: 'stopWatch'; id: string }
  | { t: 'share'; prog: any }
  | { t: 'end' };

/** Progress for a share link. */
export function progOf(s: LiveState | null, f: Pick<Fmt, 'short'>) {
  if (!s || s.done) return { phase: 'done' };
  const d = s.L2[s.cur].d, ns = d && s.nextIdx >= 0 ? d.stops[s.nextIdx] : null;
  return { leg: s.cur, phase: s.phase, next: ns ? f.short(ns.name) : null, stopsLeft: s.stopsLeft, eta: s.eta };
}

/** Words for the ongoing notification. */
export function liveWords(legs: WatchLeg[], s: LiveState, now: number, f: Fmt) {
  const last = legs.length - 1;
  if (s.done) return { title: "You've arrived", body: `${f.short(legs[last].to)} at ${f.clock(s.eta)}` };
  const l = legs[s.cur], x = s.L2[s.cur], d = x.d;
  const arrive = `Arrive ${f.clock(s.eta)} (${minsWords((s.eta - now) / 60000)})`;
  if (x.missed) return { title: `Change at risk at ${f.short(l.from)}`, body: `The ${x.was ? f.clock(x.was) + ' ' : ''}${l.line} has likely left. Open the app for the next way on. Arrive about ${f.clock(s.eta)}` };
  const late = s.delayMin != null && s.delayMin >= 2 ? `${s.delayMin} min late. ` : '';
  if (s.phase === 'wait') {
    const dm = Math.round((x.dep - now) / 60000);
    return { title: `${l.line} to ${f.short(l.towards || l.to)}`, body: `${s.cur ? 'Change to' : 'Board'} the ${l.line} ${dm <= 0 ? 'now' : `at ${f.clock(x.dep)}`}${l.fromPlatform ? `, ${f.plat(l.fromPlatform)}` : ''}. ${late}${arrive}` };
  }
  // No live data: say so, with the timetable time, and never name a next stop worked out from the clock.
  if (notLive(s)) return { title: `${l.line} to ${f.short(l.towards || l.to)}`, body: `Not live, running to timetable: due at ${f.short(l.to)} ${f.clock(x.arr)}. Arrive about ${f.clock(s.eta)}` };
  const ns = d && s.nextIdx >= 0 ? d.stops[s.nextIdx] : null;
  const yours = !!d && s.nextIdx === d.alightIndex;
  const left = s.stopsLeft != null ? `${s.stopsLeft} stop${s.stopsLeft === 1 ? '' : 's'} to ${f.short(l.to)}` : `to ${f.short(l.to)}`;
  return { title: `${l.line} to ${f.short(l.towards || l.to)}`, body: `${yours ? `Get off at ${f.short(l.to)}, next stop` : ns ? `Next stop: ${f.short(ns.name)}, ${left}` : `On the ${l.line}, ${left}`}. ${late}${arrive}` };
}

/**
 * One refresh of the trip you are on, as data: the new trip record, where you are, and what the phone should do
 * (update the ongoing notification, show an alert, stop the server alerts, update a share link, end the trip).
 * The live trip engine runs the actions; the replay tests check them.
 */
export function stepLive(g: LiveTripLike, svc: (ServiceResp | null | undefined)[], now: number, f: Fmt, pos?: Pos | null, shown?: Record<string, 1> | null, flow?: FlowCtx | null): { g: LiveTripLike; s: LiveState; actions: LiveAction[]; voiceUntil?: number } {
  const actions: LiveAction[] = [];
  const memo: LiveMemo = { rode: g.rode, here: g.here, arrivedAt: g.arrivedAt };
  const s = computeLive(g.legs, svc, now, memo, pos, flow ? { asOf: flow.asOf ?? now, plannerAt: g.started ?? null, c24: !!flow.c24 } : {});
  let n: LiveTripLike = g;
  const m = nextMemo(memo, s, now);
  if (JSON.stringify(m.rode || {}) !== JSON.stringify(g.rode || {})) n = { ...n, rode: m.rode };
  if (JSON.stringify(m.here || {}) !== JSON.stringify(g.here || {})) n = { ...n, here: m.here };
  if (flow) return stepFlow(g, n, s, svc, now, f, flow, actions);
  const list = tripAlerts(g.legs, s, n.alerted || {}, !!n.watchId, f).filter((a) => !(g.wake && a.key.startsWith('off')));
  if (list.length) {
    const alerted = { ...(n.alerted || {}) };
    for (const a of list) {
      alerted[a.key] = 1;
      // Not shown when its moment has gone (the app was in the background, 31 Oct): no late "You've arrived" banner
      // minutes after, and no "Next stop" once the stop is behind you by the phone's clock. Also not when the phone's
      // own "Next stop" alert set for this leg (getOffCore next<k>) has already rung: one moment, one alert.
      if (cueStale(a.key, s, now) || nextRang(g, a.key, now) || offShownFor(shown, a.key)) continue;
      actions.push({ t: 'alert', id: `trip-${g.id}-${a.key}`, key: a.key, title: a.title, body: a.body });
    }
    n = { ...n, alerted };
  }
  // Speak alerts reads out the same moments on its own: also when the server sends the notifications (the phone
  // then shows none, so before this nothing was ever said) and when the wake alarm stands in for "Next stop".
  // Never late (31 Oct, Bidur on build 210: "If i open app now. It will speak now", minutes after he arrived): the app
  // cannot speak in the background, so a moment that passed while it was there is kept as said, quietly.
  if (g.speak) {
    const said = n.spoken || {};
    const say = speechCues(g.legs, s, now, f).filter((a) => !said[a.key]);
    if (say.length) {
      const spoken = { ...said };
      for (const a of say) {
        spoken[a.key] = 1;
        if (cueStale(a.key, s, now) || nextSaid(g, a.key, now) || offShownFor(shown, a.key)) continue;
        actions.push({ t: 'say', key: a.key, text: a.text });
      }
      n = { ...n, spoken };
    }
  }
  if (s.done) {
    if (!n.arrivedAt) {
      if (n.share) actions.push({ t: 'share', prog: progOf(s, f) });
      // A server watch ends itself at your stop after its own "You've arrived", so it is left to finish.
      actions.push({ t: 'clearOngoing' });
      n = { ...n, arrivedAt: now };
    }
    if (now > (n.arrivedAt || now) + 10 * 60000) actions.push({ t: 'end' });
    return { g: n, s, actions };
  }
  const w = liveWords(g.legs, s, now, f);
  actions.push({ t: 'ongoing', title: w.title, body: w.body, leg: s.cur });
  if (n.share) actions.push({ t: 'share', prog: progOf(s, f) });
  return { g: n, s, actions };
}

/**
 * The new trip flow (phase 2, docs/TRIP_FLOW_SPEC.md 2.6 and 2.7) for one refresh with the app open. The calm sequence
 * (heads-up, Get off now at the live arrival minus 30 s, arrived), delay, platform, cancellation and missed change all
 * come from tripState.tripStep on the live train only, each once per stop (one moment key per step), and in-app speech
 * from voiceGate (V1 to V5: nothing in the first 10 s in front or the first two refreshes, nothing on Silent, nothing
 * from a reading over 60 s old, one queue). There is no timed "Wake me" alarm and no "Wake up" wording (G9).
 * asOf: when the live answers were loaded; voice: the speech state the engine keeps.
 */
export type FlowCtx = { asOf?: number | null; c24?: boolean; voice?: VoiceState | null; plannerAt?: number | null };
function stepFlow(g: LiveTripLike, n: LiveTripLike, s: LiveState, svc: (ServiceResp | null | undefined)[], now: number, f: Fmt, flow: FlowCtx, actions: LiveAction[]): { g: LiveTripLike; s: LiveState; actions: LiveAction[]; voiceUntil?: number } {
  const legs = g.legs;
  const use = legs.map((l, i) => { const d = svc[i] || null; return d && !sameRun(d, l, (g.rode || {})[i] != null) ? null : d; });
  const plan = tripPlanFrom(legs, use);
  const reading = tripReadingFrom(plan, legs, use, flow.asOf ?? now, { plannerAt: g.started ?? null });
  let M: TripMemory = g.flow && g.flow.legs.length === plan.legs.length ? (JSON.parse(JSON.stringify(g.flow)) as TripMemory) : newTripMemory(plan);
  // A leg the trip already finished by evidence (memo.here) is done in the trip state too.
  for (let i = 0; i < legs.length; i++) {
    const h = (n.here || {})[i];
    if (h != null && M.legs[i].phase < PHASE_INDEX.arrived) { M.legs[i].phase = PHASE_INDEX.arrived; M.legs[i].arrivedAt = h; M.legs[i].arrivedTime = h; M.legs[i].rung.getoff = M.legs[i].rung.getoff || 'skipped'; M.legs[i].rung.arrived = M.legs[i].rung.arrived || 'skipped'; if (M.current === i && i < legs.length - 1) M.current = i + 1; }
  }
  const res = tripStep(plan, M, now, reading, { c24: !!flow.c24, lead: 0 });
  let alerted = n.alerted || {};
  let spoken = n.spoken || {};
  let voiceUntil = flow.voice ? flow.voice.speakingUntil : 0;
  for (const mo of res.moments) {
    const key = 'f:' + mo.ring.moment;
    if (alerted[key]) continue;
    alerted = { ...alerted, [key]: 1 };
    const calm = mo.ring.kind === 'headsup' || mo.ring.kind === 'getoff' || mo.ring.kind === 'atstop';
    actions.push({ t: 'alert', id: `trip-${g.id}-${mo.ring.moment}`, key, title: mo.ring.title, body: mo.ring.body, ...(calm ? { haptic: 'light' as const } : {}), ...(mo.ring.quiet ? { quiet: true } : {}), ...(mo.ring.expires ? { expires: mo.ring.expires } : {}) });
    if (g.speak && flow.voice && mo.ring.say && !mo.ring.quiet) {
      const v = voiceGate({ ...flow.voice, speakingUntil: voiceUntil }, now, mo.ring.say, mo.age, mo.byVehicle);
      spoken = { ...spoken, [key]: 1 };
      if (v.words) { actions.push({ t: 'say', key, text: v.words }); voiceUntil = v.until; }
    }
  }
  // Tight and missed changes from the live times stay as before (each once per trip); "Next stop" and "You've
  // arrived" now come from the calm sequence above.
  const conn = tripAlerts(legs, s, alerted, false, f).filter((a) => a.key.startsWith('conn'));
  for (const a of conn) { alerted = { ...alerted, [a.key]: 1 }; actions.push({ t: 'alert', id: `trip-${g.id}-${a.key}`, key: a.key, title: a.title, body: a.body }); }
  n = { ...n, alerted, spoken, flow: M };
  if (s.done) {
    if (!n.arrivedAt) {
      if (n.share) actions.push({ t: 'share', prog: progOf(s, f) });
      actions.push({ t: 'clearOngoing' });
      n = { ...n, arrivedAt: now };
    }
    if (now > (n.arrivedAt || now) + 10 * 60000) actions.push({ t: 'end' });
    return { g: n, s, actions, voiceUntil };
  }
  const w = liveWords(legs, s, now, f);
  actions.push({ t: 'ongoing', title: w.title, body: w.body, leg: s.cur });
  if (n.share) actions.push({ t: 'share', prog: progOf(s, f) });
  return { g: n, s, actions, voiceUntil };
}

/**
 * The next moment the open app must step the trip again without waiting for the next 15 s refresh: Get off now at the
 * live arrival minus 30 s (the phone runs the same timer from the same trip state). Null when nothing is due soon.
 */
export function nextFlowMoment(g: LiveTripLike, s: LiveState, now: number): number | null {
  if (s.done) return null;
  const M = g.flow;
  const x = s.L2[s.cur];
  if (!M || !x || !x.arrLive || !Number.isFinite(x.arr)) return null;
  if (M.legs[s.cur]?.rung?.getoff) return null;
  const at = x.arr - TRIP_RULES.GETOFF_LEAD;
  return at > now && at - now <= 20000 ? at : null;
}

/**
 * One key per thing a server alert is about, so the same moment never shows twice: "Next stop: Kings Cross"
 * and "Arriving at Kings Cross in 2 min" for one watch share a key. `id` is the notification identifier, so a
 * newer alert about the same trip replaces the older one instead of stacking.
 */
export function noteKey(n: { id: number; watch_id?: string | null; title: string }): { key: string; id: string } {
  const w = n.watch_id || '';
  const m = /^(?:Next stop: |Arriving at |Change at )(.+?)(?:, change here| in \d+ min)?$/.exec(n.title || '');
  if (w && m) {
    const place = m[1].replace(/ Station$/i, '').trim().toLowerCase();
    return { key: `${w}|stop|${place}`, id: `w${w}-stop` };
  }
  if (w && /^(Connection at risk|Tight change)/i.test(n.title || '')) return { key: `${w}|conn|${n.title}`, id: `w${w}-conn` };
  return { key: `note|${n.id}`, id: `note-${n.id}` };
}

/** The bit of a route between where you board and where you get off, by the nearest path points. */
export function cutPath(path: [number, number][] | undefined, a?: ServiceStop | null, b?: ServiceStop | null): [number, number][] {
  if (!path || path.length < 2) return path || [];
  const near = (s?: ServiceStop | null) => {
    if (!s || s.lat == null || s.lon == null) return -1;
    let best = -1, bd = Infinity;
    path.forEach(([la, lo], k) => { const dd = (la - s.lat!) ** 2 + (lo - s.lon!) ** 2; if (dd < bd) { bd = dd; best = k; } });
    return best;
  };
  const i = near(a), j = near(b);
  if (i < 0 || j < 0 || j <= i) return path;
  return path.slice(i, j + 1);
}

/** Minutes, or hours and minutes past an hour: "9 min", "1 h 12 min". */
export function minsWords(m: number) {
  const v = Math.max(0, Math.round(m));
  return v < 60 ? `${v} min` : `${Math.floor(v / 60)} h ${v % 60} min`;
}
