// Get a better voice: opening the phone's voice settings, the one time prompt on Speak, and the check for a new
// voice when the person comes back from Settings. Logic is in voiceHelpCore.ts. Nothing here is a new native
// module: Linking is part of React Native, and every call is looked up first.
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { api } from './api';
import { hasSpeech, loadVoices, reloadVoices, speak } from './nativeExtras';
import { store } from './store';
import { ANDROID_TTS, ANDROID_TTS_DATA, betterVoiceFound, openFirst, shouldOfferVoiceHelp } from './voiceHelpCore';
import { rankVoices, sampleSentence, type RankedVoice, type VoiceInfo } from './voiceCore';

const send = (action: string) => () => {
  const f = (Linking as any).sendIntent;
  if (typeof f !== 'function') throw new Error('no sendIntent');
  return f(action);
};
const appSettings = () => Linking.openSettings();

/** Android: text to speech output, else Accessibility, else this app's settings. iPhone: this app's settings page
 * (the only settings link Apple allows; there is no public link to the voice list). */
export function openVoiceSettings(): Promise<number> {
  if (Platform.OS === 'android') return openFirst([...ANDROID_TTS.map(send), appSettings]);
  if (Platform.OS === 'ios') return openFirst([appSettings]);
  return Promise.resolve(-1);
}

/** Android: the speech engine's voice download screen, else the same chain as openVoiceSettings. */
export function openVoiceDownload(): Promise<number> {
  if (Platform.OS !== 'android') return openVoiceSettings();
  return openFirst([send(ANDROID_TTS_DATA), ...ANDROID_TTS.map(send), appSettings]);
}

/** The Voice sample from live data: the next service from this stop (home or a starred stop), as the board has it. */
export async function liveSampleFor(stop: { id: string; name: string } | null | undefined): Promise<string> {
  if (stop) {
    try { const r = await api.departures(stop.id); const t = sampleSentence(r.items, Date.now(), r.stop?.name || stop.name); if (t) return t; } catch {}
  }
  return sampleSentence(null, Date.now(), stop?.name);
}

/**
 * After a tap on Open Settings: when the app is active again, the voices are read afresh and compared with the ones
 * before. `found` is the new voice, `missed` is true when the person came back and nothing new was there yet.
 */
export function useVoiceReturn(onFound?: (v: RankedVoice) => void) {
  const before = useRef<VoiceInfo[] | null>(null);
  const armed = useRef(false);
  const [found, setFound] = useState<RankedVoice | null>(null);
  const [missed, setMissed] = useState(false);
  const cb = useRef(onFound);
  cb.current = onFound;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' || !armed.current) return;
      armed.current = false;
      reloadVoices().then((after) => {
        const v = betterVoiceFound(before.current, after);
        if (v) { setFound(v); setMissed(false); cb.current?.(v); } else setMissed(true);
      }).catch(() => {});
    });
    return () => sub.remove();
  }, []);
  /** Call just before leaving for Settings. */
  const arm = async () => {
    try { before.current = await loadVoices(); } catch { before.current = []; }
    armed.current = true;
    setMissed(false);
  };
  return { arm, found, missed };
}

/** The English voices read afresh, best first (after Settings, a downloaded voice is in the list). */
export async function englishVoicesFresh(): Promise<RankedVoice[]> { return rankVoices(await reloadVoices()); }

/** Plays the live sample in the voice just found. */
export async function playFound(v: RankedVoice, stop?: { id: string; name: string } | null) {
  const text = await liveSampleFor(stop);
  speak(text, { interrupt: true, voice: v.identifier });
}

/** True once: the first Speak tap on a phone with only its basic voice. Marks it seen as it answers true. */
export async function takeVoicePrompt(): Promise<boolean> {
  try {
    if (store.voiceHelpSeen()) return false;
    const ok = shouldOfferVoiceHelp({ list: await loadVoices(), seen: store.voiceHelpSeen(), canSpeak: hasSpeech() });
    if (ok) store.setVoiceHelpSeen();
    return ok;
  } catch { return false; }
}
