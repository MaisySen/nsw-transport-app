// Platform view (src/lib/platformCore.ts): which service, its platform and carriages, the stops after this station
// with skipped stops taken out and unnamed stops named from the station list, and the spoken line.
// Fixtures: a T8 stop list read live from /api/service at Central on 25 Oct 2026 (its two airport stops came back
// with no name) and the matching rows of the published station list.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-platform-'));
const load = async (rel, name) => {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  fs.writeFileSync(path.join(out, name), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  return import(pathToFileURL(path.join(out, name)).href);
};
const P = await load('src/lib/platformCore.ts', 'p.mjs');
const LC = await load('src/lib/layoutCore.ts', 'l.mjs');
const M = await load('src/lib/menuCore.ts', 'm.mjs');
const FX = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'platform-central-t8.json'), 'utf8'));
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

const NOW = Date.parse('2026-10-25T11:50:00Z');
const at = (min) => new Date(NOW + min * 60000).toISOString();
const row = (o) => ({ mode: 'train', line: 'T1', dest: 'Penrith', platform: 'Platform 4', stopId: 'p4', planned: at(5), realtime: false, ...o });

test('the next train or metro, or the held one while it is still on the board; the two after it on any platform', () => {
  const items = [
    row({ tripId: 'a', planned: at(-5) }),
    row({ tripId: 'bus', mode: 'bus', planned: at(1) }),
    row({ tripId: 'b', planned: at(2), platform: 'Platform 16' }),
    row({ tripId: 'x', planned: at(3), cancelled: true }),
    row({ tripId: 'c', mode: 'metro', line: 'M1', planned: at(4), platform: 'Platform 26' }),
    row({ tripId: 'd', planned: at(7), realtime: true, estimated: at(9) }),
    row({ tripId: 'e', planned: at(8) }),
  ];
  const first = P.pickService(items, NOW);
  assert.equal(first.main.tripId, 'b');
  assert.deepEqual(first.next.map((d) => d.tripId), ['c', 'e'], 'sorted by the time shown: e at 8 comes before d live at 9');
  const held = P.pickService(items, NOW, { trip: 'c', planned: at(4) });
  assert.equal(held.main.tripId, 'c'); assert.equal(held.picked, true);
  assert.deepEqual(held.next.map((d) => d.tripId), ['e', 'd']);
  const gone = P.pickService(items, NOW, { trip: 'a' });
  assert.equal(gone.main.tripId, 'b', 'a held service that has left falls back to the next one');
  assert.equal(gone.picked, false);
  assert.deepEqual(P.pickService([row({ mode: 'bus' })], NOW), { main: null, next: [], picked: false });
  assert.deepEqual(P.pickService(null, NOW), { main: null, next: [], picked: false });
  assert.equal(P.pickService([row({ tripId: 'z', departed: true })], NOW).main, null);
});

test('platform number from the data, or none', () => {
  assert.equal(P.platformNo('Platform 23'), '23');
  assert.equal(P.platformNo('Platform 1A'), '1A');
  assert.equal(P.platformNo(' platform  6 '), '6');
  assert.equal(P.platformNo(''), null);
  assert.equal(P.platformNo(null), null);
  assert.equal(P.platformSentence({ platform: null, when: 'departs in 3 minutes' }), 'Platform not given yet, departs in 3 minutes');
});

test('cars only when live data reports a sensible count', () => {
  assert.equal(P.carsOf({ vehicle: { cars: 8 } }), 8);
  assert.equal(P.carsOf({ vehicle: { cars: 6 } }), 6);
  assert.equal(P.carsOf({ vehicle: { cars: 0 } }), null);
  assert.equal(P.carsOf({ vehicle: { cars: 4.5 } }), null);
  assert.equal(P.carsOf({ vehicle: { cars: 40 } }), null);
  assert.equal(P.carsOf({ vehicle: null }), null);
  assert.equal(P.carsOf({}), null);
  assert.equal(P.carsOf(null), null);
});

test('Limited Stops or All stops only when the service says so', () => {
  assert.equal(P.stoppingTag({ description: 'City to Macarthur via Airport or Sydenham' }), null, 'a route name is not a stopping pattern');
  assert.equal(P.stoppingTag({ description: 'Limited stops to Hornsby' }), 'Limited Stops');
  assert.equal(P.stoppingTag({ description: 'All stations to Emu Plains' }), 'All stops');
  assert.equal(P.stoppingTag({}), null);
});

test('stops after this station: skipped stops out, the unnamed airport stops named from the station list', () => {
  const stops = FX.stops;
  assert.equal(stops[3].name, ', Platform 2', 'the live list really sends no name for Domestic Airport');
  const withList = P.stopsAfter(stops, { mineIndex: 0 }, FX.stations);
  assert.deepEqual(withList.names.slice(0, 5), ['Green Square', 'Mascot', 'Domestic Airport', 'International Airport', 'Wolli Creek']);
  assert.equal(withList.names[withList.names.length - 1], 'Macarthur');
  assert.equal(withList.names.length, stops.length - 1);
  assert.equal(withList.unnamed, 0);
  // Without the station list the two airport stops are counted, not shown as blank names.
  const bare = P.stopsAfter(stops, { mineIndex: 0 }, null);
  assert.equal(bare.unnamed, 2);
  assert.ok(!bare.names.includes(''));
  assert.ok(!bare.names.some((n) => n.startsWith(',')));
  // Skipped stops come out.
  const skipped = stops.map((s, i) => (i === 2 ? { ...s, skipped: true } : s));
  const sk = P.stopsAfter(skipped, { mineIndex: 0 }, FX.stations);
  assert.ok(!sk.names.includes('Mascot'));
  assert.deepEqual(sk.skipped, ['Mascot'], 'a passed stop is said, not hidden');
  assert.equal(P.platformSentence({ platform: 'Platform 1', when: 'departs now', stops: { names: ['Lidcombe'], unnamed: 0, skipped: ['Redfern', 'Central'] } }),
    'Platform 1, departs now, stops at Lidcombe, not stopping at Redfern and Central');
  assert.equal(withList.skipped, undefined);
});

test('where this station sits: the index, else the stop id, else the station name; a list without it is null', () => {
  const stops = FX.stops;
  assert.equal(P.stationIndex(stops, { mineIndex: 2 }), 2);
  assert.equal(P.stationIndex(stops.map((s) => ({ ...s, mine: false })), { mineIndex: null, stopId: stops[5].id }), 5);
  assert.equal(P.stationIndex(stops.map((s) => ({ ...s, mine: false })), { mineIndex: -1, station: 'Wolli Creek Station' }), 5);
  assert.equal(P.stationIndex(stops.map((s) => ({ ...s, mine: false })), { mineIndex: 99, stopId: 'nope', station: 'Hornsby Station' }), -1);
  assert.equal(P.stopsAfter(stops.map((s) => ({ ...s, mine: false })), { stopId: 'nope', station: 'Hornsby Station' }, FX.stations), null);
  assert.equal(P.stopsAfter(null, { mineIndex: 0 }), null);
  assert.deepEqual(P.stopsAfter([{ id: '1', name: 'Gosford Station, Platform 1', mine: true }], {}, null), { names: [], unnamed: 0 }, 'the last stop');
});

test('the nearest station within a few hundred metres, else none', () => {
  assert.equal(P.nearestStation(-33.933686, 151.180857, FX.stations)[1], 'Domestic Airport Station');
  assert.equal(P.nearestStation(-33.934982, 151.165787, FX.stations)[1], 'International Airport Station');
  assert.equal(P.nearestStation(-33.80, 151.0, FX.stations), null, 'far from every station in the list');
  assert.equal(P.nearestStation(null, 151, FX.stations), null);
  assert.equal(P.plainStop('Hornsby Station, Platform 3'), 'Hornsby');
  assert.equal(P.plainStop(', Platform 2'), '');
  assert.equal(P.plainStop('Gosford Station'), 'Gosford');
});

test('the screen reader line and Speak words', () => {
  const s = { names: ['Green Square', 'Mascot', 'Domestic Airport'], unnamed: 0 };
  assert.equal(P.platformSentence({ platform: 'Platform 23', cars: 8, when: 'departs in 4 minutes', stops: s }),
    'Platform 23, 8 cars, departs in 4 minutes, stops at Green Square, Mascot and Domestic Airport');
  assert.equal(P.platformSentence({ platform: 'Platform 5', cars: null, when: 'not tracking, timetable 10:56pm', stops: null }), 'Platform 5, not tracking, timetable 10:56pm');
  assert.equal(P.speakSentence({ line: 'T8', dest: 'Macarthur via Airport, Sydney', platform: 'Platform 23', cars: 8, when: 'departs now', stops: s }),
    'T8 to Macarthur via Airport. Platform 23, 8 cars, departs now, stops at Green Square, Mascot and Domestic Airport.');
  assert.equal(P.whenWords({ kind: 'live', big: '4', unit: 'min', counting: true }), 'departs in 4 minutes');
  assert.equal(P.whenWords({ kind: 'live', big: '1', unit: 'min', counting: true }), 'departs in 1 minute');
  assert.equal(P.whenWords({ kind: 'timetable', big: 'Now', unit: '', counting: true }), 'departs now');
  assert.equal(P.whenWords({ kind: 'live', big: '1h 5', unit: 'min', counting: true }), 'departs in 1 hour 5 minutes');
  assert.equal(P.whenWords({ kind: 'stale', big: '10:56pm', unit: '', counting: false }), 'not tracking, timetable 10:56pm');
  assert.equal(P.whenWords({ kind: 'cancelled', big: '3', unit: 'min', counting: true }), 'cancelled');
  assert.equal(P.whenWords(null), '');
  assert.equal(P.viaAirport('Macarthur via Airport'), true);
  assert.equal(P.viaAirport('Penrith', ['Blacktown']), false);
});

test('two columns by window width alone; the stop list drops to one column at very large text', () => {
  assert.equal(P.platformLayout(390).wide, false);
  assert.equal(P.platformLayout(1000).wide, true);
  assert.equal(P.platformLayout(700).wide, false);
  assert.equal(P.platformLayout(390, 1).stopCols, 2);
  assert.equal(P.platformLayout(390, 2).stopCols, 1);
  assert.ok(P.platformLayout(390, 2).big > P.platformLayout(390, 1).big, 'grows with Dynamic Type');
  assert.ok(P.platformLayout(390, 3).big <= 112, 'within reason');
  const s = P.stopsShown(['a', 'b', 'c', 'd', 'e', 'f'], 4);
  assert.deepEqual(s, { shown: ['a', 'b', 'c', 'f'], more: 2 });
  assert.deepEqual(P.stopsShown(['a', 'b'], 4), { shown: ['a', 'b'], more: 0 });
});

test('portrait lock only on a phone sized window', () => {
  assert.equal(LC.orientationFor(390, 844), 'portrait_up');
  assert.equal(LC.orientationFor(844, 390), 'portrait_up', 'a phone on its side is still phone sized');
  assert.equal(LC.orientationFor(1000, 760), 'all');
  assert.equal(LC.orientationFor(760, 1000), 'all');
  assert.equal(LC.orientationFor(0, 0), 'portrait_up');
  const layout = read('src/app/_layout.tsx');
  assert.match(layout, /orientation = orientationFor\(width, height\)/);
  assert.doesNotMatch(layout, /orientation: 'portrait_up' \}/, 'no fixed lock on every screen');
});

test('hold menu: Platform view only when the row passes it, after Show stops', () => {
  const noop = () => {};
  let p = 0;
  const m = M.departureMenu({ line: 'T1', dest: 'Emu Plains' }, false, { watch: noop, open: noop, platform: () => { p++; } });
  assert.deepEqual(m.items.map((i) => [i.text, i.sf, i.icon]), [['Watch', 'bell', 'bell'], ['Show stops', 'list.bullet', 'list'], ['Platform view', 'train.side.front.car', 'platform']]);
  m.items[2].onPress(); assert.equal(p, 1);
  assert.deepEqual(M.departureMenu({ line: '410', dest: 'Rockdale' }, false, { watch: noop, open: noop, platform: null }).items.map((i) => i.text), ['Watch', 'Show stops']);
  assert.match(read('src/components/Icon.tsx'), /\n  platform: \{/);
  const transit = read('src/components/Transit.tsx');
  assert.match(transit, /PLATFORM_VIEW && \(d\.mode === 'train' \|\| d\.mode === 'metro'\) \? \(\) => openPlatform/);
});

test('entry points: the station header button only at a station with trains or metro and only while the switch is on; tapping a row is unchanged', () => {
  const stop = read('src/app/stop/[id].tsx');
  assert.match(stop, /const railHere = modes\.includes\('train'\) \|\| modes\.includes\('metro'\)/);
  assert.match(stop, /\{PLATFORM_VIEW && railHere \? \(/);
  assert.match(stop, /onPress=\{\(\) => openService\(d\)\}/);
  const screen = read('src/app/platform.tsx');
  assert.doesNotMatch(screen, /setInterval|useNow\(1000\)|Accuracy\.High/);
  assert.doesNotMatch(screen, /Strathfield|Central|Parramatta/, 'no station written into the screen');
  assert.match(screen, /useWindowDimensions/);
});

test('side safe areas: tab bar content and Simple mode', () => {
  assert.match(read('src/components/TabBarSafe.tsx'), /edges=\{\{ bottom: true, left: true, right: true \}\}/);
  const simple = read('src/app/simple.tsx');
  assert.equal((simple.match(/paddingLeft: side\.left, paddingRight: side\.right/g) || []).length, 3);
  assert.match(simple, />Plan Your Trip</);
});

test('station board: destination split at "via", and what the stop list says when it has no names', () => {
  assert.deepEqual(P.splitVia('Newcastle Interchange via Epping'), { name: 'Newcastle Interchange', via: 'Epping' });
  assert.deepEqual(P.splitVia('Macarthur via Airport'), { name: 'Macarthur', via: 'Airport' });
  assert.deepEqual(P.splitVia('Penrith Station, Penrith'), { name: 'Penrith', via: '' });
  assert.deepEqual(P.splitVia('Bondi Junction'), { name: 'Bondi Junction', via: '' });
  assert.deepEqual(P.splitVia(null), { name: '', via: '' });
  assert.equal(P.stopsNote({ names: ['Redfern'], unnamed: 0 }, {}), null);
  assert.equal(P.stopsNote(null, { loading: true }), 'Loading stops');
  // The server was busy, the list did not include this station, or an older server sent an empty list.
  assert.equal(P.stopsNote(null, { status: 'busy' }), 'Full stop list not available yet');
  assert.equal(P.stopsNote(null, {}), 'Full stop list not available yet');
  assert.equal(P.stopsNote(null, { status: 'cancelled' }), 'This service is cancelled');
  assert.equal(P.stopsNote({ names: [], unnamed: 2 }, {}), 'Stop names not given for this service');
  assert.equal(P.stopsNote({ names: [], unnamed: 0 }, {}), 'This station is the last stop');
  // Every stop after this station is skipped: not "last stop", the list is not one to trust yet.
  assert.equal(P.stopsNote({ names: [], unnamed: 0, skipped: ['Far End'] }, {}), 'Full stop list not available yet');
});

test('station board screen: orange bar, its own scrolling stop list, the fixed parts, two columns from 720 pt', () => {
  const screen = read('src/app/platform.tsx');
  assert.match(screen, /`Next \$\{kindWord\}`/);
  assert.match(screen, /Time now/);
  assert.match(screen, /Next service/);
  assert.match(screen, /Departs/);
  assert.match(screen, /stopsNote\(/);
  assert.match(screen, /stopsStatus/);
  assert.match(screen, /<ScrollView[^>]*accessibilityLabel=\{stopsLabel\}/);
  assert.match(screen, /hasSpeech\(\)/);
  assert.match(screen, /takeVoicePrompt/);
  assert.match(screen, /useReduceMotion/);
  assert.match(screen, /maxFontSizeMultiplier/);
  assert.equal(P.WIDE_MIN, 720);
  assert.doesNotMatch(screen, /[\u2013\u2014]/);
});


// Owner's phone, Sun 25 Oct 11:59pm and 12:00am: a train showing "Not tracking, 11:54pm" stayed as the next train,
// next service rows showed gone trains, and a stop list from the train shown a moment before appeared under the next.
const LL = await load('src/lib/liveLabelCore.ts', 'll.mjs');
const st = (d, now) => LL.liveState({ planned: d.planned, estimated: d.estimated, realtime: d.realtime, cancelled: d.cancelled, seenAt: d.seenAt, vehicleAgeS: d.vehicle?.ageS }, now);

test('gone services never show: an untracked row past its timetable minute, a stale live row past its timetable time', () => {
  const items = [
    // Not tracking: live time 9 min ahead, but its position is too old, so the board shows the timetable 11:54.
    row({ tripId: 'stale', planned: at(-5), realtime: true, estimated: at(9), vehicle: { ageS: 400 } }),
    row({ tripId: 'gone', planned: at(-4) }),
    row({ tripId: 'soon', planned: at(1), realtime: true, estimated: at(1) }),
    row({ tripId: 'later', planned: at(36) }),
    row({ tripId: 'last', planned: at(40) }),
  ];
  const r = P.pickService(items, NOW, null, st);
  assert.equal(r.main.tripId, 'soon');
  assert.deepEqual(r.next.map((d) => d.tripId), ['later', 'last'], 'next service rows use the same rule');
  // The same row while it is still tracking (fresh position) is a live train 9 minutes away: it stays.
  const live = row({ tripId: 'late', planned: at(-5), realtime: true, estimated: at(9), vehicle: { ageS: 20 } });
  assert.equal(P.stillToCome(live, NOW, st), true);
  assert.equal(P.pickService([live, items[3]], NOW, null, st).main.tripId, 'late');
});

test('a live delayed train counts until a minute after its live time; untracked until its timetable minute ends', () => {
  const delayed = row({ planned: at(-10), realtime: true, estimated: at(0), vehicle: { ageS: 10 } });
  assert.equal(P.stillToCome(delayed, NOW, st), true, 'delayed 10 min, due now');
  assert.equal(P.stillToCome(delayed, NOW + 60000, st), true, 'a minute after its live time it may still be at the platform');
  assert.equal(P.stillToCome(delayed, NOW + 60001, st), false);
  const untracked = row({ planned: at(0) });
  assert.equal(P.stillToCome(untracked, NOW, st), true, 'due this minute');
  assert.equal(P.stillToCome(untracked, NOW + 59999, st), true, 'still its own minute');
  assert.equal(P.stillToCome(untracked, NOW + 60000, st), false, 'the next minute it has gone');
  assert.equal(P.stillToCome(row({ planned: at(5), cancelled: true }), NOW, st), false);
  assert.equal(P.stillToCome(row({ planned: at(5), departed: true }), NOW, st), false);
  // Without the live label (older callers), a live estimate counts as live.
  assert.equal(P.stillToCome(row({ planned: at(-5), realtime: true, estimated: at(2) }), NOW), true);
  assert.equal(P.stillToCome(row({ planned: at(-2) }), NOW), false);
});

test('rows sort by the time they show: a not tracking row by its timetable time', () => {
  const a = row({ tripId: 'a', planned: at(3), realtime: true, estimated: at(12), vehicle: { ageS: 400 } });
  const b = row({ tripId: 'b', planned: at(6) });
  assert.deepEqual(P.railRows([b, a], NOW, st).map((d) => d.tripId), ['a', 'b']);
});

test('two different trips at the same stop never share a stop list', () => {
  const t9 = row({ tripId: 'Y9BB', line: 'T9', dest: 'Central', stopId: '213510', planned: at(-5) });
  const ccn = row({ tripId: 'N486', line: 'CCN', dest: 'Newcastle Interchange via Epping', stopId: '213510', planned: at(1) });
  assert.notEqual(P.serviceKey(t9), P.serviceKey(ccn));
  const t9Answer = { key: P.serviceKey(t9), resp: { tripId: 'Y9BB', line: 'T9', stops: [] } };
  assert.equal(P.serviceFits(t9Answer, t9), true);
  assert.equal(P.serviceFits(t9Answer, ccn), false, 'the answer for the train shown before is not shown under the next one');
  // Asked for this row, but the answer names another trip or line: not shown either.
  assert.equal(P.serviceFits({ key: P.serviceKey(ccn), resp: { tripId: 'Y9BB', line: 'CCN' } }, ccn), false);
  assert.equal(P.serviceFits({ key: P.serviceKey(ccn), resp: { tripId: 'N486', line: 'T9' } }, ccn), false);
  assert.equal(P.serviceFits({ key: P.serviceKey(ccn), resp: { tripId: 'N486', line: 'CCN' } }, ccn), true);
  assert.equal(P.serviceFits(null, ccn), false);
  assert.equal(P.serviceFits({ key: P.serviceKey(ccn), resp: null }, ccn), false);
  // Same trip id at another station, or another day's run: a different service.
  assert.notEqual(P.serviceKey(ccn), P.serviceKey({ ...ccn, stopId: '2135231' }));
  assert.notEqual(P.serviceKey(ccn), P.serviceKey({ ...ccn, planned: at(1441) }));
});

test('a stop list that does not include this station is not shown', () => {
  const list = [{ id: 'h', name: 'Hornsby Station, Platform 3' }, { id: 'e', name: 'Epping Station, Platform 1' }];
  assert.equal(P.stopsAfter(list, { mineIndex: -1, stopId: '213510', station: 'Strathfield Station' }), null);
  assert.equal(P.stopsNote(null, { status: 'ok' }), 'Full stop list not available yet');
});

test('clock times fit on one line: 11:54pm in the phone column at default and large text', () => {
  for (const scale of [1, 1.2, 1.4]) {
    for (const [txt, max, w] of [['11:54pm', 44 * 0.62, 126], ['Not tracking', 19, 126], ['11:55pm', 21, 90], ['12:00am', 21, 90], ['1h 20 min', 44, 126]]) {
      const f = P.fitSize(txt, max, w, scale);
      assert.ok(f <= max && f >= 8, `${txt} ${f}`);
      assert.ok(P.textEm(txt) * f * scale <= w + 0.01, `${txt} fits at ${scale}`);
    }
  }
  assert.equal(P.fitSize('5', 44, 126), 44, 'a short value keeps its full size');
  assert.ok(P.fitSize('11:54pm', 30, 90, 1.2) < 30);
});

test('Platform view: departs sits right under the platform and cars, and times never wrap mid word', () => {
  const src = read('src/app/platform.tsx');
  assert.ok(!/justifyContent: 'space-between', alignItems: 'flex-end'/.test(src), 'the right column does not spread Departs to the bottom');
  assert.ok(/justifyContent: 'flex-start', alignItems: 'flex-end'/.test(src));
  assert.ok(!/fixed \? \{ flex: 1 \}/.test(src), 'the board is as tall as its content, so a short stop list leaves no gap');
  assert.ok(/pickService<Departure>\(data\?\.items, now, pick, depState\)/.test(src), 'the board uses the shared live label to drop gone rows');
  assert.ok(/serviceFits\(data as any, d\)/.test(src), 'a stop list shows only under the service it was asked for');
  assert.ok(/await platformService\(\{/.test(src), 'the stop list comes from the same server as the board, the one that retries a busy planner');
  assert.ok(/export async function platformService/.test(read('src/lib/api.ts')));
  const timeTexts = src.match(/<Text[^>]*fontVariant: \['tabular-nums'\][^>]*>/g) || [];
  for (const t of timeTexts) if (!/Time now/.test(t) && !/fontSize: L\.wide \? 21 : 19/.test(t)) assert.ok(/numberOfLines=\{1\}/.test(t), t.slice(0, 120));
});
