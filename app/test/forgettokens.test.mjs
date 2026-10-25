// Delete all my data, part two: what the app makes of the push server's answer, and the phone push token mark
// (platform/livePushCore.ts, used by src/lib/forgetTokens.ts and platform/livePush.ts).
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-forget-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const m = await load('platform/livePushCore.ts');
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

test('the forget call goes to the push server route, which is the new host', () => {
  assert.equal(m.PUSH_BASE, 'https://api.transportsydney.app');
  assert.equal(m.FORGET_PATH, '/api/live-activity/forget');
});

test('answers: 2xx deleted, 404 and 405 quietly unavailable, anything else or no answer failed', () => {
  assert.equal(m.forgetOutcome(200), 'deleted');
  assert.equal(m.forgetOutcome(204), 'deleted');
  assert.equal(m.forgetOutcome(404), 'unavailable');
  assert.equal(m.forgetOutcome(405), 'unavailable');
  assert.equal(m.forgetOutcome(500), 'failed');
  assert.equal(m.forgetOutcome(429), 'failed');
  assert.equal(m.forgetOutcome(null), 'failed');
});

test('when the app already uses the push server, Delete all my data deleted the tokens there and no second call is made', () => {
  assert.equal(m.forgetOutcome(null, true), 'not_needed');
  assert.equal(m.forgetOutcome(500, true), 'not_needed');
  const src = read('src/lib/forgetTokens.ts');
  assert.match(src, /if \(apiBase\(\) === PUSH_BASE\) return forgetOutcome\(null, true\)/);
});

test('the phone push token is sent only with notifications allowed and not after Delete all my data', () => {
  assert.equal(m.shouldSendDeviceToken(true, null), true);
  assert.equal(m.shouldSendDeviceToken(false, null), false);
  assert.equal(m.shouldSendDeviceToken(true, '1'), false);
  assert.match(read('platform/livePush.ts'), /shouldSendDeviceToken\(!!p\?\.granted, forgotten\)/);
  // Turning alerts on again clears the mark.
  assert.match(read('src/lib/push.ts'), /await allowPushTokens\(\);/);
});

test('Delete all my data calls the forget step, keeps its mark through the storage wipe, and only an iPhone failure is mentioned', () => {
  const s = read('src/app/(tabs)/settings/index.tsx');
  const del = s.slice(s.indexOf('const deleteAll'), s.indexOf('const turnOn'));
  assert.ok(del.indexOf('api.deleteHistory(\'all\')') < del.indexOf('forgetPushTokens()'), 'the main delete runs first');
  assert.match(del, /PUSH_FORGOTTEN_KEY\]\.includes\(k\)/);
  assert.match(del, /tokens === 'failed' && Platform\.OS === 'ios'/);
  assert.doesNotMatch(del, /[\u2013\u2014]/);
});
