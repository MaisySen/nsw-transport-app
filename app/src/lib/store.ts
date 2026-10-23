import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Place } from './types';

type State = { starred: Place[]; recents: Place[]; watchedTrips: Record<string, string> };
let state: State = { starred: [], recents: [], watchedTrips: {} };
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
