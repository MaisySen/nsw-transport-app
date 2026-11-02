// Mode chips with nothing to show (Plan, 2 Nov): a trip asked for one mode only (for example Metro from a city station
// to a western suburb no metro reaches) said only "No metro only trips". Now the screen says why in one line when the
// phone's own stop lists show it ("Metro doesn't go to Liverpool") and shows the fastest trip of any mode, one tap from
// Any. Pure logic: tripModesCore.ts (the words, the pick) and localSearchCore.ts (which modes stop at a place).
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-modeempty-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const m = await load('src/lib/tripModesCore.ts');
// localSearchCore imports askBrain (norm, aliases); both load the way localsearch.test.mjs loads them.
const src = fs.readFileSync(path.join(here, '..', 'src/lib/localSearchCore.ts'), 'utf8');
const tr = (f, to) => fs.writeFileSync(path.join(out, to), ts.transpileModule(fs.readFileSync(path.join(here, '..', 'src/lib', f), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from '\.\/askBrain'/g, "from './askBrain.mjs'"));
tr('askBrain.ts', 'askBrain.mjs');
tr('localSearchCore.ts', 'lscore.mjs');
const ls = await import(pathToFileURL(path.join(out, 'lscore.mjs')).href);
const ST = path.join(here, '..', '..', 'backend', 'src', 'public', 'stations');
const list = (n) => JSON.parse(fs.readFileSync(path.join(ST, n + '.json'), 'utf8'));

const TRAIN = 1, METRO = 2, LRAIL = 4, FERRY = 9;
const A = { id: 'S1', name: 'Harbour Square', modes: [TRAIN, METRO] };
const B = { id: 'S2', name: 'Westfield Park', modes: [TRAIN] };

test('why: the chosen mode does not stop at the destination, said in one line with its name', () => {
  assert.equal(m.modesWhy(['metro'], A, B), "Metro doesn't go to Westfield Park");
  assert.equal(m.modesWhy(['metro', 'ferry'], A, B), "Metro and ferry don't go to Westfield Park");
  assert.equal(m.modesWhy(['lightrail'], B, A), "Light rail doesn't go to Harbour Square");
});

test('why: the chosen mode does not stop at the start', () => {
  assert.equal(m.modesWhy(['metro'], B, A), "Metro doesn't stop at Westfield Park");
});

test('why: nothing is claimed when the phone does not know, when bus is chosen, or when both ends have the mode', () => {
  assert.equal(m.modesWhy(['metro'], A, { id: 'x', name: 'Somewhere', modes: [] }), null);
  assert.equal(m.modesWhy(['metro'], A, { id: 'x', name: 'Somewhere' }), null);
  assert.equal(m.modesWhy(['metro'], A, null), null);
  assert.equal(m.modesWhy(['bus'], A, B), null, 'bus stops are not in the station lists, so a station with no bus listed proves nothing');
  assert.equal(m.modesWhy(['train'], A, B), null);
  assert.equal(m.modesWhy(['metro'], A, { ...A, id: 'S3', name: 'Harbour North' }), null, 'both ends have the metro: not provable from stop lists');
  assert.equal(m.modesWhy([], A, B), null);
});

const T0 = Date.parse('2026-11-02T09:00:00Z'); // 8:00pm Sydney
const iso = (min) => new Date(T0 + min * 60000).toISOString();
const J = (leave, arrive, lines, live = true) => ({ leave: iso(leave), board: iso(leave), arrive: iso(arrive), durationMin: arrive - leave, changes: lines.length - 1, live,
  legs: lines.map((l) => (l === 'walk' ? { kind: 'walk', mode: 'walk' } : { kind: 'transit', mode: l.startsWith('M') ? 'metro' : 'train', line: l })) });

test('fastest: the trip that gets there first, trips already gone left out (R3)', () => {
  const js = [J(-3, 40, ['T1']), J(2, 55, ['T2']), J(6, 48, ['T1']), J(10, 52, ['M1', 'T1'])];
  assert.equal(m.fastestTrip(js, T0, false), js[2]);
  assert.equal(m.fastestTrip([J(4, 50, ['T2']), J(9, 50, ['T1'])], T0, false).legs[0].line, 'T1', 'same arrival: the shorter ride');
  assert.equal(m.fastestTrip([J(-5, 30, ['T1'])], T0, false), null);
  assert.equal(m.fastestTrip([], T0, false), null);
  assert.equal(m.fastestTrip(null, T0, false), null);
});

test('fastest when arriving by a time: the one that leaves last', () => {
  const js = [J(2, 40, ['T1']), J(9, 41, ['T2']), J(5, 45, ['T1'])];
  assert.equal(m.fastestTrip(js, T0, true), js[1]);
});

test('the fastest trip as one line: lines, times and minutes; timetable times say so (R1)', () => {
  const fmt = (t) => { const d = new Date(t + 11 * 3600000); const h = d.getUTCHours(); return `${((h + 11) % 12) + 1}:${String(d.getUTCMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; };
  const a = m.fastestWords(J(6, 48, ['walk', 'T1']), fmt);
  assert.equal(a.title, 'T1');
  assert.equal(a.line, '8:06pm to 8:48pm · 42 min');
  assert.match(a.a11y, /^Fastest trip, T1, leaves 8:06pm, arrives 8:48pm, 42 min/);
  const b = m.fastestWords(J(10, 52, ['M1', 'T1'], false), fmt);
  assert.equal(b.title, 'M1, then T1');
  assert.equal(b.line, '8:10pm to 8:52pm · 42 min · timetable');
  const w = m.fastestWords(J(1, 21, ['walk']), fmt);
  assert.equal(w.title, 'Walk');
});

test('the empty state: the reason as the title when known, the old words otherwise', () => {
  const k = m.modesEmptyState(['metro'], true, "Metro doesn't go to Westfield Park", true);
  assert.equal(k.title, "Metro doesn't go to Westfield Park");
  assert.equal(k.body, 'The fastest trip right now:');
  const n = m.modesEmptyState(['metro'], true, "Metro doesn't go to Westfield Park", false);
  assert.equal(n.body, 'Tap Any for other ways to get there.');
  const o = m.modesEmptyState(['bus'], true, null, false);
  assert.deepEqual(o, { ...m.emptyModes(['bus'], true) });
  const f = m.modesEmptyState(['bus'], true, null, true);
  assert.equal(f.title, 'No bus only trips');
  assert.equal(f.body, 'No bus-only trips at this time. The fastest trip right now:');
});

test('which modes stop at a place, from the stop lists on the phone: by id, or by the station name (one station, several ids)', async () => {
  assert.match(src, /export function placeModes\(/);
  const idx = ls.buildLocalIndex({ train: [['100', 'Westfield Park Station'], ['200', 'Harbour Square Station']], metro: [['201', 'Harbour Square Station']], lightrail: [], ferry: [] }, [['900', 'Some Rd at Bend St']]);
  assert.deepEqual(ls.placeModes(idx, { id: '100', name: 'Westfield Park Station' }), [TRAIN]);
  assert.deepEqual(ls.placeModes(idx, { id: '200', name: 'Harbour Square Station' }).sort(), [TRAIN, METRO]);
  assert.deepEqual(ls.placeModes(idx, { id: 'zzz', name: 'Harbour Square' }).sort(), [TRAIN, METRO], 'by the name when the id is another one');
  assert.equal(ls.placeModes(idx, { id: 'coord:1', name: '12 Smith St' }), null, 'an address: unknown');
  assert.equal(ls.placeModes(idx, { id: '900', name: 'Some Rd at Bend St' }), null, 'a bus stop: the lists cannot say which station modes are near');
  assert.equal(ls.placeModes(null, { id: '100', name: 'x' }), null);
});

test('the real stop lists: no metro at Liverpool, metro at Martin Place, so the 2 Nov screen says why', () => {
  const idx = ls.buildLocalIndex({ train: list('train'), metro: list('metro'), lightrail: list('lightrail'), ferry: list('ferry') }, []);
  const find = (name) => idx.stations.find((x) => x.name === name);
  const liv = find('Liverpool Station'), mp = find('Martin Place Station');
  assert.ok(liv && mp, 'both stations are in the lists');
  const to = { id: liv.id, name: 'Liverpool', modes: ls.placeModes(idx, liv) };
  const from = { id: mp.id, name: 'Martin Place', modes: ls.placeModes(idx, mp) };
  assert.ok(from.modes.includes(METRO));
  assert.equal(m.modesWhy(['metro'], from, to), "Metro doesn't go to Liverpool");
  assert.equal(m.modesWhy(['train'], from, to), null);
});

test('the trip screen uses it: reason, fastest trip card with one tap to Any, asked without modes, offline safe', () => {
  const s = fs.readFileSync(path.join(here, '..', 'src/app/trip.tsx'), 'utf8');
  assert.match(s, /modesEmptyState\(/);
  assert.match(s, /modesWhy\(/);
  assert.match(s, /fastestTrip\(/);
  assert.match(s, /placeModes\(/);
  assert.match(s, /accessibilityLabel=\{fw\.a11y\}/);
  // The Any question carries no modes and failures are swallowed (offline: the reason and the Any button still show).
  const ask = s.slice(s.indexOf('// Fastest of any mode'), s.indexOf('// Fastest of any mode') + 1600);
  assert.ok(ask.length > 100, 'the fastest-of-any-mode block is there');
  assert.doesNotMatch(ask.split('planTrip(')[1]?.split(')')[0] || '', /modes/);
  assert.match(ask, /\.catch\(/);
});
