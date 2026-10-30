// Sentry crash reporting for build 209 (lib/sentryCore.ts, lib/sentry.native.ts, lib/sentry.ts, docs/SENTRY.md):
// what leaves the phone is cleaned, battery heavy parts are off, and builds 201 to 208 (no native module) never load
// the SDK and keep the feedback inbox reports.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-sentry-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const S = await load('src/lib/sentryCore.ts');
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');
// Built from parts so the file holds no address shaped text (press.test.mjs looks for those).
const AT = '@';
const fakeDsn = 'https://0123456789abcdef0123' + AT + 'o1.ingest.us.sentry.io/1';
const BUNDLE = 'com.maisysen.nswtransport' + AT;

test('text: query values, positions, stop IDs, paths with IDs and quoted names are taken out', () => {
  const t = S.scrubText('GET https://api.transportsydney.app/api/trip?from=200060&to=10101100&device=abc123secret failed');
  assert.ok(!/200060|10101100|abc123secret/.test(t), t);
  assert.match(t, /\?from=&to=&device=/);
  assert.ok(!/151\.2093|33\.8688/.test(S.scrubText('at -33.8688,151.2093 and 151.2093:-33.8688:EPSG:4326')));
  assert.equal(S.scrubText('/stop/2000338 and /watch/k9x2'), '/stop/<id> and /watch/<id>');
  assert.equal(S.scrubText('No board for "Central Station"'), 'No board for "<text>"');
  assert.equal(S.scrubText("Can't find 'Parramatta' today"), "Can't find '<text>' today");
  assert.match(S.scrubText('stop: Wynyard, platform 3'), /stop: <text>/);
  assert.match(S.scrubText('Bad leg from: Martin Place'), /from: <text>/);
});

test('text: code and stack lines keep their shape', () => {
  assert.equal(S.scrubText("undefined is not an object (evaluating 'trip.legs[0]')"), "undefined is not an object (evaluating 'trip.legs[0]')");
  assert.equal(S.scrubText('at Home (index.bundle:1:234567)'), 'at Home (index.bundle:1:234567)');
  assert.equal(S.scrubText("Cannot read properties of undefined (reading 'map')"), "Cannot read properties of undefined (reading 'map')");
  assert.ok(S.scrubText('x'.repeat(9000)).length <= 4000);
  assert.equal(S.scrubText(null), '');
});

test('event: no user, request, phone name, time zone or IP; message, exception and extras cleaned; off returns null', () => {
  const ev = {
    message: 'Trip to "Bondi Junction" failed',
    user: { id: 'install-1', ip_address: '1.2.3.4' }, request: { url: '/x?stop=1' }, server_name: "Bidur's iPhone", geo: { city: 'Sydney' },
    exception: { values: [{ type: 'TypeError', value: 'Bad stop 2000338 at /stop/2000338?when=now', stacktrace: { frames: [{ filename: 'app:///index.bundle?platform=ios', vars: { stop: 'Central' }, lineno: 1 }] } }] },
    contexts: { device: { name: "Bidur's iPhone", model: 'iPhone18,1', timezone: 'Australia/Sydney' }, os: { name: 'iOS', version: '27.1' }, culture: { timezone: 'Australia/Sydney', locale: 'en-AU' }, app: { app_version: '1.0.0', device_app_hash: 'h' }, custom: { stopName: 'Central', note: 'from: Epping' } },
    breadcrumbs: [{ category: 'navigation', data: { to: '/stop/2000338' } }, { category: 'ui.touch', message: 'Central' }, { category: 'console', message: 'x' }, { category: 'app', message: 'opened /trip/123456' }],
    extra: { install: 'abc', stop: 'Central', count: 2, url: '/api/departures?stop=2000338' },
    tags: { where: 'screen', update: '01a17835' },
  };
  const e = S.scrubEvent(ev);
  assert.equal(e.user, undefined); assert.equal(e.request, undefined); assert.equal(e.server_name, undefined); assert.equal(e.geo, undefined);
  assert.equal(e.message, 'Trip to "<text>" failed');
  assert.equal(e.contexts.device.name, undefined); assert.equal(e.contexts.device.timezone, undefined); assert.equal(e.contexts.device.model, 'iPhone18,1');
  assert.equal(e.contexts.culture, undefined); assert.equal(e.contexts.app.device_app_hash, undefined);
  assert.equal(e.contexts.custom.note, 'from: <text>');
  const v = e.exception.values[0];
  assert.equal(v.type, 'TypeError'); assert.ok(!/2000338|now/.test(v.value), v.value);
  assert.equal(v.stacktrace.frames[0].vars, undefined); assert.equal(v.stacktrace.frames[0].filename, 'app:///index.bundle');
  assert.deepEqual(e.breadcrumbs.map((b) => b.category), ['app']);
  assert.equal(e.breadcrumbs[0].message, 'opened /trip/<id>');
  assert.equal(e.extra.install, undefined); assert.equal(e.extra.stop, undefined); assert.equal(e.extra.count, 2); assert.equal(e.extra.url, '/api/departures?stop=');
  assert.deepEqual(e.tags, { where: 'screen', update: '01a17835' });
  assert.ok(!JSON.stringify(e).includes('Central') && !JSON.stringify(e).includes('Bidur'));
  assert.equal(ev.user.id, 'install-1', 'the original event is not changed');
  assert.equal(S.scrubEvent(ev, false), null);
  assert.equal(S.scrubEvent(null), null);
});

test('breadcrumbs: touches, screens, requests and console lines are dropped', () => {
  for (const c of ['ui.touch', 'ui.click', 'touch', 'navigation', 'xhr', 'fetch', 'http', 'console', 'app.lifecycle', 'device.orientation']) assert.equal(S.scrubBreadcrumb({ category: c, message: 'x' }), null, c);
  assert.equal(S.scrubBreadcrumb({ type: 'navigation', category: 'x' }), null);
  assert.equal(S.scrubBreadcrumb(null), null);
  assert.equal(S.scrubBreadcrumb({ category: 'sentry.event', message: 'Bad "Central"' }).message, 'Bad "<text>"');
});

test('options: battery and privacy first (no replay, profiling, traces, sessions, screenshots, PII)', () => {
  const o = S.sentryOptions({ dsn: fakeDsn, release: 'r', dist: '209', environment: 'production' });
  assert.equal(o.sendDefaultPii, false);
  for (const k of ['tracesSampleRate', 'profilesSampleRate', 'replaysSessionSampleRate', 'replaysOnErrorSampleRate']) assert.equal(o[k], 0, k);
  for (const k of ['enableAutoSessionTracking', 'enableAutoPerformanceTracing', 'enableAppStartTracking', 'enableNativeFramesTracking', 'enableStallTracking', 'enableUserInteractionTracing', 'enableAppHangTracking', 'enableCaptureFailedRequests', 'enableNetworkBreadcrumbs', 'attachScreenshot', 'attachViewHierarchy', 'enableAutoConsoleLogs', 'spotlight', 'debug']) assert.equal(o[k], false, k);
  assert.equal(o.enableNativeCrashHandling, true);
  assert.ok(o.ignoreErrors.some((r) => r.test('TypeError: Network request failed')));
  assert.ok(S.MAX_EVENTS_PER_RUN > 0 && S.MAX_EVENTS_PER_RUN <= 20);
});

test('release is bundle id at version plus build, dist is the build number', () => {
  assert.deepEqual(S.releaseFor('com.maisysen.nswtransport', '1.0.0', '209'), { release: BUNDLE + '1.0.0+209', dist: '209' });
  assert.deepEqual(S.releaseFor(null, null, null), { release: BUNDLE + 'unknown+unknown', dist: 'unknown' });
});

test('native module check: missing, throwing or empty lookups mean no Sentry; never the throwing lookup', () => {
  assert.equal(S.hasNativeSentry({ turbo: () => null, legacy: {} }), false);
  assert.equal(S.hasNativeSentry({ turbo: () => { throw new Error('no'); }, legacy: null }), false);
  assert.equal(S.hasNativeSentry({}), false);
  assert.equal(S.hasNativeSentry({ turbo: () => ({}) }), true);
  assert.equal(S.hasNativeSentry({ turbo: () => null, legacy: { RNSentry: {} } }), true);
  assert.equal(S.validDsn(fakeDsn), fakeDsn);
  assert.equal(S.validDsn('nope'), null); assert.equal(S.validDsn(undefined), null);
});

test('builds 201 to 208: the SDK is never loaded at the top of a file, only after the native module is found', () => {
  const native = read('src/lib/sentry.native.ts');
  assert.ok(!/^import\s+(?!type\b)[^;]*['"]@sentry\/react-native['"]/m.test(native), 'no value import of the SDK');
  assert.ok(!/getEnforcing/.test(native.replace(/\/\/.*$/gm, '')), 'never getEnforcing');
  const init = native.slice(native.indexOf('export function initSentry'));
  assert.ok(init.indexOf('nativePresent()') < init.indexOf("require('@sentry/react-native')"), 'the module check comes before the require');
  assert.ok(!/@sentry/.test(read('src/lib/sentry.ts').replace(/\/\/.*$/gm, '')), 'the web file never names the SDK');
  // No other file in src loads the SDK.
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)]);
  for (const f of walk(path.join(here, '..', 'src'))) {
    if (!/\.(ts|tsx)$/.test(f) || /sentry\.native\.ts$/.test(f)) continue;
    assert.ok(!/['"]@sentry\//.test(fs.readFileSync(f, 'utf8')), f);
  }
});

test('crash net: caught errors also go to Sentry, fatal ones are left to Sentry\'s own handler; root is wrapped', () => {
  const crash = read('src/lib/crash.ts');
  assert.match(crash, /import \{ captureToSentry \} from '\.\/sentry';/);
  assert.match(crash, /if \(!fatal\) captureToSentry\(error, where\);/);
  assert.match(crash, /fetch\(`\$\{apiBase\(\)\}\/api\/feedback`/, 'the feedback inbox report stays');
  const layout = read('src/app/_layout.tsx');
  assert.ok(layout.indexOf('initSentry();') > 0 && layout.indexOf('initSentry();') < layout.indexOf('installCrashReporter();\n'));
  assert.match(layout, /export default withSentry\(RootLayout\);/);
  assert.match(layout, /reportCrash\(error, where\)/);
});

test('config: plugin, public DSN, no token in the repo, uploads only with SENTRY_AUTH_TOKEN, crash data in the manifest', () => {
  const app = JSON.parse(read('app.json')).expo;
  const plug = app.plugins.find((p) => Array.isArray(p) && p[0] === '@sentry/react-native/expo');
  assert.ok(plug, 'config plugin');
  assert.equal(plug[1].organization, 'fintex-australia-bk'); assert.equal(plug[1].project, 'transport-sydney-live');
  assert.equal(plug[1].authToken, undefined, 'the token is never in app.json');
  assert.ok(S.validDsn(app.extra.sentryDsn), 'DSN in extra');
  const crash = app.ios.privacyManifests.NSPrivacyCollectedDataTypes.find((t) => t.NSPrivacyCollectedDataType === 'NSPrivacyCollectedDataTypeCrashData');
  assert.ok(crash && crash.NSPrivacyCollectedDataTypeLinked === false && crash.NSPrivacyCollectedDataTypeTracking === false);
  const eas = JSON.parse(read('eas.json'));
  assert.equal(eas.build.preview.env.SENTRY_DISABLE_AUTO_UPLOAD, 'true');
  assert.equal(eas.build.compilecheck.env.SENTRY_DISABLE_AUTO_UPLOAD, 'true');
  assert.equal(eas.build.production.env.SENTRY_AUTH_TOKEN, undefined, 'the token is an EAS secret, not in eas.json');
  for (const f of ['app.json', 'eas.json', 'package.json', 'app.config.js', 'build-android.sh', 'build-android-aab.sh']) assert.ok(!/sntr[yu]s?_[A-Za-z0-9]/.test(read(f)), f);
  assert.match(read('package.json'), /"@sentry\/react-native": "~8\.28\.0"/);
});
