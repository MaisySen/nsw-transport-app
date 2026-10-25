// Station and suburb names for Ask's understanding (askBrain.ts): the lists the server publishes at /stations/*.json
// (every train, metro, light rail and ferry stop, and every NSW suburb). Read once, kept on the phone for 14 days, so
// questions are understood offline after the first time. Until they arrive, Ask still works (the server matches names).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiBase, DEFAULT_BASE } from './server';
import { buildGaz, type Gaz } from './askBrain';

// v2 keeps each place's position too: a suburb with no station offers its nearest stations (didYouMean).
const KEY = 'ask:places:v2';
const KEEP_MS = 14 * 86400000;
const FILES = ['train', 'metro', 'lightrail', 'ferry', 'places'] as const;
let gaz: Gaz | null = null;
let loading: Promise<Gaz | null> | null = null;

async function fetchAll(base: string): Promise<Record<string, any[]> | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const lists = await Promise.all(FILES.map((f) => fetch(`${base}/stations/${f}.json`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : null))));
    if (lists.some((l) => !Array.isArray(l))) return null;
    const out: Record<string, any[]> = {};
    FILES.forEach((f, i) => { out[f] = (lists[i] as any[]).map((row) => (f === 'places' ? [row[0], row[1], row[2]] : [row[0], row[1], row[2], row[3]])); });
    return out;
  } catch { return null; } finally { clearTimeout(t); }
}

/** The place index, from the phone first, then the server (the one in use, then the first address). */
export function askPlaces(): Promise<Gaz | null> {
  if (gaz) return Promise.resolve(gaz);
  if (loading) return loading;
  loading = (async () => {
    let kept: { at: number; lists: Record<string, any[]> } | null = null;
    try { kept = JSON.parse((await AsyncStorage.getItem(KEY)) || 'null'); } catch { kept = null; }
    if (kept && kept.lists && Date.now() - kept.at < KEEP_MS) { gaz = buildGaz(kept.lists as any); return gaz; }
    const lists = (await fetchAll(apiBase())) || (apiBase() !== DEFAULT_BASE ? await fetchAll(DEFAULT_BASE) : null);
    if (lists) {
      gaz = buildGaz(lists as any);
      AsyncStorage.setItem(KEY, JSON.stringify({ at: Date.now(), lists })).catch(() => {});
    } else if (kept && kept.lists) gaz = buildGaz(kept.lists as any);
    return gaz;
  })().finally(() => { loading = null; });
  return loading;
}
/** The index if it is already in memory (no wait). */
export const askPlacesNow = () => gaz;
