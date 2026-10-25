// Trip screen at a chosen time in the past: what the list keeps, the Left words, how far Earlier goes, the pinned day.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-trippast-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const m = await load('src/lib/tripModesCore.ts');

// Sunday 25 Oct 2026, 6:27pm Sydney (AEDT, UTC+11): Bidur's screenshot.
const NOW = Date.parse('2026-10-25T07:27:00Z');
const at = (hhmm) => Date.parse(`2026-10-25T${String(+hhmm.slice(0, 2) - 11).padStart(2, '0')}:${hhmm.slice(2)}:00Z`);
const hm = (t) => new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)$/i, '');
const LEAVE_615 = { kind: 'leave', h: 18, m: 15 };

test('a time picked today is pinned to today, over 30 min ago too, and an old one with no day to tomorrow', () => {
  assert.deepEqual(m.pinDay(LEAVE_615, NOW), { ...LEAVE_615, day: '20261025' });
  assert.deepEqual(m.pinDay({ kind: 'leave', h: 17, m: 0, day: '20261025' }, NOW).day, '20261025', 'picked on Today stays today');
  assert.equal(m.pinDay({ kind: 'leave', h: 9, m: 0 }, NOW).day, '20261026', 'no day and over 30 min ago means tomorrow, the servers rule');
  assert.deepEqual(m.pinDay({ kind: 'now' }, NOW), { kind: 'now' });
});

test('Leave 6:15pm picked at 6:27pm is still today at 7pm: the request gains today\'s date instead of turning into tomorrow', () => {
  const w = m.pinDay(LEAVE_615, NOW);
  assert.deepEqual(m.queryAt(w, NOW), { time: '1815' }, 'within 30 min: a plain time, which the older server plans for today');
  const seven = at('1900');
  assert.deepEqual(m.queryAt(w, seven), { time: '1815', date: '20261025' }, 'later on the date goes too (new server)');
  assert.equal(m.whenKeyOf(w), '1815l20261025', 'the key stays the same, so the list is not reset as the clock moves');
  assert.equal(m.whenWords(w, seven), 'Leave 6:15pm', 'no "tomorrow" on a time picked for today');
});

test('Arrive by in the past and other days: request, words and the moment', () => {
  const a = m.pinDay({ kind: 'arrive', h: 18, m: 0 }, NOW);
  assert.deepEqual(m.queryAt(a, NOW), { time: '1800', arriveBy: true });
  assert.equal(m.whenWords(a, NOW), 'Arrive by 6:00pm');
  assert.equal(m.whenAt(a, NOW), at('1800'));
  assert.equal(m.isPastWhen(a, NOW), true);
  assert.equal(m.whenWords(m.pinDay({ kind: 'leave', h: 9, m: 5 }, NOW), NOW), 'Leave 9:05am tomorrow');
  assert.equal(m.whenWords({ kind: 'leave', h: 8, m: 15, day: '20261027' }, NOW), 'Leave 8:15am Tue 27 Oct');
  assert.deepEqual(m.queryAt({ kind: 'leave', h: 8, m: 15, day: '20261027' }, NOW), { time: '0815', date: '20261027' });
  assert.equal(m.isPastWhen(m.pinDay({ kind: 'leave', h: 19, m: 0 }, NOW), NOW), false);
  assert.equal(m.isPastWhen({ kind: 'now' }, NOW), false);
  assert.equal(m.whenWords({ kind: 'now' }, NOW), 'Leave now');
});

test('the list keeps the planner\'s whole answer for a chosen time, gone services included; Now is unchanged', () => {
  const w = m.pinDay(LEAVE_615, NOW);
  const k = m.keepFrom(w, m.whenAt(w, NOW), NOW);
  const answer = ['1818', '1824', '1830', '1836'].map(at);
  assert.deepEqual(answer.filter((t) => t > k.main), answer, 'the 6:18 and the 6:24 stay (the bug dropped them)');
  const kn = m.keepFrom({ kind: 'now' }, NOW, NOW);
  assert.equal(kn.main, NOW - 120000, 'Now: gone over 2 min ago drops off, as before');
  assert.equal(kn.extra, NOW - 30 * 60000, 'Now: Earlier batches stay half an hour, as before');
  assert.equal(k.extra, at('1615'), 'a chosen time: Earlier batches stay down to 2 hours before it');
});

test('Earlier services reach back from a past time, not only half an hour before now', () => {
  const w = m.pinDay(LEAVE_615, NOW);
  const floor = m.earlierFloor(w, m.whenAt(w, NOW), NOW);
  assert.equal(floor, at('1615'));
  assert.equal(m.canLoadEarlier(m.PAGE0, at('1818'), floor, true), true, 'a pull at the top asks for the services before 6:18');
  assert.equal(m.earlierFrom(at('1818'), floor), at('1738'), 'the batch starts 40 min earlier');
  // Three batches back, then the cap.
  let st = m.PAGE0, first = at('1818');
  for (let i = 0; i < 3; i++) { assert.equal(m.canLoadEarlier(st, first, floor, true), true); first = m.earlierFrom(first, floor); st = m.afterBatch(st, 2, null, Infinity); }
  assert.equal(m.canLoadEarlier(st, first, floor, true), false, 'capped at 3 batches a visit');
  // Arrive by goes further back (its trips leave well before the time); Now keeps its half hour.
  assert.equal(m.earlierFloor({ kind: 'arrive', h: 18, m: 0, day: '20261025' }, at('1800'), NOW), at('1400'));
  assert.equal(m.earlierFloor({ kind: 'now' }, NOW, NOW), NOW - 30 * 60000);
  assert.equal(m.canLoadEarlier(m.PAGE0, NOW + 60000, NOW - 30 * 60000, true), true);
});

test('an Earlier batch over 30 min back asks with today\'s date (new server); within 30 min a plain time', () => {
  const t = at('1738');
  assert.equal(m.dateNeeded(m.ymd(t), 17, 38, NOW), '20261025');
  assert.equal(m.dateNeeded(m.ymd(at('1805')), 18, 5, NOW), null);
  assert.match(m.EARLIER_NEEDS_NEW, /^Earlier trips need a newer server/);
});

test('gone services: Left from over a minute ago, with the live delay they left with', () => {
  assert.equal(m.hasLeft(at('1818'), NOW), true);
  assert.equal(m.hasLeft(NOW - 30000, NOW), false, 'under a minute: still Now on the countdown');
  assert.equal(m.hasLeft(at('1830'), NOW), false);
  assert.equal(m.hasLeft(NaN, NOW), false);
  assert.equal(m.leftWords(at('1821'), { realtime: true, delayMin: 3 }, hm), 'Left 6:21 \u00b7 3 min late');
  assert.equal(m.leftWords(at('1818'), { realtime: true, delayMin: 0 }, hm), 'Left 6:18 \u00b7 On time');
  assert.equal(m.leftWords(at('1817'), { realtime: true, delayMin: -1 }, hm), 'Left 6:17 \u00b7 1 min early');
  assert.equal(m.leftWords(at('1824'), { realtime: false }, hm), 'Left 6:24 \u00b7 Scheduled', 'no live time: says so');
  assert.equal(m.leftWords(at('1824'), { cancelled: true, realtime: true }, hm), 'Cancelled 6:24');
  assert.equal(m.leftWords(at('1824'), null, hm), 'Left 6:24 \u00b7 Scheduled');
});

test('no em or en dashes in the new words', () => {
  for (const s of [m.EARLIER_NEEDS_NEW, m.leftWords(at('1821'), { realtime: true, delayMin: 3 }, hm), m.whenWords(m.pinDay(LEAVE_615, NOW), NOW)]) assert.doesNotMatch(s, /[\u2013\u2014]/);
});
