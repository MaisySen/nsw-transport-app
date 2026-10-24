// Taps that buzz and do nothing (Bidur, 24 Oct). The native tab bar and native gestures can't be driven in a
// browser, so this file checks the touch logic itself and scans the source for patterns that can swallow a
// press on Android. Run: node --test test/
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-press-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const g = await load('src/lib/gesture.ts');

function play(events) {
  let s = { phase: 'idle', t0: 0 };
  const outs = [];
  for (const e of events) { const [n, o] = g.gripStep(s, e); s = n; if (o !== 'none') outs.push(o); }
  return outs;
}

test('reorder handle: a tap opens the trip and never starts a drag', () => {
  assert.deepEqual(play([{ type: 'down', t: 0 }, { type: 'move', t: 40, dy: 2 }, { type: 'up', t: 90 }]), ['tap']);
  assert.deepEqual(play([{ type: 'down', t: 0 }, { type: 'up', t: 30 }]), ['tap']);
});

test('reorder handle: moving or holding starts the drag, lifting ends it, no tap', () => {
  assert.deepEqual(play([{ type: 'down', t: 0 }, { type: 'move', t: 30, dy: 8 }, { type: 'move', t: 60, dy: 40 }, { type: 'up', t: 200 }]), ['startDrag', 'move', 'endDrag']);
  assert.deepEqual(play([{ type: 'down', t: 0 }, { type: 'hold', t: 260 }, { type: 'move', t: 300, dy: 3 }, { type: 'up', t: 400 }]), ['startDrag', 'move', 'endDrag']);
  assert.deepEqual(play([{ type: 'down', t: 0 }, { type: 'hold', t: 100 }, { type: 'up', t: 120 }]), ['tap'], 'an early hold timer is not a hold');
});

test('reorder handle: a cancelled drag still ends (page scroll comes back)', () => {
  assert.deepEqual(play([{ type: 'down', t: 0 }, { type: 'move', t: 30, dy: 10 }, { type: 'cancel' }]), ['startDrag', 'endDrag']);
  assert.deepEqual(play([{ type: 'down', t: 0 }, { type: 'cancel' }]), []);
});

function fakeTimers() {
  let now = 0, id = 0; const q = new Map();
  return {
    set: (fn, ms) => { q.set(++id, { fn, at: now + ms }); return id; },
    clear: (i) => { q.delete(i); },
    tick: (ms) => { now += ms; for (const [i, t] of [...q]) if (t.at <= now) { q.delete(i); t.fn(); } },
  };
}

test('map in a scrolling page: page scroll stops while a finger is on the map and comes back after', () => {
  const tm = fakeTimers(); const log = [];
  const l = g.scrollLock((on) => log.push(on), 2500, tm);
  l.start(); l.move(); l.move();
  assert.deepEqual(log, [false]);
  l.end(1); // a second finger is still down (pinch)
  assert.deepEqual(log, [false]);
  l.end(0);
  assert.deepEqual(log, [false, true]);
  l.start(); l.cancel();
  assert.deepEqual(log, [false, true, false, true]);
});

test('map in a scrolling page: a lost touch end can not leave the page stuck', () => {
  const tm = fakeTimers(); const log = [];
  const l = g.scrollLock((on) => log.push(on), 2500, tm);
  l.start(); tm.tick(2000); l.move(); tm.tick(2000);
  assert.equal(l.locked, true, 'moving keeps it locked');
  tm.tick(600);
  assert.equal(l.locked, false);
  assert.deepEqual(log, [false, true]);
});

test('menu sheet: the chosen action runs once, after the sheet has closed or at the fallback time', () => {
  const tm = fakeTimers(); let n = 0;
  const run = g.once(() => n++, 450, tm);
  assert.equal(n, 0, 'not while the sheet is still on screen');
  run(); run(); tm.tick(1000);
  assert.equal(n, 1);
  const run2 = g.once(() => n++, 450, tm);
  tm.tick(450); run2();
  assert.equal(n, 2, 'fallback fires when the sheet never reports it closed');
});

test('real timers work when called through the helper (a browser threw Illegal invocation before)', async () => {
  let n = 0;
  const run = g.once(() => n++, 10);
  await new Promise((r) => setTimeout(r, 30));
  run();
  assert.equal(n, 1);
  const log = [];
  const l = g.scrollLock((on) => log.push(on), 10);
  l.start();
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(log, [false, true]);
  const src = fs.readFileSync(path.join(here, '..', 'src/lib/gesture.ts'), 'utf8');
  assert.ok(!/=\s*\{\s*set:\s*setTimeout/.test(src), 'setTimeout is never stored as a method');
});

test('withTimeout: a stuck promise frees the button', async () => {
  const v = await g.withTimeout(new Promise(() => {}), 20, 'free');
  assert.equal(v, 'free');
  assert.equal(await g.withTimeout(Promise.resolve(3), 1000, 0), 3);
});

// ---- Source scan: patterns that can swallow a press on Android ----
const SRC = path.join(here, '..', 'src');
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.tsx?$/.test(f.name)) files.push(p); } })(SRC);
const read = (p) => fs.readFileSync(p, 'utf8');
const rel = (p) => path.relative(path.join(here, '..'), p);

test('no tap waits on a vibration: haptics only through lib/haptic (fire and forget)', () => {
  const bad = [];
  for (const f of files) {
    if (/lib[\\/](haptic|liveEngine)\.ts$/.test(f)) continue;
    const s = read(f);
    if (/\bHaptics\.\w+Async\(/.test(s)) bad.push(rel(f));
  }
  for (const f of files) if (/await\s+(Haptics|haptic)\./.test(read(f))) bad.push(rel(f) + ' (awaits a vibration)');
  assert.deepEqual(bad, []);
});

test('no navigation waits on the network or a permission dialog', () => {
  const bad = [];
  for (const f of files) {
    read(f).split('\n').forEach((line, i) => {
      // "await something(); router.push(...)" in one handler: the push waits for the promise.
      if (/await (?!withTimeout)[^;]+;\s*(haptic\.\w+\(\);\s*)?router\.(push|replace|back)/.test(line)) bad.push(`${rel(f)}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('startLive opens the live trip without waiting for the notification prompt', () => {
  const s = read(path.join(SRC, 'lib', 'live.ts'));
  const body = s.slice(s.indexOf('export async function startLive'), s.indexOf('export async function liveWatch'));
  assert.ok(!/^\s{2}(try \{ )?const ps = await getPushState/m.test(body), 'permission is asked in the background');
  assert.ok(/\(async \(\) => \{[\s\S]*enablePush[\s\S]*\}\)\(\)\.catch/.test(body));
});

test('buttons revealed by a swipe use the gesture handler Pressable', () => {
  const bad = [];
  for (const f of files) {
    const s = read(f);
    let i = s.indexOf('renderRightActions');
    while (i >= 0) {
      const chunk = s.slice(i, i + 400);
      const inline = chunk.startsWith('renderRightActions={() =>');
      const name = (chunk.match(/^renderRightActions=\{(\w+)\}/) || [])[1];
      const fn = inline ? chunk : name ? s.slice(s.indexOf(`const ${name} = `), s.indexOf(`const ${name} = `) + 400) : '';
      if (/<Pressable\b/.test(fn) && !/<GHPressable\b/.test(fn)) bad.push(rel(f));
      i = s.indexOf('renderRightActions', i + 1);
    }
  }
  assert.deepEqual(bad, []);
});

test('reorder handles do not start a drag on touch down', () => {
  const s = read(path.join(SRC, 'app', '(tabs)', 'home', 'index.tsx'));
  const grip = s.slice(s.indexOf('function Grip('), s.indexOf('const hs = StyleSheet.create'));
  assert.ok(/onTap/.test(grip) && /gripStep/.test(grip));
  assert.ok(!/onPanResponderGrant: \(\) => cb\.current\.onStart\(\)/.test(grip));
});

test('menu sheet actions run after the sheet closes, not on a short timer', () => {
  const s = read(path.join(SRC, 'components', 'Sheet.tsx'));
  assert.ok(/onDismiss=/.test(s) && /once\(/.test(s));
  assert.ok(!/setTimeout\(a\.onPress/.test(s));
});

test('nothing covers the tab bar or swallows touches with pointerEvents', () => {
  const bad = [];
  for (const f of files) read(f).split('\n').forEach((line, i) => { if (/pointerEvents=["{']?(?:none|box-only)/.test(line) && !/Animated\.View|accessible=\{false\}/.test(line)) bad.push(`${rel(f)}:${i + 1}`); });
  assert.deepEqual(bad, []);
});

test('the four native tabs have a label and an Android icon each', () => {
  const s = read(path.join(SRC, 'app', '(tabs)', '_layout.tsx'));
  const triggers = s.match(/<NativeTabs\.Trigger\b[\s\S]*?<\/NativeTabs\.Trigger>/g) || [];
  assert.equal(triggers.length, 4);
  for (const t of triggers) { assert.match(t, /Trigger\.Label>/); assert.match(t, /md="/); }
  for (const name of ['home', 'search', 'ask', 'settings']) assert.ok(fs.existsSync(path.join(SRC, 'app', '(tabs)', name, '_layout.tsx')), name);
});

test('the About screen names Fintex and has no personal or internal addresses', () => {
  const co = read(path.join(SRC, 'lib', 'company.ts'));
  assert.match(co, /Fintex Australia Pty Ltd/); assert.match(co, /contact@fintex\.au/); assert.match(co, /https:\/\/fintex\.au/);
  const about = read(path.join(SRC, 'app', '(tabs)', 'settings', 'index.tsx'));
  assert.match(about, /COMPANY\.email/); assert.match(about, /COMPANY\.site/); assert.match(about, /Fintex Australia Pty Ltd/);
  const bad = [];
  (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', 'dist', 'dist-web', '.expo', 'android', 'ios'].includes(f.name)) continue; const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(tsx?|js|mjs|json|md)$/.test(f.name) && f.name !== 'package-lock.json') { const s = read(p); const m = s.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []; for (const e of m) if (!/^contact@fintex\.au$/.test(e) && !/^[\w-]+@[\d.^~]+$/.test(e) && !e.includes('@/')) bad.push(`${rel(p)}: ${e}`); } } })(path.join(here, '..'));
  assert.deepEqual(bad, []);
});
