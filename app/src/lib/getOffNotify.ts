// The get off alerts (lib/getOffCore.ts) on the phone: local notifications on the trip alerts channel, set for a
// time so they ring with the app closed, rung at once when the moment comes while the app is open, and taken back
// when the trip moves on. expo-notifications is in every build in the field; nothing native is new.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/** The Android channel the trip's own alerts use (live.ts makes it at launch). */
const CHANNEL = 'default';

async function put(id: string, at: number | null, title: string, body: string) {
  if (Platform.OS === 'web') { (globalThis as any).__alarmLog?.({ id, at, title, body, getOff: 1 }); return true; }
  try {
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted) return false;
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      // Time sensitive (iOS 15 and later) so it breaks through a Focus and lights the screen; a build without the
      // entitlement shows it as a normal alert. Other platforms ignore the field.
      content: { title, body, data: { go: 1 }, sound: true, interruptionLevel: 'timeSensitive' },
      trigger: at == null
        ? (Platform.OS === 'android' ? { channelId: CHANNEL } : null)
        : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL } as any,
    });
    return true;
  } catch { return false; }
}

/** Sets (or moves: the same id replaces) the alert for a time. A time already past is not set. */
export async function scheduleGetOff(id: string, at: number, title: string, body: string) {
  if (!Number.isFinite(at) || at <= Date.now()) return false;
  return put(id, at, title, body);
}

/** The moment came while the app is open: show it now, unless the phone already showed the set one. */
export async function getOffNow(id: string, title: string, body: string) {
  if (Platform.OS !== 'web') {
    try {
      const shown = await Notifications.getPresentedNotificationsAsync();
      if (shown.some((n) => n.request.identifier === id)) return false;
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {}
  }
  return put(id, null, title, body);
}

export async function cancelGetOff(id: string) {
  if (Platform.OS === 'web') { (globalThis as any).__alarmLog?.({ id, cancel: 1, getOff: 1 }); return; }
  try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
}
