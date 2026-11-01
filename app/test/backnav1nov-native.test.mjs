// Back paths from outside the app, the native half (1 Nov 2026, Bidur on build 214: "Widget missing back button or app
// screen? Check"). Needs a new build; the JavaScript half (cold start anchor, Siri links) is backnav1nov.test.mjs and
// can go as an update on runtime 1.3.0.
// - The "Your trip" widget during a trip opened Home (nswtransport://, since build 204); it opens the live trip.
// - The Apple Watch reopened the trip screen on every return to the app (build 213), so Back did not stay.
// Run: TZ=Australia/Sydney OFFLINE=1 node --test test/backnav1nov-native.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('the "Your trip" widget during a trip opens the live trip, like the Lock Screen card and the Island', () => {
  const w = read('targets/widget/TransportWidgets.swift');
  const t = read('targets/widget/WidgetText.swift');
  assert.match(t, /static let liveTripURL = URL\(string: "nswtransport:\/\/go"\)/);
  assert.match(w, /var url: URL\? \{ live \? WidgetText\.liveTripURL :/);
  assert.match(w, /private func link\(_ t: TripLine\) -> URL\? \{\s*entry\.live \? WidgetText\.liveTripURL :/);
  assert.match(w, /private var alertsLink: URL\? \{\s*entry\.live \? WidgetText\.liveTripURL :/);
  // The trip entry has no stop ids, which is why tripURL gave nswtransport:// (Home).
  assert.match(t, /guard !from\.isEmpty, !to\.isEmpty else \{ return URL\(string: "nswtransport:\/\/"\) \}/);
  assert.equal((read('targets/widget/LiveTripActivityWidget.swift').match(/widgetURL\(URL\(string: "nswtransport:\/\/go"\)\)/g) || []).length, 3);
});

test('Apple Watch: the trip screen opens by itself once per trip; a complication tap opens it every time', () => {
  const s = read('targets/watch/TransportWatchApp.swift');
  assert.match(s, /if p == \.active \{ model\.openTripOnce\(\) \}/);
  assert.match(s, /\.onChange\(of: model\.live != nil\) \{ _, has in if has \{ model\.openTripOnce\(\) \} \}/);
  assert.match(s, /\.onOpenURL \{ _ in model\.openTrip\(\) \}/);
  assert.match(s, /static func shouldAutoOpen\(trip: String, lastOpened: String\?\) -> Bool \{ trip != lastOpened \}/);
  assert.match(s, /NavigationLink\(value: WatchRoute\.trip\)/, 'the trip is pushed on the list, so the watch shows its Back');
  assert.doesNotMatch(s, /navigationBarBackButtonHidden/);
  const t = read('native-tests/native-audit/Tests/Watch/WatchRefreshLogicTests.swift');
  assert.match(t, /func testTripScreenOpensByItselfOncePerTrip/);
});
