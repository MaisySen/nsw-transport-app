// Search as you type, the phone side: builds the local stop index (localSearchCore.ts) from the station lists Ask
// keeps (askPlaces.ts) and the bus and coach stop list (/stations/bus-stops.json, read once, kept 14 days in parts).
// Nothing here blocks: a screen gets whatever index is ready now and is told when a fuller one is built.
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { askListsNow, askPlaces } from './askPlaces';
import { NEW_API_BASE } from './server';
import { buildLocalIndex, type LocalIndex } from './localSearchCore';

const BUS_KEY = 'search:bus:v1';
const KEEP_MS = 14 * 86400000;
const PART_ROWS = 6000;
let busRows: any[] | null = null;
let idx: LocalIndex | null = null;
let builtWith = '';
let started: Promise<void> | null = null;
const subs = new Set<(i: LocalIndex | null) => void>();

function rebuild() {
  const lists = askListsNow();
  const tag = `${lists ? 1 : 0}${busRows ? 1 : 0}`;
  if (tag === builtWith || (!lists && !busRows)) return;
  builtWith = tag;
  idx = buildLocalIndex(lists, busRows);
  subs.forEach((f) => f(idx));
}

async function keptBus(): Promise<{ at: number; rows: any[] } | null> {
  try {
    const meta = JSON.parse((await AsyncStorage.getItem(BUS_KEY)) || 'null');
    if (!meta || !Number.isFinite(meta.parts) || meta.parts < 1) return null;
    const got = await AsyncStorage.multiGet(Array.from({ length: meta.parts }, (_, i) => `${BUS_KEY}:${i}`));
    const rows: any[] = [];
    for (const [, v] of got) { const part = JSON.parse(v || 'null'); if (!Array.isArray(part)) return null; rows.push(...part); }
    return { at: meta.at, rows };
  } catch { return null; }
}

async function fetchBus(): Promise<any[] | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(`${NEW_API_BASE}/stations/bus-stops.json`, { signal: ctl.signal });
    const body = r.ok ? await r.json() : null;
    return Array.isArray(body) && body.length ? body : null;
  } catch { return null; } finally { clearTimeout(t); }
}

async function loadBus() {
  const kept = await keptBus();
  if (kept) { busRows = kept.rows; rebuild(); if (Date.now() - kept.at < KEEP_MS) return; }
  const rows = await fetchBus();
  if (!rows) return;
  busRows = rows;
  rebuild();
  const parts: [string, string][] = [];
  for (let i = 0; i * PART_ROWS < rows.length; i++) parts.push([`${BUS_KEY}:${i}`, JSON.stringify(rows.slice(i * PART_ROWS, (i + 1) * PART_ROWS))]);
  AsyncStorage.multiSet(parts).then(() => AsyncStorage.setItem(BUS_KEY, JSON.stringify({ at: Date.now(), parts: parts.length }))).catch(() => {});
}

/** Starts reading the lists (once); safe to call on every search screen open. */
export function warmLocalSearch(): Promise<void> {
  if (!started) {
    started = Promise.all([askPlaces().then(rebuild).catch(() => {}), loadBus().catch(() => {})]).then(() => { rebuild(); });
    started.finally(() => { if (!idx || !busRows || !askListsNow()) started = null; });
  }
  return started;
}

export const localIndexNow = () => idx;

/** The local index for a screen: what is ready now, then the fuller one when the lists arrive. */
export function useLocalIndex(): LocalIndex | null {
  const [i, setI] = useState<LocalIndex | null>(idx);
  useEffect(() => {
    subs.add(setI);
    if (idx !== i) setI(idx);
    warmLocalSearch();
    return () => { subs.delete(setI); };
  }, []);
  return i;
}
