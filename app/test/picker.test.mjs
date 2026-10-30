// Station picker and search fields (25 Oct, build 206 report "The screen looks not optimized"; "automatically
// swaps to caps lock on while searching"). Run: node --test test/picker.test.mjs
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

async function load(rel) {
  const js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-picker-'));
  const file = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(file, js);
  return import(pathToFileURL(file).href);
}

test('placeholder asks the question; To names where you got on only when it fits', async () => {
  const { pickerPlaceholder, PLACEHOLDER_MAX } = await load('src/lib/pickerCore.ts');
  assert.equal(pickerPlaceholder('from'), 'Where do you get on?');
  assert.equal(pickerPlaceholder('to', 'Bondi Junction'), 'Bondi Junction to where?');
  assert.equal(pickerPlaceholder('to', 'Sydney Olympic Park Wharf Ferry'), 'Where do you get off?');
  assert.equal(pickerPlaceholder('to'), 'Where do you get off?');
  for (const n of ['Central', 'Bondi Junction', 'Chatswood', 'Macquarie University']) assert.ok(pickerPlaceholder('to', n).length <= PLACEHOLDER_MAX, n);
});

test('search fields never capitalise, correct or spell check, and show a Search key', async () => {
  const { searchFieldProps } = await load('src/lib/pickerCore.ts');
  assert.equal(searchFieldProps.autoCapitalize, 'none');
  assert.equal(searchFieldProps.autoCorrect, false);
  assert.equal(searchFieldProps.spellCheck, false);
  assert.equal(searchFieldProps.returnKeyType, 'search');
  assert.equal(searchFieldProps.enterKeyHint, 'search');
});

test('every stop or station search field uses the shared search settings', () => {
  const files = { 'src/app/new-trip.tsx': 2, 'src/app/add-trip.tsx': 2, 'src/app/welcome.tsx': 1, 'src/app/(tabs)/search/index.tsx': 2 };
  for (const [f, n] of Object.entries(files)) {
    const s = read(f);
    assert.equal((s.match(/<TextInput \{\.\.\.searchFieldProps\}/g) || []).length, n, f);
    assert.doesNotMatch(s, /autoCapitalize=\{?['"]?characters/, f);
    assert.doesNotMatch(s, /autoCapitalize=\{[^}]*characters/, f);
  }
});

test('sheet header: transparent on iPhone (the picker insets itself), solid Material 3 bar on Android', async () => {
  const { sheetHeaderOptions } = await load('src/lib/headerOptions.ts');
  const c = { tint: '#0A84FF', bg: '#000000' };
  const ios = sheetHeaderOptions('ios', c);
  assert.equal(ios.headerTransparent, true);
  assert.equal(ios.headerLargeTitle, false);
  assert.equal(ios.headerStyle, undefined);
  const android = sheetHeaderOptions('android', c);
  assert.equal(android.headerTransparent, false);
  assert.deepEqual(android.headerStyle, { backgroundColor: c.bg });
  const layout = read('src/app/_layout.tsx');
  assert.match(layout, /name="new-trip" options=\{\{ \.\.\.sheetHeaderOptions\(Platform\.OS, c\)/);
  assert.match(layout, /name="add-trip" options=\{\{ \.\.\.sheetHeaderOptions\(Platform\.OS, c\)/);
});

test('station picker: inset below the measured header, no icon row, full width rows clear of the index', () => {
  const s = read('src/app/new-trip.tsx');
  const picker = s.slice(s.indexOf('function StationPicker'), s.indexOf('function BusPicker'));
  assert.match(picker, /useContext\(HeaderHeightContext\)/);
  assert.match(picker, /paddingTop: top/);
  assert.match(picker, /Platform\.OS === 'ios' \? headerH : 0/);
  assert.doesNotMatch(picker, /modeIconName\(mode\)/, 'no mode icon beside the prompt');
  assert.doesNotMatch(picker, /marginRight: 30/, 'no uneven right gutter');
  assert.match(picker, /paddingRight: indexOn \? INDEX_W \+ 8 : 16/);
  assert.match(picker, /insets\.bottom/);
  // Every branch of the picker uses the same inset container.
  assert.equal((picker.match(/<View style=\{box\}>/g) || []).length + (picker.match(/<View style=\{box\}>\{head\}/g) || []).length >= 6, true);
});

test('New trip back button: Cancel first, then the back chevron on iPhone', () => {
  const s = read('src/app/new-trip.tsx');
  assert.match(s, /first \? <T kind="body" tone="tint">Cancel<\/T> : <Icon name=\{I\.back\}/);
});
