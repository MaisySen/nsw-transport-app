// Build 213 (1 Nov 2026): Kylie's own clip with the app open (heard in headphones in Silent mode, Silent mutes the
// speaker), and the Watch app opening straight to the trip. Bidur: "Was in silent. But headphone on", "Never spoke",
// "Its literally not clickable right now", "Never ever loose what we already have".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('native clip player: the two functions the JS feature-detects, with the same arguments', () => {
  const m = read('modules/transport-ios/ios/TransportIOSModule.swift');
  assert.match(m, /Function\("audioRoute"\) \{ \(\) -> String in\s*ClipPlayer\.route\(\)/);
  assert.match(m, /Function\("playAlertClip"\) \{ \(name: String, headphones: Bool\) -> Bool in\s*ClipPlayer\.shared\.play\(name, headphones: headphones\)/);
  const nx = read('src/lib/nativeExtras.ts');
  assert.match(nx, /play: \(file, force\) => !!m\.playAlertClip\(file, force\)/);
  assert.match(nx, /c\.play\(file, c\.route\(\) === 'headphones'\)/, 'the playback session only while the sound goes to the ears');
});

test('native clip player: headphones play through Silent, the speaker follows Silent, only the bundled clips', () => {
  assert.ok(existsSync(new URL('../modules/transport-ios/ios/ClipPlayer.swift', import.meta.url)));
  const c = read('modules/transport-ios/ios/ClipPlayer.swift');
  assert.match(c, /static let names: Set<String> = \["getoff_soon", "getoff_now", "arrival"\]/);
  assert.match(c, /guard Self\.names\.contains\(name\), let url = Bundle\.main\.url\(forResource: name, withExtension: "wav"\)/);
  assert.match(c, /if headphones \{\s*try s\.setCategory\(\.playback, mode: \.voicePrompt, options: \[\.mixWithOthers, \.duckOthers\]\)\s*\} else \{\s*try s\.setCategory\(\.ambient/);
  assert.match(c, /\[\.headphones, \.bluetoothA2DP, \.bluetoothHFP, \.bluetoothLE\]/);
  assert.match(c, /setActive\(false, options: \.notifyOthersOnDeactivation\)/, 'music comes back up after the clip');
  assert.match(c, /try\? s\.setCategory\(\.ambient, mode: \.default, options: \[\]\)/, 'the next phone-voice alert follows Silent again');
  // no background audio: the app adds no background mode for this
  const app = read('app.json');
  assert.doesNotMatch(app, /"audio"\s*[,\]]/);
  // the clips are bundled (the same files the server's pushes name)
  assert.match(app, /assets\/sounds\/getoff_now\.wav[\s\S]*assets\/sounds\/getoff_soon\.wav[\s\S]*assets\/sounds\/arrival\.wav/);
  for (const f of ['getoff_now', 'getoff_soon', 'arrival']) assert.ok(existsSync(new URL(`../assets/sounds/${f}.wav`, import.meta.url)), f);
});

test('Watch app: opens straight to the trip while one runs, on a tap anywhere and when the phone starts one', () => {
  const w = read('targets/watch/TransportWatchApp.swift');
  // 1 Nov back-nav audit: once per trip (WatchNav.shouldAutoOpen), so Back to the first screen stays on a wrist raise;
  // openTripOnce goes through openTrip. Complication and Smart Stack taps still open it every time.
  assert.match(w, /if p == \.active \{ model\.openTripOnce\(\) \}/, 'opening the app');
  assert.match(w, /if WatchNav\.shouldAutoOpen\(trip: tripKey\(l\), lastOpened: autoOpened\) \{ openTrip\(\) \}/);
  assert.match(w, /\.onOpenURL \{ _ in model\.openTrip\(\) \}/, 'complications and the Smart Stack card');
  assert.match(w, /\.onChange\(of: model\.live != nil\) \{ _, has in if has \{ model\.openTripOnce\(\) \} \}/, 'a trip started on the phone');
  assert.match(w, /if model\.live != nil, path\.isEmpty \{ path\.append\(WatchRoute\.trip\) \}/, 'never over a screen the person opened');
  // every surface is a button: trip row, commute services, starred stops and their departures
  assert.match(w, /NavigationLink\(value: WatchRoute\.trip\) \{ LiveTripRow/);
  assert.equal((w.match(/NavigationLink\(value: s\) \{ ServiceRow/g) || []).length, 2);
  assert.match(w, /\.navigationDestination\(for: WStop\.self\)/, 'starred stop to its next 3 departures, as on 212');
  const cx = read('targets/watch-widget/Complications.swift');
  assert.match(cx, /\.widgetURL\(URL\(string: entry\.kind == \.live \? "nswtransport:\/\/watch\/trip" : "nswtransport:\/\/watch"\)\)/);
});

test('widget bundle: no if/else (WidgetBundleBuilder cannot take one; audit run 41255069387), the watch layout set in the widget', () => {
  const src = read('targets/widget/TransportWidgets.swift');
  const b = src.slice(src.indexOf('struct TransportWidgets: WidgetBundle'), src.indexOf('\n}\n', src.indexOf('struct TransportWidgets: WidgetBundle')));
  assert.ok(b.length > 100);
  assert.doesNotMatch(b, /\} else \{/);
  assert.match(b, /\n\s*LiveTripActivityWidget\(\)\n/);
  const w = read('targets/widget/LiveTripActivityWidget.swift');
  assert.match(w, /if #available\(iOS 18\.0, \*\) \{\s*return config\.supplementalActivityFamilies\(\[\.small\]\)\s*\} else \{\s*return config\s*\}/);
});

test('native audit fixes (build 213): watch card lines shorten, never cut mid-word; Watch trip and service screens', () => {
  const w = read('targets/widget/LiveTripActivityWidget.swift');
  assert.match(w, /WatchCardLine\(text: s\.0, color: s\.1\)/);
  assert.match(w, /lineProbe\("watch-card-status"/);
  assert.match(w, /lineProbe\("watch-card-stop"/);
  // JS mirror of WatchCardLine.variants after ShortText: first comma, then before " to ", then before " at "
  const cut = (t) => { const out = [t]; for (const sep of [', ', ' to ', ' at ']) { const i = t.indexOf(sep); if (i > 0) { t = t.slice(0, i); out.push(t); } } return out; };
  assert.deepEqual(cut('Tight change at Chatswood, 3 min walk to Plat 1'), ['Tight change at Chatswood, 3 min walk to Plat 1', 'Tight change at Chatswood', 'Tight change']);
  assert.deepEqual(cut('Likely miss the 5:12pm T1 to Hornsby at Epping'), ['Likely miss the 5:12pm T1 to Hornsby at Epping', 'Likely miss the 5:12pm T1']);
  const a = read('targets/watch/TransportWatchApp.swift');
  assert.match(a, /let p = WText\.platform\(card\.platform\), !\(detail \?\? ""\)\.contains\(p\)/, 'the platform once');
  assert.match(a, /Text\(WText\.short\(d\)\)\.font\(\.footnote\)\.lineLimit\(nil\)\.fixedSize\(horizontal: false, vertical: true\)/, 'whole destination');
});
