// Usual lateness on stop boards, services and trip legs: asks the server, in small batches, how late a line
// usually is at a stop. A server without /api/usual (404: the address in use until api_base moves to the new
// API host) turns it off quietly for that address.
import { useEffect, useState } from 'react';
import { apiBase } from './server';
import { usualKey, usualParams, usualQuery, usualText, type Usual, type UsualQuery } from './usualCore';
import { useFlag } from './config';

const cache = new Map<string, { u: Usual; at: number }>();
const missing = new Set<string>(); // servers that answered 404
let queue: { q: UsualQuery; done: (u: Usual) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const KEEP = 60 * 60000;

async function flush() {
  timer = null;
  const base = apiBase();
  // One batch per hour asked about, so at= fits every item; at most 12 per request (the server's limit).
  const first = queue[0];
  if (!first) return;
  const hour = usualKey(first.q).split('|')[2];
  const batch = queue.filter((b) => usualKey(b.q).split('|')[2] === hour).slice(0, 12);
  queue = queue.filter((b) => !batch.includes(b));
  if (queue.length) timer = setTimeout(flush, 0);
  if (missing.has(base)) { batch.forEach((b) => b.done(null)); return; }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(`${base}/api/usual?${usualParams(batch.map((b) => b.q))}`, { signal: ctl.signal }).finally(() => clearTimeout(t));
    if (r.status === 404) { missing.add(base); batch.forEach((b) => b.done(null)); return; }
    const body: any = r.ok ? await r.json() : null;
    const items: any[] = Array.isArray(body?.items) ? body.items : [];
    batch.forEach((b, i) => {
      const v = (items[i] ?? null) as Usual;
      if (r.ok) cache.set(usualKey(b.q), { u: v, at: Date.now() });
      b.done(v);
    });
  } catch {
    batch.forEach((b) => b.done(null));
  }
}

/** The answer for one line and stop: cached for an hour, otherwise queued into the next batch. */
export function getUsual(q: UsualQuery): Promise<Usual> {
  const hit = cache.get(usualKey(q));
  if (hit && Date.now() - hit.at < KEEP) return Promise.resolve(hit.u);
  if (missing.has(apiBase())) return Promise.resolve(null);
  return new Promise((done) => {
    queue.push({ q, done });
    if (!timer) timer = setTimeout(flush, 40);
  });
}

/** "Usually 3 min late on weekday mornings" for a line at a stop, or null (flag off, old server, too little history). */
export function useUsualText(leg?: { kind?: string; line?: string; stopId?: string; planned?: string } | null): string | null {
  const on = useFlag('usualLate');
  const q = on ? usualQuery(leg) : null;
  const key = q ? usualKey(q) : '';
  const [text, setText] = useState<string | null>(() => (q ? usualText(cache.get(key)?.u) : null));
  useEffect(() => {
    if (!q) { setText(null); return; }
    let live = true;
    getUsual(q).then((u) => { if (live) setText(usualText(u)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return text;
}
