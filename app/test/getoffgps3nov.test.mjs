// Get off now by the phone's own location (3 Nov 2026 prototype, OFF on this branch: GETOFF_GPS.on is false). Measured
// on the 3 Nov morning peak live feed (files day-3nov keep-testing-3nov.md): above ground the live rule was on time
// (15 to 75 s before the train reached the platform) 59% and late 21%; a simulated fix every 10 s with this rule was on
// time 75 to 85% and late 1 to 3%. These pin the rule and that nothing changes while it is off. Offline, no feeds.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-gps3nov-'));
async function load(rel) {
  const js = ts.transpileModule(fs.readFileSync(path.join(root, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const G = await load('src/lib/getOffGpsCore.ts');
const T = await load('src/lib/tripState.ts');

// A stop and points due south of it at a given distance (1 degree of latitude is about 111.2 km).
const STOP = { lat: -33.85, lon: 151.0 };
const south = (m, dx = 0) => ({ lat: STOP.lat - m / 111195, lon: STOP.lon + dx / (111195 * Math.cos((STOP.lat * Math.PI) / 180)) });
const fix = (m, at, acc = 15, dx = 0) => ({ ...south(m, dx), acc, at });
const t0 = 1_793_700_000_000;

test('off on this branch, and only the open app passes fixes (the server and locked phone are unchanged)', () => {
  assert.equal(G.GETOFF_GPS.on, false);
  const eng = read('src/lib/liveEngine.ts');
  assert.match(eng, /if \(GETOFF_GPS\.on\) fixes = /);
  assert.match(eng, /\.\.\.\(GETOFF_GPS\.on \? \{ gpsAt: /);
  const calc = read('src/lib/liveCalc.ts');
  assert.match(calc, /if \(typeof flow\.gpsAt === 'function'\)/);
  assert.doesNotMatch(calc, /from '\.\/getOffGpsCore'/, 'liveCalc imports nothing new');
  assert.doesNotMatch(read('src/lib/tripState.ts'), /from '\.\/getOffGpsCore'/, 'tripState stays pure: it only reads env.gps');
});

test('due: a fresh fix under 500 m from the stop, moving towards it at 3 m/s or more', () => {
  assert.equal(Math.round(G.distM(south(500), STOP)), 500);
  assert.equal(G.gpsGetOffDue([fix(700, t0), fix(480, t0 + 10000)], STOP, t0 + 11000), true);
  assert.equal(G.gpsGetOffDue([fix(800, t0), fix(560, t0 + 10000)], STOP, t0 + 11000), false, 'still 560 m out');
  assert.equal(G.gpsGetOffDue([fix(420, t0), fix(410, t0 + 10000)], STOP, t0 + 11000), false, 'dwelling at a close stop before (1 m/s)');
  assert.equal(G.gpsGetOffDue([fix(480, t0 + 10000)], STOP, t0 + 11000), false, 'one fix gives no speed');
  assert.equal(G.gpsGetOffDue([fix(700, t0), fix(480, t0 + 10000)], STOP, t0 + 31000), false, 'a fix 21 s old says nothing about now');
  assert.equal(G.gpsGetOffDue([fix(700, t0), fix(480, t0 + 40000)], STOP, t0 + 41000), false, 'fixes 40 s apart give no speed');
  assert.equal(G.gpsGetOffDue([fix(300, t0), fix(480, t0 + 10000)], STOP, t0 + 11000), false, 'moving away (past the stop)');
  assert.equal(G.gpsGetOffDue([fix(700, t0), fix(480, t0 + 10000, 150)], STOP, t0 + 11000), false, 'a 150 m guess is not used');
  assert.equal(G.gpsGetOffDue([fix(700, t0), fix(480, t0 + 10000)], null, t0 + 11000), false, 'no stop coordinates');
});

test('gpsStep gives the trip state due, hold and the distance', () => {
  const g = G.gpsStep([fix(700, t0), fix(480, t0 + 10000)], STOP, t0 + 11000);
  assert.equal(g.due, true); assert.equal(g.hold, false); assert.equal(Math.round(g.d), 480);
  assert.deepEqual(G.gpsStep([], STOP, t0), { due: false, hold: false, d: null });
});

test('hold: a fresh fix over 800 m out keeps the live rule waiting (a creeping live arrival rang 2 min early)', () => {
  assert.equal(G.gpsHoldsLive([fix(1200, t0)], STOP, t0 + 5000), true);
  assert.equal(G.gpsHoldsLive([fix(700, t0)], STOP, t0 + 5000), false);
  assert.equal(G.gpsHoldsLive([fix(1200, t0)], STOP, t0 + 25000), false, 'stale: the live rule decides');
  assert.equal(G.gpsHoldsLive([fix(1200, t0, 300)], STOP, t0 + 5000), false, 'imprecise (a tunnel, a cell guess): the live rule decides');
});

test('fixes kept: newest last, precise only, in time order, at most 4', () => {
  let k = [];
  for (let i = 0; i < 6; i++) k = G.keepFix(k, fix(1000 - i * 100, t0 + i * 10000));
  assert.equal(k.length, 4);
  assert.equal(k[3].at, t0 + 50000);
  assert.equal(G.keepFix(k, fix(100, t0 + 60000, 250)).length, 4, 'imprecise one dropped');
  assert.equal(G.keepFix(k, fix(100, t0 + 60000, 250))[3].at, t0 + 50000);
  assert.equal(G.keepFix(k, fix(100, t0 + 20000))[3].at, t0 + 50000, 'an older fix arriving late is not kept');
  assert.deepEqual(G.keepFix(null, null), []);
});

test('a replayed approach: a fix every 10 s with 20 m of error rings 15 to 75 s before the train stops', () => {
  // 20 m/s until 400 m out, then braking at 0.5 m/s2 to a stop (40 s): the train stops at tStop.
  const tStop = t0 + 300000;
  const distAt = (t) => { const s = (tStop - t) / 1000; return s <= 40 ? 0.25 * s * s : 400 + (s - 40) * 20; };
  for (const phase of [0, 2500, 5000, 7500]) {
    let k = [], rang = null;
    for (let t = t0 + phase, i = 0; t < tStop + 30000; t += 10000, i++) {
      const err = [20, -20, 10, -10][i % 4];
      k = G.keepFix(k, fix(distAt(t) + err, t, 20, err));
      if (G.gpsGetOffDue(k, STOP, t + 1000)) { rang = t + 1000; break; }
    }
    assert.ok(rang != null, `rang (phase ${phase})`);
    const lead = (tStop - rang) / 1000;
    assert.ok(lead >= 15 && lead <= 75, `${lead} s before the stop (phase ${phase})`);
  }
});

// the trip state: a sample trip (not the owner's stations), on board, live arrival 7:59:00 (the live rule rings 7:58:22)
const at = (hm) => Date.parse(`2026-11-03T${hm}+11:00`);
const iso = (hm) => new Date(at(hm)).toISOString();
const leg = { mode: 'train', line: 'T1', tripId: 'T1-1950', stopId: 'LID7', toStopId: 'CLY', from: 'Lidcombe Station', to: 'Clyde Station', planned: iso('19:50:00'), arrPlanned: iso('19:55:00'), fromPlatform: 'Platform 7' };
const svc = (cly) => ({ kind: 'service', tripId: 'T1-1950', line: 'T1', live: true, mineIndex: 0, alightIndex: 2, stops: [
  { id: 'LID7', name: 'Lidcombe Station', planned: iso('19:50:00'), estimated: iso('19:51:00'), platform: 'Platform 7', passed: true },
  { id: 'AUB', name: 'Auburn Station', planned: iso('19:53:00'), estimated: iso('19:54:00'), passed: true },
  { id: 'CLY', name: 'Clyde Station', planned: iso('19:55:00'), estimated: iso(cly) },
] });
function run(steps) {
  const plan = T.tripPlanFrom([leg], [svc('19:59:00')]);
  const M = T.newTripMemory(plan);
  M.legs[0].phase = T.PHASE_INDEX.onTheWay; M.legs[0].rung.headsup = at('19:57:00');
  const rings = [];
  for (const [hm, gps] of steps) {
    const t = at(hm);
    const snap = T.tripReadingFrom(plan, [leg], [svc('19:59:00')], t - 3000);
    const r = T.tripStep(plan, M, t, snap, gps === undefined ? { lead: 0 } : { lead: 0, gps });
    for (const x of r.moments) rings.push([hm, x.ring.kind]);
  }
  return { rings, M };
}

test('without env.gps the trip state is as before: Get off now at the live arrival less 38 s', () => {
  assert.deepEqual(run([['19:57:30'], ['19:58:21'], ['19:58:22']]).rings, [['19:58:22', 'getoff']]);
});

test('env.gps due rings Get off now at once, once, and the live rule then has nothing to ring', () => {
  const r = run([['19:57:30', { due: true, hold: false, d: 450 }], ['19:58:22'], ['19:58:30', { due: true, hold: false, d: 120 }]]);
  assert.deepEqual(r.rings, [['19:57:30', 'getoff']]);
  assert.match(r.M.legs[0].phaseWhy.getOff, /phone 450 m from Clyde and moving/);
});

test('env.gps hold keeps the live rule waiting while the phone is far; it rings when the hold ends', () => {
  const r = run([['19:58:22', { due: false, hold: true, d: 1100 }], ['19:58:30', { due: false, hold: true, d: 900 }], ['19:58:37', { due: false, hold: false, d: 700 }]]);
  assert.deepEqual(r.rings, [['19:58:37', 'getoff']]);
});
