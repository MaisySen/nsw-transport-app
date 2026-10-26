// Offline from a fresh start: the copies kept on the phone, what is dropped, the "Offline, showing times from" line
// and the "Updated 4 min ago, refreshing" line shown with a kept copy while the live answer loads.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-offline-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const o = await load('src/lib/offlineCore.ts');

// 25 Oct 2026, 8:00am Sydney (UTC+11).
const NOW = Date.parse('2026-10-24T21:00:00Z');
const iso = (minFromNow) => new Date(NOW + minFromNow * 60000).toISOString();

test('departures already gone are dropped, a late live service stays', () => {
  const d = { kind: 'departures', stop: { id: '200060', name: 'Central' }, now: NOW - 600000, items: [
    { line: 'T1', planned: iso(-5), estimated: iso(-4), realtime: true },
    { line: 'T4', planned: iso(-2), estimated: iso(3), realtime: true },
    { line: 'T8', planned: iso(6), estimated: null, realtime: false },
    { line: 'T2', planned: iso(2), estimated: iso(-1), realtime: false },
  ] };
  const p = o.pruneDepartures(d, NOW);
  assert.deepEqual(p.items.map((x) => x.line), ['T4', 'T8', 'T2']);
  assert.equal(d.items.length, 4, 'input untouched');
});

test('journeys are dropped by the first leg departure, live time first', () => {
  const d = { kind: 'trip', journeys: [
    { leave: iso(-3), legs: [{ planned: iso(-3), realtime: false }] },
    { leave: iso(-1), legs: [{ planned: iso(-1), estimated: iso(2), realtime: true }] },
    { leave: iso(10), legs: [] },
    { leave: Date.parse(iso(-10)), legs: [] },
  ] };
  assert.deepEqual(o.pruneTrip(d, NOW).journeys.map((j) => j.leave), [iso(-1), iso(10)]);
});

test('prune picks the shape and leaves other answers alone', () => {
  assert.equal(o.prune({ journeys: [{ legs: [{ planned: iso(-1) }] }] }, NOW).journeys.length, 0);
  assert.equal(o.prune({ kind: 'departures', items: [{ planned: iso(-1) }] }, NOW).items.length, 0);
  const lists = { commutes: { items: [] }, saved: { items: [{ name: 'home' }] } };
  assert.equal(o.prune(lists, NOW), lists);
});

test('only answers with services are kept', () => {
  assert.equal(o.worthKeeping({ journeys: [] }), false);
  assert.equal(o.worthKeeping({ journeys: [{}] }), true);
  assert.equal(o.worthKeeping({ items: [] }), false);
  assert.equal(o.worthKeeping({ journeys: [{}], error: 'No trips' }), false);
  assert.equal(o.worthKeeping(null), false);
  assert.equal(o.worthKeeping({ commutes: {}, saved: {} }), true);
});

test('a kept copy is shown up to 18 hours old, never from the future or broken', () => {
  assert.ok(o.usable({ at: NOW - 17 * 3600000, data: {} }, NOW));
  assert.equal(o.usable({ at: NOW - 19 * 3600000, data: {} }, NOW), null);
  assert.equal(o.usable({ at: NOW + 3600000, data: {} }, NOW), null);
  assert.equal(o.usable({ at: 'x', data: {} }, NOW), null);
  assert.equal(o.usable({ at: NOW }, NOW), null);
  assert.equal(o.usable(null, NOW), null);
});

test('the index keeps the newest first and drops the oldest past the limit', () => {
  let idx = [];
  for (let i = 0; i < 5; i++) idx = o.touch(idx, `k${i}`, 3).index;
  assert.deepEqual(idx, ['k4', 'k3', 'k2']);
  const r = o.touch(['a', 'b', 'c'], 'b', 3);
  assert.deepEqual(r.index, ['b', 'a', 'c']);
  assert.deepEqual(r.evict, []);
  assert.deepEqual(o.touch(['a', 'b', 'c'], 'd', 3).evict, ['c']);
  assert.equal(o.MAX_ENTRIES, 40);
});

test('the offline line names the time in Sydney, and yesterday when it was', () => {
  assert.equal(o.offlineText(NOW - 15 * 60000, NOW), 'Offline, showing times from 7:45am');
  assert.equal(o.offlineText(Date.parse('2026-10-24T10:30:00Z'), NOW), 'Offline, showing times from yesterday 9:30pm');
  assert.doesNotMatch(o.offlineText(NOW, NOW), /[\u2013\u2014]/);
});

test('cache keys are separate per kind', () => {
  assert.equal(o.cacheKey('dep', '200060'), 'offline:dep:200060');
  assert.notEqual(o.cacheKey('trip', 'a'), o.cacheKey('dep', 'a'));
});

test('a kept copy says how old it is, never live', () => {
  assert.equal(o.staleText(NOW - 20000, NOW), 'Updated just now, refreshing');
  assert.equal(o.staleText(NOW - 4 * 60000 - 5000, NOW), 'Updated 4 min ago, refreshing');
  assert.equal(o.staleText(NOW - 65 * 60000, NOW), 'Updated 1 h 5 min ago, refreshing');
  assert.equal(o.staleText(NOW - 120 * 60000, NOW), 'Updated 2 h ago, refreshing');
  assert.equal(o.staleText(NOW - 5 * 3600000, NOW), 'Updated at 3:00am, refreshing');
  assert.equal(o.agoText(NOW + 30000, NOW), 'just now');
  for (const m of [0, 1, 59, 61, 179, 600]) assert.doesNotMatch(o.staleText(NOW - m * 60000, NOW), /[\u2013\u2014]|live/i);
});

test('a service screen has its own kind of kept copy', () => {
  assert.equal(o.cacheKey('svc', 't1|x'), 'offline:svc:t1|x');
  const svc = { trip: 't1', stops: [{ name: 'A' }], seenAt: NOW };
  assert.equal(o.worthKeeping(svc), true);
  assert.equal(o.prune(svc, NOW), svc);
});
