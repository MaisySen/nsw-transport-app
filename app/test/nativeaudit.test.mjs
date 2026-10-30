// Native audit (30 Oct 2026): every native build is checked on the simulator first, snapshot only.
// The audit workflow uses no secrets and never builds or uploads the app; the build workflow waits for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('audit workflow is snapshot only: no secrets, no app build, no upload', () => {
  const wf = read('.github/workflows/ios-native-audit.yml');
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /workflow_call:/);
  assert.doesNotMatch(wf, /secrets\./);
  assert.doesNotMatch(wf, /eas(-cli@[^ ]+)? build|altool|upload-app|archive|exportArchive/);
  assert.match(wf, /contents: read/);
  assert.match(wf, /NativeAuditTests/);
  assert.match(wf, /WatchAuditTests/);
});

test('the Watch job compiles the Watch code first and picks a simulator xcodebuild can use', () => {
  // 30 Oct: 4 of 8 runs failed on "watchOS Simulator (null)" (simctl listed the device, xcodebuild saw no runtime),
  // and the Watch code of d0056cd went uncompiled. Compile first, for any watchOS simulator; then the simulator.
  const wf = read('.github/workflows/ios-native-audit.yml');
  const watch = wf.slice(wf.indexOf('\n  watch:'));
  const compile = watch.indexOf("build-for-testing -project NativeAudit.xcodeproj -scheme WatchAuditTests");
  assert.ok(compile > 0, 'build-for-testing of the Watch scheme');
  assert.match(watch, /-destination 'generic\/platform=watchOS Simulator'/);
  assert.ok(compile < watch.indexOf('bash watchsim.sh'), 'compiles before it looks for a simulator');
  assert.match(watch, /killall -9 com\.apple\.CoreSimulator\.CoreSimulatorService/);
  const sim = read('app/native-tests/native-audit/watchsim.sh');
  assert.match(sim, /xcodebuild -showdestinations/);
  assert.match(sim, /supportedDeviceTypes/);
  assert.match(sim, /-downloadPlatform watchOS/);
  assert.doesNotMatch(sim, /secrets|altool|upload/);
});

test('the build workflow runs the audit first', () => {
  const wf = read('.github/workflows/ios-209-local.yml');
  assert.match(wf, /uses: \.\/\.github\/workflows\/ios-native-audit\.yml/);
  assert.match(wf, /build:\n\s+needs: audit/);
});

test('the audit renders the shipped views of every native surface', () => {
  const dir = 'app/native-tests/native-audit';
  for (const f of ['project.yml', 'sheets.py', 'sim.py', 'Tests/Shared/AuditKit.swift', 'Tests/iOS/WidgetAuditTests.swift',
    'Tests/iOS/LiveActivityAudit.swift', 'Tests/Watch/WatchAuditTests.swift', 'WatchHost/HostApp.swift']) {
    assert.ok(existsSync(join(root, dir, f)), f);
  }
  const proj = read(`${dir}/project.yml`);
  assert.match(proj, /\.\.\/\.\.\/targets\/widget/);
  assert.match(proj, /\.\.\/\.\.\/targets\/watch\b/);
  assert.match(proj, /targets\/watch-widget\/Complications\.swift/);
  const ios = read(`${dir}/Tests/iOS/WidgetAuditTests.swift`) + read(`${dir}/Tests/iOS/LiveActivityAudit.swift`);
  for (const v of ['NextTripView(', 'StopBoardView(', 'standByOverride: true', 'LockScreenCard(', 'LiveTripLockCard(',
    'IslandCompactTrailing(', 'IslandMinimal(', 'LiveTripCompactLeading(', 'LiveTripCompactTrailing(', 'LiveTripMinimal(',
    'LiveTripIslandBottom(', '.accessoryCircular', '.accessoryInline', '.accessoryRectangular', '.systemLarge']) {
    assert.ok(ios.includes(v), v);
  }
  const watch = read(`${dir}/Tests/Watch/WatchAuditTests.swift`);
  for (const v of ['ServiceRow(', 'StopRow(', 'LiveTripRow(', 'NextView(', '.accessoryCorner']) assert.ok(watch.includes(v), v);
  assert.match(read(`${dir}/Tests/Shared/AuditKit.swift`), /\.xxxLarge/);
});

test('the Dynamic Island draws the same views the audit checks', () => {
  const w = read('app/targets/widget/LiveTripActivityWidget.swift');
  for (const v of ['LiveTripIslandLeading(state: s)', 'LiveTripIslandTrailing(state: s, stale: stale)', 'LiveTripIslandCenter(state: s, stale: stale)',
    'LiveTripCompactLeading(state: s, stale: stale)', 'LiveTripCompactTrailing(state: s, stale: stale)', 'LiveTripMinimal(state: s, stale: stale)']) {
    assert.ok(w.includes(v), v);
  }
  const c = read('app/targets/watch-widget/Complications.swift');
  assert.match(c, /familyOverride \?\? hostFamily/);
  assert.match(c, /#if !SNAPSHOT_TESTS\n@main/);
  assert.match(read('app/targets/watch/TransportWatchApp.swift'), /#if !SNAPSHOT_TESTS\n@main/);
});

test('fixes the audit found stay in: compact island countdown, Lock Screen words, Watch rows', () => {
  const t = read('app/targets/widget/TripLiveActivity.swift');
  assert.match(t, /struct IslandCompactTrailing[\s\S]*?CompactCountdown\(date: state\.departs\)/);
  assert.match(t, /statusRow\(platform: true, detail: true\)[\s\S]*statusRow\(platform: false, detail: false\)/);
  assert.match(t, /\.frame\(maxWidth: 100, alignment: \.trailing\)/);
  const l = read('app/targets/widget/LiveTripActivityWidget.swift');
  // Build 210: the stop track layouts come first when the card carries stops; the bar layouts stay as the fallback.
  assert.match(l, /card\(lines: 2, track: false\)\s*card\(lines: 1, track: false\)/);
  assert.match(l, /card\(lines: 2, track: true\)\s*card\(lines: 2, track: true, merged: true\)\s*card\(lines: 1, track: true, merged: true\)/);
  assert.match(l, /\.frame\(maxWidth: 100, alignment: \.trailing\)/);
  const w = read('app/targets/watch/TransportWatchApp.swift');
  assert.match(w, /\.strikethrough\(service\.cancelled\)\s*\.lineLimit\(1\)/);
  assert.match(w, /Text\(p\)\.fontWeight\(\.medium\)\.lineLimit\(1\)\.minimumScaleFactor\(0\.8\)/);
  const n = read('app/targets/widget/TransportWidgets.swift');
  assert.match(n, /Text\(Clock\.time\(t\.leave\)\)[\s\S]{0,200}\.fixedSize\(\)/);
});
