// Saved trip alerts (More > Alerts for my trips): keeps the server's copy of this phone's trips in step. The server
// (backend/src/tripalerts.js) does the matching and pushes; the phone sends its trips only when the switch is turned
// on and when the trips on Home, their reminders or their morning checks change. Nothing polls.
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { store, useStore } from './store';
import { canNotify } from './smartNotify';
import { getPushState, enablePush } from './push';
import { tripLinesNow, useTripLines } from './myLines';
import { allTripReminders, useRemindersVersion } from './reminders';
import { alertTrips, alertTripsKey, morningTimes, reminderTimes, remindersFor, type AlertTrip } from './tripAlertsCore';
import type { TripLines } from './trackworkCore';

const SENT_KEY = 'tripAlertsSent';

async function buildTrips(lines: TripLines[]): Promise<AlertTrip[]> {
  const rem = await allTripReminders();
  const morning = store.morningList();
  return alertTrips(lines, (tr) => [...reminderTimes(remindersFor(rem, tr.key)), ...morningTimes(morning, tr.f, tr.t)]);
}

async function send(lines: TripLines[], force: boolean) {
  const trips = await buildTrips(lines);
  if (!trips.length) return null;
  const key = alertTripsKey(trips);
  if (!force && (await AsyncStorage.getItem(SENT_KEY).catch(() => null)) === key) return null;
  const r = await api.tripAlerts(true, trips);
  if (r && r.on) await AsyncStorage.setItem(SENT_KEY, key).catch(() => {});
  return r;
}

export type TripAlertsResult = { ok: true; now: { trip: string; title: string }[]; noTrips: boolean } | { ok: false; reason: 'denied' | 'failed' };

/** The switch. On asks for notifications, makes sure the server can reach this phone, and sends the trips on Home. */
export async function setTripAlerts(on: boolean): Promise<TripAlertsResult> {
  if (!on) {
    store.setTripAlerts(false);
    await AsyncStorage.removeItem(SENT_KEY).catch(() => {});
    await api.tripAlerts(false).catch(() => null);
    return { ok: true, now: [], noTrips: false };
  }
  if (!(await canNotify(true))) return { ok: false, reason: 'denied' };
  const ps = await getPushState().catch(() => null);
  if (ps && ps.status === 'off') await enablePush(false).catch(() => null);
  store.setTripAlerts(true);
  const lines = tripLinesNow();
  try {
    const r = await send(lines, true);
    return { ok: true, now: (r?.now || []).map((x) => ({ trip: x.trip, title: x.title })), noTrips: !r };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Mounted once (app/_layout.tsx): sends the trips again when they change, a few seconds after Home settles. */
export function TripAlertSync() {
  const st = useStore();
  const on = !!st.tripAlerts;
  const lines = useTripLines();
  const rem = useRemindersVersion();
  const morning = st.morning;
  const sig = lines.map((l) => `${l.key}:${(l.legs || []).map((x) => x.l + x.f + x.t).join(',')}`).join('|');
  useEffect(() => {
    if (!on || !lines.length) return;
    const t = setTimeout(() => { send(lines, false).catch(() => {}); }, 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, sig, rem, morning]);
  return null;
}
