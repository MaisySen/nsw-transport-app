// Journey simulator: a pure, dependency-free reference implementation of the live trip
// flow in docs/TRIP_FLOW_SPEC.md (section 2). It plays a started trip second by second and
// says, for every moment, what each surface shows, says and buzzes, and what the server pushes.
// No network, no clock, no app code: the same inputs always give the same outputs.
// Times are seconds since local midnight (Sydney), so output does not depend on the box's TZ.
// Run the cases: node app/sim/report.mjs <outdir>   Tests: app/test/journeysim.test.mjs

// ---------- time ----------
export const hms = (s) => {
  if (typeof s === 'number') return s;
  const [h, m, sec = 0] = String(s).split(':').map(Number);
  return h * 3600 + m * 60 + sec;
};
const pad = (n) => String(n).padStart(2, '0');
export function clock(t, c24 = false) {
  const h = Math.floor(t / 3600) % 24, m = Math.floor((t % 3600) / 60);
  if (c24) return `${pad(h)}:${pad(m)}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)}${h < 12 ? 'am' : 'pm'}`;
}
export function clockSec(t) {
  const h = Math.floor(t / 3600) % 24, m = Math.floor((t % 3600) / 60), s = t % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return s ? `${h12}:${pad(m)}:${pad(s)}` : `${h12}:${pad(m)}`;
}
const mins = (sec) => Math.max(1, Math.ceil(sec / 60));

// ---------- rule numbers (spec 2.2, 2.4, 2.5, 2.6, 2.7) ----------
export const RULES = {
  LIVE_FRESH: 120,        // under 2 min: live (evidence, countdown)
  LIVE_CAP: 300,          // R2: live readings over 5 min old are not used for times
  NO_DATA: 600,           // over 10 min: "No live data. Open the app to refresh."
  LEFT_BY: 60,            // the stop's own live time passed by 60 s = left
  GETOFF_LEAD: 30,        // Get off now at live arrival minus 30 s
  SERVER_DELIVERY: 2,     // server sends 2 s early for delivery
  GETOFF_EXPIRE: 30,      // Get off now expires at live arrival + 30 s
  HEADSUP_WINDOW: 120,    // heads-up when the live arrival is 2 min away (or the stop before is left)
  ENDED_AFTER: 120,       // card goes 2 min after Arrived
  SERVER_POLL: 30,        // server reads a live trip every 30 s (delay pushes within 30 s)
  SERVER_POLL_NEAR: 15,   // and every 15 s once the live arrival is under 5 min away
  NEAR: 300,
  PHONE_POLL: 15,         // the open app reads every 15 s
  PHONE_WRITE_MAX_AGE: 20,// the phone writes the card only from readings under 20 s old
  PUSH_AT_LEAST: 60,      // server pushes the card at least every 60 s while live
  VOICE_OPEN_FOR: 10,     // V1
  VOICE_FRESH: 60,        // V2
  VOICE_SILENT_REFRESHES: 2, // V4
  VOICE_QUEUE_MAX: 30,    // V5
  DELAY_ALERT: 3,         // one alert when the delay first reaches 3 min, and per 3 min change
  WIDGET_RELOAD: 300,     // build 212 widget reload while locked
  CHANGE_MIN: 180,        // minimum time to change platforms at an interchange
};

// Kylie clips in the app bundle (spec 2.6, 2.7 V8)
export const CLIPS = {
  headsup: { file: 'getoff_soon', words: 'Your stop is coming up. Please get ready to get off at the next stop.', secs: 5.2 },
  getoff: { file: 'getoff_now', words: 'Please get off at the next stop.', secs: 2.8 },
  arrived: { file: 'arrival', words: "You've arrived at your stop.", secs: 2.0, build: 212 },
};

// ---------- case normalising ----------
const norm = (s) => String(s || '').toLowerCase().replace(/,?\s*(platform|plat|stand)\s*\w+$/, '').replace(/\s+station$/, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function prepare(c) {
  // Visible legs first, then the services the feed can find instead (alts: next service after a
  // cancellation or a missed change). An alt has forLeg = the visible leg it can replace.
  const all = [...c.legs, ...(c.alts || []).map((a) => ({ ...a, alt: true }))];
  const legs = all.map((l, li) => ({
    ...l, li,
    stops: l.stops.map((s) => ({ ...s, tt: hms(s.tt) })),
    off: l.stops.length - 1,
  }));
  const ev = (c.feed?.events || []).map((e) => ({ ...e, at: hms(e.at) })).sort((a, b) => a.at - b.at);
  const gaps = (c.feed?.gaps || []).map(([a, b]) => [hms(a), b == null ? Infinity : hms(b)]);
  const phone = (c.phone || []).map((p) => ({ ...p, at: hms(p.at) })).sort((a, b) => a.at - b.at);
  return {
    ...c, legs, start: hms(c.start), end: hms(c.end),
    feed: { refresh: c.feed?.refresh ?? 15, events: ev, gaps },
    phone,
    server: { reachable: true, direct: true, ...(c.server || {}) },
  };
}

// ---------- the live feed ----------
const inGap = (gaps, t) => gaps.some(([a, b]) => t >= a && t < b);
// The newest moment at or before t at which the feed published (a refresh tick or an event), outside gaps.
export function publishTime(P, t) {
  const { refresh, gaps, events } = P.feed;
  let best = -Infinity;
  for (let k = Math.floor(t / refresh) * refresh; k >= t - 4 * 3600; k -= refresh) {
    if (!inGap(gaps, k)) { best = k; break; }
  }
  for (const e of events) if (e.at <= t && e.at > best && !inGap(gaps, e.at)) best = e.at;
  return best;
}
// What the live feed says at time t: per leg, stop estimates, carried delay, vehicle, platform, cancellation.
export function snapshot(P, t) {
  const asOf = publishTime(P, t);
  const legs = P.legs.map(() => ({ est: {}, runDelay: null, board: null, vehicle: null, platform: null, cancelled: false, next: null, unmatched: false }));
  for (const e of P.feed.events) {
    if (e.at > asOf) break;
    const L = legs[e.leg ?? 0], leg = P.legs[e.leg ?? 0];
    if (e.est) {
      for (const [name, v] of Object.entries(e.est)) {
        const i = leg.stops.findIndex((s) => norm(s.name) === norm(name) || (s.alias && norm(s.alias) === norm(name)));
        if (i >= 0) L.est[i] = v == null ? undefined : hms(v);
      }
    }
    if ('delay' in e) L.runDelay = e.delay == null ? null : Math.round(e.delay * 60);
    if (e.board) L.board = hms(e.board);
    if (e.vehicle) {
      const i = leg.stops.findIndex((s) => norm(s.name) === norm(e.vehicle.stop));
      L.vehicle = { stop: i, state: e.vehicle.state, at: e.at };
    }
    if (e.platform) L.platform = String(e.platform);
    if (e.cancelled) { L.cancelled = true; L.next = e.next ?? null; }
    if (e.unmatched) L.unmatched = true;
  }
  // a vehicle position is re-reported on every publish while the feed is live
  for (const L of legs) if (L.vehicle) L.vehicle = { ...L.vehicle, at: asOf };
  return { asOf, legs };
}

// ---------- one trip state (spec 2.1) ----------
// A time with where it came from and how old it is.
function stopTime(leg, L, i, age, isDep) {
  const planned = leg.stops[i].tt;
  if (L && !L.unmatched && age < RULES.LIVE_CAP) {
    if (L.est[i] != null) return { at: L.est[i], planned, source: 'stop' };
    if (isDep && i === 0 && L.board != null) return { at: L.board, planned, source: 'board' };
    if (L.runDelay != null) return { at: planned + L.runDelay, planned, source: 'run' };
  }
  return { at: planned, planned, source: 'timetable' };
}

export const PHASES = ['waiting', 'due', 'left', 'onTheWay', 'nextStop', 'getOff', 'arrived', 'ended'];
const P_ = Object.fromEntries(PHASES.map((p, i) => [p, i]));
export { P_ as PHASE_INDEX };

export function newMemory(P) {
  return {
    legs: P.legs.map(() => ({ phase: 0, phaseAt: { waiting: null }, phaseWhy: {}, arrivedAt: null, arrivedTime: null, rung: {}, platformAlerted: null, delayAlerted: null, cancelAlerted: false, replaced: null })),
    current: 0,
  };
}

// The leg index the trip is on for visible leg li: its replacement after a cancellation or a missed change.
export const eff = (M, li) => (M.legs[li].replaced != null ? M.legs[li].replaced : li);

// Live evidence from one reading (spec 2.2). Never uses a timetable time.
export function evidence(P, M, snap, li, t) {
  const leg = P.legs[eff(M, li)];
  const L = snap.legs[eff(M, li)];
  const age = t - snap.asOf;
  const fresh = age < RULES.LIVE_FRESH && L && !L.unmatched;
  const v = fresh && L.vehicle && t - L.vehicle.at < RULES.LIVE_FRESH ? L.vehicle : null;
  // A fresh vehicle position is the best evidence: when it has one, a stop's own live time never moves the trip past
  // where the vehicle is (25 Oct: a feed whose estimates were the timetable, the train 4 min behind them).
  const left = (i) => {
    if (v && (v.stop > i || (v.stop === i && v.state === 'left'))) return 'vehicle';
    if (v) return null;
    if (fresh && L.est[i] != null && t >= L.est[i] + RULES.LEFT_BY) return 'stop live';
    return null;
  };
  const off = leg.off;
  const at = (i) => {
    if (v && v.stop === i && v.state === 'at') return 'vehicle';
    if (v && (v.stop > i || (v.stop === i && v.state === 'left'))) return 'vehicle';
    if (v) return null;
    if (fresh && L.est[i] != null && t >= L.est[i]) return 'stop live';
    return null;
  };
  const passed = v && (v.stop > off || (v.stop === off && v.state === 'left')) ? 'vehicle' : null;
  // the next stop the train has not yet left (for "Next: Burwood")
  let next = 1;
  while (next < off && left(next)) next++;
  return { age, fresh, L, leg, leftBoard: left(0), leftBefore: off - 1 > 0 ? left(off - 1) : null, // a non-stop leg uses the 2 min rule only
    arrived: at(off), passed, next };
}

// Times for a leg from a reading (best evidence order, R2 cap).
export function legTimes(P, M, snap, li, t) {
  const leg = P.legs[eff(M, li)];
  const L = snap.legs[eff(M, li)];
  const age = t - snap.asOf;
  const dep = stopTime(leg, L, 0, age, true);
  const arr = stopTime(leg, L, leg.off, age, false);
  const before = leg.off > 1 ? stopTime(leg, L, leg.off - 1, age, false) : null;
  const platform = L && L.platform && age < RULES.LIVE_CAP ? L.platform : leg.platform;
  return { dep, arr, before, platform, platformChanged: platform && leg.platform && platform !== leg.platform, age, asOf: snap.asOf, timetableOnly: !L || L.unmatched };
}

export function staleStep(age, timetableOnly) {
  if (timetableOnly) return 'timetable-only';
  if (age < RULES.LIVE_FRESH) return 'live';
  if (age < RULES.LIVE_CAP) return 'about';
  if (age < RULES.NO_DATA) return 'timetable';
  return 'no-data';
}

// ---------- words for every surface (spec 2.1 render model) ----------
export const BUDGET = {
  // one-line budgets in characters (a stand-in for the native audit's real measure; see docs/JOURNEY_SIM.md)
  status: { normal: 38, largest: 26 },
  warn: { normal: 30, largest: 24 },
  arrive: { normal: 32, largest: 26 },
  islandTrailing: { normal: 7, largest: 7 },
  islandMinimal: { normal: 5, largest: 5 },
  widget: { normal: 44, largest: 34 },
  watch: { normal: 24, largest: 18 },
};
function fit(variants, kind, size) {
  const max = BUDGET[kind][size];
  const list = (Array.isArray(variants) ? variants : [variants]).filter((v) => v != null && v !== '');
  if (!list.length) return { text: '', truncated: false };
  for (const v of list) if (v.length <= max) return { text: v, truncated: false };
  const last = list[list.length - 1];
  return { text: last.slice(0, max - 3) + '...', truncated: true };
}

const placeWord = (leg) => (leg.mode === 'bus' ? null : 'Platform');
function where(leg, platform, short) {
  if (leg.mode === 'bus') return leg.stand || 'Stand';
  if (!platform) return null;
  return short ? `Plat ${platform}` : `Platform ${platform}`;
}
function delayText(d) {
  if (d === 0) return 'On time';
  return d > 0 ? `${d} min late` : `${-d} min early`;
}
const delayMin = (x) => Math.round((x.at - x.planned) / 60);
const isLive = (x) => x.source !== 'timetable';

// Builds the render model every surface draws, from one trip state.
// P: prepared case; M: trip memory (phases, moments); snap: the reading behind this surface;
// t: now; opts: { c24, size, forecast } (forecast: the widget's own timeline entries).
export function renderModel(P, M, snap, t, opts = {}) {
  const c24 = !!opts.c24, size = opts.size || 'normal';
  const C = (x) => clock(x, c24);
  const li = M.current;
  const m = M.legs[li];
  if (m.phase >= P_.ended && li === lastLeg(P)) return { ended: true, phase: 'ended' };
  const ei = eff(M, li);
  const leg = P.legs[ei], base = P.legs[li];
  const tm = legTimes(P, M, snap, li, t);
  const step = staleStep(tm.age, tm.timetableOnly);
  let phase = PHASES[m.phase];
  // Waiting and Due are not stored: Due is "the live departure time has come and the train has not
  // left", so a train that is suddenly later goes back to counting down to its new time.
  if (m.phase <= P_.due) phase = tm.age < RULES.LIVE_FRESH && isLive(tm.dep) && t >= tm.dep.at ? 'due' : 'waiting';
  if (opts.forecastPhase != null && opts.forecastPhase > m.phase) phase = PHASES[opts.forecastPhase];
  const off = leg.stops[leg.off].name, board = leg.stops[0].name;
  const lineTitle = `${leg.line} ${board} to ${off}`;
  const p = tm.platform;
  const isChange = li > 0 && M.legs[li - 1].phase >= P_.arrived && m.phase < P_.left;
  const nextLeg = li < lastLeg(P) ? P.legs[eff(M, li + 1)] : null;
  const asOfT = C(tm.asOf);
  const d = isLive(tm.dep) ? delayMin(tm.dep) : null;
  const dArr = isLive(tm.arr) ? delayMin(tm.arr) : null;
  const L = snap.legs[li];
  const cancelledNoAlt = L && L.cancelled && m.replaced == null && step !== 'timetable' && step !== 'no-data';
  const replacedWhy = m.replaced != null ? (M.legs[li].replacedWhy || 'missed') : null;
  let status, warn = null, arrive = null, sub = null, timer = null, trailing, minimal, inApp, voiceOver;
  const prefix = isChange ? 'Change: ' : '';
  const W = (short) => where(leg, p, short);
  const was = tm.platformChanged ? leg.platform : null;
  const arrLabel = (x) => (x.source === 'timetable' ? `${C(x.at)} (timetable)` : C(x.at));
  if (cancelledNoAlt) {
    status = ['Cancelled', 'Cancelled'];
    warn = 'No next service found yet';
    trailing = 'Cancel'; minimal = 'X';
    inApp = `Your ${C(base.stops[0].tt)} ${base.line} is cancelled. Looking for the next one on this line.`;
  } else if (phase === 'waiting' || phase === 'due') {
    const depT = C(tm.dep.at);
    const wl = W(false), ws = W(true);
    const wasL = was ? `, was ${was}` : '', wasS = was ? ` (was ${was})` : '';
    const due = phase === 'due' || (step === 'about' && t >= tm.dep.at);
    if (step === 'live' && !due) {
      status = [`${prefix}Leaves ${depT} · ${wl}${wasL}`, `${prefix}Leaves ${depT} · ${ws}${wasL}`, `${depT} · ${ws}${wasS}`, `${depT} · ${ws}`];
      warn = d != null ? delayText(d) : 'Timetable time';
      timer = tm.dep.at > t ? tm.dep.at : null;
      trailing = `${mins(tm.dep.at - t)} min`; minimal = `${mins(tm.dep.at - t)}m`;
      inApp = `${prefix}Leaves in ${mins(tm.dep.at - t)} min, ${depT} · ${ws}${wasS}${warn ? ' · ' + warn : ''}`;
      voiceOver = `${leg.line} to ${off}, leaves ${depT} in ${mins(tm.dep.at - t)} minutes, ${wl}${d ? `, ${Math.abs(d)} minutes ${d > 0 ? 'late' : 'early'}` : ''}`;
    } else if (step === 'live' || (due && step === 'about')) {
      const about = step === 'about' ? 'about ' : '';
      status = [`${prefix}Due ${about ? 'about ' + depT : 'now'} · ${wl}${wasL}`, `${prefix}Due ${about ? 'about ' + depT : 'now'} · ${ws}${wasS}`, `Due · ${ws}`];
      warn = d != null ? (about ? `${delayText(d)} at ${asOfT}` : delayText(d)) : null;
      if (about) sub = `Updated ${asOfT}`;
      trailing = 'Due'; minimal = 'Due';
      inApp = `${prefix}Due ${about ? 'about ' + depT : 'now'} · ${ws}${warn ? ' · ' + warn : ''}`;
      voiceOver = `${leg.line} to ${off}, due now, ${wl}`;
    } else if (step === 'about') {
      status = [`${prefix}Leaves about ${depT} · ${wl}${wasL}`, `${prefix}Leaves about ${depT} · ${ws}${wasS}`, `About ${depT} · ${ws}`];
      warn = d != null ? `${delayText(d)} at ${asOfT}` : null;
      sub = `Updated ${asOfT}`;
      trailing = C(tm.dep.at).replace(/[ap]m$/, ''); minimal = trailing.length <= 5 ? trailing : 'Soon';
      inApp = `${prefix}Leaves about ${depT} · ${ws} · Updated ${asOfT}`;
    } else if (step === 'timetable' || step === 'timetable-only') {
      const tt = C(leg.stops[0].tt);
      status = [`${prefix}Timetable ${tt} · ${wl}`, `${prefix}Timetable ${tt} · ${ws}`, `TT ${tt} · ${ws}`];
      sub = step === 'timetable' ? `No live data since ${asOfT}` : 'No live data for this service';
      trailing = tt.replace(/[ap]m$/, ''); minimal = trailing.length <= 5 ? trailing : 'TT';
      inApp = `${prefix}Timetable ${tt} · ${ws} · ${sub}`;
    } else {
      status = ['No live data. Open the app to refresh.', 'No live data. Open the app.', 'No live data'];
      sub = `Timetable ${C(leg.stops[0].tt)}`;
      trailing = '--'; minimal = '--';
      inApp = `No live data. Open the app to refresh. Timetable ${C(leg.stops[0].tt)}`;
    }
    if (replacedWhy === 'cancelled') warn = `${C(base.stops[0].tt)} cancelled`;
    if (replacedWhy === 'missed') warn = `Next ${leg.line}, ${C(base.stops[0].tt)} missed`;
    if (cancelledNoAlt === false && replacedWhy === 'cancelled' && step === 'live') inApp = `Cancelled. Next ${leg.line} ${depT}, ${ws}`;
    arrive = step === 'live' ? `Arrive ${off} ${arrLabel(tm.arr)}` : step === 'about' ? `${off} about ${C(tm.arr.at)}` : `${off} ${C(leg.stops[leg.off].tt)} (timetable)`;
  } else if (phase === 'left' || phase === 'onTheWay' || phase === 'nextStop' || phase === 'getOff') {
    const e = evidence(P, M, snap, li, t);
    let nextIdx = e.next;
    if (opts.forecast) {
      // the widget's timeline: the next stop by the live times it loaded (never the timetable)
      nextIdx = 1;
      while (nextIdx < leg.off) { const st = stopTime(leg, snap.legs[ei], nextIdx, tm.age, false); if (isLive(st) && t >= st.at + RULES.LEFT_BY) nextIdx++; else break; }
      nextIdx = Math.max(nextIdx, e.next);
    }
    const nextName = leg.stops[Math.min(nextIdx, leg.off)].name;
    const arrT = C(tm.arr.at);
    if (phase === 'getOff') {
      status = [`Get off now · ${off}`, `Get off · ${off}`, 'Get off now'];
      trailing = 'Off now'; minimal = 'Off';
      arrive = step === 'live' || step === 'about' ? `Arriving ${arrT}` : null;
      inApp = `Get off now · ${off}${nextLeg ? `, change for the ${nextLeg.line}` : ''}`;
      voiceOver = `Get off now, ${off}`;
    } else if (phase === 'nextStop') {
      status = [`${off} next`, `${off} next`];
      trailing = step === 'live' && tm.arr.at > t ? `${mins(tm.arr.at - t)} min` : 'Next';
      minimal = trailing === 'Next' ? 'Next' : `${mins(tm.arr.at - t)}m`;
      inApp = `${off} next · arriving ${step === 'live' ? '' : 'about '}${arrT}`;
      voiceOver = `${off} is next, arriving ${arrT}`;
    } else {
      status = [`Next: ${nextName}`, `Next: ${nextName}`, nextName];
      trailing = step === 'live' && tm.arr.at > t ? `${mins(tm.arr.at - t)} min` : C(tm.arr.at).replace(/[ap]m$/, '');
      minimal = step === 'live' && tm.arr.at > t ? `${mins(tm.arr.at - t)}m` : '--';
      inApp = `Next: ${nextName} · ${off} ${step === 'live' ? '' : 'about '}${arrT}`;
      voiceOver = `Next stop ${nextName}, arriving ${off} ${arrT}`;
    }
    if (phase !== 'getOff') {
      if (step === 'live') { arrive = `${off} ${arrLabel(tm.arr)}`; timer = tm.arr.at > t && isLive(tm.arr) ? tm.arr.at : null; warn = dArr != null && dArr !== 0 ? delayText(dArr) : dArr === 0 ? 'On time' : null; }
      else if (step === 'about') { arrive = `${off} about ${arrT}`; sub = `Updated ${asOfT}`; }
      else if (step === 'timetable') { arrive = `${off} ${C(leg.stops[leg.off].tt)} (timetable)`; sub = `No live data since ${asOfT}`; }
      else { arrive = `${off} ${C(leg.stops[leg.off].tt)} (timetable)`; sub = 'No live data. Open the app to refresh.'; }
    } else if (step !== 'live') sub = `Updated ${asOfT}`;
    if (nextLeg && phase !== 'getOff') {
      const ntm = legTimes(P, M, snap, li + 1, t);
      warn = `Then ${nextLeg.line} ${C(ntm.dep.at)}${nextLeg.platform ? ` · Plat ${ntm.platform}` : ''}`;
    }
  } else if (phase === 'arrived') {
    const at = C(m.arrivedTime ?? tm.arr.at);
    status = [`Arrived ${off} ${at}`, `Arrived ${off}`, 'Arrived'];
    trailing = 'Here'; minimal = 'Here';
    inApp = `You've arrived at ${off}. ${at}`;
    voiceOver = `Arrived at ${off}, ${at}`;
  }
  const S = fit(status, 'status', size);
  const Wn = fit(warn, 'warn', size);
  const A = fit(arrive, 'arrive', size);
  const T = fit(trailing || '', 'islandTrailing', size);
  const Mi = fit(minimal || '', 'islandMinimal', size);
  const forecastAbout = opts.forecast && (t - tm.asOf >= RULES.LIVE_FRESH);
  const aboutTag = forecastAbout && !/about|Timetable|No live data/i.test(S.text) ? ' (about)' : '';
  const second = forecastAbout ? `Updated ${mins(t - tm.asOf)} min ago` : (Wn.text || A.text || sub || '');
  const WG = fit([`${leg.line} · ${S.text}${aboutTag}${second ? ' · ' + second : ''}`, `${S.text}${aboutTag}${second ? ' · ' + second : ''}`, `${S.text}${aboutTag}`], 'widget', size);
  const WA = fit([`${S.text}`], 'watch', size);
  return {
    phase, step, li, leg: leg.line, title: lineTitle,
    status: S.text, warn: Wn.text || null, arrive: A.text || null, sub, timer,
    staleDate: tm.age < RULES.LIVE_FRESH ? Math.min(tm.asOf + RULES.LIVE_FRESH, ...(phase === 'waiting' && isLive(tm.dep) ? [Math.max(tm.dep.at, tm.asOf + 1)] : [])) : null,
    island: { leading: leg.line, trailing: timer ? T.text : (T.text || ''), minimal: Mi.text, timer },
    widget: WG.text, watch: WA.text + (timer ? ` · ${mins(timer - t)} min` : ''),
    inApp, voiceOver: voiceOver || [S.text, Wn.text, A.text, sub].filter(Boolean).join(', '),
    truncated: [S, Wn, A, T, Mi].filter((x) => x.truncated).length, widgetTruncated: WG.truncated,
    delayShown: (step === 'live' || step === 'about') && d != null && (phase === 'waiting' || phase === 'due') ? d : null,
    depAt: tm.dep.at, depPlanned: tm.dep.planned, depSource: tm.dep.source, arrAt: tm.arr.at, arrSource: tm.arr.source, asOf: tm.asOf,
  };
}
const lastLeg = (P) => P.legs.filter((l) => !l.alt).length - 1;
export { lastLeg };

// The surface lines that must never appear in a started trip before evidence (I2, I10).
export const BANNED = ['0:00', 'Trip started', 'Checking for the next one', 'Next one', 'Wake up'];

// Signature of what a surface shows, minus the ticking countdown (for push / reload decisions).
export const sig = (r) => (r.ended ? 'ended' : [r.phase, r.status, r.warn, r.arrive, r.sub, r.timer, r.island.minimal.replace(/^\d+m$/, 'Nm'), r.step].join('|'));

// ---------- the simulation ----------
const clone = (x) => JSON.parse(JSON.stringify(x));
const newest = (...snaps) => snaps.filter(Boolean).sort((a, b) => b.asOf - a.asOf)[0] || null;

// The widget's own timeline entries (spec 2.5): phases at their live times from the reading it last
// loaded. Never from a timetable time. Shown with "about" once that reading is over 2 min old.
export function forecastPhase(P, Mw, snap, t, reloadT = -Infinity) {
  const li = Mw.current;
  const tm = legTimes(P, Mw, snap, li, t);
  let f = Mw.legs[li].phase;
  if (f >= P_.arrived) return t >= (Mw.legs[li].arrivedAt ?? Infinity) + RULES.ENDED_AFTER ? P_.ended : f;
  const live = (x) => x && isLive(x);
  const up = (p) => { if (p > f) f = p; };
  // only COMING phases: an entry whose time had already passed when the widget loaded is not
  // forecast (the trip state then said it had not happened yet, so the widget holds it)
  const due = (x, at) => live(x) && at > reloadT && t >= at;
  if (live(tm.dep) && t >= tm.dep.at) up(P_.due);
  if (due(tm.dep, tm.dep.at + RULES.LEFT_BY)) up(P_.onTheWay);
  if (f >= P_.onTheWay && tm.before && due(tm.before, tm.before.at + RULES.LEFT_BY)) up(P_.nextStop);
  if (f >= P_.onTheWay && due(tm.arr, tm.arr.at - RULES.HEADSUP_WINDOW)) up(P_.nextStop);
  // never forecast "Get off now" or "Arrived": those are shown when they happen (the alert that
  // carries them refreshes the widget), so a held train can never make the widget say them early
  if (f >= P_.arrived && t >= (Mw.legs[li].arrivedAt ?? Infinity) + RULES.ENDED_AFTER && li === lastLeg(P)) up(P_.ended);
  return f;
}

// One step of the trip on reading S (the reference engine). env: { c24, lead (s the server sends early), reread(),
// deliver(ring, age, byVehicle), log(t, what) }. M is updated in place.
export function refStepTrip(P, M, t, S, env) {
  const ph = { c24: !!env.c24 };
  const deliver = (_t, ring, age, byVehicle) => env.deliver(ring, age, byVehicle);
  const rereadFor = () => (env.reread ? env.reread() : null);
  const setPhase = (li, name, tt, why) => {
    const m = M.legs[li];
    if (P_[name] > m.phase) {
      for (let k = m.phase + 1; k <= P_[name]; k++) if (m.phaseAt[PHASES[k]] == null) { m.phaseAt[PHASES[k]] = tt; m.phaseWhy[PHASES[k]] = k === P_[name] ? why : `with ${name}`; }
      m.phase = P_[name];
      env.log(tt, `leg ${li + 1}: ${name} (${why})`);
    }
  };
  const li = M.current;
  const m = M.legs[li];
  if (m.phase >= P_.ended) return;
  const leg0 = P.legs[li];
  const isLast = li === lastLeg(P);
  // trip end
  if (m.phase >= P_.arrived) {
    if (isLast && t >= m.arrivedAt + RULES.ENDED_AFTER) setPhase(li, 'ended', t, '2 min after Arrived');
    return;
  }
  const L = S.legs[li];
  const age = t - S.asOf;
  const fresh = age < RULES.LIVE_FRESH;
  // cancellation (live only)
  if (fresh && L && L.cancelled && !m.cancelAlerted && m.phase < P_.left) {
    m.cancelAlerted = true;
    const alt = L.next != null ? P.legs.findIndex((x) => x.id === L.next) : -1;
    const C = (x) => clock(x, ph.c24);
    let body = 'No next service found yet.', say = `Your ${C(leg0.stops[0].tt)} ${leg0.line} is cancelled.`;
    if (alt >= 0) {
      m.replaced = alt; M.legs[li].replacedWhy = 'cancelled';
      const at = legTimes(P, M, S, li, t);
      body = `Next ${P.legs[alt].line} ${C(at.dep.at)}, Platform ${at.platform}.`;
      say += ` The next ${P.legs[alt].line} leaves at ${C(at.dep.at)}, from Platform ${at.platform}.`;
    }
    deliver(t, { kind: 'cancelled', title: `${C(leg0.stops[0].tt)} ${leg0.line} cancelled`, body, level: 'normal', say, moment: `cancel:${li}` }, age, false);
  }
  const e = evidence(P, M, S, li, t);
  const tm = legTimes(P, M, S, li, t);
  const leg = P.legs[eff(M, li)];
  const C = (x) => clock(x, ph.c24);
  const offName = leg.stops[leg.off].name;
  const nextVis = isLast ? null : P.legs[eff(M, li + 1)];
  // missed change: live times say the change will be missed -> count to the next found service
  if (!isLast && fresh && M.legs[li + 1].replaced == null) {
    const ntm = legTimes(P, M, S, li + 1, t);
    if (isLive(tm.arr) && isLive(ntm.dep) && tm.arr.at + RULES.CHANGE_MIN > ntm.dep.at) {
      const alt = P.legs.findIndex((x) => x.alt && x.forLeg === li + 1);
      if (alt >= 0) {
        const missed = P.legs[li + 1];
        M.legs[li + 1].replaced = alt; M.legs[li + 1].replacedWhy = 'missed';
        const a2 = legTimes(P, M, S, li + 1, t);
        const dl = isLive(tm.dep) && m.phase < P_.left ? delayMin(tm.dep) : 0;
        const lateWords = Math.abs(dl) >= RULES.DELAY_ALERT ? `Your ${leg.line} is running ${dl} min late. ` : '';
        if (lateWords) m.delayAlerted = dl; // one alert carries both
        deliver(t, { kind: 'missed', title: `You'll miss the ${C(missed.stops[0].tt)} ${missed.line}`, body: `${lateWords}Next ${P.legs[alt].line} ${C(a2.dep.at)}, Platform ${a2.platform}.`, level: 'normal', say: `You'll miss the ${C(missed.stops[0].tt)} ${missed.line}. The next one leaves at ${C(a2.dep.at)}, from Platform ${a2.platform}.`, moment: `missed:${li + 1}` }, age, false);
      }
    }
  }
  // before the train leaves: delay and platform alerts, one per change (spec 2.3)
  if (m.phase < P_.left && fresh && !(L && L.cancelled && m.replaced == null)) {
    if (isLive(tm.dep)) {
      const d = delayMin(tm.dep);
      const prev = m.delayAlerted;
      if ((prev == null && Math.abs(d) >= RULES.DELAY_ALERT) || (prev != null && Math.abs(d - prev) >= RULES.DELAY_ALERT)) {
        m.delayAlerted = d;
        const words = d === 0 ? 'back on time' : d > 0 ? `running ${d} min late` : `running ${-d} min early`;
        deliver(t, { kind: 'delay', title: `${leg.line} ${words}`, body: `Now leaves ${C(tm.dep.at)}${leg.mode === 'bus' ? ` from ${leg.stand || 'the stand'}` : ` from Platform ${tm.platform}`}.`, level: 'normal', say: `Your ${leg.line} is ${words.replace('min', 'minutes')}. It now leaves at ${C(tm.dep.at)}${leg.mode === 'bus' ? '' : `, from Platform ${tm.platform}`}.`, moment: `delay:${li}:${d}` }, age, false);
      }
    }
    if (tm.platformChanged && m.platformAlerted !== tm.platform) {
      m.platformAlerted = tm.platform;
      deliver(t, { kind: 'platform', title: `Platform change: now Platform ${tm.platform}`, body: `${leg.line} ${C(tm.dep.at)} now leaves from Platform ${tm.platform} (was ${leg.platform}).`, level: 'normal', say: `Platform change. Your ${leg.line} now leaves from Platform ${tm.platform}.`, moment: `platform:${li}:${tm.platform}` }, age, false);
    }
  }
  // phases from the live train (spec 2.2)
  if (m.phase < P_.due && e.fresh && isLive(tm.dep) && t >= tm.dep.at) setPhase(li, 'due', t, `live departure ${clockSec(tm.dep.at)} (${tm.dep.source}) came, reading ${age}s old`);
  if (m.phase < P_.onTheWay && e.leftBoard) setPhase(li, 'onTheWay', t, `left ${leg.stops[0].name}: ${e.leftBoard}`);
  if (m.phase < P_.onTheWay) return;
  const moment = (k) => m.rung[k];
  const changeWords = nextVis ? { head: `${offName} is next. Change there for the ${nextVis.line}.`, off: `Get off now. ${offName}, change for the ${nextVis.line}.` } : null;
  // 1) already past the stop before anything rang: quiet note, trip ends
  if (e.passed && !moment('getoff') && !moment('arrived')) {
    m.rung.passed = t; m.rung.headsup = m.rung.headsup || 'skipped'; m.rung.getoff = 'skipped'; m.rung.arrived = 'skipped';
    deliver(t, { kind: 'passed', quiet: true, title: `Your ${leg.mode === 'bus' ? 'bus' : 'train'} passed ${offName}`, body: `Your ${leg.mode === 'bus' ? 'bus' : 'train'} passed ${offName} at ${C(tm.arr.at)}.`, level: 'passive', moment: `passed:${li}` }, age, false);
    m.arrivedAt = t; m.arrivedTime = tm.arr.at;
    setPhase(li, 'arrived', t, `passed ${offName}: ${e.passed}`);
    if (isLast) setPhase(li, 'ended', t, 'passed the stop: trip ends');
    return;
  }
  // 2) at the stop
  if (e.arrived) {
    const arrivedTime = e.arrived === 'vehicle' ? Math.min(t, isLive(tm.arr) ? Math.max(tm.arr.at, t - RULES.LIVE_FRESH) : t) : tm.arr.at;
    m.arrivedAt = t; m.arrivedTime = arrivedTime;
    if (!moment('getoff')) {
      m.rung.getoff = t; m.rung.arrived = 'with getoff'; if (!moment('headsup')) m.rung.headsup = 'skipped';
      deliver(t, { kind: 'atstop', title: `${offName} now`, body: `${offName} now. Get off here.`, level: 'time sensitive', clip: 'getoff', say: `${offName} now. Get off here.`, moment: `getoff:${li}`, expires: t + RULES.GETOFF_EXPIRE }, age, e.arrived === 'vehicle');
    } else {
      m.rung.arrived = t;
      const say = nextVis ? `You're at ${offName}. Change to the ${nextVis.line}.` : `You've arrived at ${offName}.`;
      const nt = nextVis ? legTimes(P, M, S, li + 1, t) : null;
      deliver(t, { kind: 'arrived', title: nextVis ? `At ${offName}: change here` : `Arrived at ${offName}`, body: nextVis ? `Change to the ${nextVis.line}, Platform ${nt.platform}, leaves ${C(nt.dep.at)}.` : `You've arrived at ${offName}. ${C(arrivedTime)}.`, level: 'normal', clip: nextVis ? null : 'arrived', say, moment: `arrived:${li}`, expires: t + RULES.ENDED_AFTER }, age, e.arrived === 'vehicle');
    }
    setPhase(li, 'arrived', t, `at ${offName}: ${e.arrived}`);
    if (!isLast) { M.current = li + 1; env.log(t, `now on leg ${li + 2}`); }
    return;
  }
  // 3) Get off now at the live arrival minus 30 s
  const lead = env.lead ?? 0;
  const prevArr = m.lastArrAt; m.lastArrAt = isLive(tm.arr) ? tm.arr.at : prevArr;
  if (!moment('getoff') && !moment('getoffQuiet') && isLive(tm.arr) && t >= tm.arr.at - RULES.GETOFF_LEAD - lead) {
    // read once more at the fire moment, so a jump in the last seconds moves the timer
    const S2 = rereadFor(t) || S;
    const tm2 = legTimes(P, M, S2, li, t);
    const age2 = t - S2.asOf;
    const e2 = evidence(P, M, S2, li, t);
    if (e2.arrived || e2.passed) return; // handled next second as at-the-stop / passed
    if (isLive(tm2.arr) && t >= tm2.arr.at - RULES.GETOFF_LEAD - lead) {
      if (age2 < RULES.LIVE_FRESH) {
        m.rung.getoff = t; if (!moment('headsup')) m.rung.headsup = 'skipped';
        deliver(t, { kind: 'getoff', title: 'Get off now', body: changeWords ? changeWords.off : `Get off now. ${offName}, arriving ${C(tm2.arr.at)}.`, level: 'time sensitive', clip: 'getoff', say: changeWords ? changeWords.off : `Get off now for ${offName}.`, moment: `getoff:${li}`, expires: tm2.arr.at + RULES.GETOFF_EXPIRE, target: tm2.arr.at - RULES.GETOFF_LEAD, arrAt: tm2.arr.at, arrSource: tm2.arr.source, jumped: prevArr != null && prevArr - RULES.GETOFF_LEAD - lead > t - 1 && tm2.arr.at < prevArr }, age2, false);
        setPhase(li, 'getOff', t, `live arrival ${clockSec(tm2.arr.at)} minus 30 s, reading ${age2}s old`);
      } else if (age2 < RULES.LIVE_CAP) {
        m.rung.getoffQuiet = t;
        deliver(t, { kind: 'quiet', quiet: true, title: `${offName} about ${C(tm2.arr.at)}`, body: `${offName} about ${C(tm2.arr.at)}. No live update since ${C(S2.asOf)}.`, level: 'passive', moment: `quiet:${li}` }, age2, false);
      }
      return;
    }
  }
  // 4) heads-up: the stop before is left, or the live arrival is 2 min away (never before leaving)
  const headsUpNow = e.leftBefore || (e.fresh && isLive(tm.arr) && tm.arr.at - t <= RULES.HEADSUP_WINDOW);
  if (!moment('headsup') && headsUpNow) {
    m.rung.headsup = t;
    deliver(t, { kind: 'headsup', title: `${offName} is next`, body: changeWords ? changeWords.head : `${offName} is next. Arriving about ${C(tm.arr.at)}. Get ready to get off.`, level: 'normal', clip: 'headsup', say: changeWords ? changeWords.head : `${offName} is next. Get ready to get off.`, moment: `headsup:${li}`, expires: tm.arr.at, arrSource: tm.arr.source }, age, false);
    setPhase(li, 'nextStop', t, e.leftBefore ? `left ${leg.stops[leg.off - 1]?.name || leg.stops[0].name}: ${e.leftBefore}` : `live arrival ${clockSec(tm.arr.at)} is 2 min away`);
  }
}

// In-app speech for one moment (spec 2.7 V1 to V5), the reference rule.
export function refVoiceGate(v, t, say, readingAge, byVehicle) {
  const no = (why) => ({ words: null, why, start: t, until: v.speakingUntil });
  if (!say) return no('no spoken cue for this alert');
  if (v.silent) return no('Silent switch on (ambient session)');
  if (t - v.openSince < RULES.VOICE_OPEN_FOR) return no('app open under 10 s (V1)');
  if (v.refreshes <= RULES.VOICE_SILENT_REFRESHES) return no('first two refreshes after opening (V4)');
  if (!byVehicle && readingAge >= RULES.VOICE_FRESH) return no('live reading over 60 s old (V2)');
  const start = Math.max(t, v.speakingUntil);
  if (start - t > RULES.VOICE_QUEUE_MAX) return no('waited over 30 s in the speech queue (V5)');
  return { words: say, why: null, start, until: start + Math.ceil(say.length / 14) };
}

// The engine a run is played on. The reference engine is this file; sim/realEngine.mjs gives the same shape from the
// app's real trip code (app/src/lib/tripState.ts) so the cases run on what ships.
export const referenceEngine = { name: 'reference', legTimes, evidence, renderModel, forecastPhase, sig, stepTrip: refStepTrip, voiceGate: refVoiceGate };

// engine: the trip code the run is played on: referenceEngine (this file) or the real app code (sim/realEngine.mjs).
export function simulate(caseDef, engine = referenceEngine) {
  const P = prepare(caseDef);
  const M = newMemory(P);
  const out = { id: P.id, P, M, frames: [], rings: [], voice: [], pushes: [], log: [] };
  const ph = { app: 'locked', silent: false, location: false, c24: false, size: 'normal' };
  let pi = 0, openSince = null, refreshes = 0, phoneSnap = null, lastPhonePoll = -1e9, serverSnap = null, lastServerPoll = -1e9;
  let phoneCard = null, serverCard = null, lastPush = { sig: null, t: -1e9 }, serverDone = false;
  let widget = { mem: null, snap: null, t: -1e9, cleared: false }, lastCardSig = null;
  let speakingUntil = -1;
  let backup = null; // the phone's own Get off now, only when the server cannot take it
  const log = (t, what) => out.log.push({ t, what });

  // ---- delivering one moment to the person (spec 2.6 who rings; 2.7 voice) ----
  function deliver(t, ring, readingAge, byVehicle) {
    const open = ph.app === 'open';
    const server = P.server.reachable;
    const r = { t, ...ring, app: ph.app, age: readingAge };
    const calmStep = ['headsup', 'getoff', 'atstop'].includes(ring.kind);
    if (ring.quiet) {
      r.via = open ? 'in-app note' : server ? 'server alert (passive, no sound)' : 'none (no route to the phone)';
      r.sound = null; r.haptic = 'none';
      if (!open && server && ring.kind === 'quiet') r.lands = t + RULES.SERVER_DELIVERY;
    } else if (open) {
      r.via = 'in-app banner';
      r.sound = null;
      r.haptic = calmStep ? 'one light tap' : 'none';
      r.serverCopy = server ? 'server alert shown in the app without sound' : null;
    } else if (server) {
      r.via = P.server.direct ? 'server alert' : 'Live Activity push carrying the alert';
      r.sound = ring.clip ? `Kylie ${CLIPS[ring.clip].file} clip` : 'default sound';
      if (ph.silent) r.sound = `${r.sound} muted by the Silent switch`;
      r.haptic = 'one buzz';
      r.lands = t + (ring.kind === 'getoff' ? RULES.SERVER_DELIVERY : 0);
    } else {
      r.via = 'none (no route to the phone)'; r.sound = null; r.haptic = 'none';
    }
    // voice
    let v = null;
    if (!ring.quiet && open && ring.say) {
      const g = engine.voiceGate({ open, silent: ph.silent, openSince, refreshes, speakingUntil }, t, ring.say, readingAge, byVehicle);
      if (g.words) { v = { t: g.start, kind: ring.kind, words: g.words, by: 'in-app voice' }; speakingUntil = g.until; }
      else v = { t, kind: ring.kind, words: null, why: g.why };
    } else if (!ring.quiet && !open && server && ring.clip) {
      v = ph.silent ? { t, kind: ring.kind, words: null, why: 'Silent switch on: clip muted' } : { t: r.lands ?? t, kind: ring.kind, words: CLIPS[ring.clip].words, by: `alert sound ${CLIPS[ring.clip].file}` };
    } else if (!ring.quiet) {
      v = { t, kind: ring.kind, words: null, why: open ? 'no spoken cue for this alert' : server ? 'locked: alert sound only, no words for this kind' : 'no route to the phone' };
    }
    if (v) { r.voice = v; out.voice.push(v); }
    out.rings.push(r);
    return r;
  }

  const rereadFor = (t) => {
    if (ph.app === 'open') { phoneSnap = snapshot(P, t); lastPhonePoll = t; refreshes++; return phoneSnap; }
    if (P.server.reachable) { serverSnap = snapshot(P, t); lastServerPoll = t; return serverSnap; }
    return null;
  };

  for (let t = P.start; t <= P.end; t++) {
    // phone state
    let justOpened = false, wentAway = false;
    while (pi < P.phone.length && P.phone[pi].at <= t) {
      const was = ph.app;
      const { at, ...rest } = P.phone[pi++];
      Object.assign(ph, rest);
      if (ph.app === 'open' && was !== 'open') { justOpened = true; openSince = t; refreshes = 0; log(t, 'app opened'); }
      if (ph.app !== 'open' && was === 'open') { wentAway = true; log(t, `app ${ph.app}`); }
    }
    if (t === P.start) log(t, 'trip started');
    // reads
    if (ph.app === 'open' && (justOpened || t - lastPhonePoll >= RULES.PHONE_POLL)) { phoneSnap = snapshot(P, t); lastPhonePoll = t; refreshes++; }
    if (P.server.reachable && !serverDone) {
      const ref = newest(serverSnap, phoneSnap);
      const near = ref && (() => { const tm = engine.legTimes(P, M, ref, M.current, t); return isLive(tm.arr) && tm.arr.at - t < RULES.NEAR && M.legs[M.current].phase >= P_.onTheWay; })();
      const every = near ? RULES.SERVER_POLL_NEAR : RULES.SERVER_POLL;
      if (serverSnap == null || (t % every === 0 && t > lastServerPoll)) { serverSnap = snapshot(P, t); lastServerPoll = t; }
    }
    // catch-up on open: alerts still true now and under 90 s old are shown silently, never spoken
    if (justOpened) {
      for (const r of out.rings) if (t - r.t < 90 && !r.quiet && r.app !== 'open') out.log.push({ t, what: `catch-up banner (silent, no voice): ${r.title}` });
    }
    // backup on the phone, only when the server cannot take Get off now
    if (wentAway && !P.server.reachable && phoneSnap && t - phoneSnap.asOf < RULES.PHONE_WRITE_MAX_AGE) {
      const tm = engine.legTimes(P, M, phoneSnap, M.current, t);
      if (isLive(tm.arr) && tm.arr.at - t < RULES.NEAR && !M.legs[M.current].rung.getoff) { backup = { at: tm.arr.at - RULES.GETOFF_LEAD, arrAt: tm.arr.at, li: M.current }; log(t, `backup Get off now set on the phone for ${clockSec(backup.at)}`); }
    }
    if (ph.app === 'open') backup = null;
    const S = newest(phoneSnap, P.server.reachable ? serverSnap : null);
    if (S) {
      const lead = ph.app === 'open' ? 0 : P.server.reachable ? RULES.SERVER_DELIVERY : 0;
      engine.stepTrip(P, M, t, S, { c24: ph.c24, lead, reread: () => rereadFor(t), deliver: (ring, age, byVehicle) => deliver(t, ring, age, byVehicle), log });
    }
    if (backup && t >= backup.at && !M.legs[backup.li].rung.getoff) {
      const leg = P.legs[eff(M, backup.li)];
      M.legs[backup.li].rung.getoff = t;
      const r = deliver(t, { kind: 'getoff', title: 'Get off now', body: `Get off now. ${leg.stops[leg.off].name}, arriving ${clock(backup.arrAt, ph.c24)}.`, level: 'time sensitive', clip: 'getoff', moment: `getoff:${backup.li}`, expires: backup.arrAt + RULES.GETOFF_EXPIRE, target: backup.at, arrAt: backup.arrAt, backup: true }, 0, false);
      r.via = 'local backup alert on the phone'; r.sound = ph.silent ? 'Kylie getoff_now clip muted by the Silent switch' : 'Kylie getoff_now clip'; r.haptic = 'one buzz';
      if (r.voice && !ph.silent) { r.voice.words = CLIPS.getoff.words; r.voice.why = undefined; r.voice.by = 'alert sound getoff_now'; }
      backup = null;
    }
    // the Live Activity card: the open app writes it from readings under 20 s old; the server pushes it
    const opts = { c24: ph.c24, size: ph.size };
    if (ph.app === 'open' && phoneSnap && t - phoneSnap.asOf < RULES.PHONE_WRITE_MAX_AGE) phoneCard = phoneSnap;
    if (P.server.reachable && serverSnap && !serverDone) {
      const r = engine.renderModel(P, M, serverSnap, t, opts);
      const s = engine.sig(r);
      if (s !== lastPush.sig || t - lastPush.t >= RULES.PUSH_AT_LEAST) {
        const alertRing = out.rings.find((x) => x.t === t && x.via === 'Live Activity push carrying the alert');
        out.pushes.push({ t, kind: r.ended ? 'end' : 'update', status: r.status || null, warn: r.warn || null, arrive: r.arrive || null, sub: r.sub || null, timer: r.timer ?? null, staleDate: r.staleDate ?? null, phase: r.phase, step: r.step, alert: alertRing ? alertRing.title : null, asOf: serverSnap.asOf });
        lastPush = { sig: s, t };
        serverCard = serverSnap;
        if (r.ended) serverDone = true;
      }
    }
    const cardSnap = newest(phoneCard, serverCard);
    const card = cardSnap ? engine.renderModel(P, M, cardSnap, t, opts) : null;
    // I6: the phone's card equals the server's push when both rest on the same reading
    let serverView = null;
    if (P.server.reachable && serverSnap && phoneCard && phoneCard.asOf === serverSnap.asOf) serverView = engine.renderModel(P, M, serverSnap, t, opts);
    // the widget: reloaded by the open app on every change; while locked, every 5 min from the server
    const cs = card ? engine.sig(card) : null;
    // build 212: a server alert also refreshes the widget (the notification extension writes the trip
    // state and reloads the widget), so the widget is in step at every alert even while locked
    const alertNow = ph.app !== 'open' && P.server.reachable && out.rings.some((x) => x.t === t && x.via && x.via.startsWith('server') || (x.t === t && x.via === 'Live Activity push carrying the alert'));
    if ((ph.app === 'open' && cardSnap && (cs !== lastCardSig || justOpened || t - widget.t >= 60)) || (ph.app !== 'open' && P.server.reachable && serverSnap && (t - widget.t >= RULES.WIDGET_RELOAD || alertNow)) || (widget.snap == null && cardSnap)) {
      // build 212: the widget's own small read to the server, which answers from a fresh read of the trip
      widget = { mem: clone(M), snap: ph.app === 'open' ? cardSnap : (P.server.reachable ? snapshot(P, t) : cardSnap), t, reloads: (widget.reloads || 0) + 1 };
    }
    lastCardSig = cs;
    let wtext = null, wphase = null, wtrunc = false;
    if (widget.snap) {
      let f = engine.forecastPhase(P, widget.mem, widget.snap, t, widget.t);
      if (f >= P_.arrived && widget.mem.current < lastLeg(P)) {
        // the widget's timeline carries on to the next leg of the trip (a change of trains)
        const arrAt = engine.legTimes(P, widget.mem, widget.snap, widget.mem.current, t).arr.at;
        widget.mem.legs[widget.mem.current].phase = P_.arrived; widget.mem.legs[widget.mem.current].arrivedAt = arrAt;
        widget.mem.current += 1;
        f = engine.forecastPhase(P, widget.mem, widget.snap, t, widget.t);
      }
      if (f >= P_.ended && widget.mem.current === lastLeg(P)) { wtext = null; wphase = 'ended'; }
      else {
        const wr = engine.renderModel(P, widget.mem, widget.snap, t, { ...opts, forecastPhase: f, forecast: true });
        wtext = wr.ended ? null : wr.widget; wphase = wr.phase; wtrunc = !!wr.widgetTruncated;
      }
    }
    out.frames.push({
      t, app: ph.app, silent: ph.silent, openSince: ph.app === 'open' ? openSince : null, refreshes: ph.app === 'open' ? refreshes : null,
      phase: card ? card.phase : 'waiting',
      tripPhase: PHASES[M.legs[M.current].phase], leg: M.current, effLeg: eff(M, M.current),
      card, widget: wtext, widgetPhase: wphase, widgetTruncated: wtrunc, widgetReloadedAt: widget.t,
      watch: card && !card.ended ? card.watch : null,
      inApp: ph.app === 'open' && phoneSnap ? (engine.renderModel(P, M, phoneSnap, t, opts).inApp || 'Trip ended') : null,
      serverView,
      ages: { phone: phoneSnap ? t - phoneSnap.asOf : null, server: serverSnap ? t - serverSnap.asOf : null, card: cardSnap ? t - cardSnap.asOf : null },
    });
  }
  return out;
}

// ---------- invariants I1 to I10 (spec 4.1), plus the voice rules that can be checked offline ----------
// Independent of the engine: reads the raw feed to say whether live evidence existed at time t.
function rawSnapshotsBetween(P, a, b) {
  const times = new Set();
  for (let k = Math.ceil(a / P.feed.refresh) * P.feed.refresh; k <= b; k += P.feed.refresh) if (!inGap(P.feed.gaps, k)) times.add(k);
  for (const e of P.feed.events) if (e.at >= a && e.at <= b && !inGap(P.feed.gaps, e.at)) times.add(e.at);
  return [...times].map((p) => snapshot(P, p)).filter((s) => s.asOf >= a);
}
export function rawEvidence(P, t, li, kind, stopIndex) {
  const snaps = rawSnapshotsBetween(P, t - RULES.LIVE_FRESH + 1, t);
  for (const s of snaps) {
    const L = s.legs[li];
    if (!L || L.unmatched) continue;
    const v = L.vehicle && t - L.vehicle.at < RULES.LIVE_FRESH ? L.vehicle : null;
    const est = L.est[stopIndex];
    const planned = P.legs[li].stops[stopIndex].tt;
    const live = est != null ? est : (stopIndex === 0 && L.board != null ? L.board : (L.runDelay != null ? planned + L.runDelay : null));
    if (kind === 'due' && live != null && t >= live) return true;
    if (kind === 'left' && ((v && (v.stop > stopIndex || (v.stop === stopIndex && v.state === 'left'))) || (est != null && t >= est + RULES.LEFT_BY))) return true;
    if (kind === 'at' && ((v && v.stop >= stopIndex) || (est != null && t >= est))) return true;
    if (kind === 'near' && live != null && live - t <= RULES.HEADSUP_WINDOW + 1) return true;
    if (kind === 'getoff' && live != null && t >= live - RULES.GETOFF_LEAD - RULES.SERVER_DELIVERY - 1) return true;
  }
  return false;
}

const texts = (f) => {
  const c = f.card && !f.card.ended ? f.card : null;
  return [c?.status, c?.warn, c?.arrive, c?.sub, c?.island?.trailing, c?.island?.minimal, f.widget, f.watch, f.inApp].filter(Boolean);
};

export function checkInvariants(out) {
  const v = [];
  const P = out.P, M = out.M;
  const bad = (rule, t, msg) => v.push({ rule, t, at: clockSec(t), msg });
  for (const f of out.frames) {
    const c = f.card && !f.card.ended ? f.card : null;
    // I1: a shown delay equals the countdown target minus the timetable time (within 30 s)
    if (c && c.delayShown != null) {
      const target = c.timer ?? c.depAt;
      if (Math.abs(target - c.depPlanned - c.delayShown * 60) > 30) bad('I1', f.t, `delay ${c.delayShown} min but target ${clockSec(target)} vs timetable ${clockSec(c.depPlanned)}`);
    }
    // I2: no 0:00, no timer in the past, no banned words, no "left"/"departed" before evidence
    if (c && c.timer != null && c.timer <= f.t) bad('I2', f.t, `timer target ${clockSec(c.timer)} is not in the future`);
    for (const s of texts(f)) {
      for (const b of BANNED) if (s.includes(b)) bad(b === 'Checking for the next one' || b === 'Trip started' ? 'I10' : 'I2', f.t, `"${b}" shown: ${s}`);
      if (/\b(Departed|departed)\b/.test(s)) bad('I2', f.t, `"departed" shown: ${s}`);
    }
    // I7: every line fits one line
    if (c && c.truncated) bad('I7', f.t, `a line had to be cut: ${c.status} | ${c.warn} | ${c.arrive}`);
    if (f.widgetTruncated) bad('I7', f.t, `the widget row had to be cut: ${f.widget}`);
    // I6: phone card equals the server push from the same reading
    if (f.serverView && c && sig(f.serverView) !== sig(c)) bad('I6', f.t, `phone card "${c.status}" vs server "${f.serverView.status}"`);
    // I10: the widget keeps a row the whole trip and never says "Checking for the next one" / "Trip started"
    if (c && f.tripPhase !== 'ended' && f.tripPhase !== 'arrived' && !f.widget) bad('I10', f.t, 'widget row empty during a started trip');
    // R-E: the widget never claims a phase the live train has not reached (ahead of the card) unless
    // it says "about"; behind the card it may lag one reload, and then only with "about" after 2 min
    if (c && f.widget && f.widgetPhase && f.widgetPhase !== c.phase && !/about/.test(f.widget)) {
      const ahead = PHASES.indexOf(f.widgetPhase) > PHASES.indexOf(c.phase);
      const staleLag = f.t - f.widgetReloadedAt > RULES.LIVE_FRESH;
      if (ahead || staleLag) bad('I10', f.t, `widget "${f.widget}" (${f.widgetPhase}) vs card ${c.phase} with no "about"`);
    }
  }
  // I3: phases only from the live train (independent check against the raw feed)
  for (let li = 0; li < M.legs.length; li++) {
    const m = M.legs[li];
    const ei = m.replaced != null ? m.replaced : li;
    const leg = P.legs[ei];
    if (!leg || leg.alt && m.replaced == null) continue;
    const at = m.phaseAt;
    const chk = (name, kind, stop) => { if (at[name] != null && !String(m.phaseWhy[name]).startsWith('with') && !rawEvidence(P, at[name], ei, kind, stop)) bad('I3', at[name], `leg ${li + 1} ${name} with no live evidence (${m.phaseWhy[name]})`); };
    chk('due', 'due', 0);
    chk('onTheWay', 'left', 0);
    if (at.nextStop != null && !rawEvidence(P, at.nextStop, ei, 'left', Math.max(0, leg.off - 1)) && !rawEvidence(P, at.nextStop, ei, 'near', leg.off)) bad('I3', at.nextStop, `leg ${li + 1} next stop with no live evidence`);
    if (at.arrived != null && !rawEvidence(P, at.arrived, ei, 'at', leg.off)) bad('I3', at.arrived, `leg ${li + 1} arrived with no live evidence`);
    for (const k of Object.keys(m.phaseWhy)) if (/timetable/.test(m.phaseWhy[k])) bad('I3', at[k], `phase ${k} from a timetable time`);
  }
  const perLeg = {};
  for (const r of out.rings) {
    // I5: no next stop or get off from the timetable or from data over 5 min old (with sound: under 2 min)
    if (['headsup', 'getoff', 'atstop', 'arrived'].includes(r.kind) && !r.backup) {
      if (r.age >= RULES.LIVE_CAP) bad('I5', r.t, `${r.kind} from a reading ${r.age}s old`);
      if (r.arrSource === 'timetable') bad('I5', r.t, `${r.kind} from a timetable time`);
      if ((r.kind === 'getoff' || r.kind === 'headsup') && r.age >= RULES.LIVE_FRESH) bad('I5', r.t, `${r.kind} with sound from a reading ${r.age}s old`);
    }
    if (r.backup && r.age > RULES.PHONE_WRITE_MAX_AGE) bad('I5', r.t, 'backup set from an old reading');
    // I8: Get off now at the live arrival minus 30 s (within 5 s), or at once after a jump
    if (r.kind === 'getoff' && r.target != null) {
      const lands = r.lands ?? r.t;
      if (Math.abs(lands - r.target) > 5 && !(lands > r.target && r.jumped)) bad('I8', r.t, `Get off now lands ${clockSec(lands)}, should be ${clockSec(r.target)} (live arrival ${clockSec(r.arrAt)} minus 30 s)`);
    }
    // I9: each calm step at most once per stop, never "Wake up", one vibration at most
    const key = r.moment ? r.moment.split(':').slice(0, 2).join(':').replace('atstop', 'getoff') : r.kind;
    if (['headsup', 'getoff', 'arrived'].some((k) => key.startsWith(k))) {
      perLeg[key] = (perLeg[key] || 0) + 1;
      if (perLeg[key] > 1) bad('I9', r.t, `${key} rang ${perLeg[key]} times`);
    }
    if (/wake up/i.test(`${r.title} ${r.body}`)) bad('I9', r.t, '"Wake up" wording');
    if (r.haptic && !['none', 'one buzz', 'one light tap'].includes(r.haptic)) bad('I9', r.t, `haptic ${r.haptic}`);
    // the order of the calm sequence
  }
  for (let li = 0; li < M.legs.length; li++) {
    const g = M.legs[li].rung;
    if (typeof g.headsup === 'number' && typeof g.getoff === 'number' && g.headsup > g.getoff) bad('I9', g.getoff, 'Get off now before the heads-up');
    if (typeof g.getoff === 'number' && typeof g.arrived === 'number' && g.getoff > g.arrived) bad('I9', g.arrived, 'arrival before Get off now');
  }
  // I4 and the voice rules
  for (const s of out.voice) {
    if (!s.words) continue;
    const f = out.frames.find((x) => x.t === s.t) || out.frames[out.frames.length - 1];
    if (s.by === 'in-app voice') {
      if (f.app !== 'open') bad('V', s.t, 'in-app voice while the app is not open');
      else {
        if (s.t - f.openSince < RULES.VOICE_OPEN_FOR) bad('I4', s.t, `spoke ${s.t - f.openSince}s after opening: ${s.words}`);
        if (f.refreshes <= RULES.VOICE_SILENT_REFRESHES) bad('I4', s.t, `spoke on refresh ${f.refreshes} after opening: ${s.words}`);
      }
      if (f.silent) bad('V6', s.t, 'spoke with the Silent switch on');
    } else if (f.silent) bad('V8', s.t, 'alert clip played with the Silent switch on');
  }
  return v;
}

// Shift every timetable time by dt seconds while the live train stays exactly where it is
// (carried delays are adjusted). Used to prove no phase moves on the timetable clock (I3).
export function shiftTimetable(caseDef, dt) {
  const c = JSON.parse(JSON.stringify(caseDef));
  const sh = (s) => { const v = hms(s) + dt; return `${Math.floor(v / 3600)}:${String(Math.floor((v % 3600) / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
  for (const l of [...c.legs, ...(c.alts || [])]) for (const s of l.stops) s.tt = sh(s.tt);
  for (const e of c.feed?.events || []) if ('delay' in e && e.delay != null) e.delay = e.delay - dt / 60;
  return c;
}
// What a run did, as moments only (phases and rings), for comparing two runs.
export function momentsOf(out) {
  return {
    phases: out.M.legs.map((m) => Object.fromEntries(Object.entries(m.phaseAt).filter(([, v]) => v != null))),
    // delay alerts measure the live time against the timetable, so they are left out of this comparison
    rings: out.rings.filter((r) => !['delay'].includes(r.kind)).map((r) => `${r.t} ${r.kind} ${r.via}`),
  };
}
