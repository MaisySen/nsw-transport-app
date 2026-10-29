// Instant paint (30 Oct 2026), the parts with no phone dependencies (tested in test/instantpaint.test.mjs).
// Trip results paint on the first frame: when the phone has no kept copy for the exact search (a new time, other mode
// chips), it builds timetable trips from the kept copy of the same trip from now (Home's card, the read ahead, the last
// visit) and the live answer replaces them in place when it lands. Saved trips are read ahead on open, within a budget.
//
// The live trip rules (Bidur, 29 Oct 11:34 PM, "we are a live trip viewer as well, we can't mess up"):
// R1 a phone built answer shows timetable times only: no Live badge, no countdown from a live time, no delay text.
//    A kept live row under the live cap keeps its live time with its true age, as before (liveLabelCore).
// R2 the 5 min live cap stays (LIVE_MAX_MS on the phone, FEED_LIVE_MAX_MS on the server).
// R3 departed services drop by the phone's clock on every paint, kept, phone built or live.
// R4 the live answer replaces the phone built one in place: same row keys (trip id), same order by time.
// R5 a phone built answer is never kept as if live and never lands under another search (worthKeeping, createLatest).
// R6 Start trip, its Live Activity and alerts arm only from a fresh live answer; from anything else they arm from the
//    timetable times and the live trip reads live times itself.
import type { Journey, Leg, TripResp } from './types';
import { LIVE_MAX_MS } from './liveLabelCore';

const ms = (s?: string | number | null) => (typeof s === 'number' ? s : s ? Date.parse(s) : NaN);
const iso = (t: number) => new Date(t).toISOString();

/** At most this many phone built trips: about a screen. */
export const SEED_MAX = 10;
/** A copy older than this does not seed (it was made for another part of the day). */
export const SEED_MAX_AGE_MS = 6 * 3600 * 1000;
/** Arrive by: trips that get there more than this before the time are not shown from the phone. */
export const SEED_ARRIVE_SPAN_MS = 3 * 3600 * 1000;

/** A leg with its timetable times only (R1): every live field goes. */
export function timetableLeg(l: Leg): Leg {
  const { estimated, arrEstimated, realtime, delayMin, cancelled, occupancy, platformChangedFrom, vehicle, stopsAway, ahead, seenAt, traffic, ...rest } = l as any;
  return { ...rest, realtime: false, delayMin: null } as Leg;
}

const firstTransit = (j: Journey) => (Array.isArray(j?.legs) ? j.legs.find((l) => l && l.kind === 'transit') : undefined);
const lastTransit = (j: Journey) => (Array.isArray(j?.legs) ? [...j.legs].reverse().find((l) => l && l.kind === 'transit') : undefined);

/** When the journey's first service leaves by the timetable (ms), else its leave time. */
export function plannedLeave(j: Journey): number {
  const l = firstTransit(j);
  const p = l ? ms(l.planned) : NaN;
  return Number.isFinite(p) ? p : ms(j?.leave);
}
/** When the journey gets there by the timetable (ms), else its arrive time. */
export function plannedArrive(j: Journey): number {
  const l = lastTransit(j);
  const p = l ? ms(l.arrPlanned) : NaN;
  if (!Number.isFinite(p)) return ms(j?.arrive);
  // Walk legs after the last service keep their minutes.
  const after = j.legs.slice(j.legs.lastIndexOf(l!) + 1).reduce((s, x) => s + (x.kind === 'walk' ? (Number(x.durationMin) || 0) : 0), 0);
  return p + after * 60000;
}

/** The journey as timetable times (R1), or null when it cannot be shown honestly: a cancelled service (its live
 * answer said so; the phone will not show it as running) or no timetable time. */
export function timetableJourney(j: Journey): Journey | null {
  if (!j || !Array.isArray(j.legs) || !j.legs.length) return null;
  if (j.anyCancelled || j.legs.some((l) => l && l.cancelled)) return null;
  const f = firstTransit(j);
  if (!f || !Number.isFinite(ms(f.planned))) return null;
  const board = ms(f.planned);
  const wasBoard = ms(j.board);
  const wasLeave = ms(j.leave);
  // The walk before the first service keeps its minutes.
  const leave = Number.isFinite(wasLeave) && Number.isFinite(wasBoard) ? wasLeave + (board - wasBoard) : board;
  const arrive = plannedArrive(j);
  const { live, warn, risk, riskText, seenAt, anyCancelled, liftOutages, ...rest } = j as any;
  return {
    ...rest,
    legs: j.legs.map((l) => (l.kind === 'transit' ? timetableLeg(l) : { ...l })),
    live: false,
    leave: iso(leave),
    board: iso(board),
    arrive: Number.isFinite(arrive) ? iso(arrive) : j.arrive,
    durationMin: Number.isFinite(arrive) ? Math.max(0, Math.round((arrive - leave) / 60000)) : j.durationMin,
  } as Journey;
}

/** The trip key a journey shows under (the trip screen's jKey): the first service's trip id, else line and time.
 * The phone built and the live journey of the same service share it, so the live answer replaces it in place (R4). */
export function seedRowKey(j: Journey): string {
  const l = firstTransit(j);
  return l ? l.tripId || `${l.line}|${l.planned}` : String(j.leave);
}

export type SeedWindow = {
  /** The moment the list is for: now, or the chosen Leave at or Arrive by time. */
  anchor: number;
  arriveBy: boolean;
  now: number;
  /** Step free trips (acc=1) asked: only a copy that was asked the same way seeds. */
  accessible?: boolean;
};

/**
 * Timetable trips for the trip screen's first frame from the kept copy of the same trip from now (`base`, the
 * answer to "this trip, leaving now, any mode"), or null. Only when the copy covers the moment asked for: it was
 * asked before it and its trips reach past it, so no service between them can be missing. Services already gone by
 * the phone's clock never show (R3). Marked `seeded` and `phoneBuilt` so it is never kept (R5) and never live (R1).
 */
export function tripSeed(base: { at: number; data: any } | null | undefined, w: SeedWindow): { at: number; data: TripResp } | null {
  try {
    if (!base || !base.data || !Number.isFinite(base.at) || !Array.isArray(base.data.journeys)) return null;
    const d = base.data;
    if (d.error || d.seeded || d.phoneBuilt) return null;
    if (w.now - base.at > SEED_MAX_AGE_MS || base.at > w.now + 60000) return null;
    if (!!w.accessible !== !!d.accessible) return null;
    // A copy for other mode chips leaves services out; only the any mode answer seeds.
    if (Array.isArray(d.modes) && d.modes.length) return null;
    if (d.modesBy === 'server') return null;
    const all = (d.journeys as Journey[]).map((j) => ({ j, dep: plannedLeave(j), arr: plannedArrive(j) })).filter((x) => Number.isFinite(x.dep));
    if (!all.length) return null;
    // Covered: asked at base.at (from now), so the trips from then on are all there up to its last one.
    if (w.anchor < base.at - 60000) return null;
    const lastDep = Math.max(...all.map((x) => x.dep));
    const lastArr = Math.max(...all.map((x) => (Number.isFinite(x.arr) ? x.arr : -Infinity)));
    let pick: typeof all;
    if (w.arriveBy) {
      if (!(w.anchor <= lastArr)) return null;
      pick = all.filter((x) => Number.isFinite(x.arr) && x.arr <= w.anchor && x.arr >= w.anchor - SEED_ARRIVE_SPAN_MS);
    } else {
      if (!(w.anchor <= lastDep)) return null;
      pick = all.filter((x) => x.dep >= w.anchor);
    }
    // R3: gone by the phone's clock.
    pick = pick.filter((x) => x.dep > w.now);
    const out: Journey[] = [];
    const seen = new Set<string>();
    for (const x of pick.sort((a, b) => a.dep - b.dep)) {
      const j = timetableJourney(x.j);
      if (!j) continue;
      const k = seedRowKey(j);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(j);
    }
    const list = w.arriveBy ? out.slice(-SEED_MAX) : out.slice(0, SEED_MAX);
    if (!list.length) return null;
    const data: any = { kind: 'trip', from: d.from, to: d.to, journeys: list, now: w.now, source: 'timetable', seeded: true, phoneBuilt: true, modesBy: 'phone' };
    if (d.accessible) data.accessible = true;
    return { at: base.at, data: data as TripResp };
  } catch {
    return null;
  }
}

/** The line above phone built trips: timetable times, and whether live times are on their way or unavailable. */
export function phoneBuiltText(failed: boolean): string {
  return failed ? 'Timetable times. Live trips are unavailable right now.' : 'Timetable times. Getting live times.';
}

/** True when what the trip screen shows is phone built (R1: label it as timetable times, never live). */
export const isPhoneBuilt = (d: any) => !!(d && d.phoneBuilt === true);

/**
 * R6: whether Start trip, its Live Activity and alerts may arm from the live times on screen. Only a live answer of
 * this opening, read within the live cap, with the phone online. A kept copy, a phone built answer or an offline
 * screen arm from the timetable times instead.
 */
export function armFresh(s: { data: any; updatedAt: number | null | undefined; offlineAt?: number | null; staleAt?: number | null; now: number }): boolean {
  if (!s.data || isPhoneBuilt(s.data) || s.data.seeded) return false;
  if (s.offlineAt != null || s.updatedAt == null || !Number.isFinite(s.updatedAt)) return false;
  return s.now - s.updatedAt <= LIVE_MAX_MS;
}

/** R6: the spec Start trip arms from: live times only when fresh, else every leg on its timetable time. */
export function armSpec<S extends { legs: { estimated?: string | null }[] }>(spec: S, fresh: boolean): S {
  if (fresh) return spec;
  return { ...spec, legs: spec.legs.map((l) => { const { estimated, ...rest } = l as any; return rest; }) } as S;
}
