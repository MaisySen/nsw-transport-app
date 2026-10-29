import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { showsKept } from './netErrCore';
import { keepOffline, peekOffline, readOffline } from './offline';
import { createLatest, createStamp, quickReaskMs } from './pollCore';
import { cardDegraded, failAgainMs, phoneOffline, quickRetryMs, standInAgainMs } from './coldOpenCore';
import { answerTime } from './liveLabelCore';
import { useCountdownNow, useNow, useReportCountdowns, useScreenPoll } from './activity';
import { peekPackBoard, readPackBoard } from './timetablePack';
import { firstPaint } from './timetablePackCore';
import { firstFrame } from './speedCore';
import { ttFirstMayPaint } from './newTripCore';

/** Ticks so countdowns move on their own, only while the screen is on view and the app is in front. */
export { useCountdownNow, useNow, useReportCountdowns };

/**
 * Loads data and keeps it fresh while the screen is focused and the app is in front.
 * Keeps the last good data on screen when a refresh fails.
 * With `cacheKey`, each good answer is also kept on the phone; when the server can't be reached and nothing is on
 * screen yet (a fresh start with no signal), the kept copy is shown with the services already gone taken out.
 * `offlineAt` is the time the shown times are from while the app is offline, else null.
 * `staleAt` is set while a kept copy is on screen and the live answer is still on its way (label it, never as live).
 * With `pack` (a stop and mode), the stop's timetable pack (timetablePack.ts) is shown when there is no copy of the
 * live board from the last 10 minutes: `packAt` is set while those timetable times are on screen (label them as
 * timetable times, never as live; with `error` set the phone is offline). The live answer replaces them.
 *
 * Race rule (createLatest in pollCore.ts): every change of `deps` starts a new round. An answer that comes back for an
 * earlier round (the stop, service, time or query shown a moment ago) is dropped, never shown under the new one, and
 * the new round asks at once instead of waiting for the old request. `load` gets an AbortSignal that is aborted when
 * its round is over.
 */
export function useLive<T>(load: (refresh: boolean, signal?: AbortSignal) => Promise<T>, intervalMs: number | ((data: T | null) => number) = 15000, deps: any[] = [], opts: { cacheKey?: string; enabled?: boolean; pack?: { stop: string; mode?: string | null; at?: number | null } | null;
  /** Home cards (coldOpenCore.ts): a failed read keeps what is on screen and asks again quickly, a slow planner stand in is
   * asked again soon for live trips, and only failures in a row show the failure. `pending` and `retrying` say so. */
  quick?: boolean;
  /** What the screen before already showed (speedCore.ts, 27 Oct speed pass): painted on the first frame when the phone
   * has no kept copy and no pack, labelled by staleAt with its age (`at`), replaced by a kept copy read from storage or
   * the live answer. Never kept on the phone. */
  seed?: { at: number; data: T } | null;
  /** Ask again soon after this answer (27 Oct speed pass 4): the wait in ms for the `asked`th ask again in a row, or null
   * for the normal gap. A board at another time on timetable rows while the planner answers, the car park list while
   * its live counts are read. One run after the wait, then the normal gap; nothing runs off screen. */
  again?: ((d: T, asked: number) => number | null) | null;
  /** New trip first look (30 Oct, newTripCore.ts): a quick timetable answer asked beside the live load when nothing is
   * on screen after the phone's own copies were read. Painted like a seed (staleAt, never kept, never live) only while
   * nothing live, kept or seeded is on screen; a kept copy read from storage, or the live answer, replaces it. Null when
   * it has nothing (the screen keeps its placeholder rows). Read once per round (deps). */
  early?: (() => Promise<T | null>) | null } = {}) {
  // A copy kept in memory this session shows on the first frame (a screen opened again, Home after a tab change),
  // or the stop's timetable pack when that copy is missing or more than 10 minutes old (firstPaint).
  const first = useRef<{ at: number; data: T; pack: boolean; seed?: boolean } | null | undefined>(undefined);
  if (first.current === undefined) {
    const f = firstFrame<T>(opts.cacheKey ? peekOffline<T>(opts.cacheKey) : null, opts.pack ? peekPackBoard(opts.pack.stop, opts.pack.mode, opts.pack.at) : null, opts.seed, Date.now());
    first.current = f.kind === 'none' ? null : { at: f.at as number, data: f.data as T, pack: f.kind === 'pack', seed: f.kind === 'seed' };
  }
  const seedRef = useRef(opts.seed);
  seedRef.current = opts.seed;
  const [data, setData] = useState<T | null>(first.current ? first.current.data : null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // A fresh start shows the copy kept on the phone at once (staleAt: when it is from) while the live answer loads.
  const [staleAt, setStaleAt] = useState<number | null>(first.current && !first.current.pack ? first.current.at : null);
  const [packAt, setPackAt] = useState<number | null>(first.current && first.current.pack ? first.current.at : null);
  const packRef = useRef(opts.pack);
  packRef.current = opts.pack;
  const dataRef = useRef<T | null>(null);
  dataRef.current = data;
  const loadRef = useRef(load);
  loadRef.current = load;
  const keyRef = useRef(opts.cacheKey);
  keyRef.current = opts.cacheKey;
  const latest = useRef<ReturnType<typeof createLatest> | null>(null);
  if (!latest.current) latest.current = createLatest();
  const shown = useRef<{ live: boolean; at: number | null; pack?: boolean; seed?: boolean }>({ live: false, at: first.current ? first.current.at : null, pack: !!first.current?.pack, seed: !!first.current?.seed });
  // Shows a kept copy (staleAt) or a pack board (packAt) while nothing live is on screen.
  const paint = useCallback((f: { kind: 'kept' | 'pack' | 'none'; data: unknown; at: number | null }) => {
    if (f.kind === 'none' || f.at == null) return;
    setData(f.data as T);
    if (f.kind === 'pack') { setPackAt(f.at); setStaleAt(null); } else { setStaleAt(f.at); setPackAt(null); }
    shown.current = { live: false, at: f.at, pack: f.kind === 'pack' };
  }, []);
  // The quick ask (pollCore.quickReaskMs): an answer the server took from a saved copy more than 20 s old is asked
  // again with refresh after about 2 s, once per opening, then the normal gap.
  const reasked = useRef(false);
  const [soon, setSoon] = useState<{ key: number; ms: number } | null>(null);
  // The quick ask again (opts.quick, coldOpenCore.ts): failures in a row, the wait the next poll takes instead of the
  // gap, whether that ask is a plain one (the server's saved live copy, not a refresh), and stand in re-asks so far.
  const quickRef = useRef(!!opts.quick);
  quickRef.current = !!opts.quick;
  const fails = useRef(0);
  const nextQuick = useRef<number | null>(null);
  const plainNext = useRef(false);
  const standAsked = useRef(0);
  const againRef = useRef(opts.again);
  againRef.current = opts.again;
  const earlyRef = useRef(opts.early);
  earlyRef.current = opts.early;
  const againAsked = useRef(0);
  // pending: the first live answer of this opening is still on its way (a request out or a quick ask waiting).
  // retrying: a quick ask again is waiting (Home's header and cards say Updating, never unavailable, meanwhile).
  const [pending, setPending] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const quickAgain = useCallback((ms: number) => {
    nextQuick.current = ms;
    plainNext.current = true;
    setRetrying(true);
    setSoon({ key: Date.now() + Math.random(), ms });
  }, []);
  // Recovery (coldOpenCore.ts RECOVER_MS): the next plain ask after this wait, never later than the normal gap, said
  // nowhere on screen (the card keeps its honest words) and not counted towards the poller's back off.
  const quietAgain = useCallback((ms: number) => {
    const f = ivRef.current;
    const gap = typeof f === 'function' ? f(dataRef.current) : f;
    nextQuick.current = Number.isFinite(gap) && gap > 0 ? Math.min(ms, gap) : ms;
    plainNext.current = true;
  }, []);

  const run = useCallback(async (refresh: boolean): Promise<boolean> => {
    const L = latest.current!;
    const round = L.begin();
    if (!round) return true;
    const key = keyRef.current;
    nextQuick.current = null;
    try {
      const d = await loadRef.current(refresh, round.signal);
      if (!round.current()) return true;
      fails.current = 0;
      setPending(false);
      // A timetable stand in: live trips asked for again soon (the server saves them when they come). A slow planner's
      // first, said as Getting live times; any stand in after that, quietly, until a live answer (coldOpenCore.ts).
      const sa = quickRef.current ? standInAgainMs(d, standAsked.current) : null;
      if (sa) { standAsked.current += 1; if (sa.quick) quickAgain(sa.ms); else { setRetrying(false); quietAgain(sa.ms); } }
      else { standAsked.current = 0; setRetrying(false); }
      // When the times were read (a cached answer from the server says so), not just when they arrived (honest "Updated").
      const at = answerTime(d, Date.now());
      setData(d);
      setError(null);
      setUpdatedAt(at);
      setOfflineAt(null);
      setStaleAt(null);
      setPackAt(null);
      shown.current = { live: true, at };
      if (key) keepOffline(key, d);
      const ag = sa == null && againRef.current ? againRef.current(d, againAsked.current) : null;
      if (ag != null && Number.isFinite(ag) && ag >= 0) { againAsked.current += 1; setSoon({ key: Date.now() + Math.random(), ms: ag }); }
      else againAsked.current = 0;
      const q = sa == null && ag == null ? quickReaskMs(d, Date.now(), reasked.current) : null;
      if (q != null) { reasked.current = true; setSoon({ key: Date.now(), ms: q }); }
      return true;
    } catch (e: any) {
      if (!round.current()) return true;
      fails.current += 1;
      if (quickRef.current) {
        // A first failure is not an outage (27 Oct 8:35 AM): what is on screen stays, marked Updating, and the same
        // read goes again in a moment. Only failures in a row (or a live answer on screen gone old) show the failure.
        const liveAge = shown.current.live && shown.current.at != null ? Date.now() - shown.current.at : null;
        const w = quickRetryMs({ fails: fails.current, offline: phoneOffline(e), liveAgeMs: liveAge });
        if (w != null) { quickAgain(w); return false; }
        // The quick asks have run out: the failure shows, and the card keeps asking quietly (never minutes apart).
        quietAgain(failAgainMs(fails.current, phoneOffline(e)));
      }
      setPending(false);
      setRetrying(false);
      setError(String(e?.message || e));
      // No connection, slow live data, or a server error (5xx, 429): the copy or timetable on the phone stands in, and
      // its label says which (netErrCore.ts failWhy), never an error screen while the phone holds times.
      if (showsKept(e)) {
        if (shown.current.live) setOfflineAt(shown.current.at);
        else if (shown.current.pack) { /* timetable times stay, labelled offline by packAt with error */ }
        else if (key || packRef.current) {
          const kept = key ? peekOffline<T>(key) ?? (await readOffline<T>(key)) : null;
          const pk = packRef.current;
          const pb = pk ? await readPackBoard(pk.stop, pk.mode, pk.at) : null;
          if (round.current() && !shown.current.live) {
            const f = firstPaint<T>(kept, pb, Date.now());
            if (f.kind === 'pack') paint(f);
            else if (f.kind === 'kept') {
              setData(f.data as T);
              setOfflineAt(f.at);
              setPackAt(null);
              shown.current = { live: false, at: f.at };
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
      const pk = packRef.current;
      const f = firstFrame<T>(key ? peekOffline<T>(key) : null, pk ? peekPackBoard(pk.stop, pk.mode, pk.at) : null, seedRef.current, Date.now());
      setData(f.kind === 'none' ? null : (f.data as T));
      setStaleAt(f.kind === 'kept' || f.kind === 'seed' ? f.at : null);
      setPackAt(f.kind === 'pack' ? f.at : null);
      setUpdatedAt(null);
      setError(null);
      setOfflineAt(null);
      shown.current = { live: false, at: f.at, pack: f.kind === 'pack', seed: f.kind === 'seed' };
    }
    mounted.current = true;
    reasked.current = false;
    fails.current = 0;
    standAsked.current = 0;
    againAsked.current = 0;
    nextQuick.current = null;
    plainNext.current = false;
    setPending(true);
    setRetrying(false);
    // The kept copy or the pack first (a read from the phone, a few milliseconds), then the live answer replaces it.
    // A pack on screen still gives way to a copy of the live board from the last 10 minutes.
    const pk = packRef.current;
    // The first look (opts.early): asked only once the phone's own copies are read and none is on screen, so a search
    // the phone holds costs no extra request. It paints only if still nothing live, kept or seeded is on screen.
    const ea = earlyRef.current;
    const startEarly = () => {
      if (!ea || gen !== L.gen() || !ttFirstMayPaint(shown.current)) return;
      ea().then((d) => {
        if (!d || gen !== L.gen() || !ttFirstMayPaint(shown.current)) return;
        const at = Date.now();
        setData(d);
        setStaleAt(at);
        setPackAt(null);
        shown.current = { live: false, at, seed: true };
      }).catch(() => {});
    };
    if ((key || pk) && (!shown.current.at || shown.current.pack || shown.current.seed)) {
      Promise.all([key ? readOffline<T>(key) : null, pk ? readPackBoard(pk.stop, pk.mode, pk.at) : null]).then(([kept, pb]) => {
        if (gen !== L.gen() || shown.current.live) return;
        const f = firstPaint<T>(kept, pb, Date.now());
        // A seed (what the screen before showed) gives way to a full kept copy, never to a pack.
        if (shown.current.seed) { if (f.kind === 'kept') paint(f); return; }
        if (f.kind === 'none' || (shown.current.at && !shown.current.pack) || (f.kind === 'pack' && shown.current.pack)) return;
        paint(f);
      }).catch(() => {}).then(startEarly);
    } else startEarly();
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
  // A quick ask again is a plain read (plainNext): the server answers it from the live copy it saved a moment ago.
  const nextMs = useRef(() => { const n = nextQuick.current; nextQuick.current = null; return n; }).current;
  const runNow = useScreenPoll(() => { const plain = plainNext.current; plainNext.current = false; return run(!plain); }, typeof intervalMs === 'function' ? () => { const f = ivRef.current; return typeof f === 'function' ? f(dataRef.current) : f; } : intervalMs, { enabled: opts.enabled ?? true, retimeKey: updatedAt, soon, nextMs });

  // Back in front (opts.quick, Home's cards): a card on a stand in, a failure, kept or timetable times asks again at
  // once with a plain read, whatever its gap (coldOpenCore.ts, Home recovers by itself).
  const degraded = useRef(false);
  degraded.current = cardDegraded({ data, error, offlineAt, packAt });
  const quickOn = !!opts.quick;
  useEffect(() => {
    if (!quickOn) return;
    const sub = AppState.addEventListener('change', (a) => {
      if (a !== 'active' || !degraded.current) return;
      plainNext.current = true;
      setSoon({ key: Date.now() + Math.random(), ms: 0 });
    });
    return () => sub.remove();
  }, [quickOn]);

  const refresh = useCallback(async () => {
    plainNext.current = false;
    setRefreshing(true);
    try { await runNow(); } finally { setRefreshing(false); }
  }, [runNow]);

  // A board the server pushed (boardPush.ts): shown like a fresh answer; kept on the phone at most every 30 s.
  const keptAt = useRef(0);
  const pushed = useCallback((d: T) => {
    const now = Date.now();
    fails.current = 0;
    setPending(false);
    setData(d);
    setError(null);
    setUpdatedAt(answerTime(d, now));
    setOfflineAt(null);
    setStaleAt(null);
    setPackAt(null);
    shown.current = { live: true, at: now };
    const key = keyRef.current;
    if (key && now - keptAt.current > 30000) { keptAt.current = now; keepOffline(key, d); }
  }, []);

  return { data, error, updatedAt, offlineAt, staleAt, packAt, refreshing, refresh, setData, pushed, pending, retrying };
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
