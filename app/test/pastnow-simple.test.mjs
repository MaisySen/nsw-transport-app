// Simple mode's trip list uses the same past and upcoming split as the full trip list (PAST_NOW, 30 Oct; Bidur picked
// option A), and the Departures empty hint gives example stops that are not the owner's own stations. Reads files only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const { mentionsOwner } = await import(pathToFileURL(path.join(root, '..', 'backend', 'tools', 'owner-stations.mjs')).href);

test('Simple mode splits gone trips from trips to come with the shared pieces', () => {
  const s = read('src/app/simple.tsx');
  assert.match(s, /usePastNow\(\)/, 'reads the PAST_NOW switch and the pastNow flag');
  assert.match(s, /pastNowSplit\(pastNow \? rows\.map\(\(r\) => r\.gone\) : \[\]\)/, 'gone is the rows\' own rule, nothing new');
  assert.match(s, /<EarlierHeader count=\{pn\.pastCount\}/);
  assert.match(s, /<NowDivider label=\{nowLabel\(now, clock\)\}/);
  assert.match(s, /backgroundColor: c\.pastBg/, 'gone trips sit on the recessed past zone');
  assert.match(s, /zone=\{i === 0 \? 'next'/, 'the next trip is tinted');
  assert.doesNotMatch(s, /useOpenAtNow/, 'no open at Now: gone trips only show after Earlier is tapped');
  // No new timer: the split runs on the minute tick the screen already has (useCountdownNow).
  assert.match(s, /const now = useCountdownNow\(\);/);
});

test('Simple mode with the switch off draws the list as before', () => {
  const s = read('src/app/simple.tsx');
  // pastNowSplit([]) gives no divider, so the one card branch runs, and the next tint needs pastNow.
  assert.match(s, /rows\.length && pn\.divider \?/);
  assert.match(s, /zone=\{pastNow && i === pn\.nextIdx \? 'next' : null\}/);
});

test('the Departures empty hint names no owner station or stop', () => {
  const s = read('src/app/(tabs)/search/index.tsx');
  const m = s.match(/'Try [^']*stop number like [^']*'/);
  assert.ok(m, 'hint present');
  assert.equal(mentionsOwner(m[0]), false, m[0]);
  assert.match(m[0], /stop number like \d{6,7}\./);
});
