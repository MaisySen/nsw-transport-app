// Long distance trips (Central to Albury, Dubbo, Grafton): the Trip Planner can take up to about 30 seconds for
// these, longer than the 12 seconds the first server waits. They go to the new server with long=1, which waits
// longer and keeps the answer for 2 minutes, and the app keeps it for 2 minutes too.
// No imports, so the unit tests can load this file on its own.

/** Stop ids from Transport for NSW start with the stop's postcode: 200060 is Central (2000), 26401 Albury (2640). */
export function postcodeOf(id: string | null | undefined): number | null {
  const m = /^(2\d{3})\d{1,4}$/.exec(String(id || '').trim());
  return m ? Number(m[1]) : null;
}

// Postcodes where the planner answers quickly: Sydney, the Central Coast, Newcastle and the Hunter, the
// Illawarra, Macarthur, Western Sydney and the Blue Mountains.
const NEAR: [number, number][] = [[2000, 2263], [2264, 2330], [2500, 2574], [2740, 2786]];
const near = (pc: number) => NEAR.some(([a, b]) => pc >= a && pc <= b);

/** True when one end of the trip is a stop outside the near postcodes (regional NSW, the ACT, interstate). */
export function isLongTrip(fromId: string | null | undefined, toId: string | null | undefined): boolean {
  const a = postcodeOf(fromId), b = postcodeOf(toId);
  return (a != null && !near(a)) || (b != null && !near(b));
}

/**
 * The planner was too slow (the next search of the pair goes the long way): the server timed out on it (504) or the
 * server was reachable and no answer came in time (slow). A 502, 503 or 429 is a refusal or failure, not slowness
 * (docs/DIAGNOSIS_LAG.md item 3), and a phone with no connection is not slow either.
 */
export function plannerTooSlow(e: any): boolean {
  if (!e) return false;
  return e.http === 504 || (!!e.slow && !e.http);
}

/** A 404 from the new server's /api/trip with long=1: not there yet, so plan on the server in use. */
export const longGone = (e: any) => !!e && e.http === 404;

/** How long the app reuses a long trip answer (and how often the trip screen refreshes it). */
export const LONG_TRIP_KEEP_MS = 120000;
/** How long the app waits for a long trip answer. */
export const LONG_TRIP_TIMEOUT_MS = 45000;
/** After this long with no answer, the trip screen says it is still searching. */
export const STILL_SEARCHING_MS = 6000;

/** A small time limited memo: get returns a kept answer under keepMs old, else undefined. */
export function createKeep<T>(keepMs: number, max = 20) {
  const m = new Map<string, { at: number; v: T }>();
  return {
    get(k: string, now = Date.now()): T | undefined {
      const e = m.get(k);
      if (!e) return undefined;
      if (now - e.at >= keepMs) { m.delete(k); return undefined; }
      return e.v;
    },
    set(k: string, v: T, now = Date.now()) {
      m.delete(k);
      m.set(k, { at: now, v });
      while (m.size > max) m.delete(m.keys().next().value as string);
    },
    clear() { m.clear(); },
    size: () => m.size,
  };
}
