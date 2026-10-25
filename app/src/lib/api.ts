import type { Commute, DeparturesResp, MorningCheck, MorningInput, MorningListResp, MorningPreview, PushCount, Saved, SearchItem, ServiceResp, TripResp, Watch, WatchesResp, Place } from './types';
import { getDevice, PROFILE } from './device';
import { store } from './store';
import type { CarPark, Station, TopupItem } from './access';
import { apiBase, NEW_API_BASE } from './server';
import { placesGone, stopsAsPlaces, type PlaceItem } from './planCore';
import { createReadCache } from './pollCore';
import { stampSeen } from './liveLabelCore';
import { noteBoard } from './recent';
import { createKeep, isLongTrip, longGone, LONG_TRIP_KEEP_MS, LONG_TRIP_TIMEOUT_MS, plannerTooSlow } from './longTripCore';

function qs(o: Record<string, any>) {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function once<T>(path: string, init: RequestInit | undefined, timeoutMs: number): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = init?.body ? { 'content-type': 'application/json' } : {};
    const r = await fetch(apiBase() + path, { ...init, signal: ctl.signal, headers: { ...headers, ...((init?.headers as any) || {}) } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error((body && (body as any).error) || `Something went wrong (${r.status})`), { http: r.status });
    // Rows and legs carry the moment they arrived, so a countdown can say how old its live time is.
    return stampSeen(body as T, Date.now());
  } finally {
    clearTimeout(t);
  }
}

/** Network or timeout failure, as opposed to an answer from the server. Android reports an aborted fetch as "canceled". */
function isNetErr(e: any) {
  const m = String(e?.message || '');
  return !e?.http && (e?.name === 'AbortError' || /cancel|network request failed|timed? ?out|fetch failed|failed to fetch/i.test(m));
}

// Reads are shared (pollCore.ts): two screens or timers asking for the same thing while a request is out get that
// one request, and a good answer is reused for 4 seconds. refresh=1 asks always go out, still shared while out.
// Any write empties the cache, so a read after a save never shows the old list.
const reads = createReadCache(4000);

function req<T>(path: string, init?: RequestInit, timeoutMs = 20000): Promise<T> {
  const read = !init?.method || init.method === 'GET';
  if (!read) { reads.clear(); return send<T>(path, init, timeoutMs, false).finally(() => reads.clear()); }
  const key = `${apiBase()}${path}|${init?.headers ? JSON.stringify(init.headers) : ''}`;
  return reads.get<T>(key, () => send<T>(path, init, timeoutMs, true), { fresh: /[?&]refresh=1(&|$)/.test(path) });
}

async function send<T>(path: string, init: RequestInit | undefined, timeoutMs: number, read: boolean): Promise<T> {
  try {
    return await once<T>(path, init, timeoutMs);
  } catch (e: any) {
    if (read && isNetErr(e)) {
      // One quiet retry for reads: mobile networks drop the odd request.
      try { return await once<T>(path, init, timeoutMs); } catch (e2: any) { e = e2; }
    }
    if (isNetErr(e)) {
      // offline marks a failure to reach the server, so screens can fall back to the copy kept on the phone.
      if (/network request failed|failed to fetch/i.test(String(e?.message || ''))) throw Object.assign(new Error("You're offline. Check your connection."), { offline: true });
      throw Object.assign(new Error('No answer from the server. Check your connection.'), { offline: true });
    }
    throw e;
  }
}

export const api = {
  search: (q: string) => req<{ items: SearchItem[] }>(`/api/search?${qs({ q })}`),
  nearby: (lat: number, lon: number) => req<{ stops: (SearchItem & { distanceM?: number; dist?: number })[] }>(`/api/nearby?${qs({ lat: lat.toFixed(5), lon: lon.toFixed(5) })}`),
  departures: async (stop: string, refresh = false) => {
    const r = await req<DeparturesResp>(`/api/departures?${qs({ stop, device: await getDevice(), profile: PROFILE, refresh: refresh ? 1 : '' })}`);
    // Every board this phone reads (stop screens, Home cards) feeds Recently departed (recentCore.ts).
    noteBoard(stop, r);
    return r;
  },
  trip: async (from: Place, to: Place, opts: { refresh?: boolean; count?: number; time?: string; arriveBy?: boolean; modes?: string[]; date?: string } = {}): Promise<TripResp> => {
    const base = { from: from.id, to: to.id, fromName: from.name, toName: to.name, count: opts.count || 5, time: opts.time, arriveBy: opts.arriveBy ? 1 : '', fare: store.fareType(), acc: store.accOn() ? 1 : '' };
    const pair = `${from.id}>${to.id}`;
    if ((opts.modes && opts.modes.length) || opts.date) return tripPicked(base, pair, opts.modes || [], opts.date || '');
    if (isLongTrip(from.id, to.id) || longPairs.has(pair)) return tripLong(base, opts.refresh);
    try {
      return await req<TripResp>(`/api/trip?${qs({ ...base, device: await getDevice(), profile: PROFILE, refresh: opts.refresh ? 1 : '' })}`);
    } catch (e: any) {
      // The planner took longer than the server waits: ask again the long way, and from now on for this pair.
      if (!plannerTooSlow(e)) throw e;
      longPairs.add(pair);
      return tripLong(base, opts.refresh);
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
  watch: async (body: any) => req<{ ok: boolean; watch: { id: string } }>(`/api/watch`, { method: 'POST', body: JSON.stringify({ device: await getDevice(), profile: PROFILE, ...body }) }),
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
  topup: (lat?: number, lon?: number, limit = 40) => req<{ items: TopupItem[]; source?: string }>(`/api/topup?${qs({ lat: lat != null ? lat.toFixed(5) : '', lon: lon != null ? lon.toFixed(5) : '', limit: lat != null ? limit : '' })}`),
  parkingWatch: async (facility: string) => req<{ ok: boolean; watch?: { name: string }; now?: { status: string } }>(`/api/parking/watch`, { method: 'POST', body: JSON.stringify({ device: await getDevice(), profile: PROFILE, facility }) }),
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
async function tripPicked(base: Record<string, any>, pair: string, modes: string[], date: string): Promise<TripResp> {
  const long = isLongTrip(base.from, base.to) || longPairs.has(pair);
  const extra = { modes: modes.join(','), date, long: long ? 1 : '', count: Math.max(6, Number(base.count) || 6) };
  const path = `/api/trip?${qs({ ...base, ...extra })}`;
  const wait = long ? LONG_TRIP_TIMEOUT_MS : 20000;
  let r: TripResp;
  try {
    r = apiBase() === NEW_API_BASE ? await req<TripResp>(`${path}&${qs({ device: await getDevice(), profile: PROFILE })}`, undefined, wait) : await onNew<TripResp>(path, wait);
  } catch (e: any) {
    if (date) throw Object.assign(new Error("Planning for another day didn't work just now. Pull down to try again, or pick a time today."), { http: e?.http, offline: e?.offline });
    r = await req<TripResp>(`/api/trip?${qs({ ...base, count: 8, device: await getDevice(), profile: PROFILE })}`);
    return { ...r, modesBy: 'phone' } as TripResp;
  }
  const echoed = Array.isArray((r as any).modes);
  if (date && (r as any).date !== date) throw new Error("Planning for another day didn't work just now. Pull down to try again, or pick a time today.");
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
    if (!r.ok) throw Object.assign(new Error((body && (body as any).text) || (body && (body as any).error) || `Something went wrong (${r.status})`), { http: r.status });
    return stampSeen(body as T, Date.now());
  } catch (e: any) {
    if (e?.http) throw e;
    throw Object.assign(new Error("No answer from the server. Check your connection."), { offline: true });
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
export async function searchPlaces(q: string): Promise<{ items: PlaceItem[]; places: boolean }> {
  if (!placesOff) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch(`${NEW_API_BASE}/api/places?${qs({ q })}`, { signal: ctl.signal });
      if (!r.ok) throw Object.assign(new Error(`Something went wrong (${r.status})`), { http: r.status });
      const body = await r.json();
      if (Array.isArray(body?.items)) return { items: body.items as PlaceItem[], places: true };
    } catch (e: any) {
      if (placesGone(e)) placesOff = true;
    } finally {
      clearTimeout(t);
    }
  }
  const r = await api.search(q);
  return { items: stopsAsPlaces(r.items || []), places: false };
}
