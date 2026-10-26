// Refresh the trips the phone already holds, don't plan them again (speed pass part 2, 27 Oct; playbook pattern 3).
// When the server says it serves trip-live (servesCore.ts), a refresh of a plain trip from now sends the legs it holds
// to GET /api/trip/live?legs= and lays the feed's live times over them: no Trip Planner call, so a commute refresh
// answers in about 100 ms. The whole trip is planned again when the kept plan is old, a leg is cancelled or skipped,
// a change no longer connects, the first trip has gone, or the live answer does not match. A leg the feed has no news
// for shows its timetable time, never the old live one. No phone dependencies, so the unit tests can load it.
import type { Journey, Leg, TripResp } from './types';

/** A kept plan is re-timed for this long, then planned again (the list moves on, new trips appear). */
export const PLAN_MAX_MS = 10 * 60000;
/** Legs per /api/trip/live request (the server's limit), and requests per refresh. */
export const LIVE_LEGS_MAX = 12;
export const LIVE_REQ_MAX = 3;
/** A first trip that left more than this ago means the list needs planning again. */
export const GONE_MS = 60000;

export type LiveLeg = {
  tripId?: string; stopId?: string; toStopId?: string; realtime?: boolean; estimated?: string | null; arrEstimated?: string | null;
  delayMin?: number | null; cancelled?: boolean; skipped?: boolean; platform?: string | null; vehicle?: any; stopsAway?: number | null;
};
export type LiveResp = { kind?: string; now?: number; dataAt?: number; legs?: LiveLeg[] };
export type LegRef = { j: number; l: number };

const enc = (s: any) => encodeURIComponent(String(s ?? ''));
const isTransit = (l: Leg) => l && l.kind === 'transit';

/** One leg on the wire: tripId@fromStopId@toStopId@mode@line, each part encoded. */
export function wireLeg(l: Leg): string {
  return [l.tripId, l.stopId, l.toStopId, l.mode, l.line].map(enc).join('@');
}

/**
 * The legs of every journey in a kept answer, split into requests of at most LIVE_LEGS_MAX legs, or null when the
 * answer cannot be re-timed (a transit leg with no trip id or stop, an on demand leg, too many legs, no journeys).
 */
export function liveRequests(r: TripResp | null | undefined): { params: string[]; refs: LegRef[][] } | null {
  const js = r?.journeys || [];
  if (!js.length) return null;
  const all: { ref: LegRef; wire: string }[] = [];
  for (let j = 0; j < js.length; j++) {
    const legs = js[j]?.legs || [];
    if (!legs.some(isTransit)) return null;
    for (let l = 0; l < legs.length; l++) {
      const x = legs[l];
      if (!isTransit(x)) continue;
      if (!x.tripId || !x.stopId || !x.toStopId || x.onDemand) return null;
      all.push({ ref: { j, l }, wire: wireLeg(x) });
    }
  }
  if (!all.length || all.length > LIVE_LEGS_MAX * LIVE_REQ_MAX) return null;
  const params: string[] = [], refs: LegRef[][] = [];
  // A journey's legs stay in one request where they fit, so one answer re-times the whole journey.
  let cur: typeof all = [];
  const flush = () => { if (cur.length) { params.push(cur.map((x) => x.wire).join(',')); refs.push(cur.map((x) => x.ref)); cur = []; } };
  for (let j = 0; j < js.length; j++) {
    const mine = all.filter((x) => x.ref.j === j);
    if (cur.length + mine.length > LIVE_LEGS_MAX) flush();
    cur.push(...mine);
  }
  flush();
  return params.length <= LIVE_REQ_MAX ? { params, refs } : null;
}

const when = (planned?: string, est?: string | null, rt?: boolean) => Date.parse(String((rt && est) || planned || ''));
const iso = (t: number) => new Date(t).toISOString();

/**
 * Lays live answers over a kept plan. Returns the re-timed answer, or replan with a reason when the trip must be planned
 * again. answers[i] answers refs[i] in order. dataAt: when the live times were read.
 */
export function overlayLive(plan: TripResp, refs: LegRef[][], answers: (LiveResp | null | undefined)[], now: number, dataAt: number):
  { resp: TripResp; replan: false } | { replan: true; why: string } {
  const journeys: Journey[] = plan.journeys.map((j) => ({ ...j, legs: j.legs.map((l) => ({ ...l })) }));
  for (let i = 0; i < refs.length; i++) {
    const got = answers[i]?.legs;
    if (!Array.isArray(got) || got.length !== refs[i].length) return { replan: true, why: 'mismatch' };
    for (let k = 0; k < refs[i].length; k++) {
      const { j, l } = refs[i][k];
      const leg = journeys[j].legs[l], live = got[k] || {};
      if (live.tripId !== leg.tripId || (live.stopId != null && live.stopId !== leg.stopId)) return { replan: true, why: 'mismatch' };
      if (live.cancelled) return { replan: true, why: 'cancelled' };
      if (live.skipped) return { replan: true, why: 'skipped' };
      const okIso = (s: any) => typeof s === 'string' && Number.isFinite(Date.parse(s));
      if (live.realtime && okIso(live.estimated)) {
        leg.realtime = true;
        leg.estimated = live.estimated as string;
        // No live arrival: the planned one moved by the live delay at the boarding stop.
        const shift = Date.parse(leg.estimated) - Date.parse(String(leg.planned || ''));
        const ap = Date.parse(String(leg.arrPlanned || ''));
        if (okIso(live.arrEstimated)) leg.arrEstimated = live.arrEstimated as string;
        else if (Number.isFinite(shift) && Number.isFinite(ap)) leg.arrEstimated = iso(ap + shift);
        else delete leg.arrEstimated;
        leg.delayMin = typeof live.delayMin === 'number' && Number.isFinite(live.delayMin) ? live.delayMin : null;
        leg.vehicle = live.vehicle || undefined;
        leg.stopsAway = typeof live.stopsAway === 'number' ? live.stopsAway : null;
      } else {
        // No news from the feed for this leg: its timetable time, never the old live one.
        leg.realtime = false;
        delete leg.estimated;
        delete leg.arrEstimated;
        leg.delayMin = null;
        delete leg.vehicle;
        leg.stopsAway = null;
      }
      leg.cancelled = false;
      leg.seenAt = dataAt;
    }
  }
  for (const jr of journeys) {
    const tl = jr.legs.filter(isTransit);
    for (let i = 0; i + 1 < tl.length; i++) {
      const arr = when(tl[i].arrPlanned, tl[i].arrEstimated, tl[i].realtime);
      const dep = when(tl[i + 1].planned, tl[i + 1].estimated, tl[i + 1].realtime);
      if (Number.isFinite(arr) && Number.isFinite(dep) && dep < arr) return { replan: true, why: 'connection' };
    }
    const f = tl[0], z = tl[tl.length - 1];
    const oldBoard = Date.parse(String(jr.board || '')), oldLeave = Date.parse(String(jr.leave || '')), oldArrive = Date.parse(String(jr.arrive || ''));
    const oldLast = when(z.arrPlanned, undefined, false);
    const dep = when(f.planned, f.estimated, f.realtime);
    if (Number.isFinite(dep)) {
      if (Number.isFinite(oldBoard)) jr.board = iso(dep);
      if (Number.isFinite(oldLeave)) jr.leave = iso(dep - ((Number.isFinite(oldBoard) ? oldBoard : when(f.planned, undefined, false)) - oldLeave));
    }
    const arr = when(z.arrPlanned, z.arrEstimated, z.realtime);
    if (Number.isFinite(arr) && Number.isFinite(oldArrive) && Number.isFinite(oldLast)) jr.arrive = iso(arr + (oldArrive - oldLast));
    jr.live = tl.some((l) => !!l.realtime);
    jr.anyCancelled = false;
    jr.seenAt = dataAt;
  }
  const first = journeys[0]?.legs.find(isTransit);
  if (first && now - when(first.planned, first.estimated, first.realtime) > GONE_MS) return { replan: true, why: 'gone' };
  return { replan: false, resp: { ...plan, journeys, now: Number.isFinite(Number(answers[0]?.now)) ? Number(answers[0]?.now) : now, liveBy: 'trip-live' } as TripResp };
}

/** A full answer worth keeping as the plan to re-time: live planner trips, not a timetable stand in or an error. */
export function keepAsPlan(r: any): boolean {
  if (!r || typeof r !== 'object' || r.error || !Array.isArray(r.journeys) || !r.journeys.length) return false;
  if (r.source === 'timetable' || (typeof r.fallback === 'string' && r.fallback)) return false;
  if (Array.isArray(r.fallback) && r.fallback.some(Boolean)) return false;
  return !!liveRequests(r);
}

/** The plan is still worth re-timing (younger than PLAN_MAX_MS). */
export const planFresh = (at: number, now: number) => now - at >= 0 && now - at < PLAN_MAX_MS;
