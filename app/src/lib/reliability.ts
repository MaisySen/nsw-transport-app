// Reliability pick on service rows: asks the server, in small batches, how often a service left on time lately.
// A server without /api/reliability (404, the address in use until api_base moves) turns it off quietly.
import { useEffect, useState } from 'react';
import { apiBase } from './server';
import { relKey, relParams, relQuery, relText, type Reliability, type RelQuery } from './reliabilityCore';
import { useFlag } from './config';

const cache = new Map<string, { r: Reliability; at: number }>();
const missing = new Set<string>(); // servers that answered 404
let queue: { q: RelQuery; done: (r: Reliability) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const KEEP = 30 * 60000;

async function flush() {
  timer = null;
  const base = apiBase();
  const batch = queue.splice(0, 8);
  if (queue.length) timer = setTimeout(flush, 0);
  if (!batch.length) return;
  if (missing.has(base)) { batch.forEach((b) => b.done(null)); return; }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(`${base}/api/reliability?${relParams(batch.map((b) => b.q))}`, { signal: ctl.signal }).finally(() => clearTimeout(t));
    if (r.status === 404) { missing.add(base); batch.forEach((b) => b.done(null)); return; }
    const body: any = r.ok ? await r.json() : null;
    const items: any[] = Array.isArray(body?.items) ? body.items : [];
    batch.forEach((b, i) => {
      const v = (items[i] ?? null) as Reliability;
      cache.set(relKey(b.q), { r: v, at: Date.now() });
      b.done(v);
    });
  } catch {
    batch.forEach((b) => b.done(null));
  }
}

/** The answer for one service: cached for 30 minutes, otherwise queued into the next batch. */
export function getReliability(q: RelQuery): Promise<Reliability> {
  const hit = cache.get(relKey(q));
  if (hit && Date.now() - hit.at < KEEP) return Promise.resolve(hit.r);
  if (missing.has(apiBase())) return Promise.resolve(null);
  return new Promise((done) => {
    queue.push({ q, done });
    if (!timer) timer = setTimeout(flush, 40);
  });
}

/** "Left on time 9 of the last 10 weekdays" for a row's first leg, or null (flag off, old server, too little history). */
export function useReliabilityText(leg?: { kind?: string; line?: string; stopId?: string; planned?: string } | null): string | null {
  const on = useFlag('reliabilityPick');
  const q = on ? relQuery(leg) : null;
  const key = q ? relKey(q) : '';
  const [text, setText] = useState<string | null>(() => (q ? relText(cache.get(key)?.r) : null));
  useEffect(() => {
    if (!q) { setText(null); return; }
    let live = true;
    getReliability(q).then((r) => { if (live) setText(relText(r)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return text;
}
