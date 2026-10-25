import AsyncStorage from '@react-native-async-storage/async-storage';
import { MAX_ENTRIES, prune, touch, usable, worthKeeping } from './offlineCore';
import { cleanAlertTexts } from './htmlTextCore';

const INDEX = 'offline:index';
/** At most one write per answer every 60 s: refreshes come every 15 s and the times barely move. */
const WRITE_GAP_MS = 60000;
const lastWrite = new Map<string, number>();
let chain: Promise<unknown> = Promise.resolve();
// The newest good answer per key this session, in memory: a screen opened again shows it on its first frame.
const mem = new Map<string, { at: number; data: unknown }>();

/** Keeps a copy of a good answer on the phone for a start with no signal. */
export function keepOffline(key: string, data: unknown) {
  if (!worthKeeping(data)) return;
  const now = Date.now();
  mem.delete(key);
  mem.set(key, { at: now, data });
  if (mem.size > MAX_ENTRIES) mem.delete(mem.keys().next().value as string);
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
    // A copy kept before alert words were cleaned on arrival is cleaned here too (htmlTextCore).
    return e ? { at: e.at, data: prune(cleanAlertTexts(e.data as T), now) } : null;
  } catch {
    return null;
  }
}

/** The copy kept in memory this session for this key, gone services taken out, or null. No storage read. */
export function peekOffline<T>(key: string): { at: number; data: T } | null {
  const e = usable(mem.get(key) || null, Date.now());
  if (!e) return null;
  const now = Date.now();
  const data = prune(e.data as T, now);
  return worthKeeping(data) ? { at: e.at, data } : null;
}
