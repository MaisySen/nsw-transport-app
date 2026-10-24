import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { cacheFresh, parseStationMap, stopPageUrl, type StationMap } from './stationMapCore';

const mem = new Map<string, StationMap | null>();

/** TfNSW's station map for this stop, or null where its page lists none (or it can't be read). Kept on the phone. */
export async function stationMap(id: string): Promise<StationMap | null> {
  if (mem.has(id)) return mem.get(id)!;
  const key = `stationmap:${id}`;
  try {
    const raw = await AsyncStorage.getItem(key);
    const e = raw ? JSON.parse(raw) : null;
    if (cacheFresh(e, Date.now())) { mem.set(id, e.map || null); return e.map || null; }
  } catch {}
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(stopPageUrl(id), { signal: ctl.signal });
    if (!r.ok) return null;
    const map = parseStationMap(await r.text());
    mem.set(id, map);
    AsyncStorage.setItem(key, JSON.stringify({ at: Date.now(), map })).catch(() => {});
    return map;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** The station map for a stop screen; null until found, and always null on the web (the page can't be read there). */
export function useStationMap(id?: string) {
  const [map, setMap] = useState<StationMap | null>(null);
  useEffect(() => {
    setMap(null);
    if (!id || Platform.OS === 'web') return;
    let live = true;
    stationMap(String(id)).then((m) => { if (live) setMap(m); });
    return () => { live = false; };
  }, [id]);
  return map;
}
