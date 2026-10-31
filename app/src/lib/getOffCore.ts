// Get off alert the rider controls: how many stops before your stop the heads up comes (1, 2 or 3; 1 is the
// "Next stop" alert the app has always sent), and "Get off now" (on unless turned off). Since 31 Oct (Bidur: an early
// "get off" when a bus runs late would freak people out) the voice plays only when it is known to be real: the server's
// push from live times, the phone's real position (location alerts, the location section at the end of this file), or the app itself while it
// is open with live times just read. Nothing is set on the phone to ring "get off" from a clock; without location the
// phone's only backup is a quiet note. No React here (test/getoff*.test.mjs, test/getoffregion31.test.mjs).
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
  /** What the phone's own backup can use (31 Oct, backupOf below): `region`, location alerts (build 211+,
   * location allowed and precise); else `quiet`, the quiet note. Absent: quiet. */
  backup?: GetOffBackup;
  /** The location alerts set on the phone (rnow<leg>, rsoon<leg>), each with its place, size and sound. */
  offRegion?: Record<string, string>;
  /** This trip's own get off alerts shown on the phone (a location alert that rang, a quiet note), by key. */
  rung?: Record<string, 1>;
  /** When the live times were last read (ms): the quiet note is set only from live times at most 5 minutes old. */
  liveAt?: number | null;
};
/** The spoken alert sounds in the app (build 210 and later): a chime and a voice, played as the alert's own sound so
 * they are heard with the phone locked, where the app itself cannot speak. */
export type GetOffSound = 'getoff_now' | 'getoff_soon';
export const GETOFF_SOUND_WORDS: Record<GetOffSound, string> = {
  getoff_now: 'Please get off at the next stop.',
  getoff_soon: 'Your stop is coming up. Please get ready to get off at the next stop.',
};
export type GetOffAction =
  | { t: 'offSchedule'; id: string; key: string; at: number; title: string; body: string; sound?: GetOffSound; quiet?: boolean }
  | { t: 'regionSchedule'; id: string; key: string; lat: number; lon: number; radius: number; title: string; body: string; sound?: GetOffSound }
  | { t: 'regionCancel'; id: string; key: string }
  | { t: 'offDue'; id: string; key: string; title: string; body: string; sound?: GetOffSound }
  | { t: 'offCancel'; id: string; key: string }
  | { t: 'say'; key: string; text: string; quiet?: boolean };

/**
 * One refresh of the get off alerts, beside the trip's own alerts (31 Oct, Bidur's rule: a wrong or early "get off"
 * would freak people out, so the voice plays only when it is known to be real: the server's push from live times, or
 * the phone's real position). For each leg still ahead:
 * - with location (backup `region`): the heads up ("Next stop", or "N stops to Central") and Get off now are set once
 *   as location alerts (the location section below): circles iOS rings on entry with the app closed or the phone locked, so a
 *   late service brings them late with it. Get off now is not set when the server sends it (`server`), and "Next stop"
 *   not when a server watch sends it (`serverNext`) or the wake alarm stands in (`wake`): one moment, one voice;
 * - without location (backup `quiet`): one quiet note, no sound, not time sensitive, never "get off", for the live
 *   arrival less 2 minutes, only from live times read in the last 5 minutes, moved on every refresh, not set when the
 *   server sends Get off now;
 * - nothing is ever set on the phone for a time to say "get off" (alerts an earlier version set that way are taken
 *   back);
 * - while the app is open (this refresh, live times just read), Get off now rings 30 s before the live arrival and the
 *   N stops heads up when the live position says so, as before; a leg with no live times rings and says nothing;
 * - whichever comes first wins: a location alert that rang (`rung`, from the phone's shown notifications), the server's
 *   push (`serverRung`) or the app's own moment marks that moment done and takes the others back;
 * - nothing is read out or rung late (a region alert that rang is never read out again by the app).
 */
export function getOffStep(g: GetOffTrip, pref: GetOffPref, s: LiveState, now: number, f: Fmt): { g: GetOffTrip; actions: GetOffAction[] } {
  const actions: GetOffAction[] = [];
  const set: Record<string, number> = { ...(g.offSet || {}) };
  const region: Record<string, string> = { ...(g.offRegion || {}) };
  const voiced: Record<string, 1> = { ...(g.offVoice || {}) };
  let alerted = g.alerted || {};
  let spoken = g.spoken || {};
  const mark = (key: string) => { if (!alerted[key]) alerted = { ...alerted, [key]: 1 }; };
  const saidQuietly = (key: string) => { if (!spoken[key]) spoken = { ...spoken, [key]: 1 }; };
  const cancel = (key: string) => {
    delete voiced[key];
    if (set[key] == null) return;
    if (!alerted[key] && set[key] > now) actions.push({ t: 'offCancel', id: getOffId(g.id, key), key });
    delete set[key];
  };
  const cancelRegion = (key: string) => {
    delete voiced[key];
    if (region[key] == null) return;
    if (!alerted[key]) actions.push({ t: 'regionCancel', id: getOffId(g.id, key), key });
    delete region[key];
  };
  // The spoken sound a location alert rings with (it rings with the phone locked, where the app cannot speak): Get off
  // now when spoken Get off now or Speak alerts is on, the heads up only with Speak alerts on.
  const soundFor = (kind: 'early' | 'now'): GetOffSound | undefined => {
    const v = g.voice;
    if (!v) return undefined;
    if (kind === 'now') return v.now || v.all ? 'getoff_now' : undefined;
    return v.all ? 'getoff_soon' : undefined;
  };
  // An alert rung at once with the app open is read out by the app (richer: it names the stop); the spoken sound is
  // used then only when the app will not read it out, so nothing is said twice.
  const dueSound = (kind: 'early' | 'now') => (g.speak || (kind === 'now' && g.sayNow) ? undefined : soundFor(kind));
  const say = (key: string, text: string, kind: 'early' | 'now') => {
    const all = !!g.speak;
    if ((!all && !(kind === 'now' && g.sayNow)) || spoken[key]) return;
    spoken = { ...spoken, [key]: 1 };
    actions.push(all ? { t: 'say', key, text } : { t: 'say', key, text, quiet: true });
  };
  const wantEarly = pref.stops > 1;
  /** The moment a region alert stands for: rnow<k> is Get off now (gnow<k>), rsoon<k> the heads up (next<k> or early<k>). */
  const momentOf = (rkey: string) => {
    const m = /^r(now|soon)(\d+)$/.exec(rkey);
    if (!m) return '';
    return m[1] === 'now' ? 'gnow' + m[2] : (wantEarly ? 'early' : 'next') + m[2];
  };

  // Alerts an earlier version set on the phone for a time (gnow, next, early): taken back, never rung from a clock.
  // One whose time has passed has rung already: done (and said, when it rang with its spoken sound).
  for (const key of Object.keys(set)) {
    if (!/^(gnow|next|early)\d+$/.test(key)) continue;
    if (set[key] <= now) { if (voiced[key]) saidQuietly(key); delete voiced[key]; mark(key); delete set[key]; }
    else cancel(key);
  }

  // A location alert that rang (shown on the phone): that moment is done, and said when it rang with its spoken sound.
  const rung = g.rung || {};
  for (const key of Object.keys(region)) {
    if (!rung[key]) continue;
    const moment = momentOf(key);
    mark(key);
    if (moment) { mark(moment); if (voiced[key]) saidQuietly(moment); }
    delete voiced[key];
    delete region[key];
  }
  for (const key of Object.keys(set)) {
    if (/^quiet\d+$/.test(key) && (rung[key] || set[key] <= now)) { mark(key); delete set[key]; }
  }

  // Location alerts (with location allowed, precise, on a build with the native part).
  const wantNowRegion = pref.now && !g.server;
  const wantSoonRegion = wantEarly || (!g.serverNext && !g.wake);
  const wantRegion = new Set<string>();
  if (g.backup === 'region' && !s.done) {
    for (const r of tripRegions(g.legs, s, pref.stops, { now: wantNowRegion, soon: wantSoonRegion })) {
      const moment = momentOf(r.key);
      if (alerted[r.key] || (moment && alerted[moment])) continue;
      const k = Number(/(\d+)$/.exec(r.key)?.[1] ?? -1);
      const x = s.L2[k];
      const riding = k === s.cur && s.phase === 'ride' && legLive(s, k);
      // Already at or past that stop by live evidence: nothing to set for it.
      if (riding && s.stopsLeft != null && (r.kind === 'soon' ? s.stopsLeft <= pref.stops : s.stopsLeft <= 0)) continue;
      // Arrived by the live times: Get off now has nothing left to do.
      if (r.kind === 'now' && legLive(s, k) && x && Number.isFinite(x.arr) && x.arr <= now) continue;
      wantRegion.add(r.key);
      const kind = r.kind === 'now' ? 'now' : 'early';
      const sound = soundFor(kind);
      const sig = regionSig(r, sound);
      if (region[r.key] === sig) continue;
      const w = regionWords(g.legs, k, r.kind, pref.stops, f);
      actions.push({ t: 'regionSchedule', id: getOffId(g.id, r.key), key: r.key, lat: r.lat, lon: r.lon, radius: r.radius, title: w.title, body: w.body, ...(sound ? { sound } : {}) });
      region[r.key] = sig;
      if (sound) voiced[r.key] = 1; else delete voiced[r.key];
    }
  }
  for (const key of Object.keys(region)) if (!wantRegion.has(key)) cancelRegion(key);

  // The quiet note (no location): no sound, not time sensitive, never "get off".
  const fresh = typeof g.liveAt === 'number' && Number.isFinite(g.liveAt) && now - g.liveAt <= QUIET_FRESH_MS;
  const wantQuiet = new Set<string>();
  if (g.backup !== 'region' && !s.done && !g.server) {
    for (let k = Math.max(0, s.cur); k < g.legs.length; k++) {
      const key = 'quiet' + k;
      if (alerted[key] || alerted['gnow' + k]) continue;
      const arr = nowArrival(s, k);
      if (!fresh || !legLive(s, k) || !Number.isFinite(arr) || arr <= now) continue;
      const at = arr - QUIET_LEAD_MS;
      // That moment is now, with the app open: the trip screen shows it; nothing is posted late.
      if (at <= now) { mark(key); continue; }
      wantQuiet.add(key);
      const prev = set[key];
      if (prev == null || Math.abs(prev - at) >= MOVE_MS) {
        const w = quietWords(f.short(g.legs[k]?.to));
        actions.push({ t: 'offSchedule', id: getOffId(g.id, key), key, at, title: w.title, body: w.body, quiet: true });
        set[key] = at;
      }
    }
  }
  for (const key of Object.keys(set)) if (/^quiet\d+$/.test(key) && !wantQuiet.has(key)) cancel(key);

  // The app is open now with live times just read: the moments that come now ring here, read out as chosen.
  if (!s.done && (wantEarly || pref.now)) {
    for (let k = Math.max(0, s.cur); k < g.legs.length; k++) {
      const live = legLive(s, k);
      if (pref.now) {
        const key = 'gnow' + k;
        if (!alerted[key]) {
          const w = getOffWords(g.legs, s, k, 'now', pref.stops, f);
          const arr = nowArrival(s, k);
          if (g.server && g.serverRung?.[key]) {
            // The server's push came first: done (and said, when it spoke); the location alert is taken back.
            if (g.serverVoice) saidQuietly(key);
            mark(key); cancelRegion('rnow' + k);
          } else if (live && !s.L2[k]?.missed && Number.isFinite(arr)) {
            if (arr <= now) { mark(key); cancelRegion('rnow' + k); }
            else if (arr - GETOFF_NOW_LEAD_MS <= now) {
              const ds = dueSound('now');
              actions.push({ t: 'offDue', id: getOffId(g.id, key), key, title: w.title, body: w.body, ...(ds ? { sound: ds } : {}) });
              say(key, w.say, 'now');
              mark(key); cancelRegion('rnow' + k);
            }
          }
          // No live times for the leg: a timetable guess never rings or speaks "get off" (the location alert may).
        }
      }
      const riding = k === s.cur && s.phase === 'ride' && live;
      if (!riding || s.stopsLeft == null) continue;
      if (wantEarly) {
        const key = 'early' + k;
        if (!alerted[key]) {
          // At the stop before yours (the Next stop alert says it now), or a ride too short for this choice (the stop
          // that many before is where you got on): no heads up.
          if (s.stopsLeft <= 1 || !Number.isFinite(earlyTime(s, k, pref.stops))) { mark(key); cancelRegion('rsoon' + k); }
          else if (s.stopsLeft <= pref.stops) {
            const w = getOffWords(g.legs, s, k, 'early', pref.stops, f);
            const ds = dueSound('early');
            actions.push({ t: 'offDue', id: getOffId(g.id, key), key, title: w.title, body: w.body, ...(ds ? { sound: ds } : {}) });
            say(key, w.say, 'early');
            mark(key); cancelRegion('rsoon' + k);
          }
        }
      } else if (s.stopsLeft <= 1) {
        // At the stop before yours with the app open: the trip's own "Next stop" alert and spoken line say it now
        // (liveCalc tripAlerts, speechCues); the location alert for it is taken back.
        cancelRegion('rsoon' + k);
      }
    }
  }
  for (const key of Object.keys(voiced)) if (set[key] == null && region[key] == null) delete voiced[key];
  const sameVoice = JSON.stringify(voiced) === JSON.stringify(g.offVoice || {});
  const sameRegion = JSON.stringify(region) === JSON.stringify(g.offRegion || {});
  const same = JSON.stringify(set) === JSON.stringify(g.offSet || {}) && alerted === g.alerted && spoken === (g.spoken || {}) && sameVoice && sameRegion;
  return { g: same ? g : { ...g, offSet: set, alerted, spoken, ...(sameVoice ? {} : { offVoice: voiced }), ...(sameRegion ? {} : { offRegion: region }) }, actions };
}

/** The words of a location alert: no clock time (it rings where you are, whatever the time). */
export function regionWords(legs: WatchLeg[], k: number, kind: 'soon' | 'now', n: number, f: Fmt) {
  const l = legs[k];
  const stop = f.short(l?.to);
  const change = k < legs.length - 1 ? legs[k + 1] : null;
  if (kind === 'now') return { title: `Get off now: ${stop}`, body: change ? `Change here to the ${change.line}.` : 'This is your stop.' };
  const body = change ? `Get ready to change to the ${change.line}.` : 'Get ready to get off.';
  if (n > 1) return { title: `${n} stops to ${stop}`, body };
  return { title: change ? `Next stop: ${stop}, change here` : `Next stop: ${stop}`, body };
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

// ---------- Location alerts and the quiet note (31 Oct) ----------
// Get off alerts from the phone's real position (31 Oct, Bidur: "what if the train or bus is late? ... that would freak
// the user out"). The phone's own backup to the server's Get off now no longer rings from a clock: it is a location
// alert (iOS UNLocationNotificationTrigger, a circle around a point, notify on entry, once) that iOS rings on its own
// with the app closed or the phone locked, with When In Use location. A late bus reaches the circle late, so the alert
// is late with it. Two circles per leg, both from the stop coordinates the trip's stop list already carries:
// - the heads up ("Next stop", or "3 stops to Central" with the nap setting): around the stop that many before yours;
// - Get off now: around your stop, sized for the mode (a train arrives faster and its platform is longer than a bus stop).
// Without location (not allowed, approximate only, or a build without the native part) the only phone alert is a quiet
// note ("Your stop is coming up soon"), no sound, never time sensitive, never "get off", set for the live arrival less
// 2 minutes and only from live times at most 5 minutes old. Tests: test/getoffregion31.test.mjs.

/** iOS monitors at most 20 regions per app (Core Location, shared by every location trigger and geofence). The app
 * uses no other region monitoring; a trip sets at most this many (2 per leg, the next 3 legs), well under 20. */
export const MAX_REGIONS = 6;
/** The quiet note (no location) comes this long before the live arrival, never sooner. */
export const QUIET_LEAD_MS = 120000;
/** The quiet note is set only from live times read at most this long ago. */
export const QUIET_FRESH_MS = 5 * 60000;

type Mode = 'rail' | 'ferry' | 'tram' | 'bus';
export function modeClass(mode?: string | null): Mode {
  const m = String(mode || '').toLowerCase();
  if (/light|tram/.test(m)) return 'tram';
  if (/train|metro|rail/.test(m)) return 'rail';
  if (/ferry/.test(m)) return 'ferry';
  return 'bus';
}

/** Get off now circle radius (metres) around your stop: about 300 m for a train or metro (a long platform, a fast
 * arrival), 250 m ferry, 200 m light rail, 150 m bus or coach. */
export const NOW_RADIUS: Record<Mode, number> = { rail: 300, ferry: 250, tram: 200, bus: 150 };
/** Heads up circle radius around the stop before (or N before). */
export const SOON_RADIUS: Record<Mode, number> = { rail: 300, ferry: 300, tram: 200, bus: 200 };
/** A stop before that is further than this from yours: the heads up circle is put this far before your stop instead,
 * on the line between them (so it still comes about a stop's time ahead, not many minutes early). */
export const SOON_FAR: Record<Mode, number> = { rail: 3000, ferry: 3000, tram: 1500, bus: 1500 };
/** Where that circle goes: 900 m before a train or ferry stop, 600 m before a bus or light rail stop. */
export const SOON_BACK: Record<Mode, number> = { rail: 900, ferry: 900, tram: 600, bus: 600 };
/** The circle must start this far from where you get on: inside it at the start, iOS would never ring it. */
const START_CLEAR_M = 150;

export type Region = { lat: number; lon: number; radius: number };
export type RegionAlert = Region & { key: string; kind: 'soon' | 'now' };

const R_EARTH = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
/** Metres between two points (haversine). */
export function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** The point `m` metres from b towards a (straight line; short distances). */
function towards(b: { lat: number; lon: number }, a: { lat: number; lon: number }, m: number) {
  const d = metres(a, b);
  const f = d > 0 ? Math.min(1, m / d) : 0;
  return { lat: b.lat + (a.lat - b.lat) * f, lon: b.lon + (a.lon - b.lon) * f };
}
const hasPos = (s?: { lat?: number | null; lon?: number | null } | null): s is { lat: number; lon: number } =>
  !!s && typeof s.lat === 'number' && typeof s.lon === 'number' && Number.isFinite(s.lat) && Number.isFinite(s.lon) && !(s.lat === 0 && s.lon === 0);
const round = (v: number) => Math.round(v * 1e5) / 1e5;

/**
 * The two circles for leg k (none when the stop list has no coordinates): `now` around your stop, `soon` around the
 * stop `n` before it (skipped stops not counted), or SOON_BACK before your stop when that stop is far away. A circle
 * that would hold the stop you get on at, or that overlaps the other, is left out.
 */
export function legRegions(leg: WatchLeg | undefined, d: ServiceResp | null | undefined, k: number, n: number): RegionAlert[] {
  const out: RegionAlert[] = [];
  if (!d || !Array.isArray(d.stops)) return out;
  const mi = ix(d.mineIndex), ai = ix(d.alightIndex);
  if (mi < 0 || ai <= mi) return out;
  const off = d.stops[ai], on = d.stops[mi];
  if (!hasPos(off)) return out;
  const mode = modeClass(leg?.mode || d.mode);
  const rNow = NOW_RADIUS[mode], rSoon = SOON_RADIUS[mode];
  const clear = (c: { lat: number; lon: number }, r: number) => !hasPos(on) || metres(on, c) > r + START_CLEAR_M;
  if (clear(off, rNow)) out.push({ key: 'rnow' + k, kind: 'now', lat: round(off.lat), lon: round(off.lon), radius: rNow });
  // The stop n before yours (not where you get on).
  let p = ai, count = 0;
  while (p > mi && count < n) { p--; const st = d.stops[p]; if (p > mi && st && !st.skipped) count++; }
  if (count === n && p > mi) {
    const prev = d.stops[p];
    if (hasPos(prev)) {
      const far = metres(prev, off);
      let c: { lat: number; lon: number } = prev;
      if (n === 1 && far > SOON_FAR[mode]) c = towards(off, prev, SOON_BACK[mode]);
      const gap = metres(c, off);
      if (gap >= rNow + rSoon && clear(c, rSoon)) out.push({ key: 'rsoon' + k, kind: 'soon', lat: round(c.lat), lon: round(c.lon), radius: rSoon });
    }
  }
  return out;
}

/** The region alerts a trip wants now: legs from the one you are on, at most MAX_REGIONS. */
export function tripRegions(legs: WatchLeg[], s: LiveState, n: number, want: { now: boolean; soon: boolean }): RegionAlert[] {
  const out: RegionAlert[] = [];
  if (s.done) return out;
  for (let k = Math.max(0, s.cur); k < legs.length && out.length < MAX_REGIONS; k++) {
    const x = s.L2[k];
    if (!x || x.missed) continue;
    for (const r of legRegions(legs[k], x.d, k, n)) {
      if (r.kind === 'now' ? !want.now : !want.soon) continue;
      if (out.length < MAX_REGIONS) out.push(r);
    }
  }
  return out;
}

/** A region's identity, so one is set again only when its place, size or sound changed. */
export const regionSig = (r: Region, sound?: string) => `${r.lat},${r.lon},${r.radius}${sound ? ',' + sound : ''}`;

/** The quiet note's words (no location): never "get off", never a time to act on. */
export function quietWords(stop: string): { title: string; body: string } {
  return { title: 'Your stop is coming up soon', body: stop ? `Check the app for ${stop}.` : 'Check the app.' };
}

/** Get off alert ids that are region alerts (getoff-<trip>-rnow0, -rsoon1). */
export const isRegionAlertId = (id: string) => /^getoff-.+-r(now|soon)\d+$/.test(id);
/** The trip and key of a get off alert id. */
export function parseGetOffId(id: string): { gid: string; key: string } | null {
  const m = /^getoff-(.+)-((?:rnow|rsoon|gnow|next|early|quiet)\d+)$/.exec(String(id || ''));
  return m ? { gid: m[1], key: m[2] } : null;
}

/** The keys of this trip's own get off alerts already shown on the phone (a region alert that rang, a quiet note). */
export function ownRungKeys(gid: string, shownIds: string[]): Record<string, 1> {
  const out: Record<string, 1> = {};
  for (const id of shownIds) { const p = parseGetOffId(id); if (p && p.gid === gid) out[p.key] = 1; }
  return out;
}

/** Region alerts still waiting on the phone that belong to no running trip: taken back (a trip given up without
 * opening the app again must not ring "Get off now" near that stop days later). */
export function staleRegionIds(pendingIds: string[], liveGid: string | null): string[] {
  return pendingIds.filter((id) => { if (!isRegionAlertId(id)) return false; const p = parseGetOffId(id); return !p || p.gid !== liveGid; });
}

/** What the phone can use for the backup: `region` (location alerts), else `quiet` (the quiet note). */
export type GetOffBackup = 'region' | 'quiet';
/** Location alerts need the native part (build 211 and later), location allowed (When In Use or Always) and precise
 * location (iOS does not monitor regions with approximate location). Anything else is the quiet note. */
export function backupOf(nativeHas: boolean, status: string | null | undefined): GetOffBackup {
  return nativeHas && status === 'ok' ? 'region' : 'quiet';
}
