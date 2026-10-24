// Weekend trackwork card: when it shows, what it asks the server, and the words on it. No React here,
// so the rules are unit tested (test/trackwork.test.mjs).

export type TripLines = { key: string; f: string; t: string; lines: string[]; name: string; h: number };
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
export function tripLinesOf(key: string, f: string, t: string, name: string, journeys: { legs: { kind?: string; line?: string }[] }[], h: number): TripLines {
  const lines: string[] = [];
  for (const j of journeys.slice(0, 3)) for (const l of j.legs || []) {
    if (l.kind === 'walk' || !l.line) continue;
    if (!lines.includes(l.line) && lines.length < 8) lines.push(l.line);
  }
  return { key, f, t, lines, name, h };
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
