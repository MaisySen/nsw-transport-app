// Small pure helpers for touch handling, kept apart from React so tests can run them in Node.

export type Timers = { set: (fn: () => void, ms: number) => any; clear: (t: any) => void };
// Wrapped in arrows: a browser throws "Illegal invocation" when setTimeout is called as a method of another object.
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) };

/**
 * Tap or drag on a reorder handle. A touch that moves less than `slop` px before it lifts is a tap
 * (it opens the card, like the rest of the header). It becomes a drag once it moves `slop` px or is held
 * `holdMs`. Only a drag starts the reorder (and its buzz), so a plain tap never buzzes and does nothing.
 */
export type GripState = { phase: 'idle' | 'pending' | 'drag'; t0: number };
export type GripEvent = { type: 'down'; t: number } | { type: 'move'; t: number; dy: number } | { type: 'hold'; t: number } | { type: 'up'; t: number } | { type: 'cancel' };
export type GripOut = 'none' | 'startDrag' | 'move' | 'endDrag' | 'tap';
export const GRIP_SLOP = 6;
export const GRIP_HOLD_MS = 250;
export function gripStep(s: GripState, e: GripEvent, slop = GRIP_SLOP, holdMs = GRIP_HOLD_MS): [GripState, GripOut] {
  switch (e.type) {
    case 'down': return [{ phase: 'pending', t0: e.t }, 'none'];
    case 'move':
      if (s.phase === 'drag') return [s, 'move'];
      if (s.phase === 'pending' && (Math.abs(e.dy) >= slop || e.t - s.t0 >= holdMs)) return [{ ...s, phase: 'drag' }, 'startDrag'];
      return [s, 'none'];
    case 'hold':
      if (s.phase === 'pending' && e.t - s.t0 >= holdMs) return [{ ...s, phase: 'drag' }, 'startDrag'];
      return [s, 'none'];
    case 'up':
      if (s.phase === 'drag') return [{ phase: 'idle', t0: 0 }, 'endDrag'];
      if (s.phase === 'pending') return [{ phase: 'idle', t0: 0 }, 'tap'];
      return [s, 'none'];
    case 'cancel':
      return [{ phase: 'idle', t0: 0 }, s.phase === 'drag' ? 'endDrag' : 'none'];
  }
}

/**
 * Locks a page's scrolling while a finger is on an embedded map, so map pans and page scrolls never fight.
 * Unlocks when the last finger lifts, on cancel, and on its own after `idleMs` with no touch event, so a
 * lost touch end can never leave the page stuck.
 */
export function scrollLock(setScroll: (on: boolean) => void, idleMs = 2500, timers: Timers = realTimers) {
  let locked = false;
  let t: any = null;
  const unlock = () => { if (t) timers.clear(t); t = null; if (locked) { locked = false; setScroll(true); } };
  const arm = () => { if (t) timers.clear(t); t = timers.set(unlock, idleMs); };
  return {
    start: () => { if (!locked) { locked = true; setScroll(false); } arm(); },
    move: () => { if (locked) arm(); },
    end: (touchesLeft = 0) => { if (touchesLeft > 0) arm(); else unlock(); },
    cancel: unlock,
    get locked() { return locked; },
  };
}

/** Runs `fn` once: on the first of `signal()` or the fallback timer. Used to act after a sheet has closed. */
export function once(fn: () => void, fallbackMs: number, timers: Timers = realTimers) {
  let done = false;
  const run = () => { if (done) return; done = true; timers.clear(t); fn(); };
  const t = timers.set(run, fallbackMs);
  return run;
}

/** Resolves with the promise, or with `fallback` after `ms`, so a button's busy state can never stick. */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
