// Alert words without web code on the server too (item 3 B): planner alert titles, the alerts list, facilities and
// GTFS alert headers all go through plainText.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const code = fs.readFileSync(root + "src/worker.js", "utf8");
const src = code.replace(/export default\s*\{/, "const __default = {") + "\nexport { plainText, facStrip };\n";
const tmp = `/tmp/alert-text-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

test("plainText: links keep their words, entities decode, encoded and cut off tags go, no dashes", () => {
  assert.equal(W.plainText('<a href="https://transportnsw.info/regional-bookings/" target="_blank">Book your seat with NSW TrainLink</a>'), "Book your seat with NSW TrainLink");
  assert.equal(W.plainText("Buses replace trains &lt;b&gt;this weekend&lt;/b&gt; &amp; more"), "Buses replace trains this weekend & more");
  assert.equal(W.plainText("It&#8217;s on"), "It\u2019s on");
  assert.equal(W.plainText('Allow extra time <a href="https://transportnsw.info/al'), "Allow extra time");
  assert.equal(W.plainText("Central \u2013 Bondi"), "Central, Bondi");
  assert.equal(W.facStrip("<p>Lift 2</p> &nbsp;out"), "Lift 2 out");
});

test("every alert source uses it", () => {
  assert.match(code, /const strip = plainText;/);
  assert.match(code, /h: plainText\(a\.header\)/);
  assert.match(code, /title: plainText\(i\.subtitle/);
});
