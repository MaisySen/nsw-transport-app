// The commute card looks (src/lib/cardSkinCore.ts): the dev switch words, colour mixing, and that every look falls
// back to a solid border with no glow when the phone asks for solid colours.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-cardskin-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const K = await load('src/lib/cardSkinCore.ts');
const base = { cardColor: '#FFFFFF', text3: '#8E8E93' };

test('skinFrom reads the dev switch', () => {
  assert.equal(K.skinFrom('A'), 'titanium');
  assert.equal(K.skinFrom('titanium'), 'titanium');
  assert.equal(K.skinFrom('b'), 'line');
  assert.equal(K.skinFrom('Line-Glow'), 'line');
  assert.equal(K.skinFrom('glass'), 'glass');
  assert.equal(K.skinFrom(''), 'plain');
  assert.equal(K.skinFrom(undefined), 'plain');
  assert.equal(K.skinFrom('shiny'), 'plain');
});

test('mix and rgba', () => {
  assert.equal(K.mix('#000000', '#FFFFFF', 0), '#000000');
  assert.equal(K.mix('#000000', '#FFFFFF', 1), '#ffffff');
  assert.equal(K.mix('#000', '#fff', 0.5), '#808080');
  assert.equal(K.rgba('#F6891F', 0.2), 'rgba(246, 137, 31, 0.2)');
});

test('plain is today\'s card', () => {
  const s = K.skinStyle('plain', { dark: false, ...base });
  assert.equal(s.ring, null); assert.equal(s.shadow, null); assert.equal(s.count.size, 56);
});

test('each new look has a ring, a bigger bolder countdown, and goes solid on request', () => {
  for (const skin of ['titanium', 'line', 'glass']) for (const dark of [false, true]) {
    const s = K.skinStyle(skin, { dark, line: '#F6891F', ...base });
    assert.match(s.ring, /^linear-gradient\(/, skin);
    assert.ok(s.shadow, skin);
    assert.ok(s.count.size > 56 && s.count.weight === '900', skin);
    const solid = K.skinStyle(skin, { dark, line: '#F6891F', solid: true, ...base });
    assert.equal(solid.ring, null); assert.equal(solid.width, 1); assert.ok(solid.border); assert.equal(solid.shadow, null); assert.equal(solid.fill, null);
  }
});

test('Line glow takes the line colour, and copes without one', () => {
  const t1 = K.skinStyle('line', { dark: false, line: '#F6891F', ...base });
  assert.match(t1.shadow, /rgba\(246, 137, 31/);
  const none = K.skinStyle('line', { dark: true, line: null, ...base });
  assert.match(none.ring, /^linear-gradient\(/);
});

test('no dashes in the words; shipped look is plain until a pick', () => {
  for (const f of ['src/lib/cardSkinCore.ts', 'src/lib/cardSkin.ts', 'src/components/Sheet.tsx']) assert.doesNotMatch(fs.readFileSync(path.join(here, '..', f), 'utf8'), /[\u2013\u2014]/, f);
  assert.match(fs.readFileSync(path.join(here, '..', 'src/lib/cardSkin.ts'), 'utf8'), /SHIPPED_SKIN: CardSkin = '(plain|titanium|line|glass)'/);
});

test('menus use the system action sheet on iPhone: the + button is anchored, no drawn sheet on iOS', () => {
  const sheet = fs.readFileSync(path.join(here, '..', 'src/components/Sheet.tsx'), 'utf8');
  assert.match(sheet, /ActionSheetIOS\.showActionSheetWithOptions/);
  assert.match(sheet, /if \(ios\) return null;/);
  const home = fs.readFileSync(path.join(here, '..', 'src/app/(tabs)/home/index.tsx'), 'utf8');
  assert.match(home, /showIosSheet\(\{ actions: items, anchor: findNodeHandle\(btn\.current\) \}\)/);
});
