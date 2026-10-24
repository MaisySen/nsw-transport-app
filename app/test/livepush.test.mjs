// What the app sends the server for trip card pushes (platform/livePushCore.ts).
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-livepush-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const m = await load('platform/livePushCore.ts');

const trip = {
  id: 't1', title: 'Home to Work', origin: { id: '213510', name: 'Strathfield', lat: 1 }, to: { id: '201110', name: 'Kings Cross Station', lon: 2 },
  legs: [
    { mode: 'train', line: 'T1', tripId: 'A.1', stopId: '2135223', toStopId: '2000336', from: 'Strathfield', to: 'Central', planned: '2026-10-25T08:10:00+11:00', estimated: null, color: '#F99D1C', walkBefore: 3, fromParent: '213510' },
    { mode: 'train', line: 'T4', tripId: 'B.2', stopId: '2000339', toStopId: '2011131', planned: '2026-10-25T08:26:00+11:00', towards: 'Bondi Junction' },
  ],
  fare: { adult: 4.2 }, started: 1, alerted: { a: 1 }, share: null, watchId: null, rode: { 0: 1761340000000 }, arrivedAt: null,
};

test('pushTrip keeps what the server needs and drops the rest', () => {
  const p = m.pushTrip(trip);
  assert.deepEqual(Object.keys(p).sort(), ['arrivedAt', 'id', 'legs', 'origin', 'rode', 'title', 'to']);
  assert.deepEqual(p.origin, { id: '213510', name: 'Strathfield' });
  assert.equal(p.legs.length, 2);
  assert.equal(p.legs[0].estimated, undefined);
  assert.equal(p.legs[0].walkBefore, undefined);
  assert.equal(p.legs[0].fromParent, undefined);
  assert.equal(p.legs[1].towards, 'Bondi Junction');
  assert.deepEqual(p.rode, { 0: 1761340000000 });
  assert.equal(p.arrivedAt, null);
});

test('pushKey changes with the token, a ridden leg and arrival, not with the clock', () => {
  const k = m.pushKey('ab'.repeat(32), trip);
  assert.equal(m.pushKey('ab'.repeat(32), { ...trip, alerted: { b: 1 } }), k);
  assert.notEqual(m.pushKey('cd'.repeat(32), trip), k);
  assert.notEqual(m.pushKey('ab'.repeat(32), { ...trip, rode: { 0: 1, 1: 2 } }), k);
  assert.notEqual(m.pushKey('ab'.repeat(32), { ...trip, arrivedAt: 5 }), k);
});

test('cleanToken accepts hex tokens only', () => {
  assert.equal(m.cleanToken(' AB'.trim() + 'cd'.repeat(31) + 'EF'), 'ab' + 'cd'.repeat(31) + 'ef');
  assert.equal(m.cleanToken('xyz'), null);
  assert.equal(m.cleanToken(null), null);
  assert.equal(m.cleanToken('ab'), null);
});

test('pushes go to the new server', () => {
  assert.equal(m.PUSH_BASE, 'https://api.transportsydney.app');
});
