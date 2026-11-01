// Get off now at its moment, in the open app (1 Nov 2026, real-time harness S17a/S17b; files/day-1nov/rt-fix-harness.md).
// The open app steps the trip again at the exact Get off now moment (the live arrival less 38 s, nextFlowMoment). Before
// this, that step ran on the answers the last 15 s refresh brought (tickLive noFetch): an arrival that moved in the
// seconds before the moment, or in the moment's own second, was not seen, so Get off now rang on the old arrival (S17a:
// 160 s early, then "Held") or the moment passed on an answer that did not have the earlier arrival. Now the step at a
// moment rests only on answers ASKED FOR at or after that moment (a fresh read, refresh=1 with at=<moment>, which the
// server answers from feed copies asked at or after that second), the timer is one timer re-armed in one go (a timer
// for an old moment never runs), and a moment that comes while a refresh is running is run after it, never dropped.
// Pure, so test/getoffrace1nov.test.mjs runs it on an injected clock. JavaScript only: OTA on 1.3.0.

/** The moment timer fires this long after the moment, so the read it makes is asked for after the moment itself. */
export const MOMENT_SLACK_MS = 50;

/** Whether a step at a Get off now moment must read again: the answers in hand were asked for before the moment. */
export function momentNeedsRead(due: number | null | undefined, askedAt: number): boolean {
  if (due == null || !Number.isFinite(due)) return false;
  return !(Number.isFinite(askedAt) && askedAt >= due);
}

/** The service ask at a moment: a refresh that names the moment (the server reads feed copies from that second on). */
export function momentQuery<T extends Record<string, string | undefined>>(q: T, due: number | null | undefined): T & { at?: string } {
  if (due == null || !Number.isFinite(due) || q.refresh !== '1') return q;
  return { ...q, at: String(Math.floor(due)) };
}

/** Whether the step may decide from what it holds: not at a moment, or at a moment with answers asked at or after it. */
export function momentMayStep(due: number | null | undefined, askedAt: number): boolean {
  return !momentNeedsRead(due, askedAt);
}

export type MomentClock = { now: () => number; set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };

/**
 * One timer for the next moment. arm() cancels the timer it holds and sets the new one in the same call, and each timer
 * carries its generation: a timer from before the last arm() (an old moment the newest reading moved) never runs, even
 * if the platform runs its callback after the clear. arm(null) cancels.
 */
export function makeMomentTimer(clock: MomentClock, run: (due: number) => void) {
  let handle: unknown = null;
  let gen = 0;
  let armed: number | null = null;
  return {
    arm(due: number | null | undefined) {
      gen++;
      if (handle != null) { clock.clear(handle); handle = null; }
      armed = due != null && Number.isFinite(due) ? due : null;
      if (armed == null) return;
      const my = gen, at = armed;
      handle = clock.set(() => {
        if (my !== gen) return;
        handle = null; armed = null;
        run(at);
      }, Math.max(0, at - clock.now()) + MOMENT_SLACK_MS);
    },
    armedFor(): number | null { return armed; },
  };
}

/**
 * A moment that comes while a refresh is running is kept and run when it finishes (the refresh's own step may already
 * have done it; the moment's step then finds nothing to do). take() hands it over once.
 */
export function makeMomentQueue() {
  let pending: number | null = null;
  return {
    hold(due: number) { pending = pending == null ? due : Math.max(pending, due); },
    take(): number | null { const d = pending; pending = null; return d; },
  };
}
