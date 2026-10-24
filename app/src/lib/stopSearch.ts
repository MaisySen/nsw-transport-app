import { useEffect, useState } from 'react';
import { api } from './api';
import type { SearchItem } from './types';

/** Stops and stations matching what you type, after a short pause. */
export function useStopSearch(q: string) {
  const [items, setItems] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setItems([]); return; }
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.search(q.trim()).then((r) => { if (live) setItems(r.items || []); }).catch(() => {}).finally(() => live && setLoading(false));
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  return { items, loading };
}
