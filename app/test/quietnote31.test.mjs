// quietnote31 (31 Oct, Bidur at 11:37 AM): with location off, the one quiet "Your stop is coming up soon" note must
// come no earlier than the live arrival less 2 min, and never from live times over 5 min old. Build 211 as merged set it
// ahead from a live arrival; the phone was then locked, the app read nothing more, the service ran late, and the note
// rang early. The app gets no live times while the phone is locked (no background modes), so the note now waits on the
// phone only when it rings within 5 min of the read it comes from, and moves on any later arrival. Stop names made up.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-quietnote-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const live = await load('src/lib/liveCalc.ts');
const format = await load('src/lib/format.ts');
const G = await load('src/lib/getOffCore.ts');
const short = (n) => String(n || '').replace(/ Station$/, '');
const fmt = { clock: format.clock, short, plat: (p) => (p ? p.replace(/^Platform\s*/i, 'Platform ') : '') };
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const T0 = Date.parse('2026-10-26T21:00:00Z');
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();
const POS = (k, gap = 0.0155) => ({ lat: -33.8, lon: 151.0 + k * gap });
// Made-up line: get on at stop 1 (Northgate), off at stop 5 (Riverside).
const NAMES = ['Hilltop', 'Northgate', 'Elmwood', 'Parkside', 'Millbrook', 'Riverside', 'Southend'];
const MIN = [-2, 0, 3, 6, 9, 12, 15];
const MINE = 1, OFF = 5;
const ARR = at(MIN[OFF]);
function feed({ delay = 0, t = at(0), isLive = true, gap = 0.0155, mode = 'train', noPos = false } = {}) {
  const stops = NAMES.map((name, k) => ({ id: 'S' + k, name: name + ' Station', ...(noPos ? {} : POS(k, gap)), planned: iso(at(MIN[k])), estimated: iso(at(MIN[k]) + delay * 60000), mine: k === MINE, alight: k === OFF }));
  let nextIndex = stops.findIndex((s) => Date.parse(s.estimated) > t - 20000);
  if (nextIndex < 0) nextIndex = stops.length;
  return { kind: 'service', live: isLive, line: 'X1', mode, mineIndex: MINE, alightIndex: OFF, nextIndex, stops };
}
const LEG = { mode: 'train', line: 'X1', tripId: 'X1.r', stopId: 'S1', toStopId: 'S5', from: 'Northgate Station', to: 'Riverside Station', planned: iso(at(0)), arrPlanned: iso(ARR) };
const BUS = { ...LEG, mode: 'bus', line: '333' };
const state = (o = {}, leg = LEG) => live.computeLive([leg], [feed({ mode: leg.mode, ...o })], o.t ?? at(0), {});
const base = (o = {}) => ({ id: 'g1', legs: [LEG], alerted: {}, offSet: {}, offRegion: {}, voice: { now: true, all: true }, ...o });
const keys = (acts, t) => acts.filter((a) => a.t === t).map((a) => a.key).sort();

const GETOFF = /get off/i;
const MS = 60000;
/** Live arrival at minute t, when the service starts running `slip` min late from minute `slipAt` (else on time). */
const delayAt = (t, slipAt, slip) => (t >= at(slipAt) ? slip : 0);
/**
 * Replays one trip on a phone in 15 s steps. The app is open (reads live times, runs getOffStep) before `lockAt` and
 * from `openAt`; in between the phone is locked and only what is already set on it can ring. Returns what rang.
 */
function replay({ lockAt, openAt = 99, slipAt = 99, slip = 0, endAt = 16 }) {
  let g = base({ backup: 'quiet' });
  const pending = new Map();
  const rang = [];
  let lastRead = null;
  for (let t = at(0); t <= at(endAt); t += 15000) {
    for (const [id, p] of [...pending]) if (p.at <= t) { pending.delete(id); rang.push({ ...p, firedAt: p.at, liveArr: ARR + delayAt(p.at, slipAt, slip) * MS, readAt: p.readAt }); }
    const open = t < at(lockAt) || t >= at(openAt);
    if (!open) continue;
    lastRead = t;
    const shown = rang.map((x) => x.id);
    const s = state({ delay: delayAt(t, slipAt, slip), t });
    const r = G.getOffStep({ ...g, liveAt: t, rung: G.ownRungKeys('g1', shown) }, G.GETOFF_DEFAULT, s, t, fmt);
    for (const a of r.actions) {
      if (a.t === 'offSchedule') pending.set(a.id, { id: a.id, key: a.key, at: a.at, title: a.title, body: a.body, sound: a.sound, quiet: a.quiet, readAt: t });
      else if (a.t === 'offCancel') pending.delete(a.id);
    }
    g = { ...g, ...r.g };
  }
  return { rang, lastRead };
}

test('Bidur\'s case: locked a minute in, the train then runs 4 min late: the quiet note never rings before the live arrival less 2 min', () => {
  const { rang } = replay({ lockAt: 1, slipAt: 6, slip: 4 });
  for (const x of rang) assert.ok(x.firedAt >= x.liveArr - 2 * MS, `rang ${(x.liveArr - 2 * MS - x.firedAt) / MS} min early`);
  for (const x of rang) assert.ok(x.firedAt - x.readAt <= 5 * MS, `rang from live times ${(x.firedAt - x.readAt) / MS} min old`);
});

test('every quiet note rings from live times read at most 5 min before it, whenever the phone is locked', () => {
  for (let lock = 0.25; lock <= 11; lock += 0.25) {
    const { rang } = replay({ lockAt: lock });
    for (const x of rang) assert.ok(x.firedAt - x.readAt <= 5 * MS, `locked at ${lock}: rang ${(x.firedAt - x.readAt) / MS} min after the read`);
  }
});

test('a slip that comes more than 5 min after the last read never makes the note ring early (any lock time, any delay)', () => {
  for (let lock = 0.25; lock <= 11; lock += 0.25) for (const slip of [1, 3, 8]) for (let slipAt = lock + 5.25; slipAt <= 14; slipAt += 0.5) {
    const { rang } = replay({ lockAt: lock, slipAt, slip });
    for (const x of rang) assert.ok(x.firedAt >= x.liveArr - 2 * MS, `locked ${lock}, ${slip} min late from ${slipAt}: ${(x.liveArr - 2 * MS - x.firedAt) / MS} min early`);
  }
});

test('used within 5 min of the note: set from that read, rings once at the live arrival less 2 min, quiet, never "get off"', () => {
  const { rang } = replay({ lockAt: 8.5 });
  assert.equal(rang.length, 1, JSON.stringify(rang));
  assert.equal(rang[0].key, 'quiet0');
  assert.equal(rang[0].firedAt, ARR - 2 * MS);
  assert.equal(rang[0].quiet, true);
  assert.equal(rang[0].sound, undefined);
  assert.doesNotMatch(rang[0].title + rang[0].body, GETOFF);
});

test('locked further ahead than that: nothing waits on the phone; opened again in time, the next read sets it', () => {
  const locked = replay({ lockAt: 1 });
  assert.equal(locked.rang.length, 0, 'no note from a read 9 min before it');
  const again = replay({ lockAt: 1, openAt: 6, slipAt: 3, slip: 2 });
  assert.equal(again.rang.length, 1);
  assert.equal(again.rang[0].firedAt, ARR + 2 * MS - 2 * MS, 'from the new read: the late arrival less 2 min');
});

test('one set earlier is taken back once it would ring more than 5 min after the read it came from', () => {
  const a = G.getOffStep(base({ backup: 'quiet', liveAt: at(6) }), G.GETOFF_DEFAULT, state({ t: at(6) }), at(6), fmt);
  assert.deepEqual(keys(a.actions, 'offSchedule'), ['quiet0']);
  // Read again at 7 min: the train is now 4 min late, so the note would be at 14 min, 7 min after this read.
  const b = G.getOffStep({ ...base({ backup: 'quiet' }), ...a.g, liveAt: at(7) }, G.GETOFF_DEFAULT, state({ delay: 4, t: at(7) }), at(7), fmt);
  assert.ok(b.actions.some((x) => x.t === 'offCancel' && x.key === 'quiet0'), JSON.stringify(b.actions));
  assert.equal(keys(b.actions, 'offSchedule').length, 0);
});

test('moved on any later arrival, even 10 s (kept, it would ring 10 s early); 10 s earlier it stays (rings 10 s late, never early)', () => {
  const a = G.getOffStep(base({ backup: 'quiet', liveAt: at(8) }), G.GETOFF_DEFAULT, state({ t: at(8) }), at(8), fmt);
  assert.equal(a.actions.find((x) => x.t === 'offSchedule').at, ARR - 2 * MS);
  const later = G.getOffStep({ ...base({ backup: 'quiet' }), ...a.g, liveAt: at(8.25) }, G.GETOFF_DEFAULT, state({ delay: 10 / 60, t: at(8.25) }), at(8.25), fmt);
  const m = later.actions.find((x) => x.t === 'offSchedule');
  assert.ok(m, 'moved: ' + JSON.stringify(later.actions));
  assert.equal(m.at, ARR + 10000 - 2 * MS);
  assert.equal(m.id, 'getoff-g1-quiet0', 'same id replaces it');
  const earlier = G.getOffStep({ ...base({ backup: 'quiet' }), ...a.g, liveAt: at(8.25) }, G.GETOFF_DEFAULT, state({ delay: -10 / 60, t: at(8.25) }), at(8.25), fmt);
  assert.equal(earlier.actions.length, 0, JSON.stringify(earlier.actions));
});

test('quietWithinFresh: within 5 min of the read, and never without one', () => {
  assert.equal(G.quietWithinFresh(at(5), at(0)), true);
  assert.equal(G.quietWithinFresh(at(5) + 1, at(0)), false);
  assert.equal(G.quietWithinFresh(at(5), null), false);
  assert.equal(G.quietWithinFresh(NaN, at(0)), false);
});
