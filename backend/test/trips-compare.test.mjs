// tools/trips-compare.mjs (27 Oct 2026): the shadow compare of our planner's trip lists with the Trip Planner's, for
// the 95% gate. The sample (NSW wide, owner stops at most 5%, the same for the same seed), the match rule (first
// service within 60 s, same lines, same changes) and the cap on Trip Planner calls; the run end to end against a local
// stand in for both servers (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = new URL("..", import.meta.url).pathname;
const C = await import(root + "tools/trips-compare.mjs");
const all = C.places(root + "src/public/stations");

test("the sample: NSW wide, mostly Greater Sydney, owner stops in at most 5% of pairs, the same for a seed", () => {
  assert.ok(all.length > 1000, "stations and bus stops from the site's lists");
  const owner = { names: ["Central"], ids: [] };
  const a = C.sample(all, 60, 5, owner), b = C.sample(all, 60, 5, owner);
  assert.equal(a.length, 60);
  assert.deepEqual(a, b);
  assert.ok(a.filter((p) => p.owner).length <= 3, "at most 5% of 60");
  assert.ok(a.filter((p) => p.km > 45).length >= 2, "some NSW wide trips");
  assert.ok(new Set(a.map((p) => p.modes.split(">")[0])).size >= 3, "several modes");
  assert.equal(new Set(a.map((p) => p.from + ">" + p.to)).size, 60, "no pair twice");
  assert.notDeepEqual(C.sample(all, 20, 6), C.sample(all, 20, 7));
  assert.equal(C.LIVE_CAP, 40);
});

const T0 = Date.parse("2026-10-27T13:00:00Z");
const leg = (line, min, from, fromParent, mode = "train") => ({ kind: "transit", mode, line, planned: new Date(T0 + min * 60000).toISOString(), from, fromParent });
const J = (...legs) => ({ legs });

test("the match: first service within 60 s, same lines in order, same change station", () => {
  const nsw = [
    J(leg("T1", 0, "Alpha Station", "A")),
    J(leg("T1", 10, "Alpha Station", "A"), leg("M1", 25, "Xing Station", "X")),
    J(leg("T1", 20, "Alpha Station", "A"), leg("M1", 35, "Xing Station", "X")),
    J(leg("T1", 30, "Alpha Station", "A")),
    J(leg("T1", 40, "Alpha Station", "A")),
  ];
  const own = [
    J(leg("T1", 0.5, "Alpha Station", "A")),                                         // 30 s apart: matched
    J(leg("T1", 10, "Alpha Station", "A"), leg("M1", 25, "Xing Station", "X")),       // matched
    J(leg("T1", 20, "Alpha Station", "A"), leg("M1", 35, "Yonder Station", "Y")),     // changes elsewhere
    J(leg("T9", 30, "Alpha Station", "A")),                                         // another line
    J(leg("T1", 42, "Alpha Station", "A")),                                         // 2 minutes later
  ];
  const m = C.matchTrips(nsw, own, T0);
  assert.equal(m.counted, 5);
  assert.equal(m.matched, 2);
  assert.deepEqual(m.rows.map((r) => r.why || "ok"), ["ok", "ok", "other change", "other lines", "no trip of ours within 60 s"]);
  // A change named the same but without a station id still counts (bus stops have no parent).
  const n2 = [J(leg("333", 0, "Bondi Junction Station, Stand A", null, "bus"), leg("T4", 12, "Bondi Junction Station", null))];
  const o2 = [J(leg("333", 0, "Bondi Junction Station, Stand A", null, "bus"), leg("T4", 12, "Bondi Junction", null))];
  assert.equal(C.matchTrips(n2, o2, T0).matched, 1);
  // Only the next 10 from the time are counted, and one of ours matches one of theirs at most.
  const many = Array.from({ length: 14 }, (_, i) => J(leg("T1", i * 5, "Alpha Station", "A")));
  assert.equal(C.matchTrips(many, [many[0]], T0).counted, 10);
  assert.equal(C.matchTrips([many[0], many[0]], [many[0]], T0).matched, 1);
});

test("a run end to end: our day list and the planner page from one local server, the planner calls capped", async () => {
  let plannerCalls = 0, dayCalls = 0, keyOk = true;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    res.setHeader("content-type", "application/json");
    if (u.pathname === "/api/raptor/day") {
      dayCalls++;
      if (req.headers["x-admin-key"] !== "k") keyOk = false;
      const t = Date.now();
      return res.end(JSON.stringify({ day: "x", nextDay: null, journeys: Array.from({ length: 30 }, (_, i) => ({ legs: [{ kind: "transit", mode: "train", line: "T1", planned: new Date(Math.ceil(t / 60000) * 60000 + (i * 6 - 30) * 60000).toISOString(), from: "Alpha Station", fromParent: "A" }] })) }));
    }
    if (u.pathname === "/api/trip") {
      plannerCalls++;
      const t = Date.now();
      return res.end(JSON.stringify({ journeys: Array.from({ length: 10 }, (_, i) => ({ legs: [{ kind: "transit", mode: "train", line: i === 3 ? "T2" : "T1", planned: new Date(Math.ceil(t / 60000) * 60000 + (i * 6 + 12) * 60000).toISOString(), from: "Alpha Station", fromParent: "A" }] })) }));
    }
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const fs = await import("node:fs");
  const pairs = `/tmp/trips-compare-pairs-${process.pid}.txt`;
  fs.writeFileSync(pairs, Array.from({ length: 6 }, (_, i) => `S${i},D${i}`).join("\n"));
  try {
    const { stdout, stderr } = await promisify(execFile)("node", [root + "tools/trips-compare.mjs", "--dry", "--base", `http://127.0.0.1:${port}`, "--pairs", pairs, "--live", "4"], { env: { ...process.env, ENGINE_LOAD_KEY: "k" } });
    const out = JSON.parse(stdout);
    assert.equal(out.plannerCalls, 4, "the cap");
    assert.equal(plannerCalls, 4);
    assert.equal(out.pairsSkipped, 2);
    assert.equal(out.counted, 40);
    assert.equal(out.matched, 36, "one other line in each page of 10");
    assert.match(stderr, /matched 36 of 40/);
    assert.ok(keyOk && dayCalls === 4);
  } finally { srv.close(); fs.unlinkSync(pairs); }
  // --sample prints the pairs and calls nothing.
  const r = await promisify(execFile)("node", [root + "tools/trips-compare.mjs", "--dry", "--gen", "3", "--sample"]);
  assert.equal(JSON.parse(r.stdout).length, 3);
});
