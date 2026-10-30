// Build 210 end to end on this machine (31 Oct, final check before build 210): tools/sim210.mjs runs a trip watch and a
// Live Activity against tools/fake-nsw.mjs (no real Transport for NSW, no Apple, no Expo) in five scenarios. Here the
// facts the owner's phone depends on: the stop track rides the card push under Apple's 4 KB, Get off now goes once at
// 90 s or less from the live arrival and moves with a late run, a stale feed falls back to the timetable and says so,
// and a plain deploy (no switch set) or a kill sends neither.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const out = path.join(os.tmpdir(), `sim210-${process.pid}.json`);
execFileSync(process.execPath, [path.join(root, "tools/sim210.mjs"), out], { stdio: "ignore", timeout: 240000, env: { ...process.env, TZ: "Australia/Sydney" } });
const sim = JSON.parse(fs.readFileSync(out, "utf8")); fs.unlinkSync(out);
const S = Object.fromEntries(sim.scenarios.map((s) => [s.name.split(/[ ,]/)[0] + (s.name.includes("late") ? "-late" : ""), s]));
const at = (s) => Date.parse(s);

test("switches on: the stop track rides the card pushes, under 4 KB; one Get off now 90 s or less before the live arrival", () => {
  const s = S.on;
  assert.equal(s.watch.getOff, true);
  assert.ok(s.withTrack >= s.pushes.length - 2, "every push while riding carries the track");
  assert.ok(s.maxBytes < 4096);
  assert.equal(s.getOff.length, 1);
  const lead = at(s.liveArrivalInFeed) - at(s.getOff[0].at);
  assert.ok(lead > 0 && lead <= 90000, "fired " + lead / 1000 + " s before");
  assert.equal(s.getOff[0].sound, "getoff_now.wav");
  assert.equal(s.expo.filter((m) => /^Arriving|^Next stop/.test(m.title)).length, 0, "no second alert beside it");
  assert.equal(s.otherCalls.length, 0);
});

test("a run 4 min late after the phone locked: Get off now moves with the live arrival", () => {
  const s = S["on-late"];
  assert.equal(s.getOff.length, 1);
  const lead = at(s.lateArrival) - at(s.getOff[0].at);
  assert.ok(lead > 0 && lead <= 90000, "fired " + lead / 1000 + " s before");
});

test("a stale feed: past the 5 min cap one alert worded as timetable, and the card drops the live track", () => {
  const s = S.stale;
  assert.equal(s.getOff.length, 1);
  assert.match(s.getOff[0].body, /No live times right now\. By the timetable/);
  const after = s.pushes.filter((p) => at(p.at) >= at(sim.sim0) + 28 * 60000);
  assert.ok(after.length && after.every((p) => !p.stopTrack || p.stopTrack.live === false));
});

test("a plain deploy (no server config) and a kill: no Get off now from the server, no stop track", () => {
  for (const s of [S.off, S.kill]) {
    assert.equal(s.watch.getOff, false);
    assert.equal(s.getOff.length, 0);
    assert.equal(s.withTrack, 0);
    assert.ok(s.expo.some((m) => /^Arriving/.test(m.title)), "the alerts builds 201 to 209 had");
  }
});
