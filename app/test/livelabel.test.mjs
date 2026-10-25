// Honest live labels (liveLabelCore.ts) and Recently departed (recentCore.ts): the ghost bus fix.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-livelabel-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  js = js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const L = await load('src/lib/liveLabelCore.ts');
const R = await load('src/lib/recentCore.ts');
const NOW = Date.parse('2026-10-25T21:00:00Z'); // 8:00am Sydney
const iso = (m) => new Date(NOW + m * 60000).toISOString();
const sec = (s) => s * 1000;

test('age words step by 15 s, then minutes', () => {
  assert.equal(L.ageText(0), 'just now');
  assert.equal(L.ageText(sec(14)), 'just now');
  assert.equal(L.ageText(sec(20)), '15 s ago');
  assert.equal(L.ageText(sec(44)), '30 s ago');
  assert.equal(L.ageText(sec(59)), '45 s ago');
  assert.equal(L.ageText(sec(61)), '1 min ago');
  assert.equal(L.ageText(sec(200)), '3 min ago');
  assert.equal(L.ageText(null), null);
});

test('live time with a fresh answer: Live, counting down, age shown', () => {
  const s = L.liveState({ planned: iso(5), estimated: iso(7), realtime: true, seenAt: NOW - sec(20) }, NOW);
  assert.equal(s.kind, 'live');
  assert.equal(s.label, 'Live');
  assert.equal(s.big, '7');
  assert.equal(s.unit, 'min');
  assert.equal(s.age, '15 s ago');
  assert.equal(L.liveWords(s), 'Live, updated 15 s ago');
  assert.ok(s.counting);
});

test('age adds the GPS position age', () => {
  const s = L.liveState({ planned: iso(5), estimated: iso(5), realtime: true, seenAt: NOW - sec(10), vehicleAgeS: 25 }, NOW);
  assert.equal(s.kind, 'live');
  assert.equal(s.age, '30 s ago');
});

test('no live time: Timetable, grey countdown, never "left"', () => {
  const s = L.liveState({ planned: iso(4), estimated: null, realtime: false }, NOW);
  assert.equal(s.kind, 'timetable');
  assert.equal(s.label, 'Timetable');
  assert.equal(s.big, '4');
  assert.equal(s.soon, false);
  assert.equal(s.age, null);
  const past = L.liveState({ planned: iso(-3), realtime: false }, NOW);
  assert.equal(past.kind, 'timetable');
  assert.notEqual(past.big, 'Gone');
  assert.notEqual(past.big, 'Left');
  assert.match(past.big, /^\d{1,2}:\d{2}(am|pm)$/);
  assert.equal(past.counting, false);
  assert.match(past.a11y, /not tracked/);
});

test('realtime flag without an estimate counts as timetable', () => {
  assert.equal(L.liveState({ planned: iso(4), estimated: null, realtime: true }, NOW).kind, 'timetable');
});

test('stale GPS: Not tracking, shows the timetable time, no countdown to 0', () => {
  const s = L.liveState({ planned: iso(2), estimated: iso(1), realtime: true, seenAt: NOW - sec(5), vehicleAgeS: 240 }, NOW);
  assert.equal(s.kind, 'stale');
  assert.equal(s.label, 'Not tracking');
  assert.equal(s.counting, false);
  assert.equal(s.t, Date.parse(iso(2)));
  assert.match(s.big, /am|pm/);
});

test('our copy older than 2 min: close services stop counting, far ones show the age', () => {
  const near = L.liveState({ planned: iso(3), estimated: iso(4), realtime: true, seenAt: NOW - sec(150) }, NOW);
  assert.equal(near.kind, 'stale');
  const far = L.liveState({ planned: iso(30), estimated: iso(32), realtime: true, seenAt: NOW - sec(150) }, NOW);
  assert.equal(far.kind, 'live');
  assert.equal(far.age, '2 min ago');
});

test('a live time that passed while still listed: Now for a minute, then Not tracking (not Gone)', () => {
  assert.equal(L.liveState({ planned: iso(-1), estimated: iso(-0.5), realtime: true, seenAt: NOW - sec(10) }, NOW).big, 'Now');
  const s = L.liveState({ planned: iso(-3), estimated: iso(-2), realtime: true, seenAt: NOW - sec(10) }, NOW);
  assert.equal(s.kind, 'stale');
  assert.notEqual(s.big, 'Gone');
});

test('cancelled stays cancelled, a past one shows its time', () => {
  assert.equal(L.liveState({ planned: iso(5), realtime: true, estimated: iso(5), cancelled: true }, NOW).kind, 'cancelled');
  const p = L.liveState({ planned: iso(-5), cancelled: true }, NOW);
  assert.equal(p.counting, false);
  assert.match(p.big, /am|pm/);
});

test('liveKey changes with the countdown and the age step, not every second', () => {
  const x = { planned: iso(5), estimated: iso(5), realtime: true, seenAt: NOW };
  assert.equal(L.liveKey(x, NOW + sec(1)), L.liveKey(x, NOW + sec(5)));
  assert.notEqual(L.liveKey(x, NOW + sec(1)), L.liveKey(x, NOW + sec(16)));
});

test('stampSeen marks rows and legs once', () => {
  const r = { items: [{ planned: iso(1) }, { planned: iso(2), seenAt: 5 }], journeys: [{ legs: [{ kind: 'walk' }, { kind: 'transit' }] }] };
  L.stampSeen(r, 100);
  assert.equal(r.seenAt, 100);
  assert.equal(r.items[0].seenAt, 100);
  assert.equal(r.items[1].seenAt, 5);
  assert.equal(r.journeys[0].legs[1].seenAt, 100);
  L.stampSeen(r, 200);
  assert.equal(r.items[0].seenAt, 100);
  assert.equal(L.stampSeen(null, 1), null);
});

// ---- Recently departed ----
const row = (o) => ({ line: '410', mode: 'bus', dest: 'Rockdale', stopId: '2046100', tripId: 't' + o.n, planned: iso(o.p), estimated: o.e == null ? null : iso(o.e), realtime: o.e != null, delayMin: o.e != null ? o.e - o.p : null, vehicle: o.gps != null ? { ageS: o.gps } : undefined });

test('a live service tracked to its departure that drops off: Left, with its delay', () => {
  const m = R.createRecent();
  const a = row({ n: 1, p: 0, e: 2 }), b = row({ n: 2, p: 10, e: 10 });
  m.note('S', [a, b], NOW + sec(60));
  m.note('S', [b], NOW + sec(170));
  const l = m.list('S', NOW + sec(170));
  assert.equal(l.length, 1);
  assert.equal(l[0].confirmed, true);
  assert.equal(l[0].left, Date.parse(iso(2)));
  assert.equal(l[0].delayMin, 2);
  const w = R.departedWords(l[0], () => '8:02am');
  assert.equal(w.main, 'Left 8:02am');
  assert.equal(w.sub, 'Live, 2 min late');
});

test('timetable only service that drops off: listed as not tracked, never "Left"', () => {
  const m = R.createRecent();
  m.note('S', [row({ n: 1, p: 1 })], NOW);
  m.note('S', [], NOW + sec(110));
  const l = m.list('S', NOW + sec(110));
  assert.equal(l.length, 1);
  assert.equal(l[0].confirmed, false);
  assert.equal(l[0].left, null);
  const w = R.departedWords(l[0], () => '8:01am');
  assert.equal(w.main, 'Due 8:01am');
  assert.doesNotMatch(w.main + w.sub, /Left|left/);
});

test('live time last read long before it left, or with stale GPS: not confirmed', () => {
  const m = R.createRecent();
  m.note('S', [row({ n: 1, p: 1, e: 4 })], NOW);            // read 4 min before its time
  m.note('S', [], NOW + sec(170));
  assert.equal(m.list('S', NOW + sec(170))[0].confirmed, false);
  const g = R.createRecent();
  g.note('S', [row({ n: 1, p: 0, e: 1, gps: 400 })], NOW + sec(30));
  g.note('S', [], NOW + sec(100));
  assert.equal(g.list('S', NOW + sec(100))[0].confirmed, false);
});

test('a service that drops off long before its time is not a departure; a gap between reads records nothing', () => {
  const m = R.createRecent();
  m.note('S', [row({ n: 1, p: 20, e: 20 })], NOW);
  m.note('S', [], NOW + sec(20));
  assert.equal(m.list('S', NOW + sec(20)).length, 0);
  const g = R.createRecent();
  g.note('S', [row({ n: 1, p: 1, e: 1 })], NOW);
  g.note('S', [], NOW + sec(600));
  assert.equal(g.list('S', NOW + sec(600)).length, 0);
});

test('cancelled rows are not departures; old ones age out; newest first', () => {
  const m = R.createRecent();
  m.note('S', [{ ...row({ n: 1, p: 0, e: 0 }), cancelled: true }, row({ n: 2, p: 1, e: 1 }), row({ n: 3, p: 2, e: 2 })], NOW + sec(50));
  m.note('S', [row({ n: 3, p: 2, e: 2 })], NOW + sec(100));
  m.note('S', [], NOW + sec(160));
  const l = m.list('S', NOW + sec(160));
  assert.deepEqual(l.map((x) => x.tripId), ['t3', 't2']);
  assert.equal(m.list('S', NOW + sec(60 * 14)).length, 0);
});
