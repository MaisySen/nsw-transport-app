// 26 Oct 2026 speed pass (g10, app side): the quick ask after a saved server copy, prefetch on press in, countdowns
// that redraw on their minute on the trip list, and the window background behind every screen.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-speed10-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const pc = await load('src/lib/pollCore.ts');
const pf = await load('src/lib/prefetchCore.ts');
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

test('quick ask: a saved copy more than 20 s old is asked again after 2 s, once', () => {
  const now = Date.parse('2026-10-26T01:00:00Z');
  assert.equal(pc.quickReaskMs({ dataAt: now - 45000 }, now, false), 2000);
  assert.equal(pc.quickReaskMs({ dataAt: now - 21000 }, now, false), 2000);
  assert.equal(pc.quickReaskMs({ dataAt: now - 20000 }, now, false), null, '20 s or newer is fresh enough');
  assert.equal(pc.quickReaskMs({ dataAt: now - 3000 }, now, false), null);
  assert.equal(pc.quickReaskMs({ dataAt: now - 45000 }, now, true), null, 'once per opening');
  assert.equal(pc.quickReaskMs({}, now, false), null, 'no dataAt: a fresh answer');
  assert.equal(pc.quickReaskMs({ dataAt: now + 5000 }, now, false), null, 'a clock ahead of the phone is not old');
  assert.equal(pc.quickReaskMs(null, now, false), null);
});

function fakeTimers() {
  let t = 0; let id = 0; const q = new Map();
  return {
    timers: { set: (fn, ms) => { id++; q.set(id, { at: t + ms, fn }); return id; }, clear: (h) => q.delete(h), now: () => t },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [h, e] of q) if (e.at <= end && (!next || e.at < next[1].at)) next = [h, e];
        if (!next) break;
        q.delete(next[0]); t = next[1].at; next[1].fn(); await new Promise((r) => setImmediate(r));
      }
      t = end;
    },
  };
}

test('poller soon: one run after 2 s, then the normal gap; nothing while off view', async () => {
  const f = fakeTimers();
  const runs = [];
  const p = pc.createPoller(() => { runs.push(f.timers.now()); return true; }, 15000, f.timers, { runAtStart: false });
  p.soon(2000);
  await f.advance(2000);
  assert.deepEqual(runs, [2000]);
  await f.advance(14999);
  assert.deepEqual(runs, [2000], 'back to the 15 s gap');
  await f.advance(1);
  assert.deepEqual(runs, [2000, 17000]);
  p.setEnabled(false);
  p.soon(2000);
  await f.advance(30000);
  assert.deepEqual(runs, [2000, 17000], 'off view: no quick ask');
  p.stop();
});

test('prefetch: the same stop at most once every 10 s, the map stays small', () => {
  const m = new Map();
  assert.equal(pf.prefetchDue(m, '200060', 0), true);
  assert.equal(pf.prefetchDue(m, '200060', 4000), false);
  assert.equal(pf.prefetchDue(m, '206710', 4000), true);
  assert.equal(pf.prefetchDue(m, '200060', 10000), true);
  for (let i = 0; i < 50; i++) pf.prefetchDue(m, 's' + i, 20000, 30);
  assert.ok(m.size <= 30);
});

test('wiring: prefetchStop exported, rows prefetch on press in, useLive asks again, trip list redraws on its minute', () => {
  const pre = read('src/lib/prefetch.ts');
  assert.match(pre, /export function prefetchStop\(id: string/);
  assert.match(pre, /keepOffline\(cacheKey\('dep'/);
  for (const f of ['src/app/(tabs)/ask/index.tsx', 'src/app/route.tsx', 'src/app/topup.tsx']) assert.match(read(f), /onPressIn=\{[^}]*prefetchStop\(/, f);
  assert.match(read('src/components/ui.tsx'), /onPressIn=\{onPressIn\}/);
  const hooks = read('src/lib/hooks.ts');
  assert.match(hooks, /quickReaskMs\(d, Date\.now\(\), reasked\.current\)/);
  assert.match(hooks, /reasked\.current = false/);
  assert.match(read('src/lib/activity.ts'), /poller\.current\?\.soon\(soonMs\)/);
  const trip = read('src/app/trip.tsx');
  assert.match(trip, /const now = useCountdownNow\(\)/);
  assert.match(trip, /useReportCountdowns\('trip'/);
  const lay = read('src/app/_layout.tsx');
  assert.match(lay, /setBackgroundColorAsync\?\.\(c\.bg\)/);
  assert.match(lay, /require\('expo-system-ui'\)/, 'feature detected');
});
