// Car park "usually full by" line: shown only when the server sends one.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-pu-'));
const src = fs.readFileSync(path.join(here, '..', 'src/lib/access.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
fs.writeFileSync(path.join(out, 'access.mjs'), js.replace(/^import .*$/gm, ''));
const a = await import(pathToFileURL(path.join(out, 'access.mjs')).href);

test('usual line: the server words when present, nothing on the old address', () => {
  assert.equal(a.usualLine({ usual: { state: 'full', n: 10, tod: 470, text: 'Usually full by 7:50am on weekdays' } }), 'Usually full by 7:50am on weekdays');
  assert.equal(a.usualLine({ usual: { state: 'learning', n: 2, need: 5, text: 'Learning when it fills: 2 of 5 weekday mornings recorded' } }), 'Learning when it fills: 2 of 5 weekday mornings recorded');
  assert.equal(a.usualLine({}), null);
  assert.equal(a.usualLine({ usual: null }), null);
});
