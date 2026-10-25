import type { Fare, Journey } from './types';
import type { FareType } from './store';

/** Fare types as Settings lists them, sent to the server as the fare param. */
export const FARE_TYPES: { k: FareType; name: string; sub?: string }[] = [
  { k: 'adult', name: 'Adult' },
  { k: 'child', name: 'Child or Youth', sub: '4 to 15, or a Youth Opal card' },
  { k: 'concession', name: 'Concession', sub: 'Students, apprentices, job seekers' },
  { k: 'gold', name: 'Gold Senior or Pensioner', sub: '$2.50 a day cap' },
];

export function money(v?: number | null) {
  if (v == null || !Number.isFinite(Number(v))) return '';
  return '$' + Number(v).toFixed(2);
}

/** The fare for a whole journey, or null when the server sent none. */
export const fareOf = (j?: Journey | null): Fare | null => (j && j.fare && j.fare.total != null ? j.fare : null);

/** Where NSW TrainLink regional seats are booked. */
export const TRAINLINK_BOOKING_URL = 'https://transportnsw.info/regional-bookings/';
/**
 * Which fare a journey needs: 'opal' (an Opal estimate), 'booked' (NSW TrainLink regional only: no Opal fare, book a
 * seat), 'mixed' (an Opal part plus a booked TrainLink part), or null (nothing to show).
 */
export function fareKind(j?: Journey | null): 'opal' | 'booked' | 'mixed' | null {
  if (!j) return null;
  const booked = (j.legs || []).some((l) => l.kind === 'transit' && l.feed === 'nswtrains');
  const f = fareOf(j);
  const opal = !!f && (f.legs || []).some((l: any) => l.amount != null && l.amount > 0) && Number(f.total) > 0;
  if (booked) return opal ? 'mixed' : 'booked';
  return f ? 'opal' : null;
}

/** "Adult, off peak" with any transfer discount and airport fee. */
export function fareWords(f: Fare) {
  const bits = [`${f.typeName}${f.peak ? ', peak' : ', off peak'}`];
  if (f.transfer) bits.push(`${money(f.transfer)} transfer discount`);
  if (f.airportFee) bits.push(`includes ${money(f.airportFee)} airport fee`);
  if (f.capped) bits.push('daily cap reached');
  return bits.join(', ');
}

/** "Off peak from 7pm, save $1.62", or null outside peak. */
export function offPeakText(f?: Fare | null) {
  if (!f || !f.offPeak || !f.offPeak.save) return null;
  return `Off peak from ${f.offPeak.from}, save ${money(f.offPeak.save)}`;
}

/** Sydney weekday (1 Monday to 7 Sunday) and minutes past midnight. */
function sydneyParts(t: number) {
  try {
    const p = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t));
    const get = (k: string) => p.find((x) => x.type === k)?.value || '';
    const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday').slice(0, 3)) + 1;
    return { wd, min: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
  } catch {
    const d = new Date(t);
    return { wd: ((d.getDay() + 6) % 7) + 1, min: d.getHours() * 60 + d.getMinutes() };
  }
}

/** Opal peak: Monday to Thursday 6:30am to 10am and 3pm to 7pm Sydney time. Returns when off peak starts, or null. */
export function peakNow(t: number): string | null {
  const { wd, min } = sydneyParts(t);
  if (wd < 1 || wd > 4) return null;
  if (min >= 390 && min < 600) return '10am';
  if (min >= 900 && min < 1140) return '7pm';
  return null;
}
