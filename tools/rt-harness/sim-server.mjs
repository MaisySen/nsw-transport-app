// The local server for real-time trips in the iOS Simulator (rt-sim.yml): the real worker.js (any server checkout)
// served over HTTPS as api.transportsydney.app (the runner's /etc/hosts points the name here and the simulator trusts
// the run's own certificate authority), on the wall clock, with its minute cron, replaying one journey case's feeds
// shifted so the train leaves a few minutes after start. Every push the server sends Apple is written to
// pushes.jsonl and handed to the simulator with `xcrun simctl push` (alerts, and Live Activity updates and ends with
// apns-push-type liveactivity). Failure windows (case-relative minutes) can be injected like scenario.mjs.
//   node tools/rt-harness/sim-server.mjs --server <checkout> --case S1 --out <dir> [--port 443 --cert c.pem --key k.pem]
//        [--lead 300] [--sim <udid> --bundle com.maisysen.nswtransport] [--faults '[{"from":"+6","to":"+9","nsw":"500"}]']
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const SERVER = path.resolve(opt('server', repo));
const CASE = opt('case', 'S1');
const OUT = path.resolve(opt('out', '/tmp/rt-sim'));
const PORT = Number(opt('port', 8787));
const LEAD = Number(opt('lead', 300));
const SIM = opt('sim', null);
const BUNDLE = opt('bundle', 'com.maisysen.nswtransport');
const FAULTS = JSON.parse(opt('faults', '[]'));
fs.mkdirSync(OUT, { recursive: true });

const { caseOf } = await import('./journeys.mjs');
const { caseNet, caseFeed, caseBoard, platformId, stationId } = await import('./feed.mjs');
const { simulate, hms } = await import('../../app/sim/journeySim.mjs');
const { loadWorker, makeEnv, makeExec } = await import('./server.mjs');

const c = caseOf(CASE);
const net = caseNet(c);
const P = net.P;
// the case's clock: its Start trip moment is LEAD seconds from now; ms of case second s = BASE + s*1000
const T0 = Date.now();
const BASE = T0 + LEAD * 1000 - P.start * 1000;
const caseS = (ms) => (ms - BASE) / 1000;
const iso = (s) => new Date(BASE + s * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const log = (file, o) => fs.appendFileSync(path.join(OUT, file), JSON.stringify({ wall: new Date().toISOString(), caseT: Math.round(caseS(Date.now())), ...o }) + '\n');
const windows = FAULTS.map((f) => ({ ...f, a: BASE + (P.start + Number(String(f.from).replace('+', '')) * 60) * 1000, b: f.to ? BASE + (P.start + Number(String(f.to).replace('+', '')) * 60) * 1000 : Infinity }));
const fault = (k, t) => windows.find((w) => w[k] && t >= w.a && t < w.b) || null;

// The Trip Planner answer for the case's journey (EFA rapidJSON, the shape backend/test/helpers/efa.mjs builds).
function efaJourney(tS) {
  const snap = (() => { try { return caseFeedSnapshot(tS); } catch { return null; } })();
  const legs = P.legs.filter((l) => !l.alt).map((leg, li) => {
    const L = snap && snap.legs[li];
    const est = (i) => (L && L.est && L.est[i] != null ? L.est[i] : L && L.runDelay != null ? leg.stops[i].tt + L.runDelay : null);
    const stopRef = (i) => {
      const s = leg.stops[i];
      const nm = s.name.replace(/,.*$/, '');
      const id = i === 0 ? platformId(s.name, leg) : stationId(s.name);
      const plat = leg.mode === 'bus' ? (i === 0 ? leg.stand || 'Stand A' : null) : i === 0 ? 'Platform ' + leg.platform : 'Platform 1';
      return { id, name: (leg.mode === 'bus' ? nm : nm + ' Station') + (plat ? ', ' + plat : ''), disassembledName: nm, type: 'platform', parent: { id: stationId(s.name), name: leg.mode === 'bus' ? nm : nm + ' Station', type: 'stop' },
        coord: [-33.8 - i * 0.01, 151 + i * 0.01], properties: plat ? { platformName: plat } : {},
        departureTimePlanned: iso(s.tt), arrivalTimePlanned: iso(s.tt), ...(est(i) != null ? { departureTimeEstimated: iso(est(i)), arrivalTimeEstimated: iso(est(i)) } : {}) };
    };
    const seq = leg.stops.map((_, i) => stopRef(i));
    const o = seq[0], d = seq[seq.length - 1];
    return {
      duration: leg.stops[leg.off].tt - leg.stops[0].tt, isRealtimeControlled: est(0) != null,
      origin: { ...o, arrivalTimePlanned: undefined, arrivalTimeEstimated: undefined },
      destination: { ...d, departureTimePlanned: undefined, departureTimeEstimated: undefined },
      transportation: { id: 'nsw:' + leg.line, name: (leg.mode === 'bus' ? 'Bus ' : 'Train ') + leg.line, disassembledName: leg.line, number: leg.line, description: 'Sample line',
        product: { class: leg.mode === 'bus' ? 5 : 1, name: leg.mode === 'bus' ? 'Bus' : 'Sydney Trains Network', iconId: leg.mode === 'bus' ? 5 : 1 },
        destination: { id: 'SIM_dest', name: 'Sample terminus' }, properties: { RealtimeTripId: leg.tripId, tripCode: li } },
      stopSequence: seq, infos: [], coords: seq.map((x) => x.coord),
    };
  });
  return { version: '10.2.1.42', journeys: [{ rating: 0, isAdditional: false, interchanges: legs.length - 1, legs }] };
}
const { snapshot } = await import('../../app/sim/journeySim.mjs');
const caseFeedSnapshot = (tS) => snapshot(P, tS);

// ---- outside calls the worker makes ----
const realFetch = globalThis.fetch;
const pushes = [];
function simPush(p) {
  if (!SIM) return;
  const file = path.join(OUT, `push-${pushes.length}.apns`);
  const body = { ...(p.body || {}), 'Simulator Target Bundle': BUNDLE };
  fs.writeFileSync(file, JSON.stringify(body));
  // Live Activity pushes go to the activity's own topic; simctl takes the bundle id and the payload.
  // simctl push takes the app's bundle id and the payload; whether the simulator applies a Live Activity update (event,
  // content-state) given this way is part of what the run finds out, so the result of each push is logged.
  const a = ['simctl', 'push', SIM, BUNDLE, file];
  execFile('xcrun', a, { timeout: 20000 }, (err, so, se) => log('simctl.jsonl', { n: p.n, la: !!p.liveActivity, cmd: a.join(' '), ok: !err, out: String(so || '').slice(0, 300), err: String(se || err || '').slice(0, 300) }));
}
globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  if (url instanceof Request && !init.body) init = { method: url.method, headers: url.headers, body: await url.text().catch(() => undefined), signal: url.signal };
  const t = Date.now();
  if (u.startsWith('https://api.transport.nsw.gov.au/')) {
    const f = fault('nsw', t);
    if (f) { log('faults.jsonl', { nsw: f.nsw, u: u.slice(31, 120) }); if (/^\d+$/.test(f.nsw)) return new Response('err', { status: Number(f.nsw) }); if (f.nsw === 'down') throw new TypeError('fetch failed'); }
    const tS = Math.floor(caseS(t));
    const p = new URL(u);
    if (p.pathname.includes('/gtfs/')) return new Response(Buffer.from(caseFeed(net, BASE, tS, p.pathname.includes('/vehiclepos/') ? 'vp' : 'tu', { allTimes: true })), { status: 200, headers: { 'content-type': 'application/x-google-protobuf' } });
    if (p.pathname.includes('/tp/departure_mon')) { const id = p.searchParams.get('name_dm'); return new Response(JSON.stringify({ locations: [{ id, name: 'Sample stop', type: 'stop' }], stopEvents: caseBoard(net, BASE, tS, id) }), { status: 200 }); }
    if (p.pathname.includes('/tp/trip')) return new Response(JSON.stringify(efaJourney(tS)), { status: 200 });
    if (p.pathname.includes('/tp/stop_finder')) {
      const q = (p.searchParams.get('name_sf') || '').toLowerCase();
      const locs = Object.entries(net.names).filter(([id, v]) => !q || id.toLowerCase().includes(q) || String(v[0]).toLowerCase().includes(q)).slice(0, 10)
        .map(([id, v]) => ({ id, name: v[0], disassembledName: v[0], type: 'stop', coord: [v[1], v[2]], matchQuality: 900, isBest: true, modes: [1, 5] }));
      return new Response(JSON.stringify({ locations: locs }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }
  if (/^https:\/\/api(\.sandbox|\.development)?\.push\.apple\.com\//.test(u)) {
    const h = {}; const hh = init.headers || {}; if (hh instanceof Headers) hh.forEach((v, k) => (h[k.toLowerCase()] = v)); else for (const [k, v] of Object.entries(hh)) h[k.toLowerCase()] = v;
    let body = null; try { body = JSON.parse(init.body); } catch {}
    const p = { n: pushes.length, token: u.split('/3/device/')[1], topic: h['apns-topic'], pushType: h['apns-push-type'], priority: h['apns-priority'], liveActivity: /liveactivity$/.test(h['apns-topic'] || ''), body };
    const f = fault('apns', t);
    pushes.push(p);
    log('pushes.jsonl', { ...p, status: f ? f.apns : 200 });
    if (f) return new Response(JSON.stringify({ reason: 'InternalServerError' }), { status: Number(f.apns) || 500 });
    simPush(p);
    return new Response(null, { status: 200, headers: { 'apns-id': 'rt-' + p.n } });
  }
  if (u.startsWith('https://exp.host/')) {
    let msgs = []; try { msgs = JSON.parse(init.body); } catch {}
    if (!Array.isArray(msgs)) msgs = [msgs];
    for (const m of msgs) { log('pushes.jsonl', { expo: true, title: m.title, body: m.body }); simPush({ n: 'expo-' + pushes.length, body: { aps: { alert: { title: m.title, body: m.body }, sound: 'default' } } }); }
    return new Response(JSON.stringify({ data: msgs.map(() => ({ status: 'ok', id: 'rt' })) }), { status: 200 });
  }
  log('other.jsonl', { u: u.slice(0, 160) });
  return new Response('{}', { status: 503 });
};

const W = await loadWorker(SERVER);
const env = makeEnv(SERVER, net.names, { tripflow2: true, getOffPush: true, liveStops: true, apnsAlerts: true }, Date.now());

// ---- the truth over time (the reference simulator on the same case), for the screenshot checks ----
const ref = simulate(c);
fs.writeFileSync(path.join(OUT, 'truth.json'), JSON.stringify({ case: CASE, title: c.title, base: BASE, start: P.start, end: P.end,
  legs: P.legs.map((l) => ({ line: l.line, mode: l.mode, stops: l.stops.map((s) => ({ name: s.name, tt: s.tt })) })),
  frames: ref.frames.filter((f) => f.t % 10 === 0).map((f) => ({ t: f.t, wall: new Date(BASE + f.t * 1000).toISOString(), phase: f.tripPhase, status: f.card && f.card.status, island: f.card && f.card.island, timer: f.card && f.card.timer })),
  rings: ref.rings.map((r) => ({ t: r.t, wall: new Date(BASE + r.t * 1000).toISOString(), kind: r.kind, title: r.title })) }, null, 1));

// The link that starts this trip in the app (Next trip widget Start button, Siri): from and to of the case.
const first = P.legs[0], last = P.legs.filter((l) => !l.alt).slice(-1)[0];
const nm = (s, leg) => s.replace(/,.*$/, '') + (leg.mode === 'bus' ? '' : '');
const link = `nswtransport://trip?from=${encodeURIComponent(stationId(first.stops[0].name))}&fromName=${encodeURIComponent(nm(first.stops[0].name, first))}&to=${encodeURIComponent(stationId(last.stops[last.off].name))}&toName=${encodeURIComponent(nm(last.stops[last.off].name, last))}&start=1`;
fs.writeFileSync(path.join(OUT, 'start-link.txt'), link + '\n');

// ---- HTTP(S) ----
async function handle(req, res) {
  const chunks = []; for await (const ch of req) chunks.push(ch);
  const body = Buffer.concat(chunks);
  const t0 = Date.now();
  const f = fault('server', t0);
  if (f) { res.writeHead(503); res.end('down'); log('requests.jsonl', { m: req.method, p: req.url.slice(0, 200), s: 503, injected: true }); return; }
  const r = new Request('https://api.transportsydney.app' + req.url, { method: req.method, headers: req.headers, ...(body.length && req.method !== 'GET' && req.method !== 'HEAD' ? { body } : {}) });
  const exec = makeExec();
  let out;
  try { out = await W.__default.fetch(r, env, exec); } catch (e) { out = new Response('error', { status: 500 }); log('errors.jsonl', { where: req.url, msg: String(e && e.stack || e).slice(0, 500) }); }
  const buf = Buffer.from(await out.arrayBuffer());
  const hdrs = {}; out.headers.forEach((v, k) => { if (k !== 'content-encoding' && k !== 'content-length') hdrs[k] = v; });
  res.writeHead(out.status, hdrs); res.end(buf);
  Promise.all([...exec.pending]).catch(() => null);
  log('requests.jsonl', { m: req.method, p: req.url.slice(0, 300), s: out.status, ms: Date.now() - t0, ...(req.method === 'POST' ? { body: body.toString('utf8').slice(0, 1500) } : {}) });
}
const tls = opt('cert', null) ? { cert: fs.readFileSync(opt('cert')), key: fs.readFileSync(opt('key')) } : null;
const srv = tls ? https.createServer(tls, handle) : http.createServer(handle);
srv.listen(PORT, '0.0.0.0', () => console.log(`rt sim-server ${tls ? 'https' : 'http'} on ${PORT}, case ${CASE}, Start trip at ${new Date(BASE + P.start * 1000).toISOString()}, link ${link}`));

// ---- the minute cron, as Cloudflare runs it ----
(async () => {
  for (;;) {
    const next = Math.ceil((Date.now() + 1) / 60000) * 60000;
    await new Promise((r) => setTimeout(r, next - Date.now()));
    if (fault('server', next)) { log('cron.jsonl', { skipped: 'server down' }); continue; }
    if (W.serverCfg) W.serverCfg.at = 0;
    const exec = makeExec(); const r0 = Date.now();
    try { await W.__default.scheduled({ scheduledTime: next, cron: '* * * * *' }, env, exec); } catch (e) { log('errors.jsonl', { where: 'scheduled', msg: String(e && e.stack || e).slice(0, 500) }); }
    Promise.all([...exec.pending]).then(() => log('cron.jsonl', { ms: Date.now() - r0 }));
    if (caseS(Date.now()) > P.end + 300) { log('cron.jsonl', { done: true }); }
  }
})();
process.on('unhandledRejection', (e) => log('errors.jsonl', { where: 'unhandledRejection', msg: String(e && e.stack || e).slice(0, 500) }));
