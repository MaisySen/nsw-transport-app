// Get off alert the rider controls: how many stops before your stop the heads up comes (1, 2 or 3; 1 is the
// "Next stop" alert the app has always sent), and "Get off now" 30 s before the realtime arrival at your stop (on
// unless turned off; a minute before the timetable arrival when the leg has no live times). Both come from the stop
// times the trip already reads (no location, no extra request), are set on the phone as local alerts so they ring
// with the app closed, and move when the live times move. No React here (test/getoff.test.mjs, test/getoff30.test.mjs).
import type { WatchLeg, ServiceResp } from './types';
import type { LiveState } from './liveCalc';

export type GetOffPref = { stops: 1 | 2 | 3; now: boolean };
export const GETOFF_DEFAULT: GetOffPref = { stops: 1, now: true };
export const GETOFF_STOPS = [1, 2, 3] as const;
/** "Get off now" comes this long before the live (realtime) arrival at your stop (28 Oct: the rider asked for 30 s). */
export const GETOFF_NOW_LEAD_MS = 30000;
/** With no live times for the leg, "Get off now" comes this long before the timetable arrival. */
export const GETOFF_NOW_TIMETABLE_LEAD_MS = 60000;
/** A set alert is moved only when its time moves by this much. */
const MOVE_MS = 15000;
/** Get off now is moved sooner, so it stays well inside the 30 s before arrival. */
const NOW_MOVE_MS = 10000;
/** While the live times say the service is not there yet but its time has passed, the alert waits this long more. */
const HOLD_MS = 30000;
/** A rung alert found on the next refresh is still read out when it rang at most this long ago. */
const SAY_LATE_MS = 45000;

/**
 * The stored value, made safe: anything unknown is the default (1 stop, Get off now on). Get off now is on unless
 * the rider turned it off (stored false), so phones that kept the old default get it from this update.
 */
export function readGetOff(raw: unknown): GetOffPref {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { stops?: unknown; now?: unknown };
  const n = Number(r.stops);
  const stops = (n === 2 || n === 3 ? n : 1) as 1 | 2 | 3;
  // Get off now was opt in before 28 Oct, so a stored false from then is the old default, not a choice: only a
  // value saved from this version (v 2) can turn it off.
  const v2 = (raw as { v?: unknown } | null)?.v === 2;
  return { stops, now: v2 ? r.now === true : true };
}

/**
 * Spoken Get off now (28 Oct): "Get off now at Central" is said out loud as it rings, while the app can run, even
 * with Speak alerts off. On unless turned off in the Get off alert menu; kept apart from the stops choice so a saved
 * choice reads the same as before. Builds without the speech module say nothing (hasSpeech in liveEngine).
 */
export function readGetOffSay(raw: unknown): boolean { return raw !== false; }

/** The menu's choice: "Alert 1 stop early", "Alert 3 stops early" (a nap setting: the heads up wakes you in time). */
export const earlyWords = (n: number) => `Alert ${n} stop${n === 1 ? '' : 's'} early`;

/** "1 stop before", "2 stops before". */
export const stopsWords = (n: number) => `${n} stop${n === 1 ? '' : 's'} before`;

/** The row's value: "1 stop before", "2 stops before, Get off now". */
export function getOffValueText(p: GetOffPref): string {
  return `${stopsWords(p.stops)}${p.now ? ', Get off now' : ''}`;
}

/** The row's short value at the right: "1 stop", "3 stops". */
export const getOffShortText = (p: GetOffPref) => `${p.stops} stop${p.stops === 1 ? '' : 's'}`;

/** The row's second line, for the stop you get off at next. */
export function getOffSubText(p: GetOffPref, stop: string): string {
  const to = stop || 'your stop';
  if (p.stops === 1) return p.now ? `At the stop before ${to}, and Get off now 30 s before you reach it` : `As you leave the stop before ${to}`;
  return p.now ? `${p.stops} stops before ${to}, at the stop before, and Get off now` : `${p.stops} stops before ${to}, then at the stop before`;
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

/**
 * When to say "Get off now" on leg k: 30 seconds before the realtime arrival at your stop when the leg is live, or
 * a minute before the timetable arrival when it is not. NaN without an arrival time.
 */
export function nowTime(s: LiveState, k: number): number {
  const x = s.L2[k];
  if (!x || !Number.isFinite(x.arr)) return NaN;
  return x.arr - (legLive(s, k) ? GETOFF_NOW_LEAD_MS : GETOFF_NOW_TIMETABLE_LEAD_MS);
}

/** The arrival "Get off now" counts to on leg k (realtime when live, else timetable). */
export const nowArrival = (s: LiveState, k: number): number => {
  const a = s.L2[k]?.arr;
  return typeof a === 'number' && Number.isFinite(a) ? a : NaN;
};

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
    say: getOffSayText(sayStop(l?.to), !!change),
  };
}

/** The spoken Get off now: "Get off now at Central." (and "Change here." when another leg follows). */
export function getOffSayText(stop: string, change: boolean): string {
  return `Get off now${stop ? ` at ${stop}` : ''}.${change ? ' Change here.' : ''}`;
}

/** A stop as it is heard: the part before the comma, without "Station". */
const sayStop = (n?: string | null) => String(n || '').split(',')[0].replace(/ Station$/, '').trim();

/**
 * `speak`: Speak alerts is on (every alert is read out). `sayNow`: the phone can speak and spoken Get off now is on,
 * so the final alert is read out even with Speak alerts off; that one is marked quiet (it follows Silent mode).
 */
export type GetOffTrip = { id: string; legs: WatchLeg[]; alerted: Record<string, 1>; offSet?: Record<string, number>; speak?: boolean; sayNow?: boolean; spoken?: Record<string, 1> };
export type GetOffAction =
  | { t: 'offSchedule'; id: string; key: string; at: number; title: string; body: string }
  | { t: 'offDue'; id: string; key: string; title: string; body: string }
  | { t: 'offCancel'; id: string; key: string }
  | { t: 'say'; key: string; text: string; quiet?: boolean };

/**
 * One refresh of the get off alerts, beside the trip's own alerts. With the default (1 stop, no Get off now) it does
 * nothing, so the alerts are exactly as before. Otherwise, for each leg still ahead:
 * - "N stops to Central" (2 or 3 stops before) and "Get off now" are each set once as a local alert for the time
 *   the live stop times give, and moved when those times move;
 * - on the leg you are on, with live tracking, the service's real position decides the heads up: it comes once the
 *   service has left the stop N before yours; until then an alert whose time has passed waits 30 seconds more;
 * - Get off now is set for the realtime arrival minus 30 s (timetable minus 60 s without live times), moved on every
 *   refresh, rung at once when that moment has come, and never after the arrival (28 Oct: it used to wait for the
 *   stop list to show your stop as next, which trails the train, and rang after the rider had got off);
 * - an alert whose set time has passed has rung (the phone rang it), so nothing rings twice;
 * - without live times no heads up is set (and what was set is taken back), the same rule as the Next stop alert;
 * - a leg you are past, a trip that ended, or a choice turned off takes back what is still to ring.
 * Speak alerts (when on) reads each one out as it comes while the app is open. Spoken Get off now (sayNow) reads
 * the final one out even with Speak alerts off, and never once the arrival has passed.
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
  const say = (key: string, text: string, kind: 'early' | 'now') => {
    const all = !!g.speak;
    if ((!all && !(kind === 'now' && g.sayNow)) || spoken[key]) return;
    spoken = { ...spoken, [key]: 1 };
    actions.push(all ? { t: 'say', key, text } : { t: 'say', key, text, quiet: true });
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
          // Get off now is never said once the arrival has passed.
          if (now - prev <= SAY_LATE_MS && (kind !== 'now' || nowArrival(s, k) > now)) say(key, w.say, kind);
          mark(key); delete set[key]; continue;
        }
        if (kind === 'now') {
          // Get off now: realtime arrival minus 30 s (timetable minus 60 s without live times), set again on every
          // refresh as the arrival moves, rung at once when that moment has come, and never after the arrival: once
          // the arrival has passed, or the service was missed, nothing rings and what was set is taken back.
          const arr = nowArrival(s, k);
          if (!Number.isFinite(arr) || s.L2[k]?.missed || arr <= now) {
            cancel(key);
            if (Number.isFinite(arr) && arr <= now) mark(key);
            continue;
          }
          const nat = nowTime(s, k);
          if (nat <= now) {
            actions.push({ t: 'offDue', id: getOffId(g.id, key), key, title: w.title, body: w.body });
            say(key, w.say, kind);
            mark(key);
            delete set[key];
            continue;
          }
          if (prev == null || Math.abs(prev - nat) >= NOW_MOVE_MS) { actions.push({ t: 'offSchedule', id: getOffId(g.id, key), key, at: nat, title: w.title, body: w.body }); set[key] = nat; }
          continue;
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
          }
          if (!due && Number.isFinite(at) && at <= now) at = now + HOLD_MS;
        } else if (Number.isFinite(at) && at <= now) {
          // Not riding it yet by live evidence: a passed time is held, never rung from the clock alone.
          at = now + HOLD_MS;
        }
        if (due) {
          actions.push({ t: 'offDue', id: getOffId(g.id, key), key, title: w.title, body: w.body });
          say(key, w.say, kind);
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
