// Unit tests for station access, Park and Ride and Opal machine helpers (src/lib/access.ts). Run: npm test
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-acc-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const acc = await load('src/lib/access.ts');

test('car park names drop the station name', () => {
  assert.equal(acc.parkName({ name: 'Tallawong P1' }, 'Tallawong Station'), 'Car park P1');
  assert.equal(acc.parkName({ name: 'Kellyville (north)' }, 'Kellyville Station'), 'North car park');
  assert.equal(acc.parkName({ name: 'Ashfield Park and Ride' }, 'Gordon Station'), 'Ashfield Park and Ride');
  assert.equal(acc.parkName({ name: 'Tallawong P1' }), 'Tallawong P1');
});

test('car park badge, fill and totals', () => {
  assert.deepEqual(acc.parkBadge({ status: 'ok' }), { text: 'Spaces free', tone: 'green' });
  assert.deepEqual(acc.parkBadge({ status: 'nearly' }), { text: 'Nearly full', tone: 'orange' });
  assert.deepEqual(acc.parkBadge({ status: 'full' }), { text: 'Full', tone: 'red' });
  assert.deepEqual(acc.parkBadge({ status: 'unknown' }), { text: 'No live count', tone: 'grey' });
  assert.equal(acc.parkFill({ spots: 200, free: 50, occupied: 150 }), 75);
  assert.equal(acc.parkFill({ spots: 200, free: 50 }), 75);
  assert.equal(acc.parkFill({ spots: 200, free: null }), null);
  assert.deepEqual(acc.parkTotals([{ spots: 100, free: 10 }, { spots: 50, free: 5 }]), { free: 15, spots: 150 });
  assert.equal(acc.parkTotals([{ spots: 100, free: 10 }]), null);
  assert.equal(acc.parkTotals([{ spots: 100, free: 10 }, { spots: 50, free: null }]), null);
});

test('ticket machine wording', () => {
  assert.deepEqual(acc.ticketText({ kind: 'cash' }), { title: 'Opal top up and tickets', sub: 'Cash or card', color: '#5856D6' });
  assert.equal(acc.ticketText({ kind: 'card' }).sub, 'Card only');
  assert.equal(acc.ticketText({ kind: 'topup' }).title, 'Opal top up machine');
  assert.equal(acc.ticketText({ kind: 'card', extraTopUp: true }).sub, 'Card only, plus a card only top up machine');
  assert.equal(acc.ticketText({ kind: 'none' }).title, 'No Opal machine');
  assert.equal(acc.ticketText({ kind: 'none' }).sub, 'Top up in the Opal Travel app or at a retailer');
  assert.equal(acc.ticketText(null).title, 'Opal machine not listed');
});

test('access chips and outages on trip legs', () => {
  assert.deepEqual(acc.accChip({ id: '1', level: 'independent' }, 'Central Station'), { text: 'Central: Step free', tone: 'green' });
  assert.deepEqual(acc.accChip({ id: '1', level: 'assisted' }, 'Epping Station'), { text: 'Epping: Assisted access', tone: 'orange' });
  assert.deepEqual(acc.accChip({ id: '1', level: 'none' }, 'Stanmore Station'), { text: 'Stanmore: Not step free', tone: 'grey' });
  assert.deepEqual(acc.accChip({ id: '1', level: 'independent', outage: 'Lift 6 out' }, 'Central Station'), { text: 'Central: lift out', tone: 'red' });
  assert.equal(acc.accChip(null, 'X'), null);
  const j = { legs: [
    { kind: 'transit', access: { from: { id: 'a', level: 'independent' }, to: { id: 'b', level: 'independent', outage: 'Central Station Lift 6 is not available' } } },
    { kind: 'walk' },
    { kind: 'transit', access: { from: { id: 'b', level: 'independent', outage: 'Central Station Lift 6 is not available' }, to: null } },
  ] };
  assert.deepEqual(acc.journeyOutages(j), ['Central Station Lift 6 is not available']);
  assert.deepEqual(acc.journeyOutages({ legs: [{ kind: 'transit' }] }), []);
  assert.equal(acc.outageText('Central Station Lift 6 between Central Walk and Platform 24/25 is not available', 'Central Station'), 'Lift 6 between Central Walk and Platform 24/25 is not available');
  assert.equal(acc.outageText('Seven Hills Lift 3 is not available', 'Seven Hills Station'), 'Lift 3 is not available');
  assert.equal(acc.safeUrl('https://transportnsw.info/alerts'), 'https://transportnsw.info/alerts');
  assert.equal(acc.safeUrl('http://example.com'), null);
  assert.equal(acc.safeUrl('javascript:alert(1)'), null);
});

test('lift alert stations come from every saved trip end, digits only, at most 40', () => {
  const trips = [
    { from: { id: '2135223', name: 'Lakemba' }, to: { id: '200060', name: 'Central' }, legs: [{ from: { id: '2135223' }, to: { id: '200060' } }, { from: { id: '200060' }, to: { id: '2067141' } }] },
    { from: { id: '200060' }, to: { id: 'home' }, via: { id: '2077011' } },
  ];
  assert.deepEqual(acc.liftStations(trips), ['2135223', '200060', '2067141', '2077011']);
  const many = Array.from({ length: 60 }, (_, i) => ({ from: { id: String(2000000 + i) }, to: { id: String(3000000 + i) } }));
  assert.equal(acc.liftStations(many).length, 40);
});

test('access labels and distances', () => {
  assert.equal(acc.ACC_LABEL.independent, 'Step free access');
  assert.equal(acc.ACC_LABEL.none, 'No step free access');
  assert.equal(acc.distText(266), '270 m');
  assert.equal(acc.distText(1520), '1.5 km');
  assert.equal(acc.distText(null), '');
  assert.equal(acc.stShort('Paddy\'s Markets Light Rail'), "Paddy's Markets");
});

// Live: the server sends every field the station screen, trip legs and the Opal finder read.
const { DEFAULT_BASE: BASE } = await load('src/lib/server.ts');
async function get(p) { const r = await fetch(BASE + p, { signal: AbortSignal.timeout(30000) }); assert.equal(r.status, 200, p); return r.json(); }

test('live /api/station, /api/parking, /api/topup and acc=1 trip shapes', { timeout: 90000, skip: process.env.OFFLINE === '1' }, async () => {
  const st = await get('/api/station?id=2155384');
  assert.ok(['independent', 'assisted', 'none', 'unknown'].includes(st.access.level));
  assert.ok(st.ticket && st.ticket.kind);
  assert.ok(Array.isArray(st.outages) && Array.isArray(st.parking));
  assert.ok(st.parking.length >= 1, 'Tallawong has car parks');
  for (const p of st.parking) {
    assert.ok(p.id && p.name && typeof p.spots === 'number');
    assert.ok(['ok', 'nearly', 'full', 'unknown'].includes(p.status));
  }
  const pk = await get('/api/parking?stop=2155384');
  assert.ok(pk.carparks.length >= 1 && pk.carparks.every((p) => p.station === '2155384'));
  const tu = await get('/api/topup?lat=-33.88&lon=151.2&limit=5');
  assert.ok(tu.items.length >= 1);
  for (const r of tu.items) assert.ok(r.id && typeof r.lat === 'number' && ['cash', 'card', 'topup'].includes(r.kind) && typeof r.distance === 'number');
  const tr = await get('/api/trip?from=2155384&to=200060&acc=1&count=2');
  assert.equal(tr.accessible, true);
  assert.ok(tr.parking && tr.parking.carparks.length >= 1, 'a trip from Tallawong carries Park and Ride');
  const legs = (tr.journeys || []).flatMap((j) => j.legs).filter((l) => l.kind === 'transit');
  if (legs.length) assert.ok(legs.every((l) => l.access && (l.access.from || l.access.to)));
});
