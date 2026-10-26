// Less walking: the longest walk you will take on a trip (Any, 5, 10, 15 or 20 min) and "Prefer a bus over a long
// walk". Kept on this phone. Trips are asked for as before (the choice rides along as `maxWalk` and `lessWalk` for a
// server that honours them); the phone then leaves out trips with a longer walk and, with Prefer on, moves a trip
// with a long walk below one that walks less and arrives at most PREFER_SLACK_MIN later. No React here
// (test/walkpref.test.mjs).

export type WalkPref = { max: number; prefer: boolean };
export const WALK_CHOICES = [0, 5, 10, 15, 20] as const;
export const WALK_DEFAULT: WalkPref = { max: 0, prefer: false };
/** A walk longer than this (min) is a long walk for Prefer a bus. */
export const LONG_WALK_MIN = 8;
/** Prefer a bus moves a long walk trip below a shorter walk trip that arrives at most this many minutes later. */
export const PREFER_SLACK_MIN = 10;

type L = { kind?: string; durationMin?: number | null };
type J = { legs?: ReadonlyArray<L> | null; arrive?: string | null };

/** A stored value read back safely: unknown or broken values are Any and off. */
export function readWalkPref(v: unknown): WalkPref {
  const o = (v && typeof v === 'object' ? v : {}) as { max?: unknown; prefer?: unknown };
  const max = typeof o.max === 'number' && (WALK_CHOICES as readonly number[]).includes(o.max) ? o.max : 0;
  return { max, prefer: o.prefer === true };
}

/** The longest single walk on a journey, in minutes (0 with no walk). */
export function longestWalk(j: J): number {
  let m = 0;
  for (const l of j.legs || []) if (l && l.kind === 'walk' && typeof l.durationMin === 'number' && Number.isFinite(l.durationMin)) m = Math.max(m, l.durationMin);
  return m;
}

/** "Any walk", "Walk up to 10 min". */
export function walkChoiceText(max: number): string {
  return max > 0 ? `Walk up to ${max} min` : 'Any walk';
}

/** The short value for the trip screen's Walking row: "Any", "Up to 10 min", plus ", less walking" with Prefer on. */
export function walkValueText(p: WalkPref): string {
  const a = p.max > 0 ? `Up to ${p.max} min` : 'Any';
  return p.prefer ? `${a}, prefer bus` : a;
}

/** Query words for the trip request: none at the default. */
export function walkQuery(p: WalkPref): Record<string, string> {
  const q: Record<string, string> = {};
  if (p.max > 0) q.maxWalk = String(p.max);
  if (p.prefer) q.lessWalk = '1';
  return q;
}

const arrMs = (j: J) => { const t = j.arrive ? Date.parse(j.arrive) : NaN; return Number.isFinite(t) ? t : NaN; };

/**
 * Prefer a bus over a long walk: each trip whose longest walk is over LONG_WALK_MIN goes just below the last trip that
 * walks no more than that and arrives at most PREFER_SLACK_MIN later. Others keep their order. Stable.
 */
export function preferLessWalk<T extends J>(list: ReadonlyArray<T>): T[] {
  const long = list.map((j) => longestWalk(j) > LONG_WALK_MIN);
  const keyed = list.map((j, i) => {
    if (!long[i]) return { j, k: i };
    const a = arrMs(j);
    let anchor = -1;
    list.forEach((o, k) => {
      if (long[k] || k <= i) return;
      const b = arrMs(o);
      if (Number.isFinite(a) && Number.isFinite(b) && b - a <= PREFER_SLACK_MIN * 60000) anchor = k;
    });
    return { j, k: anchor >= 0 ? anchor + 0.5 + i / 1000 : i };
  });
  return keyed.sort((x, y) => x.k - y.k).map((x) => x.j);
}

export type WalkFiltered<T> = { list: T[]; hidden: number; allOver: boolean };

/**
 * The trips to show for a walking choice. With a limit, trips with a longer single walk are left out and counted in
 * `hidden`; when every trip walks longer, all of them stay (`allOver`), so the screen is never empty because of it.
 */
export function applyWalkPref<T extends J>(list: ReadonlyArray<T>, p: WalkPref): WalkFiltered<T> {
  let out = list.slice();
  let hidden = 0, allOver = false;
  if (p.max > 0 && out.length) {
    const ok = out.filter((j) => longestWalk(j) <= p.max);
    if (ok.length) { hidden = out.length - ok.length; out = ok; } else allOver = true;
  }
  if (p.prefer) out = preferLessWalk(out);
  return { list: out, hidden, allOver };
}

/** The note under the trips: what the walking choice did, or '' when it did nothing. */
export function walkNote(r: { hidden: number; allOver: boolean }, p: WalkPref): string {
  if (p.max <= 0) return '';
  if (r.allOver) return `Every trip found walks more than ${p.max} min, so they all show.`;
  if (r.hidden) return `${r.hidden} trip${r.hidden === 1 ? '' : 's'} with a walk over ${p.max} min not shown.`;
  return '';
}
