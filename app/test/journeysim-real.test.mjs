// The journey simulator's 30 cases played on the REAL app code (phase 2 of docs/TRIP_FLOW_SPEC.md): every feed snapshot
// becomes the /api/service JSON the app receives, and app/src/lib/tripState.ts (the module the live trip screen, the
// Lock Screen card, the widget, the Watch, speech and alerts draw from, and the server's generated copy) decides every
// time, phase, alert and spoken word. Checked: I1 to I10 every second, each case's own expectations, the I3 timetable
// shift proof, the same moments as the reference engine, and that the checks still fail on build 211's behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { simulate, checkInvariants, shiftTimetable, momentsOf, hms, clockSec } from '../sim/journeySim.mjs';
import { CASES, byId } from '../sim/cases.mjs';
import { makeRealEngine } from '../sim/realEngine.mjs';
import { expectCase, frameAt } from './journeysimExpect.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require(path.join(here, '..', 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-tripstate-'));
const src = fs.readFileSync(path.join(here, '..', 'src', 'lib', 'tripState.ts'), 'utf8');
fs.writeFileSync(path.join(out, 'tripState.mjs'), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const tripState = await import(pathToFileURL(path.join(out, 'tripState.mjs')).href);
const real = makeRealEngine(tripState);

const runs = new Map(), refs = new Map();
const run = (id) => { if (!runs.has(id)) runs.set(id, simulate(byId(id), real)); return runs.get(id); };
const ref = (id) => { if (!refs.has(id)) refs.set(id, simulate(byId(id))); return refs.get(id); };
// The app names stops short everywhere ("Burwood", not "Burwood Station"); the reference keeps the case's name.
const short = (s) => (s == null ? s : String(s).replace(/ Station\b(, Stand \w+)?/g, ''));

for (const c of CASES) {
  test(`real code ${c.id}: ${c.title}`, () => {
    const o = expectCase(c, run);
    assert.equal(o.frames.length, ref(c.id).frames.length);
  });
}

test('real code S2: the 31 Oct trip counts to the live 7:54, never 0:00, Get off now lands 7:58:30, nothing spoken on open', () => {
  const o = run('S2');
  assert.equal(o.rings.find((r) => r.kind === 'getoff').target, hms('19:58:30'));
  assert.ok(!o.voice.some((s) => s.words && s.t >= hms('19:49') && s.t < hms('19:50')));
  for (const at of ['19:48', '19:50', '19:53:59']) assert.equal(frameAt(o, at).card.timer, hms('19:54'), `timer at ${at}`);
  assert.equal(frameAt(o, '19:48').card.warn, '4 min late');
  assert.equal(frameAt(o, '19:48').card.arrive, 'Arrive Croydon 7:59pm');
});
test('real code S2-open: each moment spoken once, in the app, with the station', () => {
  const o = run('S2-open');
  assert.deepEqual(o.voice.filter((s) => s.words).map((s) => s.words), ['Croydon is next. Get ready to get off.', 'Get off now for Croydon.', "You've arrived at Croydon."]);
});

for (const c of CASES) {
  test(`real code ${c.id}: the same moments and words as the reference engine`, () => {
    const a = ref(c.id), b = run(c.id);
    assert.deepEqual(momentsOf(b), momentsOf(a));
    assert.deepEqual(b.voice.map((v) => [v.t, short(v.words), v.why || null]), a.voice.map((v) => [v.t, short(v.words), v.why || null]));
    for (let i = 0; i < a.frames.length; i++) {
      const fa = a.frames[i], fb = b.frames[i];
      for (const k of ['status', 'warn', 'arrive', 'sub', 'timer', 'staleDate', 'phase']) assert.equal(short(fb.card?.[k] ?? null), short(fa.card?.[k] ?? null), `${c.id} ${clockSec(fa.t)} card.${k}`);
      // a shorter stop name can fit a longer widget variant, so rows naming a station are compared on the status only
      if (!/Station/.test(fa.widget || '')) assert.equal(short(fb.widget), short(fa.widget), `${c.id} ${clockSec(fa.t)} widget`);
      else assert.ok(fb.widget && fb.widget.startsWith(short(fa.widget).split(' · ').slice(0, 2).join(' · ')), `${c.id} ${clockSec(fa.t)} widget ${fb.widget}`);
      assert.equal(short(fb.inApp), short(fa.inApp), `${c.id} ${clockSec(fa.t)} in-app`);
    }
  });
}

for (const c of CASES.filter((x) => !x.owner && x.id !== 'S15b' && x.id !== 'S8')) {
  test(`real code ${c.id}: moving the timetable 7 min either way changes no phase and no alert (I3)`, () => {
    const base = momentsOf(run(c.id));
    for (const dt of [-420, 420]) assert.deepEqual(momentsOf(simulate(shiftTimetable(c, dt), real)), base, `${c.id} moved with the timetable (${dt / 60} min)`);
  });
}

// the checks still catch build 211's behaviour when it is fed into a run on the real code
const mutate = (fn) => { const o = simulate(byId('S19'), real); fn(o); return checkInvariants(o).map((x) => x.rule); };
test('real code checks: build 211 behaviour fed in fails I1, I2, I3, I4, I5, I6, I7, I8, I9 and I10', () => {
  assert.ok(mutate((o) => { for (const f of o.frames) if (f.card && f.card.phase === 'waiting' && f.card.timer) f.card.timer = f.card.depPlanned; }).includes('I1'));
  const r2 = mutate((o) => { const f = frameAt(o, '19:50:30'); f.card.timer = hms('19:50'); f.widget = 'Checking for the next one'; });
  assert.ok(r2.includes('I2') && r2.includes('I10'));
  assert.ok(mutate((o) => { o.M.legs[0].phaseAt.arrived = hms('19:55'); o.M.legs[0].phaseWhy.arrived = 'timetable time passed'; }).includes('I3'));
  assert.ok(mutate((o) => { const f = frameAt(o, '19:49'); f.app = 'open'; f.openSince = hms('19:49'); f.refreshes = 1; o.voice.push({ t: hms('19:49'), kind: 'delay', words: 'From Platform 7', by: 'in-app voice' }); }).includes('I4'));
  const r5 = mutate((o) => { const g = o.rings.find((r) => r.kind === 'getoff'); o.rings.push({ ...g, t: g.t - 60, lands: g.t - 58, age: 400, title: 'Wake up', jumped: false }); });
  for (const r of ['I5', 'I8', 'I9']) assert.ok(r5.includes(r), r);
  const r7 = mutate((o) => { const f = frameAt(o, '19:48'); f.card.truncated = 1; f.serverView = { ...f.card, status: 'Leaves 7:50pm · Platform 7' }; });
  assert.ok(r7.includes('I7') && r7.includes('I6'));
});
