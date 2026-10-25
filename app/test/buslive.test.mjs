// "Bus running 6 min late" on bus and coach legs.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-bus-'));
const src = fs.readFileSync(path.join(here, '..', 'src/lib/busLiveCore.ts'), 'utf8');
fs.writeFileSync(path.join(out, 'b.mjs'), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const b = await import(pathToFileURL(path.join(out, 'b.mjs')).href);

test('bus legs with live data say how late, early or on time', () => {
  assert.deepEqual(b.busLegStatus({ kind: 'transit', mode: 'bus', realtime: true, delayMin: 6 }), { text: 'Bus running 6 min late', tone: 'red' });
  assert.deepEqual(b.busLegStatus({ kind: 'transit', mode: 'bus', realtime: true, delayMin: 3 }), { text: 'Bus running 3 min late', tone: 'late' });
  assert.deepEqual(b.busLegStatus({ kind: 'transit', mode: 'bus', realtime: true, delayMin: -3 }), { text: 'Bus running 3 min early', tone: 'late' });
  assert.deepEqual(b.busLegStatus({ kind: 'transit', mode: 'bus', realtime: true, delayMin: 1 }), { text: 'Bus on time, live', tone: 'ok' });
  assert.equal(b.busLegStatus({ kind: 'transit', mode: 'coach', realtime: true, delayMin: 4 }).text, 'Coach running 4 min late');
  assert.equal(b.busLegStatus({ kind: 'transit', mode: 'bus', cancelled: true }).text, 'Bus cancelled');
});

test('nothing without live data, and nothing for trains, walks or other modes', () => {
  assert.equal(b.busLegStatus({ kind: 'transit', mode: 'bus', realtime: false, delayMin: 0 }), null);
  assert.equal(b.busLegStatus({ kind: 'transit', mode: 'bus', realtime: true, delayMin: null }), null);
  assert.equal(b.busLegStatus({ kind: 'transit', mode: 'train', realtime: true, delayMin: 6 }), null);
  assert.equal(b.busLegStatus({ kind: 'walk', mode: 'bus' }), null);
  assert.doesNotMatch(src, /[\u2013\u2014]/);
});

test('a Live Traffic incident on the route reads as one line on bus legs only', () => {
  assert.equal(b.trafficLine({ kind: 'transit', mode: 'bus', line: '501', traffic: { text: 'Crash on Victoria Road at Gladesville' } }), 'Crash on Victoria Road at Gladesville. Your 501 may run late.');
  assert.equal(b.trafficLine({ kind: 'transit', mode: 'coach', traffic: { text: 'Breakdown at Ryde.' } }), 'Breakdown at Ryde. Your coach may run late.');
  assert.equal(b.trafficLine({ kind: 'transit', mode: 'train', line: 'T1', traffic: { text: 'Crash' } }), null);
  assert.equal(b.trafficLine({ kind: 'transit', mode: 'bus', line: '501' }), null);
  assert.equal(b.trafficLine({ kind: 'transit', mode: 'bus', line: '501', cancelled: true, traffic: { text: 'Crash' } }), null);
});

// Live bus traffic: the slow traffic rule, the board words and where the bus sits on the line of stops.
const fx = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'bus-live-sydney.json'), 'utf8'));

test('slow in traffic only when the delay clearly grows along the stops ahead and the bus ends up late', () => {
  assert.deepEqual(b.slowInTraffic([0.5, 1, 2, 3.5, 4.6]), { growthMin: 3, lateMin: 4 });
  assert.deepEqual(b.slowInTraffic([2, 2.2, 3, 4, 5, 6.1, 6]), { growthMin: 4, lateMin: 6 });
  // Late the whole way but not getting later: the delay alone says so, not traffic.
  assert.equal(b.slowInTraffic([8, 8, 8, 8.5, 8]), null);
  // Getting later but still under the late line at the end.
  assert.equal(b.slowInTraffic([-2, -1.5, 0, 1, 2]), null);
  // One odd stop at the end does not decide.
  assert.equal(b.slowInTraffic([0, 0, 0, 0, 6]), null);
  // Catching up.
  assert.equal(b.slowInTraffic([6, 5, 3, 1, 0]), null);
  // Too few live stops, or none.
  assert.equal(b.slowInTraffic([0, 5]), null);
  assert.equal(b.slowInTraffic([0, null, null, 5]), null);
  assert.equal(b.slowInTraffic(null), null);
  assert.equal(b.slowInTraffic([]), null);
});

test('stop delays and the stretch to judge come from the trip itself, for any route', () => {
  const t0 = Date.parse('2026-10-25T11:00:00Z');
  const iso = (m) => new Date(t0 + m * 60000).toISOString();
  const stops = [0, 2, 4, 6, 8, 10].map((m, i) => ({ name: 'S' + i, planned: iso(m), estimated: i === 2 ? null : iso(m + i * 1.5), mine: i === 3 }));
  assert.deepEqual(b.stopDelays(stops, 1, 4), [1.5, null, 4.5, 6]);
  assert.deepEqual(b.tripStretch(stops, 0), [0, 3]);
  assert.deepEqual(b.tripStretch(stops, 3), [3, 5]);
  assert.deepEqual(b.tripStretch(stops.map((s, i) => ({ ...s, mine: false, alight: i === 4 })), 1), [1, 4]);
  assert.equal(b.tripStretch(stops, -1), null);
  assert.equal(b.tripStretch([], 0), null);
  const svc = { mode: 'bus', live: true, vehicle: {}, nextIndex: 0, stops: stops.map((s, i) => ({ ...s, estimated: iso(i * 2 + i * 1.5), mine: i === 5 })) };
  assert.equal(b.tripTraffic(svc), 'Running slow in traffic');
  assert.equal(b.tripTraffic({ ...svc, live: false }), null);
  assert.equal(b.tripTraffic({ ...svc, vehicle: null }), null);
  assert.equal(b.tripTraffic({ ...svc, cancelled: true }), null);
  assert.equal(b.tripTraffic({ ...svc, mode: 'train' }), null);
});

test('live trips captured at Strathfield and Central on 25 Oct read honestly', () => {
  for (const [k, v] of Object.entries(fx)) {
    const s = v.service;
    const st = b.tripStretch(s.stops, s.nextIndex);
    assert.ok(st, k);
    const d = b.stopDelays(s.stops, st[0], st[1]).filter((x) => x != null);
    const grows = Math.min(d.at(-1), d.at(-2)) - Math.min(d[0], d[1]) >= 3;
    assert.equal(b.tripTraffic({ ...s, vehicle: s.vehicle ? {} : null }) !== null, grows && Math.min(d.at(-1), d.at(-2)) >= 3, k);
  }
  // The 410 at Strathfield North was about 5 min late at every stop ahead: late, not slowing.
  const s410 = fx['410@213832'].service;
  assert.equal(b.tripTraffic({ ...s410, vehicle: {} }), null);
});

test('rows and trip legs use the server list of delays ahead, buses and coaches only', () => {
  const row = { mode: 'bus', realtime: true, ahead: [1, 1.2, 2.5, 4, 5] };
  assert.equal(b.rowTraffic(row), 'Running slow in traffic');
  assert.equal(b.rowTraffic({ ...row, mode: 'coach' }), 'Running slow in traffic');
  assert.equal(b.rowTraffic({ ...row, mode: 'train' }), null);
  assert.equal(b.rowTraffic({ ...row, realtime: false }), null);
  assert.equal(b.rowTraffic({ ...row, cancelled: true }), null);
  assert.equal(b.rowTraffic({ mode: 'bus', realtime: true }), null);
  assert.equal(b.rowTraffic({ mode: 'bus', realtime: true, ahead: [4, 4, 4, 4] }), null);
});

test('board words for buses: delay and where the bus is, or Timetable only', () => {
  assert.deepEqual(b.busBoardWords({ mode: 'bus', realtime: true, delayMin: 4, stopsAway: 3, vehicle: {} }, true), { status: '4 min late', away: '3 stops away' });
  assert.deepEqual(b.busBoardWords({ mode: 'bus', realtime: true, delayMin: 1, stopsAway: 1, vehicle: {} }, true), { status: 'On time', away: '1 stop away' });
  assert.deepEqual(b.busBoardWords({ mode: 'bus', realtime: true, delayMin: -2, stopsAway: 0, vehicle: {} }, true), { status: '2 min early', away: 'At the stop' });
  assert.deepEqual(b.busBoardWords({ mode: 'bus', realtime: true, delayMin: 0, stopsAway: 4 }, true), { status: 'On time', away: '' });
  assert.deepEqual(b.busBoardWords({ mode: 'bus', realtime: true, delayMin: 0, stopsAway: 30, vehicle: {} }, true), { status: 'On time', away: '' });
  assert.deepEqual(b.busBoardWords({ mode: 'bus', realtime: false }, false), { status: 'Timetable only', away: '' });
  assert.deepEqual(b.busBoardWords({ mode: 'bus', realtime: true, delayMin: 3 }, false), { status: 'Timetable only', away: '' });
  assert.equal(b.busBoardWords({ mode: 'bus', cancelled: true }, false), null);
  assert.equal(b.busBoardWords({ mode: 'train', realtime: true, delayMin: 3 }, true), null);
});

test('the bus marker sits at the stop the bus is at, else just before its next stop', () => {
  const stops = ['A', 'B', 'C', 'B'].map((name) => ({ name }));
  assert.deepEqual(b.busMarker(stops, 2, { text: 'Between B and C', near: 'C' }, true), { index: 2, at: false });
  assert.deepEqual(b.busMarker(stops, 3, { text: 'At B', near: 'B' }, true), { index: 3, at: true });
  assert.deepEqual(b.busMarker(stops, 1, { text: 'At B', near: 'B' }, true), { index: 1, at: true });
  assert.equal(b.busMarker(stops, 1, null, false), null);
  assert.equal(b.busMarker(stops, -1, null, true), null);
  assert.equal(b.busMarker([], 0, null, true), null);
  const s = fx['410@213832'].service;
  assert.deepEqual(b.busMarker(s.stops, s.nextIndex, s.where, true), { index: 0, at: true });
});
