// Phone side alarms for the "it just knows" features: Wake me before my stop, and the Remind me leave alert.
// Both are scheduled on the phone, so they ring with the app closed.
import { Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';

export const WAKE_CHANNEL = 'wake-up';
/** Long, strong buzzes: hard to sleep through. */
export const WAKE_BUZZ = [0, 900, 300, 900, 300, 900, 300, 900];
const LEAVE_CHANNEL = 'leave-now';
export const LEAVE_ID = 'leave-reminder';

let ready: Promise<void> | null = null;
/** Android channels for the alarms. Channel settings are fixed once made, so these have their own ids. */
export function setupSmartChannels() {
  if (!ready) ready = (async () => {
    if (Platform.OS !== 'android') return;
    try {
      await Notifications.setNotificationChannelAsync(WAKE_CHANNEL, {
        name: 'Wake me before my stop', description: 'A strong buzz one stop before you get off',
        importance: Notifications.AndroidImportance.MAX, vibrationPattern: WAKE_BUZZ, enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC, lightColor: '#0A84FF',
      });
      await Notifications.setNotificationChannelAsync(LEAVE_CHANNEL, {
        name: 'Leave now reminders', description: 'When to leave for your commute',
        importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 300, 150, 300], enableVibrate: true,
      });
    } catch {}
  })();
  return ready;
}

/** Asks for notifications if never asked. True when alarms can show. */
export async function canNotify(ask: boolean) {
  if (Platform.OS === 'web') return true;
  try {
    let p = await Notifications.getPermissionsAsync();
    if (!p.granted && ask && p.canAskAgain) p = await Notifications.requestPermissionsAsync();
    return !!p.granted;
  } catch { return false; }
}

async function schedule(id: string, at: number | null, title: string, body: string, channelId: string, data: Record<string, any>) {
  if (Platform.OS === 'web') { (globalThis as any).__alarmLog?.({ id, at, title, body }); return true; }
  try {
    await setupSmartChannels();
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title, body, data, sound: true, priority: Notifications.AndroidNotificationPriority.MAX, vibrate: channelId === WAKE_CHANNEL ? WAKE_BUZZ : undefined },
      trigger: at == null
        ? (Platform.OS === 'android' ? { channelId } : null)
        : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId, delivery: 'alarmClock' } as any,
    });
    return true;
  } catch { return false; }
}

export const scheduleWake = (id: string, at: number, title: string, body: string) => schedule(id, at, title, body, WAKE_CHANNEL, { go: 1, wake: 1 });

/** The wake time came while the app was open: ring now unless the phone's alarm already rang. */
export async function wakeNow(id: string, title: string, body: string) {
  if (Platform.OS !== 'web') {
    try {
      const shown = await Notifications.getPresentedNotificationsAsync();
      if (shown.some((n) => n.request.identifier === id)) return false;
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {}
    Vibration.vibrate(WAKE_BUZZ);
  }
  return schedule(id, null, title, body, WAKE_CHANNEL, { go: 1, wake: 1 });
}

export async function cancelWake(id: string) {
  if (Platform.OS === 'web') { (globalThis as any).__alarmLog?.({ id, cancel: 1 }); return; }
  try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
}

/** Remind me: one leave now alert at the leave time. A new reminder replaces the old one. */
export const scheduleLeave = (at: number, title: string, body: string) => schedule(LEAVE_ID, at, title, body, LEAVE_CHANNEL, { home: 1 });
export async function cancelLeave() {
  if (Platform.OS === 'web') return;
  try { await Notifications.cancelScheduledNotificationAsync(LEAVE_ID); } catch {}
}
