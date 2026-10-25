// Battery rules (docs/PERFORMANCE.md): the poller in src/lib/pollCore.ts, the shared read cache, and source checks
// that keep repeating timers, precise location and screen wake locks out of the app.
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
const js = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/pollCore.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-poll-')), 'pollCore.mjs');
fs.writeFileSync(f, js);
const P = await import(pathToFileURL(f).href);

// A fake clock: timers fire only when the test moves time on.
function fakeTimers() {
  let t = 1_000_000, seq = 0;
  const q = new Map();
  return {
    set: (fn, ms) => { const id = ++seq; q.set(id, { at: t + ms, fn }); return id; },
    clear: (id) => { q.delete(id); },
    now: () => t,
    pending: () => q.size,
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, x] of q) if (x.at <= end && (!next || x.at < next[1].at)) next = [id, x];
        if (!next) break;
        q.delete(next[0]);
        t = next[1].at;
        next[1].fn();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      t = end;
    },
  };
}

test('poller runs every gap while active and enabled', async () => {
  const tm = fakeTimers(); let n = 0;
  P.createPoller(() => { n++; }, 15000, tm, { runAtStart: false });
  await tm.advance(14999); assert.equal(n, 0);
  await tm.advance(1); assert.equal(n, 1);
  await tm.advance(45000); assert.equal(n, 4);
});

test('retime: the first answer re-reads an adaptive gap set before it arrived (first refresh 15 s after opening, not 60)', async () => {
  const tm = fakeTimers(); let n = 0; let data = null;
  const gap = () => P.adaptiveGapMs(15000, data == null ? null : data);
  const p = P.createPoller(() => { n++; }, gap, tm, { runAtStart: false });
  await tm.advance(1000);
  data = 3 * 60000; // the screen's first answer: a train in 3 minutes
  p.retime();
  await tm.advance(13999); assert.equal(n, 0);
  await tm.advance(1); assert.equal(n, 1, '15 s after the poller started');
  await tm.advance(15000); assert.equal(n, 2);
  // Without a retime the first wait stays a minute.
  let m = 0; data = null;
  P.createPoller(() => { m++; }, gap, tm, { runAtStart: false });
  data = 3 * 60000;
  await tm.advance(59999); assert.equal(m, 0);
  // retime never adds a run while away
  p.setActive(false); p.retime(); assert.equal(p.scheduled(), false);
  const src = fs.readFileSync(path.join(root, 'src/lib/hooks.ts'), 'utf8');
  assert.match(src, /retimeKey: updatedAt/);
});

test('nothing is scheduled in the background, and it catches up once on return', async () => {
  const tm = fakeTimers(); let n = 0;
  const p = P.createPoller(() => { n++; }, 15000, tm, { runAtStart: false });
  await tm.advance(15000); assert.equal(n, 1);
  p.setActive(false);
  assert.equal(p.scheduled(), false); assert.equal(tm.pending(), 0);
  await tm.advance(10 * 60000); assert.equal(n, 1, 'no runs in the background');
  p.setActive(true);
  await tm.advance(0); assert.equal(n, 2, 'one catch up run, not one per missed tick');
  await tm.advance(15000); assert.equal(n, 3);
});

test('a covered screen stops; a short absence waits out the rest of the gap', async () => {
  const tm = fakeTimers(); let n = 0;
  const p = P.createPoller(() => { n++; }, 20000, tm, { runAtStart: false });
  await tm.advance(20000); assert.equal(n, 1);
  p.setEnabled(false);
  await tm.advance(3000);
  p.setEnabled(true);
  await tm.advance(0); assert.equal(n, 1, '3 s away is not stale');
  await tm.advance(17000); assert.equal(n, 2);
});

test('failures back off and a success resets the gap', async () => {
  const tm = fakeTimers(); let n = 0; let ok = false;
  P.createPoller(() => { n++; return ok; }, 10000, tm, { runAtStart: false });
  await tm.advance(10000); assert.equal(n, 1);
  await tm.advance(19999); assert.equal(n, 1, 'second try waits 20 s');
  await tm.advance(1); assert.equal(n, 2);
  await tm.advance(40000); assert.equal(n, 3, 'third waits 40 s');
  ok = true;
  await tm.advance(80000); assert.equal(n, 4);
  await tm.advance(10000); assert.equal(n, 5, 'back to 10 s');
});

test('a throwing job counts as a failure and never stops the poller', async () => {
  const tm = fakeTimers(); let n = 0;
  P.createPoller(async () => { n++; throw new Error('x'); }, 1000, tm, { runAtStart: false });
  await tm.advance(1000 + 2000 + 4000); assert.equal(n, 3);
});

test('runNow runs at once, resets back off, and stop clears everything', async () => {
  const tm = fakeTimers(); let n = 0;
  const p = P.createPoller(() => { n++; return false; }, 10000, tm, { runAtStart: false });
  await tm.advance(10000); assert.equal(n, 1);
  await p.runNow(); assert.equal(n, 2);
  p.stop(); assert.equal(tm.pending(), 0);
  await tm.advance(10 * 60000); assert.equal(n, 2);
});

test('backoffMs caps at 5 minutes and msToNextTick lands on clock multiples', () => {
  assert.equal(P.backoffMs(15000, 0), 15000);
  assert.equal(P.backoffMs(15000, 1), 30000);
  assert.equal(P.backoffMs(15000, 20), 300000);
  assert.equal(P.backoffMs(600000, 3), 600000, 'never shorter than the normal gap');
  assert.equal(P.msToNextTick(60000 * 7 + 1200, 5000), 3800);
  assert.equal(P.msToNextTick(60000 * 7, 5000), 5000);
});

test('read cache shares one request and reuses a good answer for its TTL', async () => {
  let t = 0, calls = 0;
  const c = P.createReadCache(4000, () => t);
  let release; const gate = new Promise((r) => { release = r; });
  const fetcher = () => { calls++; return gate.then(() => ({ v: calls })); };
  const a = c.get('k', fetcher), b = c.get('k', fetcher);
  release();
  assert.deepEqual(await a, await b); assert.equal(calls, 1);
  t = 3999; await c.get('k', fetcher); assert.equal(calls, 1);
  t = 4000; await c.get('k', () => { calls++; return Promise.resolve(1); }); assert.equal(calls, 2);
  await c.get('k', () => { calls++; return Promise.resolve(2); }, { fresh: true }); assert.equal(calls, 3, 'fresh always asks');
});

test('read cache never keeps a failure, and clear drops answers still in flight', async () => {
  let t = 0, calls = 0;
  const c = P.createReadCache(4000, () => t);
  await assert.rejects(c.get('k', () => { calls++; return Promise.reject(new Error('down')); }));
  await c.get('k', () => { calls++; return Promise.resolve('up'); });
  assert.equal(calls, 2);
  let release; const gate = new Promise((r) => { release = r; });
  const p = c.get('j', () => gate.then(() => 'old'));
  c.clear();
  release(); await p;
  assert.equal(c.size(), 0, 'an answer started before a write is not kept');
});

// Source checks.
function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'platform'))];
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

test('no repeating setInterval outside activity.ts', () => {
  const bad = files.filter((p) => /\bsetInterval\(/.test(fs.readFileSync(p, 'utf8')) && !/src\/lib\/activity\.ts$/.test(rel(p))).map(rel);
  assert.deepEqual(bad, [], 'use useScreenPoll / startAppPoll / useNow (src/lib/activity.ts) so the job stops in the background');
});

test('countdowns do not tick every second', () => {
  const bad = files.filter((p) => /useNow\(\s*(\d{1,3}|1000)\s*\)/.test(fs.readFileSync(p, 'utf8'))).map(rel);
  assert.deepEqual(bad, [], 'useNow() ticks every 5 s on the clock; whole minute countdowns need no more');
});

test('no precise or continuous background location', () => {
  for (const p of files) {
    const s = fs.readFileSync(p, 'utf8');
    assert.ok(!/Accuracy\.(High|Highest|BestForNavigation)\b/.test(s), `${rel(p)} asks for GPS precision`);
    assert.ok(!/startLocationUpdatesAsync|startGeofencingAsync/.test(s), `${rel(p)} starts background location`);
  }
});

test('the screen is kept awake only by the full screen board, and released on leave', () => {
  const users = files.filter((p) => /activateKeepAwake/.test(fs.readFileSync(p, 'utf8'))).map(rel);
  assert.deepEqual(users, ['src/app/board.tsx']);
  assert.match(fs.readFileSync(path.join(root, 'src/app/board.tsx'), 'utf8'), /deactivateKeepAwake/);
});

test('app.json declares no background modes the app does not use', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
  const modes = app.ios?.infoPlist?.UIBackgroundModes || [];
  for (const m of modes) assert.ok(['remote-notification'].includes(m), `UIBackgroundModes has ${m}`);
});

test('every Pressable says what it is to VoiceOver and TalkBack', () => {
  const bad = [];
  for (const p of files.filter((x) => x.endsWith('.tsx'))) {
    const s = fs.readFileSync(p, 'utf8');
    for (const m of s.matchAll(/<(Pressable|GHPressable)\b/g)) {
      let i = m.index + m[0].length, depth = 0;
      for (; i < s.length; i++) { const ch = s[i]; if (ch === '{') depth++; else if (ch === '}') depth--; else if (ch === '>' && depth === 0 && s[i - 1] !== '=') break; }
      if (!/accessibilityRole/.test(s.slice(m.index, i))) bad.push(`${rel(p)}:${s.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('Button ignores taps while its action is pending and grows with large text', () => {
  const s = fs.readFileSync(path.join(root, 'src/components/ui.tsx'), 'utf8');
  assert.match(s, /setPending\(true\)/);
  assert.match(s, /disabled=\{off\}/);
  assert.match(s, /minHeight: 50/);
  assert.doesNotMatch(s, /btn: \{[^}]*\bheight: 50/);
});
