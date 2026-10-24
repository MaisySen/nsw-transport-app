// The server pushes the iPhone trip card with a copy of the app's own card code (backend/src/worker.js, LIVECARD,
// written by backend/tools/gen-livecard.mjs). This fails when liveCalc.ts or tripCard.ts changed without running it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require(path.join(here, '..', 'node_modules', 'typescript'));
const gen = await import(pathToFileURL(path.join(here, '..', '..', 'backend', 'tools', 'gen-livecard.mjs')).href);

test('server copy of the trip card code matches the app (run node backend/tools/gen-livecard.mjs)', () => {
  const worker = fs.readFileSync(path.join(here, '..', '..', 'backend', 'src', 'worker.js'), 'utf8');
  assert.equal(gen.withBlock(worker, gen.liveCardBlock(ts)), worker);
});
