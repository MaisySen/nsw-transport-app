// Request words used as keys in plain tables (26 Oct, g28, docs/REVERSE_ENGINEERING.md): "constructor" or "__proto__"
// read Object.prototype, so /api/search?q=constructor and /api/service?mode=__proto__ answered 502, and a bad
// planned time on /api/predict threw "Invalid time value" (502). Found by the hostile input pass on wrangler dev.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { __default, idxKey, feedKey, feedKeys, tripModesParse, own };\n";
const tmp = `/tmp/protokeys-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
globalThis.fetch = async () => new Response("{}", { status: 503 });
const stmt = () => ({ bind: () => stmt(), run: async () => ({}), all: async () => ({ results: [] }), first: async () => null });
const env = { TFNSW_API_KEY: "t", DB: { prepare: stmt, batch: async (l) => l.map(() => ({})) }, ASSETS: { fetch: async () => new Response("[]") } };
const call = (p) => W.__default.fetch(new Request("https://t.example" + p, { headers: { "cf-connecting-ip": "10.8.0.1" } }), env, { waitUntil() {} });

for (const word of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
  test(`"${word}" is an ordinary word`, () => {
    assert.equal(typeof W.idxKey(word), "string");
    assert.equal(W.feedKey(word, "T1"), null);
    assert.deepEqual(W.feedKeys(word, "T1", word), []);
    assert.deepEqual(W.tripModesParse(word + ",train"), ["train"]);
  });
}

test("a known mode and feed still map", () => {
  assert.equal(W.feedKey("train", "T1"), "train");
  assert.deepEqual(W.feedKeys("bus", "333", "nswtrains"), ["nswtrains"]);
  assert.equal(W.own({ a: 1 }, "a"), true);
  assert.equal(W.own({}, "constructor"), false);
});

test("predict answers 400 for a planned time that is not a time", async () => {
  for (const v of ["garbage", "NaN", "__proto__", "99999999999999999999"]) {
    const r = await call("/api/predict?line=T1&stop=200060&planned=" + encodeURIComponent(v));
    assert.equal(r.status, 400, v);
  }
});
