// Which realtime feed carries each leg of a trip (TrainLink, regional buses and coaches, Manly Fast Ferry).
// Trips started before legs carried it get it once from the stop's departure board.
// No imports, so the unit tests can load this file on its own.

type LegLike = { mode: string; line: string; tripId?: string | null; stopId: string; planned: string; feed?: string | null };
type BoardRow = { line: string; tripId?: string; planned: string; feed?: string };

/** Modes whose services can sit in a non-Sydney feed. Other modes always read their usual feed. */
export const FEED_MODES = new Set(['train', 'coach', 'bus', 'ferry']);

/** True when the leg has never been given a feed ('' means checked: the mode's usual feed). */
export const needsFeed = (l: LegLike) => l.feed === undefined || l.feed === null;

/** The board row for this leg: same trip id, or same line leaving within 90 seconds of the planned time. */
export function boardMatch(l: LegLike, rows: BoardRow[]): BoardRow | null {
  const t = Date.parse(l.planned);
  return rows.find((x) => (!!l.tripId && x.tripId === l.tripId) || (x.line === l.line && Number.isFinite(t) && Math.abs(Date.parse(x.planned) - t) < 90000)) || null;
}

/**
 * The legs with a feed filled in where it was missing. boards maps stop id to that stop's rows (or null when the
 * board did not answer, which leaves the leg to look up again later). A leg not on its board gets '' (usual feed).
 */
export function fillFeeds<L extends LegLike>(legs: L[], boards: Record<string, BoardRow[] | null | undefined>): { legs: L[]; changed: boolean } {
  let changed = false;
  const out = legs.map((l) => {
    if (!needsFeed(l)) return l;
    if (!FEED_MODES.has(l.mode)) { changed = true; return { ...l, feed: '' }; }
    const rows = boards[l.stopId];
    if (!rows) return l;
    const m = boardMatch(l, rows);
    changed = true;
    return { ...l, feed: (m && m.feed) || '' };
  });
  return { legs: out, changed };
}

/** Stops to read a board for: legs still without a feed, in a mode that can have one, leaving within an hour. */
export function stopsToLook(legs: LegLike[], now: number): string[] {
  const out = new Set<string>();
  for (const l of legs) {
    if (!needsFeed(l) || !FEED_MODES.has(l.mode) || !l.stopId) continue;
    const t = Date.parse(l.planned);
    if (Number.isFinite(t) && t < now + 3600000 && t > now - 2 * 3600000) out.add(l.stopId);
  }
  return [...out];
}
