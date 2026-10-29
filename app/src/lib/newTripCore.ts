// New trip first look (30 Oct 2026), the parts with no phone dependencies (tested in test/newtrip.test.mjs).
// A brand new A to B search (no kept copy of its own, no kept copy of the same trip from now to build from) used to
// show placeholder rows until the Trip Planner answered, 1 to 1.5 s from Sydney. When the server says it serves
// trip-tt (x-serves, servesCore.ts), the trip screen asks a second, quick request beside its normal one: GET /api/trip
// with tt=1, which the server answers from its own timetable only (no Trip Planner call, about 0.1 to 0.3 s). Those
// trips paint as timetable times (the same label as the phone built ones, instantPaintCore.ts) and the normal
// request's live answer replaces them in place. A server without trip-tt (rolled back, switched off, the budget
// guard) gets no extra request: the phone keeps its placeholder rows as before.
//
// Bidur's live trip rules hold (instantPaintCore.ts R1 to R6): a first look is never live (every live field taken off
// again here, whatever the server sent), gone services drop by the phone's clock, rows share the live answer's keys
// (the first service's trip id), it is never kept on the phone, and Start trip never arms live times from it.
import type { Journey, TripResp } from './types';
import { isPhoneBuilt, plannedLeave, SEED_MAX, seedRowKey, timetableJourney } from './instantPaintCore';

/** The x-serves word (backend worker.js SERVES). */
export const TRIP_TT = 'trip-tt';
/** The phone's deadline for the first look: past it the live answer is close anyway. The server gives up at 1.5 s. */
export const TT_FIRST_MS = 2500;

export type TtFirstAsk = {
  /** The server in use says trip-tt (serves()). */
  served: boolean;
  /** A plain A to B trip: not a trip with set legs or via a stop. */
  plain: boolean;
  /** Step free trips: the timetable cannot say which services are step free, so never from it. */
  accessible: boolean;
  /** A long trip (regional, long trip path): the server's own path handles it. */
  long: boolean;
  /** The first frame already shows something: a kept copy, a phone built seed or the screen before. */
  painted: boolean;
};

/** Whether the trip screen asks the first look beside its normal request: only for a plain new search with nothing
 * on screen, from a server that serves it. */
export function ttFirstWanted(a: TtFirstAsk): boolean {
  return !!(a && a.served && a.plain && !a.accessible && !a.long && !a.painted);
}

/** The first look's query: the normal search's own words (from, to, names, count, time, arrive by, date, modes),
 * never a page, a day list, a poll or step free, plus tt=1. */
export function ttFirstQuery(q: { from: string; to: string; fromName?: string; toName?: string; count?: number; time?: string; arriveBy?: boolean; date?: string; modes?: string[]; fare?: string }): Record<string, string> {
  const out: Record<string, string> = { from: String(q.from), to: String(q.to) };
  if (q.fromName) out.fromName = q.fromName;
  if (q.toName) out.toName = q.toName;
  out.count = String(Math.max(1, Math.min(8, Number(q.count) || 6)));
  if (q.time && /^\d{4}$/.test(q.time)) out.time = q.time;
  if (q.arriveBy) out.arriveBy = '1';
  if (q.date && /^\d{8}$/.test(q.date)) out.date = q.date;
  if (Array.isArray(q.modes) && q.modes.length) out.modes = q.modes.join(',');
  if (q.fare) out.fare = q.fare;
  out.tt = '1';
  return out;
}

/**
 * The server's first look as the trip screen shows it, or null: only an answer that says it is timetable times
 * (source "timetable") with at least one trip still to come. Every journey goes through timetableJourney again (R1:
 * no live badge, no delay, no countdown from a live time, whatever the server sent), services gone by the phone's
 * clock are left out (R3), one row per trip key (R4), and it is marked phone built and seeded, so the screen labels
 * it "Timetable times. Getting live times.", never keeps it (R5) and never arms Start trip from it (R6).
 */
export function ttFirstSeed(resp: any, now: number, anchor: number = now, arriveBy = false): TripResp | null {
  try {
    if (!resp || typeof resp !== 'object' || resp.error) return null;
    if (resp.source !== 'timetable' || !Array.isArray(resp.journeys)) return null;
    const rows: { j: Journey; dep: number }[] = [];
    const seen = new Set<string>();
    for (const raw of resp.journeys as Journey[]) {
      if (!raw || (raw as any).source !== 'timetable' || raw.live) continue;
      const j = timetableJourney(raw);
      if (!j) continue;
      const dep = plannedLeave(j);
      if (!Number.isFinite(dep) || dep <= now) continue;
      if (!arriveBy && dep < anchor - 60000) continue;
      const k = seedRowKey(j);
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({ j, dep });
    }
    rows.sort((a, b) => a.dep - b.dep);
    const list = (arriveBy ? rows.slice(-SEED_MAX) : rows.slice(0, SEED_MAX)).map((x) => x.j);
    if (!list.length) return null;
    const data: any = { kind: 'trip', from: resp.from, to: resp.to, journeys: list, now, source: 'timetable', seeded: true, phoneBuilt: true, ttFirst: true, modesBy: Array.isArray(resp.modes) && resp.modes.length ? 'server' : 'phone' };
    if (Array.isArray(resp.modes) && resp.modes.length) data.modes = resp.modes;
    if (resp.date) data.date = resp.date;
    return data as TripResp;
  } catch {
    return null;
  }
}

/** Whether a first look may still be painted: nothing live, kept or seeded is on screen for this search. */
export function ttFirstMayPaint(shown: { live: boolean; at: number | null } | null | undefined): boolean {
  return !!shown && !shown.live && shown.at == null;
}

/** True for a first look from the server (also isPhoneBuilt, so every R1 to R6 check that reads that holds). */
export const isTtFirst = (d: any) => !!(d && d.ttFirst === true && isPhoneBuilt(d));
