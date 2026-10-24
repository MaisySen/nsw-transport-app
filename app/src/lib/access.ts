import type { Journey, Leg, Place } from './types';

/** Station access, Park and Ride and Opal machines, as /api/station, /api/parking and /api/topup send them. */
export type AccessLevel = 'independent' | 'assisted' | 'none' | 'unknown';
export type Access = { level: AccessLevel; label: string; note?: string; lift?: boolean; escalator?: boolean; stairs?: boolean; ramp?: boolean; hearingLoop?: boolean; tactile?: boolean; stairLift?: boolean };
export type TicketKind = 'cash' | 'card' | 'topup' | 'none' | 'unknown';
export type Ticket = { kind: TicketKind; label?: string; topUp?: boolean; cash?: boolean; extraTopUp?: boolean };
export type Outage = { id?: string; kind?: string; title: string; url?: string };
export type CarPark = { id: string; name: string; station: string; spots: number; free: number | null; occupied?: number | null;
  status: 'ok' | 'nearly' | 'full' | 'unknown'; label?: string; updated?: string | null; stale?: boolean; lat?: number; lon?: number; address?: string; distance?: number };
export type Station = { id: string; name: string; lat?: number; lon?: number; modes?: string[]; access: Access; ticket: Ticket; facilities?: string[];
  parkRide?: boolean; peak?: { morning?: string; afternoon?: string } | null; shortPlatform?: boolean; outages?: Outage[]; parking?: CarPark[]; sources?: string[]; read?: string };
export type LegAccessEnd = { id: string; level: AccessLevel; lift?: boolean; outage?: string; outages?: number };
export type LegAccess = { from?: LegAccessEnd | null; to?: LegAccessEnd | null };
export type TopupItem = { id: string; name: string; lat: number; lon: number; kind: TicketKind; label?: string; cash?: boolean; distance?: number | null };

/** Chip short forms for an access level. */
export const ACC_SHORT: Record<string, string> = { independent: 'Step free', assisted: 'Assisted access', none: 'Not step free', unknown: 'Access not listed' };
/** Full labels for an access level. */
export const ACC_LABEL: Record<string, string> = { independent: 'Step free access', assisted: 'Assisted access', none: 'No step free access', unknown: 'Access not listed' };
export const ACC_COLOR: Record<string, string> = { independent: '#34C759', assisted: '#FF9500', none: '#8E8E93', unknown: '#8E8E93' };

/** Opal machine kinds: title, payment, map colour. */
export const TICKET: Record<string, [string, string, string]> = {
  cash: ['Opal top up and tickets', 'Cash or card', '#5856D6'],
  card: ['Opal top up and tickets', 'Card only', '#AF52DE'],
  topup: ['Opal top up machine', 'Card only', '#FF9500'],
};

export const stShort = (n?: string | null) => String(n || '').replace(/ (Station|Light Rail|Wharf)$/, '');

/** Ticket machine row: title and subtitle. */
export function ticketText(t?: Ticket | null): { title: string; sub: string; color: string } {
  const k = t?.kind || 'unknown';
  if (k === 'none') return { title: 'No Opal machine', sub: 'Top up in the Opal Travel app or at a retailer', color: '#8E8E93' };
  if (k === 'unknown' || !TICKET[k]) return { title: 'Opal machine not listed', sub: 'Top up in the Opal Travel app or at a retailer', color: '#8E8E93' };
  const [title, sub, color] = TICKET[k];
  return { title, sub: sub + (t?.extraTopUp ? ', plus a card only top up machine' : ''), color };
}

/** "Lifts, Escalators, Boarding ramp" for the access row. */
export function accessKit(a?: Access | null): string {
  if (!a) return '';
  return [a.lift && 'Lifts', a.escalator && 'Escalators', a.ramp && 'Boarding ramp', a.hearingLoop && 'Hearing loop', a.tactile && 'Tactile edges'].filter(Boolean).join(', ');
}

/** "Tallawong P1" on the Tallawong screen reads "Car park P1"; "Kellyville (north)" reads "North car park". */
export function parkName(p: { name: string }, station?: string | null): string {
  const base = stShort(station || '');
  let n = base && p.name.toLowerCase().startsWith(base.toLowerCase() + ' ') ? p.name.slice(base.length + 1) : p.name;
  if (/^P\d+$/i.test(n)) n = 'Car park ' + n.toUpperCase();
  else if (/^\((north|south|east|west)\)$/i.test(n)) n = n.slice(1, -1).replace(/^./, (ch) => ch.toUpperCase()) + ' car park';
  return n;
}

/** Badge text and tone for a car park. */
export function parkBadge(p: { status: string }): { text: string; tone: 'green' | 'orange' | 'red' | 'grey' } {
  if (p.status === 'full') return { text: 'Full', tone: 'red' };
  if (p.status === 'nearly') return { text: 'Nearly full', tone: 'orange' };
  if (p.status === 'ok') return { text: 'Spaces free', tone: 'green' };
  return { text: 'No live count', tone: 'grey' };
}

/** Share of the car park in use, 0 to 100, or null without a live count. */
export function parkFill(p: CarPark): number | null {
  if (!p.spots || p.free == null) return null;
  const used = p.occupied != null ? p.occupied : p.spots - p.free;
  return Math.max(0, Math.min(100, Math.round((used / p.spots) * 100)));
}

/** Free and total spaces across car parks, when every one has a live count. */
export function parkTotals(list: CarPark[]): { free: number; spots: number } | null {
  if (list.length < 2 || !list.every((p) => p.free != null)) return null;
  return { free: list.reduce((n, p) => n + (p.free || 0), 0), spots: list.reduce((n, p) => n + p.spots, 0) };
}

/** The outage title without the station name in front. */
export function outageText(title: string, station?: string | null): string {
  const s = String(station || '');
  let t = String(title || '');
  for (const n of [s, stShort(s)]) if (n && t.toLowerCase().startsWith(n.toLowerCase() + ' ')) { t = t.slice(n.length + 1); break; }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Only https links open from the app. */
export const safeUrl = (u?: string | null) => (u && /^https:\/\//i.test(u) ? u : null);

/** Every lift or escalator outage on a journey's stations, each once. */
export function journeyOutages(j: Journey): string[] {
  const s = new Set<string>();
  for (const l of j.legs || []) {
    const a = (l as Leg & { access?: LegAccess }).access;
    for (const x of a ? [a.from, a.to] : []) if (x && x.outage) s.add(x.outage);
  }
  return [...s];
}

/** A leg end chip: "Central: Step free" or "Central: lift out". */
export function accChip(end: LegAccessEnd | null | undefined, name?: string | null): { text: string; tone: 'green' | 'orange' | 'grey' | 'red' } | null {
  if (!end) return null;
  if (end.outage) return { text: `${stShort(name)}: lift out`, tone: 'red' };
  const tone = end.level === 'independent' ? 'green' : end.level === 'assisted' ? 'orange' : 'grey';
  return { text: `${stShort(name)}: ${ACC_SHORT[end.level] || ACC_SHORT.unknown}`, tone };
}

type TripLike = { from?: Place | null; to?: Place | null; via?: Place | null; legs?: { from?: Place | null; to?: Place | null }[] };
/** Stop ids on saved trips (from, to, via and each leg's ends), digits only, at most 40, for lift outage alerts. */
export function liftStations(trips: TripLike[]): string[] {
  const ids: string[] = [];
  for (const t of trips) {
    for (const p of [t.from, t.to, t.via, ...(t.legs || []).flatMap((l) => [l.from, l.to])]) if (p && p.id != null) ids.push(String(p.id));
  }
  return [...new Set(ids.filter((x) => /^\d{5,8}$/.test(x)))].slice(0, 40);
}

/** "350 m" or "1.2 km". */
export function distText(m?: number | null): string {
  if (m == null || !Number.isFinite(m)) return '';
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
