// Build 206: "Add to Calendar" on a trip and the plain trip notification on an iPhone with a Live Activity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(import.meta.url);
const ts = require(path.join(root, 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-leaveby-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const { leaveByEvent, wantOngoing, sydClock, shortPlace } = await load('src/lib/leaveByCore.ts');

test('leaveByEvent fills the calendar sheet from the trip', () => {
  const j = {
    leave: '2026-10-24T22:05:00.000Z', arrive: '2026-10-24T22:31:00.000Z',
    legs: [{ kind: 'walk' }, { kind: 'transit', line: 'T1', mode: 'train', from: 'Strathfield Station', fromPlatform: 'Platform 2' }],
  };
  const ev = leaveByEvent(j, 'Kings Cross Station, Potts Point');
  assert.equal(ev.title, 'Leave for Kings Cross');
  assert.equal(ev.startDate.toISOString(), '2026-10-24T22:05:00.000Z');
  assert.equal(ev.endDate.toISOString(), '2026-10-24T22:31:00.000Z');
  assert.equal(ev.location, 'Strathfield Station');
  assert.equal(ev.notes, 'T1 from Strathfield, Platform 2. Arrive 9:31am. Live times can change, so check Transport before you go.');
  assert.deepEqual(ev.alarms, [{ relativeOffset: -10 }]);
  assert.ok(!/[\u2013\u2014]/.test(ev.notes));
});

test('leaveByEvent copes with missing parts', () => {
  assert.equal(leaveByEvent({ legs: [] }, 'Central'), null);
  const ev = leaveByEvent({ leave: 1792900000000, legs: [] }, '');
  assert.equal(ev.title, 'Leave for your trip');
  assert.equal(ev.endDate.getTime() - ev.startDate.getTime(), 30 * 60000);
  assert.equal(ev.location, undefined);
});

test('sydClock and shortPlace', () => {
  assert.equal(sydClock(Date.parse('2026-10-25T07:40:00.000Z')), '6:40pm');
  assert.equal(shortPlace('Town Hall Station, Sydney'), 'Town Hall');
});

test('no plain trip notification on an iPhone showing the Live Activity', () => {
  assert.equal(wantOngoing('ios', true, 1), false);
  assert.equal(wantOngoing('ios', true, 0), true);
  assert.equal(wantOngoing('ios', false, 1), true);
  assert.equal(wantOngoing('android', true, 1), true);
});

test('calendar and speech load only when the native module is there', () => {
  const src = fs.readFileSync(path.join(root, 'src/lib/nativeExtras.ts'), 'utf8');
  assert.match(src, /requireOptionalNativeModule\('ExpoCalendar'\)/);
  assert.match(src, /requireOptionalNativeModule\('ExpoSpeech'\)/);
  // No top level import of the packages: builds 201 to 205 would throw on start.
  assert.ok(!/^import .*expo-(calendar|speech)/m.test(src));
  for (const rel of ['src/app/trip.tsx', 'src/components/Smart.tsx', 'src/lib/liveEngine.ts', 'src/app/go.tsx']) {
    assert.ok(!/from 'expo-(calendar|speech)'/.test(fs.readFileSync(path.join(root, rel), 'utf8')), rel);
  }
});

test('calendar sheet comes from the legacy API and only add only access is ever asked', () => {
  const src = fs.readFileSync(path.join(root, 'src/lib/nativeExtras.ts'), 'utf8');
  // The root export of expo-calendar 58 throws for createEventInCalendarAsync.
  assert.match(src, /require\('expo-calendar\/legacy'\)/);
  assert.match(src, /ask\(true\)/);
  assert.ok(!/requestCalendarPermissionsAsync/.test(src));
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
  const cal = app.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-calendar')[1];
  assert.equal(cal.writeOnlyAccess, true);
  assert.ok(cal.writeOnlyCalendarPermission && cal.calendarPermission);
  assert.equal(cal.remindersPermission, false);
  assert.equal(app.ios.deploymentTarget, '17.0');
});

test('every Apple target carries a privacy manifest', () => {
  // The watch app gets the app's own manifest (ios.privacyManifests) from prebuild; a second file there is a
  // duplicate output and fails the build (EAS c0c8e3a3).
  assert.ok(!fs.existsSync(path.join(root, 'targets', 'watch', 'PrivacyInfo.xcprivacy')));
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
  assert.match(JSON.stringify(app.ios.privacyManifests), /NSPrivacyAccessedAPICategoryUserDefaults/);
  for (const t of ['widget', 'watch-widget']) {
    const p = fs.readFileSync(path.join(root, 'targets', t, 'PrivacyInfo.xcprivacy'), 'utf8');
    assert.match(p, /NSPrivacyAccessedAPICategoryUserDefaults/, t);
    assert.match(p, /CA92\.1/, t);
  }
});
