// Line badges (one look everywhere, official colours, never grey) and the swipe rows (the action hidden until the
// row moves, clipped to the card, one row open at a time, the same action for VoiceOver).
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-badges-'));
async function load(rel, name, patch = (s) => s) {
  const js = ts.transpileModule(patch(fs.readFileSync(path.join(root, rel), 'utf8')), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(tmp, name);
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const L = await load('src/lib/lineStyle.ts', 'lineStyle.mjs');
const th = await load('src/lib/theme.ts', 'theme.mjs', (s) => s.replace(/^import .*react-native.*$/m, "const Platform = { OS: 'ios' }; const useColorScheme = () => 'light';"));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));

test('a bus with no live data or an unknown class is bus blue, not grey', () => {
  assert.equal(L.badgeLook('333', 'other', '#495054').bg, '#00B5EF');
  assert.equal(L.badgeLook('D400', null, null).bg, '#00B5EF');
  assert.equal(L.badgeLook('D400', 'bus', undefined).bg, '#00B5EF');
  assert.equal(L.badgeLook('610X', 'school', '#5C5C5C').bg, '#00B5EF');
  assert.equal(L.badgeLook('333', 'bus', '#888888').mode, 'bus');
});

test('the mode is read from the line name when the feed has none', () => {
  assert.equal(L.badgeMode('T1', null), 'train');
  assert.equal(L.badgeMode('CCN', 'other'), 'train');
  assert.equal(L.badgeMode('M1', undefined), 'metro');
  assert.equal(L.badgeMode('L2', ''), 'lightrail');
  assert.equal(L.badgeMode('F1', null), 'ferry');
  assert.equal(L.badgeMode('T1', 'bus'), 'bus', 'the feed word wins when it is one we draw');
  assert.equal(L.badgeLook('M1', null, '#495054').bg, '#168388');
});

test('line colours from the feed are kept, including tinted greys like T7', () => {
  assert.equal(L.badgeLook('T4', 'train', '#005AA3').bg, '#005AA3');
  assert.equal(L.badgeLook('T7', 'train', '#6f818e').bg, '#6F818E');
  assert.equal(L.isNeutral('#495054'), true);
  assert.equal(L.isNeutral('#646974'), true);
  assert.equal(L.isNeutral('rgba(1,2,3,0.5)'), true);
  assert.equal(L.isNeutral('#F99D1C'), false);
});

test('badge text reads on its colour (dark on T1 orange, white on bus blue and metro)', () => {
  assert.equal(L.badgeLook('T1', 'train', '#F99D1C').fg, '#111111');
  assert.equal(L.badgeLook('M1', 'metro').fg, '#FFFFFF');
  for (const m of Object.keys(L.MODE_COLOR)) {
    const b = L.badgeLook('1', m);
    assert.equal(b.fg, th.onColor(b.bg), m);
  }
  assert.equal(L.badgeLook('333', 'bus').label, 'Bus 333');
  assert.equal(L.badgeLook('', 'ferry').label, 'Ferry');
});

test('theme mode colours match the badge colours', () => {
  for (const [k, v] of Object.entries(L.MODE_COLOR)) assert.equal(th.modeColor[k], v, k);
});

test('one badge component everywhere: no second badge style, no size variants', () => {
  const files = walk('src');
  const t = read('src/components/Transit.tsx');
  assert.match(t, /export function LineBadge[\s\S]*?badgeLook\(/);
  assert.doesNotMatch(t, /badgeSm/);
  for (const f of files) {
    const s = read(f);
    assert.doesNotMatch(s, /function MiniBadge/, f);
    assert.doesNotMatch(s, /<LineBadge[^>]*\bsmall\b/, f);
    assert.doesNotMatch(s, /'#888888'/, `${f}: no grey fallback for a line colour`);
  }
});

test('swipe rows: one shared component, action hidden at rest and clipped to the card', () => {
  const sw = read('src/components/Swipe.tsx');
  assert.match(sw, /progress\.value > 0\.001 \? 1 : 0/, 'the action draws only once the row moves');
  assert.match(sw, /containerStyle=\{style\}/);
  assert.match(sw, /overflow: 'hidden'/);
  assert.match(sw, /openRow\.close\(\)/, 'opening a row closes the open one');
  assert.match(sw, /accessibilityActions/);
  assert.match(sw, /overshootRight=\{false\}/);
  for (const f of walk('src')) if (f !== path.join('src', 'components', 'Swipe.tsx')) assert.doesNotMatch(read(f), /ReanimatedSwipeable/, `${f} uses SwipeRow`);
  const home = read('src/app/(tabs)/home/index.tsx');
  assert.match(home, /<SwipeRow act=\{del\} style=\{CARD_SWIPE\}>\s*<TripBoard [^>]*\bflush\b[^>]*act=\{del\}/);
  const hc = read('src/components/Home.tsx');
  assert.match(hc, /flush && \{ marginHorizontal: 0, marginTop: 0 \}/);
  assert.match(hc, /\{\.\.\.swipeA11y\(act\)\}/);
  assert.match(read('src/components/Transit.tsx'), /<SwipeRow act=\{act\}>/);
});

test('regional trains and coaches with a route number show what they are, the number stays in the label', () => {
  const x = L.badgeLook('427', 'train', '#495054', { kind: true });
  assert.equal(x.text, 'Regional');
  assert.equal(x.label, 'Regional train 427');
  assert.equal(x.bg, '#F6891F');
  assert.equal(L.badgeLook('590', 'coach', null, { kind: true }).text, 'Coach');
  assert.equal(L.badgeLook('590', 'coach', null, { kind: true }).label, 'Coach 590');
  // Route chips (no kind) keep the number so every route is told apart.
  assert.equal(L.badgeLook('427', 'train', null).text, '427');
  assert.equal(L.badgeLook('590', 'coach', null).text, '590');
  // Lines with letters and buses keep their name.
  assert.equal(L.badgeLook('T1', 'train', '#F99D1C').text, 'T1');
  assert.equal(L.badgeLook('CCN', 'train', null).text, 'CCN');
  assert.equal(L.badgeLook('427', 'bus', null, { kind: true }).text, '427');
  assert.equal(L.badgeLook('M1', 'metro', null).text, 'M1');
});

test('departure rows, recently departed and the service header ask for the kind word; route chips do not', () => {
  const rd = (p) => fs.readFileSync(path.join(here, '..', 'src', p), 'utf8');
  assert.match(rd('components/Transit.tsx'), /<LineBadge line=\{d\.line\} mode=\{d\.mode\} color=\{d\.color\} kind \/>/);
  assert.match(rd('components/LeftRow.tsx'), /color=\{d\.color\} kind \/>/);
  assert.match(rd('app/service.tsx'), /color=\{color\} kind \/>/);
  assert.match(rd('app/stop/[id].tsx'), /<LineBadge line=\{r\.line\} mode=\{r\.mode\} color=\{r\.color\} \/>/);
});
