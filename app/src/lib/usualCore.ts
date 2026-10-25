// Usual lateness, the parts with no phone dependencies (unit tested): the batch query and the words.
// The server folds recorded live times into counts per line, stop, day type and part of the day (docs/API.md, Usual lateness).
// Only api.transportsydney.app has /api/usual; the old host answers 404 and the app shows nothing.
export type Usual = { lateMin: number; plus?: boolean; n: number; dayType: 'weekday' | 'weekend'; band?: string | null; text?: string } | null;
export type UsualQuery = { line: string; stopId: string; at?: string };

const BANDS = ['mornings', 'middle of the day', 'afternoons', 'evenings'];
export const MIN_N = 8;

/** The line and stop to ask about, with the time the answer is for (a departure's timetable time), or null. */
export function usualQuery(leg?: { kind?: string; line?: string; stopId?: string; planned?: string } | null): UsualQuery | null {
  if (!leg || (leg.kind && leg.kind !== 'transit') || !leg.line || !leg.stopId) return null;
  const at = leg.planned && Number.isFinite(Date.parse(leg.planned)) ? String(leg.planned) : undefined;
  return { line: String(leg.line), stopId: String(leg.stopId), at };
}

/** One cache entry per line, stop and hour of the time asked about (the part of the day never changes inside an hour). */
export function usualKey(q: UsualQuery, now = Date.now()) {
  const t = q.at ? Date.parse(q.at) : now;
  return `${q.line}|${q.stopId}|${Math.floor(t / 3600000)}`;
}

/** The batch query: s=LINE~STOP for each, in order, and at= when every item asks about the same hour. */
export function usualParams(list: UsualQuery[]) {
  const s = list.map((q) => `s=${encodeURIComponent(`${q.line}~${q.stopId}`)}`).join('&');
  const ats = [...new Set(list.map((q) => q.at || ''))];
  return ats.length === 1 && ats[0] ? `${s}&at=${encodeURIComponent(ats[0])}` : s;
}

/**
 * "Usually 3 min late on weekday mornings", "Usually on time on weekends", or null when the answer is
 * missing or does not add up (under 8 services, a minute outside 0 to 10). Built from the numbers only.
 */
export function usualText(u: Usual | undefined): string | null {
  if (!u || typeof u !== 'object') return null;
  const m = Number(u.lateMin), n = Number(u.n);
  if (!Number.isInteger(m) || m < 0 || m > 10 || !Number.isFinite(n) || n < MIN_N) return null;
  if (u.dayType !== 'weekday' && u.dayType !== 'weekend') return null;
  const band = typeof u.band === 'string' && BANDS.includes(u.band) ? u.band : null;
  // "on weekday mornings", "on weekends around midday", "on weekdays"
  const span = band === 'middle of the day' ? `on ${u.dayType}s around midday` : band ? `on ${u.dayType} ${band}` : `on ${u.dayType}s`;
  if (m <= 1) return `Usually on time ${span}`;
  return `Usually ${m === 10 || u.plus ? '10+' : m} min late ${span}`;
}
