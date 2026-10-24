// Which alerts a stop screen shows at the top, and the one note a departure row may add. Pure, so it is unit tested.
//
// A stop can carry many alerts. The two at the top are the ones that touch the most services on the board
// (a generic "Station Update" on every train goes up there once instead of under every row); a row then names
// only an alert the top does not already show.

export type StopAlert = { id?: string; title?: string; priority?: string };

const quiet = (a: StopAlert | undefined) => !a || !a.title || a.priority === 'low' || a.priority === 'veryLow';

/** The alerts a departure refers to, resolved against the board's list (rows carry ids or whole alerts). */
export function rowAlerts(ids: any[] | undefined, board: StopAlert[] | undefined): StopAlert[] {
  const out: StopAlert[] = [];
  for (const a of ids || []) {
    const al = typeof a === 'string' ? (board || []).find((b) => b && b.id === a) : a;
    if (al && typeof al === 'object') out.push(al);
  }
  return out;
}

/**
 * Up to `max` alerts for the top of a stop screen: those that apply to the most departures on the board first,
 * then the board's own order; low priority ones (lifts and the like) only after the rest. Same titles show once.
 * onlyUsed: just the alerts at least one of these departures refers to (a mode filter is on, so a light rail
 * note does not sit above the ferries).
 */
export function topAlerts(board: StopAlert[] | undefined, items: { alerts?: any[] }[] | undefined, max = 2, onlyUsed = false): StopAlert[] {
  const list = (board || []).filter((a) => a && a.title);
  const hits = new Map<string, number>();
  for (const d of items || []) {
    const seen = new Set<string>();
    for (const a of rowAlerts(d.alerts, list)) {
      const t = a.title!;
      if (!seen.has(t)) { seen.add(t); hits.set(t, (hits.get(t) || 0) + 1); }
    }
  }
  const ranked = list.map((a, i) => ({ a, i, n: hits.get(a.title!) || 0, low: quiet(a) ? 1 : 0 }))
    .sort((x, y) => x.low - y.low || y.n - x.n || x.i - y.i);
  const out: StopAlert[] = [];
  const titles = new Set<string>();
  for (const r of ranked) {
    if (titles.has(r.a.title!) || (onlyUsed && !r.n)) continue;
    titles.add(r.a.title!);
    out.push(r.a);
    if (out.length >= max) break;
  }
  return out;
}

/** The one alert worth adding under a row: not low priority and not already at the top. Null when none. */
export function rowNote(ids: any[] | undefined, board: StopAlert[] | undefined, shown: StopAlert[]): string | null {
  const top = new Set(shown.map((a) => a.title));
  for (const a of rowAlerts(ids, board)) {
    if (!quiet(a) && !top.has(a.title)) return a.title!;
  }
  return null;
}
