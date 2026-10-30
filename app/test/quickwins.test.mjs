// Reliability pick and Last way home: the parts with no phone dependencies. Run: node --test test/
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-qw-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const rel = await load('src/lib/reliabilityCore.ts');
const lh = await load('src/lib/lastHomeCore.ts');
const MIN = 60000, H = 60 * MIN;
// Sydney is UTC+11 in late October 2026.
const syd = (d, h, m) => Date.UTC(2026, 9, d, h - 11, m);

test('reliability: which service a row asks about', () => {
  assert.deepEqual(rel.relQuery({ kind: 'transit', line: 'T1', stopId: '2134101', planned: '2026-10-26T07:52:00+11:00' }), { line: 'T1', stopId: '2134101', planned: '2026-10-26T07:52:00+11:00' });
  assert.equal(rel.relQuery({ kind: 'walk', line: 'T1', stopId: '1', planned: '2026-10-26T07:52:00+11:00' }), null);
  assert.equal(rel.relQuery({ kind: 'transit', line: 'T1', stopId: '1' }), null);
  assert.equal(rel.relQuery({ kind: 'transit', line: 'T1', stopId: '1', planned: 'soon' }), null);
  assert.equal(rel.relQuery(null), null);
  assert.equal(rel.relParams([{ line: 'T1', stopId: '1', planned: 'a+b' }, { line: '461', stopId: '2', planned: 'c' }]), 's=T1~1~a%2Bb&s=461~2~c');
});

test('reliability: words only from numbers that add up, never under 5 days', () => {
  assert.equal(rel.relText({ onTime: 9, n: 10, dayType: 'weekday' }), 'Left on time 9 of the last 10 weekdays');
  assert.equal(rel.relText({ onTime: 5, n: 5, dayType: 'weekend' }), 'Left on time 5 of the last 5 weekend days');
  assert.equal(rel.relText({ onTime: 3, n: 4, dayType: 'weekday' }), null);
  assert.equal(rel.relText({ onTime: 11, n: 10, dayType: 'weekday' }), null);
  assert.equal(rel.relText({ onTime: 2.5, n: 10, dayType: 'weekday' }), null);
  assert.equal(rel.relText(null), null);
  assert.equal(rel.relText(undefined), null);
  assert.equal(rel.relText({ n: 10, dayType: 'weekday', text: 'Always on time' }), null, 'server words alone are not shown');
});

test('last way home: the last service tonight is the one before the night gap', () => {
  // 11:10pm, 11:40pm, 12:20am, then 4:50am: the 12:20am is the last one tonight.
  const deps = [syd(25, 23, 10), syd(25, 23, 40), syd(26, 0, 20), syd(26, 4, 50)];
  assert.equal(lh.lastTonightIndex(deps), 2);
  assert.equal(lh.lastTonightIndex([deps[3], deps[0], deps[2], deps[1]]), 2, 'any order, index in the list given');
  assert.equal(lh.lastTonightIndex(deps.slice(0, 3)), -1, 'no later service listed: not proven');
  // A daytime gap of 3 hours is not the night.
  assert.equal(lh.lastTonightIndex([syd(26, 10, 0), syd(26, 14, 0)]), -1);
  assert.equal(lh.lastTonightIndex([]), -1);
});

test('last way home: room for a reminder and the mode to ask for', () => {
  const now = syd(25, 22, 0);
  assert.equal(lh.canRemind(now + 30 * MIN, now), true);
  assert.equal(lh.canRemind(now + 16 * MIN, now), false);
  assert.equal(lh.canRemind(now - 5 * MIN, now), false);
  assert.equal(lh.canRemind(now + 9 * H, now), false);
  assert.equal(lh.canRemind(NaN, now), false);
  assert.equal(lh.modeOfLegs([{ kind: 'walk' }, { kind: 'transit', mode: 'train' }, { kind: 'transit', mode: 'metro' }]), 'train');
  assert.equal(lh.modeOfLegs([{ kind: 'transit', mode: 'bus' }, { kind: 'transit', mode: 'bus' }]), 'bus');
  assert.equal(lh.modeOfLegs([{ kind: 'transit', mode: 'train' }, { kind: 'transit', mode: 'bus' }]), null);
  assert.equal(lh.modeOfLegs([{ kind: 'walk' }]), null);
});

const item = (o = {}) => ({ id: 'a', from: { id: '200060', name: 'Central Station' }, to: { id: '215020', name: 'Parramatta Station' }, mode: 'train', serviceMode: 'train', lead: 15,
  leave: new Date(syd(26, 0, 14)).toISOString(), board: new Date(syd(26, 0, 14)).toISOString(), remindAt: new Date(syd(25, 23, 59)).toISOString(),
  line: 'T1', stop: 'Central', platform: 'Platform 16', changedFrom: null, status: 'waiting', leaveText: '12:14am', remindText: '11:59pm', ...o });

test('last way home: what the phone says after Remind me, per platform, plainly', () => {
  assert.equal(lh.setNote(item(), 'ios', { web: 0, expo: 1 }), 'Reminder set. One notification at 11:59pm, 15 min before the 12:14am. It checks live times first.');
  assert.match(lh.setNote(item(), 'ios', { web: 0, expo: 0 }), /notifications are off for Transport, so it can only show on Home\.$/);
  assert.equal(lh.setNote(item(), 'android', { web: 0, expo: 0 }), "Reminder set for 11:59pm, 15 min before the 12:14am. This Android version can't get notifications from the server yet, so the reminder shows on Home instead.");
});

test('last way home: the Home card before, at and after the time', () => {
  const before = lh.cardWords(item(), syd(25, 23, 30));
  assert.deepEqual(before, { title: 'Last train to Parramatta', line: 'Leaves 12:14am T1 from Central, Platform 16. Reminder at 11:59pm.', go: false });
  const at = lh.cardWords(item(), syd(26, 0, 2));
  assert.equal(at.go, true);
  assert.equal(at.line, 'Leave in 12 min: 12:14am T1 from Central, Platform 16.');
  assert.match(lh.cardWords(item({ changedFrom: new Date(syd(26, 0, 8)).toISOString() }), syd(25, 23, 30)).line, /Time changed since you set it\.$/);
  assert.equal(lh.cardWords(item(), syd(26, 0, 20)), null, 'gone from Home once it has left');
  assert.equal(lh.cardWords(item({ status: 'gone' }), syd(25, 23, 30)), null);
  assert.equal(lh.cardWords(null, syd(25, 23, 30)), null);
  assert.match(lh.cardWords(item({ status: 'none', text: 'No service from Central to Parramatta shows for the rest of tonight. Open Plan for other ways home.' }), syd(26, 0, 0)).line, /^No service from Central/);
});

test('no dashes in the new screens and libraries', () => {
  for (const f of ['src/lib/reliabilityCore.ts', 'src/lib/reliability.ts', 'src/lib/lastHomeCore.ts', 'src/lib/lastHome.ts', 'src/components/LastHome.tsx']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /[\u2013\u2014]/, f);
  }
});
