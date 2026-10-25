// Get a better voice (Bidur, 25 Oct 9:51 PM: going to the phone's settings to download a voice is hard work).
// Voice quality, the new voice check after Settings, the once only prompt on Speak, the iPhone steps and the
// Android settings chain. No private iPhone settings URL anywhere (App Review rejects them).
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-voicehelp-'));
function emit(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return f;
}
emit('src/lib/voiceCore.ts');
const h = await import(pathToFileURL(emit('src/lib/voiceHelpCore.ts')).href);
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const compactAU = { identifier: 'com.apple.voice.compact.en-AU.Karen', name: 'Karen', quality: 'Default', language: 'en-AU' };
const compactUS = { identifier: 'com.apple.voice.compact.en-US.Samantha', name: 'Samantha', quality: 'Default', language: 'en-US' };
const enhancedGB = { identifier: 'com.apple.voice.enhanced.en-GB.Daniel', name: 'Daniel', quality: 'Enhanced', language: 'en-GB' };
const premiumAU = { identifier: 'com.apple.voice.premium.en-AU.Lee', name: 'Lee', quality: 'Default', language: 'en-AU' };
const novelty = { identifier: 'com.apple.speech.synthesis.voice.Bubbles', name: 'Bubbles', quality: 'Default', language: 'en-US' };
const french = { identifier: 'com.apple.voice.premium.fr-FR.Thomas', name: 'Thomas', quality: 'Default', language: 'fr-FR' };

test('voice quality: basic with only compact voices, good with Enhanced or Premium, none with no English voice', () => {
  assert.equal(h.voiceQuality([compactAU, compactUS, novelty]), 'basic');
  assert.equal(h.voiceQuality([compactAU, enhancedGB]), 'good');
  assert.equal(h.voiceQuality([compactAU, premiumAU]), 'good', 'Premium comes back as Default quality; the identifier says premium');
  assert.equal(h.voiceQuality([french]), 'none', 'a French Premium voice does not count');
  assert.equal(h.voiceQuality([]), 'none');
  assert.equal(h.voiceQuality(null), 'none');
  assert.equal(h.voiceQuality([{ identifier: 'en-au-x-aub-local', name: 'en-au-x-aub-local', quality: 'Enhanced', language: 'en-AU' }]), 'good', 'Android reports its own quality');
  assert.equal(h.voiceQuality([{ identifier: 'en-au-x-aub-network', name: 'n', quality: 'Enhanced', language: 'en-AU' }]), 'none', 'network voices are left out');
});

test('better voice found after Settings: a new Enhanced or Premium voice, never a compact one', () => {
  assert.equal(h.betterVoiceFound([compactAU], [compactAU, premiumAU]).identifier, premiumAU.identifier);
  assert.equal(h.betterVoiceFound([compactAU], [compactAU, enhancedGB]).identifier, enhancedGB.identifier);
  assert.equal(h.betterVoiceFound([compactAU], [compactAU, compactUS]), null, 'a new compact voice is not better');
  assert.equal(h.betterVoiceFound([compactAU], [compactAU]), null, 'nothing new yet (the download can still be running)');
  assert.equal(h.betterVoiceFound([compactAU, premiumAU], [compactAU, premiumAU, enhancedGB]), null, 'an Enhanced voice is not better than the Premium one already there');
  assert.equal(h.betterVoiceFound([compactAU, enhancedGB], [compactAU, enhancedGB, premiumAU]).identifier, premiumAU.identifier);
  assert.equal(h.betterVoiceFound([], [premiumAU]).identifier, premiumAU.identifier, 'an empty first read still finds it');
  assert.equal(h.betterVoiceFound(null, [compactAU]), null);
  assert.equal(h.betterVoiceFound([compactAU], [compactAU, french]), null, 'not English');
});

test('the Speak prompt shows once, only with the basic voice, only where the phone can speak', () => {
  const basic = [compactAU, compactUS];
  assert.equal(h.shouldOfferVoiceHelp({ list: basic, seen: false, canSpeak: true }), true);
  assert.equal(h.shouldOfferVoiceHelp({ list: basic, seen: true, canSpeak: true }), false, 'never again once seen');
  assert.equal(h.shouldOfferVoiceHelp({ list: basic, seen: false, canSpeak: false }), false);
  assert.equal(h.shouldOfferVoiceHelp({ list: [compactAU, premiumAU], seen: false, canSpeak: true }), false, 'a natural voice is already there');
  assert.equal(h.shouldOfferVoiceHelp({ list: [], seen: false, canSpeak: true }), false, 'no answer from the phone is not a reason to ask');
});

test('the prompt marks itself seen the moment it shows (a dismiss means never again)', () => {
  const s = read('src/lib/voiceHelp.ts');
  const fn = s.slice(s.indexOf('export async function takeVoicePrompt'));
  assert.match(fn, /if \(store\.voiceHelpSeen\(\)\) return false/);
  assert.match(fn, /if \(ok\) store\.setVoiceHelpSeen\(\)/);
  assert.ok(fn.indexOf('setVoiceHelpSeen') < fn.indexOf('return ok'), 'seen is saved before the prompt is shown');
  const st = read('src/lib/store.ts');
  assert.match(st, /voiceHelpSeen\?: boolean/);
  assert.match(st, /setVoiceHelpSeen\(\) \{ state = \{ \.\.\.state, voiceHelpSeen: true \}; save\(\); \}/);
  const btn = read('src/components/SpeakButton.tsx');
  assert.match(btn, /takeVoicePrompt\(\)\.then\(\(show\) => \{ if \(show\) setHelp\(true\); \}\)/);
});

test('iPhone steps: Read and Speak from iOS 26, Spoken Content before; three plain steps', () => {
  assert.equal(h.iosSpeechPage('26.0'), 'Read & Speak');
  assert.equal(h.iosSpeechPage('27.1'), 'Read & Speak');
  assert.equal(h.iosSpeechPage('18.6'), 'Spoken Content');
  assert.equal(h.iosSpeechPage(null), 'Read & Speak', 'unknown means the current name');
  const s = h.iosVoiceSteps('26.1');
  assert.equal(s.length, 3);
  assert.match(s[0].text, /Settings.*Accessibility/);
  assert.match(s[1].text, /Read & Speak, then Voices, then English/);
  assert.match(s[2].text, /Premium or Enhanced.*download/);
  s.forEach((x, i) => assert.ok(x.a11y.startsWith(`Step ${i + 1}. `)));
  assert.doesNotMatch(s[1].a11y, /&/, 'VoiceOver hears "and"');
  assert.match(h.iosVoiceSteps('18.0')[1].text, /Spoken Content/);
});

test('Android opens text to speech output, then Accessibility, then the app settings', async () => {
  assert.deepEqual([...h.ANDROID_TTS], ['com.android.settings.TTS_SETTINGS', 'android.settings.ACCESSIBILITY_SETTINGS']);
  const calls = [];
  const fail = (n) => () => { calls.push(n); throw new Error(n); };
  const ok = (n) => async () => { calls.push(n); };
  assert.equal(await h.openFirst([ok('tts'), ok('a11y')]), 0);
  calls.length = 0;
  assert.equal(await h.openFirst([fail('tts'), ok('a11y'), ok('app')]), 1);
  assert.deepEqual(calls, ['tts', 'a11y']);
  calls.length = 0;
  const reject = (n) => () => { calls.push(n); return Promise.reject(new Error(n)); };
  assert.equal(await h.openFirst([reject('tts'), reject('a11y'), ok('app')]), 2, 'a rejected intent falls through too');
  assert.equal(await h.openFirst([reject('x')]), -1);
  const lib = read('src/lib/voiceHelp.ts');
  assert.match(lib, /typeof f !== 'function'/, 'sendIntent is looked up first');
  assert.match(lib, /\[send\(ANDROID_TTS_DATA\), \.\.\.ANDROID_TTS\.map\(send\), appSettings\]/);
});

test('no private settings URL and no dashes in the voice help files; Pressables have roles', () => {
  for (const f of ['src/lib/voiceHelpCore.ts', 'src/lib/voiceHelp.ts', 'src/components/VoiceHelp.tsx', 'src/app/voice.tsx', 'src/components/SpeakButton.tsx']) {
    const s = read(f);
    assert.doesNotMatch(s, /App-prefs:|prefs:root|['"]prefs:/i, f);
    assert.doesNotMatch(s, /[\u2013\u2014]/, f);
    assert.doesNotMatch(s, /setInterval\(/, f);
  }
  assert.match(read('src/lib/voiceHelp.ts'), /Linking\.openSettings\(\)/);
});

test('the Voice screen always has the Get a better voice row', () => {
  const s = read('src/app/voice.tsx');
  assert.match(s, /<Row title="Get a better voice"/);
  assert.ok(!/quality === 'basic' \? <Row title="Get a better voice"/.test(s), 'not hidden behind the quality check');
  assert.equal(h.voiceRowSub('basic', 'ios'), 'Your phone only has its basic voice. A clearer one is a free download.');
  assert.match(h.voiceRowSub(null, 'android'), /text to speech/);
});
