// Build 215 check (2 Nov 2026): a location that cannot be found never shows as developer text. In the iOS Simulator run
// (rt-sim killed, rt-harness-215) Home's Nearby read "Calling the 'getCurrentPositionAsync' function has failed → Caused
// by: Cannot obtain current location (kCLErrorDomain error 0.)": iOS's "location unknown" (also indoors and under
// ground) came through freshFix and friendlyErr as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ts = createRequire(import.meta.url)(path.join(root, 'node_modules', 'typescript'));
async function load(rel, fix = (s) => s) {
  const src = fix(fs.readFileSync(path.join(root, rel), 'utf8'));
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loc215-')), path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const RAW = "Calling the 'getCurrentPositionAsync' function has failed\n\u2192 Caused by: Cannot obtain current location (kCLErrorDomain error 0.)";

test('freshFix turns any failure of the system location into nofix (each screen says "Can\'t find where you are")', async () => {
  const W = await load('src/lib/where.ts', (s) => s.replace("import * as Location from 'expo-location';", 'const Location: any = { Accuracy: { Balanced: 3 } };'));
  const fails = { getCurrentPositionAsync: async () => { throw new Error(RAW); } };
  await assert.rejects(W.freshFix(3, 1000, fails), (e) => e.message === 'nofix');
  const ok = { getCurrentPositionAsync: async () => ({ coords: { latitude: -33.8, longitude: 151.2 } }) };
  assert.equal((await W.freshFix(3, 1000, ok)).coords.longitude, 151.2);
});

test('friendlyErr never passes on a native module error or a message over more than one line', async () => {
  const N = await load('src/lib/netErrCore.ts');
  assert.equal(N.friendlyErr(new Error(RAW)), N.MSG.failed);
  assert.equal(N.friendlyErr(new Error('Cannot obtain current location (kCLErrorDomain error 0.)')), N.MSG.failed);
  assert.equal(N.friendlyErr(new Error("Calling the 'requestPermissionsAsync' function has failed")), N.MSG.failed);
  assert.equal(N.friendlyErr(new Error("You're offline. Check your connection.")), "You're offline. Check your connection.");
});
