// Whether an alert the server wrote for this phone may still be shown when the app finds it (push.ts pollNotes).
// 31 Oct, Bidur on build 210 (T1 to Ashfield, due 12:06): the server wrote "Leave now" at 11:57, "Arriving at Ashfield
// in 2 min" at 12:03 and "You've arrived" at 12:06, push never carried them (no push token for that service on his
// phone), and when he opened the app at 12:07 all three showed at once. An alert is news only at its moment: found
// later it is kept as seen, quietly. Pure, so the replay tests check it.

/** A server alert as /api/watches lists it. `at` is the server's clock when it was written. */
export type NoteLike = { id: number; watch_id?: string | null; at?: number | null; title: string; body?: string | null; pushed?: number | null };

/** The trip running on this phone, as far as the alert check needs it (live.ts LiveTrip). */
export type NoteTrip = { id: string; watchId: string | null; started: number; arrivedAt?: number | null };

export type NoteCtx = {
  /** The phone's clock. */
  now: number;
  /** The server's clock in the same answer (the notes' `at` is on it), when it sent one. */
  serverNow?: number | null;
  /** The trip running on this phone, if any. */
  trip?: NoteTrip | null;
  /** The Sydney clock words the server writes ("12:06pm", format.ts clock): reads "got in at 12:06pm" back to a time. */
  clock?: ((t: number) => string) | null;
  /** The running trip's own Get off now or heads up already on the phone: the server's Get off now push for its watch,
   * a location alert that rang, the quiet note (getOffCore serverRungKeys / ownRungKeys keys). */
  offShown?: Record<string, 1> | null;
};

/** Found this long after it was written, an alert is no longer news. The app asks at least once a minute while open,
 * so a live alert is never older than this when it is first seen. */
export const NOTE_LATE_MS = 90000;
/** "You've arrived" is news for 45 s, as for the app's own (liveCalc CUE_LATE_MS). */
export const NOTE_ARRIVED_LATE_MS = 45000;

export type NoteKind = 'leave' | 'stop' | 'arrived' | 'other';

/** What a server alert is about, from its title (worker.js watch alerts). */
export function noteKind(title: string): NoteKind {
  const t = String(title || '');
  if (/^Leave (now|in\b|by\b)/i.test(t)) return 'leave';
  if (/^(Next stop: |Arriving at |Change at )/.test(t)) return 'stop';
  if (/^You've arrived\b/.test(t)) return 'arrived';
  return 'other';
}

/** "is 3 min away" (Leave now) or "in 2 min" (Arriving at): minutes from when it was written, else null. */
export function noteMins(n: NoteLike): number | null {
  const m = /\bin (\d+) min\b/.exec(n.title || '') || /\bis (\d+) min away\b/.exec(n.body || '') || /\bit's (\d+) min away\b/.exec(n.body || '');
  return m ? Number(m[1]) : null;
}

/** When the moment an alert is about happens, on the server's clock: the departure for Leave now, the arrival for
 * Arriving in N min (half a minute of grace for the rounding), else when it was written. NaN without `at`. */
export function noteMoment(n: NoteLike): number {
  const at = Number(n.at);
  if (!Number.isFinite(at) || at <= 0) return NaN;
  const k = noteKind(n.title);
  const m = noteMins(n);
  // The minutes are rounded when written ("0 min away" can still be 30 s off): half a minute of grace.
  if ((k === 'leave' || k === 'stop') && m != null) return at + m * 60000 + 30000;
  return at;
}

/** The server's own clock words, "12:06pm" (Sydney, 12 hour, whatever the phone shows): worker.js clock. */
export function serverClock(t: number): string {
  try {
    return new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s/g, '').toLowerCase();
  } catch { return ''; }
}

/** When "You've arrived" says the trip got in ("got in at 12:06pm"), on the server's clock: the start of that minute,
 * found by writing the minutes before `at` with the same clock. NaN when it cannot be read. */
export function arrivedAt(n: NoteLike, clock: ((t: number) => string) | null = serverClock): number {
  const at = Number(n.at);
  const m = /\bgot in at (\d{1,2}:\d{2}\s?[ap]m)\b/i.exec(n.body || '');
  if (!m || !clock || !Number.isFinite(at) || at <= 0) return NaN;
  const want = m[1].replace(/\s/g, '').toLowerCase();
  const base = Math.floor(at / 60000) * 60000;
  for (let d = 0; d <= 90; d++) { const t = base - d * 60000; if (String(clock(t)).replace(/\s/g, '').toLowerCase() === want) return t; }
  return NaN;
}

export type NoteVerdict = { show: boolean; why: 'ok' | 'late' | 'passed' | 'onTrip' | 'tripOver' | 'offShown' };

/**
 * Whether the app shows a server alert it has just found. Never for a moment already passed:
 * - every alert: not when found more than 90 s after it was written ("You've arrived": 45 s after the arrival it names);
 * - Leave now (and any departure reminder): not once its departure has passed, and never while a trip is running on
 *   this phone (Start trip means you have left; 31 Oct, "Leave now, 0 min away" during the ride);
 * - Arriving in N min / Next stop: not once that arrival has passed, and not for the running trip once its Get off
 *   now or heads up is already on the phone (the server's push, or a location alert that rang): one moment, one alert;
 * - anything about the running trip after it arrived, apart from "You've arrived" itself.
 * An alert with no time (an older server) keeps the old behaviour.
 */
export function noteVerdict(n: NoteLike, ctx: NoteCtx): NoteVerdict {
  const k = noteKind(n.title);
  const clock = Number.isFinite(Number(ctx.serverNow)) && Number(ctx.serverNow) > 0 ? Number(ctx.serverNow) : ctx.now;
  const at = Number(n.at);
  const timed = Number.isFinite(at) && at > 0;
  const trip = ctx.trip || null;
  const ours = !!trip && !!trip.watchId && n.watch_id === trip.watchId;
  if (k === 'leave' && trip) return { show: false, why: 'onTrip' };
  if (timed) {
    const age = clock - at;
    if (age > (k === 'arrived' ? NOTE_ARRIVED_LATE_MS : NOTE_LATE_MS)) return { show: false, why: 'late' };
    // "You've arrived" counts from the arrival it names, not from when the server noticed it (up to a minute later).
    const got = k === 'arrived' ? arrivedAt(n, ctx.clock || serverClock) : NaN;
    if (Number.isFinite(got) && clock - got > NOTE_ARRIVED_LATE_MS) return { show: false, why: 'late' };
    const moment = noteMoment(n);
    if ((k === 'leave' || k === 'stop') && noteMins(n) != null && moment <= clock) return { show: false, why: 'passed' };
  }
  if (ours && k === 'stop' && ctx.offShown && Object.keys(ctx.offShown).some((key) => /^(gnow|rnow|rsoon|quiet|next)\d+$/.test(key))) return { show: false, why: 'offShown' };
  if (ours && k !== 'arrived' && trip!.arrivedAt) return { show: false, why: 'tripOver' };
  return { show: true, why: 'ok' };
}

/** The phone's own departure reminders that Start trip takes back (31 Oct: no "Leave now" once you have left). */
export type StartCancel = 'leave' | 'lastHome';
/**
 * Start trip means you have left: the Remind me leave alert (one departure, set from Home) always comes off; the Last way
 * home reminder comes off when this trip goes where it was taking you (same stop, or the same service). Weekly trip
 * reminders repeat, so they stay for the next day.
 */
export function startCancels(trip: { to?: { id?: string | null } | null; legs: { tripId?: string | null; toStopId?: string | null }[] },
  set: { leave?: boolean; lastHome?: { to?: { id?: string | null } | null; svc?: { tripId?: string | null } | null } | null }): StartCancel[] {
  const out: StartCancel[] = [];
  if (set.leave) out.push('leave');
  const lh = set.lastHome;
  if (lh) {
    const want = String(lh.to?.id || '');
    const stops = [trip.to?.id, ...trip.legs.map((l) => l.toStopId)].filter(Boolean).map(String);
    const same = !!want && stops.some((s) => s === want || s.startsWith(want) || want.startsWith(s));
    const svc = String(lh.svc?.tripId || '');
    if (same || (!!svc && trip.legs.some((l) => l.tripId === svc))) out.push('lastHome');
  }
  return out;
}
