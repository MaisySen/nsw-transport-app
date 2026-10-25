// Live trip maths, shared by the live trip screen and its tests. No React Native imports here.
import type { ServiceResp, ServiceStop, WatchLeg } from './types';

export type LegLive = { dep: number; arr: number; delay: number; live: boolean; d: ServiceResp | null; gone?: boolean;
  /** The change to this leg was missed: dep and arr are the earliest you could go, not this service's times. */
  missed?: boolean; /** The departure of the service you missed. */ was?: number };
export type Conn = { i: number; at: string; spare: number; risk: 'ok' | 'tight' | 'miss'; next: WatchLeg; nextDep: number };
export type LiveState =
  | { done: true; L2: LegLive[]; eta: number }
  | { done: false; cur: number; phase: 'wait' | 'ride'; nextIdx: number; stopsLeft: number | null; L2: LegLive[]; conns: Conn[]; eta: number; live: boolean;
      /** True when a missed change moved the arrival later than the legs' own times (no next service known yet). */
      etaLate?: boolean };

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
    const arr0 = offS && Number.isFinite(tOf(offS)) ? tOf(offS) : l.arrPlanned ? tms(l.arrPlanned) + delay : dep + 10 * 60000;
    // A fresh vehicle position short of your stop wins over a stop list that has moved on by the clock.
    const short = vehicleShort(d, mi, ai);
    const past = !!d && ai >= 0 && idx(d.nextIndex) > ai && !short;
    const arr = heldArrival(d, ai, arr0, t, short);
    // Once the vehicle is past your stop the leg is over, but its arrival time stays the real one.
    return { dep, arr, delay: delay || 0, live: !!d?.live, d, gone: past };
  });
  // A change you missed: you rode the leg before, and the live times say this leg left before you could get to it.
  // It is not your train any more, so it neither counts down nor ends the trip; its times move to the earliest you
  // could leave, and the next service found for the change (CardAlt, NextOption) replaces that guess.
  for (let i = 1; i < L2.length; i++) {
    const prev = rode[i - 1];
    if (prev == null || !Number.isFinite(L2[i].dep)) continue;
    const ready = prev + (legs[i].walkBefore || 0) * 60000;
    if (connRisk(Math.round((L2[i].dep - ready) / 60000)) !== 'miss') continue;
    const lateBy = ready - L2[i].dep;
    L2[i] = { ...L2[i], dep: ready, arr: L2[i].arr + lateBy, gone: false, missed: true, was: L2[i].dep };
  }
  const cur = L2.findIndex((x) => !x.gone && t < x.arr + 45000);
  if (cur < 0) return { done: true, L2, eta: L2[last].arr };
  const x = L2[cur], d = x.d;
  const mi = idx(d?.mineIndex), ai = idx(d?.alightIndex);
  let phase: 'wait' | 'ride' = 'wait';
  if (x.missed) phase = 'wait';
  else if (d && mi >= 0 && idx(d.nextIndex) > mi) phase = 'ride';
  else if (!d || mi < 0) phase = t >= x.dep ? 'ride' : 'wait';
  let nextIdx = d ? idx(d.nextIndex) : -1;
  if (d && nextIdx >= 0) { while (nextIdx < d.stops.length - 1 && nextIdx !== ai && !timed(d.stops[nextIdx])) nextIdx++; }
  const stopsLeft = d && ai >= 0 && phase === 'ride' ? d.stops.slice(Math.max(nextIdx, mi + 1), ai + 1).filter(timed).length : null;
  const conns: Conn[] = [];
  if (x.missed && cur > 0) {
    conns.push({ i: cur - 1, at: legs[cur - 1].to || '', spare: -1, risk: 'miss', next: legs[cur], nextDep: x.was ?? x.dep });
  }
  for (let i = cur; i < last; i++) {
    const a = L2[i], b = L2[i + 1];
    const spare = Math.round((b.dep - a.arr) / 60000 - (legs[i + 1].walkBefore || 0));
    conns.push({ i, at: legs[i].to || '', spare, risk: connRisk(spare), next: legs[i + 1], nextDep: b.dep });
  }
  const e = etaFrom(legs, L2, cur);
  return { done: false, cur, phase, nextIdx, stopsLeft, L2, conns, eta: e.eta, live: x.live, ...(e.late ? { etaLate: true } : {}) };
}

/** A change with less than 2 minutes to spare is tight; a negative spare means the next leg leaves before you get there. */
export const connRisk = (spare: number): Conn['risk'] => (spare < 0 ? 'miss' : spare < 2 ? 'tight' : 'ok');

/**
 * The arrival time to count to while the live feed still shows the vehicle before your stop. An estimate that has
 * passed while the train is still on its way is wrong, so once the estimate is 30 seconds old the arrival stays 30 seconds ahead of now until the feed
 * shows the train at or past your stop (for at most 10 minutes past the estimate). This is what keeps "Get off now"
 * from showing before the train gets there.
 */
export function heldArrival(d: ServiceResp | null, ai: number, arr: number, t: number, short = false) {
  if (!d || ai < 0 || !Number.isFinite(arr)) return arr;
  if (!short) {
    if (!d.live) return arr;
    const ni = idx(d.nextIndex);
    if (ni < 0 || ni > ai || d.stops[ai]?.passed) return arr;
  }
  // Feeds trail the train by up to half a minute, so an estimate under 30 seconds old stands.
  if (t - arr < 30000 || t - arr > 10 * 60000) return arr;
  return t + 30000;
}

/**
 * True when the feed has a vehicle position under 3 minutes old that is clearly before the stop you get off at: more
 * than 500 m from it and less than 90% of the way along the straight line from your boarding stop. The stop list's
 * "next stop" falls back to the timetable clock when a feed has no live times for it, which moved a 4 minute late T1
 * past Redfern on time (25 Oct 2026); the train's own position does not lie that way.
 */
export function vehicleShort(d: ServiceResp | null, mi: number, ai: number) {
  const v = d?.vehicle as { lat?: number; lon?: number; ageS?: number | null } | undefined;
  if (!d || !v || ai < 0 || mi < 0 || ai <= mi) return false;
  if (typeof v.lat !== 'number' || typeof v.lon !== 'number' || (typeof v.ageS === 'number' && v.ageS > 180)) return false;
  const A = d.stops[mi], B = d.stops[ai];
  if (typeof A?.lat !== 'number' || typeof A?.lon !== 'number' || typeof B?.lat !== 'number' || typeof B?.lon !== 'number') return false;
  const k = Math.cos((B.lat * Math.PI) / 180);
  const ax = A.lon * k, ay = A.lat, bx = B.lon * k, by = B.lat, vx = v.lon * k, vy = v.lat;
  const L2 = (bx - ax) ** 2 + (by - ay) ** 2;
  if (!(L2 > 0)) return false;
  const f = ((vx - ax) * (bx - ax) + (vy - ay) * (by - ay)) / L2;
  const distM = Math.hypot(vx - bx, vy - by) * 111320;
  return f < 0.9 && distM > 500;
}

/**
 * When you get to the end, from the leg you are on. A change you will make keeps the next leg's live arrival. A change
 * the live times say you will miss moves everything after it later by at least the time you are short, so the
 * arrival never reads earlier than you can get there; the next service found for that change replaces this guess.
 */
export function etaFrom(legs: WatchLeg[], L2: LegLive[], cur: number) {
  let end = L2[cur].arr;
  let late = false;
  for (let i = cur + 1; i < L2.length; i++) {
    const b = L2[i];
    const ready = end + (legs[i].walkBefore || 0) * 60000;
    const spare = Math.round((b.dep - ready) / 60000);
    if (connRisk(spare) !== 'miss' || !Number.isFinite(b.dep)) { end = b.arr; continue; }
    late = true;
    end = b.arr + (ready - b.dep);
  }
  return { eta: end, late };
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
 * connections, and one "You've arrived" at the end. When the server is watching the trip it sends all of these
 * itself (each once, and its watch ends at your stop), so the phone posts none. Keys are stable, so a key already in
 * `alerted` never fires again.
 */
export function tripAlerts(legs: WatchLeg[], s: LiveState, alerted: Record<string, 1>, serverWatching: boolean, f: Fmt): TripAlert[] {
  const out: TripAlert[] = [];
  const add = (key: string, title: string, body: string) => { if (!alerted[key] && !out.some((a) => a.key === key)) out.push({ key, title, body }); };
  const last = legs.length - 1;
  if (serverWatching) return out;
  if (s.done) {
    add('arrived', "You've arrived", `${f.short(legs[last]?.to)} at ${f.clock(s.eta)}. Trip alerts are off.`);
    return out;
  }
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

/** A stop name as it should be heard: the part before the comma, with the sign abbreviations spelt out. */
export function sayName(n?: string | null): string {
  const words: [RegExp, string][] = [[/\bStn\b/g, 'Station'], [/\bRd\b/g, 'Road'], [/\bSt\b(?!\.)/g, 'Street'], [/\bAve?\b/g, 'Avenue'], [/\bPde\b/g, 'Parade'],
    [/\bHwy\b/g, 'Highway'], [/\bDr\b/g, 'Drive'], [/\bPl\b/g, 'Place'], [/\bCres\b/g, 'Crescent'], [/\bBvd\b/g, 'Boulevard'], [/\bNr\b/g, 'near'], [/\bOpp\b/g, 'opposite'], [/\bAt\b/g, 'at'], [/\bBefore\b/g, 'before'], [/\bAfter\b/g, 'after']];
  let v = String(n || '').split(',')[0].replace(/ Station$/, '').trim();
  for (const [re, w] of words) v = v.replace(re, w);
  return v;
}
const NOUN: Record<string, string> = { train: 'train', metro: 'metro', bus: 'bus', school: 'bus', coach: 'coach', ferry: 'ferry', lightrail: 'light rail' };
/** "platform 1", "stand X1", "wharf 2": lower case, as said in the middle of a sentence. */
const sayPlat = (p?: string | null) => {
  const v = String(p || '').trim();
  if (!v) return '';
  return /^(platform|stand|wharf|side)\b/i.test(v) ? v.charAt(0).toLowerCase() + v.slice(1) : /^\d+$/.test(v) ? `platform ${v}` : v;
};

/** "the T4 line", "the 410 bus", "the F1 ferry", "the L2 light rail": a line as an announcer says it. */
export function sayLineName(line?: string | null, mode?: string | null): string {
  const l = String(line || '').trim();
  const noun = NOUN[String(mode || '')] || '';
  if (!l) return noun ? `the ${noun}` : 'the next service';
  if (noun === 'train' || noun === 'metro') return `the ${l} line`;
  return noun ? `the ${l} ${noun}` : `the ${l}`;
}

/**
 * What trip guidance (Speak alerts) reads out, each once per trip (by key). Short announcer style sentences, in the
 * best installed voice (nativeExtras.speak), modelled on Sydney Trains and the newer buses:
 * "Your train to Redfern leaves in 3 minutes, from platform 1.", "Next stop, Redfern. Change here for the T4 line.",
 * "Your stop is next. Five Dock Shops.", a platform or stand change, running late (at 3, 5, 10 and 15 minutes),
 * a tight or missed change, and "You've arrived at Kings Cross." Keys match tripAlerts, so one moment is one line.
 */
export function speechCues(legs: WatchLeg[], s: LiveState, now: number, f: Fmt): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  const last = legs.length - 1;
  if (s.done) { out.push({ key: 'arrived', text: `You've arrived at ${sayName(legs[last]?.to)}.` }); return out; }
  const i = s.cur, l = legs[i], x = s.L2[i];
  if (!l || !x) return out;
  const noun = NOUN[l.mode] || 'service';
  if (s.phase === 'ride') {
    const d = x.d;
    if (d && (d.alightIndex ?? -1) > 0 && s.nextIdx === d.alightIndex) {
      if (i === last) out.push({ key: 'off' + i, text: `Your stop is next. ${sayName(l.to)}.` });
      else { const n = legs[i + 1]; out.push({ key: 'off' + i, text: `Next stop, ${sayName(l.to)}. Change here for ${sayLineName(n.line, n.mode)}.` }); }
    }
  }
  for (const cn of s.conns) {
    const nl = sayLineName(cn.next.line, cn.next.mode);
    if (cn.risk === 'miss') out.push({ key: 'conn' + cn.i, text: `You may miss ${nl} at ${sayName(cn.at)}.` });
    else if (cn.risk === 'tight') { const m = Math.max(0, cn.spare); out.push({ key: 'conn' + cn.i, text: `Tight change at ${sayName(cn.at)}. ${m} minute${m === 1 ? '' : 's'} to catch ${nl}.` }); }
  }
  if (s.phase !== 'wait' || x.missed || !Number.isFinite(x.dep)) return out;
  const d = x.d, mi = idx(d?.mineIndex);
  const livePlat = d && mi >= 0 ? String(d.stops[mi]?.platform || '').trim() : '';
  const norm = (p?: string | null) => String(p || '').toLowerCase().replace(/^(platform|stand|wharf|side)\s*/, '').trim();
  const plat = livePlat || l.fromPlatform || '';
  if (livePlat && l.fromPlatform && norm(livePlat) !== norm(l.fromPlatform)) {
    const kind = /^stand/i.test(livePlat) ? 'Stand' : 'Platform';
    out.push({ key: `plat${i}:${norm(livePlat)}`, text: `${kind} change. Your ${noun} now leaves from ${sayPlat(livePlat)}.` });
  }
  const late = Math.round(x.delay / 60000);
  if (x.live && late >= 3) {
    const step = late >= 15 ? 15 : late >= 10 ? 10 : late >= 5 ? 5 : 3;
    out.push({ key: `late${i}:${step}`, text: `Your ${noun} is running ${late} minutes late. It now leaves at ${f.clock(x.dep)}.` });
  }
  const dm = (x.dep - now) / 60000;
  if (dm <= 3.5 && dm > -0.5) {
    const m = Math.round(dm);
    const to = sayName(l.to);
    const where = plat ? `, from ${sayPlat(plat)}` : '';
    out.push({ key: `soon${i}`, text: m <= 0 ? `Your ${noun} to ${to} is leaving now${where}.` : `Your ${noun} to ${to} leaves in ${m} minute${m === 1 ? '' : 's'}${where}.` });
  }
  return out;
}

/**
 * The two moments that get one light haptic tap on a live trip: "leave now" (the service you are waiting for leaves
 * within a minute) and arrival. Keys, so each is felt once per trip.
 */
export function tapMoments(s: LiveState, now: number): string[] {
  if (s.done) return ['arrived'];
  const x = s.L2[s.cur];
  if (s.phase !== 'wait' || !x || x.missed || !Number.isFinite(x.dep)) return [];
  const left = x.dep - now;
  return left <= 60000 && left > -30000 ? ['leave' + s.cur] : [];
}

export type LiveTripLike = {
  id: string; legs: WatchLeg[]; alerted: Record<string, 1>; watchId: string | null; share: { id: string; key: string; pos: boolean } | null;
  rode?: Record<number, number>; arrivedAt?: number | null;
  /** Wake me before my stop is on: its alarm replaces the plain "Next stop" alert for each leg. */
  wake?: boolean;
  /** Speak alerts is on, and the alerts already read out (their own memory, apart from the notifications). */
  speak?: boolean; spoken?: Record<string, 1>;
};
export type LiveAction =
  | { t: 'ongoing'; title: string; body: string; leg: number }
  | { t: 'alert'; id: string; key: string; title: string; body: string }
  | { t: 'say'; key: string; text: string }
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
  if (x.missed) return { title: `Change at risk at ${f.short(l.from)}`, body: `The ${x.was ? f.clock(x.was) + ' ' : ''}${l.line} has likely left. Open the app for the next way on. Arrive about ${f.clock(s.eta)}` };
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
  const list = tripAlerts(g.legs, s, n.alerted || {}, !!n.watchId, f).filter((a) => !(g.wake && a.key.startsWith('off')));
  if (list.length) {
    const alerted = { ...(n.alerted || {}) };
    for (const a of list) { alerted[a.key] = 1; actions.push({ t: 'alert', id: `trip-${g.id}-${a.key}`, key: a.key, title: a.title, body: a.body }); }
    n = { ...n, alerted };
  }
  // Speak alerts reads out the same moments on its own: also when the server sends the notifications (the phone
  // then shows none, so before this nothing was ever said) and when the wake alarm stands in for "Next stop".
  if (g.speak) {
    const said = n.spoken || {};
    const say = speechCues(g.legs, s, now, f).filter((a) => !said[a.key]);
    if (say.length) {
      const spoken = { ...said };
      for (const a of say) { spoken[a.key] = 1; actions.push({ t: 'say', key: a.key, text: a.text }); }
      n = { ...n, spoken };
    }
  }
  if (s.done) {
    if (!n.arrivedAt) {
      if (n.share) actions.push({ t: 'share', prog: progOf(s, f) });
      // A server watch ends itself at your stop after its own "You've arrived", so it is left to finish.
      actions.push({ t: 'clearOngoing' });
      n = { ...n, arrivedAt: now };
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
