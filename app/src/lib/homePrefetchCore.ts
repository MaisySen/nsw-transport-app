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
