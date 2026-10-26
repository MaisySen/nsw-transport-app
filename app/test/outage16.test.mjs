// Outage honesty (g16, 26 Oct 2026, Bidur's screenshots at 2:52 PM): the commute card said "No more services today"
// while the Trip Planner refused us, Nearby showed "Something went wrong (502)", Ask said "Check your signal" on 5G.
// Also DIAGNOSIS_LAG.md items 3, 5, 6 and 7: one trip deadline, no old server fallback after an answer or time out,
// shorter reads, and the copy on the phone on a 5xx or 429.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-outage-'));
async function load(rel) {
  const js = ts.transpileModule(fs.readFileSync(path.join(root, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const N = await load('src/lib/netErrCore.ts');
const O = await load('src/lib/offlineCore.ts');
const L = await load('src/lib/longTripCore.ts');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('the commute card never says "No more services today" from a kept copy while the live answer failed', () => {
  const base = { data: true, count: 0, offlineAt: null, staleAt: null, serverNote: null };
  assert.equal(N.tripNote({ ...base, error: 'Live trips are unavailable right now because Transport for NSW isn\'t answering. Try again soon.', why: 'server' }), 'Live trips unavailable right now');
  assert.equal(N.tripNote({ ...base, error: null, staleAt: Date.now() - 2 * 3600000, why: 'phone' }), 'Loading live times');
  assert.equal(N.tripNote({ ...base, error: null, offlineAt: Date.now() - 60000, why: 'server' }), 'Live trips unavailable right now');
  assert.equal(N.tripNote({ ...base, error: null, offlineAt: Date.now() - 60000, why: 'phone' }), 'No kept times left for today');
  assert.equal(N.tripNote({ ...base, error: null, why: 'phone' }), 'No more services today', 'a live answer with none still says so');
  assert.equal(N.tripNote({ ...base, count: 2, error: 'x', why: 'server' }), '');
  assert.equal(N.boardNote({ offlineAt: null, error: 'x', staleAt: null, why: 'server' }), 'Live times unavailable right now');
  assert.equal(N.boardNote({ offlineAt: null, error: null, staleAt: null, why: 'server' }), 'No more services right now');
});

test('no status code ever reaches a person, and the server\'s own words are used', () => {
  assert.equal(N.httpMessage(502, {}), N.MSG.upstream);
  assert.equal(N.httpMessage(429, null), N.MSG.upstream);
  assert.equal(N.httpMessage(503, { kind: 'error', text: 'Live data from Transport for NSW isn\'t available right now. Try again soon.' }), 'Live data from Transport for NSW isn\'t available right now. Try again soon.');
  assert.equal(N.httpMessage(400, { error: 'Give stop=id' }), 'Give stop=id');
  assert.equal(N.httpMessage(500, { error: 'Something went wrong (500)' }), N.MSG.upstream);
  const e = N.httpError(502, {});
  assert.equal(e.http, 502); assert.equal(e.server, true);
  assert.doesNotMatch(e.message, /\d{3}/);
  // Nowhere in the app builds a "Something went wrong (NNN)" message any more.
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(path.join(d, x.name)) : /\.tsx?$/.test(x.name) ? [path.join(d, x.name)] : []));
  for (const f of walk(path.join(root, 'src'))) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /Something went wrong \(\$\{/, f);
});

test('Ask blames the phone only when the phone has no connection', () => {
  assert.match(N.askFailText({ http: 502, server: true }), /Transport for NSW/);
  assert.doesNotMatch(N.askFailText({ http: 502, server: true }), /signal/);
  assert.match(N.askFailText({ offline: true }), /Check your signal/);
  assert.match(N.askFailText({ slow: true, server: true }), /not your connection/);
  assert.match(read('src/app/(tabs)/ask/index.tsx'), /const text = askFailText\(e\);/);
});

test('no answer in time while the server answered lately is slow live data; no connection at all is offline', () => {
  const now = 5_000_000;
  N.noteReach(now - 10000);
  const slow = N.noAnswerError({ name: 'AbortError', message: 'Aborted' }, now);
  assert.equal(slow.slow, true); assert.equal(slow.message, N.MSG.slow); assert.equal(N.failWhy(), 'server');
  const off = N.noAnswerError(new TypeError('Network request failed'), now);
  assert.equal(off.offline, true); assert.equal(off.message, N.MSG.offline); assert.equal(N.failWhy(), 'phone');
  const old = N.noAnswerError({ name: 'AbortError', message: 'Aborted' }, now + 10 * 60000);
  assert.equal(old.offline, true, 'nothing reached for minutes: the phone');
});

test('kept times show on a 5xx, 429, slow answer or no connection, and their label says why', () => {
  for (const e of [{ http: 502 }, { http: 503, server: true }, { http: 429 }, { slow: true }, { offline: true }]) assert.equal(N.showsKept(e), true, JSON.stringify(e));
  assert.equal(N.showsKept({ http: 404 }), false);
  assert.match(read('src/lib/hooks.ts'), /if \(showsKept\(e\)\) \{/);
  const at = Date.now() - 5 * 60000;
  O.setOfflineWhy('server');
  assert.match(O.offlineText(at, Date.now()), /^Live times unavailable, showing times from /);
  assert.equal(O.offlineWord(), 'No live times');
  O.setOfflineWhy('phone');
  assert.match(O.offlineText(at, Date.now()), /^Offline, showing times from /);
});

test('the old server only when the new one cannot be reached; a refusal is not "too slow"; one trip deadline', () => {
  assert.equal(N.legacyWorthy(new TypeError('Network request failed')), true);
  assert.equal(N.legacyWorthy({ name: 'AbortError' }), false);
  assert.equal(N.legacyWorthy({ http: 502 }), false);
  assert.equal(L.plannerTooSlow({ http: 502 }), false);
  assert.equal(L.plannerTooSlow({ http: 429 }), false);
  // 13 s from 27 Oct: comfortably past the server's own longest wait for a plain trip (coldopen.test.mjs checks both).
  assert.equal(N.TRIP_MS, 13000);
  assert.ok(N.TRIP_MS >= N.SERVER_TRIP_ANSWER_MS + 4000);
  assert.ok(N.READ_MS_WITH_COPY <= 8000 && N.READ_MS_EMPTY <= 15000);
  const a = read('src/lib/api.ts');
  assert.match(a, /if \(alt && legacyWorthy\(e\)\) \{/);
  assert.match(a, /undefined, TRIP_MS\);/);
  assert.doesNotMatch(a, /return tripLong\(base, opts\.refresh\);\n    \}\n  \},/, 'no 45 s second ask after a failed trip search');
});
