// Ask tab: checks the chat files, the tab bar entry, the route and the /api/ask block.
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

test("ask answers with reply, cards and links", () => {
  const w = read("src/worker.js");
  for (const s of ["async function askV2", "d.reply = reply; d.cards = cards; d.links = links", "lineStatus", "routeAt", "lastService"]) assert.ok(w.includes(s), s);
});

test("no em or en dashes in the Ask files", () => {
  for (const p of ["src/public/ask.js", "src/public/ask.css", "test/ask.test.mjs", "tools/build_places.py"]) assert.ok(!/[\u2013\u2014]/.test(read(p)), p);
  const w = read("src/worker.js");
  const block = w.slice(w.indexOf("// ---- ask start"), w.indexOf("// ---- ask end"));
  assert.ok(block.length > 1000 && !/[\u2013\u2014]/.test(block));
});

// ---- place resolution and phrasing, run offline ----
// The worker is loaded as a module with its Ask functions exported. Transport for NSW stop
// search answers come from test/fixtures/stopfinder.json (recorded from the live API), and trip
// requests are captured so the test can check the origin, destination and via sent upstream.
async function loadAsk() {
  let src = read("src/worker.js").replace(/export default\s*\{/, "const __default = {");
  src += "\nexport { askV2, askPlace, askParseTrip, askDecorate };\n";
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

// ---- several stops in one question ----
const MULTI = [
  "campsie to hornsby via central and chatswood",
  "campsie to hornsby via central via chatswood",
  "campsie to hornsby via central, chatswood",
  "campsie to hornsby changing at central and chatswood",
  "campsie to hornsby stopping at central and chatswood",
  "campsie via central and chatswood to hornsby",
  "campsie then central then chatswood then hornsby",
  "campsie, central, chatswood, hornsby",
  "campsie to central to chatswood to hornsby",
  "campsie > central > chatswood > hornsby",
  "campsie to central then chatswood then hornsby",
  "from campsie to hornsby via central and then chatswood",
];
test("multi stop phrasings split into from, stops and to", () => {
  for (const s of MULTI) {
    const p = ask.askParseTrip(s, false);
    assert.ok(p, s);
    assert.deepEqual([p.from, p.stops, p.to, p.via], ["campsie", ["central", "chatswood"], "hornsby", null], s);
  }
  // One stop keeps the single via path.
  for (const s of ["campsie to newcastle via chatswood", "to campsie to newcastle via chatswood", "campsie then chatswood then newcastle"]) {
    const p = ask.askParseTrip(s, false);
    assert.deepEqual([p.from, p.via, p.to], ["campsie", "chatswood", "newcastle"], s);
  }
  assert.deepEqual(ask.askParseTrip("campsie then hornsby", false).stops, []);
  assert.deepEqual(ask.askParseTrip("newcastle via central and chatswood", false).stops, ["central", "chatswood"]);
  assert.deepEqual(ask.askParseTrip("campsie to hornsby via central, chatswood and epping", false).stops, ["central", "chatswood", "epping"]);
});

test("a multi stop question plans every leg, never one merged name", async () => {
  for (const q of ["campsie to hornsby via central and chatswood", "campsie then central then chatswood then hornsby", "Campsie, Central, Chatswood, Hornsby"]) {
    tripCalls.length = 0;
    const d = await ask.askV2(env, q, { origin: "https://local" });
    assert.equal(d.kind, "trip", q);
    assert.ok(d.chain, q);
    assert.deepEqual(d.plan.map((l) => [l.f, l.t]), [["219410", "200060"], ["200060", "206710"], ["206710", d.to.id]], q);
    assert.equal(d.to.name, "Hornsby Station", q);
    assert.deepEqual(d.understood.stops, ["Central Station", "Chatswood Station"], q);
    assert.equal(tripCalls[0].name_origin, "219410", q);
    assert.equal(tripCalls[0].name_destination, "200060", q);
    assert.ok(!tripCalls.some((c) => c.name_via), "no single via sent upstream");
    assert.ok(d.reply.startsWith("Campsie Station to Hornsby Station via Central and Chatswood."), d.reply);
    assert.ok(d.reply.includes("Campsie > Central > Chatswood > Hornsby"), d.reply);
    assert.ok(!/Chatswood Central|didYouMean/.test(JSON.stringify(d)), q);
    const open = d.links.find((l) => l.label === "Open trip"), save = d.links.find((l) => l.label === "Save trip");
    assert.ok(open && save, "Open trip and Save trip");
    const legs = JSON.parse(open.legs);
    assert.deepEqual(legs.map((l) => l.to.name), ["Central Station", "Chatswood Station", "Hornsby Station"]);
    assert.ok(open.href.startsWith("#/trip?") && open.href.includes("legs="));
    assert.equal(save.kind, "saveTrip");
    assert.ok(save.href.includes("save=1"));
    assert.deepEqual(d.suggestions, ["Hornsby Station to Campsie Station via Chatswood and Central"]);
  }
});

test("multi stop: unclear stop asks, missing start asks, too many legs says so", async () => {
  const a = await ask.askV2(env, "airport to hornsby via central and chatswood", { origin: "https://local" });
  assert.equal(a.kind, "didYouMean");
  assert.ok(a.suggestions.includes("International Airport to Hornsby Station via Central Station and Chatswood Station"), a.suggestions.join(" | "));
  const n = await ask.askV2(env, "newcastle via central and chatswood", { origin: "https://local" });
  assert.equal(n.kind, "needOrigin");
  assert.ok(n.reply.includes("via Central and Chatswood"), n.reply);
  const r = await ask.askV2(env, "campsie to central to central to hornsby", { origin: "https://local" });
  assert.equal(r.kind, "text");
  assert.ok(r.reply.includes("twice in a row"), r.reply);
  const many = await ask.askV2(env, "campsie, central, chatswood, epping, hornsby, gosford, newcastle, maitland", { origin: "https://local" });
  assert.equal(many.kind, "text");
  assert.ok(many.reply.includes("up to 6 legs"), many.reply);
});

test("the single via trip opens and saves as a two leg trip", async () => {
  const d = await ask.askV2(env, "I need to go to campsie to newcastle via chatswood", { origin: "https://local" });
  assert.ok(!d.chain);
  const open = d.links.find((l) => l.label === "Open trip");
  assert.equal(open.via, "206710");
  assert.deepEqual(JSON.parse(open.legs).map((l) => [l.from.id, l.to.id]), [["219410", "206710"], ["206710", "229310"]]);
  assert.ok(d.links.some((l) => l.kind === "saveTrip"));
});

test("multi stop reply lists each leg, the changes, total time and arrival", () => {
  const at = (m) => new Date(Date.now() + m * 60000).toISOString();
  const leg = (seg, line, from, dep, arr, transfer) => ({ kind: "transit", seg, line, mode: "train", from, fromPlatform: "Platform 1", to: "x", planned: at(dep), estimated: at(dep), arrPlanned: at(arr), arrEstimated: at(arr), realtime: true, delayMin: 0, cancelled: false, ...(transfer ? { transfer } : {}) });
  const P = (id, name) => ({ id, name, station: true });
  const d = {
    kind: "trip", chain: true, from: P("219410", "Campsie Station"), to: P("207720", "Hornsby Station"), stops: [P("200060", "Central Station"), P("206710", "Chatswood Station")],
    plan: [{ f: "219410", fn: "Campsie Station", t: "200060", tn: "Central Station", m: "", c: 5 }, { f: "200060", fn: "Central Station", t: "206710", tn: "Chatswood Station", m: "", c: 5 }, { f: "206710", fn: "Chatswood Station", t: "207720", tn: "Hornsby Station", m: "", c: 5 }],
    understood: { from: "Campsie Station", to: "Hornsby Station", via: null, stops: ["Central Station", "Chatswood Station"] }, fallback: [false, false, false],
    journeys: [{ leave: at(5), arrive: at(62), durationMin: 57, changes: 2, legs: [
      leg(0, "T3", "Campsie Station", 5, 22),
      leg(1, "T1", "Central Station", 28, 45, { minutes: 6, conn: 5, at: "Central", risk: "ok", chain: true }),
      leg(2, "T9", "Chatswood Station", 47, 62, { minutes: 2, conn: 5, at: "Chatswood", risk: "tight", chain: true }),
    ], warn: "Tight change at Chatswood: 2 min" }],
  };
  const r = ask.askDecorate(d, {});
  const lines = r.reply.split("\n");
  assert.equal(lines[1], "Campsie > Central > Chatswood > Hornsby");
  assert.ok(lines[2].startsWith("1. T3 from Campsie Station, Plat 1 at "), lines[2]);
  assert.ok(lines.includes("Change at Central: 6 min"), r.reply);
  assert.ok(lines.includes("Change at Chatswood: 2 min, tight"), r.reply);
  assert.ok(lines.some((l) => l.startsWith("3. T9 from Chatswood Station")), r.reply);
  assert.ok(/^Total 57 min, arriving Hornsby /.test(lines[lines.length - 1]), r.reply);
  assert.equal(r.cards[0].journeys[0].warn, "Tight change at Chatswood: 2 min");
  assert.ok(!/[\u2013\u2014]/.test(r.reply));
});
