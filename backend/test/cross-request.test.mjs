// Requests in Cloudflare Workers may not wait on each other's promises (26 Oct, g28, docs/REVERSE_ENGINEERING.md).
// On wrangler dev (the same runtime as production) 9 of 10 identical first opens of a board, a trip, Nearby and the
// alerts failed with a 500: "Cannot perform I/O on behalf of a different request" or "the Workers runtime canceled
// this request because it detected that your Worker's code had hung". Node does not enforce this, so these tests
// check the rule in the source and the waiting helper's behaviour. backend/tools/local-burst.mjs runs the real
// burst against wrangler dev with tools/fake-nsw.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const worker = fs.readFileSync(root + "src/worker.js", "utf8");
const hub = fs.readFileSync(root + "src/livehub.js", "utf8");
const src = worker.replace(/export default\s*\{/, "const __default = {") + "\nexport { sharedJob, waitJob, joinJob, inFlight, feedMem };\n";
const tmp = `/tmp/xreq-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

test("no shared memo hands one request's promise to another", () => {
  const bad = [
    [/return hit\.promise/, "loadFeed returns the running fetch's promise"],
    [/hazMem\.promise\)/, "trafficHazards returns the running fetch's promise"],
    [/return shardMem\.get\(key\)/, "loadShard returns the running fetch's promise"],
    [/return plannerLegFlight\.get\(key\)/, "plannerLeg returns the running search's promise"],
    [/await liftMem\.p;/, "liftOutages awaits another request's promise"],
    [/inFlight\.set\(key\.url, flight\)/, "inFlight holds a raw promise"],
    [/await flight[;.]/, "a request awaits the shared flight directly"],
    [/Promise\.race\(\[flight,/, "a request races the shared flight directly"],
  ];
  for (const [re, why] of bad) {
    assert.equal(re.test(worker), false, "worker.js: " + why);
    assert.equal(re.test(hub), false, "livehub.js: " + why);
  }
  assert.match(worker, /inFlight\.set\(key\.url, job\)/);
  assert.match(hub, /joinJob\(job, SHARED_WAIT_MS\)/);
});

test("a job keeps its result as plain data once settled", async () => {
  let open; const p = new Promise((r) => { open = r; });
  const job = W.sharedJob(p);
  assert.equal(job.done, false);
  open({ status: 200, body: "{}" });
  await p; await null;
  assert.equal(job.done, true); assert.equal(job.ok, true);
  assert.deepEqual(job.value, { status: 200, body: "{}" });
});

test("joining waits on its own timers and gets the value", async () => {
  let open; const job = W.sharedJob(new Promise((r) => { open = r; }));
  setTimeout(() => open(42), 30);
  assert.equal(await W.joinJob(job, 2000), 42);
});

test("joining gets the job's error", async () => {
  let fail; const job = W.sharedJob(new Promise((_, j) => { fail = j; }));
  setTimeout(() => fail(new Error("Transport data answered 500")), 10);
  await assert.rejects(W.joinJob(job, 2000), /answered 500/);
});

test("waiting gives up after its own limit and the job carries on", async () => {
  let open; const job = W.sharedJob(new Promise((r) => { open = r; }));
  const t0 = Date.now();
  assert.equal(await W.waitJob(job, 60), false);
  assert.ok(Date.now() - t0 < 1000);
  await assert.rejects(W.joinJob(job, 20), /took too long/);
  open("late"); await null; await null;
  assert.equal(await W.joinJob(job, 100), "late");
});

test("a zero wait (watch and widget copies) answers at once", async () => {
  const job = W.sharedJob(new Promise(() => {}));
  const t0 = Date.now();
  assert.equal(await W.waitJob(job, 0), false);
  assert.ok(Date.now() - t0 < 50);
});
