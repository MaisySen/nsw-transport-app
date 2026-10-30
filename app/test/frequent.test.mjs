// Every N minutes for frequent lines (frequentCore.ts, 30 Oct) and its place on the stop board.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-frequent-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  // Relative imports get the .mjs the side by side files have.
  fs.writeFileSync(f, js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'"));
  return import(pathToFileURL(f).href);
}
// frequentCore imports boardTimeCore (which imports tripModesCore) and format: transpile them side by side.
await load('src/lib/tripModesCore.ts');
await load('src/lib/boardTimeCore.ts');
await load('src/lib/format.ts');
const f = await load('src/lib/frequentCore.ts');

const NOW = Date.parse('2026-10-30T08:00:00+11:00');
const at = (min) => new Date(NOW + min * 60000).toISOString();
const dep = (line, dest, min, extra = {}) => ({ line, mode: 'metro', color: '#168388', dest, planned: at(min), realtime: false, stopId: 's1', ...extra });

test('a line every 4 min in the next half hour gets one line', () => {
  const items = [0.5, 4.5, 8.5, 12.5, 16.5].map((m) => dep('M1', 'Tallawong Station, Sydney', m));
  const r = f.frequentLines(items, NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].text, 'Every 4 min');
  assert.equal(r[0].dest, 'Tallawong Station');
  assert.equal(r[0].label, 'M1 to Tallawong Station, every 4 minutes');
});

test('uneven gaps say the range, rounded to whole minutes', () => {
  const items = [1, 4, 9, 12.2].map((m) => dep('L2', 'Randwick', m, { mode: 'lightrail' }));
  const r = f.frequentLines(items, NOW);
  assert.equal(r[0].text, 'Every 3 to 5 min');
  assert.equal(r[0].lo, 3);
  assert.equal(r[0].hi, 5);
});

test('live times are the ones counted, like the rows', () => {
  const items = [2, 6, 10, 14].map((m) => dep('M1', 'Tallawong', m, { realtime: true, estimated: at(m + (m === 6 ? 2 : 0)) }));
  assert.equal(f.frequentLines(items, NOW)[0].text, 'Every 2 to 6 min');
  // A live time ignored when the row is not live (realtime false), as on the board.
  const tt = [2, 6, 10, 14].map((m) => dep('M1', 'Tallawong', m, { realtime: false, estimated: at(m + 30) }));
  assert.equal(f.frequentLines(tt, NOW)[0].text, 'Every 4 min');
});

test('fewer than 4 services, a gap over 10 min, or a late first service show nothing', () => {
  assert.deepEqual(f.frequentLines([1, 5, 9].map((m) => dep('M1', 'Tallawong', m)), NOW), []);
  assert.deepEqual(f.frequentLines([1, 5, 17, 21].map((m) => dep('M1', 'Tallawong', m)), NOW), []);
  assert.deepEqual(f.frequentLines([12, 15, 18, 21, 24].map((m) => dep('M1', 'Tallawong', m)), NOW), []);
});

test('only the next 30 minutes count', () => {
  const items = [1, 5, 9, 31, 35, 39].map((m) => dep('M1', 'Tallawong', m));
  assert.deepEqual(f.frequentLines(items, NOW), []);
});

test('cancelled, gone and departed services are left out', () => {
  const base = [1, 5, 9, 13].map((m) => dep('M1', 'Tallawong', m));
  assert.equal(f.frequentLines(base, NOW).length, 1);
  assert.deepEqual(f.frequentLines(base.map((d, i) => (i === 1 ? { ...d, cancelled: true } : d)), NOW), []);
  assert.deepEqual(f.frequentLines(base.map((d, i) => (i === 0 ? { ...d, departed: true } : d)), NOW), []);
  const gone = [dep('M1', 'Tallawong', -3), ...[1, 5, 9].map((m) => dep('M1', 'Tallawong', m))];
  assert.deepEqual(f.frequentLines(gone, NOW), []);
});

test('each direction is its own line, and one service seen twice counts once', () => {
  const a = [1, 5, 9, 13].map((m) => dep('M1', 'Tallawong', m));
  const b = [2, 6, 10, 14].map((m) => dep('M1', 'Sydenham', m));
  const twice = [...a, { ...a[0], stopId: 's2' }];
  const r = f.frequentLines([...twice, ...b], NOW);
  assert.deepEqual(r.map((x) => x.dest), ['Tallawong', 'Sydenham']);
  assert.ok(r.every((x) => x.text === 'Every 4 min'));
});

test('at most 2 lines, soonest first; a board for another time shows none', () => {
  const lines = ['B1', '333', '380'].map((l, i) => [i + 1, i + 5, i + 9, i + 13].map((m) => dep(l, 'Bondi Beach', m, { mode: 'bus' }))).flat();
  const r = f.frequentLines(lines, NOW);
  assert.deepEqual(r.map((x) => x.line), ['B1', '333']);
  assert.deepEqual(f.frequentLines(lines, NOW, NOW + 3600000), []);
  assert.deepEqual(f.frequentLines(null, NOW), []);
});

test('no hard coded lines or stops in the module', () => {
  const src = fs.readFileSync(path.join(here, '..', 'src/lib/frequentCore.ts'), 'utf8');
  assert.doesNotMatch(src, /'(T\d|M1|L\d|F\d|B1|\d{3})'/);
  assert.doesNotMatch(src, /react-native|expo-/);
});

test('the stop board shows it above the list, Now only, with a switch and no tap', () => {
  const src = fs.readFileSync(path.join(here, '..', 'src/app/stop/[id].tsx'), 'utf8');
  assert.match(src, /frequentLines\(/);
  assert.match(src, /FREQUENT_LINES \?/);
  const i = src.indexOf('{freq.length ? (');
  const j = src.indexOf('{items.length ? (', i);
  assert.ok(i > 0 && j > i, 'frequent lines sit just above the departures list');
  assert.doesNotMatch(src.slice(i, j), /onPress|Pressable/);
  const feat = fs.readFileSync(path.join(here, '..', 'src/lib/features.ts'), 'utf8');
  assert.match(feat, /export const FREQUENT_LINES = true;/);
});
