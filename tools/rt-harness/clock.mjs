// Accelerated real-time clock for the harness. Every timer in the process (the server's own waits in its cron pass,
// fetch timeouts, the harness's device loops) is a REAL timer, shortened by the speed factor, and Date.now() runs on
// real elapsed time times the same factor. So tasks really interleave (a phone's request lands while the server's
// pass is mid-wait, two cron runs overlap), unlike the step-by-step simulator. speed 1 is wall-clock real time.
const RealDate = Date;
const rST = globalThis.setTimeout, rSI = globalThis.setInterval, rCT = globalThis.clearTimeout, rCI = globalThis.clearInterval;
const rTimeout = AbortSignal.timeout ? AbortSignal.timeout.bind(AbortSignal) : null;
let S = null;

export function now() { return Math.floor(S.v0 + (performance.now() - S.r0) * S.speed); }
export function speed() { return S ? S.speed : 1; }

/** Installs the clock at startMs (ms since 1970) running speed times faster than the wall. */
export function installClock(startMs, factor = 30) {
  S = { v0: startMs, r0: performance.now(), speed: factor };
  class SimDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(now()); }
    static now() { return now(); }
  }
  SimDate.UTC = RealDate.UTC; SimDate.parse = RealDate.parse;
  globalThis.Date = SimDate;
  globalThis.setTimeout = (fn, ms = 0, ...a) => rST(fn, Math.max(0, Number(ms) || 0) / S.speed, ...a);
  globalThis.setInterval = (fn, ms = 0, ...a) => rSI(fn, Math.max(1, Number(ms) || 0) / S.speed, ...a);
  globalThis.clearTimeout = rCT; globalThis.clearInterval = rCI;
  AbortSignal.timeout = (ms) => { const c = new AbortController(); const h = rST(() => c.abort(new DOMException('The operation timed out.', 'TimeoutError')), Math.max(0, ms) / S.speed); if (h.unref) h.unref(); return c.signal; };
  return { RealDate };
}
/** Waits ms of virtual time (a real timer of ms / speed). */
export const sleepV = (ms) => new Promise((r) => globalThis.setTimeout(r, Math.max(0, ms)));
/** Waits until the virtual time t (ms since 1970). */
export const untilV = (t) => sleepV(t - now());
export { RealDate, rST as realSetTimeout, rTimeout as realAbortTimeout };
