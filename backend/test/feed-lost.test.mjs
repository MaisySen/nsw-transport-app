// A realtime feed fetch the runtime dropped must not block the feed for the life of the server copy (26 Oct, g28,
// docs/REVERSE_ENGINEERING.md). realtimeFor waits FEED_WAIT_MS (2.5 s) for a feed; a slower fetch went on after the
// request that started it had answered, the runtime dropped it, and its unsettled promise stayed in feedMem. On
// wrangler dev every later board in that copy waited 2.5 s and never got a fresh feed (8 s feed answer once, then 0
// feed fetches and 2.55 s per board, minutes later). Now the fetch is kept with waitUntil, and a fetch still running
// after FEED_JOB_MAX_MS is asked again.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { __default, loadFeed, feedMem, FEED_JOB_MAX_MS, reqKeep, reqStore };\n";
const tmp = `/tmp/feedlost-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

let calls = 0, hang = true;
globalThis.fetch = async () => {
  calls++;
  if (hang) return new Promise(() => {}); // dropped by the runtime: never settles
  return new Response(new Uint8Array(0), { status: 200 });
};
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;

test("a feed fetch that never settles is asked again after FEED_JOB_MAX_MS", async () => {
  W.feedMem.clear(); calls = 0; hang = true;
  const path = "/v2/gtfs/realtime/sydneytrains";
  const first = await Promise.race([W.loadFeed({}, path, "tu"), new Promise((r) => setTimeout(() => r("gave up"), 50))]);
  assert.equal(first, "gave up");
  assert.equal(calls, 1);
  // A second request soon after joins the same fetch (no new call).
  const second = await Promise.race([W.loadFeed({}, path, "tu").catch(() => "err"), new Promise((r) => setTimeout(() => r("gave up"), 50))]);
  assert.equal(second, "gave up");
  assert.equal(calls, 1, "one fetch while it may still answer");
  // Past FEED_JOB_MAX_MS the lost fetch is asked again and the fresh answer is used.
  skew = W.FEED_JOB_MAX_MS + 1000; hang = false;
  const third = await W.loadFeed({}, path, "tu");
  assert.equal(calls, 2, "asked again");
  assert.ok(third && third.buf, "a fresh feed");
  skew = 0;
});

test("the request that starts a feed fetch keeps it alive with waitUntil", async () => {
  W.feedMem.clear(); calls = 0; hang = false;
  const kept = [];
  const exec = { waitUntil: (p) => kept.push(p) };
  await W.reqStore.run({ up: 0, n: 0, exec }, () => W.loadFeed({}, "/v2/gtfs/vehiclepos/metro", "vp"));
  assert.equal(kept.length, 1);
});
