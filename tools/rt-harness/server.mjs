// The real server (backend/src/worker.js of any checkout) loaded in this process, on node:sqlite as its D1, with
// every outside call it makes (Transport for NSW, Apple, Expo, Cloudflare) answered by the harness network
// (net.mjs). The Cron Trigger is driven once a minute exactly as Cloudflare does: scheduled() is called and NOT
// awaited, so a long pass overlaps the next one as it can in production.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeD1 } from './d1.mjs';

const WANT = ['tfPass', 'tfPassStep', 'serverCfg', 'TF', 'LIVECARD', 'laPasses', 'runTick', 'TF_PASS_MAX'];

export async function loadWorker(serverDir) {
  const backend = path.join(serverDir, 'backend');
  const raw = fs.readFileSync(path.join(backend, 'src/worker.js'), 'utf8').replace(/export default\s*\{/, 'const __default = {');
  const have = WANT.filter((n) => new RegExp('\\n(?:async )?(?:function|const|let) ' + n + '\\b').test(raw));
  const src = raw + '\nexport { __default, ' + have.join(', ') + ' };\n';
  const tmp = path.join(backend, 'src', `.rt-${process.pid}-${Date.now() % 100000}.mjs`);
  fs.writeFileSync(tmp, src);
  try { return await import(tmp); } finally { fs.unlinkSync(tmp); }
}

/** A fresh env: D1 with the server's migrations, the switches, a throwaway Apple key, stop names for the sample stops. */
export function makeEnv(serverDir, names, flags, nowMs) {
  const backend = path.join(serverDir, 'backend');
  const DB = makeD1();
  for (const f of fs.readdirSync(path.join(backend, 'migrations')).sort()) DB.sql.exec(fs.readFileSync(path.join(backend, 'migrations', f), 'utf8'));
  try { DB.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)'); } catch {}
  DB.sql.exec('CREATE TABLE IF NOT EXISTS app_config (platform TEXT PRIMARY KEY, body TEXT NOT NULL, at INTEGER)');
  DB.sql.prepare("INSERT OR REPLACE INTO app_config (platform, body, at) VALUES ('server', ?, ?)").run(JSON.stringify({ flags }), nowMs);
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pub = path.join(backend, 'src', 'public');
  const ASSETS = { fetch: async (rq) => {
    const pn = new URL(rq.url).pathname;
    const m = pn.match(/^\/stops\/(.+)\.json$/);
    if (!m) {
      // the server's own published files (station lists the app reads at /stations/*.json), as the site serves them
      const f = path.join(pub, path.normalize(pn).replace(/^(\.\.[/\\])+/, ''));
      if (f.startsWith(pub) && fs.existsSync(f) && fs.statSync(f).isFile()) return new Response(fs.readFileSync(f), { headers: { 'content-type': f.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
      return new Response('{}', { status: 404 });
    }
    const shard = {};
    for (const [id, v] of Object.entries(names)) if (id.slice(0, 3).replace(/[^A-Za-z0-9]/g, '_') === m[1]) shard[id] = v;
    return new Response(JSON.stringify(shard), { headers: { 'content-type': 'application/json' } });
  } };
  return { DB, ASSETS, APNS_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }), APNS_KEY_ID: 'RTHARNESS1', APNS_TEAM_ID: 'RTHARNESS1',
    APNS_BUNDLE: ['com', 'maisy' + 'sen', 'nswtransport'].join('.'), TFNSW_API_KEY: 'fake-local-key', ADMIN_KEY: 's'.repeat(24), API_ONLY: '1' };
}

export function makeExec() {
  const pending = new Set();
  return {
    pending,
    waitUntil(p) { const q = Promise.resolve(p).catch(() => null); pending.add(q); q.finally(() => pending.delete(q)); },
    passThroughOnException() {},
  };
}

/** One HTTP call to the worker as the phone makes it. */
export async function call(W, env, method, p, body, device, extra) {
  const exec = makeExec();
  const t0 = performance.now();
  const res = await W.__default.fetch(new Request('https://api.transportsydney.app' + p, { method, headers: { 'content-type': 'application/json', ...(device ? { 'x-device': device } : {}), ...(extra || {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, exec);
  const msAnswer = performance.now() - t0;
  let j = null; try { j = await res.json(); } catch {}
  // The phone has its answer now; work the server handed to waitUntil goes on after it (1 Nov: the harness waited
  // for that work too, so a server answering at once and reading afterwards still timed out on the phone).
  const after = Promise.all([...exec.pending]);
  return { status: res.status, body: j, ms: msAnswer, after };
}
