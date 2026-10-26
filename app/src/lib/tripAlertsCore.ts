// Saved trip alerts (More > Alerts for my trips, docs/FEATURES.md): what the phone tells the server about its trips.
// The server (backend/src/tripalerts.js) matches service alerts and planned work to these trips and pushes only when
// one touches a trip near the time it is travelled. No React here, so the rules are unit tested (test/tripalerts.test.mjs).
import type { TripLines } from './trackworkCore';

/** One leg: line, mode, where it boards and where it gets off (station ids when known). */
export type AlertLeg = { l: string; m: string; f: string; t: string };
/** When a trip is travelled: d = days (0 Sunday to 6 Saturday), m = minute of the day. */
export type AlertTime = { d: number[]; m: number };
export type AlertTrip = { n: string; f: string; t: string; legs: AlertLeg[]; times: AlertTime[] };

const MAX_TRIPS = 8;
const MAX_LEGS = 8;

/** Trip reminders count days 1 Sunday to 7 Saturday (expo-notifications). */
export function reminderTimes(list: { hour: number; minute: number; days: number[] }[] | undefined): AlertTime[] {
  return (list || []).map((r) => ({ d: [...new Set(r.days.map((d) => d - 1).filter((d) => d >= 0 && d <= 6))].sort(), m: r.hour * 60 + r.minute })).filter((x) => x.d.length);
}
/** Morning checks count days 1 Monday to 7 Sunday and keep the time as "HH:MM". */
export function morningTimes(list: { from?: { id?: string }; to?: { id?: string }; time?: string; days?: number[]; active?: boolean }[] | undefined, f: string, t: string): AlertTime[] {
  const out: AlertTime[] = [];
  for (const c of list || []) {
    if (c.active === false || c.from?.id !== f || c.to?.id !== t) continue;
    const m = /^(\d{1,2}):(\d{2})$/.exec(c.time || '');
    if (!m) continue;
    const d = [...new Set((c.days || []).map((x) => x % 7).filter((x) => x >= 0 && x <= 6))].sort();
    if (d.length) out.push({ d, m: Number(m[1]) * 60 + Number(m[2]) });
  }
  return out;
}

/**
 * The trips to send: the ones on Home that report their services (saved trips, Home and Work, the usual commute),
 * each with the legs of the services its card shows and its times (its reminders by trip key, its morning checks).
 */
export function alertTrips(trips: TripLines[], timesOf: (tr: TripLines) => AlertTime[]): AlertTrip[] {
  const out: AlertTrip[] = [];
  const seen = new Set<string>();
  for (const tr of trips) {
    const k = `${tr.f}>${tr.t}`;
    if (seen.has(k) || !tr.legs?.length) continue;
    seen.add(k);
    out.push({ n: tr.name, f: tr.f, t: tr.t, legs: tr.legs.slice(0, MAX_LEGS), times: timesOf(tr) });
    if (out.length >= MAX_TRIPS) break;
  }
  return out;
}

/** A short key: the same trips, legs and times give the same key, so the server is told only when they change. */
export function alertTripsKey(trips: AlertTrip[]): string {
  return trips.map((t) => [t.f, t.t, t.legs.map((l) => `${l.l}:${l.f}:${l.t}`).join(','), t.times.map((x) => `${x.d.join('')}@${x.m}`).join(',')].join('|')).sort().join(';');
}

/** The reminders of a Home trip: reminder keys are the trip key, Home's key is the trip key plus its legs. */
export function remindersFor<T>(all: Record<string, T>, homeKey: string): T | undefined {
  for (const [k, v] of Object.entries(all)) if (homeKey === k || (homeKey.startsWith(k) && homeKey.charAt(k.length) === '[')) return v;
  return undefined;
}
