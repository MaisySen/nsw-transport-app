// Budget mode (docs/COSTS.md): the hourly usage read, the month end projection, the hold that switches the costly
// features off past 80% of an included amount, load test keys off on production, clearing a hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./helpers/d1.mjs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") +
  "\nexport { __default, budgetCycle, budgetProject, budgetCheck, budgetHeld, flagOn, loadOk, serverCfg, BUDGET_INCLUDED };\n";
const tmp = `/tmp/budget-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

// GraphQL answers: the cycle so far and the last 48 hours, by the time span asked.
let usage = null;
let asked = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes("/graphql")) {
    const v = JSON.parse(init.body).variables;
    asked.push(v);
    const span = Date.parse(v.e) - Date.parse(v.s);
    const u = span === 48 * 3600000 ? usage.day : usage.cycle; // the 48 hour rate window, else the cycle so far
    return Response.json({ data: { viewer: { accounts: [{
      w: [{ sum: { requests: u.wr, cpuTimeUs: u.cpu * 1000 } }], o: [{ sum: { requests: u.dor } }],
      p: [{ sum: { duration: u.gbs, rowsRead: 0, rowsWritten: 0, inboundWebsocketMsgCount: 0 } }], d: [{ sum: { rowsRead: 0, rowsWritten: 0 } }],
    }] } }, errors: null });
  }
  throw new Error("no NSW calls in this test");
};
const mails = [];
globalThis.TestEmailMessage = class { constructor(from, to, raw) { this.from = from; this.to = to; this.raw = raw; } };
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const mkEnv = (d1) => ({ DB: d1, CF_ANALYTICS_TOKEN: "t", CF_ACCOUNT_ID: "acc", BILLING_DAY: "26", ENGINE_BOARDS: "on", LOAD_TESTS: "on", LOAD_TEST_KEY: "k",
  ALERT_EMAIL: { send: async (m) => { mails.push(m); } } });

test("billing cycle from the billing day, the calendar month without one", () => {
  const c = W.budgetCycle(Date.UTC(2026, 9, 26, 5), 26);
  assert.equal(c.start, Date.UTC(2026, 9, 26)); assert.equal(c.end, Date.UTC(2026, 10, 26));
  const b = W.budgetCycle(Date.UTC(2026, 9, 20, 5), 26);
  assert.equal(b.start, Date.UTC(2026, 8, 26)); assert.equal(b.end, Date.UTC(2026, 9, 26));
  const j = W.budgetCycle(Date.UTC(2027, 0, 3), 26);
  assert.equal(j.start, Date.UTC(2026, 11, 26)); assert.equal(j.end, Date.UTC(2027, 0, 26));
  const m = W.budgetCycle(Date.UTC(2026, 11, 15), null);
  assert.equal(m.start, Date.UTC(2026, 11, 1)); assert.equal(m.end, Date.UTC(2027, 0, 1));
});

test("month end at a day's rate, each meter against its included amount", () => {
  const now = Date.UTC(2026, 9, 27);
  const p = W.budgetProject({ doRequests: 100000 }, { doRequests: 20000 }, now, { start: Date.UTC(2026, 9, 26), end: Date.UTC(2026, 10, 26) });
  assert.equal(p.meters.doRequests.projected, 100000 + 20000 * 30);
  assert.equal(p.meters.doRequests.projectedPct, 70);
  assert.equal(p.worst.meter, "doRequests");
  assert.equal(W.BUDGET_INCLUDED.workerRequests, 10e6);
  assert.equal(W.BUDGET_INCLUDED.doRequests, 1e6);
});

test("under 50%: nothing switched off, no email; the reading is saved", async () => {
  const d1 = makeD1(); mails.length = 0;
  const env = mkEnv(d1);
  usage = { cycle: { wr: 50000, cpu: 100000, dor: 5000, gbs: 100 }, day: { wr: 10000, cpu: 20000, dor: 500, gbs: 20 } };
  const b = await W.budgetCheck(env, Date.UTC(2026, 9, 27, 3));
  assert.equal(b.hold, false); assert.equal(mails.length, 0);
  assert.ok(b.meters.doRequests.projectedPct < 50);
  assert.equal(asked[asked.length - 1].a, "acc");
  const row = d1.sql.prepare("SELECT body FROM app_config WHERE platform = 'budget'").get();
  assert.ok(row && JSON.parse(row.body).at);
  assert.equal(W.flagOn(env, "ENGINE_BOARDS"), true);
});

test("past 80% projected: the hold switches the costly flags and load keys off, one email; it lifts under 60%", async () => {
  const d1 = makeD1(); mails.length = 0;
  const env = mkEnv(d1);
  // A load test day: 120,000 object requests on the cycle's first day, 29 days left.
  usage = { cycle: { wr: 250000, cpu: 800000, dor: 120000, gbs: 2900 }, day: { wr: 250000, cpu: 800000, dor: 120000, gbs: 2900 } };
  const b = await W.budgetCheck(env, Date.UTC(2026, 9, 26, 22));
  assert.equal(b.hold, true); assert.equal(b.worst.meter, "doRequests");
  assert.match(b.holdReason, /doRequests/);
  assert.equal(mails.length, 1); assert.equal(b.mail, "sent");
  assert.equal(mails[0].to, "contact@fintex.au"); assert.match(mails[0].raw, /^From: "Transport Sydney Live" <budget@transportsydney.app>\r\n/); assert.match(mails[0].raw, /Subject: Sydney Live: Cloudflare usage would pass/); assert.match(mails[0].raw, /switched off ENGINE_BOARDS, LOAD_TESTS/);
  assert.equal(W.budgetHeld("ENGINE_BOARDS"), true);
  assert.equal(W.flagOn(env, "ENGINE_BOARDS"), false);
  assert.equal(W.flagOn(env, "OWN_PLANNER"), false);
  const req = new Request("https://t.example/api/departures?stop=1", { headers: { "x-load-key": "k" } });
  assert.equal(W.loadOk(req, env), false);
  // The next hour: still held, no second email.
  const b2 = await W.budgetCheck(env, Date.UTC(2026, 9, 26, 23));
  assert.equal(b2.hold, true); assert.equal(mails.length, 1);
  // The test ends: the rate falls and 20% is used, so the hold lifts by itself.
  usage = { cycle: { wr: 250000, cpu: 800000, dor: 200000, gbs: 2900 }, day: { wr: 1000, cpu: 3000, dor: 100, gbs: 2 } };
  const b3 = await W.budgetCheck(env, Date.UTC(2026, 9, 29, 6));
  assert.equal(b3.hold, false); assert.ok(b3.liftedAt);
  assert.equal(W.flagOn(env, "ENGINE_BOARDS"), true);
  // An admin's clear.
  W.serverCfg.at = 0;
  const res = await W.__default.fetch(new Request("https://t.example/api/budget/clear", { method: "POST" }), env, { waitUntil() {} });
  assert.equal(res.status, 403, "admin key only");
});

test("a new billing cycle lifts the hold", async () => {
  const d1 = makeD1(); mails.length = 0;
  const env = mkEnv(d1);
  usage = { cycle: { wr: 250000, cpu: 800000, dor: 900000, gbs: 2900 }, day: { wr: 25000, cpu: 80000, dor: 30000, gbs: 290 } };
  const b = await W.budgetCheck(env, Date.UTC(2026, 10, 25, 12));
  assert.equal(b.hold, true);
  usage = { cycle: { wr: 1000, cpu: 1000, dor: 100, gbs: 1 }, day: { wr: 1000, cpu: 1000, dor: 100, gbs: 1 } };
  const c = await W.budgetCheck(env, Date.UTC(2026, 10, 26, 12));
  assert.equal(c.hold, false);
  assert.equal(W.budgetHeld("ENGINE_BOARDS"), false);
});

test("load test keys only work with LOAD_TESTS on", () => {
  W.serverCfg.budget = null;
  const req = new Request("https://t.example/api/departures?stop=1", { headers: { "x-load-key": "k" } });
  assert.equal(W.loadOk(req, { LOAD_TESTS: "on", LOAD_TEST_KEY: "k" }), true);
  assert.equal(W.loadOk(req, { LOAD_TESTS: "off", LOAD_TEST_KEY: "k" }), false);
  assert.equal(W.loadOk(req, { LOAD_TEST_KEY: "k" }), false);
});

test("no analytics token: skipped, nothing switched", async () => {
  const b = await W.budgetCheck({ DB: makeD1() }, Date.now());
  assert.equal(b.skipped, "no analytics token");
});
