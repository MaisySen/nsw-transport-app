// The trip you are on now: one at a time, kept on this phone. Started from a trip's Start trip button.
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { api } from './api';
import { enablePush, getPushState } from './push';
import type { Fare, Place, WatchLeg } from './types';
import type { WatchSpec } from './watch';
import { wakeId } from './smart';
import { getOffId, readGetOff, readGetOffSay } from './getOffCore';
import { cancelGetOff, serverGetOff, setServerGetOffWatch, soundChannels, voiceClips } from './getOffNotify';
import { cancelWake } from './smartNotify';
import { iosNative } from '../../modules/transport-ios';
import { wantOngoing } from './leaveByCore';
import { store } from './store';
import { hasSpeech } from './nativeExtras';

export type LiveShare = { id: string; key: string; url: string; pos: boolean };
export type LiveTrip = {
  id: string; title: string; origin: Place | null; to: Place | null; legs: WatchLeg[]; fare: Fare | null; started: number;
  alerted: Record<string, 1>; share: LiveShare | null; watchId: string | null; loc?: boolean;
  /** Arrival time of each leg while it was being ridden, and when the trip arrived. See LiveMemo. */
  rode?: Record<number, number>; arrivedAt?: number | null;
  /** When you got off each leg, by your tap or your location (LiveMemo.here). */
  here?: Record<number, number>;
  /** Wake me before my stop: on, and when each leg's alarm is set for (leg index to time). */
  wake?: boolean; wakeSet?: Record<string, number>;
  /** Get off alerts (getOffCore.ts) set on the phone: alert key to the time it is set for. */
  offSet?: Record<string, number>;
  /** Get off alerts set on the phone with a spoken sound (getOffCore offVoice): already said when they ring. */
  offVoice?: Record<string, 1>;
  /** The server sends Get off now for this trip (build 210; its watch said getOff: true): not set on the phone. */
  offServer?: boolean;
  /** Say trip alerts out loud (builds with the speech module), and the alerts already read out. */
  speak?: boolean; spoken?: Record<string, 1>;
};

const KEY = 'liveTrip';
const NOTE = 'live-trip';
let cur: LiveTrip | null = null;
let loaded = false;
const subs = new Set<() => void>();

async function load() {
  if (loaded) return;
  loaded = true;
  try { const raw = await AsyncStorage.getItem(KEY); if (raw) cur = JSON.parse(raw); } catch {}
  subs.forEach((f) => f());
}
export function setLive(g: LiveTrip | null) {
  cur = g;
  if (g) AsyncStorage.setItem(KEY, JSON.stringify(g)).catch(() => {});
  else AsyncStorage.removeItem(KEY).catch(() => {});
  subs.forEach((f) => f());
}
export const getLive = () => cur;
export async function loadLive() { await load(); return cur; }

export function useLiveTrip() {
  useEffect(() => { load(); }, []);
  return useSyncExternalStore((l) => { subs.add(l); return () => subs.delete(l); }, () => cur, () => cur);
}

// Speak alerts stays as you last set it (Settings store), on builds that can speak.
function speakDefault(): boolean {
  try { return store.speakOn() && hasSpeech(); } catch { return false; }
}

/** Starts tracking a planned trip. Starting another trip ends the first. */
export async function startLive(spec: WatchSpec, fare?: Fare | null) {
  await load();
  const legs = spec.legs.filter((l) => l.stopId && l.planned).slice(0, 6);
  if (!legs.length) throw new Error("This trip can't be tracked.");
  if (cur) await endLive();
  const g: LiveTrip = { id: 'g' + Date.now().toString(36), title: spec.title, origin: spec.origin || null, to: spec.to || null, legs, fare: fare && fare.total != null ? fare : null,
    started: Date.now(), alerted: {}, share: null, watchId: null, ...(speakDefault() ? { speak: true } : {}) };
  setLive(g);
  // The ongoing notification starts with the trip: ask for notifications once, if never asked, then let the
  // server follow the trip. This runs after Start trip has returned, so the live trip opens at once and the
  // button never waits on the permission dialog or the network.
  (async () => {
    if (Platform.OS !== 'web') {
      try { const ps = await getPushState(); if (ps.status === 'off') await enablePush(false); } catch {}
    }
    await liveWatch();
  })().catch(() => {});
  return g;
}

/** With notifications on, the server also sends next stop, change and connection alerts while the app is closed. */
export async function liveWatch() {
  const g = cur;
  if (!g || g.watchId || g.arrivedAt) return;
  const ps = await getPushState();
  if (ps.status !== 'on' && ps.status !== 'local') return;
  // voice: this build has the spoken alert sounds and Speak alerts is on, so the server's "Next stop" alert rings with
  // "Your stop is coming up" (heard with the phone locked). Older builds never send it and get the normal sound.
  // Android: the server's alert names the spoken sound's channel, so it is made first (made once).
  const voice = voiceClips() && !!g.speak && (await soundChannels()) ? { voice: 'soon' } : {};
  // Get off now from the server (30 Oct, build 210): with a native push token and Get off now on, the watch asks the
  // server to send it from live times (getOff), with the spoken sound when the phone's own would have it (getOffVoice).
  // Set on the phone at the last open, it rang early when the bus ran late after the phone locked.
  let off = {};
  try {
    if (ps.status === 'on' && serverGetOff() && readGetOff(store.getOff()).now) {
      const say = voiceClips() && (readGetOffSay(store.getOffSay()) || !!g.speak) && (await soundChannels());
      off = { getOff: 1, ...(say ? { getOffVoice: 1 } : {}) };
    }
  } catch { off = {}; }
  const r = await api.watch({ kind: 'trip', title: g.title, legs: g.legs, origin: g.origin, to: g.to, lead: 0, track: true, silentStart: true, ...voice, ...off });
  if (!r.watch?.id) return;
  if (cur && cur.id === g.id && !cur.arrivedAt) {
    // The server said yes: the phone's own Get off now comes off now, before the phone is locked (getOffCore server).
    const server = (r.watch as any).getOff === true && 'getOff' in off;
    const offSet = { ...(cur.offSet || {}) };
    if (server) for (const k of Object.keys(offSet)) if (/^gnow\d+$/.test(k)) { cancelGetOff(getOffId(cur.id, k)).catch(() => {}); delete offSet[k]; }
    if (server) setServerGetOffWatch(r.watch.id);
    setLive({ ...cur, watchId: r.watch.id, ...(server ? { offServer: true, offSet } : { offServer: false }) });
  } else api.stopWatch(r.watch.id).catch(() => {});
}

/** Ends the trip: stops the share link and the server alerts, removes the ongoing notification. */
export async function endLive() {
  const g = cur;
  if (!g) return null;
  if (g.share) api.shareEnd(g.share.id, g.share.key).catch(() => {});
  if (g.watchId) api.stopWatch(g.watchId).catch(() => {});
  // Wake alarms still set for this trip never ring after it ends.
  for (const k of Object.keys(g.wakeSet || {})) cancelWake(wakeId(g.id, Number(k))).catch(() => {});
  for (const k of Object.keys(g.offSet || {})) cancelGetOff(getOffId(g.id, k)).catch(() => {});
  setServerGetOffWatch(null);
  setLive(null);
  await clearOngoing();
  return g;
}

/** Android: a quiet channel for the ongoing trip notification, and its Share and End trip buttons. */
export async function setupLiveNotifications() {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Trip alerts', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 200, 120, 200], lightColor: '#0A84FF',
      });
      await Notifications.setNotificationChannelAsync(NOTE, {
        name: 'Trip in progress', description: 'Next stop and arrival time while you are on a trip',
        importance: Notifications.AndroidImportance.DEFAULT, sound: null, vibrationPattern: [0], enableVibrate: false, showBadge: false,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }
    await Notifications.setNotificationCategoryAsync(NOTE, [
      { identifier: 'share', buttonTitle: 'Share', options: { opensAppToForeground: true } },
      { identifier: 'end', buttonTitle: 'End trip', options: { opensAppToForeground: true, isDestructive: true } },
    ]);
  } catch {}
  await load();
  if (!cur) await clearOngoing();
}

/** Shows or updates the ongoing notification. Only when notifications are allowed. */
export async function showOngoing(title: string, body: string, color?: string | null) {
  try {
    // An iPhone showing the trip's Live Activity needs no second copy in Notification Centre.
    if (!wantOngoing(Platform.OS, iosNative.activitiesEnabled(), iosNative.activityIds().length)) { await clearOngoing(); return; }
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted) return;
    await Notifications.scheduleNotificationAsync({
      identifier: NOTE,
      content: { title, body, sticky: true, autoDismiss: false, sound: false, categoryIdentifier: NOTE, color: color || '#0A84FF',
        priority: Notifications.AndroidNotificationPriority.DEFAULT, data: { go: 1, ongoing: 1 } },
      trigger: Platform.OS === 'android' ? { channelId: NOTE } : null,
    });
  } catch {}
}

export async function clearOngoing() {
  try { await Notifications.dismissNotificationAsync(NOTE); } catch {}
}

/**
 * A one off alert: next stop, change here, connection at risk, you've arrived. The identifier is stable per trip
 * and alert, so showing it again replaces the first one instead of adding a second.
 */
export async function liveAlert(title: string, body: string, identifier?: string) {
  try {
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted) return false;
    await Notifications.scheduleNotificationAsync({ ...(identifier ? { identifier } : {}), content: { title, body, data: { go: 1 } }, trigger: Platform.OS === 'android' ? { channelId: 'default' } : null });
    return true;
  } catch { return false; }
}
