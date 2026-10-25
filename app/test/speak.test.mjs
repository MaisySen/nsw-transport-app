// Speak alerts (Bidur, 25 Oct: "Speak alert not working"). Before, speech was tied to the phone's own trip
// notifications, and those are skipped whenever the server follows the trip (notifications on), so nothing was
// ever said on a trip. Now Speak alerts keeps its own memory and reads out each moment once, server watch or not.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-speak-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const live = await load('src/lib/liveCalc.ts');
const format = await load('src/lib/format.ts');
const short = (n) => String(n || '').replace(/ Station$/, '');
const fmt = { clock: format.clock, short, plat: (p) => (p ? p.replace(/^Platform\s*/i, 'Platform ') : '') };

const T0 = Date.parse('2026-10-25T04:00:00Z');
const at = (min) => T0 + min * 60000;
const iso = (t) => new Date(t).toISOString();
// The 415 bus from Concord Oval to Five Dock Shops, 4 stops.
const run = { stops: [['Concord Oval, Parramatta Rd', 0], ['Majors Bay Rd', 2], ['Five Dock Park', 4], ['Garfield St', 5], ['Five Dock Shops, Great North Rd', 7], ['Lyons Rd', 9]], mine: 0, off: 4 };
const leg = { mode: 'bus', line: '415', tripId: '2666549', stopId: '213723', toStopId: '2046100', from: 'Concord Oval, Parramatta Rd', to: 'Five Dock Shops, Great North Rd', planned: iso(at(0)), arrPlanned: iso(at(7)), fromPlatform: 'Stand X1', towards: 'Chiswick' };
function feed(t) {
  const stops = run.stops.map(([name, m], k) => ({ id: 'S' + k, name, planned: iso(at(m)), estimated: iso(at(m)), mine: k === run.mine, alight: k === run.off }));
  let nextIndex = stops.findIndex((s) => Date.parse(s.estimated) > t - 20000);
  if (nextIndex < 0) nextIndex = stops.length;
  return { kind: 'service', live: true, line: '415', mode: 'bus', mineIndex: run.mine, alightIndex: run.off, nextIndex, stops };
}
function replay(g0) {
  let g = g0;
  const said = [], shown = [];
  for (let t = at(-3); t <= at(20); t += 15000) {
    const r = live.stepLive(g, [feed(t)], t, fmt);
    g = r.g;
    for (const a of r.actions) { if (a.t === 'say') said.push({ t, text: a.text }); if (a.t === 'alert') shown.push(a.key); if (a.t === 'end') return { said, shown, g }; }
  }
  return { said, shown, g };
}

test('speak alerts reads out "your stop is next" even when the server sends the notifications', () => {
  const r = replay({ id: 'b1', legs: [leg], alerted: {}, watchId: 'w123', share: null, speak: true });
  assert.equal(r.shown.length, 0, 'the phone shows no notification of its own (the server does)');
  const next = r.said.filter((x) => x.text === 'Five Dock Shops is next. Get off here.');
  assert.equal(next.length, 1, JSON.stringify(r.said));
  assert.ok(r.said.some((x) => x.text === "You've arrived at Five Dock Shops."), JSON.stringify(r.said));
});

test('each moment is read out once', () => {
  const r = replay({ id: 'b2', legs: [leg], alerted: {}, watchId: null, share: null, speak: true });
  const texts = r.said.map((x) => x.text);
  assert.equal(new Set(texts).size, texts.length, JSON.stringify(texts));
  assert.ok(r.shown.includes('off0'), 'the phone notification still shows without a server watch');
});

test('with Wake me on, the alarm replaces the notification but the voice still says it', () => {
  const r = replay({ id: 'b3', legs: [leg], alerted: {}, watchId: null, share: null, speak: true, wake: true });
  assert.ok(!r.shown.includes('off0'));
  assert.ok(r.said.some((x) => x.text === 'Five Dock Shops is next. Get off here.'));
});

test('nothing is said with Speak alerts off', () => {
  const r = replay({ id: 'b4', legs: [leg], alerted: {}, watchId: 'w1', share: null });
  assert.equal(r.said.length, 0);
});

test('speech asks for the system speech session on builds without their own (206), and the app session after', async () => {
  const src = fs.readFileSync(path.join(here, '..', 'src/lib/nativeExtras.ts'), 'utf8');
  assert.match(src, /useApplicationAudioSession: false/);
  assert.match(src, /typeof m\.startSpeechAudio === 'function'/, 'the new native call is feature detected');
  const engine = fs.readFileSync(path.join(here, '..', 'src/lib/liveEngine.ts'), 'utf8');
  assert.match(engine, /a\.t === 'say'\) speak\(a\.text\)/);
  assert.match(engine, /spoken: r\.g\.spoken/, 'what was said is kept with the trip');
  const smart = fs.readFileSync(path.join(here, '..', 'src/components/Smart.tsx'), 'utf8');
  assert.doesNotMatch(smart, /Test voice/, 'no test button in the shipping app');
  assert.match(smart, /store\.setSpeak\(on\)/, 'the switch is remembered');
  const liveSrc = fs.readFileSync(path.join(here, '..', 'src/lib/live.ts'), 'utf8');
  assert.match(liveSrc, /store\.speakOn\(\) && hasSpeech\(\)/, 'a new trip starts with the last choice, only where the phone can speak');
  const nx = fs.readFileSync(path.join(here, '..', 'src/lib/nativeExtras.ts'), 'utf8');
  assert.match(nx, /requireOptionalNativeModule\('ExpoSpeech'\)/, 'builds 201 to 205 (no speech module) hide the switch');
  assert.doesNotMatch(nx, /S\.stop\?\.\(\)/, 'a new alert no longer cuts off the one being said');
});

// The audio options, run for real: speechOptions is the one place that decides how speech asks for audio.
const nxSrc = fs.readFileSync(path.join(here, '..', 'src/lib/nativeExtras.ts'), 'utf8');
const optSrc = nxSrc.slice(nxSrc.indexOf('export function speechOptions'), nxSrc.indexOf('/** Says a trip alert out loud'));
const speechOptions = new Function(ts.transpileModule(optSrc.replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '; return speechOptions;')();
test('206 (no own audio session): the system speech session, which mixes with music instead of stopping it', () => {
  const o = speechOptions(false);
  assert.equal(o.useApplicationAudioSession, false);
  assert.equal(o.language, 'en-AU');
});
test('207 (own spoken audio session): the app session, released when speaking is done, stopped or fails', () => {
  let n = 0; const done = () => n++;
  const o = speechOptions(true, done);
  assert.equal(o.useApplicationAudioSession, true);
  o.onDone(); o.onStopped(); o.onError();
  assert.equal(n, 3);
});

// Each trigger, through the same stepLive the app runs.
function waitStep(over = {}) {
  const t = at(-1.5);
  const stops = run.stops.map(([name, m], k) => ({ id: 'S' + k, name, planned: iso(at(m)), estimated: iso(at(m) + (over.delay || 0) * 60000), mine: k === 0, alight: k === run.off, platform: k === 0 ? (over.plat || 'Stand X1') : undefined }));
  const svc = { kind: 'service', live: true, line: '415', mode: 'bus', mineIndex: 0, alightIndex: run.off, nextIndex: 0, stops };
  return live.stepLive({ id: 'w', legs: [leg], alerted: {}, watchId: 'w9', share: null, speak: true, spoken: over.spoken || {} }, [svc], over.t ?? t, fmt);
}
const says = (r) => r.actions.filter((a) => a.t === 'say').map((a) => a.text);
test('departing soon: "leaves in 2 minutes from Stand X1"', () => {
  assert.deepEqual(says(waitStep()), ['Your bus leaves in 2 minutes from stand X1.']);
});
test('stand or platform change is read out once', () => {
  const r = waitStep({ plat: 'Stand X2', t: at(-10) });
  assert.deepEqual(says(r), ['Stand change. Your bus now leaves from stand X2.']);
  const again = waitStep({ plat: 'Stand X2', t: at(-9), spoken: r.g.spoken });
  assert.deepEqual(says(again), []);
});
test('delay: said at 3 minutes late, again at 5, 10 and 15, not every refresh', () => {
  const r3 = waitStep({ delay: 3, t: at(-10) });
  assert.match(says(r3)[0], /^Your bus is running 3 minutes late\. It now leaves at /);
  assert.deepEqual(says(waitStep({ delay: 4, t: at(-9), spoken: r3.g.spoken })), []);
  assert.match(says(waitStep({ delay: 6, t: at(-9), spoken: r3.g.spoken }))[0], /running 6 minutes late/);
});
test('transfer: a tight change is read out', () => {
  const leg2 = { mode: 'train', line: 'T1', tripId: 'T1x', stopId: 'X', from: 'Five Dock', to: 'Strathfield Station', planned: iso(at(8)), arrPlanned: iso(at(20)), towards: 'Penrith' };
  const svc = feed(at(5));
  const r = live.stepLive({ id: 'c', legs: [leg, leg2], alerted: {}, watchId: 'w', share: null, speak: true }, [svc, null], at(5), fmt);
  assert.ok(says(r).includes('Tight change at Five Dock Shops. 1 minute to catch the T1.'), JSON.stringify(says(r)));
});

test('a train trip: "Redfern is next. Change here for the T4", then "Your train leaves in 2 minutes from platform 1"', () => {
  const T1 = { mode: 'train', line: 'T1', tripId: 'a', stopId: 'X', from: 'Strathfield Station', to: 'Redfern Station', planned: iso(at(0)), arrPlanned: iso(at(7)), fromPlatform: 'Platform 1', towards: 'Hornsby' };
  const T4 = { mode: 'train', line: 'T4', tripId: 'b', stopId: 'Y', from: 'Redfern Station', to: 'Kings Cross Station', planned: iso(at(12)), arrPlanned: iso(at(20)), fromPlatform: 'Platform 6', towards: 'Bondi Junction' };
  const stops = [['Strathfield', 0], ['Burwood', 3], ['Redfern', 7]].map(([n, m], k) => ({ id: 'R' + k, name: n + ' Station', planned: iso(at(m)), estimated: iso(at(m)), platform: k === 0 ? 'Platform 1' : undefined }));
  const ride = { kind: 'service', live: true, mineIndex: 0, alightIndex: 2, nextIndex: 2, stops };
  const r = live.stepLive({ id: 't', legs: [T1, T4], alerted: {}, watchId: 'w', share: null, speak: true }, [ride, null], at(5), fmt);
  assert.deepEqual(says(r), ['Redfern is next. Change here for the T4.']);
  const wait = { ...ride, nextIndex: 0 };
  const r2 = live.stepLive({ id: 't', legs: [T1, T4], alerted: {}, watchId: 'w', share: null, speak: true }, [wait, null], at(-2), fmt);
  assert.deepEqual(says(r2), ['Your train leaves in 2 minutes from platform 1.']);
});

test('names are heard as words: no "Rd", "St", "Stn" or "Opp"', async () => {
  assert.equal(live.sayName('Queens Rd At Wright St, Hurstville'), 'Queens Road at Wright Street');
  assert.equal(live.sayName('Opp Burwood Stn'), 'opposite Burwood Station');
  assert.equal(live.sayName('Strathfield Station'), 'Strathfield');
  assert.equal(live.sayName('Five Dock Shops, Great North Rd'), 'Five Dock Shops');
});
