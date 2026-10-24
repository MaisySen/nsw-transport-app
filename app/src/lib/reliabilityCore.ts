// Reliability pick, the parts with no phone dependencies (unit tested): which service to ask about and the words.
// The server counts how often one timetabled service left on time lately (docs/API.md, Reliability pick).
export type Reliability = { onTime: number; n: number; dayType: 'weekday' | 'weekend'; text?: string; short?: string; usualLateMin?: number | null; kind?: string } | null;
export type RelQuery = { line: string; stopId: string; planned: string };

/** The service a row stands for: its first transit leg's line, stop and timetable time, or null. */
export function relQuery(leg?: { kind?: string; line?: string; stopId?: string; planned?: string } | null): RelQuery | null {
  if (!leg || (leg.kind && leg.kind !== 'transit') || !leg.line || !leg.stopId || !leg.planned) return null;
  if (!Number.isFinite(Date.parse(leg.planned))) return null;
  return { line: String(leg.line), stopId: String(leg.stopId), planned: String(leg.planned) };
}
export const relKey = (q: RelQuery) => `${q.line}|${q.stopId}|${q.planned}`;

/** The batch query: s=LINE~STOP~PLANNED for each, in order. */
export function relParams(list: RelQuery[]) {
  return list.map((q) => `s=${encodeURIComponent([q.line, q.stopId, q.planned].join('~'))}`).join('&');
}

/**
 * "Left on time 9 of the last 10 weekdays", or null when the answer is missing or does not add up
 * (fewer than 5 days, more on time than seen). Built from the numbers, never from anything else.
 */
export function relText(r: Reliability | undefined): string | null {
  if (!r || typeof r !== 'object') return null;
  const n = Number(r.n), k = Number(r.onTime);
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 5 || k < 0 || k > n) return null;
  const span = r.dayType === 'weekend' ? 'weekend days' : 'weekdays';
  return `Left on time ${k} of the last ${n} ${span}`;
}
