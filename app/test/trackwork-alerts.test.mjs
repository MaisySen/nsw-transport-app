// Weekend trackwork on the current server (from /api/alerts) and the Thursday heads up.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-twalerts-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const w = await load('src/lib/trackworkCore.ts');
const fx = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'alerts-old-host-25oct.json'), 'utf8'));
const SUN = Date.parse('2026-10-25T06:10:00Z'); // Sunday 25 Oct, 5:10pm Sydney
const TUE = Date.parse('2026-10-27T00:00:00Z'); // Tuesday 27 Oct, 11am Sydney
const bidur = { key: 'a', f: '213510', t: '201110', name: 'Strathfield to Kings Cross', h: 8, lines: ['T9', 'T1', 'T4'], stops: ['strathfield', 'redfern', 'kings cross'] };
const north = { key: 'b', f: '207210', t: '200080', name: 'Pymble to Wynyard', h: 8, lines: ['T1'], stops: ['pymble', 'gordon', 'wynyard'] };

test('this weekend, in Sydney time', () => {
  const k = w.weekendKeys(SUN);
  assert.equal(k.sat, 20261024);
  assert.equal(k.sun, 20261025);
  const t = w.weekendKeys(TUE);
  assert.equal(t.sat, 20261031);
  assert.equal(t.sun, 20261101);
  assert.equal(new Date(t.thu6pm).toISOString(), '2026-10-29T07:00:00.000Z', 'Thursday 6pm AEDT');
  assert.equal(new Date(w.sydneyMoment(2026, 7, 2, 18, 0)).toISOString(), '2026-07-02T08:00:00.000Z', 'AEST in winter');
});

test('dates in alert words', () => {
  assert.deepEqual(w.alertRanges('Buses replace trains Saturday 24 and Sunday 25 October', SUN), [{ from: 20261024, to: 20261024 }, { from: 20261025, to: 20261025 }]);
  assert.deepEqual(w.alertRanges('Trackwork Friday 30 October to Monday 2 November', TUE), [{ from: 20261030, to: 20261102 }]);
  assert.equal(w.weekendDays('Buses replace some trains Saturday 31 October and Sunday 1 November', TUE), 'Sat and Sun');
  assert.equal(w.weekendDays('Trains run to a changed timetable Sunday 1 November', TUE), 'Sun');
  assert.equal(w.weekendDays('Trackwork Friday 30 October to Monday 2 November', TUE), 'Fri to Sun');
  assert.equal(w.weekendDays('Bus diversions Thursday 22 October to Friday 20 November', TUE), null, 'weeks long is not weekend work');
  assert.equal(w.weekendDays('Station Update - Glenfield From Monday 26 October until Sunday 1 November, the lift is closed', TUE), null);
  assert.equal(w.weekendDays('Buses replace trains Saturday 7 and Sunday 8 November', TUE), null, 'next weekend is not this one');
});

test('real alerts from the current server: the T4 work touches Strathfield to Kings Cross, the North Shore work does not', () => {
  const r = w.weekendFromAlerts(fx.byLine, [bidur, north], SUN);
  const a = r.trips.find((x) => x.f === '213510');
  assert.equal(a.affected, true);
  assert.ok(a.items.every((i) => !/North Shore Line/.test(i.title)), 'Hornsby to Wynyard is not on this trip');
  assert.ok(a.items.some((i) => i.lines.includes('T4')));
  assert.equal(a.addedMin, null);
  const b = r.trips.find((x) => x.f === '207210');
  assert.ok(b.items.some((i) => /North Shore Line/.test(i.title)), 'Gordon is named, and Pymble to Wynyard boards at it');
  const rows = w.trackworkRows(r, [bidur]);
  assert.equal(rows.length, 1);
  assert.match(rows[0].text, /^Sat and Sun: /);
  assert.doesNotMatch(rows[0].text, /Saturday 24/);
  assert.doesNotMatch(JSON.stringify(rows), /[\u2013\u2014]/);
});

test('places named in an alert', () => {
  assert.deepEqual(w.betweenPlaces('Trains run between Hornsby and Wynyard only. Buses replace some trains between Hornsby and Gordon Saturday 24'), ['hornsby', 'wynyard', 'gordon']);
  assert.equal(w.placeKey('Kings Cross Station, Potts Point'), 'kings cross');
  const trip = w.tripLinesOf('k', '1', '2', 'X to Y', [{ legs: [{ kind: 'walk' }, { kind: 'transit', line: 'T1', from: 'Strathfield Station, Platform 1', to: 'Redfern Station' }] }], 8);
  assert.deepEqual(trip.stops, ['strathfield', 'redfern']);
});

test('the Thursday heads up: only before Thursday 6pm and only when a trip is touched', () => {
  const resp = { enabled: true, trips: [{ f: '213510', t: '201110', affected: true, addedMin: 25, buses: { from: 'Strathfield', to: 'Lidcombe' }, items: [{ id: 'x', title: 'Buses replace trains between Strathfield and Lidcombe', lines: ['T1'], days: 'Sat and Sun' }] }] };
  const p = w.headsUpPlan(resp, [bidur], TUE);
  assert.equal(new Date(p.at).toISOString(), '2026-10-29T07:00:00.000Z');
  assert.equal(p.title, 'Trackwork this weekend');
  assert.equal(p.body, 'Strathfield to Kings Cross. Sat and Sun: Buses replace trains between Strathfield and Lidcombe. Buses replace trains Strathfield to Lidcombe. Your trip takes about 25 min longer.');
  assert.equal(w.headsUpPlan(resp, [bidur], SUN), null, 'past Thursday 6pm');
  assert.equal(w.headsUpPlan({ enabled: true, trips: [] }, [bidur], TUE), null);
  assert.equal(w.headsUpPlan(resp, [bidur], TUE, () => true), null, 'a trip the server already pushes about is left out');
});
