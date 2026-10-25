// Ask, understanding and answers: the clear question sent for what was understood, clarifying choices that are
// never a dead end, chips from your own trips only, time words, typo matching, and the actions under a card.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-askbrain-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');
const B = await load('src/lib/askBrain.ts');
const A = await load('src/lib/askAnswerCore.ts');
const ST = path.join(here, '..', '..', 'backend', 'src', 'public', 'stations');
const list = (n) => JSON.parse(fs.readFileSync(path.join(ST, n + '.json'), 'utf8'));
const gaz = B.buildGaz({ train: list('train'), metro: list('metro'), lightrail: list('lightrail'), ferry: list('ferry'), places: list('places') });
const NOW = Date.parse('2026-10-25T20:30:00Z'); // Monday 7:30 am Sydney
const base = { now: NOW, gaz, places: {}, starred: [], recentTrips: [], usual: [], hasLocation: false };
const act = (q, ctx = base) => B.toAction(B.understand(q, ctx), ctx);

test('typos and short forms find the real station from the published lists', () => {
  const m = (q) => B.matchPlace(q, { gaz }).place;
  assert.equal(m('parramata').name, 'Parramatta Station');
  assert.equal(m('wolli ck').name, 'Wolli Creek Station');
  assert.equal(m('cq').name, 'Circular Quay');
  assert.equal(m('kings x').name, 'Kings Cross Station');
  assert.equal(m('katomba').name, 'Katoomba Station');
  assert.equal(m('woolongong').name, 'Wollongong Station');
  assert.equal(m('hornsb').name, 'Hornsby Station');
  assert.equal(m('bondi beach').name, 'Bondi Beach');
  // Not a known name: kept as typed for the server's own place search, never swapped for a guess.
  assert.equal(m('westmead hospital').name, 'Westmead Hospital Light Rail');
  assert.equal(m('rpa hospital').kind, 'raw');
  assert.equal(m('opera house').kind, 'raw');
  assert.deepEqual(B.matchPlace('the airport', { gaz }).options, ['International Airport', 'Domestic Airport']);
});

test('the question sent to the server is plain and complete', () => {
  assert.equal(act('strathfeild to kings x').q, 'Strathfield to Kings Cross');
  assert.equal(act('central to hornsby after 6').q, 'Central to Hornsby at 6:00pm');
  assert.equal(act('leave at 8 arrive by 9 at north sydney', { ...base, hasLocation: true }).q, 'to North Sydney arrive by 9:00am');
  assert.equal(act('cq to manly by ferry').q, 'Circular Quay to Manly Wharf by ferry');
  assert.equal(act('is the t1 running late').q, 'Is the T1 late');
  assert.equal(act('parking at ashfield').q, 'Parking at Ashfield');
  assert.equal(act('lift at redfern?').q, 'Lifts at Redfern');
  assert.equal(act('when is the next 333 from bondi beach').q, '333 at Bondi Beach');
  assert.equal(act('fare from penrith to central').q, 'Penrith to Central');
  assert.match(act('fare from penrith to central').heard, /^Fare, Penrith to Central/);
  assert.equal(act('any trackwork this weekend').q, 'trackwork');
  assert.equal(act('last train to penrith').kind, 'clarify');
  assert.equal(act('last train to penrith', { ...base, hasLocation: true }).q, 'Last train to Penrith');
  assert.equal(act('last train home', { ...base, places: { home: { id: '1', name: 'Penrith Station' }, work: { id: '2', name: 'Martin Place Station' } } }).q, 'Last train from Martin Place to home');
});

test('another day goes to the planner for that day, with the time asked', () => {
  const a = act('gosford to central tomorrow at 7am');
  assert.equal(a.kind, 'ask');
  assert.equal(a.q, 'Gosford to Central');
  assert.deepEqual({ date: a.refine.date, time: a.refine.time }, { date: '2026-10-27', time: '07:00' });
  assert.match(a.heard, /tomorrow, from 7:00 am/);
  const d = act('parramatta to central no changes');
  assert.equal(d.refine.direct, true);
});

test('home and work come from your saved places; missing ones say where to set them', () => {
  const ctx = { ...base, places: { home: { id: '275010', name: 'Penrith Station' }, work: { id: '200070', name: 'Martin Place Station' } } };
  assert.equal(act('home to work', ctx).q, 'Penrith to Martin Place');
  const none = act('home to work');
  assert.equal(none.kind, 'say');
  assert.match(none.text, /Settings/);
});

test('when unsure: one short question with 2 or 3 tappable choices, never a dead end', () => {
  for (const q of ['fastest way to the airport', 'how do i get to uni', 'blacktown to the city', 'how do i get to bondi beach', 'asdf qwerty', 'where can i park', 'and the one after?']) {
    const a = act(q, { ...base, recentTrips: [{ from: { id: '1', name: 'Penrith Station' }, to: { id: '2', name: 'Central Station' } }] });
    assert.equal(a.kind, 'clarify', q);
    assert.ok(a.text.length < 60, q);
    assert.ok(a.choices.length >= 1 && a.choices.length <= 3, `${q}: ${a.choices.length}`);
  }
  const air = act('fastest way to the airport');
  assert.deepEqual(air.choices.map((c) => c.label), ['International Airport', 'Domestic Airport']);
  const from = act('how do i get to bondi beach');
  assert.equal(from.choices[0].label, 'Use my location');
});

test('follow ups reuse the last answer and start from the times shown', () => {
  const u0 = B.understand('chatswood to hornsby', base);
  const last = B.nextLast(u0, { firstLeave: '2026-10-25T20:40:00Z', lastLeave: '2026-10-25T21:10:00Z' }, NOW);
  const ctx = { ...base, last };
  assert.equal(act('and the one after', ctx).q, 'Chatswood to Hornsby at 7:41am');
  const b0 = B.understand('next ferry from manly', base);
  const bl = { ...base, last: B.nextLast(b0, { firstLeave: '2026-10-25T20:40:00Z', lastLeave: '2026-10-25T21:10:00Z' }, NOW) };
  const ba = act('the one after that', bl);
  assert.equal(ba.refine.time, '07:41');
  assert.equal(ba.refine.board, true);
  assert.equal(act('earlier', ctx).q, 'Chatswood to Hornsby at 6:40am');
  assert.equal(act('what about by bus', ctx).q, 'Chatswood to Hornsby by bus');
  assert.equal(act('and from there to berowra', ctx).q, 'Hornsby to Berowra');
  assert.equal(act('the way back', ctx).q, 'Hornsby to Chatswood');
  assert.equal(B.lastFresh(last, NOW + 29 * 60000), true);
  assert.equal(B.lastFresh(last, NOW + 31 * 60000), false);
});

test('time words', () => {
  const w = (q) => B.parseWhen(q, NOW);
  assert.equal(w('after 6').time, '18:00');
  assert.equal(w('around 8:30').time, '08:30');
  assert.equal(w('in 20 min').time, '07:50');
  assert.deepEqual([w('tomorrow morning').time, w('tomorrow morning').date], ['06:00', '2026-10-27']);
  assert.equal(w('this weekend').date, '2026-10-31');
  assert.equal(w('by 9am').arriveBy, true);
  assert.equal(w('quarter to 9').time, '08:45');
  assert.equal(w('tonight').time, '18:00');
  assert.equal(B.sydMs('2026-10-27', '18:00'), Date.parse('2026-10-27T07:00:00Z'));
});

test('chips come from your own trips and places only', () => {
  assert.deepEqual(B.chipsFor(base, 8), []);
  const ctx = { ...base, places: { home: { id: '1', name: 'Penrith Station' }, work: { id: '2', name: 'Martin Place Station' } },
    recentTrips: [{ from: { id: '3', name: 'Gosford Station' }, to: { id: '4', name: 'Central Station' } }], starred: [{ id: '5', name: 'Manly Wharf' }] };
  assert.deepEqual(B.chipsFor(ctx, 8), ['Penrith to Martin Place', 'Gosford to Central', 'Departures Manly Wharf']);
  assert.equal(B.chipsFor(ctx, 18)[0], 'Martin Place to Penrith');
  assert.ok(B.chipsFor(ctx, 18).includes('Last train home'));
});

test('answers: no change filter, follow up times, actions, and every number copied from the data', () => {
  const leg = (line, planned) => ({ kind: 'transit', line, mode: 'train', from: 'Gosford Station', fromPlatform: 'Platform 1', planned });
  const card = { type: 'trip', from: { id: '1', name: 'Gosford Station' }, to: { id: '2', name: 'Central Station' }, link: { kind: 'trip' },
    journeys: [{ leave: '2026-10-26T20:00:00Z', arrive: '2026-10-26T21:20:00Z', changes: 1, legs: [leg('CCN', '2026-10-26T20:00:00Z')] },
      { leave: '2026-10-26T20:30:00Z', arrive: '2026-10-26T21:45:00Z', changes: 0, legs: [leg('CCN', '2026-10-26T20:30:00Z')] }] };
  assert.equal(A.directFirst(card.journeys).journeys.length, 1);
  assert.match(A.directFirst([card.journeys[0]]).note, /None of these go without a change/);
  const r = A.tripReply(card, 'tomorrow', NOW);
  assert.match(r, /Next: the CCN from Gosford, Plat 1 at 7:00 am, arriving Central 8:20 am with 1 change/);
  assert.deepEqual(A.shownTimes([card]), { firstLeave: '2026-10-26T20:00:00Z', lastLeave: '2026-10-26T20:30:00Z' });
  assert.deepEqual(A.actionsFor([card], 'ios').map((a) => a.label), ['Open trip', 'Speak']);
  const park = { type: 'parking', items: [{ name: 'Car park', lat: -33.8, lon: 151.1 }] };
  assert.match(A.actionsFor([park], 'ios')[0].url, /^https:\/\/maps\.apple\.com\/\?daddr=-33\.8,151\.1$/);
  assert.match(A.actionsFor([park], 'android')[0].url, /^https:\/\/www\.google\.com\/maps\/dir\//);
});

test('fast and light: pure, no timers, no network in the engine; a question reads in a few ms', () => {
  for (const f of ['src/lib/askBrain.ts', 'src/lib/askAnswerCore.ts']) {
    const src = read(f);
    assert.ok(!/setInterval|setTimeout|fetch\(|require\(|^import /m.test(src), f);
    assert.ok(!/[\u2013\u2014]/.test(src), `${f} has a dash`);
  }
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) B.understand(['strathfeild to kings x', 'next 333 from bondi beach', 'trains after 6pm tomorrow to parramatta', 'katomba'][i % 4], base);
  const per = (performance.now() - t0) / 200;
  assert.ok(per < 15, `${per.toFixed(1)} ms a question`);
  const screen = read('src/app/(tabs)/ask/index.tsx');
  assert.ok(!/setInterval|useNow\(1000\)|Accuracy\.High/.test(screen));
  assert.match(screen, /getForegroundPermissionsAsync/);
});
