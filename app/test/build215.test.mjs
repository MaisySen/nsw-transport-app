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

// 2 Nov 2026, before dispatching build 215: the job-level `if` took build-215-rc, but the step "Runtime and build
// number" still had its own branch list without it, so the signed build would have stopped there with "unexpected
// branch refs/heads/build-215-rc" after the audit. Every branch the build job takes must pass that step's checks, run
// here through bash with the build number and runtime that branch builds.
test('the runtime and build number step lets every branch the build job takes through (build-215-rc with 215 / 1.4.0)', async () => {
  const { execFileSync } = await import('node:child_process');
  const job = wf.match(/^  build:\n[\s\S]*?^    if: (.*)$/m);
  assert.ok(job, 'build job if');
  const refs = [...job[1].matchAll(/refs\/heads\/([\w.-]+)/g)].map((m) => m[1]);
  assert.ok(refs.includes('build-215-rc'));
  const step = wf.match(/- name: Runtime and build number[^\n]*\n\s+run: \|\n([\s\S]*?)\n\n/);
  assert.ok(step, 'runtime step');
  const body = step[1].split('\n').filter((l) => !/^\s*(RT|BN)=|^\s*echo "runtime/.test(l)).join('\n');
  const run = (ref, bn, rt) => {
    try {
      execFileSync('bash', ['-c', body], { env: { ...process.env, GITHUB_REF: `refs/heads/${ref}`, BN: bn, RT: rt }, stdio: 'pipe' });
      return 0;
    } catch (e) { return e.status; }
  };
  assert.equal(run('build-215-rc', '215', '1.4.0'), 0, 'build-215-rc, 215, 1.4.0 must pass');
  assert.notEqual(run('build-215-rc', '215', '1.3.0'), 0, '215 on 1.3.0 must stop');
  assert.notEqual(run('some-other-branch', '215', '1.4.0'), 0, 'an unknown branch must stop');
});
