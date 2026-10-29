// Hosts and the Cloudflare move: the API host serves only the API, the live trip page and the APK;
// the site's paths redirect to transportsydney.app; any other host (the old address) keeps working
// as before; copy.api_base can be set by an admin; secrets come from Worker secrets; the minute
// tick runs from a Cron Trigger; the export endpoint and the D1 migration cover every table.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { makeD1 } from "./helpers/d1.mjs";
import { schemaSql } from "../tools/schema.mjs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => fs.readFileSync(root + p, "utf8");
let src = read("src/worker.js").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default, runTick };\n";
const tmp = `/tmp/hosts-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

globalThis.fetch = async () => new Response("{}", { status: 503 });
const assetsSeen = [];
const DB = makeD1();
const baseEnv = {
  TFNSW_API_KEY: "t",
  ADMIN_KEY: "admin-test-key-456",
  TICK_KEY: "tick-test-key-789",
  VAPID_PUBLIC_KEY: "BPublicKeyFromSecret",
  DB,
  ASSETS: { fetch: async (req) => { const u = new URL(req.url); assetsSeen.push(u.pathname); return new Response("asset " + u.pathname, { status: 200, headers: { "content-type": "text/plain" } }); } },
};
let ip = 1;
const call = (url, init = {}, env = baseEnv) => W.__default.fetch(new Request(url, { ...init, headers: { "cf-connecting-ip": "10.9.0." + (ip++ % 250), ...(init.headers || {}) } }), env, { waitUntil() {} });
const API = "https://api.transportsydney.app";
const OLD = "https://old-address.example";
const ADMIN = { "x-admin-key": "admin-test-key-456" };

test("API host: the API answers with open CORS, and preflight works", async () => {
  const r = await call(API + "/api/app/config?platform=ios");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const pre = await call(API + "/api/morning-check", { method: "OPTIONS", headers: { origin: "https://example.com", "access-control-request-method": "POST" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "*");
  assert.match(pre.headers.get("access-control-allow-methods"), /POST/);
});

test("API host: home and site pages redirect to transportsydney.app", async () => {
  for (const [p, to] of [["/", "/"], ["/index.html", "/"], ["/privacy", "/privacy/"], ["/privacy/", "/privacy/"], ["/support/thanks/", "/support/"], ["/terms", "/terms/"], ["/download/", "/"], ["/download", "/"]]) {
    const r = await call(API + p);
    assert.equal(r.status, 301, p);
    assert.equal(r.headers.get("location"), "https://transportsydney.app" + to, p);
  }
});

test("API host: the station and suburb lists the app keeps for Ask are served, with open CORS", async () => {
  for (const n of ["train", "metro", "lightrail", "ferry", "places"]) {
    assetsSeen.length = 0;
    const r = await call(API + `/stations/${n}.json`);
    assert.equal(r.status, 200, n);
    assert.equal(r.headers.get("access-control-allow-origin"), "*", n);
    assert.deepEqual(assetsSeen, [`/stations/${n}.json`]);
  }
});

test("API host: the old web app and data files are not served", async () => {
  assetsSeen.length = 0;
  for (const p of ["/app.js", "/ask.js", "/sw.js", "/manifest.webmanifest", "/stations/bus/33.json", "/stops/103.json", "/data/facilities.json", "/img/ask-dark.webp", "/nope", "/worker.mjs"]) {
    const r = await call(API + p);
    assert.equal(r.status, 404, p);
    assert.match(r.headers.get("content-type"), /json/, p);
    assert.equal((await r.json()).site, "https://transportsydney.app");
  }
  assert.deepEqual(assetsSeen, [], "no static file was read");
  const robots = await call(API + "/robots.txt");
  assert.equal(await robots.text(), "User-agent: *\nDisallow: /\n");
});

test("API host: the shared live trip page, its files and the APK are still served", async () => {
  for (const p of ["/live/", "/live/live.js", "/style.css", "/vendor/leaflet.js", "/vendor/leaflet.css", "/favicon-32.png", "/og.png"]) {
    const r = await call(API + p);
    assert.equal(r.status, 200, p);
  }
  assert.equal((await call(API + "/live?t=abc")).headers.get("location"), "/live/?t=abc");
  const apk = await call(API + "/download/transport.apk");
  assert.notEqual(apk.status, 404, "APK route is kept (503 here only because no file store is bound)");
});

test("API_ONLY makes any host API only (workers.dev preview), and SITE_URL moves the redirects", async () => {
  const env = { ...baseEnv, API_ONLY: "1", SITE_URL: "https://staging.example" };
  const r = await call("https://transport.fintex.workers.dev/privacy/", {}, env);
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("location"), "https://staging.example/privacy/");
  assert.equal((await call("https://transport.fintex.workers.dev/app.js", {}, env)).status, 404);
  const bad = await call("https://transport.fintex.workers.dev/", {}, { ...env, SITE_URL: "javascript:alert(1)" });
  assert.equal(bad.headers.get("location"), "https://transportsydney.app/");
});

test("old address: unchanged, so installed app builds keep working until they update", async () => {
  assetsSeen.length = 0;
  const r = await call(OLD + "/app.js");
  assert.equal(r.status, 200);
  assert.deepEqual(assetsSeen, ["/app.js"]);
  const a = await (await call(OLD + "/api/app/config?platform=android")).json();
  const b = await (await call(API + "/api/app/config?platform=android")).json();
  assert.deepEqual(a, b, "same API answer on both hosts");
});

test("copy.api_base: an admin can set it, a bad value is refused, nothing is set by default", async () => {
  DB.sql.exec("DELETE FROM app_config");
  const before = await (await call(API + "/api/app/config?platform=ios")).json();
  assert.equal(before.copy.api_base, undefined);
  const post = (body, platform = "ios") => call(API + "/api/app/config?platform=" + platform, { method: "POST", headers: { ...ADMIN, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await call(API + "/api/app/config?platform=ios", { method: "POST", body: JSON.stringify({ copy: { api_base: API } }) })).status, 403);
  for (const bad of ["http://api.transportsydney.app", "https://api.transportsydney.app/v2", "api.transportsydney.app", "https://", 42]) {
    assert.equal((await post({ copy: { api_base: bad } })).status, 400, String(bad));
  }
  for (const platform of ["ios", "android"]) {
    const r = await post({ copy: { api_base: API } }, platform);
    assert.equal(r.status, 200);
    assert.equal((await (await call(OLD + "/api/app/config?platform=" + platform)).json()).copy.api_base, API, "old address hands out the new one");
  }
  assert.equal((await post({ copy: { api_base: "" } })).status, 200, "an empty value clears it");
  DB.sql.exec("DELETE FROM app_config");
});

test("secrets come from Worker secrets; an unfilled placeholder is never a key", async () => {
  assert.equal((await (await call(API + "/api/push/key")).json()).publicKey, "BPublicKeyFromSecret");
  assert.equal((await call(API + "/api/usage", { headers: ADMIN })).status, 200);
  const noSecrets = { ...baseEnv, ADMIN_KEY: undefined, TICK_KEY: undefined };
  for (const k of ["__ADMIN_KEY__", "__TICK_KEY__", ""]) {
    assert.equal((await call(API + "/api/tick", { headers: { "x-admin-key": k } }, noSecrets)).status, 403, k);
    assert.equal((await call(API + "/api/admin/export", { headers: { "x-admin-key": k } }, noSecrets)).status, 403, k);
  }
  assert.equal((await call(API + "/api/tick", { headers: { "x-admin-key": "tick-test-key-789" } })).status, 200);
});

test("the Cron Trigger runs the minute tick", async () => {
  try { DB.sql.exec("UPDATE meta SET v = '0' WHERE k = 'lease'"); } catch (e) { /* no table yet */ }
  const waits = [];
  await W.__default.scheduled({ cron: "* * * * *", scheduledTime: Date.now() }, baseEnv, { waitUntil: (p) => waits.push(p) });
  // Two jobs (29 Oct): the trip card passes and the minute tick, side by side.
  assert.equal(waits.length, 2);
  await Promise.all(waits);
  const row = DB.sql.prepare("SELECT v FROM meta WHERE k = 'lease'").get();
  assert.ok(row && Number(row.v) > Date.now() - 60000, "the tick took its lease, so it ran");
});

test("export lists every table and pages rows by rowid, admin only", async () => {
  assert.equal((await call(API + "/api/admin/export")).status, 403);
  DB.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)");
  for (let i = 0; i < 5; i++) DB.sql.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").run("exp" + i, "v" + i);
  const list = await (await call(API + "/api/admin/export", { headers: ADMIN })).json();
  const meta = list.tables.find((t) => t.name === "meta");
  assert.ok(meta && meta.rows >= 5 && /CREATE TABLE/.test(meta.sql));
  let after = 0, got = [];
  for (let i = 0; i < 20 && after != null; i++) {
    const page = await (await call(API + `/api/admin/export?table=meta&limit=2&after=${after}`, { headers: ADMIN })).json();
    got.push(...page.rows); after = page.next;
  }
  assert.equal(got.length, meta.rows);
  assert.equal(new Set(got.map((r) => r.__rowid)).size, got.length, "no row twice");
  assert.equal((await call(API + "/api/admin/export?table=sqlite_master", { headers: ADMIN })).status, 404);
  assert.equal((await call(API + '/api/admin/export?table=meta";DROP TABLE meta;--', { headers: ADMIN })).status, 404);
  assert.equal((await call(API + "/api/admin/export", { method: "POST", headers: ADMIN })).status, 405);
});

test("the D1 migration is generated from the worker, creates every table and runs clean", () => {
  const file = read("migrations/0001_init.sql");
  assert.equal(file, schemaSql(read("src/worker.js")), "run node tools/schema.mjs");
  const w = read("src/worker.js");
  const names = [...new Set([...w.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]))];
  assert.ok(names.length >= 20);
  const db = new DatabaseSync(":memory:");
  db.exec(file);
  const have = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const n of names) assert.ok(have.includes(n), "table " + n);
  assert.ok(db.prepare("PRAGMA table_info(morning_checks)").all().some((c) => c.name === "mode"));
});

test("Cloudflare deploy files: config from the environment, no secrets, no old address", () => {
  const toml = read("wrangler.toml.template");
  for (const k of ["${CF_ACCOUNT_ID}", "${D1_DATABASE_ID}", "api.transportsydney.app", 'API_ONLY = "1"', "crons", "run_worker_first = true"]) assert.ok(toml.includes(k), k);
  for (const f of ["wrangler.toml.template", "tools/deploy-cloudflare.sh", "tools/export-d1.mjs", "../docs/DEPLOY_CLOUDFLARE.md"]) {
    const t = read(f);
    assert.doesNotMatch(t, new RegExp(["tab", "bot"].join("\\.") + "|nsw-transport-" + "bot", "i"), f);
    assert.doesNotMatch(t, /[\u2013\u2014]/, f);
    assert.doesNotMatch(t, /eyJhbG|apikey [A-Za-z0-9]{20}/, f);
  }
});
