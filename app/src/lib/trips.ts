import { api } from './api';
import { bestTime, ms, shortName } from './format';
import type { Fare, Journey, Leg, Place, TripResp } from './types';
import { apiBase } from './server';

/** One leg of a saved trip: mode, change time before it (legs after the first), all services, walk minutes. */
export type TripLeg = { mode: string; from: Place; to: Place; conn?: number; any?: boolean; walk?: number };
/** A trip as Home and the trip screen plan it: one or more legs. Older trips have an optional `via` with `conn`. */
export type PlanTrip = { from: Place; to: Place; via?: Place | null; conn?: number; legs?: TripLeg[]; modes?: string[] };

/** The legs of a trip, for both the multi leg form and the older via form. */
export function tLegs(t: PlanTrip): TripLeg[] {
  if (t.legs && t.legs.length) return t.legs;
  const md = t.modes || [];
  return t.via
    ? [{ mode: md[0] || '', from: t.from, to: t.via }, { mode: md[1] || '', from: t.via, to: t.to, conn: t.conn ?? 5 }]
    : [{ mode: md[0] || '', from: t.from, to: t.to }];
}
export const isChain = (t: PlanTrip) => tLegs(t).length > 1;
export const tripKey = (t: PlanTrip) => [t.from.id, ...tLegs(t).slice(0, -1).map((l) => l.to.id), t.to.id].join('>');
export const viaText = (t: PlanTrip) => tLegs(t).slice(0, -1).map((l) => stName(shortName(l.to.name))).join(', ');
export const wireLegs = (t: PlanTrip) => tLegs(t).map((l) => ({ f: l.from.id, fn: l.from.name, t: l.to.id, tn: l.to.name, m: l.mode || '', c: l.conn ?? 5, a: l.any ? 1 : 0, w: l.walk ?? 5 }));
/** Reverse a trip: legs in the other order, each change time stays with its change stop. */
export function reverseTrip(t: PlanTrip): PlanTrip {
  const L = tLegs(t), n = L.length;
  const legs = L.map((_, i) => ({ ...L[n - 1 - i], from: L[n - 1 - i].to, to: L[n - 1 - i].from, conn: i ? L[n - i].conn : undefined }));
  return { from: t.to, to: t.from, legs: n > 1 ? legs : undefined, modes: legs.map((l) => l.mode) };
}

export const MODES = [
  { k: 'train', name: 'Train', sub: 'Sydney Trains and NSW TrainLink' },
  { k: 'metro', name: 'Metro', sub: 'Sydney Metro' },
  { k: 'bus', name: 'Bus', sub: 'Route number or stop' },
  { k: 'ferry', name: 'Ferry', sub: 'Every wharf' },
  { k: 'lightrail', name: 'Light rail', sub: 'Sydney, Parramatta and Newcastle' },
] as const;
export type ModeKey = (typeof MODES)[number]['k'];
export const modeName = (k?: string) => MODES.find((m) => m.k === k)?.name || 'Any service';

const firstLeg = (j: Journey): Leg | undefined => j.legs.find((l) => l.kind === 'transit');
const lastLeg = (j: Journey): Leg | undefined => [...j.legs].reverse().find((l) => l.kind === 'transit');
export const transitCount = (j: Journey) => j.legs.filter((l) => l.kind === 'transit').length;
/** Stops at both ends: no change on the way (one change allowed at the via stop of an extended trip). */
export const isDirect = (j: Journey, t?: PlanTrip) => transitCount(j) <= (t ? tLegs(t).length : 1);

/** Default is services that stop at both ends; falls back to all of them when none do. */
export function directFilter<T>(list: T[], t: PlanTrip, all: boolean, getJ: (x: T) => Journey) {
  if (all) return { list, none: false };
  // Multi leg trips are filtered per leg on the server.
  if (isChain(t)) return { list, none: false };
  const d = list.filter((x) => isDirect(getJ(x), t));
  return d.length || !list.length ? { list: d, none: false } : { list, none: true };
}

const leaveOf = (j: Journey) => {
  const f = firstLeg(j);
  const walk = j.legs.slice(0, Math.max(0, j.legs.indexOf(f as Leg))).reduce((a, l) => a + (l.durationMin || 0), 0);
  const dep = f ? bestTime(f.planned, f.realtime ? f.estimated : null) : ms(j.leave);
  return { dep, leave: dep - walk * 60000 };
};
const arrOf = (j: Journey) => {
  const l = lastLeg(j);
  const a = l ? bestTime(l.arrPlanned, l.realtime ? l.arrEstimated : null) : NaN;
  return Number.isFinite(a) ? a : ms(j.arrive);
};

export function hhmmSydney(t: number) {
  const p = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t));
  const h = Number(p.find((x) => x.type === 'hour')?.value || 0) % 24;
  return String(h).padStart(2, '0') + (p.find((x) => x.type === 'minute')?.value || '00');
}

/**
 * Plans a trip. With a via stop each first leg is paired with the first second leg
 * that leaves at least the connection time after it arrives.
 */
export async function planTrip(t: PlanTrip, opts: { refresh?: boolean; count?: number; time?: string; all?: boolean } = {}): Promise<TripResp> {
  if (isChain(t)) return api.plan(wireLegs(t), { count: opts.count, time: opts.time, all: opts.all });
  if (!t.via) return api.trip(t.from, t.to, opts);
  const conn = Math.max(0, t.conn ?? 5) * 60000;
  const d1 = await api.trip(t.from, t.via, { ...opts, refresh: true });
  const j1 = (d1.journeys || []).filter((j) => isDirect(j));
  if (!j1.length) return { ...d1, to: { id: t.to.id, name: t.to.name }, journeys: [] };
  const firstArr = Math.min(...j1.map(arrOf));
  const d2 = await api.trip(t.via, t.to, { refresh: true, count: 8, time: hhmmSydney(firstArr + conn) });
  const j2 = (d2.journeys || []).filter((j) => isDirect(j)).map((j) => ({ j, ...leaveOf(j) })).sort((a, b) => a.leave - b.leave);
  const journeys: Journey[] = [];
  for (const a of j1) {
    const arr = arrOf(a);
    const b = j2.find((o) => o.leave >= arr + conn);
    if (!b) continue;
    const legs2 = b.j.legs.map((l) => ({ ...l }));
    const f2: any = legs2.find((l) => l.kind === 'transit');
    const gap = Math.round((b.dep - arr) / 60000);
    if (f2) f2.transfer = { minutes: gap, at: t.via.name, risk: gap < conn / 60000 ? 'tight' : '' };
    journeys.push({ ...a, legs: [...a.legs, ...legs2], changes: ((a as any).changes || 0) + ((b.j as any).changes || 0) + 1, arrive: b.j.arrive, fare: addFares(a.fare, b.j.fare) } as Journey);
  }
  return { ...d1, to: d2.to || { id: t.to.id, name: t.to.name }, journeys };
}

/** Two separately planned parts of a via trip: their fares added up (a little high when a transfer discount would apply). */
function addFares(x?: Fare | null, y?: Fare | null): Fare | null {
  if (!x || !y || x.total == null || y.total == null) return null;
  return { ...x, total: Math.round((x.total + y.total) * 100) / 100, peak: x.peak || y.peak, offPeak: null, transfer: (x.transfer || 0) + (y.transfer || 0),
    airportFee: (x.airportFee || 0) + (y.airportFee || 0), capped: x.capped || y.capped, unknown: x.unknown || y.unknown, legs: [...(x.legs || []), ...(y.legs || [])] };
}

// ---------- station lists for New Trip ----------
export type Station = [id: string, name: string, lat: number, lon: number];
export type BusDir = { to: string; stops: Station[] };
const mem = new Map<string, Promise<any>>();
function get<T>(path: string): Promise<T> {
  let p = mem.get(path);
  if (!p) {
    p = fetch(apiBase() + path).then((r) => { if (!r.ok) throw new Error('Could not load the list. Check your connection.'); return r.json(); });
    p.catch(() => mem.delete(path));
    mem.set(path, p);
  }
  return p;
}
export const stationsFor = (mode: string) => get<Station[]>(`/api/stations?mode=${encodeURIComponent(mode)}`);
export const busRoutes = () => get<Record<string, string>>('/api/stations?mode=bus');
export const busRoute = (r: string) => get<BusDir[]>(`/api/stations?mode=bus&route=${encodeURIComponent(r)}`);
export const stName = (n: string) => String(n || '').replace(/ (Station|Light Rail|Wharf)$/i, '');
export const natCmp = (a: string, b: string) => {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  if (isNaN(na) !== isNaN(nb)) return isNaN(na) ? 1 : -1;
  return a.localeCompare(b);
};
export const geoDist = (a: number, b: number, c: number, d: number) => {
  const r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
};
