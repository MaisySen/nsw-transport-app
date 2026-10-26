// Where the bus is, in plain words, for Home trip cards and trip rows: "3 stops away · 4 min late". Only from live
// data the server already sends on a leg or a board row (`vehicle`, `stopsAway`, `delayMin`, `ahead`); a row with no
// live position says nothing here, and nothing is guessed from the timetable. No React here (test/wherenow.test.mjs).

export type WhereInput = {
  kind?: string; mode?: string | null; realtime?: boolean; cancelled?: boolean; delayMin?: number | null;
  stopsAway?: number | null; vehicle?: { lat?: number; lon?: number; ageS?: number } | null;
  ahead?: ReadonlyArray<number | null> | null;
};
export type WhereNow = { text: string; a11y: string; away: number; late: number | null };

/** Furthest the line still reads as "where the bus is" (a bus 40 stops off is not useful on a card). */
export const WHERE_MAX_STOPS = 20;
/** A vehicle position older than this (seconds) is not shown as where the bus is. */
export const WHERE_MAX_AGE_S = 180;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const NOUN: Record<string, string> = { bus: 'Bus', coach: 'Coach', school: 'Bus', train: 'Train', metro: 'Metro', lightrail: 'Light rail', ferry: 'Ferry' };

/**
 * The live delay at your stop: the server's last `ahead` value (the bus's predicted delay where you get on) when it
 * sent one, else the leg's own live delay. Rounded to whole minutes. Null when there is none.
 */
export function lateAtStop(x: WhereInput): number | null {
  const a = (x.ahead || []).filter(finite);
  if (a.length) return Math.round(a[a.length - 1]);
  return finite(x.delayMin) ? Math.round(x.delayMin) : null;
}

/** "4 min late", "2 min early", "on time"; '' when there is no live delay. */
export function lateText(m: number | null): string {
  if (m == null) return '';
  if (m >= 2) return `${m} min late`;
  if (m <= -2) return `${-m} min early`;
  return 'on time';
}

/**
 * Where the vehicle is now, or null. Needs live times (`realtime`), a live position (`vehicle`) and the stop count
 * from it to your stop (`stopsAway`, 0 to WHERE_MAX_STOPS). `liveNow` is the row's own live label being Live (not
 * Not tracking); pass false and nothing shows. Cancelled and walk legs show nothing.
 */
export function whereNow(x: WhereInput | null | undefined, liveNow = true): WhereNow | null {
  if (!x || !liveNow || x.kind === 'walk' || x.cancelled || !x.realtime) return null;
  if (!x.vehicle || !finite(x.vehicle.lat) || !finite(x.vehicle.lon)) return null;
  if (finite(x.vehicle.ageS) && x.vehicle.ageS > WHERE_MAX_AGE_S) return null;
  if (!finite(x.stopsAway) || x.stopsAway < 0 || x.stopsAway > WHERE_MAX_STOPS) return null;
  const away = Math.round(x.stopsAway);
  const late = lateAtStop(x);
  const where = away === 0 ? 'At your stop' : `${away} stop${away === 1 ? '' : 's'} away`;
  const lt = lateText(late);
  const noun = NOUN[String(x.mode || '')] || 'Service';
  const text = lt ? `${where} \u00b7 ${lt}` : where;
  const a11y = `${noun} ${away === 0 ? 'at your stop' : `${away} stop${away === 1 ? '' : 's'} away`}${lt ? `, ${lt}` : ''}, from its live position`;
  return { text, a11y, away, late };
}

/** The first leg you ride on a journey (skips walks), for Home cards and trip rows. */
export function firstRide<L extends { kind?: string }>(legs: ReadonlyArray<L> | null | undefined): L | null {
  return (legs || []).find((l) => l && l.kind !== 'walk') || null;
}
