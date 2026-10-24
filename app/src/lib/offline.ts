import AsyncStorage from '@react-native-async-storage/async-storage';
import { MAX_ENTRIES, prune, touch, usable, worthKeeping } from './offlineCore';

const INDEX = 'offline:index';
/** At most one write per answer every 60 s: refreshes come every 15 s and the times barely move. */
const WRITE_GAP_MS = 60000;
const lastWrite = new Map<string, number>();
let chain: Promise<unknown> = Promise.resolve();

/** Keeps a copy of a good answer on the phone for a start with no signal. */
export function keepOffline(key: string, data: unknown) {
  if (!worthKeeping(data)) return;
  const now = Date.now();
  if (now - (lastWrite.get(key) || 0) < WRITE_GAP_MS) return;
  lastWrite.set(key, now);
  // One write at a time so two cards never race on the index.
  chain = chain.then(async () => {
    try {
      const raw = await AsyncStorage.getItem(INDEX);
      const { index, evict } = touch(raw ? JSON.parse(raw) : [], key, MAX_ENTRIES);
      await AsyncStorage.setItem(key, JSON.stringify({ at: now, data }));
      await AsyncStorage.setItem(INDEX, JSON.stringify(index));
      if (evict.length) await AsyncStorage.multiRemove(evict);
    } catch {}
  });
}

/** The stored copy for this key with the services already gone taken out, or null. */
export async function readOffline<T>(key: string): Promise<{ at: number; data: T } | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const now = Date.now();
    const e = usable(raw ? JSON.parse(raw) : null, now);
    return e ? { at: e.at, data: prune(e.data as T, now) } : null;
  } catch {
    return null;
  }
}
