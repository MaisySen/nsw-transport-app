// Turns simulator runs into the "what and when" timelines: one compact table per case.
//   node app/sim/report.mjs <outdir>   writes <outdir>/JOURNEY_SIMULATION.md, <outdir>/timelines.json
// Offline and deterministic. Used by app/test/journeysim.test.mjs as well.
import { simulate, checkInvariants, snapshot, clock, clockSec, PHASES } from './journeySim.mjs';
import { CASES } from './cases.mjs';
import fs from 'node:fs';
import path from 'node:path';

// What the live train is doing at t, from what the feed has published (the simulation's truth).
export function trainLine(out, t) {
  const P = out.P, M = out.M;
  const s = snapshot(P, t);
  const fr = out.frames.find((f) => f.t === t);
  const li = fr ? fr.leg : 0;
  const ei = fr ? fr.effLeg : li; // the service the trip follows at that moment
  const leg = P.legs[ei];
  const L = s.legs[ei];
  const age = t - s.asOf;
  const bits = [];
  if (!L || L.unmatched) return 'not in the live data (timetable only)';
  if (age >= 120) bits.push(`no live data since ${clock(s.asOf)}`);
  if (L.cancelled && ei === li) bits.push('cancelled');
  const v = L.vehicle;
  if (v && v.stop >= 0) bits.push(v.state === 'at' ? `at ${leg.stops[v.stop].name}` : `left ${leg.stops[v.stop].name}`);
  else if (!(age >= 120)) bits.push(`${leg.line} not at ${leg.stops[0].name} yet`);
  const d = L.est[0] != null ? Math.round((L.est[0] - leg.stops[0].tt) / 60) : L.runDelay != null ? Math.round(L.runDelay / 60) : null;
  if (d != null && age < 120) bits.push(d === 0 ? 'on time' : d > 0 ? `${d} min late` : `${-d} min early`);
  if (L.platform) bits.push(`Platform ${L.platform}`);
  if (ei !== li) bits.unshift(`next ${leg.line} (${clock(leg.stops[0].tt)})`);
  return bits.join(', ');
}

const lockCell = (c, c24 = false) => {
  if (!c) return 'no card';
  if (c.ended) return 'card gone';
  const parts = [c.status];
  if (c.warn) parts.push(c.warn);
  if (c.arrive) parts.push(c.arrive);
  if (c.sub) parts.push(c.sub);
  if (c.timer) parts.push(`counts down to ${clock(c.timer, c24)}`);
  return parts.join(' / ');
};
const islandCell = (c, c24 = false) => {
  if (!c || c.ended) return 'gone';
  const tr = c.timer ? `timer to ${clock(c.timer, c24)}` : c.island.trailing;
  return `${c.island.leading} · ${tr}`;
};
const ringCell = (r) => {
  const how = r.quiet ? 'quiet note, no sound' : r.via === 'in-app banner' ? `in-app banner${r.haptic !== 'none' ? ', ' + r.haptic : ''}` : `${r.via}, ${r.sound}, ${r.haptic}`;
  const voice = r.voice ? (r.voice.words ? `says "${r.voice.words}"` : `no voice (${r.voice.why})`) : '';
  return `${r.quiet ? 'Note' : 'Alert'} "${r.title}": ${r.body} (${how})${voice ? '. ' + voice : ''}`;
};

// One row per moment where anything the person sees, hears or feels changes.
export function timelineRows(out) {
  const rows = [];
  const c24 = out.P.phone.some((p) => p.c24);
  let prev = null;
  const norm = (s) => (s || '').replace(/ · Updated \d+ min ago/g, '').replace(/ \(about\)/g, '').replace(/about /g, '').replace(/^T1 · |^[A-Z0-9]+ · /, '').split(' · ')[0];
  for (const f of out.frames) {
    const c = f.card;
    const key = [c ? (c.ended ? 'ended' : [c.status, c.warn, c.arrive, c.sub, c.timer, c.island.timer ? 'T' : c.island.trailing].join('|')) : 'none', norm(f.widget), f.app].join('#');
    const rings = out.rings.filter((r) => (r.lands ?? r.t) === f.t);
    const voices = out.voice.filter((v) => v.t === f.t && v.words && !out.rings.some((r) => r.voice === v));
    const train = trainLine(out, f.t);
    const notes = out.log.filter((l) => l.t === f.t && /opened|locked|killed|background|catch-up|backup|trip started/.test(l.what)).map((l) => l.what);
    if (key !== prev?.key || rings.length || voices.length || notes.length || train !== prev?.train) {
      rows.push({
        t: f.t, time: clockSec(f.t), train,
        phone: notes.join('; '),
        lock: lockCell(c, c24), island: islandCell(c, c24), widget: f.widget ? f.widget : (f.tripPhase === 'ended' || f.tripPhase === 'arrived' ? 'cleared' : 'empty'),
        alert: [...rings.map(ringCell), ...voices.map((v) => `says "${v.words}" (${v.by})`)].join(' | '),
        phase: f.tripPhase,
      });
      prev = { key, train };
    }
  }
  return rows;
}

const esc = (s) => String(s ?? '').replace(/\|/g, '/');
export function caseMarkdown(c, out, rows, violations) {
  const lines = [];
  lines.push(`## ${c.id}. ${c.title}`, '', c.story, '');
  const ok = violations.length === 0;
  lines.push(`Checks: ${ok ? 'all invariants I1 to I10 hold' : violations.length + ' violations'}. Alerts in order: ${out.rings.map((r) => `${r.kind} ${clockSec(r.t)}`).join(', ') || 'none'}.`, '');
  lines.push('| Time | Train (live) | Lock Screen | Island | Widget | Alert / voice |', '|---|---|---|---|---|---|');
  for (const r of rows) lines.push(`| ${r.time}${r.phone ? ' (' + esc(r.phone) + ')' : ''} | ${esc(r.train)} | ${esc(r.lock)} | ${esc(r.island)} | ${esc(r.widget)} | ${esc(r.alert)} |`);
  lines.push('');
  return lines.join('\n');
}

export function runAll(cases = CASES) {
  return cases.map((c) => {
    const out = simulate(c);
    const violations = checkInvariants(out);
    const rows = timelineRows(out);
    return { c, out, rows, violations };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || 'sim-out';
  fs.mkdirSync(dir, { recursive: true });
  const all = runAll();
  const md = ['# Journey simulation: what and when', '', 'Generated by app/sim/report.mjs from app/sim/cases.mjs (offline, deterministic).', ''];
  const json = [];
  for (const { c, out, rows, violations } of all) {
    md.push(caseMarkdown(c, out, rows, violations));
    json.push({ id: c.id, title: c.title, story: c.story, owner: !!c.owner, violations, rings: out.rings.map((r) => ({ t: clockSec(r.t), kind: r.kind, title: r.title, body: r.body, via: r.via, sound: r.sound, haptic: r.haptic, voice: r.voice?.words || null, voiceWhyNot: r.voice?.why || null, lands: r.lands != null ? clockSec(r.lands) : null })), pushes: out.pushes.map((p) => ({ ...p, t: clockSec(p.t), timer: p.timer != null ? clockSec(p.timer) : null, staleDate: p.staleDate != null ? clockSec(p.staleDate) : null, asOf: clockSec(p.asOf) })), rows, phases: out.M.legs.map((m) => Object.fromEntries(Object.entries(m.phaseAt).filter(([, v]) => v != null).map(([k, v]) => [k, clockSec(v)]))) });
  }
  fs.writeFileSync(path.join(dir, 'JOURNEY_SIMULATION.md'), md.join('\n'));
  fs.writeFileSync(path.join(dir, 'timelines.json'), JSON.stringify(json, null, 1));
  const bad = all.filter((x) => x.violations.length);
  console.log(`${all.length} cases, ${all.reduce((n, x) => n + x.rows.length, 0)} timeline rows, ${bad.length} with violations`);
  if (bad.length) { for (const b of bad) console.log(b.c.id, b.violations.slice(0, 5)); process.exit(1); }
}
