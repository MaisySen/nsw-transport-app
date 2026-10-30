// Timetable packs on the phone (docs/TIMETABLE_PACKS.md): reading a pack into board rows, which stops keep one, when
// one is fetched again, which first paint wins, the honest labels, and that the stop screen, Home's stop cards and the
// full screen board use it.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-ttpack-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const P = await load('src/lib/timetablePackCore.ts');
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

// 26 Oct 2026, 8:00am Sydney (UTC+11).
const NOW = Date.parse('2026-10-25T21:00:00Z');
const S = (min) => Math.round(NOW / 1000) + min * 60;
// A station with a train platform and a bus stand: departures at -3, 2, 5, 9 and 30 min.
function pack(times = [[-3, 0, 0, 0], [2, 1, 1, 1], [5, 0, 0, 0], [9, 1, 1, 1], [30, 0, 2, 0]]) {
  const rows = [];
  let last = S(times[0][0]);
  for (const [m, l, h, p] of times) { rows.push(S(m) - last, l, h, p); last = S(m); }
  return {
    v: 1, stop: { id: '215020', name: 'Parramatta Station' }, ver: 3, builtAt: '2026-10-25T18:00:00Z', generatedAt: NOW - 3600000,
    base: S(times[0][0]), until: S(0) + 40 * 3600, days: ['20261026', '20261027'],
    lines: [['T9', 'train', '#D11F2F', 'Train', 'Hornsby to Gordon'], ['415', 'bus', '#00B5EF', 'Bus', 'Parramatta to Abbotsford']],
    heads: ['Hornsby', 'Abbotsford', 'Gordon'],
    plats: [['2135223', 'Platform 3', 'Parramatta Station Platform 3'], ['2135215', 'Stand E', 'Parramatta Station, Albert Rd, Stand E']],
    rows,
  };
}

test('a pack reads into board rows from now on, in order, as timetable times with no live data', () => {
  const rows = P.packDepartures(pack(), NOW);
  assert.deepEqual(rows.map((r) => r.line), ['415', 'T9', '415', 'T9']);
  assert.equal(rows[0].planned, new Date(S(2) * 1000).toISOString());
  for (const r of rows) {
    assert.equal(r.realtime, false); assert.equal(r.estimated, null); assert.equal(r.delayMin, null);
    assert.equal(r.status.key, 'scheduled'); assert.equal(r.tripId, '');
  }
  assert.equal(rows[1].platform, 'Platform 3'); assert.equal(rows[1].dest, 'Hornsby'); assert.equal(rows[1].stopId, '2135223');
  assert.equal(rows[0].platform, 'Stand E'); assert.equal(rows[0].mode, 'bus');
  assert.equal(rows[3].dest, 'Gordon');
});

test('trains run with no passengers are left out', () => {
  const p = pack(); p.heads.push('Empty Train');
  p.rows[p.rows.length - 2] = 3;
  assert.deepEqual(P.packDepartures(p, NOW).map((r) => r.dest), ['Abbotsford', 'Hornsby', 'Abbotsford']);
});

test('one mode, a row cap, and bus taking coaches as the server does', () => {
  assert.deepEqual(P.packDepartures(pack(), NOW, { mode: 'train' }).map((r) => r.line), ['T9', 'T9']);
  assert.equal(P.packDepartures(pack(), NOW, { max: 2 }).length, 2);
  const p = pack(); p.lines[1][1] = 'coach';
  assert.equal(P.packDepartures(p, NOW, { mode: 'bus' }).length, 2);
});

test('a pack board is a departures answer marked fromPack; an empty one has no rows', () => {
  const b = P.packBoard(pack(), NOW, 'bus');
  assert.equal(b.kind, 'departures'); assert.equal(b.askedMode, 'bus'); assert.equal(b.stop.name, 'Parramatta Station');
  assert.ok(P.isPackBoard(b)); assert.ok(!P.isPackBoard({ kind: 'departures', items: [] }));
  assert.deepEqual(b.alerts, []);
  assert.equal(P.packBoard(pack(), NOW + 2 * 3600000).items.length, 0);
});

test('a broken or run out pack is not used', () => {
  assert.ok(P.packValid(pack(), NOW));
  assert.ok(!P.packValid({ ...pack(), v: 2 }, NOW));
  assert.ok(!P.packValid({ ...pack(), rows: [1, 2, 3] }, NOW));
  assert.ok(!P.packValid({ ...pack(), until: S(-1) }, NOW));
  assert.ok(!P.packValid(null, NOW));
});

test('a pack is fetched again once a day, or when it runs out within 20 hours; never more often', () => {
  const p = pack();
  assert.equal(P.packDue(null, NOW), true);
  assert.equal(P.packDue({ at: NOW - 3600000, pack: p }, NOW), false);
  assert.equal(P.packDue({ at: NOW - 21 * 3600000, pack: p }, NOW), true);
  assert.equal(P.packDue({ at: NOW - 3600000, pack: { ...p, until: S(0) + 10 * 3600 } }, NOW), true);
  assert.equal(P.packDue({ at: NOW + 3600000, pack: p }, NOW), true, 'a clock that jumped back');
});

test('first paint: a live copy from the last 10 minutes, else the pack, else an older copy', () => {
  const b = P.packBoard(pack(), NOW);
  const kept = (min) => ({ at: NOW - min * 60000, data: { kind: 'departures', items: [{ line: 'X' }] } });
  assert.equal(P.firstPaint(kept(3), b, NOW).kind, 'kept');
  assert.equal(P.firstPaint(kept(30), b, NOW).kind, 'pack');
  assert.equal(P.firstPaint(kept(30), b, NOW).at, b.fromPack);
  assert.equal(P.firstPaint(kept(30), null, NOW).kind, 'kept');
  assert.equal(P.firstPaint(kept(30), P.packBoard(pack(), NOW + 2 * 3600000), NOW).kind, 'kept', 'a pack with nothing left loses');
  assert.equal(P.firstPaint(null, null, NOW).kind, 'none');
});

test('which stops keep a pack: starred, saved trips, home and work, recent; not addresses; no repeats; capped', () => {
  const st = {
    starred: [{ id: '215020' }, { id: '200060' }],
    myTrips: [{ from: { id: '2135223' }, to: { id: '206710' }, legs: [{ from: { id: '2135223' } }, { from: { id: '2000441' } }] }],
    places: { home: { id: '-33.87,151.21' }, work: { id: '209573' } },
    recents: [{ id: '200060' }, { id: '278020' }],
    recentTrips: [{ from: { id: 'streetID:123:Some St' }, to: { id: '1' } }],
  };
  assert.deepEqual(P.packStops(st), ['215020', '200060', '2135223', '2000441', '209573', '278020']);
  assert.equal(P.packStops(st, 3).length, 3);
  assert.deepEqual(P.packStops({}), []);
});

test('departure cache keys name the stop and mode a pack is for; other keys none', () => {
  assert.deepEqual(P.packTarget('offline:dep:215020'), { stop: '215020', mode: null });
  assert.deepEqual(P.packTarget('offline:dep:215020|bus'), { stop: '215020', mode: 'bus' });
  assert.equal(P.packTarget('offline:trip:a>b'), null);
  assert.equal(P.packTarget(undefined), null);
});

test('labels say timetable times, never live, and say when live times could not be had', () => {
  assert.equal(P.packStampText(false), 'Timetable times, getting live times');
  assert.equal(P.packStampText(true), 'Live times unavailable, showing timetable times');
  assert.ok(!/live,|updated/i.test(P.packStampText(false)));
});

test('wired in: stop screen (Now, and a picked time the pack holds), Home stop cards and the full screen board paint packs; the live answer replaces them', () => {
  const stop = read('src/app/stop/[id].tsx');
  // 27 Oct speed pass 4: a picked time paints from the pack too (all modes, from that moment; packCovers).
  assert.match(stop, /pack: id \? \(at == null \? \{ stop: String\(id\), mode: ask \} : \{ stop: String\(id\), mode: null, at \}\) : null/);
  assert.match(stop, /packAt=\{packAt \?\? /);
  assert.match(stop, /packWanted\(String\(id\)\)/);
  assert.match(read('src/components/Home.tsx'), /pack: packTarget\(key\)/);
  assert.match(read('src/app/board.tsx'), /packStampText/);
  const hooks = read('src/lib/hooks.ts');
  assert.match(hooks, /firstPaint/);
  // A live answer clears the pack state in the same place it clears the kept copy state.
  assert.match(hooks, /setStaleAt\(null\);\s*setPackAt\(null\);\s*shown\.current = \{ live: true, at \}/);
  assert.match(read('src/components/Transit.tsx'), /packStampText\(!!error\)/);
  assert.match(read('src/app/_layout.tsx'), /startPacks\(STARTUP_DEFER_MS \* 3\)/);
});

test('battery: packs sync at start and on return to the front only, one at a time, no timers that repeat', () => {
  const src = read('src/lib/timetablePack.ts');
  assert.ok(!/setInterval|startAppPoll|useScreenPoll/.test(src));
  assert.match(src, /AppState\.addEventListener\('change'/);
  assert.match(src, /if \(syncing\) return syncing;/);
  assert.match(src, /if \(r === 'fail'\) break;/);
});
