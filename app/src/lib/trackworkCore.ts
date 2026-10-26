// Weekend trackwork card: when it shows, what it asks the server, and the words on it. No React here,
// so the rules are unit tested (test/trackwork.test.mjs).

export type TripLines = { key: string; f: string; t: string; lines: string[]; name: string; h: number;
  /** Where the trip boards and gets off each service (short names), to tell which planned work is on its path. */
  stops?: string[];
  /** Mode and colour per line, for the line badges in line status. */
  marks?: Record<string, { mode?: string; color?: string }>;
  /** Line, mode and where each service boards and gets off (station ids when known), for saved trip alerts (tripAlertsCore.ts). */
  legs?: { l: string; m: string; f: string; t: string }[] };
export type TwItem = { id: string; title: string; url?: string | null; lines: string[]; days: string };
export type TwTrip = { f: string; t: string; affected: boolean; items: TwItem[]; addedMin: number | null; buses: { from: string; to: string } | null };
export type TwResp = { enabled?: boolean; weekend?: { sat: string; sun: string }; trips?: TwTrip[] };
export type TwRow = { key: string; name: string; text: string; extra: string | null; url: string | null };

const DOW: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
/** Day of week (1 Monday to 7 Sunday) and minute of the day in Sydney, whatever the phone is set to. */
export function sydneyDowTod(t: number): { dow: number; tod: number } {
  try {
    const p = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t));
    const get = (k: string) => p.find((x) => x.type === k)?.value || '';
    const h = Number(get('hour')) % 24;
    return { dow: DOW[get('weekday')] || 1, tod: h * 60 + Number(get('minute')) };
  } catch {
    const d = new Date(t);
    return { dow: d.getDay() || 7, tod: d.getHours() * 60 + d.getMinutes() };
  }
}
/** Thursday from 6pm until the end of Sunday. */
export function inWindow(t: number): boolean {
  const { dow, tod } = sydneyDowTod(t);
  return (dow === 4 && tod >= 18 * 60) || dow === 5 || dow === 6 || dow === 7;
}

/** A trip card's report: the lines of the services it shows (no walking legs), up to 8. */
export function tripLinesOf(key: string, f: string, t: string, name: string, journeys: { legs: { kind?: string; line?: string; mode?: string; color?: string; from?: string; to?: string;
  stopId?: string; toStopId?: string; fromParent?: string | null; toParent?: string | null }[] }[], h: number): TripLines {
  const lines: string[] = [];
  const stops: string[] = [];
  const marks: Record<string, { mode?: string; color?: string }> = {};
  const legs: { l: string; m: string; f: string; t: string }[] = [];
  for (const j of journeys.slice(0, 3)) for (const l of j.legs || []) {
    if (l.kind === 'walk' || !l.line) continue;
    if (!lines.includes(l.line) && lines.length < 8) { lines.push(l.line); marks[l.line] = { mode: l.mode, color: l.color }; }
    for (const s of [l.from, l.to]) { const n = placeKey(s); if (n && !stops.includes(n) && stops.length < 12) stops.push(n); }
    const lf = l.fromParent || l.stopId || '', lt = l.toParent || l.toStopId || '';
    if (lf && lt && legs.length < 8 && !legs.some((x) => x.l === l.line && x.f === lf && x.t === lt)) legs.push({ l: l.line, m: l.mode || '', f: lf, t: lt });
  }
  return { key, f, t, lines, name, h, marks, stops, ...(legs.length ? { legs } : {}) };
}

/** Query string for GET /api/trackwork: t=FROM~TO~LINE.LINE~HOUR, one per trip, at most 6, each trip once. */
export function trackworkQuery(trips: TripLines[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const tr of trips) {
    const k = `${tr.f}~${tr.t}`;
    if (seen.has(k) || !tr.lines.length) continue;
    seen.add(k);
    parts.push('t=' + encodeURIComponent(`${tr.f}~${tr.t}~${tr.lines.join('.')}~${tr.h}`));
    if (parts.length >= 6) break;
  }
  return parts.join('&');
}

/** One row per affected trip, in Home order. Nothing when no trip is affected. */
export function trackworkRows(resp: TwResp | null, trips: TripLines[]): TwRow[] {
  if (!resp || resp.enabled === false || !resp.trips) return [];
  const rows: TwRow[] = [];
  for (const tr of trips) {
    const r = resp.trips.find((x) => x.f === tr.f && x.t === tr.t);
    if (!r || !r.affected || !r.items.length) continue;
    const it = r.items[0];
    const bits: string[] = [];
    if (r.buses) bits.push(`Buses replace trains ${r.buses.from} to ${r.buses.to}.`);
    if (r.addedMin && r.addedMin >= 5) bits.push(`Your trip takes about ${r.addedMin} min longer.`);
    rows.push({ key: tr.key, name: tr.name, text: `${it.days}: ${it.title.replace(/\.$/, '')}`, extra: bits.length ? bits.join(' ') : null, url: it.url || null });
  }
  return rows;
}

// ---------- the current server: weekend work read from Transport for NSW alerts (docs/TRACKWORK.md) ----------
// /api/trackwork lives on the new server only. Until api_base moves, the card and the Thursday heads up are worked
// out on the phone from /api/alerts (what the current server already answers): planned work whose dates fall on
// this weekend, on a line the trip uses, and on its path when the alert names places. No added time here: that
// needs the planner for a future date, which only the new server has.

export type AlertLite = { title: string; url?: string | null; lines?: string[] };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAY_RE = /\b(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(January|February|March|April|May|June|July|August|September|October|November|December))?\b/gi;

/** Sydney calendar day (year, month 1 to 12, day, weekday 1 Monday to 7 Sunday) of a moment. */
export function sydneyYmd(t: number): { y: number; m: number; d: number; dow: number } {
  try {
    const p = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(new Date(t));
    const get = (k: string) => p.find((x) => x.type === k)?.value || '';
    return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), dow: DOW[get('weekday')] || 1 };
  } catch {
    const x = new Date(t);
    return { y: x.getFullYear(), m: x.getMonth() + 1, d: x.getDate(), dow: x.getDay() || 7 };
  }
}
const dayKey = (y: number, m: number, d: number) => { const x = new Date(Date.UTC(y, m - 1, d)); return x.getUTCFullYear() * 10000 + (x.getUTCMonth() + 1) * 100 + x.getUTCDate(); };
const addDays = (y: number, m: number, d: number, n: number) => { const x = new Date(Date.UTC(y, m - 1, d + n)); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }; };

/** The moment of a Sydney wall clock time (daylight saving included). */
export function sydneyMoment(y: number, m: number, d: number, hh: number, mm: number): number {
  let t = Date.UTC(y, m - 1, d, hh, mm) - 10 * 3600000;
  for (let i = 0; i < 2; i++) {
    const p = sydneyYmd(t), { tod } = sydneyDowTod(t);
    const got = Date.UTC(p.y, p.m - 1, p.d) / 60000 + tod, want = Date.UTC(y, m - 1, d) / 60000 + hh * 60 + mm;
    t += (want - got) * 60000;
  }
  return t;
}

/** This weekend as day keys (YYYYMMDD): the coming one from Monday to Friday, the one under way on Saturday and Sunday. */
export function weekendKeys(now: number): { fri: number; sat: number; sun: number; mon: number; thu6pm: number } {
  const t = sydneyYmd(now);
  const toSat = t.dow <= 6 ? 6 - t.dow : -1;
  const sat = addDays(t.y, t.m, t.d, toSat);
  const k = (n: number) => { const x = addDays(sat.y, sat.m, sat.d, n); return dayKey(x.y, x.m, x.d); };
  const thu = addDays(sat.y, sat.m, sat.d, -2);
  return { fri: k(-1), sat: k(0), sun: k(1), mon: k(2), thu6pm: sydneyMoment(thu.y, thu.m, thu.d, 18, 0) };
}

/** Dates an alert names ("Saturday 24 and Sunday 25 October", "Friday 30 October to Monday 2 November") as day key ranges. */
export function alertRanges(text: string, now: number): { from: number; to: number }[] {
  const ms: { i: number; end: number; d: number; mo: number | null }[] = [];
  for (const m of String(text || '').matchAll(DAY_RE)) ms.push({ i: m.index || 0, end: (m.index || 0) + m[0].length, d: Number(m[2]), mo: m[3] ? MONTHS.indexOf(m[3].toLowerCase()) + 1 : null });
  if (!ms.length) return [];
  // "Saturday 24 and Sunday 25 October": a day without a month takes the next month named.
  for (let i = ms.length - 1; i >= 0; i--) if (ms[i].mo == null) ms[i].mo = i + 1 < ms.length ? ms[i + 1].mo : null;
  const today = sydneyYmd(now);
  const key = (x: { d: number; mo: number | null }) => {
    const mo = x.mo || today.m;
    const y = mo < today.m - 6 ? today.y + 1 : mo > today.m + 6 ? today.y - 1 : today.y;
    return dayKey(y, mo, x.d);
  };
  const out: { from: number; to: number }[] = [];
  for (let i = 0; i < ms.length; i++) {
    const a = key(ms[i]);
    const next = ms[i + 1];
    if (next && /^\s*(?:to|until|-|through)\s*$/i.test(String(text).slice(ms[i].end, next.i))) { out.push({ from: a, to: key(next) }); i++; continue; }
    out.push({ from: a, to: a });
  }
  return out;
}

const RAIL_WORK = /buses replace|trackwork|trains? run (?:to a changed|between|only)|changed timetable|not running|no (?:trains|metro|services)|services (?:are|will be) (?:suspended|replaced)|do not run|will not run/i;
const BUS_WORK = /divert|diversion|detour|will not (?:stop|run)|temporary (?:bus )?stop|stops? (?:will be )?(?:closed|moved)/i;
const NOT_WORK = /^station update|permanent|\blifts?\b|escalator/i;

/** Planned work this weekend: the days it covers ("Sat and Sun", "Sat", "Sun"), or null. Ranges over 4 days are ongoing changes, not weekend work. */
export function weekendDays(text: string, now: number): string | null {
  if (NOT_WORK.test(text) || !(RAIL_WORK.test(text) || BUS_WORK.test(text))) return null;
  const w = weekendKeys(now);
  let sat = false, sun = false, fri = false;
  for (const r of alertRanges(text, now)) {
    const len = (Date.UTC(Math.floor(r.to / 10000), Math.floor(r.to / 100) % 100 - 1, r.to % 100) - Date.UTC(Math.floor(r.from / 10000), Math.floor(r.from / 100) % 100 - 1, r.from % 100)) / 86400000;
    if (len < 0 || len > 4) continue;
    if (r.from <= w.sat && r.to >= w.sat) sat = true;
    if (r.from <= w.sun && r.to >= w.sun) sun = true;
    if (r.from <= w.fri && r.to >= w.fri && r.to >= w.sat) fri = true;
  }
  if (!sat && !sun) return null;
  return fri ? 'Fri to Sun' : sat && sun ? 'Sat and Sun' : sat ? 'Sat' : 'Sun';
}

/** "kings cross" from "Kings Cross Station, Platform 1". */
export function placeKey(s?: string | null): string {
  return String(s || '').replace(/,.*$/, '').replace(/\s+(Station|Wharf|Light Rail|Metro Station)$/i, '').trim().toLowerCase();
}
/** Places an alert names as "between X and Y". */
export function betweenPlaces(text: string): string[] {
  const out: string[] = [];
  const re = /between:?\s*-?\s*([A-Z][\w' ]*?) and ([A-Z][\w' ]*?)(?= only\b| stations?\b| due\b| from\b| for\b| on\b| while\b| until\b| in both\b| (?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b|[.,;:(]|$)/g;
  for (const m of String(text || '').matchAll(re)) for (const p of [m[1], m[2]]) { const k = placeKey(p); if (k && !out.includes(k)) out.push(k); }
  return out;
}
/** The alert's own heading: the words before its first date. */
export function alertHead(text: string): string {
  const t = String(text || '');
  DAY_RE.lastIndex = 0;
  const m = DAY_RE.exec(t);
  DAY_RE.lastIndex = 0;
  const head = (m && m.index > 20 ? t.slice(0, m.index) : t).replace(/\.{3}$/, '').trim().replace(/[\s,.;:]+$/, '');
  return head.length > 180 ? head.slice(0, 177).replace(/\s+\S*$/, '') + '...' : head;
}

/**
 * The card's answer worked out from alerts per line, in the shape the new server gives (without added time):
 * an alert counts for a trip when it is planned work this weekend on one of the trip's lines, and, when it names
 * places ("between Hornsby and Gordon"), one of them is where the trip boards, changes or gets off.
 */
export function weekendFromAlerts(byLine: Record<string, AlertLite[]>, trips: TripLines[], now: number): TwResp {
  const w = weekendKeys(now);
  const out: TwTrip[] = [];
  const seen = new Set<string>();
  for (const tr of trips) {
    const k = `${tr.f}~${tr.t}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const mine = new Set([...(tr.stops || []), ...tr.name.split(/ to /i).map(placeKey)].filter(Boolean));
    const items: TwItem[] = [];
    for (const line of tr.lines) for (const a of byLine[line] || []) {
      if (!a || !a.title || (a.lines && a.lines.length && !a.lines.includes(line))) continue;
      const days = weekendDays(a.title, now);
      if (!days) continue;
      const places = betweenPlaces(a.title);
      if (places.length && !places.some((p) => [...mine].some((s) => s === p || s.startsWith(p + ' ') || p.startsWith(s + ' ')))) continue;
      const id = a.url || a.title;
      if (items.some((x) => x.id === id)) continue;
      items.push({ id, title: alertHead(a.title), url: a.url || null, lines: a.lines || [line], days });
    }
    out.push({ f: tr.f, t: tr.t, affected: items.length > 0, items, addedMin: null, buses: null });
  }
  const ymd = (n: number) => String(n);
  return { enabled: true, weekend: { sat: ymd(w.sat), sun: ymd(w.sun) }, trips: out };
}

/**
 * The Thursday heads up (a local notification at 6pm, when switched on): only when work this weekend touches a
 * trip, and only scheduled before that time. Null means no notification (and any earlier one is cancelled).
 */
export function headsUpPlan(resp: TwResp | null, trips: TripLines[], now: number, skip: (tr: TripLines) => boolean = () => false): { at: number; title: string; body: string } | null {
  const w = weekendKeys(now);
  if (now >= w.thu6pm - 60000) return null;
  const rows = trackworkRows(resp, trips.filter((t) => !skip(t)));
  if (!rows.length) return null;
  const r = rows[0];
  const more = rows.length > 1 ? ` Also on ${rows.length - 1} more of your trips.` : '';
  return { at: w.thu6pm, title: 'Trackwork this weekend', body: `${r.name}. ${r.text.replace(/\.$/, '')}.${r.extra ? ' ' + r.extra : ''}${more}` };
}
