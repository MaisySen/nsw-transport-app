// QA pass B, 25 Oct: stop screen alerts, nearby folding and the Version row.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-qab-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}

const { topAlerts, rowNote, rowAlerts } = await load('src/lib/stopAlertsCore.ts');
const { foldNear } = await load('src/lib/nearCore.ts');
const { versionLine } = await load('src/lib/format.ts');

// Central on 25 Oct: lift alerts (low), a light rail note, then a generic station update every train refers to.
const board = [
  { id: 'lift', title: 'Central Station Lift 6 is not available', priority: 'low' },
  { id: 'lift2', title: 'Central Station Lift 6 is not available', priority: 'low' },
  { id: 'lr', title: 'Extra L2 and L3 light rail services run', priority: 'normal' },
  { id: 'upd', title: 'Station Update - Central', priority: 'normal' },
  { id: 'cc', title: 'City Circle: Trains do not run on the City Circle', priority: 'normal' },
  { id: 'bus', title: 'Leichhardt bus diversions', priority: 'normal' },
];
const trains = Array.from({ length: 6 }, () => ({ alerts: ['upd', 'lift', 'cc'] }));
const items = [...trains, { alerts: ['lr'] }, { alerts: ['bus'] }, { alerts: [] }];

test('top alerts are the ones on the most services, low priority last, each title once', () => {
  const top = topAlerts(board, items);
  assert.deepEqual(top.map((a) => a.id), ['upd', 'cc']);
  assert.deepEqual(topAlerts(board, items, 5).map((a) => a.id), ['upd', 'cc', 'lr', 'bus', 'lift']);
});

test('with no departures pointing at alerts the board order holds', () => {
  assert.deepEqual(topAlerts(board, []).map((a) => a.id), ['lr', 'upd']);
  assert.deepEqual(topAlerts(undefined, undefined), []);
  assert.deepEqual(topAlerts([{ id: 'x' }, { id: 'y', title: 'Only one' }], []).map((a) => a.id), ['y']);
});

test('with a mode filter only alerts those departures refer to show', () => {
  assert.deepEqual(topAlerts(board, [{ alerts: ['lr'] }], 2, true).map((a) => a.id), ['lr']);
  assert.deepEqual(topAlerts(board, [{ alerts: [] }], 2, true), []);
});

test('a row names only an alert the top does not show, never a low priority one', () => {
  const top = topAlerts(board, items);
  assert.equal(rowNote(['upd', 'lift', 'cc'], board, top), null);
  assert.equal(rowNote(['lr'], board, top), 'Extra L2 and L3 light rail services run');
  assert.equal(rowNote(['upd', 'bus'], board, top), 'Leichhardt bus diversions');
  assert.equal(rowNote([{ title: 'Inline alert', priority: 'normal' }], board, top), 'Inline alert');
  assert.equal(rowNote(['nope'], board, top), null);
  assert.equal(rowNote(undefined, board, top), null);
  assert.equal(rowAlerts(['lr', 'missing'], board).length, 1);
});

const cq = { id: '200020', name: 'Circular Quay Station', seg: 'Circular Quay', parent: true, modes: [1, 4, 5, 9], distance: 49 };
const cqlr = { id: '2000450', name: 'Circular Quay Light Rail', seg: 'Circular Quay Light Rail', parent: false, distance: 70 };

test('nearby: a mode stop at a station already listed folds into the station', () => {
  assert.deepEqual(foldNear([cq, cqlr]).map((p) => p.id), ['200020']);
  assert.deepEqual(foldNear([cqlr, cq]).map((p) => p.id), ['200020']);
});

test('nearby: a different stop that only shares the start of the name stays', () => {
  const parra = { id: '215020', name: 'Parramatta Station', seg: 'Parramatta Station', parent: true, modes: [1, 5, 7, 11] };
  const sq = { id: '2150132', name: 'Parramatta Square Light Rail', seg: 'Parramatta Square Light Rail', parent: false };
  const lr = { id: '9', name: 'Parramatta Light Rail', seg: 'Parramatta Light Rail', parent: false };
  // Parramatta Station lists no light rail, so its light rail stop is its own place.
  assert.deepEqual(foldNear([parra, sq, lr]).map((p) => p.id), ['215020', '2150132', '9']);
});

test('nearby: repeated ids show once and the list stops at max', () => {
  const a = { id: '1', name: 'A', seg: 'A', parent: false };
  const b = { id: '2', name: 'B', seg: 'B', parent: false };
  const c = { id: '3', name: 'C', seg: 'C', parent: false };
  assert.deepEqual(foldNear([a, a, b, c], 2).map((p) => p.id), ['1', '2']);
  assert.deepEqual(foldNear([]), []);
});

test('Version row: build and update when known', () => {
  assert.equal(versionLine('1.0.0', '204', '01a16ff7-63f9-7c49-9cb7-965897fc6120'), '1.0.0 (204) \u00b7 update 01a16ff7');
  assert.equal(versionLine('1.0.0', null, null), '1.0.0');
  assert.equal(versionLine(null, '5', 'not an id'), '1.0.0 (5)');
  assert.equal(versionLine('1.0.0', '1.0.0', undefined), '1.0.0');
});
