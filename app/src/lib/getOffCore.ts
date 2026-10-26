// Get off alert the rider controls: how many stops before your stop the heads up comes (1, 2 or 3; 1 is the
// "Next stop" alert the app has always sent), and an optional "Get off now" as the service reaches your stop. Both
// come from the live stop times the trip already reads (no location, no extra request), are set on the phone as
// local alerts so they ring with the app closed, and move when the live times move. No React here
// (test/getoff.test.mjs).
import type { WatchLeg, ServiceResp } from './types';
import type { LiveState } from './liveCalc';

export type GetOffPref = { stops: 1 | 2 | 3; now: boolean };
export const GETOFF_DEFAULT: GetOffPref = { stops: 1, now: false };
export const GETOFF_STOPS = [1, 2, 3] as const;
/** "Get off now" comes this long before the live arrival at your stop. */
export const GETOFF_NOW_LEAD_MS = 60000;
/** A set alert is moved only when its time moves by this much. */
const MOVE_MS = 15000;
/** While the live times say the service is not there yet but its time has passed, the alert waits this long more. */
const HOLD_MS = 30000;
/** A rung alert found on the next refresh is still read out when it rang at most this long ago. */
const SAY_LATE_MS = 45000;

/** The stored value, made safe: anything unknown is the default (1 stop, no Get off now). */
export function readGetOff(raw: unknown): GetOffPref {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { stops?: unknown; now?: unknown };
  const n = Number(r.stops);
  const stops = (n === 2 || n === 3 ? n : 1) as 1 | 2 | 3;
  return { stops, now: r.now === true };
}

/** "1 stop before", "2 stops before". */
export const stopsWords = (n: number) => `${n} stop${n === 1 ? '' : 's'} before`;

/** The row's value: "1 stop before", "2 stops before, Get off now". */
export function getOffValueText(p: GetOffPref): string {
  return `${stopsWords(p.stops)}${p.now ? ', Get off now' : ''}`;
}

/** The row's second line, for the stop you get off at next. */
export function getOffSubText(p: GetOffPref, stop: string): string {
  const to = stop || 'your stop';
  const first = p.stops === 1 ? `An alert as you leave the stop before ${to}` : `An alert ${p.stops} stops before ${to}, then again at the stop before`;
  return `${first}${p.now ? ', and Get off now as you reach it.' : '.'}`;
}

type Fmt = { clock: (t: number) => string; short: (n?: string | null) => string };
const tms = (s?: string | null) => (s ? new Date(s).getTime() : NaN);
const tOfStop = (s?: { planned?: string; estimated?: string } | null) => (s ? tms(s.estimated || s.planned) : NaN);
const timed = (s?: { planned?: string; estimated?: string; skipped?: boolean } | null) => !!s && !!(s.planned || s.estimated) && !s.skipped;
const ix = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : -1);

/**
 * When the service leaves the stop `n` stops before the one you get off at on leg k (skipped stops not counted),
 * from the live stop list. NaN when the ride is not that long (the stop would be where you get on, or before it) or
 * there is no stop list.
 */
export function earlyTime(s: LiveState, k: number, n: number): number {
  const d: ServiceResp | null = s.L2[k]?.d || null;
  const mi = ix(d?.mineIndex), ai = ix(d?.alightIndex);
  if (!d || mi < 0 || ai <= mi) return NaN;
  let p = ai, count = 0;
  while (p > mi && count < n) { p--; if (p > mi && timed(d.stops[p])) count++; }
  if (count < n || p <= mi) return NaN;
  return tOfStop(d.stops[p]);
}

/** When to say "Get off now" on leg k: a minute before the live arrival at your stop, never before the service leaves the stop before it. */
export function nowTime(s: LiveState, k: number): number {
  const x = s.L2[k];
  if (!x || !Number.isFinite(x.arr)) return NaN;
  const d = x.d, mi = ix(d?.mineIndex), ai = ix(d?.alightIndex);
  let before = x.dep;
  if (d && mi >= 0 && ai > mi) {
    let p = ai - 1;
    while (p > mi && !timed(d.stops[p])) p--;
    const t = tOfStop(d.stops[p]);
    if (Number.isFinite(t)) before = t;
  }
  const t = x.arr - GETOFF_NOW_LEAD_MS;
  return Number.isFinite(before) ? Math.max(before, t) : t;
}

/** The leg's times are live (never a timetable guess): the run's own live feed, and on the leg you are on, live tracking. */
function legLive(s: LiveState, k: number) {
  const x = s.L2[k];
  if (s.done || !x || !x.d || !x.d.live || x.missed) return false;
  if (k === s.cur) return s.track !== 'timetable';
  return true;
}

export const getOffId = (gid: string, key: string) => `getoff-${gid}-${key}`;

export function getOffWords(legs: WatchLeg[], s: LiveState, k: number, kind: 'early' | 'now', n: number, f: Fmt) {
  const l = legs[k];
  const last = legs.length - 1;
  const stop = f.short(l?.to);
  const arr = s.L2[k]?.arr;
  const at = Number.isFinite(arr) ? f.clock(arr) : '';
  const change = k < last ? legs[k + 1] : null;
  if (kind === 'early') {
    return {
      title: `${n} stops to ${stop}`,
      body: change ? `Get ready to change to the ${change.line}${at ? `. You get to ${stop} at ${at}` : ''}.` : `Get ready to get off${at ? `. You arrive at ${at}` : ''}.`,
      say: `${n} stops to ${sayStop(l?.to)}.`,
    };
  }
  return {
    title: `Get off now: ${stop}`,
    body: change ? `Change here to the ${change.line}.` : `This is your stop${at ? `, due ${at}` : ''}.`,
    say: change ? `Get off now. ${sayStop(l?.to)}. Change here.` : `Get off now. ${sayStop(l?.to)}.`,
  };
}

/** A stop as it is heard: the part before the comma, without "Station". */
const sayStop = (n?: string | null) => String(n || '').split(',')[0].replace(/ Station$/, '').trim();

export type GetOffTrip = { id: string; legs: WatchLeg[]; alerted: Record<string, 1>; offSet?: Record<string, number>; speak?: boolean; spoken?: Record<string, 1> };
export type GetOffAction =
  | { t: 'offSchedule'; id: string; key: string; at: number; title: string; body: string }
  | { t: 'offDue'; id: string; key: string; title: string; body: string }
  | { t: 'offCancel'; id: string; key: string }
  | { t: 'say'; key: string; text: string };

/**
 * One refresh of the get off alerts, beside the trip's own alerts. With the default (1 stop, no Get off now) it does
 * nothing, so the alerts are exactly as before. Otherwise, for each leg still ahead:
 * - "N stops to Central" (2 or 3 stops before) and "Get off now" are each set once as a local alert for the time
 *   the live stop times give, and moved when those times move;
 * - on the leg you are on, with live tracking, the service's real position decides: the heads up comes once the
 *   service has left the stop N before yours, and Get off now once your stop is next and it is due within a minute;
 *   until then an alert whose time has passed waits 30 seconds more instead of ringing early;
 * - an alert whose set time has passed has rung (the phone rang it), so nothing rings twice;
 * - without live times nothing is set (and what was set is taken back), the same rule as the Next stop alert;
 * - a leg you are past, a trip that ended, or a choice turned off takes back what is still to ring.
 * Speak alerts (when on) reads each one out as it comes while the app is open.
 */
export function getOffStep(g: GetOffTrip, pref: GetOffPref, s: LiveState, now: number, f: Fmt): { g: GetOffTrip; actions: GetOffAction[] } {
  const actions: GetOffAction[] = [];
  const set: Record<string, number> = { ...(g.offSet || {}) };
  let alerted = g.alerted || {};
  let spoken = g.spoken || {};
  const mark = (key: string) => { if (!alerted[key]) alerted = { ...alerted, [key]: 1 }; };
  const cancel = (key: string) => {
    if (set[key] == null) return;
    if (!alerted[key] && set[key] > now) actions.push({ t: 'offCancel', id: getOffId(g.id, key), key });
    delete set[key];
  };
  const say = (key: string, text: string) => {
    if (!g.speak || spoken[key]) return;
    spoken = { ...spoken, [key]: 1 };
    actions.push({ t: 'say', key, text });
  };
  const wantEarly = pref.stops > 1;
  for (const key of Object.keys(set)) {
    const m = /^(early|gnow)(\d+)$/.exec(key);
    const k = m ? Number(m[2]) : -1;
    const off = !m || s.done || k < s.cur || (m[1] === 'early' ? !wantEarly : !pref.now);
    if (off) cancel(key);
  }
  if (!s.done && (wantEarly || pref.now)) {
    for (let k = s.cur; k < g.legs.length; k++) {
      const live = legLive(s, k);
      const riding = k === s.cur && s.phase === 'ride' && live;
      const d = s.L2[k]?.d;
      const ai = ix(d?.alightIndex);
      const stopsLeft = riding ? s.stopsLeft : null;
      const kinds: ('early' | 'now')[] = [];
      if (wantEarly) kinds.push('early');
      if (pref.now) kinds.push('now');
      for (const kind of kinds) {
        const key = (kind === 'early' ? 'early' : 'gnow') + k;
        if (alerted[key]) continue;
        const prev = set[key];
        const w = getOffWords(g.legs, s, k, kind, pref.stops, f);
        if (prev != null && prev <= now) {
          // The phone's alert has rung. With the app open (this refresh) it is read out too, while it is still news.
          if (now - prev <= SAY_LATE_MS) say(key, w.say);
          mark(key); delete set[key]; continue;
        }
        if (!live) { cancel(key); continue; }
        let at = kind === 'early' ? earlyTime(s, k, pref.stops) : nowTime(s, k);
        let due = false;
        if (riding && stopsLeft != null) {
          if (kind === 'early') {
            // Already at the stop before yours: the Next stop alert says it now, so this one is skipped.
            // Already at the stop before yours (the Next stop alert says it now), or a ride too short for this
            // choice (the stop that many before is where you got on): no heads up.
            if (stopsLeft <= 1 || !Number.isFinite(at)) { cancel(key); mark(key); continue; }
            due = stopsLeft <= pref.stops;
          } else {
            const nextIsYours = ai > 0 && s.nextIdx === ai;
            const arr = s.L2[k].arr;
            due = nextIsYours && Number.isFinite(arr) && arr - now <= GETOFF_NOW_LEAD_MS;
          }
          if (!due && Number.isFinite(at) && at <= now) at = now + HOLD_MS;
        } else if (Number.isFinite(at) && at <= now) {
          // Not riding it yet by live evidence: a passed time is held, never rung from the clock alone.
          at = now + HOLD_MS;
        }
        if (due) {
          actions.push({ t: 'offDue', id: getOffId(g.id, key), key, title: w.title, body: w.body });
          say(key, w.say);
          mark(key);
          delete set[key];
          continue;
        }
        if (!Number.isFinite(at)) { cancel(key); continue; }
        if (prev == null || Math.abs(prev - at) >= MOVE_MS) { actions.push({ t: 'offSchedule', id: getOffId(g.id, key), key, at, title: w.title, body: w.body }); set[key] = at; }
      }
    }
  }
  const same = JSON.stringify(set) === JSON.stringify(g.offSet || {}) && alerted === g.alerted && spoken === (g.spoken || {});
  return { g: same ? g : { ...g, offSet: set, alerted, spoken }, actions };
}
