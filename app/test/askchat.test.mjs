// Ask: a long chat opens fast and can be cleared (25 Oct, 7 PM).
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-askchat-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

const a = await load('src/lib/askChatCore.ts');
const msg = (i) => ({ id: 'm' + i, role: i % 2 ? 'bot' : 'me', text: 'Message ' + i, t: i });

test('history is capped at 200, the oldest dropped', () => {
  const many = Array.from({ length: 260 }, (_, i) => msg(i));
  const kept = a.capHistory(many);
  assert.equal(a.ASK_KEEP, 200);
  assert.equal(kept.length, 200);
  assert.equal(kept[0].id, 'm60');
  assert.equal(kept[199].id, 'm259');
  assert.deepEqual(a.capHistory(null), []);
  assert.deepEqual(a.capHistory({}), []);
});

test('a saved chat read back: bad entries and damaged saves are skipped', () => {
  assert.deepEqual(a.parseHistory(null), []);
  assert.deepEqual(a.parseHistory('not json'), []);
  assert.deepEqual(a.parseHistory('{"a":1}'), []);
  const raw = JSON.stringify([msg(1), { id: 2, role: 'me', text: 'x' }, null, { id: 'z', role: 'admin', text: 'x' }, msg(2)]);
  assert.deepEqual(a.parseHistory(raw).map((m) => m.id), ['m1', 'm2']);
  assert.equal(a.parseHistory(JSON.stringify(Array.from({ length: 300 }, (_, i) => msg(i)))).length, 200);
});

test('Ask opens on the last 30 and loads 30 earlier at a time', () => {
  const all = Array.from({ length: 200 }, (_, i) => msg(i));
  assert.equal(a.ASK_PAGE, 30);
  const first = a.shownSlice(all, a.ASK_PAGE);
  assert.equal(first.length, 30);
  assert.equal(first[29].id, 'm199');
  assert.equal(a.earlierLabel(30, 200), 'Load 30 earlier messages');
  assert.equal(a.showMore(30, 200), 60);
  assert.equal(a.showMore(190, 200), 200);
  assert.equal(a.earlierLabel(190, 200), 'Load 10 earlier messages');
  assert.equal(a.earlierLabel(199, 200), 'Load 1 earlier message');
  assert.equal(a.earlierLabel(200, 200), '');
  assert.equal(a.shownSlice(all.slice(0, 5), 30).length, 5);
});

test('Clear chat asks first, in plain words', () => {
  assert.deepEqual(a.clearChatWords(1), { title: 'Clear chat?', message: 'This deletes the 1 message in Ask on this phone. The chat is only kept on this phone. This cannot be undone.', confirm: 'Clear chat' });
  assert.match(a.clearChatWords(120).message, /all 120 messages/);
});

test('Ask screen: a virtualized list of memoized rows, Load earlier and a Clear chat button', () => {
  const s = read('src/app/(tabs)/ask/index.tsx');
  assert.match(s, /<FlatList/);
  assert.match(s, /const MsgRow = memo\(function MsgRow/);
  assert.ok(!/const (CardView|Row|Count|Chip) = \(/.test(s), 'no components made inside the screen (they mounted again on every render)');
  assert.match(s, /data=\{view\}/);
  assert.match(s, /accessibilityLabel="Clear chat"/);
  assert.match(s, /confirmClearChat\(/);
  assert.ok(!/ask_chat_v1/.test(s), 'the key lives in lib/askChat.ts only');
  const more = read('src/app/(tabs)/settings/index.tsx');
  assert.match(more, /confirmClearChat\(askCount/);
  assert.match(more, /await clearAskChat\(\)/, 'Delete all my data clears the chat on screen too');
  const store = read('src/lib/askChat.ts');
  assert.match(store, /Alert\.alert\(w\.title, w\.message, \[\{ text: 'Cancel', style: 'cancel' \}, \{ text: w\.confirm, style: 'destructive'/);
});
