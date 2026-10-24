import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { keepOffline, readOffline } from './offline';

/** Ticks every `ms` so countdowns move on their own. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * Loads data and keeps it fresh while the screen is focused and the app is in front.
 * Keeps the last good data on screen when a refresh fails.
 * With `cacheKey`, each good answer is also kept on the phone; when the server can't be reached and nothing is on
 * screen yet (a fresh start with no signal), the kept copy is shown with the services already gone taken out.
 * `offlineAt` is the time the shown times are from while the app is offline, else null.
 */
export function useLive<T>(load: (refresh: boolean) => Promise<T>, intervalMs = 15000, deps: any[] = [], opts: { cacheKey?: string } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const keyRef = useRef(opts.cacheKey);
  keyRef.current = opts.cacheKey;
  const busy = useRef(false);
  const shown = useRef<{ live: boolean; at: number | null }>({ live: false, at: null });

  const run = useCallback(async (refresh: boolean) => {
    if (busy.current) return;
    busy.current = true;
    const key = keyRef.current;
    try {
      const d = await loadRef.current(refresh);
      if (key !== keyRef.current) return;
      const at = Date.now();
      setData(d);
      setError(null);
      setUpdatedAt(at);
      setOfflineAt(null);
      shown.current = { live: true, at };
      if (key) keepOffline(key, d);
    } catch (e: any) {
      if (key !== keyRef.current) return;
      setError(String(e?.message || e));
      if (e?.offline) {
        if (shown.current.live) setOfflineAt(shown.current.at);
        else if (key) {
          const kept = await readOffline<T>(key);
          if (kept && key === keyRef.current && !shown.current.live) {
            setData(kept.data);
            setOfflineAt(kept.at);
            shown.current = { live: false, at: kept.at };
          }
        }
      }
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    setData(null);
    setError(null);
    setOfflineAt(null);
    shown.current = { live: false, at: null };
    run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useFocusEffect(
    useCallback(() => {
      let id: ReturnType<typeof setInterval> | null = setInterval(() => {
        if (AppState.currentState === 'active') run(true);
      }, intervalMs);
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') run(true);
      });
      return () => {
        if (id) clearInterval(id);
        id = null;
        sub.remove();
      };
    }, [intervalMs, run]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await run(true);
    setRefreshing(false);
  }, [run]);

  return { data, error, updatedAt, offlineAt, refreshing, refresh, setData };
}
