// Unit tests for moving off the old shared profile and making profile ids (src/lib/profileMigrate.ts). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require(path.join(here, '..', 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-prof-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const pm = await load('src/lib/profileMigrate.ts');
const OLD = ['bid', 'ur'].join('');

test('the shared profile is recognised in any case and nothing else is', () => {
  assert.equal(pm.isSharedProfile(OLD), true);
  assert.equal(pm.isSharedProfile(' ' + OLD.toUpperCase() + ' '), true);
  assert.equal(pm.isSharedProfile('u0a1b2c3d4e5f6g7h8i9j0k1l'), false);
  assert.equal(pm.isSharedProfile(OLD + 'x'), false);
  assert.equal(pm.isSharedProfile(null), false);
  assert.equal(pm.isSharedProfile(''), false);
});

test('ids come from 12 random bytes as 24 characters after the prefix', () => {
  const id = pm.idFromBytes('u', crypto.randomBytes(12));
  assert.match(id, /^u[0-9a-z]{24}$/);
  assert.equal(pm.idFromBytes('u', new Uint8Array(12)), 'u' + '00'.repeat(12));
  assert.equal(pm.idFromBytes('u', new Uint8Array(12).fill(255)), 'u' + '73'.repeat(12));
  assert.throws(() => pm.idFromBytes('u', new Uint8Array(8)));
  const many = new Set(Array.from({ length: 500 }, () => pm.idFromBytes('u', crypto.randomBytes(12))));
  assert.equal(many.size, 500);
});

test('UUID bytes skip the fixed version and variant nibbles', () => {
  const b = pm.bytesFromUuid(crypto.randomUUID());
  assert.equal(b.length, 15);
  assert.ok(b.every((x) => x >= 0 && x <= 255));
  assert.deepEqual(pm.bytesFromUuid('00000000-0000-4000-8000-000000000000'), new Array(15).fill(0));
  assert.match(pm.idFromBytes('app', pm.bytesFromUuid(crypto.randomUUID())), /^app[0-9a-z]{24}$/);
  assert.throws(() => pm.bytesFromUuid('nope'));
});

test('device.ts has no Math.random fallback and no shared profile literal', () => {
  const src = fs.readFileSync(path.join(here, '..', 'src/lib/device.ts'), 'utf8');
  assert.equal(/Math\.random/.test(src), false);
  assert.equal(src.toLowerCase().includes(OLD), false);
  for (const f of ['src/lib/device.ts', 'src/app/profile/[id].tsx']) {
    assert.equal(fs.readFileSync(path.join(here, '..', f), 'utf8').toLowerCase().includes(`'${OLD}'`), false, f);
  }
});

test('saved trips on the phone are turned into uploads for the new profile', () => {
  const A = { id: '10101100', name: 'Central Station' }, B = { id: '10101101', name: 'Martin Place Station' }, C = { id: '2135234', name: 'Parramatta Station' };
  const store = JSON.stringify({
    recents: [A],
    myTrips: [
      { name: 'Work', from: C, to: A },
      { name: 'Gym', from: C, to: B, legs: [{ mode: 'train', from: C, to: A }, { mode: 'metro', from: A, to: B, conn: 4, any: true, walk: 3 }] },
      { name: 'Via', from: C, to: B, via: A, conn: 6, modes: ['train', 'train'] },
      { name: 'work', from: A, to: C },
      { name: '', from: A, to: B },
      { name: 'Broken', from: A },
    ],
  });
  const up = pm.tripsToUpload(store);
  assert.equal(up.length, 3);
  assert.deepEqual(up[0], { name: 'Work', from: { id: C.id, name: C.name }, to: { id: A.id, name: A.name } });
  assert.equal(up[1].name, 'Gym');
  assert.deepEqual(up[1].legs, [
    { f: C.id, fn: C.name, t: A.id, tn: A.name, m: 'train', c: 5, a: 0, w: 5 },
    { f: A.id, fn: A.name, t: B.id, tn: B.name, m: 'metro', c: 4, a: 1, w: 3 },
  ]);
  assert.equal(up[2].legs.length, 2);
  assert.equal(up[2].legs[1].c, 6);
  assert.equal(up[2].legs[1].t, B.id);
});

test('an empty or broken store uploads nothing', () => {
  assert.deepEqual(pm.tripsToUpload(null), []);
  assert.deepEqual(pm.tripsToUpload('not json'), []);
  assert.deepEqual(pm.tripsToUpload('{}'), []);
  assert.deepEqual(pm.tripsToUpload(JSON.stringify({ myTrips: 'x' })), []);
});

test('long names are cut to the server limit of 24 characters', () => {
  const A = { id: '1', name: 'A' }, B = { id: '2', name: 'B' };
  const up = pm.tripsToUpload(JSON.stringify({ myTrips: [{ name: 'x'.repeat(40), from: A, to: B }] }));
  assert.equal(up[0].name.length, 24);
});
