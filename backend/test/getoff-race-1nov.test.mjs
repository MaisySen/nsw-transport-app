// Get off now timing race (1 Nov 2026, real-time harness S17a/S17b, files/day-1nov/rt-fix-harness.md). When the live
// arrival moved in the same second as the Get off now timer, the alert rang on the arrival from before the move (S17a: 160 s
// early, then "Held") or not at all (S17b: the 15 s read took a copy fetched 14.7 s earlier, missed the earlier arrival, and
// the timer then found the train at the stop). Both came from the trip flow reading a feed copy that was asked for BEFORE
// the moment the step was for: the timer took any copy under 5 s old, the 15 s read any copy under 15 s old, and a copy's
// time was when its answer arrived, not when it was asked. Now a step near the stop (the timer, and the 15 s reads once the
// live arrival is under 5 min away) reads a copy asked for at or after its moment.
// Deterministic: the virtual clock of tools/simtrip.mjs, each feed answer taking feedMs of it, each wait of the pass ending
// lateMs late. No real sleeps, no Transport for NSW (the case's own fake feed).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { runCase, compare, stopFake, loadWorker, setClock, BASE } from "../tools/simtrip.mjs";

after(() => stopFake());

const hm = (t) => `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
function getOffs(r) { return r.alerts.filter((a) => a.title === "Get off now" && a.via !== "card"); }
function problems(id, r) {
  const cmp = compare(id, r);
  return [
    ...cmp.rows.filter((x) => !x.match).map((x) => `${x.kind}: want "${x.body}" at ${x.simAt}, got ${x.serverT == null ? "nothing" : `"${x.serverBody}" at ${hm(x.serverT)}`}`),
    ...cmp.extra.map((x) => `extra ${x.via} "${x.title}: ${x.body}" at ${hm(x.t)}`),
  ];
}

// The feed answer times and late timers the harness saw (speed 30: a 300 ms answer, a busy box's timers up to 2 s late).
const FEED_MS = [0, 120, 300, 900, 2400];
const LATE_MS = [0, 40, 600];
// A busy box's timers are each late by a different amount (the harness on a loaded box): seeded, so every run is the same.
function jitter(seed, n = 64, max = 1500) {
  let x = (seed * 2654435761) % 4294967296;
  const out = [];
  for (let i = 0; i < n; i++) { x = (x * 1664525 + 1013904223) % 4294967296; out.push(Math.floor((x / 4294967296) * max)); }
  return out;
}
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

test("S17a: the arrival moves from 7:59 to 8:01 in the second the Get off now timer is due; Get off now follows the new arrival (8:00:20), never 7:58:20, and no Held", { timeout: 300000 }, async () => {
  const bad = [];
  for (const feedMs of FEED_MS) for (const lateMs of LATE_MS) {
    const r = await runCase("S17a", { feedMs, lateMs });
    const g = getOffs(r);
    const why = problems("S17a", r);
    // 38 s before the live arrival (8:01:00), late only by the feed's answer and the late timer; never 7:58:20 (160 s early)
    const last = 72020 + Math.ceil((feedMs + lateMs) / 1000) + 1;
    if (g.length !== 1 || g[0].t < 72015 || g[0].t > last) why.push(`Get off now at ${g.map((x) => hm(x.t)).join(", ") || "none"} (want one, 8:00:15 to ${hm(last)})`);
    if (r.alerts.some((a) => /^Held/.test(a.title))) why.push("Held, stay on was sent");
    if (why.length) bad.push(`feed ${feedMs} ms, timers ${lateMs} ms late: ${why.join("; ")}`);
  }
  assert.deepEqual(bad, []);
});

test("S17b: the arrival moves 40 s earlier (7:59 to 7:58:20) at 7:58:05; Get off now rings at the next 15 s read (7:58:15), never missed", { timeout: 300000 }, async () => {
  const bad = [];
  for (const feedMs of FEED_MS) for (const lateMs of LATE_MS) {
    const r = await runCase("S17b", { feedMs, lateMs });
    const g = getOffs(r);
    const why = problems("S17b", r);
    // the first 15 s read after the move (7:58:15), late only by the feed's answer and the late timer
    const last = 71895 + Math.ceil((feedMs + lateMs) / 1000) + 1;
    if (g.length !== 1 || g[0].t < 71885 || g[0].t > last) why.push(`Get off now at ${g.map((x) => hm(x.t)).join(", ") || "none"} (want one, 7:58:05 to ${hm(last)})`);
    if (why.length) bad.push(`feed ${feedMs} ms, timers ${lateMs} ms late: ${why.join("; ")}`);
  }
  assert.deepEqual(bad, []);
});

test("S17a and S17b with the pass's timers each late by a different amount (20 seeded runs each, 0 and 300 ms answers): Get off now never on the old arrival, never missed", { timeout: 300000 }, async () => {
  const bad = [];
  for (const seed of SEEDS) for (const feedMs of [0, 300]) {
    const a = getOffs(await runCase("S17a", { feedMs, lateMs: jitter(seed) }));
    if (a.length !== 1 || a[0].t < 72015 || a[0].t > 72024) bad.push(`S17a seed ${seed}, ${feedMs} ms: Get off now at ${a.map((x) => `${hm(x.t)} "${x.body}"`).join(", ") || "none"}`);
    const b = getOffs(await runCase("S17b", { feedMs, lateMs: jitter(seed) }));
    if (b.length !== 1 || b[0].t < 71885 || b[0].t > 71898) bad.push(`S17b seed ${seed}, ${feedMs} ms: Get off now at ${b.map((x) => `${hm(x.t)} "${x.body}"`).join(", ") || "none"}`);
  }
  assert.deepEqual(bad, []);
});

test("the cases around the race keep their alerts with slow feed answers (S16, S17c, S17d, S2, S1): arrival read at the 15 s read, not 15 s later", { timeout: 300000 }, async () => {
  const bad = [];
  for (const id of ["S16", "S17c", "S17d", "S2", "S1"]) for (const feedMs of [0, 300, 900]) {
    const why = problems(id, await runCase(id, { feedMs }));
    if (why.length) bad.push(`${id} feed ${feedMs} ms: ${why.join("; ")}`);
  }
  assert.deepEqual(bad, []);
});

// ---- the open app's read at its Get off now moment: /api/service refresh=1&at=<moment> ----
import fs from "node:fs";
import { caseById, caseNet, platformId, stationId } from "../tools/case-feed.mjs";
import { makeD1 } from "./helpers/d1.mjs";

test("/api/service refresh=1&at=<moment>: the answer rests on a feed copy asked at or after that second (S17a at 7:58:20: the copy with 8:01, not the 7:58:15 one with 7:59); without at, unchanged", { timeout: 60000 }, async () => {
  const root = new URL("..", import.meta.url).pathname;
  const RealDate = Date;
  let clock = 0;
  class D extends RealDate { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } }
  D.UTC = RealDate.UTC; D.parse = RealDate.parse;
  const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default, serviceMomentOf };\n";
  const tmp = root + `.getoff-race-${process.pid}.mjs`;
  fs.writeFileSync(tmp, src);
  let W;
  try { W = await import(tmp); } finally { fs.unlinkSync(tmp); }
  const net = caseNet(caseById("S17a"));
  const { caseFeed } = await import("../tools/case-feed.mjs");
  const base = RealDate.parse("2026-11-02T00:00:00+11:00");
  const asks = [];
  const realFetch = globalThis.fetch, realDate = globalThis.Date;
  globalThis.Date = D;
  globalThis.fetch = async (url) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.startsWith("https://api.transport.nsw.gov.au/") && /\/gtfs\//.test(u)) {
      const asked = clock;
      asks.push(asked);
      const body = caseFeed(net, base, Math.floor((asked - base) / 1000), /vehiclepos/.test(u) ? "vp" : "tu");
      await null; // the trip update and vehicle feeds are asked together
      clock = Math.max(clock, asked + 300); // the answer arrives 300 ms after it was asked
      return new Response(Buffer.from(body), { status: 200, headers: { "content-type": "application/x-google-protobuf" } });
    }
    return new Response("{}", { status: 404 });
  };
  try {
    const p = (o) => new URLSearchParams(o);
    clock = base + (19 * 3600 + 58 * 60 + 20) * 1000;
    assert.equal(W.serviceMomentOf(p({ refresh: "1", at: String(clock + 50) })), clock, "rounded down to its second, never ahead of now");
    assert.equal(W.serviceMomentOf(p({ at: String(clock) })), null, "only on a refresh");
    assert.equal(W.serviceMomentOf(p({ refresh: "1", at: String(clock - 31000) })), null, "not an old moment");
    assert.equal(W.serviceMomentOf(p({ refresh: "1", at: String(clock + 6000) })), null, "not a moment far ahead");
    assert.equal(W.serviceMomentOf(p({ refresh: "1", at: "x" })), null);

    const DB = makeD1();
    for (const f of fs.readdirSync(root + "migrations").sort()) DB.sql.exec(fs.readFileSync(root + "migrations/" + f, "utf8"));
    const ASSETS = { fetch: async (rq) => {
      const m = new URL(rq.url).pathname.match(/^\/stops\/(.+)\.json$/);
      const shard = {};
      if (m) for (const [id, v] of Object.entries(net.names)) if (id.slice(0, 3).replace(/[^A-Za-z0-9]/g, "_") === m[1]) shard[id] = v;
      return new Response(JSON.stringify(shard), { headers: { "content-type": "application/json" } });
    } };
    const env = { DB, ASSETS, TFNSW_API_KEY: "fake-local-key", API_ONLY: "1" };
    const exec = { waitUntil() {}, passThroughOnException() {} };
    const leg = net.P.legs[0];
    const off = leg.stops[leg.off].name;
    const q = { trip: leg.tripId, mode: leg.mode, line: leg.line, stop: platformId(leg.stops[0].name, leg), to: stationId(off), planned: new RealDate(base + leg.stops[0].tt * 1000).toISOString() };
    // The answer's feedAt is when the newest feed copy it rests on was asked for (the trip update's live times come from it).
    const ask = async (extra) => {
      const r = await W.__default.fetch(new Request("https://api.transportsydney.app/api/service?" + p({ ...q, ...extra })), env, exec);
      assert.equal(r.status, 200);
      return (await r.json()).feedAt;
    };
    // 7:58:15: the open app's 15 s refresh reads the feed (asked 7:58:15.0, in at 7:58:15.3)
    const t15 = base + (19 * 3600 + 58 * 60 + 15) * 1000;
    clock = t15;
    assert.equal(await ask({ refresh: "1" }), t15);
    // 7:58:20.05: the Get off now moment (7:58:20) plus the app's 50 ms; the arrival moved to 8:01 at 7:58:20
    const moment = base + (19 * 3600 + 58 * 60 + 20) * 1000;
    clock = moment + 50;
    assert.equal(await ask({ refresh: "1" }), t15, "a plain refresh still takes the 7:58:15 copy (15 s sharing, unchanged)");
    const n0 = asks.length;
    const f1 = await ask({ refresh: "1", at: String(moment) });
    assert.ok(f1 >= moment, `the moment's answer rests on a copy asked at or after 7:58:20 (feedAt ${f1 - moment} ms)`);
    assert.ok(asks.length > n0 && asks.slice(n0).every((x) => x >= moment), "fresh feed copies asked at or after the moment");
    const sec = (x) => Math.floor((x - base) / 1000);
    const tuAt = (x) => Buffer.from(caseFeed(net, base, sec(x), "tu"));
    assert.equal(Buffer.compare(tuAt(asks[asks.length - 1]), tuAt(moment)), 0, "that copy is the feed of 7:58:20 (with the move)");
    assert.notEqual(Buffer.compare(tuAt(moment), tuAt(t15)), 0, "which differs from the 7:58:15 copy (the move to 8:01 is in it)");
    // A second phone asking for the same moment in the same second shares that copy (no second feed read)
    const n1 = asks.length;
    clock = moment + 700;
    assert.ok((await ask({ refresh: "1", at: String(moment + 400) })) >= moment);
    assert.equal(asks.length, n1, "one feed read per feed per second for moments");
  } finally {
    globalThis.fetch = realFetch; globalThis.Date = realDate;
  }
});
