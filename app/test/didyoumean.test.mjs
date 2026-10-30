// Fares "Did you mean" (item 3 A, 26 Oct): a station name that is unclear (a slip, part of a name, a suburb with no
// station) gets a short list of the best real stops from our own station lists, with their modes, one tap each.
// Rule based, offline once the lists are kept, nothing guessed between close names and nothing made up.
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-dym-'));
const src = fs.readFileSync(path.join(here, '..', 'src/lib/askBrain.ts'), 'utf8');
fs.writeFileSync(path.join(out, 'b.mjs'), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const B = await import(pathToFileURL(path.join(out, 'b.mjs')).href);
const ST = path.join(here, '..', '..', 'backend', 'src', 'public', 'stations');
const list = (n) => JSON.parse(fs.readFileSync(path.join(ST, n + '.json'), 'utf8'));
const gaz = B.buildGaz({ train: list('train'), metro: list('metro'), lightrail: list('lightrail'), ferry: list('ferry'), places: list('places') });

// [typed, what should happen, the place expected]. pick: used as meant. opts: a Did you mean list (with the place in it
// when one is named), never a silent pick. none: nothing offered. From all over NSW.
const CASES = [
[
"Strathfeild",
"pick",
"Lidcombe Station"
],
[
"Kings",
"opts",
"Milsons Point Station"
],
[
"Richmond",
"pick",
"Richmond Station"
],
[
"Wynyard",
"pick",
"Wynyard Station"
],
[
"Parramtta",
"pick",
"Parramatta Station"
],
[
"hornsbey",
"pick",
"Hornsby Station"
],
[
"Chatswod",
"pick",
"Chatswood Station"
],
[
"Bondi Junc",
"pick",
"Bondi Junction Station"
],
[
"Newcastel",
"pick",
"Newcastle Interchange"
],
[
"Wollongng",
"pick",
"Wollongong Station"
],
[
"Penrth",
"pick",
"Penrith Station"
],
[
"Blacktwn",
"pick",
"Blacktown Station"
],
[
"Lindfeild",
"pick",
"Lindfield Station"
],
[
"Campbeltown",
"pick",
"Campbelltown Station"
],
[
"Gosfrod",
"pick",
"Gosford Station"
],
[
"Katoomba stn",
"pick",
"Katoomba Station"
],
[
"Martin Pl",
"pick",
"Martin Place Station"
],
[
"St Leonard",
"pick",
"St Leonards Station"
],
[
"Cronula",
"pick",
"Cronulla Station"
],
[
"Hurstvile",
"pick",
"Hurstville Station"
],
[
"Macquarie Uni",
"pick",
"Macquarie University Station"
],
[
"Olympic Prk",
"pick",
"Olympic Park Station"
],
[
"Sutherlnd",
"pick",
"Sutherland Station"
],
[
"Liverpol",
"pick",
"Liverpool Station"
],
[
"Bankstwon",
"pick",
"Bankstown Station"
],
[
"Mount Druitt",
"pick",
"Mount Druitt Station"
],
[
"Albury",
"pick",
"Albury Station"
],
[
"Dubbo",
"pick",
"Dubbo Station"
],
[
"Moss Vale",
"pick",
"Moss Vale Station"
],
[
"Thirrool",
"pick",
"Thirroul Station"
],
[
"Glenfeild",
"pick",
"Glenfield Station"
],
[
"Waterfal",
"pick",
"Waterfall Station"
],
[
"North",
"opts",
null
],
[
"Bondi",
"opts",
"Bondi Junction Station"
],
[
"Mona Vale",
"opts",
null
],
[
"Dee Why",
"opts",
null
],
[
"Castle Hill",
"pick",
"Castle Hill Station"
],
[
"Epping",
"pick",
"Epping Station"
],
[
"Circular Quay",
"pick",
"Circular Quay"
],
[
"Manly",
"pick",
"Manly Wharf"
],
[
"Tarongaa Zoo",
"pick",
"Taronga Zoo Wharf"
],
[
"Randwik",
"pick",
"Randwick Light Rail"
],
[
"Westmeed",
"pick",
"Westmead Station"
],
[
"Kingsgrove",
"pick",
"Kingsgrove Station"
],
[
"Kings Langly",
"opts",
"Kings Langley"
],
[
"Grenwich",
"pick",
"Greenwich Wharf"
],
[
"xyzzyq",
"none",
null
],
[
"Bathurts",
"pick",
"Bathurst Station"
],
[
"Tamworht",
"pick",
"Tamworth Station"
]
];

test('messy names across NSW: hit rate', () => {
  let hit = 0;
  const miss = [];
  for (const [q, want, name] of CASES) {
    const r = B.didYouMean(q, gaz);
    const ok = want === 'pick' ? !!r.pick && r.pick.name === name && !r.options.length
      : want === 'opts' ? !r.pick && r.options.length >= 2 && (!name || r.options.some((o) => o.name === name))
      : !r.pick && !r.options.length;
    if (ok) hit++; else miss.push([q, r.pick && r.pick.name, r.options.map((o) => o.name)]);
  }
  const rate = hit / CASES.length;
  console.log(`did you mean: ${hit} of ${CASES.length} (${Math.round(rate * 100)}%)`, miss.length ? JSON.stringify(miss) : '');
  assert.ok(CASES.length >= 40);
  assert.ok(rate >= 0.95, JSON.stringify(miss));
});

test('options: real stations with their modes, best first, at most 5; the suburb itself last', () => {
  const k = B.didYouMean('Kings', gaz);
  assert.equal(k.pick, undefined);
  assert.equal(k.options[0].name, 'Kings Cross Station');
  assert.equal(k.options[0].label, 'Kings Cross, Train');
  assert.ok(k.options.length <= 5);
  for (const o of k.options) assert.ok(gaz.list.some((e) => e.name === o.name), o.name + ' is a real place');
  assert.equal(B.didYouMean('Wynyard', gaz).pick.label, 'Wynyard, Train, Light rail');
  const fd = B.didYouMean('Mona Vale', gaz);
  assert.equal(fd.options[fd.options.length - 1].label, 'Mona Vale, any stop');
  assert.match(fd.options[0].label, /km from Mona Vale$/);
  assert.equal(B.didYouMean('Mona Vale suburb', gaz).pick.name, 'Mona Vale', 'the suburb choice resolves to the suburb');
  assert.deepEqual(B.didYouMean('xyzzyq', gaz), { options: [] });
  assert.deepEqual(B.didYouMean('Kings', null), { options: [] }, 'no lists yet: nothing offered here (the server answers)');
});

test('Ask: a fare question with an unclear name asks "Did you mean", a clear slip is used, each choice resolves', () => {
  const ctx = { now: Date.parse('2026-10-26T00:00:00Z'), gaz, places: {}, starred: [], recentTrips: [] };
  const u = B.understand('how much is it from Central to Kings', ctx);
  assert.equal(u.intent, 'clarify');
  assert.equal(u.clarify.text, 'Did you mean:');
  assert.equal(u.clarify.choices[0].label, 'Kings Cross, Train');
  const again = B.understand(u.clarify.choices[0].q, ctx);
  assert.equal(again.intent, 'fare');
  assert.equal(again.places.to.name, 'Kings Cross Station');
  const slip = B.understand('fare from Parramtta to Hornsbey', ctx);
  assert.equal(slip.intent, 'fare');
  assert.equal(slip.places.from.name, 'Parramatta Station');
  assert.equal(slip.places.to.name, 'Hornsby Station');
  const from = B.understand('opal fare from Kings to Central', ctx);
  assert.equal(from.intent, 'clarify');
  assert.equal(from.clarify.text, 'Leaving from? Did you mean:');
  assert.equal(B.understand(from.clarify.choices[0].q, ctx).places.from.name, 'Kings Cross Station');
});
