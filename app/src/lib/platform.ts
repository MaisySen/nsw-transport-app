// Platform view, the phone side: opening the screen, and the station list used to name stops the service list
// leaves unnamed (the airport stations come back with no name). The list is the one the server publishes at
// /stations/train.json and /stations/metro.json, read once and kept on the phone for 14 days.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { apiBase, DEFAULT_BASE } from './server';
import type { StationRow } from './platformCore';
import { PLATFORM_VIEW } from './features';

/** Opens Platform view for a station, on the given service when there is one (a held departure row). Does nothing while the switch is off. */
export function openPlatform(o: { stop: string; name?: string | null; trip?: string | null; planned?: string | null; line?: string | null }) {
  if (!PLATFORM_VIEW) return;
  router.push({ pathname: '/platform', params: { stop: o.stop, name: o.name || '', trip: o.trip || '', planned: o.planned || '', line: o.line || '' } } as any);
}

const KEY = 'platform:stations:v1';
const KEEP_MS = 14 * 86400000;
let rows: StationRow[] | null = null;
let loading: Promise<StationRow[] | null> | null = null;

const ok = (r: any): r is StationRow => Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'string' && typeof r[2] === 'number' && typeof r[3] === 'number';

async function fetchRows(base: string): Promise<StationRow[] | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const lists = await Promise.all(['train', 'metro'].map((f) => fetch(`${base}/stations/${f}.json`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : null))));
    if (lists.some((l) => !Array.isArray(l))) return null;
    return (lists as any[][]).flat().filter(ok).map((r) => [r[0], r[1], r[2], r[3]] as StationRow);
  } catch { return null; } finally { clearTimeout(timer); }
}

/** Train and metro stations with their place, from the phone first, then the server. null when neither has them. */
export function stationRows(): Promise<StationRow[] | null> {
  if (rows) return Promise.resolve(rows);
  if (loading) return loading;
  loading = (async () => {
    let kept: { at: number; rows: StationRow[] } | null = null;
    try { kept = JSON.parse((await AsyncStorage.getItem(KEY)) || 'null'); } catch { kept = null; }
    if (kept && Array.isArray(kept.rows) && Date.now() - kept.at < KEEP_MS) { rows = kept.rows.filter(ok); return rows; }
    const got = (await fetchRows(apiBase())) || (apiBase() !== DEFAULT_BASE ? await fetchRows(DEFAULT_BASE) : null);
    if (got && got.length) {
      rows = got;
      AsyncStorage.setItem(KEY, JSON.stringify({ at: Date.now(), rows: got })).catch(() => {});
    } else if (kept && Array.isArray(kept.rows)) rows = kept.rows.filter(ok);
    return rows;
  })().finally(() => { loading = null; });
  return loading;
}
