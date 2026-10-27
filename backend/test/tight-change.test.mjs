// Tight change rule on the server (27 Oct 2026): transfer.risk uses the app's "Tight change" rule
// (app/src/lib/tightChangeCore.ts, c62684f) so the app and the server never disagree; old builds keep the same
// transfer shape and the same three words. Stops here are generated, not real stations.
// Run: TZ=Australia/Sydney node --test test/tight-change.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/ttplan.js", "utf8") +
  "\nexport { __default, trip, tightChangeAt, transferRisk, journeyRisk, ttAnswer, planChain, chainLegs, TIGHT_SAME_MODE_MIN, TIGHT_OTHER_MIN, TIGHT_WALK_SPARE_MIN };\n";
const tmp = `/tmp/tight-change-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
// The app's own file, as the app ships it (Node 22 reads TypeScript by stripping the types).
const A = await import(new URL("../../app/src/lib/tightChangeCore.ts", import.meta.url).href);

const MIN = 60000;
const BASE = Date.parse("2026-10-27T09:00:00+11:00");
const iso = (t) => new Date(t).toISOString();

// A small seeded generator so a failure can be replayed.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const pick = (r, a) => a[Math.floor(r() * a.length)];
const MODES = ["train", "metro", "bus", "coach", "school bus", "ferry", "lightrail", "Train", "Bus"];
const PLATS = [null, "Platform 1", "Platform 2", "platform 2", "Stand A", "Stand B", "Wharf 3", "3", "", "Platform 1 "];

function genTrip(r) {
  const legs = [];
  let t = BASE + Math.floor(r() * 600) * MIN;
  const n = 2 + Math.floor(r() * 3);
  let stop = "S" + Math.floor(r() * 50);
  for (let i = 0; i < n; i++) {
    if (i > 0 && r() < 0.35) {
      const w = Math.floor(r() * 9);
      legs.push({ kind: "walk", mode: "walk", durationMin: r() < 0.05 ? null : w, planned: iso(t), arrPlanned: iso(t + w * MIN) });
    }
    const parent = "P" + Math.floor(r() * 6);
    const ride = (3 + Math.floor(r() * 30)) * MIN;
    const dep = t + Math.floor((r() * 14 - 3) * 60) * 1000;
    const live = r() < 0.6;
    const toStop = r() < 0.15 ? null : "S" + Math.floor(r() * 50);
    legs.push({
      kind: "transit", mode: r() < 0.05 ? null : pick(r, MODES),
      stopId: r() < 0.15 ? null : (r() < 0.4 ? stop : "S" + Math.floor(r() * 50)), toStopId: toStop,
      fromParent: r() < 0.3 ? null : parent, toParent: r() < 0.3 ? null : "P" + Math.floor(r() * 6),
      fromPlatform: pick(r, PLATS), toPlatform: pick(r, PLATS),
      planned: r() < 0.03 ? null : iso(dep), estimated: live ? iso(dep + Math.floor((r() * 8 - 2) * 60) * 1000) : null,
      arrPlanned: iso(dep + ride), arrEstimated: live && r() < 0.8 ? iso(dep + ride + Math.floor((r() * 8 - 2) * 60) * 1000) : null,
      cancelled: r() < 0.05,
    });
    stop = toStop || stop;
    t = dep + ride;
  }
  return legs;
}

test("the rule's minimums are the app's", () => {
  assert.equal(W.TIGHT_SAME_MODE_MIN, A.SAME_MODE_MIN);
  assert.equal(W.TIGHT_OTHER_MIN, A.OTHER_MIN);
  assert.equal(W.TIGHT_WALK_SPARE_MIN, A.WALK_SPARE_MIN);
});

test("server and app give the same answer on 20,000 generated trips (every change, every field)", () => {
  const r = rng(27102026);
  let tight = 0, changes = 0;
  const whys = new Set();
  for (let n = 0; n < 20000; n++) {
    const legs = genTrip(r);
    for (let i = 0; i < legs.length; i++) {
      const s = W.tightChangeAt(legs, i), a = A.changeAt(legs, i);
      assert.deepEqual(s, a, `trip ${n}, leg ${i}: ${JSON.stringify(legs)}`);
      if (legs[i].kind === "transit" && i > 0) changes++;
      if (s) { tight++; whys.add(s.why); }
    }
  }
  // The corpus is not trivially all tight or all fine, and reaches every reason.
  assert.ok(tight > changes * 0.1 && tight < changes * 0.9, `${tight} of ${changes}`);
  assert.deepEqual([...whys].sort(), ["mode", "platform", "same"]);
});

// Legs built in the trip answer's shape for the rule cases.
const leg = (o) => ({ kind: "transit", mode: "train", stopId: "A1", toStopId: "B1", fromParent: "A", toParent: "B", fromPlatform: "Platform 1", toPlatform: "Platform 2", estimated: null, arrEstimated: null, cancelled: false, ...o });
const walk = (m) => ({ kind: "walk", mode: "walk", durationMin: m });
const two = (gap, b = {}, mid = []) => [leg({ planned: iso(BASE), arrPlanned: iso(BASE + 10 * MIN) }), ...mid,
  leg({ stopId: "B1", toStopId: "C1", fromParent: "B", toParent: "C", fromPlatform: "Platform 2", planned: iso(BASE + 10 * MIN + gap * MIN), arrPlanned: iso(BASE + 40 * MIN), ...b })];
const riskOf = (legs) => { const i = legs.length - 1; const gap = Math.round((Date.parse(legs[i].planned) - Date.parse(legs[0].arrPlanned)) / MIN); const w = legs.filter((l) => l.kind === "walk").reduce((s, l) => s + l.durationMin, 0); return W.transferRisk(legs, i, gap, w); };

test("same mode, same stop: tight under 3 min", () => {
  assert.equal(riskOf(two(2)), "tight");
  assert.equal(riskOf(two(3)), "ok");
});

test("another mode: tight under 5 min (the old server said ok from 2 min)", () => {
  assert.equal(riskOf(two(4, { mode: "bus", fromPlatform: "Stand A", stopId: "B9" })), "tight");
  assert.equal(riskOf(two(5, { mode: "bus", fromPlatform: "Stand A", stopId: "B9" })), "ok");
});

test("another platform at the same station: tight under 5 min", () => {
  assert.equal(riskOf(two(4, { stopId: "B2", fromPlatform: "Platform 5" })), "tight");
  assert.equal(riskOf(two(5, { stopId: "B2", fromPlatform: "Platform 5" })), "ok");
});

test("a walk in the change: walk plus 2 min, at least 5; shorter than the walk is still miss", () => {
  assert.equal(riskOf(two(4, { stopId: "B2" }, [walk(2)])), "tight");
  assert.equal(riskOf(two(5, { stopId: "B2" }, [walk(2)])), "ok");
  assert.equal(riskOf(two(8, { stopId: "B2" }, [walk(7)])), "tight");
  assert.equal(riskOf(two(9, { stopId: "B2" }, [walk(7)])), "ok");
  assert.equal(riskOf(two(2, { stopId: "B2" }, [walk(3)])), "miss");
});

test("a cancelled leg is not called tight (the app's rule), a short change is still miss", () => {
  assert.equal(riskOf(two(1, { cancelled: true })), "ok");
  assert.equal(riskOf(two(-1, { cancelled: true })), "miss");
});

test("journey risk is the worst change", () => {
  assert.equal(W.journeyRisk([{}, { transfer: { risk: "ok" } }]), "ok");
  assert.equal(W.journeyRisk([{}, { transfer: { risk: "tight" } }, { transfer: { risk: "ok" } }]), "tight");
  assert.equal(W.journeyRisk([{}, { transfer: { risk: "tight" } }, { transfer: { risk: "miss" } }]), "miss");
});

test("timetable trips (outage answer) use the rule and keep the transfer shape", () => {
  const legs = two(4, { mode: "bus", stopId: "B9", fromPlatform: "Stand A" });
  const [j] = W.ttAnswer([legs]).journeys;
  const tf = j.legs[1].transfer;
  assert.deepEqual(Object.keys(tf), ["minutes", "walkMin", "spare", "at", "risk"]);
  assert.equal(tf.risk, "tight");
  assert.equal(j.risk, "tight");
});

// A Trip Planner (EFA) leg with generated stops.
function efa({ from, to, dep, min, cls = 1, line = "L1", plat = "Platform 1", toPlat = "Platform 2", delay = null }) {
  const arr = dep + min * MIN, live = delay != null;
  const stop = (id, name, p, k, t) => ({ id: id + p.replace(/\D/g, ""), name: name + ", " + p, disassembledName: name, parent: { id, name },
    [k + "Planned"]: iso(t), ...(live ? { [k + "Estimated"]: iso(t + delay * MIN) } : {}), properties: { platformName: p } });
  return {
    transportation: { disassembledName: line, number: line, product: { class: cls }, destination: { name: "End", id: "1" }, properties: { RealtimeTripId: "t" + dep + line } },
    origin: stop(from, "Stop " + from, plat, "departureTime", dep), destination: stop(to, "Stop " + to, toPlat, "arrivalTime", arr),
    isRealtimeControlled: live, isCancelled: false, duration: min * 60, stopSequence: [{}, {}], infos: [],
  };
}
let answer = { journeys: [] };
globalThis.fetch = async (u) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (url.pathname.endsWith("/trip")) return new Response(JSON.stringify(answer));
  return new Response("{}", { status: 404 });
};

test("/api/trip journeys: train to bus with 4 min is tight on the server, as the app's rule says", async () => {
  const now = Date.now() + 5 * MIN;
  const a = efa({ from: "900001", to: "900002", dep: now, min: 12 });
  const b = efa({ from: "900002", to: "900003", dep: now + 16 * MIN, min: 10, cls: 5, line: "B1", plat: "Stand C", toPlat: "Stand D" });
  const c = efa({ from: "900002", to: "900003", dep: now + 22 * MIN, min: 10, cls: 5, line: "B1", plat: "Stand C", toPlat: "Stand D" });
  answer = { journeys: [{ legs: [a, b] }, { legs: [a, c] }] };
  const r = await W.trip({ TFNSW_API_KEY: "t" }, "900001", "900003", {});
  const [j1, j2] = r.journeys;
  for (const j of [j1, j2]) {
    const tl = j.legs.filter((l) => l.kind === "transit");
    assert.deepEqual(Object.keys(tl[1].transfer), ["minutes", "walkMin", "spare", "at", "risk"]);
    assert.equal(tl[1].transfer.risk === "tight", !!A.tightChange(j.legs), "server and app agree");
  }
  assert.equal(j1.legs.filter((l) => l.kind === "transit")[1].transfer.risk, "tight");
  assert.equal(j1.risk, "tight");
  assert.equal(j2.legs.filter((l) => l.kind === "transit")[1].transfer.risk, "ok");
  assert.equal(j2.risk, "ok");
});

// Your own trips with a change you set (chains): your change time and the rule both count.
async function chainRun(gapMin, seg2, c) {
  const now = Date.now() + 5 * MIN;
  const a = efa({ from: "910001", to: "910002", dep: now, min: 12, line: "L1" });
  const arr = now + 12 * MIN;
  const b = efa({ from: "910002", to: "910003", dep: arr + gapMin * MIN, min: 10, line: "L2", ...seg2 });
  const byOrigin = { "910001": { journeys: [{ legs: [a] }] }, "910002": { journeys: [{ legs: [b] }] } };
  globalThis.fetch = async (u) => {
    const url = new URL(typeof u === "string" ? u : u.url);
    if (url.pathname.endsWith("/trip")) return new Response(JSON.stringify(byOrigin[url.searchParams.get("name_origin")] || { journeys: [] }));
    return new Response("{}", { status: 404 });
  };
  const legs = [{ f: "910001", fn: "Stop 910001", t: "910002", tn: "Stop 910002", m: "train" }, { f: "910002", fn: "Stop 910002", t: "910003", tn: "Stop 910003", m: seg2.cls === 5 ? "bus" : "train", c }];
  const r = await W.planChain({ TFNSW_API_KEY: "t" }, W.chainLegs(legs), {});
  const j = r.journeys[0];
  const tl = j.legs.filter((l) => l.kind === "transit");
  return { j, tf: tl[1].transfer };
}

test("chain: train to bus with 4 min is tight even when you allow 2; 5 min is fine; server warning, one only", async () => {
  const bus = { cls: 5, plat: "Stand C", toPlat: "Stand D" };
  const t4 = await chainRun(4, bus, 2);
  assert.equal(t4.tf.risk, "tight");
  assert.equal(t4.tf.chain, true);
  assert.match(t4.j.warn, /^Tight change at /);
  const t5 = await chainRun(5, bus, 2);
  assert.equal(t5.tf.risk, "ok");
  assert.equal(t5.j.warn, null);
  // The app's own row label then has nothing to add where the server said nothing.
  assert.equal(A.tightChange(t5.j.legs), null);
});

test("chain: same train platform with 2 min is tight even when you allow 2; 3 min is fine", async () => {
  const same = { plat: "Platform 2", toPlat: "Platform 1" };
  const t2 = await chainRun(2, same, 2);
  assert.equal(t2.tf.risk, "tight");
  assert.ok(A.tightChange(t2.j.legs));
  const t3 = await chainRun(3, same, 2);
  assert.equal(t3.tf.risk, "ok");
  assert.equal(A.tightChange(t3.j.legs), null);
});

test("chain: your own change time still counts on its own (allow 8, the bus runs 2 min early, 7 min left)", async () => {
  const t = await chainRun(9, { cls: 5, plat: "Stand C", toPlat: "Stand D", delay: -2 }, 8);
  assert.equal(t.tf.risk, "tight");
  assert.equal(A.tightChange(t.j.legs), null);
  assert.match(t.j.warn, /^Tight change at /);
});

test("the app shows one warning: the row's own label stands back when the server has a warning line", () => {
  const home = fs.readFileSync(new URL("../../app/src/components/Home.tsx", import.meta.url), "utf8");
  assert.match(home, /const tc = cancelled \|\| j\.warn \? null : tightChange\(j\.legs\)/);
  const detail = fs.readFileSync(new URL("../../app/src/app/trip.tsx", import.meta.url), "utf8");
  // The change line in the trip detail uses the server's words for your own changes, the rule only otherwise.
  const tr = detail.slice(detail.indexOf("function Transfer("));
  assert.ok(tr.indexOf("if (tf && tf.chain)") < tr.indexOf("changeAt(legs, i)"));
});
