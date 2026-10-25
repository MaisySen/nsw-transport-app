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
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const S = await load('src/lib/server.ts');
const M = await load('src/lib/serverMoveCore.ts');
const L = await load('src/lib/liveLabelCore.ts');
const NEW = 'https://api.transportsydney.app';
const OLD = S.LEGACY_BASE;

test('the app starts on the new server; the first server stays allowed', () => {
  assert.equal(S.DEFAULT_BASE, NEW);
  assert.equal(S.apiBase(), NEW);
  assert.equal(S.validBase(OLD, NEW), OLD, 'remote config can still move the app back (Undo)');
  assert.equal(S.nextBase({ copy: {} }, OLD), NEW, 'a config with no api_base means the new server');
});

test('startBase: a stored first server is replaced once, then a stored address is used as it is', () => {
  assert.equal(S.startBase(null, false), NEW);
  assert.equal(S.startBase(OLD, false), NEW, 'first launch on this update moves off the first server');
  assert.equal(S.startBase(OLD + '/', false), NEW);
  assert.equal(S.startBase(OLD, true), OLD, 'after the move, a config that moved it back is kept');
  assert.equal(S.startBase(NEW, false), NEW);
  assert.equal(S.startBase('https://evil.example', true), NEW, 'a stored value off the list is ignored');
});

test('fallback: only no answer or a 5xx, never a 4xx', () => {
  assert.equal(S.fallbackWorthy({ http: 500 }), true);
  assert.equal(S.fallbackWorthy({ http: 503 }), true);
  assert.equal(S.fallbackWorthy({ http: 404 }), false);
  assert.equal(S.fallbackWorthy({ http: 429 }), false);
  assert.equal(S.fallbackWorthy({ name: 'AbortError' }), true);
  assert.equal(S.fallbackWorthy(new TypeError('Network request failed')), true);
  assert.equal(S.fallbackFor(NEW), OLD);
  assert.equal(S.fallbackFor(OLD), null, 'the first server has nothing behind it');
});

test('fallback hold: after a fallback that worked, reads go to the first server for a minute', () => {
  const t = 1_000_000;
  S.noteFallback(true, t);
  assert.equal(S.readBase(t + 1000), OLD);
  assert.equal(S.fallbackHeld(t + 1000), true);
  assert.equal(S.readBase(t + S.FALLBACK_HOLD_MS + 1), NEW, 'then the new server is asked again');
  S.noteFallback(true, Date.now());
  S.noteNewServerOk();
  assert.equal(S.readBase(), NEW, 'an answer from the new server ends the hold');
  S.noteFallback(false);
  assert.equal(S.readBase(), NEW);
});

test('getJson: asks the new server, then the first one on a 5xx or no answer, never on a 4xx', async () => {
  const real = globalThis.fetch;
  const asked = [];
  try {
    globalThis.fetch = async (url) => { asked.push(String(url)); return String(url).startsWith(NEW) ? new Response('{}', { status: 502 }) : new Response('[1]', { status: 200 }); };
    assert.deepEqual(await S.getJson('/api/stations?mode=train'), [1]);
    assert.deepEqual(asked, [NEW + '/api/stations?mode=train', OLD + '/api/stations?mode=train']);
    asked.length = 0;
    assert.deepEqual(await S.getJson('/api/stations?mode=metro'), [1]);
    assert.deepEqual(asked, [OLD + '/api/stations?mode=metro'], 'held on the first server for a minute');
    S.noteNewServerOk();
    asked.length = 0;
    globalThis.fetch = async (url) => { asked.push(String(url)); if (String(url).startsWith(NEW)) throw new TypeError('Network request failed'); return new Response('[2]'); };
    assert.deepEqual(await S.getJson('/api/stations?mode=bus'), [2]);
    S.noteNewServerOk();
    asked.length = 0;
    globalThis.fetch = async (url) => { asked.push(String(url)); return new Response('{"error":"not found"}', { status: 404 }); };
    await assert.rejects(S.getJson('/api/x'), (e) => e.http === 404);
    assert.equal(asked.length, 1, 'a 4xx is the answer');
  } finally { globalThis.fetch = real; S.noteNewServerOk(); }
});

test('api.ts reads fall back, writes do not; one retry never after a time out', () => {
  const a = read('src/lib/api.ts');
  assert.match(a, /const first = read \? readBase\(\) : apiBase\(\);/);
  assert.match(a, /const alt = read \? fallbackFor\(first\) : null;/);
  assert.match(a, /if \(e\?\.name === 'AbortError' \|\| Date\.now\(\) - t0 > timeoutMs \/ 2\) throw e;/);
  assert.match(read('src/lib/trips.ts'), /getJson\(path, 25000\)/);
  // The address is written in server.ts only.
  assert.doesNotMatch(a, /sites\.tab\.bot/);
});

test('honest "Updated": a cached answer keeps the time it was read', async () => {
  const now = Date.parse('2026-10-26T08:00:00Z');
  const a = read('src/lib/api.ts');
  assert.match(a, /stampSeen\(body as T, dataTime\(body, Date\.now\(\)\)\)/);
  assert.equal(L.answerTime({ seenAt: now - 9000 }, now), now - 9000);
  assert.equal(L.answerTime({ seenAt: now + 9000 }, now), now, 'never in the future');
  assert.equal(L.answerTime({ seenAt: now - 600000 }, now), now, 'nothing older than 2 minutes is believed');
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

test('the move runs once after launch, keeps the forgotten push token forgotten and deletes only its own morning checks there', () => {
  const m = read('src/lib/serverMove.ts');
  assert.match(m, /if \(apiBase\(\) !== NEW_API_BASE\) return;/);
  assert.match(m, /await AsyncStorage\.setItem\('profileReupload', '1'\);/);
  assert.match(m, /if \(tok && forgot !== '1'\) await api\.registerExpo\(tok, Platform\.OS, false\);/);
  assert.match(m, /method: 'DELETE'/);
  assert.match(m, /await AsyncStorage\.setItem\(DONE_KEY, '1'\);/);
  const c = read('src/lib/config.ts');
  assert.match(c, /setApiBase\(startBase\(b, moved === '1'\)\);/);
});
