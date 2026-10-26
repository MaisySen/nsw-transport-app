// Speed pass (27 Oct 2026, "It's bad everywhere"): the parts with no phone dependencies, tested in test/speed27.test.mjs.
// Every screen paints at once from what the phone already has (a kept copy, or what the screen before it showed) and
// its live answer replaces that; reads go out side by side; a row's next screen is read on press in when that is cheap.
import type { ServiceResp, ServiceStop } from './types';
import { firstPaint, type PackBoard } from './timetablePackCore';

/** What a service screen is opened with (Cards.openService params). Strings, '' when absent. */
export type SvcParams = {
  trip?: string; feed?: string; line?: string; stop?: string; planned?: string; mode?: string; destId?: string; color?: string; dest?: string;
  rt?: string; est?: string; delay?: string; to?: string;
  /** Names and get off time the screen before already showed (a board row's stop, a trip leg's two stops). */
  sname?: string; tname?: string; tplan?: string;
  /** When the row's times were read (epoch ms as text), so the first frame can say how old they are. */
  seen?: string;
};

/**
 * The /api/service query, the same keys in the same order wherever it is built (the service screen, a board's next
 * stops line, a press in prefetch), so the shared read cache joins them into one request.
 */
export function serviceQuery(p: SvcParams): Record<string, string | undefined> {
  const v = (x?: string) => (x ? String(x) : undefined);
  return { trip: v(p.trip), feed: v(p.feed), line: v(p.line), stop: v(p.stop), planned: v(p.planned), mode: v(p.mode), destId: v(p.destId), to: v(p.to), dest: v(p.dest) };
}

/** What a row that opens the service view knows. stopName, toName, arrPlanned and seenAt paint its first frame. */
export type SvcRow = { tripId?: string; feed?: string; line?: string; stopId?: string; planned?: string; mode?: string; destId?: string; color?: string; dest?: string; realtime?: boolean; estimated?: string | null; delayMin?: number | null; toStopId?: string | null;
  stopName?: string | null; toName?: string | null; arrPlanned?: string | null; seenAt?: number | null };

/** The service view's params from a row (speedCore.SvcParams). */
export function svcParams(d: SvcRow): SvcParams & Record<string, string> {
  return { trip: d.tripId || '', feed: d.feed || '', line: d.line || '', stop: d.stopId || '', planned: d.planned || '', mode: d.mode || '', destId: d.destId || '', color: d.color || '', dest: d.dest || '', rt: d.realtime ? '1' : '', est: d.realtime && d.estimated ? d.estimated : '', delay: d.realtime && d.delayMin != null ? String(d.delayMin) : '', to: d.toStopId || '',
    sname: d.stopName || '', tname: d.toName || '', tplan: d.arrPlanned || '', seen: d.seenAt != null && Number.isFinite(Number(d.seenAt)) ? String(d.seenAt) : '' };
}

/** The id the service screen keeps its copy under (offlineCore.cacheKey('svc', ...)). */
export const svcCacheId = (p: SvcParams) => `${p.trip || ''}|${p.planned || ''}|${p.stop || ''}|${p.to || ''}`;

/** How old a row's times may be and still paint a service screen's first frame (older: the screen waits for live). */
export const SEED_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * The service screen's first frame from what the row that was tapped already showed: line, destination, live flag,
 * delay, your stop and its time (and the stop you get off at, from a trip). Marked `seeded`, never kept on the phone,
 * replaced by the live answer. Null when the row says too little (no trip or no line) or its times are too old.
 */
export function serviceSeed(p: SvcParams, now: number): { at: number; data: ServiceResp & { seeded: true } } | null {
  if (!p.trip || !p.line) return null;
  const seen = Number(p.seen);
  const at = Number.isFinite(seen) && seen > 0 && seen <= now ? seen : now;
  if (now - at > SEED_MAX_AGE_MS) return null;
  const live = p.rt === '1';
  const stops: ServiceStop[] = [];
  if (p.stop && p.sname) stops.push({ id: String(p.stop), name: String(p.sname), planned: p.planned || undefined, estimated: live && p.est ? p.est : undefined, mine: true });
  if (p.to && p.tname && p.to !== p.stop) stops.push({ id: String(p.to), name: String(p.tname), planned: p.tplan || undefined, alight: true });
  const delay = live && p.delay !== undefined && p.delay !== '' && Number.isFinite(Number(p.delay)) ? Number(p.delay) : null;
  const data: ServiceResp & { seeded: true } = {
    kind: 'service', seeded: true, tripId: String(p.trip), mode: p.mode || undefined, line: String(p.line), color: p.color || undefined, dest: p.dest || undefined,
    live, delayMin: delay, stops,
    mine: p.stop && p.sname ? { name: String(p.sname), planned: p.planned || undefined, estimated: live && p.est ? p.est : undefined } : null,
  };
  if (stops.length && stops[0].mine) data.mineIndex = 0;
  return { at, data };
}

/** True for a first frame painted from the row that was tapped (serviceSeed), not from the server. */
export const isSeeded = (d: any) => !!(d && typeof d === 'object' && d.seeded === true);

/** Press in prefetch limits: each key at most once per window, and at most this many a minute across the app. */
export const PREFETCH_WINDOW_MS = 20000;
export const PREFETCH_PER_MIN = 8;
/** A copy in memory younger than this is used as it is; no prefetch. */
export const PREFETCH_FRESH_MS = 15000;

/**
 * Gate for press in prefetches: a finger resting on rows while a list scrolls can press in on several, so each key is
 * read at most once per PREFETCH_WINDOW_MS and the whole app at most PREFETCH_PER_MIN a minute. Memory is bounded
 * (keys older than the window are dropped on each call). No timers.
 */
export function createPrefetchGate(windowMs = PREFETCH_WINDOW_MS, perMin = PREFETCH_PER_MIN) {
  const last = new Map<string, number>();
  let recent: number[] = [];
  return {
    allow(key: string, now: number, keptAt?: number | null): boolean {
      for (const [k, t] of last) if (now - t >= windowMs) last.delete(k);
      recent = recent.filter((t) => now - t < 60000);
      if (keptAt != null && now - keptAt < PREFETCH_FRESH_MS) return false;
      if (last.has(key)) return false;
      if (recent.length >= perMin) return false;
      last.set(key, now);
      recent.push(now);
      return true;
    },
    size: () => last.size,
  };
}

/** Metres between two points (equirectangular, fine for a few km). */
export function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const k = Math.PI / 180;
  const x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.sqrt(x * x + y * y) * 6371000;
}

/** A kept nearby list is shown at once only when the phone is still close to where it was made, and it is recent. */
export const NEAR_KEPT_M = 400;
export const NEAR_KEPT_MAX_MS = 12 * 3600 * 1000;
export type NearKept<S> = { at: number; lat: number; lon: number; stops: S[] };

/** The kept nearby stops to paint now, or null when the phone has moved, the list is old or empty. */
export function nearFirstPaint<S>(kept: NearKept<S> | null | undefined, pos: { lat: number; lon: number } | null, now: number): S[] | null {
  if (!kept || !pos || !Array.isArray(kept.stops) || !kept.stops.length) return null;
  if (!Number.isFinite(kept.lat) || !Number.isFinite(kept.lon) || !(kept.at <= now) || now - kept.at > NEAR_KEPT_MAX_MS) return null;
  return metres(kept, pos) <= NEAR_KEPT_M ? kept.stops : null;
}

/**
 * Runs `fn` over items side by side (not one after another) and keeps the input order. A failure gives null for that
 * item and never fails the rest.
 */
export async function allSettledMap<A, B>(items: A[], fn: (a: A, i: number) => Promise<B>): Promise<(B | null)[]> {
  return Promise.all(items.map((a, i) => fn(a, i).catch(() => null)));
}

/** A small session cache with a cap (oldest out first) for answers that barely change, like a route's stops. */
export function createCapped<V>(max: number) {
  const m = new Map<string, V>();
  return {
    get: (k: string) => m.get(k),
    set(k: string, v: V) { m.delete(k); m.set(k, v); while (m.size > max) m.delete(m.keys().next().value as string); },
    size: () => m.size,
  };
}

/**
 * A screen's first frame (hooks.useLive): a recent kept copy, else the stop's timetable pack, else an older kept copy
 * (timetablePackCore.firstPaint), else what the screen before showed (`seed`), else nothing. Every kind but none is
 * labelled with its age until the live answer replaces it.
 */
export function firstFrame<T>(kept: { at: number; data: T } | null, pack: PackBoard | null, seed: { at: number; data: T } | null | undefined, now: number):
  { kind: 'kept' | 'pack' | 'seed' | 'none'; data: T | PackBoard | null; at: number | null } {
  const f = firstPaint<T>(kept, pack, now);
  if (f.kind !== 'none') return f;
  if (seed && seed.data != null && Number.isFinite(seed.at)) return { kind: 'seed', data: seed.data, at: seed.at };
  return f;
}
