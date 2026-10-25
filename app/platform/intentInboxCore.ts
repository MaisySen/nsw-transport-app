// Links left for the app by Siri and Shortcuts ("Start my commute"), and the service a start link means.
// Pure, so it is unit tested. No imports.

/** How long a link left by Siri stays good. Older ones are dropped, so a stale request never starts a trip. */
export const PENDING_MAX_AGE_S = 120;

/**
 * The app link in what "Start my commute" left in the app group ({"url": "nswtransport://...", "at": seconds}),
 * or null when there is none, it is not one of the app's own links, or it is older than PENDING_MAX_AGE_S.
 */
export function pendingOpenURL(raw: string | null | undefined, nowMs: number): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let v: any;
  try { v = JSON.parse(raw); } catch { return null; }
  const url = typeof v?.url === 'string' ? v.url : '';
  const at = Number(v?.at);
  if (!/^nswtransport:\/\//i.test(url)) return null;
  if (!Number.isFinite(at)) return null;
  const age = nowMs / 1000 - at;
  if (age > PENDING_MAX_AGE_S || age < -60) return null;
  return url;
}

/**
 * Which service a start link means: the one leaving closest to `atSec` (seconds since 1970) within 3 minutes,
 * else the first. -1 when there is none. `depsMs` are departure times in milliseconds, in list order.
 */
export function startIndex(depsMs: number[], atSec: number | null | undefined, withinMs = 180000): number {
  if (!depsMs.length) return -1;
  const at = Number(atSec);
  if (!atSec || !Number.isFinite(at)) return 0;
  let best = 0;
  let gap = Infinity;
  depsMs.forEach((d, i) => {
    const g = Math.abs(d - at * 1000);
    if (Number.isFinite(g) && g < gap) { gap = g; best = i; }
  });
  return gap <= withinMs ? best : 0;
}
