import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

Notifications.setNotificationHandler({
  // The ongoing trip notification updates quietly; every other alert shows as a banner with sound.
  handleNotification: async (n) => ((n.request.content.data as any)?.ongoing
    ? { shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }
    : { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export type PushState = { status: 'on' | 'off' | 'denied' | 'local'; detail?: string };

async function channel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Trip alerts', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 200, 120, 200], lightColor: '#0A84FF',
    });
  }
}

export async function getPushState(): Promise<PushState> {
  const p = await Notifications.getPermissionsAsync();
  if (!p.granted) return { status: p.canAskAgain ? 'off' : 'denied' };
  const tok = await AsyncStorage.getItem('expoPushToken');
  return tok ? { status: 'on' } : { status: 'local' };
}

/**
 * Asks for permission, then tries to get an Expo push token so the server can reach this phone
 * even when the app is closed. If a token is not available (for example an Android build with no
 * Firebase project yet), alerts still arrive as local notifications while the app is running.
 */
export async function enablePush(welcome = true): Promise<PushState> {
  await channel();
  let p = await Notifications.getPermissionsAsync();
  if (!p.granted) p = await Notifications.requestPermissionsAsync();
  if (!p.granted) return { status: 'denied' };
  if (!Device.isDevice) return { status: 'local', detail: 'Simulator' };
  try {
    const projectId = (Constants.expoConfig as any)?.extra?.eas?.projectId || (Constants as any).easConfig?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api.registerExpo(data, Platform.OS, welcome);
    await AsyncStorage.setItem('expoPushToken', data);
    return { status: 'on' };
  } catch (e: any) {
    return { status: 'local', detail: String(e?.message || e) };
  }
}

/** Added to "alert set" messages while this phone has no push token, so nobody counts on alerts with the app closed. */
export async function appOpenNote(): Promise<string> {
  try { return (await AsyncStorage.getItem('expoPushToken')) ? '' : ' Alerts need the app open.'; } catch { return ''; }
}

export async function disablePush() {
  const tok = await AsyncStorage.getItem('expoPushToken');
  if (tok) await api.unregisterExpo(tok).catch(() => {});
  await AsyncStorage.removeItem('expoPushToken');
}

let lastId: number | null = null;
/** While the app is open, shows alerts the server wrote for this phone that push did not already deliver. */
export async function pollNotes() {
  try {
    if (lastId == null) {
      const saved = await AsyncStorage.getItem('lastNoteId');
      if (saved) lastId = Number(saved);
    }
    const r = await api.watches(lastId || 0);
    const notes = (r.notes || []).slice().sort((a, b) => a.id - b.id);
    if (lastId == null) {
      // First run on this phone: do not replay old alerts.
      lastId = notes.length ? notes[notes.length - 1].id : 0;
    } else {
      const hasToken = !!(await AsyncStorage.getItem('expoPushToken'));
      for (const n of notes.filter((x) => x.id > (lastId || 0))) {
        if (!hasToken || !n.pushed) {
          await Notifications.scheduleNotificationAsync({ content: { title: n.title, body: n.body, data: { url: n.url, watch: n.watch_id } }, trigger: null });
        }
        lastId = Math.max(lastId || 0, n.id);
      }
    }
    await AsyncStorage.setItem('lastNoteId', String(lastId));
    return r;
  } catch {
    return null;
  }
}
