// Live board pushes (src/lib/boardPushCore.ts, server engPushDiff in backend/src/engine.js): a pushed board, diffs on
// top of it give the same rows as the server's board, a diff for another board asks for the whole board, the flag is
// off unless remote config says livePush: true, and the screens poll once a minute while the socket is open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(import.meta.url);
const ts = require(path.join(root, 'node_modules', 'typescript'));
const js = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/boardPushCore.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-push-')), 'boardPushCore.mjs');
fs.writeFileSync(f, js);
const P = await import(pathToFileURL(f).href);
// The server's diff, taken from the engine source so both sides are tested together.
const eng = fs.readFileSync(path.join(root, '..', 'backend', 'src', 'engine.js'), 'utf8');
const a = eng.indexOf('function engPushKey'), b = eng.indexOf('// Feed timing', a);
const S = new Function(eng.slice(a, b) + '\nreturn { engPushDiff };')();

const row = (trip, planned, est, extra = {}) => ({ tripId: trip, stopId: '2000336', planned, estimated: est, realtime: !!est, line: 'T1', ...extra });
const board = (builtAt, items) => ({ stop: { id: '200060', name: 'Central' }, items, modes: ['train'], alerts: [], live: { feedAt: builtAt - 2000 }, engine: { builtAt } });

test('a whole board, then diffs: the phone ends up with the server board, row for row', () => {
  const b1 = board(1000, [row('A', 't1', null), row('B', 't2', 't2b'), row('C', 't3', null)]);
  const b2 = board(6000, [row('A', 't1', 't1x'), row('B', 't2', 't2b'), row('D', 't4', null)]);
  const b3 = board(11000, [row('B', 't2', 't2c'), row('A', 't1', 't1x'), row('D', 't4', null)]);
  let st = S.engPushDiff(undefined, b1).state;
  let cur = P.applyPush(null, { type: 'board', board: b1 }, 5).board;
  assert.equal(cur.kind, 'departures');
  for (const nb of [b2, b3]) {
    const { state, msg } = S.engPushDiff(st, nb);
    st = state;
    const r = P.applyPush(cur, JSON.parse(JSON.stringify(msg)), 7);
    assert.equal(r.needFull, false);
    cur = r.board;
    assert.deepEqual(cur.items, nb.items);
    assert.equal(cur.engine.builtAt, nb.engine.builtAt);
    assert.equal(cur.dataAt, nb.live.feedAt);
  }
});

test('nothing changed: no message; a diff for another board: ask for the whole board', () => {
  const b1 = board(1000, [row('A', 't1', null)]);
  const st = S.engPushDiff(undefined, b1).state;
  assert.equal(S.engPushDiff(st, board(6000, [row('A', 't1', null)])).msg, null);
  const { msg } = S.engPushDiff(st, board(6000, [row('A', 't1', 'x')]));
  const other = P.applyPush({ ...b1, pushed: true, engine: { builtAt: 999 } }, msg).needFull;
  assert.equal(other, true);
  assert.equal(P.applyPush(null, msg).needFull, true);
  assert.equal(P.applyPush(null, { type: 'nonsense' }).board, null);
});

test('the usual delay line on a row on screen stays when a pushed row has none', () => {
  const shown = { ...board(1000, [row('A', 't1', null, { pred: { text: 'Usually on time' } })]), pushed: true };
  const r = P.applyPush(shown, { type: 'board', board: board(2000, [row('A', 't1', 'x')]) });
  assert.equal(r.board.items[0].pred.text, 'Usually on time');
});

test('off unless remote config says livePush: true; killed is off; poll once a minute with the socket open', () => {
  assert.equal(P.pushFlagOn({ flags: {}, kill: {} }), false);
  assert.equal(P.pushFlagOn({ flags: { livePush: true }, kill: {} }), true);
  assert.equal(P.pushFlagOn({ flags: { livePush: true }, kill: { livePush: 'off' } }), false);
  assert.equal(P.pollGapWithPush(15000, true), 60000);
  assert.equal(P.pollGapWithPush(15000, false), 15000);
  assert.equal(P.pushUrl('https://api.transportsydney.app', '200060', 'train'), 'wss://api.transportsydney.app/api/live?stop=200060&mode=train');
  assert.deepEqual([0, 1, 2, 3].map(P.retryDelay), [2000, 10000, 30000, null]);
});

test('the socket hook opens only on view with the app in front, closes on leave, and uses no interval timer', () => {
  const src = fs.readFileSync(path.join(root, 'src/lib/boardPush.ts'), 'utf8');
  assert.ok(src.includes('useFocusEffect') && src.includes("AppState.addEventListener('change'"));
  assert.ok(!/setInterval/.test(src));
  assert.ok(/flag && focused && active/.test(src));
  assert.ok(/ws\?\.close\(1000/.test(src));
});
