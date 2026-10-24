// Live trip maths, shared by the live trip screen and its tests. No React Native imports here.
import type { ServiceResp, ServiceStop, WatchLeg } from './types';

export type LegLive = { dep: number; arr: number; delay: number; live: boolean; d: ServiceResp | null };
export type Conn = { i: number; at: string; spare: number; risk: 'ok' | 'tight' | 'miss'; next: WatchLeg; nextDep: number };
export type LiveState =
  | { done: true; L2: LegLive[]; eta: number }
  | { done: false; cur: number; phase: 'wait' | 'ride'; nextIdx: number; stopsLeft: number | null; L2: LegLive[]; conns: Conn[]; eta: number; live: boolean };

const tms = (s?: string | null) => (s ? new Date(s).getTime() : NaN);
export const tOf = (s?: ServiceStop | null) => (s ? tms(s.estimated || s.planned) : NaN);
/** Stops a service runs through without stopping have no time; they are not counted or named. */
export const timed = (s?: ServiceStop | null) => !!s && !!(s.planned || s.estimated) && !s.skipped;
const idx = (v?: number | null) => (typeof v === 'number' ? v : -1);

/**
 * Where you are on the trip. The current leg is the first one whose live arrival at your stop is not yet
 * past (or the vehicle is already past your stop). Waiting until the vehicle passes your boarding stop.
 */
export function computeLive(legs: WatchLeg[], svc: (ServiceResp | null | undefined)[], t: number): LiveState {
  const last = legs.length - 1;
  const L2: LegLive[] = legs.map((l, i) => {
    const d = svc[i] || null;
    const mi = idx(d?.mineIndex), ai = idx(d?.alightIndex);
    const mineS = d && mi >= 0 ? d.stops[mi] : null, offS = d && ai >= 0 ? d.stops[ai] : null;
    const delay = mineS && mineS.estimated && mineS.planned ? tms(mineS.estimated) - tms(mineS.planned) : l.estimated ? tms(l.estimated) - tms(l.planned) : 0;
    const dep = mineS && Number.isFinite(tOf(mineS)) ? tOf(mineS) : tms(l.estimated || l.planned);
    const arr = offS && Number.isFinite(tOf(offS)) ? tOf(offS) : l.arrPlanned ? tms(l.arrPlanned) + delay : dep + 10 * 60000;
    const past = !!d && ai >= 0 && idx(d.nextIndex) > ai;
    return { dep, arr: past ? Math.min(arr, t - 60000) : arr, delay: delay || 0, live: !!d?.live, d };
  });
  const cur = L2.findIndex((x) => t < x.arr + 45000);
  if (cur < 0) return { done: true, L2, eta: L2[last].arr };
  const x = L2[cur], d = x.d;
  const mi = idx(d?.mineIndex), ai = idx(d?.alightIndex);
  let phase: 'wait' | 'ride' = 'wait';
  if (d && mi >= 0 && idx(d.nextIndex) > mi) phase = 'ride';
  else if (!d || mi < 0) phase = t >= x.dep ? 'ride' : 'wait';
  let nextIdx = d ? idx(d.nextIndex) : -1;
  if (d && nextIdx >= 0) { while (nextIdx < d.stops.length - 1 && nextIdx !== ai && !timed(d.stops[nextIdx])) nextIdx++; }
  const stopsLeft = d && ai >= 0 && phase === 'ride' ? d.stops.slice(Math.max(nextIdx, mi + 1), ai + 1).filter(timed).length : null;
  const conns: Conn[] = [];
  for (let i = cur; i < last; i++) {
    const a = L2[i], b = L2[i + 1];
    const spare = Math.round((b.dep - a.arr) / 60000 - (legs[i + 1].walkBefore || 0));
    conns.push({ i, at: legs[i].to || '', spare, risk: spare < 0 ? 'miss' : spare < 2 ? 'tight' : 'ok', next: legs[i + 1], nextDep: b.dep });
  }
  return { done: false, cur, phase, nextIdx, stopsLeft, L2, conns, eta: L2[last].arr, live: x.live };
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
