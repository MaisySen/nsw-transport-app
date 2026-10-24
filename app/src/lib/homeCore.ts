// Small pure helpers for Home, Plan and the trip screens, kept apart from React so tests can run them in Node.

/** "1 stop", "2 stops". */
export function plural(n: number, one: string, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Countdown chip parts for a service row: "4" + "min", "Now" within a minute either way, "Left" once it has
 * gone (rows from Earlier services), or the clock time (from `hm`) an hour or more ahead.
 */
export function chipTime(t: number, now: number, hm: (t: number) => string): { big: string; unit: string } {
  const diff = t - now;
  if (!Number.isFinite(diff)) return { big: '', unit: '' };
  if (diff < -60000) return { big: 'Left', unit: '' };
  if (diff < 60000) return { big: 'Now', unit: '' };
  const m = Math.floor(diff / 60000);
  if (m < 60) return { big: String(m), unit: 'min' };
  return { big: hm(t), unit: '' };
}

/**
 * Saved trips deleted on this phone, kept until the server list no longer has them, so a deleted trip leaves
 * Home at once instead of when the server answers. Entries expire after `ttlMs` either way.
 */
export function makeDeletedNames(ttlMs = 120000) {
  const gone = new Map<string, number>();
  const key = (n: string) => n.trim().toLowerCase();
  return {
    add(name: string, now = Date.now()) { if (name) gone.set(key(name), now); },
    has(name: string, now = Date.now()) {
      const t = gone.get(key(name || ''));
      if (t == null) return false;
      if (now - t > ttlMs) { gone.delete(key(name)); return false; }
      return true;
    },
    /** The server list without the names deleted here; names the server no longer has are forgotten. */
    filter<T extends { name: string }>(items: T[], now = Date.now()): T[] {
      const names = new Set(items.map((i) => key(i.name || '')));
      for (const k of [...gone.keys()]) if (!names.has(k)) gone.delete(k);
      return items.filter((i) => !this.has(i.name, now));
    },
  };
}

/** Same two ends, either way round (a saved trip that is the Home and Work commute). */
export function sameEnds(a: { from: { id: string }; to: { id: string } }, b: { from: { id: string }; to: { id: string } }) {
  return (a.from.id === b.from.id && a.to.id === b.to.id) || (a.from.id === b.to.id && a.to.id === b.from.id);
}

/**
 * Plan: the search results to show. While a field already holds a chosen stop its text is that stop's name,
 * so no results show (Recent trips stay in view); results show while the person types.
 */
export function planResults<T>(items: T[], text: string, chosen: boolean): T[] {
  return !chosen && text.trim().length >= 2 ? items : [];
}

/** The line under a Plan or setup search that found nothing: no match, or no connection. */
export function noMatchText(text: string, loading: boolean, count: number, failed: boolean): string | null {
  if (text.trim().length < 2 || loading || count) return null;
  return failed ? "Can't search right now. Check your connection." : 'No stops match that';
}
