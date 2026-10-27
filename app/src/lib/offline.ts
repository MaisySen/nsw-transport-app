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
// The copies kept on the phone, read in one go at start (warmOffline) and parsed only when a screen asks for one, so
// the first frame of Home, a starred stop or a saved trip already has its times (g13, 26 Oct).
const disk = new Map<string, string>();
let warmed: Promise<void> | null = null;

/**
 * Reads every kept copy into memory in one storage call (the index, then one multiGet), while the profile, config and
 * saved places load beside it. peekOffline then answers on the first frame with no storage read of its own.
 */
export function warmOffline(): Promise<void> {
  if (warmed) return warmed;
  warmed = (async () => {
    try {
      const raw = await AsyncStorage.getItem(INDEX);
      const keys: string[] = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(keys) || !keys.length) return;
      const rows = await AsyncStorage.multiGet(keys.filter((k) => typeof k === 'string').slice(0, MAX_ENTRIES));
      for (const [k, v] of rows) if (v && !mem.has(k)) disk.set(k, v);
    } catch {}
  })();
  return warmed;
}

function fromDisk(key: string): { at: number; data: unknown } | null {
  const raw = disk.get(key);
  if (raw == null) return null;
  disk.delete(key);
  try {
    const e = usable(JSON.parse(raw), Date.now());
    if (!e) return null;
    const v = { at: e.at, data: cleanAlertTexts(e.data) };
    if (!mem.has(key)) mem.set(key, v);
    return mem.get(key) || v;
  } catch {
    return null;
  }
}

/** Keeps a copy of a good answer on the phone for a start with no signal. */
export function keepOffline(key: string, data: unknown) {
  if (!worthKeeping(data)) return;
  const now = Date.now();
  mem.delete(key);
  disk.delete(key);
  mem.set(key, { at: now, data });
  while (mem.size > MAX_ENTRIES) mem.delete(mem.keys().next().value as string);
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

/** Drops every kept copy held in memory this session (Delete all my data; storage is cleared by the caller). */
export function forgetOffline() {
  mem.clear();
  disk.clear();
  lastWrite.clear();
}

/**
 * Holds an answer in memory only (no storage write): a press in prefetch or a board's next stops read, so the next
 * screen's first frame has it. Bounded by the same cap as kept copies; the screen's own live answer is what gets kept.
 */
export function keepMem(key: string, data: unknown, at = Date.now()) {
  if (!worthKeeping(data)) return;
  const had = mem.get(key);
  if (had && had.at > at) return;
  mem.delete(key);
  disk.delete(key);
  mem.set(key, { at, data });
  while (mem.size > MAX_ENTRIES) mem.delete(mem.keys().next().value as string);
}

/** When the copy in memory for this key was made, or null. No storage read. */
export function memAt(key: string): number | null {
  const e = mem.get(key);
  return e ? e.at : null;
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

/** The copy kept in memory this session (or read at start by warmOffline) for this key, gone services taken out, or
 * null. No storage read. */
export function peekOffline<T>(key: string): { at: number; data: T } | null {
  const e = usable(mem.get(key) || fromDisk(key), Date.now());
  if (!e) return null;
  const now = Date.now();
  const data = prune(e.data as T, now);
  return worthKeeping(data) ? { at: e.at, data } : null;
}
