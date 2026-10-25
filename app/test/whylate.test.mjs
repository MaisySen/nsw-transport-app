// "Why it's late": the reason line comes only from alerts linked to that service, never guessed.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-why-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const w = await load('src/lib/whyLateCore.ts');

// Shapes as the server sent them on 25 Oct 2026 (Strathfield and Central boards, Strathfield to Kings Cross trip).
const U = (id) => `https://transportnsw.info/alerts/details#/${id}`;
const board = [
  { id: 'c5212ba1', title: 'Eastern Suburbs & Illawarra Line, South Coast Line', url: U('c5212ba1'), priority: 'normal', lines: ['T4'] },
  { id: 'ems-79751', title: 'Trains run to a changed timetable and stopping pattern. City Circle trackwork may also affect how you travel', url: U('ems-79751'), priority: 'normal', lines: ['T4'] },
  { id: '6ac672a5', title: 'Running late', url: U('6ac672a5'), priority: 'normal', lines: ['T4'] },
  { id: 'station', title: 'Station Update - Strathfield', url: U('station'), priority: 'normal' },
  { id: 'ems-169', title: 'Platforms may change. Check indicator screens and listen for announcements', priority: 'veryLow' },
  { id: 'lift', title: 'Redfern Station Lift 7 between the southern concourse and Platform 10 is not available', url: U('lift'), priority: 'low' },
];
const full = w.alertTexts([{ items: [
  { title: 'Eastern Suburbs & Illawarra Line, South Coast Line Allow plenty of extra travel time in both directions due to an incident requiring emergency services at Allawah earlier. Stops and platforms may change at short notice.', url: U('c5212ba1') },
  { title: 'Running late Due to an incident requiring emergency services at Allawah. Platforms may change at short notice.', url: U('6ac672a5') },
] }]);

test('alert ids from links, linked alerts from ids', () => {
  assert.equal(w.alertKey({ url: U('ems-80715') }), 'ems-80715');
  assert.equal(w.alertKey('abc'), 'abc');
  assert.equal(w.alertKey(null), '');
  assert.deepEqual(w.linkedAlerts(['6ac672a5', 'nope'], board).map((a) => a.id), ['6ac672a5', 'nope']);
  assert.equal(full['c5212ba1'].startsWith('Eastern Suburbs'), true);
});

test('causes: due to, and alerts that start with the cause', () => {
  assert.equal(w.causeOf('Allow extra travel time due to an incident requiring emergency services at Allawah earlier. Stops may change.'), 'incident requiring emergency services at Allawah');
  assert.equal(w.causeOf('Trains are delayed due to signal repairs at Redfern.'), 'signal repairs at Redfern');
  assert.equal(w.causeOf('Police operation at Central. Allow extra travel time.'), 'Police operation at Central');
  assert.equal(w.causeOf('Buses replace trains between Lidcombe and Strathfield due to trackwork, please allow extra time'), 'trackwork');
  assert.equal(w.causeOf('Trains run to a changed timetable and stopping pattern. City Circle trackwork may also affect how you travel'), '');
  assert.equal(w.causeOf('Running late'), '');
  assert.equal(w.causeOf('Station Update - Strathfield'), '');
  assert.equal(w.causeOf('Delays due to a lift outage at Redfern'), '');
  assert.equal(w.causeOf(''), '');
});

test('a delayed T4 leg on Bidur\'s trip gets the reason from its own linked alert', () => {
  const leg = { delayMin: 13, realtime: true, alerts: [board[0], board[1], board[5]] };
  const r = w.whyLate(leg, board, full);
  assert.equal(r.text, 'Delayed: incident requiring emergency services at Allawah');
  assert.equal(r.kind, 'delayed');
  assert.equal(r.alert.url, U('c5212ba1'));
  assert.equal(w.whyA11y(r), "Why it's late: Delayed: incident requiring emergency services at Allawah. Opens the full alert.");
});

test('a departure row with ids: the trip alert comes first, even with no delay number', () => {
  const row = { delayMin: null, realtime: false, alerts: ['station', 'c5212ba1', 'ems-79751', '6ac672a5'] };
  const r = w.whyLate(row, board, full);
  assert.equal(r.text, 'Delayed: incident requiring emergency services at Allawah');
  assert.equal(r.alert.id, '6ac672a5');
});

test('nothing when the service is on time, has no linked alert with a cause, or only quiet alerts', () => {
  assert.equal(w.whyLate({ delayMin: 0, realtime: true, alerts: ['c5212ba1'] }, board, full), null, 'on time: no line even though the line has an incident');
  assert.equal(w.whyLate({ delayMin: 1, realtime: true, alerts: ['c5212ba1'] }, board, full), null, 'one minute is not a delay');
  assert.equal(w.whyLate({ delayMin: 9, realtime: true, alerts: ['ems-79751', 'station'] }, board, full), null, 'trackwork timetable note is not a stated cause');
  assert.equal(w.whyLate({ delayMin: 9, realtime: true, alerts: ['lift', 'ems-169'] }, board, full), null, 'low priority alerts never explain a delay');
  assert.equal(w.whyLate({ delayMin: 9, realtime: true, alerts: [] }, board, full), null);
  assert.equal(w.whyLate({ delayMin: 9, realtime: true }, board, full), null);
  assert.equal(w.whyLate({ delayMin: 9, realtime: false, alerts: ['c5212ba1'] }, board, full), null, 'a delay with no live time is not a delay');
  // Without the full text the bare title "Eastern Suburbs & Illawarra Line, South Coast Line" names no cause.
  assert.equal(w.whyLate({ delayMin: 9, realtime: true, alerts: ['c5212ba1'] }, board, {}), null);
});

test('cancelled and changed services, cause first titles, case and length', () => {
  const b2 = [{ id: 'p', title: 'Police operation at Central', priority: 'high' }, { id: 'n', title: 'Not stopping at Erskineville due to urgent track repairs', priority: 'normal' }];
  assert.equal(w.whyLate({ cancelled: true, alerts: ['p'] }, b2).text, 'Cancelled: police operation at Central');
  assert.equal(w.whyLate({ delayMin: 4, realtime: true, alerts: ['p'] }, b2).text, 'Delayed: police operation at Central');
  const ch = w.whyLate({ delayMin: 0, realtime: true, alerts: ['n'] }, b2);
  assert.equal(ch.text, 'Changed: urgent track repairs');
  assert.equal(w.forJourney(ch, 'T3', 2).text, 'T3 changed: urgent track repairs');
  assert.equal(ch.kind, 'changed');
  const long = [{ id: 'l', title: 'Trains are delayed due to an earlier incident involving a broken down freight train between Granville and Harris Park near the old signal box and the yard' }];
  const r = w.whyLate({ delayMin: 6, realtime: true, alerts: ['l'] }, long);
  assert.ok(r.text.length <= w.WHY_MAX, r.text);
  assert.ok(r.text.endsWith('\u2026'));
  assert.doesNotMatch(r.text, /[\u2013\u2014]/);
  assert.equal(w.whyLate({ delayMin: 6, realtime: true, alerts: [{ title: 'Sydney Trains crew shortage. Allow extra time', url: U('x') }] }, [], {}), null, 'a name first with no cause word is not read as a cause');
});

test('lines to ask for full text: only rows that could show a reason, each line once', () => {
  const rows = [
    { line: 'T4', delayMin: 13, realtime: true, alerts: ['c5212ba1'] },
    { line: 'T4', delayMin: 15, realtime: true, alerts: ['c5212ba1'] },
    { line: 'T9', delayMin: 0, realtime: true, alerts: ['station'] },
    { line: 'T1', delayMin: 5, realtime: true, alerts: ['lift'] },
    { line: 'CCN', delayMin: 0, realtime: true, alerts: ['6ac672a5'] },
    { line: 'Blue Mountains', delayMin: 9, realtime: true, alerts: ['c5212ba1'] },
  ];
  // CCN and Blue Mountains: /api/alerts filters by line only for names with a number, so they are not asked.
  assert.deepEqual(w.linesToAsk(rows, board), ['T4']);
  assert.deepEqual(w.linesToAsk([{ line: '410', delayMin: 4, realtime: true, alerts: ['c5212ba1'] }, ...rows], board), ['410', 'T4']);
  assert.deepEqual(w.linesToAsk(rows, board, 1), ['T4']);
});

test('a journey card names the line when the trip has more than one ride', () => {
  const leg = { delayMin: 16, realtime: true, alerts: [board[0]] };
  const r = w.whyLate(leg, board, full);
  assert.equal(w.forJourney(r, 'T4', 2).text, 'T4 delayed: incident requiring emergency services at Allawah');
  assert.equal(w.forJourney(r, 'T4', 1).text, 'Delayed: incident requiring emergency services at Allawah');
  assert.equal(w.forJourney(null, 'T4', 2), null);
  const c = w.whyLate({ cancelled: true, alerts: [{ title: 'Police operation at Central', priority: 'high' }] }, []);
  assert.equal(w.forJourney(c, 'T1', 2).text, 'T1 cancelled: police operation at Central');
});

test('no dashes in the words the screens show', () => {
  const src = fs.readFileSync(path.join(here, '..', 'src/lib/whyLateCore.ts'), 'utf8');
  assert.doesNotMatch(src, /[\u2013\u2014]/);
});
