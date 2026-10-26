// Speed audit g13 (26 Oct): rows of live data keyed by their own service (never their place in the list), and a
// fresh start that reads the profile, settings, saved places and every kept copy at once instead of one after another.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-speed13-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const rk = await load('src/lib/rowKeysCore.ts');
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

test('stable keys: unique, in order, and a row keeps its key when the row above it leaves', () => {
  assert.deepEqual(rk.stableKeys(['a', 'b', 'a', 'a']), ['a', 'b', 'a#2', 'a#3']);
  const before = rk.withKeys(['T1|9:00', 'T2|9:05', 'T3|9:10'], (x) => x).map((r) => r.k);
  const after = rk.withKeys(['T2|9:05', 'T3|9:10', 'T4|9:15'], (x) => x).map((r) => r.k);
  assert.deepEqual(before.slice(1), after.slice(0, 2));
});

test('live lists no longer put the row number in the key', () => {
  for (const [rel, bad] of [
    ['src/app/board.tsx', 'key={r.key + i}'],
    ['src/app/trip.tsx', 'key={jKey(j) + i}'],
    ['src/app/stop/[id].tsx', 'key={key + i}'],
    ['src/components/Home.tsx', '|${i}`}'],
  ]) {
    assert.ok(!read(rel).includes(bad), `${rel} still keys rows by position`);
  }
});

test('fresh start: one boot reads profile, settings, saved places and kept copies together', () => {
  const boot = read('src/lib/boot.ts');
  for (const s of ['initProfile', 'loadCachedConfig', 'loadStore', 'warmOffline', 'loadPacks', 'Promise.all']) assert.ok(boot.includes(s), s);
  const layout = read('src/app/_layout.tsx');
  assert.ok(layout.includes('bootLocal()'));
  const off = read('src/lib/offline.ts');
  assert.ok(off.includes('multiGet'), 'kept copies are read in one go');
});

test('widgets and the trip card: the same value is not written twice, and widgets reload only on a change or on opening', () => {
  const b = read('platform/iosBridge.ts');
  assert.ok(b.includes('const sharedLast = new Map'));
  assert.ok(!/iosNative\.setJSON\('(liveCard|homeWork|starredStops)'/.test(b), 'every shared key goes through putJSON');
  assert.ok(b.includes('if (changed || force) iosNative.reloadWidgets();'));
  assert.ok(b.includes("shareWidgetData(true)"), 'opening the app still reloads them');
});
