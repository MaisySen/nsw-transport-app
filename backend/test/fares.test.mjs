// Opal fare estimates: distance bands, peak and off peak, transfer discount, same mode journeys,
// ferry with no off peak, airport station fee, daily caps and fare types. Fares read 24 Oct 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
let src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default, fareOf, pickFares, fareSentence, faresAll };\n";
const tmp = `/tmp/fares-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
const app = fs.readFileSync(root + "src/public/app.js", "utf8");
const ask = fs.readFileSync(root + "src/public/ask.js", "utf8");

// Monday 26 Oct 2026 and Saturday 24 Oct 2026, Sydney time (UTC+11).
const MON = (hhmm) => Date.parse(`2026-10-26T${hhmm}:00+11:00`);
const SAT = (hhmm) => Date.parse(`2026-10-24T${hhmm}:00+11:00`);
const path = (km, lat0 = -33.8) => [[lat0, 151.0], [lat0 - km / 2 / 111.195, 151.0], [lat0 - km / 111.195, 151.0]];
const leg = (mode, km, dep, durMin, extra = {}) => ({ kind: "transit", mode, line: extra.line || mode, planned: new Date(dep).toISOString(), arrPlanned: new Date(dep + durMin * 60000).toISOString(), path: path(km), from: extra.from || "A", to: extra.to || "B", stopId: extra.stopId || "1", toStopId: extra.toStopId || "2" });
const walk = { kind: "walk", durationMin: 3 };

test("train fare by distance band, peak on a weekday morning, off peak nudge", () => {
  const f = W.fareOf([leg("train", 11.8, MON("08:00"), 15)], "adult");
  assert.equal(f.total, 5.38);
  assert.equal(f.peak, true);
  assert.deepEqual(f.offPeak, { from: "10am", save: 1.62 });
  const e = W.fareOf([leg("train", 11.8, MON("17:30"), 15)], "adult");
  assert.equal(e.offPeak.from, "7pm");
  assert.equal(W.fareOf([leg("train", 8, MON("12:00"), 10)], "adult").total, 3.03);
  assert.equal(W.fareOf([leg("metro", 70, MON("08:00"), 60)], "adult").total, 10.66);
});

test("Fridays and weekends are off peak all day", () => {
  const f = W.fareOf([leg("train", 11.8, SAT("08:00"), 15)], "adult");
  assert.equal(f.total, 3.76);
  assert.equal(f.peak, false);
  assert.equal(f.offPeak, undefined);
});

test("bus then metro within 60 minutes gets the transfer discount", () => {
  const f = W.fareOf([leg("bus", 5.8, SAT("10:00"), 12), walk, leg("metro", 5.8, SAT("10:20"), 8)], "concession");
  assert.equal(f.transfer, 1);
  assert.equal(f.total, 2.07); // 1.56 bus + 1.51 metro - 1.00
  assert.equal(f.legs[1].transferOff, 1);
  const a = W.fareOf([leg("bus", 2, MON("08:00"), 10), leg("train", 5, MON("08:15"), 10)], "adult");
  assert.equal(a.total, 3.30 + 4.33 - 2);
});

test("train then metro is one journey on the total distance", () => {
  const f = W.fareOf([leg("train", 6, MON("12:00"), 10), walk, leg("metro", 6, MON("12:15"), 10)], "adult");
  assert.equal(f.total, 3.76);
  assert.equal(f.legs[1].joined, true);
  assert.equal(f.legs[1].amount, 0);
  // More than 60 minutes apart: two journeys, no discount.
  const g = W.fareOf([leg("train", 6, MON("12:00"), 10), leg("train", 6, MON("13:30"), 10)], "adult");
  assert.equal(g.total, 6.06);
});

test("bus and light rail use straight line distance", () => {
  const l = leg("bus", 2.5, SAT("10:00"), 20);
  l.path = [[-33.8, 151.0], [-33.9, 151.0], [-33.8 - 2.5 / 111.195, 151.0]];
  assert.equal(W.fareOf([l], "adult").total, 2.31);
  assert.equal(W.fareOf([leg("lightrail", 9, SAT("10:00"), 20)], "adult").total, 4.03);
});

test("ferries have no off peak", () => {
  const f = W.fareOf([leg("ferry", 11, MON("08:00"), 25)], "adult");
  assert.equal(f.total, 9.20);
  assert.equal(f.peak, false);
  assert.equal(W.fareOf([leg("ferry", 5, SAT("08:00"), 15)], "concession").total, 3.67);
});

test("airport station access fee", () => {
  const f = W.fareOf([leg("train", 8, SAT("10:00"), 10, { from: "Central Station", to: "International Airport Station", toStopId: "2020102" })], "adult");
  assert.equal(f.airportFee, 18.61);
  assert.equal(f.total, 3.03 + 18.61);
  const c = W.fareOf([leg("train", 8, SAT("10:00"), 10, { to: "Domestic Airport Station" })], "child");
  assert.equal(c.airportFee, 16.64);
  const d = W.fareOf([leg("train", 2, SAT("10:00"), 3, { from: "Domestic Airport Station", to: "International Airport Station" })], "adult");
  assert.equal(d.airportFee, 5.2);
  const m = W.fareOf([leg("train", 2, SAT("10:00"), 3, { from: "Mascot Station", to: "Domestic Airport Station" })], "adult");
  assert.equal(m.airportFee, 10.34);
});

test("daily caps, Gold cap and fare types", () => {
  const long = [leg("train", 70, MON("08:00"), 60), leg("ferry", 11, MON("09:10"), 25), leg("bus", 9, MON("09:40"), 20)];
  const f = W.fareOf(long, "adult");
  assert.equal(f.capped, true);
  assert.equal(f.total, 19.30);
  const sat = W.fareOf([leg("train", 70, SAT("08:00"), 60), leg("ferry", 11, SAT("09:10"), 25)], "adult");
  assert.equal(sat.total, 9.65);
  assert.equal(W.fareOf([leg("train", 30, MON("08:00"), 30)], "gold").total, 2.50);
  assert.equal(W.fareOf([leg("train", 30, MON("08:00"), 30)], "child").total, 3.10);
  assert.equal(W.fareOf([leg("train", 30, MON("08:00"), 30)], "nonsense").type, "adult");
});

test("a service with no Opal fare is marked, never guessed", () => {
  const f = W.fareOf([leg("coach", 30, SAT("10:00"), 30)], "adult");
  assert.equal(f.unknown, true);
  assert.equal(f.legs[0].amount, null);
});

test("responses carry one fare type and the sentence has no dashes", () => {
  const legs = [leg("train", 11.8, MON("08:00"), 15)];
  const d = { journeys: [{ legs, fares: W.faresAll(legs) }], cards: [{ journeys: [{ fares: W.faresAll(legs) }] }] };
  W.pickFares(d, "concession");
  assert.equal(d.journeys[0].fares, undefined);
  assert.equal(d.journeys[0].fare.type, "concession");
  assert.equal(d.journeys[0].fare.total, 2.69);
  assert.equal(d.cards[0].journeys[0].fare.type, "concession");
  const s = W.fareSentence(d.journeys[0].fare);
  assert.match(s, /^Opal fare estimate \$2\.69 \(Concession, peak\)\. Off peak from 10am, save \$0\.81\.$/);
  assert.doesNotMatch(s, /[\u2013\u2014]/);
});

test("clients send the fare type and show the estimate", () => {
  assert.match(app, /fare: fareT\(\)/);
  assert.match(app, /Opal fare estimate/);
  assert.match(app, /Off peak from/);
  assert.match(app, /data-fare=/);
  assert.match(ask, /fare: LS\.get\("tb_fare", "adult"\)/);
  assert.match(ask, /ak-fare/);
});

test("NSW TrainLink regional legs are booked fares, not Opal", () => {
  const xpt = { ...leg("train", 640, SAT("08:42"), 446), feed: "nswtrains" };
  const f = W.fareOf([xpt], "adult");
  assert.equal(f.unknown, true);
  assert.equal(f.legs[0].amount, null);
  assert.equal(f.total, 0);
});
