import type { Commute, DeparturesResp, MorningCheck, MorningInput, MorningListResp, MorningPreview, PushCount, Saved, SearchItem, ServiceResp, TripResp, Watch, WatchesResp, Place } from './types';
import { getDevice, PROFILE } from './device';
import { store } from './store';
import type { CarPark, Station, TopupItem } from './access';
import { apiBase } from './server';

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
    return body as T;
  } finally {
    clearTimeout(t);
  }
}

/** Network or timeout failure, as opposed to an answer from the server. Android reports an aborted fetch as "canceled". */
function isNetErr(e: any) {
  const m = String(e?.message || '');
  return !e?.http && (e?.name === 'AbortError' || /cancel|network request failed|timed? ?out|fetch failed/i.test(m));
}

async function req<T>(path: string, init?: RequestInit, timeoutMs = 20000): Promise<T> {
  const read = !init?.method || init.method === 'GET';
  try {
    return await once<T>(path, init, timeoutMs);
  } catch (e: any) {
    if (read && isNetErr(e)) {
      // One quiet retry for reads: mobile networks drop the odd request.
      try { return await once<T>(path, init, timeoutMs); } catch (e2: any) { e = e2; }
    }
    if (isNetErr(e)) {
      // offline marks a failure to reach the server, so screens can fall back to the copy kept on the phone.
      if (/network request failed/i.test(String(e?.message || ''))) throw Object.assign(new Error("You're offline. Showing the last times I had."), { offline: true });
      throw Object.assign(new Error('No answer from the server. Check your connection.'), { offline: true });
    }
    throw e;
  }
}

export const api = {
  search: (q: string) => req<{ items: SearchItem[] }>(`/api/search?${qs({ q })}`),
  nearby: (lat: number, lon: number) => req<{ stops: (SearchItem & { distanceM?: number; dist?: number })[] }>(`/api/nearby?${qs({ lat: lat.toFixed(5), lon: lon.toFixed(5) })}`),
  departures: async (stop: string, refresh = false) => req<DeparturesResp>(`/api/departures?${qs({ stop, device: await getDevice(), profile: PROFILE, refresh: refresh ? 1 : '' })}`),
  trip: async (from: Place, to: Place, opts: { refresh?: boolean; count?: number; time?: string; arriveBy?: boolean } = {}) =>
    req<TripResp>(`/api/trip?${qs({ from: from.id, to: to.id, fromName: from.name, toName: to.name, count: opts.count || 5, time: opts.time, arriveBy: opts.arriveBy ? 1 : '', fare: store.fareType(), acc: store.accOn() ? 1 : '', device: await getDevice(), profile: PROFILE, refresh: opts.refresh ? 1 : '' })}`),
  plan: (legs: any[], opts: { count?: number; time?: string; all?: boolean } = {}) =>
    req<TripResp>(`/api/plan?${qs({ legs: JSON.stringify(legs), count: opts.count || 5, time: opts.time, all: opts.all ? 1 : '', fare: store.fareType(), acc: store.accOn() ? 1 : '' })}`),
  service: (q: Record<string, string | undefined>) => req<ServiceResp>(`/api/service?${qs(q)}`),
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
