// The order of a list of trips (Simple mode and the trip list). Bidur, 26 Oct 8:50 AM, Strathfield to Five Dock
// Shops: a T2 then a bus that gets there no sooner than the direct 415 should not sit above it. Pure logic, no
// imports, unit tested in Node (test/rank.test.mjs).

export type RankLeg = { kind?: string; onDemand?: boolean; line?: string };
export type RankJourney = { legs: RankLeg[] };

/** How far after a trip with changes a direct one may leave and still go above it. */
export const RANK_WINDOW_MS = 20 * 60000;

const rides = (j: RankJourney) => (j.legs || []).filter((l) => l && l.kind !== 'walk');
export const isOnDemand = (j: RankJourney) => rides(j).some((l) => !!l.onDemand);

/**
 * Soonest first, with two changes to plain time order:
 * - A trip with a change goes just under a trip with fewer changes that leaves at most RANK_WINDOW_MS later and gets
 *   there no later. It stays in the list: someone may still want the earlier train.
 * - An on demand service (booked, like the D400 in the Inner West) is listed once per line, at its first time. The
 *   planner offers one every few minutes; they are one service you book, not many departures. It never counts as the
 *   direct trip that moves another one down, as it has to be booked.
 * `dep` and `arr` give a trip's live leave and arrive times in ms.
 */
export function rankTrips<T extends RankJourney>(js: T[], dep: (j: T) => number, arr: (j: T) => number): T[] {
  const info = js.map((j, i) => ({ j, i, d: dep(j), a: arr(j), n: rides(j).length, od: isOnDemand(j) }))
    .sort((x, y) => (x.d - y.d) || (x.i - y.i));
  const seenDemand = new Set<string>();
  const kept = info.filter((x) => {
    if (!x.od) return true;
    const k = rides(x.j).map((l) => (l.onDemand ? `od:${l.line || ''}` : String(l.line || ''))).join('>');
    if (seenDemand.has(k)) return false;
    seenDemand.add(k);
    return true;
  });
  const keyed = kept.map((x) => {
    if (x.n < 2 || !Number.isFinite(x.a) || !Number.isFinite(x.d)) return { ...x, k: x.d, after: 0 };
    // Just under the first such direct trip.
    let k = Infinity;
    for (const y of kept) {
      if (y === x || y.od || y.n >= x.n || !Number.isFinite(y.a)) continue;
      if (y.d < x.d || y.d - x.d > RANK_WINDOW_MS || y.a > x.a) continue;
      k = Math.min(k, y.d);
    }
    return Number.isFinite(k) ? { ...x, k, after: 1 } : { ...x, k: x.d, after: 0 };
  });
  return keyed.sort((x, y) => (x.k - y.k) || (x.after - y.after) || (x.d - y.d) || (x.i - y.i)).map((x) => x.j);
}
