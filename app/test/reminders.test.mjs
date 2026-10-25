// Trip reminders: several per saved trip, per weekday (reminderCore.ts), weekly local notifications (reminders.ts).
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-remind-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const r = await load('src/lib/reminderCore.ts');
const read = (f) => fs.readFileSync(path.join(here, '..', f), 'utf8');

test('clean reminders: whole times, days 1 to 7 sorted without repeats', () => {
  assert.deepEqual(r.cleanReminder({ id: 'a', hour: 7, minute: 30, days: [6, 2, 2, 4] }), { id: 'a', hour: 7, minute: 30, days: [2, 4, 6] });
  assert.equal(r.cleanReminder({ id: 'a', hour: 24, minute: 0, days: [2] }), null);
  assert.equal(r.cleanReminder({ id: 'a', hour: 7, minute: 60, days: [2] }), null);
  assert.equal(r.cleanReminder({ id: 'a', hour: 7.5, minute: 0, days: [2] }), null);
  assert.equal(r.cleanReminder({ id: 'a', hour: 7, minute: 0, days: [0, 8] }), null);
  assert.equal(r.cleanReminder({ hour: 7, minute: 0, days: [2] }), null);
  assert.equal(r.cleanReminder(null), null);
});

test('words: clock and days', () => {
  assert.equal(r.clockText(7, 5), '7:05am');
  assert.equal(r.clockText(0, 0), '12:00am');
  assert.equal(r.clockText(12, 30), '12:30pm');
  assert.equal(r.clockText(17, 45), '5:45pm');
  assert.equal(r.daysText([2, 3, 4, 5, 6]), 'Weekdays');
  assert.equal(r.daysText([1, 7]), 'Weekends');
  assert.equal(r.daysText([1, 2, 3, 4, 5, 6, 7]), 'Every day');
  assert.equal(r.daysText([3]), 'Tuesday');
  assert.equal(r.daysText([6, 2, 4]), 'Mon, Wed, Fri');
  assert.equal(r.reminderText({ id: 'x', hour: 7, minute: 30, days: [2, 3, 4, 5, 6] }), '7:30am, Weekdays');
});

test('several reminders per trip: one weekly notification per day, ids keyed by trip, reminder and day', () => {
  const plan = r.schedulePlan('A>B', [{ id: 'm', hour: 7, minute: 30, days: [2, 3, 4, 5, 6] }, { id: 'f', hour: 16, minute: 50, days: [6] }]);
  assert.equal(plan.length, 6);
  assert.deepEqual(plan[0], { id: 'trip-rem|A>B|m|2', weekday: 2, hour: 7, minute: 30 });
  assert.deepEqual(plan[5], { id: 'trip-rem|A>B|f|6', weekday: 6, hour: 16, minute: 50 });
  assert.ok(plan.every((p) => r.isTripReminderId(p.id)));
  assert.equal(r.isTripReminderId('leave-reminder'), false);
});

test('next ring is the next chosen day at the time, in phone time', () => {
  const rem = { id: 'm', hour: 7, minute: 30, days: [2] }; // Mondays
  const sat = new Date(2026, 9, 24, 12, 0).getTime(); // Saturday 24 Oct 2026, noon
  const next = new Date(r.nextRing(rem, sat));
  assert.equal(next.getDay(), 1);
  assert.equal(next.getDate(), 26);
  assert.equal(next.getHours(), 7);
  const monEarly = new Date(2026, 9, 26, 7, 0).getTime();
  assert.equal(new Date(r.nextRing(rem, monEarly)).getDate(), 26);
  const monLate = new Date(2026, 9, 26, 7, 31).getTime();
  assert.equal(new Date(r.nextRing(rem, monLate)).getDate(), 2);
});

test('a new reminder takes the suggested time on weekdays, else 7:30am', () => {
  assert.deepEqual(r.newReminder('x'), { id: 'x', hour: 7, minute: 30, days: [2, 3, 4, 5, 6] });
  assert.deepEqual(r.newReminder('y', { hour: 8, minute: 15 }).hour, 8);
});

test('reminders.ts: weekly trigger is feature detected, permission is asked only when a reminder is saved, nothing polls', () => {
  const src = read('src/lib/reminders.ts');
  assert.match(src, /SchedulableTriggerInputTypes;\s*return !!T\?\.WEEKLY/);
  assert.match(src, /type: T\.WEEKLY, weekday: p\.weekday, hour: p\.hour, minute: p\.minute/);
  assert.equal((src.match(/canNotify\(true\)/g) || []).length, 1);
  const save = src.slice(src.indexOf('export async function setTripReminders'));
  assert.ok(save.indexOf('remindersSupported()') < save.indexOf('canNotify(true)'));
  assert.doesNotMatch(src, /setInterval|fetch\(/);
  const ui = read('src/components/TripReminders.tsx');
  assert.doesNotMatch(ui, /canNotify|requestPermissions/);
  assert.match(ui, /if \(!remindersSupported\(\)\) return null/);
});

test('deleting a trip drops its reminders after Undo, Delete all my data drops all; a tap opens the trip', () => {
  const st = read('src/lib/store.ts');
  assert.match(st, /removeMyTrip\(key: string\) \{ dropReminders\(\[key\]\)/);
  assert.match(st, /removeMyTrips\(keys: string\[\]\) \{ dropReminders\(keys\)/);
  assert.match(st, /resetAll\(\) \{[^\n]*dropReminders\(null\)/);
  assert.match(st, /setTimeout\(\(\) => \{\s*const still = keys\.filter/);
  assert.match(read('src/app/_layout.tsx'), /d\.tripOpen[^\n]*router\.push\(\{ pathname: '\/trip', params: d\.tripOpen \}\)/);
  assert.match(read('src/app/trip.tsx'), /saved \? <TripReminders /);
});
