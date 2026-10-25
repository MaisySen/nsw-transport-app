// Car parks (25 Oct): the one row on a train station's screen, the car park detail with Directions, and the Car parks
// list. Live counts only, from /api/parking; nothing for a station without a Park and Ride car park.
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
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const js = ts.transpileModule(read('src/lib/carparkCore.ts'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-carparks-')), 'carparkCore.mjs');
fs.writeFileSync(f, js);
const P = await import(pathToFileURL(f).href);

const NOW = Date.parse('2026-10-25T10:40:00Z'); // 9:40pm Sydney
const park = (o) => ({ id: '486', name: 'Ashfield', spots: 228, free: 217, status: 'ok', updated: '2026-10-25T10:28:05.000Z', stale: false, lat: -33.888104, lon: 151.12, ...o });

test('a station without a car park shows nothing', () => {
  assert.equal(P.parkRow([], NOW), null);
  assert.equal(P.parkRow(null, NOW), null);
  assert.equal(P.parkRow(undefined, NOW), null);
});

test('one car park: "Car park: N free of M" with the time Transport for NSW read it', () => {
  const r = P.parkRow([park()], NOW);
  assert.equal(r.title, 'Car park');
  assert.equal(r.value, '217 free of 228');
  assert.equal(r.updated, 'Updated 9:28pm, 11 min ago');
  assert.equal(r.single, '486');
  assert.equal(r.tone, 'green');
  assert.match(r.a11y, /^Car park, 217 free of 228 spaces, updated 9:28pm/);
});

test('several car parks: free spaces across the live ones, newest reading, worst status', () => {
  const r = P.parkRow([park({ id: '21', name: 'Penrith (at-grade)', spots: 229, free: 3, status: 'nearly' }), park({ id: '22', name: 'Penrith (multi-level)', spots: 1129, free: 1105, updated: '2026-10-25T10:33:48.000Z' })], NOW);
  assert.equal(r.title, 'Car parks');
  assert.equal(r.value, '1108 free of 1358');
  assert.equal(r.single, null);
  assert.equal(r.tone, 'orange');
  assert.equal(r.updated, 'Updated 9:33pm, 6 min ago');
});

test('no live count is said as such, never a made up number', () => {
  const stale = P.parkRow([park({ stale: true })], NOW);
  assert.equal(stale.value, '228 spaces, no live count right now');
  assert.equal(stale.updated, '');
  assert.equal(stale.tone, 'grey');
  assert.equal(P.parkRow([park({ free: null })], NOW).value, '228 spaces, no live count right now');
  const part = P.parkRow([park({ id: 'a' }), park({ id: 'b', free: null, spots: 100 })], NOW);
  assert.equal(part.value, '217 free of 228 (1 of 2 car parks live)');
});

test('updated words: just read, minutes, hours, nothing without a time', () => {
  assert.equal(P.updatedText('2026-10-25T10:39:30.000Z', NOW), 'Updated 9:39pm');
  assert.equal(P.updatedText('2026-10-25T07:40:00.000Z', NOW), 'Updated 6:40pm, 3 hr ago');
  assert.equal(P.updatedText(null, NOW), '');
  assert.equal(P.updatedText('nonsense', NOW), '');
});

test('Directions: Apple Maps on iPhone, Google Maps elsewhere, nothing without coordinates', () => {
  assert.equal(P.directionsUrl(park(), 'ios'), 'https://maps.apple.com/?daddr=-33.888104,151.120000&dirflg=d&q=Ashfield');
  assert.equal(P.directionsUrl(park(), 'android'), 'https://www.google.com/maps/dir/?api=1&destination=-33.888104,151.120000&travelmode=driving');
  assert.equal(P.directionsUrl(park({ lat: undefined }), 'ios'), null);
  assert.equal(P.directionsUrl(park({ lat: 200 }), 'android'), null);
  assert.equal(P.directionsUrl(null, 'ios'), null);
});

test('Car parks list: closest first with a position, A to Z without', () => {
  const list = [park({ id: '1', name: 'Kogarah', lat: -33.96, lon: 151.13 }), park({ id: '2', name: 'Ashfield', lat: -33.888, lon: 151.12 }), park({ id: '3', name: 'Brookvale', lat: -33.767, lon: 151.27 })];
  const dist = (a, b, c, d) => Math.hypot(a - c, b - d);
  assert.deepEqual(P.sortParks(list, null, dist).map((p) => p.name), ['Ashfield', 'Brookvale', 'Kogarah']);
  assert.deepEqual(P.sortParks(list, { lat: -33.95, lon: 151.13 }, dist).map((p) => p.name), ['Kogarah', 'Ashfield', 'Brookvale']);
});

test('screens: the station row, the detail with Directions, the list without asking for location', () => {
  const stop = read('src/app/stop/[id].tsx');
  assert.match(stop, /<CarParkRow list=\{station\?\.parking\}/);
  const row = read('src/components/CarParkRow.tsx');
  assert.match(row, /if \(!row\) return null;/);
  assert.match(row, /accessibilityRole="button"/);
  const det = read('src/app/carpark.tsx');
  assert.match(det, /directionsUrl\(p, Platform\.OS\)/);
  assert.match(det, /Linking\.openURL\(url\)/);
  const list = read('src/app/parking.tsx');
  assert.match(list, /myPosition\(false, true\)/);
  assert.match(list, /pathname: '\/carpark'/);
  assert.match(read('src/lib/where.ts'), /low \? Location\.Accuracy\.Low/);
  assert.match(read('src/lib/api.ts'), /carpark: \(id: string\) => req<.*\/api\/parking\?\$\{qs\(\{ id \}\)\}/);
  for (const src of [row, det, list]) {
    assert.doesNotMatch(src, /setInterval|useNow\(1000\)|Accuracy\.High/);
    assert.doesNotMatch(src, /[\u2013\u2014]/);
  }
});
