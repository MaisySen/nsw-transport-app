// Limited Stops tag (lib/limitedCore.ts, components/LimitedTag.tsx): shown when the server marks a service limited
// from the timetable, or the service's own description says so; nowhere else.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-lim-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const lim = await load('src/lib/limitedCore.ts');

test('the server mark or the service description, nothing else', () => {
  assert.equal(lim.isLimited({ limited: true }), true);
  assert.equal(lim.isLimited({ limited: false, description: 'Limited Stops via Main Rd' }), true);
  assert.equal(lim.isLimited({ description: 'All stations' }), false);
  assert.equal(lim.isLimited({ description: 'Express Service' }), false);
  assert.equal(lim.isLimited({}), false);
  assert.equal(lim.isLimited(null), false);
  assert.equal(lim.LIMITED_TEXT, 'Limited stops');
});

test('the tag sits on departure rows and trip legs, and the types carry the field', () => {
  const src = (f) => fs.readFileSync(path.join(here, '..', f), 'utf8');
  assert.match(src('src/components/Transit.tsx'), /<LimitedTag x=\{d\} \/>/);
  assert.match(src('src/app/trip.tsx'), /<LimitedTag x=\{l\} \/>/);
  const types = src('src/lib/types.ts');
  assert.equal((types.match(/limited\?: boolean;/g) || []).length, 2);
  const tag = src('src/components/LimitedTag.tsx');
  // A label for VoiceOver and TalkBack, no tap target (it is not a button), theme colours only.
  assert.match(tag, /accessibilityLabel=\{LIMITED_A11Y\}/);
  assert.doesNotMatch(tag, /Pressable|onPress/);
  assert.doesNotMatch(tag, /#[0-9A-Fa-f]{3,6}/);
});
