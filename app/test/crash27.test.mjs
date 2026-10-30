// Crash safety net (27 Oct, lib/crash.ts, lib/crashCore.ts, app/_layout.tsx ErrorBoundary): a screen that throws shows
// a recovery screen, the error is reported once to the feedback inbox, and Clear saved times drops only kept answers.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-crash-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const C = await load('src/lib/crashCore.ts');
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

test('report text: kind, where, build, update, error and stack, inside the inbox limits', () => {
  const e = new TypeError("Cannot read properties of undefined (reading 'map')");
  e.stack = 'TypeError: x\n    at Home (index.bundle:1:2)\n' + 'y'.repeat(9000);
  const m = C.crashMessage(e, { where: 'screen', os: 'ios', build: '208', update: '01a17835-90e9' });
  assert.match(m, /^Automatic crash report \(caught, screen\)\. ios build 208 update 01a17835\./);
  assert.match(m, /TypeError: Cannot read properties of undefined \(reading 'map'\)/);
  assert.match(m, /at Home/);
  assert.ok(m.length >= 10 && m.length <= 4000);
  assert.match(C.crashMessage('plain words', { where: 'global', fatal: true }), /fatal, global[\s\S]*Error: plain words/);
  assert.match(C.crashMessage(null, { where: 'x' }), /Error: null/);
});

test('recent requests: last 8 paths with query names only, never values, in the report', () => {
  for (let i = 0; i < 10; i++) C.noteRequest(`/api/trip?from=2135${i}&to=202210&device=secretdevice`, 200);
  C.noteRequest('https://api.transportsydney.app/api/departures?stop=206710', 304);
  const r = C.recentRequests();
  assert.equal(r.length, 8);
  assert.equal(r[r.length - 1], '/api/departures?stop 304');
  assert.ok(!r.join(' ').includes('secretdevice') && !r.join(' ').includes('206710'));
  const m = C.crashMessage(new Error('x'), { where: 'screen /home', recent: r });
  assert.match(m, /\nRecent: \/api\/trip\?from,to,device 200/);
  assert.equal((m.match(/Error: x/g) || []).length, 1, 'the error line once');
});

test('page tag starts with crash: and fits the 80 character field', () => {
  assert.equal(C.crashPage('screen'), 'crash:screen');
  assert.ok(C.crashPage('a'.repeat(200)).length <= 80);
  assert.equal(C.crashPage('<b>'), 'crash:b');
});

test('Clear saved times drops kept answers, packs, lists and an active trip, never settings, places or trips', () => {
  const all = ['store', 'profile', 'device', 'offline:index', 'trip:1>2', 'tt:index', 'tt:pack:200060', 'ask:places:v2', 'search:bus:v1', 'search:bus:v1:0', 'liveTrip', 'reminders', 'expoPushToken'];
  const drop = C.keptKeys(all, ['trip:1>2', 'dep:200060', 'store']);
  for (const k of ['offline:index', 'trip:1>2', 'dep:200060', 'tt:index', 'tt:pack:200060', 'ask:places:v2', 'search:bus:v1', 'search:bus:v1:0', 'liveTrip']) assert.ok(drop.includes(k), k);
  for (const k of ['store', 'profile', 'device', 'reminders', 'expoPushToken']) assert.ok(!drop.includes(k), k);
});

test('root layout exports the error boundary, reports from it and installs the reporter; no timers or native modules added', () => {
  const lay = read('src/app/_layout.tsx');
  assert.match(lay, /export function ErrorBoundary\(\{ error, retry \}: ErrorBoundaryProps\)/);
  assert.match(lay, /reportCrash\(error, where\)/);
  assert.match(lay, /usePathname\(\)/);
  assert.match(read('src/lib/api.ts'), /noteRequest\(path, r\.status\)/);
  assert.match(lay, /installCrashReporter\(\);/);
  assert.match(lay, /accessibilityRole="button"/);
  const crash = read('src/lib/crash.ts');
  assert.match(crash, /\/api\/feedback/);
  assert.match(crash, /topic: 'problem'/);
  assert.match(crash, /MAX_REPORTS/);
  for (const src of [lay, crash, read('src/lib/crashCore.ts')]) {
    assert.ok(!/setInterval\(/.test(src));
    assert.ok(!/requireNativeModule\(/.test(src));
    assert.ok(!/[\u2013\u2014]/.test(src), 'no long dashes');
  }
  assert.equal(C.MAX_REPORTS, 3);
});
