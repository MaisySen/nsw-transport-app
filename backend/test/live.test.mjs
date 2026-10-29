// Live trip sharing: create, follow, update, stop, expiry, and key checks. Runs offline
// against the worker source with a small in memory stand in for the shares table.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
async function loadWorker() {
  let src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {");
  src += "\nexport { __default, sharePos, shareProg, shareExpiry };\n";
  const tmp = `/tmp/live-test-${process.pid}-${Date.now()}.mjs`;
  fs.writeFileSync(tmp, src);
  try { return await import(tmp); } finally { fs.unlinkSync(tmp); }
}
globalThis.fetch = async () => new Response("{}", { status: 503 });
const rows = new Map();
const stmt = (q, a = []) => ({
  bind: (...x) => stmt(q, x),
  run: async () => {
    if (/^INSERT INTO shares/.test(q)) rows.set(a[0], { id: a[0], okey: a[1], device: a[2], spec: a[3], state: a[4], created: a[5], updated: a[5], expires: a[6] });
    else if (/^UPDATE shares/.test(q)) Object.assign(rows.get(a[0]), { spec: a[1], state: a[2], updated: a[3], expires: a[4] });
    else if (/^DELETE FROM shares WHERE id/.test(q)) rows.delete(a[0]);
    else if (/^DELETE FROM shares WHERE expires/.test(q)) { for (const [k, r] of rows) if (r.expires < a[0]) rows.delete(k); }
    return {};
  },
  all: async () => ({ results: [] }),
  first: async () => (/FROM shares WHERE id/.test(q) ? rows.get(a[0]) || null : null),
});
const env = { TFNSW_API_KEY: "test", DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) } };
const W = await loadWorker();
const call = (p, init = {}, ip = "10.1.0.1") => W.__default.fetch(new Request("https://t.example" + p, { ...init, headers: { "cf-connecting-ip": ip, "content-type": "application/json", ...(init.headers || {}) } }), env, { waitUntil() {} });
const soon = (m) => new Date(Date.now() + m * 60000).toISOString();
const legs = [
  { mode: "train", line: "T1", tripId: "1-A", stopId: "2000334", toStopId: "2000337", from: "Central", to: "Redfern", planned: soon(3), arrPlanned: soon(6) },
  { mode: "bus", line: "343", tripId: "2-B", stopId: "201510", toStopId: "200060", from: "Redfern", to: "Circular Quay", planned: soon(12), arrPlanned: soon(30), walkBefore: 4 },
];

test("share a live trip, follow it, update it and stop it", async () => {
  const r = await call("/api/share", { method: "POST", body: JSON.stringify({ device: "dtest", title: "Central to Circular Quay", from: { id: "1", name: "Central" }, to: { id: "2", name: "Circular Quay" }, legs, pos: { lat: -33.88312345, lon: 151.20654321, acc: 12 } }) });
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.match(s.id, /^[A-Za-z0-9_-]{16}$/);
  assert.ok(s.key.length >= 24 && s.key !== s.id);
  assert.match(s.url, /\/live\/\?t=/);
  const g = await (await call("/api/share?id=" + s.id)).json();
  assert.equal(g.legs.length, 2);
  assert.equal(g.title, "Central to Circular Quay");
  assert.deepEqual([g.pos.lat, g.pos.lon], [-33.88312, 151.20654], "position is rounded");
  assert.equal(g.key, undefined, "the owner key is never sent to viewers");
  assert.equal(JSON.stringify(g).includes("dtest"), false, "the device id is never sent to viewers");
  const bad = await call("/api/share/update", { method: "POST", body: JSON.stringify({ id: s.id, key: "wrong", pos: { lat: 1, lon: 1 } }) });
  assert.equal(bad.status, 404);
  const up = await call("/api/share/update", { method: "POST", body: JSON.stringify({ id: s.id, key: s.key, pos: null, prog: { leg: 1, phase: "riding", next: "Town Hall", stopsLeft: 3, eta: Date.now() + 20 * 60000 } }) });
  assert.equal(up.status, 200);
  const g2 = await (await call("/api/share?id=" + s.id)).json();
  assert.equal(g2.pos, null, "turning location off removes it");
  assert.equal(g2.prog.next, "Town Hall");
  assert.equal((await call(`/api/share?id=${s.id}&key=wrong`, { method: "DELETE" })).status, 404);
  assert.equal((await call(`/api/share?id=${s.id}`, { method: "DELETE", headers: { "x-share-key": s.key } })).status, 200);
  assert.equal(rows.has(s.id), false, "stopping deletes the row and every position");
  const gone = await call("/api/share?id=" + s.id);
  assert.equal(gone.status, 404);
  assert.equal((await gone.json()).ended, true);
});

test("a shared trip expires after it ends and is deleted", async () => {
  const r = await (await call("/api/share", { method: "POST", body: JSON.stringify({ legs }) })).json();
  rows.get(r.id).expires = Date.now() - 1000;
  const g = await call("/api/share?id=" + r.id);
  assert.equal(g.status, 404);
  assert.equal(rows.has(r.id), false);
});

test("expiry follows the live arrival but never passes six hours", () => {
  const now = Date.now();
  const spec = { legs };
  const e1 = W.shareExpiry(spec, null, now, now);
  assert.ok(e1 > now + 30 * 60000 && e1 < now + 70 * 60000);
  const e2 = W.shareExpiry(spec, { eta: now + 20 * 3600000 }, now, now);
  assert.equal(e2, now + 6 * 3600000);
});

test("bad input is refused", async () => {
  assert.equal((await call("/api/share", { method: "POST", body: JSON.stringify({ legs: [] }) })).status, 400);
  assert.equal((await call("/api/share?id=../../x")).status, 404);
  assert.equal(W.sharePos({ lat: 200, lon: 1 }, 1), null);
  assert.equal(W.sharePos({ lat: "x", lon: 1 }, 1), null);
  const p = W.shareProg({ leg: 99, next: "a\u0000b".repeat(50), stopsLeft: -3 });
  assert.equal(p.leg, 5);
  assert.equal(p.stopsLeft, 0);
  assert.ok(p.next.length <= 80 && !p.next.includes("\u0000"));
});

test("creating shares is rate limited per address", async () => {
  let last = 200;
  for (let i = 0; i < 25; i++) last = (await call("/api/share", { method: "POST", body: JSON.stringify({ legs }) }, "10.9.9.9")).status;
  assert.equal(last, 429);
});

test("web app: Start trip, the live trip screen and sharing; no old privacy copy", () => {
  const app = fs.readFileSync(root + "src/public/app.js", "utf8");
  assert.match(app, /data-go>\$\{I\.loc\}Start trip/);
  assert.match(app, /path === "\/go"\) goView\(\)/);
  assert.match(app, /\/api\/share\/update/);
  assert.match(app, /track: true/);
  const live = fs.readFileSync(root + "src/public/live/index.html", "utf8");
  assert.doesNotMatch(live, /<script(?![^>]*\bsrc=)[^>]*>/, "the viewer page has no inline script");
  assert.match(live, /<meta name="viewport"/);
  assert.match(fs.readFileSync(root + "src/public/live/live.js", "utf8"), /This trip has ended/);
  // The old privacy copy in src/public was deleted (30 Oct); the policy is site/privacy/ only.
  assert.ok(!fs.existsSync(root + "src/public/privacy"), "no old privacy copy");
});

test("watches started from Start trip are marked for the one stop before alert", () => {
  const w = fs.readFileSync(root + "src/worker.js", "utf8");
  assert.match(w, /track: !!b\.track/);
  assert.match(w, /spec\.track && l\.tripId/);
  assert.match(w, /Next stop: \$\{l\.to\}/);
  assert.match(w, /DELETE FROM shares WHERE expires < \?1/);
});

test("a share made on the old address is read from there (TEMP until the apps move)", async () => {
  const seen = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (u) => {
    seen.push(String(u));
    if (String(u).startsWith("https://old.example/api/share?id=OldShare12345")) return new Response(JSON.stringify({ id: "OldShare12345", title: "From the old address", legs: [] }), { status: 200 });
    if (String(u).startsWith("https://old.example/api/share?id=")) return new Response(JSON.stringify({ ended: true, error: "This trip has ended." }), { status: 404 });
    return new Response("{}", { status: 503 });
  };
  const envF = { ...env, SHARE_FALLBACK_BASE: "https://old.example" };
  const get = (id) => W.__default.fetch(new Request("https://t.example/api/share?id=" + id, { headers: { "cf-connecting-ip": "10.1.0.9" } }), envF, { waitUntil() {} });
  try {
    const ok = await get("OldShare12345");
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).title, "From the old address");
    const gone = await get("NotThere12345");
    assert.equal(gone.status, 404);
    assert.equal((await gone.json()).ended, true);
    // Without the setting nothing is asked.
    const n = seen.length;
    const none = await W.__default.fetch(new Request("https://t.example/api/share?id=OldShare12345", { headers: { "cf-connecting-ip": "10.1.0.9" } }), env, { waitUntil() {} });
    assert.equal(none.status, 404);
    assert.equal(seen.filter((u) => u.includes("old.example")).length, n);
  } finally {
    globalThis.fetch = prev;
  }
});
