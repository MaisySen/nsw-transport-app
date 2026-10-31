// A journey simulator case (app/sim/cases.mjs) played as Transport for NSW would serve it, for the server-path
// simulation (tools/simtrip.mjs, backend/test/tripflow-sim.test.mjs) through tools/fake-nsw.mjs mode "case": the
// trip update and vehicle position feeds (GTFS realtime, built from the simulator's own feed model, snapshot()) and
// the departure board of the boarding stop, at any moment of the case. No network, no NSW data: sample stops only.
// Times in a case are seconds since Sydney midnight; base is that midnight in ms.
import { prepare, snapshot } from "../../app/sim/journeySim.mjs";
import { CASES } from "../../app/sim/cases.mjs";

const vint = (n) => { const out = []; let v = BigInt(Math.round(n)); if (v < 0n) v += 1n << 64n; do { let b = Number(v & 127n); v >>= 7n; if (v) b |= 128; out.push(b); } while (v); return out; };
const fld = (f, wt) => vint(f * 8 + wt);
const num = (f, n) => [...fld(f, 0), ...vint(n)];
const str = (f, s) => { const b = [...Buffer.from(String(s))]; return [...fld(f, 2), ...vint(b.length), ...b]; };
const msg = (f, bytes) => [...fld(f, 2), ...vint(bytes.length), ...bytes];
const f32 = (f, x) => { const b = Buffer.alloc(4); b.writeFloatLE(x, 0); return [...fld(f, 5), ...b]; };

export const slug = (s) => String(s).toLowerCase().replace(/,.*$/, "").replace(/\s+station$/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
/** The station id of a stop name, and the boarding platform's own id (the one the app registers). */
export const stationId = (name) => "SIM_" + slug(name);
export const platformId = (name, leg) => stationId(name) + "_" + (leg.mode === "bus" ? "S" + slug(leg.stand || "a") : "P" + (leg.platform || "1"));
const tripIdOf = (leg) => "SIM." + (leg.id || "leg" + leg.li);

export function caseById(id) { const c = CASES.find((x) => x.id === id); if (!c) throw new Error("no case " + id); return c; }

/** Everything the fake needs about one case: the prepared case, the stop names (asset shard) and the trips. */
export function caseNet(c) {
  const P = prepare(c);
  const names = {};
  for (const leg of P.legs) {
    leg.tripId = tripIdOf(leg);
    leg.stops.forEach((s, k) => {
      const nm = s.name.replace(/,.*$/, "");
      names[stationId(s.name)] = [leg.mode === "bus" ? nm : nm + " Station", -33.8 - k * 0.01, 151 + k * 0.01];
      if (k === 0) names[platformId(s.name, leg)] = [(leg.mode === "bus" ? nm + ", " + (leg.stand || "Stand A") : nm + " Station, Platform " + (leg.platform || "1")), -33.8, 151];
    });
    const lastName = leg.stops[leg.off].name;
    names[stationId(lastName) + "_beyond"] = ["Beyond " + lastName.replace(/,.*$/, "") + " Station", -34, 151.2];
  }
  return { P, names };
}

const stopIdOf = (leg, k) => (k === 0 ? platformId(leg.stops[0].name, leg) : k > leg.off ? stationId(leg.stops[leg.off].name) + "_beyond" : stationId(leg.stops[k].name));

/** The trip update feed (kind "tu") or vehicle position feed ("vp") at time t (seconds since midnight). */
export function caseFeed(net, base, t, kind) {
  const { P } = net;
  const S = snapshot(P, t);
  const tsS = Math.floor(base / 1000) + S.asOf;
  const ents = [];
  P.legs.forEach((leg, li) => {
    const L = S.legs[li];
    if (L.unmatched) return;
    if (kind === "tu") {
      const trip = [...str(1, leg.tripId), ...num(4, L.cancelled ? 3 : 0), ...str(5, "SIM_" + leg.line)];
      const stus = [];
      if (!L.cancelled) {
        for (let k = 0; k <= leg.off + 1; k++) {
          const tt = k <= leg.off ? leg.stops[k].tt : leg.stops[leg.off].tt + 120;
          // A stop's own live time is a time; the run's carried delay is a delay with no time (as the simulator tells
          // them apart: only a time counts as that stop's own evidence).
          // Stops in between carry a projected time (the stop before yours needs its timetable time for "Next: X").
          const own = k <= leg.off && L.est[k] != null ? L.est[k] : (k > 0 && k < leg.off && L.runDelay != null ? tt + L.runDelay : null);
          if (own == null && L.runDelay == null) continue;
          const ev = own != null ? [...num(1, own - tt), ...num(2, Math.floor(base / 1000) + own)] : [...num(1, L.runDelay)];
          stus.push(msg(2, [...num(1, k + 1), ...msg(2, ev), ...msg(3, ev), ...str(4, stopIdOf(leg, k))]));
        }
      }
      ents.push(msg(2, [...str(1, "e" + li), ...msg(3, [...msg(1, trip), ...stus.flat(), ...num(4, tsS)])]));
    } else if (L.vehicle && !L.cancelled) {
      const v = L.vehicle;
      const k = v.state === "at" ? v.stop : v.stop + 1;
      const vp = [...msg(1, str(1, leg.tripId)), ...msg(2, [...f32(1, -33.8 - k * 0.01), ...f32(2, 151 + k * 0.01)]), ...num(3, k + 1), ...num(4, v.state === "at" ? 1 : 2), ...num(5, Math.floor(base / 1000) + v.at), ...str(7, stopIdOf(leg, k))];
      ents.push(msg(2, [...str(1, "v" + li), ...msg(4, vp)]));
    }
  });
  const header = [...str(1, "2.0"), ...num(3, tsS)];
  return new Uint8Array([...msg(1, header), ...ents.flat()]);
}

/** The Trip Planner departure board (departure_mon) of a boarding stop at time t: the case's services from it. */
export function caseBoard(net, base, t, stopId) {
  const { P } = net;
  const S = snapshot(P, t);
  const iso = (s) => new Date(base + s * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const out = [];
  P.legs.forEach((leg, li) => {
    const st = stationId(leg.stops[0].name);
    if (!(stopId === st || String(stopId).startsWith(st + "_"))) return;
    const L = S.legs[li];
    const tt = leg.stops[0].tt;
    const live = !L.unmatched && (L.est[0] != null || L.board != null || L.runDelay != null);
    const est = L.est[0] != null ? L.est[0] : L.board != null ? L.board : L.runDelay != null ? tt + L.runDelay : null;
    const plat = L.platform || leg.platform;
    const cls = leg.mode === "bus" ? 5 : 1;
    const props = leg.mode === "bus" ? { platformName: leg.stand || "Stand A" } : { platformName: "Platform " + plat, ...(L.platform && L.platform !== leg.platform ? { plannedPlatformName: "Platform " + leg.platform } : {}) };
    out.push({ location: { id: platformId(leg.stops[0].name, { ...leg, platform: plat }), name: leg.stops[0].name.replace(/,.*$/, "") + (leg.mode === "bus" ? "" : " Station"), properties: props },
      departureTimePlanned: iso(tt), ...(live && est != null ? { departureTimeEstimated: iso(est) } : {}), isRealtimeControlled: !!live, ...(L.cancelled ? { isCancelled: true } : {}),
      transportation: { id: "nsw:" + leg.line, name: leg.line, disassembledName: leg.line, number: leg.line, description: "Sample line", product: { class: cls, name: "x" }, destination: { id: "SIM_dest", name: leg.stops[leg.off].name.replace(/,.*$/, "") } },
      properties: { RealtimeTripId: leg.tripId } });
  });
  return out.sort((a, b) => Date.parse(a.departureTimePlanned) - Date.parse(b.departureTimePlanned));
}
