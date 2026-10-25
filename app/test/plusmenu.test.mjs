// The + menu on Home (Bidur, 25 Oct 8:42 PM: the action sheet floated in the middle of the screen).
// iPhone: a system bar button with a UIMenu; Android and the web: a menu drawn under the + button.
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
const js = ts.transpileModule(read('src/lib/menuPlace.ts'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-menu-')), 'menuPlace.mjs');
fs.writeFileSync(f, js);
const M = await import(pathToFileURL(f).href);

const phone = { w: 390, h: 844 };
const plus = { x: 346, y: 54, w: 36, h: 36 }; // the + at the top right of a 390 pt wide screen

test('the menu drops from the + button: under it, right edges lined up, inside the screen', () => {
  const p = M.placeMenu(plus, phone, 4, M.IOS_MENU, { top: 47, bottom: 34 });
  assert.equal(p.up, false);
  assert.equal(p.top, 54 + 36 + 8);
  assert.equal(p.left + p.width, 382, 'right edge on the button right edge');
  assert.equal(p.width, 250);
  assert.equal(p.height, 4 * 44);
  assert.ok(p.left >= 8);
});

test('Material 3 on Android: 48 dp rows with 8 dp padding, kept 8 dp from the edge', () => {
  const p = M.placeMenu({ x: 342, y: 40, w: 48, h: 48 }, { w: 392, h: 800 }, 4, M.M3_MENU);
  assert.equal(p.height, 4 * 48 + 16);
  assert.equal(p.left + p.width, 384, 'clamped 8 dp from the right edge');
  assert.equal(p.top, 40 + 48 + 4);
});

test('a button near the bottom opens the menu above it; a narrow screen shrinks the menu', () => {
  const p = M.placeMenu({ x: 300, y: 780, w: 40, h: 40 }, phone, 4, M.IOS_MENU, { top: 47, bottom: 34 });
  assert.equal(p.up, true);
  assert.equal(p.top, 780 - 8 - 176);
  const n = M.placeMenu({ x: 0, y: 50, w: 30, h: 30 }, { w: 200, h: 600 }, 4, M.IOS_MENU);
  assert.equal(n.width, 184);
  assert.equal(n.left, 8);
});

test('iPhone: + is a system bar button with a UIMenu, SF Symbols, no Cancel, no action sheet', () => {
  const home = read('src/app/(tabs)/home/index.tsx');
  assert.match(home, /<Stack\.Toolbar placement="right">/);
  assert.match(home, /<Stack\.Toolbar\.Menu icon="plus" accessibilityLabel="Add"/);
  assert.match(home, /<Stack\.Toolbar\.MenuAction key=\{it\.text\} icon=\{it\.sf as any\} onPress=\{it\.onPress\}>/);
  for (const sf of ['point.topleft.down.to.point.bottomright.curvepath', "sf: 'star'", "sf: 'house'", "sf: 'briefcase'"]) assert.ok(home.includes(sf), sf);
  assert.match(home, /Platform\.OS === 'ios' \? <AddMenu places=\{places\} \/> : null/);
  assert.match(home, /Platform\.OS === 'ios' \? \{ title: 'Home' \}/, 'no drawn headerRight on iPhone');
  assert.doesNotMatch(home, /showIosSheet|findNodeHandle/);
  const add = home.slice(home.indexOf('function addItems('), home.indexOf('function AddButton('));
  assert.doesNotMatch(add, /['"]Cancel['"]|>Cancel</);
});

test('Android and the web: the drawn menu has no Cancel row, buttons for VoiceOver and TalkBack, a tap outside closes it', () => {
  const m = read('src/components/AnchoredMenu.tsx');
  assert.doesNotMatch(m, /['"]Cancel['"]|>Cancel</);
  assert.match(m, /accessibilityRole="button" accessibilityLabel="Close menu"/);
  assert.match(m, /accessibilityRole="button" accessibilityLabel=\{it\.text\}/);
  assert.match(m, /borderRadius: 13/);
  assert.match(m, /borderRadius: 4, paddingVertical: 8, elevation: 3/);
  assert.match(m, /useSolidLook\(\)/, 'Reduce Transparency draws a solid menu');
  assert.match(m, /onDismiss=\{\(\) => pending\.current\?\.\(\)\}/, 'the action runs after the menu has gone');
  const home = read('src/app/(tabs)/home/index.tsx');
  assert.match(home, /<Pressable ref=\{btn\} onPress=\{show\} accessibilityRole="button" accessibilityLabel="Add"/);
  assert.match(home, /measureInWindow/);
});

test('no dashes and no repeating timers in the + menu files', () => {
  for (const f of ['src/components/AnchoredMenu.tsx', 'src/lib/menuPlace.ts', 'src/app/(tabs)/home/index.tsx']) {
    const s = read(f);
    assert.doesNotMatch(s, /[\u2013\u2014]/, f);
    assert.doesNotMatch(s, /setInterval/, f);
  }
});
