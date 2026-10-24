// Offline copies of the last answers for Home, Work, saved trips and starred stops, so a fresh start with no
// signal still shows the next services. Pure logic here; storage lives in offline.ts.

/** Copies older than this are not shown at all: by then every time in them has gone. */
export const MAX_AGE_MS = 18 * 3600 * 1000;
/** How many answers are kept on the phone. The oldest goes first. */
export const MAX_ENTRIES = 24;

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
  return { ...d, items: d.items.filter((x) => bestOf(x.planned, x.estimated, x.realtime) > now) };
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
  try { s = new Date(at).toLocaleTimeString('en-AU', opt).replace(/\s?(am|pm)/i, (m) => m.trim().toLowerCase()); }
  catch { const d = new Date(at), h = d.getHours(); s = `${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; }
  const day = (x: number) => { try { return new Date(x).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); } catch { return new Date(x).toDateString(); } };
  return day(at) === day(now) ? s : `yesterday ${s}`;
}

/** The line shown with stored times: "Offline, times from 8:05am". */
export function offlineText(at: number, now: number): string {
  return `Offline, times from ${stampText(at, now)}`;
}

/** Storage key for a cached answer. */
export const cacheKey = (kind: 'trip' | 'dep' | 'home', id: string) => `offline:${kind}:${id}`;
