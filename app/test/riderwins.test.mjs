// Four rider wins (g31): where the bus is, Walking choice, Get me home, exact stand pin. Pure cores in node, plus
// source checks that the screens use them. NSW wide cases: Parramatta, Newcastle, Wollongong, Manly, Penrith.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-rider-'));
async function load(name) {
  const src = fs.readFileSync(path.join(root, 'src/lib', name + '.ts'), 'utf8');
  const f = path.join(out, name + '.mjs');
  fs.writeFileSync(f, ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  return import(pathToFileURL(f).href);
}
const W = await load('whereNowCore');
const P = await load('walkPrefCore');
const G = await load('goHomeCore');
const S = await load('standPinCore');
const src = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');

// ---------- 1. Where the bus is ----------
const veh = { lat: -33.8150, lon: 151.0011, ageS: 20 };
test('where the bus is: stops away and late, only with a live position', () => {
  const w = W.whereNow({ kind: 'transit', mode: 'bus', realtime: true, delayMin: 4, stopsAway: 3, vehicle: veh });
  assert.equal(w.text, '3 stops away \u00b7 4 min late');
  assert.match(w.a11y, /^Bus 3 stops away, 4 min late/);
  assert.equal(W.whereNow({ kind: 'transit', mode: 'bus', realtime: true, delayMin: 0, stopsAway: 1, vehicle: veh }).text, '1 stop away \u00b7 on time');
  assert.equal(W.whereNow({ kind: 'transit', mode: 'lightrail', realtime: true, delayMin: -3, stopsAway: 0, vehicle: veh }).text, 'At your stop \u00b7 3 min early');
  assert.match(W.whereNow({ kind: 'transit', mode: 'ferry', realtime: true, delayMin: 2, stopsAway: 2, vehicle: veh }).a11y, /^Ferry 2 stops away, 2 min late/);
});
test('where the bus is: the delay at your stop comes from ahead when the server sent it', () => {
  const w = W.whereNow({ kind: 'transit', mode: 'bus', realtime: true, delayMin: 1, stopsAway: 5, vehicle: veh, ahead: [1, 1.4, 3.2, null, 5.6] });
  assert.equal(w.text, '5 stops away \u00b7 6 min late');
  assert.equal(w.late, 6);
});
test('where the bus is: never guessed', () => {
  const base = { kind: 'transit', mode: 'bus', realtime: true, delayMin: 4, stopsAway: 3, vehicle: veh };
  assert.equal(W.whereNow({ ...base, realtime: false }), null, 'timetable row');
  assert.equal(W.whereNow({ ...base, vehicle: null }), null, 'no position');
  assert.equal(W.whereNow({ ...base, stopsAway: null }), null, 'no stop count');
  assert.equal(W.whereNow({ ...base, stopsAway: 40 }), null, 'too far to be useful');
  assert.equal(W.whereNow({ ...base, stopsAway: -1 }), null, 'already passed');
  assert.equal(W.whereNow({ ...base, cancelled: true }), null, 'cancelled');
  assert.equal(W.whereNow({ ...base, vehicle: { ...veh, ageS: 600 } }), null, 'old position');
  assert.equal(W.whereNow(base, false), null, 'row is Not tracking');
  assert.equal(W.whereNow({ kind: 'walk', durationMin: 5 }), null, 'walk');
  assert.equal(W.whereNow(null), null);
});

// ---------- 2. Walking choice ----------
const iso = (h, m) => new Date(Date.UTC(2026, 9, 27, h - 11, m)).toISOString();
const J = (walks, arrH, arrM, id) => ({ id, arrive: iso(arrH, arrM), legs: walks.flatMap((w, i) => [{ kind: 'walk', durationMin: w }, { kind: 'transit', mode: i ? 'bus' : 'train' }]) });
test('walking: longest walk and the limit', () => {
  assert.equal(P.longestWalk(J([3, 12], 9, 0)), 12);
  assert.equal(P.longestWalk({ legs: [{ kind: 'transit' }] }), 0);
  const list = [J([14], 9, 0, 'a'), J([4], 9, 5, 'b'), J([9], 9, 10, 'c')];
  const r = P.applyWalkPref(list, { max: 10, prefer: false });
  assert.deepEqual(r.list.map((j) => j.id), ['b', 'c']);
  assert.equal(r.hidden, 1);
  assert.equal(P.walkNote(r, { max: 10, prefer: false }), '1 trip with a walk over 10 min not shown.');
});
test('walking: when every trip walks longer, all stay and the note says so', () => {
  const list = [J([16], 9, 0, 'a'), J([22], 9, 5, 'b')];
  const r = P.applyWalkPref(list, { max: 15, prefer: false });
  assert.equal(r.list.length, 2);
  assert.equal(r.allOver, true);
  assert.equal(P.walkNote(r, { max: 15, prefer: false }), 'Every trip found walks more than 15 min, so they all show. Try Prefer bus.');
});
test('walking: prefer a bus moves a long walk below a shorter walk arriving at most 10 min later', () => {
  const list = [J([15], 9, 0, 'long'), J([3], 9, 6, 'bus'), J([4], 9, 30, 'late')];
  assert.deepEqual(P.preferLessWalk(list).map((j) => j.id), ['bus', 'long', 'late']);
  // No shorter walk within 10 min: the long walk keeps its place.
  const list2 = [J([15], 9, 0, 'long'), J([3], 9, 25, 'bus')];
  assert.deepEqual(P.preferLessWalk(list2).map((j) => j.id), ['long', 'bus']);
  assert.deepEqual(P.applyWalkPref(list, { max: 0, prefer: true }).list.map((j) => j.id), ['bus', 'long', 'late']);
  assert.equal(P.walkNote({ hidden: 0, allOver: false }, { max: 0, prefer: true }), '');
});
test('walking: stored values read back safely, query words only when set', () => {
  assert.deepEqual(P.readWalkPref(undefined), { max: 0, prefer: false });
  assert.deepEqual(P.readWalkPref({ max: 7, prefer: 'yes' }), { max: 0, prefer: false });
  assert.deepEqual(P.readWalkPref({ max: 20, prefer: true }), { max: 20, prefer: true });
  assert.deepEqual(P.walkQuery({ max: 0, prefer: false }), {});
  assert.deepEqual(P.walkQuery({ max: 10, prefer: true }), { maxWalk: '10', lessWalk: '1' });
  assert.equal(P.walkValueText({ max: 5, prefer: false }), 'Up to 5 min');
  assert.equal(P.walkValueText({ max: 0, prefer: true }), 'Any, prefer bus');
});

// ---------- 3. Get me home ----------
test('get me home: asks for Home first, needs location, opens the trip from a point', () => {
  assert.deepEqual(G.goHomeStep(null, { lat: -32.9267, lon: 151.7789 }), { kind: 'setHome' });
  const home = { id: '2300101', name: 'Newcastle Interchange' };
  assert.deepEqual(G.goHomeStep(home, null), { kind: 'noLocation' });
  assert.deepEqual(G.goHomeStep(home, { lat: 51.5, lon: -0.12 }), { kind: 'outside' });
  const s = G.goHomeStep(home, { lat: -32.92671, lon: 151.77892 });
  assert.equal(s.kind, 'open');
  assert.deepEqual(s.params, { from: '151.77892:-32.92671:EPSG:4326', fromName: 'Your location', to: '2300101', toName: 'Newcastle Interchange', here: '1' });
  assert.equal(G.isPointId(s.params.from), true);
  assert.equal(G.isPointId('2150130'), false);
});
test('get me home: the point id matches the server rule (longitude first)', () => {
  const re = /^-?\d{1,3}(\.\d+)?:-?\d{1,2}(\.\d+)?:EPSG:4326$/;
  for (const [lat, lon] of [[-34.4278, 150.8931], [-33.7969, 151.2840], [-33.7511, 150.6942]]) assert.match(G.pointId(lat, lon), re);
  assert.equal(G.pointId(NaN, 151), null);
});

// ---------- 4. Exact stand pin ----------
// A bus leaving northwards along a north south road (lat grows), the stand on its left (west) kerb.
const stand = [-33.8150, 151.0010];
const busLeg = { kind: 'transit', mode: 'bus', from: 'Parramatta Station, Stand C3, Parramatta', fromPlatform: 'Stand C3', path: [stand, [-33.8146, 151.0010], [-33.8140, 151.0011], [-33.8130, 151.0012]] };
test('stand pin: the point is the leg path first point, with the stand name', () => {
  assert.deepEqual(S.standPoint(busLeg), stand);
  assert.equal(S.standName(busLeg), 'Stand C3');
  assert.equal(S.standName({ from: 'Manly Wharf, Wharf 3, Manly' }), 'Wharf 3');
  assert.equal(S.standName({ from: 'Wollongong Station', fromPlatform: '2' }), 'Platform 2');
  assert.equal(S.standPoint({ kind: 'transit', mode: 'bus' }), null, 'timetable answer without a path');
  assert.equal(S.standPoint({ kind: 'walk', path: [stand] }), null);
  assert.equal(S.standPoint({ kind: 'transit', path: [[0, 0]] }), null);
});
test('stand pin: across the road only when the walk starts on the far side, near enough', () => {
  const east = { kind: 'walk', path: [[-33.8152, 151.0013], stand] }; // about 28 m east: the far side for a northbound bus
  const west = { kind: 'walk', path: [[-33.8152, 151.0007], stand] }; // about 28 m west: the kerb side
  assert.equal(S.acrossRoad(busLeg, S.walkStart(east)), true);
  assert.equal(S.acrossRoad(busLeg, S.walkStart(west)), false);
  assert.equal(S.acrossRoad(busLeg, [-33.8250, 151.0013]), null, 'start too far away');
  assert.equal(S.acrossRoad(busLeg, [-33.81501, 151.00101]), null, 'start at the stand');
  assert.equal(S.acrossRoad({ ...busLeg, mode: 'train' }, S.walkStart(east)), null, 'trains: platforms, no kerb');
  assert.equal(S.acrossRoad({ ...busLeg, path: [stand] }, S.walkStart(east)), null, 'no direction');
  assert.equal(S.walkStart({ kind: 'transit' }), null);
});
test('stand pin: maps links per platform', () => {
  assert.match(S.mapsUrl(stand, 'Stand C3', 'ios'), /^https:\/\/maps\.apple\.com\/\?ll=-33\.815000,151\.001000&q=Stand%20C3&dirflg=w$/);
  assert.match(S.mapsUrl(stand, 'Stand C3', 'android'), /^geo:-33\.815000,151\.001000\?q=/);
  assert.match(S.mapsUrl(stand, 'Stand C3', 'web'), /^https:\/\/www\.openstreetmap\.org\//);
});

// ---------- the screens ----------
test('screens: Home cards and trip rows show where the bus is; trip screen has Walking, stand pins, Get me home guards', () => {
  const home = src('components/Home.tsx');
  // g32: the status line already says the delay, so these pass true and the where line says only where it is.
  assert.match(home, /whereNow\(l, ls\?\.kind === 'live', true\)/);
  assert.equal((home.match(/<WhereNow w=\{wn\}/g) || []).length, 3, 'hero card, row card, service row');
  const trip = src('app/trip.tsx');
  assert.match(trip, /<WalkChoice pref=\{wp\} tripKey=\{tkey\} \/>/);
  assert.match(trip, /applyWalkPref\(df\.list, wp\)/);
  assert.match(trip, /<StandPin leg=\{l\}/);
  assert.match(trip, /!via && !here\) store\.addRecentTrip/);
  assert.match(trip, /!chain && !here \?/);
  const hs = src('app/(tabs)/home/index.tsx');
  assert.match(hs, /<GetMeHome home=\{places\.home\} \/>/);
  const gm = src('components/GetMeHome.tsx');
  assert.match(gm, /myPosition\(true, false\)/, 'balanced accuracy, never high');
  assert.doesNotMatch(gm + src('components/StandPin.tsx') + src('components/WalkChoice.tsx') + src('components/WhereNow.tsx'), /setInterval|Accuracy\.High/);
});
