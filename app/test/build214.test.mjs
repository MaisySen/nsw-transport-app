// Build 214 (1 Nov 2026, Bidur OK 2:31 PM "Yes. If thats the right thing"): the three changes he said yes to.
// 1. Held train: one calm "Held, stay on" when the train is not at the stop a minute after Get off now and the live
//    arrival has moved on (shadow trip L, 31 Oct: held 2 min 43 s outside the stop, Get off now 200 s early).
// 2. Get off now timing: the 30 s rule plus the feed's lag (8 s), so it lands about 30 s before the train stops (shadow
//    trips G, H, I, K, M landed 13 to 25 s before), never over 40 s before the live arrival.
// 3. Words: one word for no live data ("Timetable"), one time style ("7:52pm"), no data provider's name in errors
//    (the attributions keep it).
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-b214-'));
async function load(rel) {
  const js = ts.transpileModule(fs.readFileSync(path.join(root, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const T = await load('src/lib/tripState.ts');

const at = (hm) => Date.parse(`2026-10-31T${hm}+11:00`);
const iso = (hm) => new Date(at(hm)).toISOString();
// a sample trip (not the owner's stations): Lidcombe 7:50pm to Clyde 7:55pm
const leg = { mode: 'train', line: 'T1', tripId: 'T1-1950', stopId: 'LID7', toStopId: 'CLY', from: 'Lidcombe Station', to: 'Clyde Station', planned: iso('19:50:00'), arrPlanned: iso('19:55:00'), fromPlatform: 'Platform 7' };
const svc = (cly, o = {}) => ({ kind: 'service', tripId: 'T1-1950', line: 'T1', live: true, mineIndex: 0, alightIndex: 2, stops: [
  { id: 'LID7', name: 'Lidcombe Station', planned: iso('19:50:00'), estimated: iso('19:51:00'), platform: 'Platform 7', passed: true },
  { id: 'AUB', name: 'Auburn Station', planned: iso('19:53:00'), estimated: iso('19:54:00'), passed: true },
  { id: 'CLY', name: 'Clyde Station', planned: iso('19:55:00'), estimated: iso(cly), ...(o.cly || {}) },
], ...(o.d || {}) });

/** A trip already on board (phase onTheWay), then stepped at each [time, live arrival at Clyde, reading age s]. */
function run(steps, lead = 0) {
  const plan = T.tripPlanFrom([leg], [svc('19:59:00')]);
  const M = T.newTripMemory(plan);
  M.legs[0].phase = T.PHASE_INDEX.onTheWay; M.legs[0].rung.headsup = at('19:57:00');
  const rings = [];
  for (const [hm, cly, age = 3] of steps) {
    const t = at(hm);
    const snap = T.tripReadingFrom(plan, [leg], [svc(cly)], t - age * 1000);
    const r = T.tripStep(plan, M, t, snap, { lead });
    for (const x of r.moments) rings.push({ at: hm, kind: x.ring.kind, title: x.ring.title, quiet: !!x.ring.quiet, level: x.ring.level, clip: x.ring.clip || null, target: x.ring.target });
  }
  return { rings, M, plan };
}

test('Get off now lands 38 s before the live arrival (30 s plus the feed lag), never more than 40 s before it', () => {
  assert.equal(T.TRIP_RULES.GETOFF_LEAD, 30000, "the owner's 30 s rule stays the base");
  assert.equal(T.getOffLeadMs(0), 38000, 'the app (no delivery lead)');
  assert.equal(T.getOffLeadMs(2000), 40000, 'the server sends 2 s early for delivery, so it lands at 38 s too');
  for (const lead of [0, 2000, 5000, 60000]) assert.ok(T.getOffLeadMs(lead) <= 40000, `never over 40 s (lead ${lead})`);
  // arrival 7:59:00: not at 7:58:21, rings at 7:58:22 (38 s before)
  assert.deepEqual(run([['19:58:21', '19:59:00']]).rings.map((x) => x.kind), []);
  const r = run([['19:58:21', '19:59:00'], ['19:58:22', '19:59:00']]);
  assert.deepEqual(r.rings.map((x) => [x.at, x.kind]), [['19:58:22', 'getoff']]);
  assert.equal(r.rings[0].target, at('19:58:22'), 'the moment it was due (catch-up rule) is the arrival less 38 s');
  // the server, 2 s delivery lead: sends at 7:58:20
  assert.deepEqual(run([['19:58:19', '19:59:00'], ['19:58:20', '19:59:00']], 2000).rings.map((x) => [x.at, x.kind]), [['19:58:20', 'getoff']]);
  assert.equal(T.backupGetOff(T.tripPlanFrom([leg], [svc('19:59:00')]), T.newTripMemory(T.tripPlanFrom([leg], [svc('19:59:00')])), T.tripReadingFrom(T.tripPlanFrom([leg], [svc('19:59:00')]), [leg], [svc('19:59:00')], at('19:56:00')), at('19:56:05'), false).at, at('19:58:22'), 'the phone backup uses the same moment');
});

test('held after Get off now: one calm "Held, stay on" a minute later, then Arrived as usual', () => {
  const r = run([['19:58:22', '19:59:00'], ['19:59:00', '19:59:40'], ['19:59:22', '20:00:30'], ['19:59:40', '20:00:50'], ['20:00:30', '20:01:10'], ['20:01:00', '20:01:20']]);
  const held = r.rings.filter((x) => x.kind === 'held');
  assert.equal(held.length, 1, 'never more than one');
  assert.equal(held[0].at, '19:59:22', '60 s after Get off now, live arrival 68 s away and 90 s later than at Get off now');
  assert.equal(held[0].title, 'Held, stay on');
  assert.equal(held[0].quiet, true, 'calm: a quiet note');
  assert.equal(held[0].level, 'passive', 'no alarm, no time sensitive break through');
  assert.equal(held[0].clip, null, 'no sound clip');
  // the card says it, and keeps the arrival
  const snap = T.tripReadingFrom(r.plan, [leg], [svc('20:01:20')], at('20:00:55'));
  const v = T.tripRender(r.plan, r.M, snap, at('20:01:00'));
  assert.equal(v.held, true);
  assert.match(v.status, /^Held · stay on/);
  assert.equal(v.arrive, 'Arriving about 8:01pm');
  assert.doesNotMatch(v.status, /Get off now/);
  // the train gets in: Arrived comes as usual
  const snap2 = T.tripReadingFrom(r.plan, [leg], [svc('20:01:20', { cly: { passed: true } })], at('20:01:25'));
  const done = T.tripStep(r.plan, r.M, at('20:01:30'), snap2, {});
  assert.deepEqual(done.moments.map((x) => x.ring.kind), ['arrived']);
});

test('no "Held" on a normal stop: a train coming in on time, a little late, or with no new data', () => {
  // on time: the arrival passes (Arrived comes from the stop's own time), never Held
  assert.deepEqual(run([['19:58:22', '19:59:00'], ['19:59:22', '19:59:00'], ['19:59:40', '19:59:00']]).rings.filter((x) => x.kind === 'held'), []);
  // a minute on it is 34 s late but 12 s away (pulling in): not held
  assert.deepEqual(run([['19:58:22', '19:59:00'], ['19:59:22', '19:59:34'], ['19:59:30', '19:59:34']]).rings.filter((x) => x.kind === 'held'), []);
  // moved 45 s later but due in 10 s (pulling in): not held
  assert.deepEqual(run([['19:58:22', '19:59:00'], ['19:59:35', '19:59:45']]).rings.filter((x) => x.kind === 'held'), []);
  // old data (reading 3 min old): never claims a hold
  assert.deepEqual(run([['19:58:22', '19:59:00'], ['20:00:00', '20:01:30', 180]]).rings.filter((x) => x.kind === 'held'), []);
  // under 60 s after Get off now: not yet
  assert.deepEqual(run([['19:58:22', '19:59:00'], ['19:59:20', '20:00:30']]).rings.filter((x) => x.kind === 'held'), []);
});

test('the Watch, the Your trip widget and the open app use the same Get off now moment as the alert (38 s)', () => {
  for (const f of ['targets/watch/WatchCore.swift', 'targets/watch-widget/WatchCore.swift', 'targets/widget/TripMoments.swift']) {
    assert.match(read(f), /static let getOffLead: TimeInterval = 38\b/, f);
  }
  const lc = read('src/lib/liveCalc.ts');
  assert.match(lc, /const at = getOffDueAt\(x\.arr\);/, 'the open app steps the trip at the same moment');
  assert.doesNotMatch(read('src/lib/tripState.ts'), /tm2?\.arr\.at - R\.GETOFF_LEAD - lead/, 'no bare 30 s timer left');
});

test('one word for no live data: "Timetable" on the phone, widgets, Lock Screen and Island', async () => {
  const F = await load('src/lib/format.ts').catch(() => null);
  if (F) assert.equal(F.delayWords(null, false).text, 'Timetable');
  const A = await load('src/lib/askFormat.ts');
  assert.equal(A.statusOf({ realtime: false }).text, 'Timetable');
  const TM = await load('src/lib/tripModesCore.ts');
  assert.equal(TM.leftWords(at('18:18:00'), { realtime: false }, () => '6:18'), 'Left 6:18 \u00b7 Timetable');
  for (const f of ['src/components/Cards.tsx', 'src/components/Home.tsx', 'src/lib/askFormat.ts', 'src/lib/format.ts', 'src/lib/tripModesCore.ts', 'src/lib/timetablePackCore.ts']) {
    assert.doesNotMatch(read(f), /text: 'Scheduled'|'Scheduled'|· Scheduled`/, f);
  }
  assert.match(read('targets/widget/Format.swift'), /guard live, let d = delayMin else \{ return "Timetable" \}/);
  assert.match(read('targets/widget/WidgetText.swift'), /return "Timetable" \}/);
  assert.doesNotMatch(read('targets/widget/WidgetText.swift'), /return "No live data"/);
  assert.doesNotMatch(read('targets/widget/TripLiveActivity.swift'), /: "Scheduled"\)/);
  assert.doesNotMatch(read('targets/widget/TransportWidgets.swift'), /x\.status = "Scheduled"/);
});

test('one time style: "7:52pm" (no space) on the Plan rows, trip detail and Ask too', async () => {
  const RT = await load('src/lib/rowTimeCore.ts');
  const t = at('12:56:00');
  assert.equal(RT.rowClock(t, false), '12:56pm');
  assert.equal(RT.rowClock(at('09:05:00'), false), '9:05am');
  assert.equal(RT.rowClock(t, true), '12:56');
  assert.deepEqual(RT.chipClock(t, false), { big: '12:56', unit: 'pm' });
  const A = await load('src/lib/askFormat.ts');
  assert.match(A.clock12(new Date(at('19:52:00')).toISOString()), /^7:52pm$/);
  for (const f of ['src/lib/askAnswerCore.ts', 'src/app/(tabs)/ask/index.tsx', 'src/lib/askFormat.ts']) assert.doesNotMatch(read(f), /\(_m, p\) => ' ' \+ p\.toLowerCase\(\)/, f);
  assert.doesNotMatch(read('src/lib/askBrain.ts'), /replace\(\/\(am\|pm\)\$\/, ' \$1'\)/);
});

test('no data provider name in error messages; the attributions keep it', async () => {
  const N = await load('src/lib/netErrCore.ts');
  const brand = /Transport for NSW|TfNSW/;
  assert.doesNotMatch(N.MSG.upstream, brand);
  assert.doesNotMatch(N.askFailText({ http: 502, server: true }), brand);
  // the server before tonight's deploy still names it: the phone says "live data"
  assert.equal(N.httpMessage(503, { kind: 'error', text: "Live data from Transport for NSW isn't available right now. Try again soon." }), "Live data isn't available right now. Try again soon.");
  assert.equal(N.plainErr("Live trips are unavailable right now because Transport for NSW isn't answering. Try again soon."), "Live trips are unavailable right now because live data isn't answering. Try again soon.");
  assert.equal(N.plainErr("Transport for NSW's live data isn't answering right now, so I can't check that. It's not your connection. Try again soon."), "Live data isn't answering right now, so I can't check that. It's not your connection. Try again soon.");
  assert.doesNotMatch(N.tripNote({ data: true, count: 0, offlineAt: null, staleAt: null, error: null, serverNote: "Live trips are unavailable right now because Transport for NSW isn't answering.", why: 'server' }), brand);
  assert.match(read('src/app/(tabs)/ask/index.tsx'), /if \(d\.kind === 'error'\) reply = plainErr\(reply\);/);
  assert.doesNotMatch(read('src/app/carpark.tsx'), /Transport for NSW sends no Park and Ride count/);
  // attributions untouched
  assert.match(read('src/app/(tabs)/settings/index.tsx'), /Data from Transport for NSW \(CC BY 4\.0\) and OpenStreetMap contributors\. Not made or endorsed by Transport for NSW\./);
});
