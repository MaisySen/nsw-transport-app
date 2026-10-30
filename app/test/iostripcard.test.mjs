// The iPhone trip Live Activity content (platform/tripCard.ts) for a two leg trip: waiting, on board,
// a tight change, a missed change and arrived. Field names must match LiveTripAttributes.ContentState in Swift.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-card-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const live = await load('src/lib/liveCalc.ts');
const { cardFor } = await load('platform/tripCard.ts');

const T0 = Date.parse('2026-10-24T11:00:00Z');
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();
const legs = (changeAt) => [
  { mode: 'train', line: 'T2', stopId: 'ASH', toStopId: 'RDF', from: 'Ashfield Station', to: 'Epping Station', planned: iso(at(0)), arrPlanned: iso(at(13)), fromPlatform: 'Platform 3', towards: 'Central Station', color: '#0098CD' },
  { mode: 'train', line: 'T4', stopId: 'RDF4', toStopId: 'KXS', from: 'Epping Station', to: 'Martin Place Station', planned: iso(at(changeAt)), arrPlanned: iso(at(changeAt + 9)), fromPlatform: 'Platform 9', towards: 'Bondi Junction Station', color: '#005AA3' },
];
const trip = (changeAt = 19) => ({ legs: legs(changeAt), to: { id: 'KXS', name: 'Martin Place Station' } });
const cardAt = (g, t, memo) => cardFor(g, live.computeLive(g.legs, [], t, memo), t);

const SWIFT_FIELDS = new Set(['line', 'lineColorHex', 'mode', 'nextStop', 'stopsLeft', 'getOffAt', 'arrival', 'phase', 'warning', 'progress',
  'fareLine', 'towards', 'platform', 'departs', 'legArrives', 'destination', 'updated']);
const REQUIRED = ['line', 'lineColorHex', 'mode', 'getOffAt', 'arrival', 'phase', 'progress'];

function checkShape(c) {
  for (const k of Object.keys(c)) assert.ok(SWIFT_FIELDS.has(k), `unknown field ${k}`);
  for (const k of REQUIRED) assert.ok(c[k] !== null && c[k] !== undefined, `missing ${k}`);
  for (const v of Object.values(c)) if (typeof v === 'string') {
    assert.doesNotMatch(v, /\b\d{1,2}:\d\d\b(?!\s*[ap]m)/, `timer style text: ${v}`);
    assert.doesNotMatch(v, /[\u2013\u2014]/);
    assert.doesNotMatch(v, / Station$/);
  }
}

test('waiting for the first leg: board details, no timer text', () => {
  const c = cardAt(trip(), at(-5));
  checkShape(c);
  assert.equal(c.phase, 'wait');
  assert.equal(c.line, 'T2');
  assert.equal(c.nextStop, 'Ashfield');
  assert.equal(c.getOffAt, 'Epping');
  assert.equal(c.towards, 'Central');
  assert.equal(c.platform, 'Platform 3');
  assert.equal(c.departs, at(0));
  assert.equal(c.destination, 'Martin Place');
  // No live data in this card: it says so rather than reading as on time.
  assert.equal(c.warning, 'Timetable times, not live');
});

test('on board: ride phase with progress between 0 and 1', () => {
  const c = cardAt(trip(), at(6));
  checkShape(c);
  assert.equal(c.phase, 'ride');
  assert.ok(c.progress > 0.3 && c.progress < 0.7, String(c.progress));
  assert.equal(c.legArrives, at(13));
  assert.equal(c.arrival, at(28));
});

test('a one minute change says Tight change', () => {
  const c = cardAt(trip(14), at(6));
  checkShape(c);
  assert.equal(c.warning, 'Tight change at Epping');
});

test('a change that cannot be made names the service you will miss', () => {
  const c = cardAt(trip(12), at(6));
  checkShape(c);
  assert.match(c.warning, /^You'll likely miss the \d{1,2}:\d\d[ap]m T4$/);
});

test('second leg after the change', () => {
  // You got off at Epping (your tap or your location): the card moves on to the T4.
  const c = cardAt(trip(), at(20), { here: { 0: at(13) } });
  checkShape(c);
  assert.equal(c.line, 'T4');
  assert.equal(c.getOffAt, 'Martin Place');
});

test('no live data and nothing from you: the card stays on the leg you are on, never at the change by the clock', () => {
  const c = cardAt(trip(), at(20));
  checkShape(c);
  assert.equal(c.line, 'T2');
  assert.equal(c.phase, 'ride');
  assert.equal(c.nextStop, null);
  assert.equal(c.warning, 'Timetable times, not live');
  assert.ok(c.progress <= 0.9);
});

test('arrived: one final card, nothing after', () => {
  const g = trip();
  const c = cardAt(g, at(40), { rode: { 0: at(13), 1: at(28) }, arrivedAt: at(28) });
  checkShape(c);
  assert.equal(c.phase, 'arrived');
  assert.equal(c.progress, 1);
  assert.equal(c.arrival, at(28));
  assert.equal(c.destination, 'Martin Place');
});
