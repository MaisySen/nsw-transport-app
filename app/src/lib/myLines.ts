// The lines each trip on Home uses: the trip cards report the lines of the services they show, so
// the weekend trackwork card and line status ask about exactly those, with nothing to set up.
import { useSyncExternalStore } from 'react';
import { tripLinesOf, type TripLines } from './trackworkCore';

const reg = new Map<string, TripLines>();
const subs = new Set<() => void>();
let snap: TripLines[] = [];

/** From a trip card on Home: Home and Work, commutes and saved trips (recent trips are not reported). */
export function reportTripLines(key: string, v: TripLines | null) {
  const before = JSON.stringify(reg.get(key) || null);
  if (v && v.lines.length) reg.set(key, v); else reg.delete(key);
  if (before === JSON.stringify(reg.get(key) || null)) return;
  snap = [...reg.values()];
  subs.forEach((f) => f());
}
export { tripLinesOf };
/** The trips on Home right now (saved trip alerts read them when the switch is turned on). */
export const tripLinesNow = (): TripLines[] => snap;

export function useTripLines(): TripLines[] {
  return useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => snap, () => snap);
}
