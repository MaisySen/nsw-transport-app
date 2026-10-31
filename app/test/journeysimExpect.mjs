// The journey simulator's per-case expectations (named minutes, ring times, alert order, voice, pushes, I1 to I10),
// shared by the reference run (journeysim.test.mjs) and the run on the real app code (journeysim-real.test.mjs).
import assert from 'node:assert/strict';
import { checkInvariants, momentsOf, hms, clock, clockSec } from '../sim/journeySim.mjs';

export const frameAt = (o, at) => o.frames.find((f) => f.t === hms(at));
export const fmtV = (v) => v.map((x) => `${x.rule} ${x.at}: ${x.msg}`).join('\n');

// Checks a case's own expectations (named minutes, ring times, order, voice, pushes).
export function expectCase(c, run) {
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

