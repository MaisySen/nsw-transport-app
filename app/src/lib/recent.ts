// Recently departed on this phone: one memory for the app session, fed by every departures read (api.ts).
import { useSyncExternalStore } from 'react';
import { createRecent, type Departed, type RowLike } from './recentCore';

const mem = createRecent();
let version = 0;
const subs = new Set<() => void>();

export function noteBoard(stopId: string, r: { items?: RowLike[]; seenAt?: number } | null | undefined) {
  if (!r || !Array.isArray(r.items)) return;
  mem.note(String(stopId), r.items, typeof r.seenAt === 'number' ? r.seenAt : Date.now());
  version++;
  subs.forEach((f) => f());
}

function subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

/** The services that left this stop in the last few minutes, newest first (re-read when a board read changes it). */
export function useRecentDeparted(stopId: string | undefined, now: number): Departed[] {
  useSyncExternalStore(subscribe, () => version, () => version);
  return stopId ? mem.list(String(stopId), now) : [];
}
