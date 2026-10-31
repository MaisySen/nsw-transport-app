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
/** The phone's own "Next stop" (next<leg>) without a live stop list: this long before the live arrival (31 Oct). */
export const NEXT_LEAD_MS = 90000;
/** The phone's own "Next stop" is set this long after the service is due to leave the stop before (31 Oct). */
export const NEXT_HOLD_MS = 40000;

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
  // No live times for the leg (30 Oct): the alert rings from the timetable and says so, so it is never read as live.
  const tt = !legLive(s, k);
  return {
    title: `Get off now: ${stop}`,
    body: (change ? `Change here to the ${change.line}.` : `This is your stop${at ? `, due ${at}` : ''}.`) + (tt ? ' Timetable time, no live times.' : ''),
    say: getOffSayText(sayStop(l?.to), !!change),
  };
}

/** The words of the phone's own "Next stop" (next<leg>): the same as the trip's "Next stop" alert (liveCalc tripAlerts). */
export function nextWords(legs: WatchLeg[], s: LiveState, k: number, f: Fmt) {
  const l = legs[k];
  const stop = f.short(l?.to);
  const arr = s.L2[k]?.arr;
  const at = Number.isFinite(arr) ? f.clock(arr) : '';
  const change = k < legs.length - 1 ? legs[k + 1] : null;
  return change
    ? { title: `Next stop: ${stop}, change here`, body: `Get ready to change to the ${change.line}${at ? `. You get to ${stop} at ${at}` : ''}.` }
    : { title: `Next stop: ${stop}`, body: `Get ready to get off${at ? `. You arrive at ${at}` : ''}.` };
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
export type GetOffTrip = {
  id: string; legs: WatchLeg[]; alerted: Record<string, 1>; offSet?: Record<string, number>; speak?: boolean; sayNow?: boolean; spoken?: Record<string, 1>;
  /** The phone has the spoken alert sounds (voiceClipsSupported) and they are not turned off: `now` spoken Get off now
   * is on, `all` Speak alerts is on. Null or absent: every alert rings with the phone's normal sound, as before. */
  voice?: { now: boolean; all: boolean } | null;
  /** The alerts set on the phone with a spoken sound: when one rings, the phone has already said it, so the app does
   * not read it out again when it is opened. */
  offVoice?: Record<string, 1>;
  /** The server sends Get off now for this trip (30 Oct, build 210: its watch was started with getOff: 1 and the
   * server said yes). Get off now is then never set on the phone (what was set is taken back): set at the last app
   * open, it rang early when the bus ran late after the phone locked. With the app open it still rings and is read
   * out at its moment as before; the server's own push is not shown then (push.ts). */
  server?: boolean;
  /** Get off now alerts the server already put on the phone (gnow<leg>: 1, read from the phone's shown notifications):
   * done, and said when it rang with its spoken sound (`serverVoice`), so neither rung nor read out again. */
  serverRung?: Record<string, 1>;
  serverVoice?: boolean;
  /** A server watch follows this trip, so its own "Next stop" push is the heads up (31 Oct). Without one (no push
   * token, notifications only on the phone) the phone sets its own "Next stop" alert ahead (next<leg>), so the heads up
   * rings with the phone locked too; before this it came only while the app was open. */
  serverNext?: boolean;
  /** Wake me before my stop is on: its alarm is the heads up, so no "Next stop" alert is set here. */
  wake?: boolean;
};
/** The spoken alert sounds in the app (build 210 and later): a chime and a voice, played as the alert's own sound so
 * they are heard with the phone locked, where the app itself cannot speak. */
export type GetOffSound = 'getoff_now' | 'getoff_soon';
export const GETOFF_SOUND_WORDS: Record<GetOffSound, string> = {
  getoff_now: 'Please get off at the next stop.',
  getoff_soon: 'Your stop is coming up. Please get ready to get off at the next stop.',
};
export type GetOffAction =
  | { t: 'offSchedule'; id: string; key: string; at: number; title: string; body: string; sound?: GetOffSound }
  | { t: 'offDue'; id: string; key: string; title: string; body: string; sound?: GetOffSound }
  | { t: 'offCancel'; id: string; key: string }
  | { t: 'say'; key: string; text: string; quiet?: boolean };

/**
 * One refresh of the get off alerts, beside the trip's own alerts. For each leg still ahead:
 * - "Next stop" (1 stop before, the default) is set on the phone as next<leg> when no server watch sends it and no
 *   wake alarm stands in (31 Oct: with the phone locked it used to come only when the app was opened);
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
  const voiced: Record<string, 1> = { ...(g.offVoice || {}) };
  let alerted = g.alerted || {};
  let spoken = g.spoken || {};
  const mark = (key: string) => { if (!alerted[key]) alerted = { ...alerted, [key]: 1 }; };
  const cancel = (key: string) => {
    delete voiced[key];
    if (set[key] == null) return;
    if (!alerted[key] && set[key] > now) actions.push({ t: 'offCancel', id: getOffId(g.id, key), key });
    delete set[key];
  };
  // The spoken sound an alert set on the phone rings with (30 Oct, Bidur: with the phone locked only the banner came;
  // the app speaks only while it is open). The same rule as reading out: Get off now when spoken Get off now or Speak
  // alerts is on, the heads up only with Speak alerts on.
  const soundFor = (kind: 'early' | 'now'): GetOffSound | undefined => {
    const v = g.voice;
    if (!v) return undefined;
    if (kind === 'now') return v.now || v.all ? 'getoff_now' : undefined;
    return v.all ? 'getoff_soon' : undefined;
  };
  // An alert rung at once with the app open is read out by the app (richer: it names the stop); the spoken sound is
  // used then only when the app will not read it out, so nothing is said twice.
  const dueSound = (kind: 'early' | 'now') => (g.speak || (kind === 'now' && g.sayNow) ? undefined : soundFor(kind));
  const schedule = (key: string, kind: 'early' | 'now', at: number, w: { title: string; body: string }) => {
    const sound = soundFor(kind);
    actions.push({ t: 'offSchedule', id: getOffId(g.id, key), key, at, title: w.title, body: w.body, ...(sound ? { sound } : {}) });
    set[key] = at;
    if (sound) voiced[key] = 1; else delete voiced[key];
  };
  // Set again (same time) when the spoken sound it should ring with changed: the choice was turned on or off.
  const soundMoved = (key: string, kind: 'early' | 'now') => !!voiced[key] !== !!soundFor(kind);
  const say = (key: string, text: string, kind: 'early' | 'now') => {
    const all = !!g.speak;
    if ((!all && !(kind === 'now' && g.sayNow)) || spoken[key]) return;
    spoken = { ...spoken, [key]: 1 };
    actions.push(all ? { t: 'say', key, text } : { t: 'say', key, text, quiet: true });
  };
  // "Next stop" set on the phone for each leg ahead (next<leg>, 31 Oct): when the service leaves the stop before yours
  // (live stop list), else 90 s before the live arrival. Moved with the live times like the others. With the app open
  // at the stop before, the trip's own "Next stop" alert and spoken line take over (liveCalc tripAlerts, speechCues)
  // and the set one is taken back; one that has rung keeps those from repeating it (liveCalc nextRang, nextSaid).
  function nextStep() {
    if (s.done) return;
    for (let k = s.cur; k < g.legs.length; k++) {
      const key = 'next' + k;
      if (alerted[key]) continue;
      const prev = set[key];
      if (prev != null && prev <= now) { delete voiced[key]; mark(key); delete set[key]; continue; }
      const live = legLive(s, k);
      if (!live) { cancel(key); continue; }
      const riding = k === s.cur && s.phase === 'ride';
      if (riding && s.stopsLeft != null && s.stopsLeft <= 1) { cancel(key); continue; }
      // Set a little after the service is due to leave the stop before (NEXT_HOLD_MS), so with the app open the trip's
      // own "Next stop", from live evidence that it has left, comes first and this one is taken back; never later than
      // a minute before the arrival, so it always comes before Get off now.
      const arr = nowArrival(s, k);
      const dep = earlyTime(s, k, 1);
      let at = Number.isFinite(dep) ? Math.max(dep, Math.min(dep + NEXT_HOLD_MS, Number.isFinite(arr) ? arr - 60000 : dep + NEXT_HOLD_MS))
        : Number.isFinite(arr) ? arr - NEXT_LEAD_MS : NaN;
      if (!Number.isFinite(at)) { cancel(key); continue; }
      if (at <= now) at = now + HOLD_MS;
      const w = nextWords(g.legs, s, k, f);
      if (prev == null || Math.abs(prev - at) >= MOVE_MS || soundMoved(key, 'early')) schedule(key, 'early', at, w);
    }
  }
  const wantEarly = pref.stops > 1;
  // The phone's own "Next stop" (1 stop before), set ahead so it rings locked: only when nothing else gives that heads
  // up with the phone locked (no server watch, no wake alarm) and the choice is 1 stop (2 or 3 stops set early<leg>).
  const wantNext = pref.stops === 1 && !g.serverNext && !g.wake;
  for (const key of Object.keys(set)) {
    const m = /^(early|gnow|next)(\d+)$/.exec(key);
    const k = m ? Number(m[2]) : -1;
    const off = !m || s.done || k < s.cur || (m[1] === 'early' ? !wantEarly : m[1] === 'next' ? !wantNext : !pref.now);
    if (off) cancel(key);
  }
  if (!s.done && wantNext) nextStep();
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
          // Get off now is never said once the arrival has passed. One that rang with its spoken sound has been said
          // by the phone already (locked or not), so it is not said again.
          if (voiced[key]) { if (!spoken[key]) spoken = { ...spoken, [key]: 1 }; }
          else if (now - prev <= SAY_LATE_MS && (kind !== 'now' || nowArrival(s, k) > now)) say(key, w.say, kind);
          delete voiced[key];
          mark(key); delete set[key]; continue;
        }
        if (kind === 'now' && g.server) {
          // The server sends it (from the live times when it is due, worded as timetable when it has none): nothing
          // on the phone for a time worked out now. Already shown by the server's push: done (and said, when that
          // push spoke). Else, with the app open, it rings and is read out at its moment, as below.
          if (prev != null) cancel(key);
          if (g.serverRung?.[key]) {
            if (g.serverVoice && !spoken[key]) spoken = { ...spoken, [key]: 1 };
            mark(key);
            continue;
          }
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
            const ds = dueSound(kind);
            actions.push({ t: 'offDue', id: getOffId(g.id, key), key, title: w.title, body: w.body, ...(ds ? { sound: ds } : {}) });
            say(key, w.say, kind);
            mark(key);
            delete set[key];
            delete voiced[key];
            continue;
          }
          if (g.server) continue;
          if (prev == null || Math.abs(prev - nat) >= NOW_MOVE_MS || soundMoved(key, kind)) schedule(key, kind, nat, w);
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
          const ds = dueSound(kind);
          actions.push({ t: 'offDue', id: getOffId(g.id, key), key, title: w.title, body: w.body, ...(ds ? { sound: ds } : {}) });
          say(key, w.say, kind);
          mark(key);
          delete set[key];
          delete voiced[key];
          continue;
        }
        if (!Number.isFinite(at)) { cancel(key); continue; }
        if (prev == null || Math.abs(prev - at) >= MOVE_MS || soundMoved(key, kind)) schedule(key, kind, at, w);
      }
    }
  }
  for (const key of Object.keys(voiced)) if (set[key] == null) delete voiced[key];
  const sameVoice = JSON.stringify(voiced) === JSON.stringify(g.offVoice || {});
  const same = JSON.stringify(set) === JSON.stringify(g.offSet || {}) && alerted === g.alerted && spoken === (g.spoken || {}) && sameVoice;
  return { g: same ? g : { ...g, offSet: set, alerted, spoken, ...(sameVoice ? {} : { offVoice: voiced }) }, actions };
}

/**
 * Whether this phone's app has the spoken alert sounds (getoff_now.wav, getoff_soon.wav in the app, set up by the
 * expo-notifications plugin in app.json): iPhone build 210 and later, Android versionCode 6 and later. Older builds
 * would ring with the default sound anyway (a sound the app does not have plays the default), but on Android a
 * channel cannot be made with a sound it does not have, so older builds are left exactly as they were.
 */
export function voiceClipsSupported(os: string, build: string | number | null | undefined): boolean {
  const n = Number(build);
  if (!Number.isFinite(n)) return false;
  if (os === 'ios') return n >= 210;
  if (os === 'android') return n >= 6;
  return false;
}

/**
 * Whether this build asks the server to send Get off now (30 Oct): the same builds as the spoken sounds, iPhone 210
 * and later and Android versionCode 6 and later. Builds 201 to 209 never ask, even with this code from an update, so
 * they keep the phone's own alert exactly as before.
 */
export function serverGetOffSupported(os: string, build: string | number | null | undefined): boolean {
  return voiceClipsSupported(os, build);
}

/** The keys (gnow<leg>) of the server's Get off now pushes for this watch among the phone's shown notifications. */
export function serverRungKeys(watchId: string | null | undefined, shown: { data?: any }[]): Record<string, 1> {
  const out: Record<string, 1> = {};
  if (!watchId) return out;
  for (const n of shown) {
    const d = n?.data || {};
    if (d.watch === watchId && d.getOff != null && /^\d+$/.test(String(d.getOff))) out[`gnow${d.getOff}`] = 1;
  }
  return out;
}

/** The Android channel an alert with a spoken sound rings on (a channel's sound is fixed when it is made). */
export const getOffSoundChannel = (sound: GetOffSound) => sound;

/**
 * The trigger a get off alert is set with (31 Oct). iPhone: a time interval (seconds from now, at least 1) to the
 * best known moment, which iOS counts down on its own with the app suspended or closed; set again (same identifier)
 * on every live refresh, so it follows the live times while the app runs. Android keeps its date trigger. Null time:
 * shown now.
 */
export function getOffTrigger(os: string, at: number | null, now: number, channelId: string): any {
  if (at == null) return os === 'android' ? { channelId } : null;
  if (os === 'ios') return { type: 'timeInterval', seconds: Math.max(1, Math.round((at - now) / 1000)), repeats: false };
  return { type: 'date', date: at, channelId };
}

/**
 * A trip push (the running trip's own watch) arriving with the app in front that rings with a spoken sound, while the
 * app reads the same moment out itself (Speak alerts): shown, but without its sound, so it is not heard twice
 * (31 Oct). iOS reports a bundled sound as "custom" (or its file name); "default" and none are the normal sound.
 */
export function tripPushSoundless(o: { watch: unknown; sound: unknown; appState: string; tripWatch: string | null; speaks: boolean }): boolean {
  if (o.appState !== 'active' || !o.speaks || !o.tripWatch || o.watch !== o.tripWatch) return false;
  const snd = typeof o.sound === 'string' ? o.sound : '';
  return snd === 'custom' || /^getoff_(now|soon)(\.wav)?$/.test(snd);
}
