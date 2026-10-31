// Not stopping today (28 Oct): a bus detour or closed stop from the service's alerts says "Not stopping at <stop>
// today" on the stop board, a trip's bus leg and the bus route view. Rows and answers without the new server fields
// (every server before this, and every other row) show exactly as before.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-notstop-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  js = js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const N = await load('src/lib/notStoppingCore.ts');
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');
// A fixed noon in the zone the tests run in (TZ=Australia/Sydney), not the real clock: "today" against a time 5 or
// 25 minutes on flipped to "on Saturday" when the suite ran within 25 minutes of midnight (seen 30 Oct 11:47 PM,
// line 47). Midnight itself is pinned by the test at the end of this file.
const NOON = new Date(); NOON.setHours(12, 0, 0, 0);
const NOW = NOON.getTime();
const iso = (m) => new Date(NOW + m * 60000).toISOString();
const MARK = { stop: 'Main St opp Park Rd, Townsville', id: 'a1', title: 'Route X91 detour.', url: null };

test('stop board row: a marked bus says "Not stopping at <stop> today"; unmarked rows and trains say nothing', () => {
  assert.equal(N.notStoppingText({ mode: 'bus', planned: iso(5), notStopping: MARK }, NOW), 'Not stopping at Main St opp Park Rd today');
  assert.equal(N.notStoppingText({ mode: 'coach', planned: iso(5), notStopping: MARK }, NOW), 'Not stopping at Main St opp Park Rd today');
  assert.equal(N.notStoppingText({ mode: 'bus', planned: iso(5) }, NOW), null, 'an older server sends no field');
  assert.equal(N.notStoppingText({ mode: 'bus', planned: iso(5), notStopping: null }, NOW), null);
  assert.equal(N.notStoppingText({ mode: 'bus', planned: iso(5), notStopping: 'yes' }, NOW), null, 'a bad shape is ignored');
  assert.equal(N.notStoppingText({ mode: 'train', planned: iso(5), notStopping: MARK }, NOW), null, 'trains keep their own Not stopping');
  assert.equal(N.notStoppingText({ mode: 'bus', planned: iso(5), notStopping: { id: 'a1' } }, NOW), 'Not stopping here today');
  assert.equal(N.notStoppingText(null, NOW), null);
});

test('another day: a board or trip for another day names the day instead of "today"', () => {
  const later = NOW + 3 * 86400000;
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(later).getDay()];
  assert.equal(N.notStoppingText({ mode: 'bus', planned: new Date(later).toISOString(), notStopping: MARK }, NOW), `Not stopping at Main St opp Park Rd on ${day}`);
});

test('trip leg: the stop you get on, or the stop you get off (timed by its arrival)', () => {
  assert.equal(N.notStoppingText({ mode: 'bus', planned: iso(5), arrPlanned: iso(25), notStopping: { at: 'from', stop: 'High St' } }, NOW), 'Not stopping at High St today');
  assert.equal(N.notStoppingText({ mode: 'bus', planned: iso(5), arrPlanned: iso(25), notStopping: { at: 'to', stop: 'Park Rd, Stand B' } }, NOW), 'Not stopping at Park Rd today');
  assert.equal(N.notStoppingWhy({ notStopping: MARK }), 'Route X91 detour');
  assert.equal(N.notStoppingWhy({}), null);
  assert.equal(N.stopShort('Stand C, Main St'), 'Main St');
  assert.equal(N.stopShort(''), '');
});

test('route view: /api/detours becomes stop marks and one line above the stops; anything else marks nothing', () => {
  const m = N.routeDetours({ line: 'X91', items: [{ id: 'a1', title: 'Route X91 detour', stops: ['1', '2'] }, { id: 'b1', title: 'Stop moved', stops: ['2', '3'] }, null, { stops: 'x' }] });
  assert.deepEqual([...m.keys()], ['1', '2', '3']);
  assert.equal(m.get('2').id, 'a1', 'the first alert for a stop wins');
  const stops = [{ id: '1', name: 'Main St, Townsville' }, { id: '9', name: 'Far Rd' }];
  assert.equal(N.detourSummary(stops, m), 'Not stopping at Main St today');
  assert.equal(N.detourSummary([...stops, { id: '3', name: 'Park Rd' }], m), 'Not stopping at 2 stops today');
  assert.equal(N.detourSummary([{ id: '9', name: 'Far Rd' }], m, new Set(['1', '2', '3', '9'])), null, 'its stops are on the other direction');
  for (const bad of [null, undefined, {}, { items: 'x' }, { error: 'not found' }]) assert.equal(N.routeDetours(bad).size, 0);
  assert.equal(N.detourSummary(stops, new Map()), null);
});

test('route view: a closed stop the timetable already dropped shows the alert\'s own words above the stops', () => {
  const m = N.routeDetours({ items: [{ id: 'c1', title: 'Main St after Park Pl temporary bus stop closure.', stops: ['77'] }] });
  const dirA = [{ id: '1', name: 'Main St opp Park Pl' }], dirB = [{ id: '2', name: 'Main St at Park Pl' }];
  const all = new Set(['1', '2']);
  assert.equal(N.detourSummary(dirA, m, all), 'Main St after Park Pl temporary bus stop closure');
  assert.equal(N.detourSummary(dirB, m, all), 'Main St after Park Pl temporary bus stop closure');
  // A stop on the other direction's list is shown there, by name, not here.
  const both = new Set(['1', '2', '77']);
  assert.equal(N.detourSummary(dirA, m, both), null);
  assert.equal(N.detourSummary([{ id: '77', name: 'Main St after Park Pl' }], m, both), 'Not stopping at Main St after Park Pl today');
});

test('screens: the stop board row, the trip leg and the route view use it; the route view asks once, never polls', () => {
  const row = read('src/components/Transit.tsx');
  assert.match(row, /notStoppingText\(d, now\)/);
  const trip = read('src/app/trip.tsx');
  assert.match(trip, /notStoppingText\(l, now\)/);
  const route = read('src/app/route.tsx');
  assert.match(route, /api\.detours\(line, mode\)/);
  assert.match(route, /Not stopping today/);
  // Asked in an effect on line and mode, not inside the 30 s poll (load).
  const load = route.slice(route.indexOf('const load = useCallback'), route.indexOf('const runNow'));
  assert.doesNotMatch(load, /detours/);
  // Feature detected: a failed or missing answer is caught and changes nothing.
  assert.match(route, /api\.detours\(line, mode\)\.then\([^\n]*\)\.catch\(\(\) => \{\}\)/);
  const api = read('src/lib/api.ts');
  assert.match(api, /\/api\/detours\?/);
});

test('near midnight: a stop time after midnight names the next day, one before it is today (fixed clock, never the real one)', () => {
  const late = new Date(NOW); late.setHours(23, 50, 0, 0);
  const t = late.getTime();
  const at = (m) => new Date(t + m * 60000).toISOString();
  const next = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(t + 25 * 60000).getDay()];
  assert.equal(N.notStoppingText({ mode: 'bus', planned: at(5), notStopping: MARK }, t), 'Not stopping at Main St opp Park Rd today');
  assert.equal(N.notStoppingText({ mode: 'bus', planned: at(5), arrPlanned: at(25), notStopping: { at: 'to', stop: 'Park Rd' } }, t), `Not stopping at Park Rd on ${next}`);
});
