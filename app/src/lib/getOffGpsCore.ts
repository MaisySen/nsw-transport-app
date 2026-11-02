// Get off now from the phone's own location (3 Nov 2026, prototype, OFF: GETOFF_GPS.on is false and nothing passes
// fixes in). Measured on the live trains feed, 3 Nov morning peak (files day-3nov keep-testing-3nov.md): at stations
// above ground, today's rule (the live arrival, or the train's position under 1 km, minus 38 s) was on time (15 to
// 75 s before the train reached the platform) for 59% of 965 arrivals and late for 21%; a simulated phone fix every
// 10 s with the rule below was on time for 75% to 85% and late for 1% to 3% (noise 10 to 50 m, trains held or not
// between position reports). Underground the phone has no fix, so the live rule stays as it is. Untested on a real
// trip: it needs logged fixes from a ride before it is turned on. No React here (test/getoffgps3nov.test.mjs).

export type PhoneFix = { lat: number; lon: number; acc?: number | null; at: number };
export type Pt = { lat: number; lon: number };

export const GETOFF_GPS = {
  /** Off: the prototype is on a branch, not turned on anywhere. */
  on: false,
  /** Get off now when the phone is this close to the stop off and moving towards it. */
  NEAR_M: 500,
  /** Moving towards the stop at least this fast (m/s), from the last two fixes (a train at the stop before is not). */
  MOVING_MPS: 3,
  /** A fix older than this says nothing about now. */
  FRESH_MS: 20000,
  /** A fix less precise than this is not used (wifi or cell guesses, a tunnel). */
  ACC_M: 100,
  /** Two fixes further apart than this give no speed. */
  PAIR_MS: 25000,
  /** The live rule is held (not rung early) while a fresh fix puts the phone further than this from the stop. */
  HOLD_FAR_M: 800,
  /** Fixes kept. */
  KEEP: 4,
};

const R = 6371000;
/** Metres between two points (haversine). */
export function distM(a: Pt, b: Pt): number {
  const p1 = (a.lat * Math.PI) / 180, p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1, dl = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const usable = (f: PhoneFix | null | undefined): f is PhoneFix =>
  !!f && Number.isFinite(f.lat) && Number.isFinite(f.lon) && Number.isFinite(f.at) && !(typeof f.acc === 'number' && f.acc > GETOFF_GPS.ACC_M);

/** The fixes kept: the newest last, only precise ones, never two with the same time, at most KEEP. */
export function keepFix(list: PhoneFix[] | null | undefined, f: PhoneFix | null | undefined): PhoneFix[] {
  const cur = (list || []).filter(usable);
  if (!usable(f)) return cur;
  if (cur.length && f.at <= cur[cur.length - 1].at) return cur;
  return [...cur, { lat: f.lat, lon: f.lon, acc: f.acc ?? null, at: f.at }].slice(-GETOFF_GPS.KEEP);
}

export type GpsRead = { fresh: boolean; d: number | null; v: number | null };
/** What the newest fix says at `now`: fresh or not, metres to the stop, speed towards it (m/s) from the fix before. */
export function gpsRead(fixes: PhoneFix[] | null | undefined, stop: Pt | null | undefined, now: number): GpsRead {
  const fx = (fixes || []).filter(usable);
  const last = fx[fx.length - 1];
  if (!stop || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lon) || !last || now - last.at > GETOFF_GPS.FRESH_MS || last.at > now + 5000) return { fresh: false, d: null, v: null };
  const d = distM(last, stop);
  const prev = fx[fx.length - 2];
  const v = prev && last.at - prev.at > 0 && last.at - prev.at <= GETOFF_GPS.PAIR_MS ? (distM(prev, stop) - d) / ((last.at - prev.at) / 1000) : null;
  return { fresh: true, d, v };
}

/** Get off now by the phone: a fresh fix under NEAR_M from the stop off, moving towards it at MOVING_MPS or more. */
export function gpsGetOffDue(fixes: PhoneFix[] | null | undefined, stop: Pt | null | undefined, now: number): boolean {
  const g = gpsRead(fixes, stop, now);
  return g.fresh && g.d != null && g.d <= GETOFF_GPS.NEAR_M && g.v != null && g.v >= GETOFF_GPS.MOVING_MPS;
}

/** The live rule waits: a fresh fix puts the phone further than HOLD_FAR_M from the stop (a creeping estimate, 2 Nov). */
export function gpsHoldsLive(fixes: PhoneFix[] | null | undefined, stop: Pt | null | undefined, now: number): boolean {
  const g = gpsRead(fixes, stop, now);
  return g.fresh && g.d != null && g.d > GETOFF_GPS.HOLD_FAR_M;
}

/** The trip state's view (tripState StepGps): due, hold and the distance, from the fixes for one stop at `now`. */
export function gpsStep(fixes: PhoneFix[] | null | undefined, stop: Pt, now: number): { due: boolean; hold: boolean; d: number | null } {
  return { due: gpsGetOffDue(fixes, stop, now), hold: gpsHoldsLive(fixes, stop, now), d: gpsRead(fixes, stop, now).d };
}
