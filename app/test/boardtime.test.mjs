// Earlier departures on a stop's board: the moment a picked time stands for, the request, the server echo check,
// what the board keeps on Now and at a picked time, Left words, how far back it goes and how a short batch is filled.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-boardtime-'));
function write(rel, fix = (x) => x) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, fix(js));
  return f;
}
write('src/lib/tripModesCore.ts');
const B = await import(pathToFileURL(write('src/lib/boardTimeCore.ts', (js) => js.replace(/from '\.\/tripModesCore'/g, "from './tripModesCore.mjs'"))).href);

// Sunday 25 Oct 2026, 8:46pm Sydney (AEDT, UTC+11).
const syd = (day, hhmm) => Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00+11:00`);
const NOW = syd('20261025', '2046');
const MIN = 60000;
const hm = (t) => new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)$/i, '');
const iso = (t) => new Date(t).toISOString();
const dep = (line, t, o = {}) => ({ line, planned: iso(t), stopId: '2135101', realtime: false, ...o });

test('a picked time is in the service day of now: 4am to 4am', () => {
  assert.equal(B.boardMoment(18, 15, NOW), syd('20261025', '1815'));
  assert.equal(B.boardMoment(4, 0, NOW), syd('20261025', '0400'));
  // 1:30am picked at 8:46pm is tonight (after midnight), not this morning.
  assert.equal(B.boardMoment(1, 30, NOW), syd('20261026', '0130'));
  // At 1:30am, 11pm is the evening before.
  const late = syd('20261026', '0130');
  assert.equal(B.boardMoment(23, 0, late), syd('20261025', '2300'));
  assert.equal(B.boardWhenWords(B.boardMoment(23, 0, late), late), 'From 11:00pm yesterday');
  assert.equal(B.boardWhenWords(B.boardMoment(1, 30, NOW), NOW), 'From 1:30am tomorrow');
  assert.equal(B.boardWhenWords(syd('20261025', '1815'), NOW), 'From 6:15pm');
  assert.equal(B.boardWhenWords(null, NOW), 'Now');
  assert.equal(B.boardDayWord(syd('20261025', '0500'), NOW), 'Today');
});

test('the request is Sydney HHMM and its day; only an echoed answer counts', () => {
  const q = B.boardQuery(syd('20261025', '1815'));
  assert.deepEqual(q, { time: '1815', date: '20261025' });
  assert.equal(B.honoured({ at: { date: '20261025', time: '1815', clamped: false } }, q), true);
  assert.equal(B.honoured({ at: { date: '20261025', time: '0400', clamped: true } }, { time: '0300', date: '20261025' }), true);
  // An older server ignores time and answers for now, with no at.
  assert.equal(B.honoured({ items: [] }, q), false);
  assert.equal(B.honoured(null, q), false);
  assert.equal(B.honoured({ at: { date: '20261025', time: '2046' } }, q), false);
});

test('Now keeps the live answer as before and the earlier batches above it; a picked time keeps everything', () => {
  const main = [dep('T9', NOW - 5 * MIN), dep('T1', NOW + 2 * MIN), dep('T2', NOW + 6 * MIN)];
  const extra = [dep('T3', NOW - 30 * MIN, { realtime: true, estimated: iso(NOW - 27 * MIN), delayMin: 3 }), dep('T1', NOW + 2 * MIN)];
  // Now with nothing earlier loaded: exactly today's board (gone over a minute ago drops off).
  assert.deepEqual(B.boardList(main, [], null, NOW).map((d) => d.line), ['T1', 'T2']);
  // Now with an earlier batch: the batch's gone service on top, no duplicate of the live answer's T1.
  assert.deepEqual(B.boardList(main, extra, null, NOW).map((d) => d.line), ['T3', 'T1', 'T2']);
  // A picked time: the whole answer, gone or not, in time order.
  assert.deepEqual(B.boardList(main, extra, NOW - 40 * MIN, NOW).map((d) => d.line), ['T3', 'T9', 'T1', 'T2']);
  assert.equal(B.firstDepOf(B.boardList(main, extra, null, NOW)), NOW - 27 * MIN);
});

test('gone services read Left with the live delay they left with', () => {
  const late = dep('T3', NOW - 30 * MIN, { realtime: true, estimated: iso(NOW - 27 * MIN), delayMin: 3 });
  assert.equal(B.isGone(late, NOW), true);
  assert.equal(B.goneWords(late, hm), `Left ${hm(NOW - 27 * MIN)} \u00b7 3 min late`);
  assert.equal(B.goneWords(dep('T9', NOW - 12 * MIN), hm), `Left ${hm(NOW - 12 * MIN)} \u00b7 Scheduled`);
  assert.equal(B.goneWords(dep('T2', NOW - 8 * MIN, { cancelled: true }), hm), `Cancelled ${hm(NOW - 8 * MIN)}`);
  assert.equal(B.goneWords(dep('T1', NOW - 4 * MIN, { realtime: true, estimated: iso(NOW - 4 * MIN), delayMin: 0 }), hm), `Left ${hm(NOW - 4 * MIN)} \u00b7 On time`);
  // Within the last minute it is not gone yet (the countdown chip says the same).
  assert.equal(B.isGone(dep('T1', NOW - 30000), NOW), false);
});

test('Earlier goes back to 4am of the time shown, in steps, and a short batch is filled up to the list', () => {
  const four = syd('20261025', '0400');
  assert.equal(B.boardFloor(null, NOW), four);
  assert.equal(B.boardFloor(syd('20261025', '0600'), NOW), four);
  assert.deepEqual(B.boardEarlierSteps(NOW, four), [NOW - 40 * MIN, NOW - 90 * MIN, NOW - 180 * MIN]);
  assert.deepEqual(B.boardEarlierSteps(four + 20 * MIN, four), [four]);
  // A batch from 40 min back that stops 20 min short of the first service: ask again from its last one.
  const first = NOW;
  const batch = [dep('A', NOW - 40 * MIN), dep('B', NOW - 20 * MIN)];
  assert.equal(B.fillFrom(batch, first, NOW - 40 * MIN), NOW - 20 * MIN);
  assert.equal(B.fillFrom([dep('C', NOW - 30000)], first, NOW - 20 * MIN), null);
  assert.equal(B.fillFrom([], first, NOW - 40 * MIN), null);
  // No progress (the batch ends where the last ask began): stop.
  assert.equal(B.fillFrom([dep('B', NOW - 20 * MIN)], first, NOW - 20 * MIN), null);
  assert.ok(B.BOARD_MAX_ASKS >= 2 && B.BOARD_MAX_ASKS <= 6);
  // Only new services before the first one shown are added.
  const have = [dep('B', NOW - 20 * MIN)];
  assert.deepEqual(B.freshBefore([dep('A', NOW - 40 * MIN), dep('B', NOW - 20 * MIN), dep('D', NOW + MIN)], first, have).map((d) => d.line), ['A']);
});

test('the Earlier departures row shows while a batch can load, never on a server without earlier times', () => {
  const four = syd('20261025', '0400');
  const P0 = { pages: 0, done: false, busy: false };
  assert.deepEqual(B.boardEarlierRow(P0, NOW, four, true), { show: true, label: 'Earlier departures' });
  assert.equal(B.boardEarlierRow(P0, NOW, four, false).show, false);
  assert.equal(B.boardEarlierRow({ ...P0, done: true }, NOW, four, true).show, false);
  assert.equal(B.boardEarlierRow({ ...P0, busy: true }, NOW, four, true).show, false);
  assert.equal(B.boardEarlierRow(P0, four + 30000, four, true).show, false);
  assert.equal(B.boardEarlierRow(P0, null, four, true).show, false);
  assert.equal(B.BOARD_EARLIER_NEEDS_NEW, 'Earlier departures need a newer server, which did not answer just now. Pull down to try again.');
});
