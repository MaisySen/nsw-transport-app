// Prefetch on press in (26 Oct 2026, g10): a finger on a stop row starts that stop's departures before the tap ends,
// so the stop screen opens on data. The request goes through the shared read cache in api.ts, so the stop screen's
// first load joins the same request while it is out (or reuses its answer for 4 s), and the answer is also put in the
// kept copies (offline.ts), so a stop screen that opens after it landed paints it on the first frame with its age.
import { api, departuresFor } from './api';
import { planTrip } from './trips';
import { createForegroundOnce, mayReadAhead } from './homePrefetchCore';
import type { WalkPref } from './walkPrefCore';
import { keepMem, keepOffline, memAt, peekOffline } from './offline';
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
 * and 8 a minute across the app; the answer waits in memory for the screen's first frame. A bus also gets its route's
 * stop list (prefetchRoute), so the service screen can paint the stops after yours next time with no wait. */
export function pressService(d: SvcRow) {
  prefetchService(svcParams(d));
  if (d.line && BUS_ROUTE_MODES.has(String(d.mode || ''))) prefetchRoute(String(d.line));
}

// Bus route stop lists (27 Oct speed pass 4): timetable data kept like route.tsx keeps them (offline cacheKey 'route',
// "LINE|bus"). A kept list younger than ROUTE_FRESH_MS is not asked again; each line at most once per ROUTE_GAP_MS.
const BUS_ROUTE_MODES = new Set(['bus', 'coach', 'school']);
const ROUTE_FRESH_MS = 24 * 3600 * 1000;
const ROUTE_GAP_MS = 10 * 60 * 1000;
const routeAsked = new Map<string, number>();
const routeKey = (line: string) => cacheKey('route', `${line}|bus`);
/** The bus route's stop list kept on the phone (memory, no wait), or null. Only for buses. */
export function keptRoute(line?: string | null, mode?: string | null): unknown {
  if (!line || !BUS_ROUTE_MODES.has(String(mode || ''))) return null;
  return peekOffline<unknown>(routeKey(String(line)))?.data ?? null;
}
/** Reads a bus route's stop list in the background and keeps it, unless a fresh one is kept or it was asked lately. */
export function prefetchRoute(line: string): void {
  const k = routeKey(line);
  const now = Date.now();
  const kept = peekOffline<unknown>(k);
  if (kept && now - kept.at < ROUTE_FRESH_MS) return;
  if (now - (routeAsked.get(k) || 0) < ROUTE_GAP_MS) return;
  routeAsked.set(k, now);
  if (routeAsked.size > 60) routeAsked.delete(routeAsked.keys().next().value as string);
  api.route(line, 'bus').then((raw) => { if (Array.isArray(raw) && raw.length) keepOffline(k, raw); }).catch(() => {});
}

/** The car park the list showed, held for the car park screen's first frame (with the list's age). */
export function holdPark(p: { id: string }, at?: number | null) {
  if (p && p.id) keepMem(cacheKey('park', `cp:${p.id}`), { carparks: [p] }, at ?? Date.now());
}

// Home's read ahead (homePrefetchCore.ts): the top card's trip screen, once per foreground, through the same limits.
const homeOnce = createForegroundOnce();
/** The app came to the front: Home may read ahead once more. */
export function homeForeground() { homeOnce.foreground(); }

/** Reads the trip screen's first page for a plain A to B trip and keeps it under that screen's key, so the screen
 * paints it on its first frame (with its age) and its first request joins this one while it is out. */
export function prefetchTripScreen(plan: { from: { id: string; name: string }; to: { id: string; name: string } }, keepKey: string, walk: WalkPref | undefined, appState: string | null | undefined) {
  // The caller passes the app's state: never with the app in the background.
  if (!mayReadAhead({ focused: true, appState, hasLists: true })) return;
  if (!homeOnce.take(keepKey)) return;
  if (!gate.allow(keepKey, Date.now(), memAt(keepKey))) return;
  // The trip screen's own first request for a plain trip from now (trip.tsx): 6 trips, pages, day lists when served.
  planTrip(plan, { count: 6, walk, page: true, days: true }).then((r) => keepOffline(keepKey, r)).catch(() => {});
}

/** When the copy kept for this key (memory, or read at start) was made, or null. No storage read (instant paint, 30 Oct). */
export function keptAt(key: string): number | null {
  const m = memAt(key);
  if (m != null) return m;
  const k = peekOffline<unknown>(key);
  return k ? k.at : null;
}
