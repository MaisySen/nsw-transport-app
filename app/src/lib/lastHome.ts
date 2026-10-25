// Last way home reminder on the phone: the current reminder, set and cancel. Two ways (docs/LAST-WAY-HOME.md): the
// server push (the new server, iPhone), or the phone's own local notification, rechecked live whenever the app is
// open (the current server, and Android). A server without /api/last-home (404) uses the phone's own.
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { apiBase } from './server';
import { getDevice } from './device';
import { hhmmSydney } from './trips';
import { canNotify, cancelLocalAlert, scheduleLocalAlert } from './smartNotify';
import { canRemind, followLast, localItem, localRingWords, recheckDue, type LastHomeHint, type LastHomeItem, type LastSvc, type LocalLast } from './lastHomeCore';

type State = { base: string; available: boolean | null; item: LastHomeItem | null; push: { web: number; expo: number } | null; at: number; local: LocalLast | null };
let state: State = { base: '', available: null, item: null, push: null, at: 0, local: null };
const listeners = new Set<() => void>();
const KEY = 'lastHome';
const LOCAL_KEY = 'lastHomeLocal';
/** The local notification's id: one reminder at a time, a new one replaces it. */
export const LAST_LOCAL_ID = 'last-home-local';
function set(s: Partial<State>) {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, JSON.stringify({ item: state.item, base: state.base })).catch(() => {});
  if ('local' in s) AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(state.local)).catch(() => {});
}

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(apiBase() + path, { ...init, signal: ctl.signal, headers: init?.body ? { 'content-type': 'application/json' } : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } finally { clearTimeout(t); }
}

/** Shows the last known reminder at once, before the server answers. */
export async function loadCachedLastHome() {
  try { const raw = await AsyncStorage.getItem(KEY); if (raw) { const v = JSON.parse(raw); if (v?.base === apiBase()) state = { ...state, item: v.item || null }; } } catch {}
  await loadLocal();
}
let localLoaded = false;
async function loadLocal() {
  if (localLoaded) return;
  localLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(LOCAL_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (v && v.local === true && v.svc && v.leave) { state = { ...state, local: v }; listeners.forEach((l) => l()); }
  } catch {}
}

/** Reads the reminder from the server (at most every 30 s unless forced). Marks the feature missing on a 404. */
export async function refreshLastHome(force = false) {
  const base = apiBase();
  if (state.base === base && state.available === false) return;
  if (!force && state.base === base && Date.now() - state.at < 30000) return;
  try {
    const r = await call(`/api/last-home?device=${encodeURIComponent(await getDevice())}`);
    if (r.status === 404) { set({ base, available: false, item: null, at: Date.now() }); return; }
    if (r.status >= 400) return;
    set({ base, available: r.body?.enabled !== false, item: r.body?.item || null, push: r.body?.push || null, at: Date.now() });
  } catch { /* offline: keep what we had */ }
}

export type SetResult = { ok: true; item: LastHomeItem; push: { web: number; expo: number } } | { ok: false; missing?: boolean; error: string };

/** Asks for the reminder. The server picks the last service itself and may answer that it is too soon or gone. */
export async function remindLastHome(from: { id: string; name: string }, to: { id: string; name: string }, mode: string | null, acc = false): Promise<SetResult> {
  const base = apiBase();
  try {
    const r = await call('/api/last-home', { method: 'POST', body: JSON.stringify({ device: await getDevice(), from, to, mode, acc }) });
    if (r.status === 404) { set({ base, available: false }); return { ok: false, missing: true, error: 'Reminders are not available yet.' }; }
    if (r.status >= 400 || !r.body?.item) return { ok: false, error: r.body?.error || `Something went wrong (${r.status})` };
    set({ base, available: true, item: r.body.item, push: r.body.push || null, at: Date.now() });
    return { ok: true, item: r.body.item, push: r.body.push || { web: 0, expo: 0 } };
  } catch {
    return { ok: false, error: 'No answer from the server. Check your connection.' };
  }
}

export async function cancelLastHome(): Promise<boolean> {
  try {
    const r = await call(`/api/last-home?device=${encodeURIComponent(await getDevice())}`, { method: 'DELETE' });
    if (r.status >= 400) return false;
    set({ item: null, at: Date.now() });
    return true;
  } catch { return false; }
}

/** Delete all data: the server removes it with scope all; this forgets it on the phone, the local one included. */
export function clearLastHomeLocal() { cancelLocalAlert(LAST_LOCAL_ID); set({ item: null, push: null, at: 0, local: null }); }

// ---------- the phone's own reminder ----------

/** A one time local notification at a date: in builds 201 to 206 (expo-notifications 58). On the web only in tests. */
export function localLastSupported(): boolean {
  if (Platform.OS === 'web') return !!(globalThis as any).__alarmLog || __DEV__;
  try {
    const T: any = (Notifications as any).SchedulableTriggerInputTypes;
    return !!T?.DATE && typeof Notifications.scheduleNotificationAsync === 'function' && typeof Notifications.cancelScheduledNotificationAsync === 'function';
  } catch { return false; }
}

const isCoord = (id: string) => /^-?[\d.]+:-?[\d.]+:EPSG:4326$/.test(id || '');
async function getJson(path: string): Promise<any | null> {
  try { const r = await call(path); return r.status < 400 ? r.body : null; } catch { return null; }
}
const NOUN_Q: Record<string, string> = { lightrail: 'light rail' };

/**
 * Journeys around the last service, from what the current server already answers: the trip planner from a stop, or
 * Ask's Last train home from a spot on the map (the planner there needs a stop). Null when there is no answer.
 */
async function lastJourneys(from: { id: string; name: string }, to: { id: string; name: string }, mode: string | null, near: number | null, acc: boolean): Promise<any[] | null> {
  if (isCoord(from.id)) {
    const [lon, lat] = from.id.split(':');
    const q = `last ${NOUN_Q[mode || ''] || mode || 'train'} home`;
    const qs = new URLSearchParams({ q, home: `${to.id}|${to.name || ''}`, lat, lon, ...(acc ? { acc: '1' } : {}) });
    const d = await getJson(`/api/ask?${qs.toString()}`);
    if (!d) return null;
    return [d.before, d.last, d.after].filter(Boolean);
  }
  const now = Date.now();
  // From 45 min before the service (or now), so the list holds it and what runs after it. A time past midnight is
  // read by the server as tomorrow's, which is what a last service after midnight is.
  const at = hhmmSydney(near != null && Number.isFinite(near) ? Math.max(now, near - 45 * 60000) : now);
  const qs = new URLSearchParams({ from: from.id, to: to.id, time: at, count: '8', refresh: '1', ...(acc ? { acc: '1' } : {}) });
  const d = await getJson(`/api/trip?${qs.toString()}`);
  return d && Array.isArray(d.journeys) ? d.journeys : null;
}

async function scheduleLocal(item: LocalLast): Promise<boolean> {
  const w = localRingWords(item);
  const at = Date.parse(item.remindAt || '');
  const open = isCoord(item.from.id) ? null : { from: item.from.id, fromName: item.from.name, to: item.to.id, toName: item.to.name };
  await cancelLocalAlert(LAST_LOCAL_ID);
  return scheduleLocalAlert(LAST_LOCAL_ID, at, w.title, w.body, { lastHome: 1, ...(open ? { tripOpen: open } : {}) });
}

export type LocalSetResult = { ok: true; item: LocalLast } | { ok: false; error: string; denied?: boolean };

/**
 * Remind me on the phone: one local notification 15 min before the last service home leaves. The service comes
 * with the hint (Ask, trip results); notifications are asked for here, at the tap, and not before.
 */
export async function remindLastLocal(hint: LastHomeHint, acc = false): Promise<LocalSetResult> {
  await loadLocal();
  const svc: LastSvc | null | undefined = hint.svc;
  if (!svc) return { ok: false, error: 'No last service to remind you about. Ask again in a moment.' };
  const now = Date.now();
  const leave = Date.parse(svc.leave);
  if (!canRemind(leave, now)) {
    return { ok: false, error: leave > now ? `It leaves in ${Math.max(1, Math.round((leave - now) / 60000))} min, too soon for a reminder.` : 'The last service has gone.' };
  }
  if (!(await canNotify(true))) return { ok: false, denied: true, error: 'Notifications are off for Transport, so the reminder can only show on Home. Allow them in Settings to get it.' };
  const item = localItem(hint, svc, now);
  item.acc = acc;
  if (!(await scheduleLocal(item))) return { ok: false, error: "Couldn't set the reminder on this phone. Try again." };
  set({ local: item });
  return { ok: true, item };
}

export async function cancelLastLocal() {
  await cancelLocalAlert(LAST_LOCAL_ID);
  set({ local: null });
}

let checking = false;
/**
 * The live recheck, only while the app is open (on open, and from the app poll): looks at live times again on the
 * schedule in recheckDue, follows the service, and moves or cancels the notification. Nothing runs in the background.
 */
export async function recheckLastLocal(force = false) {
  await loadLocal();
  const item = state.local;
  if (!item || checking) return;
  const now = Date.now();
  if (item.leave && now > Date.parse(item.leave) + 30 * 60000) { set({ local: null }); return; }
  if (!force && !recheckDue(item, now)) return;
  checking = true;
  try {
    const js = await lastJourneys(item.from, item.to, item.mode || null, Date.parse(item.svc.planned || item.svc.board), !!item.acc);
    if (!js) return;
    const next = followLast(item, js, Date.now());
    if (next.status === 'none') await cancelLocalAlert(LAST_LOCAL_ID);
    else if (next.remindAt !== item.remindAt || next.board !== item.board) {
      if (Date.parse(next.remindAt || '') > Date.now() + 30000) await scheduleLocal(next);
      else await cancelLocalAlert(LAST_LOCAL_ID);
    }
    set({ local: next });
  } finally { checking = false; }
}

export function useLastHome(): State {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
}
