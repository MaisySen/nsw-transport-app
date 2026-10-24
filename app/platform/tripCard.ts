// The trip Live Activity's content for a live trip state. Pure, so it is unit tested
// (test/iostripcard.test.mjs). Field names match LiveTripAttributes.ContentState in Swift; dates are ms.
import type { LiveState } from '../src/lib/liveCalc';
import type { LiveTrip } from '../src/lib/live';
import type { ServiceResp, WatchLeg } from '../src/lib/types';

export type TripCardState = {
  line: string; lineColorHex: string; mode: string; nextStop: string | null; stopsLeft: number | null; getOffAt: string;
  arrival: number; phase: 'wait' | 'ride' | 'arrived'; warning: string | null; progress: number;
  towards: string | null; platform: string | null; departs: number | null; legArrives: number | null; destination: string | null;
};

type TripLike = Pick<LiveTrip, 'legs' | 'to'>;

export const shortName = (n?: string | null) =>
  String(n || '').replace(/ (Station|Light Rail|Wharf)$/i, '').replace(/,.*$/, '').trim();
const platText = (p?: string | null) => (p ? p.replace(/^Platform\s*/i, 'Platform ').replace(/^Stand\s*/i, 'Stand ') : null);
const colorOf = (l: WatchLeg) => l.color || '#0A84FF';
const hhmm = (t: number) => {
  const s = new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' });
  return s.replace(/\s/g, '').toLowerCase();
};

/** The card for a live state. */
export function cardFor(g: TripLike, s: LiveState, now = Date.now()): TripCardState {
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
  }
  let warning: string | null = null;
  const c = s.conns.find((k) => k.i === s.cur) || s.conns[0];
  if (c && c.risk === 'miss') warning = `You'll likely miss the ${hhmm(c.nextDep)} ${c.next.line}`;
  else if (c && c.risk === 'tight') warning = `Tight change at ${shortName(c.at)}`;
  return {
    line: l.line, lineColorHex: colorOf(l), mode: l.mode,
    nextStop: s.phase === 'wait' ? shortName(l.from) || null : next ? shortName(next.name) : null,
    stopsLeft: s.stopsLeft, getOffAt: shortName(l.to), arrival: s.eta, phase: s.phase, warning, progress,
    towards: shortName(l.towards || d?.dest) || null, platform: platText(l.fromPlatform),
    departs: Number.isFinite(x.dep) ? x.dep : null, legArrives: Number.isFinite(x.arr) ? x.arr : null, destination,
  };
}

