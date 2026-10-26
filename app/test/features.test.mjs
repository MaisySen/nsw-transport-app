// Platform view was removed on 26 Oct 2026 (Bidur, 5:36 PM): no screen, no entry point, no switch, no fetch left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

const src = new URL('../src/', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((n) => { const p = d + n; return statSync(p).isDirectory() ? walk(p + '/') : [p]; });

test('Platform view screen and its helpers are gone', () => {
  for (const f of ['app/platform.tsx', 'lib/platform.ts', 'lib/platformCore.ts']) assert.equal(existsSync(src + f), false, f);
});

test('no switch, entry point, menu item or fetch for Platform view is left', () => {
  for (const p of walk(src).filter((p) => /\.tsx?$/.test(p))) {
    const rel = p.slice(src.length);
    const s = readFileSync(p, 'utf8');
    assert.doesNotMatch(s, /PLATFORM_VIEW|openPlatform|platformDepartures|platformService|stationRows|pathname: '\/platform'|'Platform view'/, rel);
  }
});
