// The journey simulator's engine on the REAL app code (phase 2 of docs/TRIP_FLOW_SPEC.md). Every feed snapshot the
// simulator makes is turned into the JSON the app really receives (the /api/service answer per leg, with its stop list,
// own and carried live times, vehicle position and platform; the planned trip legs as WatchLeg), and every decision is
// taken by app/src/lib/tripState.ts: times, phase, calm sequence, voice, render model for every surface.
// The test (app/test/journeysim-real.test.mjs) transpiles tripState.ts and passes the module in, so this file stays
// dependency free. Times: the simulator counts seconds since Sydney midnight; the app counts ms since 1970.

// Sydney midnight at the start of 31 Oct 2026 (AEDT, UTC+11)
export const BASE = Date.parse('2026-10-31T00:00:00+11:00');
const toMs = (s) => (s == null ? s : s === -Infinity || s === Infinity ? s : BASE + s * 1000);
const toS = (m) => (m == null ? m : m === -Infinity || m === Infinity ? m : (m - BASE) / 1000);
const iso = (s) => new Date(toMs(s)).toISOString();
const norm = (s) => String(s || '').toLowerCase().replace(/,?\s*(platform|plat|stand)\s*\w+$/, '').replace(/\s+station$/, '').replace(/[^a-z0-9]+/g, ' ').trim();

// a straight line of stops about 1.1 km apart (a vehicle half way between two stops is 550 m from both)
const LAT0 = -33.80, LON0 = 151.0, STEP = 0.01;
const stopXY = (k) => ({ lat: LAT0 - k * STEP, lon: LON0 });

export function makeRealEngine(ts) {
  const cache = new WeakMap();
  // The planned trip as the app holds it: WatchLeg per leg, the first service answer (timetable stop list), the plan.
  function setup(P) {
    let c = cache.get(P);
    if (c) return c;
    const station = (leg, name) => (leg.mode === 'bus' || /station/i.test(name) ? name : `${name} Station`);
    const watch = P.legs.map((leg, li) => ({
      mode: leg.mode, line: leg.line, tripId: leg.id ? `alt-${leg.id}` : `trip-${li}`, stopId: `s${li}-1`, toStopId: `s${li}-${leg.off + 1}`,
      from: station(leg, leg.stops[0].name), to: station(leg, leg.stops[leg.off].name),
      planned: iso(leg.stops[0].tt), arrPlanned: iso(leg.stops[leg.off].tt),
      fromPlatform: leg.mode === 'bus' ? (leg.stand || null) : leg.platform ? `Platform ${leg.platform}` : null, towards: 'City',
    }));
    // names the live answer uses, when a case says the feed names stops differently (S15a)
    const feedNames = P.legs.map((leg, li) => {
      const out = {};
      for (const e of P.feed.events) if ((e.leg ?? 0) === li && e.est) for (const k of Object.keys(e.est)) {
        const i = leg.stops.findIndex((s) => norm(s.name) === norm(k) || (s.alias && norm(s.alias) === norm(k)));
        if (i >= 0 && k !== leg.stops[i].name && k !== station(leg, leg.stops[i].name)) out[i] = k;
      }
      return out;
    });
    // the run's stops: one stop before where you board and one after where you get off, so indexes are exercised
    const runStops = (leg, li, names) => {
      const n = leg.stops.length;
      const list = [{ id: `s${li}-0`, name: 'Origin Station', ...stopXY(0), planned: iso(leg.stops[0].tt - 180) }];
      leg.stops.forEach((s, i) => list.push({ id: `s${li}-${i + 1}`, name: names[i] || station(leg, s.name), ...stopXY(i + 1), planned: iso(s.tt) }));
      list.push({ id: `s${li}-${n + 1}`, name: 'Terminus Station', ...stopXY(n + 1), planned: iso(leg.stops[n - 1].tt + 180) });
      return list;
    };
    const base = P.legs.map((leg, li) => ({ kind: 'service', tripId: watch[li].tripId, line: leg.line, mode: leg.mode, live: false, stops: runStops(leg, li, {}), mineIndex: 1, alightIndex: leg.off + 1 }));
    const vis = P.legs.filter((l) => !l.alt).length;
    const plan = ts.tripPlanFrom(watch.slice(0, vis), base.slice(0, vis), P.legs.slice(vis).map((l, k) => ({ leg: watch[vis + k], svc: base[vis + k], id: l.id, forLeg: l.forLeg })));
    c = { watch, base, plan, feedNames, runStops, readings: new WeakMap() };
    cache.set(P, c);
    return c;
  }

  // One feed snapshot as the app's real /api/service answers (one per leg).
  function answersFor(P, snap) {
    const c = setup(P);
    return P.legs.map((leg, li) => {
      const L = snap.legs[li];
      const other = !!(L && L.unmatched);
      // an answer for another run (shape (c) of spec section 0, not matched): other stop ids and names
      const stops = c.runStops(leg, li, other ? Object.fromEntries(leg.stops.map((s, i) => [i, `Elsewhere ${i} Station`])) : c.feedNames[li]).map((s) => (other ? { ...s, id: `x${s.id}` } : s));
      const d = { kind: 'service', tripId: c.watch[li].tripId, line: leg.line, mode: leg.mode, live: false, stops };
      const named = Object.keys(c.feedNames[li]).length > 0;
      if (!(L && L.unmatched) && !named) { d.mineIndex = 1; d.alightIndex = leg.off + 1; }
      if (!L) return d;
      const run = L.runDelay;
      stops.forEach((s, k) => {
        const i = k - 1;
        const tt = i < 0 ? leg.stops[0].tt - 180 : i >= leg.stops.length ? leg.stops[leg.stops.length - 1].tt + 180 : leg.stops[i].tt;
        if (i >= 0 && i < leg.stops.length && L.est[i] != null) { s.estimated = iso(L.est[i]); }
        else if (run != null) { s.estimated = iso(tt + run); s.carried = true; }
      });
      if (run != null || Object.values(L.est).some((x) => x != null)) { d.live = true; if (run != null) d.delayMin = Math.round(run / 60); }
      if (!L.unmatched) stops[1].platform = leg.mode === 'bus' ? undefined : (L.platform || leg.platform) ? `Platform ${L.platform || leg.platform}` : undefined;
      if (L.cancelled) d.cancelled = true;
      if (L.vehicle && L.vehicle.stop >= 0) {
        const k = L.vehicle.stop + 1;
        const a = stopXY(k), b = stopXY(k + 1);
        const p = L.vehicle.state === 'at' ? a : { lat: (a.lat + b.lat) / 2, lon: a.lon };
        d.vehicle = { ...p, ageS: Math.max(0, snap.asOf - L.vehicle.at) };
        d.progress = 'vehicle'; d.nextIndex = L.vehicle.state === 'at' ? k : k + 1;
      }
      return d;
    });
  }
  function readingOf(P, snap) {
    const c = setup(P);
    let r = c.readings.get(snap);
    if (!r) {
      const ans = answersFor(P, snap);
      const boards = P.legs.map((leg, li) => { const L = snap.legs[li]; return L && L.board != null ? { planned: iso(leg.stops[0].tt), estimated: iso(L.board), realtime: true, tripId: c.watch[li].tripId } : null; });
      r = ts.tripReadingFrom(c.plan, c.watch, ans, toMs(snap.asOf), { boards, next: snap.legs.map((L) => (L && L.next) || null) });
      c.readings.set(snap, r);
    }
    return r;
  }

  // memory: the simulator keeps seconds, the app ms
  const mapRung = (rung, f) => Object.fromEntries(Object.entries(rung).map(([k, v]) => [k, typeof v === 'number' ? f(v) : v]));
  const memMs = (M) => ({ current: M.current, legs: M.legs.map((l) => ({ ...l, phaseAt: Object.fromEntries(Object.entries(l.phaseAt).map(([k, v]) => [k, v == null ? v : toMs(v)])), phaseWhy: { ...l.phaseWhy },
    arrivedAt: toMs(l.arrivedAt), arrivedTime: toMs(l.arrivedTime), lastArrAt: toMs(l.lastArrAt), rung: mapRung(l.rung, toMs) })) });
  const memBack = (Mm, M) => {
    M.current = Mm.current;
    Mm.legs.forEach((l, i) => { M.legs[i] = { ...l, phaseAt: Object.fromEntries(Object.entries(l.phaseAt).map(([k, v]) => [k, v == null ? v : toS(v)])), arrivedAt: toS(l.arrivedAt), arrivedTime: toS(l.arrivedTime), lastArrAt: toS(l.lastArrAt), rung: mapRung(l.rung, toS) }; });
  };
  const timeS = (x) => (x ? { ...x, at: toS(x.at), planned: toS(x.planned), asOf: toS(x.asOf) } : x);
  const renderS = (r) => {
    if (r.ended) return r;
    return { ...r, timer: toS(r.timer), staleDate: toS(r.staleDate), island: { ...r.island, timer: toS(r.island.timer) }, depAt: toS(r.depAt), depPlanned: toS(r.depPlanned), arrAt: toS(r.arrAt), asOf: toS(r.asOf) };
  };
  return {
    name: 'real',
    readingOf, answersFor, setup,
    legTimes(P, M, snap, li, t) {
      const tm = ts.tripLegTimes(setup(P).plan, memMs(M), readingOf(P, snap), li, toMs(t));
      return { ...tm, dep: timeS(tm.dep), arr: timeS(tm.arr), before: timeS(tm.before), age: tm.age / 1000, asOf: toS(tm.asOf) };
    },
    evidence(P, M, snap, li, t) {
      const e = ts.tripEvidence(setup(P).plan, memMs(M), readingOf(P, snap), li, toMs(t));
      return { ...e, age: e.age / 1000 };
    },
    renderModel(P, M, snap, t, opts = {}) { return renderS(ts.tripRender(setup(P).plan, memMs(M), readingOf(P, snap), toMs(t), opts)); },
    forecastPhase(P, Mw, snap, t, reloadT = -Infinity) { return ts.forecastPhaseOf(setup(P).plan, memMs(Mw), readingOf(P, snap), toMs(t), toMs(reloadT)); },
    sig: (r) => ts.renderSig(r),
    stepTrip(P, M, t, S, env) {
      const Mm = memMs(M);
      const res = ts.tripStep(setup(P).plan, Mm, toMs(t), readingOf(P, S), { c24: env.c24, lead: (env.lead || 0) * 1000, reread: () => { const s2 = env.reread ? env.reread() : null; return s2 ? readingOf(P, s2) : null; } });
      memBack(Mm, M);
      for (const { ring, age, byVehicle } of res.moments) {
        env.deliver({ ...ring, expires: toS(ring.expires), target: toS(ring.target), arrAt: toS(ring.arrAt) }, age / 1000, byVehicle);
      }
      for (const l of res.log) env.log(toS(l.t), l.what);
    },
    voiceGate(v, t, say, age, byVehicle) {
      const g = ts.voiceGate({ open: true, silent: !!v.silent, openSince: v.openSince == null ? null : toMs(v.openSince), refreshes: v.refreshes, speakingUntil: toMs(v.speakingUntil) }, toMs(t), say, age * 1000, byVehicle);
      return { ...g, start: toS(g.start), until: toS(g.until) };
    },
  };
}
