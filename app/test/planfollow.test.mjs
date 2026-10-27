// Plan rows follow ups (27 Oct 2026): trip detail times and the Home chip past an hour in the Plan rows' clock
// ("12:56 pm", or 24 hour), and the rule based "Tight change" hint on trip rows and trip detail.
// Run: TZ=Australia/Sydney OFFLINE=1 node --test test/planfollow.test.mjs
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
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-planfollow-'));
async function load(rel, name) {
  const js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  fs.writeFileSync(path.join(out, name), js);
  return import(pathToFileURL(path.join(out, name)).href);
}
const R = await load('src/lib/rowTimeCore.ts', 'rowTimeCore.mjs');
const H = await load('src/lib/homeCore.ts', 'homeCore.mjs');
const TC = await load('src/lib/tightChangeCore.ts', 'tightChangeCore.mjs');

const min = 60000;
// Times are built from a fixed base in Sydney time; the base itself never shows in the app.
const base = Date.parse('2026-10-27T00:00:00+11:00');
const at = (h, m) => base + (h * 60 + m) * min;
const iso = (t) => new Date(t).toISOString();

test('chip clock: the Plan rows clock split into digits and am or pm, or 24 hour digits alone', () => {
  for (const [h, m] of [[0, 5], [9, 41], [12, 0], [12, 56], [13, 7], [23, 59]]) {
    const t = at(h, m);
    const c12 = R.chipClock(t, false);
    assert.equal(`${c12.big} ${c12.unit}`, R.rowClock(t, false), `12 hour ${h}:${m}`);
    assert.match(c12.unit, /^(am|pm)$/);
    assert.deepEqual(R.chipClock(t, true), { big: R.rowClock(t, true), unit: '' });
  }
  assert.deepEqual(R.chipClock(at(12, 56), false), { big: '12:56', unit: 'pm' });
  assert.deepEqual(R.chipClock(at(0, 5), true), { big: '00:05', unit: '' });
  assert.deepEqual(R.chipClock(NaN, false), { big: '', unit: '' });
});

test('Home chip past an hour carries am or pm; under an hour it still counts down', () => {
  const now = at(10, 16);
  const parts = (t) => R.chipClock(t, false);
  assert.deepEqual(H.chipTime(now + 75 * min, now, parts), R.chipClock(now + 75 * min, false));
  assert.equal(H.chipTime(now + 75 * min, now, parts).unit, 'am');
  assert.equal(H.chipTime(now + 3 * 60 * min, now, parts).unit, 'pm');
  assert.deepEqual(H.chipTime(now + 12 * min, now, parts), { big: '12', unit: 'min' });
  assert.deepEqual(H.chipTime(now + 75 * min, now, (t) => R.chipClock(t, true)).unit, '');
  // A string clock still works for older callers.
  assert.deepEqual(H.chipTime(now + 75 * min, now, () => 'x'), { big: 'x', unit: '' });
  assert.equal(H.spokenTime(H.chipTime(now + 3 * 60 * min, now, parts)), R.rowClock(now + 3 * 60 * min, false));
  assert.equal(H.thenText([H.chipTime(now + 3 * 60 * min, now, parts)]), `Next ${R.rowClock(now + 3 * 60 * min, false)}`);
});

const leg = (o) => ({ kind: 'transit', durationMin: 10, ...o });
const walk = (m) => ({ kind: 'walk', durationMin: m });
function trip(aMode, aArr, bMode, bDep, extra = {}) {
  const a = leg({ mode: aMode, planned: iso(aArr - 10 * min), arrPlanned: iso(aArr), toStopId: extra.aStop ?? '1001', toPlatform: extra.aPlat ?? null });
  const b = leg({ mode: bMode, planned: iso(bDep), arrPlanned: iso(bDep + 10 * min), stopId: extra.bStop ?? '1001', fromPlatform: extra.bPlat ?? null });
  return extra.walk ? [a, walk(extra.walk), b] : [a, b];
}

test('tight change: same mode at the same stop wants 3 min', () => {
  const t0 = at(8, 0);
  assert.ok(TC.tightChange(trip('bus', t0, 'bus', t0 + 2 * min)));
  assert.equal(TC.tightChange(trip('bus', t0, 'bus', t0 + 2 * min)).why, 'same');
  assert.equal(TC.tightChange(trip('bus', t0, 'bus', t0 + 3 * min)), null);
  assert.equal(TC.tightChange(trip('ferry', t0, 'ferry', t0 + 4 * min)), null);
  assert.equal(TC.tightChange(trip('train', t0, 'train', t0 + 2 * min, { aPlat: 'Platform 2', bPlat: 'Platform 2', aStop: 'x2', bStop: 'x2' })).why, 'same');
});

test('tight change: another mode, platform or stop wants 5 min', () => {
  const t0 = at(17, 30);
  const m = TC.tightChange(trip('train', t0, 'bus', t0 + 4 * min, { aStop: '20001', bStop: '20002' }));
  assert.equal(m.why, 'mode');
  assert.equal(m.gapMin, 4);
  assert.equal(m.needMin, 5);
  assert.equal(TC.tightChange(trip('train', t0, 'bus', t0 + 5 * min, { aStop: '20001', bStop: '20002' })), null);
  const p = TC.tightChange(trip('train', t0, 'train', t0 + 4 * min, { aStop: 'p1', bStop: 'p4', aPlat: 'Platform 1', bPlat: 'Platform 4' }));
  assert.equal(p.why, 'platform');
  assert.equal(TC.tightChange(trip('train', t0, 'train', t0 + 6 * min, { aStop: 'p1', bStop: 'p4', aPlat: 'Platform 1', bPlat: 'Platform 4' })), null);
  assert.equal(TC.tightChange(trip('lightrail', t0, 'metro', t0 + 3 * min)).why, 'mode');
  // Bus and coach count as one mode.
  assert.equal(TC.tightChange(trip('bus', t0, 'coach', t0 + 4 * min)), null);
});

test('tight change: a walk in the change wants the walk plus 2 min, and at least 5', () => {
  const t0 = at(7, 10);
  const w = TC.tightChange(trip('train', t0, 'train', t0 + 8 * min, { walk: 7, aStop: 'a', bStop: 'b' }));
  assert.equal(w.needMin, 9);
  assert.equal(w.walkMin, 7);
  assert.equal(w.index, 2);
  assert.equal(w.fromIndex, 0);
  assert.equal(TC.tightChange(trip('train', t0, 'train', t0 + 9 * min, { walk: 7, aStop: 'a', bStop: 'b' })), null);
  assert.ok(TC.tightChange(trip('bus', t0, 'bus', t0 + 4 * min, { walk: 1 })));
});

test('tight change: live times count, cancelled legs and one service trips say nothing', () => {
  const t0 = at(9, 0);
  const legs = trip('train', t0, 'bus', t0 + 8 * min, { aStop: 's', bStop: 't' });
  assert.equal(TC.tightChange(legs), null);
  legs[0].arrEstimated = iso(t0 + 5 * min);
  assert.equal(TC.tightChange(legs).gapMin, 3);
  legs[1].cancelled = true;
  assert.equal(TC.tightChange(legs), null);
  assert.equal(TC.tightChange([leg({ mode: 'train', planned: iso(t0), arrPlanned: iso(t0 + 20 * min) })]), null);
  assert.equal(TC.tightChange([]), null);
  assert.equal(TC.tightChange(null), null);
  assert.equal(TC.tightChange([leg({ mode: 'bus' }), leg({ mode: 'bus' })]), null);
});

test('tight change: every change on a trip, and the words for screen readers', () => {
  const t0 = at(6, 0);
  const legs = [
    leg({ mode: 'bus', planned: iso(t0), arrPlanned: iso(t0 + 10 * min), toStopId: '1' }),
    leg({ mode: 'train', planned: iso(t0 + 12 * min), arrPlanned: iso(t0 + 30 * min), stopId: '2', toStopId: '3' }),
    leg({ mode: 'train', planned: iso(t0 + 40 * min), arrPlanned: iso(t0 + 50 * min), stopId: '3' }),
  ];
  const all = TC.tightChanges(legs);
  assert.equal(all.length, 1);
  assert.equal(all[0].index, 1);
  assert.equal(TC.tightA11y(all[0]), 'tight change, 2 minutes to change');
  assert.equal(TC.tightA11y({ ...all[0], gapMin: 1 }), 'tight change, 1 minute to change');
  assert.equal(TC.tightA11y({ ...all[0], gapMin: -2 }), 'tight change, 0 minutes to change');
});

test('the rule names no stations or routes', () => {
  const src = read('src/lib/tightChangeCore.ts');
  assert.ok(!/Central|Strathfield|Town Hall|Parramatta|Flemington|Campsie/.test(src));
  assert.ok(!/[\u2013\u2014]/.test(src));
});

test('screens: trip detail and the Home chip use the Plan rows clock; rows and detail show Tight change', () => {
  const trip = read('src/app/trip.tsx');
  const home = read('src/components/Home.tsx');
  const transit = read('src/components/Transit.tsx');
  assert.ok(!/\bclock\(/.test(trip), 'trip detail has no old clock() call');
  assert.ok(trip.includes('rowTime(dep)') && trip.includes('Arrive ${rowTime(arr)}'));
  assert.ok(trip.includes('changeAt(legs, i)') && trip.includes('<TightLabel'));
  assert.ok(!trip.includes('very tight'));
  assert.ok(home.includes('chipClock(x, phone24h())') && home.includes('lsChip(ls)'));
  assert.ok(!home.includes(".replace(/(am|pm)$/i, '')"), 'Home no longer strips am or pm');
  const row = home.slice(home.indexOf('export function ServiceRow'));
  assert.ok(row.includes('tightChange(j.legs)') && row.includes('<TightLabel') && row.includes('tightA11y(tc)'));
  const label = home.slice(home.indexOf('export function TightLabel'), home.indexOf('export function WarnLine'));
  assert.ok(label.includes('Tight change') && !label.includes('Pressable') && !label.includes('onPress'));
  assert.ok(!transit.includes('Leave ${clock(') && transit.includes('rowTime(ms(j.board))'));
});
