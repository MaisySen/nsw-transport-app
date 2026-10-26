// The app's battery switch (docs/PERFORMANCE.md): every repeating job goes through here, so nothing polls while
// the app is in the background, and screen jobs stop while the screen is covered or left.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { createPoller, msToNextTick, nextChangeMs, Poller, PollTimers } from './pollCore';

const timers: PollTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h), now: () => Date.now() };

/** In front and on screen. iOS "inactive" (Control Center pulled down, the app switcher) counts as away. */
export const appActive = (s: AppStateStatus | string | null | undefined = AppState.currentState) => s === 'active' || s == null;

/** A job for the whole app (not one screen): runs while the app is in front, and never in the background. */
export function startAppPoll(run: () => Promise<boolean | void> | boolean | void, everyMs: number, opts: { runAtStart?: boolean; staleMs?: number } = {}): Poller & { remove: () => void } {
  const p = createPoller(run, everyMs, timers, { active: appActive(), runAtStart: opts.runAtStart, staleMs: opts.staleMs });
  const sub = AppState.addEventListener('change', (s) => p.setActive(appActive(s)));
  return { ...p, remove: () => { p.stop(); sub.remove(); } };
}

/**
 * A job for one screen: runs every `everyMs` while the app is in front AND this screen is on view.
 * `run` returns false for a failure, and the wait doubles after each one (up to 5 minutes).
 */
export function useScreenPoll(run: () => Promise<boolean | void> | boolean | void, everyMs: number | (() => number), opts: { enabled?: boolean; runAtStart?: boolean; staleMs?: number; retimeKey?: unknown; soon?: { key: unknown; ms: number } | null; nextMs?: () => number | null } = {}) {
  const runRef = useRef(run);
  runRef.current = run;
  // A gap given as a function is read before each wait (adaptive polling) without restarting the poller.
  const everyRef = useRef(everyMs);
  everyRef.current = everyMs;
  const dynamic = typeof everyMs === 'function';
  const fixed = dynamic ? 0 : (everyMs as number);
  const poller = useRef<Poller | null>(null);
  const enabled = opts.enabled ?? true;
  const focused = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const gap = dynamic ? () => { const e = everyRef.current; return typeof e === 'function' ? e() : e; } : fixed;
    const nextRef = opts.nextMs;
    const p = createPoller(() => runRef.current(), gap, timers, { active: appActive(), enabled: focused.current, runAtStart: opts.runAtStart ?? false, staleMs: opts.staleMs, nextMs: nextRef ? () => nextRef() : undefined });
    poller.current = p;
    const sub = AppState.addEventListener('change', (s) => p.setActive(appActive(s)));
    return () => { sub.remove(); p.stop(); if (poller.current === p) poller.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixed, dynamic, enabled]);
  // A dynamic gap is read again when the data it depends on changes (useLive passes each answer's time).
  useEffect(() => { if (dynamic) poller.current?.retime(); }, [opts.retimeKey, dynamic]);
  // One run sooner than the gap (useLive: the quick ask after a saved server copy). Declared after retime so it wins.
  const soonKey = opts.soon ? opts.soon.key : null;
  const soonMs = opts.soon ? opts.soon.ms : 0;
  useEffect(() => { if (soonKey != null) poller.current?.soon(soonMs); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [soonKey]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    poller.current?.setEnabled(true);
    return () => { focused.current = false; poller.current?.setEnabled(false); };
  }, []));
  return useCallback(() => poller.current?.runNow() ?? Promise.resolve(), []);
}

/** A ref that is true only while this screen is on view with the app in front: one-off loads (the trip list's next
 * batch) check it, so nothing is fetched for a screen nobody is looking at. */
export function useOnViewRef() {
  const on = useRef(false);
  const focused = useRef(false);
  useFocusEffect(useCallback(() => { focused.current = true; on.current = appActive(); return () => { focused.current = false; on.current = false; }; }, []));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { on.current = focused.current && appActive(s); });
    return () => sub.remove();
  }, []);
  return on;
}

/**
 * The time, ticking every `ms` on whole multiples of the clock (a 5 second tick lands exactly on each minute), only
 * while the app is in front and this screen is on view. Countdowns show whole minutes, so 5 seconds is enough;
 * a 1 second tick redraws the whole screen 60 times a minute for nothing.
 */
export function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  const [on, setOn] = useState(true);
  const [active, setActive] = useState(appActive());
  useFocusEffect(useCallback(() => { setOn(true); setNow(Date.now()); return () => setOn(false); }, []));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { const a = appActive(s); setActive(a); if (a) setNow(Date.now()); });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!on || !active) return;
    let h: any = null;
    const next = () => { h = setTimeout(() => { setNow(Date.now()); next(); }, msToNextTick(Date.now(), ms)); };
    next();
    return () => clearTimeout(h);
  }, [ms, on, active]);
  return now;
}

// ---------- countdown clock ----------
// Every countdown on screen reports the times it counts to; screens tick only when one of them shows a new whole
// minute (or "Now", "Gone"), not every 5 seconds. With nothing reported, they tick on each minute of the clock.

const countdownTimes = new Map<string, number[]>();
const timeSubs = new Set<() => void>();
let timesVersion = 0;

/** A card reports the departure times its countdowns show (an empty list or null takes them away). */
export function reportCountdowns(key: string, times: number[] | null) {
  const prev = countdownTimes.get(key);
  const next = (times || []).filter((t) => Number.isFinite(t)).slice(0, 4);
  if (prev && prev.length === next.length && prev.every((t, i) => t === next[i])) return;
  if (next.length) countdownTimes.set(key, next); else countdownTimes.delete(key);
  timesVersion++;
  timeSubs.forEach((f) => f());
}

/** The same, from a component: reported while mounted. */
export function useReportCountdowns(key: string, times: number[]) {
  const sig = times.join(',');
  useEffect(() => { reportCountdowns(key, times); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key, sig]);
  useEffect(() => () => reportCountdowns(key, null), [key]);
}

function allTimes(): number[] { const out: number[] = []; countdownTimes.forEach((v) => out.push(...v)); return out; }

/**
 * The time for screens with countdowns: changes only when a reported countdown changes its whole minute, and on
 * each minute of the clock otherwise. Only while this screen is on view and the app is in front, like useNow.
 */
export function useCountdownNow() {
  const [now, setNow] = useState(Date.now());
  const [on, setOn] = useState(true);
  const [active, setActive] = useState(appActive());
  const version = useSyncExternalStore((f) => { timeSubs.add(f); return () => { timeSubs.delete(f); }; }, () => timesVersion, () => timesVersion);
  useFocusEffect(useCallback(() => { setOn(true); setNow(Date.now()); return () => setOn(false); }, []));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { const a = appActive(s); setActive(a); if (a) setNow(Date.now()); });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!on || !active) return;
    let h: any = null;
    const next = () => { h = setTimeout(() => { setNow(Date.now()); next(); }, nextChangeMs(Date.now(), allTimes())); };
    next();
    return () => clearTimeout(h);
  }, [on, active, version]);
  return now;
}
