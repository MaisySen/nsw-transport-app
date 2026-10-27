// Speed pass 5, app (27 Oct 2026): less work before the first frame and fewer redraws per clock tick. The local search
// index and the Ask gazetteer leave the modules read before Home draws; tabs that were never opened stop ticking; the
// service screen, the live trip screen and watches tick only their time text; trip list rows redraw only when what they
// show changes; Plan and Ask read the stop lists when opened, not at launch; two more rows start the next screen's read on press in. Screen wiring is checked in the source.
// Run: TZ=Australia/Sydney OFFLINE=1 node --test test/speed27e.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const src = path.join(root, 'src');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// The app's own modules a cold start evaluates before Home's first frame: the root layout, the tabs layout and Home,
// and every module they import at the top (not type imports, not require() inside a function).
function resolve(from, spec) {
  let base;
  if (spec.startsWith('@/')) base = path.join(src, spec.slice(2));
  else if (spec.startsWith('.')) base = path.normalize(path.join(path.dirname(from), spec));
  else return null;
  for (const ext of ['.ios.tsx', '.ios.ts', '.tsx', '.ts', '.js', '/index.tsx', '/index.ts']) if (fs.existsSync(base + ext)) return base + ext;
  return null;
}
function eagerSet() {
  const roots = ['app/_layout.tsx', 'app/(tabs)/_layout.tsx', 'app/(tabs)/home/_layout.tsx', 'app/(tabs)/home/index.tsx'].map((r) => path.join(src, r));
  const seen = new Set();
  const stack = [...roots];
  const re = /^\s*(import|export)\s+(type\s+)?(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm;
  while (stack.length) {
    const f = stack.pop();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(re)) { if (m[2]) continue; const d = resolve(f, m[3]); if (d) stack.push(d); }
  }
  return seen;
}

test('cold start: the local search index and the Ask gazetteer are not evaluated before the first frame', () => {
  const eager = [...eagerSet()].map((f) => path.relative(src, f));
  for (const m of ['lib/localSearch.ts', 'lib/askPlaces.ts', 'lib/askBrain.ts', 'lib/localSearchCore.ts']) assert.ok(!eager.includes(m), `${m} is read before the first frame`);
  // Home and the layout still load what the first frame draws.
  for (const m of ['components/Home.tsx', 'lib/boot.ts', 'lib/api.ts']) assert.ok(eager.includes(m), m);
  const layout = read('src/app/_layout.tsx');
  assert.ok(!/import\s*\{[^}]*warmLocalSearch[^}]*\}\s*from/.test(layout), 'no top level import of warmLocalSearch');
  assert.match(layout, /require\('\.\.\/lib\/localSearch'\)[^;]*\.warmLocalSearch\(\)/);
  assert.match(layout, /STARTUP_DEFER_MS \* 4/, 'still warmed well after the first screen has its times');
});

test('the Plan and Ask tabs read the stop lists when opened, not when the native tabs mount them at launch', () => {
  const ls = read('src/lib/localSearch.ts');
  const hook = ls.slice(ls.indexOf('export function useLocalIndex('));
  assert.match(hook, /useFocusEffect\(useCallback\(\(\) => \{ warmLocalSearch\(\); \}, \[\]\)\);/);
  const effect = hook.slice(hook.indexOf('useEffect('), hook.indexOf('useFocusEffect('));
  assert.ok(!effect.includes('warmLocalSearch'), 'mounting alone no longer reads and indexes the lists');
  const ask = read('src/app/(tabs)/ask/index.tsx');
  assert.match(ask, /useFocusEffect\(useCallback\(\(\) => \{ askPlaces\(\)\.catch\(\(\) => null\); \}, \[\]\)\);/);
  assert.ok(!/useEffect\(\(\) => \{ askPlaces\(\)/.test(ask));
});

test('clocks: a screen that was never focused does not tick (native tabs mount every tab at start)', () => {
  const a = read('src/lib/activity.ts');
  const useNow = a.slice(a.indexOf('export function useNow('), a.indexOf('// ---------- countdown clock'));
  const cd = a.slice(a.indexOf('export function useCountdownNow('));
  for (const body of [useNow, cd]) {
    assert.match(body, /const \[on, setOn\] = useState\(false\);/);
    assert.match(body, /useFocusEffect\(useCallback\(\(\) => \{ setOn\(true\); setNow\(Date\.now\(\)\); return \(\) => setOn\(false\); \}, \[\]\)\)/);
    assert.match(body, /if \(!on \|\| !active\) return;/);
  }
});

test('ticks: only the time text redraws on the service, live trip and watch screens', () => {
  const svc = read('src/app/service.tsx');
  const screen = svc.slice(svc.indexOf('export default function ServiceScreen'), svc.indexOf('function ServiceStatus('));
  assert.ok(!/useNow\(/.test(screen), 'the service screen itself has no clock');
  const status = svc.slice(svc.indexOf('function ServiceStatus('));
  assert.match(status, /const now = useNow\(\);/);
  assert.match(status, /liveState\(at, now\)/);
  assert.match(screen, /<ServiceStatus at=\{liveAt\}/);

  const go = read('src/app/go.tsx');
  const goScreen = go.slice(go.indexOf('export default'), go.indexOf('function Sheet('));
  assert.ok(!/useNow\(/.test(goScreen), 'the live trip screen (map) has no clock');
  assert.ok(!goScreen.includes('now={now}'));
  assert.match(go.slice(go.indexOf('function Sheet(')), /const now = useNow\(\);/);

  const cards = read('src/components/Cards.tsx');
  assert.match(cards, /export function WatchLineText\(\{ w, kind, style \}[^)]*\) \{\n  const now = useNow\(\);\n  return <T kind=\{kind\} style=\{style\}>\{watchLine\(w, now\)\}<\/T>;/);
  for (const f of ['src/app/watching.tsx', 'src/app/watch/[id].tsx']) {
    const s = read(f);
    assert.ok(!/useNow/.test(s), `${f} has no screen clock`);
    assert.match(s, /<WatchLineText w=\{w\}/);
  }
});

test('trip list rows redraw only when the trip or what the clock shows on the row changes', () => {
  const home = read('src/components/Home.tsx');
  assert.match(home, /export const ServiceRow = memo\(ServiceRowView, sameServiceRow\);/);
  const clock = home.slice(home.indexOf('export function serviceRowClock('), home.indexOf('export function sameServiceRow('));
  // Every clock input the row reads is in the key: status words, badge, colour band, the hour grey, live label, faded.
  for (const s of ['statusOf(j, now)', 'timeLeftBadge(dep, now)', 'b.mins >= 60', '<= 3', '<= 9', 'hasLiveData(l, now)', 'dep < now - 30000']) assert.ok(clock.includes(s), s);
  const same = home.slice(home.indexOf('export function sameServiceRow('), home.indexOf('export const ServiceRow'));
  assert.match(same, /a\.j !== b\.j/);
  assert.match(same, /a\.onPress !== b\.onPress/, 'without a pressKey a new onPress still redraws, as before');
  const view = home.slice(home.indexOf('function ServiceRowView('), home.indexOf('// ---------- stop boards'));
  // The clock inputs the row draws with are the ones in the key.
  for (const s of ['statusOf(j, now)', 'timeLeftBadge(dep, now)', 'cdColor(dep, now, cancelled, c)', 'hasLiveData(l, now)', 'dep < now - 30000']) assert.ok(view.includes(s), s);
  assert.equal((view.match(/\bnow\b/g) || []).length, 8, 'a new use of now in the row needs a place in serviceRowClock');
  const trip = read('src/app/trip.tsx');
  const row = trip.slice(trip.indexOf('<ServiceRow j={j} now={now}'));
  assert.ok(row.slice(0, row.indexOf('\n')).includes('pressKey={i} onPress={() => { haptic.select(); setOpen((o) => (o === i ? null : i)); }} />'));
});

test('Home cards that do not use the clock skip the countdown redraws', () => {
  assert.match(read('src/components/GetMeHome.tsx'), /export const GetMeHome = memo\(GetMeHomeView\);/);
  assert.match(read('src/components/LastHome.tsx'), /export const LastHomeCard = memo\(LastHomeCardView\);/);
});

test('press in: a watch leg and the car park station row start the next screen read', () => {
  const w = read('src/app/watch/[id].tsx');
  assert.match(w, /onPressIn=\{\(\) => pressService\(legSvc\(l\)\)\} onPress=\{\(\) => openService\(legSvc\(l\)\)\}/);
  const cp = read('src/app/carpark.tsx');
  assert.match(cp, /title="Station departures" onPressIn=\{\(\) => prefetchStop\(stationId\)\}/);
});
