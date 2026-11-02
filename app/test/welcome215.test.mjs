// Build 215 readiness (2 Nov 2026): the first-open "Where's home?" set up never covers a running trip.
// Found in the iOS Simulator real-time run (rt-harness-1nov run 3, 1 Nov): a trip started from a link before the two
// questions were answered; after the app was closed and opened again, Home pushed the set up over the trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const home = fs.readFileSync(path.join(here, '..', 'src', 'app', '(tabs)', 'home', 'index.tsx'), 'utf8');
const at = home.indexOf("router.push('/welcome')");
const effect = home.slice(home.lastIndexOf('useEffect(', at), home.indexOf('}, [', at) + 80);

test('the live trip is read before the set up effect (hook order kept, no hook after it)', () => {
  const g = home.indexOf('const g = useLiveTrip();');
  assert.ok(g > 0 && g < home.lastIndexOf('useEffect(', at), 'useLiveTrip comes before the set up effect');
  assert.equal(home.split('useLiveTrip()').length - 1, 1, 'read once');
});

test('no set up while a trip is running, also when the trip loads after the store', () => {
  assert.match(effect, /if \(![^\n]*\|\| g\b[^\n]*\) return;/, 'a running trip skips the questions');
  assert.match(effect, /getLive\(\)/, 'checked again when the timer fires (the saved trip can load after the store)');
  assert.match(effect, /\[loaded, st\.onboarded, places\.home, places\.work, g\]/, 'the trip is a dependency');
});

test('asked once only when it is really shown', () => {
  const inTimer = effect.slice(effect.indexOf('setTimeout('));
  assert.match(inTimer, /asked\.current = true/, 'marked asked when the timer pushes the screen');
});
