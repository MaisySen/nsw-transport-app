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
  /**
   * Reads the gap again for the wait already running (adaptive gaps depend on the data on screen). The screen's first
   * answer arrives after the first wait was set, when the gap read "nothing on screen yet"; without this the first
   * refresh of a stop came a minute after opening it, whatever was due (measured 26 Oct 2026).
   */
  retime: () => void;
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
export function createPoller(run: () => Promise<boolean | void> | boolean | void, everyMs: number | (() => number), timers: PollTimers, opts: { active?: boolean; enabled?: boolean; staleMs?: number; runAtStart?: boolean } = {}): Poller {
  let active = opts.active ?? true;
  let enabled = opts.enabled ?? true;
  let handle: any = null;
  let last = opts.runAtStart === false ? timers.now() : -Infinity;
  let failures = 0;
  let running = false;
  let stopped = false;
  // A gap can be a function, read before each wait (adaptive polling: slower while the next service is far off).
  const every = () => { const v = typeof everyMs === 'function' ? everyMs() : everyMs; return Number.isFinite(v) && v > 0 ? v : 15000; };
  const staleMs = opts.staleMs ?? every() / 2;

  const clear = () => { if (handle != null) { timers.clear(handle); handle = null; } };
  const wanted = () => active && enabled && !stopped;
  const gap = () => backoffMs(every(), failures);

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
    retime: () => { if (handle == null || running) return; schedule(gap() - (timers.now() - last)); },
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

/**
 * The latest answer rule for a screen's live data (useLive in hooks.ts). Each change of what the screen shows (its
 * stop, trip, time or query) starts a new round with `next()`; a request belongs to the round it started in, and its
 * answer is used only while that round is still the current one. So an answer still on its way for the stop or
 * service shown a moment ago is dropped instead of landing under the new one, and the new round asks at once rather
 * than waiting behind it. Within one round only one request is out at a time.
 * The old round's signal is aborted, so a load can skip any follow up step; reads themselves are shared between
 * screens (createReadCache), so the fetch they share is left to finish.
 */
export type LiveRound = { gen: number; current: () => boolean; signal?: AbortSignal; end: () => void };
export function createLatest() {
  let gen = 0;
  let out: { gen: number; ctl: AbortController | null } | null = null;
  return {
    /** What the screen shows changed, or the screen closed: a new round. */
    next(): number {
      gen++;
      if (out) { try { out.ctl?.abort(); } catch {} out = null; }
      return gen;
    },
    /** A request for the current round, or null when one is already out for it. Call `end()` when it settles. */
    begin(): LiveRound | null {
      if (out && out.gen === gen) return null;
      const g = gen;
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const mine = { gen: g, ctl };
      out = mine;
      return { gen: g, current: () => g === gen, signal: ctl?.signal, end: () => { if (out === mine) out = null; } };
    },
    /** The current round, for one off reads that start beside the poll (the kept copy). */
    gen: () => gen,
  };
}

/**
 * The same rule for one off loads (the next batch of a trip list, search as you type, another way after a missed
 * change): `stamp()` before the request returns a check that is true only while `key` is still the same and the
 * screen is still open (`close()`), so an answer for an earlier query is never added to the new one.
 */
export function createStamp(key: string) {
  let k = key;
  let gen = 0;
  return {
    setKey(next: string) { if (next !== k) { k = next; gen++; } },
    close() { gen++; },
    stamp(): () => boolean { const g = gen; return () => g === gen; },
  };
}

/**
 * Adaptive polling (docs/PERFORMANCE.md): the screen's normal gap (15 s on boards) while the next service is
 * 10 minutes away or less, 30 seconds from 10 to 20 minutes, and once a minute beyond 20 minutes (or with nothing to
 * wait for today). A gap longer than these is kept. Before 26 Oct 2026 the fast gap stopped at 5 minutes, so a train
 * 6 to 15 minutes away was asked for every 30 s ("updates late", Bidur).
 */
export const FAST_POLL_WITHIN_MS = 10 * 60000;
export function adaptiveGapMs(baseMs: number, nextInMs: number | null | undefined): number {
  if (nextInMs == null || !Number.isFinite(nextInMs)) return Math.max(baseMs, 60000);
  const m = nextInMs / 60000;
  if (m > 20) return Math.max(baseMs, 60000);
  if (nextInMs > FAST_POLL_WITHIN_MS) return Math.max(baseMs, 30000);
  return baseMs;
}

/**
 * Trip lists (trip screen, Simple mode, Home trip cards): every 15 s while the first service of the list leaves in
 * 10 minutes or less, else every 20 s (the gap these lists always had).
 */
export function firstLeaveInMs(journeys: { leave?: string | null; board?: string | null }[] | null | undefined, now: number): number | null {
  let best: number | null = null;
  for (const j of journeys || []) {
    const t = Date.parse(String(j?.board || j?.leave || '')) - now;
    if (Number.isFinite(t) && t > -30000 && (best == null || t < best)) best = t;
  }
  return best;
}
export function tripGapMs(firstInMs: number | null | undefined): number {
  return firstInMs != null && Number.isFinite(firstInMs) && firstInMs <= FAST_POLL_WITHIN_MS ? 15000 : 20000;
}

/**
 * Milliseconds until any countdown on screen shows a different value. Countdowns show whole minutes (format.countdown:
 * the minutes left, rounded down; "Now" in the last minute; "Gone" a minute after), so each time changes at a whole
 * minute before its departure. With nothing to count to, the next minute on the clock. Never under 1 second.
 */
export function nextChangeMs(now: number, times: Iterable<number>): number {
  let best = 60000 - (now % 60000);
  for (const t of times) {
    if (!Number.isFinite(t)) continue;
    const d = t - now;
    if (d < -60000) continue;
    // The next whole minute boundary of (t - now) below the current one, i.e. when floor((t - now) / 60000) changes.
    const r = ((d % 60000) + 60000) % 60000;
    const wait = r === 0 ? 60000 : r;
    if (wait < best) best = wait;
  }
  return Math.max(1000, best + 50);
}

/** Milliseconds from `now` to the next service still ahead on a board (live time where there is one), or null. */
export function nextInMs(items: { planned?: string | null; estimated?: string | null; realtime?: boolean; departed?: boolean; cancelled?: boolean }[] | null | undefined, now: number): number | null {
  let best: number | null = null;
  for (const d of items || []) {
    if (d.departed || d.cancelled) continue;
    const e = d.realtime && d.estimated ? Date.parse(d.estimated) : NaN;
    const t = (Number.isFinite(e) ? e : Date.parse(String(d.planned || ''))) - now;
    if (Number.isFinite(t) && t > -30000 && (best == null || t < best)) best = t;
  }
  return best;
}

/**
 * One value made once and shared: calls while the first is still loading wait for it instead of starting their own.
 * A failure is not kept, so the next call tries again. getDevice (src/lib/device.ts) uses it: on a fresh install,
 * Home's first board and trip asked for the device id at the same moment, each found none and made one, and the
 * first requests went out under an id the phone then forgot (26 Oct 2026, item 2 audit).
 */
export function sharedOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let value: { v: T } | null = null;
  let pending: Promise<T> | null = null;
  return () => {
    if (value) return Promise.resolve(value.v);
    if (!pending) {
      pending = load().then((v) => { value = { v }; pending = null; return v; }, (e) => { pending = null; throw e; });
    }
    return pending;
  };
}

/**
 * How long the app wide alerts timer (every 20 s, src/lib/push.ts) waits since its last ask. With a push token, push
 * brings each alert, so once a minute catches a missed one. With no token and nothing watched on this phone, no alert
 * needs the next 20 s either (the server writes its notes on a minute tick), so once a minute too. Watching with no
 * token: every tick, as before.
 */
export function notesWaitMs(hasToken: boolean, watching: boolean): number {
  return hasToken || !watching ? 55000 : 0;
}
