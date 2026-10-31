// Offline copies of the last answers for Home, Work, saved trips and starred stops, so a fresh start with no
// signal still shows the next services. Pure logic here; storage lives in offline.ts.

// The phone's 24-Hour Time setting (iPhone Settings, General, Date and Time): lib/rowTime.ts installs the reader
// at start (installPhoneClock). Until then, and in tests, the 12 hour clock the app has always used.
const PHONE24 = (): boolean => { try { return (globalThis as any).__tslPhone24h?.() === true; } catch { return false; } };
/** "07:55" (or "07:55:30"), Sydney time, for a phone set to 24 hour time. */
const C24 = (t: number, sec = false): string => {
  try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}), hourCycle: 'h23', timeZone: 'Australia/Sydney' } as Intl.DateTimeFormatOptions).format(new Date(t)); }
  catch { const d = new Date(t); return [d.getHours(), d.getMinutes(), ...(sec ? [d.getSeconds()] : [])].map((n) => String(n).padStart(2, '0')).join(':'); }
};

/** Copies older than this are not shown at all: by then every time in them has gone. */
export const MAX_AGE_MS = 18 * 3600 * 1000;
/** How many answers are kept on the phone. The oldest goes first. */
// 40 since the 27 Oct speed pass: car parks, settings lists and watches keep a copy too (each a few KB).
// 64 since the 30 Oct instant paint pass: more stops, trips and services open on a kept copy (a few KB each, read in one
// multiGet at start; about 64 x 6 KB at most).
export const MAX_ENTRIES = 64;

const t = (s?: string | null) => (s ? new Date(s).getTime() : NaN);
/** Estimated time when the service is live and has one, else the timetable. */
export function bestOf(planned?: string | null, estimated?: string | null, realtime?: boolean) {
  const e = realtime ? t(estimated) : NaN;
  return Number.isFinite(e) ? e : t(planned);
}

/** When a journey leaves: its first leg's best time, else its leave field. */
export function journeyLeaves(j: any): number {
  const l = j && Array.isArray(j.legs) ? j.legs[0] : null;
  const v = l ? bestOf(l.planned, l.estimated, l.realtime) : NaN;
  if (Number.isFinite(v)) return v;
  const leave = typeof j?.leave === 'number' ? j.leave : t(j?.leave);
  return Number.isFinite(leave) ? leave : NaN;
}

/** A departures answer without the services that have already left. */
export function pruneDepartures<T extends { items?: any[] }>(d: T, now: number): T {
  if (!d || !Array.isArray(d.items)) return d;
  // A kept copy is read back from the phone's storage, so a row that is not an object (a broken or older copy) is
  // dropped here instead of stopping the screen that reads it (28 Oct crash hunt).
  return { ...d, items: d.items.filter((x) => !!x && typeof x === 'object' && bestOf(x.planned, x.estimated, x.realtime) > now) };
}

/** A trip answer without the journeys that have already left. */
export function pruneTrip<T extends { journeys?: any[] }>(d: T, now: number): T {
  if (!d || !Array.isArray(d.journeys)) return d;
  return { ...d, journeys: d.journeys.filter((j) => journeyLeaves(j) > now) };
}

/** Either kind of answer, by its shape. Anything else is returned as it is. */
export function prune<T>(d: T, now: number): T {
  const x: any = d;
  if (x && Array.isArray(x.journeys)) return pruneTrip(x, now);
  if (x && Array.isArray(x.items) && x.kind === 'departures') return pruneDepartures(x, now);
  return d;
}

/** True when an answer is worth keeping: it has at least one service in it. */
export function worthKeeping(d: any): boolean {
  if (!d || typeof d !== 'object' || d.error) return false;
  // A first frame painted from the row that was tapped (speedCore.serviceSeed) is never kept.
  if (d.seeded === true) return false;
  // The server's stand ins (27 Oct speed pass 4) are never kept: a car park list whose live counts are still being read,
  // a board at another time on timetable rows. A copy with real counts or live times stays the kept one.
  if (d.fallback === 'counts-loading' || (d.source === 'timetable' && d.fallback === 'planner-slow' && d.at)) return false;
  if (Array.isArray(d.carparks)) return d.carparks.length > 0;
  if (Array.isArray(d.journeys)) return d.journeys.length > 0;
  if (Array.isArray(d.items)) return d.items.length > 0;
  return true;
}

/** A stored copy that can still be shown, or null when it is missing, broken or too old. */
export function usable(entry: any, now: number): { at: number; data: any } | null {
  if (!entry || typeof entry !== 'object' || typeof entry.at !== 'number' || entry.data == null) return null;
  if (entry.at > now + 60000 || now - entry.at > MAX_AGE_MS) return null;
  return entry;
}

/** The key list after writing `key` (newest first) and the keys that drop off the end. */
export function touch(index: string[], key: string, max = MAX_ENTRIES): { index: string[]; evict: string[] } {
  const list = [key, ...index.filter((k) => k !== key)];
  return { index: list.slice(0, max), evict: list.slice(max) };
}

/** "8:05am" in Sydney time, with "yesterday" in front when the copy is from the day before. */
export function stampText(at: number, now: number): string {
  const opt: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' };
  let s: string;
  if (PHONE24()) s = C24(at);
  else try { s = new Date(at).toLocaleTimeString('en-AU', opt).replace(/\s?(am|pm)/i, (m) => m.trim().toLowerCase()); }
  catch { const d = new Date(at), h = d.getHours(); s = `${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; }
  const day = (x: number) => { try { return new Date(x).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); } catch { return new Date(x).toDateString(); } };
  return day(at) === day(now) ? s : `yesterday ${s}`;
}

/** The line shown with stored times: "Offline, showing times from 8:05am". */
// Why the kept times are on screen: the phone is offline, or the live data is down (a server error or slow answers
// while the phone is online). Set by api.ts from netErrCore.ts, so the label never blames the phone's signal for an
// outage of Transport for NSW's live data (g16).
let offWhy: 'phone' | 'server' = 'phone';
export function setOfflineWhy(w: 'phone' | 'server') { offWhy = w; }
export function offlineText(at: number, now: number): string {
  return offWhy === 'server' ? `Live times unavailable, showing times from ${stampText(at, now)}` : `Offline, showing times from ${stampText(at, now)}`;
}
/** The one word tag for Home's header while kept times are on screen. */
export function offlineWord(): string {
  return offWhy === 'server' ? 'No live times' : 'Offline';
}

/** How old a kept copy is, in words: "just now", "4 min ago", "1 h 5 min ago", or its time when older than 3 hours. */
export function agoText(at: number, now: number): string {
  const min = Math.floor(Math.max(0, now - at) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 180) return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''} ago`;
  return `at ${stampText(at, now)}`;
}

/** The line shown with a kept copy while the live answer is on its way: "Updated 4 min ago, refreshing". */
export function staleText(at: number, now: number): string {
  return `Updated ${agoText(at, now)}, refreshing`;
}

/** Storage key for a cached answer. */
export const cacheKey = (kind: 'trip' | 'dep' | 'home' | 'svc' | 'park' | 'list' | 'route', id: string) => `offline:${kind}:${id}`;

/**
 * Kept copies of the light per phone lists (27 Oct speed pass 3), so their screens paint at once with their age:
 * Watching, one watch's detail (`watch(id)`), More's commutes and watch count, the morning checks and the Opal machines
 * list. Each is a few KB, inside MAX_ENTRIES. Delete all my data clears them with the rest (offline.forgetOffline).
 */
export const LIST_KEYS = {
  watches: cacheKey('list', 'watches'),
  watch: (id: string) => cacheKey('list', `watch:${id}`),
  settings: cacheKey('list', 'settings'),
  morning: cacheKey('list', 'morning'),
  topup: cacheKey('list', 'topup'),
};

/**
 * A watch's detail painted from the Watching list's kept copy (the same watch object the list shows), with no notes
 * until the detail answer lands; null when the list has no watch with this id.
 */
export function watchSeed<W extends { id?: string }>(list: { at: number; data: { items?: W[] } } | null | undefined, id: string): { at: number; data: { watch: W; notes: any[]; now: number; seeded: true } } | null {
  const w = list && Array.isArray(list.data?.items) ? list.data.items.find((x) => x && String(x.id) === String(id)) : null;
  return w && list ? { at: list.at, data: { watch: w, notes: [], now: list.at, seeded: true } } : null;
}
