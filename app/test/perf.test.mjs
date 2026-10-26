// Battery, smoothness and speed pass (25 Oct, 9 PM): adaptive polling, countdowns that redraw only when a
// minute changes, the kept copy shown at once on a fresh start, and Home's lists at once a minute.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-perf-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const pc = await load('src/lib/pollCore.ts');
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

test('adaptive gap: 15 s in the last 10 minutes, 30 s up to 20, a minute beyond or with nothing ahead', () => {
  assert.equal(pc.adaptiveGapMs(15000, 2 * 60000), 15000);
  assert.equal(pc.adaptiveGapMs(15000, 5 * 60000), 15000);
  assert.equal(pc.adaptiveGapMs(15000, 9 * 60000), 15000, 'a train 9 min away is asked for every 15 s (was 30 s)');
  assert.equal(pc.adaptiveGapMs(15000, 10 * 60000), 15000);
  assert.equal(pc.adaptiveGapMs(15000, 11 * 60000), 30000);
  assert.equal(pc.adaptiveGapMs(15000, 16 * 60000), 30000);
  assert.equal(pc.adaptiveGapMs(15000, 21 * 60000), 60000);
  assert.equal(pc.adaptiveGapMs(15000, null), 60000);
  assert.equal(pc.adaptiveGapMs(120000, 60000), 120000, 'a slower gap is never made faster');
});

test('trip lists: 15 s while the first service leaves in 10 minutes or less, else 20 s', () => {
  const now = Date.parse('2026-10-26T07:40:00Z');
  const at = (m) => new Date(now + m * 60000).toISOString();
  assert.equal(pc.tripGapMs(4 * 60000), 15000);
  assert.equal(pc.tripGapMs(10 * 60000), 15000);
  assert.equal(pc.tripGapMs(11 * 60000), 20000);
  assert.equal(pc.tripGapMs(null), 20000);
  assert.equal(pc.firstLeaveInMs([{ leave: at(12), board: at(14) }, { leave: at(6), board: at(8) }], now), 8 * 60000, 'the first boarding');
  assert.equal(pc.firstLeaveInMs([{ leave: at(-5) }, { leave: at(3) }], now), 3 * 60000, 'a trip already gone is skipped');
  assert.equal(pc.firstLeaveInMs([], now), null);
  // Every list that shows live times uses them (Simple mode was 30 s or slower before 26 Oct 2026).
  assert.match(read('src/app/simple.tsx'), /\(d\) => tripGapMs\(/);
  assert.match(read('src/app/trip.tsx'), /tripGapMs\(firstLeaveInMs\(d\?\.journeys, Date\.now\(\)\)\)/);
  const cards = read('src/components/Cards.tsx');
  assert.match(cards, /api\.departures\(stop\.id, r\), \(d\) => adaptiveGapMs\(15000, nextInMs\(d\?\.items, Date\.now\(\)\)\)/);
  assert.match(cards, /tripGapMs\(firstLeaveInMs\(d\?\.journeys, Date\.now\(\)\)\)/);
});

test('next change of a whole minute countdown', () => {
  const now = Date.parse('2026-10-25T10:00:10Z');
  // A service at 10:04:40 shows 4 min until 10:00:40, then 3: the next redraw is 30 s away.
  assert.equal(pc.nextChangeMs(now, [Date.parse('2026-10-25T10:04:40Z')]), 30000 + 50);
  assert.equal(pc.nextChangeMs(now, []), 50000 + 50, 'nothing to count to: the next minute on the clock');
  assert.equal(pc.nextChangeMs(now, [Date.parse('2026-10-25T10:00:30Z')]), 20000 + 50, 'Now becomes ... at whole minutes too');
  assert.ok(pc.nextChangeMs(now, [now + 60000]) >= 1000);
  assert.equal(pc.nextChangeMs(now, [now - 5 * 60000]), 50000 + 50, 'long gone services are ignored');
});

test('a poller with a gap function reads it before each wait', async () => {
  const waits = [];
  let gap = 15000;
  const timers = { set: (fn, ms) => { waits.push(ms); return 1; }, clear: () => {}, now: () => 0 };
  const p = pc.createPoller(() => true, () => gap, timers, { runAtStart: false });
  gap = 60000;
  await p.runNow();
  assert.equal(waits.at(-1), 60000);
  p.stop();
});

test('next service on a board skips gone and cancelled ones', () => {
  const now = Date.parse('2026-10-25T10:00:00Z');
  const t = (m) => new Date(now + m * 60000).toISOString();
  assert.equal(pc.nextInMs([{ planned: t(-3), departed: true }, { planned: t(2), cancelled: true }, { planned: t(9), estimated: t(11), realtime: true }], now), 11 * 60000);
  assert.equal(pc.nextInMs([], now), null);
});

test('source: screens with countdowns redraw on minute changes, polls are adaptive, Home lists once a minute', () => {
  const home = read('src/app/(tabs)/home/index.tsx');
  assert.match(home, /useCountdownNow\(\)/);
  assert.match(home, /\}, 60000, \[\], \{ cacheKey: cacheKey\('home', 'lists'\) \}\)/);
  const card = read('src/components/Home.tsx');
  assert.match(card, /adaptiveGapMs\(15000/);
  assert.match(card, /useReportCountdowns\('trip:'/);
  for (const f of ['src/app/stop/[id].tsx', 'src/app/board.tsx']) {
    const s = read(f);
    assert.match(s, /useCountdownNow\(\)/, f);
    assert.match(s, /adaptiveGapMs\(15000, nextInMs\(/, f);
  }
  const hooks = read('src/lib/hooks.ts');
  assert.match(hooks, /Promise\.all\(\[key \? readOffline<T>\(key\) : null, pk \? readPackBoard\(pk\.stop, pk\.mode\) : null\]\)\.then/, 'the kept copy (and the timetable pack) is read at once on a fresh start');
  assert.match(hooks, /setStaleAt\(f\.at\)/, 'a kept copy on screen is labelled with its age');
  const act = read('src/lib/activity.ts');
  assert.doesNotMatch(act, /setInterval/);
});

test('Reduce Motion: the live dot does not pulse', () => {
  const t = read('src/components/Transit.tsx');
  assert.match(t, /const still = useReduceMotion\(\)/);
  assert.match(t, /if \(still\) \{ a\.setValue\(1\); return; \}/);
});

test('haptics: one light tap at leave now and on arrival, once each per trip', async () => {
  const lc = await load('src/lib/liveCalc.ts').catch(() => null);
  const now = Date.parse('2026-10-25T10:00:00Z');
  const s = (dep) => ({ done: false, cur: 0, phase: 'wait', L2: [{ dep, missed: false }] });
  if (lc) {
    assert.deepEqual(lc.tapMoments(s(now + 50000), now), ['leave0']);
    assert.deepEqual(lc.tapMoments(s(now + 3 * 60000), now), []);
    assert.deepEqual(lc.tapMoments({ done: true }, now), ['arrived']);
  }
  const eng = read('src/lib/liveEngine.ts');
  assert.match(eng, /if \(!tapped\.has\(id\)\) \{ tapped\.add\(id\); haptic\.light\(\); \}/);
});
