// Calendar leave by (More > Calendar leave by, off by default): the pure parts, so they are unit tested.
// The phone reads the calendar on the phone (calendarLeaveBy.ts) and only ever sends two things to the server:
// the event's place, as a place search (the same search as typing it into Plan), and the trip query to the
// place it found. The event's name, notes, people and calendar never leave the phone. No imports.

/** An event as read from the phone's calendar, cut down to what this feature uses. */
export type CalEvent = { id: string; title: string; start: number; end: number; location: string; allDay?: boolean; status?: string | null };

/** A place the search found for an event's location. */
export type CalPlace = { id: string; name: string };

/** Resolved places kept on the phone, by cleaned location text. null means the search found nothing usable. */
export type CalPlaceCache = Record<string, { p: CalPlace | null; at: number }>;

export const CAL = {
  /** Events starting in the next 6 hours only. */
  windowMs: 6 * 3600000,
  /** The calendar is read at most once per 5 minutes, and only while Home is on view (useScreenPoll). */
  everyMs: 5 * 60000,
  /** At most this many events are planned and shown. */
  maxShown: 2,
  /** A found place is kept for 30 days; a location that found nothing is tried again after a day. */
  hitMs: 30 * 86400000,
  missMs: 86400000,
  /** At most this many places are kept on the phone. */
  maxCache: 60,
};

const ONLINE = /(https?:\/\/|www\.|\bzoom\b|\bteams\b|microsoft teams|google meet|\bmeet\.google|\bwebex\b|\bskype\b|\bfacetime\b|\bonline\b|\bvirtual\b|\bphone call\b|\bcall\b|\bdial[- ]in\b|\bTBC\b|\bTBA\b)/i;

/**
 * The part of an event's location that is a place: the first line, without a "Room 4.02" or "Level 3" prefix,
 * at most 80 characters. null for an online meeting, a link or anything too short to search for.
 */
export function cleanLocation(raw: string | null | undefined): string | null {
  let s = String(raw || '').split(/[\r\n]+/)[0].trim();
  if (!s || ONLINE.test(s)) return null;
  // Drop leading room, level or floor parts: "Level 3, 200 Barangaroo Ave" is searched as "200 Barangaroo Ave".
  s = s.replace(/^(((meeting )?room|rm|level|lvl|floor|suite)\s+[\w.]*\d[\w.]*\s*[,/-]?\s*)+/i, '').trim();
  s = s.replace(/\s+/g, ' ').replace(/^[,;\s]+|[,;\s]+$/g, '');
  if (s.length < 3 || !/[a-z]{3}/i.test(s)) return null;
  return s.slice(0, 80);
}

/** The cache key for a cleaned location. */
export const placeKey = (loc: string) => loc.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Events worth a leave by line: not all day, not cancelled, starting after now and within the window, with a
 * place. Soonest first, one per place and time, at most `max`.
 */
export function pickEvents(events: CalEvent[], now: number, windowMs = CAL.windowMs, max = CAL.maxShown + 2): (CalEvent & { place: string })[] {
  const seen = new Set<string>();
  const out: (CalEvent & { place: string })[] = [];
  const list = (events || []).filter((e) => e && Number.isFinite(e.start) && !e.allDay && !/cancel/i.test(String(e.status || ''))
    && e.start > now && e.start <= now + windowMs).sort((a, b) => a.start - b.start);
  for (const e of list) {
    const place = cleanLocation(e.location);
    if (!place) continue;
    const k = `${e.start}|${placeKey(place)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...e, place });
    if (out.length >= max) break;
  }
  return out;
}

const STOP_WORDS = new Set(['street', 'road', 'avenue', 'level', 'room', 'floor', 'suite', 'sydney', 'nsw', 'australia', 'the', 'and', 'office', 'building', 'tower', 'house', 'centre', 'center']);

/** The words of a location worth matching: 3 letters or more, not "street", "level" or "Sydney". */
export function keyWords(loc: string): string[] {
  return [...new Set(String(loc || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && /[a-z]/.test(w) && !STOP_WORDS.has(w)))];
}

/**
 * The place for a location from a search answer: the first result whose name or suburb shares a word with the
 * location. Nothing when no result does, so a meeting room code never turns into a random stop.
 */
export function chooseResolved(items: { id?: string; name?: string; area?: string | null }[] | null | undefined, loc: string): CalPlace | null {
  const words = keyWords(loc);
  if (!words.length) return null;
  for (const it of items || []) {
    if (!it || !it.id || !it.name) continue;
    const hay = `${it.name} ${it.area || ''}`.toLowerCase();
    if (words.some((w) => hay.includes(w))) return { id: String(it.id), name: String(it.name) };
  }
  return null;
}

/** A cached place, or undefined when it should be searched (never searched, or the entry is too old). */
export function cachedPlace(cache: CalPlaceCache | null | undefined, loc: string, now: number): CalPlace | null | undefined {
  const e = cache?.[placeKey(loc)];
  if (!e) return undefined;
  const age = now - e.at;
  if (e.p ? age > CAL.hitMs : age > CAL.missMs) return undefined;
  return e.p;
}

/** The cache with one more answer, the oldest entries dropped past the cap. */
export function rememberPlace(cache: CalPlaceCache | null | undefined, loc: string, p: CalPlace | null, now: number): CalPlaceCache {
  const next: CalPlaceCache = { ...(cache || {}) };
  delete next[placeKey(loc)];
  next[placeKey(loc)] = { p, at: now };
  const keys = Object.keys(next).sort((a, b) => next[a].at - next[b].at);
  for (const k of keys.slice(0, Math.max(0, keys.length - CAL.maxCache))) delete next[k];
  return next;
}

type PlaceLike = { id: string; name: string };

/**
 * Where the trip starts: the commute card's start (home before 12, work after, as on Home), else the first saved
 * trip's start, else home or work. Never the event's own place.
 */
export function pickOrigin(commuteFrom: PlaceLike | null | undefined, firstTripFrom: PlaceLike | null | undefined, places: { home?: PlaceLike; work?: PlaceLike } | null | undefined): PlaceLike | null {
  for (const p of [commuteFrom, firstTripFrom, places?.home, places?.work]) if (p && p.id) return { id: p.id, name: p.name };
  return null;
}

type JLike = { leave?: string | number; arrive?: string | number; legs?: { kind?: string; line?: string | null; mode?: string | null; from?: string | null; realtime?: boolean }[]; live?: boolean };
const tms = (v: string | number | undefined) => (typeof v === 'number' ? v : v ? Date.parse(v) : NaN);

/**
 * The trip to take: the one that leaves last and still arrives by the event's start, and has not left yet.
 * null when no trip does (then nothing is shown for that event).
 */
export function leaveBy<J extends JLike>(js: J[] | null | undefined, eventStart: number, now: number): { j: J; leave: number; arrive: number } | null {
  let best: { j: J; leave: number; arrive: number } | null = null;
  for (const j of js || []) {
    const leave = tms(j.leave), arrive = tms(j.arrive);
    if (!Number.isFinite(leave) || !Number.isFinite(arrive)) continue;
    if (arrive > eventStart || leave < now - 60000) continue;
    if (!best || leave > best.leave || (leave === best.leave && arrive < best.arrive)) best = { j, leave, arrive };
  }
  return best;
}

/** "8:12am" in Sydney time. */
export function calClock(t: number): string {
  try {
    return new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)/i, (m) => m.trim().toLowerCase());
  } catch {
    const d = new Date(t);
    return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

/** "Strathfield" from "Strathfield Station, Strathfield". */
const shortP = (s: string | null | undefined) => String(s || '').split(',')[0].replace(/ Station$/, '').trim();

/** The Home line: "Leave by 8:12am for Team meeting (Barangaroo)", "Leave now for ..." when it is time. */
export function leaveTitle(title: string, placeName: string, leave: number, now: number): string {
  const what = String(title || '').replace(/\s+/g, ' ').trim() || 'your event';
  const where = shortP(placeName);
  const head = leave - now <= 60000 ? 'Leave now' : `Leave by ${calClock(leave)}`;
  return `${head} for ${what}${where ? ` (${where})` : ''}`;
}

/** The second line: "T1 from Strathfield, arrive 8:51am. Starts 9:00am". */
export function leaveSub(j: JLike, arrive: number, eventStart: number): string {
  const t = (j.legs || []).find((l) => l.kind !== 'walk' && (l.line || l.mode));
  const first = t ? `${t.line || t.mode}${t.from ? ` from ${shortP(t.from)}` : ''}, arrive ${calClock(arrive)}` : `Arrive ${calClock(arrive)}`;
  return `${first}. Starts ${calClock(eventStart)}`;
}

/** "0900" for the trip query. */
export function hhmmSyd(t: number): string {
  try {
    return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Sydney' }).replace(':', '').slice(0, 4);
  } catch {
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

/** "20261025" in Sydney time. */
export function ymdSyd(t: number): string {
  try {
    const p = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Australia/Sydney' }).format(new Date(t));
    return p.replace(/-/g, '');
  } catch {
    const d = new Date(t);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }
}

/**
 * Route params for the trip screen: to the event's place, Arrive by its start, with the day only when it is not
 * today (an event just after midnight).
 */
export function tripParams(from: PlaceLike, to: PlaceLike, eventStart: number, now: number): Record<string, string> {
  const day = ymdSyd(eventStart);
  return { from: from.id, fromName: from.name, to: to.id, toName: to.name, time: hhmmSyd(eventStart), arriveBy: '1', ...(day !== ymdSyd(now) ? { date: day } : {}) };
}

/** The trip query for Home, the same shape: time and arrive by, and the day only when it is not today. */
export function tripQuery(eventStart: number, now: number): { time: string; arriveBy: true; date?: string } {
  const day = ymdSyd(eventStart);
  return { time: hhmmSyd(eventStart), arriveBy: true, ...(day !== ymdSyd(now) ? { date: day } : {}) };
}

/**
 * Whether this phone can read the calendar for leave by. iPhone: the calendar module and the full access text in
 * the app (build 208 and later; 206 and 207 have add only access, and asking for read access there is refused).
 * Android: the calendar module (its manifest then has READ_CALENDAR). Web: never, apart from the dev mock.
 */
export function readSupported(os: string, hasModule: boolean, hasNextModule: boolean, build: string | number | null | undefined): boolean {
  if (!hasModule) return false;
  if (os === 'android') return true;
  if (os !== 'ios') return false;
  const n = Number(build);
  return hasNextModule && Number.isFinite(n) && n >= 208;
}
