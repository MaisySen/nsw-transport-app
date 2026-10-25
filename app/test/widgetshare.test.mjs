// What the app shares with the iPhone widgets (platform/widgetShare.ts) and the short stop names on the
// Live Activity (platform/tripCard.ts). Field names must match SharedHomeWork and SharedLiveCard in
// targets/widget/WidgetIntents.swift.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-widgetshare-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const { homeWorkFor, liveCardFor, starredFor } = await load('platform/widgetShare.ts');
const { shortName } = await load('platform/tripCard.ts');

const strath = { id: '213510', name: 'Strathfield Station' };
const kx = { id: '201110', name: 'Kings Cross Station' };

test('Home and Work go to the widget as id and name', () => {
  const st = { places: { home: { ...strath, lat: -33.87 }, work: kx }, myTrips: [], commuteFlip: null };
  assert.deepEqual(homeWorkFor(st), { home: strath, work: kx, flip: null, trips: [] });
});

test('numeric stop ids become strings, as the widget decodes them', () => {
  const st = { places: { home: { id: 213510, name: 'Strathfield Station' } } };
  assert.deepEqual(homeWorkFor(st).home, strath);
  assert.equal(homeWorkFor(st).work, null);
});

test('no store shares an empty Home and Work, so the widget can say what to set', () => {
  assert.deepEqual(homeWorkFor(null), { home: null, work: null, flip: null, trips: [] });
  assert.deepEqual(homeWorkFor({}), { home: null, work: null, flip: null, trips: [] });
});

test('the commute swap for this half day travels with it', () => {
  assert.equal(homeWorkFor({ places: {}, commuteFlip: '2026-10-25 am' }).flip, '2026-10-25 am');
});

test('trips saved on the phone are shared with their names; broken ones are left out', () => {
  const st = { myTrips: [
    { name: 'Uni', from: strath, to: kx, legs: [{ mode: 'train', from: strath, to: kx }] },
    { name: 'Loop', from: strath, to: strath },
    { name: 'Half', from: strath },
  ] };
  assert.deepEqual(homeWorkFor(st).trips, [{ name: 'Uni', from: strath, to: kx }]);
});

test('the live card keeps the trip card fields and says when to stop showing it', () => {
  const card = { line: 'T1', lineColorHex: '#F99D1C', mode: 'train', nextStop: 'Redfern', stopsLeft: 1, getOffAt: 'Redfern',
    arrival: 1000000, phase: 'ride', warning: null, progress: 0.5, towards: 'Hornsby', platform: null, departs: 1, legArrives: 900000,
    destination: 'Kings Cross' };
  const c = liveCardFor('Strathfield to Kings Cross', card, 120000);
  assert.equal(c.title, 'Strathfield to Kings Cross');
  assert.equal(c.until, 1120000);
  assert.equal(c.getOffAt, 'Redfern');
  assert.equal(c.legArrives, 900000);
});

test('stop names lose Station even when a suburb follows', () => {
  assert.equal(shortName('Kings Cross Station, Kings Cross'), 'Kings Cross');
  assert.equal(shortName('Kings Cross Station'), 'Kings Cross');
  assert.equal(shortName('Circular Quay Wharf 4, Sydney'), 'Circular Quay Wharf 4');
  assert.equal(shortName('Manly Wharf'), 'Manly');
  assert.equal(shortName(null), '');
});

test('bus trips and bus stops reach the widget: modes on saved trips, stop number and routes on starred bus stops', () => {
  const fd = { id: 'G2046100', name: 'Five Dock Shops, Great North Rd, Five Dock' };
  const st = { myTrips: [{ from: strath, to: fd, name: 'Strathfield to Five Dock Shops', modes: ['bus'] }, { from: strath, to: kx, name: 'Strathfield to Kings Cross' }],
    starred: [{ id: '2046100', name: 'Five Dock Shops, Great North Rd', mode: 'bus', lines: ['438X', '492', '530', '415', 'D400', '501', '502', '504'] }, kx, { id: '213723', name: 'Concord Oval', mode: 'train' }] };
  const hw = homeWorkFor(st);
  assert.deepEqual(hw.trips[0], { name: 'Strathfield to Five Dock Shops', from: strath, to: fd, modes: ['bus'] });
  assert.deepEqual(hw.trips[1], { name: 'Strathfield to Kings Cross', from: strath, to: kx });
  const s = starredFor(st);
  assert.deepEqual(s[0], { id: '2046100', name: 'Five Dock Shops, Great North Rd', code: '2046100', mode: 'bus', lines: ['438X', '492', '530', '415', 'D400', '501'] });
  assert.deepEqual(s[1], kx, 'a station stays id and name, as older widgets read it');
  assert.equal(s[2].code, undefined, 'only bus stops get a stop number');
  assert.deepEqual(starredFor(null), []);
});
