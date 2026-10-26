// Transport for NSW answering 200 with a page that is not JSON (an HTML maintenance or gateway page) or with "null"
// (26 Oct, g28, docs/REVERSE_ENGINEERING.md). Before, tp() parsed it as an answer: the JSON parse threw or the board read
// properties of null, the error did not look like an outage, so the phone got "Something went wrong on our side" (502)
// and no timetable board or kept copy stood in. Now such an answer counts as the hub being down (answered 502).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/ttplan.js", "utf8") + "\nexport { __default, tp, ttUpstreamDown };\n";
const tmp = `/tmp/notjson-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

let answer = () => new Response("{}", { status: 200 });
globalThis.fetch = async () => answer();
const stmt = () => ({ bind: () => stmt(), run: async () => ({}), all: async () => ({ results: [] }), first: async () => null });
const env = { TFNSW_API_KEY: "t", DB: { prepare: stmt, batch: async (l) => l.map(() => ({})) }, ASSETS: { fetch: async () => new Response("[]") } };
let ip = 1;
const call = (p) => W.__default.fetch(new Request("https://t.example" + p, { headers: { "cf-connecting-ip": "10.7.0." + (ip++) } }), env, { waitUntil() {} });

const pages = [
  ["an HTML page", () => new Response("<html><body>Service temporarily unavailable</body></html>", { status: 200, headers: { "content-type": "text/html" } })],
  ["null", () => new Response("null", { status: 200, headers: { "content-type": "application/json" } })],
  ["cut off JSON", () => new Response('{"stopEvents":[{"transportation":', { status: 200, headers: { "content-type": "application/json" } })],
];

for (const [name, page] of pages) {
  test(`tp() takes ${name} as the hub being down`, async () => {
    answer = page;
    await assert.rejects(W.tp(env, "departure_mon", { name_dm: "200060" }), (e) => /Transport data answered 502/.test(e.message) && W.ttUpstreamDown(e));
  });
}

test("a board over a hub answering an HTML page says Transport for NSW, not our side", async () => {
  answer = pages[0][1];
  const r = await call("/api/departures?stop=2000441&mode=train&count=3");
  const b = await r.json();
  assert.notEqual(r.status, 500);
  assert.equal(b.upstream, true, JSON.stringify(b).slice(0, 200));
  assert.doesNotMatch(String(b.text || ""), /our side/);
});

test("a good JSON answer still parses", async () => {
  answer = () => new Response(JSON.stringify({ stopEvents: [] }), { status: 200, headers: { "content-type": "application/json" } });
  assert.deepEqual(await W.tp(env, "departure_mon", { name_dm: "200060" }), { stopEvents: [] });
});
