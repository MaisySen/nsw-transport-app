import { useCallback, useEffect, useRef, useState } from 'react';
import { keepOffline, peekOffline, readOffline } from './offline';
import { createLatest, createStamp } from './pollCore';
import { answerTime } from './liveLabelCore';
import { useCountdownNow, useNow, useReportCountdowns, useScreenPoll } from './activity';

/** Ticks so countdowns move on their own, only while the screen is on view and the app is in front. */
export { useCountdownNow, useNow, useReportCountdowns };

/**
 * Loads data and keeps it fresh while the screen is focused and the app is in front.
 * Keeps the last good data on screen when a refresh fails.
 * With `cacheKey`, each good answer is also kept on the phone; when the server can't be reached and nothing is on
 * screen yet (a fresh start with no signal), the kept copy is shown with the services already gone taken out.
 * `offlineAt` is the time the shown times are from while the app is offline, else null.
 * `staleAt` is set while a kept copy is on screen and the live answer is still on its way (label it, never as live).
 *
 * Race rule (createLatest in pollCore.ts): every change of `deps` starts a new round. An answer that comes back for an
 * earlier round (the stop, service, time or query shown a moment ago) is dropped, never shown under the new one, and
 * the new round asks at once instead of waiting for the old request. `load` gets an AbortSignal that is aborted when
 * its round is over.
 */
export function useLive<T>(load: (refresh: boolean, signal?: AbortSignal) => Promise<T>, intervalMs: number | ((data: T | null) => number) = 15000, deps: any[] = [], opts: { cacheKey?: string; enabled?: boolean } = {}) {
  // A copy kept in memory this session shows on the first frame (a screen opened again, Home after a tab change).
  const first = useRef<{ at: number; data: T } | null | undefined>(undefined);
  if (first.current === undefined) first.current = opts.cacheKey ? peekOffline<T>(opts.cacheKey) : null;
  const [data, setData] = useState<T | null>(first.current ? first.current.data : null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // A fresh start shows the copy kept on the phone at once (staleAt: when it is from) while the live answer loads.
  const [staleAt, setStaleAt] = useState<number | null>(first.current ? first.current.at : null);
  const dataRef = useRef<T | null>(null);
  dataRef.current = data;
  const loadRef = useRef(load);
  loadRef.current = load;
  const keyRef = useRef(opts.cacheKey);
  keyRef.current = opts.cacheKey;
  const latest = useRef<ReturnType<typeof createLatest> | null>(null);
  if (!latest.current) latest.current = createLatest();
  const shown = useRef<{ live: boolean; at: number | null }>({ live: false, at: first.current ? first.current.at : null });

  const run = useCallback(async (refresh: boolean): Promise<boolean> => {
    const L = latest.current!;
    const round = L.begin();
    if (!round) return true;
    const key = keyRef.current;
    try {
      const d = await loadRef.current(refresh, round.signal);
      if (!round.current()) return true;
      // When the times were read (a cached answer from the server says so), not just when they arrived (honest "Updated").
      const at = answerTime(d, Date.now());
      setData(d);
      setError(null);
      setUpdatedAt(at);
      setOfflineAt(null);
      setStaleAt(null);
      shown.current = { live: true, at };
      if (key) keepOffline(key, d);
      return true;
    } catch (e: any) {
      if (!round.current()) return true;
      setError(String(e?.message || e));
      if (e?.offline) {
        if (shown.current.live) setOfflineAt(shown.current.at);
        else if (key) {
          const kept = peekOffline<T>(key) ?? (await readOffline<T>(key));
          if (round.current() && !shown.current.live) {
            if (kept) {
              setData(kept.data);
              setOfflineAt(kept.at);
              shown.current = { live: false, at: kept.at };
            } else if (shown.current.at) setOfflineAt(shown.current.at);
            setStaleAt(null);
          }
        }
      }
      return false;
    } finally {
      round.end();
    }
  }, []);

  const mounted = useRef(false);
  useEffect(() => {
    const L = latest.current!;
    const gen = L.next();
    const key = keyRef.current;
    if (mounted.current) {
      // What the screen shows changed: start clean, with this key's copy kept in memory when there is one.
      const mem = key ? peekOffline<T>(key) : null;
      setData(mem ? mem.data : null);
      setStaleAt(mem ? mem.at : null);
      setUpdatedAt(null);
      setError(null);
      setOfflineAt(null);
      shown.current = { live: false, at: mem ? mem.at : null };
    }
    mounted.current = true;
    // The kept copy first (a read from the phone, a few milliseconds), then the live answer replaces it.
    if (key && !shown.current.at) {
      readOffline<T>(key).then((kept) => {
        if (kept && gen === L.gen() && !shown.current.live && !shown.current.at) {
          setData(kept.data);
          setStaleAt(kept.at);
          shown.current = { live: false, at: kept.at };
        }
      }).catch(() => {});
    }
    run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  // Closed: whatever is still on its way is dropped.
  useEffect(() => () => { latest.current?.next(); mounted.current = false; }, []);

  // Refreshes every intervalMs only while this screen is on view and the app is in front (activity.ts); after a
  // failure the wait doubles, so a dead connection is not hammered. Back on view, stale data refreshes at once.
  // A gap given as a function of the data on screen is read before each wait (adaptive polling, pollCore.adaptiveGapMs).
  const ivRef = useRef(intervalMs);
  ivRef.current = intervalMs;
  // enabled false (a Simple mode page that is not the one on view): nothing polls.
  // updatedAt (each answer) re-reads an adaptive gap: the first wait is set before the first answer has arrived.
  const runNow = useScreenPoll(() => run(true), typeof intervalMs === 'function' ? () => { const f = ivRef.current; return typeof f === 'function' ? f(dataRef.current) : f; } : intervalMs, { enabled: opts.enabled ?? true, retimeKey: updatedAt });

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await runNow(); } finally { setRefreshing(false); }
  }, [runNow]);

  return { data, error, updatedAt, offlineAt, staleAt, refreshing, refresh, setData };
}

/**
 * For one off loads beside useLive (the next batch of a trip list, search as you type, another way): call `stamp()`
 * before the request; the check it returns is true only while `key` is unchanged and the screen is still open.
 */
export function useStamp(key: string) {
  const ref = useRef<ReturnType<typeof createStamp> | null>(null);
  if (!ref.current) ref.current = createStamp(key);
  ref.current.setKey(key);
  useEffect(() => { const s = ref.current!; return () => s.close(); }, []);
  return ref.current.stamp;
}
