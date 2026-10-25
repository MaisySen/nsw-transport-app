// Trip screen: mode chips (Any, Train, Metro, Bus, Light rail, Ferry), the endless list's caps, and the day picker.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-tripmodes-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const m = await load('src/lib/tripModesCore.ts');
const pc = await load('src/lib/planCore.ts');

const walk = { kind: 'walk', mode: 'walk' };
const leg = (mode) => ({ kind: 'transit', mode });
const J = (...legs) => ({ legs });

test('chips: Any clears, a mode toggles, several can be on, every chip on is Any', () => {
  assert.deepEqual(m.toggleMode([], null), []);
  assert.deepEqual(m.toggleMode([], 'bus'), ['bus']);
  assert.deepEqual(m.toggleMode(['bus'], 'train'), ['train', 'bus']);
  assert.deepEqual(m.toggleMode(['train', 'bus'], 'bus'), ['train']);
  assert.deepEqual(m.toggleMode(['train'], 'bus', ['train', 'bus']), []);
  assert.deepEqual(m.normModes('bus,plane,train,bus'), ['train', 'bus']);
  assert.deepEqual(m.normModes(undefined), []);
});

test('chips that make sense: Train and Bus always, others only when seen or chosen', () => {
  assert.deepEqual(m.chipsToShow([], []), ['train', 'bus']);
  assert.deepEqual(m.chipsToShow(['metro', 'coach', 'walk'], []), ['train', 'metro', 'bus']);
  assert.deepEqual(m.chipsToShow([], ['ferry']), ['train', 'bus', 'ferry']);
});

test('bus only keeps journeys whose every service is a bus (coach and school bus count), walks are fine', () => {
  const js = [J(walk, leg('bus'), walk, leg('bus')), J(leg('train')), J(leg('bus'), leg('train')), J(walk), J(leg('coach'))];
  assert.equal(m.filterModes(js, ['bus']).length, 2);
  assert.equal(m.filterModes(js, ['train', 'bus']).length, 4);
  assert.equal(m.filterModes(js, []).length, 5);
  assert.deepEqual(m.journeyChips(js[2]), ['train', 'bus']);
});

test('empty state is honest about who filtered', () => {
  assert.deepEqual(m.emptyModes(['bus'], true), { title: 'No bus only trips', body: 'No bus-only trips at this time. Try Any.' });
  const e = m.emptyModes(['bus'], false);
  assert.match(e.title, /in these results/);
  assert.doesNotMatch(e.body, /No bus-only trips at this time/);
  assert.equal(m.modesWords(['train', 'metro', 'bus']), 'Train, metro and bus');
});

test('endless list: capped, one batch at a time, only on view, stops at the end of the service day', () => {
  const T = Date.parse('2026-10-25T07:00:00Z'); // 6pm Sydney
  const end = m.serviceDayEnd(T);
  assert.equal(new Date(end).toISOString(), '2026-10-25T17:00:00.000Z', '4am next morning in Sydney');
  assert.equal(m.serviceDayEnd(Date.parse('2026-10-25T15:30:00Z')), Date.parse('2026-10-25T17:00:00Z'), '2:30am is still that night');
  assert.equal(m.canLoadLater(m.PAGE0, T, end, true), true);
  assert.equal(m.canLoadLater(m.PAGE0, T, end, false), false, 'not while off screen');
  assert.equal(m.canLoadLater({ ...m.PAGE0, busy: true }, T, end, true), false);
  assert.equal(m.canLoadLater({ ...m.PAGE0, pages: m.PAGING.maxLater }, T, end, true), false);
  assert.equal(m.canLoadLater(m.PAGE0, end + 1, end, true), false);
  assert.equal(m.afterBatch(m.PAGE0, 0, T, end).done, true, 'nothing new means the planner has no more');
  assert.equal(m.afterBatch(m.PAGE0, 3, end + 60000, end).done, true);
  const st = m.afterBatch(m.PAGE0, 3, T + 3600000, end);
  assert.deepEqual(st, { pages: 1, busy: false, done: false });
  // Simulate scrolling forever: the number of requests is bounded.
  let s = m.PAGE0, last = T, asked = 0;
  for (let i = 0; i < 100; i++) { if (!m.canLoadLater(s, last, end, true)) break; asked++; last += 20 * 60000; s = m.afterBatch(s, 4, last, end); }
  assert.ok(asked <= m.PAGING.maxLater);
});

test('earlier: never before half an hour ago', () => {
  const now = Date.parse('2026-10-25T07:00:00Z');
  const floor = now - m.PAGING.earliestBeforeNowMs;
  assert.equal(m.canLoadEarlier(m.PAGE0, now + 5 * 60000, floor, true), true);
  assert.equal(m.canLoadEarlier(m.PAGE0, floor + 30000, floor, true), false);
  assert.equal(m.earlierFrom(now + 5 * 60000, floor), floor);
  assert.equal(m.earlierFrom(now + 120 * 60000, floor), now + 80 * 60000);
});

test('near the end of the scroll view', () => {
  assert.equal(m.nearEnd({ layoutH: 800, offsetY: 0, contentH: 1200 }), true);
  assert.equal(m.nearEnd({ layoutH: 800, offsetY: 0, contentH: 3000 }), false);
  assert.equal(m.nearEnd({ layoutH: 800, offsetY: 1600, contentH: 3000 }), true);
});

test('days: Sydney dates, a date only when the time alone does not say the day', () => {
  const now = Date.parse('2026-10-25T06:30:00Z'); // Sun 5:30pm Sydney (AEDT)
  const d = m.pickerDays(now, 4);
  assert.deepEqual(d.map((x) => x.label), ['Today', 'Tomorrow', 'Tue 27 Oct', 'Wed 28 Oct']);
  assert.equal(d[0].day, '20261025');
  assert.equal(m.dateNeeded('20261025', 18, 0, now), null, 'today, later on');
  assert.equal(m.dateNeeded('20261026', 8, 0, now), null, 'tomorrow 8am: the 30 min rule says tomorrow');
  assert.equal(m.dateNeeded('20261026', 19, 0, now), '20261026', 'tomorrow 7pm needs the date');
  assert.equal(m.dateNeeded('20261027', 8, 15, now), '20261027');
  assert.equal(m.dateNeeded('20261025', 9, 0, now), '20261025', 'earlier today needs the date or it would be tomorrow');
  assert.equal(new Date(m.sydneyTime('20261027', 8, 15)).toISOString(), '2026-10-26T21:15:00.000Z');
  assert.equal(new Date(m.sydneyTime('20260705', 8, 0)).toISOString(), '2026-07-04T22:00:00.000Z', 'winter, AEST');
});

test('When carries a day through params, query and label', () => {
  const w = pc.whenFromParams('0815', '1', '20261027');
  assert.deepEqual(w, { kind: 'arrive', h: 8, m: 15, day: '20261027' });
  assert.deepEqual(pc.whenQuery(w), { time: '0815', arriveBy: true, date: '20261027' });
  assert.deepEqual(pc.whenParams(w), { time: '0815', arriveBy: '1', date: '20261027' });
  assert.equal(pc.whenLabel(w, Date.parse('2026-10-25T06:30:00Z')), 'Arrive by 8:15am Tue 27 Oct');
  assert.deepEqual(pc.whenFromParams('0815', '', 'junk'), { kind: 'leave', h: 8, m: 15 });
});
