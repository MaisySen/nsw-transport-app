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
  for (const skin of ['titanium', 'glass']) for (const dark of [false, true]) {
    const s = K.skinStyle(skin, { dark, line: '#F6891F', ...base });
    assert.match(s.ring, /^linear-gradient\(/, skin);
    assert.ok(s.shadow, skin);
    assert.ok(s.count.size > 56 && s.count.weight === '900', skin);
    const solid = K.skinStyle(skin, { dark, line: '#F6891F', solid: true, ...base });
    assert.equal(solid.ring, null); assert.equal(solid.width, 1); assert.ok(solid.border); assert.equal(solid.shadow, null); assert.equal(solid.fill, null);
  }
});

const T4 = '#005AA3', T1 = '#F99D1C';
const dk = { cardColor: '#1C1C1E', text3: 'rgba(235,235,245,0.3)' };

test('Line glow ring runs between the trip\'s line colours, 2 pt', () => {
  const s = K.skinStyle('line', { dark: true, lines: [T4, T1], ...dk });
  assert.equal(s.width, 2);
  assert.match(s.ring, /^linear-gradient\(135deg, #005aa3 0%, #005aa3 22%, #[0-9a-f]{6} 50%, #f99d1c 78%, #f99d1c 100%\)$/);
  // The middle is a light sheen, not the grey olive of blue and orange mixed straight.
  const mid = /22%, (#[0-9a-f]{6}) 50%/.exec(s.ring)[1];
  const lum = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).reduce((a, b) => a + b, 0) / 3;
  assert.ok(lum(mid) > lum(K.mix(T4, T1, 0.5)) + 40, mid);
  assert.ok(s.count.size > 56 && s.count.weight === '900');
  // Three lines: three evenly spaced stops; a repeat counts once; more than three keeps the first three.
  assert.equal(K.skinStyle('line', { dark: false, lines: [T4, '#00954C', T4, T1], ...base }).ring, 'linear-gradient(135deg, #005aa3 0%, #00954c 50%, #f99d1c 100%)');
});

test('ringColors: one line into silver, none is silver, bad colours skipped', () => {
  assert.deepEqual(K.ringColors([T1], true), ['#f99d1c', K.LINE_SILVER.dark]);
  assert.deepEqual(K.ringColors([T1], false), ['#f99d1c', K.LINE_SILVER.light]);
  assert.deepEqual(K.ringColors([], false), [K.LINE_SILVER.light, K.LINE_SILVER.light]);
  assert.deepEqual(K.ringColors([null, 'red', undefined, '#00954C'], true), ['#00954c', K.LINE_SILVER.dark]);
  assert.deepEqual(K.ringColors(['#f00', '#0f0', '#00f', '#fff'], true), ['#ff0000', '#00ff00', '#0000ff']);
  // The single line option (older callers) still works.
  assert.match(K.skinStyle('line', { dark: false, line: T1, ...base }).ring, /^linear-gradient\(135deg, #f99d1c 0%, #f99d1c 22%, #[0-9a-f]{6} 50%, #aeb4bd 78%, #aeb4bd 100%\)$/);
});

test('Line glow in dark: tinted glow in both colours, lifted surface, other looks untouched', () => {
  const s = K.skinStyle('line', { dark: true, lines: [T4, T1], ...dk });
  assert.match(s.shadow, /rgba\(0, 90, 163, 0\.55\)/);
  assert.match(s.shadow, /rgba\(249, 157, 28, 0\.55\)/);
  assert.equal(s.surface, '#232326');
  assert.equal(K.lifted('#1C1C1E'), '#232326');
  // Android's dark card is lifted a step towards white.
  assert.equal(K.lifted('#1B1E24'), '#22252b');
  assert.equal(K.skinStyle('plain', { dark: true, ...dk }).surface, null);
});

test('Line glow in light: white card (theme colour) with a soft shadow, no highlight', () => {
  const s = K.skinStyle('line', { dark: false, lines: [T4, T1], ...base });
  assert.equal(s.surface, null);
  assert.equal(s.fill, null);
  assert.match(s.shadow, /^0px 6px 18px 0px rgba\(16, 24, 40, 0\.10\)/);
  assert.equal(s.highlight, null);
});

test('Line glow under Reduce Transparency or Increase Contrast: solid 1.5 pt border in the line colour', () => {
  for (const dark of [false, true]) {
    const s = K.skinStyle('line', { dark, lines: [T4, T1], solid: true, ...(dark ? dk : base) });
    assert.equal(s.ring, null); assert.equal(s.width, 1.5); assert.equal(s.border, '#005aa3');
    assert.equal(s.shadow, null); assert.equal(s.highlight, null); assert.equal(s.fill, null);
  }
  assert.equal(K.skinStyle('line', { dark: true, lines: [], solid: true, ...dk }).border, K.LINE_SILVER.dark);
});

test('no dashes in the words; Line glow is the shipped look', () => {
  for (const f of ['src/lib/cardSkinCore.ts', 'src/lib/cardSkin.ts', 'src/components/Sheet.tsx']) assert.doesNotMatch(fs.readFileSync(path.join(here, '..', f), 'utf8'), /[\u2013\u2014]/, f);
  assert.match(fs.readFileSync(path.join(here, '..', 'src/lib/cardSkin.ts'), 'utf8'), /SHIPPED_SKIN: CardSkin = 'line'/);
});

test('hold menus use the system action sheet on iPhone, no drawn sheet on iOS; the + is the system menu (test/plusmenu.test.mjs)', () => {
  const sheet = fs.readFileSync(path.join(here, '..', 'src/components/Sheet.tsx'), 'utf8');
  assert.match(sheet, /ActionSheetIOS\.showActionSheetWithOptions/);
  assert.match(sheet, /if \(ios\) return null;/);
  const home = fs.readFileSync(path.join(here, '..', 'src/app/(tabs)/home/index.tsx'), 'utf8');
  assert.match(home, /<Stack\.Toolbar\.Menu icon="plus"/);
  assert.doesNotMatch(home, /showIosSheet/);
});
