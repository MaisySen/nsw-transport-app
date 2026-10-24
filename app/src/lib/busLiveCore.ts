// "Bus running 6 min late" on bus and coach legs of a trip, from the live position feed the server
// merges into each leg (realtime, delayMin). No React here (test/buslive.test.mjs).

export type BusLegStatus = { text: string; tone: 'late' | 'ok' | 'red' };

/** Words for a bus or coach leg with live data, or null (other modes, or no live data for this bus). */
export function busLegStatus(l: { kind?: string; mode?: string; realtime?: boolean; delayMin?: number | null; cancelled?: boolean }): BusLegStatus | null {
  if (l.kind === 'walk' || (l.mode !== 'bus' && l.mode !== 'coach')) return null;
  const noun = l.mode === 'coach' ? 'Coach' : 'Bus';
  if (l.cancelled) return { text: `${noun} cancelled`, tone: 'red' };
  if (!l.realtime || l.delayMin == null || !Number.isFinite(l.delayMin)) return null;
  const d = Math.round(l.delayMin);
  if (d >= 2) return { text: `${noun} running ${d} min late`, tone: d >= 5 ? 'red' : 'late' };
  if (d <= -2) return { text: `${noun} running ${-d} min early`, tone: 'late' };
  return { text: `${noun} on time, live`, tone: 'ok' };
}
