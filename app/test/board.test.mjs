// Departure board: rows, big times, platform words and how many rows fit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require(path.join(here, '..', 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-board-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const b = await load('src/lib/boardCore.ts');
const NOW = Date.parse('2026-10-24T21:00:00Z'); // 8:00am Sydney
const iso = (m) => new Date(NOW + m * 60000).toISOString();

test('platform words', () => {
  assert.equal(b.platformLabel('Platform 3'), 'Plat 3');
  assert.equal(b.platformLabel('platform 12A'), 'Plat 12A');
  assert.equal(b.platformLabel('Stand B'), 'Stand B');
  assert.equal(b.platformLabel(null), '');
});

test('big time: Now, minutes, then the clock', () => {
  assert.deepEqual(b.boardTime(NOW + 30000, NOW), { when: 'Now', unit: '' });
  assert.deepEqual(b.boardTime(NOW + 4 * 60000 + 59000, NOW), { when: '4', unit: 'min' });
  assert.deepEqual(b.boardTime(NOW + 75 * 60000, NOW), { when: '9:15am', unit: '' });
  assert.deepEqual(b.boardTime(NaN, NOW), { when: '', unit: '' });
});

test('rows: live time first, gone services out, soonest first, capped', () => {
  const items = [
    { line: 'T1', mode: 'train', dest: 'Penrith Station', platform: 'Platform 4', planned: iso(2), estimated: iso(6), realtime: true, tripId: 'a' },
    { line: 'T9', mode: 'train', dest: 'Hornsby', platform: 'Platform 1', planned: iso(3), realtime: false, tripId: 'b' },
    { line: 'T2', mode: 'train', dest: 'Leppington', planned: iso(-2), estimated: iso(-1), realtime: true, tripId: 'c' },
    { line: '400', mode: 'bus', dest: 'Bondi Junction', platform: 'Stand C', planned: iso(1), realtime: true, estimated: iso(1), cancelled: true, tripId: 'd' },
  ];
  const r = b.boardRows(items, NOW);
  assert.deepEqual(r.map((x) => x.line), ['400', 'T9', 'T1']);
  assert.equal(r[2].dest, 'Penrith');
  assert.equal(r[2].when, '6');
  assert.equal(r[2].live, true);
  assert.equal(r[1].live, false);
  assert.equal(r[0].cancelled, true);
  assert.equal(r[0].live, false);
  assert.equal(r[2].a11y, 'T1 to Penrith, platform 4, 6 minutes, live');
  assert.equal(r[1].a11y, 'T9 to Hornsby, platform 1, 3 minutes, scheduled');
  assert.equal(r[0].a11y, '400 to Bondi Junction, Stand C, cancelled');
  assert.equal(b.boardRows(items, NOW, 1).length, 1);
  assert.deepEqual(b.boardRows(items, NOW, 8, 'bus').map((x) => x.line), ['400']);
  for (const x of r) assert.doesNotMatch(x.a11y + x.when + x.platform, /[\u2013\u2014]/);
});

test('rows that fit', () => {
  assert.equal(b.rowsThatFit(800, 80, 100), 8);
  assert.equal(b.rowsThatFit(200, 80, 100), 3);
  assert.equal(b.rowsThatFit(3000, 80, 100), 12);
  assert.equal(b.rowsThatFit(0, 80, 100), 6);
});
