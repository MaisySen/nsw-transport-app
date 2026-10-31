// The get off alerts (lib/getOffCore.ts) on the phone: local notifications on the trip alerts channel, set for a
// time so they ring with the app closed, rung at once when the moment comes while the app is open, and taken back
// when the trip moves on. expo-notifications is in every build in the field.
// Spoken sounds (30 Oct, build 210): the app cannot speak with the phone locked (no background audio, by design), so
// an alert can ring with a chime and a voice ("Please get off at the next stop", Kylie, chosen by the owner 31 Oct) as its own sound, bundled in the app by the
// expo-notifications plugin (app.json "sounds"). The phone plays it like any alert sound: muted by Silent mode (where it
// still vibrates: every get off alert has a sound, the normal one when not spoken, so iOS gives its buzz on Silent),
// through headphones when they are in, and through a Focus because the alert is time sensitive. No Critical Alerts
// entitlement (Apple grants it for health and safety apps, not transit): Silent mode is the rider's choice.
// Since 31 Oct nothing here is set for a time to say "get off": the phone's own backup is a location alert
// (scheduleRegion, build 211+) or, without location, a quiet note (scheduleQuiet).
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';
import { backupOf, getOffSoundChannel, getOffTrigger, ownRungKeys, staleRegionIds, tripPushSoundless, serverGetOffSupported, serverRungKeys, voiceClipsSupported, type GetOffBackup, type GetOffSound } from './getOffCore';
import { isOn } from './config';
import { iosNative } from '../../modules/transport-ios';

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

/** Android: the quiet note's channel (31 Oct): shown in the list, no sound, no vibration. Made once. */
const QUIET_CHANNEL = 'getoff_quiet';
let quietCh: Promise<boolean> | null = null;
function quietChannel(): Promise<boolean> {
  if (Platform.OS !== 'android') return Promise.resolve(true);
  if (!quietCh) {
    quietCh = Notifications.setNotificationChannelAsync(QUIET_CHANNEL, {
      name: 'Stop coming up, quiet', importance: Notifications.AndroidImportance.LOW, sound: null, enableVibrate: false,
    }).then(() => true).catch(() => { quietCh = null; return false; });
  }
  return quietCh;
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
      trigger: getOffTrigger(Platform.OS, at, Date.now(), channelId) as any,
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

/**
 * The quiet note (31 Oct, no location): no sound, not time sensitive (it never breaks through a Focus), never "get
 * off". A time already past is not set.
 */
export async function scheduleQuiet(id: string, at: number, title: string, body: string) {
  if (!Number.isFinite(at) || at <= Date.now()) return false;
  if (Platform.OS === 'web') { (globalThis as any).__alarmLog?.({ id, at, title, body, getOff: 1, quiet: 1 }); return true; }
  try {
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted) return false;
    // Android: its own channel with no sound and no buzz (a channel's sound is fixed once made; the trip alerts channel rings).
    const ch = Platform.OS === 'android' ? ((await quietChannel()) ? QUIET_CHANNEL : CHANNEL) : CHANNEL;
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title, body, data: { go: 1, quiet: 1 }, sound: false, interruptionLevel: 'active' },
      trigger: getOffTrigger(Platform.OS, at, Date.now(), ch) as any,
    });
    return true;
  } catch { return false; }
}

/**
 * What the phone's backup can use now: `region` (location alerts: build 211 and later, location allowed, precise),
 * else `quiet`. Read each refresh, so turning location on or off in Settings takes effect at the next open.
 */
export function getOffBackup(): GetOffBackup {
  if (Platform.OS !== 'ios') return 'quiet';
  return backupOf(iosNative.hasRegionAlerts(), iosNative.regionAlertStatus());
}

/** Sets a location alert (iOS, build 211+): rings once on entering the circle, with the app closed or the phone locked.
 * Time sensitive, with the spoken sound when it has one (a build without the sound plays the normal one). */
export async function scheduleRegion(id: string, lat: number, lon: number, radius: number, title: string, body: string, sound?: GetOffSound) {
  if (Platform.OS === 'web') { (globalThis as any).__alarmLog?.({ id, region: { lat, lon, radius }, title, body, getOff: 1, ...(sound ? { sound } : {}) }); return true; }
  try {
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted) return false;
    const voice = !!sound && voiceClips();
    return await iosNative.scheduleRegionAlert(id, title, body, lat, lon, radius, voice && sound ? `${sound}.wav` : null, { go: 1, region: 1, ...(voice ? { voice: 1 } : {}) });
  } catch { return false; }
}

/** This trip's own get off alerts already shown on the phone (a location alert that rang, a quiet note). */
export async function ownGetOffShown(gid: string): Promise<Record<string, 1>> {
  if (Platform.OS === 'web') return {};
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    return ownRungKeys(gid, shown.map((x) => x.request.identifier));
  } catch { return {}; }
}

/** Location alerts left waiting by a trip that is no longer running (given up without opening the app): taken back at
 * every refresh and at launch, so "Get off now" never rings near that stop another day. */
export async function sweepRegions(liveGid: string | null) {
  if (Platform.OS !== 'ios' || !iosNative.hasRegionAlerts()) return;
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    for (const id of staleRegionIds(pending.map((x) => x.identifier), liveGid)) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  } catch {}
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

/** The running trip's watch and whether the app reads its moments out (Speak alerts, with speech): liveEngine sets it. */
let tripWatch: string | null = null;
let tripSpeaks = false;
export const setTripWatch = (id: string | null, speaks: boolean) => { tripWatch = id; tripSpeaks = !!id && speaks; };
/** push.ts: this push is the running trip's, rings with a spoken sound, and the app is saying the same thing now. */
export const tripPushQuiet = (watch: unknown, sound: unknown, appState: string) => tripPushSoundless({ watch, sound, appState, tripWatch, speaks: tripSpeaks });
