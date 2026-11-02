// Checks one Android emulator run (run-emu.sh): the app's own notifications over real time (the ongoing trip
// notification is the Android Lock Screen surface) against the trip's truth and what the server sent.
//   node android-check.mjs <run dir>
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
const jl = (f) => read(f).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const truth = JSON.parse(read('server/truth.json') || '{}');
const reqs = jl('server/requests.jsonl');
const pushes = jl('server/pushes.jsonl');
const day = truth.base ? new Date(truth.base + truth.start * 1000).toISOString().slice(0, 10) : '';
const caseT = (ms) => Math.round((ms - truth.base) / 1000);
const hms = (t) => { const h = Math.floor(t / 3600) % 24, m = Math.floor((t % 3600) / 60), s = t % 60; return `${h % 12 || 12}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; };
// notification lines grouped per sample: "HH:MM:SS tag   android.title=..."
const samples = new Map();
for (const l of read('notifications.txt').split('\n')) {
  const m = l.match(/^(\d{2}:\d{2}:\d{2}) (\S+)\s+(.*)$/); if (!m) continue;
  const k = m[1] + ' ' + m[2]; const s = samples.get(k) || { wall: Date.parse(`${day}T${m[1]}Z`), tag: m[2], lines: [] }; s.lines.push(m[3].trim()); samples.set(k, s);
}
const list = [...samples.values()].map((s) => ({ ...s, t: caseT(s.wall), text: s.lines.filter((x) => /android\.(title|text|bigText|subText)=/.test(x)).map((x) => x.replace(/^android\.\w+=/, '').replace(/^String \((.*)\)$/, '$1')).join(' | ') })).sort((a, b) => a.t - b.t);
const out = { case: truth.case, samples: list.length, findings: [] };
const add = (sev, what, detail) => out.findings.push({ sev, what, detail });
const posts = (p) => reqs.filter((r) => r.m === 'POST' && r.p.startsWith(p)).map((r) => r.s);
out.app = { tripAsked: reqs.some((r) => r.p.startsWith('/api/trip')), watch: posts('/api/watch'), expo: posts('/api/push/expo'), serviceReads: reqs.filter((r) => r.p.startsWith('/api/service')).length };
const lockLine = read('timeline.txt').match(/(\d{2}:\d{2}:\d{2}) screen off/);
const lockT = lockLine ? caseT(Date.parse(`${day}T${lockLine[1]}Z`)) : null;
out.app.serviceReadsScreenOff = lockT != null ? reqs.filter((r) => r.caseT > lockT + 30 && r.p.startsWith('/api/service')).length : null;
out.server = { expoAlerts: pushes.filter((p) => p.expo).length, note: 'Expo pushes cannot reach the emulator (no push credentials on the runner); they are listed, not delivered' };
if (!out.app.tripAsked) add('blocker', 'the app never asked the local server for the trip', 'the Start link did not reach the server (TLS, hosts, or the link not handled)');
const off = list.filter((s) => lockT != null && s.t > lockT + 20);
let worst = { len: 0 }, run = null, prev = null;
for (const s of off) { if (prev && s.text && s.text === prev.text) { run = run || prev; const len = s.t - run.t; if (len > worst.len) worst = { len, from: run.t, to: s.t, text: s.text }; } else run = null; prev = s; }
out.frozen = worst;
const changes = (a, b) => (truth.frames || []).filter((f) => f.t > a && f.t <= b).reduce((n, f, i, arr) => n + (i && arr[i - 1].status !== f.status ? 1 : 0), 0);
if (worst.len >= 180 && changes(worst.from, worst.to) > 0) add('critical', 'the trip notification froze with the screen off', `from ${hms(worst.from)} to ${hms(worst.to)} it said "${worst.text.slice(0, 160)}" while the trip changed ${changes(worst.from, worst.to)} times`);
if (off.length && !off.some((s) => s.text)) add('critical', 'no trip notification with the screen off', `${off.length} reads, none from the app`);
out.timeline = list.map((s) => `${hms(s.t)} [${s.tag}] ${s.text.slice(0, 200)}`);
fs.writeFileSync(path.join(dir, 'check.json'), JSON.stringify(out, null, 1));
console.log(`${out.case}: ${list.length} notification reads, app ${JSON.stringify(out.app)}, frozen longest ${Math.round((worst.len || 0) / 60)} min`);
for (const f of out.findings) console.log(`  [${f.sev}] ${f.what}: ${f.detail}`);
for (const l of out.timeline.slice(0, 40)) console.log('  ' + l);
