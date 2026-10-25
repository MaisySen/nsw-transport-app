// What the iPhone sends to the Apple Watch app (WatchConnectivity application context). Pure, so it is unit tested
// (test/watchshare.test.mjs). Field names must match WatchContext in targets/watch/WatchCore.swift.
//
// The watch loads live times itself from the server named here (base), so a move of the app's server reaches the
// watch the next time the phone sends a context. Only the person's own places go: Home, Work, starred stops, the
// card of a trip in progress and (version 2, the watch app from build 207) the trips on Home in the order Home
// shows them, with the last times the phone loaded for each so the watch has something to show with no signal.
// Watch apps from build 206 read version 1 fields only and leave the rest alone.
import type { HomeWork, LiveCardShare, SharedStop } from './widgetShare';

export const WATCH_CONTEXT_VERSION = 2;
/** The watch lists this many saved trips at most (Home lists 8 under Your trips). */
export const WATCH_MAX_TRIPS = 8;
/** Phone loaded times per trip: this many services, and a trip's times are replaced at most this often. */
export const WATCH_MAX_NEXT = 3;
export const WATCH_TIMES_GAP_MS = 5 * 60000;
/** The watch lists this many starred stops at most, in the order the app keeps them. */
export const WATCH_MAX_STARRED = 8;

/** The trip card as the watch gets it: no progress bar fraction (it changes every few seconds and the watch does not
 * draw it) and the load time to the minute, so the context only changes when something on the watch would. */
export type WatchLiveCard = Omit<LiveCardShare, 'progress'>;

export type WatchContext = {
  v: number;
  base: string;
  profile: string | null;
  home: SharedStop | null;
  work: SharedStop | null;
  flip: string | null;
  starred: SharedStop[];
  live: WatchLiveCard | null;
  /** Saved trips (server commutes, trips saved on this phone, saved trips), in Home's order. */
  trips: WatchTrip[];
  /** The last times the phone loaded, by trip key ("from>to", or with the change stops between). */
  times: Record<string, WatchTimes>;
};

/** One saved trip. `plan` is the legs as /api/plan takes them, for a trip with changes you chose; else null and
 * the watch asks /api/trip from `from` to `to`. */
export type WatchTrip = { key: string; name: string; kind: 'commute' | 'mine' | 'saved'; from: SharedStop; to: SharedStop; plan: string | null };
/** One service the phone loaded: the first train, bus or ferry of a planned trip. `dep` is ms since 1970. */
export type WatchNext = {
  line: string; color: string | null; mode: string | null; platform: string | null; dep: number; delay: number | null;
  live: boolean; cancelled: boolean; lines: string[]; colors: string[];
};
export type WatchTimes = { at: number; next: WatchNext[] };

/** The lists Home loads from the server (kept on the phone as offline:home:lists). */
export type HomeLists = { commutes?: { items?: any[] } | null; saved?: { items?: any[] } | null } | null;

const okBase = (b: unknown): string | null => {
  const s = typeof b === 'string' ? b.trim().replace(/\/+$/, '') : '';
  return /^https:\/\/[a-z0-9.-]+(\/[^\s?#]*)?$/i.test(s) ? s : null;
};

/** The context for the watch, or null when there is no usable server address. */
export function watchContextFor(
  base: string,
  profile: string | null,
  hw: HomeWork,
  starred: SharedStop[],
  live: LiveCardShare | null,
  trips: WatchTrip[] = [],
  times: Record<string, WatchTimes> = {},
): WatchContext | null {
  const b = okBase(base);
  if (!b) return null;
  const seen = new Set<string>();
  const stars: SharedStop[] = [];
  for (const s of starred || []) {
    if (!s || !s.id || seen.has(s.id)) continue;
    seen.add(s.id);
    stars.push({ id: String(s.id), name: String(s.name || '') });
    if (stars.length >= WATCH_MAX_STARRED) break;
  }
  return {
    v: WATCH_CONTEXT_VERSION,
    base: b,
    profile: profile || null,
    home: hw.home,
    work: hw.work,
    flip: hw.flip,
    starred: stars,
    live: live && live.phase !== 'arrived' ? watchCard(live) : null,
    trips: trips.slice(0, WATCH_MAX_TRIPS),
    times: timesFor(trips, hw, times),
  };
}

/** Only the times of trips the watch shows (both ways of Home and Work too), in key order so equal maps give
 * equal JSON. */
function timesFor(trips: WatchTrip[], hw: HomeWork, times: Record<string, WatchTimes>): Record<string, WatchTimes> {
  const keys = new Set(trips.slice(0, WATCH_MAX_TRIPS).map((t) => t.key));
  if (hw.home && hw.work) { keys.add(`${hw.home.id}>${hw.work.id}`); keys.add(`${hw.work.id}>${hw.home.id}`); }
  const out: Record<string, WatchTimes> = {};
  for (const k of [...keys].sort()) {
    const t = times && times[k];
    if (t && Array.isArray(t.next) && t.next.length) out[k] = t;
  }
  return out;
}

const place = (p: any): SharedStop | null =>
  p && p.id !== undefined && p.id !== null && String(p.id) ? { id: String(p.id), name: String(p.name || '') } : null;

type AnyLeg = { mode?: string; from?: any; to?: any; conn?: number; any?: boolean; walk?: number };
/** The legs of a saved trip: the multi leg form, or the older form with one change stop (`via`). */
function legsOf(t: any): AnyLeg[] {
  if (Array.isArray(t?.legs) && t.legs.length) return t.legs;
  const md: string[] = Array.isArray(t?.modes) ? t.modes : [];
  return t?.via
    ? [{ mode: md[0] || '', from: t.from, to: t.via }, { mode: md[1] || '', from: t.via, to: t.to, conn: t.conn ?? 5 }]
    : [{ mode: md[0] || '', from: t?.from, to: t?.to }];
}

/** The trip's key, the same as tripKeyOf in src/lib/store.ts and tripKey in src/lib/trips.ts: "from>to", or with
 * the change stops between. The phone keeps a trip's times under this key too (offline:trip:<key>[...]). */
export function watchTripKey(t: any): string {
  const legs = legsOf(t);
  return [String(t?.from?.id ?? ''), ...legs.slice(0, -1).map((l) => String(l?.to?.id ?? '')), String(t?.to?.id ?? '')].join('>');
}

/**
 * The trips Home lists under Your trips, in the same order: active server commutes, trips saved on this phone and
 * saved trips, no repeats, none with the two ends of Home and Work (that is the commute card, which the watch
 * builds itself), then your own drag order.
 */
export function watchTripsFor(st: any, lists: HomeLists): WatchTrip[] {
  const places = (st && st.places) || {};
  const home = place(places.home), work = place(places.work);
  const seen = new Set<string>();
  if (home && work && home.id !== work.id) { seen.add(`${home.id}>${work.id}`); seen.add(`${work.id}>${home.id}`); }
  const out: WatchTrip[] = [];
  const add = (t: any, kind: WatchTrip['kind']) => {
    const from = place(t?.from), to = place(t?.to);
    if (!from || !to || from.id === to.id || out.length >= WATCH_MAX_TRIPS) return;
    const key = watchTripKey(t);
    if (seen.has(key)) return;
    seen.add(key);
    const legs = kind === 'mine' ? legsOf(t) : [];
    const plan = legs.length > 1 && legs.every((l) => place(l.from) && place(l.to))
      ? JSON.stringify(legs.map((l) => ({ f: String(l.from.id), fn: String(l.from.name || ''), t: String(l.to.id), tn: String(l.to.name || ''), m: l.mode || '', c: l.conn ?? 5, a: l.any ? 1 : 0, w: l.walk ?? 5 })))
      : null;
    out.push({ key, name: String(t?.name || ''), kind, from, to, plan });
  };
  for (const c of lists?.commutes?.items || []) if (c && c.active) add(c, 'commute');
  for (const m of Array.isArray(st?.myTrips) ? st.myTrips : []) add(m, 'mine');
  for (const s of lists?.saved?.items || []) add(s, 'saved');
  const order: string[] = Array.isArray(st?.tripOrder) ? st.tripOrder : [];
  return out
    .map((t, i) => ({ t, i, p: order.indexOf(t.key) < 0 ? 1000 + i : order.indexOf(t.key) }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map((x) => x.t);
}

const msOf = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v ? Date.parse(v) : NaN);

/** The next services of a trip answer (/api/trip or /api/plan), for the watch to show with no signal. */
export function watchNextFor(data: any, now: number): WatchNext[] {
  const out: WatchNext[] = [];
  for (const j of Array.isArray(data?.journeys) ? data.journeys : []) {
    const legs = (Array.isArray(j?.legs) ? j.legs : []).filter((l: any) => l && l.kind !== 'walk');
    const l = legs[0];
    if (!l) continue;
    const live = !!l.realtime && !!l.estimated;
    const dep = msOf(live ? l.estimated : l.planned);
    if (!Number.isFinite(dep) || dep < now - 30000) continue;
    const lines: string[] = [], colors: string[] = [];
    for (const x of legs) {
      const n = String(x.line || '');
      if (!n || lines.includes(n)) continue;
      lines.push(n); colors.push(String(x.color || ''));
    }
    out.push({
      line: String(l.line || ''), color: l.color ? String(l.color) : null, mode: l.mode ? String(l.mode) : null,
      platform: l.fromPlatform ? String(l.fromPlatform) : null, dep, delay: typeof l.delayMin === 'number' ? l.delayMin : null,
      live, cancelled: !!l.cancelled || !!j.anyCancelled, lines, colors,
    });
  }
  return out.sort((a, b) => a.dep - b.dep).slice(0, WATCH_MAX_NEXT);
}

/** The trip key inside a kept trip answer's storage key ("offline:trip:201110>213510[]|0|0" gives "201110>213510"),
 * or null for another kind of key and for a plan at a chosen time (those keys end with the time). */
export function tripKeyOfCache(storageKey: string): string | null {
  const m = /^offline:trip:([^[|]+)\[[^|]*\]\|[01]\|[01]$/.exec(storageKey || '');
  return m ? m[1] : null;
}

/** New phone times for a trip replace the kept ones only when there were none or they are older than the gap, so
 * the context (and the watch) does not change every time Home refreshes. */
export function shouldTakeTimes(old: WatchTimes | undefined, next: WatchNext[], now: number): boolean {
  if (!next.length) return false;
  if (!old || !old.next.length) return true;
  if (old.next.every((n) => n.dep < now)) return true;
  return now - old.at >= WATCH_TIMES_GAP_MS;
}

function watchCard(c: LiveCardShare): WatchLiveCard {
  const { progress: _progress, ...rest } = c;
  const updated = typeof rest.updated === 'number' && rest.updated > 0 ? Math.floor(rest.updated / 60000) * 60000 : null;
  return { ...rest, updated };
}

/** The same context as JSON, the form the native call takes. Equal contexts give equal strings. */
export const watchContextJSON = (c: WatchContext) => JSON.stringify(c);
