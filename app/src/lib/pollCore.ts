// Battery rules in one place (docs/PERFORMANCE.md). Pure logic with no React Native import, so the tests run it
// in Node: a poller that runs only while the app is in front and the screen is on view, waits longer after each
// failure, and catches up once when it comes back; and a read cache that shares one request between callers.

export type PollTimers = { set: (fn: () => void, ms: number) => any; clear: (h: any) => void; now: () => number };

/** Wait before the next run: the normal gap, doubled for each failure in a row, never more than `maxMs`. */
export function backoffMs(everyMs: number, failures: number, maxMs = 5 * 60000): number {
  if (!(failures > 0)) return everyMs;
  return Math.min(Math.max(maxMs, everyMs), everyMs * 2 ** Math.min(failures, 8));
}

/** Milliseconds to the next whole multiple of `ms` on the clock, so a 5 second tick lands exactly on each minute. */
export function msToNextTick(now: number, ms: number): number {
  const r = ms - (now % ms);
  return r <= 0 ? ms : r;
}

export type Poller = {
  /** The app came to the front (true) or left it (false). */
  setActive: (on: boolean) => void;
  /** The screen came on view (true) or was covered or left (false). */
  setEnabled: (on: boolean) => void;
  /** Runs now (pull to refresh, a button), then keeps the normal gap. */
  runNow: () => Promise<void>;
  stop: () => void;
  /** For tests: whether a run is waiting on the timer. */
  scheduled: () => boolean;
};

/**
 * Runs `run` every `everyMs` while both active and enabled; nothing is scheduled otherwise, so a phone in a pocket
 * or a screen under another one costs no timer and no request. `run` returns false (or throws) for a failure, and
 * each failure in a row doubles the wait (backoffMs). Back on view, it runs at once only when the last run is at
 * least `staleMs` old (default half the gap); else it waits out the rest of the gap.
 */
export function createPoller(run: () => Promise<boolean | void> | boolean | void, everyMs: number, timers: PollTimers, opts: { active?: boolean; enabled?: boolean; staleMs?: number; runAtStart?: boolean } = {}): Poller {
  let active = opts.active ?? true;
  let enabled = opts.enabled ?? true;
  let handle: any = null;
  let last = opts.runAtStart === false ? timers.now() : -Infinity;
  let failures = 0;
  let running = false;
  let stopped = false;
  const staleMs = opts.staleMs ?? everyMs / 2;

  const clear = () => { if (handle != null) { timers.clear(handle); handle = null; } };
  const wanted = () => active && enabled && !stopped;
  const gap = () => backoffMs(everyMs, failures);

  const schedule = (delay: number) => {
    clear();
    if (!wanted()) return;
    handle = timers.set(() => { handle = null; void tick(); }, Math.max(0, delay));
  };

  async function tick() {
    if (!wanted() || running) return;
    running = true;
    let ok = true;
    try { ok = (await run()) !== false; } catch { ok = false; }
    running = false;
    last = timers.now();
    failures = ok ? 0 : failures + 1;
    schedule(gap());
  }

  const resume = () => {
    if (!wanted()) { clear(); return; }
    const since = timers.now() - last;
    if (since >= Math.min(staleMs, gap())) schedule(0);
    else schedule(gap() - since);
  };

  resume();
  return {
    setActive: (on) => { if (on === active) return; active = on; resume(); },
    setEnabled: (on) => { if (on === enabled) return; enabled = on; resume(); },
    runNow: async () => { clear(); failures = 0; await tick(); if (!handle) schedule(gap()); },
    stop: () => { stopped = true; clear(); },
    scheduled: () => handle != null,
  };
}

/**
 * Shares reads: callers asking for the same key while a request is out get that one request, and a good answer is
 * reused for `ttlMs`. A failure is never kept. `clear` drops everything (after any write to the server).
 */
export function createReadCache(ttlMs: number, now: () => number = Date.now, maxEntries = 60) {
  const inflight = new Map<string, Promise<any>>();
  const kept = new Map<string, { at: number; v: any }>();
  let gen = 0;
  return {
    get<T>(key: string, fetcher: () => Promise<T>, opts: { fresh?: boolean } = {}): Promise<T> {
      const k = kept.get(key);
      if (!opts.fresh && k && now() - k.at < ttlMs) return Promise.resolve(k.v as T);
      const out = inflight.get(key);
      if (out) return out as Promise<T>;
      const g = gen;
      const p = fetcher().then((v) => {
        if (g === gen) {
          kept.set(key, { at: now(), v });
          if (kept.size > maxEntries) kept.delete(kept.keys().next().value as string);
        }
        return v;
      }).finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
      inflight.set(key, p);
      return p;
    },
    clear() { gen++; kept.clear(); inflight.clear(); },
    size: () => kept.size,
  };
}
