// Car park copies (27 Oct, "This is still slow"): /api/parking took 11.5 s on a cold open, because about 40 car
// parks are read four at a time under the open data rate limit. Now the last answer with a live count is saved and a
// cold open gets it at once (dataAt says how old) while the fresh one is read behind; an answer with no live count is
// never saved or kept; a saved reading over 30 minutes old is stale again on the way out.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./helpers/d1.mjs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => fs.readFileSync(root + p, "utf8");
const src = read("src/worker.js").replace(/export default\s*\{/, "const __default = {") +
  "\nexport { __default, memCacheMap, parkMem, parkAllMem, isBoardCopyKey, parkCopyKey, parkCopyOk, PARK_SAVED_MAX_MS };\n";
const tmp = `/tmp/park-swr-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const sydStr = (ms) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(ms)).replace(" ", "T");
let delay = 0, down = false, parkCalls = 0;
globalThis.fetch = async (u) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (url.pathname === "/v1/carpark") {
    parkCalls++;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (down) return new Response("busy", { status: 503 });
    return new Response(JSON.stringify({ spots: "200", occupancy: { total: "150" }, MessageDate: sydStr(Date.now()) }));
  }
  return new Response("{}", { status: 404 });
};
const edge = new Map();
globalThis.caches = { default: { match: async (req) => { const e = edge.get(String(req.url || req)); return e ? new Response(e.body, { headers: e.headers }) : undefined; }, put: async (req, res) => { edge.set(String(req.url || req), { body: await res.text(), headers: [...res.headers] }); }, delete: async () => true } };
const D = makeD1();
const env = {
  TFNSW_API_KEY: "test", DB: D,
  ASSETS: { fetch: async (req) => { const p = root + "src/public" + new URL(req.url).pathname; return fs.existsSync(p) ? new Response(fs.readFileSync(p)) : new Response("", { status: 404 }); } },
};
const behind = [];
async function settle() { for (let n = -1; n !== behind.length;) { n = behind.length; await Promise.all(behind); await new Promise((r) => setTimeout(r, 20)); } }
const exec = { waitUntil: (p) => { behind.push(Promise.resolve(p).catch(() => null)); } };
let ip = 1;
const get = async (path) => {
  const t0 = Date.now();
  const r = await W.__default.fetch(new Request("https://api.transportsydney.app" + path, { headers: { "cf-connecting-ip": "10.9.0." + (ip++ % 250) } }), env, exec);
  return { status: r.status, body: await r.json(), tag: r.headers.get("x-edge-cache"), ms: Date.now() - t0 };
};
// Another data centre, or a new copy of the worker: no edge copy, no memory.
function newPlace() { edge.clear(); W.memCacheMap.clear(); W.parkMem.clear(); W.parkAllMem.v = null; W.parkAllMem.at = 0; W.parkAllMem.readAt = 0; }
const rows = () => D.sql.prepare("SELECT k, at, opened FROM board_copies WHERE k LIKE 'park:%'").all();

test("a cold open gets the saved car park counts at once with their age, and the fresh ones are read behind it", { timeout: 30000 }, async () => {
  newPlace(); delay = 0; down = false;
  const first = await get("/api/parking?stop=2155384");
  assert.equal(first.status, 200);
  assert.equal(first.body.carparks.length, 3);
  await settle();
  assert.equal(rows().length, 1, "the answer with live counts is saved");
  assert.equal(rows()[0].k, "park:stop:2155384");
  // A later cold open elsewhere, with the open data API slow: the saved copy, not an 11 s wait.
  newPlace(); delay = 1500; parkCalls = 0;
  const r = await get("/api/parking?stop=2155384");
  assert.equal(r.status, 200);
  assert.ok(r.ms < 1000, `answered in ${r.ms} ms`);
  assert.equal(r.tag, "saved");
  assert.ok(Number(r.body.dataAt) > 0 && Number(r.body.dataAt) <= Date.now(), "labelled with when its counts were read");
  assert.equal(r.body.carparks.find((c) => c.id === "26").free, 50);
  await settle();
  assert.ok(parkCalls >= 3, "the fresh counts were read behind the copy");
  assert.ok(rows()[0].at >= r.body.dataAt, "and saved for the next open");
  delay = 0;
});

test("an answer with no live count is never saved or kept at the edge", { timeout: 30000 }, async () => {
  newPlace(); D.sql.exec("DELETE FROM board_copies"); down = true; delay = 0;
  const r = await get("/api/parking?stop=2155384");
  assert.equal(r.status, 200);
  assert.ok(r.body.carparks.every((c) => c.free == null));
  await settle();
  assert.equal(rows().length, 0, "nothing saved");
  assert.ok(![...edge.keys()].some((k) => k.includes("/api/parking")), "nothing kept at the edge");
  down = false;
});

test("a saved reading over 30 minutes old is stale again on the way out, and a copy over 30 minutes old is not used", { timeout: 30000 }, async () => {
  newPlace(); D.sql.exec("DELETE FROM board_copies"); down = false; delay = 0;
  // A saved copy 10 minutes old whose first car park reading is 40 minutes old.
  const old = new Date(Date.now() - 40 * 60000).toISOString();
  const body = { carparks: [{ id: "26", name: "A", free: 9, spots: 123, status: "nearly", label: "Nearly full", updated: old, stale: false }, { id: "27", name: "B", free: 40, spots: 455, status: "ok", label: "Spaces free", updated: new Date().toISOString(), stale: false }], source: "x" };
  const z = await new Response(new Blob([JSON.stringify(body)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  const b64 = Buffer.from(z).toString("base64");
  D.sql.prepare("INSERT INTO board_copies (k, stop, at, opened, body) VALUES ('park:stop:2155384', 'park', ?, 0, ?)").run(Date.now() - 10 * 60000, b64);
  newPlace(); delay = 1500;
  const r = await get("/api/parking?stop=2155384");
  assert.equal(r.tag, "saved");
  const a = r.body.carparks.find((c) => c.id === "26"), b = r.body.carparks.find((c) => c.id === "27");
  assert.equal(a.stale, true); assert.equal(a.status, "unknown"); assert.equal(a.label, "No live count");
  assert.equal(b.status, "ok");
  await settle();
  // A copy past PARK_SAVED_MAX_MS waits for the fresh counts instead.
  D.sql.prepare("UPDATE board_copies SET at = ? WHERE k = 'park:stop:2155384'").run(Date.now() - W.PARK_SAVED_MAX_MS - 60000);
  newPlace(); delay = 300;
  const r2 = await get("/api/parking?stop=2155384");
  assert.notEqual(r2.tag, "saved");
  assert.equal(r2.body.carparks.find((c) => c.id === "26").free, 50);
  delay = 0;
});

test("car park copy keys, and the board warm up leaves them alone", () => {
  const u = (q) => new URL("https://x/api/parking" + q);
  assert.deepEqual(W.parkCopyKey(u("")), { k: "park:all", stop: "park" });
  assert.deepEqual(W.parkCopyKey(u("?stop=2155384")), { k: "park:stop:2155384", stop: "park" });
  assert.deepEqual(W.parkCopyKey(u("?id=26")), { k: "park:id:26", stop: "park" });
  assert.equal(W.parkCopyKey(u("?live=0")), null);
  assert.equal(W.parkCopyKey(u("?id=" + encodeURIComponent("1 OR 1"))), null);
  assert.equal(W.isBoardCopyKey("206710|"), true);
  assert.equal(W.isBoardCopyKey("206710|train"), true);
  assert.equal(W.isBoardCopyKey("trip:206710>202210"), false);
  assert.equal(W.isBoardCopyKey("park:all"), false);
  assert.equal(W.parkCopyOk(JSON.stringify({ carparks: [{ free: null }] })), false);
  assert.equal(W.parkCopyOk(JSON.stringify({ carparks: [{ free: 3 }] })), true);
  assert.equal(W.parkCopyOk(JSON.stringify({ dataAt: Date.now() - W.PARK_SAVED_MAX_MS - 1000, carparks: [{ free: 3 }] })), false);
});
