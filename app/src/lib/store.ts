import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Place } from './types';

export type RecentTrip = { from: Place; to: Place; at: number };
export type Places = { home?: Place; work?: Place };
type State = { starred: Place[]; recents: Place[]; recentTrips: RecentTrip[]; watchedTrips: Record<string, string>; places: Places };
let state: State = { starred: [], recents: [], recentTrips: [], watchedTrips: {}, places: {} };
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
  clearRecents() { state = { ...state, recents: [] }; save(); },
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
