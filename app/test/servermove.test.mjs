// The move to the new server (26 Oct 2026): start address, read fallback to the first server, honest data time,
// and what the phone carries over (docs/DEPLOY_CLOUDFLARE.md, section 9).
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-move-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const S = await load('src/lib/server.ts');
const M = await load('src/lib/serverMoveCore.ts');
const L = await load('src/lib/liveLabelCore.ts');
const NEW = 'https://api.transportsydney.app';
const OLD = 'https://nsw-transport-' + 'bot.sites.' + 'tab' + '.bot'; // the first server's old address, switched off 30 Oct 2026

test('the app starts on the new server; the first server is no longer allowed (switched off 30 Oct 2026)', () => {
  assert.equal(S.DEFAULT_BASE, NEW);
  assert.equal(S.apiBase(), NEW);
  assert.equal(S.validBase(OLD, NEW), null, 'remote config can no longer move the app to the old address');
  assert.equal(S.nextBase({ copy: {} }, NEW), NEW, 'a config with no api_base means the new server');
  assert.equal(S.nextBase({ api_base: OLD }, NEW), NEW, 'a config naming the old address is ignored');
});

test('startBase: a stored first server is always replaced; an allowed stored address is used as it is', () => {
  assert.equal(S.startBase(null, false), NEW);
  assert.equal(S.startBase(OLD, false), NEW, 'first launch on this update moves off the first server');
  assert.equal(S.startBase(OLD + '/', false), NEW);
  assert.equal(S.startBase(OLD, true), NEW, 'even after a move back, the old address is not used');
  assert.equal(S.startBase(NEW, false), NEW);
  assert.equal(S.startBase('https://api.api.transportsydney.app', true), 'https://api.api.transportsydney.app');
  assert.equal(S.startBase('https://evil.example', true), NEW, 'a stored value off the list is ignored');
});

test('no fallback: the first server is switched off, so every read goes to the address in use', () => {
  assert.equal(S.fallbackWorthy({ http: 500 }), false);
  assert.equal(S.fallbackWorthy({ name: 'AbortError' }), false);
  assert.equal(S.fallbackWorthy(new TypeError('Network request failed')), true);
  assert.equal(S.fallbackFor(NEW), null);
  assert.equal(S.fallbackFor(OLD), null);
  const t = 1_000_000;
  S.noteFallback(true, t);
  assert.equal(S.readBase(t + 1), NEW);
  S.noteFallback(false);
  assert.equal(S.readBase(), NEW);
});

test('getJson: asks only the address in use, never the old address', async () => {
  const real = globalThis.fetch;
  const asked = [];
  try {
    globalThis.fetch = async (url) => { asked.push(String(url)); return new Response('{"kind":"error","text":"x"}', { status: 502 }); };
    await assert.rejects(S.getJson('/api/stations?mode=train'), (e) => e.http === 502 && !/\(502\)/.test(e.message));
    assert.deepEqual(asked, [NEW + '/api/stations?mode=train']);
    asked.length = 0;
    globalThis.fetch = async (url) => { asked.push(String(url)); throw new TypeError('Network request failed'); };
    await assert.rejects(S.getJson('/api/stations?mode=bus'));
    assert.deepEqual(asked, [NEW + '/api/stations?mode=bus'], 'no connection: no second ask anywhere');
    asked.length = 0;
    globalThis.fetch = async (url) => { asked.push(String(url)); return new Response('[2]'); };
    assert.deepEqual(await S.getJson('/api/stations?mode=bus'), [2]);
    assert.deepEqual(asked, [NEW + '/api/stations?mode=bus']);
  } finally { globalThis.fetch = real; S.noteNewServerOk(); }
});

test('api.ts reads fall back, writes do not; one retry never after a time out', () => {
  const a = read('src/lib/api.ts');
  assert.match(a, /const first = read \? readBase\(\) : apiBase\(\);/);
  assert.match(a, /const alt = read \? fallbackFor\(first\) : null;/);
  assert.match(a, /if \(e\?\.name === 'AbortError' \|\| Date\.now\(\) - t0 > timeoutMs \/ 2\) throw e;/);
  assert.match(read('src/lib/trips.ts'), /getJsonTagged\(path, 25000\)/);
  assert.match(read('src/lib/etag.ts'), /getJson<T>\(path, timeoutMs, undefined, \{ tag:/);
  // The address is written in server.ts only.
  assert.doesNotMatch(a, /sites\.tab\.bot/);
});

test('honest "Updated": a cached answer keeps the time it was read', async () => {
  const now = Date.parse('2026-10-26T08:00:00Z');
  const a = read('src/lib/api.ts');
  assert.match(a, /stampSeen\((?:cleanAlertTexts\()?body as T\)?, dataTime\(body, Date\.now\(\)\)(?:, LIVE_DATA_AGE \? Date\.now\(\) : undefined)?\)/);
  assert.equal(L.answerTime({ seenAt: now - 9000 }, now), now - 9000);
  assert.equal(L.answerTime({ seenAt: now + 9000 }, now), now, 'never in the future');
  // 28 Oct liveness pass: an older answer keeps its own time (up to 15 minutes back), so "Updated" never says now.
  assert.equal(L.answerTime({ seenAt: now - 600000 }, now), now - 600000, 'a 10 minute old answer keeps its time');
  assert.equal(L.answerTime({ seenAt: now - 3600000 }, now), now - 900000, 'at most 15 minutes back');
  assert.equal(L.answerTime(null, now), now);
  assert.match(read('src/lib/hooks.ts'), /const at = answerTime\(d, Date\.now\(\)\);/);
  const r = L.stampSeen({ dataAt: now - 7000, items: [{}] }, now - 7000);
  assert.equal(r.items[0].seenAt, now - 7000);
});

test('morning checks: copy what the new server lacks, once, within the per phone limit', () => {
  const c = (from, to, time, days = [1, 2, 3, 4, 5], extra = {}) => ({ id: 'x' + from, name: null, from: { id: from, name: 'A' }, to: { id: to, name: 'B' }, time, days, lead: 15, active: true, mode: null, ...extra });
  const old = [c('213510', '200060', '07:30'), c('213510', '2046100', '17:10', [1, 2, 3, 4, 5], { mode: 'bus', lead: 20 })];
  const moved = M.morningToCopy(old, [c('213510', '200060', '07:30')]);
  assert.equal(moved.length, 1);
  assert.deepEqual(moved[0], { name: null, from: { id: '213510', name: 'A' }, to: { id: '2046100', name: 'B' }, time: '17:10', days: [1, 2, 3, 4, 5], lead: 20, active: true, mode: 'bus' });
  assert.ok(!('id' in moved[0]), 'the new server gives its own id');
  assert.equal(M.morningToCopy(old, [...old]).length, 0, 'running again copies nothing');
  assert.equal(M.morningToCopy(old, [], 1).length, 1, 'never past the limit');
  assert.equal(M.morningToCopy([c('1', '2', '07:00', [])], []).length, 0, 'a check without days is skipped');
  assert.equal(M.morningToCopy(null, null).length, 0);
});

test('the move runs once after launch, keeps the forgotten push token forgotten and never calls the old address', () => {
  const m = read('src/lib/serverMove.ts');
  assert.match(m, /if \(apiBase\(\) !== NEW_API_BASE\) return;/);
  assert.match(m, /await AsyncStorage\.setItem\('profileReupload', '1'\);/);
  assert.match(m, /if \(tok && forgot !== '1'\) await api\.registerExpo\(tok, Platform\.OS, false\);/);
  assert.doesNotMatch(m, /method: 'DELETE'/, 'a forwarded delete would reach the new server');
  assert.doesNotMatch(m, /LEGACY|tab\.bot|fetch\(/);
  assert.match(m, /await AsyncStorage\.setItem\(DONE_KEY, '1'\);/);
  const c = read('src/lib/config.ts');
  assert.match(c, /setApiBase\(startBase\(b, moved === '1'\)\);/);
});
