// QA part A fixes: countdown chip for services that already left, one stop vs stops, deleted saved trips leave
// Home at once, a saved trip that is the commute, and Plan search results and no match lines.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-qaa-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const h = await load('src/lib/homeCore.ts');
const NOW = Date.parse('2026-10-24T22:42:00Z');
const hm = () => '10:44';

test('a service that left 18 minutes ago says Left, not Now', () => {
  assert.deepEqual(h.chipTime(NOW - 18 * 60000, NOW, hm), { big: 'Left', unit: '' });
  assert.deepEqual(h.chipTime(NOW - 30000, NOW, hm), { big: 'Now', unit: '' });
  assert.deepEqual(h.chipTime(NOW + 30000, NOW, hm), { big: 'Now', unit: '' });
  assert.deepEqual(h.chipTime(NOW + 13 * 60000, NOW, hm), { big: '13', unit: 'min' });
  assert.deepEqual(h.chipTime(NOW + 62 * 60000, NOW, hm), { big: '10:44', unit: '' });
  assert.deepEqual(h.chipTime(NaN, NOW, hm), { big: '', unit: '' });
});

test('one stop, two stops', () => {
  assert.equal(h.plural(1, 'stop'), '1 stop');
  assert.equal(h.plural(8, 'stop'), '8 stops');
  assert.equal(h.plural(1, 'more stop', 'more stops'), '1 more stop');
});

test('a saved trip deleted here is hidden until the server forgets it', () => {
  const d = h.makeDeletedNames(120000);
  const items = [{ name: 'Parra test' }, { name: 'Office' }];
  d.add('Parra test', NOW);
  assert.deepEqual(d.filter(items, NOW + 1000).map((x) => x.name), ['Office']);
  // Server caught up: the name is forgotten, so saving it again later shows it.
  assert.deepEqual(d.filter([{ name: 'Office' }], NOW + 2000).map((x) => x.name), ['Office']);
  assert.deepEqual(d.filter(items, NOW + 3000).map((x) => x.name), ['Parra test', 'Office']);
  // Expires either way.
  d.add('Office', NOW);
  assert.deepEqual(d.filter(items, NOW + 121000).map((x) => x.name), ['Parra test', 'Office']);
});

test('same ends either way round', () => {
  const A = { id: '213510' }, B = { id: '201110' }, C = { id: '200060' };
  assert.equal(h.sameEnds({ from: A, to: B }, { from: A, to: B }), true);
  assert.equal(h.sameEnds({ from: B, to: A }, { from: A, to: B }), true);
  assert.equal(h.sameEnds({ from: A, to: C }, { from: A, to: B }), false);
});

test('Plan shows results only while typing, and says when nothing matched', () => {
  assert.deepEqual(h.planResults([1, 2], 'Central Station', true), []);
  assert.deepEqual(h.planResults([1, 2], 'Cen', false), [1, 2]);
  assert.deepEqual(h.planResults([1, 2], 'C', false), []);
  assert.equal(h.noMatchText('xqzv', false, 0, false), 'No stops match that');
  assert.equal(h.noMatchText('Central', false, 0, true), "Can't search right now. Check your connection.");
  assert.equal(h.noMatchText('Central', true, 0, false), null);
  assert.equal(h.noMatchText('Central', false, 3, false), null);
  assert.equal(h.noMatchText('C', false, 0, false), null);
});
