import { withTimeout } from './gesture';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, watchClock } from './api';
import { notesWaitMs } from './pollCore';
import { noteKey } from './liveCalc';
import { allowPushTokens } from './forgetTokens';
import { isServerGetOffWatch, tripPushQuiet } from './getOffNotify';
import { ownRungKeys, serverRungKeys } from './getOffCore';
import { noteVerdict, type NoteCtx, type NoteTrip } from './noteShowCore';

Notifications.setNotificationHandler({
  // The ongoing trip notification updates quietly; every other alert shows as a banner with sound. The server's Get
  // off now for the running trip (30 Oct, build 210) is kept in the list only while the app is open: the app rings
  // and reads out its own at that moment, so it is not heard twice (getOffCore server).
  handleNotification: async (n) => {
    const d = (n.request.content.data as any) || {};
    if (d.ongoing || serverGetOffQuiet(d, String(AppState.currentState || ''))) return { shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };
    // The running trip's "Next stop" push with its spoken sound while the app is open and reading it out (31 Oct): shown
    // without the sound, so the moment is not heard twice.
    if (tripPushQuiet(d.watch, (n.request.content as any).sound, String(AppState.currentState || ''))) return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };
    return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
  },
});

/** The server's Get off now for the running trip's watch, with the app in front (push.ts handler). */
export function serverGetOffQuiet(d: any, appState: string): boolean {
  return appState === 'active' && d && d.getOff != null && isServerGetOffWatch(d.watch);
}

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
    // Without a push service on the phone (an Android build with no Firebase project yet) the token call can
    // wait for ever, so it gets 10 seconds; alerts then show while the app is open.
    const tok = await withTimeout(Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined), 10000, null);
    if (!tok) return { status: 'local', detail: 'No push token' };
    const { data } = tok;
    await api.registerExpo(data, Platform.OS, welcome);
    await AsyncStorage.setItem('expoPushToken', data);
    await allowPushTokens();
    tokenKnown = true;
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
  tokenKnown = false;
}

let tokenKnown: boolean | null = null;
let lastPollAt = 0;
/**
 * The app-wide alerts timer (every 20 seconds while the app is in front, never in the background). With a push
 * token, push brings each alert, so the server is asked only once a minute to catch a missed one; without one
 * (alerts only arrive this way) every tick asks.
 */
export async function pollNotesTick(): Promise<boolean> {
  if (tokenKnown == null) { try { tokenKnown = !!(await AsyncStorage.getItem('expoPushToken')); } catch { tokenKnown = false; } }
  // A watch started since the last ask counts as watching at once (api.watch stamps watchClock).
  const watching = watchingNow || watchClock.startedAt >= lastPollAt;
  if (Date.now() - lastPollAt < notesWaitMs(!!tokenKnown, watching)) return true;
  lastPollAt = Date.now();
  await pollNotes();
  return true;
}

/** Whether the server's last answer listed a watch for this phone (true until the first answer). */
let watchingNow = true;
/** Watches ended on this phone (a live trip that arrived): their late alerts are never shown. */
export const endedWatches = new Set<string>();
let lastId: number | null = null;
let polling: Promise<any> | null = null;
let shown: string[] | null = null;
/**
 * While the app is open, shows alerts the server wrote for this phone that push did not already deliver.
 * One poll at a time, so two timers never show the same alert twice. Alerts about the same stop on the same
 * trip ("Next stop: Kings Cross", "Arriving at Kings Cross in 2 min") show once, and a newer alert for that
 * trip replaces the older notification instead of stacking.
 */
export function pollNotes() {
  if (!polling) polling = pollOnce().finally(() => { polling = null; });
  return polling;
}
async function pollOnce() {
  try {
    if (shown == null) { try { shown = JSON.parse((await AsyncStorage.getItem('shownNoteKeys')) || '[]'); } catch { shown = []; } }
    if (lastId == null) {
      const saved = await AsyncStorage.getItem('lastNoteId');
      if (saved) lastId = Number(saved);
    }
    const r = await api.watches(lastId || 0);
    watchingNow = Array.isArray(r?.items) ? r.items.length > 0 : true;
    const notes = (r.notes || []).slice().sort((a, b) => a.id - b.id);
    if (lastId == null) {
      // First run on this phone: do not replay old alerts.
      lastId = notes.length ? notes[notes.length - 1].id : 0;
    } else {
      const hasToken = !!(await AsyncStorage.getItem('expoPushToken'));
      const fresh = notes.filter((x) => x.id > (lastId || 0));
      // Found when the app opens, an alert whose moment has passed is kept as seen, quietly (31 Oct, Bidur on build
      // 210: "Leave now", "Arriving in 2 min" and "You've arrived" all at once on opening the app after arriving).
      const ctx = fresh.length ? await noteCtx(r) : null;
      for (const n of fresh) {
        const k = noteKey(n);
        if ((!hasToken || !n.pushed) && !shown!.includes(k.key) && !(n.watch_id && endedWatches.has(n.watch_id))) {
          shown!.push(k.key);
          if (ctx && noteVerdict(n, ctx).show) {
            await Notifications.scheduleNotificationAsync({ identifier: k.id, content: { title: n.title, body: n.body, data: { url: n.url, watch: n.watch_id } }, trigger: Platform.OS === 'android' ? { channelId: 'default' } : null });
          }
        }
        lastId = Math.max(lastId || 0, n.id);
      }
    }
    await AsyncStorage.setItem('lastNoteId', String(lastId));
    if (shown!.length > 200) shown = shown!.slice(-200);
    await AsyncStorage.setItem('shownNoteKeys', JSON.stringify(shown));
    return r;
  } catch {
    return null;
  }
}

/**
 * What the alert check needs (noteShowCore): both clocks, the trip running on this phone (read from its saved record,
 * so it is known at the first ask after launch, before the trip screen runs) and its get off alerts already shown.
 */
async function noteCtx(r: any): Promise<NoteCtx> {
  const now = Date.now();
  let trip: NoteTrip | null = null;
  try {
    const g = JSON.parse((await AsyncStorage.getItem('liveTrip')) || 'null');
    if (g && g.id) trip = { id: String(g.id), watchId: g.watchId || null, started: Number(g.started) || 0, arrivedAt: g.arrivedAt || null };
  } catch {}
  let offShown: Record<string, 1> = {};
  if (trip && Platform.OS !== 'web') {
    try {
      const shownNow = await Notifications.getPresentedNotificationsAsync();
      offShown = { ...serverRungKeys(trip.watchId, shownNow.map((x) => ({ data: x.request.content.data }))), ...ownRungKeys(trip.id, shownNow.map((x) => x.request.identifier)) };
    } catch {}
  }
  return { now, serverNow: Number(r?.now) || null, trip, offShown };
}
