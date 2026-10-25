// Simple mode, one screen (Bidur, 25 Oct 9:37 PM: "User come. Look this to that place. They get the list like this.
// Thats it."). Your places and their order, the trip rows, the steps and the source rules for the screen.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-simple-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const s = await load('src/lib/simpleCore.ts');
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');


const iso = (t) => new Date(t).toISOString();
const NOW = Date.parse('2026-10-25T10:50:00Z'); // 9:50pm Sydney
const min = 60000;
const strath = { id: '213510', name: 'Strathfield Station' };
const kx = { id: '201110', name: 'Kings Cross Station' };
// Strathfield to Kings Cross as the planner sends it: T9 to Redfern, then T4.
function commute(depMin, { delay = 0, realtime = true, cancelled = false } = {}) {
  const dep = NOW + depMin * min;
  return {
    leave: iso(dep), arrive: iso(dep + 38 * min), durationMin: 38, changes: 1,
    legs: [
      { kind: 'transit', mode: 'train', line: 'T9', color: '#D11F2F', towards: 'Central', from: 'Strathfield Station', fromPlatform: 'Platform 2', to: 'Redfern Station', toPlatform: 'Platform 1',
        fromParent: '213510', toParent: '201510', planned: iso(dep), estimated: iso(dep + delay * min), arrPlanned: iso(dep + 12 * min), arrEstimated: iso(dep + (12 + delay) * min),
        realtime, delayMin: realtime ? delay : null, cancelled, stops: 2, durationMin: 12, tripId: `a${depMin}` },
      { kind: 'transit', mode: 'train', line: 'T4', color: '#005AA3', towards: 'Bondi Junction via Central', from: 'Redfern Station', fromPlatform: 'Platform 11', to: 'Kings Cross Station', toPlatform: 'Platform 2',
        fromParent: '201510', toParent: '201110', planned: iso(dep + 28 * min), estimated: iso(dep + 28 * min), arrPlanned: iso(dep + 38 * min), arrEstimated: iso(dep + 38 * min),
        realtime, delayMin: 0, stops: 4, durationMin: 10, tripId: `b${depMin}` },
    ],
  };
}

test('your places: Home, Work, then recent places newest first, then starred stops, each once', () => {
  const rows = s.simplePlaces({
    home: strath, work: kx,
    recentTrips: [
      { from: strath, to: { id: 'G2046100', name: 'Five Dock Shops, Great North Rd, Five Dock' }, at: 100 },
      { from: strath, to: { id: '200060', name: 'Central Station' }, at: 300 },
      { from: strath, to: kx, at: 200 },
    ],
    starred: [{ id: '213511', name: 'Strathfield Station, Everton Rd, Stand D, Strathfield' }, { id: '200060', name: 'Central Station' }],
  });
  assert.deepEqual(rows.map((r) => [r.kind, r.title]), [['home', 'Home'], ['work', 'Work'], ['recent', 'Central'], ['recent', 'Five Dock Shops'], ['star', 'Strathfield']]);
  assert.equal(rows[0].sub, 'Strathfield');
  assert.equal(rows[3].sub, 'Great North Rd');
  assert.equal(rows[4].a11y, 'Strathfield, Everton Rd, Stand D');
  assert.equal(s.simplePlaces({ home: strath, recentTrips: [], starred: [strath] }).length, 1);
  assert.deepEqual(s.simplePlaces({}), [], 'nothing saved, nothing shown');
  assert.equal(s.simplePlaces({ recentTrips: Array.from({ length: 6 }, (_, i) => ({ from: strath, to: { id: String(i), name: `Stop ${i}` }, at: i })), starred: [kx, { id: 'x', name: 'X' }, { id: 'y', name: 'Y' }] }).length, 8);
});

test('a tapped place fills To, From when To is filled and From is empty, else To', () => {
  assert.equal(s.fillTarget({ loc: true }, null), 'to');
  assert.equal(s.fillTarget(null, null), 'to');
  assert.equal(s.fillTarget(null, { place: kx }), 'from');
  assert.equal(s.fillTarget({ loc: true }, { place: kx }), 'to');
});

test('Current location is the station named like the nearest stop', () => {
  assert.deepEqual(s.nearPlace({ id: '2135234', name: 'Strathfield Station, Platform 4, Strathfield' }, [{ id: '213710', name: 'North Strathfield Station' }, strath]), strath);
  assert.deepEqual(s.nearPlace({ id: 'G1', name: 'Five Dock Shops, Great North Rd, Five Dock' }, [{ id: 'G1', name: 'Five Dock Shops, Great North Rd, Five Dock' }]), { id: 'G1', name: 'Five Dock Shops, Great North Rd, Five Dock' });
  assert.equal(s.nearPlace(null, [strath]), null);
});

test('result row: leave, arrive, duration, changes, lines, live status and whole minutes to go', () => {
  const r = s.tripRow(commute(12), NOW);
  assert.equal(r.leave, s.clock(NOW + 12 * min));
  assert.equal(r.arrive, s.clock(NOW + 50 * min));
  assert.equal(r.dur, '38 min');
  assert.equal(r.changes, '1 change');
  assert.deepEqual(r.lines.map((l) => l.line), ['T9', 'T4']);
  assert.equal(r.status, 'On time');
  assert.equal(r.inText, 'Leaves in 12 min');
  assert.equal(r.a11y, `Leaves ${s.clock(NOW + 12 * min)}, arrives ${s.clock(NOW + 50 * min)}, 38 minutes, 1 change, T9 then T4, on time, leaves in 12 minutes.`);
  assert.equal(s.tripRow(commute(12), NOW + 30 * 1000).inText, 'Leaves in 11 min', 'whole minutes, rounded down');
  const late = s.tripRow(commute(12, { delay: 4 }), NOW);
  assert.equal(late.status, '4 min late'); assert.equal(late.tone, 'late'); assert.equal(late.inText, 'Leaves in 16 min');
  assert.match(late.a11y, /4 minutes late, leaves in 16 minutes\.$/);
  const gone = s.tripRow(commute(12, { cancelled: true }), NOW);
  assert.equal(gone.status, 'Cancelled'); assert.equal(gone.inText, ''); assert.equal(gone.tone, 'red');
  assert.equal(s.tripRow(commute(12, { realtime: false }), NOW).status, 'Timetable');
  assert.equal(s.tripRow(commute(0), NOW).inText, 'Leaves now');
  assert.equal(s.tripRow(commute(75), NOW).inText, 'Leaves in 1 hr 15 min');
  const direct = commute(5); direct.legs = direct.legs.slice(0, 1); direct.changes = 0;
  assert.equal(s.tripRow(direct, NOW).changes, 'No changes');
});

test('trip list: soonest first, each once, gone ones only after Earlier', () => {
  const js = [commute(20), commute(5), commute(-10), commute(5)];
  const { rows } = s.tripRows(js, NOW);
  assert.deepEqual(rows.map((r) => r.inText), ['Leaves in 5 min', 'Leaves in 20 min']);
  const withGone = s.tripRows(js, NOW, { keepGone: true }).rows;
  assert.equal(withGone.length, 3);
  assert.equal(withGone[0].status, 'Left');
  assert.equal(s.earlierAt(NOW), NOW - 30 * min);
  assert.equal(s.laterAt(NOW), NOW + min);
  assert.match(s.hhmm(Date.parse('2026-10-25T10:05:00Z')), /^2105$/);
});

test('steps from the real legs: walk to the platform, take, change, get off', () => {
  const steps = s.buildSteps(commute(12));
  assert.deepEqual(steps.map((x) => x.text), [
    'Walk to Platform 2',
    'Take T9 to Redfern, 2 stops',
    'Change to T4 at Redfern, Platform 11',
    'Get off at Kings Cross',
  ]);
  assert.equal(steps[0].sub, 'Strathfield');
  assert.equal(steps[1].sub, `Leaves ${s.clock(NOW + 12 * min)}, towards Central`);
  assert.equal(steps[2].sub, `Leaves ${s.clock(NOW + 40 * min)}, 4 stops to Kings Cross`);
  assert.equal(steps[3].sub, `Arrive ${s.clock(NOW + 50 * min)}`);
  assert.equal(steps[1].say, `Take T9 to Redfern, 2 stops. Leaves ${s.clock(NOW + 12 * min)}, towards Central.`);
  assert.match(s.spokenSteps(steps), /^Walk to Platform 2\. Strathfield\. Take T9/);
});

test('steps: a bus with walks, a walk between two stops, late and cancelled services', () => {
  const dep = NOW + 6 * min;
  const j = { leave: iso(dep - 3 * min), arrive: iso(dep + 30 * min), durationMin: 33, changes: 1, legs: [
    { kind: 'walk', durationMin: 3, to: 'Strathfield Station, Everton Rd, Stand D, Strathfield' },
    { kind: 'transit', mode: 'bus', line: '410', from: 'Strathfield Station, Everton Rd, Stand D, Strathfield', fromPlatform: 'Stand D', to: 'Burwood Station, Burwood Rd, Burwood', planned: iso(dep), estimated: iso(dep + 3 * min), realtime: true, delayMin: 3, stops: 7, arrPlanned: iso(dep + 10 * min) },
    { kind: 'walk', durationMin: 4, to: 'Burwood Rd at Belmore St' },
    { kind: 'transit', mode: 'bus', line: 'D400', from: 'Burwood Rd at Belmore St, Burwood', to: 'Five Dock Shops, Great North Rd, Five Dock', planned: iso(dep + 16 * min), realtime: false, cancelled: true, stops: 1, arrPlanned: iso(dep + 25 * min) },
    { kind: 'walk', durationMin: 5, to: 'Five Dock Library' },
  ] };
  const steps = s.buildSteps(j);
  assert.deepEqual(steps.map((x) => x.text), [
    'Walk to Stand D',
    'Take bus 410 to Burwood, 7 stops',
    'Walk to Burwood Rd at Belmore St',
    'Take bus D400 to Five Dock Shops, 1 stop',
    'Get off at Five Dock Shops',
    'Walk to Five Dock Library',
  ]);
  assert.equal(steps[0].sub, 'Strathfield, 3 min walk');
  assert.match(steps[1].sub, /3 min late$/);
  assert.match(steps[3].sub, /Cancelled$/);
  assert.equal(steps[5].sub, `5 min walk, there by ${s.clock(dep + 30 * min)}`);
  assert.equal(s.buildSteps({ legs: [{ kind: 'walk', durationMin: 9 }] })[0].text, 'Walk all the way');
  assert.equal(s.lineWords({ mode: 'ferry', line: 'F1' }), 'ferry F1');
  assert.equal(s.platformWords('Plat 3'), 'Platform 3');
  assert.equal(s.platformWords('4'), 'Platform 4');
});

test('the screen: one page, no swiping or chips, live list only on view, location never asked on launch', () => {
  const src = read('src/app/simple.tsx');
  assert.ok(!/pagingEnabled|horizontal/.test(src), 'no swipe pages');
  assert.ok(!/hereChoices|chipLabel|defaultPage/.test(src), 'old Here board code is gone');
  assert.match(src, /enabled: !!query && !edit/, 'the trip list refreshes only while on view');
  assert.ok(!/setInterval|Accuracy\.High|useNow\(1000\)/.test(src));
  assert.match(src, /Accuracy\.Low/);
  // On launch only the permission is read; asking happens from the Use my location row.
  const launch = src.slice(src.indexOf('no prompt on launch'), src.indexOf('no prompt on launch') + 300);
  assert.match(launch, /getForegroundPermissionsAsync/);
  assert.ok(!/requestForegroundPermissionsAsync/.test(launch));
  assert.match(src, /speak\(/, 'Speak reads the steps through nativeExtras.speak');
  assert.match(src, /store\.setSimple\(false\)/, 'the gear still leaves Simple mode, after a confirm');
  for (const chunk of src.split('<Pressable ').slice(1)) assert.match(chunk.slice(0, 400), /accessibilityRole=/, 'every Pressable has a role');
  assert.ok(!/[\u2013\u2014]/.test(src + read('src/lib/simpleCore.ts')), 'no em or en dashes');
});

test('the screen is headed Plan Your Trip, and its words name no other app or site', () => {
  const src = read('src/app/simple.tsx');
  const core = read('src/lib/simpleCore.ts');
  assert.match(src, />Plan Your Trip</, 'the heading reads Plan Your Trip');
  // The words are built from parts so a search of the repo for them finds only real uses.
  const words = (src + core).toLowerCase();
  for (const w of ['trip ' + 'planner', 'transport' + 'nsw', 'trip' + 'view']) assert.ok(!words.includes(w), `Simple mode does not say ${w}`);
});
