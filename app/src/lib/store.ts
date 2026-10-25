import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Place } from './types';

export type RecentTrip = { from: Place; to: Place; at: number };
export type Places = { home?: Place; work?: Place };
/** One leg of a multi leg trip: mode, change time before it, all services on this leg, walk minutes for a walk leg. */
export type MyTripLeg = { mode: string; from: Place; to: Place; conn?: number; any?: boolean; walk?: number };
/** A trip saved on this phone from New Trip. Multi leg trips have legs; older two leg trips have via and conn. */
export type MyTrip = { from: Place; to: Place; via?: Place; conn?: number; name: string; modes?: string[]; legs?: MyTripLeg[] };
export type FareType = 'adult' | 'child' | 'concession' | 'gold';
type State = { starred: Place[]; recents: Place[]; recentTrips: RecentTrip[]; watchedTrips: Record<string, string>; places: Places;
  myTrips: MyTrip[]; tripOrder: string[]; allServices: Record<string, boolean>; fareType: FareType;
  /** Settings > Accessibility: step free trips only, and lift outage alerts for stations on saved trips. */
  acc?: boolean; liftAlerts?: boolean;
  /** Speak alerts on the live trip: the last choice, so the next trip starts with it. */
  speak?: boolean;
  /** The two question setup (home and work) was finished or skipped. */
  onboarded?: boolean;
  /** The commute card was swapped for this half day ("2026-10-24 pm"); it flips back at the next 12. */
  commuteFlip?: string | null;
  /** Remind me on the commute card: when the leave alert rings, and for which service. */
  leaveReminder?: LeaveReminder | null;
  /** Morning checks this phone has on the server, as last read (the server is the record). */
  morning?: import('./types').MorningCheck[];
};
export type LeaveReminder = { at: number; dep: number; label: string };
const EMPTY: State = { starred: [], recents: [], recentTrips: [], watchedTrips: {}, places: {}, myTrips: [], tripOrder: [], allServices: {}, fareType: 'adult' };
let state: State = { ...EMPTY };

/** One key per trip, used for order, the All services switch and duplicates. */
export const tripKeyOf = (t: { from: Place; to: Place; via?: Place | null; legs?: { to: Place }[] }) =>
  t.legs && t.legs.length > 1 ? [t.from.id, ...t.legs.slice(0, -1).map((l) => l.to.id), t.to.id].join('>') : `${t.from.id}>${t.via ? t.via.id + '>' : ''}${t.to.id}`;
let loaded = false;
const listeners = new Set<() => void>();

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem('store');
    if (raw) state = { ...state, ...JSON.parse(raw) };
  } catch {}
  listeners.forEach((l) => l());
}
function save() {
  AsyncStorage.setItem('store', JSON.stringify(state)).catch(() => {});
  listeners.forEach((l) => l());
}

export function useStore() {
  useEffect(() => { load(); }, []);
  const snap = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
  return snap;
}

/**
 * Reminders set on saved trips (reminders.ts) go with the trip: 8 s after a delete (past Home's 5 s Undo, and an
 * edit that saves the trip again), the ones whose trip is still gone are cancelled. Delete all my data drops all now.
 */
const dropReminders = (keys: string[] | null) => {
  const go = (k: string[] | null) => { import('./reminders').then((m) => m.dropTripReminders(k)).catch(() => {}); };
  if (keys == null) { go(null); return; }
  setTimeout(() => {
    const still = keys.filter((k) => !(state.myTrips || []).some((t) => tripKeyOf(t) === k));
    if (still.length) go(still);
  }, 8000);
};

export const store = {
  /** The watch on a trip right now (read at tap time, so a memoised row never acts on an old value). */
  watchedId: (key: string) => state.watchedTrips[key],
  isStarred: (id: string) => state.starred.some((s) => s.id === id),
  /** Bus stops keep their mode and routes, so the widgets can show the stop number and lines. */
  toggleStar(p: Place & { mode?: string; lines?: string[] }) {
    const has = state.starred.some((s) => s.id === p.id);
    state = { ...state, starred: has ? state.starred.filter((s) => s.id !== p.id) : [...state.starred, p] };
    save();
    return !has;
  },
  clearStarred() { state = { ...state, starred: [] }; save(); },
  addRecent(p: Place) {
    state = { ...state, recents: [p, ...state.recents.filter((r) => r.id !== p.id)].slice(0, 8) };
    save();
  },
  /** Empties Recent stops and returns what was there, for Undo. */
  clearRecents() { const old = state.recents || []; state = { ...state, recents: [] }; save(); return old; },
  restoreRecents(list: Place[]) { state = { ...state, recents: list }; save(); },
  removeRecent(id: string) { state = { ...state, recents: (state.recents || []).filter((r) => r.id !== id) }; save(); },
  /** Empties Recent trips and returns what was there, for Undo. */
  clearRecentTrips() { const old = state.recentTrips || []; state = { ...state, recentTrips: [] }; save(); return old; },
  restoreRecentTrips(list: RecentTrip[]) { state = { ...state, recentTrips: list }; save(); },
  fareType: (): FareType => state.fareType || 'adult',
  setFareType(f: FareType) { state = { ...state, fareType: f }; save(); },
  /** Accessible trips: acc=1 on trip, plan and Ask calls. */
  accOn: (): boolean => !!state.acc,
  setAcc(on: boolean) { state = { ...state, acc: on }; save(); },
  speakOn: (): boolean => !!state.speak,
  setSpeak(on: boolean) { state = { ...state, speak: on }; save(); },
  liftAlertsOn: (): boolean => !!state.liftAlerts,
  setLiftAlerts(on: boolean) { state = { ...state, liftAlerts: on }; save(); },
  /** Saved trips on this phone, for lift outage alerts. */
  myTrips: (): MyTrip[] => state.myTrips || [],
  /** Delete all my data: everything this store keeps goes back to empty (the fare type stays). */
  resetAll() { if (state.leaveReminder) import('./smartNotify').then((m) => m.cancelLeave()).catch(() => {}); dropReminders(null); state = { ...EMPTY, fareType: state.fareType || 'adult', acc: !!state.acc }; save(); },
  /** Remembers an A to B trip the user opened, newest first. */
  addRecentTrip(from: Place, to: Place) {
    if (!from?.id || !to?.id || from.id === to.id) return;
    const rest = (state.recentTrips || []).filter((t) => !(t.from.id === from.id && t.to.id === to.id));
    const top = state.recentTrips?.[0];
    if (top && top.from.id === from.id && top.to.id === to.id && top.from.name === from.name && top.to.name === to.name) return;
    state = { ...state, recentTrips: [{ from, to, at: Date.now() }, ...rest].slice(0, 6) };
    save();
  },
  removeRecentTrip(fromId: string, toId: string) {
    state = { ...state, recentTrips: (state.recentTrips || []).filter((t) => !(t.from.id === fromId && t.to.id === toId)) };
    save();
  },
  /** Home and work stops for the Home to Work and Work to Home trips. */
  setPlace(kind: 'home' | 'work', p: Place | null) {
    const places = { ...(state.places || {}) };
    if (p) places[kind] = { id: p.id, name: p.name }; else delete places[kind];
    state = { ...state, places };
    save();
  },
  setOnboarded(on: boolean) { state = { ...state, onboarded: on }; save(); },
  setCommuteFlip(key: string | null) { state = { ...state, commuteFlip: key }; save(); },
  setLeaveReminder(r: LeaveReminder | null) { state = { ...state, leaveReminder: r }; save(); },
  setMorning(list: import('./types').MorningCheck[]) { state = { ...state, morning: list }; save(); },
  /** The morning checks last read from the server (More > Check my trip). */
  morningList: () => state.morning || [],
  saveMyTrip(t: MyTrip) {
    const k = tripKeyOf(t);
    state = { ...state, myTrips: [t, ...(state.myTrips || []).filter((x) => tripKeyOf(x) !== k && x.name !== t.name)].slice(0, 12) };
    save();
  },
  /** Clear all in Your trips: the trips kept on the phone with these keys, and their place in your order. */
  removeMyTrips(keys: string[]) { dropReminders(keys); const k = new Set(keys); state = { ...state, myTrips: (state.myTrips || []).filter((x) => !k.has(tripKeyOf(x))), tripOrder: (state.tripOrder || []).filter((x) => !k.has(x)) }; save(); },
  /** Undo of a delete on Home: the list exactly as it was. */
  setMyTrips(list: MyTrip[]) { state = { ...state, myTrips: list }; save(); },
  removeMyTrip(key: string) { dropReminders([key]); state = { ...state, myTrips: (state.myTrips || []).filter((x) => tripKeyOf(x) !== key) }; save(); },
  getOrder: () => state.tripOrder || [],
  setTripOrder(keys: string[]) { state = { ...state, tripOrder: keys }; save(); },
  setAllServices(key: string, on: boolean) {
    const a = { ...(state.allServices || {}) };
    if (on) a[key] = true; else delete a[key];
    state = { ...state, allServices: a };
    save();
  },
  markWatched(tripKey: string, watchId: string) { state = { ...state, watchedTrips: { ...state.watchedTrips, [tripKey]: watchId } }; save(); },
  unmarkWatched(watchId: string) {
    const w = { ...state.watchedTrips };
    for (const k of Object.keys(w)) if (w[k] === watchId) delete w[k];
    state = { ...state, watchedTrips: w };
    save();
  },
};

export function useLoaded() {
  const [ok, setOk] = useState(loaded);
  const cb = useCallback(() => setOk(true), []);
  useEffect(() => { load().then(cb); }, [cb]);
  return ok;
}
