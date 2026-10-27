// Speed pass 3 (27 Oct 2026): the screens that still waited on the network before their first frame paint from what the
// phone keeps (Watching, a watch's detail, More, morning checks, Opal machines), static lists show their kept copy while
// the version tag is checked behind them, and Delete all my data forgets the kept copies held in memory too. Pure parts
// run here; screen wiring is checked in the source.
// Run: TZ=Australia/Sydney OFFLINE=1 node --test test/speed27c.test.mjs
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-speed27c-'));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

fs.writeFileSync(path.join(out, 'async-storage.mjs'), `const m = new Map();
export default { getItem: async (k) => (m.has(k) ? m.get(k) : null), setItem: async (k, v) => { m.set(k, v); }, multiGet: async (ks) => ks.map((k) => [k, m.has(k) ? m.get(k) : null]), multiRemove: async (ks) => { for (const k of ks) m.delete(k); }, removeItem: async (k) => { m.delete(k); } };`);
const done = new Set();
function emit(rel) {
  if (done.has(rel)) return;
  done.add(rel);
  let js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  js = js.replace(/from '@react-native-async-storage\/async-storage'/g, "from './async-storage.mjs'");
  js = js.replace(/from '\.\/([A-Za-z0-9_]+)'/g, (m, name) => { emit(`src/lib/${name}.ts`); return `from './${name}.mjs'`; });
  fs.writeFileSync(path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs')), js);
}
async function load(rel) { emit(rel); return import(pathToFileURL(path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'))).href); }

const O = await load('src/lib/offlineCore.ts');
const OFF = await load('src/lib/offline.ts');
const E = await load('src/lib/etagCore.ts');

const NOW = Date.parse('2026-10-27T03:40:00Z');
const watch = (id, active = true) => ({ id, kind: 'svc', title: `T1 to Penrith ${id}`, active, created: NOW - 600000, updated: NOW - 60000, expires: NOW + 3600000, legs: [] });

test('list keys: one kept copy per light list, all under the kept copies prefix, a watch per id', () => {
  const keys = [O.LIST_KEYS.watches, O.LIST_KEYS.settings, O.LIST_KEYS.morning, O.LIST_KEYS.topup, O.LIST_KEYS.watch('w1')];
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) assert.match(k, /^offline:list:/);
  assert.notEqual(O.LIST_KEYS.watch('w1'), O.LIST_KEYS.watch('w2'));
});

test('a watch detail paints from the Watching list copy: the same watch, its age, no notes, never kept', () => {
  const list = { at: NOW - 90000, data: { items: [watch('a'), watch('b', false)] } };
  const s = O.watchSeed(list, 'b');
  assert.equal(s.at, NOW - 90000);
  assert.equal(s.data.watch.id, 'b');
  assert.deepEqual(s.data.notes, []);
  assert.equal(s.data.seeded, true);
  assert.equal(O.worthKeeping(s.data), false, 'a seed is never kept on the phone');
  assert.equal(O.watchSeed(list, 'zzz'), null);
  assert.equal(O.watchSeed(null, 'a'), null);
  assert.equal(O.watchSeed({ at: NOW, data: {} }, 'a'), null);
});

test('kept lists: shown on the next first frame, and forgetOffline drops what memory holds', () => {
  OFF.keepOffline(O.LIST_KEYS.watches, { items: [watch('a')] });
  assert.equal(OFF.peekOffline(O.LIST_KEYS.watches).data.items[0].id, 'a');
  OFF.keepOffline(O.LIST_KEYS.settings, { commutes: [], watching: 0 });
  assert.ok(OFF.peekOffline(O.LIST_KEYS.settings));
  // An empty Watching list is not kept (nothing worth painting).
  OFF.keepOffline(O.LIST_KEYS.morning, { items: [], push: {}, enabled: true });
  assert.equal(OFF.peekOffline(O.LIST_KEYS.morning), null);
  OFF.forgetOffline();
  assert.equal(OFF.peekOffline(O.LIST_KEYS.watches), null);
  assert.equal(OFF.peekOffline(O.LIST_KEYS.settings), null);
});

test('static lists show at once while checked behind, only with a tag and a check in the last 7 days', () => {
  assert.equal(E.tagShowsAtOnce({ e: '"v1"', at: NOW - 3600000, n: 10 }, NOW), true);
  assert.equal(E.tagShowsAtOnce({ e: '"v1"', at: NOW - 6 * 86400000, n: 10 }, NOW), true);
  assert.equal(E.tagShowsAtOnce({ e: '"v1"', at: NOW - 8 * 86400000, n: 10 }, NOW), false);
  assert.equal(E.tagShowsAtOnce({ e: '', at: NOW, n: 10 }, NOW), false);
  assert.equal(E.tagShowsAtOnce({ e: '"v1"', at: NOW + 3600000, n: 10 }, NOW), false, 'a clock that jumped back does not count');
  assert.equal(E.tagShowsAtOnce(null, NOW), false);
  assert.equal(E.TAG_SWR_MS, 7 * 86400000);
});

test('screen wiring: each light list screen paints from its kept copy', () => {
  const watching = read('src/app/watching.tsx');
  assert.match(watching, /cacheKey: LIST_KEYS\.watches/);
  assert.match(watching, /staleAt=\{staleAt\}/);
  const detail = read('src/app/watch/[id].tsx');
  assert.match(detail, /cacheKey: id \? LIST_KEYS\.watch\(String\(id\)\)/);
  assert.match(detail, /watchSeed\(peekOffline/);
  assert.match(detail, /seed \}/);
  const more = read('src/app/(tabs)/settings/index.tsx');
  assert.match(more, /cacheKey: LIST_KEYS\.settings/);
  assert.match(more, /forgetOffline\(\);/);
  assert.ok(more.indexOf('forgetOffline();') > more.indexOf('AsyncStorage.multiRemove'), 'memory goes after storage');
  const morning = read('src/app/morning.tsx');
  assert.match(morning, /peekOffline<MorningListResp>\(LIST_KEYS\.morning\)/);
  assert.match(morning, /keepOffline\(LIST_KEYS\.morning, r\)/);
  const topup = read('src/app/topup.tsx');
  assert.match(topup, /peekOffline<\{ items\?: TopupItem\[\] \}>\(LIST_KEYS\.topup\)/);
  assert.match(topup, /map\(\(\{ distance, \.\.\.x \}\) => x\)/, 'kept without distances from where the phone was then');
  const etag = read('src/lib/etag.ts');
  assert.match(etag, /tagShowsAtOnce\(entry, Date\.now\(\)\)/);
  assert.match(etag, /check\(path, timeoutMs, kept, entry\.e\)\.catch/);
});
