// Home, Option A (25 Oct): the Next trip card and compact rows. Where to board, the next two times, which trip is
// the card, the order after a drag or Show first, and delete with Undo. Pure helpers in src/lib/homeCore.ts.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-homea-'));
const js = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/homeCore.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
fs.writeFileSync(path.join(out, 'homeCore.mjs'), js);
const H = await import(pathToFileURL(path.join(out, 'homeCore.mjs')).href);
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('where to board: platform for trains, stop number (and stand on the card) for buses', () => {
  assert.equal(H.whereText('Platform 2', '213510', 'train'), 'Plat 2');
  assert.equal(H.whereText('Platform 2', '213510', 'train', true), 'Platform 2');
  assert.equal(H.whereText('Stand X1', '213723', 'bus'), 'Stop 213723');
  assert.equal(H.whereText('Stand X1', '213723', 'bus', true), 'Stand X1, Stop 213723');
  assert.equal(H.whereText(null, '2046100', 'bus', true), 'Stop 2046100');
  assert.equal(H.whereText('', '', 'train'), '');
  assert.equal(H.whereText('Platform 1', '2000331', 'ferry'), 'Plat 1', 'a wharf id is not a bus stop number');
});

test('then line: the next two countdowns, min only when all are minutes', () => {
  assert.equal(H.thenText([{ big: '12', unit: 'min' }, { big: '19', unit: 'min' }]), 'Then 12, 19 min');
  assert.equal(H.thenText([{ big: '45', unit: 'min' }, { big: '5:12', unit: '' }]), 'Then 45, 5:12');
  assert.equal(H.thenText([]), '');
  assert.equal(H.thenText([{ big: '', unit: '' }]), '');
});

test('Next trip card: the commute when set, otherwise the first trip in your order', () => {
  assert.deepEqual(H.splitNext('C', ['a', 'b']), { next: 'C', rest: ['a', 'b'] });
  assert.deepEqual(H.splitNext(null, ['a', 'b', 'c']), { next: 'a', rest: ['b', 'c'] });
  assert.deepEqual(H.splitNext(null, []), { next: null, rest: [] });
});

test('dragging a row keeps the Next trip card on top', () => {
  assert.deepEqual(H.dragOrder(['a'], ['b', 'c', 'd'], 2, 0), ['a', 'd', 'b', 'c']);
  assert.deepEqual(H.dragOrder([], ['b', 'c', 'd'], 0, 2), ['c', 'd', 'b']);
  // Home and Work share one key: the moved one keeps the place it was dropped at.
  assert.deepEqual(H.dragOrder([], ['places', 'x', 'places', 'y'], 0, 3), ['x', 'y', 'places']);
  assert.deepEqual(H.dragOrder(['a'], ['b'], 5, 0), ['a', 'b'], 'a bad index changes nothing');
});

test('Show first puts the trip on top of the saved order', () => {
  assert.deepEqual(H.toFront(['a', 'b', 'c'], ['a', 'b', 'c'], 'c'), ['c', 'a', 'b']);
  assert.deepEqual(H.toFront([], ['a', 'b', 'c'], 'b'), ['b', 'a', 'c'], 'no order yet: the order on screen');
  assert.deepEqual(H.toFront(['a'], ['a', 'b', 'c'], 'c'), ['c', 'a', 'b'], 'trips not in the order keep their place after it');
});

function fakeTimers() {
  let t = 0, seq = 0; const q = new Map();
  return { set: (fn, ms) => { const id = ++seq; q.set(id, { at: t + ms, fn }); return id; }, clear: (id) => { q.delete(id); },
    advance(ms) { t += ms; for (const [id, x] of [...q]) if (x.at <= t) { q.delete(id); x.fn(); } }, pending: () => q.size };
}

test('delete with Undo: gone at once, the server copy only after the Undo bar', () => {
  const tm = fakeTimers(); const log = [];
  const d = H.undoableDelete(() => { log.push('local'); return () => log.push('restore'); }, () => log.push('remote'), 5500, tm);
  assert.deepEqual(log, ['local']);
  tm.advance(5000); assert.deepEqual(log, ['local']);
  tm.advance(500); assert.deepEqual(log, ['local', 'remote']);
  assert.equal(d.undo(), false, 'too late to undo once the server delete went');
  assert.equal(d.state(), 'done');
});

test('Undo restores and the server is never asked', () => {
  const tm = fakeTimers(); const log = [];
  const d = H.undoableDelete(() => { log.push('local'); return () => log.push('restore'); }, () => log.push('remote'), 5500, tm);
  assert.equal(d.undo(), true);
  tm.advance(10000);
  assert.deepEqual(log, ['local', 'restore']);
  assert.equal(tm.pending(), 0);
  assert.equal(d.undo(), false, 'undo runs once');
});

test('going to the background sends the server delete at once, once', () => {
  const tm = fakeTimers(); const log = [];
  const d = H.undoableDelete(() => () => log.push('restore'), () => log.push('remote'), 5500, tm);
  d.commit(); d.commit(); tm.advance(6000);
  assert.deepEqual(log, ['remote']);
});

test('a trip kept only on the phone has no server step', () => {
  const tm = fakeTimers();
  const d = H.undoableDelete(() => () => {}, null, 5500, tm);
  tm.advance(6000); assert.equal(d.state(), 'done');
});

test('a deleted saved trip name shows again after Undo', () => {
  const g = H.makeDeletedNames();
  g.add('Work run', 0); assert.equal(g.has('work run', 1), true);
  g.remove('Work run'); assert.equal(g.has('work run', 2), false);
});

test('Home source: Option A only, no design switch, one Add in the navigation bar', () => {
  const home = read('src/app/(tabs)/home/index.tsx');
  assert.ok(!/design/.test(home.replace(/redesign/gi, '')), 'no ?design= switch');
  assert.ok(!/Segmented/.test(home), 'no Option B segmented control');
  assert.ok(!/pills/.test(read('src/components/Home.tsx')), 'no Option B pills look');
  assert.ok(/headerRight[\s\S]{0,200}<AddButton/.test(home), 'Add sits in the navigation bar');
  assert.ok(!/action=\{\{ title: 'Add'/.test(home), 'no Add in the middle of the page');
  assert.ok(/look="hero"/.test(home), 'Next trip card');
  assert.ok(/<TabBarSafe overlay/.test(home), 'Undo bar above the tab bar');
  assert.ok(/ActionSheet visible/.test(home), 'Android and web use the bottom sheet (an Android dialog shows 3 buttons at most)');
  assert.ok(/accessibilityLabel="Add"/.test(home), 'VoiceOver label on Add');
});

test('hold menus fit Android dialogs (3 buttons at most)', () => {
  const src = read('src/components/Home.tsx');
  assert.ok(/buttons\.length > 3 \? buttons\.filter\(\(b\) => b\.style !== 'cancel'\)/.test(src));
  const menu = src.slice(src.indexOf('export function tripMenu'), src.indexOf('export function tripMenu') + 4000);
  assert.ok(!/Alert\.alert\(trip\.name/.test(menu), 'trip menus go through holdMenu');
});

test('Next trip card and rows use the shared live label', () => {
  const src = read('src/components/Home.tsx');
  const g = src.slice(src.indexOf('function TripGlance'), src.indexOf('const g = StyleSheet.create'));
  assert.ok(/liveState\(/.test(g), 'countdown from liveState');
  assert.ok(/<LiveStatus state=\{ls\}/.test(g), 'card label is LiveStatus');
  assert.ok(/honest \? ls\.label/.test(g), 'rows say Timetable or Not tracking');
  assert.ok(!/\bcd\(dep, now\) : \{ big/.test(g) || /ls \? \{ big: ls\.big/.test(g), 'the big number is the honest one');
});
