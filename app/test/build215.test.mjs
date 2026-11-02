// Build 215 readiness (2 Nov 2026): the one next native build. Native code changed since build 214 (TripOutbox, the
// locked screens' live card, the minimal Island, spoken alerts with the phone locked: background audio and location),
// so it gets its own runtime 1.4.0: an update published for 1.3.0 (builds 212 to 214, now b75a4e11) can never land on
// it and replace its newer JavaScript, and an update for 1.4.0 never reaches 214, whose native code lacks those calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(app, '..');
const a = JSON.parse(fs.readFileSync(path.join(app, 'app.json'), 'utf8')).expo;
const wf = fs.readFileSync(path.join(root, '.github/workflows/ios-209-local.yml'), 'utf8');

test('build 215 on its own runtime 1.4.0', () => {
  assert.equal(a.ios.buildNumber, '215');
  assert.equal(a.runtimeVersion, '1.4.0');
});

test('the build workflow takes build-215-rc and refuses runtime 1.3.0 (and older) for build 215 and later', () => {
  assert.match(wf, /github\.ref == 'refs\/heads\/build-215-rc'/);
  assert.match(wf, /"\$BN" -ge 215 \] && \{ \[ "\$RT" = "1\.3\.0" \] \|\| \[ "\$RT" = "1\.2\.0" \]; \}/);
  assert.match(wf, /needs: audit/);
  assert.doesNotMatch(wf, /eas(-cli@latest)? submit|appStoreVersionSubmissions|reviewSubmissions/);
});

test('background modes are exactly audio and location, with the When In Use purpose string and no Always', () => {
  const ip = a.ios.infoPlist;
  assert.deepEqual([...ip.UIBackgroundModes].sort(), ['audio', 'location']);
  const plugins = JSON.stringify(a.plugins);
  assert.doesNotMatch(plugins + JSON.stringify(ip), /NSLocationAlwaysAndWhenInUseUsageDescription|NSLocationAlwaysUsageDescription/);
  assert.match(plugins + JSON.stringify(ip), /NSLocationWhenInUseUsageDescription|locationWhenInUsePermission/);
});
