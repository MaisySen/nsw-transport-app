// Web app tight change rule (27 Oct 2026): the web page's via trips (src/public/app.js planTrip) call a change tight
// with the same rule as the app (app/src/lib/tightChangeCore.ts) and the server (tightChangeAt in worker.js), with the
// person's own change time as a floor. This runs the web page's own rule block against the app's file over the same
// generated trips and fails on any difference. Stops here are generated, not real stations.
// Run: TZ=Australia/Sydney node --test test/web-tight-change.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const app = fs.readFileSync(root + "src/public/app.js", "utf8");
const m = app.match(/\/\/ tight-change-rule:start\n([\s\S]*?)\n\s*\/\/ tight-change-rule:end/);
const block = m ? m[1] : "";
// The block is plain code inside the web app's closure; run it on its own and hand back its functions.
const Web = block ? new Function(block + "\nreturn { tightChangeAt, tightOrOwn, TIGHT_SAME_MODE_MIN, TIGHT_OTHER_MIN, TIGHT_WALK_SPARE_MIN };")() : {};
const A = await import(new URL("../../app/src/lib/tightChangeCore.ts", import.meta.url).href);

const MIN = 60000;
const BASE = Date.parse("2026-10-27T09:00:00+11:00");
const iso = (t) => new Date(t).toISOString();
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
    const ride = (3 + Math.floor(r() * 30)) * MIN;
    const dep = t + Math.floor((r() * 14 - 3) * 60) * 1000;
    const live = r() < 0.6;
    const toStop = r() < 0.15 ? null : "S" + Math.floor(r() * 50);
    legs.push({
      kind: "transit", mode: r() < 0.05 ? null : pick(r, MODES),
      stopId: r() < 0.15 ? null : (r() < 0.4 ? stop : "S" + Math.floor(r() * 50)), toStopId: toStop,
      fromParent: r() < 0.3 ? null : "P" + Math.floor(r() * 6), toParent: r() < 0.3 ? null : "P" + Math.floor(r() * 6),
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

test("the web page carries one marked copy of the rule, with the app's minimums", () => {
  assert.ok(block, "tight-change-rule markers in src/public/app.js");
  assert.equal(app.split("tight-change-rule:start").length, 2);
  assert.equal(Web.TIGHT_SAME_MODE_MIN, A.SAME_MODE_MIN);
  assert.equal(Web.TIGHT_OTHER_MIN, A.OTHER_MIN);
  assert.equal(Web.TIGHT_WALK_SPARE_MIN, A.WALK_SPARE_MIN);
});

test("web page and app give the same answer on 20,000 generated trips (every change, every field)", () => {
  const r = rng(2710202627);
  let tight = 0, changes = 0;
  const whys = new Set();
  for (let n = 0; n < 20000; n++) {
    const legs = genTrip(r);
    for (let i = 0; i < legs.length; i++) {
      const w = Web.tightChangeAt(legs, i), a = A.changeAt(legs, i);
      assert.deepEqual(w, a, `trip ${n}, leg ${i}: ${JSON.stringify(legs)}`);
      if (legs[i].kind === "transit" && i > 0) changes++;
      if (w) { tight++; whys.add(w.why); }
      // The via floor: the same answer for any own change time.
      const gap = Math.floor(r() * 12) - 1, own = Math.floor(r() * 10);
      assert.equal(Web.tightOrOwn(legs, i, gap, own), A.tightOrOwn(legs, i, gap, own), `trip ${n}, leg ${i}, gap ${gap}, own ${own}`);
    }
  }
  assert.ok(tight > changes * 0.1 && tight < changes * 0.9, `${tight} of ${changes}`);
  assert.deepEqual([...whys].sort(), ["mode", "platform", "same"]);
});

test("via floor: tight under the person's own time or under the rule, whichever is longer", () => {
  const at = (m) => iso(BASE + m * MIN);
  // Train to bus with 4 min to change: the rule wants 5, so tight even when the person allows 2.
  const legs = [
    { kind: "transit", mode: "train", stopId: "S1", toStopId: "S2", planned: at(0), arrPlanned: at(10) },
    { kind: "transit", mode: "bus", stopId: "S3", toStopId: "S4", planned: at(14), arrPlanned: at(30) },
  ];
  assert.equal(Web.tightOrOwn(legs, 1, 4, 2), true);
  // Same mode, same stop, 4 min: the rule is happy, the person's 6 min is not.
  const same = [{ ...legs[0] }, { ...legs[1], mode: "train", stopId: "S2" }];
  assert.equal(Web.tightOrOwn(same, 1, 4, 3), false);
  assert.equal(Web.tightOrOwn(same, 1, 4, 6), true);
  // 8 min to another mode, person allows 5: fine.
  const roomy = [{ ...legs[0] }, { ...legs[1], planned: at(18) }];
  assert.equal(Web.tightOrOwn(roomy, 1, 8, 5), false);
});

test("web via trips use the rule, not only the person's change time", () => {
  assert.doesNotMatch(app, /risk: gap < conn \/ 60000 \? "tight"/);
  assert.match(app, /risk: tightOrOwn\(legs, \(a\.j\.legs \|\| \[\]\)\.length \+ legs2\.indexOf\(f2\), gap, conn \/ 60000\) \? "tight" : ""/);
  assert.doesNotMatch(block, /[\u2013\u2014]/);
});
