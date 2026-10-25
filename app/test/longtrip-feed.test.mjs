// Long distance trips (longer wait, kept answer) and the realtime feed on watched and live trip legs.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-longtrip-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const L = await load('src/lib/longTripCore.ts');
const F = await load('src/lib/feedCore.ts');
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

test('stop ids carry the postcode', () => {
  assert.equal(L.postcodeOf('200060'), 2000);
  assert.equal(L.postcodeOf('26401'), 2640);
  assert.equal(L.postcodeOf('2000338'), 2000);
  assert.equal(L.postcodeOf('coord:151.2:-33.8'), null);
  assert.equal(L.postcodeOf(''), null);
});

test('long distance: regional NSW is long, Sydney, Newcastle and Wollongong are not', () => {
  assert.equal(L.isLongTrip('200060', '26401'), true, 'Central to Albury');
  assert.equal(L.isLongTrip('28301', '200060'), true, 'Dubbo to Central');
  assert.equal(L.isLongTrip('200060', '213510'), false, 'Central to Strathfield');
  assert.equal(L.isLongTrip('200060', '230010'), false, 'Central to Newcastle area');
  assert.equal(L.isLongTrip('200060', '250010'), false, 'Central to Wollongong');
  assert.equal(L.isLongTrip('278010', '200060'), false, 'Blue Mountains');
  assert.equal(L.isLongTrip('coord:1', '200060'), false, 'unknown ends are not long');
});

test('planner too slow: 502, 504 and timeouts, not 404 or a plain error', () => {
  assert.equal(L.plannerTooSlow({ http: 502, message: "Live data didn't answer just now. Try again in a moment." }), true);
  assert.equal(L.plannerTooSlow({ http: 504 }), true);
  assert.equal(L.plannerTooSlow({ message: 'No answer from the server. Check your connection.', offline: true }), true);
  assert.equal(L.plannerTooSlow({ http: 404, message: 'Not found' }), false);
  assert.equal(L.plannerTooSlow({ http: 400, message: 'count must be 1 to 8' }), false);
  assert.equal(L.plannerTooSlow(null), false);
  assert.equal(L.longGone({ http: 404 }), true);
  assert.equal(L.longGone({ http: 502 }), false);
});

test('kept answers expire after the keep time and the oldest go first', () => {
  const k = L.createKeep(1000, 2);
  k.set('a', 1, 0);
  assert.equal(k.get('a', 999), 1);
  assert.equal(k.get('a', 1000), undefined);
  k.set('a', 1, 0); k.set('b', 2, 0); k.set('c', 3, 0);
  assert.equal(k.get('a', 1), undefined);
  assert.equal(k.get('c', 1), 3);
  assert.ok(L.LONG_TRIP_TIMEOUT_MS >= 35000);
  assert.ok(L.STILL_SEARCHING_MS <= 8000);
});

const NOW = Date.parse('2026-10-25T00:00:00Z');
const at = (m) => new Date(NOW + m * 60000).toISOString();

test('legs without a feed get it from the board; checked legs stay as they are', () => {
  const legs = [
    { mode: 'train', line: 'ST22', tripId: 'x1', stopId: '200060', planned: at(10) },
    { mode: 'metro', line: 'M1', stopId: '2000400', planned: at(40) },
    { mode: 'bus', line: '902', stopId: '26401', planned: at(500) },
    { mode: 'train', line: 'T1', stopId: '213510', planned: at(5), feed: '' },
  ];
  assert.deepEqual(F.stopsToLook(legs, NOW), ['200060']);
  const r = F.fillFeeds(legs, { '200060': [{ line: 'ST22', tripId: 'x1', planned: at(10), feed: 'nswtrains' }] });
  assert.equal(r.changed, true);
  assert.equal(r.legs[0].feed, 'nswtrains');
  assert.equal(r.legs[1].feed, '');
  assert.equal(r.legs[2].feed, undefined, 'no board read yet');
  assert.equal(r.legs[3], legs[3]);
  assert.equal(F.fillFeeds(r.legs.slice(0, 2), {}).changed, false);
});

test('board match by trip id or by line and time within 90 s', () => {
  const l = { mode: 'bus', line: '902', stopId: 's', planned: at(10) };
  assert.equal(F.boardMatch(l, [{ line: '902', planned: at(12) }]), null);
  assert.ok(F.boardMatch(l, [{ line: '902', planned: new Date(NOW + 10 * 60000 + 60000).toISOString() }]));
  assert.ok(F.boardMatch({ ...l, tripId: 't' }, [{ line: 'other', tripId: 't', planned: at(99) }]));
  const r = F.fillFeeds([l], { s: [] });
  assert.equal(r.legs[0].feed, '', 'not on the board: the usual feed');
  assert.equal(F.fillFeeds([l], { s: null }).changed, false, 'board did not answer: look again later');
});

test('feed travels with watches, the live trip and the lock screen card', () => {
  assert.match(read('src/lib/watch.ts'), /feed: legFeed\(d\.feed\)/);
  assert.match(read('src/lib/watch.ts'), /feed: legFeed\(x\.feed\)/);
  assert.match(read('src/lib/liveEngine.ts'), /feed: l\.feed \|\| undefined/);
  assert.match(read('platform/livePushCore.ts'), /'destId', 'feed'\]/);
  assert.match(read('src/lib/types.ts'), /feed\?: string \| null \};\nexport type Watch/);
});

test('long trips: the trip screen says it is still searching and refreshes every 2 minutes', () => {
  const t = read('src/app/trip.tsx');
  assert.match(t, /Still searching/);
  assert.match(t, /isLongPair\(from\.id, to\.id\) \? LONG_TRIP_KEEP_MS : \(d: TripResp \| null\) => tripGapMs\(firstLeaveInMs\(d\?\.journeys, Date\.now\(\)\)\)/);
  const a = read('src/lib/api.ts');
  assert.match(a, /tripLong\(base, opts\.refresh\)/);
  assert.match(a, /long: 1/);
});

test('travel time in hours for long trips, alert titles without HTML', async () => {
  const src = fs.readFileSync(path.join(here, '..', 'src/lib/format.ts'), 'utf8');
  const fn = (name) => { const m = new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`).exec(src); return m[0]; };
  const code = [fn('plainText'), fn('durText')].join('\n');
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, 'fmtbits.mjs'); fs.writeFileSync(f, js);
  const M = await import(pathToFileURL(f).href);
  assert.equal(M.durText(25), '25 min');
  assert.equal(M.durText(60), '1 h');
  assert.equal(M.durText(446), '7 h 26 min');
  assert.equal(M.plainText('<a href="https://transportnsw.info/regional-bookings/" target="_blank">Book your seat with NSW TrainLink</a>'), 'Book your seat with NSW TrainLink');
  assert.equal(M.plainText('Lifts &amp; ramps'), 'Lifts & ramps');
});

test('quieter carriage hint only from live carriage data', async () => {
  const O = await load('src/lib/occupancy.ts');
  assert.equal(O.quietText({ quiet: { where: 'back', text: 'Quieter at the back' } }), 'Quieter at the back');
  assert.equal(O.quietText({ quiet: { where: 'back' } }, false), null, 'crowding switched off');
  assert.equal(O.quietText({ quiet: { where: 'roof' } }), null);
  assert.equal(O.quietText({ quiet: { where: 'ends' } }), 'Quieter at either end');
  assert.equal(O.quietText({}), null);
  assert.equal(O.quietText(null), null);
  assert.match(read('src/components/Transit.tsx'), /<QuietChip v=\{d\.vehicle\} \/>/);
});

test('NSW TrainLink regional trips show a booked fare, not Opal', async () => {
  const src = fs.readFileSync(path.join(here, '..', 'src/lib/fare.ts'), 'utf8').replace(/^import .*$/gm, '');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, 'fare.mjs'); fs.writeFileSync(f, js);
  const F2 = await import(pathToFileURL(f).href);
  const xpt = { kind: 'transit', mode: 'train', line: '621', feed: 'nswtrains' };
  const t1 = { kind: 'transit', mode: 'train', line: 'T1' };
  assert.equal(F2.fareKind({ legs: [xpt], fare: { total: 0, unknown: true, legs: [{ amount: null }] } }), 'booked');
  assert.equal(F2.fareKind({ legs: [t1, xpt], fare: { total: 4.2, legs: [{ amount: 4.2 }, { amount: null }] } }), 'mixed');
  assert.equal(F2.fareKind({ legs: [t1], fare: { total: 4.2, legs: [{ amount: 4.2 }] } }), 'opal');
  assert.equal(F2.fareKind({ legs: [t1] }), null);
  assert.equal(F2.TRAINLINK_BOOKING_URL, 'https://transportnsw.info/regional-bookings/');
});
