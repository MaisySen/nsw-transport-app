// The old card pass (phones without trip flow 2, or the tripflow2 switch off) keeps the card code of server-211-rc
// 1d3fa14 exactly (LIVECARD_211, a frozen copy), so deploying trip flow 2 changes nothing for build 210 and 211 cards
// until the switch and the app update go together. Integrator check, 31 Oct 2026.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const src = fs.readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const A = "const LIVECARD_211 = (() => {", B = "// ---- live card 211 end";

test("the old card pass runs the frozen 211 card code, byte for byte", () => {
  const a = src.indexOf(A), b = src.indexOf(B);
  assert.ok(a > 0 && b > a, "frozen block present");
  const body = src.slice(a + A.length, b);
  assert.equal(crypto.createHash("sha256").update(body).digest("hex"), "d13a11d3270b64bffbdccc055da10da4d6d7ee14cd4e4d20762e5e2a2016c9c5");
});

test("laCardFor and the old push use LIVECARD_211, the trip flow 2 card uses LIVECARD", () => {
  const f = src.slice(src.indexOf("async function laCardFor("), src.indexOf("async function laCardFor(") + 1400);
  assert.match(f, /LIVECARD_211\.computeLive\(/);
  assert.match(f, /LIVECARD_211\.cardFor\(/);
  assert.doesNotMatch(f, /[^_]LIVECARD\.(computeLive|cardFor)\(/);
  const p = src.slice(src.indexOf("async function laPushOne("), src.indexOf("async function laPushOne(") + 2600);
  assert.match(p, /LIVECARD_211\.staleAt\(/);
  assert.match(src, /const r = LIVECARD\.tripRender\(/);
});
