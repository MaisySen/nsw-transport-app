// A synthetic Sydney Trains network for local runs (tools/fake-nsw.mjs mode "trains", tools/engine-cpu.mjs): a GTFS
// realtime trip update feed with whole trips (a time and a delay at every stop, no stop sequences, as the Sydney Trains
// feed gives them) and the matching timetable for the board engine. Some trips can be left out of the timetable
// (unknown: published after the load) and some can carry the "Empty Train" headsign. No network, no NSW data.
const vint = (n) => { const out = []; let v = BigInt(n); if (v < 0n) v += 1n << 64n; do { let b = Number(v & 127n); v >>= 7n; if (v) b |= 128; out.push(b); } while (v); return out; };
const fld = (f, wt) => vint(f * 8 + wt);
const num = (f, n) => [...fld(f, 0), ...vint(n)];
const str = (f, s) => { const b = [...Buffer.from(s)]; return [...fld(f, 2), ...vint(b.length), ...b]; };
const msg = (f, bytes) => [...fld(f, 2), ...vint(bytes.length), ...bytes];
const ev = (o) => [...num(1, o.delay), ...num(2, o.time)];
const stu = (u) => [...msg(2, ev(u.arr)), ...msg(3, ev(u.dep)), ...str(4, u.stopId)];
const tripUpdate = (t) => [...msg(1, [...str(1, t.tripId), ...num(4, t.rel || 0), ...str(5, t.routeId)]), ...t.stus.flatMap((u) => msg(2, stu(u))), ...num(4, t.ts)];

// trips: trips in the feed; stations: on one line, each with platforms 1 and 2; perTrip: stops a trip calls at;
// unknown: how many of the feed's trips the timetable lacks; empty: how many timetable trips are "Empty Train";
// stands: how many stations (from ST0) have sides with no name in the timetable (as temporary bus stands have), which
// the fake planner board (plannerBoard) names Stand X1 and X2 as moved stands; at: the moment the network is made for,
// so the feed, the planner board and a load into the engine agree (fake-nsw /__mode?at=).
export function trainNetwork({ trips = 1500, stations = 60, perTrip = 20, unknown = 0, empty = 0, stands = 0, at = 0, now = at || Date.now() } = {}) {
  const nowS = Math.floor(now / 1000);
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" });
  const day = fmt.format(new Date(now)).replace(/-/g, "");
  // Sydney midnight whatever the machine's time zone (the old way parsed the date in the local zone: 11 hours out on a
  // UTC machine, so no timetable row fell in a board's window there).
  const hms = new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(now)).split(":").map(Number);
  const base = nowS - (hms[0] * 3600 + hms[1] * 60 + hms[2]);
  const meta = { days: { [day]: base }, routes: [["T1", 1, "#F99D1C", "train", "", "Fake Line"]], heads: ["Fake Terminus", "Empty Train"], routeIds: { train: { FAKE_1: 0 } }, builtAt: new Date(now).toISOString() };
  const stops = {};
  for (let s = 0; s < stations; s++) {
    stops["ST" + s] = ["Fake " + s + " Station", "", "", 0, 0];
    if (s < stands) {
      stops["ST" + s + "P1"] = ["Fake " + s + " Station Side A", "ST" + s, "", 0, 0];
      stops["ST" + s + "P2"] = ["Fake " + s + " Station Side B", "ST" + s, "", 0, 0];
    } else {
      stops["ST" + s + "P1"] = ["Fake " + s + " Station Platform 1", "ST" + s, "1", 0, 0];
      stops["ST" + s + "P2"] = ["Fake " + s + " Station Platform 2", "ST" + s, "2", 0, 0];
    }
  }
  const rows = {}, tripRows = [], feedTrips = [], calls = {}, taken = new Set();
  for (let i = 0; i < trips; i++) {
    const up = i % 2 === 0;
    const first = (i * 7) % Math.max(1, stations - perTrip);
    const start = nowS - 45 * 60 + Math.floor((i * 6000) / trips); // spread over 100 minutes from 45 minutes ago
    const delay = (i % 5) * 30;
    const run = "R" + i;
    const known = i >= unknown;
    const tripId = run + ".1324.165." + (known ? "4" : "8") + ".A.8." + (90000000 + i);
    const stus = [], flat = [];
    for (let k = 0; k < perTrip; k++) {
      const st = up ? first + k : first + perTrip - 1 - k;
      const sid = "ST" + st + (up ? "P1" : "P2");
      const t = start + k * 150;
      stus.push({ stopId: sid, arr: { delay, time: t + delay }, dep: { delay, time: t + delay + 30 } });
      flat.push(sid, k + 1);
      // One train a minute per platform, as on the real network: a second one in the same minute runs through (the
      // engine keeps one row per line, minute and platform, so the fake planner board would list a train it cannot).
      const slot = sid + "|" + Math.floor((t + 30) / 60);
      const stops = k < perTrip - 1 && !taken.has(slot);
      if (stops) { taken.add(slot); (calls["ST" + st] = calls["ST" + st] || []).push({ sid, planned: (t + 30) * 1000, delay, tripId, empty: known && i < empty, stand: st < stands, up }); }
      if (known && stops) (rows[sid] = rows[sid] || []).push([t + 30 - base, tripId, 0, i < empty ? 1 : 0, k + 1]);
    }
    if (known) tripRows.push({ t: tripId, s: flat });
    feedTrips.push({ tripId, routeId: "FAKE_1", rel: 0, stus, ts: nowS });
  }
  for (const r of Object.values(rows)) r.sort((a, b) => a[0] - b[0]);
  const header = [...str(1, "2.0"), ...num(3, nowS)];
  const tu = new Uint8Array([...msg(1, header), ...feedTrips.flatMap((t, i) => msg(2, [...str(1, "e" + i), ...msg(3, tripUpdate(t))]))]);
  return { tu, meta, stops, rows, trips: tripRows, day, calls };
}

// The Trip Planner's departure board (departure_mon) for a station of the network: every call from now to two hours
// on, the planned time in whole minutes and the live time that minute plus the delay (as the real planner), its
// platform, or Stand X1 and X2 shown as moved from Stand A on the stand stations. Empty Train runs are listed like any
// other (as the night match of 27 Oct found them). id: a station ("ST4"); null when the network has no such station.
export function plannerBoard(net, id, now = Date.now()) {
  const list = net.calls[id];
  if (!list) return null;
  const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
  return list.filter((c) => c.planned >= now - 60000 && c.planned <= now + 120 * 60000).sort((a, b) => a.planned - b.planned).slice(0, 60).map((c) => {
    const planned = c.planned - (c.planned % 60000);
    const props = c.stand ? { platformName: c.up ? "Stand X1" : "Stand X2", plannedPlatformName: "Stand A" } : { platformName: "Platform " + (c.up ? 1 : 2) };
    return { location: { id: c.sid, name: "Fake station", properties: props }, departureTimePlanned: iso(planned), departureTimeEstimated: iso(planned + c.delay * 1000), isRealtimeControlled: true,
      transportation: { id: "nsw:T1", name: "T1", disassembledName: "T1", number: "T1", description: "Fake Line", product: { class: 1, name: "Sydney Trains Network" }, destination: { id: "x", name: "Fake Terminus" } },
      properties: { RealtimeTripId: c.tripId } };
  });
}
