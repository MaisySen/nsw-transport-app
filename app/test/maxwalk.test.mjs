// Max walk chips (28 Oct): Max walk 5, 10 or 15 min and Prefer bus over a long walk on the trip screen, kept per trip
// (A to B) on this phone, sent as maxWalk and lessWalk, asked again when changed. Pure core in node, plus source checks.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-maxwalk-'));
async function load(name) {
  const src = fs.readFileSync(path.join(root, 'src/lib', name + '.ts'), 'utf8');
  const f = path.join(out, name + '.mjs');
  fs.writeFileSync(f, ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  return import(pathToFileURL(f).href);
}
const P = await load('walkPrefCore');
const src = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');

const A = 'p1>p2', B = 'p3>p4';

test('per trip: its own choice first, else the older one for every trip, else Any', () => {
  assert.deepEqual(P.readTripWalk(undefined, A, undefined), { max: 0, prefer: false });
  assert.deepEqual(P.readTripWalk(undefined, A, { max: 10, prefer: true }), { max: 10, prefer: true });
  const by = { [A]: { max: 5, prefer: false } };
  assert.deepEqual(P.readTripWalk(by, A, { max: 10, prefer: true }), { max: 5, prefer: false });
  assert.deepEqual(P.readTripWalk(by, B, { max: 10, prefer: true }), { max: 10, prefer: true });
  // Any set on purpose for one trip stays Any there, whatever the older choice says.
  assert.deepEqual(P.readTripWalk({ [A]: { max: 0, prefer: false } }, A, { max: 15, prefer: true }), { max: 0, prefer: false });
  // Broken stored values read as Any.
  assert.deepEqual(P.readTripWalk({ [A]: 'x' }, A, null), { max: 0, prefer: false });
  assert.deepEqual(P.readTripWalk('nope', A, { max: 7 }), { max: 0, prefer: false });
});

test('per trip: setting one trip leaves the others, newest kept, at most TRIP_WALK_KEEP', () => {
  let by = P.withTripWalk(undefined, A, { max: 10, prefer: false });
  by = P.withTripWalk(by, B, { max: 5, prefer: true });
  assert.deepEqual(by[A], { max: 10, prefer: false });
  assert.deepEqual(by[B], { max: 5, prefer: true });
  by = P.withTripWalk(by, A, { max: 15, prefer: false });
  assert.deepEqual(Object.keys(by), [B, A], 'the trip set last is the newest');
  let big = {};
  for (let i = 0; i < P.TRIP_WALK_KEEP + 5; i++) big = P.withTripWalk(big, `s${i}>d${i}`, { max: 5, prefer: false });
  assert.equal(Object.keys(big).length, P.TRIP_WALK_KEEP);
  assert.ok(!('s0>d0' in big) && `s${P.TRIP_WALK_KEEP + 4}>d${P.TRIP_WALK_KEEP + 4}` in big);
});

test('chips: 5, 10, 15; pressing the one on goes back to Any; a kept 20 still shows', () => {
  assert.deepEqual([...P.WALK_CHIPS], [5, 10, 15]);
  assert.deepEqual(P.walkChips({ max: 0, prefer: false }), [5, 10, 15]);
  assert.deepEqual(P.walkChips({ max: 20, prefer: false }), [5, 10, 15, 20]);
  assert.deepEqual(P.walkChipPress({ max: 0, prefer: true }, 10), { max: 10, prefer: true });
  assert.deepEqual(P.walkChipPress({ max: 10, prefer: true }, 10), { max: 0, prefer: true });
  assert.deepEqual(P.walkChipPress({ max: 10, prefer: false }, 5), { max: 5, prefer: false });
});

test('the trip screen asks again when the choice changes (walkKey), and reads the server echo', () => {
  assert.equal(P.walkKey({ max: 0, prefer: false }), '0');
  assert.equal(P.walkKey({ max: 10, prefer: true }), '10p');
  assert.notEqual(P.walkKey({ max: 10, prefer: false }), P.walkKey({ max: 10, prefer: true }));
  assert.equal(P.serverWalk({ journeys: [] }), null, 'an older server sends no echo');
  assert.deepEqual(P.serverWalk({ walk: { max: 10, less: true, dropped: false } }), { max: 10, less: true, dropped: false });
  assert.deepEqual(P.serverWalk({ walk: 'x' }), null);
});

test('a 22 min walk is left out with a 10 min cap; with every trip over, all stay and Prefer bus is suggested', () => {
  const at = (m) => new Date(Date.UTC(2026, 9, 28, 0, m)).toISOString();
  const walk22 = { id: 'w', arrive: at(20), legs: [{ kind: 'walk', durationMin: 22 }, { kind: 'transit' }] };
  const bus = { id: 'b', arrive: at(26), legs: [{ kind: 'walk', durationMin: 3 }, { kind: 'transit' }, { kind: 'walk', durationMin: 4 }] };
  const r = P.applyWalkPref([walk22, bus], { max: 10, prefer: false });
  assert.deepEqual(r.list.map((j) => j.id), ['b']);
  assert.equal(P.walkNote(r, { max: 10, prefer: false }), '1 trip with a walk over 10 min not shown.');
  const r2 = P.applyWalkPref([walk22], { max: 5, prefer: false });
  assert.equal(r2.allOver, true);
  assert.match(P.walkNote(r2, { max: 5, prefer: false }), /Try Prefer bus\.$/);
  assert.doesNotMatch(P.walkNote(r2, { max: 5, prefer: true }), /Try Prefer bus/);
  // Prefer bus alone: the bus trip arriving 6 min later goes first.
  assert.deepEqual(P.applyWalkPref([walk22, bus], { max: 0, prefer: true }).list.map((j) => j.id), ['b', 'w']);
});

test('screens: chips per trip on the trip screen, Home reads the same trip choice, no timers', () => {
  const trip = src('app/trip.tsx');
  assert.match(trip, /readTripWalk\(stNow\.tripWalk, tkey, stNow\.walkPref\)/);
  assert.match(trip, /modesKey, wKey\],/, 'a changed choice asks again');
  assert.match(trip, /accOn, whenKey, modesKey, wKey\]\.join/, 'batches for the old choice go');
  const chip = src('components/WalkChoice.tsx');
  assert.match(chip, /store\.setTripWalk\(tripKey, p\)/);
  assert.match(chip, /accessibilityRole="button"/);
  assert.match(chip, /accessibilityState=\{\{ selected: on \}\}/);
  assert.match(chip, /Max walk \$\{m\} min/);
  assert.match(chip, /Prefer bus over long walk/);
  assert.doesNotMatch(chip, /setInterval|setTimeout|useNow|Location/);
  const home = src('app/(tabs)/home/index.tsx');
  assert.match(home, /readTripWalk\(sn\.tripWalk, `\$\{aheadPlan\.from\.id\}>\$\{aheadPlan\.to\.id\}`, sn\.walkPref\)/);
  const store = src('lib/store.ts');
  assert.match(store, /setTripWalk\(key: string/);
  assert.match(store, /tripWalk\?: Record<string, \{ max: number; prefer: boolean \}>/);
});
