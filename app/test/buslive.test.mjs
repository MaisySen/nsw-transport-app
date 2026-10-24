// "Bus running 6 min late" on bus and coach legs.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-bus-'));
const src = fs.readFileSync(path.join(here, '..', 'src/lib/busLiveCore.ts'), 'utf8');
fs.writeFileSync(path.join(out, 'b.mjs'), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const b = await import(pathToFileURL(path.join(out, 'b.mjs')).href);

test('bus legs with live data say how late, early or on time', () => {
  assert.deepEqual(b.busLegStatus({ kind: 'transit', mode: 'bus', realtime: true, delayMin: 6 }), { text: 'Bus running 6 min late', tone: 'red' });
  assert.deepEqual(b.busLegStatus({ kind: 'transit', mode: 'bus', realtime: true, delayMin: 3 }), { text: 'Bus running 3 min late', tone: 'late' });
  assert.deepEqual(b.busLegStatus({ kind: 'transit', mode: 'bus', realtime: true, delayMin: -3 }), { text: 'Bus running 3 min early', tone: 'late' });
  assert.deepEqual(b.busLegStatus({ kind: 'transit', mode: 'bus', realtime: true, delayMin: 1 }), { text: 'Bus on time, live', tone: 'ok' });
  assert.equal(b.busLegStatus({ kind: 'transit', mode: 'coach', realtime: true, delayMin: 4 }).text, 'Coach running 4 min late');
  assert.equal(b.busLegStatus({ kind: 'transit', mode: 'bus', cancelled: true }).text, 'Bus cancelled');
});

test('nothing without live data, and nothing for trains, walks or other modes', () => {
  assert.equal(b.busLegStatus({ kind: 'transit', mode: 'bus', realtime: false, delayMin: 0 }), null);
  assert.equal(b.busLegStatus({ kind: 'transit', mode: 'bus', realtime: true, delayMin: null }), null);
  assert.equal(b.busLegStatus({ kind: 'transit', mode: 'train', realtime: true, delayMin: 6 }), null);
  assert.equal(b.busLegStatus({ kind: 'walk', mode: 'bus' }), null);
  assert.doesNotMatch(src, /[\u2013\u2014]/);
});
