// Native modules that come with iPhone build 206 and the next Android build: the calendar sheet and speech.
// Builds 201 to 205 and Android versionCode 5 do not have them, and importing the packages there throws at
// once, so each package is loaded only after its native module is found. Everything here is a no-op without it.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { LeaveByEvent } from './leaveByCore';

export function hasCalendar(): boolean {
  if (Platform.OS === 'web') return false;
  try { return !!requireOptionalNativeModule('ExpoCalendar'); } catch { return false; }
}

export function hasSpeech(): boolean {
  if (Platform.OS === 'web') return false;
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
export function speechOptions(hasSession: boolean, done?: () => void) {
  // Builds 206 and earlier have no audio session of their own (the default one stops music and goes quiet in
  // Silent mode), so the system's own speech session is used: it mixes with music and lowers it while talking.
  return hasSession
    ? { language: 'en-AU', useApplicationAudioSession: true, onDone: done, onStopped: done, onError: done }
    : { language: 'en-AU', useApplicationAudioSession: false };
}

/** Says a trip alert out loud (in headphones when they are in). Replaces anything still being said. */
export function speak(text: string) {
  const S = speechModule();
  if (!S || !text) return;
  try {
    // Queued after anything still being said (two moments in one refresh are both heard). The app's own audio
    // session, where there is one, is let go only when the last queued alert is done.
    const a = speechAudio();
    const own = !!a?.start?.();
    if (own) pending++;
    S.speak(text, speechOptions(own, own ? () => { pending = Math.max(0, pending - 1); if (!pending) a?.end?.(); } : undefined));
  } catch {}
}
let pending = 0;
