import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

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
 */
export function useLive<T>(load: (refresh: boolean) => Promise<T>, intervalMs = 15000, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const busy = useRef(false);

  const run = useCallback(async (refresh: boolean) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const d = await loadRef.current(refresh);
      setData(d);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    setData(null);
    setError(null);
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

  return { data, error, updatedAt, refreshing, refresh, setData };
}
