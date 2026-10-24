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
  myTrips: MyTrip[]; tripOrder: string[]; allServices: Record<string, boolean>; fareType: FareType };
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

export const store = {
  isStarred: (id: string) => state.starred.some((s) => s.id === id),
  toggleStar(p: Place) {
    const has = state.starred.some((s) => s.id === p.id);
    state = { ...state, starred: has ? state.starred.filter((s) => s.id !== p.id) : [...state.starred, p] };
    save();
    return !has;
  },
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
  /** Delete all my data: everything this store keeps goes back to empty (the fare type stays). */
  resetAll() { state = { ...EMPTY, fareType: state.fareType || 'adult' }; save(); },
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
  saveMyTrip(t: MyTrip) {
    const k = tripKeyOf(t);
    state = { ...state, myTrips: [t, ...(state.myTrips || []).filter((x) => tripKeyOf(x) !== k && x.name !== t.name)].slice(0, 12) };
    save();
  },
  removeMyTrip(key: string) { state = { ...state, myTrips: (state.myTrips || []).filter((x) => tripKeyOf(x) !== key) }; save(); },
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
