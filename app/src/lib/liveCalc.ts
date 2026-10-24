// Live trip maths, shared by the live trip screen and its tests. No React Native imports here.
import type { ServiceResp, ServiceStop, WatchLeg } from './types';

export type LegLive = { dep: number; arr: number; delay: number; live: boolean; d: ServiceResp | null; gone?: boolean };
export type Conn = { i: number; at: string; spare: number; risk: 'ok' | 'tight' | 'miss'; next: WatchLeg; nextDep: number };
export type LiveState =
  | { done: true; L2: LegLive[]; eta: number }
  | { done: false; cur: number; phase: 'wait' | 'ride'; nextIdx: number; stopsLeft: number | null; L2: LegLive[]; conns: Conn[]; eta: number; live: boolean };

const tms = (s?: string | null) => (s ? new Date(s).getTime() : NaN);
export const tOf = (s?: ServiceStop | null) => (s ? tms(s.estimated || s.planned) : NaN);
/** Stops a service runs through without stopping have no time; they are not counted or named. */
export const timed = (s?: ServiceStop | null) => !!s && !!(s.planned || s.estimated) && !s.skipped;
const idx = (v?: number | null) => (typeof v === 'number' ? v : -1);

/**
 * Where you are on the trip. The current leg is the first one whose live arrival at your stop is not yet
 * past (or the vehicle is already past your stop). Waiting until the vehicle passes your boarding stop.
 */
export function computeLive(legs: WatchLeg[], svc: (ServiceResp | null | undefined)[], t: number, memo?: LiveMemo | null): LiveState {
  const last = legs.length - 1;
  const rode = memo?.rode || {};
  // A trip that has arrived stays arrived, whatever a later feed says.
  if (memo?.arrivedAt) {
    const L0: LegLive[] = legs.map((l, i) => {
      const arr = rode[i] ?? (l.arrPlanned ? tms(l.arrPlanned) : tms(l.planned));
      return { dep: tms(l.estimated || l.planned), arr, delay: 0, live: false, d: svc[i] || null };
    });
    return { done: true, L2: L0, eta: rode[last] ?? memo.arrivedAt };
  }
  const L2: LegLive[] = legs.map((l, i) => {
    let d = svc[i] || null;
    // After you have been riding a leg, a feed that shows a vehicle still before your boarding stop
    // is the next service on the line, not yours. Ignore it and keep the arrival you were riding to.
    if (d && !sameRun(d, l, rode[i] != null)) d = null;
    if (!d && rode[i] != null) {
      const a = rode[i];
      return { dep: tms(l.estimated || l.planned), arr: a, delay: 0, live: false, d: null };
    }
    const mi = idx(d?.mineIndex), ai = idx(d?.alightIndex);
    const mineS = d && mi >= 0 ? d.stops[mi] : null, offS = d && ai >= 0 ? d.stops[ai] : null;
    const delay = mineS && mineS.estimated && mineS.planned ? tms(mineS.estimated) - tms(mineS.planned) : l.estimated ? tms(l.estimated) - tms(l.planned) : 0;
    const dep = mineS && Number.isFinite(tOf(mineS)) ? tOf(mineS) : tms(l.estimated || l.planned);
    const arr = offS && Number.isFinite(tOf(offS)) ? tOf(offS) : l.arrPlanned ? tms(l.arrPlanned) + delay : dep + 10 * 60000;
    const past = !!d && ai >= 0 && idx(d.nextIndex) > ai;
    // Once the vehicle is past your stop the leg is over, but its arrival time stays the real one.
    return { dep, arr, delay: delay || 0, live: !!d?.live, d, gone: past };
  });
  const cur = L2.findIndex((x) => !x.gone && t < x.arr + 45000);
  if (cur < 0) return { done: true, L2, eta: L2[last].arr };
  const x = L2[cur], d = x.d;
  const mi = idx(d?.mineIndex), ai = idx(d?.alightIndex);
  let phase: 'wait' | 'ride' = 'wait';
  if (d && mi >= 0 && idx(d.nextIndex) > mi) phase = 'ride';
  else if (!d || mi < 0) phase = t >= x.dep ? 'ride' : 'wait';
  let nextIdx = d ? idx(d.nextIndex) : -1;
  if (d && nextIdx >= 0) { while (nextIdx < d.stops.length - 1 && nextIdx !== ai && !timed(d.stops[nextIdx])) nextIdx++; }
  const stopsLeft = d && ai >= 0 && phase === 'ride' ? d.stops.slice(Math.max(nextIdx, mi + 1), ai + 1).filter(timed).length : null;
  const conns: Conn[] = [];
  for (let i = cur; i < last; i++) {
    const a = L2[i], b = L2[i + 1];
    const spare = Math.round((b.dep - a.arr) / 60000 - (legs[i + 1].walkBefore || 0));
    conns.push({ i, at: legs[i].to || '', spare, risk: spare < 0 ? 'miss' : spare < 2 ? 'tight' : 'ok', next: legs[i + 1], nextDep: b.dep });
  }
  return { done: false, cur, phase, nextIdx, stopsLeft, L2, conns, eta: L2[last].arr, live: x.live };
}

/** What the live trip remembers between refreshes: when each leg was last seen being ridden, and its arrival then. */
export type LiveMemo = { rode?: Record<number, number>; arrivedAt?: number | null };

/**
 * True while a feed still describes your service: its timetable time at your stop matches the leg, and once you
 * have boarded, the vehicle is past your boarding stop. A feed for the next service on the line fails this.
 */
export function sameRun(d: ServiceResp, l: WatchLeg, boarded = true) {
  if (d.tripId && l.tripId && d.tripId !== l.tripId) return false;
  const mi = idx(d.mineIndex), ni = idx(d.nextIndex);
  // Timetable times never move with delays, so a boarding time more than 5 minutes off the planned one is another run.
  const mineS = mi >= 0 ? d.stops[mi] : null;
  if (mineS?.planned && l.planned && Math.abs(tms(mineS.planned) - tms(l.planned)) > 5 * 60000) return false;
  if (boarded && mi >= 0 && ni >= 0 && ni <= mi) return false;
  return true;
}

/** The memo after a refresh: the leg you are riding now records its arrival time. */
export function nextMemo(memo: LiveMemo | null | undefined, s: LiveState): LiveMemo {
  const m: LiveMemo = { rode: { ...(memo?.rode || {}) }, arrivedAt: memo?.arrivedAt ?? null };
  if (!s.done && s.phase === 'ride' && Number.isFinite(s.L2[s.cur].arr)) m.rode![s.cur] = s.L2[s.cur].arr;
  return m;
}

export type TripAlert = { key: string; title: string; body: string };
type Fmt = { clock: (t: number) => string; short: (n?: string | null) => string; plat: (p?: string | null) => string };

/**
 * The alerts this refresh should show, each once per trip: get off or change one stop before, tight or missed
 * connections, and one "You've arrived" at the end. When the server is watching the trip it sends the stop and
 * connection alerts itself, so only "You've arrived" comes from the phone. Keys are stable, so a key already in
 * `alerted` never fires again.
 */
export function tripAlerts(legs: WatchLeg[], s: LiveState, alerted: Record<string, 1>, serverWatching: boolean, f: Fmt): TripAlert[] {
  const out: TripAlert[] = [];
  const add = (key: string, title: string, body: string) => { if (!alerted[key] && !out.some((a) => a.key === key)) out.push({ key, title, body }); };
  const last = legs.length - 1;
  if (s.done) {
    add('arrived', "You've arrived", `${f.short(legs[last]?.to)} at ${f.clock(s.eta)}. Trip alerts are off.`);
    return out;
  }
  if (serverWatching) return out;
  if (s.phase === 'ride') {
    const d = s.L2[s.cur].d, l = legs[s.cur];
    if (d && (d.alightIndex ?? -1) > 0 && s.nextIdx === d.alightIndex) {
      if (s.cur === last) add('off' + s.cur, `Next stop: ${f.short(l.to)}`, `Get ready to get off. You arrive at ${f.clock(s.eta)}.`);
      else { const n = legs[s.cur + 1]; add('off' + s.cur, `Next stop: ${f.short(l.to)}, change here`, `Then the ${f.clock(s.L2[s.cur + 1].dep)} ${n.line}${n.fromPlatform ? ' from ' + f.plat(n.fromPlatform) : ''}.`); }
    }
  }
  for (const cn of s.conns) {
    if (cn.risk === 'miss') add('conn' + cn.i, 'Connection at risk', `With live times you'll likely miss the ${f.clock(new Date(cn.next.planned).getTime())} ${cn.next.line} at ${f.short(cn.at)}.`);
    else if (cn.risk === 'tight') add('conn' + cn.i, `Tight change at ${f.short(cn.at)}`, `${Math.max(0, cn.spare)} min to catch the ${cn.next.line}.`);
  }
  return out;
}

export type LiveTripLike = {
  id: string; legs: WatchLeg[]; alerted: Record<string, 1>; watchId: string | null; share: { id: string; key: string; pos: boolean } | null;
  rode?: Record<number, number>; arrivedAt?: number | null;
};
export type LiveAction =
  | { t: 'ongoing'; title: string; body: string; leg: number }
  | { t: 'alert'; id: string; key: string; title: string; body: string }
  | { t: 'clearOngoing' }
  | { t: 'stopWatch'; id: string }
  | { t: 'share'; prog: any }
  | { t: 'end' };

/** Progress for a share link. */
export function progOf(s: LiveState | null, f: Pick<Fmt, 'short'>) {
  if (!s || s.done) return { phase: 'done' };
  const d = s.L2[s.cur].d, ns = d && s.nextIdx >= 0 ? d.stops[s.nextIdx] : null;
  return { leg: s.cur, phase: s.phase, next: ns ? f.short(ns.name) : null, stopsLeft: s.stopsLeft, eta: s.eta };
}

/** Words for the ongoing notification. */
export function liveWords(legs: WatchLeg[], s: LiveState, now: number, f: Fmt) {
  const last = legs.length - 1;
  if (s.done) return { title: "You've arrived", body: `${f.short(legs[last].to)} at ${f.clock(s.eta)}` };
  const l = legs[s.cur], x = s.L2[s.cur], d = x.d;
  const arrive = `Arrive ${f.clock(s.eta)} (${minsWords((s.eta - now) / 60000)})`;
  if (s.phase === 'wait') {
    const dm = Math.round((x.dep - now) / 60000);
    return { title: `${l.line} to ${f.short(l.towards || l.to)}`, body: `${s.cur ? 'Change to' : 'Board'} the ${l.line} ${dm <= 0 ? 'now' : `at ${f.clock(x.dep)}`}${l.fromPlatform ? `, ${f.plat(l.fromPlatform)}` : ''}. ${arrive}` };
  }
  const ns = d && s.nextIdx >= 0 ? d.stops[s.nextIdx] : null;
  const yours = !!d && s.nextIdx === d.alightIndex;
  const left = s.stopsLeft != null ? `${s.stopsLeft} stop${s.stopsLeft === 1 ? '' : 's'} to ${f.short(l.to)}` : `to ${f.short(l.to)}`;
  return { title: `${l.line} to ${f.short(l.towards || l.to)}`, body: `${yours ? `Get off at ${f.short(l.to)}, next stop` : ns ? `Next stop: ${f.short(ns.name)}, ${left}` : `On the ${l.line}, ${left}`}. ${arrive}` };
}

/**
 * One refresh of the trip you are on, as data: the new trip record, where you are, and what the phone should do
 * (update the ongoing notification, show an alert, stop the server alerts, update a share link, end the trip).
 * The live trip engine runs the actions; the replay tests check them.
 */
export function stepLive(g: LiveTripLike, svc: (ServiceResp | null | undefined)[], now: number, f: Fmt): { g: LiveTripLike; s: LiveState; actions: LiveAction[] } {
  const actions: LiveAction[] = [];
  const memo: LiveMemo = { rode: g.rode, arrivedAt: g.arrivedAt };
  const s = computeLive(g.legs, svc, now, memo);
  let n: LiveTripLike = g;
  const m = nextMemo(memo, s);
  if (JSON.stringify(m.rode || {}) !== JSON.stringify(g.rode || {})) n = { ...n, rode: m.rode };
  const list = tripAlerts(g.legs, s, n.alerted || {}, !!n.watchId, f);
  if (list.length) {
    const alerted = { ...(n.alerted || {}) };
    for (const a of list) { alerted[a.key] = 1; actions.push({ t: 'alert', id: `trip-${g.id}-${a.key}`, key: a.key, title: a.title, body: a.body }); }
    n = { ...n, alerted };
  }
  if (s.done) {
    if (!n.arrivedAt) {
      if (n.share) actions.push({ t: 'share', prog: progOf(s, f) });
      if (n.watchId) actions.push({ t: 'stopWatch', id: n.watchId });
      actions.push({ t: 'clearOngoing' });
      n = { ...n, arrivedAt: now, watchId: null };
    }
    if (now > (n.arrivedAt || now) + 10 * 60000) actions.push({ t: 'end' });
    return { g: n, s, actions };
  }
  const w = liveWords(g.legs, s, now, f);
  actions.push({ t: 'ongoing', title: w.title, body: w.body, leg: s.cur });
  if (n.share) actions.push({ t: 'share', prog: progOf(s, f) });
  return { g: n, s, actions };
}

/**
 * One key per thing a server alert is about, so the same moment never shows twice: "Next stop: Kings Cross"
 * and "Arriving at Kings Cross in 2 min" for one watch share a key. `id` is the notification identifier, so a
 * newer alert about the same trip replaces the older one instead of stacking.
 */
export function noteKey(n: { id: number; watch_id?: string | null; title: string }): { key: string; id: string } {
  const w = n.watch_id || '';
  const m = /^(?:Next stop: |Arriving at |Change at )(.+?)(?:, change here| in \d+ min)?$/.exec(n.title || '');
  if (w && m) {
    const place = m[1].replace(/ Station$/i, '').trim().toLowerCase();
    return { key: `${w}|stop|${place}`, id: `w${w}-stop` };
  }
  if (w && /^(Connection at risk|Tight change)/i.test(n.title || '')) return { key: `${w}|conn|${n.title}`, id: `w${w}-conn` };
  return { key: `note|${n.id}`, id: `note-${n.id}` };
}

/** The bit of a route between where you board and where you get off, by the nearest path points. */
export function cutPath(path: [number, number][] | undefined, a?: ServiceStop | null, b?: ServiceStop | null): [number, number][] {
  if (!path || path.length < 2) return path || [];
  const near = (s?: ServiceStop | null) => {
    if (!s || s.lat == null || s.lon == null) return -1;
    let best = -1, bd = Infinity;
    path.forEach(([la, lo], k) => { const dd = (la - s.lat!) ** 2 + (lo - s.lon!) ** 2; if (dd < bd) { bd = dd; best = k; } });
    return best;
  };
  const i = near(a), j = near(b);
  if (i < 0 || j < 0 || j <= i) return path;
  return path.slice(i, j + 1);
}

/** Minutes, or hours and minutes past an hour: "9 min", "1 h 12 min". */
export function minsWords(m: number) {
  const v = Math.max(0, Math.round(m));
  return v < 60 ? `${v} min` : `${Math.floor(v / 60)} h ${v % 60} min`;
}
