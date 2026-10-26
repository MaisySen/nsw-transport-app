// The trip list's endless scroll (app/trip.tsx): pages of about 10 trips from the server (GET /api/trip?page=1 with
// after= or before= and arr=), asked for before the reader gets to the end either way, so the list keeps up with the
// scroll. Plain logic here so it can be tested without a phone (test/trip-pages.test.mjs).

/** How far the list goes from the time it is for: 7 days back and 7 days ahead. */
export const PAGE_REACH_MS = 7 * 86400000;
/** Guards so a list never loops on the network: pages each way per visit (7 days of a 10 minute service is about 50). */
export const PAGE_MAX = 60;
/** Ask for the next page while the reader is still this many screens from the end (prefetch). */
export const PREFETCH_SCREENS = 1.5;
/** A page that brought nothing new this many times in a row ends that direction. */
export const EMPTY_PAGES_END = 2;

export type Cursor = { after: number | null; before: number | null; arr: number | null };
type LegLike = { kind?: string; planned?: string | null; arrPlanned?: string | null };
type JLike = { legs: LegLike[]; leave?: string; board?: string; arrive?: string };

const t = (s?: string | null) => (s ? Date.parse(s) : NaN);
/** When a trip's first service leaves by the timetable (the cursors are timetable times, so a late service does not
 * move the edge of the list). */
export function plannedDep(j: JLike): number {
  const l = j.legs.find((x) => x.kind === 'transit');
  const v = t(l?.planned);
  return Number.isFinite(v) ? v : t(j.board || j.leave);
}
/** When it gets there by the timetable. */
export function plannedArr(j: JLike): number {
  const tl = j.legs.filter((x) => x.kind === 'transit');
  const v = t(tl[tl.length - 1]?.arrPlanned);
  return Number.isFinite(v) ? v : t(j.arrive);
}

/** Where the next pages start: later from the last departure the list has, earlier before its first departure and
 * first arrival. Worked out from every trip loaded, so a trip left out on the phone (walking, modes) still counts. */
export function cursorsOf(list: JLike[]): Cursor {
  const deps = list.map(plannedDep).filter(Number.isFinite);
  const arrs = list.map(plannedArr).filter(Number.isFinite);
  return { after: deps.length ? Math.max(...deps) : null, before: deps.length ? Math.min(...deps) : null, arr: arrs.length ? Math.min(...arrs) : null };
}

export type PageDir = { pages: number; busy: boolean; done: boolean; empties: number };
export const DIR0: PageDir = { pages: 0, busy: false, done: false, empties: 0 };

/** Whether the next page that way may be asked for now: one at a time, only on view, inside the reach. */
export function canPage(st: PageDir, edge: number | null, limit: number, later: boolean, visible: boolean): boolean {
  if (!visible || st.busy || st.done || st.pages >= PAGE_MAX || edge == null) return false;
  return later ? edge < limit : edge > limit;
}
/** After a page: done after EMPTY_PAGES_END pages in a row with nothing new, or past the reach. */
export function afterPage(st: PageDir, added: number, edge: number | null, limit: number, later: boolean): PageDir {
  const empties = added > 0 ? 0 : st.empties + 1;
  const past = edge != null && (later ? edge >= limit : edge <= limit);
  return { pages: st.pages + 1, busy: false, empties, done: empties >= EMPTY_PAGES_END || past };
}

/** Near the end: within PREFETCH_SCREENS screens (at least `minPx`) of the bottom. */
export function nearBottom(e: { layoutH: number; offsetY: number; contentH: number }, minPx = 700): boolean {
  const px = Math.max(minPx, e.layoutH * PREFETCH_SCREENS);
  return e.contentH > 0 && e.offsetY + e.layoutH >= e.contentH - px;
}
/** Near the top of the trips (`topOfRows`: where the first trip starts in the scroll view), scrolling up. */
export function nearTop(e: { layoutH: number; offsetY: number }, topOfRows: number, movingUp: boolean, minPx = 400): boolean {
  const px = Math.max(minPx, e.layoutH * PREFETCH_SCREENS);
  return movingUp && e.offsetY <= topOfRows + px;
}

/** True when the answer is a page from a server that pages (an older one ignores page=1 and has no page). */
export const isPaged = (r: unknown): boolean => !!(r && typeof r === 'object' && (r as any).page && typeof (r as any).page === 'object');

// ---- whole days from our own planner (server page.mode "day", 27 Oct) ----
// When the server's own planner is on it answers a phone that sends days=1 with a whole day of trips (3 AM to 3 AM),
// the days before and after it that it can list the same way (prevDay, nextDay), and the window's bounds. The next day
// is asked for while the reader is about DAY_PREFETCH_ROWS rows from either end; past the planner's days the list
// carries on with Trip Planner pages from the last trip it has. Earlier rows already loaded are shown a block at a time
// as the reader scrolls up (no network), so the list still opens at now.
export const DAY_PREFETCH_ROWS = 50;
/** Rows of earlier trips put above the list at a time, from a day already loaded. */
export const DAY_REVEAL_ROWS = 30;
export type DayInfo = { day: string; prevDay: string | null; nextDay: string | null; windowStart: number; windowEnd: number };
const dayStr = (v: unknown): string | null => (typeof v === 'string' && /^\d{8}$/.test(v) ? v : null);
/** The day page of an answer, or null (a Trip Planner page, or a server without the planner's days). */
export function dayPageOf(r: unknown): DayInfo | null {
  const p = r && typeof r === 'object' ? (r as any).page : null;
  if (!p || typeof p !== 'object' || p.mode !== 'day' || !dayStr(p.day)) return null;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);
  return { day: p.day, prevDay: dayStr(p.prevDay), nextDay: dayStr(p.nextDay), windowStart: n(p.windowStart), windowEnd: n(p.windowEnd) };
}
/** How near an end (in pixels) the next day is asked for: DAY_PREFETCH_ROWS rows at the list's average row height,
 * never less than the plain pages' own distance (`minPx`). */
export function dayPrefetchPx(contentH: number, rows: number, minPx: number): number {
  if (!(rows > 0) || !(contentH > 0)) return minPx;
  return Math.max(minPx, Math.round((contentH / rows) * DAY_PREFETCH_ROWS));
}
/** Which way the next earlier rows come from: rows already loaded and not yet shown, the planner's day before, or
 * Trip Planner pages (none of the planner's days left that way). */
export function earlierSource(hiddenRows: number, lo: DayInfo | null): 'reveal' | 'day' | 'pages' {
  if (hiddenRows > 0) return 'reveal';
  return lo && lo.prevDay ? 'day' : 'pages';
}
/** And the next later rows: the planner's next day, or Trip Planner pages. */
export const laterSource = (hi: DayInfo | null): 'day' | 'pages' => (hi && hi.nextDay ? 'day' : 'pages');

/** Skeleton rows shown while a page loads: enough to fill what the reader sees of it, never more than 4. */
export const skeletonCount = (busy: boolean) => (busy ? 3 : 0);
