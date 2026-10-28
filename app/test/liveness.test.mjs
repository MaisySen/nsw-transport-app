// Liveness pass (28 Oct, docs/LIVE-LABELS.md "How fresh live is"): a live time is never shown as live once it is
// older than its feed allows. The row's age counts from when the server's feed copy was made (liveAt, LIVE_DATA_AGE),
// the GPS age is not counted twice, a kept copy counts from its own dataAt on the server's clock, and nothing older
// than LIVE_MAX_MS keeps the Live label or the "Live, updated" line.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-liveness-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  js = js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');
const L = await load('src/lib/liveLabelCore.ts');
const B = await load('src/lib/boardCore.ts');
const NOW = Date.parse('2026-10-29T03:10:00Z'); // 2:10pm Sydney
const iso = (m) => new Date(NOW + m * 60000).toISOString();
const sec = (s) => s * 1000;

test('a live time older than LIVE_MAX_MS is never live, however far off the service is', () => {
  assert.equal(L.LIVE_MAX_MS, 300000);
  // 25 minutes away: the near rule (2 min within 10 min) does not apply, the hard limit does.
  const far = (ageS) => L.liveState({ planned: iso(23), estimated: iso(25), realtime: true, seenAt: NOW - sec(ageS) }, NOW);
  assert.equal(far(240).kind, 'live', '4 minutes old, far off: still live with its age');
  assert.equal(far(240).age, '4 min ago');
  const old = far(301);
  assert.equal(old.kind, 'stale');
  assert.equal(old.label, 'Not tracking');
  assert.equal(old.counting, false, 'the timetable clock time, no countdown');
  assert.equal(old.t, Date.parse(iso(23)), 'the timetable time, not the old estimate');
  assert.match(old.a11y, /^Not tracking/);
  // Near services keep the stricter 2 minute rule.
  assert.equal(L.liveState({ planned: iso(4), estimated: iso(5), realtime: true, seenAt: NOW - sec(130) }, NOW).kind, 'stale');
});

test('the GPS age is counted from the answer, not twice, when the row has its own read time (liveLead)', () => {
  // The feed copy was made 60 s before the answer; the vehicle position was 150 s old when the answer was made.
  const base = { planned: iso(6), estimated: iso(7), realtime: true, seenAt: NOW - sec(60), vehicleAgeS: 150 };
  const withLead = L.liveState({ ...base, liveLeadMs: sec(60) }, NOW);
  assert.equal(withLead.kind, 'live', 'GPS 150 s old now: under the 3 minute limit');
  assert.equal(withLead.age, '2 min ago', 'the older of the copy (60 s) and the GPS position (150 s)');
  // Without the lead the old rule counts 150 + 60 = 210 s and says Not tracking.
  assert.equal(L.liveState(base, NOW).kind, 'stale');
  // 40 s later the GPS position is 190 s old: Not tracking.
  assert.equal(L.liveState({ ...base, liveLeadMs: sec(60) }, NOW + sec(40)).kind, 'stale');
  // A lead never makes a row younger than its own read time.
  assert.equal(L.liveAgeMs({ ...base, vehicleAgeS: 0, liveLeadMs: sec(60) }, NOW), sec(60));
});

test('stampSeen gives each row its own read time (liveAt on the server clock) and the lead, never younger than the answer', () => {
  const arrival = NOW;
  // The server clock is 30 s ahead; the feed copy was made 45 s before the server answered; a planner row was read with the answer.
  const r = { now: NOW + 30000, items: [{ realtime: true, liveAt: NOW + 30000 - 45000 }, { realtime: true, liveAt: NOW + 30000 }, { realtime: false, liveAt: null }] };
  L.stampSeen(r, NOW, arrival);
  assert.equal(r.items[0].seenAt, NOW - 45000);
  assert.equal(r.items[0].liveLead, 45000);
  assert.equal(r.items[1].seenAt, NOW);
  assert.equal(r.items[1].liveLead, undefined);
  assert.equal(r.items[2].liveLead, undefined);
  // A board row: the label counts the feed copy's age.
  const rows = B.boardRows([{ ...r.items[0], mode: 'train', line: 'T1', planned: iso(8), estimated: iso(9), dest: 'X' }], NOW + sec(20));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].live, true);
});

test('a kept copy counts from its dataAt on the server clock; over 15 minutes counts as 15; never in the future', () => {
  // Server clock 2 minutes ahead of the phone; the copy was made 90 s before the server sent it.
  assert.equal(L.copyTime({ dataAt: NOW + 120000 - 90000, now: NOW + 120000 }, NOW), NOW - 90000);
  // Without the server's now: dataAt as it is.
  assert.equal(L.copyTime({ dataAt: NOW - 20000 }, NOW), NOW - 20000);
  // 40 minutes old: 15 minutes (it counted as just read before 28 Oct).
  assert.equal(L.copyTime({ dataAt: NOW - 2400000, now: NOW }, NOW), NOW - 900000);
  assert.equal(L.copyTime({ dataAt: NOW + 60000 }, NOW), NOW, 'never in the future');
  assert.equal(L.copyTime({}, NOW), NOW);
  assert.equal(L.copyTime(null, NOW), NOW);
  // The stamp a saved board 6 minutes old gets puts its live rows past LIVE_MAX_MS: Not tracking, not Live.
  const at = L.copyTime({ dataAt: NOW - 360000, now: NOW }, NOW);
  const d = L.stampSeen({ dataAt: NOW - 360000, now: NOW, items: [{ realtime: true, planned: iso(20), estimated: iso(21) }] }, at, NOW);
  assert.equal(L.liveState({ ...d.items[0], seenAt: d.items[0].seenAt }, NOW).kind, 'stale');
});

test('"Updated" keeps an older answer its own time (answerTime); api.ts stamps through copyTime', () => {
  assert.equal(L.answerTime({ seenAt: NOW - 400000 }, NOW), NOW - 400000);
  assert.equal(L.answerTime({ seenAt: NOW + 5000 }, NOW), NOW);
  const api = read('src/lib/api.ts');
  assert.match(api, /export function dataTime\(body: any, now: number\): number \{\s*return copyTime\(body, now\);/);
  assert.match(read('src/lib/features.ts'), /export const LIVE_DATA_AGE = true;/);
});

test('the "Live, updated" line is not said of times older than LIVE_MAX_MS; board and row keys pass the lead', () => {
  const t = read('src/components/Transit.tsx');
  assert.match(t, /export const stampTooOld = \(updatedAt: number \| null \| undefined, now: number\) => updatedAt != null && Number\.isFinite\(updatedAt\) && now - updatedAt > LIVE_MAX_MS;/);
  assert.match(t, /if \(!error && stampTooOld\(updatedAt, Date\.now\(\)\)\)/);
  assert.match(t, /depState = [^\n]*liveLeadMs: d\.liveLead/);
  assert.match(t, /depKey = [^\n]*liveLeadMs: d\.liveLead/);
  assert.match(read('src/lib/boardCore.ts'), /liveLeadMs: d\.liveLead/);
});
