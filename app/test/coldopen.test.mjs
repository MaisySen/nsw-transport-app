// The cold open (27 Oct 2026, 8:35 AM): Home keeps its kept times marked Updating while the first live answers load,
// asks again quickly after a timeout or one failure, says unavailable only after failures in a row, never shows
// "No live times" while a first request is still out, and sends the commute card's trip first.
// Run: TZ=Australia/Sydney OFFLINE=1 node --test test/coldopen.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(import.meta.url);
const ts = require(path.join(root, 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-coldopen-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const C = await load('src/lib/coldOpenCore.ts');
const N = await load('src/lib/netErrCore.ts');
const P = await load('src/lib/pollCore.ts');

test('a timeout or one failure asks again quickly; only the third failure in a row shows unavailable', () => {
  const slow = { slow: true, server: true, offline: true };
  assert.equal(C.phoneOffline(slow), false, 'a slow answer is not the phone being offline');
  assert.equal(C.quickRetryMs({ fails: 1, offline: false, liveAgeMs: null }), 1500);
  assert.equal(C.quickRetryMs({ fails: 2, offline: false, liveAgeMs: null }), 4000);
  assert.equal(C.quickRetryMs({ fails: 3, offline: false, liveAgeMs: null }), null);
  assert.equal(C.quickRetryMs({ fails: 7, offline: false, liveAgeMs: null }), null);
  // A 5xx or 429 from the server counts the same as a timeout.
  assert.equal(C.phoneOffline({ http: 502, server: true }), false);
});

test('no connection at all: one quick ask again, then Offline', () => {
  const off = { offline: true };
  assert.equal(C.phoneOffline(off), true);
  assert.equal(C.quickRetryMs({ fails: 1, offline: true, liveAgeMs: null }), 1500);
  assert.equal(C.quickRetryMs({ fails: 2, offline: true, liveAgeMs: null }), null);
});

test('a live answer on screen is kept through a quick ask again only while it is under a minute old', () => {
  assert.equal(C.quickRetryMs({ fails: 1, offline: false, liveAgeMs: 20000 }), 1500);
  assert.equal(C.quickRetryMs({ fails: 1, offline: false, liveAgeMs: C.LIVE_GRACE_MS + 1 }), null);
});

test('a slow planner stand in is asked again twice for live trips; an outage stand in and a live answer are not', () => {
  const quick = { source: 'timetable', fallback: 'planner-slow', journeys: [{}] };
  assert.equal(C.isSlowStandIn(quick), true);
  assert.equal(C.standInReaskMs(quick, 0), 6000);
  assert.equal(C.standInReaskMs(quick, 1), 10000);
  assert.equal(C.standInReaskMs(quick, 2), null, 'then the normal gap');
  assert.equal(C.standInReaskMs({ source: 'timetable', journeys: [{}] }, 0), null, 'Trip Planner refused: the outage label stays');
  assert.equal(C.standInReaskMs({ journeys: [{}] }, 0), null);
  assert.equal(C.standInReaskMs(null, 0), null);
  assert.doesNotMatch(C.STAND_IN_UPDATING_NOTE, /unavailable/i);
});

test('the header says Updating while first requests are out, never "No live times"', () => {
  // Bidur's 8:35 AM open: a kept copy on screen, the commute request still out.
  assert.equal(C.homeHeader({ live: 0, off: 0, stale: 1000, pending: 1 }), 'updating');
  // Another card already failed for real, the commute is still on its way: still Updating.
  assert.equal(C.homeHeader({ live: 0, off: 1000, stale: 0, pending: 1 }), 'updating');
  // Nothing kept on the phone, first requests out.
  assert.equal(C.homeHeader({ live: 0, off: 0, stale: 0, pending: 2 }), 'updating');
  // Every card has had its answer or its failures in a row: now it may say so.
  assert.equal(C.homeHeader({ live: 0, off: 1000, stale: 0, pending: 0 }), 'offline');
  assert.equal(C.homeHeader({ live: 5000, off: 0, stale: 0, pending: 1 }), 'live');
  assert.equal(C.homeHeader({ live: 5000, off: 0, stale: 0, pending: 0 }), 'live');
  assert.equal(C.homeHeader({ live: 0, off: 0, stale: 0, pending: 0 }), 'none');
  assert.equal(C.UPDATING_WORD, 'Updating');
  assert.equal(C.updatingText('8:05am'), 'Updating, times from 8:05am');
});

test('the 8:35 AM sequence: a timed out first request, a quick ask, a stand in, then live; never unavailable', () => {
  // Model of one Home trip card (useLive with quick) and the header, step by step, with the core's own rules.
  let fails = 0, asked = 0, pending = 1, off = 0, live = 0, error = null;
  const stale = 1000; // a kept copy from earlier this morning
  const headers = [];
  const fail = (e) => {
    fails += 1;
    const w = C.quickRetryMs({ fails, offline: C.phoneOffline(e), liveAgeMs: live ? 0 : null });
    if (w == null) { pending = 0; error = e.message; off = stale; }
    headers.push(C.homeHeader({ live, off, stale: off ? 0 : stale, pending }));
    return w;
  };
  const answer = (d) => {
    fails = 0; pending = 0;
    const w = C.standInReaskMs(d, asked);
    if (w != null) asked += 1;
    if (!C.isSlowStandIn(d)) live = 2000;
    headers.push(C.homeHeader({ live, off, stale: live ? 0 : stale, pending: w != null && !live ? 1 : pending }));
    return w;
  };
  // 0 s: the commute request; 13 s: no answer (the phone's deadline).
  assert.equal(fail({ message: N.MSG.slow, slow: true, server: true, offline: true }), 1500);
  // 14.5 s: asked again, the server answers from its quick path with timetable trips.
  assert.equal(answer({ source: 'timetable', fallback: 'planner-slow', journeys: [{}] }), 6000);
  // 20.5 s: asked again, the planner's live answer is the server's saved copy now.
  assert.equal(answer({ journeys: [{}], source: 'live' }), null);
  assert.deepEqual(headers, ['updating', 'updating', 'live']);
  assert.equal(error, null);
  assert.ok(!headers.includes('offline'));
});

test('a real outage still says so after three failures in a row (about 5.5 s of quick asks plus the deadlines)', () => {
  let fails = 0, said = null;
  const e = { message: 'x', http: 503, server: true };
  for (let i = 0; i < 5 && said == null; i++) {
    fails += 1;
    if (C.quickRetryMs({ fails, offline: C.phoneOffline(e), liveAgeMs: null }) == null) said = fails;
  }
  assert.equal(said, C.FAILS_BEFORE_UNAVAILABLE);
  assert.equal(C.QUICK_RETRY_MS.reduce((a, b) => a + b, 0), 5500);
});

test('the trip deadline is comfortably past the server answer: TRIP_MS against the server constants', () => {
  const w = read('../backend/src/worker.js');
  const quick = Number((w.match(/const TRIP_QUICK_MS = (\d+);/) || [])[1]);
  const standIn = Number((w.match(/const TRIP_STANDIN_MS = (\d+);/) || [])[1]);
  assert.ok(quick > 0 && standIn > 0, 'the server constants are where this test reads them');
  assert.equal(N.SERVER_TRIP_ANSWER_MS, quick + standIn, 'the app knows the server wait');
  assert.ok(N.TRIP_MS - (quick + standIn) >= 4000, `TRIP_MS ${N.TRIP_MS} leaves at least 4 s over the server's ${quick + standIn} ms`);
});

test('one slow trip is a slow moment; the second marks the pair long, a 504 at once', () => {
  assert.equal(C.slowMakesLong(1, false), false);
  assert.equal(C.slowMakesLong(2, false), true);
  assert.equal(C.slowMakesLong(0, true), true);
  const a = read('src/lib/api.ts');
  assert.match(a, /slowMakesLong\(slowPairs\.get\(pair\) \|\| 0, e\?\.http === 504\)/);
  assert.match(a, /slowPairs\.delete\(pair\);/, 'an answer resets the count');
  assert.doesNotMatch(a, /if \(e\?\.slow \|\| e\?\.http === 504\) longPairs\.add\(pair\);/);
});

test('the poller takes a run\'s own next wait once (the quick ask), then the normal gap; nothing in the background', async () => {
  let t = 0, seq = 0; const q = new Map();
  const tm = { set: (fn, ms) => { const id = ++seq; q.set(id, { at: t + ms, fn }); return id; }, clear: (id) => q.delete(id), now: () => t };
  const advance = async (ms) => {
    const end = t + ms;
    for (;;) {
      let nx = null;
      for (const [id, x] of q) if (x.at <= end && (!nx || x.at < nx[1].at)) nx = [id, x];
      if (!nx) break;
      q.delete(nx[0]); t = nx[1].at; nx[1].fn();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    }
    t = end;
  };
  let n = 0, next = null; const ok = false;
  const p2 = P.createPoller(() => { n++; next = n === 1 ? 1500 : null; return ok; }, 15000, tm, { runAtStart: false, nextMs: () => { const v = next; next = null; return v; } });
  await advance(15000); assert.equal(n, 1);
  await advance(1499); assert.equal(n, 1);
  await advance(1); assert.equal(n, 2, 'quick ask 1.5 s after the failure, not the 30 s back off');
  await advance(29999); assert.equal(n, 2, 'then the normal back off, the quick ask not counted in it');
  await advance(1); assert.equal(n, 3);
  p2.setActive(false);
  next = 10;
  await advance(10 * 60000); assert.equal(n, 3, 'nothing while the app is away');
  p2.stop();
});

test('the commute card\'s trip for now: Home to Work in the morning, Work to Home after; none without both places', () => {
  const home = { id: '213510', name: 'Strathfield Station' }, work = { id: '201110', name: 'Kings Cross Station' };
  assert.deepEqual(C.commutePlanOf({ home, work }, 'toWork'), { from: home, to: work });
  assert.deepEqual(C.commutePlanOf({ home, work }, 'toHome'), { from: work, to: home });
  assert.equal(C.commutePlanOf({ home }, 'toWork'), null);
  assert.equal(C.commutePlanOf({ home, work: home }, 'toWork'), null);
  assert.equal(C.commutePlanOf(null, 'toWork'), null);
});

test('wiring: Home cards use the quick ask, the header uses homeHeader, the commute goes first, the card says Updating', () => {
  const h = read('src/lib/hooks.ts');
  // The quick ask comes before any error or offline label is set.
  const i = h.indexOf('quickRetryMs({'), j = h.indexOf('setError(String(e?.message || e));');
  assert.ok(i > 0 && j > i, 'quick ask decided before the error is shown');
  assert.match(h, /standInReaskMs\(d, standAsked\.current\)/);
  assert.match(h, /return run\(!plain\);/, 'a quick ask is a plain read (the server\'s saved live copy)');
  const home = read('src/components/Home.tsx');
  assert.match(home, /quick: true \}\);/);
  assert.match(home, /homeHeader\(\{ live: t, off, stale, pending \}\)/);
  assert.match(home, /reportPending\(key, pending \|\| retrying\)/);
  assert.match(home, /updatingText\(stampText\(staleAt, now\)\)/);
  assert.match(home, /retrying \? STAND_IN_UPDATING_NOTE : TIMETABLE_TRIPS_NOTE/);
  const lay = read('src/app/_layout.tsx');
  const w = lay.indexOf('warmCommute();'), r = lay.indexOf('setReady(true);');
  assert.ok(w > 0 && r > w, 'the commute request goes out before Home draws');
  const warm = read('src/lib/commuteWarm.ts');
  assert.match(warm, /planTrip\(plan, \{ refresh: false, count: 6, all: false \}\)/, 'the same request as the commute card, so it is shared');
  assert.match(home, /planTrip\(plan, \{ refresh: r, count: 6, all: chain && !!allServices \}\)/);
  assert.doesNotMatch(warm, /setInterval|setTimeout/, 'once per start, no timers');
});
