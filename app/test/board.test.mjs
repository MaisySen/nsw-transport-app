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
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
await load('src/lib/liveLabelCore.ts');
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
  assert.equal(r[1].a11y, 'T9 to Hornsby, platform 1, 3 minutes, timetable');
  assert.equal(r[0].a11y, '400 to Bondi Junction, Stand C, cancelled');
  assert.equal(b.boardRows(items, NOW, 1).length, 1);
  assert.deepEqual(b.boardRows(items, NOW, 8, 'bus').map((x) => x.line), ['400']);
  assert.deepEqual(r.map((x) => x.label), ['Cancelled', 'Timetable', 'Live']);
  for (const x of r) assert.doesNotMatch(x.a11y + x.when + x.platform, /[\u2013\u2014]/);
});

test('rows: a live time gone quiet says Not tracking and shows its timetable time, not a countdown', () => {
  const items = [{ line: 'T1', mode: 'train', dest: 'Penrith', planned: iso(4), estimated: iso(6), realtime: true, tripId: 'a', vehicle: { ageS: 400 } }];
  const [r] = b.boardRows(items, NOW);
  assert.equal(r.kind, 'stale');
  assert.equal(r.label, 'Not tracking');
  assert.equal(r.unit, '');
  assert.match(r.when, /^8:04am$/);
  assert.match(r.a11y, /not tracking, timetable 8:04am/);
});

test('stopping pattern: only a description that reads as one; stop lists summarised', () => {
  assert.equal(b.patternOf('Chatswood, then all stations to Central'), 'Chatswood, then all stations to Central');
  assert.equal(b.patternOf('City to Emu Plains or Richmond'), '');
  assert.equal(b.patternOf('Hornsby to North Shore via City'), '');
  assert.equal(b.patternOf('Limited stops to Parramatta'), 'Limited stops to Parramatta');
  assert.equal(b.patternOf(null), '');
  const stops = ['Chatswood Station, Platform 1', 'Epping Station, Platform 2', 'Cronulla Station, Platform 7', 'Central Station, Platform 18'].map((name) => ({ name }));
  assert.equal(b.stopsSummary(stops, 0), 'Epping, Cronulla and Central');
  assert.equal(b.stopsSummary(stops, 2), 'Central only');
  assert.equal(b.stopsSummary(stops, -1), '');
  assert.equal(b.stopsSummary(stops, 3), '');
  const long = Array.from({ length: 12 }, (_, i) => ({ name: `Stop ${i} Station` }));
  assert.equal(b.stopsSummary(long, 0), 'Stop 1, Stop 2, Stop 3, then 8 more to Stop 11');
  const items = [{ line: '44T2', mode: 'bus', dest: 'Central', planned: iso(5), realtime: false, description: 'Chatswood, then all stations to Central' }];
  assert.equal(b.boardRows(items, NOW)[0].pattern, 'Chatswood, then all stations to Central');
  assert.match(b.boardRows(items, NOW)[0].a11y, /stops: Chatswood, then all stations to Central$/);
});

test('board type size: grows with Dynamic Type, still fits rows, landscape uses the height', () => {
  assert.equal(b.boardScale(390, 844, 1), 39);
  assert.ok(b.boardScale(390, 844, 1.5) > 39);
  assert.ok(b.boardScale(390, 844, 3) <= Math.round(844 / 7.5));
  assert.equal(b.boardScale(844, 390, 1), 39);
  assert.ok(b.boardScale(844, 390, 2) <= 52, 'landscape keeps at least a few rows');
  assert.equal(b.boardScale(390, 844, NaN), 39);
  assert.equal(b.boardScale(390, 844, 0.8), 39, 'smaller text never shrinks the board');
});

test('rows that fit', () => {
  assert.equal(b.rowsThatFit(800, 80, 100), 8);
  assert.equal(b.rowsThatFit(200, 80, 100), 3);
  assert.equal(b.rowsThatFit(3000, 80, 100), 12);
  assert.equal(b.rowsThatFit(0, 80, 100), 6);
});
