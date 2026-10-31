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
  const sim = read('app/native-tests/native-audit/watchsim.sh');
  assert.match(sim, /xcodebuild -showdestinations/);
  assert.match(sim, /supportedDeviceTypes/);
  assert.match(sim, /killall -9 com\.apple\.CoreSimulator\.CoreSimulatorService/);
  assert.match(sim, /wait_ready 900/);
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
  // Build 211 round 2: the title is one line in every layout (LiveTripTitle), so the layouts differ only in the detail
  // and warning lines: two, then one, then merged onto one, then merged without the arrival line.
  // Build 212 (G24): every layout's status is one line (the two line layouts are gone).
  assert.match(l, /card\(lines: 1, track: false\)\s*\/\/[^\n]*\n\s*card\(lines: 1, track: false, merged: true\)\s*\/\/[^\n]*\n\s*card\(lines: 1, track: false, merged: true, arriveLine: false\)/);
  assert.doesNotMatch(l, /card\(lines: 2/);
  // Build 211: the track layouts merge the stops and the delay onto one line, so the track fits under a one line countdown.
  assert.match(l, /card\(lines: 1, track: true, merged: true\)/);
  assert.doesNotMatch(l, /card\(lines: 2, track: true\)/);
  // Round 2: the stop alone shrinks to 0.7 on the Lock Screen and 0.65 in the Island before it is cut at its end.
  assert.match(l, /probe: "lock-stop", font: \.headline, minScale: 0\.7\)/);
  assert.match(l, /struct LiveTripIslandCenter[\s\S]{0,1200}?minScale: 0\.65\)/, "the island title shrinks before it is cut");
  // 31 Oct readiness audit: the countdown shrinks before it is cut ("in 18 mi..." at xxxLarge).
  assert.match(l, /\.minimumScaleFactor\(0\.5\)/);
  assert.match(t, /\.minimumScaleFactor\(0\.5\)/);
  assert.match(l, /\.frame\(maxWidth: 100, alignment: \.trailing\)/);
  const w = read('app/targets/watch/TransportWatchApp.swift');
  assert.match(w, /\.strikethrough\(service\.cancelled\)\s*\.lineLimit\(1\)/);
  assert.match(w, /Text\(p\)\.fontWeight\(\.medium\)\.lineLimit\(1\)\.minimumScaleFactor\(0\.8\)/);
  // 31 Oct readiness audit: the corner complication's countdown stays on one line and shrinks before it is cut.
  const c = read('app/targets/watch-widget/Complications.swift');
  assert.match(c, /private var corner[\s\S]*?Text\(t, style: \.timer\)[\s\S]{0,200}?\.lineLimit\(1\)\s*\.minimumScaleFactor\(0\.5\)/);
  const n = read('app/targets/widget/TransportWidgets.swift');
  assert.match(n, /Text\(Clock\.time\(t\.leave\)\)[\s\S]{0,200}\.fixedSize\(\)/);
});
