import { useCallback, useEffect, useRef, useState } from 'react';
import { keepOffline, readOffline } from './offline';
import { useCountdownNow, useNow, useReportCountdowns, useScreenPoll } from './activity';

/** Ticks so countdowns move on their own, only while the screen is on view and the app is in front. */
export { useCountdownNow, useNow, useReportCountdowns };

/**
 * Loads data and keeps it fresh while the screen is focused and the app is in front.
 * Keeps the last good data on screen when a refresh fails.
 * With `cacheKey`, each good answer is also kept on the phone; when the server can't be reached and nothing is on
 * screen yet (a fresh start with no signal), the kept copy is shown with the services already gone taken out.
 * `offlineAt` is the time the shown times are from while the app is offline, else null.
 */
export function useLive<T>(load: (refresh: boolean) => Promise<T>, intervalMs: number | ((data: T | null) => number) = 15000, deps: any[] = [], opts: { cacheKey?: string } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // A fresh start shows the copy kept on the phone at once (staleAt: when it is from) while the live answer loads.
  const [staleAt, setStaleAt] = useState<number | null>(null);
  const dataRef = useRef<T | null>(null);
  dataRef.current = data;
  const loadRef = useRef(load);
  loadRef.current = load;
  const keyRef = useRef(opts.cacheKey);
  keyRef.current = opts.cacheKey;
  const busy = useRef(false);
  const shown = useRef<{ live: boolean; at: number | null }>({ live: false, at: null });

  const run = useCallback(async (refresh: boolean): Promise<boolean> => {
    if (busy.current) return true;
    busy.current = true;
    const key = keyRef.current;
    try {
      const d = await loadRef.current(refresh);
      if (key !== keyRef.current) return true;
      const at = Date.now();
      setData(d);
      setError(null);
      setUpdatedAt(at);
      setOfflineAt(null);
      setStaleAt(null);
      shown.current = { live: true, at };
      if (key) keepOffline(key, d);
      return true;
    } catch (e: any) {
      if (key !== keyRef.current) return true;
      setError(String(e?.message || e));
      if (e?.offline) {
        if (shown.current.live) setOfflineAt(shown.current.at);
        else if (key) {
          const kept = await readOffline<T>(key);
          if (kept && key === keyRef.current && !shown.current.live) {
            setData(kept.data);
            setStaleAt(null);
            setOfflineAt(kept.at);
            shown.current = { live: false, at: kept.at };
          }
        }
      }
      return false;
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    setData(null);
    setError(null);
    setOfflineAt(null);
    setStaleAt(null);
    shown.current = { live: false, at: null };
    // The kept copy first (a read from the phone, a few milliseconds), then the live answer replaces it.
    const key = keyRef.current;
    if (key) {
      readOffline<T>(key).then((kept) => {
        if (kept && key === keyRef.current && !shown.current.live && !shown.current.at) {
          setData(kept.data);
          setStaleAt(kept.at);
        }
      }).catch(() => {});
    }
    run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Refreshes every intervalMs only while this screen is on view and the app is in front (activity.ts); after a
  // failure the wait doubles, so a dead connection is not hammered. Back on view, stale data refreshes at once.
  // A gap given as a function of the data on screen is read before each wait (adaptive polling, pollCore.adaptiveGapMs).
  const ivRef = useRef(intervalMs);
  ivRef.current = intervalMs;
  const runNow = useScreenPoll(() => run(true), typeof intervalMs === 'function' ? () => { const f = ivRef.current; return typeof f === 'function' ? f(dataRef.current) : f; } : intervalMs);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await runNow(); } finally { setRefreshing(false); }
  }, [runNow]);

  return { data, error, updatedAt, offlineAt, staleAt, refreshing, refresh, setData };
}
