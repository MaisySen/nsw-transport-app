// Back paths from outside the app (1 Nov 2026, Bidur on build 214 at 5:48 PM: "Widget missing back button or app
// screen? Check"). Every way into the app from outside: home-screen, Lock Screen and StandBy widgets, Live Activity and
// Dynamic Island, Control Center, Siri and Shortcuts, notification taps, site links, the Apple Watch.
// 1. With the app closed, a link made its screen the only one in the stack: no Back, no tab bar (since the Expo app,
//    24-25 Oct). The start screen is now the anchor under it (unstable_settings.anchor = 'index'); Back opens Home.
//    Checked with expo-router's own state functions, the ones its linking runs on a cold start.
// 2. The "Your trip" widget during a trip opened Home (nswtransport://, since build 204); it opens the live trip.
// 3. Siri / Shortcuts "Start my commute" handed its link to the system before the screens listened (lost on a cold
//    start); it now waits for the root layout and opens on top of the screen in view.
// 4. The Apple Watch reopened the trip screen on every return to the app (build 213), so Back did not stay.
// Run: TZ=Australia/Sydney OFFLINE=1 node --test test/backnav1nov.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(import.meta.url);
const ts = require(path.join(root, 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-backnav-'));
async function load(rel) {
  const js = ts.transpileModule(fs.readFileSync(path.join(root, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// expo-router's cold start: getRoutes, getStateFromPath, then the seeded stack with the layout anchor
// (fork/useLinking.native.js getInitialState -> createSeededRootState). Its React files are not loaded: Route.js is
// only needed for sortRoutesWithInitial (sortRoutes.js) and global-state/utils for the root slot's name.
const ER = fs.realpathSync(path.join(root, 'node_modules', 'expo-router', 'build'));
const load0 = Module._load;
Module._load = function (req, parent, isMain) {
  if (parent && parent.filename && parent.filename.startsWith(ER)) {
    if (req === '../Route' || req === './Route') return require(path.join(ER, 'sortRoutes.js'));
    if (req === './utils' && parent.filename.endsWith('createSeededNavigationState.js')) return { getRootStackRouteNames: () => ['__root'] };
  }
  return load0.apply(this, arguments);
};
const { getRoutes } = require(path.join(ER, 'getRoutesCore.js'));
const { getReactNavigationConfig } = require(path.join(ER, 'getReactNavigationConfig.js'));
const { getStateFromPath } = require(path.join(ER, 'fork', 'getStateFromPath.js'));
const { createSeededNavigationState } = require(path.join(ER, 'global-state', 'createSeededNavigationState.js'));
const { withLoadedLayouts } = require(path.join(ER, 'layoutAnchor.js'));
Module._load = load0;

const appDir = path.join(root, 'src', 'app');
function walk(d, b = '') {
  let o = [];
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) o = o.concat(walk(p, b + f + '/'));
    else if (/\.tsx?$/.test(f)) o.push('./' + b + f);
  }
  return o;
}
function settingsOf(key) {
  const m = /export const unstable_settings\s*=\s*(\{[^;]*\})/.exec(fs.readFileSync(path.join(appDir, key), 'utf8'));
  return m ? Function('return (' + m[1] + ')')() : undefined;
}
const ctx = (k) => ({ default: () => null, unstable_settings: settingsOf(k) });
ctx.keys = () => walk(appDir); ctx.resolve = (k) => k; ctx.id = 'app';
const tree = getRoutes(ctx, { platform: 'ios', skipGenerated: false, ignoreEntryPoints: true, preserveApiRoutes: false });
const nav = getReactNavigationConfig(tree, false);
/** The root stack a cold start with this URL path builds: route names bottom to top. */
function coldStack(p) {
  const parsed = getStateFromPath(p, { screens: nav.screens, initialRouteName: nav.initialRouteName });
  const st = withLoadedLayouts(() => createSeededNavigationState(parsed, tree, 'root'));
  return st.routes.map((r) => r.name);
}
/** nswtransport://x?y -> /x?y, as expo-router reads the app's own scheme. */
const pathOf = (u) => '/' + u.replace(/^nswtransport:\/\//, '').replace(/^\/+/, '');

// Every link opened from outside the app, from the code that opens it.
const OUTSIDE = [
  ['Next trip widget row, Lock Screen, StandBy', 'nswtransport://trip?from=200060&fromName=Central&to=2150401&toName=Parramatta&at=1793530800', 'trip'],
  ['Next trip Start, Control Center, Siri', 'nswtransport://trip?from=200060&fromName=Central&to=2150401&toName=Parramatta&start=1', 'trip'],
  ['Stop board widget and its rows', 'nswtransport://stop/200060', 'stop/[id]'],
  ['Live Activity, Dynamic Island, Your trip widget', 'nswtransport://go', 'go'],
  ['transportsydney.app/stop', 'nswtransport://stop/2150401', 'stop/[id]'],
  ['transportsydney.app/plan', 'nswtransport://plan?from=200060&to=2150401', 'plan'],
  ['transportsydney.app/trip share', 'nswtransport://shared/abcdefghijklmnop', 'shared/[id]'],
  ['profile link', 'nswtransport://profile/abcdefghijkl', 'profile/[id]'],
];

test('cold start from every outside link: the screen opens on top of the start screen, so Back and the tab bar are one step away', () => {
  for (const [what, url, screen] of OUTSIDE) {
    const s = coldStack(pathOf(url));
    assert.equal(s[s.length - 1], screen, `${what}: ${url} opens ${screen}`);
    assert.deepEqual(s, ['index', screen], `${what}: ${url} must open on top of the start screen (was the only screen, no Back)`);
  }
});

test("the app's normal start is unchanged: one start screen, which picks Home or Simple mode", () => {
  assert.deepEqual(coldStack('/'), ['index']);
  assert.deepEqual(coldStack(pathOf('nswtransport://')), ['index']);
  assert.match(read('src/app/index.tsx'), /Redirect href=\{st\.simple \? '\/simple' : '\/home'\}/);
  const lay = read('src/app/_layout.tsx');
  assert.match(lay, /export const unstable_settings = \{ anchor: 'index' \}/);
  // Back to the start screen replaces it with Home at once (no second slide).
  assert.match(lay, /<Stack\.Screen name="\(tabs\)" options=\{\{ headerShown: false, animation: 'none' \}\} \/>/);
  assert.match(lay, /<Stack\.Screen name="index" options=\{\{ headerShown: false, animation: 'none' \}\} \/>/);
});

test('every link the native code opens is a screen of the app (none lands on Not found)', () => {
  const sources = [
    'targets/widget/TransportWidgets.swift', 'targets/widget/WidgetText.swift', 'targets/widget/LiveTripActivityWidget.swift',
    'targets/widget/_shared/CommuteIntents.swift', 'plugins/widget/kotlin/BoardWidgetProvider.kt',
    'plugins/widget/kotlin/ShortcutSync.kt', 'plugins/widget/kotlin/TripWidgetProvider.kt',
  ].map(read).join('\n');
  const found = new Set();
  for (const m of sources.matchAll(/nswtransport:\/\/([A-Za-z]*)/g)) found.add(m[1]);
  for (const head of ['go', 'stop', 'trip', '', 'ask']) assert.ok(found.has(head), `native code opens nswtransport://${head}`);
  for (const head of found) {
    const s = coldStack(head === 'stop' ? '/stop/200060' : '/' + head);
    const top = s[s.length - 1];
    assert.ok(!/not-found/.test(top), `nswtransport://${head} must open a screen, got ${top}`);
  }
});

test('the "Your trip" widget during a trip opens the live trip, like the Lock Screen card and the Island', () => {
  const w = read('targets/widget/TransportWidgets.swift');
  const t = read('targets/widget/WidgetText.swift');
  assert.match(t, /static let liveTripURL = URL\(string: "nswtransport:\/\/go"\)/);
  assert.match(w, /var url: URL\? \{ live \? WidgetText\.liveTripURL :/);
  assert.match(w, /private func link\(_ t: TripLine\) -> URL\? \{\s*entry\.live \? WidgetText\.liveTripURL :/);
  assert.match(w, /private var alertsLink: URL\? \{\s*entry\.live \? WidgetText\.liveTripURL :/);
  // The trip entry has no stop ids, which is why tripURL gave nswtransport:// (Home).
  assert.match(t, /guard !from\.isEmpty, !to\.isEmpty else \{ return URL\(string: "nswtransport:\/\/"\) \}/);
  assert.equal((read('targets/widget/LiveTripActivityWidget.swift').match(/widgetURL\(URL\(string: "nswtransport:\/\/go"\)\)/g) || []).length, 3);
});

test('Siri and Shortcuts links wait for the screens, then open on top of the one in view', async () => {
  const L = await load('src/lib/appLinkInbox.ts');
  const opened = [];
  L.openAppLink('nswtransport://trip?from=1&to=2&start=1');
  assert.deepEqual([...L.heldAppLinks()], ['nswtransport://trip?from=1&to=2&start=1'], 'held until the screens are ready');
  const off = L.setAppLinkHandler((u) => opened.push(u));
  assert.deepEqual(opened, ['nswtransport://trip?from=1&to=2&start=1']);
  assert.equal(L.heldAppLinks().length, 0);
  L.openAppLink('nswtransport://go');
  assert.deepEqual(opened.slice(-1), ['nswtransport://go'], 'opens at once when ready');
  off();
  for (let i = 0; i < 5; i++) L.openAppLink('nswtransport://stop/' + i);
  assert.equal(L.heldAppLinks().length, 3, 'at most 3 wait');
  assert.equal(L.appPath('nswtransport://trip?from=1&to=2&start=1'), '/trip?from=1&to=2&start=1');
  assert.equal(L.appPath('nswtransport://go'), '/go');
  assert.equal(L.appPath('nswtransport://'), '/');
  assert.equal(L.appPath('nswtransport://stop/200060'), '/stop/200060');
  assert.equal(L.appPath('https://example.com/x'), null);
  assert.equal(L.appPath('javascript:alert(1)'), null);
  assert.equal(L.appPath(null), null);
  const b = read('platform/iosBridge.ts');
  assert.match(b, /if \(url\) openAppLink\(url\);/);
  assert.doesNotMatch(b, /Linking\.openURL\(url\)/, 'not handed to the system before the screens listen');
  const lay = read('src/app/_layout.tsx');
  assert.match(lay, /setAppLinkHandler\(/);
  assert.match(lay, /router\.push\(to as any\)/);
  assert.match(lay, /links\(\);/, 'the handler is removed with the layout');
});

test('notification taps open their screen on top of the one in view (push), so Back returns to the app', () => {
  const lay = read('src/app/_layout.tsx');
  const body = lay.slice(lay.indexOf('const openFromAlert'), lay.indexOf('const sub = Notifications'));
  assert.ok(body.length > 200);
  // Only End trip (the trip is over) replaces the stack; every other tap pushes or goes to a tab.
  const replaces = [...body.matchAll(/router\.replace\(/g)].length;
  assert.equal(replaces, 1);
  assert.match(body, /actionIdentifier === 'end'\) \{ endLive\(\)\.finally\(\(\) => router\.replace\('\/'\)\)/);
  for (const r of ["router.push('/go')", "router.push({ pathname: '/trip', params: d.tripOpen })", "router.navigate('/home')", "router.push('/morning')", "router.push({ pathname: '/watch/[id]'"]) {
    assert.ok(body.includes(r), r);
  }
});

test('screens that hide the bar have their own Back that works from a cold start too', () => {
  for (const f of ['src/app/go.tsx', 'src/app/shared/[id].tsx', 'src/app/profile/[id].tsx']) {
    assert.match(read(f), /router\.canGoBack\(\) \? router\.back\(\) : router\.replace\('\/'\)/, f);
  }
  assert.match(read('src/app/go.tsx'), /accessibilityLabel="Back"/);
});

test('Apple Watch: the trip screen opens by itself once per trip; a complication tap opens it every time', () => {
  const s = read('targets/watch/TransportWatchApp.swift');
  assert.match(s, /if p == \.active \{ model\.openTripOnce\(\) \}/);
  assert.match(s, /\.onChange\(of: model\.live != nil\) \{ _, has in if has \{ model\.openTripOnce\(\) \} \}/);
  assert.match(s, /\.onOpenURL \{ _ in model\.openTrip\(\) \}/);
  assert.match(s, /static func shouldAutoOpen\(trip: String, lastOpened: String\?\) -> Bool \{ trip != lastOpened \}/);
  assert.match(s, /NavigationLink\(value: WatchRoute\.trip\)/, 'the trip is pushed on the list, so the watch shows its Back');
  assert.doesNotMatch(s, /navigationBarBackButtonHidden/);
  const t = read('native-tests/native-audit/Tests/Watch/WatchRefreshLogicTests.swift');
  assert.match(t, /func testTripScreenOpensByItselfOncePerTrip/);
});
