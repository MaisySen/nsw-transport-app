// Feature switches (src/lib/features.ts): Platform view stays off until the owner asks for it back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('Platform view switch is off', () => {
  assert.match(read('lib/features.ts'), /export const PLATFORM_VIEW = false;/);
});

test('every way into Platform view checks the switch', () => {
  assert.match(read('lib/platform.ts'), /if \(!PLATFORM_VIEW\) return;/);
  assert.match(read('components/Transit.tsx'), /const platform = PLATFORM_VIEW && /);
  assert.match(read('app/stop/[id].tsx'), /\{PLATFORM_VIEW && railHere \?/);
  assert.match(read('app/platform.tsx'), /PLATFORM_VIEW \? <PlatformView \/> : <Redirect href="\/" \/>/);
});

test('nothing else calls openPlatform or pushes /platform', () => {
  const allowed = new Set(['lib/platform.ts', 'lib/features.ts', 'components/Transit.tsx', 'app/stop/[id].tsx']);
  const root = new URL('../src/', import.meta.url).pathname;
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = d + n; return statSync(p).isDirectory() ? walk(p + '/') : [p]; });
  for (const p of walk(root).filter((p) => /\.tsx?$/.test(p))) {
    const rel = p.slice(root.length);
    const s = readFileSync(p, 'utf8');
    if (/openPlatform\(|pathname: '\/platform'/.test(s)) assert.ok(allowed.has(rel), `${rel} opens Platform view`);
  }
});
