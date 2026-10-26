// Prefetch on press in (26 Oct 2026, g10): a finger on a stop row starts that stop's departures before the tap ends,
// so the stop screen opens on data. The request goes through the shared read cache in api.ts, so the stop screen's
// first load joins the same request while it is out (or reuses its answer for 4 s), and the answer is also put in the
// kept copies (offline.ts), so a stop screen that opens after it landed paints it on the first frame with its age.
import { api, departuresFor } from './api';
import { keepOffline } from './offline';
import { cacheKey } from './offlineCore';
import { boardKey } from './stopBoardCore';
import { prefetchDue } from './prefetchCore';

const asked = new Map<string, number>();

/** Starts fetching a stop's board (all modes, or one mode) and keeps the answer. Safe to call on every press in. */
export function prefetchStop(id: string, mode?: string | null): void {
  const stop = String(id || '').trim();
  if (!stop) return;
  const key = boardKey(stop, mode || null);
  const now = Date.now();
  if (!prefetchDue(asked, key, now)) return;
  const p = mode ? departuresFor(stop, mode, false) : api.departures(stop, false);
  p.then((d) => keepOffline(cacheKey('dep', key), d)).catch(() => {});
}
