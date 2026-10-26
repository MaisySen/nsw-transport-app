// Trip list endless scroll (src/lib/tripPagesCore.ts, app/trip.tsx): page cursors, prefetch before either end, the
// 7 day reach, the end of a direction, and source checks that the Earlier and Later buttons are gone and that pages
// load only on view and one at a time.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-trippages-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const m = await load('src/lib/tripPagesCore.ts');
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

const MIN = 60000;
const t0 = Date.parse('2026-10-27T08:00:00+11:00');
const iso = (t) => new Date(t).toISOString();
const j = (dep, ride = 20, live = 0) => ({ leave: iso(dep - 3 * MIN), board: iso(dep + live * MIN), arrive: iso(dep + ride * MIN),
  legs: [{ kind: 'walk', planned: iso(dep - 3 * MIN), arrPlanned: iso(dep) }, { kind: 'transit', planned: iso(dep), arrPlanned: iso(dep + ride * MIN) }] });

test('cursors are the timetable edges of everything loaded, a late service does not move them', () => {
  const list = [j(t0 + 10 * MIN, 20, 7), j(t0), j(t0 + 20 * MIN, 12)];
  const c = m.cursorsOf(list);
  assert.equal(c.after, t0 + 20 * MIN);
  assert.equal(c.before, t0);
  assert.equal(c.arr, t0 + 20 * MIN);
  assert.equal(m.plannedDep(list[0]), t0 + 10 * MIN, 'planned, not the live 7 min late time');
  assert.deepEqual(m.cursorsOf([]), { after: null, before: null, arr: null });
});

test('a walk only trip uses its own times', () => {
  const w = { leave: iso(t0), board: iso(t0), arrive: iso(t0 + 15 * MIN), legs: [{ kind: 'walk', planned: iso(t0), arrPlanned: iso(t0 + 15 * MIN) }] };
  assert.equal(m.plannedDep(w), t0);
  assert.equal(m.plannedArr(w), t0 + 15 * MIN);
});

test('a page loads one at a time, only on view, and inside 7 days either way', () => {
  const lim = t0 + m.PAGE_REACH_MS;
  assert.equal(m.canPage(m.DIR0, t0, lim, true, true), true);
  assert.equal(m.canPage(m.DIR0, t0, lim, true, false), false, 'off view: no page');
  assert.equal(m.canPage({ ...m.DIR0, busy: true }, t0, lim, true, true), false, 'one at a time');
  assert.equal(m.canPage(m.DIR0, lim, lim, true, true), false, '7 days on: stop');
  assert.equal(m.canPage(m.DIR0, t0, t0 - m.PAGE_REACH_MS, false, true), true);
  assert.equal(m.canPage(m.DIR0, t0 - m.PAGE_REACH_MS, t0 - m.PAGE_REACH_MS, false, true), false, '7 days back: stop');
  assert.equal(m.canPage({ ...m.DIR0, pages: m.PAGE_MAX }, t0, lim, true, true), false, 'cap per visit');
  assert.equal(m.canPage(m.DIR0, null, lim, true, true), false, 'nothing loaded yet');
  assert.equal(m.PAGE_REACH_MS, 7 * 86400000);
});

test('a direction ends after two pages in a row with nothing new, or past the reach', () => {
  let st = m.afterPage(m.DIR0, 0, t0, t0 + 9e9, true);
  assert.equal(st.done, false);
  st = m.afterPage(st, 0, t0, t0 + 9e9, true);
  assert.equal(st.done, true);
  st = m.afterPage({ ...m.DIR0, empties: 1 }, 5, t0, t0 + 9e9, true);
  assert.deepEqual(st, { pages: 1, busy: false, empties: 0, done: false });
  assert.equal(m.afterPage(m.DIR0, 20, t0 + 8 * 86400000, t0 + m.PAGE_REACH_MS, true).done, true);
  assert.equal(m.afterPage(m.DIR0, 20, t0 - 8 * 86400000, t0 - m.PAGE_REACH_MS, false).done, true);
});

test('the next page is asked for a screen and a half before either end (prefetch)', () => {
  // 390 x 844: a 760 pt high list.
  const H = 760;
  assert.equal(m.nearBottom({ layoutH: H, offsetY: 0, contentH: 4000 }), false);
  assert.equal(m.nearBottom({ layoutH: H, offsetY: 4000 - H - 1100, contentH: 4000 }), true, '1.5 screens before the end');
  assert.equal(m.nearBottom({ layoutH: H, offsetY: 4000 - H - 1200, contentH: 4000 }), false);
  assert.equal(m.nearBottom({ layoutH: H, offsetY: 0, contentH: 0 }), false);
  // Earlier: only when scrolling up, within 1.5 screens of where the trips start.
  assert.equal(m.nearTop({ layoutH: H, offsetY: 1400 }, 300, true), true);
  assert.equal(m.nearTop({ layoutH: H, offsetY: 1400 }, 300, false), false, 'not while scrolling down');
  assert.equal(m.nearTop({ layoutH: H, offsetY: 2000 }, 300, true), false);
});

test('a server that does not page is told apart', () => {
  assert.equal(m.isPaged({ journeys: [], page: { dir: 'first' } }), true);
  assert.equal(m.isPaged({ journeys: [] }), false);
  assert.equal(m.isPaged(null), false);
});

test('the trip list has no Earlier or Later buttons: pages load by themselves with skeleton rows', () => {
  const t = read('src/app/trip.tsx');
  assert.doesNotMatch(t, /earlierRow\(/);
  assert.doesNotMatch(t, />\{er\.label\}</);
  assert.doesNotMatch(t, /LoadingRow/);
  assert.match(t, /<SkeletonRows count=\{3\} label="Loading earlier services" \/>/);
  assert.match(t, /<SkeletonRows count=\{3\} label="Loading later services" \/>/);
  // Prefetch both ways, earlier only after the reader scrolls, the reader's place kept when rows go in above.
  assert.match(t, /nearBottom\(at\)/);
  assert.match(t, /dragged\.current && nearTop\(at, rowsTop, up\)/);
  assert.match(t, /maintainVisibleContentPosition=\{anchorOn \? \{ minIndexForVisible: 1 \} : undefined\}/);
  // Pages only on view (onView), from the cursors, never in a loop.
  assert.match(t, /canPage\(st, edge, fwd \? reachHi : reachLo, fwd, onView\.current\)/);
  assert.match(t, /page: true, modes, walk: wp/);
});

test('skeleton rows animate on the native driver only while shown, and stay still with Reduce Motion', () => {
  const s = read('src/components/SkeletonRows.tsx');
  assert.match(s, /useNativeDriver: Platform\.OS !== 'web'/);
  assert.match(s, /return \(\) => loop\.stop\(\)/);
  assert.match(s, /if \(still\) \{ fade\.setValue\(1\); return; \}/);
  assert.doesNotMatch(s, /setInterval|requestAnimationFrame/);
});

test('the server is asked for pages with cursors (api.trip), and a via trip pages the old way', () => {
  const a = read('src/lib/api.ts');
  assert.match(a, /if \(opts\.page\) Object\.assign\(base, \{ page: 1, after: opts\.after \?\? '', before: opts\.before \?\? '', arr: opts\.arr \?\? '' \}\);/);
  const tr = read('src/lib/trips.ts');
  assert.match(tr, /opts = \{ \.\.\.opts, page: false, after: undefined, before: undefined, arr: undefined \};/);
});
