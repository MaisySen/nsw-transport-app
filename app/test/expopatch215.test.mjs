// Expo SDK 58 patch versions for build 215 (2 Nov; known issues B6 "build tool security advisories, take the SDK 58
// patches in a native build"). Every Expo package is on the version the installed SDK lists (expo install --check
// clean), no package in the lock is in a range with a high advisory, the runtime stays 1.4.0 (build 215 is the first
// binary on it), and expo-router 58.0.26's breaking change (a layout without unstable_settings.anchor no longer takes
// the route named like its group as the anchor) cannot change Back in this app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(app, 'package-lock.json'), 'utf8'));
const deps = pkg.dependencies;
const num = (v) => String(v).replace(/^[~^]/, '').split('.').map((x) => parseInt(x, 10));
const ge = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return true; };

test('the SDK 58 patch versions are taken (expo 58.0.22, React Native 0.88.1, expo-router 58.0.29)', () => {
  assert.ok(ge(deps.expo, '58.0.22') && num(deps.expo)[0] === 58, deps.expo);
  assert.equal(deps['react-native'], '0.88.1');
  assert.ok(ge(deps['expo-router'], '58.0.29'), deps['expo-router']);
  assert.ok(ge(deps['expo-updates'], '58.0.20'), deps['expo-updates']);
  assert.ok(ge(deps['react-native-screens'], '4.30.1'), deps['react-native-screens']);
});

test('every package the SDK pins is on the version it lists (what expo install --check reads)', () => {
  const bundled = JSON.parse(fs.readFileSync(path.join(app, 'node_modules', 'expo', 'bundledNativeModules.json'), 'utf8'));
  const off = [];
  for (const [name, want] of Object.entries(bundled)) {
    if (!deps[name]) continue;
    const w = String(want).replace(/^[~^]/, ''), h = String(deps[name]).replace(/^[~^]/, '');
    const [wa, wb] = num(w), [ha, hb] = num(h);
    if (wa !== ha || wb !== hb || !ge(h, w)) off.push(`${name} ${deps[name]} (SDK lists ${want})`);
  }
  assert.deepEqual(off, []);
});

test('no package in the lock is in a range with a high advisory (xmldom, node-forge, zod)', () => {
  const bad = [];
  for (const [p, v] of Object.entries(lock.packages || {})) {
    const name = p.split('node_modules/').pop();
    if (name === '@xmldom/xmldom' && !ge(v.version, '0.8.15')) bad.push(`${p} ${v.version}`);
    if (name === 'node-forge' && !ge(v.version, '1.4.2')) bad.push(`${p} ${v.version}`);
    if (name === 'zod' && num(v.version)[0] === 4 && !ge(v.version, '4.6.6')) bad.push(`${p} ${v.version}`);
  }
  assert.deepEqual(bad, []);
  // @bacons/xcode (widget and Watch targets at prebuild) pins an old @expo/plist with xmldom 0.7: overridden to 0.8,
  // the API @expo/plist 0.5 uses; the prebuild output was compared and is the same.
  assert.equal(pkg.overrides?.['@bacons/xcode']?.['@expo/plist']?.['@xmldom/xmldom'], '~0.8.15');
});

test('the runtime stays 1.4.0 (no 1.4.0 binary exists before 215, so the new fingerprint changes nothing for 212 to 214)', () => {
  const aj = JSON.parse(fs.readFileSync(path.join(app, 'app.json'), 'utf8'));
  assert.equal(aj.expo.runtimeVersion, '1.4.0');
});

test('expo-router 58.0.26 anchors: the root keeps its explicit anchor, and no group has a route named like it', () => {
  const root = fs.readFileSync(path.join(app, 'src', 'app', '_layout.tsx'), 'utf8');
  assert.match(root, /unstable_settings = \{ anchor: 'index' \}/);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [path.join(d, e.name), ...walk(path.join(d, e.name))] : []));
  for (const dir of walk(path.join(app, 'src', 'app'))) {
    const g = /^\((.+)\)$/.exec(path.basename(dir));
    if (!g) continue;
    const named = fs.readdirSync(dir).filter((f) => f === g[1] || f.replace(/\.tsx?$/, '') === g[1]);
    assert.deepEqual(named, [], `${path.basename(dir)} has a route named like the group: it was the anchor before 58.0.26`);
  }
});
