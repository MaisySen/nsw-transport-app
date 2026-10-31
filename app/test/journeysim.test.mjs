// Journey simulator (phase 1 of the trip flow plan, docs/JOURNEY_SIM.md): plays every case in
// app/sim/cases.mjs second by second under the new rules in docs/TRIP_FLOW_SPEC.md and checks the
// invariants I1 to I10 on every second, the named-minute expectations, and that the checks fail
// loudly on the build 211 behaviour. Offline: no network, no app code, no clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulate, checkInvariants, shiftTimetable, momentsOf, hms, clock, clockSec, RULES, BANNED, sig } from '../sim/journeySim.mjs';
import { CASES, byId } from '../sim/cases.mjs';
import { timelineRows, runAll, caseMarkdown } from '../sim/report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const simDir = path.join(here, '..', 'sim');
const runs = new Map();
const run = (id) => { if (!runs.has(id)) runs.set(id, simulate(byId(id))); return runs.get(id); };
const frameAt = (o, at) => o.frames.find((f) => f.t === hms(at));
const fmtV = (v) => v.map((x) => `${x.rule} ${x.at}: ${x.msg}`).join('\n');

// Checks a case's own expectations (named minutes, ring times, order, voice, pushes).
function expectCase(c) {
  const o = run(c.id);
  const v = checkInvariants(o);
  assert.equal(v.length, 0, `${c.id} broke the spec:\n${fmtV(v)}`);
  for (const k of c.checks || []) {
    const f = frameAt(o, k.at);
    assert.ok(f, `${c.id}: no frame at ${k.at}`);
    if (k.ended) { assert.ok(!f.card || f.card.ended, `${c.id} ${k.at}: card should be gone, shows ${f.card?.status}`); assert.equal(f.widget, null, `${c.id} ${k.at}: widget should be cleared`); continue; }
    if (k.tripPhase) { assert.equal(f.tripPhase, k.tripPhase, `${c.id} ${k.at}: phase`); continue; }
    if (k.noVoice) { assert.ok(!o.voice.some((s) => s.words && Math.abs(s.t - hms(k.at)) <= 15), `${c.id} ${k.at}: something was spoken`); continue; }
    if (k.card) {
      let got = f.card[k.card];
      if (k.card === 'timer') got = got == null ? null : clock(got, true);
      assert.equal(got, k.is, `${c.id} ${k.at}: card ${k.card}`);
    }
    if (k.widget === 'has') assert.ok(f.widget && f.widget.includes(k.is), `${c.id} ${k.at}: widget "${f.widget}" lacks "${k.is}"`);
    if (k.widget === 'is') assert.equal(f.widget, k.is, `${c.id} ${k.at}: widget`);
  }
  if (c.order) assert.deepEqual(o.rings.map((r) => r.kind), c.order, `${c.id}: alerts in order`);
  for (const w of c.ring || []) {
    const r = o.rings.find((x) => x.kind === w.kind);
    assert.ok(r, `${c.id}: no ${w.kind}`);
    if (w.lands) assert.equal(clockSec(r.lands ?? r.t), clockSec(hms(w.lands)), `${c.id}: ${w.kind} lands`);
    if (w.sentAt) assert.equal(clockSec(r.t), clockSec(hms(w.sentAt)), `${c.id}: ${w.kind} sent`);
    if (w.expires) assert.equal(clockSec(r.expires), clockSec(hms(w.expires)), `${c.id}: ${w.kind} expires`);
    if (w.via) assert.equal(r.via, w.via, `${c.id}: ${w.kind} route`);
    if (w.between) assert.ok(r.t >= hms(w.between[0]) && r.t <= hms(w.between[1]), `${c.id}: ${w.kind} at ${clockSec(r.t)}, expected ${w.between.join(' to ')}`);
  }
  if (c.spoken) {
    const said = o.voice.filter((s) => s.words && s.by === 'in-app voice').map((s) => s.kind);
    for (const k of c.spoken) assert.ok(said.includes(k), `${c.id}: ${k} not spoken in the app (spoken: ${said.join(', ')})`);
    if (!c.spoken.length) assert.equal(o.voice.filter((s) => s.words).length, 0, `${c.id}: nothing may be heard`);
  }
  if (c.pushWithin) {
    const p = o.pushes.find((x) => x.t >= hms(c.pushWithin.at) && x.status === c.pushWithin.status);
    assert.ok(p && p.t - hms(c.pushWithin.at) <= c.pushWithin.secs, `${c.id}: server push "${c.pushWithin.status}" not within ${c.pushWithin.secs}s`);
  }
  if (c.no24) for (const f of o.frames) for (const s of [f.card?.status, f.card?.arrive, f.widget, f.watch]) assert.ok(!/\d(am|pm)\b/.test(s || ''), `${c.id}: 12 hour time "${s}" on a 24 hour phone`);
  if (c.same) assert.deepEqual(momentsOf(o), momentsOf(run(c.same)), `${c.id} differs from ${c.same}`);
  return o;
}

// ---- every sample case (the owner's own trips are below, by name) ----
for (const c of CASES.filter((x) => !x.owner)) {
  test(`journey sim ${c.id}: ${c.title}`, () => { expectCase(c); });
}

// ---- the owner's cases ----
test("journey sim S2: the 31 Oct Strathfield to Croydon T1 trip, 4 min late, follows the live train", () => {
  const o = expectCase(byId('S2'));
  assert.equal(o.rings.find((r) => r.kind === 'getoff').target, hms('19:58:30'));
  assert.ok(!o.voice.some((s) => s.words && s.t >= hms('19:49') && s.t < hms('19:50')), 'nothing spoken when he opened the app at 7:49');
});
test("journey sim S2-open: the Strathfield to Croydon trip with the app open from 7:56 speaks each moment once", () => {
  const o = expectCase(byId('S2-open'));
  const said = o.voice.filter((s) => s.words).map((s) => s.words);
  assert.deepEqual(said, ['Croydon is next. Get ready to get off.', 'Get off now for Croydon.', "You've arrived at Croydon."]);
  assert.ok(o.rings.filter((r) => r.kind !== 'delay').every((r) => r.serverCopy === 'server alert shown in the app without sound'));
});
test('journey sim BUS: the 415 from Stand G (213516) is Due until the bus position shows it left', () => { expectCase(byId('BUS')); });
test('journey sim X: T1 to Redfern then the T4, the change is announced and the second leg runs', () => {
  const o = expectCase(byId('X'));
  assert.match(o.rings[1].body, /change for the T4/);
});

// ---- I3 proven another way: move every timetable time, keep the live train; nothing may change ----
for (const c of CASES.filter((x) => !x.owner && x.id !== 'S15b' && x.id !== 'S8')) {
  test(`journey sim ${c.id}: moving the timetable 7 min either way changes no phase and no alert (I3)`, () => {
    const base = momentsOf(run(c.id));
    for (const dt of [-420, 420]) assert.deepEqual(momentsOf(simulate(shiftTimetable(c, dt))), base, `${c.id} moved with the timetable (${dt / 60} min)`);
  });
}

// ---- the checks fail loudly on what build 211 did (section 0 of the spec), replayed onto the sample trip ----
const mutate = (fn) => { const o = simulate(byId('S19')); fn(o); return checkInvariants(o).map((x) => x.rule); };
test('journey sim checks: a countdown to the timetable time beside a live delay fails I1', () => {
  const rules = mutate((o) => { for (const f of o.frames) if (f.card && f.card.phase === 'waiting' && f.card.timer) f.card.timer = f.card.depPlanned; });
  assert.ok(rules.includes('I1'));
});
test('journey sim checks: a timer left at 0:00, "Trip started" and "Checking for the next one" fail I2 and I10', () => {
  const rules = mutate((o) => { const f = frameAt(o, '19:50:30'); f.card.timer = hms('19:50'); f.widget = 'Checking for the next one'; frameAt(o, '19:51').widget = 'Trip started'; });
  assert.ok(rules.includes('I2') && rules.includes('I10'));
});
test('journey sim checks: arriving by the timetable clock fails I3', () => {
  const rules = mutate((o) => { o.M.legs[0].phaseAt.arrived = hms('19:55'); o.M.legs[0].phaseWhy.arrived = 'timetable time passed'; });
  assert.ok(rules.includes('I3'));
});
test('journey sim checks: speaking when the app opens fails I4', () => {
  const rules = mutate((o) => { const f = frameAt(o, '19:49'); f.app = 'open'; f.openSince = hms('19:49'); f.refreshes = 1; o.voice.push({ t: hms('19:49'), kind: 'delay', words: 'From Platform 7', by: 'in-app voice' }); });
  assert.ok(rules.includes('I4'));
});
test('journey sim checks: a get off from an old reading, at the wrong time, twice, or as "Wake up" fails I5, I8 and I9', () => {
  const rules = mutate((o) => {
    const g = o.rings.find((r) => r.kind === 'getoff');
    o.rings.push({ ...g, t: g.t - 60, lands: g.t - 58, age: 400, title: 'Wake up', jumped: false });
  });
  for (const r of ['I5', 'I8', 'I9']) assert.ok(rules.includes(r), `${r} not raised`);
});
test('journey sim checks: a widget saying "Get off now" before the card does fails I10', () => {
  const rules = mutate((o) => { const f = frameAt(o, '19:58:10'); f.widget = 'T1 · Get off now · Clyde'; f.widgetPhase = 'getOff'; });
  assert.ok(rules.includes('I10'));
});
test('journey sim checks: a status line cut short fails I7, and the phone and server disagreeing fails I6', () => {
  const rules = mutate((o) => { const f = frameAt(o, '19:48'); f.card.truncated = 1; f.serverView = { ...f.card, status: 'Leaves 7:50pm · Platform 7' }; });
  assert.ok(rules.includes('I7') && rules.includes('I6'));
});

// ---- the simulator itself ----
test('journey sim: same inputs, same outputs (deterministic)', () => {
  for (const id of ['S1', 'S17a', 'S7']) assert.equal(JSON.stringify(simulate(byId(id)).rings), JSON.stringify(simulate(byId(id)).rings));
});
test('journey sim: rule numbers match the spec (30 s get off, 2/5/10 min stale, 15 s near the stop)', () => {
  assert.equal(RULES.GETOFF_LEAD, 30); assert.equal(RULES.GETOFF_EXPIRE, 30); assert.equal(RULES.SERVER_DELIVERY, 2);
  assert.deepEqual([RULES.LIVE_FRESH, RULES.LIVE_CAP, RULES.NO_DATA], [120, 300, 600]);
  assert.equal(RULES.SERVER_POLL_NEAR, 15); assert.equal(RULES.ENDED_AFTER, 120); assert.equal(RULES.VOICE_OPEN_FOR, 10);
  assert.ok(BANNED.includes('Checking for the next one') && BANNED.includes('Wake up'));
});
test('journey sim: the simulator is offline and dependency free', () => {
  for (const f of fs.readdirSync(simDir).filter((n) => n.endsWith('.mjs'))) {
    const s = fs.readFileSync(path.join(simDir, f), 'utf8');
    assert.ok(!/\bfetch\s*\(|https?:\/\/|require\(/.test(s), `${f} reaches out`);
    for (const m of s.matchAll(/^import .* from '([^']+)'/gm)) assert.ok(m[1].startsWith('./') || m[1].startsWith('node:'), `${f} imports ${m[1]}`);
  }
});
test('journey sim: every case gives a timeline with no em or en dashes and no agency branding', () => {
  const all = runAll();
  assert.equal(all.length, CASES.length);
  for (const { c, out, rows, violations } of all) {
    assert.ok(rows.length >= 2, `${c.id} timeline too short`);
    const md = caseMarkdown(c, out, rows, violations);
    assert.ok(!/[\u2013\u2014]/.test(md), `${c.id} has a dash`);
    assert.ok(!/TfNSW|Transport for NSW|Opal/i.test(md), `${c.id} has branding`);
  }
});
test('journey sim: case ids cover S1 to S20, a bus leg and a change of trains', () => {
  const ids = new Set(CASES.map((c) => c.id.replace(/[a-z]$|-open$/, '')));
  for (let i = 1; i <= 20; i++) assert.ok(ids.has(`S${i}`), `S${i} missing`);
  assert.ok(CASES.some((c) => c.legs.some((l) => l.mode === 'bus')));
  assert.ok(CASES.filter((c) => c.legs.length > 1).length >= 2);
});
