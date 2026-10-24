// Station map: the link is read from the stop's own transportnsw.info page (recorded 25 Oct 2026), never guessed.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-smap-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const m = await load('src/lib/stationMapCore.ts');
const pages = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'tfnsw-stop-pages.json'), 'utf8'));

test('real pages: the listed station map is picked', () => {
  assert.deepEqual(m.parseStationMap(pages['201510']), { url: 'https://transportnsw.info/document/3487/redfern-station-map.pdf', label: 'Redfern - Train - station map' });
  assert.equal(m.parseStationMap(pages['215020']).url, 'https://transportnsw.info/document/3322/parramatta-station-guide.pdf');
  assert.equal(m.parseStationMap(pages['200070']).url, 'https://transportnsw.info/document/3521/town-hall-station-map.pdf');
  assert.equal(m.parseStationMap(pages['200060']).url, 'https://transportnsw.info/document/7272/central-area-guide.pdf');
});

test('a page with no maps list gives no button', () => {
  assert.equal(m.parseStationMap(pages['200080']), null);
  assert.equal(m.parseStationMap(''), null);
  assert.equal(m.parseStationMap(undefined), null);
});

test('bus and stop guides alone are not a station map; a station guide is', () => {
  const L = (label) => ({ url: 'https://transportnsw.info/document/1/x.pdf', label });
  assert.equal(m.pickStationMap([L('Town Hall - Bus interchange guide'), L('Town Hall - Stop guide')]), null);
  assert.equal(m.pickStationMap([L('Redfern - Train - local area map')]), null);
  assert.equal(m.pickStationMap([L('Martin Place station guide metro')]).label, 'Martin Place station guide metro');
  assert.equal(m.pickStationMap([L('A station guide'), L('B - Station map')]).label, 'B - Station map');
});

test('only document PDFs on transportnsw.info, labels cleaned', () => {
  const html = 'x Public transport maps <a href="https://evil.example/document/1/a-station-map.pdf">Evil station map</a> <a class="k" href="/document/12/b-station-map.pdf"><span>B&nbsp;&amp; C</span> station map</a>';
  assert.deepEqual(m.mapLinks(html), [{ url: 'https://transportnsw.info/document/12/b-station-map.pdf', label: 'B & C station map' }]);
});

test('stop page address and how long answers are kept', () => {
  assert.equal(m.stopPageUrl('201510'), 'https://transportnsw.info/stop?q=201510');
  const now = Date.now();
  assert.equal(m.cacheFresh({ at: now - 6 * 86400000, map: { url: 'u' } }, now), true);
  assert.equal(m.cacheFresh({ at: now - 8 * 86400000, map: { url: 'u' } }, now), false);
  assert.equal(m.cacheFresh({ at: now - 2 * 86400000, map: null }, now), false);
  assert.equal(m.cacheFresh({ at: now - 3600000, map: null }, now), true);
  assert.equal(m.cacheFresh(null, now), false);
});
