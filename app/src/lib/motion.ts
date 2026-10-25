// Reduce Motion, read once for the whole app and kept up to date (one listener, not one per component).
// With it on, nothing pulses: the live dot stays still and changes show without animation.
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

let reduce = false;
let started = false;
const subs = new Set<() => void>();
const set = (v: boolean) => { if (v === reduce) return; reduce = v; subs.forEach((f) => f()); };

function start() {
  if (started) return;
  started = true;
  try {
    if (Platform.OS === 'web') {
      const m = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null;
      if (m) { set(!!m.matches); m.addEventListener?.('change', (e) => set(!!e.matches)); }
      return;
    }
    AccessibilityInfo.isReduceMotionEnabled().then((v) => set(!!v)).catch(() => {});
    AccessibilityInfo.addEventListener('reduceMotionChanged', (v: boolean) => set(!!v));
  } catch {}
}

/** True while the phone asks for less motion (iOS Reduce Motion, Android Remove animations, the browser setting). */
export function useReduceMotion(): boolean {
  start();
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => reduce, () => reduce);
}

/** The same, read once outside React. */
export function reduceMotionNow(): boolean { start(); return reduce; }
