// Weekend trackwork card data: asks GET /api/trackwork about the trips on Home, Thursday 6pm to Sunday.
// A server without the route (404, the address in use until api_base moves) turns it off quietly.
import { useEffect, useState } from 'react';
import { apiBase } from './server';
import { useFlag } from './config';
import { inWindow, trackworkQuery, type TripLines, type TwResp } from './trackworkCore';

const missing = new Set<string>();
const cache = new Map<string, { at: number; r: TwResp }>();
const KEEP = 30 * 60000;

async function load(q: string): Promise<TwResp | null> {
  const base = apiBase();
  if (missing.has(base)) return null;
  const k = base + '?' + q;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < KEEP) return hit.r;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch(`${base}/api/trackwork?${q}`, { signal: ctl.signal }).finally(() => clearTimeout(t));
    if (res.status === 404) { missing.add(base); return null; }
    if (!res.ok) return null;
    const r = (await res.json()) as TwResp;
    cache.set(k, { at: Date.now(), r });
    return r;
  } catch {
    return null;
  }
}

/** The server's answer for these trips, or null outside the window, with the flag off or on an old server. */
export function useTrackwork(trips: TripLines[], now: number): TwResp | null {
  const on = useFlag('weekendTrackwork') && inWindow(now);
  const q = on ? trackworkQuery(trips) : '';
  const tick = Math.floor(now / KEEP);
  const [r, setR] = useState<TwResp | null>(() => (q ? cache.get(apiBase() + '?' + q)?.r || null : null));
  useEffect(() => {
    if (!q) { setR(null); return; }
    let live = true;
    load(q).then((x) => { if (live) setR(x); });
    return () => { live = false; };
  }, [q, tick]);
  return q ? r : null;
}
