// The service screen's stop list (item 3 D, 26 Oct): the app names the service's destination so a City Circle run is
// asked round the loop, and a stop the train runs past today stays in the list as "Not stopping".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'src/app/service.tsx'), 'utf8');

test('the destination name goes to the server', () => {
  // Since the 27 Oct speed pass the query is built by speedCore.serviceQuery (shared with the board and press in).
  assert.match(src, /api\.service\(serviceQuery\(p\)\)/);
  const core = fs.readFileSync(path.join(here, '..', 'src/lib/speedCore.ts'), 'utf8');
  assert.match(core, /to: v\(p\.to\), dest: v\(p\.dest\) \}/);
});

test('a skipped stop: greyed, "Not stopping", no time, read out as not stopping', () => {
  assert.match(src, /const skip = !!s\.skipped && !s\.mine;/);
  assert.match(src, />Not stopping</);
  assert.match(src, /\{skip \? null : <T kind="sub"/);
  assert.match(src, /not stopping` : undefined/);
});
