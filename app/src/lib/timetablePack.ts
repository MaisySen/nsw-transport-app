// On phone timetable packs (docs/TIMETABLE_PACKS.md): storage and fetching. Rules live in timetablePackCore.ts.
// Each stop that keeps a pack (starred, saved trips, home and work, recent) has its own AsyncStorage key. The packs
// are read into memory once at start, so a stop screen or a Home card reads its pack on the first frame with no wait.
// Packs are fetched again once a day, one at a time, at start and when the app comes back to the front: no polling.
// Packs come from api.transportsydney.app only (the first server has no /api/pack); a stop with no pack (404) just
// uses the live board as before.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { NEW_API_BASE } from './server';
import { store } from './store';
import { cleanTag, condHeaders } from './etagCore';
import { PACK_MAX_CHARS, packBoard, packBoardAt, packCovers, packDue, packStops, packValid, type KeptPack, type PackBoard } from './timetablePackCore';

const INDEX = 'tt:index';
const keyOf = (stop: string) => `tt:pack:${stop}`;
const mem = new Map<string, KeptPack>();
/** Stops the server has no pack for (404) this session, so they are not asked again until the next start. */
const none = new Set<string>();
let loading: Promise<void> | null = null;
let syncing: Promise<void> | null = null;

/** Reads every kept pack into memory, once. Safe to call often. */
export function loadPacks(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      try {
        const raw = await AsyncStorage.getItem(INDEX);
        const ids: string[] = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(ids) || !ids.length) return;
        const got = await AsyncStorage.multiGet(ids.map(keyOf));
        const now = Date.now();
        for (const [k, v] of got) {
          if (!v) continue;
          try {
            const e = JSON.parse(v) as KeptPack;
            if (e && typeof e.at === 'number' && packValid(e.pack, now)) mem.set(k.slice('tt:pack:'.length), e);
          } catch { /* a broken copy is fetched again */ }
        }
      } catch { /* nothing kept */ }
    })();
  }
  return loading;
}

/**
 * The pack board for a stop from memory (no wait), or null when it has no pack or no services left in it. With `at` (a
 * board at another time), the board from that moment, only when the pack covers it (packCovers).
 */
export function peekPackBoard(stop: string, mode?: string | null, at?: number | null): PackBoard | null {
  const e = mem.get(stop);
  if (!e) return null;
  const now = Date.now();
  if (!packValid(e.pack, now)) return null;
  if (at != null && !packCovers(e.pack, at)) return null;
  const b = at != null ? packBoardAt(e.pack, at, now, mode) : packBoard(e.pack, now, mode);
  return b.items.length ? b : null;
}

/** The same after the kept packs have been read (a cold start). */
export async function readPackBoard(stop: string, mode?: string | null, at?: number | null): Promise<PackBoard | null> {
  await loadPacks();
  return peekPackBoard(stop, mode, at);
}

async function fetchPack(stop: string): Promise<'ok' | 'none' | 'fail'> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    // The kept pack's version tag rides along (etagCore.ts): 304 means the kept pack is still the server's.
    const old = mem.get(stop);
    const r = await fetch(`${NEW_API_BASE}/api/pack?stop=${encodeURIComponent(stop)}`, { signal: ctl.signal, headers: condHeaders(old?.etag) });
    if (r.status === 304 && old && old.etag) {
      const now = Date.now();
      if (!packValid(old.pack, now)) return 'fail';
      const e: KeptPack = { ...old, at: now };
      mem.set(stop, e);
      await AsyncStorage.setItem(keyOf(stop), JSON.stringify(e));
      return 'ok';
    }
    if (r.status === 404) return 'none';
    if (!r.ok) return 'fail';
    const text = await r.text();
    if (text.length > PACK_MAX_CHARS) return 'none';
    const pack = JSON.parse(text);
    const now = Date.now();
    if (!packValid(pack, now)) return 'fail';
    const tag = cleanTag(r.headers?.get?.('etag'));
    const e: KeptPack = tag ? { at: now, pack, etag: tag } : { at: now, pack };
    mem.set(stop, e);
    await AsyncStorage.setItem(keyOf(stop), JSON.stringify(e));
    return 'ok';
  } catch {
    return 'fail';
  } finally {
    clearTimeout(t);
  }
}

async function writeIndex(keep: string[]) {
  const drop = [...mem.keys()].filter((k) => !keep.includes(k));
  for (const k of drop) mem.delete(k);
  try {
    const raw = await AsyncStorage.getItem(INDEX);
    const old: string[] = raw ? JSON.parse(raw) : [];
    const gone = (Array.isArray(old) ? old : []).filter((k) => !keep.includes(k));
    await AsyncStorage.setItem(INDEX, JSON.stringify(keep.filter((k) => mem.has(k))));
    if (gone.length) await AsyncStorage.multiRemove(gone.map(keyOf));
  } catch { /* the next sync tries again */ }
}

/**
 * Brings the kept packs in line with the stops that want one: fetches the ones that are missing or a day old, one at a
 * time, and drops packs for stops no longer wanted. Stops after the first network failure (no signal: try next time).
 */
export function syncPacks(stops?: string[]): Promise<void> {
  if (syncing) return syncing;
  // Before the saved stops are read the list would be empty and every kept pack would be dropped.
  if (!stops && !store.ready()) return Promise.resolve();
  const list = stops || packStops(store.snapshot());
  syncing = (async () => {
    await loadPacks();
    for (const s of list) {
      if (none.has(s) || !packDue(mem.get(s), Date.now())) continue;
      const r = await fetchPack(s);
      if (r === 'none') none.add(s);
      if (r === 'fail') break;
    }
    await writeIndex(list);
  })().finally(() => { syncing = null; });
  return syncing;
}

/** A stop just opened: fetch its pack if it is one that keeps a pack and it has none or an old one. */
export function packWanted(stop: string): void {
  const wanted = packStops(store.snapshot());
  if (!store.ready() || !wanted.includes(stop) || none.has(stop) || !packDue(mem.get(stop), Date.now())) return;
  syncPacks(wanted).catch(() => {});
}

let started = false;
/** Called once from the root layout: reads kept packs now, syncs after `deferMs`, and again on each return to front. */
export function startPacks(deferMs: number): () => void {
  if (started) return () => {};
  started = true;
  loadPacks();
  const first = setTimeout(() => { syncPacks().catch(() => {}); }, deferMs);
  const sub = AppState.addEventListener('change', (s) => { if (s === 'active') syncPacks().catch(() => {}); });
  return () => { clearTimeout(first); sub.remove(); started = false; };
}
