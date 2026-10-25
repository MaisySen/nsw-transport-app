// iOS 27 resizable windows (iPhone Duo, iPhone Mirroring, iPad): content clears the side safe areas and stays at a
// readable width on a wide window (src/lib/layoutCore.ts), and the screens that draw their own edges use it.
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
const js = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/layoutCore.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-layout-')), 'layoutCore.mjs');
fs.writeFileSync(f, js);
const L = await import(pathToFileURL(f).href);
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('portrait iPhone: no side padding', () => {
  assert.deepEqual(L.sidePadding(393, 0, 0), { left: 0, right: 0 });
  assert.equal(L.isWide(393, 0, 0), false);
});

test('status bar or bars on the right edge: content keeps clear of them', () => {
  assert.deepEqual(L.sidePadding(420, 0, 62), { left: 0, right: 62 });
});

test('landscape with the Dynamic Island on one side', () => {
  assert.deepEqual(L.sidePadding(852, 59, 59), { left: 59 + 31, right: 59 + 31 });
});

test('wide window: content centred at the readable width', () => {
  const p = L.sidePadding(1000, 0, 0);
  assert.equal(1000 - p.left - p.right, L.READABLE_WIDTH);
  assert.equal(p.left, p.right);
  assert.equal(L.isWide(1000), true);
});

test('wide window with a side inset still adds up and stays readable', () => {
  const p = L.sidePadding(1100, 0, 60);
  assert.equal(1100 - p.left - p.right, L.READABLE_WIDTH);
  assert.equal(p.right - p.left, 60);
});

test('bad input is safe', () => {
  assert.deepEqual(L.sidePadding(NaN, -5, undefined), { left: 0, right: 0 });
  assert.deepEqual(L.sidePadding(0, 10, 10), { left: 10, right: 10 });
});

test('Screen, lists, sheets and floating buttons use the side padding', () => {
  assert.match(src('src/components/ui.tsx'), /paddingLeft: side\.left, paddingRight: side\.right/);
  assert.match(src('src/app/(tabs)/ask/index.tsx'), /12 \+ side\.left/);
  assert.match(src('src/app/go.tsx'), /left: insets\.left \+ 12/);
  assert.match(src('src/app/go.tsx'), /right: insets\.right \+ 12/);
  assert.match(src('src/app/service.tsx'), /left: insets\.left \+ 16/);
  assert.match(src('src/components/Sheet.tsx'), /marginLeft: side\.left/);
  assert.match(src('src/components/WhenPicker.tsx'), /marginLeft: side\.left/);
  assert.match(src('src/app/new-trip.tsx'), /paddingLeft: side\.left/);
  assert.match(src('src/app/(tabs)/home/index.tsx'), /left: 16 \+ side\.left/);
});

test('no screen size read once at import (a resized window would keep the old size)', () => {
  const dirs = ['src', 'platform'];
  const bad = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name) && /Dimensions\.get\(/.test(src(p))) bad.push(p);
  } };
  dirs.forEach((d) => fs.existsSync(path.join(root, d)) && walk(d));
  assert.deepEqual(bad, []);
});

test('no Linking.canOpenURL (deprecated in iOS 27: open the link and handle a failure)', () => {
  const bad = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name) && /canOpenURL/.test(src(p))) bad.push(p);
  } };
  ['src', 'platform'].forEach((d) => fs.existsSync(path.join(root, d)) && walk(d));
  assert.deepEqual(bad, []);
});
