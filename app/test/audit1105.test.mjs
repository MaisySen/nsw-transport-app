// Audit fixes (5 Nov, JS over the air plus native code for the next build): no profile switch link, ids out of
// request addresses where the server reads headers, start links start only this phone's own trips, Delete all my
// data makes new ids, the install ID is shown in More, native widget and watch clocks follow the 24 hour setting,
// the Android build script runs in its own folder, and the iPhone privacy manifest lists crash data.
// Run: OFFLINE=1 TZ=Australia/Sydney node --test test/audit1105.test.mjs
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-audit1105-'));
async function load(rel, swap = {}) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  js = js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  for (const [k, v] of Object.entries(swap)) js = js.split(`from '${k}'`).join(`from '${v}'`);
  const f = path.join(out, path.basename(rel).replace(/\.tsx?$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
  const rel = path.join(dir, e.name);
  return e.isDirectory() ? walk(rel) : /\.(ts|tsx|mjs|js)$/.test(e.name) ? [rel] : [];
});

const S = await load('src/lib/servesCore.ts');
const HB = await load('src/lib/homeBundleCore.ts');
const IN = await load('platform/intentInboxCore.ts');

test('the profile link keeps this phone\'s own id, warns plainly and can switch back', () => {
  // Kept (docs/STORE.md: the owner's way to bring their trips to a new install), but a stranger's link can no longer
  // cost you your own trips: the old id is saved first and Switch back returns to it.
  const src = read('src/app/profile/[id].tsx');
  assert.match(src, /setItem\(PREVIOUS_KEY, current\)[\s\S]*setItem\('profile', clean\)/, 'the old id is kept before the switch');
  assert.match(src, /Switch back to my own trips/);
  assert.match(src, /Anyone who has this link can see and change/);
  assert.match(src, /clean\.length >= 16/, 'short ids are refused');
});

test('ids ride as headers on a server that says id-headers, and in the address only on one that does not', () => {
  assert.equal(S.ID_HEADERS, 'id-headers');
  const prof = { device: '', profile: 'u0a1b2c3d4e5f6g7h8i9j0k1l' };
  assert.deepEqual(S.placeIds('/api/saved', prof, true), { path: '/api/saved', headers: { 'x-profile': prof.profile } });
  assert.deepEqual(S.placeIds('/api/saved', prof, false), { path: `/api/saved?profile=${prof.profile}`, headers: {} });
  assert.deepEqual(S.placeIds('/api/commutes?id=c1', prof, true).path, '/api/commutes?id=c1');
  const both = { device: 'app0a1b2c3d4e5f6g7h8i9j0k1l', profile: prof.profile };
  const ask = S.placeIds('/api/ask?q=central%20to%20manly&fare=adult', both, true);
  assert.equal(ask.path, '/api/ask?q=central%20to%20manly&fare=adult');
  assert.deepEqual(ask.headers, { 'x-device': both.device, 'x-profile': both.profile });
  assert.equal(S.placeIds('/api/watch?id=w1', { device: both.device }, false).path, `/api/watch?id=w1&device=${both.device}`);
});

test('Ask, saved trips, commutes and one watch read go through the shared ids rule', () => {
  const api = read('src/lib/api.ts');
  // No read or write puts the profile in its address by hand any more.
  assert.equal(/qs\(\{[^}]*\bprofile\b/.test(api), false, 'no profile inside qs({...})');
  assert.equal(/[?&]profile=/.test(api.replace(/\/\[\?&\]profile=\//g, '')), false, 'no profile= in a path');
  for (const name of ['saved', 'deleteSaved', 'commutes', 'saveCommute', 'deleteCommute', 'dismissSuggestion', 'watches']) {
    const line = api.split('\n').find((l) => l.trimStart().startsWith(`${name}: `));
    assert.ok(line && /withIds\(true, false\)/.test(line), name);
  }
  const detail = api.split('\n').find((l) => l.trimStart().startsWith('watchDetail: '));
  assert.ok(detail && /withIds\(false\)/.test(detail), 'watchDetail sends the device');
  const ask = read('src/app/(tabs)/ask/index.tsx');
  assert.equal(/profile: PROFILE, device:/.test(ask), false);
  assert.match(ask, /placeIds\(`\/api\/ask\?\$\{qs\}`, \{ device, profile: PROFILE \}, serves\(ID_HEADERS, base\)\)/);
  assert.match(ask, /fetch\(base \+ placed\.path, \{ signal: ctl\.signal, headers: placed\.headers \}\)/);
});

test('saved trips and commutes with no query still go in the Home bundle; a kept read with a profile in it is dropped', () => {
  assert.ok(HB.homeReadOk('/api/saved'));
  assert.ok(HB.homeReadOk('/api/commutes'));
  assert.ok(!HB.homeReadOk('/api/watches'));
  assert.match(read('src/lib/api.ts'), /drop: \(r\) => \(r\.p === CONFIG_READ && !o\.config\) \|\| \/\[\?&\]profile=\/\.test\(r\.p\)/);
  // Delete all my data forgets the noted reads (one names the old device id in its address) and saves that.
  let saved = null;
  const H = HB.createHomeBundle({ now: () => 0, set: () => 1, clear: () => {} }, (l) => { saved = l; });
  H.load({ start: [{ p: '/api/watches?device=app0&since=0', ids: true }, { p: '/api/saved', ids: true }] });
  assert.equal(H.lists().start.length, 2);
  H.reset();
  assert.deepEqual(H.lists(), {});
  assert.deepEqual(saved, {});
});

test('a start link starts at once only for one of this phone\'s own trips, either way round', () => {
  const home = { id: '2095163', name: 'Manly Wharf' }, work = { id: '200060', name: 'Central Station' };
  const saved = { name: 'Uni', from: { id: '2150106' }, to: { id: '2500220' } };
  const commute = { from: { id: '2780100' }, to: { id: '209523' } };
  const own = [{ from: home, to: work }, saved, commute];
  assert.equal(IN.ownStart(home.id, work.id, own), true);
  assert.equal(IN.ownStart(work.id, home.id, own), true, 'the evening way back');
  assert.equal(IN.ownStart('2500220', '2150106', own), true, 'Smart turns a saved trip round');
  assert.equal(IN.ownStart('2780100', '209523', own), true);
  assert.equal(IN.ownStart('2150106', '200060', own), false, 'a pair from a stranger\'s link');
  assert.equal(IN.ownStart(home.id, home.id, own), false);
  assert.equal(IN.ownStart('', work.id, own), false);
  assert.equal(IN.ownStart(home.id, work.id, [{ from: undefined, to: work }, null, { from: { id: '' }, to: { id: '' } }]), false, 'no Home set');
  assert.equal(IN.ownStart(undefined, null, own), false);
  const trip = read('src/app/trip.tsx');
  assert.match(trip, /if \(ownStart\(from\.id, to\.id, own\)\) setAutoStart\(i\);/);
  assert.equal(/\n\s*setAutoStart\(i\);\n/.test(trip), false, 'no start without the check');
  assert.match(trip, /!storeLoaded\) return;/, 'waits for the saved places and trips');
});

test('Delete all my data makes new profile and device ids, written so the widgets and the watch follow', async () => {
  const calls = [];
  const mem = new Map([['profile', 'u000000000000000000000000'], ['device', 'app000000000000000000000000']]);
  fs.writeFileSync(path.join(out, 'as-mock.mjs'), 'export default globalThis.__asMock;');
  globalThis.__asMock = {
    getItem: async (k) => { calls.push(['get', k]); return mem.has(k) ? mem.get(k) : null; },
    setItem: async (k, v) => { calls.push(['set', k]); mem.set(k, v); },
    removeItem: async (k) => { calls.push(['remove', k]); mem.delete(k); },
    multiRemove: async (ks) => { calls.push(['multiRemove', ks.join(',')]); ks.forEach((k) => mem.delete(k)); },
  };
  await load('src/lib/profileMigrate.ts');
  await load('src/lib/pollCore.ts');
  const D = await load('src/lib/device.ts', { '@react-native-async-storage/async-storage': './as-mock.mjs' });
  assert.equal(await D.initProfile(), 'u000000000000000000000000');
  assert.equal(await D.getDevice(), 'app000000000000000000000000');
  assert.equal(await D.renewIds(), true);
  assert.match(D.PROFILE, /^u[0-9a-z]{24}$/);
  assert.notEqual(D.PROFILE, 'u000000000000000000000000');
  assert.match(await D.getDevice(), /^app[0-9a-z]{24}$/);
  assert.notEqual(await D.getDevice(), 'app000000000000000000000000');
  assert.equal(mem.get('profile'), D.PROFILE);
  assert.equal(mem.get('device'), await D.getDevice());
  // setItem, not multiSet: platform/iosBridge.ts copies 'profile' to the app group and the watch from setItem.
  assert.ok(calls.some(([op, k]) => op === 'set' && k === 'profile'));
  assert.match(read('platform/iosBridge.ts'), /const WATCH = new Set\(\['liveTrip', 'profile', 'store', 'apiBase'\]\)/);
  assert.match(read('platform/iosBridge.ts'), /putString\('apiProfile', profile\)/);

  const st = read('src/app/(tabs)/settings/index.tsx');
  const del = st.slice(st.indexOf('const deleteAll'), st.indexOf('const turnOn'));
  const at = (s) => { const i = del.indexOf(s); assert.ok(i > 0, s); return i; };
  // The old ids are used for the server delete and the push token delete, and only then made new.
  assert.ok(at("api.deleteHistory('all')") < at('await renewIds()'));
  assert.ok(at('await disablePush()') < at('await renewIds()'));
  assert.ok(at('await forgetPushTokens()') < at('await renewIds()'));
  assert.ok(at('await syncLiftAlerts(false)') < at('await renewIds()'));
  assert.ok(at('AsyncStorage.multiRemove') < at('await renewIds()'));
  assert.ok(at('await renewIds()') < at('homeBundle.reset()'));
  // Alerts stay off until turned on again, then register the new device id (push.ts enablePush, livePush.ts).
  assert.match(read('src/lib/push.ts'), /await api\.registerExpo\(data, Platform\.OS, welcome\);\n\s*await AsyncStorage\.setItem\('expoPushToken', data\);\n\s*await allowPushTokens\(\);/);
  assert.match(read('src/lib/api.ts'), /registerExpo: async [^\n]*device: await getDevice\(\)/);
  delete globalThis.__asMock;
});

test('More shows the install ID crash reports carry, selectable, with words for VoiceOver and TalkBack', () => {
  const crash = read('src/lib/crash.ts');
  assert.match(crash, /export async function installId\(\): Promise<string> \{\n\s*try \{ return \(\(await AsyncStorage\.getItem\('device'\)\) \|\| ''\)\.slice\(0, 40\); \}/);
  assert.match(crash, /install: await installId\(\)/);
  const st = read('src/app/(tabs)/settings/index.tsx');
  assert.match(st, /import \{ installId \} from '@\/lib\/crash';/);
  const row = st.slice(st.indexOf('title="Install ID"'), st.indexOf('title="Install ID"') + 400);
  assert.match(row, /selectable/);
  assert.match(row, /accessibilityLabel=\{`Install ID /);
  assert.match(row, /\{install\}<\/T>/);
  assert.match(st, /setInstall\(await installId\(\)\);/, 'shows the new id after Delete all my data');
});

test('native widget and watch clocks follow the phone\'s 12 or 24 hour setting', () => {
  const kt = read('plugins/widget/kotlin/TransitApi.kt');
  assert.match(kt, /import android\.text\.format\.DateFormat/);
  assert.match(kt, /H24 = try \{ DateFormat\.is24HourFormat\(context\) \} catch \(e: Exception\) \{ false \}/);
  assert.match(kt, /SimpleDateFormat\(if \(H24\) "HH:mm" else "h:mma", Locale\.US\)/);
  assert.equal(/SimpleDateFormat\("h:mm"/.test(kt), false, 'no clock without am or pm');
  for (const f of ['targets/widget/Format.swift', 'targets/watch/WatchCore.swift', 'targets/watch-widget/WatchCore.swift']) {
    const src = read(f);
    assert.match(src, /DateFormatter\.dateFormat\(fromTemplate: "j", options: 0, locale: Locale\.autoupdatingCurrent\)/, f);
    const fixed = src.split('\n').filter((l) => /dateFormat = "h:mm ?a"/.test(l));
    assert.deepEqual(fixed, [], `${f}: every short clock asks uses24Hour`);
    assert.match(src, /dateFormat = uses24Hour \? "HH:mm" : "h:mm ?a"/, f);
  }
  assert.equal(read('targets/watch/WatchCore.swift'), read('targets/watch-widget/WatchCore.swift'));
});

test('the Android build script runs in its own folder, as the App Bundle script does', () => {
  const sh = read('build-android.sh');
  assert.equal(sh.includes('/home/user/nsw-app'), false);
  assert.match(sh, /\ncd "\$\(dirname "\$0"\)"\n/);
  assert.match(read('build-android-aab.sh'), /\ncd "\$\(dirname "\$0"\)"\n/);
});

test('the iPhone privacy manifest lists crash data, as the build branches do', () => {
  const app = JSON.parse(read('app.json'));
  const types = app.expo.ios.privacyManifests.NSPrivacyCollectedDataTypes;
  const crash = types.find((t) => t.NSPrivacyCollectedDataType === 'NSPrivacyCollectedDataTypeCrashData');
  assert.deepEqual(crash, {
    NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeCrashData',
    NSPrivacyCollectedDataTypeLinked: false,
    NSPrivacyCollectedDataTypeTracking: false,
    NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
  });
  assert.equal(types.filter((t) => t.NSPrivacyCollectedDataType === crash.NSPrivacyCollectedDataType).length, 1);
});

test('Android in-app clocks: the limit is written down where the setting is read', () => {
  assert.match(read('src/lib/rowTime.ts'), /Android: the system "Use 24-hour format" switch is not readable from JavaScript in these builds/);
});
