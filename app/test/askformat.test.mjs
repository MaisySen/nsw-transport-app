// Ask answer layout: the trip card fields and the short paragraphs. Run: node --test test/
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-ask-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const A = await load('src/lib/askFormat.ts');
const MIN = 60000;

// The shape /api/ask returned on 25 Oct for a Strathfield to Kings Cross question (Sydney is UTC+11).
const KX = 'Kings Cross Station Lift 1 between the concourse and Victoria St is not available';
const RF = 'Redfern Station Lift 7 between the southern concourse and Platform 10 is not available';
const fare = { type: 'adult', typeName: 'Adult', total: 3.76, peak: false, transfer: 0, airportFee: 0, capped: false, unknown: false, legs: [], estimate: true };
function journey(dep, delay, opts = {}) {
  const planned = new Date(Date.parse(dep) - delay * MIN).toISOString();
  return {
    leave: opts.leave || dep, arrive: new Date(Date.parse(dep) + 25 * MIN).toISOString(), durationMin: 25, changes: 1, fare,
    legs: [
      ...(opts.walk ? [{ kind: 'walk', realtime: false, delayMin: 0, cancelled: false }] : []),
      { kind: 'transit', mode: 'train', line: 'T1', color: '#F99D1C', fromPlatform: 'Platform 2', planned, estimated: dep, realtime: true, delayMin: delay, cancelled: false,
        access: { from: { level: 'independent' }, to: { outage: opts.redfern ? RF : undefined } } },
      { kind: 'transit', mode: 'train', line: 'T4', color: '#005AA3', fromPlatform: 'Platform 11', planned: dep, estimated: dep, realtime: true, delayMin: 0, cancelled: false,
        access: { from: { outage: opts.redfern ? RF : undefined }, to: { outage: KX } } },
    ],
  };
}
const reply = 'Strathfield Station to Kings Cross Station. Next: the T1 from Strathfield Station, Plat 2 at 7:30am (in 13 min), arriving Kings Cross Station 7:55am with 1 change. 4 min late.\n'
  + `Lift outage on this trip: ${KX}.\nOpal fare estimate $3.76 (Adult, off peak).`;
const msg = (j, extra = {}) => ({ text: reply, kind: 'trip', fare, cards: [{ type: 'trip', from: { id: '213510', name: 'Strathfield Station' }, to: { id: '201110', name: 'Kings Cross Station' }, journeys: j }], ...extra });
const DEP = '2026-10-24T20:30:00.000Z'; // 7:30 am Sydney
const NOW = Date.parse(DEP) - 13 * MIN;

test('trip answer becomes the card fields', () => {
  const s = A.tripSummary(msg([journey(DEP, 4)]), NOW);
  assert.equal(s.time, '7:30 am');
  assert.equal(s.when, 'in 13 min');
  assert.deepEqual(s.lines.map((l) => l.line), ['T1', 'T4']);
  assert.equal(s.platform, 'Platform 2');
  assert.equal(s.arrive, 'Arrives Kings Cross 7:55 am \u00b7 1 change');
  assert.deepEqual(s.status, { text: '4 min late', tone: 'lateText' });
  assert.equal(s.liftShort, 'Lift 1 at Kings Cross not working');
  assert.deepEqual(s.outages, [KX]);
  assert.equal(s.fare, 'Fare about $3.76 \u00b7 Adult off peak');
  assert.deepEqual(s.extras, []);
  assert.equal(s.leaveAt, null);
});

test('no repeated header, no "Station" and no dashes in what is shown', () => {
  const s = A.tripSummary(msg([journey(DEP, 4)]), NOW);
  const shown = [s.time, s.when, s.platform, s.arrive, s.status.text, s.liftShort, s.fare, ...s.extras].join(' | ');
  assert.ok(!/Strathfield/.test(shown));
  assert.ok(!/Station/.test(shown));
  assert.ok(!/[\u2013\u2014]/.test(shown + s.spoken));
});

test('screen readers get one sentence', () => {
  const s = A.tripSummary(msg([journey(DEP, 4)]), NOW);
  assert.equal(s.spoken, 'Next T1 then T4 at 7:30 am, in 13 minutes, from Platform 2. Arrives Kings Cross at 7:55 am, 1 change. 4 minutes late. Lift 1 at Kings Cross not working. Fare about $3.76, Adult off peak.');
});

test('on time is green, cancelled and scheduled read plainly', () => {
  assert.deepEqual(A.statusOf({ realtime: true, delayMin: 1 }), { text: 'On time', tone: 'liveText' });
  assert.deepEqual(A.statusOf({ realtime: true, delayMin: -3 }), { text: '3 min early', tone: 'liveText' });
  assert.deepEqual(A.statusOf({ realtime: false }), { text: 'Scheduled', tone: 'text2' });
  assert.deepEqual(A.statusOf({ cancelled: true, realtime: true }), { text: 'Cancelled', tone: 'redText' });
  const s = A.tripSummary(msg([journey(DEP, 0)]), NOW);
  assert.equal(s.status.text, 'On time');
  assert.ok(s.spoken.includes('On time.'));
});

test('countdown words', () => {
  const t = Date.parse(DEP);
  assert.deepEqual(A.untilWords(DEP, t - 1 * MIN), { text: 'in 1 min', spoken: 'in 1 minute', past: false });
  assert.equal(A.untilWords(DEP, t).text, 'Now');
  assert.equal(A.untilWords(DEP, t + 5 * MIN).text, 'Left');
  assert.deepEqual(A.untilWords(DEP, t - 65 * MIN), { text: 'in 1 h 5 min', spoken: 'in 1 hour 5 minutes', past: false });
  assert.equal(A.untilWords(DEP, t - 120 * MIN).text, 'in 2 h');
});

test('a journey that has left gives way to the next one', () => {
  const later = '2026-10-24T20:45:00.000Z';
  const s = A.tripSummary(msg([journey(DEP, 4), journey(later, 0)]), Date.parse(DEP) + 3 * MIN);
  assert.equal(s.time, '7:45 am');
  assert.equal(s.status.text, 'On time');
});

test('two lift outages, same station, many', () => {
  assert.equal(A.liftShort([RF, KX]), 'Lift 7 at Redfern and Lift 1 at Kings Cross not working');
  assert.equal(A.liftShort(['Central Station Lift 3 is not available', 'Central Station Lift 4 is not available']), 'Lift 3 and Lift 4 at Central not working');
  assert.equal(A.liftShort([RF, KX, 'Central Station Escalator 2 is not available']), '3 lifts not working on this trip');
  assert.equal(A.liftShort(['The lift is closed for maintenance']), 'Lift not working on this trip');
  assert.equal(A.liftShort([]), null);
  assert.deepEqual(A.parseOutage('Wynyard Station Escalator 4 between X and Y is not available'), { what: 'Escalator 4', at: 'Wynyard' });
  const s = A.tripSummary(msg([journey(DEP, 4, { redfern: true })]), NOW);
  assert.deepEqual(s.outages, [RF, KX]);
});

test('fare line variants', () => {
  assert.equal(A.fareLine({ ...fare, peak: true }).text, 'Fare about $3.76 \u00b7 Adult peak');
  assert.equal(A.fareLine({ ...fare, typeName: 'Concession', total: 1.88, capped: true }).text, 'Fare about $1.88 \u00b7 Concession off peak \u00b7 daily cap reached');
  assert.equal(A.fareLine({ ...fare, airportFee: 17.34 }).text, 'Fare about $3.76 \u00b7 Adult off peak \u00b7 includes $17.34 airport fee');
  assert.equal(A.fareLine({ ...fare, unknown: true }), null);
  assert.equal(A.fareLine({ ...fare, total: null }), null);
  assert.equal(A.fareLine(null), null);
});

test('walk first shows when to leave; other reply lines are kept', () => {
  const m = msg([journey(DEP, 0, { walk: true, leave: '2026-10-24T20:22:00.000Z' })]);
  m.text = m.text + '\nStep free trips only.';
  const s = A.tripSummary(m, NOW);
  assert.equal(s.leaveAt, '7:22 am');
  assert.deepEqual(s.extras, ['Step free trips only.']);
  assert.ok(s.spoken.includes('Leave at 7:22 am.'));
});

test('answers that are not a next service stay text', () => {
  assert.equal(A.tripSummary({ text: 'The T1 looks on time. All 6 live services are within 2 min.', kind: 'line', cards: [] }, NOW), null);
  assert.equal(A.tripSummary({ ...msg([journey(DEP, 0)]), text: 'Strathfield Station to Kings Cross Station. No trips found right now.' }, NOW), null);
  assert.equal(A.tripSummary(msg([]), NOW), null);
  // Saved chats from before this version have no kind; the reply and the card still say it is a trip.
  const old = msg([journey(DEP, 4)]); delete old.kind; delete old.fare;
  assert.equal(A.tripSummary(old, NOW).fare, 'Fare about $3.76 \u00b7 Adult off peak');
});

test('plain answers split into short paragraphs', () => {
  const t = 'The T1 has some delays at Strathfield: 2 of 6 live services late, the worst 6 min (7:41am to Central). 1 alert: Trackwork at Redfern. Buses replace trains. Check before you travel.';
  assert.deepEqual(A.splitPlain(t), [
    'The T1 has some delays at Strathfield: 2 of 6 live services late, the worst 6 min (7:41am to Central). 1 alert: Trackwork at Redfern.',
    'Buses replace trains. Check before you travel.',
  ]);
  assert.deepEqual(A.splitPlain('Bus stop on George St. near Market St. is closed. Use the next stop.'), ['Bus stop on George St. near Market St. is closed. Use the next stop.']);
  assert.deepEqual(A.splitPlain('Fare $3.76 today. Next one.\nSecond line here.'), ['Fare $3.76 today. Next one.', 'Second line here.']);
  assert.deepEqual(A.splitPlain('One. Two. Three.'), ['One. Two.', 'Three.']);
  const long = 'A'.repeat(100) + '. ' + 'B'.repeat(100) + '.';
  assert.equal(A.splitPlain(long).length, 2);
  assert.deepEqual(A.splitPlain(''), []);
});

test('short place names', () => {
  assert.equal(A.shortPlace('Kings Cross Station'), 'Kings Cross');
  assert.equal(A.shortPlace('Circular Quay Wharf'), 'Circular Quay');
  assert.equal(A.shortPlace('Parramatta Rd opp Stanmore Rd, Stanmore'), 'Parramatta Rd opp Stanmore Rd');
  assert.equal(A.shortPlace(null), '');
});
