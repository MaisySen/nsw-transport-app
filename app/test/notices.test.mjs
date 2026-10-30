// Home with the commute card on top (25 Oct, 7 PM): the Notifications chips and the bar above the card.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-notices-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

const n = await load('src/lib/noticesCore.ts');

test('no alerts, trackwork, line problems or extra watches: no chips', () => {
  assert.deepEqual(n.noticeChips({}), []);
  assert.deepEqual(n.noticeChips({ lines: [{ line: 'T1', status: 'good', label: 'Good service', title: null, url: null, more: 0 }] }), []);
});

test('chips in order, most urgent first, each with its full text for VoiceOver', () => {
  const chips = n.noticeChips({
    high: [{ title: 'Departing platform 6. Platform changed', url: 'https://x/1' }, { title: 'Lift out at Central', url: null }],
    tripAlerts: ['Trackwork at Epping. Buses replace trains.', 'Lift 7 at Epping is not available', 'Trackwork at Epping. Buses replace trains.'],
    trackwork: [{ key: 'k1', name: 'Bondi Junction to Chatswood', text: 'Sat and Sun: Trains run to a changed timetable', extra: 'About 20 min longer', url: 'https://x/tw' }],
    lines: [{ line: 'T4', mode: 'train', color: '#005AA3', status: 'delays', label: 'Delays', title: 'Signal repairs at Epping', url: 'https://x/t4', more: 1 }],
    watches: [{ id: 'w1', title: 'Central to Parramatta', sub: 'Departs in 5 min' }],
  });
  assert.deepEqual(chips.map((c) => c.key), ['high', 'line:T4', 'alerts', 'trackwork', 'watching']);
  const [high, line, alerts, tw, watching] = chips;
  assert.equal(high.label, 'Departing platform 6');
  assert.equal(high.count, 2);
  assert.match(high.a11y, /Departing platform 6\. Platform changed\. Lift out at Central$/);
  assert.equal(high.items[1].trip, true, 'a high alert with no page opens the trip, like the old banner');
  assert.equal(line.label, 'Delays');
  assert.equal(line.line.line, 'T4');
  assert.match(line.a11y, /^T4: Delays\. Signal repairs at Epping\. 1 more$/);
  assert.equal(alerts.label, '2 trip alerts', 'the same alert on two trips counts once');
  assert.equal(alerts.a11y, '2 alerts on your trips: Trackwork at Epping. Buses replace trains. Lift 7 at Epping is not available');
  assert.equal(tw.label, 'Trackwork this weekend');
  assert.equal(tw.items[0].url, 'https://x/tw');
  assert.match(tw.a11y, /About 20 min longer$/);
  assert.equal(watching.label, 'Watching 1 trip');
  assert.equal(watching.items[0].watch, 'w1');
});

test('one alert reads in the singular', () => {
  const [c] = n.noticeChips({ tripAlerts: ['Lift 7 at Epping is not available.'] });
  assert.equal(c.label, '1 trip alert');
  assert.equal(c.a11y, '1 alert on your trips: Lift 7 at Epping is not available');
});

test('chip labels stay short: the first clause, cut at a word', () => {
  assert.equal(n.shortTitle('Departing platform 6'), 'Departing platform 6');
  assert.equal(n.shortTitle('T1 Western Line: Trains run to a changed timetable'), 'T1 Western Line');
  const long = n.shortTitle('Eastern Suburbs and Illawarra Line South Coast Line trackwork tonight');
  assert.ok(long.length <= 29, long);
  assert.ok(long.endsWith('\u2026'));
  assert.ok(!/ \u2026$/.test(long));
});

test('the live trip and its own watch show once, in the bar', () => {
  const w = [{ id: 'w1' }, { id: 'w2' }];
  assert.deepEqual(n.topBar({ watchId: 'w1' }, w), { live: true, watch: null, rest: [{ id: 'w2' }] });
  assert.deepEqual(n.topBar({ watchId: 'w1' }, [{ id: 'w1' }]), { live: true, watch: null, rest: [] });
  assert.deepEqual(n.topBar(null, [{ id: 'w2' }]), { live: false, watch: { id: 'w2' }, rest: [] }, 'one watch and no live trip: the watch is the bar');
  assert.deepEqual(n.topBar(null, w), { live: false, watch: null, rest: w }, 'two watches: a chip, not two bars');
  assert.deepEqual(n.topBar(null, []), { live: false, watch: null, rest: [] });
});

test('Home: the commute card comes before the chips, and nothing alert related sits above it', () => {
  const h = read('src/app/(tabs)/home/index.tsx');
  const body = h.slice(h.indexOf('<Screen '), h.indexOf('</Screen>'));
  const card = body.indexOf("title={nextIsCommute ? 'Your commute' : 'Next trip'}");
  assert.ok(card > 0);
  for (const old of ['<AlertBanner', '<AlertsLine', '<TrackworkCard', '<LineStatusStrip', 'title="Watching now"']) assert.ok(!body.includes(old), `${old} is gone from Home`);
  const chips = body.indexOf('<Notices ');
  assert.ok(chips > card, 'Notifications come after the commute card (VoiceOver reads the card first)');
  for (const below of ['{sugg ? (', '<CalendarLeaveByCard', '<LastHomeCard', 'title="Your trips"']) assert.ok(body.indexOf(below) > card, `${below} is below the card`);
  assert.ok(body.indexOf('<LiveBar') < card && body.indexOf('<WatchBar') < card, 'the slim bar is the only thing above the card');
  assert.match(h, /LeaveLine compact/);
  assert.match(h, /MorningLink compact/);
});

test('chips are buttons with the full text, collapsed until tapped', () => {
  const src = read('src/components/Notices.tsx');
  assert.match(src, /accessibilityRole="button" accessibilityLabel=\{n\.a11y\} accessibilityState=\{\{ expanded: on \}\}/);
  assert.match(src, /useState<string \| null>\(null\)/, 'nothing open at first');
  assert.match(src, /useTrackworkHeadsUp\(/, 'the Thursday trackwork heads up still runs from Home');
  assert.ok(!/setInterval|useNow\(1000\)/.test(src));
});
