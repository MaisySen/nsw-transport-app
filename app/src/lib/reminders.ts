// Trip reminders on the phone: several per saved trip, each on chosen weekdays at a clock time. Each day of a
// reminder is one weekly local notification (expo-notifications, in builds 201 to 206), so they ring with the app
// closed and nothing polls. Notification permission is asked only when the first reminder is saved.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useEffect, useSyncExternalStore } from 'react';
import { canNotify } from './smartNotify';
import { cleanReminder, isTripReminderId, ringWords, schedulePlan, type Reminder } from './reminderCore';

export const REMIND_CHANNEL = 'trip-reminders';
const KEY = 'tripReminders';
type Entry = { name: string; open: Record<string, string>; list: Reminder[] };
let all: Record<string, Entry> = {};
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : {};
    const out: Record<string, Entry> = {};
    for (const [k, e] of Object.entries<any>(v && typeof v === 'object' ? v : {})) {
      const list = (Array.isArray(e?.list) ? e.list : []).map(cleanReminder).filter(Boolean) as Reminder[];
      if (list.length) out[k] = { name: String(e.name || ''), open: e.open && typeof e.open === 'object' ? e.open : {}, list };
    }
    all = out;
  } catch {}
  emit();
}
const save = () => { AsyncStorage.setItem(KEY, JSON.stringify(all)).catch(() => {}); emit(); };

/**
 * Weekly local notifications in this build: the WEEKLY trigger type and the scheduling calls are there.
 * Builds 201 to 206 have them (expo-notifications 58); on the web, or a build without them, reminders are hidden.
 */
export function remindersSupported(): boolean {
  if (Platform.OS === 'web') return !!(globalThis as any).__alarmLog || __DEV__;
  try {
    const T: any = (Notifications as any).SchedulableTriggerInputTypes;
    return !!T?.WEEKLY && typeof Notifications.scheduleNotificationAsync === 'function'
      && typeof Notifications.getAllScheduledNotificationsAsync === 'function' && typeof Notifications.cancelScheduledNotificationAsync === 'function';
  } catch { return false; }
}

let channel: Promise<void> | null = null;
function setupChannel() {
  if (!channel) channel = (async () => {
    if (Platform.OS !== 'android') return;
    try {
      await Notifications.setNotificationChannelAsync(REMIND_CHANNEL, {
        name: 'Trip reminders', description: 'The reminders you set on a saved trip',
        importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 120, 250], enableVibrate: true,
      });
    } catch {}
  })();
  return channel;
}

async function cancelFor(tripKey: string | null) {
  if (Platform.OS === 'web') { (globalThis as any).__alarmLog?.({ cancelTrip: tripKey }); return; }
  try {
    const list = await Notifications.getAllScheduledNotificationsAsync();
    const pre = tripKey == null ? null : `trip-rem|${tripKey}|`;
    for (const n of list) {
      const id = n.identifier;
      if (isTripReminderId(id) && (pre == null || id.startsWith(pre))) await Notifications.cancelScheduledNotificationAsync(id);
    }
  } catch {}
}

async function scheduleFor(tripKey: string, e: Entry) {
  const words = ringWords(e.name);
  const plan = schedulePlan(tripKey, e.list);
  if (Platform.OS === 'web') { plan.forEach((p) => (globalThis as any).__alarmLog?.({ ...p, ...words })); return true; }
  await setupChannel();
  const T: any = (Notifications as any).SchedulableTriggerInputTypes;
  let ok = true;
  for (const p of plan) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: p.id,
        content: { title: words.title, body: words.body, data: { tripOpen: e.open }, sound: true },
        trigger: { type: T.WEEKLY, weekday: p.weekday, hour: p.hour, minute: p.minute, channelId: REMIND_CHANNEL } as any,
      });
    } catch { ok = false; }
  }
  return ok;
}

export type SaveResult = { ok: true } | { ok: false; reason: 'unsupported' | 'denied' | 'failed' };

/**
 * Saves a trip's reminders and schedules them again. The first reminder asks for notifications; when that is
 * refused nothing is saved. An empty list removes the trip's reminders.
 */
export async function setTripReminders(tripKey: string, name: string, open: Record<string, string>, list: Reminder[]): Promise<SaveResult> {
  await load();
  const clean = list.map(cleanReminder).filter(Boolean) as Reminder[];
  if (!clean.length) {
    await cancelFor(tripKey);
    delete all[tripKey];
    save();
    return { ok: true };
  }
  if (!remindersSupported()) return { ok: false, reason: 'unsupported' };
  if (!(await canNotify(true))) return { ok: false, reason: 'denied' };
  const e: Entry = { name, open, list: clean };
  await cancelFor(tripKey);
  const ok = await scheduleFor(tripKey, e);
  all = { ...all, [tripKey]: e };
  save();
  return ok ? { ok: true } : { ok: false, reason: 'failed' };
}

/** Trips deleted from the phone (or Delete all my data): their reminders go too. null removes every one. */
export async function dropTripReminders(keys: string[] | null) {
  await load();
  if (keys == null) { await cancelFor(null); all = {}; save(); return; }
  let changed = false;
  for (const k of keys) if (all[k]) { await cancelFor(k); delete all[k]; changed = true; }
  if (changed) save();
}

/** The reminders on one trip, kept up to date. */
export function useTripReminders(tripKey: string): Reminder[] {
  useEffect(() => { load(); }, []);
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => all[tripKey]?.list || EMPTY, () => EMPTY);
}
const EMPTY: Reminder[] = [];
