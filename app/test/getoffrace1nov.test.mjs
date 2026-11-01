// Get off now timing race in the open app (1 Nov 2026, real-time harness S17a/S17b; files/day-1nov/rt-fix-harness.md).
// The open app's step at the exact Get off now moment (live arrival less 38 s) ran on the answers of the last 15 s
// refresh (liveEngine tickLive noFetch). An arrival that moved in the seconds before the moment, or in its own second,
// was not seen: Get off now rang on the old arrival (S17a: 160 s early, then "Held"), or after the train was in (S17b).
// Now (liveMomentCore.ts, liveEngine.ts) the step at a moment reads again (refresh=1&at=<moment>) and decides only on
// answers asked for at or after the moment; one timer, re-armed in one go; a moment during a refresh runs after it.
// Deterministic: an injected clock and timer queue, the case's own feed (app/sim), the app's real trip engine
// (tripState.ts tripStep), no real sleeps, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepare, snapshot } from '../sim/journeySim.mjs';
import { byId } from '../sim/cases.mjs';
import { makeRealEngine, BASE } from '../sim/realEngine.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '..');
const require = createRequire(import.meta.url);
const ts = require(path.join(app, 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-getoffrace-'));
async function load(rel) {
  const p = path.join(app, rel);
  assert.ok(fs.existsSync(p), `${rel} exists`);
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, ts.transpileModule(fs.readFileSync(p, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  return import(pathToFileURL(f).href);
}
const tripState = await load('src/lib/tripState.ts');

/** A clock and timer queue the test moves by hand (no real time passes). */
function fakeClock(t0) {
  let now = t0, seq = 0;
  const q = [];
  return {
    now: () => now,
    set: (fn, ms) => { const h = { at: now + Math.max(0, ms), fn, seq: seq++, live: true }; q.push(h); return h; },
    clear: (h) => { if (h) h.live = false; },
    // run every timer due up to t, in time order; leaky: true also runs cleared ones (a platform that runs a callback
    // after it was cleared), so a stale timer is only stopped by the timer's own generation check
    advance(t, o = {}) {
      for (;;) {
        const due = q.filter((h) => h.at <= t && (h.live || o.leaky) && !h.ran).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
        if (!due) break;
        now = Math.max(now, due.at); due.ran = true; due.fn();
      }
      now = Math.max(now, t);
    },
  };
}

test('liveMomentCore: a moment needs a read when the answers were asked for before it; the ask names the moment', async () => {
  const C = await load('src/lib/liveMomentCore.ts');
  assert.equal(C.momentNeedsRead(1000, 999), true, 'asked a moment before: read again');
  assert.equal(C.momentNeedsRead(1000, 1000), false, 'asked at the moment');
  assert.equal(C.momentNeedsRead(1000, 0), true, 'nothing asked yet');
  assert.equal(C.momentNeedsRead(null, 0), false, 'not a moment');
  assert.equal(C.momentMayStep(1000, 999), false);
  assert.equal(C.momentMayStep(undefined, 5), true);
  assert.deepEqual(C.momentQuery({ trip: 't', refresh: '1' }, 1234.7), { trip: 't', refresh: '1', at: '1234' });
  assert.deepEqual(C.momentQuery({ trip: 't' }, 1234), { trip: 't' }, 'a first ask (no answer held yet) is not a refresh: no moment');
  assert.deepEqual(C.momentQuery({ trip: 't', refresh: '1' }, null), { trip: 't', refresh: '1' });
  assert.equal(C.MOMENT_SLACK_MS, 50);
});

test('liveMomentCore: re-arming cancels and replaces in one go; a timer for an old moment never runs, even if the platform runs it', async () => {
  const C = await load('src/lib/liveMomentCore.ts');
  const ck = fakeClock(0);
  const ran = [];
  const T = C.makeMomentTimer(ck, (due) => ran.push([due, ck.now()]));
  T.arm(10000);
  T.arm(70000); // the arrival moved 60 s later in the same tick
  assert.equal(T.armedFor(), 70000);
  ck.advance(100000, { leaky: true });
  assert.deepEqual(ran, [[70000, 70050]], 'only the newest moment, 50 ms after it');
  T.arm(120000); T.arm(null);
  ck.advance(200000, { leaky: true });
  assert.equal(ran.length, 1, 'arm(null) cancels');
  const Q = C.makeMomentQueue();
  Q.hold(5); Q.hold(9); Q.hold(7);
  assert.equal(Q.take(), 9); assert.equal(Q.take(), null, 'handed over once');
});

test('liveEngine: the moment timer reads again before it decides (no step on the last refresh), one timer, a moment during a refresh is kept', () => {
  const src = fs.readFileSync(path.join(app, 'src/lib/liveEngine.ts'), 'utf8');
  assert.doesNotMatch(src, /setTimeout\(\(\) => \{ momentTimer = null; tickLive\(\{ noFetch: true \}\)/, 'the old moment step on the cached answers');
  assert.match(src, /makeMomentTimer\(/);
  assert.match(src, /momentTimer\.arm\(nextFlowMoment\(r\.g, r\.s, now\)\)/, 're-armed in one go from the newest step');
  assert.match(src, /tickLive\(\{ momentAt: due, noFetch: true \}\)/);
  assert.match(src, /momentNeedsRead\(opts\.momentAt, svcAskedAt\)/, 'reads again when the answers were asked before the moment');
  assert.match(src, /momentQuery\(liveServiceQuery\(/, 'the read names the moment (at=)');
  assert.match(src, /if \(busy\) \{ if \(opts\.momentAt != null\) momentQueue\.hold\(opts\.momentAt\); return; \}/, 'a moment during a refresh is kept');
  assert.match(src, /!momentMayStep\(opts\.momentAt, svcAskedAt\)\) return;/, 'never decided on answers from before the moment');
  assert.match(src, /if \(!failed\) svcAskedAt = asked;/);
});

// ---- the open app's loop on an injected clock: 15 s refreshes, the moment timer, the real trip engine ----
const engine = makeRealEngine(tripState);
const toMs = (s) => BASE + s * 1000;
const toS = (ms) => (ms - BASE) / 1000;
const hm = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60 * 10) / 10).padStart(2, '0')}`;

/**
 * Runs a case with the app open from start to end. Every refresh (and every moment read) is asked at one moment and
 * answered latencyMs later with the feed as it was when asked. policy 'fixed' is liveEngine with liveMomentCore;
 * 'old' is the step on the last refresh's answers at the moment (tickLive noFetch, before 1 Nov).
 */
async function runApp(id, { policy, phaseS = 0, latencyMs = 300 }) {
  const C = await load('src/lib/liveMomentCore.ts');
  const P = prepare(byId(id));
  const plan = engine.setup(P).plan;
  const M = tripState.newTripMemory(plan);
  const ck = fakeClock(toMs(P.start));
  const end = toMs(P.end);
  let reading = null, askedAt = 0, busy = false;
  const rings = [];
  const fetch = () => { const a = ck.now(); const snap = snapshot(P, Math.floor(toS(a))); return { a, snap }; };
  let timer;
  const step = () => {
    const t = ck.now();
    const res = tripState.tripStep(plan, M, t, reading, { lead: 0, reread: () => reading });
    for (const m of res.moments) rings.push({ t: toS(t), kind: m.ring.kind, arrAt: m.ring.arrAt != null ? toS(m.ring.arrAt) : null });
    // nextFlowMoment (liveCalc.ts): the Get off now moment when it is under 20 s away
    const li = M.current, ml = M.legs[li];
    let due = null;
    if (ml && !ml.rung.getoff && ml.phase < tripState.PHASE_INDEX.arrived) {
      const tm = tripState.tripLegTimes(plan, M, reading, li, t);
      if (tripState.isLiveTime(tm.arr)) { const at = tripState.getOffDueAt(tm.arr.at); if (at > t && at - t <= 20000) due = at; }
    }
    if (policy === 'fixed') timer.arm(due);
    else { timer.arm(due); }
  };
  // one refresh: asked now, answered latencyMs later (the clock moves while it is on its way)
  const refresh = (moment) => {
    busy = true;
    const { a, snap } = fetch();
    ck.set(() => {
      reading = engine.readingOf(P, snap); askedAt = a; busy = false;
      if (moment == null || C.momentMayStep(moment, askedAt)) step();
      const held = queue.take();
      if (held != null) onMoment(held);
    }, latencyMs);
  };
  const queue = C.makeMomentQueue();
  const onMoment = (due) => {
    if (busy) { queue.hold(due); return; }
    if (policy === 'old') { step(); return; } // before 1 Nov: the last refresh's answers
    if (C.momentNeedsRead(due, askedAt)) refresh(due); else step();
  };
  timer = C.makeMomentTimer(ck, onMoment);
  for (let t = toMs(P.start) + phaseS * 1000; t < end; t += 15000) ck.set(() => { if (!busy) refresh(null); }, t - ck.now());
  ck.advance(end + 60000);
  return { rings, getoffs: rings.filter((r) => r.kind === 'getoff' || r.kind === 'atstop') };
}

test('S17a in the open app: the arrival moves 7:59 to 8:01 at 7:58:20, in the second of the Get off now moment (7:58:22); Get off now follows the new arrival, never on the old one', async () => {
  const bad = [];
  for (let phaseS = 0; phaseS < 15; phaseS++) for (const latencyMs of [0, 120, 300, 900]) {
    const r = await runApp('S17a', { policy: 'fixed', phaseS, latencyMs });
    const g = r.getoffs;
    // 38 s before the 8:01 arrival (8:00:22), late only by the read (the next refresh at the latest)
    if (g.length !== 1 || g[0].kind !== 'getoff' || g[0].arrAt !== 72060 || g[0].t < 72022 || g[0].t > 72022 + 1 + latencyMs / 1000) bad.push(`refresh phase ${phaseS} s, ${latencyMs} ms answers: ${g.map((x) => `${x.kind} at ${hm(x.t)} for ${x.arrAt == null ? '?' : hm(x.arrAt)}`).join(', ') || 'none'}`);
  }
  assert.deepEqual(bad, []);
});

test('S17b in the open app: the arrival moves 40 s earlier at 7:58:05 (to 7:58:20); Get off now never rings on the old 7:59 arrival after the train is in', async () => {
  const bad = [];
  for (let phaseS = 0; phaseS < 15; phaseS++) for (const latencyMs of [0, 120, 300, 900]) {
    const r = await runApp('S17b', { policy: 'fixed', phaseS, latencyMs });
    const g = r.getoffs;
    const late = g.filter((x) => x.kind === 'getoff' && x.t >= 71900);
    const old = g.filter((x) => x.arrAt === 71940);
    if (g.length !== 1 || late.length || old.length) bad.push(`refresh phase ${phaseS} s, ${latencyMs} ms answers: ${g.map((x) => `${x.kind} at ${hm(x.t)} for ${x.arrAt == null ? '?' : hm(x.arrAt)}`).join(', ') || 'none'}`);
  }
  assert.deepEqual(bad, []);
});

test('the old moment step (on the last refresh) is what rang early: S17a rings at 7:58:22 for 7:59 on every refresh phase', async () => {
  // the failing-first shape, kept as a record of the bug: the same loop with the step on the cached answers
  let early = 0;
  for (let phaseS = 0; phaseS < 15; phaseS++) {
    const r = await runApp('S17a', { policy: 'old', phaseS, latencyMs: 300 });
    if (r.getoffs.some((x) => x.kind === 'getoff' && x.arrAt === 71940)) early++;
  }
  assert.ok(early >= 10, `old step rang on 7:59 in ${early} of 15 phases`);
});
