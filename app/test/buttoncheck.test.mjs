// Button check (docs/BUTTON_CHECK.md): source checks for the fixes the check found.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = new URL('../src/', import.meta.url).pathname;

test('a watch the server no longer has (404) says it has ended once and stops asking', () => {
  const s = readFileSync(src + 'app/watch/[id].tsx', 'utf8');
  assert.match(s, /e\?\.http === 404\) setGone\(true\)/);
  assert.match(s, /enabled: !gone/);
  assert.match(s, /This watch has ended/);
  assert.match(s, /router\.replace\('\/watching'\)/);
});
