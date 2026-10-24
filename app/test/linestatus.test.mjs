// Status of my lines: which lines are asked about, the order shown, and the summary words.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-ls-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const ls = await load('src/lib/lineStatusCore.ts');
const trips = [
  { key: 'a', f: '1', t: '2', lines: ['T1', 'T4'], name: 'To work', h: 8, marks: { T1: { mode: 'train', color: '#F99D1C' }, T4: { mode: 'train' } } },
  { key: 'b', f: '3', t: '4', lines: ['T4', 'M1', '501'], name: 'Gym', h: 10, marks: { M1: { mode: 'metro' }, 501: { mode: 'bus' } } },
];

test('my lines: Home order, each once, with mode and colour, capped', () => {
  assert.deepEqual(ls.myLines(trips).map((x) => x.line), ['T1', 'T4', 'M1', '501']);
  assert.equal(ls.myLines(trips)[0].color, '#F99D1C');
  assert.equal(ls.myLines(trips, 2).length, 2);
});

test('rows: problems first, then good service, in Home order; nothing when stale, off or empty', () => {
  const mine = ls.myLines(trips);
  const resp = { enabled: true, items: [
    { line: 'T1', status: 'good', label: 'Good service', title: null, url: null, more: 0 },
    { line: 'T4', status: 'trackwork', label: 'Trackwork', title: 'Buses replace trains', url: 'https://x', more: 0 },
    { line: 'M1', status: 'suspended', label: 'Suspended', title: 'No metro', url: null, more: 0 },
    { line: '501', status: 'good', label: 'Good service', title: null, url: null, more: 0 },
  ] };
  assert.deepEqual(ls.lineRows(resp, mine).map((r) => r.line), ['M1', 'T4', 'T1', '501']);
  assert.equal(ls.lineRows(resp, mine)[0].mode, 'metro');
  assert.deepEqual(ls.lineRows({ ...resp, stale: true }, mine), []);
  assert.deepEqual(ls.lineRows({ ...resp, enabled: false }, mine), []);
  assert.deepEqual(ls.lineRows(null, mine), []);
  assert.equal(ls.summaryText(ls.lineRows(resp, mine)), '2 of your 4 lines have issues');
});

test('summary words', () => {
  for (const f of ['src/lib/lineStatusCore.ts', 'src/lib/lineStatus.ts', 'src/components/LineStatus.tsx']) assert.doesNotMatch(fs.readFileSync(path.join(here, '..', f), 'utf8'), /[\u2013\u2014]/, f);
  const g = (line) => ({ line, status: 'good', label: 'Good service', title: null, url: null, more: 0 });
  assert.equal(ls.summaryText([g('T1')]), 'Good service on your line');
  assert.equal(ls.summaryText([g('T1'), g('T4')]), 'Good service on all 2 of your lines');
  assert.equal(ls.summaryText([{ ...g('T1'), status: 'delays' }]), 'Your line has an issue');
  assert.equal(ls.summaryText([{ ...g('T1'), status: 'delays' }, g('T4')]), '1 of your 2 lines has an issue');
  assert.equal(ls.summaryText([]), '');
});
