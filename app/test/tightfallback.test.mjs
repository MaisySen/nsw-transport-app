// Tight change fallback (27 Oct 2026): a via trip joined on the phone (lib/trips.ts planTrip) calls its change tight
// with the same rule as the trip rows and the server (lib/tightChangeCore.ts, tightChangeAt in worker.js), with the
// person's own change time as a floor: tight under their minutes or under the rule, whichever is longer.
// Run: TZ=Australia/Sydney OFFLINE=1 node --test test/tightfallback.test.mjs
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
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-tightfallback-'));
async function load(rel, name) {
  const js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  fs.writeFileSync(path.join(out, name), js);
  return import(pathToFileURL(path.join(out, name)).href);
}
const TC = await load('src/lib/tightChangeCore.ts', 'tightChangeCore.mjs');

const min = 60000;
const base = Date.parse('2026-10-27T00:00:00+11:00');
const iso = (m) => new Date(base + m * min).toISOString();
const leg = (o) => ({ kind: 'transit', ...o });

test('train to bus with 4 min to change is tight even when the person allows 2', () => {
  const legs = [leg({ mode: 'train', stopId: 'A1', toStopId: 'A2', planned: iso(0), arrPlanned: iso(10) }), leg({ mode: 'bus', stopId: 'B1', toStopId: 'B2', planned: iso(14), arrPlanned: iso(30) })];
  assert.equal(TC.tightOrOwn(legs, 1, 4, 2), true);
  assert.equal(TC.tightOrOwn(legs, 1, 4, 2), !!TC.changeAt(legs, 1) || 4 < 2);
});

test('the person\'s own time is a floor: same platform, 4 min, they allow 6', () => {
  const legs = [leg({ mode: 'train', stopId: 'A1', toStopId: 'A2', planned: iso(0), arrPlanned: iso(10) }), leg({ mode: 'train', stopId: 'A2', toStopId: 'A3', planned: iso(14), arrPlanned: iso(30) })];
  assert.equal(TC.changeAt(legs, 1), null);
  assert.equal(TC.tightOrOwn(legs, 1, 4, 3), false);
  assert.equal(TC.tightOrOwn(legs, 1, 4, 6), true);
});

test('a walk in the change counts: walk 4 plus 2 wants 6', () => {
  const legs = [leg({ mode: 'train', stopId: 'A1', toStopId: 'A2', planned: iso(0), arrPlanned: iso(10) }), { kind: 'walk', durationMin: 4 }, leg({ mode: 'train', stopId: 'C1', toStopId: 'C2', planned: iso(15), arrPlanned: iso(30) })];
  assert.equal(TC.tightOrOwn(legs, 2, 5, 0), true);
  const roomy = legs.map((l, i) => (i === 2 ? { ...l, planned: iso(16) } : l));
  assert.equal(TC.tightOrOwn(roomy, 2, 6, 5), false);
});

test('nothing to tell: no legs, an unknown index or missing times fall back to the person\'s time alone', () => {
  assert.equal(TC.tightOrOwn(null, 1, 3, 5), true);
  assert.equal(TC.tightOrOwn([], 1, 6, 5), false);
  assert.equal(TC.tightOrOwn([leg({ mode: 'train' }), leg({ mode: 'bus' })], 1, 9, 5), false);
});

test('a cancelled service is never called tight by the rule', () => {
  const legs = [leg({ mode: 'train', stopId: 'A1', toStopId: 'A2', planned: iso(0), arrPlanned: iso(10) }), leg({ mode: 'bus', stopId: 'B1', planned: iso(12), arrPlanned: iso(30), cancelled: true })];
  assert.equal(TC.tightOrOwn(legs, 1, 2, 0), false);
});

test('lib/trips.ts joins via trips with the rule, not only the change time', () => {
  const s = read('src/lib/trips.ts');
  assert.match(s, /import \{ tightOrOwn \} from '\.\/tightChangeCore';/);
  assert.match(s, /risk: tightOrOwn\(legs, a\.legs\.length \+ legs2\.indexOf\(f2\), gap, conn \/ 60000\) \? 'tight' : ''/);
  assert.doesNotMatch(s, /risk: gap < conn \/ 60000 \? 'tight'/);
  // The transfer keeps its shape for the trip screen: minutes, at, risk.
  assert.match(s, /f2\.transfer = \{ minutes: gap, at: t\.via\.name, risk: /);
});

test('no dashes and no station names in the new code', () => {
  // owner-stations: guard (checks the names are absent from the code)
  for (const f of ['src/lib/tightChangeCore.ts', 'test/tightfallback.test.mjs']) assert.doesNotMatch(read(f), /[\u2013\u2014]/, f);
  assert.doesNotMatch(read('src/lib/tightChangeCore.ts'), /Strathfield|Central|Town Hall|Kings Cross|Parramatta/);
});
