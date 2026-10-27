// Native modules that come with iPhone build 206 and the next Android build: the calendar sheet and speech.
// Builds 201 to 205 and Android versionCode 5 do not have them, and importing the packages there throws at
// once, so each package is loaded only after its native module is found. Everything here is a no-op without it.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { LeaveByEvent } from './leaveByCore';
import { store } from './store';
import { pickVoice, rankVoices, speechPace, type RankedVoice, type VoiceInfo } from './voiceCore';

export function hasCalendar(): boolean {
  if (Platform.OS === 'web') return false;
  try { return !!requireOptionalNativeModule('ExpoCalendar'); } catch { return false; }
}

export function hasSpeech(): boolean {
  // The web preview speaks through the browser's own speech (expo-speech's web side), where there is one.
  if (Platform.OS === 'web') return typeof window !== 'undefined' && !!(window as any).speechSynthesis;
  try { return !!requireOptionalNativeModule('ExpoSpeech'); } catch { return false; }
}

// The new event sheet is in expo-calendar's legacy API (native module ExpoCalendar); the root export throws for it.
function calendarModule(): any | null {
  if (!hasCalendar()) return null;
  try { return require('expo-calendar/legacy'); } catch { return null; }
}

// Add only access is asked through the current API (native module CalendarNext), which takes writeOnly.
function calendarAccess(): ((writeOnly: boolean) => Promise<{ granted?: boolean }>) | null {
  try {
    if (!requireOptionalNativeModule('CalendarNext')) return null;
    const ask = require('expo-calendar').requestCalendarPermissions;
    return typeof ask === 'function' ? ask : null;
  } catch { return null; }
}

function speechModule(): any | null {
  if (!hasSpeech()) return null;
  try { return require('expo-speech'); } catch { return null; }
}

/**
 * Opens the system's new event sheet filled in with the trip. Nothing is saved until the person taps Add. On iOS 17
 * the sheet needs no calendar access; if the system still refuses, it asks once for add only access (never read
 * access) and tries again. Returns false when this build has no calendar module or the person says no.
 */
export async function addToCalendar(ev: LeaveByEvent): Promise<boolean> {
  const C = calendarModule();
  if (!C || typeof C.createEventInCalendarAsync !== 'function') return false;
  const open = () => C.createEventInCalendarAsync({
    title: ev.title, startDate: ev.startDate, endDate: ev.endDate, notes: ev.notes, alarms: ev.alarms,
    timeZone: 'Australia/Sydney', ...(ev.location ? { location: ev.location } : {}),
  });
  try {
    await open();
    return true;
  } catch {
    try {
      // Add only access (writeOnly true); the full access request is never made, so its Info.plist string is not needed.
      const ask = calendarAccess();
      if (!ask) return false;
      const r = await ask(true);
      if (!r?.granted) return false;
      await open();
      return true;
    } catch {
      return false;
    }
  }
}

/** From build 207: a spoken audio session (plays in Silent mode, lowers music while it talks). Absent before. */
function speechAudio(): { start?: () => boolean; end?: () => void } | null {
  if (Platform.OS !== 'ios') return null;
  try {
    const m: any = requireOptionalNativeModule('TransportIOS');
    return m && typeof m.startSpeechAudio === 'function' ? { start: () => !!m.startSpeechAudio(), end: () => { try { m.endSpeechAudio?.(); } catch {} } } : null;
  } catch { return null; }
}

/** True on builds with the app's own spoken audio session (207 and later). */
export function hasSpeechSession(): boolean { return !!speechAudio(); }

/** How speak() asks for audio: the app's own spoken session on builds that have one, else a session the system runs. */
export function speechOptions(hasSession: boolean, done?: () => void, voice?: string | null, os: string = Platform.OS) {
  // Builds 206 and earlier have no audio session of their own (the default one stops music and goes quiet in
  // Silent mode), so the system's own speech session is used: it mixes with music and lowers it while talking.
  // Every call names the voice (the best installed one, or the one picked in More > Voice) and a natural pace;
  // without a voice the system falls back to its compact voice, which is the robotic one.
  const pace = speechPace(os);
  const base = { language: 'en-AU', rate: pace.rate, pitch: pace.pitch, ...(voice ? { voice } : {}) };
  return hasSession
    ? { ...base, useApplicationAudioSession: true, onDone: done, onStopped: done, onError: done }
    : { ...base, useApplicationAudioSession: false };
}

// ---------- the installed voices (read once per app run) ----------

let voiceList: VoiceInfo[] | null = null;
let voiceLoad: Promise<VoiceInfo[]> | null = null;

/** The installed voices. iOS can answer an empty list on the very first ask, so an empty answer is asked once more. */
export function loadVoices(): Promise<VoiceInfo[]> {
  if (voiceList && voiceList.length) return Promise.resolve(voiceList);
  if (voiceLoad) return voiceLoad;
  const S = speechModule();
  if (!S || typeof S.getAvailableVoicesAsync !== 'function') return Promise.resolve([]);
  const ask = async (): Promise<VoiceInfo[]> => { try { return ((await S.getAvailableVoicesAsync()) || []) as VoiceInfo[]; } catch { return []; } };
  voiceLoad = (async () => {
    let v = await ask();
    if (!v.length) { await new Promise((r) => setTimeout(r, 400)); v = await ask(); }
    voiceList = v;
    voiceLoad = null;
    return v;
  })();
  return voiceLoad;
}

/** Reads the installed voices again (back from Settings, where a voice may have been downloaded). */
export function reloadVoices(): Promise<VoiceInfo[]> {
  voiceList = null;
  return loadVoices();
}

/** English voices installed on this phone, best first (voiceCore.rankVoices). */
export async function englishVoices(): Promise<RankedVoice[]> { return rankVoices(await loadVoices()); }

/** The voice every speech call uses: the one picked in More > Voice if still installed, else the best installed
 * one (Premium, Enhanced, Default; en-AU, en-GB, en-US). */
export async function currentVoice(): Promise<RankedVoice | null> {
  let chosen: string | null = null;
  try { chosen = store.voiceId(); } catch {}
  return pickVoice(await loadVoices(), chosen);
}

/**
 * The one way the app speaks: trip alerts, trip guidance, Speak departures and the Voice sample all come here, so
 * each uses the same best voice and pace. Queued after anything still being said unless `interrupt` (a button the
 * person pressed: what they asked for now replaces what was being said). `quiet`: said through the system's own
 * speech session, not the app's (207 and later), so Silent mode mutes it like any other sound (spoken Get off now
 * with Speak alerts off; the rider never chose to hear it in Silent mode).
 */
export async function speak(text: string, opts: { interrupt?: boolean; voice?: string | null; quiet?: boolean } = {}) {
  const S = speechModule();
  if (!S || !text) return;
  let voice: string | null = null;
  try { voice = opts.voice || (await currentVoice())?.identifier || null; } catch {}
  try {
    if (opts.interrupt) { try { S.stop(); } catch {} }
    // Queued after anything still being said (two moments in one refresh are both heard). The app's own audio
    // session, where there is one, is let go only when the last queued alert is done.
    const a = speechAudio();
    const own = !opts.quiet && !!a?.start?.();
    if (own) pending++;
    const done = own ? () => { pending = Math.max(0, pending - 1); if (!pending) a?.end?.(); } : undefined;
    try { S.speak(text, speechOptions(own, done, voice)); }
    catch { if (voice) S.speak(text, speechOptions(own, done, null)); else throw new Error('speak'); }
  } catch {}
}
let pending = 0;

/** Stops anything being said (the Speak departures button pressed again). */
export function stopSpeaking() { try { speechModule()?.stop(); } catch {} }
