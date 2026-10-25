// Build 207 native parts for buses and Speak alerts (branch native-207-bus): the names on both sides must match,
// because the JavaScript ships over the air to builds 201 to 207 and checks for each native function first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, '..', p), 'utf8');

test('Speak alerts audio session: the functions JavaScript looks for exist, playback with voice prompt, music lowered', () => {
  const sw = read('modules/transport-ios/ios/TransportIOSModule.swift');
  const js = read('src/lib/nativeExtras.ts');
  for (const f of ['startSpeechAudio', 'endSpeechAudio']) {
    assert.match(sw, new RegExp(`Function\\("${f}"\\)`), f);
    assert.match(js, new RegExp(`\\b${f}\\b`), `${f} is feature detected in nativeExtras.ts`);
  }
  assert.match(sw, /setCategory\(\.playback, mode: \.voicePrompt, options: \[\.duckOthers, \.interruptSpokenAudioAndMixWithOthers\]\)/);
  assert.match(sw, /setActive\(false, options: \.notifyOthersOnDeactivation\)/);
  assert.match(js, /useApplicationAudioSession: true/);
});

test('starred bus stops: the widget reads the fields the app shares (code, mode, lines)', () => {
  const sw = read('targets/widget/WidgetIntents.swift');
  const share = read('platform/widgetShare.ts');
  const m = /struct SharedStarred: Decodable \{([\s\S]*?)\n\}/.exec(sw);
  assert.ok(m, 'SharedStarred');
  for (const k of ['id', 'name', 'code', 'mode', 'lines']) {
    assert.match(m[1], new RegExp(`var ${k}:`), k);
    assert.match(share, new RegExp(`\\b${k}\\b`), `${k} in starredFor`);
  }
  assert.match(sw, /"Stop \\\(c\) · \\\(l\)"/);
});

test('stop board widget: "Stop 2046100" only for a 6 or 7 digit id where every departure is a bus', () => {
  const sw = read('targets/widget/TransportWidgets.swift');
  assert.match(sw, /\(6\.\.\.7\)\.contains\(id\.count\), id\.allSatisfy\(\\\.isNumber\)/);
  assert.match(sw, /\["bus", "coach", "school"\]\.contains\(\$0\)/);
  assert.match(sw, /var stopNo: String\? = nil/);
});
