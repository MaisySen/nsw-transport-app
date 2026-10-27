import type { Commute, DeparturesResp, MorningCheck, MorningInput, MorningListResp, MorningPreview, PushCount, Saved, SearchItem, ServiceResp, TripResp, Watch, WatchesResp, Place } from './types';
import { getDevice, PROFILE } from './device';
import { store } from './store';
import { readWalkPref, walkQuery, type WalkPref } from './walkPrefCore';
import type { CarPark, Station, TopupItem } from './access';
import { noteRequest } from './crashCore';
import { apiBase, fallbackFor, NEW_API_BASE, noteFallback, noteNewServerOk, readBase, setErrorWords } from './server';
import { placesGone, stopsAsPlaces, type PlaceItem } from './planCore';
import { EARLIER_NEEDS_NEW, ymd } from './tripModesCore';
import { BOARD_EARLIER_NEEDS_NEW, boardQuery, honoured } from './boardTimeCore';
import { createReadCache } from './pollCore';
import { stampSeen } from './liveLabelCore';
import { LIVE_DATA_AGE } from './features';
import { cleanAlertTexts } from './htmlTextCore';
import { noteBoard } from './recent';
import { boardKey } from './stopBoardCore';
import { createKeep, isLongTrip, longGone, LONG_TRIP_KEEP_MS, LONG_TRIP_TIMEOUT_MS } from './longTripCore';
import { httpError, isNetErr as netErr, legacyWorthy, noAnswerError, noteReach, onFailWhy, READ_MS_EMPTY, READ_MS_WITH_COPY, TRIP_MS } from './netErrCore';
import { setOfflineWhy } from './offlineCore';

// Kept times say why they are on screen: the phone offline, or the live data down (netErrCore.ts).
onFailWhy(setOfflineWhy);
setErrorWords({ http: httpError, noAnswer: (e: any) => (netErr(e) ? noAnswerError(e) : e), reach: noteReach });

function qs(o: Record<string, any>) {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function once<T>(path: string, init: RequestInit | undefined, timeoutMs: number, base: string = apiBase()): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = init?.body ? { 'content-type': 'application/json' } : {};
    const r = await fetch(base + path, { ...init, signal: ctl.signal, headers: { ...headers, ...((init?.headers as any) || {}) } });
    noteReach();
    noteRequest(path, r.status);
    const body = await r.json().catch(() => ({}));
    // The server's own words, never a bare status (netErrCore.ts); a 5xx or 429 is marked server (live data's fault).
    if (!r.ok) throw httpError(r.status, body);
    // Rows and legs carry the moment they arrived, so a countdown can say how old its live time is. An answer the
    // server took from its shared cache says when it was made (dataAt); the older of the two is the honest one.
    // LIVE_DATA_AGE (features.ts): each live row's age counts from when its time was read upstream (the row's liveAt).
    return stampSeen(cleanAlertTexts(body as T), dataTime(body, Date.now()), LIVE_DATA_AGE ? Date.now() : undefined);
  } finally {
    clearTimeout(t);
  }
}

/** When an answer's times were read: the server's dataAt for a cached answer (never in the future, at most 15 min back:
 * a first open can get the server's saved board at once, minutes old, while it fetches a fresh one), else now. */
export function dataTime(body: any, now: number): number {
  const d = body && typeof body === 'object' ? Number((body as any).dataAt) : NaN;
  return Number.isFinite(d) && d <= now && now - d < 900000 ? d : now;
}

/** Network or timeout failure, as opposed to an answer from the server. Android reports an aborted fetch as "canceled". */
function isNetErr(e: any) {
  return netErr(e);
}

// Reads are shared (pollCore.ts): two screens or timers asking for the same thing while a request is out get that
// one request, and a good answer is reused for 4 seconds. refresh=1 asks always go out, still shared while out.
// Any write empties the cache, so a read after a save never shows the old list.
const reads = createReadCache(4000);

function req<T>(path: string, init?: RequestInit, timeoutMs = READ_MS_EMPTY): Promise<T> {
  const read = !init?.method || init.method === 'GET';
  if (!read) { reads.clear(); return send<T>(path, init, timeoutMs, false).finally(() => reads.clear()); }
  const key = `${apiBase()}${path}|${init?.headers ? JSON.stringify(init.headers) : ''}`;
  return reads.get<T>(key, () => send<T>(path, init, timeoutMs, true), { fresh: /[?&]refresh=1(&|$)/.test(path) });
}

async function send<T>(path: string, init: RequestInit | undefined, timeoutMs: number, read: boolean): Promise<T> {
  // Reads go to the first server for a minute after the new one failed and the first one answered (server.ts).
  const first = read ? readBase() : apiBase();
  const t0 = Date.now();
  try {
    try {
      const v = await once<T>(path, init, timeoutMs, first);
      if (read && first === NEW_API_BASE) noteNewServerOk();
      return v;
    } catch (e: any) {
      if (read && isNetErr(e)) {
        // One quiet retry for reads: mobile networks drop the odd request. Not after a time out (that would double the wait).
        if (e?.name === 'AbortError' || Date.now() - t0 > timeoutMs / 2) throw e;
        return await once<T>(path, init, timeoutMs, first);
      }
      throw e;
    }
  } catch (e: any) {
    // Fallback (docs/DIAGNOSIS_LAG.md item 5): a read is asked of the first server once only when the new server could
    // not be reached at all, never after a time out or an error answer (those are the live data's, and the first
    // server would wait on the same Transport for NSW key). A phone with no connection fails the same way there, as fast.
    const alt = read ? fallbackFor(first) : null;
    if (alt && legacyWorthy(e)) {
      try {
        const v = await once<T>(path, init, Math.min(timeoutMs, 12000), alt);
        noteFallback(true);
        return v;
      } catch (e2: any) {
        noteFallback(false);
        if (!e?.http) e = e2;
      }
    }
    // offline (no connection) or slow (the server answered other requests lately): either way screens fall back to
    // the copy kept on the phone, and the words say which it is.
    if (isNetErr(e)) throw noAnswerError(e);
    throw e;
  }
}

/** When this phone last started a watch: the alerts timer asks every tick again at once (push.ts, notesWaitMs). */
export const watchClock = { startedAt: 0 };

export const api = {
  search: (q: string) => req<{ items: SearchItem[] }>(`/api/search?${qs({ q })}`),
  nearby: (lat: number, lon: number) => req<{ stops: (SearchItem & { distanceM?: number; dist?: number })[] }>(`/api/nearby?${qs({ lat: lat.toFixed(5), lon: lon.toFixed(5) })}`),
  departures: async (stop: string, refresh = false, mode?: string) => {
    // A refresh has the board on screen already, so it waits less (netErrCore.ts read deadlines).
    const r = await req<DeparturesResp>(`/api/departures?${qs({ stop, mode: mode || '', device: await getDevice(), profile: PROFILE, refresh: refresh ? 1 : '' })}`, undefined, refresh ? READ_MS_WITH_COPY : READ_MS_EMPTY);
    // Every board this phone reads (stop screens, Home cards) feeds Recently departed (recentCore.ts). A board for one
    // mode is kept apart, so trains missing from a bus board never read as departed.
    noteBoard(boardKey(stop, mode), r);
    return mode ? { ...r, askedMode: mode } : r;
  },
  trip: async (from: Place, to: Place, opts: { refresh?: boolean; count?: number; time?: string; arriveBy?: boolean; modes?: string[]; date?: string; walk?: WalkPref } = {}): Promise<TripResp> => {
    // The trip screen's Walking choice (opts.walk, only that screen sends it) rides along (maxWalk, lessWalk) for a server that takes it; the phone filters
    // either way (walkPrefCore.ts), so with a limit it asks for the most trips the server gives (8).
    const wp = readWalkPref(opts.walk);
    const base = { from: from.id, to: to.id, fromName: from.name, toName: to.name, count: wp.max > 0 ? 8 : opts.count || 5, time: opts.time, arriveBy: opts.arriveBy ? 1 : '', fare: store.fareType(), acc: store.accOn() ? 1 : '', ...walkQuery(wp) };
    const pair = `${from.id}>${to.id}`;
    if ((opts.modes && opts.modes.length) || opts.date) return tripPicked(base, pair, opts.modes || [], opts.date || '');
    if (isLongTrip(from.id, to.id) || longPairs.has(pair)) return tripLong(base, opts.refresh);
    try {
      // One deadline for a trip search (docs/DIAGNOSIS_LAG.md item 3). The server answers a refused Trip Planner with
      // timetable trips or a plain error, so an error answer is never read as "too slow" and never asked again here.
      return await req<TripResp>(`/api/trip?${qs({ ...base, device: await getDevice(), profile: PROFILE, refresh: opts.refresh ? 1 : '' })}`, undefined, TRIP_MS);
    } catch (e: any) {
      // No answer in time while the server is reachable: the next search of this pair goes the long way (no second
      // wait now). A server that timed out on the planner itself (504) is the same.
      if (e?.slow || e?.http === 504) longPairs.add(pair);
      throw e;
    }
  },
  plan: (legs: any[], opts: { count?: number; time?: string; all?: boolean } = {}) =>
    req<TripResp>(`/api/plan?${qs({ legs: JSON.stringify(legs), count: opts.count || 5, time: opts.time, all: opts.all ? 1 : '', fare: store.fareType(), acc: store.accOn() ? 1 : '' })}`),
  service: (q: Record<string, string | undefined>) => req<ServiceResp>(`/api/service?${qs(q)}`),
  /** A bus route's stops in order, each direction: [{ to, stops: [[id, name, lat, lon]] }]. 404 when there is no such route. */
  route: (line: string, mode = 'bus') => req<any>(`/api/stations?${qs({ mode, route: line })}`, undefined, 25000),
  alerts: (q = '') => req<{ items?: any[]; alerts?: any[] }>(`/api/alerts?${qs({ q })}`),
  saved: () => req<{ items: Saved[] }>(`/api/saved?${qs({ profile: PROFILE })}`),
  saveTrip: (name: string, from: Place, to: Place) => req<{ ok: boolean }>(`/api/saved`, { method: 'POST', body: JSON.stringify({ profile: PROFILE, name, from, to }) }),
  saveTripLegs: (name: string, legs: any[]) => req<{ ok: boolean }>(`/api/saved`, { method: 'POST', body: JSON.stringify({ profile: PROFILE, name, legs }) }),
  deleteSaved: (name: string) => req<{ ok: boolean }>(`/api/saved?${qs({ profile: PROFILE, name })}`, { method: 'DELETE' }),
  commutes: () => req<{ items: Commute[]; suggestion: any; now: number }>(`/api/commutes?${qs({ profile: PROFILE })}`),
  saveCommute: (body: Partial<Commute> & { from?: Place; to?: Place }) => req<{ ok: boolean; item: Commute }>(`/api/commutes?${qs({ profile: PROFILE })}`, { method: 'POST', body: JSON.stringify(body) }),
  deleteCommute: (id: string) => req<{ ok: boolean }>(`/api/commutes?${qs({ profile: PROFILE, id })}`, { method: 'DELETE' }),
  dismissSuggestion: (key: string) => req<{ ok: boolean }>(`/api/commutes/dismiss?${qs({ profile: PROFILE })}`, { method: 'POST', body: JSON.stringify({ key }) }),
  watches: async (since = 0) => req<WatchesResp>(`/api/watches?${qs({ device: await getDevice(), profile: PROFILE, since })}`),
  watch: async (body: any) => {
    const r = await req<{ ok: boolean; watch: { id: string } }>(`/api/watch`, { method: 'POST', body: JSON.stringify({ device: await getDevice(), profile: PROFILE, ...body }) });
    watchClock.startedAt = Date.now();
    return r;
  },
  watchDetail: (id: string) => req<{ watch: Watch; notes: any[]; now: number }>(`/api/watch?${qs({ id })}`),
  stopWatch: async (id: string) => req<{ ok: boolean }>(`/api/watch?${qs({ id, device: await getDevice() })}`, { method: 'DELETE' }),
  registerExpo: async (token: string, platform: string, welcome = false) =>
    req<{ ok: boolean; test?: any }>(`/api/push/expo`, { method: 'POST', body: JSON.stringify({ device: await getDevice(), profile: PROFILE, token, platform, welcome }) }),
  unregisterExpo: async (token: string) => req<{ ok: boolean }>(`/api/push/expo/unregister`, { method: 'POST', body: JSON.stringify({ device: await getDevice(), token }) }),
  /** Deletes this profile's trip history on the server ("history"), or everything it keeps ("all"). */
  deleteHistory: async (scope: 'history' | 'all') => req<{ ok: boolean; deleted?: Record<string, number> }>(`/api/history/delete`, { method: 'POST', body: JSON.stringify({ profile: PROFILE, device: await getDevice(), scope }) }),
  shareStart: async (body: any) => req<{ ok: boolean; id: string; key: string; url: string; expires: number }>(`/api/share`, { method: 'POST', body: JSON.stringify({ device: await getDevice(), ...body }) }),
  shareUpdate: (body: any) => req<{ ok: boolean }>(`/api/share/update`, { method: 'POST', body: JSON.stringify(body) }),
  shareEnd: (id: string, key: string) => req<{ ok: boolean }>(`/api/share?${qs({ id })}`, { method: 'DELETE', headers: { 'x-share-key': key } }),
  // Station access, Park and Ride and Opal machines.
  station: (id: string) => req<Station>(`/api/station?${qs({ id })}`),
  parking: (stop?: string) => req<{ carparks: CarPark[]; station?: string; source?: string }>(`/api/parking?${qs({ stop })}`, undefined, 30000),
  /** One car park, live (the same /api/parking, by facility id). */
  carpark: (id: string) => req<{ carpark: CarPark; source?: string }>(`/api/parking?${qs({ id })}`, undefined, 30000),
  topup: (lat?: number, lon?: number, limit = 40) => req<{ items: TopupItem[]; source?: string }>(`/api/topup?${qs({ lat: lat != null ? lat.toFixed(5) : '', lon: lon != null ? lon.toFixed(5) : '', limit: lat != null ? limit : '' })}`),
  parkingWatch: async (facility: string) => req<{ ok: boolean; watch?: { name: string }; now?: { status: string } }>(`/api/parking/watch`, { method: 'POST', body: JSON.stringify({ device: await getDevice(), profile: PROFILE, facility }) }),
  /** Saved trip alerts (backend/src/tripalerts.js): this phone's trips; off deletes them on the server. */
  tripAlerts: async (on: boolean, trips: import('./tripAlertsCore').AlertTrip[] = []) => req<{ ok: boolean; on: boolean; enabled?: boolean; trips?: number; now?: { trip: string; title: string; url?: string | null; planned?: boolean }[] }>(`/api/trip-alerts`, { method: 'POST', body: JSON.stringify(on ? { device: await getDevice(), profile: PROFILE, on: true, trips } : { device: await getDevice(), on: false }) }),
  liftAlerts: async (on: boolean, stations: string[] = []) => req<{ ok: boolean; now?: { title: string; url?: string }[] }>(`/api/lifts/alerts`, { method: 'POST', body: JSON.stringify(on ? { device: await getDevice(), profile: PROFILE, on: true, stations } : { device: await getDevice(), on: false }) }),
  // Morning check: one alert before the usual trip, only when something is wrong. Keyed by the same device id as push.
  morningList: async () => req<MorningListResp>(`/api/morning-check?${qs({ device: await getDevice() })}`),
  morningSave: async (body: MorningInput) => req<{ ok: boolean; item: MorningCheck; push: PushCount; enabled: boolean }>(`/api/morning-check`, { method: 'POST', body: JSON.stringify({ device: await getDevice(), ...body }) }),
  /** Deletes one check, or every check of this phone without an id. */
  morningDelete: async (id?: string) => req<{ ok: boolean; deleted: number }>(`/api/morning-check?${qs({ device: await getDevice(), id })}`, { method: 'DELETE' }),
  morningPreview: async (id: string) => req<MorningPreview>(`/api/morning-check/preview?${qs({ device: await getDevice(), id })}`),
  testPush: async () => req<{ ok: boolean; pushed: any[]; expo?: any[] }>(`/api/push/test`, { method: 'POST', body: JSON.stringify({ device: await getDevice() }) }),
};

// Long distance trips (longTripCore.ts): the new server waits up to 35 s for the planner and keeps the answer for
// 2 minutes; the app keeps it 2 minutes too, so the trip screen and Home do not ask the planner again on every
// refresh. Until the app moves there, a 404 means the server in use, with a longer wait, for the session.
const longPairs = new Set<string>();
const longKeep = createKeep<TripResp>(LONG_TRIP_KEEP_MS);
const longOut = new Map<string, Promise<TripResp>>();
let longOff = false;
async function tripLong(base: Record<string, any>, refresh?: boolean): Promise<TripResp> {
  const path = `/api/trip?${qs({ ...base, long: 1 })}`;
  const kept = longKeep.get(path);
  if (kept && !refresh) return kept;
  const out = longOut.get(path);
  if (out) return out;
  const p = (async () => {
    let r: TripResp;
    if (apiBase() === NEW_API_BASE || longOff) {
      r = await req<TripResp>(apiBase() === NEW_API_BASE ? `${path}&${qs({ device: await getDevice(), profile: PROFILE })}` : path, undefined, LONG_TRIP_TIMEOUT_MS);
    } else {
      try {
        r = await onNew<TripResp>(path, LONG_TRIP_TIMEOUT_MS);
      } catch (e: any) {
        if (!longGone(e)) throw e;
        longOff = true;
        r = await req<TripResp>(path, undefined, LONG_TRIP_TIMEOUT_MS);
      }
    }
    if ((r as any)?.journeys?.length) longKeep.set(path, r);
    return r;
  })();
  longOut.set(path, p);
  try { return await p; } finally { longOut.delete(path); }
}

// Mode chips (Bus only, Train and bus) and another day: only the new server takes `modes` and `date` (it asks the
// planner for those modes and echoes them back). Until the app moves there these trips go to it directly, with no
// profile or device. If it does not answer, modes fall back to the server in use with the phone filtering its usual
// answer (`modesBy: 'phone'`, the screen says so honestly); a day cannot be planned there, so that is an error.
// A date the new server could not plan. Today's date means a time over 30 min ago (the older server plans that
// time for tomorrow), so it says so plainly; another day says pick a time today.
function dayMiss(date: string): string {
  return date === ymd(Date.now()) ? EARLIER_NEEDS_NEW : "Planning for another day didn't work just now. Pull down to try again, or pick a time today.";
}
async function tripPicked(base: Record<string, any>, pair: string, modes: string[], date: string): Promise<TripResp> {
  const long = isLongTrip(base.from, base.to) || longPairs.has(pair);
  const extra = { modes: modes.join(','), date, long: long ? 1 : '', count: Math.max(6, Number(base.count) || 6) };
  const path = `/api/trip?${qs({ ...base, ...extra })}`;
  const wait = long ? LONG_TRIP_TIMEOUT_MS : TRIP_MS;
  let r: TripResp;
  try {
    r = apiBase() === NEW_API_BASE ? await req<TripResp>(`${path}&${qs({ device: await getDevice(), profile: PROFILE })}`, undefined, wait) : await onNew<TripResp>(path, wait);
  } catch (e: any) {
    if (date) throw Object.assign(new Error(dayMiss(date)), { http: e?.http, offline: e?.offline });
    r = await req<TripResp>(`/api/trip?${qs({ ...base, count: 8, device: await getDevice(), profile: PROFILE })}`);
    return { ...r, modesBy: 'phone' } as TripResp;
  }
  const echoed = Array.isArray((r as any).modes);
  if (date && (r as any).date !== date) throw new Error(dayMiss(date));
  return { ...r, modesBy: modes.length ? (echoed ? 'server' : 'phone') : undefined } as TripResp;
}

/**
 * Calendar leave by on Home (docs/CALENDAR-LEAVE-BY.md): the trip to an event's place, Arrive by its start, with no
 * install id, profile or names, so the server can't keep it in trip history or link it to this phone. Another day
 * (an event after midnight) needs the new host's date parameter; a server without it fails and the line is hidden.
 */
export async function tripForCalendar(fromId: string, toId: string, q: { time: string; arriveBy: boolean; date?: string }): Promise<TripResp> {
  const path = `/api/trip?${qs({ from: fromId, to: toId, count: 6, time: q.time, arriveBy: q.arriveBy ? 1 : '', date: q.date || '', acc: store.accOn() ? 1 : '' })}`;
  if (!q.date || apiBase() === NEW_API_BASE) {
    const r = await req<TripResp>(path, undefined, 20000);
    if (q.date && (r as any).date !== q.date) throw new Error('This server does not plan for another day.');
    return r;
  }
  const r = await onNew<TripResp>(path, 20000);
  if ((r as any).date !== q.date) throw new Error('This server does not plan for another day.');
  return r;
}

/** One GET to the new server (before the app has moved there), with a timeout; errors carry http like req. */
async function onNew<T>(path: string, timeoutMs: number): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${NEW_API_BASE}${path}`, { signal: ctl.signal });
    const body = await r.json().catch(() => ({}));
    noteReach();
    if (!r.ok) throw httpError(r.status, body);
    return stampSeen(cleanAlertTexts(body as T), Date.now());
  } catch (e: any) {
    if (e?.http) throw e;
    throw noAnswerError(e);
  } finally {
    clearTimeout(t);
  }
}

/** True for a pair planned the long way (the trip screen then refreshes every 2 minutes, not every 20 s). */
export const isLongPair = (fromId: string, toId: string) => isLongTrip(fromId, toId) || longPairs.has(`${fromId}>${toId}`);

// Plan search: stops, addresses, streets, landmarks and suburbs from /api/places, which only the new host has.
// Until every server has it, a 404 there means stops only from /api/search on the server in use, for the rest
// of the session; a dropped connection or a slow answer falls back for this search only.
let placesOff = false;
export async function searchPlaces(q: string, signal?: AbortSignal): Promise<{ items: PlaceItem[]; places: boolean }> {
  if (!placesOff) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    // A newer keystroke cancels this request (the search box passes its own signal).
    if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', () => ctl.abort()); }
    try {
      const r = await fetch(`${NEW_API_BASE}/api/places?${qs({ q })}`, { signal: ctl.signal });
      if (!r.ok) throw httpError(r.status, {});
      const body = await r.json();
      if (Array.isArray(body?.items)) return { items: body.items as PlaceItem[], places: true };
    } catch (e: any) {
      if (placesGone(e)) placesOff = true;
    } finally {
      clearTimeout(t);
    }
  }
  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
  const r = await api.search(q);
  return { items: stopsAsPlaces(r.items || []), places: false };
}

// A stop's board at another time (Earlier departures and the time chip on the stop screen): only
// api.transportsydney.app takes `time` and `date` on /api/departures, and it echoes `at`. Until the app moves there
// these requests go to it directly, with no device or profile. No answer: the screen says Earlier departures need a
// newer server. An answer without `at` (a server without the parameter): the row and the chip are hidden for the
// rest of the session, and the board stays on now.
let boardTimeOff = false;
export const boardTimeSupported = () => !boardTimeOff;
export async function departuresAt(stop: string, t: number): Promise<DeparturesResp> {
  const q = boardQuery(t);
  const path = `/api/departures?${qs({ stop, time: q.time, date: q.date })}`;
  let r: DeparturesResp;
  try {
    r = apiBase() === NEW_API_BASE ? await req<DeparturesResp>(`${path}&${qs({ device: await getDevice(), profile: PROFILE })}`, undefined, 15000) : await onNew<DeparturesResp>(path, 15000);
  } catch (e: any) {
    throw Object.assign(new Error(BOARD_EARLIER_NEEDS_NEW), { http: e?.http, offline: e?.offline, needsNew: true });
  }
  if (!honoured(r, q)) {
    boardTimeOff = true;
    throw Object.assign(new Error('This server shows departures from now only.'), { unsupported: true });
  }
  return r;
}

// A stop's board for one mode (the stop screen's mode or route chip at a stop with several modes). Only
// api.transportsydney.app asks the Trip Planner for that mode alone, so its 40 services reach further ahead (buses at
// Strathfield: about 50 minutes, where the buses in a mixed board of 40 cover about 15). Until the app moves there,
// this request goes to it directly (no device or profile) and falls back to the server in use on any failure, which
// filters its mixed board as before.
export async function departuresFor(stop: string, mode: string, refresh = false): Promise<DeparturesResp> {
  if (apiBase() === NEW_API_BASE) return api.departures(stop, refresh, mode);
  let r: DeparturesResp | null = null;
  try {
    const x = await onNew<DeparturesResp>(`/api/departures?${qs({ stop, mode, refresh: refresh ? 1 : '' })}`, 8000);
    if (x && Array.isArray((x as any).items)) r = x;
  } catch { /* the server in use answers instead */ }
  if (!r) return api.departures(stop, refresh, mode);
  noteBoard(boardKey(stop, mode), r);
  return { ...r, askedMode: mode };
}

