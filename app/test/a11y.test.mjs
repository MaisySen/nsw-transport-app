// Contrast of the Android palette (light and dark) and of text on line colours. The browser check
// (test/e2e/a11y.mjs, axe) covers the screens; this keeps the colours themselves honest.
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
const src = fs.readFileSync(path.join(here, '..', 'src/lib/theme.ts'), 'utf8')
  .replace(/^import .*react-native.*$/m, "const Platform = { OS: 'android' }; const useColorScheme = () => 'light';");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-a11y-')), 'theme.mjs');
fs.writeFileSync(f, js);
const th = await import(pathToFileURL(f).href);

for (const mode of ['light', 'dark']) {
  test(`Android ${mode}: every text colour is at least 4.5:1 on every surface`, () => {
    const p = th.palettes.md[mode];
    const bad = [];
    for (const fg of ['text', 'text2', 'text3', 'tint', 'liveText', 'lateText', 'redText']) {
      for (const bg of ['bg', 'card', 'card2', 'fill']) {
        const r = th.contrast(p[fg], p[bg]);
        if (r < 4.5) bad.push(`${fg} ${p[fg]} on ${bg} ${p[bg]}: ${r.toFixed(2)}`);
      }
    }
    assert.deepEqual(bad, []);
  });
  test(`Android ${mode}: white text on the Trip in progress bar is at least 4.5:1`, () => {
    assert.ok(th.contrast('#FFFFFF', th.palettes.md[mode].liveBg) >= 4.5);
  });
}

test('line badges pick white or dark text with at least 4.5:1 on every mode colour and common line colours', () => {
  const colours = [...Object.values(th.modeColor), '#F99D1C', '#0098CD', '#F37021', '#005AA3', '#00954C', '#D11F2F', '#833134', '#00B5EF', '#5AB031', '#E4022D', '#168388', '#742282', '#888888'];
  const bad = colours.filter((bg) => th.contrast(th.onColor(bg), bg) < 4.5 && th.contrast(th.onColor(bg), bg) < Math.max(th.contrast('#FFFFFF', bg), th.contrast('#111111', bg)));
  assert.deepEqual(bad, []);
  assert.equal(th.onColor('#F99D1C'), '#111111', 'T1 orange gets dark text');
  assert.equal(th.onColor('#742282'), '#FFFFFF');
  assert.ok(['#FFFFFF', '#111111'].includes(th.onColor('rgba(60,60,67,0.3)')), 'a colour that is not #RRGGBB does not crash');
});
