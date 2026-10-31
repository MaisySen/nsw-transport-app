// One live trip state, shared by every surface (docs/TRIP_FLOW_SPEC.md section 2, docs/TRIP_STATE_API.md).
// The app (live trip screen, Lock Screen card, Island, widget, Watch, speech, alerts) and the server (a generated copy
// in backend/src/worker.js, tools/gen-livecard.mjs) both draw from it, so the phone and the server never disagree (I6).
// Pure: no runtime imports, no clock, no timers. Every time is an argument, in ms. The journey simulator
// (app/sim/journeySim.mjs) is the reference behaviour; app/sim/realEngine.mjs plays its cases on this file.
import type { Departure, ServiceResp, ServiceStop, WatchLeg } from './types';

// ---------- rule numbers (spec 2.2, 2.4, 2.5, 2.6, 2.7), in ms ----------
export const TRIP_RULES = {
  LIVE_FRESH: 120000, // under 2 min: live (evidence, countdown)
  LIVE_CAP: 300000, // R2: live readings over 5 min old are not used for times
  NO_DATA: 600000, // over 10 min: "No live data. Open the app to refresh."
  LEFT_BY: 60000, // the stop's own live time passed by 60 s = left
  GETOFF_LEAD: 30000, // Get off now at live arrival minus 30 s
  SERVER_DELIVERY: 2000, // the server sends 2 s early for delivery
  GETOFF_EXPIRE: 30000, // Get off now expires at live arrival + 30 s
  HEADSUP_WINDOW: 120000, // heads-up when the live arrival is 2 min away (or the stop before is left)
  ENDED_AFTER: 120000, // the card goes 2 min after Arrived
  NEAR: 300000, // the server reads every 15 s once the live arrival is under 5 min away
  PHONE_WRITE_MAX_AGE: 20000, // the phone writes the card (and sets its backup) only from readings under 20 s old
  VOICE_OPEN_FOR: 10000, // V1
  VOICE_FRESH: 60000, // V2
  VOICE_SILENT_REFRESHES: 2, // V4
  VOICE_QUEUE_MAX: 30000, // V5
  DELAY_ALERT: 3, // minutes: one alert when the delay first reaches 3 min, and per 3 min change
  CHANGE_MIN: 180000, // minimum time to change platforms at an interchange
  VEHICLE_MAX_AGE: 180000, // a vehicle position older than this is not used
  AT_STOP_M: 150, // a vehicle under 150 m from a stop is at it
};
const R = TRIP_RULES;

// Kylie clips in the app bundle (spec 2.6, 2.7 V8). arrival is new in build 212.
export const TRIP_CLIPS = {
  headsup: { file: 'getoff_soon', words: 'Your stop is coming up. Please get ready to get off at the next stop.', secs: 5.2 },
  getoff: { file: 'getoff_now', words: 'Please get off at the next stop.', secs: 2.8 },
  arrived: { file: 'arrival', words: "You've arrived at your stop.", secs: 2.0, build: 212 },
} as const;
export type ClipKey = keyof typeof TRIP_CLIPS;

// ---------- clock words (12 or 24 hour, Sydney time; the caller passes the phone's setting, c24) ----------
const fmts: Record<string, Intl.DateTimeFormat> = {};
const fmtOf = (c24: boolean) =>
  fmts[c24 ? 'h23' : 'h12'] ||
  (fmts[c24 ? 'h23' : 'h12'] = new Intl.DateTimeFormat('en-AU', c24
    ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Australia/Sydney' }
    : { hour: 'numeric', minute: '2-digit', hourCycle: 'h12', timeZone: 'Australia/Sydney' }));
/** "7:54pm", or "19:54" on a phone set to 24 hour time. */
export function tripClock(t: number, c24 = false): string {
  if (!Number.isFinite(t)) return '';
  const s = fmtOf(c24).format(t).replace(/\s/g, '').toLowerCase();
  return c24 ? s.replace(/^24:/, '00:') : s;
}
/** "7:54:30pm" style for logs: seconds only when not whole. */
export function tripClockSec(t: number): string {
  const s = Math.floor(t / 1000) % 60;
  const base = tripClock(t).replace(/[ap]m$/, '');
  return s ? `${base}:${String(s).padStart(2, '0')}` : base;
}
const mins = (ms: number) => Math.max(1, Math.ceil(ms / 60000));

// ---------- the plan and one live reading, in one shape ----------
/** A stop of a leg: boarding stop first, stop off last. tt: timetable time (ms). */
export type PlanStop = { name: string; tt: number; id?: string | null; alias?: string | null };
/** A leg as the trip state uses it. alt: a service the trip can switch to (next service after a cancellation or a missed change) for visible leg forLeg. */
export type PlanLeg = { id?: string | null; mode: string; line: string; platform: string | null; stand?: string | null; stops: PlanStop[]; off: number; alt?: boolean; forLeg?: number | null; li: number };
/** Visible legs first, then alternatives. */
export type TripPlan = { legs: PlanLeg[] };
export type VehiclePos = { stop: number; state: 'at' | 'left'; at: number };
/**
 * What one live answer says about one leg, per plan stop: est (the stop's own live time), run (the run's live delay at
 * that stop, carried from the nearest stop with news), board (the departure board's live time), vehicle, platform.
 * runAsOf: when run came from somewhere older than the answer (the planner's estimate captured at Start trip).
 */
export type LegReading = {
  est: (number | null)[]; run: (number | null)[]; runAsOf: number | null; board: number | null; vehicle: VehiclePos | null;
  platform: string | null; cancelled: boolean; next: string | null; unmatched: boolean;
};
/** asOf: when the live data was made (or loaded). */
export type TripReading = { asOf: number; legs: (LegReading | null)[] };
export type TimeSource = 'stop' | 'board' | 'run' | 'timetable';
/** A time with where it came from and how old it is (spec 2.1). */
export type TripTime = { at: number; planned: number; source: TimeSource; asOf: number | null };

const tms = (s?: string | null) => (s ? Date.parse(s) : NaN);
/** "Kings Cross Station, Kings Cross" and "Kings Cross Station" both become "Kings Cross". */
export const stopShort = (n?: string | null) => String(n || '').replace(/,.*$/, '').trim().replace(/ (Station|Light Rail|Wharf)$/i, '').trim();
const normName = (s?: string | null) => stopShort(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** "Platform 7" -> "7"; "Stand G" stays as it is for buses. */
export const platNum = (p?: string | null) => {
  const v = String(p || '').trim();
  return v ? v.replace(/^(platform|plat)\s*/i, '') : null;
};
const timedStop = (s?: ServiceStop | null) => !!s && !!(s.planned || s.estimated) && !s.skipped;
const idxOf = (v?: number | null) => (typeof v === 'number' ? v : -1);

function findStop(d: ServiceResp, id: string | null | undefined, name: string | null | undefined, from = 0, alias?: string | null): number {
  if (!d.stops) return -1;
  if (id) { const k = d.stops.findIndex((s, i) => i >= from && s.id === id); if (k >= 0) return k; }
  const n = normName(name), a = alias ? normName(alias) : '';
  if (!n && !a) return -1;
  return d.stops.findIndex((s, i) => i >= from && (normName(s.name) === n || (!!a && normName(s.name) === a)));
}
/** Where you board in a service answer: its own index, else by stop id or name (spec 2.1: matched by name as well). */
export function boardIndexOf(w: Pick<WatchLeg, 'stopId' | 'from'>, d: ServiceResp | null | undefined): number {
  if (!d || !d.stops || !d.stops.length) return -1;
  const mi = idxOf(d.mineIndex);
  if (mi >= 0 && mi < d.stops.length) return mi;
  return findStop(d, w.stopId, w.from);
}
export function offIndexOf(w: Pick<WatchLeg, 'toStopId' | 'to'>, d: ServiceResp | null | undefined, mi: number): number {
  if (!d || !d.stops || mi < 0) return -1;
  const ai = idxOf(d.alightIndex);
  if (ai > mi && ai < d.stops.length) return ai;
  return findStop(d, w.toStopId, w.to, mi + 1);
}

/** The plan leg for a trip leg: the service's own stops between where you board and get off when known, else the two ends. */
export function planLegFrom(w: WatchLeg, d?: ServiceResp | null, extra: { li?: number; id?: string | null; alt?: boolean; forLeg?: number | null } = {}): PlanLeg {
  const bus = w.mode === 'bus' || w.mode === 'school' || w.mode === 'coach';
  const base = { id: extra.id ?? w.tripId ?? null, mode: bus ? 'bus' : w.mode, line: w.line, platform: bus ? null : platNum(w.fromPlatform), stand: bus ? (w.fromPlatform || null) : null, alt: !!extra.alt, forLeg: extra.forLeg ?? null, li: extra.li ?? 0 };
  const mi = boardIndexOf(w, d);
  const ai = d ? offIndexOf(w, d, mi) : -1;
  if (d && mi >= 0 && ai > mi) {
    const stops: PlanStop[] = [];
    for (let k = mi; k <= ai; k++) {
      const s = d.stops[k];
      if (k !== mi && k !== ai && !timedStop(s)) continue;
      const tt = Number.isFinite(tms(s.planned)) ? tms(s.planned) : k === mi ? tms(w.planned) : k === ai ? tms(w.arrPlanned) : NaN;
      stops.push({ name: stopShort(s.name), tt, id: s.id || null });
    }
    return { ...base, stops, off: stops.length - 1 };
  }
  const dep = tms(w.planned);
  const arr = Number.isFinite(tms(w.arrPlanned)) ? tms(w.arrPlanned) : dep + 10 * 60000;
  return { ...base, stops: [{ name: stopShort(w.from), tt: dep, id: w.stopId || null }, { name: stopShort(w.to), tt: arr, id: w.toStopId || null }], off: 1 };
}

const hasXY = (s?: { lat?: number | null; lon?: number | null } | null): s is { lat: number; lon: number } => !!s && typeof s.lat === 'number' && typeof s.lon === 'number';
function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** The vehicle against the run's stops: at stop k (under 150 m), or heading to stop k. Null without a fresh position. */
export function vehicleOnRun(d: ServiceResp | null | undefined): { k: number; at: boolean } | null {
  const v = d?.vehicle as { lat?: number; lon?: number; ageS?: number | null } | undefined | null;
  if (!d || !d.stops) return null;
  const ageS = v && typeof v.ageS === 'number' ? v.ageS : 0;
  if (v && hasXY(v) && !(ageS * 1000 > R.VEHICLE_MAX_AGE)) {
    const st = d.stops;
    let best = Infinity, bi = -1, near = -1, nd = Infinity;
    for (let i = 0; i < st.length; i++) {
      const a = st[i];
      if (!hasXY(a)) continue;
      const da = metres(v, a);
      if (da < nd) { nd = da; near = i; }
      let j = i + 1;
      while (j < st.length && !hasXY(st[j])) j++;
      const b = st[j];
      if (!hasXY(b)) continue;
      const ex = da + metres(v, b) - metres(a, b);
      if (ex < best) { best = ex; bi = j; }
    }
    if (near >= 0 && nd < R.AT_STOP_M) return { k: near, at: true };
    if (bi >= 0 && best <= 1500) return { k: bi, at: false };
    return null;
  }
  if (d.progress === 'vehicle' && idxOf(d.nextIndex) >= 0) return { k: idxOf(d.nextIndex), at: false };
  return null;
}

/**
 * One live answer (the app's /api/service ServiceResp, plus optionally the departure board row and the planner's
 * estimate captured at Start trip) as a reading for one plan leg. All three feed shapes of spec section 0 land here:
 * (a) no live time anywhere in the answer but the planner's estimate is late: the planner's delay counts as a live
 * reading with its own age (plannerAt) for departure and arrival alike; (b) only later stops have live times: the run's
 * delay is carried back to the boarding stop; (c) the boarding stop is not matched by index: matched by id or name, and
 * when still not found the leg is timetable only (unmatched). A live time carried on by the server (stop.carried) is a
 * run time, not the stop's own.
 */
export function legReadingFrom(pl: PlanLeg, w: Pick<WatchLeg, 'stopId' | 'from' | 'toStopId' | 'to' | 'planned' | 'estimated' | 'tripId'> | null, d: ServiceResp | null | undefined,
  o: { asOf?: number; board?: Pick<Departure, 'planned' | 'estimated' | 'realtime' | 'tripId'> | null; plannerAt?: number | null; next?: string | null } = {}): LegReading | null {
  const n = pl.stops.length;
  const est: (number | null)[] = new Array(n).fill(null);
  const run: (number | null)[] = new Array(n).fill(null);
  let runAsOf: number | null = null;
  let board: number | null = null;
  if (o.board && o.board.realtime && o.board.estimated && (!o.board.tripId || !w?.tripId || o.board.tripId === w.tripId)) board = tms(o.board.estimated);
  const planner = w && w.estimated && w.planned && o.plannerAt != null ? tms(w.estimated) - tms(w.planned) : null;
  if (!d || !d.stops || !d.stops.length) {
    if (planner == null && board == null) return d ? { est, run, runAsOf, board, vehicle: null, platform: null, cancelled: !!d.cancelled, next: o.next ?? null, unmatched: true } : null;
    if (planner != null && Number.isFinite(planner)) { run.fill(planner); runAsOf = o.plannerAt ?? null; }
    return { est, run, runAsOf, board, vehicle: null, platform: null, cancelled: false, next: o.next ?? null, unmatched: false };
  }
  // map every plan stop to the answer's stop list
  const first = w ? boardIndexOf(w, d) : findStop(d, pl.stops[0].id, pl.stops[0].name, 0, pl.stops[0].alias);
  const map: number[] = [];
  let from = first < 0 ? 0 : first;
  for (let i = 0; i < n; i++) {
    const s = pl.stops[i];
    const k = i === 0 && first >= 0 ? first : findStop(d, s.id, s.name, from, s.alias);
    map.push(k);
    if (k >= 0) from = k;
  }
  if (first < 0 || map[0] < 0) {
    return { est, run, runAsOf, board, vehicle: null, platform: null, cancelled: !!d.cancelled, next: o.next ?? null, unmatched: true };
  }
  // the run's live delay at answer stop k: the latest stop at or before k with a live time, else the first after
  const delayAt = (s?: ServiceStop) => (s && s.estimated && s.planned && !s.skipped ? tms(s.estimated) - tms(s.planned) : null);
  const carried = (k: number): number | null => {
    for (let j = Math.min(k, d.stops.length - 1); j >= 0; j--) { const v = delayAt(d.stops[j]); if (v != null && Number.isFinite(v)) return v; }
    for (let j = Math.max(0, k + 1); j < d.stops.length; j++) { const v = delayAt(d.stops[j]); if (v != null && Number.isFinite(v)) return v; }
    return null;
  };
  let anyLive = false;
  for (let i = 0; i < n; i++) {
    const k = map[i];
    const s = k >= 0 ? d.stops[k] : null;
    if (s && s.estimated && !s.carried && !s.skipped) est[i] = tms(s.estimated);
    const c = k >= 0 ? carried(k) : carried(map[0]);
    if (c != null) { run[i] = c; anyLive = true; }
  }
  if (!anyLive && d.live && typeof d.delayMin === 'number') { run.fill(d.delayMin * 60000); anyLive = true; }
  if (!anyLive && planner != null && Number.isFinite(planner)) { run.fill(planner); runAsOf = o.plannerAt ?? null; }
  // the vehicle, as a plan stop index: at stop i, or left stop i (heading to the next)
  let vehicle: VehiclePos | null = null;
  const vr = vehicleOnRun(d);
  if (vr) {
    const ageS = typeof (d.vehicle as { ageS?: number } | undefined)?.ageS === 'number' ? (d.vehicle as { ageS: number }).ageS : 0;
    const vAt = o.asOf ?? 0;
    const exact = map.indexOf(vr.k);
    if (vr.at && exact >= 0) vehicle = { stop: exact, state: 'at', at: vAt - ageS * 1000 };
    else {
      // between plan stops: it has left the last plan stop before answer stop k (or before it when only heading there)
      let p = -1;
      for (let i = 0; i < n; i++) if (map[i] >= 0 && (vr.at ? map[i] <= vr.k : map[i] < vr.k)) p = i;
      vehicle = { stop: p, state: 'left', at: vAt - ageS * 1000 };
    }
  }
  const mineS = d.stops[map[0]];
  const platform = pl.mode === 'bus' ? null : platNum(mineS?.platform) || null;
  return { est, run, runAsOf, board, vehicle, platform, cancelled: !!d.cancelled, next: o.next ?? null, unmatched: false };
}

/**
 * The reading for the whole trip from the answers per leg (plan legs first, then alternatives). asOf: when the live
 * data was made or loaded; a vehicle position is that minus its own age.
 */
export function tripReadingFrom(plan: TripPlan, legs: (WatchLeg | null)[], svc: (ServiceResp | null | undefined)[], asOf: number,
  o: { boards?: (Departure | null | undefined)[]; plannerAt?: number | null; next?: (string | null | undefined)[] } = {}): TripReading {
  return {
    asOf,
    legs: plan.legs.map((pl, i) => {
      return legReadingFrom(pl, legs[i] || null, svc[i], { asOf, board: o.boards?.[i] || null, plannerAt: o.plannerAt ?? null, next: o.next?.[i] ?? null });
    }),
  };
}

// ---------- one trip state (spec 2.1, 2.2) ----------
export const TRIP_PHASES = ['waiting', 'due', 'left', 'onTheWay', 'nextStop', 'getOff', 'arrived', 'ended'] as const;
export type TripPhase = (typeof TRIP_PHASES)[number];
export const PHASE_INDEX: Record<TripPhase, number> = Object.fromEntries(TRIP_PHASES.map((p, i) => [p, i])) as Record<TripPhase, number>;
const PI = PHASE_INDEX;

/** What the trip remembers per leg: the phase the live train was last seen in, when each phase came and why, which calm steps rang. */
export type LegMemory = {
  phase: number; phaseAt: Partial<Record<TripPhase, number | null>>; phaseWhy: Partial<Record<TripPhase, string>>;
  arrivedAt: number | null; arrivedTime: number | null; rung: Record<string, number | string>;
  platformAlerted: string | null; delayAlerted: number | null; cancelAlerted: boolean; replaced: number | null; replacedWhy?: 'cancelled' | 'missed' | null; lastArrAt?: number | null;
};
export type TripMemory = { legs: LegMemory[]; current: number };
export function newTripMemory(plan: TripPlan): TripMemory {
  return {
    legs: plan.legs.map(() => ({ phase: 0, phaseAt: { waiting: null }, phaseWhy: {}, arrivedAt: null, arrivedTime: null, rung: {}, platformAlerted: null, delayAlerted: null, cancelAlerted: false, replaced: null })),
    current: 0,
  };
}
/** The visible leg count less one: the last leg of the trip (alternatives are not counted). */
export const lastLegOf = (plan: TripPlan) => plan.legs.filter((l) => !l.alt).length - 1;
/** The plan leg the trip is on for visible leg li: its replacement after a cancellation or a missed change. */
export const effLeg = (M: TripMemory, li: number) => (M.legs[li].replaced != null ? (M.legs[li].replaced as number) : li);

function stopTime(leg: PlanLeg, L: LegReading | null | undefined, i: number, t: number, asOf: number, isDep: boolean): TripTime {
  const planned = leg.stops[i].tt;
  if (L && !L.unmatched) {
    if (t - asOf < R.LIVE_CAP) {
      const e = L.est[i];
      if (e != null) return { at: e, planned, source: 'stop', asOf };
      if (isDep && i === 0 && L.board != null) return { at: L.board, planned, source: 'board', asOf };
    }
    const ra = L.runAsOf ?? asOf;
    const rd = L.run[i];
    if (rd != null && t - ra < R.LIVE_CAP) return { at: planned + rd, planned, source: 'run', asOf: ra };
  }
  return { at: planned, planned, source: 'timetable', asOf: null };
}
export const isLiveTime = (x: TripTime | null | undefined) => !!x && x.source !== 'timetable';
const delayMinOf = (x: TripTime) => Math.round((x.at - x.planned) / 60000);

export type Evidence = { age: number; fresh: boolean; leftBoard: string | null; leftBefore: string | null; arrived: string | null; passed: string | null; next: number };
/** Live evidence from one reading (spec 2.2). Never uses a timetable time. */
export function tripEvidence(plan: TripPlan, M: TripMemory, snap: TripReading, li: number, t: number): Evidence {
  const ei = effLeg(M, li);
  const leg = plan.legs[ei];
  const L = snap.legs[ei];
  const age = t - snap.asOf;
  const fresh = age < R.LIVE_FRESH && !!L && !L.unmatched;
  const v = fresh && L && L.vehicle && t - L.vehicle.at < R.LIVE_FRESH ? L.vehicle : null;
  const left = (i: number): string | null => {
    if (v && (v.stop > i || (v.stop === i && v.state === 'left'))) return 'vehicle';
    const e = L ? L.est[i] : null;
    if (fresh && e != null && t >= e + R.LEFT_BY) return 'stop live';
    return null;
  };
  const off = leg.off;
  const at = (i: number): string | null => {
    if (v && v.stop === i && v.state === 'at') return 'vehicle';
    if (v && (v.stop > i || (v.stop === i && v.state === 'left'))) return 'vehicle';
    const e = L ? L.est[i] : null;
    if (fresh && e != null && t >= e) return 'stop live';
    return null;
  };
  const passed = v && (v.stop > off || (v.stop === off && v.state === 'left')) ? 'vehicle' : null;
  let next = 1;
  while (next < off && left(next)) next++;
  return { age, fresh, leftBoard: left(0), leftBefore: off - 1 > 0 ? left(off - 1) : null, arrived: at(off), passed, next };
}

export type LegTimes = { dep: TripTime; arr: TripTime; before: TripTime | null; platform: string | null; platformChanged: boolean; age: number; asOf: number; timetableOnly: boolean };
/** Times for a leg from a reading: best evidence order stop live, board live, run live, timetable; the 5 min live cap (R2). */
export function tripLegTimes(plan: TripPlan, M: TripMemory, snap: TripReading, li: number, t: number): LegTimes {
  const leg = plan.legs[effLeg(M, li)];
  const L = snap.legs[effLeg(M, li)];
  const age = t - snap.asOf;
  const dep = stopTime(leg, L, 0, t, snap.asOf, true);
  const arr = stopTime(leg, L, leg.off, t, snap.asOf, false);
  const before = leg.off > 1 ? stopTime(leg, L, leg.off - 1, t, snap.asOf, false) : null;
  const platform = L && L.platform && age < R.LIVE_CAP ? L.platform : leg.platform;
  return { dep, arr, before, platform, platformChanged: !!(platform && leg.platform && platform !== leg.platform), age, asOf: snap.asOf, timetableOnly: !L || L.unmatched };
}

export type StaleStep = 'live' | 'about' | 'timetable' | 'no-data' | 'timetable-only';
/** Live data age to words (spec 2.4): live under 2 min, "about" to 5, timetable to 10, then "No live data". */
export function staleStepOf(age: number, timetableOnly: boolean): StaleStep {
  if (timetableOnly) return 'timetable-only';
  if (age < R.LIVE_FRESH) return 'live';
  if (age < R.LIVE_CAP) return 'about';
  if (age < R.NO_DATA) return 'timetable';
  return 'no-data';
}

// ---------- words for every surface (the render model, spec 2.1) ----------
export type TextSize = 'normal' | 'largest';
/** One-line budgets in characters per surface and text size (a stand-in for the native audit's real measure). */
export const LINE_BUDGET = {
  status: { normal: 38, largest: 26 }, warn: { normal: 30, largest: 24 }, arrive: { normal: 32, largest: 26 },
  islandTrailing: { normal: 7, largest: 7 }, islandMinimal: { normal: 5, largest: 5 }, widget: { normal: 44, largest: 34 }, watch: { normal: 24, largest: 18 },
};
function fitLine(variants: (string | null | undefined)[] | string | null | undefined, kind: keyof typeof LINE_BUDGET, size: TextSize) {
  const max = LINE_BUDGET[kind][size];
  const list = (Array.isArray(variants) ? variants : [variants]).filter((v): v is string => v != null && v !== '');
  if (!list.length) return { text: '', truncated: false };
  for (const v of list) if (v.length <= max) return { text: v, truncated: false };
  const last = list[list.length - 1];
  return { text: last.slice(0, max - 3) + '...', truncated: true };
}
function whereWords(leg: PlanLeg, platform: string | null, short: boolean) {
  if (leg.mode === 'bus') return leg.stand || 'Stand';
  if (!platform) return null;
  return short ? `Plat ${platform}` : `Platform ${platform}`;
}
/** "4 min late", "2 min early", "On time". */
export function delayWords(d: number) {
  if (d === 0) return 'On time';
  return d > 0 ? `${d} min late` : `${-d} min early`;
}

export type RenderOpts = { c24?: boolean; size?: TextSize; forecast?: boolean; forecastPhase?: number | null };
export type TripRender = {
  ended?: boolean; phase: TripPhase; step?: StaleStep; li?: number; leg?: string; title?: string;
  status?: string; warn?: string | null; arrive?: string | null; sub?: string | null; timer?: number | null; staleDate?: number | null;
  island?: { leading: string; trailing: string; minimal: string; timer: number | null }; widget?: string; watch?: string; inApp?: string; voiceOver?: string;
  truncated?: number; widgetTruncated?: boolean; delayShown?: number | null;
  depAt?: number; depPlanned?: number; depSource?: TimeSource; arrAt?: number; arrSource?: TimeSource; asOf?: number;
  platform?: string | null; platformWas?: string | null; nextStop?: string | null; offName?: string; boardName?: string;
};

/** Builds the render model every surface draws, from one trip state (plan, memory, the reading behind the surface, now). */
export function tripRender(plan: TripPlan, M: TripMemory, snap: TripReading, t: number, opts: RenderOpts = {}): TripRender {
  const c24 = !!opts.c24, size: TextSize = opts.size || 'normal';
  const C = (x: number) => tripClock(x, c24);
  const li = M.current;
  const m = M.legs[li];
  if (m.phase >= PI.ended && li === lastLegOf(plan)) return { ended: true, phase: 'ended' };
  const ei = effLeg(M, li);
  const leg = plan.legs[ei], base = plan.legs[li];
  const tm = tripLegTimes(plan, M, snap, li, t);
  const step = staleStepOf(tm.age, tm.timetableOnly);
  let phase: TripPhase = TRIP_PHASES[m.phase];
  // Waiting and Due are not stored: Due is "the live departure time has come and the train has not left", so a train
  // that is suddenly later goes back to counting down to its new time.
  if (m.phase <= PI.due) phase = tm.age < R.LIVE_FRESH && isLiveTime(tm.dep) && t >= tm.dep.at ? 'due' : 'waiting';
  if (opts.forecastPhase != null && opts.forecastPhase > m.phase) phase = TRIP_PHASES[opts.forecastPhase];
  const off = leg.stops[leg.off].name, board = leg.stops[0].name;
  const lineTitle = `${leg.line} ${board} to ${off}`;
  const p = tm.platform;
  const isChange = li > 0 && M.legs[li - 1].phase >= PI.arrived && m.phase < PI.left;
  const nextLeg = li < lastLegOf(plan) ? plan.legs[effLeg(M, li + 1)] : null;
  const asOfT = C(tm.asOf);
  const d = isLiveTime(tm.dep) ? delayMinOf(tm.dep) : null;
  const dArr = isLiveTime(tm.arr) ? delayMinOf(tm.arr) : null;
  const L = snap.legs[li];
  const cancelledNoAlt = !!(L && L.cancelled && m.replaced == null && step !== 'timetable' && step !== 'no-data');
  const replacedWhy = m.replaced != null ? (M.legs[li].replacedWhy || 'missed') : null;
  let status: string[] | string = '', warn: string | null = null, arrive: string | null = null, sub: string | null = null, timer: number | null = null;
  let trailing = '', minimal = '', inApp = '', voiceOver = '', nextStop: string | null = null;
  const prefix = isChange ? 'Change: ' : '';
  const W = (short: boolean) => whereWords(leg, p, short);
  const was = tm.platformChanged ? leg.platform : null;
  const arrLabel = (x: TripTime) => (x.source === 'timetable' ? `${C(x.at)} (timetable)` : C(x.at));
  if (cancelledNoAlt) {
    status = ['Cancelled', 'Cancelled'];
    warn = 'No next service found yet';
    trailing = 'Cancel'; minimal = 'X';
    inApp = `Your ${C(base.stops[0].tt)} ${base.line} is cancelled. Looking for the next one on this line.`;
  } else if (phase === 'waiting' || phase === 'due') {
    const depT = C(tm.dep.at);
    const wl = W(false), ws = W(true);
    const wasL = was ? `, was ${was}` : '', wasS = was ? ` (was ${was})` : '';
    const due = phase === 'due' || (step === 'about' && t >= tm.dep.at);
    if (step === 'live' && !due) {
      status = [`${prefix}Leaves ${depT} · ${wl}${wasL}`, `${prefix}Leaves ${depT} · ${ws}${wasL}`, `${depT} · ${ws}${wasS}`, `${depT} · ${ws}`];
      warn = d != null ? delayWords(d) : 'Timetable time';
      timer = tm.dep.at > t ? tm.dep.at : null;
      trailing = `${mins(tm.dep.at - t)} min`; minimal = `${mins(tm.dep.at - t)}m`;
      inApp = `${prefix}Leaves in ${mins(tm.dep.at - t)} min, ${depT} · ${ws}${wasS}${warn ? ' · ' + warn : ''}`;
      voiceOver = `${leg.line} to ${off}, leaves ${depT} in ${mins(tm.dep.at - t)} minutes, ${wl}${d ? `, ${Math.abs(d)} minutes ${d > 0 ? 'late' : 'early'}` : ''}`;
    } else if (step === 'live' || (due && step === 'about')) {
      const about = step === 'about';
      status = [`${prefix}Due ${about ? 'about ' + depT : 'now'} · ${wl}${wasL}`, `${prefix}Due ${about ? 'about ' + depT : 'now'} · ${ws}${wasS}`, `Due · ${ws}`];
      warn = d != null ? (about ? `${delayWords(d)} at ${asOfT}` : delayWords(d)) : null;
      if (about) sub = `Updated ${asOfT}`;
      trailing = 'Due'; minimal = 'Due';
      inApp = `${prefix}Due ${about ? 'about ' + depT : 'now'} · ${ws}${warn ? ' · ' + warn : ''}`;
      voiceOver = `${leg.line} to ${off}, due now, ${wl}`;
    } else if (step === 'about') {
      status = [`${prefix}Leaves about ${depT} · ${wl}${wasL}`, `${prefix}Leaves about ${depT} · ${ws}${wasS}`, `About ${depT} · ${ws}`];
      warn = d != null ? `${delayWords(d)} at ${asOfT}` : null;
      sub = `Updated ${asOfT}`;
      trailing = C(tm.dep.at).replace(/[ap]m$/, ''); minimal = trailing.length <= 5 ? trailing : 'Soon';
      inApp = `${prefix}Leaves about ${depT} · ${ws} · Updated ${asOfT}`;
    } else if (step === 'timetable' || step === 'timetable-only') {
      const tt = C(leg.stops[0].tt);
      status = [`${prefix}Timetable ${tt} · ${wl}`, `${prefix}Timetable ${tt} · ${ws}`, `TT ${tt} · ${ws}`];
      sub = step === 'timetable' ? `No live data since ${asOfT}` : 'No live data for this service';
      trailing = tt.replace(/[ap]m$/, ''); minimal = trailing.length <= 5 ? trailing : 'TT';
      inApp = `${prefix}Timetable ${tt} · ${ws} · ${sub}`;
    } else {
      status = ['No live data. Open the app to refresh.', 'No live data. Open the app.', 'No live data'];
      sub = `Timetable ${C(leg.stops[0].tt)}`;
      trailing = '--'; minimal = '--';
      inApp = `No live data. Open the app to refresh. Timetable ${C(leg.stops[0].tt)}`;
    }
    if (replacedWhy === 'cancelled') warn = `${C(base.stops[0].tt)} cancelled`;
    if (replacedWhy === 'missed') warn = `Next ${leg.line}, ${C(base.stops[0].tt)} missed`;
    if (replacedWhy === 'cancelled' && step === 'live') inApp = `Cancelled. Next ${leg.line} ${depT}, ${ws}`;
    arrive = step === 'live' ? `Arrive ${off} ${arrLabel(tm.arr)}` : step === 'about' ? `${off} about ${C(tm.arr.at)}` : `${off} ${C(leg.stops[leg.off].tt)} (timetable)`;
    nextStop = board;
  } else if (phase === 'left' || phase === 'onTheWay' || phase === 'nextStop' || phase === 'getOff') {
    const e = tripEvidence(plan, M, snap, li, t);
    let nextIdx = e.next;
    if (opts.forecast) {
      // the widget's timeline: the next stop by the live times it loaded (never the timetable)
      nextIdx = 1;
      while (nextIdx < leg.off) { const st = stopTime(leg, snap.legs[ei], nextIdx, t, snap.asOf, false); if (isLiveTime(st) && t >= st.at + R.LEFT_BY) nextIdx++; else break; }
      nextIdx = Math.max(nextIdx, e.next);
    }
    const nextName = leg.stops[Math.min(nextIdx, leg.off)].name;
    nextStop = nextName;
    const arrT = C(tm.arr.at);
    if (phase === 'getOff') {
      status = [`Get off now · ${off}`, `Get off · ${off}`, 'Get off now'];
      trailing = 'Off now'; minimal = 'Off';
      arrive = step === 'live' || step === 'about' ? `Arriving ${arrT}` : null;
      inApp = `Get off now · ${off}${nextLeg ? `, change for the ${nextLeg.line}` : ''}`;
      voiceOver = `Get off now, ${off}`;
    } else if (phase === 'nextStop') {
      status = [`${off} next`, `${off} next`];
      trailing = step === 'live' && tm.arr.at > t ? `${mins(tm.arr.at - t)} min` : 'Next';
      minimal = trailing === 'Next' ? 'Next' : `${mins(tm.arr.at - t)}m`;
      inApp = `${off} next · arriving ${step === 'live' ? '' : 'about '}${arrT}`;
      voiceOver = `${off} is next, arriving ${arrT}`;
    } else {
      status = [`Next: ${nextName}`, `Next: ${nextName}`, nextName];
      trailing = step === 'live' && tm.arr.at > t ? `${mins(tm.arr.at - t)} min` : C(tm.arr.at).replace(/[ap]m$/, '');
      minimal = step === 'live' && tm.arr.at > t ? `${mins(tm.arr.at - t)}m` : '--';
      inApp = `Next: ${nextName} · ${off} ${step === 'live' ? '' : 'about '}${arrT}`;
      voiceOver = `Next stop ${nextName}, arriving ${off} ${arrT}`;
    }
    if (phase !== 'getOff') {
      if (step === 'live') { arrive = `${off} ${arrLabel(tm.arr)}`; timer = tm.arr.at > t && isLiveTime(tm.arr) ? tm.arr.at : null; warn = dArr != null && dArr !== 0 ? delayWords(dArr) : dArr === 0 ? 'On time' : null; }
      else if (step === 'about') { arrive = `${off} about ${arrT}`; sub = `Updated ${asOfT}`; }
      else if (step === 'timetable') { arrive = `${off} ${C(leg.stops[leg.off].tt)} (timetable)`; sub = `No live data since ${asOfT}`; }
      else { arrive = `${off} ${C(leg.stops[leg.off].tt)} (timetable)`; sub = 'No live data. Open the app to refresh.'; }
    } else if (step !== 'live') sub = `Updated ${asOfT}`;
    if (nextLeg && phase !== 'getOff') {
      const ntm = tripLegTimes(plan, M, snap, li + 1, t);
      warn = `Then ${nextLeg.line} ${C(ntm.dep.at)}${nextLeg.platform ? ` · Plat ${ntm.platform}` : ''}`;
    }
  } else if (phase === 'arrived') {
    const at = C(m.arrivedTime ?? tm.arr.at);
    status = [`Arrived ${off} ${at}`, `Arrived ${off}`, 'Arrived'];
    trailing = 'Here'; minimal = 'Here';
    inApp = `You've arrived at ${off}. ${at}`;
    voiceOver = `Arrived at ${off}, ${at}`;
  }
  const S = fitLine(status, 'status', size);
  const Wn = fitLine(warn, 'warn', size);
  const A = fitLine(arrive, 'arrive', size);
  const T = fitLine(trailing || '', 'islandTrailing', size);
  const Mi = fitLine(minimal || '', 'islandMinimal', size);
  const forecastAbout = !!opts.forecast && t - tm.asOf >= R.LIVE_FRESH;
  const aboutTag = forecastAbout && !/about|Timetable|No live data/i.test(S.text) ? ' (about)' : '';
  const second = forecastAbout ? `Updated ${mins(t - tm.asOf)} min ago` : (Wn.text || A.text || sub || '');
  const WG = fitLine([`${leg.line} · ${S.text}${aboutTag}${second ? ' · ' + second : ''}`, `${S.text}${aboutTag}${second ? ' · ' + second : ''}`, `${S.text}${aboutTag}`], 'widget', size);
  const WA = fitLine([`${S.text}`], 'watch', size);
  const staleDate = tm.age < R.LIVE_FRESH ? Math.min(tm.asOf + R.LIVE_FRESH, ...(phase === 'waiting' && isLiveTime(tm.dep) ? [Math.max(tm.dep.at, tm.asOf + 1000)] : [])) : null;
  return {
    phase, step, li, leg: leg.line, title: lineTitle,
    status: S.text, warn: Wn.text || null, arrive: A.text || null, sub, timer, staleDate,
    island: { leading: leg.line, trailing: T.text || '', minimal: Mi.text, timer },
    widget: WG.text, watch: WA.text + (timer ? ` · ${mins(timer - t)} min` : ''),
    inApp, voiceOver: voiceOver || [S.text, Wn.text, A.text, sub].filter(Boolean).join(', '),
    truncated: [S, Wn, A, T, Mi].filter((x) => x.truncated).length, widgetTruncated: WG.truncated,
    delayShown: (step === 'live' || step === 'about') && d != null && (phase === 'waiting' || phase === 'due') ? d : null,
    depAt: tm.dep.at, depPlanned: tm.dep.planned, depSource: tm.dep.source, arrAt: tm.arr.at, arrSource: tm.arr.source, asOf: tm.asOf,
    platform: p, platformWas: was, nextStop, offName: off, boardName: board,
  };
}

/** The surface lines that must never appear in a started trip before evidence (I2, I10). */
export const BANNED_WORDS = ['0:00', 'Trip started', 'Checking for the next one', 'Next one', 'Wake up'];
/** What a surface shows, minus the ticking countdown (push and reload decisions: one push per change). */
export const renderSig = (r: TripRender) => (r.ended ? 'ended' : [r.phase, r.status, r.warn, r.arrive, r.sub, r.timer, (r.island?.minimal || '').replace(/^\d+m$/, 'Nm'), r.step].join('|'));

/**
 * The widget's own timeline entries (spec 2.5): phases at their live times from the reading it last loaded, never from a
 * timetable time, and never "Get off now" or "Arrived" (those show when they happen). reloadT: when it loaded.
 */
export function forecastPhaseOf(plan: TripPlan, Mw: TripMemory, snap: TripReading, t: number, reloadT = -Infinity): number {
  const li = Mw.current;
  const tm = tripLegTimes(plan, Mw, snap, li, t);
  let f = Mw.legs[li].phase;
  if (f >= PI.arrived) return t >= (Mw.legs[li].arrivedAt ?? Infinity) + R.ENDED_AFTER ? PI.ended : f;
  const up = (p: number) => { if (p > f) f = p; };
  const due = (x: TripTime | null, at: number) => isLiveTime(x) && at > reloadT && t >= at;
  if (isLiveTime(tm.dep) && t >= tm.dep.at) up(PI.due);
  if (due(tm.dep, tm.dep.at + R.LEFT_BY)) up(PI.onTheWay);
  if (f >= PI.onTheWay && tm.before && due(tm.before, tm.before.at + R.LEFT_BY)) up(PI.nextStop);
  if (f >= PI.onTheWay && due(tm.arr, tm.arr.at - R.HEADSUP_WINDOW)) up(PI.nextStop);
  return f;
}

// ---------- what moves the trip and what rings (spec 2.2, 2.3, 2.6) ----------
/** One moment to deliver to the person: an alert, maybe with a Kylie clip and in-app words (say). Times in ms. */
export type TripRing = {
  kind: 'cancelled' | 'missed' | 'delay' | 'platform' | 'passed' | 'atstop' | 'arrived' | 'getoff' | 'quiet' | 'headsup';
  title: string; body: string; level: 'normal' | 'time sensitive' | 'passive'; moment: string; clip?: ClipKey | null; say?: string; quiet?: boolean;
  expires?: number; target?: number; arrAt?: number; arrSource?: TimeSource; jumped?: boolean;
};
export type TripMoment = { ring: TripRing; age: number; byVehicle: boolean };
/**
 * c24: 24 hour words. lead: how early this side sends Get off now for delivery (0 in the app, 2 s on the server).
 * reread: read the live data once more at the Get off moment (so a jump in the last seconds moves it).
 */
export type StepEnv = { c24?: boolean; lead?: number; reread?: () => TripReading | null };
export type StepResult = { moments: TripMoment[]; log: { t: number; what: string }[] };

function setPhase(M: TripMemory, li: number, name: TripPhase, t: number, why: string, log: StepResult['log']) {
  const m = M.legs[li];
  if (PI[name] > m.phase) {
    for (let k = m.phase + 1; k <= PI[name]; k++) if (m.phaseAt[TRIP_PHASES[k]] == null) { m.phaseAt[TRIP_PHASES[k]] = t; m.phaseWhy[TRIP_PHASES[k]] = k === PI[name] ? why : `with ${name}`; }
    m.phase = PI[name];
    log.push({ t, what: `leg ${li + 1}: ${name} (${why})` });
  }
}

/**
 * One step of the trip at time t on reading S: moves the phase only on live evidence and returns the moments to ring,
 * each once per stop (one moment key per step). M is updated in place (and is the trip's saved memory).
 */
export function tripStep(plan: TripPlan, M: TripMemory, t: number, S: TripReading, env: StepEnv = {}): StepResult {
  const res: StepResult = { moments: [], log: [] };
  const deliver = (ring: TripRing, age: number, byVehicle: boolean) => res.moments.push({ ring, age, byVehicle });
  const li = M.current;
  const m = M.legs[li];
  if (m.phase >= PI.ended) return res;
  const leg0 = plan.legs[li];
  const isLast = li === lastLegOf(plan);
  const C = (x: number) => tripClock(x, !!env.c24);
  if (m.phase >= PI.arrived) {
    if (isLast && t >= (m.arrivedAt ?? Infinity) + R.ENDED_AFTER) setPhase(M, li, 'ended', t, '2 min after Arrived', res.log);
    return res;
  }
  const L = S.legs[li];
  const age = t - S.asOf;
  const fresh = age < R.LIVE_FRESH;
  // cancellation (live only)
  if (fresh && L && L.cancelled && !m.cancelAlerted && m.phase < PI.left) {
    m.cancelAlerted = true;
    const alt = L.next != null ? plan.legs.findIndex((x) => x.id === L.next && x.alt) : -1;
    let body = 'No next service found yet.', say = `Your ${C(leg0.stops[0].tt)} ${leg0.line} is cancelled.`;
    if (alt >= 0) {
      m.replaced = alt; m.replacedWhy = 'cancelled';
      const at = tripLegTimes(plan, M, S, li, t);
      body = `Next ${plan.legs[alt].line} ${C(at.dep.at)}, Platform ${at.platform}.`;
      say += ` The next ${plan.legs[alt].line} leaves at ${C(at.dep.at)}, from Platform ${at.platform}.`;
    }
    deliver({ kind: 'cancelled', title: `${C(leg0.stops[0].tt)} ${leg0.line} cancelled`, body, level: 'normal', say, moment: `cancel:${li}` }, age, false);
  }
  const e = tripEvidence(plan, M, S, li, t);
  const tm = tripLegTimes(plan, M, S, li, t);
  const leg = plan.legs[effLeg(M, li)];
  const offName = leg.stops[leg.off].name;
  const nextVis = isLast ? null : plan.legs[effLeg(M, li + 1)];
  // missed change: live times say the change will be missed -> count to the next found service
  if (!isLast && fresh && M.legs[li + 1].replaced == null) {
    const ntm = tripLegTimes(plan, M, S, li + 1, t);
    if (isLiveTime(tm.arr) && isLiveTime(ntm.dep) && tm.arr.at + R.CHANGE_MIN > ntm.dep.at) {
      const alt = plan.legs.findIndex((x) => !!x.alt && x.forLeg === li + 1);
      if (alt >= 0) {
        const missed = plan.legs[li + 1];
        M.legs[li + 1].replaced = alt; M.legs[li + 1].replacedWhy = 'missed';
        const a2 = tripLegTimes(plan, M, S, li + 1, t);
        const dl = isLiveTime(tm.dep) && m.phase < PI.left ? delayMinOf(tm.dep) : 0;
        const lateWords = Math.abs(dl) >= R.DELAY_ALERT ? `Your ${leg.line} is running ${dl} min late. ` : '';
        if (lateWords) m.delayAlerted = dl; // one alert carries both
        deliver({ kind: 'missed', title: `You'll miss the ${C(missed.stops[0].tt)} ${missed.line}`, body: `${lateWords}Next ${plan.legs[alt].line} ${C(a2.dep.at)}, Platform ${a2.platform}.`, level: 'normal', say: `You'll miss the ${C(missed.stops[0].tt)} ${missed.line}. The next one leaves at ${C(a2.dep.at)}, from Platform ${a2.platform}.`, moment: `missed:${li + 1}` }, age, false);
      }
    }
  }
  // before the train leaves: delay and platform alerts, one per change (spec 2.3)
  if (m.phase < PI.left && fresh && !(L && L.cancelled && m.replaced == null)) {
    if (isLiveTime(tm.dep)) {
      const d = delayMinOf(tm.dep);
      const prev = m.delayAlerted;
      if ((prev == null && Math.abs(d) >= R.DELAY_ALERT) || (prev != null && Math.abs(d - prev) >= R.DELAY_ALERT)) {
        m.delayAlerted = d;
        const words = d === 0 ? 'back on time' : d > 0 ? `running ${d} min late` : `running ${-d} min early`;
        deliver({ kind: 'delay', title: `${leg.line} ${words}`, body: `Now leaves ${C(tm.dep.at)}${leg.mode === 'bus' ? ` from ${leg.stand || 'the stand'}` : ` from Platform ${tm.platform}`}.`, level: 'normal', say: `Your ${leg.line} is ${words.replace('min', 'minutes')}. It now leaves at ${C(tm.dep.at)}${leg.mode === 'bus' ? '' : `, from Platform ${tm.platform}`}.`, moment: `delay:${li}:${d}` }, age, false);
      }
    }
    if (tm.platformChanged && m.platformAlerted !== tm.platform) {
      m.platformAlerted = tm.platform;
      deliver({ kind: 'platform', title: `Platform change: now Platform ${tm.platform}`, body: `${leg.line} ${C(tm.dep.at)} now leaves from Platform ${tm.platform} (was ${leg.platform}).`, level: 'normal', say: `Platform change. Your ${leg.line} now leaves from Platform ${tm.platform}.`, moment: `platform:${li}:${tm.platform}` }, age, false);
    }
  }
  // phases from the live train (spec 2.2)
  if (m.phase < PI.due && e.fresh && isLiveTime(tm.dep) && t >= tm.dep.at) setPhase(M, li, 'due', t, `live departure ${tripClockSec(tm.dep.at)} (${tm.dep.source}) came, reading ${Math.round(age / 1000)}s old`, res.log);
  if (m.phase < PI.onTheWay && e.leftBoard) setPhase(M, li, 'onTheWay', t, `left ${leg.stops[0].name}: ${e.leftBoard}`, res.log);
  if (m.phase < PI.onTheWay) return res;
  const rung = (k: string) => m.rung[k];
  const changeWords = nextVis ? { head: `${offName} is next. Change there for the ${nextVis.line}.`, off: `Get off now. ${offName}, change for the ${nextVis.line}.` } : null;
  const vehicleWord = leg.mode === 'bus' ? 'bus' : 'train';
  // 1) already past the stop before anything rang: quiet note, trip ends
  if (e.passed && !rung('getoff') && !rung('arrived')) {
    m.rung.passed = t; m.rung.headsup = m.rung.headsup || 'skipped'; m.rung.getoff = 'skipped'; m.rung.arrived = 'skipped';
    deliver({ kind: 'passed', quiet: true, title: `Your ${vehicleWord} passed ${offName}`, body: `Your ${vehicleWord} passed ${offName} at ${C(tm.arr.at)}.`, level: 'passive', moment: `passed:${li}` }, age, false);
    m.arrivedAt = t; m.arrivedTime = tm.arr.at;
    setPhase(M, li, 'arrived', t, `passed ${offName}: ${e.passed}`, res.log);
    if (isLast) setPhase(M, li, 'ended', t, 'passed the stop: trip ends', res.log);
    return res;
  }
  // 2) at the stop
  if (e.arrived) {
    const arrivedTime = e.arrived === 'vehicle' ? Math.min(t, isLiveTime(tm.arr) ? Math.max(tm.arr.at, t - R.LIVE_FRESH) : t) : tm.arr.at;
    m.arrivedAt = t; m.arrivedTime = arrivedTime;
    if (!rung('getoff')) {
      m.rung.getoff = t; m.rung.arrived = 'with getoff'; if (!rung('headsup')) m.rung.headsup = 'skipped';
      deliver({ kind: 'atstop', title: `${offName} now`, body: `${offName} now. Get off here.`, level: 'time sensitive', clip: 'getoff', say: `${offName} now. Get off here.`, moment: `getoff:${li}`, expires: t + R.GETOFF_EXPIRE }, age, e.arrived === 'vehicle');
    } else {
      m.rung.arrived = t;
      const say = nextVis ? `You're at ${offName}. Change to the ${nextVis.line}.` : `You've arrived at ${offName}.`;
      const nt = nextVis ? tripLegTimes(plan, M, S, li + 1, t) : null;
      deliver({ kind: 'arrived', title: nextVis ? `At ${offName}: change here` : `Arrived at ${offName}`, body: nextVis && nt ? `Change to the ${nextVis.line}, Platform ${nt.platform}, leaves ${C(nt.dep.at)}.` : `You've arrived at ${offName}. ${C(arrivedTime)}.`, level: 'normal', clip: nextVis ? null : 'arrived', say, moment: `arrived:${li}`, expires: t + R.ENDED_AFTER }, age, e.arrived === 'vehicle');
    }
    setPhase(M, li, 'arrived', t, `at ${offName}: ${e.arrived}`, res.log);
    if (!isLast) { M.current = li + 1; res.log.push({ t, what: `now on leg ${li + 2}` }); }
    return res;
  }
  // 3) Get off now at the live arrival minus 30 s
  const lead = env.lead ?? 0;
  const prevArr = m.lastArrAt ?? null; m.lastArrAt = isLiveTime(tm.arr) ? tm.arr.at : prevArr;
  if (!rung('getoff') && !rung('getoffQuiet') && isLiveTime(tm.arr) && t >= tm.arr.at - R.GETOFF_LEAD - lead) {
    // read once more at the fire moment, so a jump in the last seconds moves the timer
    const S2 = (env.reread && env.reread()) || S;
    const tm2 = tripLegTimes(plan, M, S2, li, t);
    const age2 = t - S2.asOf;
    const e2 = tripEvidence(plan, M, S2, li, t);
    if (e2.arrived || e2.passed) return res; // at the stop / passed: the next step says so
    if (isLiveTime(tm2.arr) && t >= tm2.arr.at - R.GETOFF_LEAD - lead) {
      if (age2 < R.LIVE_FRESH) {
        m.rung.getoff = t; if (!rung('headsup')) m.rung.headsup = 'skipped';
        deliver({ kind: 'getoff', title: 'Get off now', body: changeWords ? changeWords.off : `Get off now. ${offName}, arriving ${C(tm2.arr.at)}.`, level: 'time sensitive', clip: 'getoff', say: changeWords ? changeWords.off : `Get off now for ${offName}.`, moment: `getoff:${li}`, expires: tm2.arr.at + R.GETOFF_EXPIRE, target: tm2.arr.at - R.GETOFF_LEAD, arrAt: tm2.arr.at, arrSource: tm2.arr.source, jumped: prevArr != null && prevArr - R.GETOFF_LEAD - lead > t - 1000 && tm2.arr.at < prevArr }, age2, false);
        setPhase(M, li, 'getOff', t, `live arrival ${tripClockSec(tm2.arr.at)} minus 30 s, reading ${Math.round(age2 / 1000)}s old`, res.log);
      } else if (age2 < R.LIVE_CAP) {
        m.rung.getoffQuiet = t;
        deliver({ kind: 'quiet', quiet: true, title: `${offName} about ${C(tm2.arr.at)}`, body: `${offName} about ${C(tm2.arr.at)}. No live update since ${C(S2.asOf)}.`, level: 'passive', moment: `quiet:${li}` }, age2, false);
      }
      return res;
    }
  }
  // 4) heads-up: the stop before is left, or the live arrival is 2 min away (never before leaving)
  const headsUpNow = e.leftBefore || (e.fresh && isLiveTime(tm.arr) && tm.arr.at - t <= R.HEADSUP_WINDOW);
  if (!rung('headsup') && headsUpNow) {
    m.rung.headsup = t;
    deliver({ kind: 'headsup', title: `${offName} is next`, body: changeWords ? changeWords.head : `${offName} is next. Arriving about ${C(tm.arr.at)}. Get ready to get off.`, level: 'normal', clip: 'headsup', say: changeWords ? changeWords.head : `${offName} is next. Get ready to get off.`, moment: `headsup:${li}`, expires: tm.arr.at, arrSource: tm.arr.source }, age, false);
    setPhase(M, li, 'nextStop', t, e.leftBefore ? `left ${leg.stops[leg.off - 1]?.name || leg.stops[0].name}: ${e.leftBefore}` : `live arrival ${tripClockSec(tm.arr.at)} is 2 min away`, res.log);
  }
  return res;
}

// ---------- who rings, and what is heard (spec 2.6 who rings, 2.7 voice) ----------
/** The phone's state for voice: app in front, Silent switch, when it came to the front, refreshes since then, the speech queue. */
export type VoiceState = { open: boolean; silent: boolean; openSince: number | null; refreshes: number; speakingUntil: number };
export type VoiceDecision = { words: string | null; why: string | null; start: number; until: number };
/**
 * In-app speech for one moment (V1 to V5): spoken only when the app has been in front at least 10 s, after the first
 * two refreshes, from a live reading under 60 s old (or a vehicle position), not on Silent (ambient session), and not
 * after waiting over 30 s behind another cue (one queue, nothing cut off).
 */
export function voiceGate(v: VoiceState, t: number, say: string | null | undefined, readingAge: number, byVehicle: boolean): VoiceDecision {
  const no = (why: string): VoiceDecision => ({ words: null, why, start: t, until: v.speakingUntil });
  if (!say) return no('no spoken cue for this alert');
  if (!v.open) return no('app not in front (V1)');
  if (v.silent) return no('Silent switch on (ambient session)');
  if (v.openSince == null || t - v.openSince < R.VOICE_OPEN_FOR) return no('app open under 10 s (V1)');
  if (v.refreshes <= R.VOICE_SILENT_REFRESHES) return no('first two refreshes after opening (V4)');
  if (!byVehicle && readingAge >= R.VOICE_FRESH) return no('live reading over 60 s old (V2)');
  const start = Math.max(t, v.speakingUntil);
  if (start - t > R.VOICE_QUEUE_MAX) return no('waited over 30 s in the speech queue (V5)');
  return { words: say, why: null, start, until: start + Math.ceil(say.length / 14) * 1000 };
}

export type RouteState = { open: boolean; serverReachable: boolean; direct: boolean; silent: boolean };
export type RingRoute = { via: string; sound: string | null; haptic: 'one light tap' | 'one buzz' | 'none'; lands: number | null; serverCopy: string | null };
/**
 * Who rings a moment: the open app (banner, in-app voice, one light tap for the calm steps; the server's copy shown
 * without sound), else the server (a direct alert, or the Live Activity push carrying it when direct alerts do not
 * work), else nobody. Quiet notes never make a sound.
 */
export function ringRoute(s: RouteState, ring: TripRing, t: number): RingRoute {
  const calm = ring.kind === 'headsup' || ring.kind === 'getoff' || ring.kind === 'atstop';
  if (ring.quiet) {
    return { via: s.open ? 'in-app note' : s.serverReachable ? 'server alert (passive, no sound)' : 'none (no route to the phone)', sound: null, haptic: 'none',
      lands: !s.open && s.serverReachable && ring.kind === 'quiet' ? t + R.SERVER_DELIVERY : null, serverCopy: null };
  }
  if (s.open) return { via: 'in-app banner', sound: null, haptic: calm ? 'one light tap' : 'none', lands: null, serverCopy: s.serverReachable ? 'server alert shown in the app without sound' : null };
  if (s.serverReachable) {
    let sound = ring.clip ? `Kylie ${TRIP_CLIPS[ring.clip].file} clip` : 'default sound';
    if (s.silent) sound = `${sound} muted by the Silent switch`;
    return { via: s.direct ? 'server alert' : 'Live Activity push carrying the alert', sound, haptic: 'one buzz', lands: t + (ring.kind === 'getoff' ? R.SERVER_DELIVERY : 0), serverCopy: null };
  }
  return { via: 'none (no route to the phone)', sound: null, haptic: 'none', lands: null, serverCopy: null };
}

/**
 * The phone's own backup Get off now (G39, spec 2.6): only when the server has not taken it, set from a reading under
 * 20 s old when the app goes to the background, only when the live arrival is under 5 min away, at the live arrival
 * minus 30 s. Null otherwise.
 */
export function backupGetOff(plan: TripPlan, M: TripMemory, snap: TripReading | null, t: number, serverTakes: boolean): { at: number; arrAt: number; li: number } | null {
  if (serverTakes || !snap || t - snap.asOf >= R.PHONE_WRITE_MAX_AGE) return null;
  const li = M.current;
  if (M.legs[li].rung.getoff || M.legs[li].phase >= PI.arrived) return null;
  const tm = tripLegTimes(plan, M, snap, li, t);
  if (!isLiveTime(tm.arr) || tm.arr.at - t >= R.NEAR) return null;
  return { at: tm.arr.at - R.GETOFF_LEAD, arrAt: tm.arr.at, li };
}

/** The plan for a trip: one plan leg per trip leg (from the service answers when loaded), then any alternatives. */
export function tripPlanFrom(legs: WatchLeg[], svc: (ServiceResp | null | undefined)[] = [], alts: { leg: WatchLeg; svc?: ServiceResp | null; id: string; forLeg: number }[] = []): TripPlan {
  const out: PlanLeg[] = legs.map((w, i) => planLegFrom(w, svc[i] || null, { li: i }));
  alts.forEach((a, k) => out.push(planLegFrom(a.leg, a.svc || null, { li: legs.length + k, id: a.id, alt: true, forLeg: a.forLeg })));
  return { legs: out };
}

/** The server reads a live trip every 30 s, and every 15 s once the live arrival is under 5 min away (spec 2.6). */
export function serverPollMs(plan: TripPlan, M: TripMemory, snap: TripReading | null, t: number): number {
  if (!snap) return 30000;
  const tm = tripLegTimes(plan, M, snap, M.current, t);
  return isLiveTime(tm.arr) && tm.arr.at - t < R.NEAR && M.legs[M.current].phase >= PI.onTheWay ? 15000 : 30000;
}
