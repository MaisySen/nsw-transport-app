// Locked screens live (1 Nov 2026, build 215). The owner on build 214 at 7:09 PM: "App still doesnt pull live data on
// locked screens yet". On a locked iPhone the app's code does not run, so the card it saves for the widgets (liveCard)
// and sends to the Watch stops changing; up to build 214 the "Your trip" widget (home, Lock Screen, StandBy) and the
// Watch complications read only that saved card during a trip. Now they ask the server for the trip flow's card
// (GET /api/live-card, server-lockedlive) when the kept one is over a minute old: targets/widget/LiveCardFetch.swift,
// the same file in targets/watch-widget. This file compiles it with swiftc when it is on the machine (skipped
// otherwise) and checks the widget and the complication use it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '..');
const read = (rel) => (fs.existsSync(path.join(app, rel)) ? fs.readFileSync(path.join(app, rel), 'utf8') : '');
function which(cmd) {
  try { return execFileSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}
const swiftc = process.env.WIDGET_NATIVE_CHECK === '0' ? null : which('swiftc');

test('LiveCardFetch: asks only when the kept card is over a minute old, takes only newer cards, 3 min reloads in a trip', { skip: swiftc ? false : 'no swiftc on this machine', timeout: 300000 }, () => {
  assert.ok(read('targets/widget/LiveCardFetch.swift'), 'targets/widget/LiveCardFetch.swift');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-livecardfetch-'));
  const bin = path.join(out, 'lcf');
  execFileSync(swiftc, [path.join(app, 'targets/widget/LiveCardFetch.swift'), path.join(here, 'swift/livecardfetch/main.swift'), '-o', bin], { stdio: 'pipe', timeout: 280000 });
  const v = Object.fromEntries(execFileSync(bin, { encoding: 'utf8', timeout: 20000 }).trim().split('\n').map((l) => { const o = JSON.parse(l); return [o.k, o.v]; }));
  fs.rmSync(out, { recursive: true, force: true });
  assert.equal(v.neededNil, true);
  assert.equal(v.needed30, false, 'a card 30 s old is used as it is');
  assert.equal(v.needed90, true, 'a card 90 s old: ask the server');
  assert.equal(v.url, 'https://api.transportsydney.app/api/live-card?profile=u6b1m1i641h161z1j6p046532&line=T1&off=Strathfield');
  assert.equal(v.urlNone, 'nil', 'the widget before the app was opened asks nothing');
  assert.equal(v.urlShared, 'nil', 'an old shared profile asks nothing');
  assert.equal(v.parseUpdated, 1793519990000);
  assert.equal(v.parseCardPhase, 'ride');
  assert.equal(v.replacesNewer, true);
  assert.equal(v.replacesOlder, false, 'never an older card over the app\'s');
  assert.equal(v.replacesEnded, true, 'an ended trip ends the widget\'s trip');
  assert.equal(v.noneCard, true);
  assert.equal(v.replacesNone, false);
  assert.equal(v.badCard, true, 'a card missing what the widget needs is not taken');
  assert.equal(v.nextOk, 180);
  assert.equal(v.nextFail, 300);
  assert.equal(v.nextNearArrival, 100, 'not past the arrival');
  assert.equal(v.nextPastArrival, 60, 'at least a minute away');
});

test('the widget and the Watch complication use it during a trip, the same file in both targets', () => {
  const W = read('targets/widget/LiveCardFetch.swift');
  assert.ok(W, 'targets/widget/LiveCardFetch.swift');
  assert.equal(read('targets/watch-widget/LiveCardFetch.swift'), W, 'the two LiveCardFetch copies are the same file');
  assert.doesNotMatch(W, /import (UIKit|SwiftUI|WidgetKit)/, 'pure Foundation');
  const widgets = read('targets/widget/TransportWidgets.swift');
  const live = widgets.slice(widgets.indexOf('func timeline(for configuration: NextTripIntent'), widgets.indexOf('static func entries(from e: NextTripEntry)'));
  assert.match(live, /LiveCardFetch\.needed\(updatedMs: card\.updated/);
  assert.match(live, /LiveCardFetch\.load\(base: APIBase\.current\(\), profile: AppIdentity\.profile/);
  assert.match(live, /groupDefaults\.set\(data, forKey: "liveCard"\)/, 'kept for the other widgets');
  assert.match(live, /liveReload\(card, asked: asked\)/);
  assert.match(widgets, /if let ok = asked \{ return LiveCardFetch\.next\(now: now, arrival: arrive, ok: ok\) \}/);
  const comp = read('targets/watch-widget/Complications.swift');
  assert.match(comp, /LiveCardFetch\.needed\(updatedMs: l\.updated, now: now\)/);
  assert.match(comp, /LiveCardFetch\.load\(base: base, profile: p, line: l\.line, off: l\.getOffAt/);
  assert.match(comp, /JSONDecoder\(\)\.decode\(WLiveCard\.self, from: data\)/);
  assert.match(comp, /WatchStore\.save\(c\)/, 'kept for the watch app');
});
