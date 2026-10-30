// Plan's "Current location" in From and To (30 Oct; Bidur testing build 209: "From should have option to put current
// location as well"). Run: OFFLINE=1 TZ=Australia/Sydney node --test test/fromloc.test.mjs
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
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const tsc = (src) => ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;

// hereCore.ts imports ./goHomeCore; both go to one temp folder so the relative import resolves.
async function loadCore() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-fromloc-'));
  fs.writeFileSync(path.join(out, 'goHomeCore.mjs'), tsc(read('src/lib/goHomeCore.ts')));
  fs.writeFileSync(path.join(out, 'hereCore.mjs'), tsc(read('src/lib/hereCore.ts')).replace(/from '\.\/goHomeCore'/g, "from './goHomeCore.mjs'"));
  return import(pathToFileURL(path.join(out, 'hereCore.mjs')).href);
}

// hereLocation.ts with fake react-native, expo-modules-core and expo-location, so each build can be played.
async function loadLocation({ native, perm, ask, last, current, os: platform = 'ios' }) {
  const calls = { ask: 0, last: 0, current: [], required: 0 };
  globalThis.__fromloc = {
    Platform: { OS: platform },
    requireOptionalNativeModule: (name) => (name === 'ExpoLocation' && native ? {} : null),
    require: (name) => {
      calls.required++;
      if (name !== 'expo-location') throw new Error('unexpected ' + name);
      return {
        Accuracy: { Low: 2, Balanced: 3, High: 4 },
        getForegroundPermissionsAsync: async () => perm,
        requestForegroundPermissionsAsync: async () => { calls.ask++; return ask || perm; },
        getLastKnownPositionAsync: async () => { calls.last++; return last || null; },
        getCurrentPositionAsync: async (o) => { calls.current.push(o); return current || null; },
      };
    },
  };
  let js = tsc(read('src/lib/hereLocation.ts'));
  js = js.replace(/import \{ Platform \} from 'react-native';/, 'const { Platform } = globalThis.__fromloc;')
    .replace(/import \{ requireOptionalNativeModule \} from 'expo-modules-core';/, 'const { requireOptionalNativeModule } = globalThis.__fromloc;')
    .replace(/\brequire\('expo-location'\)/g, "globalThis.__fromloc.require('expo-location')");
  assert.ok(!/from 'expo-location'/.test(js), 'expo-location must not be imported at the top (feature detect)');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-fromloc-'));
  const file = path.join(out, `hereLocation-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(file, js);
  return { m: await import(pathToFileURL(file).href), calls };
}

const POS = { coords: { latitude: -33.79677, longitude: 151.18066 } }; // Chatswood, a fixture position

test('hidden when the build has no location module, and nothing is loaded or asked', async () => {
  const { m, calls } = await loadLocation({ native: false, perm: { granted: true } });
  assert.equal(m.hasLocation(), false);
  assert.equal(await m.hereOnce(true), null);
  assert.equal(calls.required, 0);
  const { showHereRow } = await loadCore();
  assert.equal(showHereRow({ available: false, mode: 'trip', field: 'from', text: '', chosen: false, otherIsHere: false }), false);
});

test('shown first in an empty From or To on a build with location, never on Departures or while typing', async () => {
  const { m } = await loadLocation({ native: true, perm: { granted: true } });
  assert.equal(m.hasLocation(), true);
  const { showHereRow } = await loadCore();
  const base = { available: true, mode: 'trip', field: 'from', text: '', chosen: false, otherIsHere: false };
  assert.equal(showHereRow(base), true);
  assert.equal(showHereRow({ ...base, field: 'to' }), true);
  assert.equal(showHereRow({ ...base, text: '  ' }), true);
  assert.equal(showHereRow({ ...base, text: 'chats' }), false);
  assert.equal(showHereRow({ ...base, chosen: true }), false);
  assert.equal(showHereRow({ ...base, mode: 'stop', field: 'stop' }), false);
  assert.equal(showHereRow({ ...base, field: 'to', otherIsHere: true }), false, 'both ends cannot be Current location');
});

test('denied permission: short note with a Settings link, nothing planned', async () => {
  const { m, calls } = await loadLocation({ native: true, perm: { granted: false, canAskAgain: true }, ask: { granted: false, canAskAgain: false } });
  const r = await m.hereOnce(true);
  assert.equal(calls.ask, 1, 'the system prompt shows on the tap');
  assert.deepEqual(r, { pos: null, denied: true, canAskAgain: false });
  assert.equal(calls.current.length, 0);
  const { hereStep } = await loadCore();
  const step = hereStep(r, Date.now());
  assert.equal(step.kind, 'note');
  assert.equal(step.settings, true);
  assert.match(step.note, /Settings/);
  assert.ok(step.note.length <= 100);
});

test('no prompt without a tap: a stale point is read again only when already allowed', async () => {
  const { m, calls } = await loadLocation({ native: true, perm: { granted: false, canAskAgain: true } });
  const r = await m.hereOnce(false);
  assert.equal(calls.ask, 0);
  assert.equal(r.denied, true);
});

test('granted: one Balanced fix and the planner point carries the coordinates', async () => {
  const { m, calls } = await loadLocation({ native: true, perm: { granted: true }, current: POS });
  const r = await m.hereOnce(true);
  assert.equal(calls.ask, 0, 'already allowed: no prompt');
  assert.equal(calls.last, 1);
  assert.deepEqual(calls.current, [{ accuracy: 3 }], 'one Balanced fix');
  const { hereStep, isHerePlace, HERE_LABEL } = await loadCore();
  const step = hereStep(r, 1000);
  assert.equal(step.kind, 'place');
  assert.deepEqual(step.place, { id: '151.18066:-33.79677:EPSG:4326', name: HERE_LABEL, at: 1000 });
  assert.equal(isHerePlace(step.place), true);
  assert.equal(isHerePlace({ id: '151.18066:-33.79677:EPSG:4326', name: 'Chatswood' }), false, 'a suburb point is not Current location');
  assert.equal(isHerePlace({ id: '206710', name: HERE_LABEL }), false);
});

test('a recent system fix is used without a new one', async () => {
  const { m, calls } = await loadLocation({ native: true, perm: { granted: true }, last: POS });
  const r = await m.hereOnce(true);
  assert.deepEqual(r.pos, { lat: -33.79677, lon: 151.18066 });
  assert.equal(calls.current.length, 0);
});

test('outside NSW and no fix: a note, no Settings link', async () => {
  const { hereStep } = await loadCore();
  const far = hereStep({ pos: { lat: -31.9523, lon: 115.8613 } }, 0);
  assert.equal(far.kind, 'note'); assert.equal(far.settings, false); assert.match(far.note, /NSW/);
  const none = hereStep({ pos: null }, 0);
  assert.equal(none.kind, 'note'); assert.equal(none.settings, false);
});

test('a Current location end older than 5 minutes is read again before the trip opens', async () => {
  const { hereStale } = await loadCore();
  assert.equal(hereStale({ at: 0 }, 5 * 60000), false);
  assert.equal(hereStale({ at: 0 }, 5 * 60000 + 1), true);
  assert.equal(hereStale({ id: '206710' }, 1e12), false, 'a stop never goes stale');
  assert.equal(hereStale(null, 1e12), false);
});

test('Plan sends the point as the trip end, with the label, and keeps it out of Recent', () => {
  const s = read('src/app/(tabs)/search/index.tsx');
  assert.match(s, /showHereRow\(/);
  assert.match(s, /hereOnce\(true\)/, 'the prompt is asked from the tap');
  assert.ok(!/useEffect\([^)]*hereOnce/.test(s), 'never asked on open');
  assert.match(s, /params: \{ from: a\.id, fromName: a\.name, to: b\.id, toName: b\.name/);
  assert.match(s, /Linking\.openSettings\(\)/);
  const trip = read('src/app/trip.tsx');
  assert.match(trip, /const here = isPointId\(from\.id\) \|\| isHerePlace\(to\)/, 'not a recent or saved trip at either end');
  const loc = read('src/lib/hereLocation.ts');
  assert.ok(!/watchPositionAsync|startLocationUpdatesAsync|requestBackgroundPermissionsAsync/.test(loc), 'one fix, foreground only');
});

test('the When In Use string still says trip planning (every build with the module has it)', () => {
  const app = JSON.parse(read('app.json')).expo;
  const plug = (app.plugins || []).find((p) => Array.isArray(p) && p[0] === 'expo-location');
  assert.ok(plug, 'expo-location plugin');
  assert.match(plug[1].locationWhenInUsePermission, /plan trips from where you are/);
  assert.equal(plug[1].locationAlwaysPermission, false);
});
