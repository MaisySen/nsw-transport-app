// Pure rule for prefetchStop (prefetch.ts), tested in Node.

/** The same stop is prefetched at most once every PREFETCH_GAP_MS (a press in, a scroll, a second press in). */
export const PREFETCH_GAP_MS = 10000;
export function prefetchDue(asked: Map<string, number>, key: string, now: number, max = 30): boolean {
  const last = asked.get(key);
  if (last != null && now - last < PREFETCH_GAP_MS) return false;
  asked.delete(key);
  asked.set(key, now);
  if (asked.size > max) asked.delete(asked.keys().next().value as string);
  return true;
}
