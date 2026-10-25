// Last way home on the phone: the hint from Ask and trip results, the reminder, the live recheck and its words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require(path.join(here, '..', 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-lastlocal-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const h = await load('src/lib/lastHomeCore.ts');
const fx = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'ask-last-home-old-host.json'), 'utf8'));
const T0 = Date.parse('2026-10-25T12:00:00Z'); // 11:00pm Sydney
const iso = (m) => new Date(T0 + m * 60000).toISOString();
const leg = (line, dep, x = {}) => ({ kind: 'transit', line, mode: 'train', tripId: `${line}-${dep}`, from: 'Kings Cross Station', fromPlatform: 'Platform 1', planned: iso(dep), arrPlanned: iso(dep + 20), realtime: false, ...x });
const J = (dep, x = {}, l = {}) => ({ leave: iso(dep), legs: [leg(x.line || 'T4', dep, l)], anyCancelled: false, ...x });
const hint = { from: { id: '201110', name: 'Kings Cross Station' }, to: { id: '10101100', name: 'Strathfield Station' }, mode: 'train' };

test('the current server Ask answer gives a Remind me hint; the server hint wins when there is one', () => {
  const x = h.askLastHint(fx);
  assert.equal(x.from.id, fx.from.id);
  assert.equal(x.to.id, '10101100');
  assert.equal(x.svc.line, 'T4');
  assert.equal(x.svc.stop, 'Kings Cross');
  assert.equal(x.svc.board, fx.last.legs[1].estimated);
  assert.equal(x.svc.leave, fx.last.leave, 'the walk to the station keeps its 9 min');
  assert.ok(JSON.stringify(x).length < 800, 'small enough to keep in the Ask history');
  const server = { lastHome: { from: hint.from, to: hint.to, leave: iso(60) } };
  assert.equal(h.askLastHint(server), server.lastHome);
  assert.equal(h.askLastHint({ kind: 'trip' }), null);
  assert.equal(h.askLastHint({ ...fx, sure: false }), null, 'not sure it is the last one');
  assert.equal(h.askLastHint({ ...fx, last: { ...fx.last, anyCancelled: true } }), null);
});

test('who sends it: the server push on iPhone where it exists, else the phone', () => {
  assert.equal(h.chooseLastPath('ios', true, true), 'server');
  assert.equal(h.chooseLastPath('ios', false, true), 'local');
  assert.equal(h.chooseLastPath('android', true, true), 'local', 'Android has no server push before versionCode 6');
  assert.equal(h.chooseLastPath('android', true, false), 'server');
  assert.equal(h.chooseLastPath('ios', false, false), null);
});

test('the reminder rings 15 min before leaving, with words written at scheduling', () => {
  const svc = h.slimLast(J(60));
  const it = h.localItem(hint, svc, T0);
  assert.equal(it.remindAt, iso(45));
  assert.equal(it.leaveText, '12:00am');
  assert.equal(it.remindText, '11:45pm');
  const w = h.localRingWords(it);
  assert.equal(w.title, 'Last train to Strathfield');
  assert.equal(w.body, "The 12:00am T4 from Kings Cross, Platform 1 leaves in 15 min. It's the last one tonight.");
  const walk = h.localItem(hint, h.slimLast({ ...J(60), leave: iso(51) }), T0);
  assert.match(h.localRingWords(walk).body, /^Leave by 11:51pm for the 12:00am T4/);
  assert.equal(h.cardWords(walk, T0).line, 'Leave by 11:51pm for the 12:00am T4 from Kings Cross, Platform 1. Reminder at 11:36pm.');
  assert.equal(h.cardWords(walk, T0 + 41 * 60000).line, 'Leave in 10 min for the 12:00am T4 from Kings Cross, Platform 1.');
  assert.match(h.setNoteLocal(it), /^Reminder set for 11:45pm, 15 min before you leave at 12:00am\./);
  assert.doesNotMatch(w.body + h.setNoteLocal(it), /[\u2013\u2014]/);
  assert.deepEqual(h.cardWords(it, T0).title, 'Last train to Strathfield');
});

test('recheck: a late service moves the reminder; the same time leaves it', () => {
  const it = h.localItem(hint, h.slimLast(J(60)), T0);
  const late = J(60, {}, { realtime: true, estimated: iso(66) });
  const n = h.followLast(it, [J(30), late, J(330)], T0 + 10 * 60000);
  assert.equal(n.status, 'waiting');
  assert.equal(n.board, iso(66));
  assert.equal(n.remindAt, iso(51));
  assert.equal(n.changedFrom, '12:00am');
  assert.match(h.cardWords(n, T0 + 10 * 60000).line, /Time changed since you set it/);
  const same = h.followLast(it, [J(30), J(60), J(330)], T0 + 10 * 60000);
  assert.equal(same.remindAt, it.remindAt);
  assert.equal(same.changedFrom, null);
  assert.equal(h.followLast(it, [], T0).remindAt, it.remindAt, 'no answer changes nothing');
});

test('recheck: cancelled, the last one still running takes over; none left says so', () => {
  const it = h.localItem(hint, h.slimLast(J(60)), T0);
  const cancelled = J(60, {}, { cancelled: true });
  const n = h.followLast(it, [J(30), cancelled, J(330)], T0 + 5 * 60000);
  assert.equal(n.status, 'waiting');
  assert.equal(n.board, iso(30));
  assert.equal(n.text, 'The 12:00am T4 is cancelled. Following the 11:30pm T4 instead.');
  const none = h.followLast(it, [cancelled, J(330)], T0 + 5 * 60000);
  assert.equal(none.status, 'none');
  assert.match(none.text, /^The 12:00am T4 is cancelled\. No other service home shows for tonight/);
  assert.equal(h.cardWords(none, T0 + 5 * 60000).go, true);
});

test('the last service is the one before the night gap; buses do not count for a train reminder', () => {
  const p = h.pickLastJourney([J(30), J(60), J(330)], 'train');
  assert.equal(p.j.leave, iso(60));
  assert.equal(p.sure, true);
  const bus = { leave: iso(90), legs: [leg('N70', 90, { mode: 'bus' })] };
  assert.equal(h.pickLastJourney([J(30), J(60), bus, J(330)], 'train').j.leave, iso(60));
  assert.equal(h.pickLastJourney([J(30), bus], null).j.leave, iso(90));
  assert.equal(h.pickLastJourney([], 'train'), null);
});

test('rechecks run only while it waits: every 5 min, every minute in the last 25 min', () => {
  const it = h.localItem(hint, h.slimLast(J(60)), T0);
  assert.equal(h.recheckDue(it, T0 + 60000), false);
  assert.equal(h.recheckDue(it, T0 + 5 * 60000), true);
  const near = { ...it, checked: T0 + 40 * 60000 };
  assert.equal(h.recheckDue(near, T0 + 41 * 60000), true);
  assert.equal(h.recheckDue({ ...it, status: 'none' }, T0 + 30 * 60000), false);
  assert.equal(h.recheckDue(it, T0 + 63 * 60000), false, 'gone');
});
