// Speed pass 4 (27 Oct 2026): the three screens still over 1 s. A stop board at another time paints from the stop's
// timetable pack when the pack holds that moment, and asks again when the server answered with timetable rows while the
// planner was slow; the car park list asks again while the server reads its live counts and says so; a bus's service
// screen paints the stops after yours from the route list kept on the phone. Pure parts run here; screen wiring is
// checked in the source.
// Run: TZ=Australia/Sydney OFFLINE=1 node --test test/speed27d.test.mjs
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-speed27d-'));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

fs.writeFileSync(path.join(out, 'async-storage.mjs'), `const m = new Map();
export default { getItem: async (k) => (m.has(k) ? m.get(k) : null), setItem: async (k, v) => { m.set(k, v); }, multiGet: async (ks) => ks.map((k) => [k, m.has(k) ? m.get(k) : null]), multiRemove: async (ks) => { for (const k of ks) m.delete(k); }, removeItem: async (k) => { m.delete(k); } };`);
const done = new Set();
function emit(rel) {
  if (done.has(rel)) return;
  done.add(rel);
  let js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  js = js.replace(/from '@react-native-async-storage\/async-storage'/g, "from './async-storage.mjs'");
  js = js.replace(/from '\.\/([A-Za-z0-9_]+)'/g, (m, name) => { emit(`src/lib/${name}.ts`); return `from './${name}.mjs'`; });
  fs.writeFileSync(path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs')), js);
}
async function load(rel) { emit(rel); return import(pathToFileURL(path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'))).href); }


const P = await load('src/lib/timetablePackCore.ts');
const BT = await load('src/lib/coldOpenCore.ts');
const CP = await load('src/lib/carparkCore.ts');
const O = await load('src/lib/offlineCore.ts');
const SC = await load('src/lib/speedCore.ts');

const NOW = Date.parse('2026-10-27T06:00:00Z');
const BASE = Math.floor(NOW / 1000) - 3600;
// A made up stop: a service every 10 minutes from an hour ago for 30 hours.
function pack(hours = 30) {
  const rows = [];
  let last = BASE;
  for (let t = BASE; t < BASE + hours * 3600; t += 600) { rows.push(t - last, 0, 0, 0); last = t; }
  return { v: 1, stop: { id: 'S1', name: 'Testville' }, base: BASE, until: BASE + hours * 3600, generatedAt: NOW - 3600000, rows,
    lines: [['T9', 'train', '#D11F2F', 'Sydney Trains', 'Test line']], heads: ['Testend'], plats: [['S1P1', 'Platform 1', 'Testville Platform 1']] };
}

test('a board at another time paints from the pack: from that moment, departed rows marked, only when the pack holds it', () => {
  const p = pack();
  const at = NOW - 30 * 60000;
  assert.equal(P.packCovers(p, at), true);
  const b = P.packBoardAt(p, at, NOW, null);
  assert.equal(b.items.length, P.PACK_BOARD_ROWS);
  assert.ok(Date.parse(b.items[0].planned) >= at - 45000, 'starts at the asked moment');
  assert.equal(b.items[0].departed, true, 'a service that left before now is marked departed, as the server marks it');
  assert.equal(b.items.find((d) => Date.parse(d.planned) > NOW).departed, false);
  assert.ok(b.items.every((d) => d.realtime === false && d.status.key === 'scheduled'), 'timetable times, never live');
  assert.equal(b.now, NOW);
  assert.ok(P.isPackBoard(b));
  // Outside the pack, or too close to its end for a full board: no pack board.
  assert.equal(P.packCovers(p, BASE * 1000 - 3600000), false);
  assert.equal(P.packCovers(p, p.until * 1000 - 3600000), false);
  assert.equal(P.packCovers(p, NaN), false);
});

test('a board at another time on the server\'s timetable rows asks again at 6 s, then 10 s; anything else keeps its gap', () => {
  const slow = { kind: 'departures', source: 'timetable', fallback: 'planner-slow', at: { date: '20261027', time: '1930' }, items: [] };
  assert.equal(BT.boardAtAgainMs(slow, 0), 6000);
  assert.equal(BT.boardAtAgainMs(slow, 1), 10000);
  assert.equal(BT.boardAtAgainMs(slow, 2), null);
  assert.equal(BT.boardAtAgainMs({ kind: 'departures', items: [] }, 0), null);
  assert.equal(BT.boardAtAgainMs(null, 0), null);
});

test('car park list while its live counts are read: asks again at 8, 15, 30 s and says when the shown counts are from', () => {
  const at = Date.parse('2026-10-27T05:00:00Z');
  const loading = { fallback: 'counts-loading', dataAt: at, carparks: [{ id: '1', name: 'A', spots: 100, free: 40, stale: true }] };
  assert.equal(CP.isParkLoading(loading), true);
  assert.deepEqual([0, 1, 2, 3].map((n) => CP.parkAgainMs(loading, n)), [8000, 15000, 30000, null]);
  assert.equal(CP.parkAgainMs({ carparks: [] }, 0), null);
  assert.equal(CP.parkLoadingNote(loading), `Counts from ${CP.parkClock(at)}. Getting live counts.`);
  assert.equal(CP.parkLoadingNote({ fallback: 'counts-loading', carparks: [] }), 'Getting live counts.');
  assert.ok(!/\u2013|\u2014/.test(CP.parkLoadingNote(loading)));
});

test('stand ins are never kept on the phone; real answers still are', () => {
  assert.equal(O.worthKeeping({ fallback: 'counts-loading', carparks: [{ id: '1' }] }), false);
  assert.equal(O.worthKeeping({ carparks: [{ id: '1' }] }), true);
  assert.equal(O.worthKeeping({ kind: 'departures', source: 'timetable', fallback: 'planner-slow', at: { time: '1930' }, items: [{}] }), false);
  // The trip stand in keeps its old rule (unchanged by this pass).
  assert.equal(O.worthKeeping({ source: 'timetable', fallback: 'planner-slow', journeys: [{}] }), true);
});

// A made up route, two directions.
const route = [
  { to: 'Testend', stops: [['2000001', 'First St', -33.1, 151.1], ['2000002', 'Second St', -33.2, 151.2], ['2000003', 'Third St', -33.3, 151.3], ['2000004', 'Testend Interchange, Stand A', -33.4, 151.4], ['2000005', 'Depot Rd', -33.5, 151.5]] },
  { to: 'First St', stops: [['2000014', 'Testend Interchange, Stand B', -33.4, 151.4], ['2000013', 'Third St', -33.3, 151.3], ['2000011', 'First St', -33.1, 151.1]] },
];
const row = { trip: 'tr1', line: 'T99', mode: 'bus', stop: '2000002', sname: 'Second St', planned: new Date(NOW + 300000).toISOString(), dest: 'Testend', seen: String(NOW - 5000) };

test('a bus service paints the stops after yours from the kept route: to the destination, places, no times', () => {
  const s = SC.serviceSeed(row, NOW, route);
  assert.equal(s.data.seeded, true);
  assert.deepEqual(s.data.stops.map((x) => x.id), ['2000002', '2000003', '2000004'], 'cut at the stop named like the destination');
  assert.equal(s.data.stops[0].mine, true);
  assert.equal(s.data.stops[0].lat, -33.2);
  assert.equal(s.data.stops[1].planned, undefined, 'no made up times');
  assert.equal(s.data.mineIndex, 0);
  assert.equal(O.worthKeeping(s.data), false);
  // With the stop you get off at: tagged in the list, its time kept.
  const t = SC.serviceSeed({ ...row, to: '2000003', tname: 'Third St', tplan: new Date(NOW + 900000).toISOString() }, NOW, route);
  assert.equal(t.data.stops[t.data.alightIndex].id, '2000003');
  assert.equal(t.data.stops[t.data.alightIndex].alight, true);
  assert.ok(t.data.stops[t.data.alightIndex].planned);
  // No destination match: to the end of the route.
  assert.deepEqual(SC.serviceSeed({ ...row, dest: 'Elsewhere' }, NOW, route).data.stops.map((x) => x.id), ['2000002', '2000003', '2000004', '2000005']);
});

test('no kept route, a train, a stop not on the route or its last stop: the tapped row alone, as before', () => {
  assert.deepEqual(SC.serviceSeed(row, NOW).data.stops.map((x) => x.id), ['2000002']);
  assert.deepEqual(SC.serviceSeed({ ...row, mode: 'train' }, NOW, route).data.stops.map((x) => x.id), ['2000002']);
  assert.deepEqual(SC.serviceSeed({ ...row, stop: '9999999' }, NOW, route).data.stops.map((x) => x.id), ['9999999']);
  assert.deepEqual(SC.serviceSeed({ ...row, stop: '2000005', sname: 'Depot Rd' }, NOW, route).data.stops.map((x) => x.id), ['2000005']);
  assert.equal(SC.routeStopsAfter('not a route', row), null);
});

test('screens are wired: stop board pack at a moment and its ask again, car park ask again and note, bus route seed and press in', () => {
  const stop = read('src/app/stop/[id].tsx');
  assert.match(stop, /\{ stop: String\(id\), mode: null, at \}/);
  assert.match(stop, /again: at != null \? boardAtAgainMs : null/);
  assert.match(stop, /packAt=\{packAt \?\? \(isSlowStandIn\(data\) \? updatedAt : null\)\}/);
  const hooks = read('src/lib/hooks.ts');
  assert.match(hooks, /peekPackBoard\(opts\.pack\.stop, opts\.pack\.mode, opts\.pack\.at\)/);
  assert.match(hooks, /againRef\.current\(d, againAsked\.current\)/);
  assert.doesNotMatch(hooks, /setInterval/);
  const park = read('src/app/parking.tsx');
  assert.match(park, /again: parkAgainMs/);
  assert.match(park, /parkLoadingNote\(data\)/);
  const svc = read('src/app/service.tsx');
  assert.match(svc, /serviceSeed\(p, Date\.now\(\), keptRoute\(p\.line, p\.mode\)\)/);
  const pf = read('src/lib/prefetch.ts');
  assert.match(pf, /prefetchRoute\(String\(d\.line\)\)/);
  assert.match(pf, /ROUTE_GAP_MS = 10 \* 60 \* 1000/);
});
