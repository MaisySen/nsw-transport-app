// Plan tab trip rows (27 Oct 2026): times in the phone's clock ("12:56 pm" or 24 hour), the time left badge
// ("12 min", "2 hrs") and On time only when the row carries a live reading. Pure parts run here; the rows are
// checked in the source.
// Run: TZ=Australia/Sydney OFFLINE=1 node --test test/planrows.test.mjs
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
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-planrows-'));
const js = ts.transpileModule(read('src/lib/rowTimeCore.ts'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
fs.writeFileSync(path.join(out, 'rowTimeCore.mjs'), js);
const R = await import(pathToFileURL(path.join(out, 'rowTimeCore.mjs')).href);

const min = 60000;
// 27 Oct 2026 10:16 am in Sydney (AEDT, UTC+11): the moment of the screenshot that showed the bug.
const NOW = Date.parse('2026-10-26T23:16:00Z');
const at = (h, m) => Date.parse(`2026-10-27T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+11:00`);

test('the phone clock setting: iPhone 24-Hour Time wins, then the locale hour cycle, else 12 hour', () => {
  assert.equal(R.uses24h({ force24: true, hourCycle: 'h12' }), true);
  assert.equal(R.uses24h({ force24: false, hourCycle: 'h23' }), false);
  assert.equal(R.uses24h({ hourCycle: 'h23' }), true);
  assert.equal(R.uses24h({ hourCycle: 'h24' }), true);
  assert.equal(R.uses24h({ hourCycle: 'h12' }), false);
  assert.equal(R.uses24h({ hourCycle: 'h11' }), false);
  assert.equal(R.uses24h({ hour12: false }), true);
  assert.equal(R.uses24h({ hour12: true }), false);
  assert.equal(R.uses24h({}), false);
  assert.equal(R.uses24h(null), false);
});

test('12 hour rows read "12:56 pm": lowercase, with a space, Sydney time', () => {
  assert.equal(R.rowClock(at(12, 56), false), '12:56 pm');
  assert.equal(R.rowClock(at(13, 38), false), '1:38 pm');
  assert.equal(R.rowClock(at(9, 5), false), '9:05 am');
  assert.equal(R.rowClock(at(0, 5), false), '12:05 am');
  assert.equal(R.rowClock(at(12, 0), false), '12:00 pm');
  assert.equal(R.rowClock(at(23, 59), false), '11:59 pm');
  assert.equal(R.rowClock(NaN, false), '');
  assert.doesNotMatch(R.rowClock(at(12, 56), false), /[AP]M/);
});

test('24 hour rows read "12:56" and "09:05", with no am or pm', () => {
  assert.equal(R.rowClock(at(12, 56), true), '12:56');
  assert.equal(R.rowClock(at(13, 38), true), '13:38');
  assert.equal(R.rowClock(at(9, 5), true), '09:05');
  assert.equal(R.rowClock(at(0, 5), true), '00:05');
  assert.equal(R.rowClock(at(23, 59), true), '23:59');
});

test('rows keep Sydney time across the daylight saving change', () => {
  // 5 Apr 2026, 3 am AEDT becomes 2 am AEST: 15:30 UTC on 4 Apr is 2:30 am AEDT, 16:30 UTC is 2:30 am AEST.
  assert.equal(R.rowClock(Date.parse('2026-04-04T15:30:00Z'), false), '2:30 am');
  assert.equal(R.rowClock(Date.parse('2026-04-04T16:30:00Z'), true), '02:30');
});

test('time left badge: Now, minutes under an hour, then whole hours rounded down, then days', () => {
  const b = (t) => R.badgeText(R.timeLeftBadge(t, NOW));
  assert.equal(b(NOW + 20000), 'Now');
  assert.equal(b(NOW - 50000), 'Now');
  assert.equal(b(NOW + 59999), 'Now');
  assert.equal(b(NOW + min), '1 min');
  assert.equal(b(NOW + 12 * min + 30000), '12 min');
  assert.equal(b(NOW + 59 * min + 59000), '59 min');
  assert.equal(b(NOW + 60 * min), '1 hr');
  assert.equal(b(NOW + 119 * min), '1 hr');
  assert.equal(b(NOW + 120 * min), '2 hrs');
  // The screenshot's rows at 10:16 am: 12:29 pm, 12:56 pm, 1:29 pm, 1:38 pm.
  assert.equal(b(at(12, 29)), '2 hrs');
  assert.equal(b(at(12, 56)), '2 hrs');
  assert.equal(b(at(13, 29)), '3 hrs');
  assert.equal(b(at(13, 38)), '3 hrs');
  assert.equal(b(NOW + 23 * 60 * min + 59 * min), '23 hrs');
  assert.equal(b(NOW + 24 * 60 * min), '1 day');
  assert.equal(b(NOW + 50 * 60 * min), '2 days');
  assert.equal(b(NOW - 2 * min), 'Left');
  assert.equal(R.timeLeftBadge(NaN, NOW).big, '');
});

test('time left badge parts and spoken words', () => {
  assert.deepEqual(R.timeLeftBadge(NOW + 2 * 60 * min + 5 * min, NOW), { big: '2', unit: 'hrs', a11y: 'in 2 hours', mins: 125 });
  assert.deepEqual(R.timeLeftBadge(NOW + 61 * min, NOW), { big: '1', unit: 'hr', a11y: 'in 1 hour', mins: 61 });
  assert.deepEqual(R.timeLeftBadge(NOW + 1 * min, NOW), { big: '1', unit: 'min', a11y: 'in 1 minute', mins: 1 });
  assert.equal(R.timeLeftBadge(NOW + 10000, NOW).a11y, 'leaving now');
});

test('the badge changes at most once a minute, so the existing tick redraws rows rarely', () => {
  const seen = new Set();
  for (let s = 0; s < 60; s += 5) seen.add(R.badgeText(R.timeLeftBadge(at(13, 29), NOW + s * 1000)));
  assert.equal(seen.size, 1);
});

test('status rule: a trip 3 hours out with the timetable echoed as live says Scheduled', () => {
  // The 1:29 pm row at 10:16 am: realtime set, estimate equal to the timetable, delay 0.
  const echo = { planned: new Date(at(13, 29)).toISOString(), estimated: new Date(at(13, 29)).toISOString(), realtime: true, delayMin: 0 };
  assert.equal(R.hasLiveData(echo, NOW), false);
  // The same reading inside the hour is live: On time.
  assert.equal(R.hasLiveData(echo, at(12, 40)), true);
  assert.equal(R.hasLiveData(echo, at(12, 29)), true);
});

test('status rule: a real delay, early running or a placed vehicle is live at any distance', () => {
  const p = new Date(at(13, 29)).toISOString();
  assert.equal(R.hasLiveData({ planned: p, estimated: new Date(at(13, 32)).toISOString(), realtime: true, delayMin: 3 }, NOW), true);
  assert.equal(R.hasLiveData({ planned: p, estimated: new Date(at(13, 27)).toISOString(), realtime: true, delayMin: -2 }, NOW), true);
  assert.equal(R.hasLiveData({ planned: p, estimated: new Date(at(13, 31)).toISOString(), realtime: true, delayMin: null }, NOW), true);
  assert.equal(R.hasLiveData({ planned: p, estimated: p, realtime: true, delayMin: 0, vehicle: { lat: -33.8, lon: 151.1 } }, NOW), true);
  assert.equal(R.hasLiveData({ planned: p, estimated: p, realtime: true, delayMin: 0, stopsAway: 4 }, NOW), true);
});

test('status rule: no realtime flag or no estimate is never live', () => {
  const p = new Date(at(10, 30)).toISOString();
  assert.equal(R.hasLiveData({ planned: p, estimated: p, realtime: false, delayMin: 0 }, NOW), false);
  assert.equal(R.hasLiveData({ planned: p, estimated: null, realtime: true, delayMin: 0 }, NOW), false);
  assert.equal(R.hasLiveData({ planned: p, estimated: null, realtime: true, delayMin: 4 }, NOW), false);
  assert.equal(R.hasLiveData(null, NOW), false);
  assert.equal(R.hasLiveData(undefined, NOW), false);
});

test('where you get on reads with its platform; where you get off reads as the place', () => {
  assert.equal(R.boardText('Lidcombe Station', 'Platform 3'), 'Lidcombe Platform 3');
  assert.equal(R.boardText('Lidcombe', 'Platform 3'), 'Lidcombe Platform 3');
  assert.equal(R.boardText('Parramatta Station', 'Stand B4'), 'Parramatta Stand B4');
  assert.equal(R.boardText('Lidcombe Station', ''), 'Lidcombe');
  assert.equal(R.boardText('', 'Platform 1'), 'Platform 1');
  assert.equal(R.boardText('Wynyard Station, Sydney', null), 'Wynyard');
  assert.deepEqual(R.boardParts('Lidcombe Station', 'Platform 3'), { name: 'Lidcombe', platform: 'Platform 3' });
  assert.deepEqual(R.boardParts('Lidcombe Station', ''), { name: 'Lidcombe', platform: '' });
  assert.deepEqual(R.boardParts('', 'Platform 1'), { name: 'Platform 1', platform: '' });
  assert.equal(R.placeText('Lakemba Station'), 'Lakemba');
  assert.equal(R.placeText('Circular Quay, Wharf 4'), 'Circular Quay');
  assert.equal(R.placeText(null), '');
});

test('the lines a trip rides, once each, transit legs only, in order', () => {
  const legs = [{ kind: 'walk', line: '' }, { kind: 'transit', line: 'T9' }, { kind: 'transit', line: 'M20' }, { kind: 'transit', line: 'T9' }, { kind: 'transit', line: '' }];
  assert.deepEqual(R.tripLines(legs).map((l) => l.line), ['T9', 'M20']);
});

test('columns sit side by side at normal sizes and stack for big Dynamic Type on narrow phones', () => {
  assert.equal(R.stackColumns(390, 1), false);
  assert.equal(R.stackColumns(430, 1.4), false);
  assert.equal(R.stackColumns(375, 1), false);
  assert.equal(R.stackColumns(375, 1.4), true);
  assert.equal(R.stackColumns(320, 1.2), true);
  assert.equal(R.stackColumns(390, 3), R.stackColumns(390, 1.4));
});

test('trip rows use the phone clock, the time left badge and the live rule', () => {
  const home = read('src/components/Home.tsx');
  const row = home.slice(home.indexOf('function ServiceRowView('), home.indexOf('// ---------- stop boards'));
  assert.match(row, /timeLeftBadge\(dep, now\)/);
  assert.match(row, /rowTime\(dep\)/);
  assert.match(row, /rowTime\(arrive\)/);
  assert.match(row, /boardText\(l\?\.from, l\?\.fromPlatform\)/);
  assert.match(row, /boardParts\(l\?\.from, l\?\.fromPlatform\)/);
  assert.match(row, /tripLines\(j\.legs\)/);
  assert.doesNotMatch(row, /\bhm\(/);
  assert.doesNotMatch(row, /\bcd\(dep/);
  const status = home.slice(home.indexOf('function statusOf('), home.indexOf('export type TripItem'));
  assert.match(status, /if \(hasLiveData\(l, now\)\)/);
  assert.doesNotMatch(status, /if \(l\.realtime\)/);
  assert.match(home, /if \(hasLiveData\(l, t\)\) holds\.set/);
  const left = read('src/components/LeftRow.tsx');
  assert.match(left, /rowTime\(dep\)/);
  assert.match(left, /rowTime\(arrive\)/);
  assert.match(read('src/app/trip.tsx'), /realtime=\{hasLiveData\(l, now\)\}/);
});

test('the clock setting is read without timers, listeners or new native modules', () => {
  const src = read('src/lib/rowTime.ts') + read('src/lib/rowTimeCore.ts');
  assert.doesNotMatch(src, /setInterval|setTimeout|addEventListener|requireNativeModule|NativeModules/);
  assert.match(read('src/lib/rowTime.ts'), /Platform\.OS === 'ios'/);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies['expo-localization'], undefined);
});
