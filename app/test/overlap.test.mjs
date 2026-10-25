// iOS 26 and 27 floating tab bar and keyboard: the Ask field and the Home undo bar sit above the tab bar, the Ask
// field rises with the keyboard by the measured overlap, and the chat opens on its latest message.
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
const js = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/keyboardCore.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-kb-')), 'keyboardCore.mjs');
fs.writeFileSync(f, js);
const K = await import(pathToFileURL(f).href);
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('keyboard overlap is the view bottom minus the keyboard top, in window points', () => {
  // 844 pt iPhone, view ends above an 83 pt tab bar area, keyboard 336 pt tall.
  assert.equal(K.keyboardOverlap(844 - 83, 844 - 336), 253);
  // View reaching the screen edge (no tab bar): the whole keyboard.
  assert.equal(K.keyboardOverlap(844, 508), 336);
  // Keyboard hidden or below the view.
  assert.equal(K.keyboardOverlap(761, null), 0);
  assert.equal(K.keyboardOverlap(761, 844), 0);
  assert.equal(K.keyboardOverlap(761, 0), 0, 'cross fade transitions report 0, never a full screen of padding');
  assert.equal(K.keyboardOverlap(NaN, 500), 0);
});

test('a list counts as at its end within the slack', () => {
  assert.equal(K.atEnd(0, 600, 400), true, 'short content is always at the end');
  assert.equal(K.atEnd(1400, 600, 2000), true);
  assert.equal(K.atEnd(1350, 600, 2000), true, 'within 80 pt');
  assert.equal(K.atEnd(800, 600, 2000), false, 'scrolled up to read');
  assert.equal(K.atEnd(1566, 600, 2083, 83), true, 'bottom inset counted');
  assert.equal(K.atEnd(1400, 600, 2083, 83), false, 'not yet at the end below the inset');
});

test('Ask: field above the tab bar and the keyboard, no guessed offsets, opens on the latest message', () => {
  const a = src('src/app/(tabs)/ask/index.tsx');
  assert.match(a, /<TabBarSafe/);
  assert.match(a, /useKeyboardPad\(/);
  assert.doesNotMatch(a, /KeyboardAvoidingView/);
  assert.doesNotMatch(a, /keyboardVerticalOffset/);
  assert.doesNotMatch(a, /insets\.bottom - 34/);
  assert.match(a, /useFocusEffect\(/);
  assert.match(a, /onContentSizeChange=/);
  assert.match(a, /onScrollEndDrag=/);
});

test('Home: the undo bar sits above the tab bar', () => {
  const h = src('src/app/(tabs)/home/index.tsx');
  assert.match(h, /<TabBarSafe overlay/);
  assert.doesNotMatch(h, /snack: \{ position: 'absolute'/);
});

test('TabBarSafe pads by the native screen safe area on iPhone only', () => {
  const t = src('src/components/TabBarSafe.tsx');
  assert.match(t, /from 'react-native-screens\/experimental'/);
  assert.match(t, /edges=\{\{ bottom: true \}\}/);
  assert.match(t, /Platform\.OS === 'ios'/);
  // The native view must exist in the builds this update reaches: same react-native-screens as the 206 lock file.
  const lock = JSON.parse(src('package-lock.json'));
  assert.equal(lock.packages['node_modules/react-native-screens'].version, '4.30.0');
  const codegen = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/react-native-screens/package.json'), 'utf8')).codegenConfig;
  assert.ok(codegen.ios.components.RNSSafeAreaView, 'RNSSafeAreaView is a native component of react-native-screens');
});

test('scroll views take the keyboard inset on iPhone', () => {
  assert.match(src('src/components/ui.tsx'), /automaticallyAdjustKeyboardInsets/);
  const n = src('src/app/new-trip.tsx');
  assert.ok((n.match(/automaticallyAdjustKeyboardInsets/g) || []).length >= 3);
});
