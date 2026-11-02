// Trip alerts spoken in headphones with the iPhone locked or on Silent (2 Nov). The rules are in lockedVoiceCore.ts;
// this file carries them out for the live trip engine: it starts and stops the native background session with the
// trip, keeps the silent push clip lease, and reads out a push of the trip the app had not said itself.
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { iosNative } from '../../modules/transport-ios';
import { audioRoute, hasSpeech, playClip, speak } from './nativeExtras';
import { store } from './store';
import { awakeUntil, awakeWanted, canVoiceLocked, isHeadphones, LOCKED, lockedVoiceState, nextVoiceSince, pushesToSay, quietLease, readLockedVoice, saidKinds, type Shown } from './lockedVoiceCore';
import type { VoiceState } from './tripState';

let awakeFor: string | null = null;
let tripFor: string | null = null;
let awakeOn = false;
let voiceSince: number | null = null;
let headphonesAt: number | null = null;
let said: Record<string, number> = {};
let heard: Record<string, 1> = {};
let quietOn = false;

/** This build can keep a trip's voice going with the phone locked (iPhone, the native part present). */
export const lockedVoiceSupported = () => Platform.OS === 'ios' && iosNative.hasTripAwake();

/** The location state for More > Speak alerts in headphones ("ok", "notDetermined", "denied", ...), null without it. */
export const lockedVoiceStatus = () => (lockedVoiceSupported() ? iosNative.tripAwakeStatus() : null);

type TripLike = { id: string; arrivedAt?: number | null; speak?: boolean; legs: { arrPlanned?: string | number | null; planned?: string | number | null }[] };

const ms = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v) { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
};

/** The trip speaks: its Speak alerts or spoken Get off now, with speech on this phone (the existing voice settings). */
export function tripSpeaks(g: { speak?: boolean } | null | undefined, sayNow: boolean): boolean {
  return !!g && (!!g.speak || sayNow) && hasSpeech();
}

/**
 * Every refresh (open or locked): starts, keeps or stops the native background session for this trip. Returns whether
 * the app is voicing the locked trip right now, and the speech state voiceGate uses for it (null: the open app's own).
 */
export async function lockedStep(g: TripLike | null, o: { sayNow: boolean; refreshes: number; speakingUntil: number; now?: number }): Promise<{ voicing: boolean; voice: VoiceState | null }> {
  const now = o.now ?? Date.now();
  if (!lockedVoiceSupported()) return { voicing: false, voice: null };
  const appActive = AppState.currentState === 'active';
  const route = audioRoute();
  if (!appActive && isHeadphones(route)) headphonesAt = now;
  if ((g?.id ?? null) !== tripFor) { tripFor = g?.id ?? null; said = {}; heard = {}; headphonesAt = !appActive && isHeadphones(route) ? now : null; voiceSince = null; }
  const setting = readLockedVoice(store.lockedVoice());
  const w = awakeWanted({ os: Platform.OS, supported: true, setting, speaks: tripSpeaks(g, o.sayNow), status: iosNative.tripAwakeStatus(), tripActive: !!g,
    arrivedAt: g?.arrivedAt ?? null, appActive, route, headphonesAt, now });
  if (w.want && g) {
    // The native side may have stopped by itself (its deadline, location turned off): read it again with the app open.
    if (awakeOn && appActive) awakeOn = await iosNative.tripAwakeOn();
    // Background location can only start with the app in front: started there, kept in the background.
    if (!awakeOn || awakeFor !== g.id) {
      if (appActive) {
        const last = g.legs.length ? ms(g.legs[g.legs.length - 1].arrPlanned) ?? ms(g.legs[g.legs.length - 1].planned) : null;
        awakeOn = (await iosNative.startTripAwake(awakeUntil(last, now))) === 'ok';
        awakeFor = awakeOn ? g.id : null;
      }
    }
  } else if (awakeOn || awakeFor) {
    await stopLockedVoice();
  }
  const voicing = canVoiceLocked({ appActive, awake: awakeOn, route, setting });
  voiceSince = nextVoiceSince(voiceSince, appActive || voicing, now);
  return { voicing, voice: lockedVoiceState({ voicing, since: voiceSince, refreshes: o.refreshes, speakingUntil: o.speakingUntil }) };
}

/** The silent push clips while the app voices the locked trip from a fresh reading; off otherwise. */
export async function lockedQuiet(voicing: boolean, readingAge: number | null, now = Date.now()) {
  if (!lockedVoiceSupported()) return;
  const until = quietLease({ voicing, readingAge, now });
  if (until != null) { quietOn = await iosNative.setPushClipsQuiet(true, until); return; }
  if (quietOn) { quietOn = false; await iosNative.setPushClipsQuiet(false, now); }
}

/** The kinds the app says now (heads-up, Get off now, arrived), kept for the one voice rule. */
export function lockedSaid(actions: { t: string; key?: string }[], now = Date.now()) { said = saidKinds(actions, said, now); }
export const lockedSaidNow = () => said;

/** Reads out the trip's pushes the app had not said itself (their sound is the silent copy while the app voices). */
export async function lockedReadPushes(watch: string | null | undefined, now = Date.now()) {
  if (!watch || Platform.OS !== 'ios') return;
  let shown: Shown[] = [];
  try {
    const list = await Notifications.getPresentedNotificationsAsync();
    shown = list.map((n) => ({ id: n.request.identifier, date: typeof n.date === 'number' ? n.date : now, title: n.request.content.title, body: n.request.content.body, data: n.request.content.data }));
  } catch { return; }
  for (const p of pushesToSay(shown, { watch, now, said, heard })) {
    heard = { ...heard, [p.id]: 1 };
    said = { ...said, [p.kind]: now };
    speak(p.text, { alert: true, locked: true });
  }
}

/** Speech for one action while the app voices the locked trip: Kylie's clip or the words, in the playback session. */
export function lockedSay(a: { t: string; text?: string; file?: string }) {
  if (a.t === 'clip' && a.file) playClip(a.file, a.text || '', { locked: true });
  else if (a.t === 'say' && a.text) speak(a.text, { alert: true, locked: true });
}

/** Ends it all: no background session, the push's own voice back. Safe any time. */
export async function stopLockedVoice() {
  const was = awakeOn || !!awakeFor || quietOn;
  awakeOn = false; awakeFor = null; voiceSince = null; headphonesAt = null; quietOn = false;
  if (was) await iosNative.stopTripAwake();
}

/** The native side asks for a refresh (background only; the open app has its own 15 s poll). */
export function onLockedWake(cb: () => void): () => void {
  if (!lockedVoiceSupported()) return () => {};
  return iosNative.onTripWake(() => { if (AppState.currentState !== 'active') cb(); });
}

export { LOCKED };
