// Trip alerts spoken in headphones with the iPhone locked or on Silent (2 Nov, Bidur: "Silent mode. Airpod or headphone
// on. App talks only when app opened" then "Find a way to do this from in app"). The rules, pure so the tests can run
// them; lockedVoice.ts carries them out and liveEngine.ts calls it on every refresh.
//
// How it works (docs/VOICE_LOCKED.md): while a trip is running, the app keeps receiving location updates in the
// background the way turn by turn guidance does (When In Use location, the blue location pill, UIBackgroundModes
// location), so it stays running when the phone is locked and keeps following the live train. It speaks each trip
// moment into the headphones through a playback audio session (UIBackgroundModes audio, voice prompt mode), which the
// Silent switch does not mute. Nothing is said on the phone's speaker from the background (the Silent switch keeps its
// meaning there, Bidur's choice of 1 Nov) and the app never runs without a trip: it stops at arrival, at End trip, when
// the trip is cancelled, and by itself after the trip's last arrival.
//
// One voice, never two: while the app is speaking in the headphones, the push's own spoken sounds (Kylie's clips) are
// replaced by silent copies of the same file names in the app's Library/Sounds (iOS looks there before the app bundle),
// on a short lease the app renews every refresh, so the push still shows its banner and taps but does not talk over
// the app. The lease runs out by itself 45 s after the app stops renewing it, and the native side removes the copies
// when the headphones come out, when the trip ends, when the app is closed and at every launch.
import type { VoiceState } from './tripState';

export const LOCKED = {
  /** The background refresh while the app voices a locked trip (the same 15 s as with the app open). */
  TICK_MS: 15000,
  /** Headphones taken out (AirPods back in the case): the app keeps running this long before it lets go. */
  HEADPHONE_GRACE_MS: 5 * 60000,
  /** The silent push clips' lease: renewed every refresh, so it lapses three refreshes after the app stops. */
  QUIET_LEASE_MS: 45000,
  /** A push for the trip delivered this recently, and not said by the app, is read out (no catch up of older ones). */
  PUSH_SAY_WINDOW_MS: 60000,
  /** The same kind of moment (heads-up, Get off now, arrived) said once within this window, by the app or a push. */
  SAME_KIND_MS: 3 * 60000,
  /** After the arrival, the app keeps running this long so the arrival is heard in full. */
  AFTER_ARRIVAL_MS: 60000,
  /** The native side stops by itself this long after the trip's last arrival (or the cap below). */
  AFTER_LAST_ARRIVAL_MS: 30 * 60000,
  MAX_AWAKE_MS: 4 * 3600000,
  /** V2: the app says a moment only from a live reading under this age; the push sounds are silenced only then. */
  FRESH_MS: 60000,
} as const;

/** More > Speak alerts in headphones, as stored: on unless switched off. */
export function readLockedVoice(stored: unknown): boolean {
  return stored !== false;
}

/** "headphones", "speaker" or "other" from the native route reading (anything unknown is "other"). */
export const isHeadphones = (route: string | null | undefined) => route === 'headphones';

export type AwakeInput = {
  os: string;
  /** The build has the native part (startTripAwake). */
  supported: boolean;
  /** More > Speak alerts in headphones. */
  setting: boolean;
  /** The trip speaks (the trip's Speak alerts or spoken Get off now, with speech on this phone). */
  speaks: boolean;
  /** tripAwakeStatus(): "ok" needs location allowed While Using the App (or Always) and the background mode. */
  status: string | null;
  /** A trip is running: started, not ended. */
  tripActive: boolean;
  /** When the trip arrived (null before). */
  arrivedAt: number | null;
  appActive: boolean;
  route: string | null;
  /** When the headphones were last seen while the app ran in the background (null: never this trip). */
  headphonesAt: number | null;
  now: number;
};

/**
 * Whether the app should keep running in the background for this trip now. With the app open it is kept ready (iOS
 * only lets background location start while the app is in front, so it is started at Start trip). In the background
 * it is kept only while the headphones are in, or came out under 5 min ago: no headphones, no blue pill, no battery.
 */
export function awakeWanted(o: AwakeInput): { want: boolean; why: string } {
  if (o.os !== 'ios') return { want: false, why: 'iPhone only (Android needs a foreground service, not built)' };
  if (!o.supported) return { want: false, why: 'build without the native part' };
  if (!o.setting) return { want: false, why: 'Speak alerts in headphones is off' };
  if (!o.speaks) return { want: false, why: 'this trip does not speak' };
  if (!o.tripActive) return { want: false, why: 'no trip running' };
  if (o.arrivedAt != null && o.now - o.arrivedAt > LOCKED.AFTER_ARRIVAL_MS) return { want: false, why: 'arrived' };
  if (o.status !== 'ok') return { want: false, why: `location not ready (${o.status ?? 'unknown'})` };
  if (o.appActive) return { want: true, why: 'app open: ready for the lock' };
  if (isHeadphones(o.route)) return { want: true, why: 'headphones in' };
  if (o.headphonesAt != null && o.now - o.headphonesAt <= LOCKED.HEADPHONE_GRACE_MS) return { want: true, why: 'headphones out, waiting a few minutes' };
  return { want: false, why: 'no headphones' };
}

/** When the native side stops by itself: 30 min after the trip's last arrival, never over 4 h from now, at least 30 min. */
export function awakeUntil(lastArrival: number | null | undefined, now: number): number {
  const cap = now + LOCKED.MAX_AWAKE_MS;
  if (lastArrival == null || !Number.isFinite(lastArrival)) return cap;
  return Math.min(cap, Math.max(now + LOCKED.AFTER_LAST_ARRIVAL_MS, lastArrival + LOCKED.AFTER_LAST_ARRIVAL_MS));
}

/** Whether the app can voice the trip from the background right now. */
export function canVoiceLocked(o: { appActive: boolean; awake: boolean; route: string | null; setting: boolean }): boolean {
  return !o.appActive && o.awake && o.setting && isHeadphones(o.route);
}

/**
 * Since when the voice has been there without a break (the V4 catch-up rule counts from it): the app open, or the app
 * voicing the locked trip in headphones. Going from open to locked with headphones in keeps the time; headphones put
 * in while locked start it again (nothing from before is said).
 */
export function nextVoiceSince(prev: number | null, available: boolean, now: number): number | null {
  if (!available) return null;
  return prev ?? now;
}

/**
 * The speech state for the trip flow (voiceGate) while the app voices the locked trip: in front for voiceGate's sake
 * (V1), in headphones (V6: playback session, heard on Silent), counting from the unbroken voice time (V4). Null when
 * the app is not voicing the locked trip (the engine's own open state is used).
 */
export function lockedVoiceState(o: { voicing: boolean; since: number | null; refreshes: number; speakingUntil: number }): VoiceState | null {
  if (!o.voicing || o.since == null) return null;
  return { open: true, silent: false, headphones: true, openSince: o.since, refreshes: o.refreshes, speakingUntil: o.speakingUntil };
}

/** The kind of trip moment an engine key or push names: "headsup", "getoff" or "arrived"; null for anything else. */
export function kindOfKey(key: string | null | undefined): 'headsup' | 'getoff' | 'arrived' | null {
  const m = /^f:(headsup|getoff|atstop|arrived):/.exec(String(key || ''));
  if (!m) return null;
  return m[1] === 'atstop' ? 'getoff' : (m[1] as 'headsup' | 'getoff' | 'arrived');
}

const PUSH_KIND: Record<string, 'headsup' | 'getoff' | 'arrived'> = { headsup: 'headsup', getoff: 'getoff', atstop: 'getoff', arrived: 'arrived' };

/** A trip push's moment kind from its tag ("w<watch><kind>", the server's trip flow alerts), or null. */
export function pushKind(data: any, watch: string): 'headsup' | 'getoff' | 'arrived' | null {
  const tag = typeof data?.tag === 'string' ? data.tag : '';
  const head = `w${watch}`;
  if (!tag.startsWith(head)) return null;
  return PUSH_KIND[tag.slice(head.length)] || null;
}

type Act = { t: string; key?: string; [k: string]: any };

/**
 * What the engine does with one refresh's actions while the app voices the locked trip: no banner of its own when the
 * server is watching the trip (the server's push is the banner, as before), speech only in the headphones, and a
 * moment a push already had read out (pushesToSay) is not said twice.
 */
export function lockedActions<A extends Act>(actions: A[], o: { serverWatching: boolean; headphones: boolean; said: Record<string, number>; now: number }): A[] {
  return actions.filter((a) => {
    if (a.t === 'alert') return !o.serverWatching;
    if (a.t === 'ongoing') return false;
    if (a.t === 'say' || a.t === 'clip') {
      if (!o.headphones) return false;
      const k = kindOfKey(a.key);
      if (k && o.said[k] != null && Math.abs(o.now - o.said[k]) < LOCKED.SAME_KIND_MS) return false;
    }
    return true;
  });
}

/** Records the kinds the app is saying now (heads-up, Get off now, arrived) with the time, for the one voice rule. */
export function saidKinds(actions: Act[], said: Record<string, number>, now: number): Record<string, number> {
  let out = said;
  for (const a of actions) {
    if (a.t !== 'say' && a.t !== 'clip') continue;
    const k = kindOfKey(a.key);
    if (k) out = { ...out, [k]: now };
  }
  return out;
}

export type Shown = { id: string; date: number; title?: string | null; body?: string | null; data?: any };

/**
 * The server's pushes for this trip that the app reads out itself (their spoken sound is silent while the app voices
 * the trip): delivered in the last minute, a heads-up, Get off now or arrival, not read before, and not a moment the
 * app said itself in the last 3 minutes. Each is said once (heard), in the push's own words.
 */
export function pushesToSay(shown: Shown[], o: { watch: string | null; now: number; said: Record<string, number>; heard: Record<string, 1> }): { id: string; kind: 'headsup' | 'getoff' | 'arrived'; text: string }[] {
  if (!o.watch) return [];
  const out: { id: string; kind: 'headsup' | 'getoff' | 'arrived'; text: string }[] = [];
  const said = { ...o.said };
  for (const n of [...shown].sort((a, b) => a.date - b.date)) {
    if (!n || o.heard[n.id]) continue;
    const d = n.data || {};
    if (String(d.watch ?? '') !== o.watch) continue;
    const kind = pushKind(d, o.watch);
    if (!kind) continue;
    if (!(n.date <= o.now + 5000 && o.now - n.date <= LOCKED.PUSH_SAY_WINDOW_MS)) continue;
    if (said[kind] != null && Math.abs(n.date - said[kind]) < LOCKED.SAME_KIND_MS) continue;
    const text = String(n.body || n.title || '').trim();
    if (!text) continue;
    out.push({ id: n.id, kind, text });
    said[kind] = n.date;
  }
  return out;
}

/**
 * Whether the push's spoken sounds should be silent copies now, and until when: only while the app is voicing the
 * locked trip in the headphones from a live reading under 60 s old. Else none (the push sounds as before).
 */
export function quietLease(o: { voicing: boolean; readingAge: number | null; now: number }): number | null {
  if (!o.voicing || o.readingAge == null || !(o.readingAge < LOCKED.FRESH_MS)) return null;
  return o.now + LOCKED.QUIET_LEASE_MS;
}

/** More > Speak alerts in headphones: the row's line under the title, and what tapping it does, from the location state. */
export function lockedVoiceRow(status: string | null): { subtitle: string; action: 'none' | 'ask' | 'settings' } {
  if (status === 'ok') return { subtitle: 'On a trip, even when locked or on Silent', action: 'none' };
  if (status === 'notDetermined') return { subtitle: 'Needs your location while using the app', action: 'ask' };
  return { subtitle: 'Needs location. Turn it on in Settings', action: 'settings' };
}

/** What the row explains when tapped, with the iPhone's own way as well (Announce Notifications, read by Siri). */
export const LOCKED_VOICE_HELP = {
  title: 'Speak alerts in headphones',
  body: 'While a trip is on and your headphones are in, Transport reads out its alerts, like Get off now, even when your iPhone is locked or on Silent. It uses your location while the trip runs, so you may see the location icon. It stops when you arrive.\n\nYou can also have Siri read every Transport alert: Settings, Notifications, Announce Notifications.',
} as const;
