// Search as you type from the lists kept on the phone (g10, 26 Oct): every NSW mode, at once, no network.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-ls-'));
const tr = (f, to) => fs.writeFileSync(path.join(out, to), ts.transpileModule(fs.readFileSync(path.join(here, '..', 'src/lib', f), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from '\.\/askBrain'/g, "from './askBrain.mjs'"));
tr('askBrain.ts', 'askBrain.mjs');
tr('localSearchCore.ts', 'core.mjs');
const C = await import(pathToFileURL(path.join(out, 'core.mjs')).href);
const ST = path.join(here, '..', '..', 'backend', 'src', 'public', 'stations');
const list = (n) => JSON.parse(fs.readFileSync(path.join(ST, n + '.json'), 'utf8'));
// The bus stop list the server publishes is built from the route files (backend/build.mjs); the same rows here.
const bus = new Map();
for (const f of fs.readdirSync(path.join(ST, 'bus'))) {
  const d = JSON.parse(fs.readFileSync(path.join(ST, 'bus', f), 'utf8'));
  for (const dirs of Object.values(d)) for (const dir of (Array.isArray(dirs) ? dirs : [dirs])) for (const s of dir.stops || []) if (!bus.has(s[0])) bus.set(s[0], [s[0], s[1]]);
}
const idx = C.buildLocalIndex({ train: list('train'), metro: list('metro'), lightrail: list('lightrail'), ferry: list('ferry') }, [...bus.values()]);
const first = (q) => (C.localSearch(q, idx)[0] || {}).name;

test('messy names from all over NSW find the right stop first', () => {
  const cases = [
    ['wollongong stn', 'Wollongong Station'], ['newcastle interch', 'Newcastle Interchange'], ['newcastle interchnge', 'Newcastle Interchange'], ['wolongong', 'Wollongong Station'], ['katoomba', 'Katoomba Station'],
    ['albury', 'Albury Station'], ['wagga wagga', 'Wagga Wagga Station'], ['strathfeild', 'Strathfield Station'],
    ['parra', 'Parramatta Station'], ['kings x', 'Kings Cross Station'], ['manly wharf', 'Manly Wharf'], ['tallawong', 'Tallawong Station'],
    ['bondi jnct', 'Bondi Junction Station'], ['circular quay', 'Circular Quay'], ['gosf', 'Gosford Station'],
  ];
  for (const [q, want] of cases) assert.equal(first(q), want, q);
});

test('every mode is covered: light rail, ferry, metro and bus stops', () => {
  const modes = (q) => C.localSearch(q, idx).flatMap((x) => x.modes);
  assert.ok(modes('randwick light').includes(4));
  assert.ok(modes('manly wharf').includes(9));
  assert.ok(modes('tallawong').includes(2));
  const b = C.localSearch('warnervale rd', idx);
  assert.ok(b.some((x) => x.modes.includes(5)), 'a bus stop by street');
  assert.ok(C.localSearch('206712', idx).some((x) => x.id === '206712'), 'a stop number');
  const central = C.localSearch('central station', idx)[0];
  assert.deepEqual(central.modes.slice().sort(), [1, 2, 4].filter((m) => central.modes.includes(m)).sort());
  assert.ok(central.modes.includes(1));
});

test('a whole word typed comes first: kings is Kings Cross before Kingswood', () => {
  assert.equal(first('kings'), 'Kings Cross Station');
});

test('bus stands never crowd out stations', () => {
  const r = C.localSearch('wynyard', idx, 10);
  assert.equal(r[0].name, 'Wynyard Station');
  assert.ok(r.filter((x) => !x.modes.includes(5)).length >= 1);
});

test('is fast enough for every keystroke', () => {
  const qs = ['c', 'ce', 'cen', 'cent', 'centr', 'centra', 'central', 'parramatta rd', 'george st', 'wollon'];
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) for (const q of qs) C.localSearch(q, idx);
  const each = (performance.now() - t0) / (5 * qs.length);
  assert.ok(each < 30, `${each.toFixed(1)} ms a keystroke`);
});

test('merge keeps the local answer on top and adds only what the server has new', () => {
  const local = [{ id: '200060', name: 'Central Station', modes: [1] }];
  const server = [{ id: '200060', name: 'Central Station', modes: [1] }, { id: '10101100', name: 'Central Station', kind: 'stop' }, { id: 'x1', name: 'Central Park', kind: 'place' }];
  const m = C.mergeSearch(local, server, 12);
  assert.deepEqual(m.map((x) => x.id), ['200060', 'x1']);
  assert.equal(C.searchBusy(true, 0), true);
  assert.equal(C.searchBusy(true, 3), false);
  assert.ok(C.SEARCH_DEBOUNCE_MS >= 250 && C.SEARCH_DEBOUNCE_MS <= 300);
  assert.deepEqual(C.localSearch('c', idx), []);
  assert.deepEqual(C.localSearch('central', null), []);
});
