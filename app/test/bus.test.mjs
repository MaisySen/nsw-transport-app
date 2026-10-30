// Buses: stop numbers, route search, where the buses on a route are, and the words for where to board.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-bus-'));
async function load(rel, name) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, (name || path.basename(rel).replace(/\.ts$/, '')) + '.mjs');
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const bus = await load('src/lib/busCore.ts');
const gen = await load('src/lib/busGroups.gen.ts');

test('stop numbers: bus and coach stop ids are the number on the sign; stations and trains are not', () => {
  assert.equal(bus.stopNumber('2046100', 'bus'), '2046100');
  assert.equal(bus.stopNumber('206712', 'bus'), '206712');
  assert.equal(bus.stopNumber('2046100'), '2046100');
  assert.equal(bus.stopNumber('206710', 'train'), null);
  assert.equal(bus.stopNumber('G2046100', 'bus'), null);
  assert.equal(bus.stopNumber('placeID:95356003:1', 'bus'), null);
  assert.equal(bus.stopNumber('', 'bus'), null);
  assert.equal(bus.stopLabel('2220328', 'bus'), 'Stop 2220328');
  assert.equal(bus.stopLabel('202210', 'train'), '');
});

test('search: 6 or 7 digits is a stop number; 410, M90, B1, D400, 438X are routes', () => {
  assert.ok(bus.isStopNumber('2046100'));
  assert.ok(bus.isStopNumber(' 213723 '));
  assert.ok(!bus.isStopNumber('410'));
  for (const q of ['410', 'm90', 'B1', 'D400', '438X', '610X', 'T80', 'route 501', '1']) assert.ok(bus.routeQuery(q), q);
  for (const q of ['2046100', 'Lane Cove', 'Chatswood', '', 'ABCDEF', 'X']) assert.equal(bus.routeQuery(q), null, q);
  assert.equal(bus.routeQuery('route 501'), '501');
  assert.equal(bus.routeQuery('m90'), 'M90');
});

// The 410 towards Marsfield as /api/stations answered on 25 Oct 2026 (first stops), and boards of probe stops.
const raw = [{ to: 'Waterloo Park Marsfield', stops: [['2220328', 'Hurstville Station, Stand A', -33.96636, 151.10222], ['222023', 'Westfield Hurstville, Forest Rd', -33.96738, 151.10379], ['222034', 'Park Rd At Cross St', -33.96528, 151.10461], ['222035', 'Hurstville Presbyterian Church, Park Rd', -33.96418, 151.1036], ['222091', 'Queens Rd At Wright St', -33.9617, 151.10565], ['2220300', 'Queens Rd After Romani Av', -33.95968, 151.10898]] },
  { to: 'Hurstville Station', stops: [['2220301', 'Queens Rd Before Romani Av'], ['222090', 'Queens Rd At Wright St']] }, { to: 'Nowhere', stops: [['1', 'Only one']] }];

test('route directions: stops in order with ids and positions; a direction with one stop is dropped', () => {
  const d = bus.routeDirs(raw);
  assert.equal(d.length, 2);
  assert.equal(d[0].stops[0].id, '2220328');
  assert.equal(d[0].stops[0].lat, -33.96636);
  assert.equal(d[1].stops[1].lat, undefined);
  assert.deepEqual(bus.routeDirs(null), []);
  assert.equal(bus.pickDir(d, '222090'), 1);
  assert.equal(bus.pickDir(d, null, 'Hurstville Station'), 1);
  assert.equal(bus.pickDir(d, null, 'Marsfield'), 0);
  assert.equal(bus.pickDir(d, 'nope'), 0);
});

test('probe stops: a third, two thirds and the stop before the end', () => {
  assert.deepEqual(bus.probeStops(81), [27, 54, 79]);
  assert.deepEqual(bus.probeStops(10), [3, 6, 8]);
  assert.deepEqual(bus.probeStops(3), [1]);
  assert.deepEqual(bus.probeStops(2), [0]);
  assert.deepEqual(bus.probeStops(1), []);
});

test('buses on the route: probe stop minus stops away, nearest probe wins, each bus once, other lines ignored', () => {
  const v = (lat) => ({ lat, lon: 151.1 });
  const b = bus.busesOn('410', [
    { idx: 27, items: [{ line: '410', tripId: 'A', planned: 'x', stopsAway: 6, vehicle: v(1), realtime: true, delayMin: 2 }, { line: '410', tripId: 'C', planned: 'x', stopsAway: null, vehicle: null }] },
    { idx: 54, items: [{ line: '410', tripId: 'B', planned: 'x', stopsAway: 13, vehicle: v(2) }, { line: '410', tripId: 'A', planned: 'x', stopsAway: 33, vehicle: v(1) }, { line: '415', tripId: 'Z', planned: 'x', stopsAway: 2, vehicle: v(3) }] },
    { idx: 79, items: [{ line: '410', tripId: 'B', planned: 'x', stopsAway: 38, vehicle: v(2) }, { line: '410', tripId: 'D', planned: 'x', stopsAway: 1, vehicle: v(4), cancelled: true }] },
    { idx: 5, items: null },
  ]);
  assert.deepEqual(b.map((x) => [x.tripId, x.pos]), [['B', 41], ['A', 21]]);
  assert.equal(b[1].delayMin, 2);
  assert.deepEqual(bus.nextBusAt(30, b), { bus: b[1], away: 9 });
  assert.deepEqual(bus.nextBusAt(41, b), { bus: b[0], away: 0 });
  assert.equal(bus.nextBusAt(10, b), null);
  assert.equal(bus.awayWords(0), 'At the stop');
  assert.equal(bus.awayWords(1), '1 stop away');
  assert.equal(bus.awayWords(9), '9 stops away');
});

test('times of one line at a stop: soonest first, live time used, gone and cancelled left out', () => {
  const now = Date.parse('2026-10-25T04:00:00Z');
  const items = [
    { line: '410', planned: '2026-10-25T04:20:00Z', realtime: false },
    { line: '410', planned: '2026-10-25T04:05:00Z', estimated: '2026-10-25T04:09:00Z', realtime: true },
    { line: '410', planned: '2026-10-25T03:50:00Z', realtime: false },
    { line: '410', planned: '2026-10-25T04:07:00Z', cancelled: true },
    { line: '415', planned: '2026-10-25T04:01:00Z' },
  ];
  assert.deepEqual(bus.lineTimes(items, '410', now).map((d) => d.planned), ['2026-10-25T04:05:00Z', '2026-10-25T04:20:00Z']);
});

test('routes at a stop: bus lines only, once each, in number order', () => {
  const l = bus.linesHere([{ line: 'M90', mode: 'bus' }, { line: '438X', mode: 'bus' }, { line: 'T1', mode: 'train' }, { line: '410', mode: 'bus' }, { line: '438X', mode: 'bus' }, { line: '41', mode: 'bus' }, { line: '530', mode: 'bus' }]);
  assert.deepEqual(l.map((x) => x.line), ['41', '410', '438X', '530', 'M90']);
});

test('where to board: name, stand when the name lacks it, and the stop number', () => {
  assert.equal(bus.boardWords('Concord Oval, Parramatta Rd', 'Stand X1', '213723', 'bus'), 'Concord Oval, Parramatta Rd, Stand X1, Stop 213723');
  assert.equal(bus.boardWords('Hurstville Station, Stand A', 'Stand A', '2220328', 'bus'), 'Hurstville Station, Stand A, Stop 2220328');
  assert.equal(bus.boardWords('Chatswood Station', 'Platform 1', '206710', 'train'), 'Chatswood Station, Platform 1');
});

test('a stop number search finds the stop from its own board, and nothing for a number with no stop', async () => {
  const src = fs.readFileSync(path.join(here, '..', 'src/lib/busSearch.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export function stopFromBoard'), src.indexOf('export function useBusLookup'));
  const stopFromBoard = new Function(ts.transpileModule(fn.replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '; return stopFromBoard;')();
  assert.deepEqual(stopFromBoard('2220328', { stop: { id: '2220328', name: 'Hurstville Station', fullName: 'Hurstville Station, Hurstville', exactName: 'Hurstville Station, Stand A' }, items: [{ mode: 'bus' }] }),
    { id: '2220328', name: 'Hurstville Station, Hurstville', stand: 'Stand A', modes: ['bus'] });
  assert.deepEqual(stopFromBoard('2137185', { stop: { id: '2137185', name: 'Cabarita Wharf', fullName: 'Cabarita Wharf, Cabarita', exactName: 'Side A' }, items: [{ mode: 'ferry' }] }),
    { id: '2137185', name: 'Cabarita Wharf, Cabarita', stand: 'Side A', modes: ['ferry'] });
  assert.equal(stopFromBoard('999999', { stop: { id: '999999', name: '999999', fullName: '', exactName: null }, items: [] }), null);
});

test('route screen polls only while on view, through useScreenPoll, never setInterval', () => {
  const src = fs.readFileSync(path.join(here, '..', 'src/app/route.tsx'), 'utf8');
  assert.match(src, /useScreenPoll\(load, 30000/);
  assert.doesNotMatch(src, /setInterval/);
});

// The bus picker (New trip): Bidur's 3:10 PM screenshot opened on 1AT9, 1B, 1HU, 1L1, 1T9, 2AT9 with cut off text.
const routes = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'backend', 'src', 'public', 'stations', 'bus-routes.json'), 'utf8'));
const R = gen.REGIONAL_ROUTES;

test('picker groups: Sydney routes lead; trackwork, school and regional routes have their own sections', () => {
  const g = (r) => bus.busGroup(r, routes[r] || '', R);
  for (const r of ['1AT9', '1T9', '2AT9', '1L1', '1HU', '10HU', '11T8', '20T4', '14L4']) assert.equal(g(r), 'replacement', r);
  for (const r of ['S101', 'S531']) assert.equal(g(r), 'school', r);
  for (const r of ['11', '41', '2', '130', '160', '308', '351']) assert.equal(g(r), 'regional', `${r} ${routes[r]}`);
  for (const r of ['410', '415', '438X', '492', '530', 'M90', 'B1', 'N10', 'T80', '100', '323', '360', 'S1', 'SW1'].filter((r) => routes[r])) assert.equal(g(r), 'sydney', `${r} ${routes[r]}`);
  const syd = Object.keys(routes).filter((r) => g(r) === 'sydney').sort(bus.routeCmp);
  assert.ok(syd.length > 400 && syd.length < 700, String(syd.length));
  assert.deepEqual(syd.slice(0, 3), ['1B', '5A', '5B'], 'Sydney routes start 1B (Sydney Olympic Park to Warriewood), 5A, 5B');
  assert.ok(!syd.some((r) => /T\d$|HU$/.test(r)), 'no trackwork buses among Sydney routes');
});

test('the generated groups match the route data the server has now', () => {
  const src = fs.readFileSync(path.join(here, '..', 'src', 'lib', 'busGroups.gen.ts'), 'utf8');
  const before = src;
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, [path.join(here, '..', 'tools', 'gen-bus-groups.mjs')]);
  assert.equal(fs.readFileSync(path.join(here, '..', 'src', 'lib', 'busGroups.gen.ts'), 'utf8'), before, 'run node tools/gen-bus-groups.mjs');
});

test('natural route order: numbers first by value, then lettered routes', () => {
  assert.deepEqual(['M90', 'D400', '410', '400', 'B1', '438X', '438', 'M30', 'N10', '41'].sort(bus.routeCmp), ['41', '400', '410', '438', '438X', 'B1', 'D400', 'M30', 'M90', 'N10']);
});

test('a route reads on two lines: from, then to with the via; a shared number shows where the Sydney service goes', () => {
  assert.deepEqual(bus.routeEnds('Hurstville to Macquarie Park'), { from: 'Hurstville', to: 'Macquarie Park' });
  assert.deepEqual(bus.routeEnds('Lakemba to Abbotsford via Lane Cove'), { from: 'Lakemba', to: 'Abbotsford via Lane Cove' });
  assert.deepEqual(bus.routeEnds('Unknown'), { from: '', to: '' });
  assert.deepEqual(bus.routeEnds('Nowra to Ulladulla', ['Taronga Zoo Via City QVB']), { from: '', to: 'Taronga Zoo via City QVB' });
  assert.ok(gen.SYDNEY_TO['100'], 'route 100 runs in Sydney and around Nowra');
});

test('route search: the number typed comes first, Sydney before regional, then place names', () => {
  const m = bus.matchRoutes(routes, '41', R);
  assert.equal(m[0], '410');
  assert.ok(m.indexOf('41') > m.indexOf('418'), 'regional 41 after the Sydney 41x routes');
  assert.equal(bus.matchRoutes(routes, 'm90', R)[0], 'M90');
  assert.equal(bus.matchRoutes(routes, 'route 410', R)[0], '410');
  assert.ok(bus.matchRoutes(routes, 'Chiswick', R).includes('415'));
  assert.deepEqual(bus.matchRoutes(routes, '', R), []);
});

test('a shared route number keeps the directions on your side: Sydney unless you are at a stop elsewhere', () => {
  const dirs = [{ to: 'North Bondi', stops: [['202276', 'a'], ['202277', 'b']] }, { to: 'Port Macquarie', stops: [['244739', 'c'], ['244740', 'd']] }];
  assert.deepEqual(bus.regionDirs(dirs).map((d) => d.to), ['North Bondi']);
  assert.deepEqual(bus.regionDirs(dirs, '244739').map((d) => d.to), ['Port Macquarie']);
  const one = [{ to: 'Belmont', stops: [{ id: '2290491' }] }];
  assert.equal(bus.regionDirs(one).length, 1, 'never empties a route');
  assert.ok(bus.sydneyStop('2046100') && bus.sydneyStop('2220328') && bus.sydneyStop('256712') && !bus.sydneyStop('2290491'));
});

test('the picker never asks for location on its own and lists no route without its from and to', () => {
  const src = fs.readFileSync(path.join(here, '..', 'src', 'app', 'new-trip.tsx'), 'utf8');
  const p = src.slice(src.indexOf('const GROUP_TITLE'));
  assert.match(p, /getForegroundPermissionsAsync\(\)\.then\(\(p\) => \{ if \(p\.granted\) loadNear\(false\)/);
  assert.doesNotMatch(p, /numberOfLines=\{1\}/, 'two lines, nothing cut off');
  assert.match(p, /Trackwork buses/);
});
