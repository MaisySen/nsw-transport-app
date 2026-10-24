// What the app sends the server so it can update the trip card by push while the phone is locked
// (build 205 and later). Pure, so it is unit tested (test/livepush.test.mjs).
import type { LiveTrip } from '../src/lib/live';
import type { WatchLeg } from '../src/lib/types';

/** The server that sends trip card pushes. It holds the push key, whichever address the rest of the app uses. */
export const PUSH_BASE = 'https://api.transportsydney.app';

export type PushTrip = {
  id: string; title: string; origin: { id?: string; name?: string } | null; to: { id?: string; name?: string } | null;
  legs: WatchLeg[]; rode: Record<number, number>; arrivedAt: number | null;
};

const LEG_KEYS: (keyof WatchLeg)[] = ['mode', 'line', 'tripId', 'stopId', 'toStopId', 'from', 'to', 'planned', 'arrPlanned', 'estimated',
  'fromPlatform', 'toPlatform', 'color', 'towards', 'destId', 'feed'];

const place = (p: any) => (p ? { id: p.id ? String(p.id) : undefined, name: p.name ? String(p.name) : undefined } : null);

/** The parts of a live trip the server needs to work out the card: legs, what was ridden and the arrival. */
export function pushTrip(g: LiveTrip): PushTrip {
  return {
    id: g.id,
    title: g.title || '',
    origin: place(g.origin),
    to: place(g.to),
    legs: (g.legs || []).map((l) => {
      const o: any = {};
      for (const k of LEG_KEYS) if (l[k] !== undefined && l[k] !== null && l[k] !== '') o[k] = l[k];
      return o as WatchLeg;
    }),
    rode: { ...(g.rode || {}) },
    arrivedAt: g.arrivedAt ?? null,
  };
}

/** Changes when the server should hear about the trip again: a new token, a leg ridden, a replan or arrival. */
export function pushKey(token: string, g: LiveTrip): string {
  const t = pushTrip(g);
  return JSON.stringify([token, t.id, t.legs.map((l) => [l.tripId, l.stopId, l.planned]), t.rode, t.arrivedAt]);
}

/** A hex APNs token, or null. */
export function cleanToken(t: unknown): string | null {
  if (typeof t !== 'string') return null;
  const s = t.trim().toLowerCase();
  return /^[0-9a-f]{32,400}$/.test(s) ? s : null;
}

/** The parts of the native module this needs. Builds 201 to 204 have none of the push functions. */
export type PushNative = {
  supportsActivityPush?: () => boolean;
  tripActivityPushToken?: (id: string) => string | null;
} | null | undefined;

/** True only on builds whose trip card can be updated by push (205 and later); false on 201 to 204 and off iPhone. */
export function activityPushOf(native: PushNative): boolean {
  try { return !!native && typeof native.supportsActivityPush === 'function' && native.supportsActivityPush() === true; } catch { return false; }
}

/** The card's push token, or null on builds without push and whenever the call fails. */
export function pushTokenOf(native: PushNative, id: string): string | null {
  try { return native && typeof native.tripActivityPushToken === 'function' ? cleanToken(native.tripActivityPushToken(id)) : null; } catch { return null; }
}
