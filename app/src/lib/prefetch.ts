// Prefetch on press in (26 Oct 2026, g10): a finger on a stop row starts that stop's departures before the tap ends,
// so the stop screen opens on data. The request goes through the shared read cache in api.ts, so the stop screen's
// first load joins the same request while it is out (or reuses its answer for 4 s), and the answer is also put in the
// kept copies (offline.ts), so a stop screen that opens after it landed paints it on the first frame with its age.
import { api, departuresFor } from './api';
import { keepMem, keepOffline, memAt } from './offline';
import { cacheKey } from './offlineCore';
import { boardKey } from './stopBoardCore';
import { prefetchDue } from './prefetchCore';
import { createPrefetchGate, serviceQuery, svcCacheId, svcParams, type SvcParams, type SvcRow } from './speedCore';

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

// Services (27 Oct speed pass): a finger on a row that opens a service starts its /api/service read. The answer waits in
// memory only (offline.keepMem, capped with the kept copies); the service screen's own live answer is what gets kept.
const gate = createPrefetchGate();

/** The service screen's read for these params (Cards.svcParams), held for its first frame. */
export function prefetchService(p: SvcParams) {
  if (!p.trip) return;
  const key = cacheKey('svc', svcCacheId(p));
  if (!gate.allow(key, Date.now(), memAt(key))) return;
  api.service(serviceQuery(p)).then((r) => keepMem(key, r)).catch(() => {});
}

/** A service answer read for something else (a board's next stops line) kept for the service screen's first frame. */
export function holdService(p: SvcParams, r: unknown) {
  if (p.trip) keepMem(cacheKey('svc', svcCacheId(p)), r);
}

/** Press in on a row that opens a service (Cards.openService): its read starts now, at most once per 20 s per service
 * and 8 a minute across the app; the answer waits in memory for the screen's first frame. */
export function pressService(d: SvcRow) {
  prefetchService(svcParams(d));
}

/** The car park the list showed, held for the car park screen's first frame (with the list's age). */
export function holdPark(p: { id: string }, at?: number | null) {
  if (p && p.id) keepMem(cacheKey('park', `cp:${p.id}`), { carparks: [p] }, at ?? Date.now());
}
