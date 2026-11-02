// One real-time scenario, in its own process: the real server (worker.js) with its minute cron, a phone model that
// receives every push the server sends (trip card, alerts) and runs the app's side on the real trip state engine
// (app/src/lib/tripState.ts through the journey simulator), the "Your trip" widget and the Watch reading what the app
// wrote, and a network that injects the scenario's failures. Everything runs on one accelerated real-time clock.
//   node tools/rt-harness/scenario.mjs <scenario id> --server <checkout dir> [--speed 30] [--out file.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installClock, now, sleepV, untilV, RealDate, speed as clockSpeed } from './clock.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const ID = args[0];
const SERVER = path.resolve(opt('server', process.env.RT_SERVER || repo));
const SPEED = Number(opt('speed', process.env.RT_SPEED || 30));
const OUT = opt('out', null);

const { SCENARIOS } = await import('./scenarios.mjs');
const { caseOf } = await import('./journeys.mjs');
const { caseNet, caseFeed, caseBoard, platformId, stationId } = await import('./feed.mjs');
const { simulate, hms, PHASES } = await import('../../app/sim/journeySim.mjs');
const { makeRealEngine } = await import('../../app/sim/realEngine.mjs');
const { loadWorker, makeEnv, call, makeExec } = await import('./server.mjs');
const { evaluate } = await import('./checks.mjs');

const S = SCENARIOS.find((x) => x.id === ID);
if (!S) { console.error('no scenario ' + ID); process.exit(2); }

// ---- the app's trip state engine (real tripState.ts, transpiled) ----
function typescript() {
  const req = createRequire(import.meta.url);
  for (const p of [process.env.RT_TYPESCRIPT, path.join(repo, 'app/node_modules/typescript'), path.join(repo, 'node_modules/typescript')]) {
    if (p && fs.existsSync(p)) return req(p);
  }
  return req('typescript');
}
const ts = typescript();
const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-ts-'));
fs.writeFileSync(path.join(tdir, 'tripState.mjs'), ts.transpileModule(fs.readFileSync(path.join(repo, 'app/src/lib/tripState.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const tripState = await import(pathToFileURL(path.join(tdir, 'tripState.mjs')).href);
// The app's registration retries (tripRegCore.ts, 1 Nov fixes for harness bugs #2 to #4), when this checkout has them:
// the phone model then runs them (JavaScript while open, the native queue's background upload while locked). Without
// the file the phone does what builds up to 214 do: one try at Start trip, the card token only while the app is open.
const regFile = path.join(repo, 'app/src/lib/tripRegCore.ts');
let REG = null;
if (fs.existsSync(regFile) && process.env.RT_APP_OLD !== '1') {
  fs.writeFileSync(path.join(tdir, 'tripRegCore.mjs'), ts.transpileModule(fs.readFileSync(regFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  REG = await import(pathToFileURL(path.join(tdir, 'tripRegCore.mjs')).href);
}
fs.rmSync(tdir, { recursive: true, force: true });

// ---- the case and its two references ----
const base = caseOf(S.case);
const c = S.mutate ? S.mutate(structuredClone(base)) : base;
const net = caseNet(c);
const P = net.P;
const BASE = RealDate.parse('2026-11-02T00:00:00+11:00'); // a Monday, Sydney midnight
const at = (s) => BASE + hms(s) * 1000;
const sec = (ms) => (ms - BASE) / 1000;
// The phone's own trip state, second by second, on the real engine (what the open app draws and writes).
const appRun = simulate(c, makeRealEngine(tripState));
// The ideal run of the unchanged case (no failures): the truth the locked surfaces are compared with.
const truthRun = S.mutate ? simulate(base, makeRealEngine(tripState)) : appRun;
const frameAt = (run, tS) => { const f = run.frames; const i = Math.max(0, Math.min(f.length - 1, Math.round(tS - f[0].t))); return f[i]; };

// ---- faults ----
const windows = (S.faults || []).map((f) => ({ ...f, a: at(f.from), b: f.to ? at(f.to) : Infinity }));
const fault = (kind, t) => windows.find((w) => w[kind] && t >= w.a && t < w.b) || null;

// the server's request log lines go to the record, not the console
const reqLines = [];
const log0 = console.log;
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('{"t":"req"')) { if (reqLines.length < 5000) reqLines.push(a[0]); return; } log0(...a); };
// ---- the record ----
const rec = { id: S.id, case: S.case, title: S.title, speed: SPEED, server: SERVER, start: P.start, end: P.end,
  nsw: { calls: 0, failed: 0 }, apns: [], expo: [], calls: [], passes: [], errors: [], samples: [], device: [], other: [] };
process.on('unhandledRejection', (e) => rec.errors.push({ t: sec(now()), where: 'unhandledRejection', msg: String(e && e.stack || e).slice(0, 400) }));
process.on('uncaughtException', (e) => rec.errors.push({ t: sec(now()), where: 'uncaughtException', msg: String(e && e.stack || e).slice(0, 400) }));

// ---- clock: start 40 s before Start trip ----
installClock(at(P.start) - 40000, SPEED);

// ---- the phone ----
const DEVICE = 'rtdevice' + String(process.pid).padStart(12, '0');
const LA_TOKEN = (S.laToken || 'b').repeat(64);
const APNS_DEV = 'c'.repeat(64);
const EXPO = 'ExponentPushToken[rtharness' + process.pid + ']';
const phone = {
  app: 'open', online: true, lowPower: false, notif: true, la: true, skewS: 0,
  card: null,          // what the Lock Screen card shows: { src, cs | frame, staleMs, at, sentAt, phase, updatedMs, ended }
  heldLa: null, heldAlert: null,
  notes: [],           // notifications shown
  widget: null,        // SharedLiveCard as written by the app: { at, asOfMs, phase, words }
  widgetReload: null,
  watch: null,         // what the phone last sent the Watch
  laTokenAt: null, laSent: false, laSending: false,
};
const appleDate = (v) => (v == null ? null : Math.round((Number(v) + 978307200) * 1000));
const PH = { wait: 'waiting', waiting: 'waiting', due: 'due', board: 'due', left: 'left', ride: 'onTheWay', onboard: 'onTheWay', next: 'nextStop', nextStop: 'nextStop', getoff: 'getOff', getOff: 'getOff', arrived: 'arrived', ended: 'ended', change: 'change' };
function kindOf(title, body) {
  const t = `${title || ''} ${body || ''}`;
  if (/Get off now/i.test(t)) return 'getoff';
  if (/\bHeld\b/i.test(t)) return 'held';
  if (/is next|coming up/i.test(t)) return 'headsup';
  if (/arrived/i.test(t)) return 'arrived';
  // the end of a leg at a change ("At Redfern: change here") is the change stop's arrival alert
  if (/^At .+: change here/i.test(title || '')) return 'arrived';
  if (/Cancel/i.test(t)) return 'cancelled';
  if (/\b(late|early)\b|delay/i.test(title || '')) return 'delay';
  if (/Platform|Plat /i.test(title || '')) return 'platform';
  if (/\b(late|early)\b|delay/i.test(t)) return 'delay';
  if (/Platform|Plat /i.test(t)) return 'platform';
  if (/Change|miss/i.test(t)) return 'change';
  return 'other';
}
function showNote(n) {
  if (!phone.notif && n.via !== 'card') { rec.device.push({ t: sec(now()), what: 'alert not shown (notifications off)', title: n.title }); return; }
  phone.notes.push({ ...n, shownAt: sec(now()), kind: kindOf(n.title, n.body) });
}
function applyApns(p) {
  const aps = (p.body && p.body.aps) || {};
  if (p.topic && p.topic.endsWith('.push-type.liveactivity')) {
    if (p.token !== LA_TOKEN) return;
    if (!phone.la || !phone.card) { rec.device.push({ t: sec(now()), what: 'card push with no card on the phone' }); return; }
    const cs = aps['content-state'] || {};
    if (aps.event === 'end') phone.card = { ...phone.card, ended: true, dismissMs: (aps['dismissal-date'] || 0) * 1000, endAt: now() };
    else phone.card = { src: 'push', cs, staleMs: aps['stale-date'] ? aps['stale-date'] * 1000 : null, at: now(), sentAt: (aps.timestamp || 0) * 1000, phase: PH[cs.phase] || cs.phase, updatedMs: appleDate(cs.updated), prio: p.priority };
    if (aps.alert) showNote({ title: aps.alert.title, body: aps.alert.body, via: 'card', sound: aps.sound || null, level: aps['interruption-level'] || null });
    return;
  }
  if (p.token && p.token !== APNS_DEV) return; // another phone's
  showNote({ title: aps.alert && aps.alert.title, body: aps.alert && aps.alert.body, via: 'apns', sound: aps.sound || null, level: aps['interruption-level'] || null });
}
function deliverApns(p) {
  if (!phone.online) { if (p.topic && p.topic.endsWith('liveactivity')) phone.heldLa = p; else phone.heldAlert = p; return; }
  applyApns(p);
}
function deliverExpo(m) {
  if (m.to && [].concat(m.to).indexOf(EXPO) < 0) return; // another phone's (the stress phones)
  if (!phone.online) { phone.heldAlert = { body: { aps: { alert: { title: m.title, body: m.body } } } }; return; }
  showNote({ title: m.title, body: m.body, via: 'expo', sound: m.sound || null, level: m.interruptionLevel || null });
}

// ---- the network ----
const hdr = (h) => { const o = {}; if (!h) return o; if (h instanceof Headers) h.forEach((v, k) => (o[k.toLowerCase()] = v)); else for (const [k, v] of Object.entries(h)) o[k.toLowerCase()] = v; return o; };
const hang = (signal, maxMs) => new Promise((_, rej) => {
  const h = setTimeout(() => rej(new TypeError('fetch failed')), maxMs);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(h); rej(signal.reason || new DOMException('aborted', 'AbortError')); });
});
globalThis.fetch = async (url, init = {}) => {
  rec.fetchN = (rec.fetchN || 0) + 1;
  const u = String(url instanceof Request ? url.url : url);
  if (url instanceof Request && !init.body) init = { method: url.method, headers: url.headers, body: await url.text().catch(() => undefined), signal: url.signal };
  const t = now();
  if (u.startsWith('https://api.transport.nsw.gov.au/')) {
    rec.nsw.calls++;
    { const k = new URL(u).pathname.replace(/\/v\d+\//, '/').replace(/[0-9]+/g, '#'); rec.nsw.byPath = rec.nsw.byPath || {}; rec.nsw.byPath[k] = (rec.nsw.byPath[k] || 0) + 1; const dm = new URL(u).searchParams.get('name_dm'); if (!dm || dm.startsWith('SIM_')) rec.nsw.trip = (rec.nsw.trip || 0) + 1; if (dm) { rec.nsw.byStop = rec.nsw.byStop || {}; rec.nsw.byStop[dm] = (rec.nsw.byStop[dm] || 0) + 1; } }
    const f = fault('nsw', t);
    let lag = 0;
    if (f) {
      const k = f.nsw;
      if (/^\d+$/.test(k)) { rec.nsw.failed++; return new Response(k === '429' ? 'Too Many Requests' : 'Server error', { status: Number(k) }); }
      if (k === 'timeout') { rec.nsw.failed++; return hang(init.signal, 60000); }
      if (k === 'garbage') return new Response(Buffer.from([0x0a, 0xff, 0xff, 0xff, 0x0f, 1, 2]), { status: 200, headers: { 'content-type': 'application/x-google-protobuf' } });
      if (k === 'html') return new Response('<html><body>maintenance</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
      if (k.startsWith('slow')) await sleepV(Number(k.slice(4)) * 1000);
      if (k.startsWith('stale')) lag = Number(k.slice(5));
      if (k === 'down') { rec.nsw.failed++; throw new TypeError('fetch failed'); }
    }
    const tS = Math.floor(sec(now())) - lag;
    const p = new URL(u);
    if (p.pathname.includes('/gtfs/')) return new Response(Buffer.from(caseFeed(net, BASE, tS, p.pathname.includes('/vehiclepos/') ? 'vp' : 'tu')), { status: 200, headers: { 'content-type': 'application/x-google-protobuf' } });
    if (p.pathname.includes('/tp/departure_mon')) { const id = p.searchParams.get('name_dm'); return new Response(JSON.stringify({ locations: [{ id, name: 'Sample stop', type: 'stop' }], stopEvents: caseBoard(net, BASE, tS, id) }), { status: 200 }); }
    return new Response('{}', { status: 200 });
  }
  if (/^https:\/\/api(\.sandbox|\.development)?\.push\.apple\.com\//.test(u)) {
    const h = hdr(init.headers);
    let body = null; try { body = JSON.parse(init.body); } catch {}
    const p = { at: sec(t), token: u.split('/3/device/')[1], topic: h['apns-topic'], pushType: h['apns-push-type'], priority: Number(h['apns-priority']) || null, expiration: h['apns-expiration'] || null, body, bytes: (init.body || '').length };
    const f = fault('apns', t);
    if (f) {
      p.status = f.apns;
      rec.apns.push(p);
      if (f.apns === 'timeout') return hang(init.signal, 60000);
      const reason = { 410: 'Unregistered', 403: 'ExpiredProviderToken', 429: 'TooManyRequests', 500: 'InternalServerError', 503: 'ServiceUnavailable', 400: 'BadDeviceToken' }[f.apns] || 'Error';
      return new Response(JSON.stringify({ reason, ...(f.apns === '410' ? { timestamp: t } : {}) }), { status: Number(f.apns) });
    }
    p.status = 200;
    rec.apns.push(p);
    const lat = (S.apnsLatencyS || 0) * 1000;
    if (lat) setTimeout(() => deliverApns(p), lat); else deliverApns(p);
    return new Response(null, { status: 200, headers: { 'apns-id': 'rt-' + rec.apns.length } });
  }
  if (u.startsWith('https://exp.host/')) {
    let msgs = []; try { msgs = JSON.parse(init.body); } catch {}
    if (!Array.isArray(msgs)) msgs = [msgs];
    const f = fault('expo', t);
    for (const m of msgs) rec.expo.push({ at: sec(t), to: Array.isArray(m.to) ? m.to.join(',') : m.to, title: m.title, body: m.body, sound: m.sound, level: m.interruptionLevel, status: f ? f.expo : 'ok' });
    if (f) return new Response('{"errors":[{"code":"INTERNAL"}]}', { status: Number(f.expo) || 500 });
    for (const m of msgs) deliverExpo(m);
    return new Response(JSON.stringify({ data: msgs.map(() => ({ status: 'ok', id: 'rt' })) }), { status: 200 });
  }
  rec.other.push(u.slice(0, 120));
  return new Response('{}', { status: 503 });
};

// ---- the server ----
const W = await loadWorker(SERVER);
const flags = { tripflow2: true, getOffPush: true, liveStops: true, apnsAlerts: S.apnsAlerts !== false, ...(S.flags || {}) };
const env = makeEnv(SERVER, net.names, flags, now());
const serverDown = (t) => !!fault('server', t);
async function phoneCall(method, p, body, via = 'js') {
  const t = now();
  if (!phone.online || fault('phone', t)) { rec.calls.push({ t: sec(t), method, p, status: 'offline', via }); return { status: 0 }; }
  if (serverDown(t)) { rec.calls.push({ t: sec(t), method, p, status: 503, via }); return { status: 503 }; }
  // The app gives a write 15 s (api.ts send, READ_MS_EMPTY) and the card token post 10 s (livePush.ts post); past that
  // it counts as failed, whatever the server goes on to do. The native queue's background upload waits 60 s.
  const limit = via === 'native' ? 60000 : p === '/api/live-activity' || p === '/api/apns/device' ? 10000 : 15000;
  try {
    const r = await Promise.race([call(W, env, method, p, body, DEVICE), sleepV(limit).then(() => ({ status: 'timeout' }))]);
    const ms = r.status === 'timeout' ? limit : Math.round(r.ms * SPEED);
    rec.calls.push({ t: sec(t), method, p, status: r.status, ms, via });
    return r;
  } catch (e) { rec.errors.push({ t: sec(t), where: method + ' ' + p, msg: String(e && e.stack || e).slice(0, 400) }); return { status: 500 }; }
}

// ---- the legs the app registers (as the simulator's server path does) ----
const legs = P.legs.filter((l) => !l.alt).map((l) => ({
  mode: l.mode, line: l.line, tripId: l.tripId, stopId: platformId(l.stops[0].name, l), toStopId: stationId(l.stops[l.off].name),
  from: l.stops[0].name.replace(/,.*$/, '') + (l.mode === 'bus' ? '' : ' Station'), to: l.stops[l.off].name.replace(/,.*$/, '') + (l.mode === 'bus' ? '' : ' Station'),
  planned: new RealDate(at(l.stops[0].tt)).toISOString(), arrPlanned: new RealDate(at(l.stops[l.off].tt)).toISOString(),
  fromPlatform: l.mode === 'bus' ? (l.stand || 'Stand A') : 'Platform ' + l.platform, towards: 'Sample terminus', color: '#F99D1C', feed: '',
}));
const c24 = !!(P.phone || []).find((p) => p.c24);
const flow = { tripFlow: 2, c24 };
const tripBody = () => ({ id: 'rt', title: 'rt', to: { id: 'x', name: legs[legs.length - 1].to }, legs, rode: {}, started: at(P.start), ...flow });

async function shareToken() {
  if (phone.laSent || phone.laSending || phone.laTokenAt == null || now() < phone.laTokenAt || !phone.la) return;
  phone.laSending = true;
  const r = await phoneCall('POST', '/api/live-activity', { token: LA_TOKEN, device: DEVICE, activity: 'rt', trip: tripBody(), ...flow });
  phone.laSending = false;
  if (r.status === 200) phone.laSent = true;
}
let watchOk = false;
// The registrations as the fixed app makes them (REG, tripRegCore.ts): a key, JavaScript's tries with backoff while the
// app is open, and the native queue's copy (a background upload: sent by iOS while the phone is locked and the app is
// suspended, held until there is signal, cancelled only when the app is force quit). The token reaches the native
// side while the app is open or inside the background time Start trip asks for (beginBackgroundTask, about 30 s).
const reg = { key: REG ? REG.regKeyFor('grt', DEVICE) : null, started: null, keeps: false,
  w: { tries: 0, next: null, busy: false, nTries: 0, nNext: null, nBusy: false },
  c: { got: null, nTries: 0, nNext: null, nBusy: false }, bgUntil: null };
const watchBody = () => ({ device: DEVICE, kind: 'trip', legs, track: true, getOff: 1, getOffVoice: 1, to: { id: 'x', name: legs[legs.length - 1].to }, ...flow,
  ...(reg.key ? { key: reg.key } : {}), ...(REG && reg.c.got != null && phone.la ? { la: { token: LA_TOKEN, activity: 'rt', trip: 'grt' } } : {}) });
async function regWatch(via) {
  const body = watchBody();
  const r = await phoneCall('POST', '/api/watch', body, via);
  const out = REG ? REG.regOutcome(r.status === 'timeout' ? 'timeout' : r.status) : (r.status === 200 ? 'ok' : 'retry');
  if (out === 'ok') {
    watchOk = true;
    if (REG && r.body && REG.serverKeepsKeys(r.body, reg.key)) reg.keeps = true;
    if (REG && r.body && r.body.watch === null && r.body.ended) rec.device.push({ t: sec(now()), what: 'watch already ended' });
    if (REG && body.la) phone.laSent = true;
  }
  return out;
}
async function regTick(t) {
  if (!REG || reg.started == null) return;
  const w = reg.w;
  // JavaScript, while the app is open (live.ts liveWatchRetry)
  if (!watchOk && phone.app === 'open' && w.next != null && t >= w.next && !w.busy) {
    w.busy = true; w.tries++;
    const out = await regWatch('js');
    w.busy = false;
    if (!watchOk) w.next = out === 'unknown' && !reg.keeps ? null : REG.regNextAt(w.tries, out, now(), reg.started);
  }
  // the native queue (TripOutbox.swift): background upload, waits for signal, gone on force quit
  if (!watchOk && phone.app !== 'killed' && phone.online && w.nNext != null && t >= w.nNext && !w.nBusy) {
    w.nBusy = true; w.nTries++;
    const out = await regWatch('native');
    w.nBusy = false;
    if (!watchOk) w.nNext = REG.regNextAt(w.nTries, out === 'unknown' ? 'retry' : out, now(), reg.started);
  }
  // the card token: reaches the app when it is open or inside the background time
  const c = reg.c;
  if (c.got == null && phone.la && phone.laTokenAt != null && t >= phone.laTokenAt && (phone.app === 'open' || (reg.bgUntil != null && t <= reg.bgUntil))) {
    c.got = t;
    c.nNext = t + (phone.app === 'open' ? REG.REG_NATIVE_DELAY_S * 1000 : 0);
  }
  if (!phone.laSent && c.got != null && phone.app !== 'killed' && phone.online && c.nNext != null && t >= c.nNext && !c.nBusy) {
    c.nBusy = true; c.nTries++;
    const r = await phoneCall('POST', '/api/live-activity', { token: LA_TOKEN, device: DEVICE, activity: 'rt', trip: tripBody(), ...flow }, 'native');
    c.nBusy = false;
    const out = REG.regOutcome(r.status === 'timeout' ? 'timeout' : r.status);
    if (out === 'ok') phone.laSent = true; else c.nNext = REG.regNextAt(c.nTries, out === 'unknown' ? 'retry' : out, now(), reg.started);
  }
}
async function startTrip() {
  // Start trip, as the app does it (live.ts startLive, iosBridge.ts refreshCard): the card starts at once from the app's
  // own trip state and its push token follows about a second later (sent by itself, onActivityPushToken); the alert
  // routes and the trip watch (liveWatch, once, after Start trip returned) go out beside it, not before it.
  if (phone.la) {
    const f = frameAt(appRun, sec(now()));
    phone.card = { src: 'app', frame: f.card, at: now(), phase: f.tripPhase, updatedMs: f.card && f.card.asOf != null ? BASE + f.card.asOf * 1000 : now(), staleMs: f.card && f.card.staleDate != null ? BASE + f.card.staleDate * 1000 : null };
    phone.laTokenAt = now() + (S.laTokenDelayS ?? 1) * 1000;
  }
  if (REG) {
    reg.started = now();
    // the native copy waits for JavaScript's own try; Start trip asks iOS for background time (about 30 s)
    reg.w.nNext = now() + REG.REG_NATIVE_DELAY_S * 1000;
    if (phone.app !== 'open') reg.bgUntil = now() + 30000;
  }
  const routes = (async () => {
    if (phone.notif && P.server.direct !== false) await phoneCall('POST', '/api/push/expo', { device: DEVICE, token: EXPO, platform: 'ios' });
    if (phone.notif) await phoneCall('POST', '/api/apns/device', { token: APNS_DEV, device: DEVICE, env: 'production' });
  })();
  if (REG) {
    reg.w.busy = true; reg.w.tries = 1;
    const out = await regWatch('js');
    reg.w.busy = false;
    if (!watchOk) reg.w.next = out === 'unknown' && !reg.keeps ? null : REG.regNextAt(1, out, now(), reg.started);
  } else {
    const r = await phoneCall('POST', '/api/watch', watchBody());
    watchOk = r.status === 200;
  }
  await routes;
  if (STRESS) stressRegister();
}

// Local stress (RT_STRESS=N): N more phones start the same trip in the same minute, each with its own trip watch and
// card token, so every cron pass carries N+1 trips. Each pass's real time and outbound requests are recorded
// (Cloudflare: a cron invocation may make at most 1000 subrequests on the paid plan, and its CPU time is limited).
const STRESS = Number(process.env.RT_STRESS || 0);
async function stressRegister() {
  const t0 = performance.now(); let ok = 0, bad = 0; const slow = []; const badWhy = {};
  for (let i = 0; i < STRESS; i += 25) {
    await Promise.all(Array.from({ length: Math.min(25, STRESS - i) }, async (_, j) => {
      const dev = 'rtstress' + String(i + j).padStart(16, '0');
      const tok = (i + j).toString(16).padStart(64, 'd');
      try {
        // each phone on its own address, as on the road (the server limits writes per address)
        const ip = { 'cf-connecting-ip': `10.${(i + j) >> 8 & 255}.${(i + j) & 255}.7` };
        // the app's order: its push route first, then the trip watch and the card token
        await call(W, env, 'POST', '/api/push/expo', { device: dev, token: `ExponentPushToken[stressdev${String(i + j).padStart(6, '0')}]`, platform: 'ios' }, dev, ip);
        const a = await call(W, env, 'POST', '/api/watch', { device: dev, kind: 'trip', legs, track: true, getOff: 1, getOffVoice: 1, to: { id: 'x', name: legs[legs.length - 1].to }, ...flow }, dev, ip);
        const b = await call(W, env, 'POST', '/api/live-activity', { token: tok, device: dev, activity: 'rt', trip: tripBody(), ...flow }, dev, ip);
        if (a.status === 200 && b.status === 200) ok++; else { bad++; const k = `watch ${a.status} ${JSON.stringify(a.body).slice(0, 80)} / card ${b.status} ${JSON.stringify(b.body).slice(0, 80)}`; badWhy[k] = (badWhy[k] || 0) + 1; }
        slow.push(Math.round(a.ms));
      } catch (e) { bad++; rec.errors.push({ t: sec(now()), where: 'stress register', msg: String(e).slice(0, 300) }); }
    }));
  }
  slow.sort((x, y) => x - y);
  rec.stress = { devices: STRESS, ok, bad, registerRealMs: Math.round(performance.now() - t0), watchMsP50: slow[slow.length >> 1], watchMsMax: slow[slow.length - 1], badWhy };
}

// ---- the app while open: reads every 15 s, writes the card (fresh readings only), the widget and the Watch ----
let appTimer = null;
async function appRefresh() {
  if (phone.app !== 'open') return;
  const t = now();
  const ok = phone.online && !serverDown(t) && !fault('phone', t);
  // The trip watch (server alerts) is NOT asked again here: the app calls liveWatch() once at Start trip (live.ts), again
  // only when notifications are turned on from the trip screen or after a replan; a failed first try is not retried.
  await shareToken();
  if (!ok) return;
  const f = frameAt(appRun, sec(t));
  if (!f.card) return;
  const asOfMs = f.card.asOf != null ? BASE + f.card.asOf * 1000 : t;
  phone.widget = { at: t, asOfMs, phase: f.tripPhase, words: f.card.widget || f.card.status };
  phone.watch = { at: t, asOfMs, phase: f.tripPhase, words: f.card.watch || f.card.status };
  phone.widgetReload = t;
  // the app writes the card only from readings under 20 s old (spec 2.5), and not over what the server pushed
  if (phone.card && !phone.card.ended && t - asOfMs < 20000 && !(phone.laSent && phone.card.src === 'push' && t - phone.card.at < 20000)) {
    phone.card = { src: 'app', frame: f.card, at: t, phase: f.tripPhase, updatedMs: asOfMs, staleMs: f.card.staleDate != null ? BASE + f.card.staleDate * 1000 : null };
  }
}
function setApp(state) {
  const was = phone.app;
  phone.app = state;
  rec.device.push({ t: sec(now()), what: 'app ' + state });
  if (state === 'open') { if (was !== 'open') appRefresh(); if (!appTimer) appTimer = setInterval(appRefresh, 15000); }
  if (state !== 'open' && appTimer) { clearInterval(appTimer); appTimer = null; }
  if (state === 'killed') { phone.laSending = false; }
  if (state !== 'open' && was === 'open') phone.widgetReload = now(); // leaving the app reloads the widgets once
  if (REG && state !== 'open' && was === 'open' && reg.started != null) reg.bgUntil = now() + 30000;
}
function setOnline(v) {
  phone.online = v;
  rec.device.push({ t: sec(now()), what: v ? 'online' : 'offline' });
  if (v) { const a = phone.heldLa, b = phone.heldAlert; phone.heldLa = phone.heldAlert = null; if (a) applyApns(a); if (b) applyApns(b); }
}

// ---- the script: the case's phone moments plus the scenario's own device moments ----
const script = [...(S.keepCasePhone === false ? [] : P.phone.map((p) => ({ at: p.at, ...(p.app ? { app: p.app === 'locked' ? 'locked' : p.app } : {}) }))), ...(S.device || []).map((d) => ({ ...d, at: hms(d.at) }))]
  .sort((a, b) => a.at - b.at);

const truthArr = []; // the train's real arrival at each stop off (the vehicle at the stop), from the case's feed
for (const leg of base.legs) truthArr.push(null);
for (const e of prepareEvents(base)) if (e.vehicle && e.vehicle.state === 'at') {
  const li = e.leg ?? 0; const leg = base.legs[li]; if (!leg) continue;
  const off = leg.stops[leg.stops.length - 1].name;
  if (norm(e.vehicle.stop) === norm(off)) truthArr[li] = hms(e.at);
}
function prepareEvents(cs) { return (cs.feed && cs.feed.events) || []; }
function norm(s) { return String(s || '').toLowerCase().replace(/,.*$/, '').replace(/\s+station$/, '').trim(); }

// ---- run ----
const endMs = at(P.end) + 60000;
const passes = [];
async function cron() {
  let minute = Math.ceil((now() + 1) / 60000) * 60000;
  while (minute < endMs) {
    await untilV(minute);
    if (serverDown(minute)) { rec.passes.push({ t: sec(minute), skipped: 'server down' }); minute += 60000; continue; }
    const exec = makeExec();
    const r0 = performance.now(), v0 = now(), f0 = rec.fetchN || 0, a0 = rec.apns.length, c0 = process.cpuUsage();
    if (W.serverCfg) W.serverCfg.at = 0;
    try { await W.__default.scheduled({ scheduledTime: minute, cron: '* * * * *' }, env, exec); }
    catch (e) { rec.errors.push({ t: sec(minute), where: 'scheduled', msg: String(e && e.stack || e).slice(0, 400) }); }
    const p = Promise.all([...exec.pending]).then(() => rec.passes.push({ t: sec(minute), realMs: Math.round(performance.now() - r0), virtS: Math.round((now() - v0) / 1000), fetches: (rec.fetchN || 0) - f0, apns: rec.apns.length - a0, cpuMs: Math.round((process.cpuUsage(c0).user + process.cpuUsage(c0).system) / 1000) }));
    passes.push(p);
    minute += 60000;
  }
}
async function device() {
  let k = 0;
  const startMs = at(P.start);
  let started = false;
  for (let t = Math.ceil(now() / 1000) * 1000; t <= endMs; t += 1000) {
    await untilV(t);
    const tS = Math.round(sec(t));
    while (k < script.length && script[k].at <= tS) {
      const d = script[k++];
      if (d.app) setApp(d.app);
      if ('net' in d) setOnline(d.net);
      if ('lowPower' in d) { phone.lowPower = d.lowPower; rec.device.push({ t: tS, what: 'low power ' + d.lowPower }); }
      if ('notif' in d) phone.notif = d.notif;
      if ('la' in d) phone.la = d.la;
      if ('skew' in d) phone.skewS = d.skew;
    }
    if (!started && t >= startMs) { started = true; startTrip().catch((e) => rec.errors.push({ t: tS, where: 'startTrip', msg: String(e) })); }
    // the card's push token reaches JavaScript (onActivityPushToken): shared at once if the app is running
    if (phone.app === 'open' && phone.laTokenAt != null && t >= phone.laTokenAt && !phone.laSent && !phone.laSending) shareToken();
    if (REG && started) regTick(t).catch((e) => rec.errors.push({ t: tS, where: 'regTick', msg: String(e && e.stack || e).slice(0, 300) }));
    // the widget reloads on its own about every 5 min while the app is not in front (TripMoments liveReload)
    if (phone.app !== 'open' && phone.widgetReload != null && t - phone.widgetReload >= 300000) phone.widgetReload = t;
    if (tS % 5 === 0 && started) {
      const card = phone.card;
      rec.samples.push({ t: tS, app: phone.app, online: phone.online,
        card: card ? { src: card.src, phase: card.phase, updatedS: card.updatedMs ? Math.round(sec(card.updatedMs)) : null, staleS: card.staleMs ? Math.round(sec(card.staleMs)) : null, atS: Math.round(sec(card.at)), ended: !!card.ended,
          warning: card.cs ? card.cs.warning || null : card.frame ? card.frame.warn || card.frame.sub || null : null, departsS: card.cs && card.cs.departs != null ? Math.round(sec(appleDate(card.cs.departs))) : null, arrivalS: card.cs && card.cs.arrival != null ? Math.round(sec(appleDate(card.cs.arrival))) : null } : null,
        widget: phone.widget ? { asOfS: Math.round(sec(phone.widget.asOfMs)), phase: phone.widget.phase, reloadS: phone.widgetReload ? Math.round(sec(phone.widgetReload)) : null } : null,
        watch: phone.watch ? { asOfS: Math.round(sec(phone.watch.asOfMs)), phase: phone.watch.phase } : null,
        truth: (() => { const f = frameAt(truthRun, tS); return { phase: f.tripPhase }; })() });
    }
  }
}
const wall0 = performance.now();
await Promise.all([cron(), device()]);
await Promise.race([Promise.all(passes), sleepV(120000)]);
if (appTimer) clearInterval(appTimer);
rec.wallS = Math.round((performance.now() - wall0) / 100) / 10;
rec.notes = phone.notes;
rec.truthArr = truthArr;
rec.caseOrder = c.order || null;
rec.laTokenSent = phone.laSent;
rec.watchRegistered = watchOk;
rec.appModel = REG ? 'tripRegCore' : 'build214';
rec.appRings = appRun.rings.map((r) => ({ t: r.t, kind: r.kind, lands: r.lands, via: r.via }));
rec.checks = evaluate(rec, S, { P, BASE });
if (OUT) fs.writeFileSync(OUT, JSON.stringify(rec));
const bad = rec.checks.filter((x) => !x.ok);
log0(`${S.id}: ${rec.checks.length - bad.length}/${rec.checks.length} checks ok, ${rec.apns.length} Apple pushes, ${rec.expo.length} Expo, NSW ${rec.nsw.calls}, ${rec.wallS}s wall` + (bad.length ? '\n  ' + bad.map((b) => `${b.id}: ${b.detail}`).join('\n  ') : ''));
process.exit(0);
