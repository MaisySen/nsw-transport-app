// Ask tab: checks the chat files, the tab bar entry, the route and the /api/ask v2 block.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const root = new URL("..", import.meta.url).pathname;
const read = (p) => fs.readFileSync(root + p, "utf8");

test("Ask tab is wired into the web app", () => {
  const html = read("src/public/index.html");
  assert.ok(html.includes('data-tab="ask"') && html.includes('href="#/chat"'), "tab bar entry");
  assert.ok(html.includes("/ask.js") && html.includes("/ask.css"), "assets linked");
  assert.ok(read("src/public/app.js").includes('path === "/chat"'), "route");
  const js = read("src/public/ask.js");
  for (const s of ["Next train Burwood to Central", "Is the T1 late", "Last train home", "/api/ask?"]) assert.ok(js.includes(s), s);
});

test("ask v2 answers with reply, cards and links", () => {
  const w = read("src/worker.js");
  for (const s of ["async function askV2", "d.reply = reply; d.cards = cards; d.links = links", "lineStatus", "routeAt", "lastService"]) assert.ok(w.includes(s), s);
});

test("no em or en dashes in the Ask files", () => {
  for (const p of ["src/public/ask.js", "src/public/ask.css", "test/ask.test.mjs", "tools/build_places.py"]) assert.ok(!/[\u2013\u2014]/.test(read(p)), p);
  const w = read("src/worker.js");
  const block = w.slice(w.indexOf("// ---- ask v2 start"), w.indexOf("// ---- ask v2 end"));
  assert.ok(block.length > 1000 && !/[\u2013\u2014]/.test(block));
});

// ---- place resolution and phrasing, run offline ----
// The worker is loaded as a module with its Ask functions exported. Transport for NSW stop
// search answers come from test/fixtures/stopfinder.json (recorded from the live API), and trip
// requests are captured so the test can check the origin, destination and via sent upstream.
async function loadAsk() {
  let src = read("src/worker.js").replace(/export default\s*\{/, "const __default = {");
  src += "\nexport { askV2, askPlace, askParseTrip };\n";
  const tmp = `/tmp/ask-test-${process.pid}-${Date.now()}.mjs`;
  fs.writeFileSync(tmp, src);
  try { return await import(tmp); } finally { fs.unlinkSync(tmp); }
}
const fixtures = JSON.parse(read("test/fixtures/stopfinder.json"));
const tripCalls = [];
globalThis.fetch = async (u) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (url.pathname.endsWith("/stop_finder")) return new Response(JSON.stringify(fixtures[url.searchParams.get("name_sf")] || { locations: [] }));
  if (url.pathname.endsWith("/trip")) { tripCalls.push(Object.fromEntries(url.searchParams)); return new Response(JSON.stringify({ journeys: [] })); }
  return new Response("{}", { status: 404 });
};
const env = {
  TFNSW_API_KEY: "test",
  ASSETS: { fetch: async (req) => { const p = root + "src/public" + new URL(req.url).pathname; return fs.existsSync(p) ? new Response(fs.readFileSync(p)) : new Response("", { status: 404 }); } },
};
const ask = await loadAsk();

const PARSE = [["to campsie to newcastle via chatswood", true, ["campsie", "newcastle", "chatswood"]], ["campsie to newcastle", false, ["campsie", "newcastle", null]], ["from campsie to newcastle", false, ["campsie", "newcastle", null]], ["to newcastle from campsie", true, ["campsie", "newcastle", null]], ["newcastle from campsie", false, ["campsie", "newcastle", null]], ["campsie via chatswood to newcastle", false, ["campsie", "newcastle", "chatswood"]], ["campsie to newcastle via chatswood", false, ["campsie", "newcastle", "chatswood"]], ["from campsie via chatswood to newcastle", false, ["campsie", "newcastle", "chatswood"]], ["to newcastle via chatswood from campsie", true, ["campsie", "newcastle", "chatswood"]], ["campsie to newcastle through strathfield", false, ["campsie", "newcastle", "strathfield"]], ["liverpool to campbelltown by train", false, ["liverpool", "campbelltown", null]], ["burwood > central", false, ["burwood", "central", null]], ["burwood -> central", false, ["burwood", "central", null]], ["to bondi junction", true, [null, "bondi junction", null]], ["newcastle via chatswood", false, [null, "newcastle", "chatswood"]], ["penrith to katoomba changing at blacktown", false, ["penrith", "katoomba", "blacktown"]]];
test("trip phrasings split into from, to and via", () => {
  for (const [s, travel, [from, to, via]] of PARSE) {
    const p = ask.askParseTrip(s, travel);
    assert.ok(p, s);
    assert.deepEqual([p.from, p.to, p.via], [from, to, via], s);
  }
  assert.equal(ask.askParseTrip("is the T1 late", false), null);
});

// Expected: a stop id, an exact name, "suburb:Name", "stop:part of name", "poi:part of name",
// "ambiguous" (Did you mean choices) or null (not found).
const PLACES = {
"campsie": "219410",
"newcastle": "229310",
"chatswood": "206710",
"campsei": "219410",
"newcasle": "229310",
"CAMPSIE": "219410",
"Campsie Station": "219410",
"campsie stn": "219410",
"strathfeild": "Strathfield Station",
"parramata": "Parramatta Station",
"chatwood": "206710",
"hornsbey": "Hornsby Station",
"manly": "Manly Wharf",
"st leonards": "St Leonards Station",
"saint leonards": "St Leonards Station",
"mount druitt": "Mount Druitt Station",
"mt druitt": "Mount Druitt Station",
"the entrance": "suburb:The Entrance",
"coogee": "suburb:Coogee",
"bondi": "suburb:Bondi",
"bondi junction": "Bondi Junction Station",
"the city": "200060",
"sydney": "200060",
"cbd": "200060",
"airport": "ambiguous",
"uni": "ambiguous",
"opera house": "Circular Quay",
"unsw": "UNSW Anzac Parade Light Rail",
"macquarie uni": "Macquarie University Station",
"orange": "Orange Station",
"waterloo": "Waterloo Station",
"the rocks": "suburb:The Rocks",
"rocks": "ambiguous",
"parra": "Parramatta Station",
"olympic park": "Olympic Park Station",
"newcastle interchange": "229310",
"Newcastle Airport": "stop:Newcastle Airport",
"chan chan peruvian cantina": "poi:Chan Chan",
"zzqqx": null,
"domestic airport": "202020",
"international airport": "202030",
"central": "200060",
"town hall": "200070",
"circular quay": "Circular Quay",
"surry hills": "Surry Hills Light Rail",
"penrith": "Penrith Station",
"katoomba": "Katoomba Station",
"gosford": "Gosford Station",
"bathurst": "Bathurst Station"
};
test("bare suburbs and stations resolve to the station or suburb, never a business", async () => {
  for (const [q, exp] of Object.entries(PLACES)) {
    const g = await ask.askPlace(env, q, "https://local");
    if (exp === null) { assert.equal(g, null, q); continue; }
    if (exp === "ambiguous") { assert.ok(g && g.ambiguous && g.options.length >= 2 && g.options.length <= 5, q); continue; }
    assert.ok(g && !g.ambiguous, q + " resolved");
    const [k, v] = exp.includes(":") ? exp.split(/:(.*)/) : [null, exp];
    if (k === "suburb") assert.ok(g.suburb && g.name === v, `${q} -> ${g.name}`);
    else if (k === "stop" || k === "poi") assert.ok(g.name.includes(v), `${q} -> ${g.name}`);
    else assert.ok(g.id === v || g.name === v, `${q} -> ${g.id} ${g.name}`);
    if (k !== "poi") assert.ok(g.type !== "poi", `${q} must not be a business`);
  }
});

test("Bidur's sentence plans Campsie to Newcastle Interchange via Chatswood", async () => {
  tripCalls.length = 0;
  const d = await ask.askV2(env, "I need to go to campsie to newcastle via chatswood", { origin: "https://local" });
  assert.equal(d.kind, "trip");
  assert.equal(tripCalls.length, 1);
  assert.equal(tripCalls[0].name_origin, "219410");
  assert.equal(tripCalls[0].name_destination, "229310");
  assert.equal(tripCalls[0].name_via, "206710");
  assert.deepEqual(d.understood, { from: "Campsie Station", to: "Newcastle Interchange", via: "Chatswood Station" });
  assert.ok(d.reply.startsWith("Campsie Station to Newcastle Interchange via Chatswood."), d.reply);
  assert.ok(!/Chan Chan|Troy St/.test(JSON.stringify(d)));
});

test("typos and other phrasings reach the same trip", async () => {
  for (const q of ["campsei to newcasle via chatswood", "to Newcastle via Chatswood from Campsie", "from Campsie Station via Chatswood to Newcastle Interchange", "how do I get to newcastle from campsie via chatswood", "CAMPSIE TO NEWCASTLE VIA CHATSWOOD"]) {
    tripCalls.length = 0;
    const d = await ask.askV2(env, q, { origin: "https://local" });
    assert.equal(d.kind, "trip", q);
    assert.deepEqual([tripCalls[0].name_origin, tripCalls[0].name_destination, tripCalls[0].name_via], ["219410", "229310", "206710"], q);
  }
});

test("unclear places get Did you mean choices instead of a guess", async () => {
  for (const q of ["central to uni", "airport to central", "rocks to central"]) {
    tripCalls.length = 0;
    const d = await ask.askV2(env, q, { origin: "https://local" });
    assert.equal(d.kind, "didYouMean", q);
    assert.equal(tripCalls.length, 0, q + " must not plan a trip");
    assert.ok(d.reply.includes("Did you mean") && d.suggestions.length >= 2, q);
  }
  const d = await ask.askV2(env, "airport to central", { origin: "https://local" });
  assert.ok(d.suggestions.includes("International Airport to Central Station"), d.suggestions.join(" | "));
  const z = await ask.askV2(env, "campsie to zzqqx", { origin: "https://local" });
  assert.equal(z.kind, "text");
  assert.ok(z.reply.includes("couldn't find"));
});
