// Alert words without web code (item 3 B): the Dubbo stop screen showed "<a href=...>Book your seat with NSW
// TrainLink</a>" from the old server, 26 Oct. Every answer and every kept copy is cleaned (htmlTextCore.ts), and
// nothing in the app renders HTML.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-html-'));
const src = fs.readFileSync(path.join(here, '..', 'src/lib/htmlTextCore.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
fs.writeFileSync(path.join(out, 'h.mjs'), js);
const h = await import(pathToFileURL(path.join(out, 'h.mjs')).href);
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

test('plain words: links keep their words, entities decode, encoded and cut off tags go', () => {
  assert.equal(h.plainText('<a href="https://transportnsw.info/regional-bookings/" target="_blank">Book your seat with NSW TrainLink</a>'), 'Book your seat with NSW TrainLink');
  assert.equal(h.plainText('Lifts &amp; ramps'), 'Lifts & ramps');
  assert.equal(h.plainText('Buses replace trains &lt;b&gt;this weekend&lt;/b&gt;'), 'Buses replace trains this weekend');
  assert.equal(h.plainText('It&#8217;s the 6:10 &#x2192; Central'), 'It\u2019s the 6:10 \u2192 Central');
  assert.equal(h.plainText('Line 1<br/>Line 2<p>Line 3</p>'), 'Line 1 Line 2 Line 3');
  assert.equal(h.plainText('Allow extra time <a href="https://transportnsw.info/alerts'), 'Allow extra time');
  assert.equal(h.plainText('Central \u2013 Bondi Junction'), 'Central, Bondi Junction', 'no en or em dashes');
  assert.equal(h.plainText('Trains < 3 min apart & more'), 'Trains < 3 min apart & more', 'a plain < or & stays');
  assert.equal(h.plainText(null), '');
});

test('answers: every alert word field is cleaned, ids, urls and names are not', () => {
  const dep = {
    kind: 'departures', stop: { id: '28301', name: 'Dubbo Station' },
    items: [{ line: '4591', dest: 'Broken Hill', alerts: ['ems-63457'], status: { key: 'scheduled', text: 'Scheduled' } }],
    alerts: [{ id: 'ems-63457', title: '<a href="https://transportnsw.info/regional-bookings/" target="_blank">Book your seat with NSW TrainLink</a>', url: 'https://transportnsw.info/alerts/details#/ems-63457' }],
  };
  const c = h.cleanAlertTexts(dep);
  assert.equal(c.alerts[0].title, 'Book your seat with NSW TrainLink');
  assert.equal(c.alerts[0].url, 'https://transportnsw.info/alerts/details#/ems-63457');
  assert.equal(c.items[0].status.text, 'Scheduled');
  const trip = { journeys: [{ legs: [{ kind: 'transit', alerts: [{ title: 'Lifts &amp; ramps <b>out</b>', url: null }] }] }] };
  assert.equal(h.cleanAlertTexts(trip).journeys[0].legs[0].alerts[0].title, 'Lifts & ramps out');
  const notes = { items: [{ h: 'Trackwork &ndash; buses replace trains', detail: '<p>Plan ahead</p>' }] };
  const n = h.cleanAlertTexts(notes);
  assert.equal(n.items[0].h, 'Trackwork, buses replace trains');
  assert.equal(n.items[0].detail, 'Plan ahead');
  assert.equal(h.cleanAlertTexts(null), null);
  assert.equal(h.cleanAlertTexts('x'), 'x');
});

test('every answer and every kept copy goes through it, and nothing renders HTML', () => {
  const api = read('src/lib/api.ts');
  const stamps = api.match(/return stampSeen\(/g) || [];
  assert.ok(stamps.length >= 1);
  assert.equal((api.match(/return stampSeen\(cleanAlertTexts\(/g) || []).length, stamps.length, 'each answer is cleaned');
  assert.match(read('src/lib/offline.ts'), /prune\(cleanAlertTexts\(/);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(here, '..', 'src')).filter((f) => /\.(ts|tsx)$/.test(f))) {
    const s = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /dangerouslySetInnerHTML|\.innerHTML\s*=/, f);
  }
});
