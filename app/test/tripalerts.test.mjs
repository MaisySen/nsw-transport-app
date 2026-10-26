// Saved trip alerts (lib/tripAlertsCore.ts, lib/tripAlerts.ts): what the phone sends the server about its trips, and
// that it sends it only when the switch is on and the trips change, with nothing polling.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-ta-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const core = await load('src/lib/tripAlertsCore.ts');
const tw = await load('src/lib/trackworkCore.ts');

// A Home card's services: a ferry, then a light rail leg; walks are left out.
const journeys = [
  { legs: [{ kind: 'transit', line: 'F4', mode: 'ferry', from: 'Wharf A', to: 'Wharf B', stopId: '20001', toStopId: '20002', fromParent: null, toParent: null },
    { kind: 'walk', line: '', mode: 'walk', from: 'Wharf B', to: 'Stop C' },
    { kind: 'transit', line: 'L1', mode: 'lightrail', from: 'Stop C', to: 'Stop D', stopId: '20031', toStopId: '20041', fromParent: '2003', toParent: '2004' }] },
  { legs: [{ kind: 'transit', line: 'F4', mode: 'ferry', from: 'Wharf A', to: 'Wharf B', stopId: '20001', toStopId: '20002' }] },
];

test('a Home card reports each service leg once, with station ids where it has them', () => {
  const tl = tw.tripLinesOf('a>d[]', 'a', 'd', 'Harbour trip', journeys, 10);
  assert.deepEqual(tl.legs, [{ l: 'F4', m: 'ferry', f: '20001', t: '20002' }, { l: 'L1', m: 'lightrail', f: '2003', t: '2004' }]);
  assert.deepEqual(tl.lines, ['F4', 'L1']);
});

test('times from trip reminders (1 Sunday) and morning checks (1 Monday) become 0 Sunday days', () => {
  assert.deepEqual(core.reminderTimes([{ hour: 7, minute: 45, days: [2, 3, 4, 5, 6] }]), [{ d: [1, 2, 3, 4, 5], m: 465 }]);
  assert.deepEqual(core.morningTimes([{ from: { id: 'a' }, to: { id: 'd' }, time: '17:10', days: [6, 7], active: true },
    { from: { id: 'a' }, to: { id: 'x' }, time: '08:00', days: [1] }, { from: { id: 'a' }, to: { id: 'd' }, time: '09:00', days: [1], active: false }], 'a', 'd'), [{ d: [0, 6], m: 1030 }]);
  assert.equal(core.remindersFor({ 'a>d': 1, 'a>e': 2 }, 'a>d[]'), 1);
  assert.equal(core.remindersFor({ 'a>d': 1 }, 'a>dx[]'), undefined);
});

test('the trips sent: each trip once, only with service legs, at most 8; the key changes only when they do', () => {
  const tl = tw.tripLinesOf('a>d[]', 'a', 'd', 'Harbour trip', journeys, 10);
  const bare = { key: 'b>c[]', f: 'b', t: 'c', lines: [], name: 'Walk', h: 9 };
  const trips = core.alertTrips([tl, tl, bare], () => [{ d: [1], m: 480 }]);
  assert.equal(trips.length, 1);
  assert.deepEqual(trips[0], { n: 'Harbour trip', f: 'a', t: 'd', legs: tl.legs, times: [{ d: [1], m: 480 }] });
  const k1 = core.alertTripsKey(trips);
  assert.equal(core.alertTripsKey(core.alertTrips([tl], () => [{ d: [1], m: 480 }])), k1);
  assert.notEqual(core.alertTripsKey(core.alertTrips([tl], () => [{ d: [1], m: 490 }])), k1);
  const many = Array.from({ length: 12 }, (_, i) => ({ ...tl, f: 'f' + i }));
  assert.equal(core.alertTrips(many, () => []).length, 8);
});

test('the phone side: no polling, a switch that asks first, and the sync only follows changes', () => {
  const src = fs.readFileSync(path.join(here, '..', 'src/lib/tripAlerts.ts'), 'utf8');
  assert.doesNotMatch(src, /setInterval|startAppPoll|useScreenPoll/);
  assert.match(src, /canNotify\(true\)/);
  assert.match(src, /SENT_KEY/);
  const settings = fs.readFileSync(path.join(here, '..', 'src/app/(tabs)/settings/index.tsx'), 'utf8');
  assert.match(settings, /flags\.tripAlerts === true/);
  assert.match(settings, /Alerts for my trips/);
  const layout = fs.readFileSync(path.join(here, '..', 'src/app/_layout.tsx'), 'utf8');
  assert.match(layout, /<TripAlertSync \/>/);
});
