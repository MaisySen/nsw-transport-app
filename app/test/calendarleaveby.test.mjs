// Calendar leave by (docs/CALENDAR-LEAVE-BY.md): which events, the place match, the cache, the trip to take,
// the words on Home, the trip screen params, the build gate, and source checks for privacy and battery.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-calleave-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const m = await load('src/lib/calendarLeaveByCore.ts');
const pc = await load('src/lib/planCore.ts');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// 25 Oct 2026, 7:00am Sydney (AEDT, UTC+11).
const NOW = Date.UTC(2026, 9, 24, 20, 0);
const at = (h, mm = 0) => NOW + ((h - 7) * 60 + mm) * 60000;
const ev = (o) => ({ id: 'e', title: 'Team meeting', start: at(9), end: at(10), location: 'Barangaroo', ...o });

test('locations: first line, room and level dropped, online meetings and links are not places', () => {
  assert.equal(m.cleanLocation('Barangaroo'), 'Barangaroo');
  assert.equal(m.cleanLocation('Level 3, 200 Barangaroo Ave\nSydney NSW 2000'), '200 Barangaroo Ave');
  assert.equal(m.cleanLocation('Room 4.02 / Level 3 - 1 Martin Pl'), '1 Martin Pl');
  assert.equal(m.cleanLocation('Levels Cafe, Parramatta'), 'Levels Cafe, Parramatta');
  assert.equal(m.cleanLocation('Microsoft Teams Meeting'), null);
  assert.equal(m.cleanLocation('https://zoom.us/j/123'), null);
  assert.equal(m.cleanLocation('Google Meet'), null);
  assert.equal(m.cleanLocation('  '), null);
  assert.equal(m.cleanLocation('42'), null);
  assert.equal(m.cleanLocation(null), null);
  assert.equal(m.cleanLocation('x'.repeat(200)).length, 80);
});

test('events: next 6 hours only, not all day, not cancelled, with a place, soonest first', () => {
  const list = [
    ev({ id: 'later', start: at(12) }),
    ev({ id: 'soon', start: at(8) }),
    ev({ id: 'past', start: at(6, 50) }),
    ev({ id: 'far', start: at(13, 30) }),
    ev({ id: 'allday', allDay: true }),
    ev({ id: 'cancel', status: 'CANCELED' }),
    ev({ id: 'online', location: 'Zoom' }),
    ev({ id: 'noloc', location: '' }),
  ];
  assert.deepEqual(m.pickEvents(list, NOW).map((e) => e.id), ['soon', 'later']);
  assert.equal(m.pickEvents(list, NOW)[0].place, 'Barangaroo');
  // The same place and time twice (two calendars) is one event.
  assert.equal(m.pickEvents([ev({ id: 'a' }), ev({ id: 'b' })], NOW).length, 1);
  assert.equal(m.CAL.windowMs, 6 * 3600000);
  assert.equal(m.CAL.everyMs, 5 * 60000);
});

test('place match: a result has to share a word with the location, else nothing', () => {
  const items = [{ id: '1', name: 'Wynyard Station' }, { id: '2', name: 'Barangaroo Wharf 1', area: 'Barangaroo' }];
  assert.deepEqual(m.chooseResolved(items, 'Barangaroo'), { id: '2', name: 'Barangaroo Wharf 1' });
  assert.equal(m.chooseResolved(items, 'Level 3 Room 4'), null);
  assert.equal(m.chooseResolved([], 'Barangaroo'), null);
  assert.equal(m.chooseResolved([{ id: '', name: 'Barangaroo' }], 'Barangaroo'), null);
  assert.deepEqual(m.keyWords('200 Barangaroo Ave, Sydney NSW'), ['200', 'barangaroo', 'ave'].filter((w) => /[a-z]/.test(w)));
});

test('place cache: hits kept 30 days, misses retried after a day, capped', () => {
  let c = m.rememberPlace({}, 'Barangaroo', { id: '2', name: 'Barangaroo' }, NOW);
  c = m.rememberPlace(c, 'Room 4', null, NOW);
  assert.deepEqual(m.cachedPlace(c, 'barangaroo', NOW + 86400000), { id: '2', name: 'Barangaroo' });
  assert.equal(m.cachedPlace(c, 'Barangaroo', NOW + 31 * 86400000), undefined);
  assert.equal(m.cachedPlace(c, 'Room 4', NOW + 3600000), null);
  assert.equal(m.cachedPlace(c, 'Room 4', NOW + 2 * 86400000), undefined);
  assert.equal(m.cachedPlace(c, 'Central', NOW), undefined);
  let big = {};
  for (let i = 0; i < 80; i++) big = m.rememberPlace(big, `Place ${String.fromCharCode(97 + (i % 26))}${i}`, null, NOW + i);
  assert.equal(Object.keys(big).length, m.CAL.maxCache);
  assert.ok(m.cachedPlace(big, `Place ${String.fromCharCode(97 + (79 % 26))}79`, NOW + 100) === null);
});

test('origin: commute start, else first trip start, else home or work', () => {
  const H = { id: 'h', name: 'Strathfield Station' }, W = { id: 'w', name: 'Town Hall Station' }, F = { id: 'f', name: 'Burwood' };
  assert.deepEqual(m.pickOrigin(W, F, { home: H }), W);
  assert.deepEqual(m.pickOrigin(null, F, { home: H }), F);
  assert.deepEqual(m.pickOrigin(null, null, { work: W }), W);
  assert.equal(m.pickOrigin(null, null, {}), null);
});

test('leave by: the last trip that still arrives by the start and has not left', () => {
  const iso = (t) => new Date(t).toISOString();
  const J = (l, a, line = 'T1') => ({ leave: iso(l), arrive: iso(a), legs: [{ kind: 'walk' }, { kind: 'transit', line, from: 'Strathfield Station, Platform 3' }] });
  const js = [J(at(7, 50), at(8, 30)), J(at(8, 12), at(8, 51)), J(at(8, 25), at(9, 4)), J(at(6, 40), at(7, 20))];
  const lb = m.leaveBy(js, at(9), NOW);
  assert.equal(lb.leave, at(8, 12));
  assert.equal(lb.arrive, at(8, 51));
  assert.equal(m.leaveBy([J(at(8, 25), at(9, 4))], at(9), NOW), null);
  assert.equal(m.leaveBy([], at(9), NOW), null);
  assert.equal(m.leaveTitle('Team meeting', 'Barangaroo Wharf 1, Barangaroo', lb.leave, NOW), 'Leave by 8:12am for Team meeting (Barangaroo Wharf 1)');
  assert.equal(m.leaveTitle('', 'Central Station', at(7), NOW), 'Leave now for your event (Central)');
  assert.equal(m.leaveSub(lb.j, lb.arrive, at(9)), 'T1 from Strathfield, arrive 8:51am. Starts 9:00am');
});

test('trip screen params: Arrive by the start, the day only when it is not today', () => {
  const S = { id: '213510', name: 'Strathfield Station' }, B = { id: '2', name: 'Barangaroo' };
  assert.deepEqual(m.tripParams(S, B, at(9), NOW), { from: '213510', fromName: 'Strathfield Station', to: '2', toName: 'Barangaroo', time: '0900', arriveBy: '1' });
  const late = Date.UTC(2026, 9, 25, 13, 30); // 12:30am Monday 26 Oct
  const evening = Date.UTC(2026, 9, 25, 10, 0); // 9pm Sunday
  assert.deepEqual(m.tripParams(S, B, late, evening), { from: '213510', fromName: 'Strathfield Station', to: '2', toName: 'Barangaroo', time: '0030', arriveBy: '1', date: '20261026' });
  assert.deepEqual(m.tripQuery(at(9), NOW), { time: '0900', arriveBy: true });
});

test('trip screen at Arrive by opens the trip that leaves last and still arrives in time', () => {
  const L = [{ leave: at(7, 44), arrive: at(8, 8) }, { leave: at(6, 44), arrive: at(7, 12) }, { leave: at(8, 1), arrive: at(8, 20) }, { leave: at(7, 29), arrive: at(7, 53) }];
  assert.equal(pc.arriveByIndex(L, at(8, 15)), 0);
  assert.equal(pc.arriveByIndex(L, at(7, 0)), -1);
  assert.equal(pc.arriveByIndex([], at(8)), -1);
  assert.equal(pc.arriveByIndex([{ leave: NaN, arrive: at(7) }], at(8)), -1);
  const trip = read('src/app/trip.tsx');
  assert.match(trip, /when\.kind !== 'arrive' \|\| p\.pick != null/);
});

test('build gate: iPhone 208 and later with the module, Android with the module, never web', () => {
  assert.equal(m.readSupported('ios', false, false, '205'), false);
  assert.equal(m.readSupported('ios', true, true, '206'), false);
  assert.equal(m.readSupported('ios', true, true, '207'), false);
  assert.equal(m.readSupported('ios', true, true, '208'), true);
  assert.equal(m.readSupported('ios', true, false, '208'), false);
  assert.equal(m.readSupported('ios', true, true, null), false);
  assert.equal(m.readSupported('android', true, false, '6'), true);
  assert.equal(m.readSupported('android', false, false, '5'), false);
  assert.equal(m.readSupported('web', true, true, '208'), false);
});

test('source: off by default, read only, nothing but the place search and the trip query leave the phone', () => {
  const store = read('src/lib/store.ts');
  assert.match(store, /calLeaveBy\?: boolean/);
  assert.doesNotMatch(store.match(/const EMPTY: State = [^\n]+/)[0], /calLeaveBy/);
  const lib = read('src/lib/calendarLeaveBy.ts');
  // Read only: no create, update or delete of events, and the dev mock is dev and web only.
  assert.doesNotMatch(lib, /createEventAsync|updateEventAsync|deleteEventAsync|createCalendarAsync/);
  assert.match(lib, /__DEV__ \|\| Platform\.OS !== 'web'/);
  // iPhone asks through the module that checks the app has the full access text (a refusal, not a crash, on 206 and 207).
  assert.match(lib, /requestCalendarPermissions;[\s\S]*ask\(false\)/);
  const card = read('src/components/CalendarLeaveBy.tsx');
  assert.match(card, /searchPlaces\(e\.place\)/);
  assert.match(card, /tripForCalendar\(o\.id, p\.id, tripQuery\(e\.start, t\)\)/);
  // The calendar trip query carries no install id, profile or names (so the server keeps no trip history from it).
  const api = read('src/lib/api.ts');
  const fn = api.slice(api.indexOf('export async function tripForCalendar'), api.indexOf('/** One GET to the new server'));
  assert.ok(fn.length > 100);
  assert.doesNotMatch(fn, /getDevice|PROFILE|fromName|toName/);
  assert.doesNotMatch(card, /fetch\(|api\.(saveTrip|watch|saveCommute)|e\.title[^\n]*api\./);
  // Battery: only through useScreenPoll, every 5 minutes, nothing in the background.
  assert.match(card, /useScreenPoll\([^\n]*CAL\.everyMs/);
  assert.doesNotMatch(card, /setInterval|startAppPoll|BackgroundFetch|TaskManager/);
  const settings = read('src/app/(tabs)/settings/index.tsx');
  assert.match(settings, /calOn \? \(/);
});
