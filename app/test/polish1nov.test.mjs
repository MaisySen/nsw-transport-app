// Polish pass (1 Nov 2026): source checks for small reliability fixes found in the whole-app audit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}
const SRC = [...files(path.join(root, 'src')), ...files(path.join(root, 'platform'))];

test('every Linking.openURL call handles a refusal (no unhandled promise when no app can open the link)', () => {
  const bad = [];
  for (const f of SRC) {
    const s = fs.readFileSync(f, 'utf8');
    s.split('\n').forEach((line, i) => {
      if (/Linking\.openURL\(/.test(line) && !/\.catch\(/.test(line) && !/await Linking\.openURL/.test(line)) bad.push(`${path.relative(root, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('time wheels follow the phone: a 24 hour phone gets a 00 to 23 hour wheel and no am/pm wheel', () => {
  for (const f of ['src/components/WhenPicker.tsx', 'src/components/TripReminders.tsx']) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    assert.match(s, /const h24 = phone24h\(\)/, f);
    assert.match(s, /h24 \? <Wheel label="Hour" width=\{72\} values=\{HOURS24\}/, f);
    assert.match(s, /h24 \? null : <Wheel label="Morning or afternoon"/, f);
  }
});

test('alerts after a failed action never show a raw error: friendlyErr keeps people words, drops code words', async () => {
  const { createRequire } = await import('node:module');
  const os = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const ts = createRequire(import.meta.url)(path.join(root, 'node_modules', 'typescript'));
  const src = fs.readFileSync(path.join(root, 'src/lib/netErrCore.ts'), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'polish-')), 'netErrCore.mjs');
  fs.writeFileSync(f, js);
  const N = await import(pathToFileURL(f).href);
  assert.equal(N.friendlyErr(new Error("You're offline. Check your connection.")), "You're offline. Check your connection.");
  assert.equal(N.friendlyErr(new TypeError("Cannot read properties of undefined (reading 'id')")), N.MSG.failed);
  assert.equal(N.friendlyErr({ message: 'TypeError: x is not a function' }), N.MSG.failed);
  assert.equal(N.friendlyErr({ message: '{"error":"bad"}' }), N.MSG.failed);
  assert.equal(N.friendlyErr(undefined), N.MSG.failed);
  for (const file of SRC) {
    const s = fs.readFileSync(file, 'utf8');
    s.split('\n').forEach((line, i) => {
      if (/Alert\.alert\(/.test(line)) assert.ok(!/\be\??\.message\b|String\(e\b/.test(line), `${path.relative(root, file)}:${i + 1} shows a raw error`);
    });
  }
});

test('live trip screen: one sentence for the arrival header, one wording for old data, no doubled timetable sentence', () => {
  const s = fs.readFileSync(path.join(root, 'src/app/go.tsx'), 'utf8');
  assert.match(s, /accessible accessibilityLabel=\{`\$\{st\.etaLate \|\| x\.missed \? 'Arrive about' : 'Arrive'\} at/);
  assert.match(s, /`Updated \$\{clock\(updated\)\}\. Trying again\.`/);
  assert.ok(!/Last update \$\{ago/.test(s));
  assert.ok(!/Not live, running to timetable/.test(s));
  assert.ok(!/Running to timetable, not live\. The trip moves on/.test(s));
});

test('ask: send arrow and own bubbles use the readable colour on the tint, chips grow with text, answers are announced', () => {
  const s = fs.readFileSync(path.join(root, 'src/app/(tabs)/ask/index.tsx'), 'utf8');
  assert.match(s, /color: text\.trim\(\) \? onColor\(c\.tint\) : c\.text3/);
  assert.match(s, /chip: \{ minHeight: 34/);
  assert.match(s, /announceForAccessibility\(said\.slice\(0, 240\)\)/);
  assert.match(s, /accessibilityLabel="Looking that up"/);
});

test('header pills and the bus stop list grow with Dynamic Type instead of clipping', () => {
  for (const f of ['src/app/stop/[id].tsx', 'src/app/service.tsx', 'src/app/route.tsx']) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/paddingHorizontal: 12, height: 3[24], borderRadius: 1[67], backgroundColor: c\.fill/.test(s), f);
  }
  assert.match(fs.readFileSync(path.join(root, 'src/app/new-trip.tsx'), 'utf8'), /lineRow: \{[^}]*minHeight: 50/);
  assert.match(fs.readFileSync(path.join(root, 'src/components/Transit.tsx'), 'utf8'), /accessibilityLabel=\{a11y\} accessibilityHint="Opens the trip"/);
});

test('round 2: platform change spoken on Home cards, commute switch handles failure, no per-minute TalkBack chatter, stop retry, Plat wording, search failure honest', () => {
  const home = fs.readFileSync(path.join(root, 'src/components/Home.tsx'), 'utf8');
  assert.match(home, /\$\{stt\.text\}\$\{l\?\.platformChangedFrom \? `, platform changed from/);
  const set = fs.readFileSync(path.join(root, 'src/app/(tabs)/settings/index.tsx'), 'utf8');
  assert.match(set, /right=\{sw\(cm\.active, /);
  const smart = fs.readFileSync(path.join(root, 'src/components/Smart.tsx'), 'utf8');
  assert.equal((smart.match(/accessibilityLiveRegion=\{urgent \? 'polite' : 'none'\}/g) || []).length, 2);
  assert.match(fs.readFileSync(path.join(root, 'src/components/Transit.tsx'), 'utf8'), /accessibilityLiveRegion=\{offlineAt \? 'polite' : 'none'\}/);
  assert.ok(!/'Plat\. '/.test(fs.readFileSync(path.join(root, 'src/components/Transit.tsx'), 'utf8')));
  assert.match(fs.readFileSync(path.join(root, 'src/app/stop/[id].tsx'), 'utf8'), /title="Can't load this stop" body=\{error\} action=\{<Button title="Try again"/);
  const ss = fs.readFileSync(path.join(root, 'src/lib/stopSearch.ts'), 'utf8');
  assert.match(ss, /\.catch\(\(\) => \{ if \(live\) setFailed\(key\); \}\)/);
  for (const f of ['src/app/add-trip.tsx', 'src/app/welcome.tsx']) assert.match(fs.readFileSync(path.join(root, f), 'utf8'), /failed \? SEARCH_FAILED_TEXT : 'No stops match that'/, f);
  const trip = fs.readFileSync(path.join(root, 'src/app/trip.tsx'), 'utf8');
  assert.ok(!/function hms\(/.test(trip) && /Updated \$\{rowTime\(updatedAt\)\}/.test(trip));
});

test('round 3: cold start alert taps open their screen once, location never spins for ever, stable list keys, one pass beaten check, Ask me rows skip ticks', () => {
  const lay = fs.readFileSync(path.join(root, 'src/app/_layout.tsx'), 'utf8');
  assert.match(lay, /addNotificationResponseReceivedListener\(openFromAlert\)/);
  assert.match(lay, /getLastNotificationResponse/);
  assert.match(lay, /handledTaps\.has\(key\)/);
  const bad = [];
  for (const file of SRC) {
    const s = fs.readFileSync(file, 'utf8');
    if (/getCurrentPositionAsync\(/.test(s) && !/lib\/(where|hereLocation)\.ts$/.test(file)) bad.push(path.relative(root, file));
  }
  assert.deepEqual(bad, [], 'every fresh position goes through freshFix (12 s limit)');
  assert.match(fs.readFileSync(path.join(root, 'src/lib/hereLocation.ts'), 'utf8'), /setTimeout\(\(\) => r\(null\), 12000\)/);
  const nt = fs.readFileSync(path.join(root, 'src/app/new-trip.tsx'), 'utf8');
  assert.ok(!/keyExtractor=\{\([^)]*, i\) => [^}]*\+ i\}/.test(nt), 'no index in list keys');
  const trip = fs.readFileSync(path.join(root, 'src/app/trip.tsx'), 'utf8');
  assert.ok(!/arrs\.slice\(i \+ 1\)/.test(trip));
  assert.match(fs.readFileSync(path.join(root, 'src/app/(tabs)/ask/index.tsx'), 'utf8'), /a\.item\.role === 'me' \|\| \(a\.last === b\.last && a\.now === b\.now\)/);
});

test('freshFix gives up after its limit with nofix, and passes a fix through', async () => {
  const { createRequire } = await import('node:module');
  const os = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const ts = createRequire(import.meta.url)(path.join(root, 'node_modules', 'typescript'));
  let src = fs.readFileSync(path.join(root, 'src/lib/where.ts'), 'utf8').replace("import * as Location from 'expo-location';", 'const Location: any = { Accuracy: { Balanced: 3 } };');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'polish-')), 'where.mjs');
  fs.writeFileSync(f, js);
  const W = await import(pathToFileURL(f).href);
  const never = { getCurrentPositionAsync: () => new Promise(() => {}) };
  await assert.rejects(W.freshFix(3, 30, never), /nofix/);
  const ok = { getCurrentPositionAsync: async () => ({ coords: { latitude: -33.8, longitude: 151.2 } }) };
  assert.equal((await W.freshFix(3, 1000, ok)).coords.latitude, -33.8);
});
