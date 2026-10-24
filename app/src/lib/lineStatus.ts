// Status of my lines: asks GET /api/lines about the lines on Home's trips, every 2 minutes while shown.
// A server without the route (404, the address in use until api_base moves) turns it off quietly.
import { useEffect, useState } from 'react';
import { apiBase } from './server';
import { useFlag } from './config';
import type { LinesResp } from './lineStatusCore';

const missing = new Set<string>();
const cache = new Map<string, { at: number; r: LinesResp }>();
const KEEP = 2 * 60000;

async function load(q: string): Promise<LinesResp | null> {
  const base = apiBase();
  if (missing.has(base)) return null;
  const k = base + '|' + q;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < KEEP) return hit.r;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    const res = await fetch(`${base}/api/lines?l=${encodeURIComponent(q)}`, { signal: ctl.signal }).finally(() => clearTimeout(t));
    if (res.status === 404) { missing.add(base); return null; }
    if (!res.ok) return hit?.r || null;
    const r = (await res.json()) as LinesResp;
    cache.set(k, { at: Date.now(), r });
    return r;
  } catch {
    return hit?.r || null;
  }
}

export function useLineStatus(lines: string[], now: number): LinesResp | null {
  const on = useFlag('lineStatus');
  const q = on ? lines.join(',') : '';
  const tick = Math.floor(now / KEEP);
  const [r, setR] = useState<LinesResp | null>(() => (q ? cache.get(apiBase() + '|' + q)?.r || null : null));
  useEffect(() => {
    if (!q) { setR(null); return; }
    let live = true;
    load(q).then((x) => { if (live) setR(x); });
    return () => { live = false; };
  }, [q, tick]);
  return q ? r : null;
}
