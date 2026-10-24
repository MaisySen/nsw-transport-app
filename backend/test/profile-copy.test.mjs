// Admin profile copy: needs the admin key, a POST and a long new id, and copies rows to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
let src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {");
const ADMIN = "test-admin-key-123";
src = src.split("__ADMIN_KEY__").join(ADMIN) + "\nexport { __default };\n";
const tmp = `/tmp/profile-copy-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
globalThis.fetch = async () => new Response("{}", { status: 503 });

const inserts = [];
const rowsFor = { saved: [{ profile: "bidur", name: "home", from_id: "1", from_name: "A", to_id: "2", to_name: "B", created: 1 }], commutes: [{ id: "c1", profile: "bidur", name: "Morning", tod: 480 }] };
const stmt = (q, args = []) => ({
  bind: (...a) => stmt(q, a),
  run: async () => { if (/^INSERT OR IGNORE/.test(q)) inserts.push({ q, args }); return { meta: { changes: 1 } }; },
  all: async () => { const m = q.match(/FROM (\w+) WHERE profile/); return { results: m && args[0] === "bidur" ? rowsFor[m[1]] || [] : [] }; },
  first: async () => null,
});
const env = { TFNSW_API_KEY: "t", DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) }, ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
const call = (init = {}, key) => W.__default.fetch(new Request("https://t.example/api/admin/profile-copy", { ...init, headers: { "cf-connecting-ip": "10.7.7.7", "content-type": "application/json", ...(key ? { "x-admin-key": key } : {}) } }), env, { waitUntil() {} });
const NEW = "p" + "a1b2c3d4e5f6g7h8i9j0k1l2";

test("profile copy refuses a missing or wrong key", async () => {
  assert.equal((await call({ method: "POST", body: JSON.stringify({ from: "bidur", to: NEW }) })).status, 403);
  assert.equal((await call({ method: "POST", body: JSON.stringify({ from: "bidur", to: NEW }) }, "wrong")).status, 403);
});
test("profile copy refuses GET and short ids", async () => {
  assert.equal((await call({ method: "GET" }, ADMIN)).status, 405);
  assert.equal((await call({ method: "POST", body: JSON.stringify({ from: "bidur", to: "short" }) }, ADMIN)).status, 400);
  assert.equal((await call({ method: "POST", body: JSON.stringify({ from: "bidur", to: "bidur" }) }, ADMIN)).status, 400);
});
test("profile copy copies rows to the new id with fresh commute ids", async () => {
  const r = await call({ method: "POST", body: JSON.stringify({ from: "bidur", to: NEW }) }, ADMIN);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.copied.saved.copied, 1);
  assert.equal(d.copied.commutes.copied, 1);
  const saved = inserts.find((i) => /INTO saved \(/.test(i.q));
  assert.ok(saved.args.includes(NEW) && !saved.args.includes("bidur"));
  const com = inserts.find((i) => /INTO commutes/.test(i.q));
  assert.ok(!com.args.includes("c1"), "commute gets a new id");
});
