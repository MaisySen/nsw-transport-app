// Tab and stop headers: never a large title, so Home and the other tabs open with the normal header
// on every launch (iOS 26 drew the large title behind the header blur). Run: node --test test/
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

async function load() {
  const src = fs.readFileSync(path.join(root, 'src/lib/headerOptions.ts'), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-header-'));
  const file = path.join(out, 'headerOptions.mjs');
  fs.writeFileSync(file, js);
  return import(pathToFileURL(file).href);
}

const palette = { tint: '#0A84FF', bg: '#000000' };

test('tab headers have no large title on iOS or Android', async () => {
  const { tabHeaderOptions } = await load();
  for (const osName of ['ios', 'android', 'web']) {
    assert.equal(tabHeaderOptions(osName, palette).headerLargeTitle, false, osName);
  }
});

test('iOS keeps the transparent blurred header, Android a solid one in the page colour', async () => {
  const { tabHeaderOptions } = await load();
  const ios = tabHeaderOptions('ios', palette);
  assert.equal(ios.headerTransparent, true);
  assert.equal(ios.headerBlurEffect, 'systemChromeMaterial');
  assert.equal(ios.headerStyle, undefined);
  assert.equal(ios.headerTintColor, palette.tint);
  const android = tabHeaderOptions('android', palette);
  assert.equal(android.headerTransparent, false);
  assert.deepEqual(android.headerStyle, { backgroundColor: palette.bg });
  assert.deepEqual(android.contentStyle, { backgroundColor: palette.bg });
});

test('web preview header starts below the floating tab pill; iPhone and Android unchanged', async () => {
  const { tabHeaderOptions, WEB_PILL_CLEAR } = await load();
  // expo-router's web tabs: a pill fixed 24 px from the top, 40 px tall.
  assert.ok(WEB_PILL_CLEAR >= 24 + 40);
  assert.equal(tabHeaderOptions('web', palette).headerStatusBarHeight, WEB_PILL_CLEAR);
  assert.equal('headerStatusBarHeight' in tabHeaderOptions('ios', palette), false);
  assert.equal('headerStatusBarHeight' in tabHeaderOptions('android', palette), false);
});

test('stop screen header has no large title and no title text', async () => {
  const { stopHeaderOptions } = await load();
  const ios = stopHeaderOptions('ios');
  assert.equal(ios.headerLargeTitle, false);
  assert.equal(ios.title, '');
  assert.equal(ios.headerTransparent, true);
  assert.equal(stopHeaderOptions('android').headerTransparent, false);
});

test('every tab layout and the stop screen use the shared header options', () => {
  for (const t of ['home', 'ask', 'search', 'settings']) {
    const s = fs.readFileSync(path.join(root, `src/app/(tabs)/${t}/_layout.tsx`), 'utf8');
    assert.match(s, /screenOptions=\{tabHeaderOptions\(Platform\.OS, c\)\}/, t);
    assert.doesNotMatch(s, /headerLargeTitle: true/, t);
  }
  const rootLayout = fs.readFileSync(path.join(root, 'src/app/_layout.tsx'), 'utf8');
  assert.match(rootLayout, /name="stop\/\[id\]" options=\{stopHeaderOptions\(Platform\.OS\)\}/);
  assert.doesNotMatch(rootLayout, /headerLargeTitle: Platform\.OS === 'ios'/);
});
