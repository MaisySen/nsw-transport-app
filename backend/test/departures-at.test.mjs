// Departures from a chosen moment (/api/departures `time`, optional `date`): the board from any time in the service
// day, services that have already left included and marked departed, with the live delay they left with. No time
// means now, exactly as before. The moment is echoed in `at` so the app can tell this server honoured it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
let src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default, boardAt, sydneyMomentOf };\n";
const tmp = `/tmp/dep-at-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const MIN = 60000;
const now = Date.now();
const ev = (line, planned, delayMin) => ({
  location: { id: "2135101", name: "Strathfield Station, Platform 1", properties: { platformName: "Platform 1" }, parent: { id: "213510", name: "Strathfield Station" } },
  departureTimePlanned: new Date(planned).toISOString(),
  ...(delayMin == null ? {} : { departureTimeEstimated: new Date(planned + delayMin * MIN).toISOString(), isRealtimeControlled: true }),
  transportation: { disassembledName: line, number: line, product: { class: 1 }, destination: { name: "Central", id: "1" }, properties: {} },
  properties: { RealtimeTripId: line + planned },
});
const asked = [];
globalThis.fetch = async (u) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (url.pathname.endsWith("/departure_mon")) {
    asked.push({ date: url.searchParams.get("itdDate"), time: url.searchParams.get("itdTime") });
    return new Response(JSON.stringify({ locations: [{ id: "213510", name: "Strathfield Station", disassembledName: "Strathfield" }],
      stopEvents: [ev("T9", now - 20 * MIN, 3), ev("T2", now - 12 * MIN, null), ev("T1", now + 4 * MIN, 0), ev("T3", now + 9 * MIN, null)] }));
  }
  return new Response("{}", { status: 404 });
};
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), run: async () => ({ meta: { changes: 1, last_row_id: 1 } }), all: async () => ({ results: [] }), first: async () => null });
const env = { TFNSW_API_KEY: "t", DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) }, ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
let ip = 1;
const get = async (path) => { const r = await W.__default.fetch(new Request("https://t.example" + path, { headers: { "cf-connecting-ip": "10.7.0." + (ip++ % 250) } }), env, { waitUntil() {} }); return { status: r.status, body: await r.json() }; };
const hhmm = (t) => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)); const o = Object.fromEntries(p.map((x) => [x.type, x.value])); return o.hour + o.minute; };

test("no time: the board for now, gone services dropped, no at (unchanged)", async () => {
  const r = await get("/api/departures?stop=213510&n=1");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((i) => i.line), ["T1", "T3"]);
  assert.equal(r.body.at, undefined);
  assert.ok(r.body.items.every((i) => i.departed === undefined));
});

test("time: services that left are kept, marked departed, with their live delay", async () => {
  const want = hhmm(now - 25 * MIN);
  asked.length = 0;
  const r = await get(`/api/departures?stop=213510&time=${want}&n=2`);
  assert.equal(r.status, 200);
  assert.equal(asked[0].time, want);
  assert.deepEqual(r.body.items.map((i) => i.line), ["T9", "T2", "T1", "T3"]);
  const by = Object.fromEntries(r.body.items.map((i) => [i.line, i]));
  assert.equal(by.T9.departed, true);
  assert.equal(by.T9.realtime, true);
  assert.equal(by.T9.delayMin, 3);
  assert.equal(by.T2.departed, true);
  assert.equal(by.T2.realtime, false);
  assert.equal(by.T1.departed, false);
  assert.equal(r.body.at.time, want);
  assert.ok(/^\d{8}$/.test(r.body.at.date));
});

test("boardAt: no date means the current service day; before 4am is clamped to 4am; bad input is now", () => {
  // 25 Oct 2026, 7:00pm Sydney (UTC+11).
  const at7pm = W.sydneyMomentOf("20261025", "1900");
  assert.equal(new Date(at7pm).toISOString(), "2026-10-25T08:00:00.000Z");
  const a = W.boardAt("1815", null, at7pm);
  assert.deepEqual([a.date, a.time, a.clamped], ["20261025", "1815", false]);
  const early = W.boardAt("0300", "20261025", at7pm);
  assert.deepEqual([early.date, early.time, early.clamped], ["20261025", "0400", true]);
  // 1:30am on 26 Oct: 11:00pm means the evening before (same service day), 2:00am means tonight.
  const at130 = W.sydneyMomentOf("20261026", "0130");
  assert.deepEqual([W.boardAt("2300", "", at130).date, W.boardAt("2300", "", at130).time], ["20261025", "2300"]);
  assert.deepEqual([W.boardAt("0200", "", at130).date, W.boardAt("0200", "", at130).time], ["20261026", "0200"]);
  assert.equal(W.boardAt("", null, at7pm), null);
  assert.equal(W.boardAt("7pm", null, at7pm), null);
  // Daylight saving ends 5 Apr 2027 3:00am: 8:00am that day is UTC+10.
  assert.equal(new Date(W.sydneyMomentOf("20270405", "0800")).toISOString(), "2027-04-04T22:00:00.000Z");
});

test("a bad time is refused as before", async () => {
  const r = await get("/api/departures?stop=213510&time=25:00&n=3");
  assert.equal(r.status, 400);
});
