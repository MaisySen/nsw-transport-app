// Trip flow 2, board row (integrator, 31 Oct 2026): the real /api/service stop rows carry no platform, so a trip flow 2
// app asks for the boarding stop's departure board row (board=1) before the train leaves, and the trip state takes the
// board's live time and live platform from the answer, exactly as the server's card does (G19, G21, I6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linkTs } from './tsLink.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(import.meta.url);
const ts = require(path.join(root, 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-board-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, linkTs(js, out, ts));
  return import(pathToFileURL(f).href);
}
const live = await load('src/lib/liveCalc.ts');
const { cardFor } = await load('platform/tripCard.ts');
const F = await load('src/lib/liveFreshCore.ts');

const T0 = Date.parse('2026-10-31T09:00:00Z'); // 8:00pm Sydney
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();
const NAMES = [['Lidcombe', 0], ['Auburn', 3], ['Clyde', 5]];
const LEG = { mode: 'train', line: 'T1', tripId: 'T1.a', stopId: 'S0', toStopId: 'S2', from: 'Lidcombe Station', to: 'Clyde Station', planned: iso(at(0)), arrPlanned: iso(at(5)), fromPlatform: 'Platform 6', towards: 'Sample Station' };
// the real answer's shape: stop rows with no platform and, here, no live time at all (the feed has no news yet)
function answer(board) {
  const stops = NAMES.map(([n, m], k) => ({ id: 'S' + k, name: n + ' Station', lat: -33.87 + k / 200, lon: 151.08 + k / 200, planned: iso(at(m)), passed: false, mine: k === 0, alight: k === 2, skipped: false, carried: false }));
  return { kind: 'service', live: false, delayMin: null, line: 'T1', mode: 'train', tripId: 'T1.a', mineIndex: 0, alightIndex: 2, nextIndex: 0, progress: 'timetable', stops, ...(board !== undefined ? { board } : {}) };
}

test('ask: board=1 only before the train has left and inside the board window', () => {
  assert.deepEqual(F.liveServiceQuery({ trip: 'x' }, true, { board: true }), { trip: 'x', refresh: '1', board: '1' });
  assert.deepEqual(F.liveServiceQuery({ trip: 'x' }, false), { trip: 'x' });
  assert.equal(F.wantsBoard(iso(at(10)), false, at(0)), true);
  assert.equal(F.wantsBoard(iso(at(10)), true, at(0)), false, 'ridden: no board');
  assert.equal(F.wantsBoard(iso(at(50)), false, at(0)), false, 'over 45 min ahead');
  assert.equal(F.wantsBoard(iso(at(-31)), false, at(0)), false, 'over 30 min past');
  assert.match(fs.readFileSync(path.join(root, 'src/lib/liveEngine.ts'), 'utf8'), /board: wantsBoard\(l\.planned/);
});

test('board live time: the countdown goes to the board time with the delay beside it, from the same reading', () => {
  const t = at(-2);
  const s = live.computeLive([LEG], [answer({ planned: iso(at(0)), estimated: iso(at(4)), realtime: true, tripId: 'T1.a', platform: 'Platform 6' })], t, null, null, { asOf: t });
  const c = cardFor({ id: 'g', title: 'x', legs: [LEG], rode: {} }, s, t);
  assert.equal(c.departs, at(4), 'counts to the board live 8:04, not the timetable 8:00');
  assert.match(String(c.warning), /4 min late/);
});

test('board live platform: "Plat 7, was 6" from the board row (the stop rows carry none)', () => {
  const t = at(-2);
  const s = live.computeLive([LEG], [answer({ planned: iso(at(0)), estimated: iso(at(0)), realtime: true, tripId: 'T1.a', platform: 'Platform 7' })], t, null, null, { asOf: t });
  const c = cardFor({ id: 'g', title: 'x', legs: [LEG], rode: {} }, s, t);
  assert.match(String(c.platform).replace(/^(Platform|Plat)\s*/i, ''), /^7, was 6$/);
});

test('no board row (an old server, or outside the window): timetable, never a guessed live time', () => {
  const t = at(-2);
  const s = live.computeLive([LEG], [answer(undefined)], t, null, null, { asOf: t });
  const c = cardFor({ id: 'g', title: 'x', legs: [LEG], rode: {} }, s, t);
  assert.equal(c.departs, at(0));
  assert.doesNotMatch(String(c.warning || ''), /late/);
});

test('a board row for another trip is not used', () => {
  const t = at(-2);
  const s = live.computeLive([LEG], [answer({ planned: iso(at(0)), estimated: iso(at(9)), realtime: true, tripId: 'T1.other', platform: 'Platform 6' })], t, null, null, { asOf: t });
  const c = cardFor({ id: 'g', title: 'x', legs: [LEG], rode: {} }, s, t);
  assert.equal(c.departs, at(0));
});
