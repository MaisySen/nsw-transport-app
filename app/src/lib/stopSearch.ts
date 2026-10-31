import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { useLocalIndex } from './localSearch';
import { localSearch, mergeSearch, searchBusy, searchKey, SEARCH_DEBOUNCE_MS } from './localSearchCore';
import type { SearchItem } from './types';

const memo = new Map<string, SearchItem[]>();
/** What a search screen says when nothing matched and the server could not be asked. */
export const SEARCH_FAILED_TEXT = "Can't reach the server. Stations still work; bus stops need a connection.";

/** Stops and stations matching what you type: at once from the lists kept on the phone, then the server's extras. */
export function useStopSearch(q: string) {
  const idx = useLocalIndex();
  const key = q.trim();
  const [server, setServer] = useState<{ key: string; items: SearchItem[] } | null>(null);
  const [loading, setLoading] = useState(false);
  // The server's part failed (offline, slow): screens say so instead of "No stops match that" (1 Nov polish).
  const [failed, setFailed] = useState<string | null>(null);
  const local = useMemo(() => localSearch(key, idx, 10), [key, idx]);
  useEffect(() => {
    setFailed(null);
    if (key.length < 2) { setServer(null); setLoading(false); return; }
    const mk = searchKey(key);
    const hit = memo.get(mk);
    if (hit) { setServer({ key, items: hit }); setLoading(false); return; }
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.search(key).then((r) => {
        if (!live) return;
        memo.set(mk, r.items || []);
        if (memo.size > 80) memo.delete(memo.keys().next().value as string);
        setServer({ key, items: r.items || [] });
      }).catch(() => { if (live) setFailed(key); }).finally(() => live && setLoading(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(t); };
  }, [key]);
  const items = mergeSearch(local, server && server.key === key ? server.items : [], 12);
  return { items, loading: searchBusy(loading, items.length), failed: failed === key };
}
