// Plan B on the trip screen: what counts as a problem and which other way is offered.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-planb-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const b = await load('src/lib/planBCore.ts');
const NOW = Date.parse('2026-10-24T21:00:00Z'); // 8:00am Sydney
const iso = (m) => new Date(NOW + m * 60000).toISOString();
const leg = (line, dep, arr, x = {}) => ({ kind: 'transit', line, mode: 'train', tripId: `${line}-${dep}`, planned: iso(dep), arrPlanned: iso(arr), realtime: false, alerts: [], ...x });
const J = (...legs) => ({ legs, risk: 'ok', anyCancelled: false });

test('a cancelled service is a problem and the next running way is offered', () => {
  const bad = J(leg('T1', 4, 30, { cancelled: true }));
  const later = J(leg('T1', 14, 40));
  const metro = J(leg('M1', 8, 36, { mode: 'metro' }));
  const p = b.problemOf(bad);
  assert.equal(p.kind, 'cancelled');
  assert.equal(p.text, 'The 8:04am T1 is cancelled');
  const r = b.planB([bad, later, metro], bad, NOW);
  assert.equal(r.j, metro, 'earliest arrival wins');
  assert.equal(r.label, 'M1, leave 8:08am, arrive 8:36am');
  assert.equal(r.why, 'Next way that is running');
});

test('a suspended line: only ways without that line, never trackwork with buses for some trains', () => {
  const susp = { title: 'T1 North Shore Line services are suspended between Hornsby and Chatswood', priority: 'high' };
  const bad = J(leg('T1', 4, 30, { alerts: [susp] }));
  const sameLine = J(leg('T1', 10, 34));
  const other = J(leg('M1', 12, 45, { mode: 'metro' }));
  assert.equal(b.problemOf(bad).kind, 'suspended');
  const r = b.planB([bad, sameLine, other], bad, NOW);
  assert.equal(r.j, other);
  assert.equal(r.why, 'Avoids the T1');
  assert.equal(b.planB([bad, sameLine], bad, NOW), null);
  const trackwork = J(leg('T1', 4, 30, { alerts: [{ title: 'Trains run to a changed timetable. Buses replace some trains', priority: 'normal' }] }));
  assert.equal(b.problemOf(trackwork), null);
  assert.equal(b.problemOf(J(leg('T1', 4, 30, { alerts: ['ems-1 suspended'] }))), null, 'bare alert ids are not read');
  assert.ok(b.SUSPENDED.test('No trains between Central and Redfern'));
  assert.ok(b.SUSPENDED.test('Ferries are not running'));
});

test('a missed change: Plan B is a way you can make, and live times count', () => {
  const t4 = leg('T4', 26, 36, { transfer: { risk: 'miss', at: 'Redfern Station' } });
  const bad = { ...J(leg('T1', 4, 22, { realtime: true, estimated: iso(8), arrEstimated: iso(26) }), t4), risk: 'miss' };
  const p = b.problemOf(bad);
  assert.equal(p.kind, 'missed');
  assert.equal(p.text, 'Delays mean you will likely miss the 8:26am T4 at Redfern');
  const alsoMiss = { ...J(leg('T1', 9, 25), leg('T4', 27, 37, { transfer: { risk: 'miss' } })), risk: 'miss' };
  const ok = J(leg('T1', 12, 28), leg('T4', 31, 41));
  const r = b.planB([bad, alsoMiss, ok], bad, NOW);
  assert.equal(r.j, ok);
  assert.equal(r.why, 'Next way you can make');
  assert.equal(r.label, 'T1 then T4, leave 8:12am, arrive 8:41am');
});

test('no problem, no Plan B; gone or too soon services are not offered', () => {
  const fine = J(leg('T1', 4, 30));
  assert.equal(b.problemOf(fine), null);
  assert.equal(b.planB([fine], fine, NOW), null);
  const bad = J(leg('T1', 4, 30, { cancelled: true }));
  assert.equal(b.planB([bad, J(leg('T2', 0, 20)), J(leg('T2', -5, 20))], bad, NOW), null);
  assert.equal(b.problemOf(null), null);
  assert.equal(b.planB([], null, NOW), null);
});

test('words have no long dashes', () => {
  const bad = J(leg('T1', 4, 30, { cancelled: true }));
  const r = b.planB([bad, J(leg('M1', 8, 36))], bad, NOW);
  assert.doesNotMatch(r.label + r.why + b.problemOf(bad).text, /[\u2013\u2014]/);
});
