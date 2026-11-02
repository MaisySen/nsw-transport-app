// "Held, stay on" on the owner's Strathfield trip (2 Nov 2026, 3:15 PM, watch GBvLimZ3u-4, read from production): Get off
// now went at 3:14:59 for a live arrival of 3:15:39; the train got in at 3:17:07 (88 s after that estimate; the feed's
// last estimate was 3:16:51) and no Held came. The build 214 rule (tripState.ts HELD_*): 60 s after Get off now, the
// train not at the stop, a fresh live arrival at least 15 s away AND at least 30 s later than the one Get off now came
// from, at the same reading. Two replays of the same 88 s on the fake feed: the feed creeping with the train (each
// estimate 10 s ahead of its reading, what the stored readings allow) gives no Held, by the rule; the feed moving the
// arrival once gives one Held. So the 2 Nov trip is the rule working as written, not a bug in it.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { runCase, stopFake } from "../tools/simtrip.mjs";

after(() => stopFake());
const hms = (s) => { const [h, m, x = 0] = s.split(":").map(Number); return h * 3600 + m * 60 + x; };

test("S23c: the feed creeps with a train crawling in: no Held (each estimate under 15 s away), one Get off now, Arrived at the stop", { timeout: 90000 }, async () => {
  const r = await runCase("S23c");
  const said = JSON.stringify(r.alerts.map((a) => [a.t, a.title]));
  assert.ok(!r.alerts.some((a) => a.title === "Held, stay on"), said);
  assert.equal(new Set(r.alerts.filter((a) => /^Get off now/.test(a.title)).map((a) => a.title + a.body)).size, 1, said);
  const arr = r.alerts.filter((a) => /^Arrived|You've arrived/.test(a.title));
  assert.ok(arr.length >= 1 && arr.every((a) => a.t >= hms("20:00:28")), said);
});

test("S23j: the same 88 s with the arrival moved once: one quiet Held a minute after Get off now", { timeout: 90000 }, async () => {
  const r = await runCase("S23j");
  const held = r.alerts.filter((a) => a.title === "Held, stay on");
  assert.ok(held.length >= 1, JSON.stringify(r.alerts.map((a) => [a.t, a.title])));
  for (const h of held) assert.ok(h.t >= hms("19:59:20") && h.t <= hms("19:59:40"), `held at ${h.t}`);
  assert.equal(new Set(held.map((h) => h.body)).size, 1, "one Held message");
});
