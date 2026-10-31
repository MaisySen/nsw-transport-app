// Spoken alert sounds (30 Oct, Bidur on a real trip with build 209: "Didn't speak for the getting off. Only the alert
// notification came in on top... only spoke when I opened the app"). The app speaks only while it is open (no
// background audio, by design), so on build 210 and later the alerts set on the phone ring with a chime and a voice
// as their own sound ("Please get off at the next stop"), heard with the phone locked. Replayed with a fake clock refreshing
// every 15 s like the app; while the app is "closed" only the phone's set alerts ring, with the sound they were set with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linkTs } from './tsLink.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(import.meta.url);
const ts = require(path.join(root, 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-getoffvoice-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, linkTs(js, out, ts));
  return import(pathToFileURL(f).href);
}
const live = await load('src/lib/liveCalc.ts');
const format = await load('src/lib/format.ts');
const G = await load('src/lib/getOffCore.ts');
const short = (n) => String(n || '').replace(/ Station$/, '');
const fmt = { clock: format.clock, short, plat: (p) => (p ? p.replace(/^Platform\s*/i, 'Platform ') : '') };
const src = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');

const T0 = Date.parse('2026-10-28T08:00:00Z'); // Wed 28 Oct, 7:00pm Sydney
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();
// An express on the T9: gets on at stop 1, off at stop 6; stops 3 and 5 are run through (skipped).
const NAMES = ['Cheltenham', 'Epping', 'Eastwood', 'Denistone', 'West Ryde', 'Meadowbank', 'Rhodes', 'Concord West'];
const MIN = [-2, 0, 2, 4, 6, 8, 10, 12];
const SKIP = new Set([3, 5]);
const MINE = 1, OFF = 6;
const LEG = { mode: 'train', line: 'T9', tripId: 'T9.x', stopId: 'EPP', toStopId: 'RHO', from: 'Epping Station', to: 'Rhodes Station', planned: iso(at(0)), arrPlanned: iso(at(10)), fromPlatform: 'Platform 1', towards: 'Hornsby Station' };
const ARR = at(MIN[OFF]);

function feed(delayMin, t, isLive, skip = SKIP) {
  const stops = NAMES.map((name, k) => ({ id: name.slice(0, 3).toUpperCase() + k, name: name + ' Station', lat: -33.8, lon: 151.0 + k * 0.0155, planned: iso(at(MIN[k])), estimated: iso(at(MIN[k]) + delayMin * 60000), mine: k === MINE, alight: k === OFF, ...(skip.has(k) ? { skipped: true } : {}) }));
  let nextIndex = stops.findIndex((s, k) => !skip.has(k) && Date.parse(s.estimated) > t - 20000);
  if (nextIndex < 0) nextIndex = stops.length;
  return { kind: 'service', live: isLive, line: 'T9', mode: 'train', mineIndex: MINE, alightIndex: OFF, nextIndex, stops };
}

// Where each stop is (31 Oct, location alerts): on a line east, about 1.4 km apart; the train moves between stops at
// a steady speed on its live times, so a late train reaches each circle late.
const POS = NAMES.map((_, k) => ({ lat: -33.8, lon: 151.0 + k * 0.0155 }));
function trainAt(t, delayMin) {
  const times = MIN.map((m) => at(m) + delayMin * 60000);
  if (t <= times[0]) return POS[0];
  for (let k = 0; k < times.length - 1; k++) {
    if (t <= times[k + 1]) { const f = (t - times[k]) / (times[k + 1] - times[k]); return { lat: POS[k].lat, lon: POS[k].lon + (POS[k + 1].lon - POS[k].lon) * f }; }
  }
  return POS[POS.length - 1];
}
const metres = (a, b) => G.metres(a, b);

/** One trip refreshed every 15 s. The app runs before `closeAt` and from `openAt` (minutes); between, only the phone's
 * set alerts ring: since 31 Oct those are location alerts (backup 'region'), rung when the train enters the circle. */
function replay({ pref = G.GETOFF_DEFAULT, delay = 0, isLive = true, speak = false, sayNow = true, voice = { now: true, all: false }, from = -3, closeAt = Infinity, openAt = Infinity, skip = SKIP, flipAt = null, flipTo = null, backup = 'region' } = {}) {
  let g = { id: 'g1', legs: [LEG], alerted: {}, watchId: null, share: null, speak, spoken: {}, offSet: {}, offVoice: {}, offRegion: {} };
  const alarms = new Map();
  const regions = new Map();
  const rang = [], said = [], sets = [];
  const presented = new Set();
  let ended = false;
  for (let t = at(from); t <= at(20) && !ended; t += 15000) {
    for (const [id, a] of [...alarms]) if (a.at <= t) { rang.push({ id, t: a.at, by: 'phone', sound: a.sound }); presented.add(id); alarms.delete(id); }
    for (let u = t - 14000; u <= t; u += 1000) {
      const p = trainAt(u, delay);
      for (const [id, a] of [...regions]) if (metres(p, a) <= a.radius) { rang.push({ id, t: u, by: 'phone', sound: a.sound }); presented.add(id); regions.delete(id); }
    }
    if (t >= at(closeAt) && t < at(openAt)) continue;
    const v = flipAt != null && t >= at(flipAt) ? flipTo : voice;
    const r = live.stepLive(g, [feed(delay, t, isLive, skip)], t, fmt);
    const rung = G.ownRungKeys(g.id, [...presented]);
    const o = G.getOffStep({ id: g.id, legs: g.legs, alerted: r.g.alerted, offSet: g.offSet, speak, sayNow, spoken: r.g.spoken, voice: v, offVoice: g.offVoice, backup, offRegion: g.offRegion, rung, liveAt: t }, pref, r.s, t, fmt);
    g = { ...r.g, alerted: o.g.alerted, spoken: o.g.spoken, offSet: o.g.offSet, offVoice: o.g.offVoice, offRegion: o.g.offRegion };
    for (const a of o.actions) {
      if (a.t === 'offSchedule') { alarms.set(a.id, { at: a.at, sound: a.sound, quiet: a.quiet }); sets.push({ ...a, t }); }
      else if (a.t === 'regionSchedule') { regions.set(a.id, { lat: a.lat, lon: a.lon, radius: a.radius, sound: a.sound }); sets.push({ ...a, t }); }
      else if (a.t === 'offCancel' || a.t === 'regionCancel') { alarms.delete(a.id); regions.delete(a.id); }
      else if (a.t === 'offDue') { if (!presented.has(a.id)) { alarms.delete(a.id); rang.push({ id: a.id, t, by: 'app', sound: a.sound }); presented.add(a.id); } }
      else if (a.t === 'say') said.push({ ...a, t });
    }
    for (const a of r.actions) if (a.t === 'end') ended = true;
  }
  return {
    early: rang.filter((x) => /-(early|rsoon)\d+$/.test(x.id)),
    now: rang.filter((x) => /-(gnow|rnow)\d+$/.test(x.id)),
    said, saidNow: said.filter((x) => /^gnow/.test(x.key)), saidEarly: said.filter((x) => /^early/.test(x.key)), sets, g,
  };
}

const leaves = (k, d = 0) => at(MIN[k]) + d * 60000;

test('phone locked the whole ride (Bidur, 30 Oct): Get off now rings once with the spoken sound, before the arrival', () => {
  // 31 Oct: it rings from the phone's position (the location alert around Rhodes), not a clock.
  const r = replay({ pref: { stops: 1, now: true }, closeAt: 1, openAt: 30 });
  assert.equal(r.now.length, 1, JSON.stringify(r));
  assert.equal(r.now[0].by, 'phone');
  assert.match(r.now[0].id, /-rnow0$/);
  assert.equal(r.now[0].sound, 'getoff_now', 'the alert itself speaks: the app is not running to do it');
  assert.ok(r.now[0].t < ARR && r.now[0].t > ARR - 60000, 'as the train reaches the stop');
  // Running 4 min late: it comes with the train, 4 min later, never at the timetable time.
  const late = replay({ pref: { stops: 1, now: true }, closeAt: 1, openAt: 30, delay: 4 });
  assert.equal(late.now.length, 1);
  assert.ok(late.now[0].t > ARR + 4 * 60000 - 60000 && late.now[0].t < ARR + 4 * 60000);
  // Without location (quiet backup): nothing is voiced from the phone while locked.
  const q = replay({ pref: { stops: 1, now: true }, closeAt: 1, openAt: 30, backup: 'quiet' });
  assert.equal(q.now.length, 0);
  assert.ok(q.sets.every((a) => !a.sound));
});

test('builds without the sounds (209 and older): exactly as before, normal alert sound, no sound named', () => {
  const r = replay({ pref: { stops: 2, now: true }, closeAt: 1, openAt: 30, voice: null });
  assert.equal(r.now.length, 1);
  assert.equal(r.now[0].sound, undefined);
  assert.ok(r.early.every((x) => x.sound === undefined));
  assert.ok(r.sets.every((a) => !('sound' in a)));
  const open = replay({ pref: { stops: 2, now: true }, voice: null });
  assert.equal(open.saidNow.length, 1, 'with the app open it is read out, as before');
  assert.deepEqual(open.g.offVoice || {}, {});
});

test('spoken Get off now turned off: the alert rings with the normal sound', () => {
  const r = replay({ pref: { stops: 1, now: true }, closeAt: 1, openAt: 30, voice: { now: false, all: false }, sayNow: false });
  assert.equal(r.now.length, 1);
  assert.equal(r.now[0].sound, undefined);
});

test('the heads up speaks only with Speak alerts on, the same rule as reading out', () => {
  const off = replay({ pref: { stops: 2, now: true }, closeAt: 3, openAt: 30 });
  assert.equal(off.early.length, 1);
  assert.equal(off.early[0].sound, undefined);
  const on = replay({ pref: { stops: 2, now: true }, closeAt: 3, openAt: 30, voice: { now: false, all: true }, speak: true, sayNow: false });
  assert.equal(on.early.length, 1);
  assert.equal(on.early[0].sound, 'getoff_soon');
  assert.equal(on.now[0].sound, 'getoff_now', 'Speak alerts on covers Get off now too');
});

test('rang with its voice and the app opened before arrival: not said a second time', () => {
  const r = replay({ pref: { stops: 1, now: true }, closeAt: 9, openAt: 9.75 });
  assert.equal(r.now.length, 1);
  assert.equal(r.now[0].sound, 'getoff_now');
  assert.equal(r.saidNow.length, 0, 'the phone already said it');
  assert.ok(r.g.spoken.gnow0, 'marked said');
  assert.deepEqual(r.g.offVoice, {}, 'nothing left over');
});

test('app open the whole time: the set alert rings with its voice and the app does not read it out on top', () => {
  const r = replay({ pref: { stops: 1, now: true } });
  assert.equal(r.now.length, 1);
  assert.equal(r.saidNow.length + (r.now[0].sound ? 1 : 0), 1, 'heard exactly once: ' + JSON.stringify({ now: r.now, said: r.saidNow }));
});

test('rung at once with the app open: the app reads it out (it names the stop) and the alert has the normal sound', () => {
  // The heads up is due at once when the service is already that many stops away with the app open.
  const r = replay({ pref: { stops: 2, now: true }, speak: true, voice: { now: true, all: true }, from: 2.5 });
  const due = [...r.early, ...r.now].filter((x) => x.by === 'app');
  assert.ok(due.length >= 1, JSON.stringify(r));
  for (const d of due) assert.equal(d.sound, undefined, 'the app speaks it: no second voice');
  assert.ok(r.saidEarly.length + r.saidNow.length >= due.length);
});

test('rung at once with the app open but app speech unavailable: the alert carries the spoken sound instead', () => {
  const r = replay({ pref: { stops: 2, now: true }, speak: false, sayNow: false, voice: { now: true, all: true }, from: 2.5 });
  const due = [...r.early, ...r.now].filter((x) => x.by === 'app');
  assert.ok(due.length >= 1, JSON.stringify(r));
  assert.ok(due.every((d) => d.sound), JSON.stringify(due));
  assert.equal(r.said.length, 0);
});

test('turning the voice off mid trip sets the location alert again (same place) without the sound, and on again with it', () => {
  const r = replay({ pref: { stops: 1, now: true }, flipAt: 2, flipTo: { now: false, all: false }, sayNow: false });
  const nowSets = r.sets.filter((a) => /rnow/.test(a.key));
  assert.ok(nowSets.length >= 2, JSON.stringify(nowSets));
  assert.equal(nowSets[0].sound, 'getoff_now');
  assert.equal(nowSets[nowSets.length - 1].sound, undefined);
  assert.equal(r.now.length, 1);
  assert.equal(r.now[0].sound, undefined);
  const back = replay({ pref: { stops: 1, now: true }, voice: { now: false, all: false }, flipAt: 2, flipTo: { now: true, all: false }, closeAt: 3, openAt: 30 });
  assert.equal(back.now[0].sound, 'getoff_now');
});

test('which builds have the sounds: iPhone 210 and later, Android versionCode 6 and later, never web', () => {
  assert.equal(G.voiceClipsSupported('ios', '209'), false);
  assert.equal(G.voiceClipsSupported('ios', '210'), true);
  assert.equal(G.voiceClipsSupported('ios', 211), true);
  assert.equal(G.voiceClipsSupported('ios', null), false);
  assert.equal(G.voiceClipsSupported('android', '5'), false);
  assert.equal(G.voiceClipsSupported('android', '6'), true);
  assert.equal(G.voiceClipsSupported('web', '999'), false);
  assert.equal(G.getOffSoundChannel('getoff_now'), 'getoff_now');
});

test('the sound files: in the app, short, mono PCM wav, named in app.json for the notifications plugin', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const plug = cfg.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-notifications');
  assert.ok(plug, 'expo-notifications plugin');
  for (const name of ['getoff_now', 'getoff_soon']) {
    assert.ok(plug[1].sounds.includes(`./assets/sounds/${name}.wav`), name);
    assert.match(name, /^[a-z0-9_]+$/, 'Android raw resource names');
    const b = fs.readFileSync(path.join(root, 'assets', 'sounds', `${name}.wav`));
    assert.equal(b.toString('ascii', 0, 4), 'RIFF');
    assert.equal(b.toString('ascii', 8, 12), 'WAVE');
    const fmtAt = b.indexOf('fmt ');
    assert.equal(b.readUInt16LE(fmtAt + 8), 1, 'linear PCM (iPhone alert sounds: PCM, MA4, uLaw or aLaw)');
    const channels = b.readUInt16LE(fmtAt + 10), rate = b.readUInt32LE(fmtAt + 12), bits = b.readUInt16LE(fmtAt + 22);
    const dataAt = b.indexOf('data');
    const secs = b.readUInt32LE(dataAt + 4) / (rate * channels * bits / 8);
    assert.ok(secs > 1.5 && secs < 10, `${name} is ${secs.toFixed(1)} s (alert sounds must be under 30 s)`);
    assert.ok(G.GETOFF_SOUND_WORDS[name].length > 10);
  }
});

test('the wiring: alerts carry the sound to the phone, only on builds that have it, with a server off switch', () => {
  const notify = src('lib/getOffNotify.ts');
  assert.match(notify, /voiceClipsSupported\(Platform\.OS, build\)/);
  assert.match(notify, /isOn\('getOffVoice'\)/);
  assert.match(notify, /sound: voice && sound \? `\$\{sound\}\.wav` : true/);
  assert.match(notify, /setNotificationChannelAsync\(getOffSoundChannel\(sound\)/);
  assert.match(notify, /interruptionLevel: 'timeSensitive'/);
  const eng = src('lib/liveEngine.ts');
  assert.match(eng, /voiceClips\(\) \? \{ now: readGetOffSay\(store\.getOffSay\(\)\), all: !!g\.speak \} : null/);
  assert.match(eng, /scheduleGetOff\(a\.id, a\.at, a\.title, a\.body, a\.sound\)/);
  assert.match(eng, /getOffNow\(a\.id, a\.title, a\.body, a\.sound\)/);
  assert.match(eng, /offVoice: o\.g\.offVoice/);
  const lv = src('lib/live.ts');
  assert.match(lv, /voiceClips\(\) && !!g\.speak && \(await soundChannels\(\)\) \? \{ voice: 'soon' \}/);
  // Speaking with the phone locked is the alert sound's job: no background audio mode is added for it.
  const cfg = fs.readFileSync(path.join(root, 'app.json'), 'utf8');
  assert.doesNotMatch(cfg, /"audio"/);
});
