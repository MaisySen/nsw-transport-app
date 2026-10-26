// Version tags for static data (speed pass part 2, 27 Oct; playbook pattern 9): stations, line lists and timetable
// packs keep the server's ETag beside their copy and send it back as If-None-Match; a 304 answer means the copy is
// still the server's, so nothing is downloaded again. No phone dependencies, so the unit tests can load it.

/** Kept copies with a tag: at most this many, this many characters each, this many in all. */
export const TAG_MAX_ENTRIES = 16;
export const TAG_MAX_CHARS = 256 * 1024;
export const TAG_MAX_TOTAL = 1536 * 1024;

/** A usable ETag header (strong or weak), or null. */
export function cleanTag(v: string | null | undefined): string | null {
  if (!v || typeof v !== 'string') return null;
  const t = v.trim();
  return /^(W\/)?"[^"\r\n]{1,200}"$/.test(t) ? t : null;
}

/** The If-None-Match header for a kept copy, or none. */
export function condHeaders(tag: string | null | undefined): Record<string, string> {
  const t = cleanTag(tag);
  return t ? { 'if-none-match': t } : {};
}

export type TagEntry = { e: string; at: number; n: number };
export type TagIndex = Record<string, TagEntry>;

/**
 * The index after keeping one copy (key, tag, size in characters): oldest copies dropped past the caps. Returns the
 * new index and the keys whose bodies should be removed. A copy too big, or with no tag, is not kept (and an old one
 * under that key is dropped).
 */
export function keepTag(idx: TagIndex, key: string, tag: string | null | undefined, chars: number, now: number): { idx: TagIndex; drop: string[] } {
  const out: TagIndex = { ...idx };
  const drop: string[] = [];
  const t = cleanTag(tag);
  delete out[key];
  if (!t || !(chars > 0) || chars > TAG_MAX_CHARS) return { idx: out, drop: idx[key] ? [key] : [] };
  out[key] = { e: t, at: now, n: chars };
  const keys = Object.keys(out).sort((a, b) => out[a].at - out[b].at);
  let total = keys.reduce((s, k) => s + out[k].n, 0);
  while (keys.length > TAG_MAX_ENTRIES || total > TAG_MAX_TOTAL) {
    const k = keys.shift() as string;
    if (k === key) { keys.push(k); if (keys.length === 1) break; continue; }
    total -= out[k].n;
    delete out[k];
    drop.push(k);
  }
  return { idx: out, drop };
}

/** The index after a 304: the copy counts as just checked. */
export function touchTag(idx: TagIndex, key: string, now: number): TagIndex {
  return idx[key] ? { ...idx, [key]: { ...idx[key], at: now } } : idx;
}
