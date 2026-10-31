// System settings pass (31 Oct, OTA safe, JS only): every clock in the app follows the phone's 12 or 24 hour setting,
// the Home stop card says "Timetable" on any time that is not a fresh live time, sheets and the time wheel respect
// Reduce Motion, text on the main screens has a Dynamic Type cap, and every tappable there has a role and words.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-sys31-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  js = js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  const f = path.join(out, path.basename(rel).replace(/\.tsx?$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const F = await load('src/lib/format.ts');
const L = await load('src/lib/liveLabelCore.ts');
const B = await load('src/lib/boardCore.ts');
const TM = await load('src/lib/tripModesCore.ts');
const BT = await load('src/lib/boardTimeCore.ts');
const O = await load('src/lib/offlineCore.ts');
const P = await load('src/lib/planCore.ts');
const OP = await load('src/lib/offPeakCore.ts');
const RC = await load('src/lib/reminderCore.ts');
const CP = await load('src/lib/carparkCore.ts');
const LB = await load('src/lib/leaveByCore.ts');
const AF = await load('src/lib/askFormat.ts');
const LH = await load('src/lib/lastHomeCore.ts');
await load('src/lib/rankCore.ts');
const S = await load('src/lib/simpleCore.ts');
const RT = await load('src/lib/rowTimeCore.ts');

// 7:52 pm and 12:05 am in Sydney on a fixed day (AEDT, UTC+11), never the real clock.
const EVE = Date.UTC(2026, 9, 28, 8, 52);
const MID = Date.UTC(2026, 9, 28, 13, 5);
const phone = (h24) => { globalThis.__tslPhone24h = () => h24; };
const unset = () => { delete globalThis.__tslPhone24h; };

test('before the app hands over the setting (and in every other test) the clocks stay 12 hour', () => {
  unset();
  assert.equal(F.clock(EVE), '7:52pm');
  assert.equal(F.liveStamp(EVE), 'Live 7:52pm');
  globalThis.__tslPhone24h = () => { throw new Error('no settings'); };
  assert.equal(F.clock(EVE), '7:52pm', 'a reader that throws keeps 12 hour');
  unset();
});

test('24 hour phone: boards, trips, Plan, stamps and Ask say 19:52 and 00:05; 12 hour phone says 7:52pm', () => {
  phone(true);
  assert.equal(F.clock(EVE), '19:52');
  assert.equal(F.clock(MID), '00:05', 'midnight is 00, never 24');
  assert.equal(F.clockSec(EVE + 30000), '19:52:30');
  assert.equal(F.liveStamp(EVE), 'Live 19:52');
  assert.equal(F.todText(19 * 60 + 5), '19:05');
  assert.equal(B.boardTime(EVE + 3 * 3600000, EVE).when, '22:52');
  const tt = L.liveState({ planned: new Date(EVE + 3 * 3600000).toISOString(), realtime: false }, EVE);
  assert.equal(tt.big, '22:52');
  assert.match(tt.a11y, /timetable time 22:52/);
  assert.equal(P.clock12(9, 5), '09:05');
  assert.equal(TM.whenWords({ kind: 'leave', h: 21, m: 15 }, EVE), 'Leave 21:15');
  assert.equal(BT.boardWhenWords(EVE, EVE), 'From 19:52');
  assert.equal(O.stampText(EVE, EVE), '19:52');
  assert.equal(OP.clockWords(10, 0), '10:00');
  assert.equal(RC.clockText(7, 30), '07:30');
  assert.equal(CP.parkClock(EVE), '19:52');
  assert.equal(LB.sydClock(EVE), '19:52');
  assert.equal(AF.clock12(new Date(EVE).toISOString()), '19:52');
  assert.equal(LH.clockText(EVE), '19:52');
  assert.equal(S.clock(EVE), '19:52');
  phone(false);
  assert.equal(F.clock(EVE), '7:52pm');
  assert.equal(F.clock(MID), '12:05am');
  assert.equal(F.clockSec(EVE + 30000), '7:52:30pm');
  assert.equal(B.boardTime(EVE + 3 * 3600000, EVE).when, '10:52pm');
  assert.equal(P.clock12(9, 5), '9:05am');
  assert.equal(TM.whenWords({ kind: 'leave', h: 21, m: 15 }, EVE), 'Leave 9:15pm');
  assert.equal(BT.boardWhenWords(EVE, EVE), 'From 7:52pm');
  assert.equal(O.stampText(EVE, EVE), '7:52pm');
  assert.equal(RC.clockText(7, 30), '7:30am');
  assert.equal(AF.clock12(new Date(EVE).toISOString()), '7:52 pm');
  assert.equal(S.clock(EVE), '7:52pm');
  unset();
});

test('the Plan rows and every other clock read the same phone setting, once a minute at most', () => {
  assert.equal(RT.rowClock(EVE, true), '19:52');
  assert.equal(RT.uses24h({ force24: true }), true);
  assert.equal(RT.uses24h({ hourCycle: 'h23' }), true);
  assert.equal(RT.uses24h({ hourCycle: 'h12' }), false);
  const rowTime = read('src/lib/rowTime.ts');
  assert.match(rowTime, /export function installPhoneClock\(\)/);
  assert.match(rowTime, /__tslPhone24h = \(\) => phone24h\(\)/);
  const layout = read('src/app/_layout.tsx');
  assert.match(layout, /\ninstallPhoneClock\(\);/);
  // The stop board's "Live, updated" line uses the shared clock, not its own 12 hour one.
  assert.match(read('src/components/Transit.tsx'), /Live, updated \$\{clockSec\(updatedAt\)\}/);
  // Every file that still writes a 12 hour clock asks the phone first (the server's copy of the trip card excepted:
  // it is generated into backend/src/worker.js, where there is no phone). On build 211 noteShowCore.ts also writes the
  // server's own 12 hour words (serverClock), never shown: only to read "got in at 12:06pm" in a server note back to a
  // time, so it must match the server whatever the phone shows.
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const r = path.join(d, e.name); if (e.isDirectory()) walk(r); else if (/\.tsx?$/.test(e.name)) files.push(r); } };
  walk('src');
  const readsServerWords = (f) => /export function serverClock\(/.test(read(f)) && read(f).split('hour12: true').length === 2;
  const bad = files.filter((f) => read(f).includes('hour12: true') && !read(f).includes('PHONE24') && !readsServerWords(f));
  assert.deepEqual(bad, []);
});

test('Home stop card: only a fresh live time counts down in green; anything else shows its timetable time and says Timetable', () => {
  const home = read('src/components/Home.tsx');
  const board = home.slice(home.indexOf('export function StopBoard'), home.indexOf('// ---------- Nearby'));
  assert.match(board, /const ls = depState\(d, now\);/);
  assert.match(board, /const tag = live \? '' : ls\.kind === 'cancelled' \? 'Cancelled' : 'Timetable';/);
  assert.match(board, /cd\(live \? bestTime\(d\.planned, d\.estimated\) : ls\.t, now\)/);
  assert.match(board, /timetable time, no live data/);
  assert.doesNotMatch(board, /color: d\.realtime \? c\.liveText/, 'the old copy\'s realtime flag alone no longer paints a row live');
  assert.match(board, /staleAt && !offlineAt && !packAt && groups\.length \? <T[^>]*>\{updatingText\(stampText\(staleAt, now\)\)\}/);
  // The rule the card now follows: an hour-old kept copy of a live time is not live (it is Not tracking / timetable).
  const kept = L.liveState({ planned: new Date(EVE + 8 * 60000).toISOString(), estimated: new Date(EVE + 10 * 60000).toISOString(), realtime: true, seenAt: EVE - 3600000 }, EVE);
  assert.notEqual(kept.kind, 'live');
  assert.equal(kept.t, EVE + 8 * 60000, 'it stands for the timetable time');
});

test('Reduce Motion: sheets fade instead of sliding, the time wheel and Ask jump instead of scrolling, a sheet drag goes straight back', () => {
  assert.match(read('src/components/Sheet.tsx'), /animationType=\{still \? 'fade' : 'slide'\}/);
  assert.match(read('src/components/VoiceHelp.tsx'), /animationType=\{still \? 'fade' : 'slide'\}/);
  const wp = read('src/components/WhenPicker.tsx');
  assert.match(wp, /animationType=\{ios && !still \? 'slide' : 'fade'\}/);
  assert.match(wp, /animated: animated && !still/);
  assert.match(read('src/components/TripReminders.tsx'), /animationType=\{ios && !still \? 'slide' : 'fade'\}/);
  assert.match(read('src/components/EditorSheet.tsx'), /if \(reduceMotionNow\(\)\) y\.setValue\(0\); else Animated\.spring/);
  assert.match(read('src/app/(tabs)/ask/index.tsx'), /scrollToEnd\(\{ animated: animated && !reduceMotionNow\(\) \}\)/);
  // Already in place before: the live dot and the loading rows stand still.
  assert.match(read('src/components/Transit.tsx'), /const still = useReduceMotion\(\);/);
  assert.match(read('src/components/SkeletonRows.tsx'), /const still = useReduceMotion\(\);/);
  for (const f of ['src/components/Sheet.tsx', 'src/components/VoiceHelp.tsx', 'src/components/WhenPicker.tsx', 'src/components/TripReminders.tsx']) {
    assert.doesNotMatch(read(f), /animationType="slide"/, f);
  }
});

// The main screens and the parts they are made of.
const MAIN = ['src/app/(tabs)/home/index.tsx', 'src/components/Home.tsx', 'src/components/Cards.tsx', 'src/app/(tabs)/search/index.tsx', 'src/app/(tabs)/ask/index.tsx',
  'src/app/(tabs)/settings/index.tsx', 'src/app/stop/[id].tsx', 'src/components/Transit.tsx', 'src/app/trip.tsx', 'src/app/new-trip.tsx', 'src/app/service.tsx', 'src/app/route.tsx',
  'src/app/board.tsx', 'src/app/simple.tsx', 'src/app/go.tsx', 'src/components/LiveLabel.tsx', 'src/components/ui.tsx', 'src/components/Segmented.tsx', 'src/components/Sheet.tsx',
  'src/components/HoldMenu.tsx', 'src/components/Swipe.tsx', 'src/components/WhenPicker.tsx', 'src/components/PastNow.tsx', 'src/components/GetMeHome.tsx', 'src/components/Smart.tsx',
  'src/components/Notices.tsx', 'src/components/Trackwork.tsx', 'src/components/LineStatus.tsx', 'src/components/WhyLate.tsx', 'src/components/SpeakButton.tsx', 'src/components/MapCard.tsx',
  'src/components/WalkChoice.tsx', 'src/components/LastHome.tsx', 'src/components/SkeletonRows.tsx', 'src/components/AskAnswer.tsx', 'src/components/CarParkRow.tsx', 'src/components/LeftRow.tsx',
  'src/components/EditorSheet.tsx', 'src/components/TripReminders.tsx', 'src/components/Access.tsx', 'src/components/LimitedTag.tsx', 'src/components/WhereNow.tsx', 'src/components/VoiceHelp.tsx',
  'src/components/CalendarLeaveBy.tsx', 'src/components/GetOffChoice.tsx', 'src/components/AnchoredMenu.tsx', 'src/components/RowMenu.tsx', 'src/components/StandPin.tsx'];
const TAP = new Set(['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback']);
function scan(f, onEl) {
  const src = read(f);
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (n) => {
    const op = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
    if (op) onEl(n, op, (x) => sf.getLineAndCharacterOfPosition(x.getStart()).line + 1);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
const attr = (op, name) => op.attributes.properties.find((p) => p.name && p.name.getText() === name);
const spread = (op) => op.attributes.properties.some((p) => p.kind === ts.SyntaxKind.JsxSpreadAttribute);
const isText = (n) => ts.isJsxElement(n) && ['Text', 'T'].includes(n.openingElement.tagName.getText());

test('Dynamic Type: every text on the main screens has a size cap (or takes its parent text\'s), and none turns scaling off', () => {
  const bad = [];
  for (const f of MAIN) {
    scan(f, (n, op, line) => {
      if (attr(op, 'allowFontScaling')) bad.push(`${f}:${line(n)} allowFontScaling`);
      if (op.tagName.getText() !== 'Text' || attr(op, 'maxFontSizeMultiplier') || spread(op)) return;
      let p = n.parent;
      while (p) { if (isText(p)) return; p = p.parent; }
      bad.push(`${f}:${line(n)}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('VoiceOver: every tappable on the main screens says what it is and has words (its own label or its text)', () => {
  const bad = [];
  for (const f of MAIN) {
    scan(f, (n, op, line) => {
      if (!TAP.has(op.tagName.getText()) || spread(op)) return;
      const role = attr(op, 'accessibilityRole') || attr(op, 'role');
      const label = attr(op, 'accessibilityLabel') || attr(op, 'aria-label');
      let words = false;
      // A row component that draws its caller's children ({children}) gets its words from the caller.
      const walk = (x) => { if (words) return; if (isText(x) || (ts.isJsxText(x) && x.getText().trim()) || (ts.isJsxExpression(x) && x.expression && x.expression.getText() === 'children')) words = true; ts.forEachChild(x, walk); };
      if (ts.isJsxElement(n)) ts.forEachChild(n, walk);
      if (!role || (!label && !words)) bad.push(`${f}:${line(n)}${role ? '' : ' no role'}${label || words ? '' : ' no words'}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('Dark mode: the main screens take their colours from the palette; white is only used on a coloured fill', () => {
  const bad = [];
  for (const f of MAIN) {
    read(f).split('\n').forEach((l, i) => {
      // A light grey or black written straight into a style would not follow Dark mode.
      if ((/(backgroundColor|borderColor)\s*:\s*'#(F2F2F7|FFFFFF|E5E5EA|000000|1C1C1E|EFEFF4)'/i.test(l) || /\bcolor\s*:\s*'#000000'/i.test(l)) && !/c\.dark|dark \?|light \?/.test(l)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});
