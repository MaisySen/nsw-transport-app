// The trip you are on now: one at a time, kept on this phone. Started from a trip's Start trip button.
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { api } from './api';
import { getPushState } from './push';
import type { Fare, Place, WatchLeg } from './types';
import type { WatchSpec } from './watch';

export type LiveShare = { id: string; key: string; url: string; pos: boolean };
export type LiveTrip = {
  id: string; title: string; origin: Place | null; to: Place | null; legs: WatchLeg[]; fare: Fare | null; started: number;
  alerted: Record<string, 1>; share: LiveShare | null; watchId: string | null; loc?: boolean;
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

/** Starts tracking a planned trip. Starting another trip ends the first. */
export async function startLive(spec: WatchSpec, fare?: Fare | null) {
  await load();
  const legs = spec.legs.filter((l) => l.stopId && l.planned).slice(0, 6);
  if (!legs.length) throw new Error("This trip can't be tracked.");
  if (cur) await endLive();
  const g: LiveTrip = { id: 'g' + Date.now().toString(36), title: spec.title, origin: spec.origin || null, to: spec.to || null, legs, fare: fare && fare.total != null ? fare : null,
    started: Date.now(), alerted: {}, share: null, watchId: null };
  setLive(g);
  liveWatch().catch(() => {});
  return g;
}

/** With notifications on, the server also sends next stop, change and connection alerts while the app is closed. */
export async function liveWatch() {
  const g = cur;
  if (!g || g.watchId) return;
  const ps = await getPushState();
  if (ps.status !== 'on' && ps.status !== 'local') return;
  const r = await api.watch({ kind: 'trip', title: g.title, legs: g.legs, origin: g.origin, to: g.to, lead: 0, track: true, silentStart: true });
  if (cur && cur.id === g.id && r.watch?.id) setLive({ ...cur, watchId: r.watch.id });
}

/** Ends the trip: stops the share link and the server alerts, removes the ongoing notification. */
export async function endLive() {
  const g = cur;
  if (!g) return null;
  if (g.share) api.shareEnd(g.share.id, g.share.key).catch(() => {});
  if (g.watchId) api.stopWatch(g.watchId).catch(() => {});
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

/** A one off alert: Next stop, change here, connection at risk. */
export async function liveAlert(title: string, body: string) {
  try {
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted) return false;
    await Notifications.scheduleNotificationAsync({ content: { title, body, data: { go: 1 } }, trigger: Platform.OS === 'android' ? { channelId: 'default' } : null });
    return true;
  } catch { return false; }
}
