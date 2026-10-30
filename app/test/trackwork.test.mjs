// Weekend trackwork card: the Thursday to Sunday window, the request, and the words on the card.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-tw-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const tw = await load('src/lib/trackworkCore.ts');

test('the card window is Thursday 6pm to the end of Sunday, Sydney time', () => {
  assert.equal(tw.inWindow(Date.parse('2026-10-29T06:59:00Z')), false); // Thu 5:59pm
  assert.equal(tw.inWindow(Date.parse('2026-10-29T07:00:00Z')), true); // Thu 6:00pm
  assert.equal(tw.inWindow(Date.parse('2026-10-30T23:00:00Z')), true); // Sat 10am
  assert.equal(tw.inWindow(Date.parse('2026-11-01T12:59:00Z')), true); // Sun 11:59pm
  assert.equal(tw.inWindow(Date.parse('2026-11-01T13:00:00Z')), false); // Mon 12:00am
  assert.equal(tw.inWindow(Date.parse('2026-10-27T23:00:00Z')), false); // Wed
});

test('a trip card reports its lines once each, no walking, from the services it shows', () => {
  const j = (...lines) => ({ legs: lines.map((l) => (l === 'walk' ? { kind: 'walk' } : { kind: 'transit', line: l })) });
  const r = tw.tripLinesOf('k', '206710', '200030', 'To work', [j('T1', 'walk', 'T4'), j('T2', 'T4'), j('T9'), j('M1')], 8);
  assert.deepEqual(r.lines, ['T1', 'T4', 'T2', 'T9']);
  assert.equal(r.h, 8);
});

test('the query has one entry per trip, trips without lines left out, at most 6', () => {
  const t = (f, lines) => ({ key: f, f, t: 'X', lines, name: f, h: 10 });
  const q = tw.trackworkQuery([t('1', ['T1', 'T4']), t('1', ['T1']), t('2', []), t('3', ['M1'])]);
  assert.equal(q, 't=1~X~T1.T4~10&t=3~X~M1~10');
  assert.equal(tw.trackworkQuery(Array.from({ length: 9 }, (_, i) => t(String(i), ['L1']))).split('&').length, 6);
});

test('rows only for affected trips, in Home order, with buses and the time added', () => {
  const trips = [{ key: 'a', f: '1', t: '2', lines: ['T4'], name: 'To work', h: 8 }, { key: 'b', f: '3', t: '4', lines: ['M1'], name: 'Gym', h: 10 }];
  const resp = { enabled: true, trips: [
    { f: '3', t: '4', affected: false, items: [], addedMin: null, buses: null },
    { f: '1', t: '2', affected: true, items: [{ id: 'x', title: 'Buses replace trains between Central and Bondi Junction.', url: 'https://transportnsw.info/x', lines: ['T4'], days: 'Sat and Sun' }], addedMin: 25, buses: { from: 'Central', to: 'Martin Place' } },
  ] };
  const rows = tw.trackworkRows(resp, trips);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'To work');
  assert.equal(rows[0].text, 'Sat and Sun: Buses replace trains between Central and Bondi Junction');
  assert.equal(rows[0].extra, 'Buses replace trains Central to Martin Place. Your trip takes about 25 min longer.');
  assert.deepEqual(tw.trackworkRows({ enabled: false, trips: resp.trips }, trips), []);
  assert.deepEqual(tw.trackworkRows(null, trips), []);
  const noExtra = tw.trackworkRows({ trips: [{ ...resp.trips[1], addedMin: 3, buses: null }] }, trips);
  assert.equal(noExtra[0].extra, null);
});

test('no dashes in the card words', () => {
  for (const f of ['src/lib/trackworkCore.ts', 'src/lib/trackwork.ts', 'src/lib/myLines.ts', 'src/components/Trackwork.tsx']) {
    assert.doesNotMatch(fs.readFileSync(path.join(here, '..', f), 'utf8'), /[\u2013\u2014]/, f);
  }
});
