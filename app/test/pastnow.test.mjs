// Past and upcoming apart on lists that mix them (PAST_NOW, 30 Oct; Bidur testing build 209: "Hard to differentiate
// past and current list here"). The split (where the Earlier header and the Now divider go), the open at Now (initial
// scroll), the muted gone rows, and that both lists use it without a new timer or a change to what counts as gone.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-pastnow-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const P = await load('src/lib/pastNowCore.ts');
const M = await load('src/lib/tripModesCore.ts');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const themeSrc = read('src/lib/theme.ts').replace(/^import .*react-native.*$/m, "const Platform = { OS: 'android' }; const useColorScheme = () => 'light';");
const themeFile = path.join(out, 'theme.mjs');
fs.writeFileSync(themeFile, ts.transpileModule(themeSrc, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const th = await import(pathToFileURL(themeFile).href);

// Friday 30 Oct 2026, 5:08pm Sydney (AEDT, UTC+11).
const NOW = Date.parse('2026-10-30T06:08:00Z');
const min = (n) => NOW + n * 60000;
const hm = (t) => new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)/i, (m) => m.trim().toLowerCase());

test('divider goes above the first service still to come, Earlier above the first gone one', () => {
  // 4:52, 4:58, 5:04 gone; 5:07:30 is within the minute (not gone, the rows' own rule); 5:12 and 5:18 to come.
  const deps = [min(-16), min(-10), min(-4), min(-0.5), min(4), min(10)];
  const gone = deps.map((d) => M.hasLeft(d, NOW));
  assert.deepEqual(gone, [true, true, true, false, false, false], 'the same hasLeft the rows use: over a minute past');
  const s = P.pastNowSplit(gone);
  assert.equal(s.nowIdx, 3);
  assert.equal(s.pastCount, 3);
  assert.equal(s.earlier, true);
  assert.equal(s.divider, true);
  assert.equal(s.nextIdx, 3, 'the next service is the first one to come');
});

test('nothing gone: no Earlier header, no divider, the first row is the next one', () => {
  const s = P.pastNowSplit([false, false, false]);
  assert.deepEqual(s, { nowIdx: 0, pastCount: 0, earlier: false, divider: false, nextIdx: 0 });
});

test('everything gone (a time picked earlier today): Earlier header, no divider, nothing marked next', () => {
  const s = P.pastNowSplit([true, true]);
  assert.deepEqual(s, { nowIdx: -1, pastCount: 2, earlier: true, divider: false, nextIdx: -1 });
});

test('empty list and the switch off (screens pass []) draw exactly as before', () => {
  const s = P.pastNowSplit([]);
  assert.deepEqual(s, { nowIdx: -1, pastCount: 0, earlier: false, divider: false, nextIdx: -1 });
  for (let i = 0; i < 4; i++) {
    const e = P.cardEdges(i, 4, s);
    assert.deepEqual(e, { top: i === 0, bottom: i === 3, sep: i > 0 }, 'one card, as before');
  }
});

test('a gone row ranked under a later direct trip stays where ranking put it, after the divider', () => {
  const s = P.pastNowSplit([true, false, true, false]);
  assert.equal(s.nowIdx, 1);
  assert.equal(s.pastCount, 2);
  assert.equal(s.divider, true);
});

test('cards split at Now: rounded corners and no hairline at the cut', () => {
  const s = P.pastNowSplit([true, true, false, false, false]);
  const e = [0, 1, 2, 3, 4].map((i) => P.cardEdges(i, 5, s));
  assert.deepEqual(e.map((x) => x.top), [true, false, true, false, false]);
  assert.deepEqual(e.map((x) => x.bottom), [false, true, false, false, true]);
  assert.deepEqual(e.map((x) => x.sep), [false, true, false, true, true]);
});

test('divider words: "Now, 5:08pm" in Sydney time, and VoiceOver says what is above and below', () => {
  assert.equal(P.nowLabel(NOW, hm), 'Now, 5:08pm');
  assert.equal(P.nowLabel(NOW, () => ''), 'Now');
  assert.match(P.nowA11y(NOW, hm, 3), /^Now, 5:08pm\. 3 services above have already gone\. Services to come below\.$/);
  assert.match(P.nowA11y(NOW, hm, 1), /1 service above has already gone/);
});

test('open at Now: scrolls the divider to the top once per list, under the iPhone header, never after a drag', () => {
  const split = { divider: true };
  assert.equal(P.scrollToNow({ split, dividerY: 600, done: null, key: 'a', dragged: false }), 596, 'solid header: divider at the top edge');
  assert.equal(P.scrollToNow({ split, dividerY: 600, done: null, key: 'a', dragged: false, headerH: 103 }), 493, 'see-through header: just under it');
  assert.equal(P.scrollToNow({ split, dividerY: 40, done: null, key: 'a', dragged: false, headerH: 103 }), -67, 'near the top: a small move');
  assert.equal(P.scrollToNow({ split, dividerY: -20, done: null, key: 'a', dragged: false, headerH: 103 }), -103, 'never above the top of the list');
  assert.equal(P.scrollToNow({ split, dividerY: 600, done: 'a', key: 'a', dragged: false }), null, 'once per list');
  assert.equal(P.scrollToNow({ split, dividerY: 600, done: 'a', key: 'b', dragged: false }), 596, 'a new time or trip opens at Now again');
  assert.equal(P.scrollToNow({ split, dividerY: 600, done: null, key: 'a', dragged: true }), null, 'the reader scrolled: leave it');
  assert.equal(P.scrollToNow({ split: { divider: false }, dividerY: 600, done: null, key: 'a', dragged: false }), null, 'nothing gone above');
  assert.equal(P.scrollToNow({ split, dividerY: null, done: null, key: 'a', dragged: false }), null, 'not laid out yet');
});

test('open at Now is settled by the first rows shown: a row that goes later on the minute tick never moves the list', () => {
  assert.equal(P.openSettled(true, 0, false), false, 'no rows yet: wait');
  assert.equal(P.openSettled(true, 5, false), true, 'first rows had nothing gone: settled, no scroll later');
  assert.equal(P.openSettled(true, 5, true), false, 'gone rows above: scroll when the divider is laid out');
  assert.equal(P.openSettled(false, 5, true), true, 'switch off: never scroll');
});

test('gone rows are muted: faded times and badges, no strikethrough, a little shorter', () => {
  assert.ok(P.MUTED.timeOpacity < 1 && P.MUTED.timeOpacity >= 0.6, 'times fade but stay readable');
  assert.ok(P.MUTED.badgeOpacity < 0.5, 'badges fade more than before (0.5)');
  assert.equal(P.MUTED.strike, false);
  const src = read('src/components/LeftRow.tsx');
  assert.match(src, /const strike = cancelled && !muted/, 'trip Left row: no strikethrough when muted');
  assert.match(src, /d\.cancelled && !muted \? 'line-through'/, 'board Left row: no strikethrough when muted');
  assert.match(src, /muted \? MUTED\.badgeOpacity : 0\.5/);
  assert.doesNotMatch(src, /LiveLabel|LivePill|LiveStatus/, 'no live badge on a gone row');
});

test('the trip list and the stop board use it, with the rows\' own gone rule and no new timer', () => {
  const trip = read('src/app/trip.tsx');
  assert.match(trip, /pastNowSplit\(pastNow \? js\.map\(\(j\) => hasLeft\(depMs\(j\), now\)\) : \[\]\)/);
  assert.match(trip, /<LeftRow j=\{j\} arrive=\{arrs\[i\]\} muted=\{pastNow\}/);
  assert.match(trip, /<EarlierHeader/);
  assert.match(trip, /<NowDivider label=\{nowLabel\(now, clock\)\}/);
  assert.match(trip, /atNow\.onDividerLayout/);
  assert.match(trip, /maintainVisibleContentPosition=\{anchorOn \? \{ minIndexForVisible: 1 \} : undefined\}/, 'earlier pages still keep the reader\'s place');
  const board = read('src/app/stop/[id].tsx');
  assert.match(board, /pastNowSplit\(pastNow \? items\.map\(\(d\) => isGone\(d, now\)\) : \[\]\)/);
  assert.match(board, /<LeftDepartureRow d=\{d\} muted=\{pastNow\}/);
  assert.match(board, /<NowDivider[^>]*onLayout=\{atNow\.onDividerLayout\}/);
  for (const rel of ['src/components/PastNow.tsx', 'src/lib/pastNowCore.ts']) {
    const s = read(rel);
    assert.doesNotMatch(s, /setInterval|setTimeout|useNow\(|useCountdownNow\(/, `${rel}: no timer of its own`);
    assert.doesNotMatch(s, /\bfetch\(|api\./, `${rel}: no request`);
  }
});

test('switches: PAST_NOW in features.ts, server flags pastNow and pastNowScroll', () => {
  assert.match(read('src/lib/features.ts'), /export const PAST_NOW = true;/);
  const c = read('src/components/PastNow.tsx');
  assert.match(c, /useFlag\('pastNow'\)/);
  assert.match(c, /useFlag\('pastNowScroll'\)/);
  assert.match(c, /return PAST_NOW && on;/);
});

// Bidur, 5:09 PM: "Make background better." The zones are told apart by their backgrounds, and every text on them
// stays readable (WCAG AA 4.5:1) in light and dark, iPhone and Android.
const SETS = [['iPhone', 'light'], ['iPhone', 'dark'], ['Android', 'light'], ['Android', 'dark']];
for (const [os_, mode] of SETS) {
  const p = th.palettes[os_ === 'iPhone' ? 'ios' : 'md'][mode];
  test(`${os_} ${mode}: past zone, Now band and next tint meet 4.5:1 for their text`, () => {
    const bad = [];
    const need = (fg, bg, min = 4.5) => { const r = th.contrast(p[fg], p[bg]); if (r < min) bad.push(`${fg} ${p[fg]} on ${bg} ${p[bg]}: ${r.toFixed(2)}`); };
    need('pastText', 'pastBg');
    need('lateText', 'pastBg');
    need('nowText', 'nowBg');
    need('text', 'nextBg');
    need('lateText', 'nextBg');
    need('redText', 'nextBg');
    // Live green on the next tint: as readable as on the plain card (iPhone light's system green is 4.4:1 on white,
    // so there the tint may cost at most 0.35).
    const onCard = th.contrast(p.liveText, p.card), onNext = th.contrast(p.liveText, p.nextBg);
    if (onNext < Math.min(4.5, onCard - 0.35)) bad.push(`liveText on nextBg ${onNext.toFixed(2)} (card ${onCard.toFixed(2)})`);
    // Faded times on the past zone stay large text readable (3:1).
    assert.deepEqual(bad, []);
  });
  test(`${os_} ${mode}: the zones look different (past is not the card colour, the band stands out)`, () => {
    assert.notEqual(p.pastBg, p.card);
    assert.notEqual(p.nextBg, p.card);
    assert.ok(th.contrast(p.pastBg, p.card) >= 1.05, 'past zone visibly apart from the cards');
    assert.ok(th.contrast(p.nowBg, p.bg) >= 3, 'Now band at least 3:1 against the page (a non-text UI part)');
  });
}

test('board rows: the next service is tinted on the board too, and the past card uses the past zone colour', () => {
  const board = read('src/app/stop/[id].tsx');
  assert.match(board, /next=\{pn\.nextIdx === i\}/);
  assert.match(board, /backgroundColor: c\.pastBg/);
  const tr = read('src/components/Transit.tsx');
  assert.match(tr, /next \? c\.nextBg : c\.card/);
  assert.match(tr, /!!a\.next === !!b\.next/, 'the memo compares the new prop');
  const trip = read('src/app/trip.tsx');
  assert.match(trip, /pastNow && gone \? c\.pastBg : pn\.nextIdx === i && open !== i \? c\.nextBg : c\.card/);
});
