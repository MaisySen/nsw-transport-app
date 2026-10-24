// Incoming transportsydney.app links (trip, stop, plan) and the app routes they open. Run: node --test test/
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-links-'));
const src = fs.readFileSync(path.join(root, 'src/lib/links.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
fs.writeFileSync(path.join(out, 'links.mjs'), js);
const { parseLink, routeFor, systemPath } = await import(pathToFileURL(path.join(out, 'links.mjs')).href);
const server = fs.readFileSync(path.join(root, 'src/lib/server.ts'), 'utf8');

const ID = 'Ab-C_12345678';

test('a shared trip link opens the shared trip screen with its id', () => {
  assert.deepEqual(parseLink(`https://transportsydney.app/trip/${ID}`), { kind: 'trip', id: ID });
  assert.equal(systemPath(`https://transportsydney.app/trip/${ID}`), `/shared/${ID}`);
  assert.equal(systemPath(`https://transportsydney.app/trip/${ID}/`), `/shared/${ID}`);
  assert.equal(systemPath(`https://www.transportsydney.app/trip/${ID}?utm=x#top`), `/shared/${ID}`);
  assert.equal(systemPath(`HTTPS://TransportSydney.App/trip/${ID}`), `/shared/${ID}`);
});

test('Share trip links parse back to the same id', () => {
  const m = /shareLink = \(id: string\) => `\$\{SITE\}\/trip\/\$\{encodeURIComponent\(id\)\}`/.exec(server);
  assert.ok(m, 'shareLink still builds transportsydney.app/trip/<id>');
  assert.match(server, /SITE = 'https:\/\/transportsydney\.app'/);
  for (const id of ['abcdefghijkl', 'A1b2C3d4E5f6G7h8', 'x_y-z_0123456789_abcdefghij']) {
    assert.deepEqual(parseLink(`https://transportsydney.app/trip/${encodeURIComponent(id)}`), { kind: 'trip', id });
  }
});

test('a bad share id goes home, not to a broken screen', () => {
  for (const bad of ['short', 'has%20space123456', '..%2F..%2Fetc%2Fpasswd', 'a'.repeat(41), '%E0%A4%A']) {
    assert.deepEqual(parseLink(`https://transportsydney.app/trip/${bad}`), { kind: 'home' }, bad);
  }
  assert.deepEqual(parseLink(`https://transportsydney.app/trip/${ID}/extra`), { kind: 'home' });
});

test('a stop link opens that stop', () => {
  assert.equal(systemPath('https://transportsydney.app/stop/200060'), '/stop/200060');
  assert.equal(systemPath('https://transportsydney.app/stop/G200060/'), '/stop/G200060');
  assert.deepEqual(parseLink('https://transportsydney.app/stop/<script>'), { kind: 'home' });
  assert.deepEqual(parseLink('https://transportsydney.app/stop/'), { kind: 'home' });
});

test('a plan link keeps from, to and names; bad values are dropped', () => {
  assert.equal(systemPath('https://transportsydney.app/plan?from=200060&to=2150110'), '/plan?from=200060&to=2150110');
  assert.equal(systemPath('https://transportsydney.app/plan/?to=2150110&from=200060'), '/plan?from=200060&to=2150110');
  assert.equal(
    systemPath('https://transportsydney.app/plan?from=200060&to=2150110&fromName=Central+Station&toName=Parramatta%20Station'),
    '/plan?from=200060&to=2150110&fromName=Central%20Station&toName=Parramatta%20Station',
  );
  assert.equal(systemPath('https://transportsydney.app/plan?from=200060'), '/plan?from=200060');
  assert.equal(systemPath('https://transportsydney.app/plan'), '/plan');
  assert.equal(systemPath('https://transportsydney.app/plan?from=a%20b&to=%3Cx%3E'), '/plan');
  assert.equal(systemPath('https://transportsydney.app/plan?from=1&from=2&to=3'), '/plan?from=1&to=3');
  assert.deepEqual(parseLink('https://transportsydney.app/plan?fromName=Nowhere'), { kind: 'plan' });
});

test('other pages on the site open home', () => {
  for (const p of ['/', '/support/', '/privacy/', '/open/', '/trip', '/stop/1/2', '/plan/x']) {
    assert.equal(systemPath(`https://transportsydney.app${p}`), '/', p);
  }
  assert.equal(routeFor({ kind: 'home' }), '/');
});

test('links that are not ours pass through unchanged', () => {
  for (const p of [
    'nswtransport://stop/200060', 'nswtransport://trip?from=1&to=2', 'nswtransport://go', 'nswtransport://ask',
    '/stop/200060', '/watch/abc', 'https://example.com/trip/' + ID, 'https://transportsydney.app.evil.com/trip/' + ID,
    'http://transportsydney.app/trip/' + ID, 'https://api.transportsydney.app/live/?t=' + ID, '',
  ]) {
    assert.equal(systemPath(p), p, p);
    assert.equal(parseLink(p), null, p);
  }
  assert.equal(parseLink(undefined), null);
  assert.equal(parseLink(42), null);
});
