// The get off alerts (lib/getOffCore.ts) on the phone: local notifications on the trip alerts channel, set for a
// time so they ring with the app closed, rung at once when the moment comes while the app is open, and taken back
// when the trip moves on. expo-notifications is in every build in the field.
// Spoken sounds (30 Oct, build 210): the app cannot speak with the phone locked (no background audio, by design), so
// an alert can ring with a chime and a voice ("Get off at the next stop") as its own sound, bundled in the app by the
// expo-notifications plugin (app.json "sounds"). The phone plays it like any alert sound: muted by Silent mode,
// through headphones when they are in, and through a Focus because the alert is time sensitive.
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';
import { getOffSoundChannel, serverGetOffSupported, serverRungKeys, voiceClipsSupported, type GetOffSound } from './getOffCore';
import { isOn } from './config';

/** The Android channel the trip's own alerts use (live.ts makes it at launch). */
const CHANNEL = 'default';

/** True when this build has the spoken alert sounds and they are not switched off from the server (getOffVoice). */
export function voiceClips(): boolean {
  if (Platform.OS === 'web') return false;
  let build: string | null = null;
  try { build = Application.nativeBuildVersion; } catch {}
  let on = true;
  try { on = isOn('getOffVoice'); } catch {}
  return on && voiceClipsSupported(Platform.OS, build);
}

let channels: Promise<boolean> | null = null;
/** Android: one channel per spoken sound (a channel's sound is fixed once made). Made once, the first time needed. */
export function soundChannels(): Promise<boolean> {
  if (Platform.OS !== 'android') return Promise.resolve(true);
  if (!channels) {
    channels = (async () => {
      for (const [sound, name] of [['getoff_now', 'Get off now, spoken'], ['getoff_soon', 'Stop coming up, spoken']] as [GetOffSound, string][]) {
        await Notifications.setNotificationChannelAsync(getOffSoundChannel(sound), {
          name, importance: Notifications.AndroidImportance.HIGH, sound: `${sound}.wav`, vibrationPattern: [0, 200, 120, 200], lightColor: '#0A84FF',
        });
      }
      return true;
    })().catch(() => { channels = null; return false; });
  }
  return channels;
}

async function put(id: string, at: number | null, title: string, body: string, sound?: GetOffSound) {
  if (Platform.OS === 'web') { (globalThis as any).__alarmLog?.({ id, at, title, body, getOff: 1, ...(sound ? { sound } : {}) }); return true; }
  try {
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted) return false;
    // The spoken sound only on a build that has it; anything going wrong falls back to the normal alert sound.
    const voice = !!sound && voiceClips() && (await soundChannels());
    const channelId = voice && sound ? getOffSoundChannel(sound) : CHANNEL;
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      // Time sensitive (iOS 15 and later) so it breaks through a Focus and lights the screen; a build without the
      // entitlement shows it as a normal alert. Other platforms ignore the field.
      content: { title, body, data: { go: 1, ...(voice ? { voice: 1 } : {}) }, sound: voice && sound ? `${sound}.wav` : true, interruptionLevel: 'timeSensitive' },
      trigger: at == null
        ? (Platform.OS === 'android' ? { channelId } : null)
        : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId } as any,
    });
    return true;
  } catch { return false; }
}

/** Sets (or moves: the same id replaces) the alert for a time. A time already past is not set. */
export async function scheduleGetOff(id: string, at: number, title: string, body: string, sound?: GetOffSound) {
  if (!Number.isFinite(at) || at <= Date.now()) return false;
  return put(id, at, title, body, sound);
}

/** The moment came while the app is open: show it now, unless the phone already showed the set one. */
export async function getOffNow(id: string, title: string, body: string, sound?: GetOffSound) {
  if (Platform.OS !== 'web') {
    try {
      const shown = await Notifications.getPresentedNotificationsAsync();
      if (shown.some((n) => n.request.identifier === id)) return false;
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {}
  }
  return put(id, null, title, body, sound);
}

export async function cancelGetOff(id: string) {
  if (Platform.OS === 'web') { (globalThis as any).__alarmLog?.({ id, cancel: 1, getOff: 1 }); return; }
  try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
}

/** True when this build asks the server for Get off now (build 210+, getOffCore) and the getOffPush flag is on. */
export function serverGetOff(): boolean {
  if (Platform.OS === 'web') return false;
  let build: string | null = null;
  try { build = Application.nativeBuildVersion; } catch {}
  let on = true;
  try { on = isOn('getOffPush'); } catch {}
  return on && serverGetOffSupported(Platform.OS, build);
}

/** The running trip's watch whose Get off now the server sends (push.ts hides that push while the app is open). */
let serverWatch: string | null = null;
export const setServerGetOffWatch = (id: string | null) => { serverWatch = id; };
export const isServerGetOffWatch = (id: unknown) => !!serverWatch && id === serverWatch;

/** The server's Get off now pushes for this watch already shown on the phone (gnow<leg>: 1). */
export async function serverGetOffShown(watchId: string | null): Promise<Record<string, 1>> {
  if (!watchId || Platform.OS === 'web') return {};
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    return serverRungKeys(watchId, shown.map((x) => ({ data: x.request.content.data })));
  } catch { return {}; }
}
