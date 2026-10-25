// Simple mode (Bidur, 25 Oct 8:57 PM: "A simple mode in setting... It just show what bus in this stand. What time.
// Same with train or anything. Like tripviewlite."). The rows, the stand chips and the page it opens on.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-simple-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const s = await load('src/lib/simpleCore.ts');
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

test('stand and platform chips from /api/nearby, nearest first', () => {
  const c = s.hereChoices([
    { id: '213564', name: 'Strathfield Station, Everton Rd, Strathfield', distance: 52 },
    { id: '2135234', name: 'Strathfield Station, Platform 4, Strathfield', distance: 41 },
    { id: '213511', name: 'Strathfield Station, Everton Rd, Stand D, Strathfield', distance: 48 },
    { id: '2135234', name: 'Strathfield Station, Platform 4, Strathfield', distance: 41 },
  ]);
  assert.deepEqual(c.map((x) => x.id), ['2135234', '213511', '213564']);
  assert.deepEqual(c.map(s.chipLabel), ['Platform 4', 'Stand D', 'Everton Rd']);
  assert.equal(c[1].place, 'Strathfield Station');
  assert.equal(s.chipLabel(s.hereChoices([{ id: '1', name: 'Kings Cross Station' }])[0]), 'All stops');
});

const T0 = Date.parse('2026-10-25T10:00:00Z');
const iso = (m) => new Date(T0 + m * 60000).toISOString();
test('departure row: line, destination, scheduled time, status and whole minute countdown', () => {
  const r = s.depRow({ line: '410', mode: 'bus', dest: 'Rockdale, Bay St', planned: iso(5), estimated: iso(8), realtime: true, delayMin: 3, tripId: 'x' }, T0);
  assert.equal(r.dest, 'Rockdale');
  assert.equal(r.status, '3 min late');
  assert.equal(r.tone, 'late');
  assert.equal(r.sched, s.clock(T0 + 5 * 60000));
  assert.match(r.a11y, /^410 to Rockdale, scheduled .+, 3 minutes late, leaves in 8 minutes$/);
  assert.equal(s.countdownWords(T0 + 8 * 60000 + 30000, T0).big, '8');
  assert.equal(s.countdownWords(T0 + 30000, T0).big, 'Now');
  assert.deepEqual(s.countdownWords(T0 + 497 * 60000, T0), { big: '8 hr', unit: '17 min', spoken: '8 hours 17 minutes' });
  const x = s.depRow({ line: 'T1', mode: 'train', dest: 'Emu Plains Station', planned: iso(2), realtime: true, cancelled: true }, T0);
  assert.equal(x.status, 'Cancelled');
  assert.match(x.a11y, /cancelled$/);
  assert.equal(s.depRow({ line: 'D400', dest: 'Bondi Junction', planned: iso(4), realtime: false }, T0).status, 'Scheduled');
});

test('rows: soonest first, gone ones out', () => {
  const rows = s.depRows([
    { line: 'A', dest: 'x', planned: iso(9) }, { line: 'B', dest: 'y', planned: iso(-3) }, { line: 'C', dest: 'z', planned: iso(1), departed: true }, { line: 'D', dest: 'w', planned: iso(2) },
  ], T0);
  assert.deepEqual(rows.map((r) => r.line), ['D', 'A']);
});

test('trip row: depart and arrive, duration, changes and platform', () => {
  const j = { leave: iso(4), arrive: iso(31), durationMin: 27, changes: 1, legs: [
    { kind: 'transit', line: 'T1', mode: 'train', planned: iso(4), estimated: iso(5), realtime: true, delayMin: 1, fromPlatform: 'Platform 1' },
    { kind: 'walk' }, { kind: 'transit', line: 'T4', mode: 'train', planned: iso(16) },
  ] };
  const r = s.tripRow(j, T0);
  assert.equal(r.times, `${s.clock(T0 + 5 * 60000)} to ${s.clock(T0 + 31 * 60000)}`);
  assert.equal(r.sub, '27 min \u00b7 1 change \u00b7 Platform 1');
  assert.deepEqual(r.lines.map((l) => l.line), ['T1', 'T4']);
  assert.equal(r.status, '1 min late');
  assert.match(r.a11y, /27 minutes, 1 change, Platform 1, T1 then T4, 1 minute late, leaves in 5 minutes$/);
  assert.equal(s.tripRow({ ...j, changes: 0, legs: [j.legs[0]] }, T0).sub, '27 min \u00b7 Direct \u00b7 Platform 1');
});

test('opens on To work in the morning, To home in the evening, else a trip used at this hour, else Here', () => {
  const pages = [{ kind: 'here' }, { kind: 'trip', key: 'a>b', from: { id: 'a' }, to: { id: 'b' }, tag: 'toWork' }, { kind: 'trip', key: 'b>a', from: { id: 'b' }, to: { id: 'a' }, tag: 'toHome' }, { kind: 'trip', key: 'a>c', from: { id: 'a' }, to: { id: 'c' } }];
  const at = (h) => Date.parse(`2026-10-26T${String((h - 11 + 24) % 24).padStart(2, '0')}:15:00Z`); // Sydney is UTC+11
  assert.equal(s.defaultPage(pages, at(8)), 1);
  assert.equal(s.defaultPage(pages, at(18)), 2);
  assert.equal(s.defaultPage(pages, at(12), [{ from: { id: 'a' }, to: { id: 'c' }, at: at(13) }]), 3);
  assert.equal(s.defaultPage(pages, at(12), [{ from: { id: 'a' }, to: { id: 'c' }, at: at(22) }]), 0);
  assert.equal(s.defaultPage([{ kind: 'here' }], at(8)), 0);
});

test('source: off by default, a switch in More, opens on its own screen, only the page on view polls, low accuracy', () => {
  const store = read('src/lib/store.ts');
  assert.match(store, /simple\?: boolean/);
  assert.doesNotMatch(store, /simple: true/);
  assert.match(read('src/app/(tabs)/settings/index.tsx'), /title="Simple mode"/);
  assert.match(read('src/app/index.tsx'), /st\.simple \? '\/simple' : '\/home'/);
  const scr = read('src/app/simple.tsx');
  assert.match(scr, /enabled: visible && !!cur/);
  assert.match(scr, /enabled: visible \}/);
  assert.match(scr, /Accuracy\.Low/);
  assert.doesNotMatch(scr, /Accuracy\.High|watchPositionAsync|startLocationUpdates|setInterval/);
  assert.match(scr, /accessibilityLabel="Settings"/);
  assert.match(scr, /Turn off Simple mode/);
});
