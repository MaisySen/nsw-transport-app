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
// unknown: how many of the feed's trips the timetable lacks; empty: how many timetable trips are "Empty Train".
export function trainNetwork({ trips = 1500, stations = 60, perTrip = 20, unknown = 0, empty = 0, now = Date.now() } = {}) {
  const nowS = Math.floor(now / 1000);
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" });
  const day = fmt.format(new Date(now)).replace(/-/g, "");
  const base = Math.floor(new Date(new Date(now).toLocaleString("en-US", { timeZone: "Australia/Sydney" }).replace(/,.*/, "") + " 00:00").getTime() / 1000);
  const meta = { days: { [day]: base }, routes: [["T1", 1, "#F99D1C", "train", "", "Fake Line"]], heads: ["Fake Terminus", "Empty Train"], routeIds: { train: { FAKE_1: 0 } }, builtAt: new Date(now).toISOString() };
  const stops = {};
  for (let s = 0; s < stations; s++) {
    stops["ST" + s] = ["Fake " + s + " Station", "", "", 0, 0];
    stops["ST" + s + "P1"] = ["Fake " + s + " Station Platform 1", "ST" + s, "1", 0, 0];
    stops["ST" + s + "P2"] = ["Fake " + s + " Station Platform 2", "ST" + s, "2", 0, 0];
  }
  const rows = {}, tripRows = [], feedTrips = [];
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
      if (known && k < perTrip - 1) (rows[sid] = rows[sid] || []).push([t + 30 - base, tripId, 0, i < empty ? 1 : 0, k + 1]);
    }
    if (known) tripRows.push({ t: tripId, s: flat });
    feedTrips.push({ tripId, routeId: "FAKE_1", rel: 0, stus, ts: nowS });
  }
  for (const r of Object.values(rows)) r.sort((a, b) => a[0] - b[0]);
  const header = [...str(1, "2.0"), ...num(3, nowS)];
  const tu = new Uint8Array([...msg(1, header), ...feedTrips.flatMap((t, i) => msg(2, [...str(1, "e" + i), ...msg(3, tripUpdate(t))]))]);
  return { tu, meta, stops, rows, trips: tripRows, day };
}
