// Checks one simulator run (run-sim.sh): what the phone showed over real time (the words on each picture, ocr.jsonl)
// against what the server knew and sent (sim-server.mjs logs) and the trip's truth (truth.json, the reference
// simulator on the same case). A surface whose words do not change while the train's state did is frozen.
//   node sim-check.mjs <run dir>      writes check.json, prints the findings
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
const jl = (f) => read(f).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const truth = JSON.parse(read('server/truth.json') || '{}');
const ocr = jl('ocr.jsonl');
const pushes = jl('server/pushes.jsonl');
const simctl = jl('server/simctl.jsonl');
const reqs = jl('server/requests.jsonl');
const errors = jl('server/errors.jsonl');
const timeline = read('timeline.txt');
const day = (truth.base ? new Date(truth.base + (truth.start || 0) * 1000) : new Date()).toISOString().slice(0, 10);
const caseT = (ms) => Math.round((ms - truth.base) / 1000);
const hms = (t) => { const h = Math.floor(t / 3600) % 24, m = Math.floor((t % 3600) / 60), s = t % 60; return `${h % 12 || 12}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; };
const VOCAB = /(\b\d{1,2}:\d{2}\s?(am|pm)?\b|\b\d+\s?min\b|\bDue\b|\bNow\b|Get off|Arriv|Next|Leaves|Updated|about|Timetable|Held|\blate\b|\bearly\b|On time|Cancel|Platform|Plat\b|Stand|No live)/i;
const STATUS = /^(\d{1,2}:\d{2}|[\d:]+\s?(AM|PM)?)$/; // the status bar clock

const frames = (truth.frames || []);
const truthAt = (t) => { let best = null; for (const f of frames) { if (f.t <= t) best = f; else break; } return best; };
const shots = ocr.map((o) => {
  const m = o.file.match(/^(\d{2})(\d{2})(\d{2})-(.+)\.png$/);
  const wall = m ? Date.parse(`${day}T${m[1]}:${m[2]}:${m[3]}Z`) : null;
  const t = wall ? caseT(wall) : null;
  const lines = o.lines || [];
  const island = lines.filter((l) => l.y < 0.065 && !STATUS.test(l.t.trim())).map((l) => l.t.trim());
  const ours = lines.filter((l) => VOCAB.test(l.t) && !(l.y < 0.03 && STATUS.test(l.t.trim()))).map((l) => l.t.trim());
  const lock = lines.some((l) => l.y > 0.08 && l.y < 0.3 && l.h > 0.06 && /^\d{1,2}:\d{2}$/.test(l.t.trim()));
  const banner = lines.filter((l) => /Get off now|is next|Arrived at|Held, stay on|running \d+ min|Platform/i.test(l.t)).map((l) => l.t.trim());
  return { file: o.file, name: m ? m[4] : o.file, wall, t, island, ours, lock, banner, tr: t != null ? truthAt(t) : null };
}).filter((s) => s.t != null).sort((a, b) => a.t - b.t);

const out = { dir, case: truth.case, title: truth.title, shots: shots.length, findings: [] };
const add = (sev, what, detail) => out.findings.push({ sev, what, detail });

// the app and the server
const posts = (p) => reqs.filter((r) => r.m === 'POST' && r.p.startsWith(p));
const tripStartT = (() => { const r = reqs.find((x) => x.p.startsWith('/api/trip')); return r ? r.caseT : null; })();
out.app = { tripAsked: !!tripStartT, watch: posts('/api/watch').map((r) => r.s), card: posts('/api/live-activity').map((r) => r.s), apnsDevice: posts('/api/apns/device').map((r) => r.s), expo: posts('/api/push/expo').map((r) => r.s),
  serviceReads: reqs.filter((r) => r.p.startsWith('/api/service')).length, firstReq: reqs[0] ? reqs[0].p : null };
if (!out.app.tripAsked) add('blocker', 'the app never asked the local server for the trip', 'Start trip did not reach the server (link not handled, first-open screen in the way, or TLS not trusted)');
if (!out.app.card.length) add('high', 'the app never sent its Live Activity push token', 'in the simulator the card got no push token (no APNs in the runner) or the app did not send it; the server cannot update the Lock Screen card');
if (!out.app.watch.length) add('high', 'the app never registered the trip watch (server alerts)', 'POST /api/watch never reached the server');
out.server = { pushes: pushes.length, cardPushes: pushes.filter((p) => p.liveActivity).length, alertPushes: pushes.filter((p) => !p.liveActivity && !p.expo).length, expo: pushes.filter((p) => p.expo).length, errors: errors.length,
  simctlOk: simctl.filter((s) => s.ok).length, simctlFailed: simctl.filter((s) => !s.ok).length, simctlFirstError: (simctl.find((s) => !s.ok) || {}).err || null };
if (errors.length) add('critical', 'server errors', errors.slice(0, 3).map((e) => `${e.where}: ${String(e.msg).split('\n')[0]}`).join('; '));
// locked reads: the app's JavaScript reading while it should be suspended
const lockAt = (() => { const m = timeline.match(/(\d{2}):(\d{2}):(\d{2}) (Settings in front|lock keystroke)/); return m ? caseT(Date.parse(`${day}T${m[1]}:${m[2]}:${m[3]}Z`)) : null; })();
out.lockAt = lockAt;
if (lockAt != null) out.app.serviceReadsWhileLocked = reqs.filter((r) => r.caseT > lockAt + 30 && r.p.startsWith('/api/service')).length;

// surfaces over time while locked
const locked = shots.filter((s) => lockAt != null && s.t > lockAt + 10 && !/reopened/.test(s.name));
const sig = (s) => [...s.island, ...s.ours].join(' | ');
let runStart = null, worst = { len: 0 }, prev = null;
for (const s of locked) {
  const k = sig(s);
  if (prev && k === prev.k && k) { if (!runStart) runStart = prev.s; const len = s.t - runStart.t; const changes = frames.filter((f) => f.t > runStart.t && f.t <= s.t).reduce((n, f, i, a) => n + (i && (a[i - 1].phase !== f.phase || a[i - 1].status !== f.status) ? 1 : 0), 0); if (len > worst.len) worst = { len, from: runStart.t, to: s.t, words: k, truthChanges: changes }; }
  else runStart = null;
  prev = { k, s };
}
out.frozen = worst;
if (worst.len >= 180 && worst.truthChanges >= 1) add('critical', 'a locked surface froze', `from ${hms(worst.from)} to ${hms(worst.to)} (${Math.round(worst.len / 60)} min) the phone showed "${worst.words}" while the trip changed ${worst.truthChanges} times`);
const withOurs = locked.filter((s) => s.ours.length || s.island.length).length;
out.lockedShots = locked.length; out.lockedShotsWithTripWords = withOurs;
if (locked.length && !withOurs) add('critical', 'nothing of the trip on the locked phone', `${locked.length} pictures while locked/in the background and none shows the trip (no Live Activity, no Island)`);
// does the phone follow the truth: the truth's status words (minute and phase) seen in the pictures
let match = 0, checked = 0; const misses = [];
for (const s of locked) {
  if (!s.tr || !s.tr.status) continue;
  checked++;
  const want = (s.tr.status.match(/\d{1,2}:\d{2}\s?(am|pm)|Get off now|Arrived|Next: \w+|Due/i) || [null])[0];
  const text = [...s.island, ...s.ours, ...s.banner].join(' ');
  if (want && text.toLowerCase().includes(want.toLowerCase().replace(/\s+/g, ''))) match++; else if (want) misses.push(`${hms(s.t)}: truth "${s.tr.status}", phone "${text.slice(0, 120)}"`);
}
out.followsTruth = { checked, match };
if (checked && match / checked < 0.6) add('high', 'the locked phone does not show the live state', `${match} of ${checked} locked pictures show the truth's time or phase; e.g. ${misses.slice(0, 3).join('; ')}`);
// alerts seen as banners
out.banners = shots.filter((s) => s.banner.length).map((s) => `${hms(s.t)} ${s.banner.join(' / ')}`);
out.rings = truth.rings;
fs.writeFileSync(path.join(dir, 'check.json'), JSON.stringify(out, null, 1));
console.log(`${out.case}: ${shots.length} pictures (${locked.length} locked), app ${JSON.stringify(out.app)}, server ${JSON.stringify(out.server)}`);
console.log(`frozen longest: ${worst.len ? `${Math.round(worst.len / 60)} min "${worst.words}" (truth changed ${worst.truthChanges}x)` : 'none'}; follows truth ${match}/${checked}`);
for (const f of out.findings) console.log(`  [${f.sev}] ${f.what}: ${f.detail}`);
for (const b of out.banners.slice(0, 12)) console.log('  banner ' + b);
