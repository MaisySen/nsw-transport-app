// Build 210 (30 Oct): the medium trip widget on build 209 was cut off top and bottom ("This one widget looks cut
// off. Other two are fine", owner testing 209). Each trip widget family now picks the first layout that fits
// (ViewThatFits) instead of one fixed stack: medium drops the second row, then the "from to" line, then the
// footer; large drops rows; small drops the "from to" line, then a title line, then the status line; the Lock
// Screen rectangle drops its third line. The fit itself is checked on a Mac (app/native-tests/widget-snapshots,
// workflow ios-209-local.yml mode "snapshots") at every iPhone widget size and a larger text size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8');
const W = read('targets/widget/TransportWidgets.swift');
const C = read('targets/widget/Controls.swift');

function body(name) {
  const start = W.indexOf(name);
  assert.ok(start >= 0, `${name} missing`);
  const next = W.indexOf('\n    private ', start + name.length);
  return W.slice(start, next > 0 ? next : undefined);
}

test('medium, large, small and the Lock Screen rectangle each pick the first layout that fits', () => {
  for (const v of ['private var medium: some View', 'private var large: some View', 'private var small: some View', 'private var rectangular: some View']) {
    assert.match(body(v), /ViewThatFits\(in: \.vertical\)/, v);
  }
});

test('medium tries two rows first, then one row, and its last layout has no footer', () => {
  const m = body('private var medium: some View');
  const calls = [...m.matchAll(/mediumBody\(rows: (\d), subtitle: (true|false), footer: (true|false)\)/g)].map((x) => x.slice(1).join(','));
  assert.deepEqual(calls, ['2,true,true', '1,true,true', '1,false,true', '1,false,false']);
});

test('large keeps up to five rows (four with a notice) and falls back to fewer', () => {
  const l = body('private var large: some View');
  assert.match(l, /entry\.notice == nil \? 5 : 4/);
  assert.match(l, /largeBody\(rows: 1\)/);
});

test('no fixed heights in the trip widget views', () => {
  const start = W.indexOf('struct NextTripView');
  const end = W.indexOf('// MARK: Stop board widget');
  const views = W.slice(start, end);
  assert.doesNotMatch(views, /\.frame\([^)]*height: \d/);
});

test('the stop board widget is unchanged: no ViewThatFits there and its icon buttons keep 28 pt', () => {
  const board = W.slice(W.indexOf('// MARK: Stop board widget'));
  assert.doesNotMatch(board, /ViewThatFits/);
  assert.match(C, /var size: CGFloat = 28/);
});

test('the Mac fit check renders every family at the smallest and largest widget sizes and a larger text size', () => {
  const p = 'native-tests/widget-snapshots/Tests/WidgetFitSnapshotTests.swift';
  assert.ok(existsSync(join(here, '..', p)));
  const s = read(p);
  for (const f of ['.systemSmall', '.systemMedium', '.systemLarge', '.accessoryRectangular', '.xxxLarge', 'OVERFLOWS']) assert.ok(s.includes(f), f);
  for (const d of ['"se"', '"mini"', '"promax"']) assert.ok(s.includes(d), d);
  // owner-stations: guard (checks the names are absent from the native code)
  assert.doesNotMatch(s, /Strathfield|Burwood|Kings Cross|Redfern/);
});

test('build number 210 on version 1.0.0, runtime 1.1.0', () => {
  const a = JSON.parse(read('app.json')).expo;
  assert.equal(a.ios.buildNumber, '210');
  assert.equal(a.version, '1.0.0');
  assert.equal(a.runtimeVersion, '1.1.0');
});
