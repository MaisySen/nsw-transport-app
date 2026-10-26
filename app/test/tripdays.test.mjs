// Whole days from our own planner in the trip list (src/lib/tripPagesCore.ts day helpers, app/trip.tsx, 27 Oct): the
// server's day page read, the next day asked for about 50 rows from either end, earlier rows already loaded shown a
// block at a time with no network, Trip Planner pages past the planner's days, and source checks that the phone asks
// for days only on plain A to B pages and needs nothing native (an over the air update).
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-tripdays-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const m = await load('src/lib/tripPagesCore.ts');
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

test('the day page of an answer: only a server day page, with its neighbours when it can list them', () => {
  const page = { mode: 'day', day: '20261027', prevDay: '20261026', nextDay: null, windowStart: 1, windowEnd: 2 };
  assert.deepEqual(m.dayPageOf({ page }), { day: '20261027', prevDay: '20261026', nextDay: null, windowStart: 1, windowEnd: 2 });
  assert.equal(m.dayPageOf({ page: { next: 1, prev: 0, end: false } }), null, 'a Trip Planner page');
  assert.equal(m.dayPageOf({ journeys: [] }), null, 'an older server');
  assert.equal(m.dayPageOf({ page: { mode: 'day', day: 'x' } }), null);
  assert.equal(m.dayPageOf({ page: { ...page, nextDay: 'tomorrow' } }).nextDay, null);
});

test('the next day about 50 rows from either end; earlier rows from what is loaded first, then the day before, then pages', () => {
  assert.equal(m.DAY_PREFETCH_ROWS, 50);
  // 100 rows over 9,000 px: 90 px a row, 50 rows is 4,500 px.
  assert.equal(m.dayPrefetchPx(9000, 100, 700), 4500);
  assert.equal(m.dayPrefetchPx(500, 10, 700), 2500);
  assert.equal(m.dayPrefetchPx(0, 0, 700), 700, 'no rows yet: the plain distance');
  assert.equal(m.dayPrefetchPx(100, 50, 700), 700, 'never nearer than the plain pages ask');
  const d = (prevDay, nextDay) => ({ day: '20261027', prevDay, nextDay, windowStart: 0, windowEnd: 0 });
  assert.equal(m.earlierSource(12, d('20261026', null)), 'reveal');
  assert.equal(m.earlierSource(0, d('20261026', null)), 'day');
  assert.equal(m.earlierSource(0, d(null, null)), 'pages');
  assert.equal(m.laterSource(d(null, '20261028')), 'day');
  assert.equal(m.laterSource(d(null, null)), 'pages');
  assert.equal(m.laterSource(null), 'pages');
  assert.ok(m.DAY_REVEAL_ROWS > 0 && m.DAY_REVEAL_ROWS <= m.DAY_PREFETCH_ROWS);
});

test('the phone asks for days on plain A to B pages, carries on with Trip Planner cursors, and stays an over the air update', () => {
  const api = read('src/lib/api.ts');
  assert.match(api, /if \(opts\.page && opts\.days\) Object\.assign\(base, \{ days: 1, day: opts\.day \?\? '' \}\)/);
  const trips = read('src/lib/trips.ts');
  assert.match(trips, /page: false, after: undefined, before: undefined, arr: undefined, days: false, day: undefined/, 'a trip via a stop never asks for days');
  const s = read('src/app/trip.tsx');
  assert.match(s, /\.\.\.\(pageable \? \{ page: true, days: true \} : \{\}\)/);
  // A day is asked for only by name (day=); a cursor page never carries days=1.
  assert.match(s, /\.\.\.\(want \? \{ days: true, day: want \} : fwd \? \{ after: cur\.after! \} : \{ before: cur\.before!, arr: cur\.arr \?\? undefined \}\)/);
  // Rows already loaded go above with no request.
  const reveal = s.slice(s.indexOf("if (src === 'reveal')"), s.indexOf("set((x) => ({ ...x, busy: true }));", s.indexOf("if (src === 'reveal')")));
  assert.ok(reveal.length > 0 && !/planTrip|fetch\(/.test(reveal), 'showing loaded rows makes no request');
  assert.match(s, /dayPrefetchPx\(/);
  // The list opens at its time: a day's trips before it wait above.
  assert.match(s, /const mainCut = day0 \? Math\.max\(keep\.main, anchor - 120000\) : keep\.main;/);
  for (const f of ['src/lib/tripPagesCore.ts', 'src/app/trip.tsx']) {
    const src = read(f);
    assert.ok(!/setInterval\(/.test(src), f + ': no setInterval');
    assert.ok(!/requireNativeModule|NativeModules\./.test(src), f + ': nothing native');
    assert.ok(!/[\u2013\u2014]/.test(src), f + ': no long dashes');
  }
});
