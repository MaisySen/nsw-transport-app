// Kept static answers with their version tags (etagCore.ts), on the phone. getJsonTagged asks the server with the kept
// copy's tag; a 304 returns the kept copy, a new answer replaces it. Used for station and line lists (trips.ts).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getJson, NOT_MODIFIED } from './server';
import { keepTag, touchTag, type TagIndex } from './etagCore';

const IDX = 'etag:idx:v1';
const bodyKey = (k: string) => `etag:b:${k}`;
let idx: TagIndex = {};
let loaded: Promise<void> | null = null;

function load(): Promise<void> {
  if (!loaded) loaded = AsyncStorage.getItem(IDX).then((raw) => { const v = raw ? JSON.parse(raw) : null; if (v && typeof v === 'object') idx = v; }).catch(() => {});
  return loaded;
}

/** A GET of static JSON through getJson, with the kept copy's tag when there is one. */
export async function getJsonTagged<T = any>(path: string, timeoutMs: number): Promise<T> {
  await load();
  let kept: T | null = null;
  const entry = idx[path];
  if (entry) {
    try { const raw = await AsyncStorage.getItem(bodyKey(path)); kept = raw ? (JSON.parse(raw) as T) : null; } catch { kept = null; }
  }
  let tag: string | null = null;
  const r = await getJson<T>(path, timeoutMs, undefined, { tag: kept != null && entry ? entry.e : null, onTag: (e) => { tag = e; } });
  if (r === NOT_MODIFIED) {
    idx = touchTag(idx, path, Date.now());
    AsyncStorage.setItem(IDX, JSON.stringify(idx)).catch(() => {});
    return kept as T;
  }
  try {
    const text = JSON.stringify(r);
    const next = keepTag(idx, path, tag, text.length, Date.now());
    idx = next.idx;
    if (idx[path]) await AsyncStorage.setItem(bodyKey(path), text);
    if (next.drop.length) await AsyncStorage.multiRemove(next.drop.map(bodyKey));
    await AsyncStorage.setItem(IDX, JSON.stringify(idx));
  } catch { /* kept next time */ }
  return r;
}
