// Native menus (Bidur, 25 Oct 8:42 PM: the centred action sheet looked wrong). Every hold menu and button menu is
// data (src/lib/menuCore.ts) shown as the iPhone system menu (expo-router Link.Menu, Stack.Toolbar.Menu, @expo/ui
// SwiftUI Menu), the Material 3 menu on Android (AnchoredMenu), and VoiceOver actions on the row.
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
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const js = ts.transpileModule(read('src/lib/menuCore.ts'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-menus-')), 'menuCore.mjs');
fs.writeFileSync(f, js);
const M = await import(pathToFileURL(f).href);

const noop = () => {};

test('Cancel rows go, destructive rows go red and last, order kept otherwise', () => {
  const items = M.menuFrom([
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete trip', style: 'destructive', onPress: noop },
    { text: 'Edit trip', onPress: noop },
    { text: 'Show first', onPress: noop },
  ]);
  assert.deepEqual(items.map((i) => i.text), ['Edit trip', 'Show first', 'Delete trip']);
  assert.deepEqual(items.map((i) => i.destructive), [false, false, true]);
  assert.ok(!items.some((i) => /cancel/i.test(i.text)));
});

test('rows with no action are dropped (nothing dead in a menu)', () => {
  assert.equal(M.menuFrom([{ text: 'Save trip' }, { text: 'Star stop', onPress: noop }]).length, 1);
});

test('SF Symbols and Android icons per action', () => {
  const want = {
    'Edit trip': 'pencil', 'Show first': 'arrow.up.to.line', 'Delete trip': 'trash', 'Delete commute': 'trash', 'Remove both': 'trash',
    'Remove from Recent': 'clock.badge.xmark', 'Unstar stop': 'star.slash', 'Star stop': 'star', 'Save trip': 'star',
    'Change home': 'house', 'Change work': 'briefcase', Home: 'house', Work: 'briefcase',
  };
  for (const [text, sf] of Object.entries(want)) assert.equal(M.iconsFor(text).sf, sf, text);
  assert.equal(M.iconsFor('Delete trip').icon, 'trash');
  assert.equal(M.iconsFor('Change home').icon, 'home');
  // Every Android icon key exists in components/Icon.tsx.
  const icons = read('src/components/Icon.tsx');
  for (const t of [...Object.keys(want), 'Earlier (7:15 am)', 'Later', 'Every day', 'Clear recent stops', 'Email privacy', 'Anything else']) {
    const k = M.iconsFor(t).icon;
    assert.ok(new RegExp(`\\n  ${k}: \\{`).test(icons), `${t}: icon ${k}`);
  }
});

test('menuOf keeps given symbols, an empty one means none, destructive last', () => {
  const it = M.menuOf([{ text: 'Delete', destructive: true, onPress: noop }, { text: 'Adult (current)', sf: 'checkmark', icon: 'check', onPress: noop }, { text: 'Child', sf: '', onPress: noop }]);
  assert.deepEqual(it.map((i) => i.text), ['Adult (current)', 'Child', 'Delete']);
  assert.equal(it[0].sf, 'checkmark');
  assert.equal(it[1].sf, '');
  assert.equal(it[2].sf, 'trash');
});

test('older builds: the old sheet gets the rows and Cancel last', () => {
  const b = M.legacyButtons(M.menuFrom([{ text: 'Unstar stop', style: 'destructive', onPress: noop }]));
  assert.deepEqual(b.map((x) => [x.text, x.style]), [['Unstar stop', 'destructive'], ['Cancel', 'cancel']]);
});

test('VoiceOver: every menu row is an action on the row, after the row\'s own, never twice', () => {
  let ran = '';
  const items = M.menuFrom([{ text: 'Show first', onPress: () => { ran = 'top'; } }, { text: 'Delete trip', style: 'destructive', onPress: () => { ran = 'del'; } }]);
  const a = M.withMenuActions([{ name: 'swipeAction', label: 'Delete trip' }, { name: 'whyLate', label: "Why it's late" }], items);
  assert.deepEqual(a.map((x) => x.label), ['Delete trip', "Why it's late", 'Show first']);
  assert.ok(M.runMenuAction(a[2].name, items));
  assert.equal(ran, 'top');
  assert.equal(M.runMenuAction('swipeAction', items), false, 'the row\'s own actions are left to the row');
  assert.equal(M.runMenuAction('menu:9', items), false);
  assert.deepEqual(M.withMenuActions(undefined, items).map((x) => x.name), ['menu:0', 'menu:1']);
});

test('which menu each phone gets', () => {
  assert.equal(M.menuKind('ios', true), 'native');
  assert.equal(M.menuKind('ios', false), 'legacy');
  assert.equal(M.menuKind('android', true), 'material');
  assert.equal(M.menuKind('web', false), 'web');
});

test('no ActionSheetIOS menu left on a hold or a menu button (only the old-build fallback in Sheet.tsx)', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(path.join(root, 'src')).filter((p) => /\.tsx?$/.test(p));
  const rel = (p) => path.relative(root, p);
  for (const p of files) {
    const s = fs.readFileSync(p, 'utf8');
    if (/import[^;]*\bActionSheetIOS\b[^;]*from 'react-native'/.test(s)) assert.ok(/src\/components\/Sheet\.tsx$/.test(rel(p)), `${rel(p)} uses ActionSheetIOS`);
    if (/\bnativeMenu\(/.test(s)) assert.ok(/src\/components\/(Sheet|HoldMenu)\.tsx$/.test(rel(p)), `${rel(p)} calls nativeMenu directly`);
    assert.ok(!/onLongPress=\{\(\) => (stopMenu|removeTrip|removeStop)/.test(s), `${rel(p)} still opens a sheet on a long press`);
  }
});

test('feature checks before any native menu view', () => {
  const nv = read('src/lib/nativeViews.ts');
  assert.match(nv, /getViewConfig\?\.\(moduleName, viewName\)/);
  assert.match(nv, /'ExpoRouterNativeLinkPreview', 'NativeLinkPreviewView'/);
  assert.match(nv, /'ExpoUI', 'MenuView'/);
  assert.match(nv, /__DEV__ && !!\(globalThis as any\)\.__legacyMenus/, 'the debug switch is __DEV__ only');
  const hold = read('src/components/HoldMenu.tsx');
  assert.match(hold, /menuKind\(Platform\.OS, canContextMenu\(\)\)/);
  assert.match(hold, /<Link\.Menu title=/);
  assert.match(hold, /destructive=\{it\.destructive\}/);
  const row = read('src/components/RowMenu.ios.tsx');
  assert.match(row, /if \(!canSwiftUIMenu\(\)\) return <RowMenuDrawn/);
  assert.match(row, /require\('@expo\/ui\/swift-ui'\)/, '@expo/ui is required only after the check');
  assert.match(row, /role=\{it\.destructive \? 'destructive' : 'default'\}/);
  assert.doesNotMatch(read('src/components/RowMenu.tsx'), /@expo\/ui/);
});

test('Save this trip: a bar button menu on iPhone, no Cancel', () => {
  const t = read('src/app/trip.tsx');
  assert.match(t, /<Stack\.Toolbar\.Menu icon="star" accessibilityLabel="Save trip"/);
  assert.match(t, /<PullDownButton menu=\{saveMenu\}>/);
  assert.doesNotMatch(t, /nativeMenu\('Save this trip'/);
});

test('editors stay sheets with the system grabber and drag to close', () => {
  for (const f of ['src/components/WhenPicker.tsx', 'src/components/TripReminders.tsx']) {
    const s = read(f);
    assert.match(s, /<SheetGrabber onClose=\{onClose\} \/>/, f);
    assert.match(s, /useSheetDrag\(onClose\)/, f);
  }
  const e = read('src/components/EditorSheet.tsx');
  assert.match(e, /width: 36, height: 5/);
  assert.match(e, /accessibilityActions=\{\[\{ name: 'activate', label: 'Close' \}\]\}/);
});

test('no dashes in the new menu code', () => {
  for (const f of ['src/lib/menuCore.ts', 'src/lib/nativeViews.ts', 'src/components/HoldMenu.tsx', 'src/components/RowMenu.tsx', 'src/components/RowMenu.ios.tsx', 'src/components/EditorSheet.tsx']) {
    assert.doesNotMatch(read(f), /[\u2013\u2014]/, f);
  }
});

// The departures row (stop screen, board, Home stop cards): hold opens the same native menu, not the old sheet.
test('departure row menu: Watch or Stop watching, then Show stops, bell symbols, title from the service', () => {
  let w = 0, o = 0;
  const m = M.departureMenu({ line: 'T1', dest: 'Emu Plains Station, Emu Plains' }, false, { watch: () => { w++; }, open: () => { o++; } });
  assert.equal(m.title, 'T1 to Emu Plains');
  assert.deepEqual(m.items.map((i) => [i.text, i.sf, i.icon, i.destructive]), [['Watch', 'bell', 'bell', false], ['Show stops', 'list.bullet', 'list', false]]);
  m.items[0].onPress(); m.items[1].onPress();
  assert.equal(w, 1); assert.equal(o, 1);
  const on = M.departureMenu({ line: '410', dest: 'Rockdale' }, true, { watch: noop, open: noop });
  assert.deepEqual(on.items.map((i) => [i.text, i.sf]), [['Stop watching', 'bell.slash'], ['Show stops', 'list.bullet']]);
  assert.deepEqual(M.departureMenu({ line: 'T1', dest: 'Central' }, false, { open: noop }).items.map((i) => i.text), ['Show stops']);
  // VoiceOver: the swipe's Watch is not listed twice.
  assert.deepEqual(M.withMenuActions([{ name: 'swipeAction', label: 'Watch' }], m.items).map((a) => a.label), ['Watch', 'Show stops']);
});

test('the departure row holds through HoldMenu, with no direct long press and no ActionSheetIOS', () => {
  const src = read('src/components/Transit.tsx');
  assert.match(src, /<HoldMenu menu=\{departureMenu\(d, !!watched, \{ watch: onWatch, open: onPress, platform \}\)\}/);
  assert.doesNotMatch(src, /onLongPress=/);
  assert.doesNotMatch(src, /ActionSheetIOS|nativeMenu\(/);
});
