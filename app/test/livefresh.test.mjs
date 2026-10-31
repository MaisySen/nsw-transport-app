// Live trip freshness (src/lib/liveFreshCore.ts, 29 Oct): refresh asks for a leg already answered, and the trip card
// not overwritten by the app's older times while the server pushes it.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-livefresh-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const m = await load('src/lib/liveFreshCore.ts');
const NOW = Date.parse('2026-10-30T08:00:00+11:00');

test('first ask for a leg is a plain open; asks for a leg already answered are refreshes', () => {
  const q = { trip: 'A.1', mode: 'train', line: 'T1', stop: '2000336', planned: '2026-10-30T08:10:00+11:00' };
  assert.deepEqual(m.liveServiceQuery(q, false), q);
  assert.equal(m.liveServiceQuery(q, false).refresh, undefined);
  assert.deepEqual(m.liveServiceQuery(q, true), { ...q, refresh: '1' });
  // The ask the engine passes in is not changed.
  assert.equal(q.refresh, undefined);
});

test('the refresh ask goes out as refresh=1, which the shared read cache treats as fresh', () => {
  const q = m.liveServiceQuery({ trip: 'A.1', stop: '1' }, true);
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null)).toString();
  assert.match('/api/service?' + qs, /[?&]refresh=1(&|$)/);
});

test('trip card: going to the background, or with no push, the app always writes it', () => {
  assert.equal(m.appMayWriteCard({ background: true, pushing: true, lastSvcAt: NOW - 600000, now: NOW }), true);
  assert.equal(m.appMayWriteCard({ background: false, pushing: false, lastSvcAt: 0, now: NOW }), true);
  assert.equal(m.appMayWriteCard({ background: false, pushing: false, lastSvcAt: NOW - 600000, now: NOW }), true);
});

test('trip card while the server pushes it: only times from the last 20 seconds overwrite it', () => {
  const at = (age) => m.appMayWriteCard({ background: false, pushing: true, lastSvcAt: NOW - age, now: NOW });
  assert.equal(at(0), true);
  assert.equal(at(15000), true);
  assert.equal(at(m.CARD_FRONT_FRESH_MS), true);
  assert.equal(at(m.CARD_FRONT_FRESH_MS + 1), false);
  assert.equal(at(5 * 60000), false);
  assert.equal(m.appMayWriteCard({ background: false, pushing: true, lastSvcAt: 0, now: NOW }), false);
  // A clock that moved back is not counted as fresh.
  assert.equal(m.appMayWriteCard({ background: false, pushing: true, lastSvcAt: NOW + 5000, now: NOW }), false);
});

test('the engine and the iPhone bridge use these rules', () => {
  const eng = fs.readFileSync(path.join(here, '..', 'src/lib/liveEngine.ts'), 'utf8');
  assert.match(eng, /api\.service\(liveServiceQuery\(\{[^]*?\}, !!svcCache\[i\](, \{ board: wantsBoard\([^]*?\) \})?\)\)/);
  const br = fs.readFileSync(path.join(here, '..', 'platform/iosBridge.ts'), 'utf8');
  assert.match(br, /if \(!appMayWriteCard\(\{ background, pushing: !!activityToken, lastSvcAt, now: Date\.now\(\) \}\)\) return;/);
  // The guard comes after shareToken and before the card is compared and written.
  const i = br.indexOf('appMayWriteCard({'), j = br.indexOf('const j = JSON.stringify({ ...card');
  assert.ok(i > 0 && j > i);
});
