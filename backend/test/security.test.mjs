// Security checks: admin keys, rate limits, response headers, error text, query limits and
// the build's Content Security Policy. Runs offline against the worker source.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => fs.readFileSync(root + p, "utf8");

async function loadWorker() {
  let src = read("src/worker.js").replace(/export default\s*\{/, "const __default = {");
  src += "\nexport { __default, safeEq, rateOk };\n";
  const tmp = `/tmp/sec-test-${process.pid}-${Date.now()}.mjs`;
  fs.writeFileSync(tmp, src);
  try { return await import(tmp); } finally { fs.unlinkSync(tmp); }
}
globalThis.fetch = async () => new Response("{}", { status: 503 });
const sql = [];
const stmt = (q) => ({
  bind: (...a) => stmt(q),
  run: async () => { sql.push(q); return {}; },
  all: async () => { sql.push(q); return { results: [] }; },
  first: async () => { sql.push(q); return null; },
});
const env = {
  TFNSW_API_KEY: "test",
  ADMIN_KEY: "test-admin-key-123",
  DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) },
  ASSETS: { fetch: async () => new Response("<h1>page</h1>", { status: 404, headers: { "content-type": "text/html" } }) },
};
const W = await loadWorker();
const call = (p, init = {}, ip = "10.0.0.1") => W.__default.fetch(new Request("https://t.example" + p, { ...init, headers: { "cf-connecting-ip": ip, ...(init.headers || {}) } }), env, { waitUntil() {} });

test("admin endpoints refuse a wrong or missing key", async () => {
  for (const p of ["/api/stats", "/api/feedback", "/api/admin/searches", "/api/admin/sim?id=x", "/api/tick"]) {
    assert.equal((await call(p)).status, 403, p);
    assert.equal((await call(p + (p.includes("?") ? "&" : "?") + "key=wrong")).status, 403, p);
  }
});

test("admin key works only from the x-admin-key header, never the address", async () => {
  // The key comes from the Worker secret (env.ADMIN_KEY); the unfilled build placeholder never works.
  assert.equal((await call("/api/stats", { headers: { "x-admin-key": "test-admin-key-123" } })).status, 200);
  assert.equal((await call("/api/stats?key=test-admin-key-123")).status, 403);
  assert.equal((await call("/api/stats", { headers: { "x-admin-key": "__ADMIN_KEY__" } })).status, 403);
  assert.equal((await call("/api/health")).status, 403);
  assert.equal((await call("/api/health", { headers: { "x-admin-key": "test-admin-key-123" } })).status, 200);
  const u = await (await call("/api/usage")).json();
  assert.deepEqual(Object.keys(u), ["observations"], "public usage shows only the recorded count");
});

test("key compare is exact", () => {
  assert.equal(W.safeEq("abc", "abc"), true);
  for (const [a, b] of [["abc", "abd"], ["abc", "ab"], ["", ""], ["abc", ""], ["abcabc", "abc"]]) assert.equal(W.safeEq(a, b), false, a + "|" + b);
});

test("contact form is rate limited per address", async () => {
  const post = (ip) => call("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "The departures board froze at Central", topic: "problem" }) }, ip);
  for (let i = 0; i < 5; i++) assert.equal((await post("10.0.0.9")).status, 200);
  const r = await post("10.0.0.9");
  assert.equal(r.status, 429);
  assert.equal((await post("10.0.0.10")).status, 200, "another address still works");
});

test("API answers carry security headers and no internal error text", async () => {
  const r = await call("/api/nope");
  assert.equal(r.status, 404);
  for (const h of ["x-content-type-options", "referrer-policy", "strict-transport-security", "content-security-policy", "x-frame-options"]) assert.ok(r.headers.get(h), h);
  const src = read("src/worker.js");
  assert.ok(!/detail: String\(\(e && e\.message\)/.test(src), "502 answers must not echo exception text");
  const page = await call("/does-not-exist/");
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
});

test("observation queries cap the row limit", async () => {
  sql.length = 0;
  await call("/api/obs?limit=-1");
  await call("/api/obs?limit=abc");
  await call("/api/obs?limit=99999");
  const lims = sql.filter((q) => q.includes("FROM obs") && q.includes("LIMIT")).map((q) => Number(q.match(/LIMIT (\S+)/)[1]));
  assert.deepEqual(lims, [1, 200, 1000]);
});

test("profile in a saved trip body cannot crash the handler", async () => {
  const r = await call("/api/saved", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile: 12345, name: "" }) });
  assert.equal(r.status, 400);
});

test("retention purges run in the hourly housekeeping", () => {
  const src = read("src/worker.js");
  for (const s of ["DELETE FROM searches WHERE at < ?1", "DELETE FROM watches WHERE active = 0 AND updated < ?1", "DELETE FROM feedback WHERE at < ?1"]) assert.ok(src.includes(s), s);
});

test("web app makes long random ids and asks before a ?me= link switches profile", () => {
  const js = read("src/public/app.js");
  assert.ok(js.includes("crypto.getRandomValues"), "secure ids");
  assert.ok(/qp\.has\("me"\)[\s\S]{0,400}window\.confirm/.test(js), "confirm before switching");
});

test("build moves every page into the worker with a hash for every inline script, and writes no _headers", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "sec-build-"));
  const fake = { TFNSW_API_KEY: "t", VAPID_PUBLIC_KEY: "t", VAPID_PRIVATE_KEY: "t", VAPID_SUBJECT: "mailto:t@example.com", TICK_KEY: "t", ADMIN_KEY: "t" };
  execFileSync(process.execPath, [root + "build.mjs", out], { env: { ...process.env, ...fake }, stdio: "pipe" });
  assert.ok(!fs.existsSync(path.join(out, "_headers")), "no _headers file");
  const left = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith(".html")) left.push(f); } };
  walk(out);
  assert.deepEqual(left, [], "no html left in the static assets");
  const wsrc = fs.readFileSync(path.join(out, "worker.mjs"), "utf8");
  assert.ok(!wsrc.includes("/*__PAGES__*/") && !wsrc.includes("/*__PAGE_CSP__*/"), "markers filled");
  const tmp = path.join(out, "w-test.mjs");
  fs.writeFileSync(tmp, wsrc);
  const BW = await import(tmp);
  const assets = { fetch: async () => new Response("nope", { status: 404 }) };
  const benv = { ...env, ASSETS: assets };
  const get = (p, method = "GET") => BW.default.fetch(new Request("https://t.example" + p, { method, headers: { "cf-connecting-ip": "10.7.0.1" } }), benv, { waitUntil() {} });
  for (const p of ["/", "/privacy/", "/support/", "/support/thanks/", "/terms/", "/download/", "/live/"]) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get("content-type"), /text\/html/, p);
    for (const k of ["strict-transport-security", "x-content-type-options", "referrer-policy", "permissions-policy", "x-frame-options", "cross-origin-opener-policy"]) assert.ok(r.headers.get(k), p + " " + k);
    const csp = r.headers.get("content-security-policy");
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "script-src 'self' 'sha256-"]) assert.ok(csp.includes(d), p + " " + d);
    const html = await r.text();
    const at = html.indexOf('http-equiv="Content-Security-Policy"');
    assert.ok(at > 0 && (html.indexOf("<script") < 0 || at < html.indexOf("<script")), p + " meta CSP first");
  }
  const red = await get("/privacy");
  assert.equal(red.status, 301);
  assert.equal(red.headers.get("location"), "/privacy/");
  assert.equal((await get("/index.html")).headers.get("location"), "/");
  const nf = await get("/no-such-page");
  assert.equal(nf.status, 404);
  assert.ok(nf.headers.get("strict-transport-security") && nf.headers.get("content-security-policy").includes("frame-ancestors"));
  fs.rmSync(out, { recursive: true, force: true });
});
