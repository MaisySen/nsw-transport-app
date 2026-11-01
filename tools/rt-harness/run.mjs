// One command for the whole real-time harness: every scenario in its own process (parallel), then the bug list.
//   node tools/rt-harness/run.mjs --server <checkout with backend/> [--speed 30] [--jobs 6] [--only S1,F-NSW500]
//        [--out dir] [--known tools/rt-harness/known-bugs.json]
// Exit code: 0 when every failed check is listed in --known (CI keeps known bugs visible without going red on
// them), 1 when a check failed that is not known, 2 on a harness error. Without --known any failed check exits 1.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const SERVER = path.resolve(opt('server', process.env.RT_SERVER || path.resolve(here, '../..')));
const SPEED = opt('speed', '30');
const JOBS = Number(opt('jobs', Math.max(2, Math.min(8, os.cpus().length - 1))));
const ONLY = opt('only', null);
const OUT = path.resolve(opt('out', fs.mkdtempSync(path.join(os.tmpdir(), 'rt-harness-'))));
const KNOWN = opt('known', null);
fs.mkdirSync(OUT, { recursive: true });
const list = SCENARIOS.filter((s) => !ONLY || ONLY.split(',').includes(s.id));

function one(s) {
  return new Promise((resolve) => {
    const file = path.join(OUT, s.id + '.json');
    const p = spawn(process.execPath, ['--no-warnings', path.join(here, 'scenario.mjs'), s.id, '--server', SERVER, '--speed', SPEED, '--out', file], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let o = '', e = '';
    p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (e += d));
    // A scenario is a 10 to 40 min trip at --speed; one still running after 4x that has stopped moving: a call into
    // the server that never returns (as a corrupt feed did, F-NSWGARBAGE) is reported as a server hang, not a harness error.
    const limitMs = Math.max(4 * 60000, 4 * (45 * 60000) / Number(SPEED));
    let hung = false;
    const kill = setTimeout(() => { hung = true; p.kill('SIGKILL'); }, limitMs);
    p.on('close', (code) => { clearTimeout(kill); process.stdout.write(o); let r = null; try { r = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      if (!r && hung) r = { checks: [{ id: 'server-no-hang', ok: false, sev: 'critical', detail: `the run stopped moving and was stopped after ${Math.round(limitMs / 60000)} min: a server call never returned (the CPU stayed busy), so no pass, push or answer after that` }], apns: [], expo: [], nsw: { calls: 0 }, passes: [], wallS: Math.round(limitMs / 1000) };
      resolve({ s, code, r, err: r ? '' : (e || o).slice(-1500) }); });
  });
}
const t0 = Date.now();
const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(JOBS, list.length) }, async () => { while (next < list.length) results.push(await one(list[next++])); }));

// group failed checks into bugs: the same check failing in several scenarios is one bug with several repros
const bugs = new Map();
const broken = [];
for (const { s, r, err } of results) {
  if (!r) { broken.push({ id: s.id, err }); continue; }
  for (const c of r.checks.filter((x) => !x.ok)) {
    const key = c.id.replace(/-leg\d+$/, '');
    const b = bugs.get(key) || { check: key, sev: c.sev, runs: [] };
    if (['critical', 'high', 'medium', 'low'].indexOf(c.sev) < ['critical', 'high', 'medium', 'low'].indexOf(b.sev)) b.sev = c.sev;
    b.runs.push({ scenario: s.id, title: s.title, detail: c.detail });
    bugs.set(key, b);
  }
}
const order = { critical: 0, high: 1, medium: 2, low: 3 };
const bugList = [...bugs.values()].sort((a, b) => order[a.sev] - order[b.sev] || b.runs.length - a.runs.length);
const summary = { at: new Date().toISOString(), server: SERVER, speed: Number(SPEED), wallS: Math.round((Date.now() - t0) / 1000), scenarios: results.length, broken, bugs: bugList,
  runs: results.filter((x) => x.r).map(({ s, r }) => ({ id: s.id, title: s.title, ok: r.checks.filter((c) => c.ok).length, failed: r.checks.filter((c) => !c.ok).map((c) => c.id), apns: r.apns.length, expo: r.expo.length, nsw: r.nsw.calls, wallS: r.wallS, maxPassRealMs: Math.max(0, ...r.passes.map((p) => p.realMs || 0)) })) };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(`\n${results.length} scenarios in ${summary.wallS}s, ${broken.length} broken runs, ${bugList.length} failing checks:`);
for (const b of bugList) console.log(`  [${b.sev}] ${b.check} in ${b.runs.length} runs: ${b.runs.map((r) => r.scenario).join(', ')}`);
for (const b of broken) console.log(`  BROKEN ${b.id}: ${b.err.split('\n').slice(-5).join(' | ')}`);
console.log('summary: ' + path.join(OUT, 'summary.json'));
let known = [];
if (KNOWN && fs.existsSync(KNOWN)) known = JSON.parse(fs.readFileSync(KNOWN, 'utf8')).map((k) => k.check + '|' + k.scenario);
const unknown = bugList.flatMap((b) => b.runs.map((r) => b.check + '|' + r.scenario)).filter((k) => !known.includes(k));
process.exit(broken.length ? 2 : unknown.length ? 1 : 0);
