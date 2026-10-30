// Compliance gate before build 210 (31 Oct 2026): pins what the App Store check fixed on build-210-rc.
// 1) Privacy manifests: the app (ios.privacyManifests) and both widget bundles declare their required reason APIs.
//    The Apple Watch app gets the app's manifest from prebuild; a file of its own is a duplicate build output
//    (EAS c0c8e3a3, see leaveby206.test), so it must not have one.
// 2) Times drawn by the widgets, Live Activities, Siri answers and the Watch follow the phone's 24-Hour Time setting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(app, p), 'utf8');

test('every native bundle that reads UserDefaults has a privacy manifest with a UserDefaults reason', () => {
  assert.ok(!existsSync(join(app, 'targets/watch/PrivacyInfo.xcprivacy')));
  for (const t of ['widget', 'watch-widget']) {
    const p = `targets/${t}/PrivacyInfo.xcprivacy`;
    assert.ok(existsSync(join(app, p)), `${p} missing`);
    const x = read(p);
    assert.match(x, /NSPrivacyAccessedAPICategoryUserDefaults/);
    assert.match(x, /CA92\.1/);
    assert.match(x, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  }
  const cfg = JSON.parse(read('app.json')).expo.ios.privacyManifests;
  assert.equal(cfg.NSPrivacyTracking, false);
  const kinds = cfg.NSPrivacyAccessedAPITypes.map((a) => a.NSPrivacyAccessedAPIType);
  for (const k of ['UserDefaults', 'FileTimestamp', 'SystemBootTime', 'DiskSpace']) assert.ok(kinds.includes(`NSPrivacyAccessedAPICategory${k}`), k);
});

test('native clocks follow the phone 24-Hour Time setting', () => {
  const fmt = read('targets/widget/Format.swift');
  assert.match(fmt, /static var phone24h: Bool/);
  assert.match(fmt, /phone24h \? "HH:mm" : "h:mm a"/);
  assert.match(fmt, /phone24h \? "HH:mm:ss" : "h:mm:ss a"/);
  assert.match(read('targets/widget/_shared/CommuteIntents.swift'), /h24 \? "HH:mm" : "h:mm a"/);
  for (const t of ['watch', 'watch-widget']) assert.match(read(`targets/${t}/WatchCore.swift`), /h24 \? "HH:mm" : "h:mma"/);
  // No other fixed 12 hour pattern left in the native targets.
  for (const f of ['targets/widget/Format.swift', 'targets/widget/_shared/CommuteIntents.swift', 'targets/watch/WatchCore.swift']) {
    const fixed = read(f).split('\n').filter((l) => /dateFormat = "h:mm/.test(l));
    assert.equal(fixed.length, 0, `${f}: ${fixed.join(' | ')}`);
  }
});

test('Info.plist answers App Review reads: when in use location only, no encryption, no tablet, write only calendar', () => {
  const e = JSON.parse(read('app.json')).expo;
  assert.equal(e.ios.config.usesNonExemptEncryption, false);
  assert.equal(e.ios.infoPlist.ITSAppUsesNonExemptEncryption, false);
  assert.equal(e.ios.supportsTablet, false);
  const loc = e.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-location')[1];
  assert.equal(loc.locationAlwaysAndWhenInUsePermission, false);
  assert.equal(loc.locationAlwaysPermission, false);
  assert.ok(loc.locationWhenInUsePermission.length > 40);
  const cal = e.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-calendar')[1];
  assert.equal(cal.writeOnlyAccess, true);
  assert.equal(cal.remindersPermission, false);
});
