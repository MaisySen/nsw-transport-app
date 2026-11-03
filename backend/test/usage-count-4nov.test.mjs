// Usage double count (3 Nov live check): a minute tick counted every upstream call made since it started, while the
// prewarm and warmBoards answers inside it (answerAndStore, handleRequest, afterAnswer) had already flushed part of
// them into the usage table. The table read about 44 a tick against about 28 real calls, so the 40,000 pre-load cap
// stopped warming boards every afternoon. Now the tick counts only what was not flushed. No NSW calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./helpers/d1.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") +
  "\nexport { __default, upstream, tickCalls, afterAnswer, bumpUsage, usageToday, ensureSchema3 };\n";
const tmp = `/tmp/usage-count-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
globalThis.fetch = async () => { throw new Error("no NSW calls in this test"); };
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
// One database for the file: the schema is set up once per isolate, as on Cloudflare.
const env = { DB: makeD1() };
await W.ensureSchema3(env);
const tableCalls = async () => (await W.usageToday(env)).calls || 0;

// One tick as runTick counts it: c0 at the start, calls made, prewarm answers flushed by afterAnswer, then the end.
async function tick(env, steps) {
  const c0 = W.upstream.calls;
  for (const s of steps) {
    if (s.calls) W.upstream.calls += s.calls;
    if (s.answer) {
      const waits = [];
      await W.afterAnswer(env, { kind: "status" }, { exec: { waitUntil: (p) => waits.push(p) }, log: false });
      await Promise.all(waits);
    }
  }
  const calls = W.tickCalls(c0);
  await W.bumpUsage(env, { calls, ticks: 1 });
  return calls;
}

test("a tick whose prewarm answers flushed some calls adds only the rest; the table equals the real calls", async () => {
  const before = await tableCalls();
  W.upstream.calls = 1000; W.upstream.flushed = 1000;
  // 12 calls (watches, sampling), a prewarm answer flushes them, 10 more calls, another answer, 6 more after.
  const added = await tick(env, [{ calls: 12 }, { answer: true }, { calls: 10 }, { answer: true }, { calls: 6 }]);
  assert.equal(added, 6);
  assert.equal(await tableCalls() - before, 28, "usage table gains 28, the real number, not 12 + 10 + 28");
  assert.equal(W.upstream.flushed, W.upstream.calls);
});

test("a tick with no answer inside counts all its calls once; the next tick starts clean", async () => {
  const before = await tableCalls();
  W.upstream.calls = 50; W.upstream.flushed = 50;
  assert.equal(await tick(env, [{ calls: 9 }]), 9);
  assert.equal(await tick(env, [{ calls: 4 }, { answer: true }]), 0);
  assert.equal(await tick(env, [{ calls: 3 }]), 3);
  assert.equal(await tableCalls() - before, 16);
});

test("a request answered in the same isolate during a tick flushes its own and the tick's calls once", async () => {
  const before = await tableCalls();
  W.upstream.calls = 7; W.upstream.flushed = 7;
  // The tick makes 5, a user request makes 2 and its afterAnswer flushes all 7, the tick makes 1 more.
  const added = await tick(env, [{ calls: 5 }, { calls: 2 }, { answer: true }, { calls: 1 }]);
  assert.equal(added, 1);
  assert.equal(await tableCalls() - before, 8);
});

test("calls made before the tick and never flushed stay out of this tick's count, as before", () => {
  W.upstream.calls = 200; W.upstream.flushed = 190;
  const c0 = W.upstream.calls;
  W.upstream.calls += 4;
  assert.equal(W.tickCalls(c0), 4);
  assert.equal(W.upstream.flushed, 204);
});
