// Off peak hint (28 Oct): on trip results in an Opal peak, "Leave after 10:00am and pay about $x less" from the
// server's own off peak price for the same journey, only when a trip after the peak is loaded. Pure core in node, the
// server's fare code for real fare objects, plus source checks on the trip screen.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-offpeak-'));
async function load(name) {
  const src = fs.readFileSync(path.join(root, 'src/lib', name + '.ts'), 'utf8');
  const f = path.join(out, name + '.mjs');
  fs.writeFileSync(f, ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  return import(pathToFileURL(f).href);
}
const P = await load('offPeakCore');

// The server's fare code, so the fare objects are the ones the app really gets.
const wsrc = fs.readFileSync(path.join(root, '..', 'backend', 'src', 'worker.js'), 'utf8').replace(/export default\s*\{/, 'const __default = {') + '\nexport { __default, fareOf };\n';
const wtmp = path.join(out, 'worker.mjs');
fs.writeFileSync(wtmp, wsrc);
const W = await import(pathToFileURL(wtmp).href);

// Wednesday 4 Nov 2026 (a peak day, daylight saving, UTC+11), Saturday 7 Nov, Thursday 5 Nov.
const WED = (hhmm) => Date.parse(`2026-11-04T${hhmm}:00+11:00`);
const SAT = (hhmm) => Date.parse(`2026-11-07T${hhmm}:00+11:00`);
const THU = (hhmm) => Date.parse(`2026-11-05T${hhmm}:00+11:00`);
const geo = (km) => [[-33.8, 151.0], [-33.8 - km / 2 / 111.195, 151.0], [-33.8 - km / 111.195, 151.0]];
const leg = (mode, km, dep, durMin) => ({ kind: 'transit', mode, line: mode, planned: new Date(dep).toISOString(), arrPlanned: new Date(dep + durMin * 60000).toISOString(), path: geo(km), from: 'A', to: 'B', stopId: '1', toStopId: '2' });
const trip = (dep, mode = 'train', km = 11.8, type = 'adult') => { const legs = [leg(mode, km, dep, 15)]; return { dep, legs, fare: W.fareOf(legs, type) }; };
const fake = (dep, fare) => ({ dep, fare });
const dep = (j) => j.dep;
const peakFare = (save = 1.62, from = '10am', total = 5.38) => ({ total, peak: true, offPeak: { from, save } });
const offFare = (total = 3.76) => ({ total, peak: false });

test('times from the server read as hour and minute, shown on the app clock', () => {
  assert.deepEqual(P.parseFrom('10am'), { h: 10, m: 0 });
  assert.deepEqual(P.parseFrom('7pm'), { h: 19, m: 0 });
  assert.deepEqual(P.parseFrom('9:30 am'), { h: 9, m: 30 });
  assert.deepEqual(P.parseFrom('19:00'), { h: 19, m: 0 });
  assert.deepEqual(P.parseFrom('12pm'), { h: 12, m: 0 });
  for (const bad of ['', null, undefined, 'soon', '13pm', '0am', '25:00', '10:75am', '7']) assert.equal(P.parseFrom(bad), null, String(bad));
  assert.equal(P.clockWords(10, 0), '10:00am');
  assert.equal(P.clockWords(19, 0), '7:00pm');
  assert.equal(P.clockWords(12, 5), '12:05pm');
});

test('morning peak with a trip after 10am loaded: one line with the server saving for the first trip to leave', () => {
  const a = trip(WED('08:00')), b = trip(WED('08:15')), later = trip(WED('10:05'));
  assert.equal(a.fare.peak, true);
  assert.equal(later.fare.peak, false);
  const h = P.offPeakHint([a, b], [a, b, later], dep, WED('07:58'));
  assert.ok(h);
  assert.equal(h.save, a.fare.offPeak.save);
  assert.equal(h.text, `Leave after 10:00am and pay about $${a.fare.offPeak.save.toFixed(2)} less`);
  assert.match(h.a11y, /^Opal fare estimate\. /);
  assert.equal(h.at, WED('10:00'));
  assert.deepEqual([h.day, h.h, h.m], ['20261104', 10, 0]);
});

test('no trip after the peak loaded, or only tomorrow\'s: no line', () => {
  const a = trip(WED('08:00')), b = trip(WED('09:40'));
  assert.equal(P.offPeakHint([a, b], [a, b], dep, WED('07:58')), null);
  const tomorrow = trip(THU('10:30'));
  assert.equal(P.offPeakHint([a], [a, tomorrow], dep, WED('07:58')), null);
  // A trip after 10am with no Opal fare (a booked coach, a kept copy without fares) does not count.
  assert.equal(P.offPeakHint([a], [a, fake(WED('10:10'), null)], dep, WED('07:58')), null);
  assert.equal(P.offPeakHint([a], [a, fake(WED('10:10'), { total: null, peak: false })], dep, WED('07:58')), null);
});

test('off peak already, a weekend, a ferry or an older server without offPeak: no line', () => {
  const mid = trip(WED('11:00')), mid2 = trip(WED('12:00'));
  assert.equal(P.offPeakHint([mid], [mid, mid2], dep, WED('10:55')), null);
  const sat = trip(SAT('08:00')), sat2 = trip(SAT('10:30'));
  assert.equal(sat.fare.peak, false);
  assert.equal(P.offPeakHint([sat], [sat, sat2], dep, SAT('07:55')), null);
  const ferry = trip(WED('08:00'), 'ferry', 5), ferry2 = trip(WED('10:20'), 'ferry', 5);
  assert.equal(P.offPeakHint([ferry], [ferry, ferry2], dep, WED('07:55')), null);
  const old = fake(WED('08:00'), { total: 5.38, peak: true });
  assert.equal(P.offPeakHint([old], [old, fake(WED('10:10'), offFare())], dep, WED('07:55')), null);
});

test('broken savings show nothing: zero, negative, not a number, more than the fare, a time that is not one', () => {
  const later = fake(WED('10:10'), offFare());
  for (const f of [peakFare(0), peakFare(-1), peakFare(NaN), peakFare(9, '10am', 5.38), peakFare(1.62, 'later'), { total: 5, peak: false, offPeak: { from: '10am', save: 1 } }]) {
    const j = fake(WED('08:00'), f);
    assert.equal(P.offPeakHint([j], [j, later], dep, WED('07:55')), null, JSON.stringify(f));
  }
});

test('evening peak (Monday to Thursday 3pm to 7pm) uses the server time: Leave after 7:00pm', () => {
  const a = trip(WED('17:30')), later = trip(WED('19:10'));
  assert.equal(a.fare.offPeak.from, '7pm');
  const h = P.offPeakHint([a], [a, later], dep, WED('17:25'));
  assert.ok(h);
  assert.equal(h.text, `Leave after 7:00pm and pay about $${a.fare.offPeak.save.toFixed(2)} less`);
  assert.equal(h.at, WED('19:00'));
});

test('Arrive by lists never get it; trips that have left are skipped for the amount', () => {
  const a = trip(WED('08:00')), later = trip(WED('10:05'));
  assert.equal(P.offPeakHint([a], [a, later], dep, WED('07:55'), true), null);
  const gone = fake(WED('07:40'), peakFare(3.33));
  const h = P.offPeakHint([gone, a], [gone, a, later], dep, WED('07:50'));
  assert.equal(h.save, a.fare.offPeak.save);
  // Everything shown has left: nothing to say.
  assert.equal(P.offPeakHint([gone], [gone, later], dep, WED('07:50')), null);
});

test('fare types: the saving is the server\'s for the chosen type', () => {
  const a = trip(WED('08:00'), 'train', 11.8, 'concession'), later = trip(WED('10:05'), 'train', 11.8, 'concession');
  const h = P.offPeakHint([a], [a, later], dep, WED('07:55'));
  assert.ok(h);
  assert.equal(h.save, a.fare.offPeak.save);
  assert.ok(h.save < trip(WED('08:00')).fare.offPeak.save);
});

test('trip screen: one quiet line above the trips, a button to Leave at the off peak time, never hiding trips', () => {
  const s = fs.readFileSync(path.join(root, 'src/app/trip.tsx'), 'utf8');
  assert.match(s, /import \{ offPeakHint \} from '@\/lib\/offPeakCore'/);
  const line = s.slice(s.indexOf('{opHint && js.length'), s.indexOf('{opHint && js.length') + 900);
  assert.match(line, /accessibilityRole="button"/);
  assert.match(line, /accessibilityLabel=\{opHint\.a11y\}/);
  assert.match(line, /minHeight: 44/);
  assert.match(line, /setWhen\(\{ kind: 'leave', h: opHint\.h, m: opHint\.m, day: opHint\.day \}\)/);
  assert.match(line, /kind="foot" tone="text2"/);
  // The list itself never reads the hint.
  assert.equal((s.match(/opHint/g) || []).length, 7);
  assert.doesNotMatch(s.slice(s.indexOf('const opHint'), s.indexOf('const opHint') + 400), /setInterval|useNow\(1000\)/);
  const core = fs.readFileSync(path.join(root, 'src/lib/offPeakCore.ts'), 'utf8');
  assert.doesNotMatch(core + line, /[\u2013\u2014]/);
  assert.doesNotMatch(core, /from 'react'|setInterval|fetch\(/);
});
