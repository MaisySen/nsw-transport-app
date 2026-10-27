// Network pass (27 Oct, 9 PM): tags on polled answers. The phone keeps the last answer per polled address with its tag
// (memory only, bounded), sends the tag back while the server says poll-tags, and a 304 hands back the kept answer with
// the server clock from x-now. Delete all my data clears it.
// Run: TZ=Australia/Sydney OFFLINE=1 node --test test/polltags.test.mjs
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-polltags-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const P = await load('src/lib/pollTagCore.ts');

test('polled addresses only', () => {
  for (const p of ['/api/departures?stop=1', '/api/service?trip=x', '/api/trip/live?legs=a', '/api/trip?from=1&to=2', '/api/alerts?q=T1', '/api/parking', '/api/lines?l=T1', '/api/trackwork?t=a', '/api/status?trip=x']) assert.ok(P.pollTagWorthy(p), p);
  for (const p of ['/api/search?q=st', '/api/saved', '/api/watches', '/api/home?p=x', '/api/departuresx', '/api/app/config']) assert.equal(P.pollTagWorthy(p), false, p);
});

test('tag header values', () => {
  assert.equal(P.pollTag('"abc"'), '"abc"');
  assert.equal(P.pollTag('W/"abc"'), 'W/"abc"');
  assert.equal(P.pollTag('abc'), null);
  assert.equal(P.pollTag(null), null);
  assert.equal(P.pollTag('"' + 'a'.repeat(100) + '"'), null);
});

test('a kept answer comes back on a 304 with the server clock', () => {
  const s = P.createPollTags();
  const text = JSON.stringify({ kind: 'departures', items: [{ planned: 'x' }], now: 1000, dataAt: 900 });
  s.keep('k', '"t1"', text, 5000);
  assert.equal(s.tagFor('k', 6000), '"t1"');
  assert.equal(s.textFor('k', '"t1"'), text);
  assert.equal(s.textFor('k', '"t2"'), null);
  const b = P.withNow(text, '777777', 1);
  assert.equal(b.now, 777777);
  assert.equal(b.dataAt, 900, 'dataAt is never moved');
  assert.equal(P.withNow(text, null, 42).now, 42);
  assert.equal(P.withNow(JSON.stringify({ items: [] }), '5', 1).now, undefined, 'no now is added');
});

test('old, oversized and untagged answers are not kept', () => {
  const s = P.createPollTags();
  s.keep('a', null, '{}', 0);
  assert.equal(s.tagFor('a', 0), null);
  s.keep('b', '"t"', 'x'.repeat(P.POLL_TAG_MAX_CHARS + 1), 0);
  assert.equal(s.tagFor('b', 0), null);
  s.keep('c', '"t"', '{}', 0);
  assert.equal(s.tagFor('c', P.POLL_TAG_MAX_AGE_MS + 1), null);
  assert.equal(s.size(), 0);
});

test('bounded by count and total size, oldest out first', () => {
  const s = P.createPollTags(3, 1000, 2500);
  for (let i = 0; i < 5; i++) s.keep('k' + i, '"t"', '{}', i);
  assert.equal(s.size(), 3);
  assert.equal(s.tagFor('k0', 10), null);
  assert.equal(s.tagFor('k4', 10), '"t"');
  const t = P.createPollTags(10, 1000, 2500);
  for (let i = 0; i < 4; i++) t.keep('k' + i, '"t"', 'x'.repeat(900), i);
  assert.ok(t.chars() <= 2500);
  assert.equal(t.tagFor('k0', 10), null);
  t.clear();
  assert.equal(t.size(), 0);
  assert.equal(t.chars(), 0);
});

test('api.ts sends the tag only for polled GETs while the server says poll-tags, and keeps the answer on a 304', () => {
  const a = read('src/lib/api.ts');
  assert.match(a, /pollTagWorthy\(path\) && serves\(POLL_TAGS, base\)/);
  assert.match(a, /!rest\.method && !rest\.body/);
  assert.match(a, /'if-none-match': sent/);
  assert.match(a, /r\.status === 304 \? sentText : null/);
  assert.match(a, /withNow\(keptText, r\.headers\?\.get\?\.\('x-now'\)/);
  assert.match(a, /keptText == null && !r\.ok/);
  assert.match(a, /pollTags\.keep\(tagKey, pollTag\(/);
  assert.match(read('src/lib/offline.ts'), /pollTags\.clear\(\)/);
  assert.match(a, /api\/search\?\$\{qs\(\{ q \}\)\}`, \{ headers: PUBLIC_OK \}/);
  assert.match(a, /api\/places\?\$\{qs\(\{ q \}\)\}`, \{ signal: ctl\.signal, headers: PUBLIC_OK \}/);
  assert.deepEqual(P.PUBLIC_OK, { 'x-public-ok': '1' });
});
