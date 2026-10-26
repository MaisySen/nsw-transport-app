// Station and suburb names for Ask's understanding (askBrain.ts): the lists the server publishes at /stations/*.json
// (every train, metro, light rail and ferry stop, and every NSW suburb). Read once, kept on the phone for 14 days, so
// questions are understood offline after the first time. Until they arrive, Ask still works (the server matches names).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiBase, DEFAULT_BASE } from './server';
import { buildGaz, type Gaz } from './askBrain';
import { cleanTag, condHeaders } from './etagCore';

// v2 keeps each place's position too: a suburb with no station offers its nearest stations (didYouMean).
const KEY = 'ask:places:v2';
const KEEP_MS = 14 * 86400000;
const FILES = ['train', 'metro', 'lightrail', 'ferry', 'places'] as const;
let gaz: Gaz | null = null;
// The same lists as rows, for search as you type (localSearch.ts).
let rows: Record<string, any[]> | null = null;
let loading: Promise<Gaz | null> | null = null;

async function fetchAll(base: string, kept?: Kept | null): Promise<{ lists: Record<string, any[]>; tags: Record<string, string> } | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    // Each list's version tag rides along when the phone has that list (etagCore.ts); a 304 keeps the phone's list.
    const tags: Record<string, string> = {};
    const lists = await Promise.all(FILES.map(async (f) => {
      const have = kept && kept.lists && Array.isArray(kept.lists[f]) && kept.tags ? kept.tags[f] : undefined;
      const r = await fetch(`${base}/stations/${f}.json`, { signal: ctl.signal, headers: condHeaders(have) });
      if (r.status === 304 && have) { tags[f] = have; return { same: kept!.lists[f] }; }
      if (!r.ok) return null;
      const tag = cleanTag(r.headers?.get?.('etag'));
      if (tag) tags[f] = tag;
      return { fresh: await r.json() };
    }));
    if (lists.some((l) => !l || !Array.isArray((l as any).same ?? (l as any).fresh))) return null;
    const out: Record<string, any[]> = {};
    FILES.forEach((f, i) => {
      const l: any = lists[i];
      out[f] = l.same ? l.same : (l.fresh as any[]).map((row) => (f === 'places' ? [row[0], row[1], row[2]] : [row[0], row[1], row[2], row[3]]));
    });
    return { lists: out, tags };
  } catch { return null; } finally { clearTimeout(t); }
}
type Kept = { at: number; lists: Record<string, any[]>; tags?: Record<string, string> };

/** The place index, from the phone first, then the server (the one in use, then the first address). */
export function askPlaces(): Promise<Gaz | null> {
  if (gaz) return Promise.resolve(gaz);
  if (loading) return loading;
  loading = (async () => {
    let kept: Kept | null = null;
    try { kept = JSON.parse((await AsyncStorage.getItem(KEY)) || 'null'); } catch { kept = null; }
    if (kept && kept.lists && Date.now() - kept.at < KEEP_MS) { rows = kept.lists; gaz = buildGaz(kept.lists as any); return gaz; }
    const got = (await fetchAll(apiBase(), kept)) || (apiBase() !== DEFAULT_BASE ? await fetchAll(DEFAULT_BASE) : null);
    const lists = got ? got.lists : null;
    if (got && lists) {
      rows = lists;
      gaz = buildGaz(lists as any);
      AsyncStorage.setItem(KEY, JSON.stringify({ at: Date.now(), lists, tags: got.tags })).catch(() => {});
    } else if (kept && kept.lists) { rows = kept.lists; gaz = buildGaz(kept.lists as any); }
    return gaz;
  })().finally(() => { loading = null; });
  return loading;
}
/** The index if it is already in memory (no wait). */
export const askPlacesNow = () => gaz;
/** The kept lists as rows (train, metro, lightrail, ferry, places), if already read. */
export const askListsNow = () => rows;
