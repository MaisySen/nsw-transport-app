// Stop boards: GET ON / GET OFF tags and route filter chips (stopBoardCore.ts).
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-stopboard-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const s = await load('src/lib/stopBoardCore.ts');
const stops = [{ id: '1' }, { id: '2046100', mine: true }, { id: '3' }, { id: '2046999' }, { id: '5' }];

test('GET ON and GET OFF only when opened from a trip or plan', () => {
  assert.deepEqual(s.boardAlight(stops, '2046100', null), { on: -1, off: -1 });
  assert.deepEqual(s.boardAlight(stops, '2046100', '2046999'), { on: 1, off: 3 });
});

test('the server alight flag wins; the from id stands in for mine', () => {
  const a = [{ id: '1' }, { id: '2' }, { id: '3', alight: true }, { id: '4' }];
  assert.deepEqual(s.boardAlight(a, '2', '4'), { on: 1, off: 2 });
  assert.deepEqual(s.boardAlight([{ id: '1' }, { id: '2' }, { id: '3' }], '1', '3'), { on: 0, off: 2 });
});

test('a get off stop before the get on stop (a loop route) is not tagged', () => {
  const loop = [{ id: '9' }, { id: '2', mine: true }, { id: '3' }];
  assert.deepEqual(s.boardAlight(loop, '2', '9'), { on: 1, off: -1 });
  assert.deepEqual(s.boardAlight([], '2', '9'), { on: -1, off: -1 });
});

test('route chips filter the board and drop a route the board no longer runs', () => {
  const items = [{ line: '410' }, { line: 'D400' }, { line: '410' }];
  assert.equal(s.byRoute(items, null).length, 3);
  assert.deepEqual(s.byRoute(items, '410').map((x) => x.line), ['410', '410']);
  assert.equal(s.keepRoute('410', [{ line: '410' }]), '410');
  assert.equal(s.keepRoute('461', [{ line: '410' }]), null);
  assert.equal(s.keepRoute(null, [{ line: '410' }]), null);
});

test('boardAsk: one mode only at a stop with several, when a mode or route chip is on', () => {
  const mixed = ['bus', 'train'];
  assert.equal(s.boardAsk(mixed, null, null, null), null);
  assert.equal(s.boardAsk(mixed, 'bus', null, null), 'bus');
  assert.equal(s.boardAsk(mixed, 'train', null, null), 'train');
  // A route chip is a bus, coach or school bus line: the board asks for buses.
  assert.equal(s.boardAsk(mixed, null, '415', null), 'bus');
  // The mode chip wins over the route.
  assert.equal(s.boardAsk(mixed, 'train', '415', null), 'train');
  // One mode here, a mode the stop does not serve, or another time: every mode, as before.
  assert.equal(s.boardAsk(['bus'], 'bus', '415', null), null);
  assert.equal(s.boardAsk([], 'bus', null, null), null);
  assert.equal(s.boardAsk(mixed, 'ferry', null, null), null);
  assert.equal(s.boardAsk(mixed, 'bus', null, 1815), null);
  assert.equal(s.boardAsk(['train', 'metro'], null, 'X1', null), null);
});

test('boardKey: a board for one mode is noted apart', () => {
  assert.equal(s.boardKey('206710'), '206710');
  assert.equal(s.boardKey('206710', null), '206710');
  assert.equal(s.boardKey('206710', 'bus'), '206710|bus');
});

test('modesServed: only a board for every mode changes the list; same list keeps its identity', () => {
  const all = { items: [{ mode: 'train' }, { mode: 'bus' }, { mode: 'train' }] };
  const a = s.modesServed([], all);
  assert.deepEqual(a, ['train', 'bus']);
  assert.equal(s.modesServed(a, all), a);
  assert.equal(s.modesServed(a, { askedMode: 'bus', items: [{ mode: 'bus' }] }), a);
  assert.equal(s.modesServed(a, null), a);
  assert.deepEqual(s.modesServed(a, { items: [{ mode: 'bus' }] }), ['bus']);
});
