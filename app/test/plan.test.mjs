// Plan features: place search (addresses, streets, landmarks), Leave at / Arrive by, Clear all, and the
// Home header stamp in the rows' 12 hour format.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-plan-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');
const P = await load('src/lib/planCore.ts');
const F = await load('src/lib/format.ts');
// 25 Oct 2026, 10:12am in Sydney (AEDT, UTC+11).
const NOW = Date.parse('2026-10-24T23:12:00Z');

test('place results: what each one is, with its suburb', () => {
  assert.equal(P.placeSubtitle({ id: 'a', name: '1 Martin Pl', kind: 'address', area: 'Sydney' }), 'Address, Sydney');
  assert.equal(P.placeSubtitle({ id: 'b', name: 'Pitt St, Redfern', kind: 'street' }), 'Street');
  assert.equal(P.placeSubtitle({ id: 'c', name: 'Sydney Opera House', kind: 'place', area: 'Sydney' }), 'Place, Sydney');
  assert.equal(P.placeSubtitle({ id: 'd', name: 'Coogee', kind: 'suburb' }), 'Suburb');
  assert.equal(P.placeSubtitle({ id: '200060', name: 'Central Station', kind: 'stop' }), undefined);
  assert.equal(P.isStopItem({ id: '200060', name: 'Central Station' }), true, 'stops only answers have no kind');
  assert.equal(P.isStopItem({ id: 'x', name: 'Pitt St', kind: 'street' }), false);
  assert.deepEqual(P.stopsAsPlaces([{ id: '1', name: 'A', modes: [1] }]), [{ id: '1', name: 'A', modes: [1], kind: 'stop' }]);
});

test('place search falls back for the session only on a 404', () => {
  assert.equal(P.placesGone({ http: 404 }), true);
  assert.equal(P.placesGone({ http: 500 }), false);
  assert.equal(P.placesGone({ name: 'AbortError' }), false);
  assert.equal(P.placesGone(null), false);
});

test('no match words say what search covers', () => {
  assert.equal(P.noPlaceText('zzqqx', false, 0, false, true), 'No stops or places match that');
  assert.equal(P.noPlaceText('zzqqx', false, 0, false, false), 'No stops match that');
  assert.equal(P.noPlaceText('zzqqx', false, 0, true, true), "Can't search right now. Check your connection.");
  assert.equal(P.noPlaceText('zz', true, 0, false, true), null);
  assert.equal(P.noPlaceText('z', false, 0, false, true), null);
  assert.equal(P.noPlaceText('pitt', false, 3, false, true), null);
});

test('Plan search asks /api/places on the new host and falls back to stops', () => {
  const api = read('src/lib/api.ts');
  assert.ok(api.includes('${NEW_API_BASE}/api/places?'), 'places on the new host');
  assert.ok(/if \(placesGone\(e\)\) placesOff = true/.test(api), 'a 404 turns it off for the session');
  assert.ok(/const r = await api\.search\(q\);\s*return \{ items: stopsAsPlaces/.test(api), 'stops only fallback');
  const server = read('src/lib/server.ts');
  assert.ok(server.includes("export const NEW_API_BASE = 'https://api.transportsydney.app'"));
  const plan = read('src/app/(tabs)/search/index.tsx');
  assert.ok(plan.includes("useStopSearch(text, mode === 'trip')"), 'trips search places, Departures searches stops');
  assert.ok(plan.includes('if (isStopItem(it)) store.addRecent(p)'), 'only stops go into Recent stops');
});

test('Sydney clock and the picker start', () => {
  assert.deepEqual(P.sydneyClock(NOW), { h: 10, m: 12 });
  assert.deepEqual(P.defaultClock(NOW), { h: 10, m: 15 });
  assert.deepEqual(P.defaultClock(Date.parse('2026-10-24T23:15:00Z')), { h: 10, m: 20 }, 'on the mark moves to the next one');
  assert.deepEqual(P.defaultClock(Date.parse('2026-10-25T12:58:00Z')), { h: 0, m: 0 }, '11:58pm wraps to midnight');
});

test('12 hour picker columns', () => {
  assert.deepEqual(P.to12(0), { h12: 12, pm: false });
  assert.deepEqual(P.to12(12), { h12: 12, pm: true });
  assert.deepEqual(P.to12(17), { h12: 5, pm: true });
  assert.equal(P.from12(12, false), 0);
  assert.equal(P.from12(12, true), 12);
  assert.equal(P.from12(5, true), 17);
  assert.equal(P.clock12(9, 5), '9:05am');
  assert.equal(P.clock12(0, 0), '12:00am');
  assert.equal(P.wrapStep(12, [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], -1), 11);
  assert.equal(P.wrapStep(55, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55], 1), 0);
  assert.equal(P.snapMinute(7), 5);
  assert.equal(P.snapMinute(58), 55);
});

test('when labels, with tomorrow by the server rule', () => {
  assert.equal(P.whenLabel(P.NOW, NOW), 'Leave now');
  assert.equal(P.whenLabel({ kind: 'leave', h: 17, m: 30 }, NOW), 'Leave 5:30pm');
  assert.equal(P.whenLabel({ kind: 'arrive', h: 9, m: 0 }, NOW), 'Arrive by 9:00am tomorrow', 'over 30 min ago is tomorrow');
  assert.equal(P.whenLabel({ kind: 'leave', h: 9, m: 50 }, NOW), 'Leave 9:50am', 'just gone is still today');
  assert.equal(P.isTomorrow({ kind: 'leave', h: 9, m: 41 }, NOW), true);
  assert.equal(P.isTomorrow({ kind: 'leave', h: 9, m: 42 }, NOW), false);
});

test('when to the trip request and back', () => {
  assert.deepEqual(P.whenQuery(P.NOW), {});
  assert.deepEqual(P.whenQuery({ kind: 'leave', h: 7, m: 5 }), { time: '0705' });
  assert.deepEqual(P.whenQuery({ kind: 'arrive', h: 17, m: 30 }), { time: '1730', arriveBy: true });
  assert.deepEqual(P.whenParams({ kind: 'arrive', h: 17, m: 30 }), { time: '1730', arriveBy: '1' });
  assert.deepEqual(P.whenParams(P.NOW), {});
  assert.deepEqual(P.whenFromParams('1730', '1'), { kind: 'arrive', h: 17, m: 30 });
  assert.deepEqual(P.whenFromParams('0705'), { kind: 'leave', h: 7, m: 5 });
  assert.deepEqual(P.whenFromParams('2460'), P.NOW);
  assert.deepEqual(P.whenFromParams(undefined), P.NOW);
  const trip = read('src/app/trip.tsx');
  assert.ok(trip.includes('planTrip(plan, { refresh: r, count: 6, all: chain && allOn, ...queryAt(when, Date.now()), modes, walk: wp, ...(pageable ? { page: true, days: true } : {}) })'), 'the trip screen plans at the chosen time (worked out when sent, trippast.test.mjs), with the mode chips and the Walking choice, as a first page for a plain trip (whole days when the server planner is on)');
  assert.ok(trip.includes("(whenKey ? `|${whenKey}` : '')"), 'kept answers are per time');
  const trips = read('src/lib/trips.ts');
  assert.ok(trips.includes('arriveBy?: boolean'), 'planTrip passes arrive by');
  assert.ok(trips.includes('{ ...opts, arriveBy: false, refresh: true }'), 'a via trip never plans its first leg as arrive by');
});

test('the time picker is JS only, no new native module', () => {
  const src = read('src/components/WhenPicker.tsx');
  assert.ok(!/datetimepicker|requireNativeModule|NativeModules|@expo\/ui/.test(src));
  assert.ok(src.includes('accessibilityRole="adjustable"'), 'wheels work with VoiceOver and TalkBack');
  const pkg = JSON.parse(read('package.json'));
  assert.ok(!pkg.dependencies['@react-native-community/datetimepicker']);
});

test('Clear all for Your trips: phone trips, saved trips and commutes, never Home and Work', () => {
  const trips = [
    { key: 'a>b', kind: 'mine', name: 'gym' },
    { key: 'c>d', kind: 'saved', name: 'uni' },
    { key: 'e>f', kind: 'commute', id: 'cm1', name: 'Morning' },
    { key: 'g>h', kind: 'place', name: 'To work' },
    { key: 'i>j', kind: 'mine' },
    { key: 'c>d2', kind: 'saved', name: 'uni' },
  ];
  assert.deepEqual(P.clearAllPlan(trips), { mine: ['a>b', 'i>j'], saved: ['gym', 'uni'], commutes: ['cm1'] });
  assert.deepEqual(P.clearAllPlan([]), { mine: [], saved: [], commutes: [] });
});

test('Clear all confirm words per platform', () => {
  assert.deepEqual(P.clearAllWords('trips', 3, true), { title: 'Clear All Trips?', message: 'This removes 3 trips from Your trips. Your commute stays.', confirm: 'Clear All' });
  assert.deepEqual(P.clearAllWords('trips', 1, false), { title: 'Clear all trips?', message: 'This removes 1 trip from Your trips. Your commute stays.', confirm: 'Clear all' });
  assert.deepEqual(P.clearAllWords('stops', 2, false), { title: 'Clear all starred stops?', message: 'This unstars 2 stops.', confirm: 'Clear all' });
  const home = read('src/app/(tabs)/home/index.tsx');
  assert.ok(home.includes("style: 'destructive', onPress: run"), 'a destructive confirm button');
  assert.ok(home.includes("{ text: 'Cancel', style: 'cancel' }"));
  assert.ok(home.includes('store.clearStarred()'));
  const store = read('src/lib/store.ts');
  assert.ok(store.includes('clearStarred() { state = { ...state, starred: [] }; save(); }'));
  assert.ok(store.includes('removeMyTrips(keys: string[])'));
});

test('Home header stamp uses the rows 12 hour clock', () => {
  assert.equal(F.liveStamp(Date.parse('2026-10-24T22:52:00Z')), 'Live 9:52am');
  assert.equal(F.liveStamp(Date.parse('2026-10-25T02:05:00Z')), 'Live 1:05pm');
  const home = read('src/components/Home.tsx');
  assert.ok(home.includes('{liveStamp(t)}') && !home.includes('Live {hm24(t)}'));
});

test('no em or en dashes in the new files', () => {
  for (const f of ['src/lib/planCore.ts', 'src/components/WhenPicker.tsx', 'test/plan.test.mjs', 'src/app/(tabs)/search/index.tsx']) assert.ok(!/[\u2013\u2014]/.test(read(f)), f);
});
