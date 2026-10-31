// "It just knows" logic: the commute direction by time of day, when to leave for the station, waking you one stop
// before you get off, and the next option when a change will be missed. Plain functions with no React Native
// imports, so the unit tests and the replay test run them as they are.
import type { Journey, Leg, ServiceResp, WatchLeg } from './types';
import type { LiveState } from './liveCalc';

const SYD = 'Australia/Sydney';

/** Hour of the day in Sydney, 0 to 23. */
export function sydneyHour(t: number) {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: SYD }).format(new Date(t))) % 24;
  } catch {
    return new Date(t).getHours();
  }
}

/** Sydney date and half of the day, "2026-10-24 am". A swap of the commute card lasts until this changes. */
export function halfDayKey(t: number) {
  let d = '';
  try {
    d = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: SYD }).format(new Date(t));
  } catch {
    const x = new Date(t);
    d = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }
  return `${d} ${sydneyHour(t) < 12 ? 'am' : 'pm'}`;
}

/** Sydney clock time as HHMM, the time format /api/plan reads. */
export function sydHHMM(t: number) {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: SYD }).formatToParts(new Date(t));
    const h = p.find((x) => x.type === 'hour')?.value || '00', m = p.find((x) => x.type === 'minute')?.value || '00';
    return (h === '24' ? '00' : h) + m;
  } catch {
    const x = new Date(t);
    return String(x.getHours()).padStart(2, '0') + String(x.getMinutes()).padStart(2, '0');
  }
}

/** Before 12pm Sydney time the commute goes Home to Work, after 12pm Work to Home. A swap flips it. */
export function commuteDir(now: number, flipped: boolean): 'toWork' | 'toHome' {
  const morning = sydneyHour(now) < 12;
  return morning !== flipped ? 'toWork' : 'toHome';
}

export type LatLon = { lat: number; lon: number };

/** Straight line distance in metres. */
export function distM(a: LatLon, b: LatLon) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Walking minutes at 5 km/h in a straight line, rounded up. */
export function walkMin(a: LatLon, b: LatLon) {
  return Math.max(1, Math.ceil(distM(a, b) / (5000 / 60)));
}

/** Where the first service of a journey leaves from: the first point of its path. */
export function boardPoint(j: Journey): LatLon | null {
  const l = j.legs.find((x) => x.kind === 'transit');
  const p = l?.path?.[0];
  return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? { lat: p[0], lon: p[1] } : null;
}

const tms = (s?: string | null) => (s ? new Date(s).getTime() : NaN);
/** Live departure of the first service, else the timetable time. */
export function boardTime(j: Journey) {
  const l = j.legs.find((x) => x.kind === 'transit');
  if (!l) return tms(j.leave);
  const t = l.realtime && l.estimated ? tms(l.estimated) : tms(l.planned);
  return Number.isFinite(t) ? t : tms(j.leave);
}

/** Walks longer than this are not a walk to the station: you are somewhere else, so no leave time shows. */
export const MAX_WALK = 25;
/** A minute to get through the gates and onto the platform. */
export const PLATFORM_MIN = 1;

export type LeavePlan = { j: Journey; index: number; dep: number; leaveAt: number; inMin: number; walk: number; leg: Leg };

/**
 * When to leave: the first service you can still reach on foot (walk at 5 km/h plus a minute for the platform),
 * and how long until you have to go. Null when the walk is too long or nothing is reachable.
 */
export function leavePlan(js: Journey[], now: number, me: LatLon | null): LeavePlan | null {
  if (!me) return null;
  for (let i = 0; i < js.length; i++) {
    const j = js[i];
    const at = boardPoint(j);
    const leg = j.legs.find((x) => x.kind === 'transit');
    if (!at || !leg || leg.cancelled) continue;
    const walk = walkMin(me, at);
    if (walk > MAX_WALK) return null;
    const dep = boardTime(j);
    if (!Number.isFinite(dep)) continue;
    const leaveAt = dep - (walk + PLATFORM_MIN) * 60000;
    if (leaveAt < now - 30000) continue;
    return { j, index: i, dep, leaveAt, inMin: Math.max(0, Math.floor((leaveAt - now) / 60000)), walk, leg };
  }
  return null;
}

/**
 * Every service the card has loaded leaves before you could walk to it (trains a few minutes apart in the peak,
 * or a long walk), so leavePlan finds none: the moment from which you could board, so the card can ask for
 * services from then. Null when a loaded service is reachable, the walk is over MAX_WALK, or there is nothing to go on.
 */
export function reachFrom(js: Journey[], now: number, me: LatLon | null): number | null {
  if (!me || !js.length || leavePlan(js, now, me)) return null;
  const j = js.find((x) => boardPoint(x) && x.legs.some((l) => l.kind === 'transit' && !l.cancelled));
  const at = j ? boardPoint(j) : null;
  if (!at) return null;
  const walk = walkMin(me, at);
  if (walk > MAX_WALK) return null;
  return now + (walk + PLATFORM_MIN) * 60000;
}

/** "Leave now", "Leave in 6 min", "Leave in 1 h 5 min". */
export function leaveWords(p: LeavePlan) {
  if (p.inMin <= 0) return 'Leave now';
  return p.inMin < 60 ? `Leave in ${p.inMin} min` : `Leave in ${Math.floor(p.inMin / 60)} h ${p.inMin % 60} min`;
}

// ---------- Wake me before my stop ----------

type Fmt = { clock: (t: number) => string; short: (n?: string | null) => string };
const tOfStop = (s?: { planned?: string; estimated?: string } | null) => (s ? tms(s.estimated || s.planned) : NaN);
const timedStop = (s?: { planned?: string; estimated?: string; skipped?: boolean } | null) => !!s && !!(s.planned || s.estimated) && !s.skipped;

/**
 * When to wake you for leg k: as the service leaves the stop before the one you get off at (for a one stop ride,
 * as it leaves your boarding stop). From the live stop times the trip already uses; without them, 2 minutes
 * before the leg's arrival.
 */
export function wakeTime(s: LiveState, k: number): number {
  const x = s.L2[k];
  if (!x) return NaN;
  const d: ServiceResp | null = x.d;
  const mi = d?.mineIndex ?? -1, ai = d?.alightIndex ?? -1;
  if (d && mi >= 0 && ai > mi) {
    let p = ai - 1;
    while (p > mi && !timedStop(d.stops[p])) p--;
    const t = tOfStop(d.stops[p]);
    if (Number.isFinite(t)) return t;
  }
  return Math.max(x.dep, x.arr - 2 * 60000);
}

export type WakeTrip = { id: string; legs: WatchLeg[]; wake?: boolean; wakeSet?: Record<string, number>; alerted: Record<string, 1> };
export type WakeAction =
  | { t: 'wakeSchedule'; id: string; at: number; title: string; body: string }
  | { t: 'wakeDue'; id: string; title: string; body: string }
  | { t: 'wakeCancel'; id: string };

export const wakeId = (gid: string, k: number) => `wake-${gid}-${k}`;

/**
 * "Wake me before my stop" is gone (31 Oct, phase 2 of docs/TRIP_FLOW_SPEC.md, G9): it was an alarm set on the phone
 * ahead of time from stop times (timetable ones when that was all there was), with sudden "Wake up" words. The calm
 * sequence from the live train replaces it (heads-up, Get off now 30 s before the live arrival, arrived). This only takes
 * back an alarm an earlier version set for a trip still running, and never sets one.
 */
export function wakeStep(g: WakeTrip, _s: LiveState, now: number, _f?: Fmt): { g: WakeTrip; actions: WakeAction[] } {
  const actions: WakeAction[] = [];
  const set = { ...(g.wakeSet || {}) };
  const alerted = g.alerted || {};
  for (const k of Object.keys(set)) {
    if (!alerted['wake' + k] && set[k] > now) actions.push({ t: 'wakeCancel', id: wakeId(g.id, Number(k)) });
    delete set[k];
  }
  const changed = Object.keys(g.wakeSet || {}).length > 0;
  return { g: changed ? { ...g, wakeSet: set } : g, actions };
}

// ---------- Missed connection ----------

export type Missed = { i: number; at: string; readyAt: number; missing: WatchLeg; fromId: string; fromName: string; toId: string; toName: string };

/**
 * The first change the live times say you will miss, and what to plan from: the change stop once you get there
 * (arrival plus the walk between platforms) to where the trip ends.
 */
export function missedConn(legs: WatchLeg[], s: LiveState, dest?: { id: string; name: string } | null): Missed | null {
  if (s.done) return null;
  const cn = s.conns.find((c) => c.risk === 'miss');
  if (!cn) return null;
  const a = legs[cn.i], z = legs[legs.length - 1];
  const fromId = a.toParent || a.toStopId || legs[cn.i + 1].stopId;
  const toId = dest?.id || z.toParent || z.toStopId || '';
  if (!fromId || !toId) return null;
  const readyAt = s.L2[cn.i].arr + (legs[cn.i + 1].walkBefore || 0) * 60000;
  return { i: cn.i, at: cn.at, readyAt, missing: cn.next, fromId, fromName: a.to || '', toId, toName: dest?.name || z.to || '' };
}

/** The legs /api/plan takes for the next option: one leg from the change stop to the end, any service. */
export function missedPlanLegs(m: Missed) {
  return [{ f: m.fromId, fn: m.fromName, t: m.toId, tn: m.toName, a: 1 }];
}

/** The first journey you can still catch from the change stop, never the one you are missing. */
export function pickNextOption(js: Journey[], m: Missed): Journey | null {
  const missTrip = m.missing.tripId;
  const missPlanned = tms(m.missing.planned);
  for (const j of js) {
    const l = j.legs.find((x) => x.kind === 'transit');
    if (!l || l.cancelled || j.anyCancelled) continue;
    if (missTrip && l.tripId === missTrip) continue;
    if (!missTrip && l.line === m.missing.line && Math.abs(tms(l.planned) - missPlanned) < 60000) continue;
    if (boardTime(j) < m.readyAt) continue;
    return j;
  }
  return null;
}

/** Live trip legs from a planned journey, the shape the trip keeps (walks fold into the next leg's walkBefore). */
export function legsOf(j: Journey, short: (n?: string | null) => string): WatchLeg[] {
  const out: WatchLeg[] = [];
  let walk = 0;
  for (const x of j.legs) {
    if (x.kind === 'walk') { walk += x.durationMin; continue; }
    out.push({ mode: x.mode || 'bus', line: x.line || '', tripId: x.tripId, stopId: x.stopId || '', toStopId: x.toStopId, from: x.from, to: x.to, planned: x.planned || '', arrPlanned: x.arrPlanned,
      estimated: x.estimated, fromPlatform: x.fromPlatform, toPlatform: x.toPlatform, color: x.color, towards: short(x.towards), destId: x.destId, walkBefore: walk,
      fromParent: x.fromParent, toParent: x.toParent });
    walk = 0;
  }
  return out;
}

/**
 * The trip after you switch to the next option: legs up to the change stay, the rest are the new journey's. Alerts
 * and alarms for the replaced legs are cleared so they can ring for the new ones.
 */
export function switchLegs<T extends { legs: WatchLeg[]; alerted: Record<string, 1>; wakeSet?: Record<string, number>; rode?: Record<number, number>; offSet?: Record<string, number>; offRegion?: Record<string, string> }>(g: T, m: Missed, next: WatchLeg[]): T {
  const keep = g.legs.slice(0, m.i + 1);
  if (next.length && keep.length) next = [{ ...next[0], walkBefore: next[0].walkBefore || g.legs[m.i + 1]?.walkBefore || 0 }, ...next.slice(1)];
  const legs = [...keep, ...next].slice(0, 6);
  // Alerts about the missed change and anything after it can fire again for the new legs.
  const alerted: Record<string, 1> = {};
  for (const [k, v] of Object.entries(g.alerted || {})) {
    const mm = /^(off|conn|wake|early|gnow)(\d+)$/.exec(k);
    if (mm && (mm[1] === 'conn' ? Number(mm[2]) >= m.i : Number(mm[2]) > m.i)) continue;
    alerted[k] = v;
  }
  const wakeSet: Record<string, number> = {};
  for (const [k, v] of Object.entries(g.wakeSet || {})) if (Number(k) <= m.i) wakeSet[k] = v;
  const rode: Record<number, number> = {};
  for (const [k, v] of Object.entries(g.rode || {})) if (Number(k) <= m.i) rode[Number(k)] = v;
  // Get off alerts set for the legs that are replaced are dropped (the caller takes them off the phone).
  const offSet: Record<string, number> = {};
  for (const [k, v] of Object.entries(g.offSet || {})) { const mm = /(\d+)$/.exec(k); if (mm && Number(mm[1]) <= m.i) offSet[k] = v; }
  // Location alerts (31 Oct) for the legs that change are dropped the same way (Smart.tsx takes them off the phone).
  const offRegion: Record<string, string> = {};
  for (const [k, v] of Object.entries(g.offRegion || {})) { const mm = /(\d+)$/.exec(k); if (mm && Number(mm[1]) <= m.i) offRegion[k] = v; }
  return { ...g, legs, alerted, wakeSet, rode, ...(g.offSet ? { offSet } : {}), ...(g.offRegion ? { offRegion } : {}) };
}
