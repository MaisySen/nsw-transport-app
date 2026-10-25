// Plan tab logic with no app imports, so it is unit tested as is: place search results (stops, addresses,
// streets, landmarks, suburbs), the Leave at / Arrive by choice, and Clear all.

export type PlaceKind = 'stop' | 'address' | 'street' | 'place' | 'suburb';
export type PlaceItem = { id: string; name: string; kind?: PlaceKind; modes?: number[]; area?: string; lat?: number; lon?: number };

/** The line under a search result that is not a stop: what it is, and its suburb when the name has none. */
export function placeSubtitle(it: PlaceItem): string | undefined {
  const what = it.kind === 'address' ? 'Address' : it.kind === 'street' ? 'Street' : it.kind === 'place' ? 'Place' : it.kind === 'suburb' ? 'Suburb' : null;
  if (!what) return undefined;
  return it.area ? `${what}, ${it.area}` : what;
}

/** Only stops have departures, so only stops go into Recent stops. */
export const isStopItem = (it: PlaceItem) => !it.kind || it.kind === 'stop';

/** Stops only search answers (the server in use before /api/places) as place items. */
export const stopsAsPlaces = (items: { id: string; name: string; modes?: number[] }[]): PlaceItem[] => items.map((i) => ({ ...i, kind: 'stop' as const }));

/**
 * Whether place search should be left alone for the rest of the session: the server answered that it has no
 * such route (404). A dropped connection or a slow answer tries again on the next search.
 */
export const placesGone = (e: any) => !!e && e.http === 404;

/** "No places match that" once search can find more than stops; the stops only wording otherwise. */
export function noPlaceText(text: string, loading: boolean, count: number, failed: boolean, places: boolean): string | null {
  if (text.trim().length < 2 || loading || count) return null;
  if (failed) return "Can't search right now. Check your connection.";
  return places ? 'No stops or places match that' : 'No stops match that';
}

// ---- Leave now, Leave at, Arrive by ----

/** When to travel. h and m are a Sydney clock time (24 hour); the server takes it as today, or tomorrow once it has passed. */
/** Leave now, or Leave at / Arrive by a Sydney clock time. `day` (YYYYMMDD) only when the time alone does not say the day
 * (set by the trip screen's picker; see dateNeeded in tripModesCore.ts). */
export type When = { kind: 'now' } | { kind: 'leave' | 'arrive'; h: number; m: number; day?: string };
export const NOW: When = { kind: 'now' };

/** Hour and minute now in Sydney, whatever the phone is set to. */
export function sydneyClock(now: number): { h: number; m: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Australia/Sydney' }).formatToParts(new Date(now));
    const h = Number(parts.find((p) => p.type === 'hour')?.value);
    const m = Number(parts.find((p) => p.type === 'minute')?.value);
    if (Number.isFinite(h) && Number.isFinite(m)) return { h: h % 24, m };
  } catch {}
  const d = new Date(now);
  return { h: d.getHours(), m: d.getMinutes() };
}

/** The picker's starting time: the next 5 minute mark after now, Sydney time. */
export function defaultClock(now: number, step = 5): { h: number; m: number } {
  const { h, m } = sydneyClock(now);
  let t = Math.ceil((h * 60 + m + 1) / step) * step;
  t %= 24 * 60;
  return { h: Math.floor(t / 60), m: t % 60 };
}

export const to12 = (h: number) => ({ h12: ((h + 11) % 12) + 1, pm: h >= 12 });
export const from12 = (h12: number, pm: boolean) => (h12 % 12) + (pm ? 12 : 0);

/** "9:05am", the format the rows use. */
export function clock12(h: number, m: number): string {
  const { h12, pm } = to12(h);
  return `${h12}:${String(m).padStart(2, '0')}${pm ? 'pm' : 'am'}`;
}

/** Same rule as the server: a time more than 30 minutes before now is tomorrow. */
export function isTomorrow(w: When, now: number): boolean {
  if (w.kind === 'now' || w.day) return false;
  const c = sydneyClock(now);
  return w.h * 60 + w.m < c.h * 60 + c.m - 30;
}

/** "Leave now", "Leave 9:05am", "Arrive by 5:30pm tomorrow". */
export function whenLabel(w: When, now: number): string {
  if (w.kind === 'now') return 'Leave now';
  const t = clock12(w.h, w.m) + (w.day ? ` ${dayShort(w.day)}` : isTomorrow(w, now) ? ' tomorrow' : '');
  return w.kind === 'arrive' ? `Arrive by ${t}` : `Leave ${t}`;
}

/** The trip request's time ("0905") and arrive by flag. Nothing for now. */
export function whenQuery(w: When): { time?: string; arriveBy?: boolean; date?: string } {
  if (w.kind === 'now') return {};
  return { time: `${String(w.h).padStart(2, '0')}${String(w.m).padStart(2, '0')}`, ...(w.kind === 'arrive' ? { arriveBy: true } : {}), ...(w.day ? { date: w.day } : {}) };
}

/** "Tue 27 Oct" for a YYYYMMDD day. */
export function dayShort(day: string): string {
  const y = +day.slice(0, 4), mo = +day.slice(4, 6), d = +day.slice(6, 8);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow]} ${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo - 1]}`;
}

/** Route params for the trip screen, as strings. */
export function whenParams(w: When): { time?: string; arriveBy?: string; date?: string } {
  const q = whenQuery(w);
  return q.time ? { time: q.time, ...(q.arriveBy ? { arriveBy: '1' } : {}), ...(q.date ? { date: q.date } : {}) } : {};
}

/** Back from route params; anything that is not HHMM is now. */
export function whenFromParams(time?: string | string[], arriveBy?: string | string[], date?: string | string[]): When {
  const t = Array.isArray(time) ? time[0] : time;
  const m = /^([01]\d|2[0-3])([0-5]\d)$/.exec(String(t || ''));
  if (!m) return NOW;
  const a = Array.isArray(arriveBy) ? arriveBy[0] : arriveBy;
  const d = String((Array.isArray(date) ? date[0] : date) || '');
  return { kind: a === '1' || a === 'true' ? 'arrive' : 'leave', h: Number(m[1]), m: Number(m[2]), ...(/^20\d{6}$/.test(d) ? { day: d } : {}) };
}

/** One step of a picker column, wrapping around (hour 12 then 1, minute 55 then 0). */
export function wrapStep(value: number, values: number[], dir: 1 | -1): number {
  const i = values.indexOf(value);
  const n = values.length;
  return values[((i < 0 ? 0 : i) + dir + n) % n];
}

/** The nearest picker value to a minute that is not on the step (a link with 9:07 shows 9:05). */
export function snapMinute(m: number, step = 5): number {
  return Math.min(60 - step, Math.round(m / step) * step);
}

// ---- Clear all ----

/** What Clear all removes from Your trips: trips kept on the phone (by key), saved trips (by name) and the server's commutes (by id). */
export function clearAllPlan<T extends { kind?: string; name?: string | null; key: string; id?: string }>(trips: T[]): { mine: string[]; saved: string[]; commutes: string[] } {
  const mine: string[] = [], saved: string[] = [], commutes: string[] = [];
  for (const t of trips) {
    if (t.kind === 'commute') { if (t.id && !commutes.includes(t.id)) commutes.push(t.id); continue; }
    if (t.kind === 'mine') mine.push(t.key);
    // A trip kept on the phone can also be saved on the server under its name (Delete does both too).
    if ((t.kind === 'saved' || t.kind === 'mine') && t.name && !saved.includes(t.name)) saved.push(t.name);
  }
  return { mine, saved, commutes };
}

/** The confirm dialog's words. iOS buttons are title case, Material dialogs sentence case. */
export function clearAllWords(what: 'trips' | 'stops', count: number, ios: boolean): { title: string; message: string; confirm: string } {
  const n = count === 1 ? (what === 'trips' ? '1 trip' : '1 stop') : `${count} ${what}`;
  return what === 'trips'
    ? { title: ios ? 'Clear All Trips?' : 'Clear all trips?', message: `This removes ${n} from Your trips. Your commute stays.`, confirm: ios ? 'Clear All' : 'Clear all' }
    : { title: ios ? 'Clear All Starred Stops?' : 'Clear all starred stops?', message: `This unstars ${n}.`, confirm: ios ? 'Clear All' : 'Clear all' };
}

/**
 * Arrive by: the trip to open first, the one that leaves last and still arrives by the time (the one you would
 * take). -1 when none arrives in time.
 */
export function arriveByIndex(list: { leave: number; arrive: number }[], by: number): number {
  let best = -1;
  list.forEach((j, i) => {
    if (!Number.isFinite(j.leave) || !Number.isFinite(j.arrive) || j.arrive > by) return;
    if (best < 0 || j.leave > list[best].leave) best = i;
  });
  return best;
}
