// "Bus running 6 min late" on bus and coach legs of a trip, from the live position feed the server
// merges into each leg (realtime, delayMin). No React here (test/buslive.test.mjs).

export type BusLegStatus = { text: string; tone: 'late' | 'ok' | 'red' };

/** Words for a bus or coach leg with live data, or null (other modes, or no live data for this bus). */
export function busLegStatus(l: { kind?: string; mode?: string; realtime?: boolean; delayMin?: number | null; cancelled?: boolean }): BusLegStatus | null {
  if (l.kind === 'walk' || (l.mode !== 'bus' && l.mode !== 'coach')) return null;
  const noun = l.mode === 'coach' ? 'Coach' : 'Bus';
  if (l.cancelled) return { text: `${noun} cancelled`, tone: 'red' };
  if (!l.realtime || l.delayMin == null || !Number.isFinite(l.delayMin)) return null;
  const d = Math.round(l.delayMin);
  if (d >= 2) return { text: `${noun} running ${d} min late`, tone: d >= 5 ? 'red' : 'late' };
  if (d <= -2) return { text: `${noun} running ${-d} min early`, tone: 'late' };
  return { text: `${noun} on time, live`, tone: 'ok' };
}

/**
 * A Live Traffic incident on the bus's route (from the new server only): "Crash on Victoria Road at Gladesville.
 * Your 501 may run late." Null for other modes, or with no incident on the route.
 */
export function trafficLine(l: { kind?: string; mode?: string; line?: string; cancelled?: boolean; traffic?: { text?: string } | null }): string | null {
  if (l.kind === 'walk' || (l.mode !== 'bus' && l.mode !== 'coach') || l.cancelled) return null;
  const t = String(l.traffic?.text || '').replace(/[.\s]+$/, '').trim();
  if (!t) return null;
  const who = l.line ? `Your ${l.line}` : l.mode === 'coach' ? 'Your coach' : 'Your bus';
  return `${t}. ${who} may run late.`;
}

// Live bus status for departure rows, the departures board and the bus trip screen. Real-time data only: a row or
// trip with no live data says "Timetable only" and nothing more; nothing here guesses.

/** The delay must grow by at least this many minutes over the stops ahead of the bus to count as slow traffic. */
export const SLOW_GROWTH_MIN = 3;
/** And the bus must be predicted at least this many minutes late where the stretch ends. */
export const SLOW_LATE_MIN = 3;
/** Fewest stops with a live time ahead of the bus before the rule says anything. */
export const SLOW_MIN_STOPS = 3;
export const TRAFFIC_TEXT = 'Running slow in traffic';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Is the bus losing time on the road ahead? `delays` are the live predicted delays in minutes at the stops ahead,
 * in stop order, starting at the bus's next stop (null where a stop has no live time). Slow when the delay at the
 * end of the stretch is clearly bigger than at its start: the smaller of the last two minus the smaller of the
 * first two is at least SLOW_GROWTH_MIN, and the bus is at least SLOW_LATE_MIN late at the end. Taking the smaller
 * of two neighbours keeps one odd stop from deciding. Works the same for any route.
 */
export function slowInTraffic(delays: ReadonlyArray<number | null | undefined> | null | undefined): { growthMin: number; lateMin: number } | null {
  const pts = (delays || []).filter(finite);
  if (pts.length < SLOW_MIN_STOPS) return null;
  const start = Math.min(pts[0], pts[1]);
  const end = Math.min(pts[pts.length - 1], pts[pts.length - 2]);
  const growth = end - start;
  if (growth < SLOW_GROWTH_MIN || end < SLOW_LATE_MIN) return null;
  return { growthMin: Math.round(growth), lateMin: Math.round(end) };
}

type StopTimes = { planned?: string | null; estimated?: string | null; passed?: boolean; mine?: boolean; alight?: boolean; name?: string };
const at = (s?: string | null) => (s ? new Date(s).getTime() : NaN);

/** Live delay in minutes at each stop from `from` to `to` (both included); null where a stop has no live time. */
export function stopDelays(stops: ReadonlyArray<StopTimes>, from: number, to: number): (number | null)[] {
  const out: (number | null)[] = [];
  if (!stops || from < 0) return out;
  for (let i = from; i <= Math.min(to, stops.length - 1); i++) {
    const s = stops[i];
    const d = (at(s?.estimated) - at(s?.planned)) / 60000;
    out.push(Number.isFinite(d) ? Math.round(d * 10) / 10 : null);
  }
  return out;
}

/**
 * The stretch of a bus trip to judge: from the bus's next stop to your stop when the bus has not reached it yet,
 * else to where you get off, else to the end of the trip.
 */
export function tripStretch(stops: ReadonlyArray<StopTimes>, nextIndex: number | null | undefined): [number, number] | null {
  const n = stops?.length || 0;
  const ni = nextIndex ?? -1;
  if (n < 2 || ni < 0 || ni >= n) return null;
  const mine = stops.findIndex((s) => s.mine);
  const off = stops.findIndex((s) => s.alight);
  const end = mine > ni ? mine : off > ni ? off : n - 1;
  return [ni, end];
}

/** "Running slow in traffic" for a bus trip screen, or null. Live trips with a vehicle only. */
export function tripTraffic(svc: { mode?: string; live?: boolean; cancelled?: boolean; vehicle?: unknown; nextIndex?: number; stops?: ReadonlyArray<StopTimes> } | null | undefined): string | null {
  if (!svc || !svc.live || svc.cancelled || !svc.vehicle) return null;
  if (svc.mode && svc.mode !== 'bus' && svc.mode !== 'coach' && svc.mode !== 'school') return null;
  const stretch = tripStretch(svc.stops || [], svc.nextIndex);
  if (!stretch) return null;
  return slowInTraffic(stopDelays(svc.stops || [], stretch[0], stretch[1])) ? TRAFFIC_TEXT : null;
}

/**
 * "Running slow in traffic" for a departure row or a trip leg, from `ahead`: the server's live delays (minutes) at
 * the stops from the bus's next stop to this stop. Null for other modes, timetable rows and cancelled services.
 */
export function rowTraffic(d: { mode?: string; realtime?: boolean; cancelled?: boolean; ahead?: ReadonlyArray<number | null> | null } | null | undefined): string | null {
  if (!d || d.cancelled || !d.realtime) return null;
  if (d.mode !== 'bus' && d.mode !== 'coach' && d.mode !== 'school') return null;
  return slowInTraffic(d.ahead) ? TRAFFIC_TEXT : null;
}

/**
 * Live words for a bus on the departures board: `status` ("4 min late", "On time", "Timetable only") and `away`
 * ("3 stops away", "at the stop", or empty when the bus has no position or is far off). Null for other modes.
 */
export function busBoardWords(d: { mode?: string; realtime?: boolean; cancelled?: boolean; delayMin?: number | null; stopsAway?: number | null; vehicle?: unknown }, live: boolean): { status: string; away: string } | null {
  if (!d || (d.mode !== 'bus' && d.mode !== 'coach' && d.mode !== 'school')) return null;
  if (d.cancelled) return null;
  if (!d.realtime || !live) return { status: 'Timetable only', away: '' };
  const m = finite(d.delayMin) ? Math.round(d.delayMin) : 0;
  const status = m >= 2 ? `${m} min late` : m <= -2 ? `${-m} min early` : 'On time';
  const away = d.vehicle && finite(d.stopsAway) && d.stopsAway >= 0 && d.stopsAway <= 15
    ? (d.stopsAway === 0 ? 'At the stop' : `${d.stopsAway} stop${d.stopsAway === 1 ? '' : 's'} away`) : '';
  return { status, away };
}

/**
 * Where to draw the bus on a trip's line of stops: `at` a stop when the bus is at it (the server's "At <stop>"),
 * else just before the next stop (between it and the one before). Null without a live vehicle.
 */
export function busMarker(stops: ReadonlyArray<StopTimes>, nextIndex: number | null | undefined, where: { text?: string; near?: string } | null | undefined, hasVehicle: boolean): { index: number; at: boolean } | null {
  const n = stops?.length || 0;
  const ni = nextIndex ?? -1;
  if (!hasVehicle || n === 0 || ni < 0 || ni >= n) return null;
  if (where?.text && /^At /.test(where.text) && where.near) {
    // The closest stop by that name to the next stop (a route can pass a stop name twice).
    let best = -1;
    stops.forEach((s, i) => { if (s.name === where.near && (best < 0 || Math.abs(i - ni) < Math.abs(best - ni))) best = i; });
    if (best >= 0) return { index: best, at: true };
  }
  return { index: ni, at: false };
}
