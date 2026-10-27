// The trip Live Activity's content for a live trip state. Pure, so it is unit tested
// (test/iostripcard.test.mjs). Field names match LiveTripAttributes.ContentState in Swift; dates are ms.
import type { LiveState } from '../src/lib/liveCalc';
import type { LiveTrip } from '../src/lib/live';
import type { ServiceResp, WatchLeg } from '../src/lib/types';

export type TripCardState = {
  line: string; lineColorHex: string; mode: string; nextStop: string | null; stopsLeft: number | null; getOffAt: string;
  arrival: number; phase: 'wait' | 'ride' | 'arrived'; warning: string | null; progress: number;
  towards: string | null; platform: string | null; departs: number | null; legArrives: number | null; destination: string | null;
  /** When the live times on the card were loaded. Native card version 2 (iosNative.cardVersion) shows "Updated 8:21am" once the card is stale. */
  updated?: number | null;
};

/** The next service for a change the live times say you will miss, from the plan the trip screen also shows. */
export type CardAlt = { line: string; dep: number; arr: number };
/**
 * alt: the next way on for a missed change. asOf: the app is going to the background, so the card says when its live
 * times are from (on native card version 1, which cannot show that itself). updated: when the feed was loaded.
 */
export type CardOpts = { alt?: CardAlt | null; asOf?: number | null; updated?: number | null };

type TripLike = Pick<LiveTrip, 'legs' | 'to'>;

/** "Kings Cross Station, Kings Cross" and "Kings Cross Station" both become "Kings Cross". */
export const shortName = (n?: string | null) =>
  String(n || '').replace(/,.*$/, '').trim().replace(/ (Station|Light Rail|Wharf)$/i, '').trim();
const platText = (p?: string | null) => (p ? p.replace(/^Platform\s*/i, 'Platform ').replace(/^Stand\s*/i, 'Stand ') : null);
const colorOf = (l: WatchLeg) => l.color || '#0A84FF';
const hhmm = (t: number) => {
  const s = new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' });
  return s.replace(/\s/g, '').toLowerCase();
};

/** The card for a live state. */
export function cardFor(g: TripLike, s: LiveState, now = Date.now(), o: CardOpts = {}): TripCardState {
  const legs = g.legs;
  const last = legs[legs.length - 1];
  const destination = shortName(g.to?.name || last?.to) || null;
  if (s.done) {
    return {
      line: last?.line || '', lineColorHex: last ? colorOf(last) : '#0A84FF', mode: last?.mode || '', nextStop: null, stopsLeft: null,
      getOffAt: shortName(last?.to), arrival: s.eta, phase: 'arrived', warning: null, progress: 1,
      towards: null, platform: null, departs: null, legArrives: s.eta, destination,
    };
  }
  const l = legs[s.cur];
  const x = s.L2[s.cur];
  const d: ServiceResp | null = x?.d || null;
  const next = d && s.nextIdx >= 0 ? d.stops[s.nextIdx] : null;
  let progress = 0;
  if (s.phase === 'ride') {
    const span = x.arr - x.dep;
    progress = span > 0 ? Math.min(1, Math.max(0, (now - x.dep) / span)) : 0;
    // Without live data the bar never reaches your stop on the clock alone.
    if (s.track === 'timetable') progress = Math.min(progress, 0.9);
  }
  const c = s.conns.find((k) => k.i === s.cur) || s.conns[0];
  const alt = c && c.risk === 'miss' ? o.alt || null : null;
  // No change warning: say when the leg has no live data, or how late it is, so the card never reads as on time.
  const legNote = s.track === 'timetable' ? 'Timetable times, not live' : s.delayMin != null && s.delayMin >= 2 ? `${s.delayMin} min late` : null;
  const warning = cardWarning(c, alt, o.asOf ?? null, legNote);
  return {
    line: l.line, lineColorHex: colorOf(l), mode: l.mode,
    nextStop: s.phase === 'wait' ? shortName(l.from) || null : next && s.track !== 'timetable' ? shortName(next.name) : null,
    stopsLeft: s.stopsLeft, getOffAt: shortName(l.to), arrival: alt && Number.isFinite(alt.arr) ? alt.arr : s.eta, phase: s.phase, warning, progress,
    towards: shortName(l.towards || d?.dest) || null, platform: platText(l.fromPlatform),
    // A missed change counts down to the next service when one was found, and to no made up time when not.
    departs: x.missed ? (alt ? alt.dep : null) : Number.isFinite(x.dep) ? x.dep : null,
    legArrives: x.missed ? (alt ? alt.arr : null) : Number.isFinite(x.arr) ? x.arr : null, destination,
    ...(o.updated ? { updated: o.updated } : {}),
  };
}

/**
 * The orange or red line on the card. A missed change says so, with the next service when one was found ("Change at
 * risk. Next T4 8:31am"); a change under 2 minutes is "Tight change at Redfern". asOf adds when the times are from,
 * because a card the app can no longer refresh must not read as live.
 */
export function cardWarning(c: LiveStateConn | null | undefined, alt: CardAlt | null, asOf: number | null, legNote: string | null = null): string | null {
  let w: string | null = null;
  if (c && c.risk === 'miss') w = alt ? `Change at risk. Next ${alt.line} ${hhmm(alt.dep)}` : `You'll likely miss the ${hhmm(c.nextDep)} ${c.next.line}`;
  else if (c && c.risk === 'tight') w = `Tight change at ${shortName(c.at)}`;
  else if (legNote) w = legNote;
  if (asOf == null) return w;
  return w ? `${w}. Updated ${hhmm(asOf)}` : `Updated ${hhmm(asOf)}. Open the app for live times`;
}
type LiveStateConn = Extract<LiveState, { done: false }>['conns'][number];

/**
 * When the system should mark the card out of date. Native card version 1 (builds up to 204) draws a stale card as
 * "You've arrived", so there it stays 2 minutes past the arrival. Version 2 draws it as "Updated 8:21am" with clock times instead of a
 * countdown, so there it is 2 minutes after the live times were loaded: the app refreshes them every 15 seconds while
 * it is open, and once it is closed the card stops claiming "now".
 */
export function staleAt(card: TripCardState, updated: number | null, honestStale: boolean, keepMs = 120000): number | null {
  if (card.phase === 'arrived') return null;
  // On board, the card also goes stale at the arrival where you get off (28 Oct: the Dynamic Island still counted
  // "in 1 minute" after the rider had got off), so with no newer times it shows the clock time, not a countdown.
  const off = card.phase === 'ride' && typeof card.legArrives === 'number' && Number.isFinite(card.legArrives) ? card.legArrives : Infinity;
  if (honestStale && updated) return Math.min(updated + 120000, card.arrival + keepMs, off);
  return card.arrival + keepMs;
}

