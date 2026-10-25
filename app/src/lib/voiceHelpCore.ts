// Get a better voice (Bidur, 25 Oct 9:51 PM: finding the voice download in phone settings is hard work).
// Pure logic with no React Native import, so the tests run it in Node: how good the installed voice is, whether a
// better one turned up after a visit to Settings, the one time prompt on Speak, the iPhone steps and the Android
// settings to try in order. iPhone has no public link to its voice settings, so it gets steps and Open Settings.
import { rankVoices, type RankedVoice, type VoiceInfo, type VoiceTier } from './voiceCore';

/** none: the phone answered no English voice; basic: only compact (Default) voices; good: an Enhanced or Premium one. */
export type VoiceQuality = 'none' | 'basic' | 'good';

export function voiceQuality(list: VoiceInfo[] | null | undefined): VoiceQuality {
  const r = rankVoices(list);
  if (!r.length) return 'none';
  return r[0].tier === 'Default' ? 'basic' : 'good';
}

const TIER: Record<VoiceTier, number> = { Premium: 0, Enhanced: 1, Default: 2 };

/**
 * After a visit to Settings: the best voice that was not there before and is at least as good as the best one
 * before it, never a compact one. Null when nothing better came (a download can still be running).
 */
export function betterVoiceFound(before: VoiceInfo[] | null | undefined, after: VoiceInfo[] | null | undefined): RankedVoice | null {
  const had = new Set((before || []).map((v) => v && v.identifier));
  const old = rankVoices(before)[0];
  const top = old ? TIER[old.tier] : TIER.Default;
  return rankVoices(after).find((v) => !had.has(v.identifier) && v.tier !== 'Default' && TIER[v.tier] <= top) || null;
}

/**
 * The gentle prompt on a Speak button: once ever, only when the phone can speak and has nothing but its basic voice.
 * `seen` is set the moment it shows, so a dismiss (or leaving the app with it open) means never again.
 */
export function shouldOfferVoiceHelp(o: { list: VoiceInfo[] | null | undefined; seen: boolean; canSpeak: boolean }): boolean {
  return !!o.canSpeak && !o.seen && voiceQuality(o.list) === 'basic';
}

/** The name of the iPhone settings page with Voices: Read & Speak from iOS 26, Spoken Content before. */
export function iosSpeechPage(version: string | number | null | undefined): string {
  const major = parseInt(String(version ?? ''), 10);
  return Number.isFinite(major) && major > 0 && major < 26 ? 'Spoken Content' : 'Read & Speak';
}

export type HelpStep = { icon: 'gear' | 'list' | 'download'; text: string; a11y: string };

/** Three plain steps to a Premium or Enhanced voice on iPhone. */
export function iosVoiceSteps(version: string | number | null | undefined): HelpStep[] {
  const page = iosSpeechPage(version);
  const said = page.replace('&', 'and');
  return [
    { icon: 'gear', text: 'Open Settings, then tap Accessibility.', a11y: 'Step 1. Open Settings, then tap Accessibility.' },
    { icon: 'list', text: `Tap ${page}, then Voices, then English.`, a11y: `Step 2. Tap ${said}, then Voices, then English.` },
    { icon: 'download', text: 'Pick a voice marked Premium or Enhanced and tap download.', a11y: 'Step 3. Pick a voice marked Premium or Enhanced and tap download.' },
  ];
}

/** Android screens to try, in order: text to speech output, then Accessibility. The app's own settings come last. */
export const ANDROID_TTS = ['com.android.settings.TTS_SETTINGS', 'android.settings.ACCESSIBILITY_SETTINGS'] as const;
/** The speech engine's own voice download screen (the engine may not offer it; then text to speech output opens). */
export const ANDROID_TTS_DATA = 'android.speech.tts.engine.INSTALL_TTS_DATA';

/** Runs each opener until one works; the index of the one that opened, or -1 when none did. */
export async function openFirst(tries: (() => unknown)[]): Promise<number> {
  for (let i = 0; i < tries.length; i++) {
    try { await tries[i](); return i; } catch {}
  }
  return -1;
}

/** The Voice row's second line. */
export function voiceRowSub(q: VoiceQuality | null, os: string): string {
  if (q === 'basic') return 'Your phone only has its basic voice. A clearer one is a free download.';
  if (q === 'good') return 'You have a natural voice. You can add more in your phone settings.';
  return os === 'android' ? 'Opens your phone\'s text to speech settings.' : 'Three short steps in Settings.';
}
