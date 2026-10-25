// Siri, Shortcuts and Control Center (build 206): the links "Start my commute" leaves for the app, the service a
// start link means, and the app group keys the app and the Swift side must agree on.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-intents-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const { pendingOpenURL, startIndex, PENDING_MAX_AGE_S } = await load('platform/intentInboxCore.ts');

test('pendingOpenURL takes a fresh app link', () => {
  const now = 1_800_000_000_000;
  const raw = JSON.stringify({ url: 'nswtransport://trip?from=1&to=2&start=1', at: now / 1000 - 5 });
  assert.equal(pendingOpenURL(raw, now), 'nswtransport://trip?from=1&to=2&start=1');
});

test('pendingOpenURL drops old, foreign and broken values', () => {
  const now = 1_800_000_000_000;
  assert.equal(pendingOpenURL(JSON.stringify({ url: 'nswtransport://', at: now / 1000 - PENDING_MAX_AGE_S - 1 }), now), null);
  assert.equal(pendingOpenURL(JSON.stringify({ url: 'https://example.com', at: now / 1000 }), now), null);
  assert.equal(pendingOpenURL(JSON.stringify({ url: 'nswtransport://' }), now), null);
  assert.equal(pendingOpenURL('{not json', now), null);
  assert.equal(pendingOpenURL(null, now), null);
  assert.equal(pendingOpenURL('', now), null);
});

test('startIndex picks the service closest to at, within 3 minutes', () => {
  const t0 = 1_800_000_000_000;
  const deps = [t0, t0 + 6 * 60000, t0 + 12 * 60000];
  assert.equal(startIndex(deps, (t0 + 6 * 60000 + 30000) / 1000), 1);
  assert.equal(startIndex(deps, (t0 + 12 * 60000) / 1000), 2);
  // Too far from every service: the first one.
  assert.equal(startIndex(deps, (t0 + 40 * 60000) / 1000), 0);
  assert.equal(startIndex(deps, null), 0);
  assert.equal(startIndex([], t0 / 1000), -1);
});

test('the app and the Swift side use the same app group keys', () => {
  const swift = read('targets/widget/_shared/CommuteIntents.swift');
  const bridge = read('platform/iosBridge.ts');
  assert.match(swift, /pendingKey = "intentPendingOpen"/);
  assert.match(bridge, /takeString\('intentPendingOpen'\)/);
  assert.match(swift, /forKey: "apiBase\.v1"/);
  assert.match(bridge, /setString\('apiBase\.v1'/);
  for (const k of ['homeWork', 'starredStops', 'liveCard', 'apiProfile']) {
    assert.ok(swift.includes(`"${k}"`), `Swift reads ${k}`);
    assert.ok(bridge.includes(`'${k}'`), `the app writes ${k}`);
  }
  const mod = read('modules/transport-ios/ios/TransportIOSModule.swift');
  assert.match(swift, /Notification\.Name\("TransportIntentQueued"\)/);
  assert.match(mod, /Notification\.Name\("TransportIntentQueued"\)/);
  assert.match(mod, /Function\("takeSharedString"\)/);
});

test('Siri phrases each name the app once, and the controls are in the widget bundle', () => {
  const swift = read('targets/widget/_shared/CommuteIntents.swift');
  const phrases = [...swift.matchAll(/^\s+"(.*)",$/gm)].map((m) => m[1]);
  assert.ok(phrases.length >= 10);
  for (const p of phrases) assert.equal(p.split('\\(.applicationName)').length - 1, 1, p);
  const bundle = read('targets/widget/TransportWidgets.swift');
  assert.match(bundle, /TrainHomeControl\(\)/);
  assert.match(bundle, /StartCommuteControl\(\)/);
});

test('the start link the widget and Siri build is the one the trip screen reads', () => {
  const swift = read('targets/widget/_shared/CommuteIntents.swift');
  const text = read('targets/widget/WidgetText.swift');
  const trip = read('src/app/trip.tsx');
  assert.match(swift, /name: "start", value: "1"/);
  assert.match(text, /name: "start", value: "1"/);
  assert.match(trip, /p\.start !== '1'/);
});

test('no long dashes in the new native and app text', () => {
  for (const rel of ['targets/widget/_shared/CommuteIntents.swift', 'targets/widget/Controls.swift', 'platform/intentInboxCore.ts']) {
    assert.ok(!/[\u2013\u2014]/.test(read(rel)), rel);
  }
});
