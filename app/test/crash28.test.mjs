// 28 Oct crash hunt (owner, 27 Oct 10:43 AM "App has been crashing continuously"): odd server answers and broken
// copies kept on the phone go through the parts of the launch path that read them, and none of them may stop a screen.
// The server answers are the shapes server D (f8c60d91, 27 Oct 10:30 to 10:44 AM) could give a train service: the board
// engine's stop list with a stop that has no name, a stop with no planned time, skipped stops, no live times, no list.
// Run: TZ=Australia/Sydney OFFLINE=1 node --test test/crash28.test.mjs
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-crash28-'));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// A fake phone storage for offline.ts.
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

const live = await load('src/lib/liveCalc.ts');
const { cardFor } = await load('platform/tripCard.ts');
const { stopsSummary } = await load('src/lib/boardCore.ts');
const O = await load('src/lib/offlineCore.ts');
const P = await load('src/lib/timetablePackCore.ts');
const OFF = await load('src/lib/offline.ts');
const AS = (await import(pathToFileURL(path.join(out, 'async-storage.mjs')).href)).default;

// A made up two leg train trip (not a real timetable): leg one 0 to 12 min, change, leg two 16 to 26 min.
const T0 = Date.parse('2026-10-29T22:00:00Z');
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();
const legs = [
  { mode: 'train', line: 'T9', tripId: 'A.1', stopId: 'S1', toStopId: 'S3', from: 'Alpha Station', to: 'Gamma Station', planned: iso(at(0)), arrPlanned: iso(at(12)), fromPlatform: 'Platform 1', towards: 'Omega Station', color: '#D11F2F' },
  { mode: 'train', line: 'T8', tripId: 'B.1', stopId: 'S3B', toStopId: 'S6', from: 'Gamma Station', to: 'Zeta Station', planned: iso(at(16)), arrPlanned: iso(at(26)), fromPlatform: 'Platform 4', towards: 'Psi Station', color: '#00954C' },
];
const trip = { legs, to: { id: 'S6', name: 'Zeta Station' } };
const run = (tripId, names, mins, mine, off) => ({ kind: 'service', live: true, mode: 'train', line: tripId[0] === 'A' ? 'T9' : 'T8', tripId, mineIndex: mine, alightIndex: off, nextIndex: 0,
  stops: names.map((n, k) => ({ id: `${tripId}.${k}`, name: `${n} Station`, lat: -33.9 + k / 100, lon: 151.1 + k / 100, planned: iso(at(mins[k])), estimated: iso(at(mins[k] + 2)) })) });
const svcA = run('A.1', ['Alpha', 'Beta', 'Gamma', 'Delta'], [0, 6, 12, 15], 0, 2);
const svcB = run('B.1', ['Gamma', 'Epsilon', 'Zeta'], [16, 21, 26], 0, 2);

// The board engine's quick list as server D sent it: id, seq, name only when the engine had one, planned may be null,
// estimated null without a live reading, skipped, and no indexes (the full answer that follows has them).
const engineQuick = (a) => ({ kind: 'service', line: a.line, mode: 'train', tripId: a.tripId, source: 'timetable', partial: true,
  stops: a.stops.map(({ name, ...s }, i) => ({ id: s.id, seq: i + 1, ...(i === 1 ? {} : { name }), lat: s.lat, lon: s.lon, planned: i === 2 ? null : s.planned, estimated: null, skipped: i === 1 })) });
const shapes = {
  engineQuick,
  noNames: (a) => ({ ...a, stops: a.stops.map(({ name, ...s }) => s) }),
  noPlanned: (a) => ({ ...a, stops: a.stops.map((s) => ({ ...s, planned: null })) }),
  noIndexes: ({ mineIndex, alightIndex, nextIndex, ...a }) => a,
  indexesOutside: (a) => ({ ...a, mineIndex: 40, alightIndex: -3, nextIndex: 99 }),
  emptyList: (a) => ({ ...a, stops: [] }),
  idsOnly: (a) => ({ ...a, stops: a.stops.map((s) => ({ id: s.id })) }),
};
const fmt = { clock: (t) => new Date(t).toISOString().slice(11, 16), short: (n) => String(n || '').replace(/ Station.*$/, ''), plat: (p) => (p ? String(p) : '') };

test('trip in progress: server D service shapes never stop the live trip, its card or the stops after line', () => {
  for (const [name, shape] of Object.entries(shapes)) {
    for (let m = -5; m <= 35; m += 1) {
      const t = at(m);
      const svc = [shape(svcA), shape(svcB)];
      const s = live.computeLive(legs, svc, t, { rode: {} });
      assert.equal(typeof s.done, 'boolean', `${name} at ${m} min`);
      const c = cardFor(trip, s, t);
      assert.ok(c && typeof c === 'object', `${name} card at ${m} min`);
      live.stepLive({ id: 'g1', legs, ...trip }, svc, t, fmt, null);
      for (const a of svc) assert.equal(typeof stopsSummary(a.stops, 0), 'string');
    }
  }
});

test('a kept board copy with a broken row: the row is dropped, the good rows stay', () => {
  const now = Date.now();
  const good = { line: 'T9', planned: new Date(now + 5 * 60000).toISOString(), estimated: null, realtime: false };
  const d = O.prune({ kind: 'departures', items: [null, 7, 'x', good] }, now);
  assert.deepEqual(d.items, [good]);
  assert.equal(O.prune({ kind: 'departures', items: [null] }, now).items.length, 0);
  assert.deepEqual(O.pruneTrip({ journeys: [null] }, now).journeys, []);
});

test('first frame from a broken kept copy: no copy, never a stopped screen', async () => {
  const now = Date.now();
  const good = { line: 'T9', planned: new Date(now + 5 * 60000).toISOString(), realtime: false };
  const keys = { mixed: 'dep:crash28a', garbage: 'dep:crash28b', notJson: 'dep:crash28c', future: 'dep:crash28d' };
  await AS.setItem(keys.mixed, JSON.stringify({ at: now - 60000, data: { kind: 'departures', items: [null, good] } }));
  await AS.setItem(keys.garbage, JSON.stringify({ at: now - 60000, data: { kind: 'departures', items: [[], 'x', 3] } }));
  await AS.setItem(keys.notJson, '{"at": 1, "data": ');
  await AS.setItem(keys.future, JSON.stringify({ at: now + 3600000, data: { kind: 'departures', items: [good] } }));
  await AS.setItem('offline:index', JSON.stringify(Object.values(keys)));
  await OFF.warmOffline();
  const p = OFF.peekOffline(keys.mixed);
  assert.ok(p, 'the good row still paints');
  assert.equal(p.data.items.length, 1);
  assert.equal(OFF.peekOffline(keys.garbage), null);
  assert.equal(OFF.peekOffline(keys.notJson), null);
  assert.equal(OFF.peekOffline(keys.future), null);
  // A copy held in memory with a broken row (an answer kept this session) is read the same way.
  OFF.keepMem('dep:crash28e', { kind: 'departures', items: [good] }, now - 1000);
  assert.ok(OFF.peekOffline('dep:crash28e'));
});

test('kept timetable packs that are broken are never drawn', () => {
  const now = Date.now();
  for (const p of [null, 'x', {}, { v: 1, lines: null, heads: [], plats: [], rows: [0, 0, 0, 0] }, { v: 1, lines: [], heads: [], plats: [], rows: null }, { v: 1, lines: [], heads: [], plats: [], rows: 'abc' }, { v: 1, lines: [], heads: [], plats: [], rows: [10, 5, 5, 5] }]) {
    assert.equal(P.packValid(p, now), false, JSON.stringify(p));
  }
});

test('the guards are in the source: the first frame read is wrapped and broken rows are dropped', () => {
  assert.match(read('src/lib/offline.ts'), /export function peekOffline<T>\(key: string\)[\s\S]{0,400}try \{[\s\S]{0,400}\} catch \{\n    return null;/);
  assert.match(read('src/lib/offlineCore.ts'), /items: d\.items\.filter\(\(x\) => !!x && typeof x === 'object' && bestOf/);
});
