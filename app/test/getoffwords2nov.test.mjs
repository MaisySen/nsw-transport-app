// 2 Nov 2026 (Bidur's first real build 214 trip, B4; Bidur OK 9:19 AM): the heads-up said "Arriving about 4:56am"
// from the stop's feed time, then Get off now said "arriving 4:55am" from the train's position. Two clocks a minute
// apart for one stop. Get off now's words now carry no clock time: the moment is now, and Arrived carries the real time.
// Generic stops (no real stations).
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-words2nov-'));
async function load(rel) {
  const js = ts.transpileModule(fs.readFileSync(path.join(root, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const T = await load('src/lib/tripState.ts');

const at = (hm) => Date.parse(`2026-11-02T${hm}+11:00`);
const iso = (hm) => new Date(at(hm)).toISOString();
const leg = { mode: 'train', line: 'L4', tripId: 'L4-0452', stopId: 'AST5', toStopId: 'COV2', from: 'Aston Station', to: 'Cove Station', planned: iso('04:52:00'), arrPlanned: iso('04:56:00'), fromPlatform: 'Platform 5' };
const svc = (cov) => ({ kind: 'service', tripId: 'L4-0452', line: 'L4', live: true, mineIndex: 0, alightIndex: 2, stops: [
  { id: 'AST5', name: 'Aston Station', planned: iso('04:52:00'), estimated: iso('04:52:30'), platform: 'Platform 5', passed: true },
  { id: 'MRT1', name: 'Marton Station', planned: iso('04:54:00'), estimated: iso('04:54:00'), passed: true },
  { id: 'COV2', name: 'Cove Station', planned: iso('04:56:00'), estimated: iso(cov) },
] });

function run(steps) {
  const plan = T.tripPlanFrom([leg], [svc('04:56:00')]);
  const M = T.newTripMemory(plan);
  M.legs[0].phase = T.PHASE_INDEX.onTheWay;
  const rings = [];
  for (const [hm, cov] of steps) {
    const t = at(hm);
    const r = T.tripStep(plan, M, t, T.tripReadingFrom(plan, [leg], [svc(cov)], t - 3000), { lead: 0 });
    for (const x of r.moments) rings.push({ at: hm, kind: x.ring.kind, title: x.ring.title, body: x.ring.body, say: x.ring.say || '' });
  }
  return rings;
}
const CLOCK = /\b\d{1,2}:\d{2}\s*(am|pm)?\b/i;

test('B4: heads-up keeps its "Arriving about" time, Get off now carries no clock time (no second, different clock)', () => {
  const r = run([['04:54:00', '04:56:00'], ['04:54:20', '04:55:05'], ['04:54:27', '04:55:05']]);
  const hu = r.find((x) => x.kind === 'headsup');
  const go = r.find((x) => x.kind === 'getoff');
  assert.ok(hu && go, JSON.stringify(r));
  assert.match(hu.body, /Arriving about 4:56/, 'the heads-up still says when');
  assert.equal(go.title, 'Get off now');
  assert.doesNotMatch(go.body, CLOCK, `Get off now body has a clock time: "${go.body}"`);
  assert.doesNotMatch(go.say, CLOCK, 'nor the spoken words');
  assert.match(go.body, /Cove/, 'it still names the stop');
});

test('B4: a change keeps its words ("change for the L9") and no clock', () => {
  const plan = T.tripPlanFrom([leg, { ...leg, line: 'L9', tripId: 'L9-0500', stopId: 'COV3', toStopId: 'END1', from: 'Cove Station', to: 'End Station', planned: iso('05:00:00'), arrPlanned: iso('05:06:00') }], [svc('04:56:00'), null]);
  const M = T.newTripMemory(plan);
  M.legs[0].phase = T.PHASE_INDEX.onTheWay;
  const rings = [];
  for (const hm of ['04:54:00', '04:55:22']) {
    const t = at(hm);
    for (const x of T.tripStep(plan, M, t, T.tripReadingFrom(plan, [leg, null], [svc('04:56:00'), null], t - 3000), { lead: 0 }).moments) rings.push(x.ring);
  }
  const go = rings.find((x) => x.kind === 'getoff');
  assert.ok(go, JSON.stringify(rings.map((x) => x.kind)));
  assert.match(go.body, /change for the L9/);
  assert.doesNotMatch(go.body, CLOCK);
});

test('B4: the phone\'s own backup Get off now (set ahead, rings while locked) has the same words, no clock time', () => {
  const src = fs.readFileSync(path.join(root, 'src/lib/liveEngine.ts'), 'utf8');
  const m = /scheduleGetOff\(backupId, b\.at, 'Get off now', `([^`]*)`/.exec(src);
  assert.ok(m, 'the backup alert is set');
  assert.equal(m[1], 'Get off now. ${off}.');
  // the journey simulator says the same (its server and backup rings)
  const sim = fs.readFileSync(path.join(root, 'sim/journeySim.mjs'), 'utf8');
  assert.doesNotMatch(sim, /Get off now\. \$\{[^}]+\}, arriving/);
});
