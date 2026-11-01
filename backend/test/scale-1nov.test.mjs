// Server scale and stale feed fixes (1 Nov 2026, task 03193e77; harness report files/day-1nov/rt-harness*.md).
// SCALE: tfPassStep read "SELECT * FROM watches WHERE active = 1 ORDER BY created LIMIT 100": every active watch of any
//   kind, oldest first, at most 100, so past 100 watches the newest trips were never stepped (151 trips: 51 got no Get
//   off now; 500: 400). Now only trip flow watches are read (filtered in SQL), the most overdue first, leftovers
//   expire in one UPDATE, and past 30 trips the minute is split over TripFlowShard objects (TFSHARD binding), each its
//   own invocation; every invocation keeps its outbound requests (NSW, Apple, Expo) and D1 statements under budget,
//   together well under Cloudflare's 1000 subrequests an invocation.
// FEED 150 s BEHIND (harness F-NSWSTALE): the card stayed on "wait" saying "On time" and nothing rang. What a reading
//   shows has happened (the train past a stop by its own time) now counts while the reading is under the 5 min live
//   cap, so the trip moves (late, never early); the card says "About 7:55pm, updated 7:52pm", never "On time" from a
//   copy over 2 min old; Get off now from that copy is the quiet "Clyde about" note (spec 2.2) and "Clyde now. Get off
//   here." never comes from it (the calm Arrived does).
// FEED LOST NEAR THE STOP (harness F-NSWDOWN-NEAR): a stop's live time is a forecast and is never passed on the clock
//   more than 30 s after the reading it came from, so no arrival claim comes from the last forecast; and the card's next
//   stop only comes from live data (it moved to "Clyde" on the timetable once the data was 5 min old) and never goes
//   back (it went back to "Auburn" when the old copy's vehicle position dropped out at 3 min).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { runCase, stopFake } from "../tools/simtrip.mjs";

after(() => stopFake());
const SUBREQ = 1000; // Cloudflare Workers: subrequests an invocation
const hm = (t) => `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
const T = (s) => { const [h, m, x] = s.split(":").map(Number); return h * 3600 + m * 60 + (x || 0); };

function stressSummary(r) {
  const byTok = new Map(), byExpo = new Map();
  for (const a of r.caught.apple) if (a.token) byTok.set(a.token, (byTok.get(a.token) || 0) + 1);
  for (const m of r.caught.expo) { const v = byExpo.get(m.to) || []; v.push(m.title); byExpo.set(m.to, v); }
  const pushes = r.stress.map((s) => byTok.get(s.tok) || 0).sort((a, b) => a - b);
  // every invocation (the cron's own pass and each shard's) on its own; D1 counted per statement (the server's own
  // meter, where it has one), to be safe
  const ps = r.passes.filter((p) => p.ext || p.d1).map((p) => ({ ...p, d1: Math.max(p.d1, (p.meter && p.meter.d1s) || 0) }));
  const worst = ps.reduce((w, p) => (p.ext + p.d1 > w.ext + w.d1 ? p : w), { ext: 0, d1: 0 });
  return {
    trips: r.stress.length + 1, registered: r.stress.filter((s) => s.watch).length + 1,
    noCardPush: r.stress.filter((s) => !byTok.get(s.tok)).length,
    noGetoff: r.stress.filter((s) => !(byExpo.get(s.expo) || []).includes("Get off now")).length,
    main: byExpo.get(r.mainExpo) || [],
    pushesMin: pushes[0], pushesP50: pushes[pushes.length >> 1],
    worstExt: worst.ext, worstD1: worst.d1, worstAt: worst.t, invocations: ps.length,
  };
}

for (const n of [151, 500]) {
  test(`${n} trips at once: every trip gets its card pushes and Get off now, each invocation under ${SUBREQ} subrequests`, async (t) => {
    const r = await runCase("S1", { stress: n - 1, shards: true });
    const s = stressSummary(r);
    t.diagnostic(JSON.stringify(s));
    assert.equal(s.registered, n);
    assert.equal(s.noGetoff, 0, `${s.noGetoff} of ${n - 1} other trips got no Get off now`);
    assert.equal(s.noCardPush, 0, `${s.noCardPush} trips got no card push`);
    assert.ok(s.pushesMin >= 15, `a trip got only ${s.pushesMin} card pushes over 12 min (p50 ${s.pushesP50})`);
    // Cloudflare counts outbound requests and D1 queries an invocation against 1000 each; here they stay under 1000 even
    // added together (and the server's own budget stops each at 750)
    assert.ok(s.worstExt + s.worstD1 < SUBREQ, `an invocation made ${s.worstExt} outbound requests and ${s.worstD1} D1 statements`);
    for (const want of ["Clyde is next", "Get off now", "Arrived at Clyde"]) assert.ok(s.main.includes(want), `the first trip got no "${want}": ${JSON.stringify(s.main)}`);
  });
}

test("older running watches of other kinds never take a trip's place (the pass read the 100 oldest of any kind)", async () => {
  const r = await runCase("S1", { oldWatches: 120 });
  const titles = r.alerts.filter((a) => !a.passive).map((a) => a.title);
  for (const want of ["Clyde is next", "Get off now", "Arrived at Clyde"]) assert.ok(titles.includes(want), `no "${want}" with 120 older watches running (got ${JSON.stringify(titles)})`);
  assert.ok(r.pushes.length >= 15, `${r.pushes.length} card pushes`);
});

// Without the binding (a deploy that missed it) the cron alone keeps under budget, Get off now timers first, and every
// trip keeps its card; all 151 trips here reach their Get off moment in the same minute, so some of those wait out the
// budget (the deploy note makes the binding a must).
test("no TFSHARD binding: 151 trips in the cron alone stay under budget, every trip keeps its card", async (t) => {
  const r = await runCase("S1", { stress: 150, shards: false });
  const s = stressSummary(r);
  t.diagnostic(JSON.stringify(s));
  assert.equal(s.noCardPush, 0);
  assert.ok(s.worstExt < 750 && s.worstD1 < 750, `the cron made ${s.worstExt} outbound requests and ${s.worstD1} D1 statements`);
  assert.ok(s.noGetoff <= 50, `${s.noGetoff} of 150 trips got no Get off now with the cron alone`);
});

test("feed 150 s behind: the trip still moves, never says On time from the old copy, and the quiet note and Arrived go", async () => {
  const r = await runCase("S1", { feedLagMs: 150000, endAt: T("20:03") });
  const lies = r.pushes.filter((p) => p.warning && /On time/.test(p.warning) && p.updated != null && p.t - p.updated >= 120);
  assert.deepEqual(lies.map((p) => `${hm(p.t)} "${p.warning}" from ${hm(p.updated)}`), [], "On time from a copy over 2 min old");
  const ride = r.pushes.find((p) => p.phase === "ride");
  assert.ok(ride && ride.t <= T("19:54"), `the card left "wait" at ${ride ? hm(ride.t) : "never"} (the train left 7:50pm)`);
  assert.ok(r.pushes.some((p) => p.event === "end"), "the card never ended");
  const a = r.alerts.map((x) => `${x.title}${x.passive ? " (quiet)" : ""}`);
  assert.ok(a.includes("Clyde about 7:55pm (quiet)"), `no quiet "Clyde about" note: ${JSON.stringify(a)}`);
  assert.ok(a.includes("Arrived at Clyde"), `no Arrived: ${JSON.stringify(a)}`);
  assert.ok(!a.some((x) => /now$|is next|Get off now/.test(x)), `a "now" or "is next" alert from a copy 150 s old: ${JSON.stringify(a)}`);
  const words = r.pushes.filter((p) => p.updated != null && p.t - p.updated >= 120 && p.t - p.updated < 300 && p.phase !== "arrived").map((p) => p.warning);
  // (before the copy shows the trip at all it is "Timetable times, not live")
  assert.ok(words.length && words.every((w) => /updated \d{1,2}:\d{2}[ap]m$|^Timetable times, not live$/.test(w)), `old copy words: ${JSON.stringify([...new Set(words)])}`);
});

test("feed lost 50 s before the stop: Get off now goes, and no arrival is claimed on the last forecast", async () => {
  const r = await runCase("S1", { feedDown: [T("19:54:10"), T("20:30")], endAt: T("20:05") });
  const a = r.alerts.filter((x) => x.t < T("20:05")).map((x) => `${hm(x.t)} ${x.title}`);
  assert.ok(a.some((x) => x.endsWith("Get off now")), JSON.stringify(a));
  assert.deepEqual(a.filter((x) => /Arrived|Clyde now|passed/.test(x)), [], "an arrival with no live data behind it");
  assert.deepEqual(r.pushes.filter((p) => p.phase === "arrived").map((p) => hm(p.t)), [], "the card said arrived with no live data");
});

test("feed lost 3 min before the stop (S20): no Get off now with sound, no arrival, and the next stop never moves on the timetable", async () => {
  const r = await runCase("S1", { feedDown: [T("19:52"), T("20:30")], endAt: T("20:05") });
  const a = r.alerts.map((x) => `${hm(x.t)} ${x.title}${x.passive ? " (quiet)" : ""}`);
  assert.deepEqual(a.filter((x) => /Get off now|Arrived|Clyde now|passed/.test(x)), [], JSON.stringify(a));
  assert.ok(a.some((x) => x.endsWith("Clyde about 7:55pm (quiet)")), JSON.stringify(a));
  const moved = r.pushes.filter((p) => p.updated != null && p.t - p.updated >= 300 && p.nextStop);
  assert.deepEqual(moved.map((p) => `${hm(p.t)} next ${p.nextStop} (data from ${hm(p.updated)})`), [], "a next stop with no live data");
  assert.ok(r.pushes.some((p) => p.t >= T("19:57") && /^No live data/.test(p.warning || "")), "the card never said the data is gone");
});

test("feed lost just after the train left Auburn: the card's next stop never goes back to Auburn", async () => {
  const r = await runCase("S1", { feedDown: [T("19:53:10"), T("20:30")], endAt: T("20:00") });
  const next = r.pushes.filter((p) => p.phase === "ride" && p.nextStop).map((p) => [hm(p.t), p.nextStop]);
  const first = next.findIndex(([, n]) => n === "Clyde");
  assert.ok(first >= 0, JSON.stringify(next));
  assert.deepEqual(next.slice(first).filter(([, n]) => n !== "Clyde"), [], "the next stop went back");
});
