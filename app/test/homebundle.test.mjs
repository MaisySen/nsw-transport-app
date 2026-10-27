// Home in one request (27 Oct): the phone notes Home's reads, asks for them next time as one GET /api/home when the
// server says home-bundle, answers each matching read from it once, and sends anything else on its own. Home cards
// also recover by themselves from a timetable stand in or failures (quiet asks, never minutes apart, and at once on a
// return to the front).
// Run: TZ=Australia/Sydney OFFLINE=1 node --test test/homebundle.test.mjs
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-homebundle-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const B = await load('src/lib/homeBundleCore.ts');
const C = await load('src/lib/coldOpenCore.ts');
const S = await load('src/lib/servesCore.ts');

function clock() {
  let now = 1000, seq = 0;
  const q = new Map();
  return {
    t: { now: () => now, set: (fn, ms) => { const id = ++seq; q.set(id, { at: now + ms, fn }); return id; }, clear: (id) => q.delete(id) },
    advance(ms) { now += ms; for (const [id, e] of [...q]) if (e.at <= now) { q.delete(id); e.fn(); } },
  };
}
const BASE = 'https://api.example';
const TRIP = '/api/trip?from=10101100&to=2000340&count=6&fare=adult';
const DEP = '/api/departures?stop=2150106';
const LISTS = ['/api/commutes?profile=p1', '/api/saved?profile=p1'];

test('only Home reads go in a bundle: no paging, refresh trips, text answers or other paths', () => {
  for (const p of [TRIP, DEP, DEP + '&refresh=1', ...LISTS, '/api/watches?device=d&profile=p&since=0', '/api/app/config?platform=android']) assert.ok(B.homeReadOk(p), p);
  for (const p of [TRIP + '&refresh=1', TRIP + '&page=1', TRIP + '&after=123', '/api/trip/live?legs=x', '/api/service?trip=1', '/api/search?q=x', DEP + '&format=text', '/api/commutes', 'x/api/saved?profile=1']) assert.ok(!B.homeReadOk(p), p);
});

test('the bundle address carries each read once, encoded', () => {
  assert.equal(B.homeBundlePath([TRIP, DEP]), '/api/home?p=' + encodeURIComponent(TRIP) + '&p=' + encodeURIComponent(DEP));
  assert.equal(S.HOME_BUNDLE, 'home-bundle');
  assert.match(fs.readFileSync(path.join(root, '..', 'backend', 'src', 'worker.js'), 'utf8'), /\["home-bundle", "HOME_BUNDLE", "homeBundle"\]/, 'the server says the same word');
});

test('first start: nothing to send; the reads Home makes in the window are kept for next time', () => {
  const c = clock();
  let saved = null;
  const H = B.createHomeBundle(c.t, (l) => { saved = l; });
  let sent = 0;
  assert.equal(H.begin('start', BASE, async () => { sent++; return null; }), false);
  H.note(TRIP, true); H.note(DEP, true); H.note(LISTS[0], false); H.note(TRIP, true); H.note('/api/search?q=x', false);
  c.advance(B.HOME_WINDOW_MS - 1);
  H.note(LISTS[1], false);
  c.advance(1);
  H.note('/api/departures?stop=999', true); // after the window: not noted
  assert.equal(sent, 0);
  assert.deepEqual(saved.start.map((r) => r.p), [TRIP, DEP, LISTS[0], LISTS[1]]);
  assert.deepEqual(saved.start.map((r) => r.ids), [true, true, false, false]);
});

test('next start: one bundle; each read is answered from it once, and waits for it while it is on its way', async () => {
  const c = clock();
  const H = B.createHomeBundle(c.t);
  H.load({ start: [{ p: TRIP, ids: true }, { p: DEP, ids: true }, { p: LISTS[0], ids: false }] });
  let release, asked = null;
  const went = H.begin('start', BASE, (list) => { asked = list; return new Promise((r) => { release = r; }); });
  assert.equal(went, true);
  assert.deepEqual(asked.map((r) => r.p), [TRIP, DEP, LISTS[0]]);
  assert.ok(H.covers(BASE, TRIP) && !H.covers(BASE, '/api/departures?stop=1') && !H.covers('https://other', TRIP));
  const pTrip = H.take(BASE, TRIP);
  const pDep = H.take(BASE, DEP);
  release([{ status: 200, body: { journeys: [] } }, { status: 0, late: true }, { status: 200, body: { items: [] } }]);
  const [a, b] = await Promise.all([pTrip, pDep]);
  assert.deepEqual(a.body, { journeys: [] });
  assert.equal(b, null, 'a late part goes out on its own');
  assert.equal(await H.take(BASE, TRIP), null, 'used once');
  assert.equal(await H.take('https://other', LISTS[0]), null, 'another server never takes it');
  c.advance(B.HOME_PART_KEEP_MS + 1);
  assert.equal(await H.take(BASE, LISTS[0]), null, 'too old');
  assert.equal(H.covers(BASE, TRIP), false);
});

test('a failed bundle or one with the wrong number of parts: every read goes out on its own', async () => {
  for (const answer of [null, [{ status: 200, body: {} }], Promise.reject(new Error('net'))]) {
    const c = clock();
    const H = B.createHomeBundle(c.t);
    H.load({ start: [{ p: TRIP, ids: true }, { p: DEP, ids: true }] });
    H.begin('start', BASE, () => (answer instanceof Promise ? answer : Promise.resolve(answer)));
    assert.equal(await H.take(BASE, TRIP), null);
    assert.equal(await H.take(BASE, DEP), null);
  }
});

test('one read alone is not a bundle; the config rides along only when due; a write empties what a bundle brought', async () => {
  const c = clock();
  const H = B.createHomeBundle(c.t);
  H.load({ front: [{ p: DEP, ids: true }, { p: '/api/app/config?platform=android', ids: false }] });
  let n = 0;
  const send = async (list) => { n++; return list.map(() => ({ status: 200, body: { ok: 1 } })); };
  assert.equal(H.begin('front', BASE, send, { drop: (r) => r.p.startsWith('/api/app/config') }), false);
  assert.equal(n, 0);
  let got = null;
  assert.equal(H.begin('front', BASE, async (list) => { got = list; return send(list); }, { extra: [{ p: '/api/app/config?platform=android', ids: false }] }), true);
  assert.deepEqual(got.map((r) => r.p), [DEP, '/api/app/config?platform=android'], 'no read twice');
  await new Promise((r) => setTimeout(r, 0));
  H.clear();
  assert.equal(await H.take(BASE, DEP), null);
});

test('a window where Home asked nothing keeps the list from before; at most ten reads', () => {
  const c = clock();
  let saved = null;
  const H = B.createHomeBundle(c.t, (l) => { saved = l; });
  H.load({ front: [{ p: DEP, ids: true }] });
  H.begin('front', BASE, null);
  c.advance(B.HOME_WINDOW_MS);
  assert.equal(saved, null);
  assert.deepEqual(H.lists().front.map((r) => r.p), [DEP]);
  H.begin('start', BASE, null);
  for (let i = 0; i < 14; i++) H.note('/api/departures?stop=20000' + i, true);
  c.advance(B.HOME_WINDOW_MS);
  assert.equal(saved.start.length, B.HOME_BUNDLE_MAX);
  assert.deepEqual(B.cleanLists({ start: [{ p: '/api/ask?q=1' }, { p: DEP, ids: 1 }], front: 'x' }), { start: [{ p: DEP, ids: true }] });
});

test('recovery: any stand in is asked again, a slow planner first as Getting live times, then quietly, up to a minute', () => {
  const slow = { source: 'timetable', fallback: 'planner-slow' };
  const down = { source: 'timetable', fallback: 'planner-down' };
  assert.equal(C.standInAgainMs({ journeys: [] }, 0), null);
  assert.deepEqual([0, 1, 2, 3, 6, 9].map((n) => C.standInAgainMs(slow, n)), [{ ms: 6000, quick: true }, { ms: 10000, quick: true }, { ms: 5000, quick: false }, { ms: 10000, quick: false }, { ms: 60000, quick: false }, { ms: 60000, quick: false }]);
  assert.deepEqual([0, 1, 2, 3, 4, 20].map((n) => C.standInAgainMs(down, n).ms), [5000, 10000, 20000, 40000, 60000, 60000]);
  assert.ok([0, 1, 7].every((n) => C.standInAgainMs(down, n).quick === false));
  assert.deepEqual([3, 4, 5, 6, 7, 30].map((f) => C.failAgainMs(f, false)), [5000, 10000, 20000, 40000, 60000, 60000]);
  assert.equal(C.failAgainMs(2, true), 5000);
  assert.ok(C.cardDegraded({ data: down, error: null, offlineAt: null }));
  assert.ok(C.cardDegraded({ data: { journeys: [] }, error: 'x', offlineAt: null }));
  assert.ok(C.cardDegraded({ data: { journeys: [] }, error: null, offlineAt: 5 }));
  assert.ok(!C.cardDegraded({ data: { journeys: [] }, error: null, offlineAt: null, packAt: null }));
});

test('wiring: api.ts notes and takes, the app starts the bundle before the commute warm, cards ask again on return', () => {
  const api = read('src/lib/api.ts');
  assert.match(api, /if \(!init\?\.headers\) homeBundle\.note\(path, !!init\?\.ids\)/);
  assert.match(api, /if \(read && !init\?\.headers\) \{ const b = await fromBundle<T>\(first, path\); if \(b\) return b; \}/);
  assert.match(api, /homeBundle\.clear\(\)/, 'a write drops bundle answers');
  assert.match(api, /if \(!serves\(HOME_BUNDLE, base\) \|\| readBase\(\) !== base\) return null;/, 'only a server that says home-bundle');
  const lay = read('src/app/_layout.tsx');
  assert.ok(lay.indexOf("startHomeBundle('start'") > 0 && lay.indexOf("startHomeBundle('start'") < lay.indexOf('warmCommute();'));
  assert.match(lay, /if \(homeOnView\(\)\) startHomeBundle\('front', \{ config: configDue\(\) \}\);\s*refreshConfig\(\);/);
  assert.match(read('src/lib/config.ts'), /homeBundle\.take\(base, CONFIG_READ\)/);
  assert.match(read('src/lib/boot.ts'), /loadHomeBundle\(\)/);
  assert.match(read('src/app/(tabs)/home/index.tsx'), /setHomeOnView\(true\); return \(\) => setHomeOnView\(false\)/);
  const hooks = read('src/lib/hooks.ts');
  assert.match(hooks, /if \(a !== 'active' \|\| !degraded\.current\) return;\s*plainNext\.current = true;\s*setSoon\(\{ key: Date\.now\(\) \+ Math\.random\(\), ms: 0 \}\);/);
  assert.match(hooks, /quietAgain\(failAgainMs\(fails\.current, phoneOffline\(e\)\)\)/);
  assert.match(hooks, /nextQuick\.current = Number\.isFinite\(gap\) && gap > 0 \? Math\.min\(ms, gap\) : ms;/, 'never later than the normal gap');
  for (const f of ['src/lib/homeBundleCore.ts', 'src/lib/homeBundle.ts', 'src/lib/hooks.ts', 'src/lib/api.ts']) assert.doesNotMatch(read(f), /setInterval|[\u2013\u2014]/, f);
});
