// Fix-all 1 Nov 2026 (known-issues sweep A3, from the polish security notes): the server refuses a request body over
// 128 KB before reading it (413), except the admin, engine load, planner and budget routes, which carry files and
// timetables; and /api/push/unsubscribe clamps the endpoint at 1000 characters like /api/push/subscribe.
// Runs offline against the worker source, as security.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => fs.readFileSync(root + p, "utf8");
const SRC = read("src/worker.js");

async function loadWorker() {
  let src = SRC.replace(/export default\s*\{/, "const __default = {");
  src += "\nexport { __default };\n";
  const tmp = `/tmp/bodycap-test-${process.pid}-${Date.now()}.mjs`;
  fs.writeFileSync(tmp, src);
  try { return await import(tmp); } finally { fs.unlinkSync(tmp); }
}
globalThis.fetch = async () => new Response("{}", { status: 503 });
const sql = [];
const stmt = (q, a = []) => ({
  bind: (...b) => stmt(q, b),
  run: async () => { sql.push([q, a]); return {}; },
  all: async () => { sql.push([q, a]); return { results: [] }; },
  first: async () => { sql.push([q, a]); return null; },
});
const env = {
  TFNSW_API_KEY: "test",
  ADMIN_KEY: "test-admin-key-123",
  DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) },
  ASSETS: { fetch: async () => new Response("<h1>page</h1>", { status: 404, headers: { "content-type": "text/html" } }) },
};
const W = await loadWorker();
let ipN = 1;
const call = (p, init = {}) => W.__default.fetch(new Request("https://t.example" + p, { ...init, headers: { "cf-connecting-ip": `10.9.0.${ipN++ % 250}`, ...(init.headers || {}) } }), env, { waitUntil() {} });
const big = (n) => JSON.stringify({ device: "dev_abcdefghijklmnopqrstuv", pad: "x".repeat(n) });

test("a body over 128 KB is refused with 413 before it is read", async () => {
  for (const p of ["/api/live-activity/forget", "/api/push/unsubscribe", "/api/history/delete", "/api/watch", "/api/live-activity"]) {
    const body = big(140 * 1024);
    const r = await call(p, { method: "POST", body, headers: { "content-type": "application/json", "content-length": String(body.length) } });
    assert.equal(r.status, 413, p);
    const b = await r.json();
    assert.match(b.error, /too big/i, p);
  }
});

test("normal bodies (a long regional trip, 60 KB) still go through", async () => {
  const body = big(60 * 1024);
  const r = await call("/api/live-activity/forget", { method: "POST", body, headers: { "content-type": "application/json", "content-length": String(body.length) } });
  assert.notEqual(r.status, 413);
});

test("admin, engine load, planner and budget routes are not capped (files and timetables)", () => {
  const i = SRC.indexOf("const BODY_MAX");
  assert.ok(i > 0, "BODY_MAX defined");
  assert.match(SRC, /BODY_MAX = 128 \* 1024/);
  assert.match(SRC, /BODY_UNCAPPED_RE = \/\^\\\/api\\\/\(admin\|engine\\\/load\|raptor\|budget\)\\\//);
});

test("/api/push/unsubscribe clamps the endpoint at 1000 characters", async () => {
  sql.length = 0;
  const endpoint = "https://push.example/" + "a".repeat(3000);
  const r = await call("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint, device: "dev_abcdefghijklmnopqrstuv" }), headers: { "content-type": "application/json" } });
  assert.equal(r.status, 200);
  const del = sql.find(([q]) => /DELETE FROM push_subs/.test(q));
  assert.ok(del, "the delete ran");
  assert.equal(del[1][0].length, 1000);
});
