// Home reads the likely next screen while it sits idle and on screen (speed pass part 2, 27 Oct; playbook pattern 6):
// the top trip card's trip screen (a plain A to B trip with no mode chips), once per time Home comes to the front,
// a moment after Home has its lists. It goes through the same press in limits as a finger on a row (speedCore
// createPrefetchGate: once per 20 s per key, 8 a minute across the app) and never runs with the app in the
// background. No phone dependencies, so the unit tests can load it.

/** How long Home waits after it is on screen with its lists before it reads the next screen. */
export const HOME_IDLE_MS = 1500;

type P = { id: string; name: string };
export type NextTrip = { from: P; to: P; via?: P | null; legs?: unknown[] | null } | null | undefined;

/** The trip screen's plan for the top card, or null when that screen would not ask the plain way (a change stop, set
 * legs, mode chips on, or the same stop at both ends). */
export function nextTripPlan(t: NextTrip, modesOn: string[] | null | undefined): { from: P; to: P } | null {
  if (!t || !t.from?.id || !t.to?.id || t.from.id === t.to.id) return null;
  if (t.via || (Array.isArray(t.legs) && t.legs.length > 1)) return null;
  if (Array.isArray(modesOn) && modesOn.length) return null;
  return { from: { id: t.from.id, name: t.from.name }, to: { id: t.to.id, name: t.to.name } };
}

/** Each key once per foreground: foreground() starts a new one (the app came to the front). */
export function createForegroundOnce() {
  const done = new Set<string>();
  return {
    foreground() { done.clear(); },
    take(key: string): boolean { if (done.has(key)) return false; done.add(key); return true; },
  };
}

/** Home may read ahead only on screen, in the front, with its lists in hand. */
export const mayReadAhead = (s: { focused: boolean; appState: string | null | undefined; hasLists: boolean }) =>
  s.focused && s.appState === 'active' && s.hasLists;

// Instant paint (30 Oct): the read ahead covers the first few trips on Home, not only the top card. Home's own cards
// already read each saved trip and starred stop under the very key their screens paint from, so this only adds the
// trip screen's first page (whole day lists where the server pages) for trips whose kept copy is missing or old.

/** At most this many trip screens are read ahead per foreground, the top card included. */
export const READ_AHEAD_MAX = 4;
/** A kept copy younger than this is not read ahead again. */
export const READ_AHEAD_FRESH_MS = 10 * 60000;

/** The trip screens to read ahead, top of Home first: plain A to B trips only (nextTripPlan), each pair once, at most
 * READ_AHEAD_MAX. `modesOf` gives the mode chips kept for a pair. */
export function readAheadPlans(trips: NextTrip[], modesOf: (pair: string) => string[] | null | undefined, max = READ_AHEAD_MAX): { from: P; to: P }[] {
  const out: { from: P; to: P }[] = [];
  const seen = new Set<string>();
  for (const t of trips || []) {
    if (out.length >= max) break;
    const pair = t && t.from?.id && t.to?.id ? `${t.from.id}>${t.to.id}` : '';
    if (!pair || seen.has(pair)) continue;
    const plan = nextTripPlan(t, modesOf(pair));
    if (!plan) continue;
    seen.add(pair);
    out.push(plan);
  }
  return out;
}

/** True when a trip screen should be read ahead now: its kept copy is missing or older than READ_AHEAD_FRESH_MS. */
export const readAheadDue = (keptAt: number | null | undefined, now: number) => keptAt == null || !Number.isFinite(keptAt) || now - keptAt >= READ_AHEAD_FRESH_MS;
