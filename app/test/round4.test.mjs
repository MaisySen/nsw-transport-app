// Round 4: one server address (remote api_base with an allowlist), remote config flags, Morning check helpers,
// occupancy chips and step free trip notes. Run: node --test test/
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-r4-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const server = await load('src/lib/server.ts');
const core = await load('src/lib/configCore.ts');
const morning = await load('src/lib/morning.ts');
const occ = await load('src/lib/occupancy.ts');
const sf = await load('src/lib/stepFree.ts');
const format = await load('src/lib/format.ts');

const CUR = server.DEFAULT_BASE;

test('server: the default address and the allowlist', () => {
  assert.equal(CUR, `https://${server.DEFAULT_HOST}`);
  assert.equal(server.SITE, 'https://transportsydney.app');
  assert.equal(server.PRIVACY_URL, 'https://transportsydney.app/privacy');
  assert.equal(server.SUPPORT_URL, 'https://transportsydney.app/support');
  assert.equal(CUR, 'https://api.transportsydney.app', 'the app reads from the new server (26 Oct 2026)');
  assert.equal(server.NEW_API_BASE, CUR);
  assert.deepEqual([...server.ALLOWED_DOMAINS], ['api.transportsydney.app'], 'the first server is switched off (30 Oct 2026)');
  assert.equal(server.LEGACY_HOST, undefined);
  assert.equal(server.apiBase(), CUR);
});

test('share and support links use transportsydney.app', () => {
  assert.equal(server.shareLink('Ab12_x'), 'https://transportsydney.app/trip/Ab12_x');
  assert.equal(server.shareLink('a b/c'), 'https://transportsydney.app/trip/a%20b%2Fc');
  const go = fs.readFileSync(path.join(root, 'src/app/go.tsx'), 'utf8');
  assert.doesNotMatch(go, /r\.url|share!\.url/, 'the server link (old host) is never shared');
  assert.match(go, /shareLink\(r\.id\)/);
  const co = fs.readFileSync(path.join(root, 'src/lib/company.ts'), 'utf8');
  assert.match(co, /email: 'support@transportsydney\.app'/);
  assert.match(co, /privacyEmail: 'privacy@transportsydney\.app'/);
  const set = fs.readFileSync(path.join(root, 'src/app/(tabs)/settings/index.tsx'), 'utf8');
  assert.match(set, /mailto:\$\{COMPANY\.privacyEmail\}/);
  assert.match(set, /PRIVACY_URL/); assert.match(set, /SUPPORT_URL/);
});

test('server: validBase takes https on an allowed domain only', () => {
  assert.equal(server.validBase('https://api.api.transportsydney.app', CUR), 'https://api.api.transportsydney.app');
  assert.equal(server.validBase('https://api.transportsydney.app/', CUR), 'https://api.transportsydney.app');
  assert.equal(server.validBase('  HTTPS://API.TransportSydney.APP  ', CUR), 'https://api.transportsydney.app');
  assert.equal(server.validBase('https://transportsydney.app', CUR), null, 'the site itself is not the API host');
  assert.equal(server.validBase(CUR, CUR), CUR);
  // not https, not allowed, or more than a bare host
  for (const bad of ['http://api.api.transportsydney.app', 'https://evil.example', 'https://api.transportsydney.app.evil.com', 'https://evilapi.transportsydney.app',
    'https://user:pw' + String.fromCharCode(64) + 'api.api.transportsydney.app', 'https://api.api.transportsydney.app:8443', 'https://api.api.transportsydney.app/v1', 'https://api.api.transportsydney.app?x=1',
    'https://api.api.transportsydney.app#a', 'ftp://api.transportsydney.app', 'api.transportsydney.app', '', null, 42, {}, 'https://localhost', 'https://-x.api.transportsydney.app']) {
    assert.equal(server.validBase(bad, CUR), null, String(bad));
  }
  // the host in use now is always allowed, even off the list
  assert.equal(server.validBase('https://old.example.org', 'https://old.example.org'), 'https://old.example.org');
});

test('server: copy.api_base first, then top level api_base', () => {
  assert.equal(server.baseInConfig({ copy: { api_base: 'https://a.api.transportsydney.app' }, api_base: 'https://b.api.transportsydney.app' }), 'https://a.api.transportsydney.app');
  assert.equal(server.baseInConfig({ copy: {}, api_base: 'https://b.api.transportsydney.app' }), 'https://b.api.transportsydney.app');
  assert.equal(server.baseInConfig({ copy: { api_base: '' } }), undefined);
  assert.equal(server.baseInConfig({}), undefined);
  assert.equal(server.baseInConfig(null), undefined);
});

test('server: nextBase switches, keeps the last good value on a bad one, and goes back when removed', () => {
  const moved = 'https://api.api.transportsydney.app';
  assert.equal(server.nextBase({ copy: { api_base: moved } }, CUR), moved);
  assert.equal(server.nextBase({ api_base: moved }, CUR), moved);
  assert.equal(server.nextBase({ copy: { api_base: 'http://api.api.transportsydney.app' } }, moved), moved, 'http is ignored, last good stays');
  assert.equal(server.nextBase({ copy: { api_base: 'https://evil.example' } }, moved), moved, 'off the list is ignored');
  assert.equal(server.nextBase({ copy: {} }, moved), CUR, 'no api_base goes back to the default');
  // The live config shape as served today
  assert.equal(server.nextBase({ version: 1, flags: {}, kill: {}, copy: {}, tabs: [], timing: {}, platform: 'android' }, CUR), CUR);
});

test('server: setApiBase applies only allowed values', () => {
  assert.equal(server.setApiBase('https://evil.example'), CUR);
  assert.equal(server.setApiBase('https://api.api.transportsydney.app'), 'https://api.api.transportsydney.app');
  assert.equal(server.apiBase(), 'https://api.api.transportsydney.app');
  assert.equal(server.setApiBase('http://api.transportsydney.app'), 'https://api.api.transportsydney.app');
  assert.equal(server.setApiBase(CUR), CUR);
});

test('one address: the old server host is never written, and no first phase names anywhere in the app', () => {
  const files = [];
  const skip = new Set(['node_modules', 'android', 'dist', '.expo', '.git', 'assets']);
  const walk = (d) => { for (const f of fs.readdirSync(d)) { if (skip.has(f)) continue; const p = path.join(d, f); const s = fs.lstatSync(p); if (s.isDirectory()) walk(p); else if (s.isFile() && /\.(tsx?|mjs|js|kt|json|md|sh)$/.test(f)) files.push(p); } };
  walk(root);
  assert.ok(files.length > 50);
  const rel = (f) => path.relative(root, f);
  const hits = (re) => files.filter((f) => re.test(fs.readFileSync(f, 'utf8'))).map(rel).filter((f) => f !== 'package-lock.json' && f !== 'test/round4.test.mjs'); // this file names what it looks for
  assert.deepEqual(hits(/tab\.bot/), [], 'the old tab.bot address is gone from the app (30 Oct 2026)');
  assert.deepEqual(hits(/nsw-transport-bot/), []);
  assert.deepEqual(hits(/to Tab\b/), [], 'no Tab branding in the app');
  assert.deepEqual(hits(/mail\.tab\.bot|Transport Bot/i), []);
  const src = files.filter((f) => rel(f).startsWith('src/') || rel(f).startsWith('plugins/'));
  const bad = src.filter((f) => /[\u2013\u2014]/.test(fs.readFileSync(f, 'utf8'))).map(rel);
  assert.deepEqual(bad, [], 'no em or en dashes');
});

test('Delete all data also deletes the morning checks, and keeps only the install ids, the server address and the push token mark', () => {
  const src = fs.readFileSync(path.join(root, 'src/app/(tabs)/settings/index.tsx'), 'utf8');
  const del = src.slice(src.indexOf('const deleteAll'), src.indexOf('const deleteAll') + 2000);
  assert.match(del, /api\.deleteHistory\('all'\)/);
  assert.match(del, /api\.morningDelete\(\)/);
  // Kept: install ids, the server address and switches, and the mark that stops the phone push token being sent again.
  assert.match(del, /\['profile', 'device', 'store', 'apiBase', 'remoteConfig', PUSH_FORGOTTEN_KEY\]/);
  const store = fs.readFileSync(path.join(root, 'src/lib/store.ts'), 'utf8');
  assert.match(store, /resetAll\(\) \{[^\n]*\.\.\.EMPTY/, 'the morning mirror goes with resetAll');
  assert.doesNotMatch(src, /Web version/, 'no link to the web app');
});

test('config: flags default on, off only when the server says false or kills it', () => {
  const c = core.cleanConfig({ flags: { morningCheck: false, occupancy: true, junk: 'no' }, kill: { liftAwareRouting: 'Paused.', x: 3 }, copy: { api_base: 'https://a.api.transportsydney.app' }, timing: { configRefreshMin: 10, bad: 'x' } });
  assert.equal(core.flagOn(c, 'morningCheck'), false);
  assert.equal(core.flagOn(c, 'occupancy'), true);
  assert.equal(core.flagOn(c, 'liftAwareRouting'), false, 'killed');
  assert.equal(core.flagOn(c, 'somethingNew'), true);
  assert.equal(core.flagOn(c, 'junk'), true, 'non boolean ignored');
  assert.equal(c.timing.configRefreshMin, 10);
  assert.equal(c.timing.bad, undefined);
  assert.equal(c.copy.api_base, 'https://a.api.transportsydney.app');
  const d = core.cleanConfig(null);
  assert.equal(core.flagOn(d, 'morningCheck'), true);
  assert.equal(d.timing.configRefreshMin, 30);
});

test('morning: time steps and labels', () => {
  assert.equal(morning.stepTime('08:00', 5), '08:05');
  assert.equal(morning.stepTime('08:00', -5), '07:55');
  assert.equal(morning.stepTime('08:03', 5), '08:05');
  assert.equal(morning.stepTime('08:03', -5), '08:00');
  assert.equal(morning.stepTime('23:55', 5), '00:00');
  assert.equal(morning.stepTime('00:00', -5), '23:55');
  assert.equal(morning.timeText('08:00'), '8:00am');
  assert.equal(morning.timeText('17:30'), '5:30pm');
  assert.equal(morning.timeText('00:05'), '12:05am');
  assert.equal(morning.timeText('12:00'), '12:00pm');
  assert.ok(Number.isNaN(morning.minutesOf('25:00')));
  assert.equal(morning.minutesOf('0745'), 465);
  assert.equal(morning.hhmm(480 - 15), '07:45');
  assert.equal(morning.daysLabel([1, 2, 3, 4, 5]), 'Mon to Fri');
  assert.equal(morning.daysLabel([7, 6]), 'Sat and Sun');
  assert.equal(morning.daysLabel([1, 2, 3, 4, 5, 6, 7]), 'Every day');
  assert.equal(morning.daysLabel([1, 3, 5]), 'Mon, Wed, Fri');
  assert.equal(morning.daysLabel([]), 'No days');
  assert.deepEqual(morning.toggleDay([1, 2, 3], 2), [1, 3]);
  assert.deepEqual(morning.toggleDay([1, 3], 2), [1, 2, 3]);
  assert.equal(morning.DEFAULT_LEAD, 15);
});

test('morning: titles, subtitles and when to ask for notifications', () => {
  const m = { id: 'x', name: null, from: { id: '213410', name: 'Burwood Station' }, to: { id: '213510', name: 'Strathfield Station' }, time: '08:00', timeText: '8:00am', days: [1, 2, 3, 4, 5], mode: null, lead: 15, active: true };
  assert.equal(morning.checkTitle(m), 'Burwood to Strathfield');
  assert.equal(morning.checkTitle({ ...m, name: 'Work' }), 'Work');
  assert.equal(morning.checkSubtitle(m), '8:00am, Mon to Fri. Checks 15 min before.');
  assert.equal(morning.checkSubtitle({ ...m, mode: 'lightrail', lead: 10 }), '8:00am light rail, Mon to Fri. Checks 10 min before.');
  assert.equal(morning.noTargets({ web: 0, expo: 0 }), true);
  assert.equal(morning.noTargets(null), true);
  assert.equal(morning.noTargets({ web: 0, expo: 1 }), false);
  assert.equal(morning.noTargets({ web: 1, expo: 0 }), false);
});

test('morning: Check now preview words', () => {
  const item = { id: 'x', time: '08:00', timeText: '8:00am', days: [1], lead: 15 };
  const issue = morning.previewWords({ item, found: true, issues: [{ kind: 'delay', minutes: 7, text: 'The 8:00am T1 is 7 min late.' }, { kind: 'lift', text: 'Lift out of service at Burwood.' }], service: {}, alert: { title: 't', body: 'b' }, sent: false }, format.clock);
  assert.equal(issue.tone, 'issue');
  assert.equal(issue.title, '2 problems right now');
  assert.deepEqual(issue.lines, ['The 8:00am T1 is 7 min late.', 'Lift out of service at Burwood.']);
  const ok = morning.previewWords({ item, found: true, issues: [], service: { line: 'T1', planned: '2026-10-25T21:00:00.000Z', estimated: '2026-10-25T21:00:00.000Z', platform: 'Platform 3', realtime: true }, alert: null, sent: false }, format.clock);
  assert.equal(ok.tone, 'ok');
  assert.equal(ok.lines[0], 'The 8:00am T1 runs on time from Platform 3. Nothing would be sent.');
  const late = morning.previewWords({ item, found: true, issues: [], service: { line: 'T1', planned: '2026-10-25T21:00:00.000Z', estimated: '2026-10-25T21:03:00.000Z', realtime: true }, alert: null, sent: false }, format.clock);
  assert.equal(late.lines[0], 'The 8:00am T1 runs 3 min late. Nothing would be sent.');
  const sched = morning.previewWords({ item, found: true, issues: [], service: { line: 'T1', planned: '2026-10-25T21:00:00.000Z', realtime: false }, alert: null, sent: false }, format.clock);
  assert.match(sched.lines[0], /no live data yet/);
  const none = morning.previewWords({ item, found: false, issues: [], service: null, alert: null, sent: false }, format.clock);
  assert.equal(none.tone, 'none');
  assert.equal(none.title, 'No service found near 8:00am');
});

test('occupancy: a chip only when Transport for NSW sends it, and only with the flag on', () => {
  assert.equal(occ.occText({ level: 2, text: 'Few seats' }), 'Few seats');
  assert.equal(occ.occText({ level: 2, text: 'Few seats' }, false), null);
  assert.equal(occ.occText(null), null);
  assert.equal(occ.occText(undefined), null);
  assert.equal(occ.occText({ level: 1, text: '  ' }), null);
  assert.equal(occ.occText({ level: 1 }), null);
  assert.equal(occ.occBusy({ level: 3, text: 'Standing room' }), true);
  assert.equal(occ.occBusy({ level: 2, text: 'Few seats' }), false);
  assert.equal(occ.occBusy(null), false);
});

test('step free: lift aware note and per trip chips', () => {
  assert.equal(sf.liftAwareNote({ accessible: true, liftAware: { avoided: 1, allAffected: false, stations: ['Central Station'] } }).text, 'Left out 1 trip with a lift out of service at Central.');
  assert.equal(sf.liftAwareNote({ accessible: true, liftAware: { avoided: 2, allAffected: false, stations: ['Central', 'Redfern', 'Central'] } }).text, 'Left out 2 trips with a lift out of service at Central and Redfern.');
  const all = sf.liftAwareNote({ accessible: true, liftAware: { avoided: 0, allAffected: true, stations: ['Burwood'] } });
  assert.equal(all.tone, 'warn');
  assert.equal(all.text, 'Every trip found passes a lift that is out of service at Burwood. Each trip shows where.');
  assert.equal(sf.liftAwareNote({ accessible: true, liftAware: { avoided: 0, allAffected: false, stations: [] } }), null);
  assert.equal(sf.liftAwareNote({ accessible: true, liftAware: { avoided: 1, allAffected: false, stations: [] } }, false), null, 'flag off');
  assert.equal(sf.liftAwareNote({ accessible: false, liftAware: null }), null);
  assert.deepEqual(sf.journeyAccess({ stepFree: true, liftOutages: [] }), { stepFree: true, outages: [] });
  assert.deepEqual(sf.journeyAccess({ stepFree: false, liftOutages: [{ id: '1', name: 'Burwood Station', title: 'Lift 1' }, { id: '1', name: 'Burwood Station' }] }), { stepFree: false, outages: ['Burwood'] });
  assert.deepEqual(sf.journeyAccess({ liftOutages: [{ id: '1', name: 'Burwood Station' }] }, false), { stepFree: false, outages: [] });
});

// Live: the server the app talks to answers the config, the Morning check round trip and step free trips.
test('live: config, morning check and step free answers', { skip: process.env.OFFLINE === '1', timeout: 90000 }, async () => {
  const get = async (p, init) => { const r = await fetch(CUR + p, { ...init, signal: AbortSignal.timeout(30000) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const cfg = await get(`/api/app/config?platform=android&t=${Date.now()}`);
  assert.equal(cfg.status, 200);
  for (const k of ['morningCheck', 'occupancy', 'liftAwareRouting']) assert.equal(typeof cfg.body.flags[k], 'boolean', k);
  assert.equal(server.nextBase(cfg.body, CUR), CUR);
  const device = 'test.r4.' + Math.random().toString(36).slice(2, 10);
  const save = await get('/api/morning-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device, from: { id: '213410', name: 'Burwood Station' }, to: { id: '213510', name: 'Strathfield Station' }, time: '08:00', days: [1, 2, 3, 4, 5], lead: 15 }) });
  try {
    assert.equal(save.status, 200, JSON.stringify(save.body));
    assert.deepEqual(save.body.push, { web: 0, expo: 0 });
    assert.equal(morning.noTargets(save.body.push), true);
    const list = await get(`/api/morning-check?device=${device}`);
    assert.equal(list.body.items.length, 1);
    const pv = await get(`/api/morning-check/preview?device=${device}&id=${save.body.item.id}`);
    assert.equal(pv.status, 200);
    const w = morning.previewWords(pv.body, format.clock);
    assert.ok(w.title && w.lines.length);
  } finally {
    const del = await get(`/api/morning-check?device=${device}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    const after = await get(`/api/morning-check?device=${device}`);
    assert.equal(after.body.items.length, 0);
  }
  const trip = await get(`/api/trip?from=213410&to=200060&count=3&acc=1&t=${Date.now()}`);
  assert.equal(trip.status, 200);
  assert.equal(trip.body.accessible, true);
  for (const j of trip.body.journeys || []) assert.equal(typeof j.stepFree, 'boolean');
});
