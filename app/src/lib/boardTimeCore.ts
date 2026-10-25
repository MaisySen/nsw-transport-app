// Earlier departures on a stop's board (stop screen): the parts with no phone dependencies, unit tested in
// test/boardtime.test.mjs. Same rules as the trip screen's Earlier services (tripModesCore.ts): back to the start of
// the service day (4am), gone services shown as Left with the live delay they left with, Now as before.
import { earlierRow, earlierSteps, hasLeft, leftWords, serviceDayStart, sydney, sydneyTime, ymd, type PageState } from './tripModesCore';

type DepLike = { line?: string; planned?: string | null; estimated?: string | null; realtime?: boolean; delayMin?: number | null; cancelled?: boolean; stopId?: string | null };

/** What the board says when the server that answers earlier times did not answer. */
export const BOARD_EARLIER_NEEDS_NEW = 'Earlier departures need a newer server, which did not answer just now. Pull down to try again.';

/** When a service leaves: its live time, else the timetable (the same time the board's countdown uses). */
export function depTime(d: DepLike): number {
  return Date.parse(String((d.realtime && d.estimated) || d.planned || ''));
}

/** One key per service at this stop: line, timetable time and stop (a trip id is not always sent). */
export const depKey = (d: DepLike) => `${d.line || ''}|${d.planned || ''}|${d.stopId || ''}`;

/** Gone: left over a minute ago, worked out on the phone (a kept answer's own flag can be a minute old). */
export const isGone = (d: DepLike, now: number) => hasLeft(depTime(d), now);

/** "Left 6:18 · 3 min late", "Left 6:18 · Scheduled" (no live time), "Cancelled 6:18". */
export const goneWords = (d: DepLike, hm: (t: number) => string) => leftWords(depTime(d), d, hm);

/** The moment a time picked for the board stands for: that clock time in the service day of now (4am to 4am), so
 * 1:30am picked at 11pm is tonight and 11pm picked at 1:30am is the evening before. */
export function boardMoment(h: number, m: number, now: number): number {
  const start = serviceDayStart(now);
  const t = sydneyTime(ymd(start), h, m);
  return t >= start ? t : sydneyTime(ymd(start + 24 * 3600000), h, m);
}

/** The request for the board at a moment: Sydney HHMM and its day (api.transportsydney.app's time and date). */
export function boardQuery(t: number): { time: string; date: string } {
  const p = sydney(t);
  return { time: `${String(p.h).padStart(2, '0')}${String(p.m).padStart(2, '0')}`, date: ymd(t) };
}

/** True when an answer is for the moment asked: the server echoes `at`. An older server ignores the time and answers
 * for now without it, so the board must not show that answer as the earlier one. */
export function honoured(r: { at?: { date?: string; time?: string; clamped?: boolean } | null } | null | undefined, q: { time: string; date: string }): boolean {
  const a = r?.at;
  return !!a && a.date === q.date && (a.time === q.time || !!a.clamped);
}

/** The day of a board time against today: "Today", "Yesterday" (after midnight, the evening before) or "Tomorrow". */
export function boardDayWord(at: number, now: number): string {
  const day = ymd(at), today = ymd(now);
  return day === today ? 'Today' : day < today ? 'Yesterday' : 'Tomorrow';
}

/** The time chip's words: "Now", or "From 6:15pm" ("From 11:30pm yesterday" after midnight, "From 1:30am tomorrow"). */
export function boardWhenWords(at: number | null, now: number): string {
  if (at == null) return 'Now';
  const p = sydney(at);
  const t = `${p.h % 12 || 12}:${String(p.m).padStart(2, '0')}${p.h < 12 ? 'am' : 'pm'}`;
  const d = boardDayWord(at, now);
  return `From ${t}${d === 'Today' ? '' : ` ${d.toLowerCase()}`}`;
}

/** How far back Earlier departures go: the start of the service day of the time shown (now, or the time picked). */
export const boardFloor = (at: number | null, now: number) => serviceDayStart(at ?? now);

/** The rows on the board. Now: the live answer as before (services gone over a minute ago drop off), with the earlier
 * batches kept above it, gone ones as Left. A picked time keeps its whole answer, gone or not. One row per service
 * (the live answer's copy wins), in time order. */
export function boardList<T extends DepLike>(main: T[], extra: T[], at: number | null, now: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const d of main) {
    if (at == null && !(depTime(d) > now - 60000)) continue;
    const k = depKey(d);
    if (!seen.has(k)) { seen.add(k); out.push(d); }
  }
  for (const d of extra) {
    const k = depKey(d);
    if (!seen.has(k)) { seen.add(k); out.push(d); }
  }
  return out.sort((a, b) => depTime(a) - depTime(b));
}

/** The first service on the board (where the next earlier batch must end). */
export function firstDepOf(list: DepLike[]): number | null {
  let first: number | null = null;
  for (const d of list) { const t = depTime(d); if (Number.isFinite(t) && (first == null || t < first)) first = t; }
  return first;
}

/** Where one Earlier tap asks, in turn: 40 min before the first service, then 90 min, then 3 hours, never before
 * the floor (the trip screen's steps; a quiet stretch does not end the list). */
export const boardEarlierSteps = earlierSteps;

/** A board answer is a fixed number of services (40), so at a busy station a batch from 40 min back can stop short
 * of the first one shown. The next ask, from the batch's last service, until the gap is closed; null when it is
 * closed, the batch is empty or brought nothing later than the last ask. */
export function fillFrom(batch: DepLike[], firstDep: number, asked: number): number | null {
  let last = -Infinity;
  for (const d of batch) { const t = depTime(d); if (Number.isFinite(t) && t > last) last = t; }
  if (!Number.isFinite(last) || last >= firstDep - 60000 || last <= asked) return null;
  return last;
}
/** At most this many asks per Earlier tap (the first, plus the ones that close a gap). */
export const BOARD_MAX_ASKS = 5;

/** The new services an earlier batch brings: before the first one shown and not on the board already. */
export function freshBefore<T extends DepLike>(batch: T[], firstDep: number, have: DepLike[]): T[] {
  const keys = new Set(have.map(depKey));
  return batch.filter((d) => depTime(d) < firstDep && !keys.has(depKey(d)));
}

/** The Earlier departures row at the top of the board: shown while another batch can load, and never when the
 * server has shown it has no earlier times (supported false). */
export function boardEarlierRow(st: PageState, firstDep: number | null, floor: number, supported: boolean): { show: boolean; label: string } {
  return { show: supported && earlierRow(st, firstDep, floor).show, label: 'Earlier departures' };
}
