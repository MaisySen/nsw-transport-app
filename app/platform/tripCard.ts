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
  /**
   * The stops on this leg for the stop track that replaces the plain bar (native card from build 210). Optional:
   * older native cards ignore it and draw the bar, and a card without it draws the bar too.
   */
  stopTrack?: StopTrack;
};

/**
 * The leg's stops for the Live Activity stop track, small enough for Apple's 4 KB push. passed: stops of this leg
 * already behind you, your boarding stop included (1 while waiting). next: the stops still to come, next first and your
 * stop off last, short names, at most TRACK_MAX. hidden: stops left out of the middle of a long ride, after the first
 * hiddenAt names. live: where the run is comes from live data (vehicle, live times, your location or tap); false when
 * only the timetable says, and the card then labels it as timetable (R1, never shown as live).
 */
export type StopTrack = { passed: number; next: string[]; hidden: number; hiddenAt: number; live: boolean };
/** Upcoming stop names on the card at most; a longer ride keeps the first ones and your stop off. */
export const TRACK_MAX = 10;
/** A stop name on the card at most this long (the push stays well under 4 KB). */
export const TRACK_NAME_MAX = 32;

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

/** A stop the service stops at (a time and not skipped), as liveCalc counts stops. */
const stopTimed = (st?: { planned?: string | null; estimated?: string | null; skipped?: boolean | null } | null) =>
  !!st && !!(st.planned || st.estimated) && !st.skipped;
const trackName = (n?: string | null) => {
  const v = shortName(n);
  return v.length > TRACK_NAME_MAX ? v.slice(0, TRACK_NAME_MAX - 1).trimEnd() + '.' : v;
};

/**
 * The stop track for the current leg, from the same stop list and next stop the countdown and "N stops" use. Null
 * without the run's stops, or without both your boarding stop and your stop off in them.
 */
export function stopTrackFor(d: ServiceResp | null | undefined, nextIdx: number, phase: 'wait' | 'ride', live: boolean): StopTrack | null {
  if (!d || !Array.isArray(d.stops) || !d.stops.length) return null;
  const mi = typeof d.mineIndex === 'number' ? d.mineIndex : -1;
  const ai = typeof d.alightIndex === 'number' ? d.alightIndex : -1;
  if (mi < 0 || ai <= mi || ai >= d.stops.length) return null;
  // The leg's stops: where you board, where it stops on the way, where you get off.
  const leg: number[] = [];
  for (let i = mi; i <= ai; i++) if (i === mi || i === ai || stopTimed(d.stops[i])) leg.push(i);
  // While waiting you are at your boarding stop; on board the run is between the stops behind it and nextIdx.
  const n = phase === 'wait' || nextIdx < 0 ? mi + 1 : Math.min(Math.max(nextIdx, mi + 1), ai);
  const passed = leg.filter((i) => i < n).length;
  const up = leg.filter((i) => i >= n).map((i) => trackName(d.stops[i].name));
  if (!up.length || up.some((x) => !x)) return null;
  let next = up, hidden = 0, hiddenAt = 0;
  if (up.length > TRACK_MAX) {
    hiddenAt = TRACK_MAX - 2;
    hidden = up.length - (TRACK_MAX - 1);
    next = [...up.slice(0, hiddenAt), up[up.length - 1]];
  }
  return { passed, next, hidden, hiddenAt, live };
}

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
  const track = stopTrackFor(d, s.nextIdx, s.phase, s.track !== 'timetable');
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
    // A missed change waits for a service the stop list is not for, so it keeps the plain bar.
    ...(track && !x.missed ? { stopTrack: track } : {}),
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

