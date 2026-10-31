// Unit tests for the app's pure logic (fares, live trip maths). Run: node --test test/
// The TypeScript files are transpiled on the fly with the project's own TypeScript.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linkTs } from './tsLink.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require(path.join(here, '..', 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-test-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, linkTs(js, out, ts));
  return import(pathToFileURL(f).href);
}
const fare = await load('src/lib/fare.ts');
const live = await load('src/lib/liveCalc.ts');

const T0 = Date.parse('2026-10-24T05:00:00Z');
const iso = (min) => new Date(T0 + min * 60000).toISOString();
const stop = (id, min, extra = {}) => ({ id, name: id + ' Station', lat: -33.8 - min / 1000, lon: 151.2, planned: iso(min), estimated: iso(min), ...extra });

test('money and fare words', () => {
  assert.equal(fare.money(3.76), '$3.76');
  assert.equal(fare.money(null), '');
  const f = { type: 'adult', typeName: 'Adult', total: 21.64, peak: false, transfer: 2, airportFee: 18.61, legs: [] };
  assert.equal(fare.fareWords(f), 'Adult, off peak, $2.00 transfer discount, includes $18.61 airport fee');
  assert.equal(fare.offPeakText({ ...f, offPeak: { from: '7pm', save: 1.62 } }), 'Off peak from 7pm, save $1.62');
  assert.equal(fare.offPeakText(f), null);
  assert.equal(fare.fareOf({ fare: { total: null } }), null);
});

test('Opal peak hours, Sydney time, Monday to Thursday', () => {
  // Monday 26 Oct 2026, AEDT (UTC+11).
  assert.equal(fare.peakNow(Date.parse('2026-10-25T21:00:00Z')), '10am'); // 8:00am Monday
  assert.equal(fare.peakNow(Date.parse('2026-10-26T05:30:00Z')), '7pm'); // 4:30pm Monday
  assert.equal(fare.peakNow(Date.parse('2026-10-26T01:00:00Z')), null); // 12:00pm Monday
  assert.equal(fare.peakNow(Date.parse('2026-10-29T21:00:00Z')), null); // 8:00am Friday
  assert.equal(fare.peakNow(Date.parse('2026-10-24T22:00:00Z')), null); // 9:00am Sunday
});

const leg = (o = {}) => ({ mode: 'train', line: 'T1', tripId: 't1', stopId: 'A', toStopId: 'D', from: 'A', to: 'D', planned: iso(0), arrPlanned: iso(12), ...o });
const svc = (nextIndex, extra = {}) => ({ kind: 'service', live: true, mineIndex: 0, alightIndex: 3, nextIndex,
  stops: [stop('A', 0, { mine: true }), stop('B', 4), { id: 'X', name: 'Express skip', skipped: true }, stop('D', 12, { alight: true })], ...extra });

test('waiting until the vehicle passes your stop', () => {
  const s = live.computeLive([leg()], [svc(0)], T0 - 3 * 60000);
  assert.equal(s.done, false);
  assert.equal(s.phase, 'wait');
  assert.equal(s.cur, 0);
  assert.equal(s.eta, T0 + 12 * 60000);
});

test('riding: next stop skips stops it runs through, stops left counts only timed stops', () => {
  const s = live.computeLive([leg()], [svc(1)], T0 + 2 * 60000);
  assert.equal(s.phase, 'ride');
  assert.equal(s.nextIdx, 1);
  assert.equal(s.stopsLeft, 2); // B and D, not the skipped stop
  const s2 = live.computeLive([leg()], [svc(2)], T0 + 6 * 60000);
  assert.equal(s2.nextIdx, 3, 'the skipped stop is never the next stop');
  assert.equal(s2.stopsLeft, 1);
});

test('done once the last leg has arrived', () => {
  const s = live.computeLive([leg()], [svc(4)], T0 + 20 * 60000);
  assert.equal(s.done, true);
});

test('connections: spare minutes, tight and missed', () => {
  const l2 = leg({ line: 'M1', mode: 'metro', stopId: 'D2', toStopId: 'E', from: 'D', to: 'E', planned: iso(15), arrPlanned: iso(25), walkBefore: 2 });
  const ok = live.computeLive([leg(), l2], [svc(1), null], T0 + 60000);
  assert.equal(ok.conns[0].spare, 1);
  assert.equal(ok.conns[0].risk, 'tight');
  const late = svc(1); late.stops[3] = stop('D', 16, { alight: true });
  const miss = live.computeLive([leg(), l2], [late, null], T0 + 60000);
  assert.equal(miss.conns[0].risk, 'miss');
  assert.ok(miss.conns[0].spare < 0);
  const roomy = live.computeLive([leg(), { ...l2, planned: iso(25), arrPlanned: iso(35) }], [svc(1), null], T0 + 60000);
  assert.equal(roomy.conns[0].risk, 'ok');
  assert.equal(roomy.conns[0].spare, 11);
});

test('second leg becomes current after the first arrives', () => {
  const l2 = leg({ line: 'M1', stopId: 'D2', toStopId: 'E', planned: iso(20), arrPlanned: iso(30) });
  const s = live.computeLive([leg(), l2], [svc(4), null], T0 + 15 * 60000);
  assert.equal(s.cur, 1);
  assert.equal(s.phase, 'wait');
});

test('cutPath keeps the route between your stops', () => {
  const p = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
  assert.deepEqual(live.cutPath(p, { lat: 1, lon: 0 }, { lat: 3.1, lon: 0 }), [[1, 0], [2, 0], [3, 0]]);
  assert.deepEqual(live.cutPath(p, null, null), p);
});

test('minsWords', () => {
  assert.equal(live.minsWords(9.4), '9 min');
  assert.equal(live.minsWords(72), '1 h 12 min');
  assert.equal(live.minsWords(-3), '0 min');
});

// Live check against the real server: a trip that is running now, then its service, through the same maths.
test('live: a real trip, its service and its fare', { skip: process.env.OFFLINE === '1', timeout: 60000 }, async () => {
  const { DEFAULT_BASE: base } = await load('src/lib/server.ts');
  const trip = await (await fetch(`${base}/api/trip?from=200060&to=206710&count=2&fare=concession`)).json();
  const j = trip.journeys.find((x) => x.legs.some((l) => l.kind === 'transit'));
  assert.ok(j, 'a journey');
  assert.equal(j.fare.type, 'concession');
  assert.ok(j.fare.total > 0);
  const l = j.legs.find((x) => x.kind === 'transit');
  const wl = { mode: l.mode, line: l.line, tripId: l.tripId, stopId: l.stopId, toStopId: l.toStopId, from: l.from, to: l.to, planned: l.planned, arrPlanned: l.arrPlanned, estimated: l.estimated, destId: l.destId, towards: l.towards };
  const q = new URLSearchParams({ trip: l.tripId || '', mode: l.mode, line: l.line, stop: l.stopId, destId: l.destId || '', planned: l.planned, to: l.toStopId || '' });
  const s = await (await fetch(`${base}/api/service?${q}`)).json();
  assert.ok(Array.isArray(s.stops) && s.stops.length > 1, 'service stops');
  const st = live.computeLive([wl], [s], Date.now());
  assert.ok(st.done === false || st.done === true);
  if (!st.done) {
    assert.ok(Number.isFinite(st.eta));
    assert.ok(st.eta > Date.now() - 120000);
  }
});
