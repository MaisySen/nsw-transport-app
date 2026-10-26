// The latest answer rule (useLive in src/lib/hooks.ts, createLatest and createStamp in src/lib/pollCore.ts).
// 26 Oct 2026, 12:00 AM: on a real iPhone, Platform view showed a stop list that belonged to the train shown a moment
// before. The answer for the old service was still on its way when the screen moved to the next one, and it landed
// under the new one. These tests replay that race, and the ones like it on every screen that loads data.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-race-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const P = await load('src/lib/pollCore.ts');
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

// A request whose answer arrives when the test says so.
function later() { let ok, no; const p = new Promise((a, b) => { ok = a; no = b; }); return { p, ok, no }; }

// The same steps useLive takes, without React: start a round per key, ask, apply only the current round's answer.
function screen() {
  const L = P.createLatest();
  const shown = [];
  const asked = [];
  const run = async (key, req) => {
    const r = L.begin();
    if (!r) return 'skipped';
    asked.push(key);
    try { const d = await req.p; if (r.current()) shown.push(d); return r.current() ? 'applied' : 'dropped'; }
    catch { return r.current() ? 'failed' : 'dropped'; }
    finally { r.end(); }
  };
  return { L, shown, asked, open: (key, req) => { L.next(); return run(key, req); }, poll: (key, req) => run(key, req) };
}

test('an answer for the service shown before never lands under the new one', async () => {
  const s = screen();
  const a = later(), b = later();
  const ra = s.open('trip A', a);
  const rb = s.open('trip B', b); // the screen moved on while A was still out
  b.ok('stops of B');
  a.ok('stops of A'); // A arrives last, as on the phone
  assert.equal(await rb, 'applied');
  assert.equal(await ra, 'dropped');
  assert.deepEqual(s.shown, ['stops of B']);
});

test('the new key asks at once instead of waiting behind the old request', async () => {
  const s = screen();
  const a = later(), b = later();
  s.open('stop 1', a);
  const rb = s.open('stop 2', b);
  assert.deepEqual(s.asked, ['stop 1', 'stop 2']);
  b.ok('board 2');
  assert.equal(await rb, 'applied');
  a.ok('board 1');
});

test('the old round is aborted so a load can stop its follow up steps', () => {
  const L = P.createLatest();
  L.next();
  const r1 = L.begin();
  L.next();
  assert.equal(r1.signal.aborted, true);
  assert.equal(r1.current(), false);
  const r2 = L.begin();
  assert.equal(r2.signal.aborted, false);
  assert.equal(r2.current(), true);
});

test('within one round only one request is out at a time', async () => {
  const s = screen();
  const a = later();
  const r1 = s.open('stop 1', a);
  assert.equal(await s.poll('stop 1', later()), 'skipped');
  a.ok('board');
  assert.equal(await r1, 'applied');
  const b = later();
  const r2 = s.poll('stop 1', b);
  b.ok('board again');
  assert.equal(await r2, 'applied');
  assert.deepEqual(s.shown, ['board', 'board again']);
});

test('a failure for an old round is not shown on the new one', async () => {
  const s = screen();
  const a = later(), b = later();
  const ra = s.open('time 8:00', a);
  const rb = s.open('time 9:00', b);
  a.no(new Error('offline'));
  b.ok('9:00 board');
  assert.equal(await ra, 'dropped');
  assert.equal(await rb, 'applied');
});

test('a closed screen drops what is still on its way', async () => {
  const s = screen();
  const a = later();
  const ra = s.open('stop 1', a);
  s.L.next(); // closed
  a.ok('board');
  assert.equal(await ra, 'dropped');
  assert.deepEqual(s.shown, []);
});

test('many quick switches keep only the last answer, whatever order they come back in', async () => {
  const s = screen();
  const reqs = Array.from({ length: 6 }, later);
  const runs = reqs.map((r, i) => s.open('key ' + i, r));
  for (const i of [3, 0, 5, 1, 4, 2]) reqs[i].ok('answer ' + i);
  await Promise.all(runs);
  assert.deepEqual(s.shown, ['answer 5']);
});

test('one off loads: a batch for the old query is not added to the new list', () => {
  const st = P.createStamp('Central>Hornsby|now');
  const still = st.stamp();
  st.setKey('Central>Hornsby|now');
  assert.equal(still(), true, 'same key, same answer');
  st.setKey('Central>Hornsby|9:00');
  assert.equal(still(), false);
  const again = st.stamp();
  assert.equal(again(), true);
  st.close();
  assert.equal(again(), false, 'closed screen');
});

// Every screen that loads data goes through the rule (audit of 26 Oct 2026).
test('useLive uses the latest answer rule and has no shared busy flag', () => {
  const h = read('src/lib/hooks.ts');
  assert.match(h, /createLatest\(\)/);
  assert.match(h, /round\.current\(\)/);
  assert.doesNotMatch(h, /busy\.current/);
  assert.doesNotMatch(h, /key !== keyRef\.current/, 'the old check covered only screens with a cache key');
  assert.match(h, /export function useStamp/);
});

test('one off loads on the trip list, Simple mode, walk search, next option and the live trip are guarded', () => {
  const trip = read('src/app/trip.tsx');
  assert.match(trip, /useStamp\(listKey\)/);
  assert.ok((trip.match(/if \(!still\(\)\) return/g) || []).length >= 4, 'batches, later and earlier');
  assert.match(trip, /if \(still\(\)\) setExtra/, 'Plan B');
  assert.match(trip, /\[listKey\]\);/, 'batches for an old trip go when the trip changes');
  const simple = read('src/app/simple.tsx');
  assert.match(simple, /useStamp\(/);
  assert.match(simple, /if \(!still\(\)\) return;\s*\n\s*setExtra/);
  const nt = read('src/app/new-trip.tsx');
  assert.match(nt, /if \(!live\) return; setErr\(''\); setItems/);
  const smart = read('src/components/Smart.tsx');
  assert.ok((smart.match(/if \(keyRef\.current !== k\) return;/g) || []).length >= 2);
  const eng = read('src/lib/liveEngine.ts');
  assert.match(eng, /gen !== cacheGen/);
});

test('screens with kept copies label them, never as live', () => {
  for (const f of ['src/app/stop/[id].tsx', 'src/app/board.tsx', 'src/app/trip.tsx', 'src/app/simple.tsx', 'src/app/service.tsx']) {
    const s = read(f);
    assert.match(s, /staleAt/, f);
  }
  assert.match(read('src/app/service.tsx'), /cacheKey\('svc'/);
  assert.match(read('src/components/Transit.tsx'), /export function KeptBanner/);
});

test('startup: the first screen asks for its times before the config, alerts and Last way home rechecks', () => {
  const l = read('src/app/_layout.tsx');
  assert.match(l, /const STARTUP_DEFER_MS = \d+;/);
  assert.match(l, /setTimeout\(\(\) => \{ later = null; finishProfileMove\(api\)\.then\(\(\) => finishServerMove\(\)\); refreshConfig\(true\); \}, STARTUP_DEFER_MS\)/);
  assert.match(l, /setTimeout\(\(\) => \{ pollNotes\(\); recheckLastLocal\(\)/);
  assert.doesNotMatch(l, /\n\s*pollNotes\(\);\n/);
  assert.match(l, /clearTimeout\(first\)/);
});

test('sharedOnce: calls while the first is loading share it; one id on a fresh install', async () => {
  const store = new Map();
  let made = 0;
  const slow = (v) => new Promise((ok) => setTimeout(() => ok(v), 5));
  const get = P.sharedOnce(async () => {
    let id = await slow(store.get('device') || null);
    if (!id) { id = 'app' + (++made); await slow(store.set('device', id)); }
    return id;
  });
  const ids = await Promise.all([get(), get(), get()]);
  assert.deepEqual(ids, ['app1', 'app1', 'app1']);
  assert.equal(made, 1);
  assert.equal(await get(), 'app1');
  assert.equal(store.get('device'), 'app1');
});

test('sharedOnce: a failure is not kept, the next call tries again', async () => {
  let n = 0;
  const get = P.sharedOnce(async () => { n++; if (n === 1) throw new Error('storage busy'); return 'ok'; });
  await assert.rejects(get(), /storage busy/);
  assert.equal(await get(), 'ok');
  assert.equal(n, 2);
});

test('getDevice goes through sharedOnce', () => {
  const src = read('src/lib/device.ts');
  assert.match(src, /sharedOnce\(/);
});

test('notesWaitMs: no push token and nothing watched asks once a minute; watching with no token every tick', () => {
  assert.equal(P.notesWaitMs(true, true), 55000);
  assert.equal(P.notesWaitMs(true, false), 55000);
  assert.equal(P.notesWaitMs(false, false), 55000);
  assert.equal(P.notesWaitMs(false, true), 0);
  const push = read('src/lib/push.ts');
  assert.match(push, /notesWaitMs\(!!tokenKnown, watching\)/);
  assert.match(push, /watchingNow = Array\.isArray\(r\?\.items\)/);
  assert.match(read('src/lib/api.ts'), /watchClock\.startedAt = Date\.now\(\)/);
});
