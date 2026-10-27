// Often does not run (28 Oct): a bus with no live time, or a stale one, in an hour where the server's count says many
// recorded services never showed live (noShow on the row) says "Often does not run" instead of "Timetable only" or
// "Not tracking". Rows without noShow (every answer from servers before this, and every other row) are unchanged.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-noshow-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  js = js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const L = await load('src/lib/liveLabelCore.ts');
const B = await load('src/lib/boardCore.ts');
const NOW = Date.parse('2026-10-27T21:00:00Z'); // 8:00am Sydney, a Wednesday
const iso = (m) => new Date(NOW + m * 60000).toISOString();
const NS = { share: 45, n: 12 };

test('oftenNoShow: only a share and count at or over the floors', () => {
  assert.equal(L.oftenNoShow({ noShow: NS }), true);
  assert.equal(L.oftenNoShow({ noShow: { share: 30, n: 8 } }), true);
  assert.equal(L.oftenNoShow({ noShow: { share: 29, n: 40 } }), false);
  assert.equal(L.oftenNoShow({ noShow: { share: 80, n: 7 } }), false);
  assert.equal(L.oftenNoShow({ noShow: null }), false);
  assert.equal(L.oftenNoShow({ noShow: { share: 'x', n: 9 } }), false);
  assert.equal(L.oftenNoShow({}), false);
  assert.equal(L.oftenNoShow(null), false);
  assert.equal(L.NO_SHOW_LABEL, 'Often does not run');
});

test('no live time: "Often does not run", still counting down to the timetable time', () => {
  const s = L.liveState({ planned: iso(6), realtime: false, noShow: NS }, NOW);
  assert.equal(s.kind, 'timetable');
  assert.equal(s.label, 'Often does not run');
  assert.equal(s.noShow, true);
  assert.equal(s.big, '6');
  assert.equal(s.unit, 'min');
  assert.equal(s.counting, true);
  assert.match(s.a11y, /^Often does not run\. 6 minutes, timetable time 8:06am, no live data$/);
  // Its time passed: the clock time, never "Gone".
  const p = L.liveState({ planned: iso(-5), realtime: false, noShow: NS }, NOW);
  assert.equal(p.big, '7:55am');
  assert.equal(p.counting, false);
  assert.equal(p.label, 'Often does not run');
});

test('stale live time: "Often does not run" in place of "Not tracking", timetable clock time, age kept', () => {
  const s = L.liveState({ planned: iso(4), estimated: iso(5), realtime: true, seenAt: NOW - 200000, noShow: NS }, NOW);
  assert.equal(s.kind, 'stale');
  assert.equal(s.label, 'Often does not run');
  assert.equal(s.noShow, true);
  assert.equal(s.big, '8:04am');
  assert.equal(s.age, '3 min ago');
  assert.match(s.a11y, /^Not tracking, often does not run\. Timetable 8:04am, last live time 3 min ago$/);
});

test('a live time is a live time: noShow never changes Live or Cancelled', () => {
  const live = L.liveState({ planned: iso(5), estimated: iso(7), realtime: true, seenAt: NOW - 20000, noShow: NS }, NOW);
  const plain = L.liveState({ planned: iso(5), estimated: iso(7), realtime: true, seenAt: NOW - 20000 }, NOW);
  assert.deepEqual(live, plain);
  assert.equal(live.label, 'Live');
  const cx = L.liveState({ planned: iso(5), realtime: false, cancelled: true, noShow: NS }, NOW);
  assert.equal(cx.label, 'Cancelled');
  assert.equal(cx.noShow, undefined);
});

test('rows without noShow (older servers) are exactly as before', () => {
  for (const x of [{ planned: iso(6), realtime: false }, { planned: iso(-5), realtime: false },
    { planned: iso(4), estimated: iso(5), realtime: true, seenAt: NOW - 200000 }, { planned: iso(6), realtime: false, noShow: { share: 10, n: 30 } }]) {
    const s = L.liveState(x, NOW);
    assert.equal(s.noShow, undefined);
    assert.ok(['Timetable', 'Not tracking'].includes(s.label));
    assert.equal(L.liveKey(x, NOW).endsWith('|n'), false);
  }
});

test('the row redraws when noShow arrives (liveKey differs)', () => {
  const x = { planned: iso(6), realtime: false };
  assert.notEqual(L.liveKey(x, NOW), L.liveKey({ ...x, noShow: NS }, NOW));
});

test('departure board rows carry the label and say it to VoiceOver and TalkBack', () => {
  const items = [
    { line: '600', mode: 'bus', dest: 'Town Centre', planned: iso(6), realtime: false, tripId: 'a', noShow: NS },
    { line: '600', mode: 'bus', dest: 'Town Centre', planned: iso(4), estimated: iso(5), realtime: true, tripId: 'b', seenAt: NOW - 200000, noShow: NS },
    { line: '601', mode: 'bus', dest: 'Town Centre', planned: iso(12), realtime: false, tripId: 'c' },
  ];
  const rows = B.boardRows(items, NOW, 8);
  const tt = rows.find((r) => r.tripId === 'a');
  assert.equal(tt.label, 'Often does not run');
  assert.match(tt.a11y, /timetable, often does not run/);
  const st = rows.find((r) => r.tripId === 'b');
  assert.equal(st.kind, 'stale');
  assert.equal(st.label, 'Often does not run');
  assert.match(st.a11y, /not tracking, often does not run, timetable/);
  const plain = rows.find((r) => r.tripId === 'c');
  assert.equal(plain.label, 'Timetable');
  assert.doesNotMatch(plain.a11y, /often/);
});
