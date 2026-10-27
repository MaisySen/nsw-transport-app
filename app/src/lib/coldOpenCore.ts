/**
 * The cold open (27 Oct 2026, the 8:35 AM incident). Bidur opened the app on a slow Trip Planner morning: the commute
 * card's first trip request ran into the app's trip deadline, Home said "No live times" and "Live trips unavailable
 * right now", and a few seconds later it was live. A first request that fails once is not an outage: the server keeps
 * the planner call going and saves its live answer, so the same request a moment later is usually answered at once.
 *
 * So Home cards (useHomeLive) keep what they show, marked Updating, and ask again quickly after a timeout or a failure.
 * Only failures in a row say unavailable. A timetable stand in from a slow planner is asked again soon for the live
 * answer. Pure: no React Native imports, so the tests can run it.
 */

/** Waits before the quick asks again: after the first failure in a row, then after the second. */
export const QUICK_RETRY_MS = [1500, 4000] as const;
/** Failures in a row before a card says the live data is unavailable (a timeout, a 5xx or 429, a slow answer). */
export const FAILS_BEFORE_UNAVAILABLE = 3;
/** The phone has no connection at all: one quick ask again, then Offline (the phone's own state, said sooner). */
export const OFFLINE_FAILS_BEFORE_SAYING = 2;
/** A live answer on screen older than this is not kept as if live while asking again: the card says so at once. */
export const LIVE_GRACE_MS = 60000;

/**
 * The wait before asking again after a failed read, or null when the card should now show the failure. `fails` is the
 * failures in a row including this one, `offline` that the phone had no connection (not a slow or refused answer), and
 * `liveAgeMs` the age of the live answer on screen (null when none has come since the card opened).
 */
export function quickRetryMs(o: { fails: number; offline: boolean; liveAgeMs: number | null }): number | null {
  const fails = Math.max(1, Math.floor(o.fails || 1));
  if (o.liveAgeMs != null && o.liveAgeMs > LIVE_GRACE_MS) return null;
  const most = o.offline ? OFFLINE_FAILS_BEFORE_SAYING : FAILS_BEFORE_UNAVAILABLE;
  if (fails >= most) return null;
  return QUICK_RETRY_MS[Math.min(fails, QUICK_RETRY_MS.length) - 1];
}

/** Whether a failed read was the phone having no connection (not a slow answer or a server refusal). */
export function phoneOffline(e: any): boolean {
  return !!(e && e.offline && !e.slow && !e.server && !e.http);
}

/**
 * The server's answer while the Trip Planner is slow (fallback "planner-slow", 27 Oct): timetable trips now, while the
 * planner call carries on and its live answer is saved. Asked again after these waits (from the stand in's arrival),
 * then the normal gap.
 */
export const STAND_IN_REASK_MS = [6000, 10000] as const;
export function isSlowStandIn(d: any): boolean {
  return !!(d && typeof d === 'object' && d.source === 'timetable' && d.fallback === 'planner-slow');
}
/** The wait before asking again for live trips after a slow planner stand in, or null. `asked`: re-asks so far. */
export function standInReaskMs(d: any, asked: number): number | null {
  if (!isSlowStandIn(d) || asked >= STAND_IN_REASK_MS.length) return null;
  return STAND_IN_REASK_MS[Math.max(0, asked)];
}

/**
 * Home recovers by itself (27 Oct, 1:20 PM: the commute card stayed on "Live trips are unavailable" until a pull to
 * refresh). A card on any timetable stand in (not only a slow planner's) keeps asking for live times, and a card whose
 * quick asks again have run out keeps asking too: after these waits, then every RECOVER_MS's last value, never longer
 * than the card's normal gap. These asks are quiet (the card keeps its honest words, the header does not say Updating),
 * and do not count towards the poller's back off, so the wait never grows to minutes while Home is on view. The app
 * coming back to the front asks such a card again at once (hooks.ts).
 */
export const RECOVER_MS = [5000, 10000, 20000, 40000, 60000] as const;
export function recoverMs(step: number): number {
  const i = Math.max(0, Math.floor(Number.isFinite(step) ? step : 0));
  return RECOVER_MS[Math.min(i, RECOVER_MS.length - 1)];
}
/** Any timetable stand in from the server (its source), whatever the reason the planner gave none. */
export function isStandIn(d: any): boolean {
  return !!(d && typeof d === 'object' && d.source === 'timetable');
}
/**
 * The next ask after a stand in: `quick` (a slow planner's, said as Getting live times) for its first asks, then the
 * quiet recovery asks. Null for a live answer. `asked`: asks after stand ins in a row so far.
 */
export function standInAgainMs(d: any, asked: number): { ms: number; quick: boolean } | null {
  if (!isStandIn(d)) return null;
  const slow = standInReaskMs(d, asked);
  if (slow != null) return { ms: slow, quick: true };
  return { ms: recoverMs(isSlowStandIn(d) ? asked - STAND_IN_REASK_MS.length : asked), quick: false };
}
/** After the quick asks again have run out (the card shows the failure): the wait before the next quiet ask. */
export function failAgainMs(fails: number, offline: boolean): number {
  return recoverMs(fails - (offline ? OFFLINE_FAILS_BEFORE_SAYING : FAILS_BEFORE_UNAVAILABLE));
}
/** Whether a Home card is showing something other than live times (asked again at once on a return to the front). */
export function cardDegraded(o: { data: unknown; error: string | null; offlineAt: number | null; packAt?: number | null }): boolean {
  return !!o.error || !!o.offlineAt || !!o.packAt || isStandIn(o.data);
}

/** Under a Home trip card on timetable trips while live ones are still being asked for. */
export const STAND_IN_UPDATING_NOTE = 'Timetable times for now. Getting live times.';

/**
 * Before 27 Oct one timed out trip marked its pair as a long trip for the rest of the session (a 45 s wait and the
 * server's long path, which skips the saved live copy). The server now answers a plain trip inside the deadline, so
 * one timeout is a slow moment, not a long pair: only the second timeout of a pair in a session marks it.
 */
export const SLOW_TRIPS_BEFORE_LONG = 2;
export function slowMakesLong(slowSoFar: number, http504: boolean): boolean {
  return http504 || slowSoFar >= SLOW_TRIPS_BEFORE_LONG;
}

/**
 * What Home's header shows. `live`: time of the newest live answer on Home (0 for none), `off`: the oldest kept copy
 * shown because live data failed (0 for none), `stale`: the oldest kept copy shown while its first live answer loads
 * (0 for none), `pending`: cards whose first live answer of this opening is still on its way (a request out or a quick
 * ask again waiting). "No live times" never shows while a first request is still out.
 */
export type HeaderKind = 'updating' | 'offline' | 'live' | 'none';
export function homeHeader(o: { live: number; off: number; stale: number; pending: number }): HeaderKind {
  if (o.pending || (o.stale && !o.live)) return o.live ? 'live' : 'updating';
  if (o.off) return 'offline';
  if (o.live) return 'live';
  return 'none';
}

/** The header word while Home is getting its first live times. */
export const UPDATING_WORD = 'Updating';

/** The line under a card showing times kept on the phone while its live answer loads: "Updating, times from 8:05am". */
export function updatingText(stamp: string): string {
  return `Updating, times from ${stamp}`;
}

/**
 * The commute card's trip for this moment (Home to Work in the morning, Work to Home after, unless swapped), the same
 * one Home's commute card asks for, so its request can go out before Home has drawn. Null without both places.
 */
export function commutePlanOf<P extends { id: string }>(places: { home?: P | null; work?: P | null } | null | undefined, dir: 'toWork' | 'toHome'): { from: P; to: P } | null {
  const h = places?.home, w = places?.work;
  if (!h || !w || !h.id || !w.id || h.id === w.id) return null;
  return dir === 'toWork' ? { from: h, to: w } : { from: w, to: h };
}

/**
 * A board at another time on timetable rows (27 Oct speed pass 4): api.transportsydney.app answers with the timetable
 * for that moment when the Trip Planner has not answered within a moment (source "timetable", fallback "planner-slow")
 * and keeps the planner's board when it lands. The stop screen asks again after 6 s, then 10 s; after that, the normal
 * gap. Null for any other answer.
 */
export function boardAtAgainMs(d: unknown, asked: number): number | null {
  if (!isSlowStandIn(d) || asked < 0 || asked >= STAND_IN_REASK_MS.length) return null;
  return STAND_IN_REASK_MS[asked];
}
