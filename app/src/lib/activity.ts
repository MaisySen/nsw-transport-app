// The app's battery switch (docs/PERFORMANCE.md): every repeating job goes through here, so nothing polls while
// the app is in the background, and screen jobs stop while the screen is covered or left.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { createPoller, msToNextTick, Poller, PollTimers } from './pollCore';

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
export function useScreenPoll(run: () => Promise<boolean | void> | boolean | void, everyMs: number, opts: { enabled?: boolean; runAtStart?: boolean; staleMs?: number } = {}) {
  const runRef = useRef(run);
  runRef.current = run;
  const poller = useRef<Poller | null>(null);
  const enabled = opts.enabled ?? true;
  const focused = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const p = createPoller(() => runRef.current(), everyMs, timers, { active: appActive(), enabled: focused.current, runAtStart: opts.runAtStart ?? false, staleMs: opts.staleMs });
    poller.current = p;
    const sub = AppState.addEventListener('change', (s) => p.setActive(appActive(s)));
    return () => { sub.remove(); p.stop(); if (poller.current === p) poller.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyMs, enabled]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    poller.current?.setEnabled(true);
    return () => { focused.current = false; poller.current?.setEnabled(false); };
  }, []));
  return useCallback(() => poller.current?.runNow() ?? Promise.resolve(), []);
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
