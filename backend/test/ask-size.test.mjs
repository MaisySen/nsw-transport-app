// /api/ask reply size and alert links: replies carry only the fields the web, Android and
// iPhone Ask screens read, and alert links are links only when they are https. Runs offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
async function loadWorker() {
  let src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {");
  src += "\nexport { __default, askSlim, httpsUrl };\n";
  const tmp = `/tmp/ask-size-test-${process.pid}-${Date.now()}.mjs`;
  fs.writeFileSync(tmp, src);
  try { return await import(tmp); } finally { fs.unlinkSync(tmp); }
}
globalThis.fetch = async () => new Response("{}", { status: 503 });
const stmt = () => ({ bind: () => stmt(), run: async () => ({}), all: async () => ({ results: [] }), first: async () => null });
const env = {
  TFNSW_API_KEY: "test",
  DB: { prepare: () => stmt(), batch: async (l) => l.map(() => ({})) },
  ASSETS: { fetch: async () => new Response("", { status: 404 }) },
};
const W = await loadWorker();

const link = { kind: "service", trip: "1", mode: "train", line: "T1", stop: "200060", href: "#/svc?trip=1" };
const leg = (i) => ({
  kind: "transit", mode: "train", line: "T" + i, color: "#F99D1C", towards: "Hornsby", from: "Central", fromPlatform: "Platform 16", to: "Chatswood",
  planned: "2026-10-24T04:34:00.000Z", estimated: null, realtime: true, delayMin: 2, cancelled: false, durationMin: 22, link,
  path: Array.from({ length: 800 }, (_, k) => [151.2 + k / 1e4, -33.8 - k / 1e4]),
  stops: Array.from({ length: 30 }, (_, k) => ({ id: String(k), name: "Stop " + k, planned: "2026-10-24T04:34:00.000Z" })),
});
const jny = () => ({ leave: "2026-10-24T04:34:00.000Z", board: "x", arrive: "2026-10-24T05:34:00.000Z", durationMin: 60, changes: 2, live: true, cancelled: false, legs: [leg(1), { kind: "walk", durationMin: 4 }, leg(2), leg(3)] });
const big = () => ({
  kind: "trip", v: 2, from: { id: "219510", name: "Lakemba Station" }, to: { id: "229310", name: "Newcastle Interchange" },
  journeys: Array.from({ length: 6 }, jny), reply: "Lakemba Station to Newcastle Interchange via Chatswood.",
  cards: [{ type: "trip", title: "Next", from: { id: "219510", name: "Lakemba Station" }, to: { id: "229310", name: "Newcastle Interchange" }, link, journeys: Array.from({ length: 4 }, jny) },
    { type: "alerts", items: [{ title: "Trackwork", url: "javascript:alert(1)", lines: ["T1"] }, { title: "Lift out", url: "https://transportnsw.info/alerts/1", lines: [] }] },
    { type: "departures", title: "Central", items: [{ line: "T1", dest: "Hornsby", planned: "2026-10-24T04:34:00.000Z", realtime: 1, cancelled: 0, link, path: [[1, 2]] }] }],
  links: [{ label: "Open trip", kind: "trip", from: "219510", to: "229310", href: "#/trip?from=219510&to=229310" }],
  suggestions: ["newcastle to lakemba via chatswood"], detail: "internal error text",
});

test("askSlim keeps every field the Ask screens read and drops the rest", () => {
  const d = big();
  const s = W.askSlim(d);
  const before = JSON.stringify(d).length, after = JSON.stringify(s).length;
  assert.ok(before > 180000, "fixture is large: " + before);
  assert.ok(after < 30000, "slim reply under 30 KB: " + after);
  for (const k of ["journeys", "detail"]) assert.equal(k in s, false, k);
  for (const k of ["kind", "reply", "links", "suggestions", "from", "to"]) assert.deepEqual(s[k], d[k], k);
  const j = s.cards[0].journeys[0];
  for (const k of ["leave", "arrive", "durationMin", "changes"]) assert.ok(k in j, k);
  const l = j.legs[0];
  for (const k of ["kind", "mode", "line", "color", "fromPlatform", "planned", "realtime", "delayMin", "cancelled", "link"]) assert.ok(k in l, "leg " + k);
  assert.equal("path" in l, false);
  assert.equal(j.legs[1].realtime, false, "walk legs still carry realtime for the iPhone decoder");
  assert.equal(j.legs[1].cancelled, false);
  const dep = s.cards[2].items[0];
  assert.equal(dep.realtime, true); assert.equal(dep.cancelled, false); assert.equal("path" in dep, false);
  assert.deepEqual(s.cards[0].from, d.cards[0].from);
  assert.deepEqual(s.cards[0].link, link);
});

test("alert links become links only when they are https", () => {
  const s = W.askSlim(big());
  assert.equal(s.cards[1].items[0].url, null);
  assert.equal(s.cards[1].items[1].url, "https://transportnsw.info/alerts/1");
  for (const bad of ["javascript:alert(1)", "http://transportnsw.info/x", "data:text/html,x", "//evil.example", "https://x.example/\"onmouseover=1", "", null, undefined]) assert.equal(W.httpsUrl(bad), null, String(bad));
  assert.equal(W.httpsUrl(" https://transportnsw.info/alerts "), "https://transportnsw.info/alerts");
});

test("/api/ask answers small and without internal error text", async () => {
  const r = await W.__default.fetch(new Request("https://t.example/api/ask?q=lakemba%20to%20central", { headers: { "cf-connecting-ip": "10.9.9.9" } }), env, { waitUntil() {} });
  const body = await r.text();
  assert.ok(body.length < 30000, "size " + body.length);
  const d = JSON.parse(body);
  assert.equal("detail" in d, false);
  assert.equal("journeys" in d, false);
});
