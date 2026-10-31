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
