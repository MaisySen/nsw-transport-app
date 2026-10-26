// Keys for rows of live data (g13, 26 Oct). A row's key is its own service, never its place in the list: with the
// place in the key, every row below got a new key when the first service left or an earlier one was added, so React
// threw the whole list away and drew it again on each refresh (a flash on slow phones and lost press states).

/** The same keys in the same order, with "#2", "#3" added to a key seen before so every key is unique. */
export function stableKeys(keys: string[]): string[] {
  const seen = new Map<string, number>();
  return keys.map((k) => {
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    return n === 1 ? k : `${k}#${n}`;
  });
}

/** Each item with its stable key (stableKeys over keyOf), for `list.map` in a screen. */
export function withKeys<T>(list: T[], keyOf: (x: T) => string): { v: T; k: string }[] {
  const ks = stableKeys(list.map(keyOf));
  return list.map((v, i) => ({ v, k: ks[i] }));
}
