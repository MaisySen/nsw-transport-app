// A cut-off or corrupted realtime feed must never hang the server (1 Nov, real-time harness F-NSWGARBAGE, server-214).
// Before this fix the feed reader's varint loop read past the end of the bytes: b[i] was undefined, `undefined < 128`
// is false, so the loop never ended. indexFeed of the 4 bytes [10, 127, 1, 2] never returned, and in production the
// Worker copy would spin until it was killed for CPU, failing every request and the minute's card and alert pushes.
// Now every read is bounds checked and an overrun throws "truncated feed", so loadFeed keeps the last good copy.
// Every parse here runs in a worker thread with a watchdog: a hang fails the test instead of hanging the suite.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Worker } from "node:worker_threads";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { __default, indexFeed, PB, readTripUpdate, readVehiclePosition, decodeAlerts, decodeFrom, loadFeed, feedMem, feedFresh, FEED_TTL_MS };\n";
const tmp = `/tmp/feed-truncated-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
after(() => { try { fs.unlinkSync(tmp); } catch {} });

const PER_CALL_MS = 50; // each parse must return or throw within this (measured inside the thread)
const HANG_MS = 1500; // a call still running after this is a hang: the thread is stopped and the test fails

// ---- a GTFS-realtime writer (synthetic data: made-up trip, stop and vehicle ids) ----
const varint = (n) => { const o = []; n = BigInt(n); if (n < 0n) n += 1n << 64n; do { let b = Number(n & 0x7fn); n >>= 7n; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const tag = (f, w) => varint((f << 3) | w);
const vint = (f, n) => [...tag(f, 0), ...varint(n)];
const bytes = (f, b) => [...tag(f, 2), ...varint(b.length), ...b];
const str = (f, s) => bytes(f, [...Buffer.from(s)]);
const f32 = (f, x) => { const b = Buffer.alloc(4); b.writeFloatLE(x, 0); return [...tag(f, 5), ...b]; };
const f64 = (f, x) => { const b = Buffer.alloc(8); b.writeDoubleLE(x, 0); return [...tag(f, 1), ...b]; };
const TS = 1793500000;
const tripDesc = (i) => [...str(1, `T${i}.9X.1.A`), ...str(2, "17:05:00"), ...str(3, "20261101"), ...vint(4, i % 3), ...str(5, `R${i}`)];
const tripUpdate = (i) => [
  ...bytes(1, tripDesc(i)),
  ...bytes(3, [...str(1, `V${i}`), ...str(2, `Set ${i}`)]),
  ...[1, 2, 3, 4].flatMap((k) => bytes(2, [...vint(1, k), ...bytes(2, [...vint(1, (k - 2) * 60), ...vint(2, TS + k * 120)]),
    ...bytes(3, [...vint(1, -30 * k), ...vint(2, TS + k * 120 + 30)]), ...str(4, `29901${i}${k}`), ...vint(5, k === 3 ? 1 : 0)])),
  ...vint(4, TS), ...vint(5, -45), ...f64(99, 1.5),
];
const vehicle = (i) => [
  ...bytes(1, tripDesc(i)),
  ...bytes(2, [...f32(1, -33.8 - i / 100), ...f32(2, 151.2 + i / 100), ...f32(3, 90), ...f32(5, 12.5)]),
  ...vint(3, 4), ...vint(4, 2), ...vint(5, TS), ...vint(6, 1), ...str(7, `29901${i}1`), ...bytes(8, [...str(1, `V${i}`)]), ...vint(9, 2),
  ...[1, 2, 3].flatMap((k) => bytes(18, [...str(2, `C${k}`), ...vint(3, k), ...vint(5, k)])),
  ...[1, 2].flatMap((k) => bytes(1007, [...str(1, `N${k}`), ...vint(2, k), ...vint(3, 1), ...vint(4, 1)])),
];
const header = () => bytes(1, [...str(1, "2.0"), ...vint(2, 0), ...vint(3, TS)]);
// One feed with trip updates and vehicle positions; `bounds` are the top-level field ends (a cut there is a whole feed).
function buildFeed() {
  const parts = [header()];
  for (let i = 1; i <= 6; i++) parts.push(bytes(2, [...str(1, `e${i}`), ...bytes(3, tripUpdate(i))]));
  for (let i = 1; i <= 4; i++) parts.push(bytes(2, [...str(1, `v${i}`), ...bytes(4, vehicle(i))]));
  const bounds = new Set([0]); let n = 0;
  for (const p of parts) { n += p.length; bounds.add(n); }
  return { buf: parts.flat(), bounds };
}
function buildAlerts() {
  const parts = [header()];
  for (let i = 1; i <= 3; i++) parts.push(bytes(2, [...str(1, `a${i}`), ...bytes(5, [...bytes(1, [...vint(1, TS), ...vint(2, TS + 3600)]),
    ...bytes(5, [...str(2, `R${i}`), ...str(5, `29901${i}`)]), ...vint(6, 1), ...vint(7, 4), ...bytes(10, bytes(1, str(1, `Alert ${i}`)))])]));
  const bounds = new Set([0]); let n = 0;
  for (const p of parts) { n += p.length; bounds.add(n); }
  return { buf: parts.flat(), bounds };
}
// Seeded garbage (mulberry32), so a failure names a buffer that can be made again.
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- the thread: runs each call, timing it, and writes the call it is in to shared memory for the watchdog ----
const THREAD = `
const { parentPort, workerData } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");
(async () => {
  const W = await import(workerData.mod);
  const prog = new Int32Array(workerData.sab);
  const results = [];
  for (let i = 0; i < workerData.cases.length; i++) {
    const c = workerData.cases[i];
    const buf = new Uint8Array(c.bytes);
    Atomics.store(prog, 0, i + 1);
    const t0 = performance.now();
    let out = "ok", err = null, trips = 0;
    try {
      if (c.call === "index-tu" || c.call === "index-vp") {
        const kind = c.call === "index-tu" ? "tu" : "vp";
        const r = W.indexFeed(buf, kind);
        const feed = { buf, idx: r.idx, kind, cache: new Map() };
        for (const id of r.idx.keys()) { W.decodeFrom(feed, id); trips++; }
      } else if (c.call === "tu") W.readTripUpdate(new W.PB(buf));
      else if (c.call === "vp") W.readVehiclePosition(new W.PB(buf));
      else if (c.call === "alerts") W.decodeAlerts(buf);
    } catch (e) { out = "threw"; err = String(e && e.message || e); }
    results.push({ i, out, err, trips, ms: performance.now() - t0 });
  }
  Atomics.store(prog, 0, -1);
  parentPort.postMessage(results);
})().catch((e) => parentPort.postMessage({ fatal: String(e && e.stack || e) }));
`;
// Runs the cases; resolves { results } or { hung: case } when one call runs past HANG_MS.
function runCases(cases) {
  return new Promise((resolve, reject) => {
    const sab = new SharedArrayBuffer(4);
    const prog = new Int32Array(sab);
    const w = new Worker(THREAD, { eval: true, workerData: { mod: tmp, sab, cases } });
    let last = 0, since = Date.now(), done = false;
    const timer = setInterval(() => {
      const cur = Atomics.load(prog, 0);
      if (cur !== last) { last = cur; since = Date.now(); return; }
      if (cur > 0 && Date.now() - since > HANG_MS) { done = true; clearInterval(timer); w.terminate(); resolve({ hung: { ...cases[cur - 1], index: cur - 1 } }); }
    }, 5);
    w.on("message", (m) => { if (done) return; done = true; clearInterval(timer); w.terminate(); if (m.fatal) reject(new Error(m.fatal)); else resolve({ results: m }); });
    w.on("error", (e) => { if (done) return; done = true; clearInterval(timer); reject(e); });
  });
}
const show = (c) => `${c.call} of ${c.label} (${c.bytes.length} bytes${c.bytes.length <= 24 ? ": [" + c.bytes.join(",") + "]" : ""})`;
function assertNoHang(r) { if (r.hung) assert.fail(`HANG: ${show(r.hung)} did not return or throw within ${HANG_MS} ms`); }
function assertFast(r, cases) {
  const slow = r.results.filter((x) => x.ms > PER_CALL_MS);
  assert.equal(slow.length, 0, slow.slice(0, 3).map((x) => `${show(cases[x.i])} took ${x.ms.toFixed(1)} ms`).join("; "));
}
const ALL = ["index-tu", "index-vp", "tu", "vp", "alerts"];

test("the 4-byte repro [10,127,1,2] throws 'truncated feed' instead of looping", async () => {
  const cases = ALL.map((call) => ({ call, label: "repro", bytes: [10, 127, 1, 2] }));
  const r = await runCases(cases);
  assertNoHang(r);
  assertFast(r, cases);
  for (const x of r.results.slice(0, 2)) assert.deepEqual([x.out, x.err], ["threw", "truncated feed"]);
});

test("every prefix of a multi-entity feed: a whole-field cut parses, any other cut throws 'truncated feed', none hangs", async () => {
  const { buf, bounds } = buildFeed();
  const cases = [];
  for (let n = 0; n <= buf.length; n++) for (const call of ["index-tu", "index-vp"]) cases.push({ call, label: `feed prefix ${n}/${buf.length}`, bytes: buf.slice(0, n), n });
  const r = await runCases(cases);
  assertNoHang(r);
  assertFast(r, cases);
  for (const x of r.results) {
    const c = cases[x.i];
    if (bounds.has(c.n)) assert.equal(x.out, "ok", `${show(c)} should parse: ${x.err}`);
    else assert.deepEqual([x.out, x.err], ["threw", "truncated feed"], show(c));
  }
  const whole = r.results.filter((x) => cases[x.i].n === buf.length);
  assert.deepEqual(whole.map((x) => x.trips), [6, 4], "the whole feed indexes 6 trip updates and 4 vehicles");
});

test("every prefix of a trip update, a vehicle position and an alerts feed: decoders return or throw, none hangs", async () => {
  const tu = tripUpdate(1), vp = vehicle(2), { buf: al } = buildAlerts();
  const cases = [];
  for (let n = 0; n <= tu.length; n++) cases.push({ call: "tu", label: `trip update prefix ${n}`, bytes: tu.slice(0, n) });
  for (let n = 0; n <= vp.length; n++) cases.push({ call: "vp", label: `vehicle prefix ${n}`, bytes: vp.slice(0, n) });
  for (let n = 0; n <= al.length; n++) cases.push({ call: "alerts", label: `alerts prefix ${n}`, bytes: al.slice(0, n) });
  const r = await runCases(cases);
  assertNoHang(r);
  assertFast(r, cases);
  const odd = r.results.filter((x) => x.out === "threw" && !/^(truncated feed|bad wire type \d+|bad feed varint)$/.test(x.err));
  assert.equal(odd.length, 0, odd.slice(0, 3).map((x) => `${show(cases[x.i])}: ${x.err}`).join("; "));
});

test("2,000 random garbage buffers (seed 20261101) through every reader: each returns or throws within 50 ms", async () => {
  const rand = rng(20261101);
  const { buf } = buildFeed();
  const cases = [];
  for (let k = 0; k < 2000; k++) {
    let bytes;
    if (k % 4 === 3) { // a real feed with a few bytes flipped: lengths that point anywhere
      bytes = buf.slice(0, 1 + Math.floor(rand() * buf.length));
      for (let j = 0; j < 1 + Math.floor(rand() * 4); j++) bytes[Math.floor(rand() * bytes.length)] = Math.floor(rand() * 256);
    } else {
      const n = 1 + Math.floor(rand() * (k % 2 ? 24 : 600));
      bytes = Array.from({ length: n }, () => (rand() < 0.5 ? 128 + Math.floor(rand() * 128) : Math.floor(rand() * 256)));
    }
    cases.push({ call: ALL[k % ALL.length], label: `garbage #${k}`, bytes });
    if (k % ALL.length === 0) cases.push({ call: "index-vp", label: `garbage #${k}`, bytes });
  }
  const r = await runCases(cases);
  assertNoHang(r);
  assertFast(r, cases);
  const odd = r.results.filter((x) => x.out === "threw" && !/^(truncated feed|bad wire type \d+|bad feed varint)$/.test(x.err));
  assert.equal(odd.length, 0, odd.slice(0, 3).map((x) => `${show(cases[x.i])}: ${x.err}`).join("; "));
});

// loadFeed with a cut-off body keeps the last good copy (its own time, so it ages out of live as before).
const LOADFEED = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const W = await import(workerData.mod);
  const good = new Uint8Array(workerData.good);
  let body = good;
  globalThis.fetch = async () => new Response(body, { status: 200 });
  const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;
  const path = "/v2/gtfs/realtime/sydneytrains";
  const first = await W.loadFeed({}, path, "tu");
  body = new Uint8Array(workerData.cut);
  skew = W.FEED_TTL_MS + 1000;
  let second, joined, err = null;
  // Two requests at once: the second joins the first one's fetch; both get the last good copy.
  try { [second, joined] = await Promise.all([W.loadFeed({}, path, "tu"), W.loadFeed({}, path, "tu")]); } catch (e) { err = String(e.message); }
  const row = W.feedFresh.get(path);
  W.feedMem.clear();
  let third = null;
  try { await W.loadFeed({}, path, "tu"); } catch (e) { third = String(e.message); }
  parentPort.postMessage({ sameCopy: second === first, joinedTrips: joined ? joined.idx.size : null, joinedAt: joined && joined.at, trips: second ? second.idx.size : null, firstAt: first.at, secondAt: second && second.at, err, servedOld: row.servedOld, lastErr: row.lastErr, third });
})().catch((e) => parentPort.postMessage({ fatal: String(e && e.stack || e) }));
`;
test("loadFeed: a cut-off feed answer keeps the last good copy for the request and any that joined it (same time, counted as served old); with no good copy it errors", async () => {
  const { buf } = buildFeed();
  const w = new Worker(LOADFEED, { eval: true, workerData: { mod: tmp, good: buf, cut: buf.slice(0, buf.length - 7) } });
  const m = await Promise.race([new Promise((res, rej) => { w.on("message", res); w.on("error", rej); }), new Promise((res) => setTimeout(() => res({ hung: true }), 5000))]);
  await w.terminate();
  assert.ok(!m.hung, "HANG: loadFeed did not answer within 5 s on a cut-off feed");
  assert.ok(!m.fatal, m.fatal);
  assert.equal(m.err, null);
  assert.equal(m.sameCopy, true, "the last good copy is served");
  assert.equal(m.trips, 6);
  assert.equal(m.secondAt, m.firstAt, "with its own (older) time, so it is not passed off as fresh");
  assert.equal(m.joinedTrips, 6, "a request that joined the failed fetch gets the last good copy too");
  assert.equal(m.joinedAt, m.firstAt);
  assert.equal(m.servedOld, 2);
  assert.equal(m.lastErr, "truncated feed");
  assert.equal(m.third, "truncated feed", "no good copy: the request sees the error (and realtimeFor falls back to timetable)");
});
