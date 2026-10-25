// Usual lateness: query, cache key and words (usualCore.ts), and the quiet 404 hide in usual.ts.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-usual-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const u = await load('src/lib/usualCore.ts');

test('words come from the numbers: minutes, day type and part of the day', () => {
  assert.equal(u.usualText({ lateMin: 3, n: 24, dayType: 'weekday', band: 'mornings' }), 'Usually 3 min late on weekday mornings');
  assert.equal(u.usualText({ lateMin: 4, n: 9, dayType: 'weekend', band: null }), 'Usually 4 min late on weekends');
  assert.equal(u.usualText({ lateMin: 10, plus: true, n: 30, dayType: 'weekday', band: 'afternoons' }), 'Usually 10+ min late on weekday afternoons');
  assert.equal(u.usualText({ lateMin: 1, n: 30, dayType: 'weekday', band: 'evenings' }), 'Usually on time on weekday evenings');
  assert.equal(u.usualText({ lateMin: 0, n: 30, dayType: 'weekend', band: 'middle of the day' }), 'Usually on time on weekends around midday');
});

test('nothing when the answer is missing or does not add up', () => {
  assert.equal(u.usualText(null), null);
  assert.equal(u.usualText(undefined), null);
  assert.equal(u.usualText({ lateMin: 3, n: 7, dayType: 'weekday', band: 'mornings' }), null);
  assert.equal(u.usualText({ lateMin: 11, n: 30, dayType: 'weekday' }), null);
  assert.equal(u.usualText({ lateMin: -1, n: 30, dayType: 'weekday' }), null);
  assert.equal(u.usualText({ lateMin: 2.5, n: 30, dayType: 'weekday' }), null);
  assert.equal(u.usualText({ lateMin: 3, n: 30, dayType: 'sometimes' }), null);
  assert.equal(u.usualText({ lateMin: 3, n: 30, dayType: 'weekday', band: 'brunch' }), 'Usually 3 min late on weekdays');
});

test('query: transit legs with a line and stop only; at is the timetable time', () => {
  assert.equal(u.usualQuery(null), null);
  assert.equal(u.usualQuery({ kind: 'walk', line: '410', stopId: '1' }), null);
  assert.equal(u.usualQuery({ kind: 'transit', stopId: '1' }), null);
  assert.deepEqual(u.usualQuery({ kind: 'transit', line: '410', stopId: '2046100', planned: '2026-10-26T07:52:00+11:00' }), { line: '410', stopId: '2046100', at: '2026-10-26T07:52:00+11:00' });
  assert.deepEqual(u.usualQuery({ line: 'T1', stopId: '2135223', planned: 'soon' }), { line: 'T1', stopId: '2135223', at: undefined });
});

test('batch params and one cache entry per line, stop and hour', () => {
  const a = { line: '410', stopId: '2046100', at: '2026-10-26T07:52:00+11:00' };
  const b = { line: 'T1', stopId: '2135223', at: '2026-10-26T07:52:00+11:00' };
  assert.equal(u.usualParams([a, b]), 's=410~2046100&s=T1~2135223&at=2026-10-26T07%3A52%3A00%2B11%3A00');
  assert.equal(u.usualParams([a, { ...b, at: undefined }]), 's=410~2046100&s=T1~2135223');
  assert.equal(u.usualKey(a), u.usualKey({ ...a, at: '2026-10-26T07:05:00+11:00' }));
  assert.notEqual(u.usualKey(a), u.usualKey({ ...a, at: '2026-10-26T08:05:00+11:00' }));
});

test('usual.ts turns itself off for a server that answers 404 and is behind the usualLate flag', () => {
  const src = fs.readFileSync(path.join(here, '..', 'src/lib/usual.ts'), 'utf8');
  assert.match(src, /status === 404\) \{ missing\.add\(base\)/);
  assert.match(src, /useFlag\('usualLate'\)/);
  assert.match(src, /apiBase\(\)/);
  for (const f of ['src/app/stop/[id].tsx', 'src/app/service.tsx', 'src/app/trip.tsx']) {
    assert.match(fs.readFileSync(path.join(here, '..', f), 'utf8'), /useUsualText\(/, f);
  }
});
