// Voice (Bidur, 25 Oct 9 PM: the trip voice sounded robotic). Every speech call names the best installed voice:
// Premium, then Enhanced, then Default; en-AU first. And the sentences Speak departures says, from live data.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-voice-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const v = await load('src/lib/voiceCore.ts');

// What an iPhone answers (expo-speech reports Premium voices as "Default"; the identifier says premium).
const iphone = [
  { identifier: 'com.apple.voice.compact.en-AU.Karen', name: 'Karen', quality: 'Default', language: 'en-AU' },
  { identifier: 'com.apple.voice.compact.en-US.Samantha', name: 'Samantha', quality: 'Default', language: 'en-US' },
  { identifier: 'com.apple.voice.enhanced.en-GB.Daniel', name: 'Daniel', quality: 'Enhanced', language: 'en-GB' },
  { identifier: 'com.apple.voice.enhanced.en-AU.Karen', name: 'Karen', quality: 'Enhanced', language: 'en-AU' },
  { identifier: 'com.apple.voice.premium.en-US.Zoe', name: 'Zoe', quality: 'Default', language: 'en-US' },
  { identifier: 'com.apple.voice.premium.en-AU.Lee', name: 'Lee', quality: 'Default', language: 'en-AU' },
  { identifier: 'com.apple.eloquence.en-US.Eddy', name: 'Eddy', quality: 'Default', language: 'en-US' },
  { identifier: 'com.apple.speech.synthesis.voice.Bubbles', name: 'Bubbles', quality: 'Default', language: 'en-US' },
  { identifier: 'com.apple.voice.compact.fr-FR.Thomas', name: 'Thomas', quality: 'Default', language: 'fr-FR' },
];

test('quality from the identifier: premium, enhanced, else default', () => {
  assert.equal(v.voiceTier(iphone[5]), 'Premium');
  assert.equal(v.voiceTier(iphone[3]), 'Enhanced');
  assert.equal(v.voiceTier(iphone[0]), 'Default');
  assert.equal(v.voiceTier({ identifier: 'en-au-x-aub-local', quality: 'Enhanced' }), 'Enhanced', 'Android reports its own quality');
});

test('ranking: Premium, Enhanced, Default; en-AU, then en-GB, then en-US; novelty and other languages left out', () => {
  const r = v.rankVoices(iphone).map((x) => x.identifier);
  assert.deepEqual(r, [
    'com.apple.voice.premium.en-AU.Lee', 'com.apple.voice.premium.en-US.Zoe',
    'com.apple.voice.enhanced.en-AU.Karen', 'com.apple.voice.enhanced.en-GB.Daniel',
    'com.apple.voice.compact.en-AU.Karen', 'com.apple.voice.compact.en-US.Samantha',
  ]);
});

test('the best voice is picked; a voice chosen in Settings wins while it is installed', () => {
  assert.equal(v.pickVoice(iphone).identifier, 'com.apple.voice.premium.en-AU.Lee');
  assert.equal(v.pickVoice(iphone, 'com.apple.voice.enhanced.en-GB.Daniel').identifier, 'com.apple.voice.enhanced.en-GB.Daniel');
  assert.equal(v.pickVoice(iphone, 'com.apple.voice.gone').identifier, 'com.apple.voice.premium.en-AU.Lee');
  assert.equal(v.pickVoice([]), null);
  // Only compact voices: en-AU compact is still better than the US one, and the tip shows.
  const compact = iphone.filter((x) => /compact/.test(x.identifier));
  assert.equal(v.pickVoice(compact).identifier, 'com.apple.voice.compact.en-AU.Karen');
  assert.equal(v.onlyCompact(compact), true);
  assert.equal(v.onlyCompact(iphone), false);
});

test('Android: network voices are left out (they send the words to a server)', () => {
  const r = v.rankVoices([
    { identifier: 'en-au-x-aub-network', name: 'en-au-x-aub-network', quality: 'Enhanced', language: 'en-AU' },
    { identifier: 'en-au-x-aub-local', name: 'en-au-x-aub-local', quality: 'Enhanced', language: 'en-AU' },
    { identifier: 'en-us-x-sfg-local', name: 'en-us-x-sfg-local', quality: 'Default', language: 'en_US' },
  ]).map((x) => x.identifier);
  assert.deepEqual(r, ['en-au-x-aub-local', 'en-us-x-sfg-local']);
});

test('label and pace', () => {
  assert.equal(v.voiceLabel(v.rankVoices(iphone)[0]), 'Lee, Australian, Premium');
  assert.deepEqual(v.speechPace('ios'), { rate: 1, pitch: 1 });
});

const T0 = Date.parse('2026-10-25T09:00:00Z');
const iso = (m) => new Date(T0 + m * 60000).toISOString();
test('Speak departures: the next two in one natural sentence, from the board', () => {
  const s = v.departuresSentence([
    { line: 'T1', mode: 'train', dest: 'Emu Plains Station', planned: iso(4), estimated: iso(6), realtime: true, delayMin: 2, platform: 'Platform 1' },
    { line: 'T9', mode: 'train', dest: 'Hornsby Station', planned: iso(9), realtime: false, platform: '3' },
    { line: 'T2', mode: 'train', dest: 'Leppington', planned: iso(12), realtime: false },
  ], T0);
  assert.equal(s, 'The T1 line to Emu Plains leaves in 6 minutes, from platform 1. It is running 2 minutes late. Then the T9 line to Hornsby, in 9 minutes.');
});

test('Speak departures: buses, "1 minute", "now", cancelled and gone services', () => {
  const s = v.departuresSentence([
    { line: '410', mode: 'bus', dest: 'Lane Cove Shops, Great North Rd', planned: iso(-3), departed: true },
    { line: 'D400', mode: 'bus', dest: 'Parramatta Stn', planned: iso(0.5), realtime: true, estimated: iso(0.5), cancelled: true },
    { line: '410', mode: 'bus', dest: 'Opp Lane Cove Shops', planned: iso(1.2), realtime: true, estimated: iso(1.2), platform: 'Stand C' },
    { line: 'D400', mode: 'bus', dest: 'Bondi Junction', planned: iso(0.2) },
  ], T0);
  assert.equal(s, 'The D400 bus to Parramatta Station is cancelled. The 410 bus to opposite Lane Cove Shops leaves in 1 minute, from stand C. Then the D400 bus to Bondi Junction, now.');
  assert.equal(v.departuresSentence([], T0, { stop: 'Chatswood Station' }), 'No more services from Chatswood right now.');
  assert.doesNotMatch(s + v.departuresSentence([{ line: 'T4', mode: 'train', dest: 'Bondi Junction', planned: iso(75) }], T0), /\d+m\b|min\b|\u2013|\u2014/);
});

test('no hard coded times: every number said comes from the data', () => {
  const src = fs.readFileSync(path.join(here, '..', 'src/lib/voiceCore.ts'), 'utf8');
  assert.doesNotMatch(src, /\d{1,2}:\d{2}\s?(am|pm)/i);
});

test('Speak departures on the commute card: to where you get off, and the change', () => {
  const j = (m) => ({ legs: [
    { kind: 'transit', line: 'T1', mode: 'train', to: 'Epping Station', fromPlatform: 'Platform 1', planned: iso(m), realtime: true, estimated: iso(m) },
    { kind: 'walk' },
    { kind: 'transit', line: 'T4', mode: 'train', to: 'Martin Place Station', planned: iso(m + 12) },
  ] });
  assert.equal(v.tripSentence([j(4), j(11)], T0), 'The T1 line to Epping leaves in 4 minutes, from platform 1. Change at Epping for the T4 line. Then the T1 line to Epping, in 11 minutes.');
  const bus = { legs: [{ kind: 'transit', line: '410', mode: 'bus', to: 'Lane Cove Shops, Great North Rd', fromPlatform: 'Stand D', planned: iso(7) }] };
  assert.equal(v.tripSentence([bus], T0), 'The 410 bus to Lane Cove Shops leaves in 7 minutes, from stand D.');
  assert.equal(v.tripSentence([], T0), 'No more services right now.');
});
