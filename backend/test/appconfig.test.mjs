// Remote config for the phone apps: GET /api/app/config gives safe defaults, a stored override
// is merged over them, and only an admin can change it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
let src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { __default, mergeAppConfig };\n";
const tmp = `/tmp/appconfig-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);
globalThis.fetch = async () => new Response("{}", { status: 503 });

let stored = null;
const stmt = (q, args = []) => ({
  bind: (...a) => stmt(q, a),
  run: async () => { if (/INSERT INTO app_config/.test(q)) stored = args[1]; return { meta: { changes: 1 } }; },
  all: async () => ({ results: [] }),
  first: async () => (/SELECT body FROM app_config/.test(q) && stored ? { body: stored } : null),
});
const env = { TFNSW_API_KEY: "t", DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) }, ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
const get = (ip) => W.__default.fetch(new Request("https://t.example/api/app/config?platform=ios", { headers: { "cf-connecting-ip": ip } }), env, { waitUntil() {} });

test("defaults: every feature on, four tabs, timings", async () => {
  const r = await get("10.7.0.1");
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.platform, "ios");
  assert.equal(d.flags.liveTrip, true);
  assert.deepEqual(d.tabs, ["home", "plan", "watching", "more"]);
  assert.equal(d.timing.alertRepeatWindowMin, 15);
  assert.deepEqual(d.kill, {});
  assert.match(r.headers.get("cache-control") || "", /max-age=300/);
});

test("a stored override merges over the defaults", async () => {
  stored = JSON.stringify({ flags: { ask: false }, kill: { liveTrip: "Live trips are paused for a moment." }, copy: { welcomeTitle: "Hi" }, tabs: ["plan", "home", "more"] });
  const d = await (await get("10.7.0.2")).json();
  assert.equal(d.flags.ask, false);
  assert.equal(d.flags.liveTrip, true);
  assert.equal(d.kill.liveTrip, "Live trips are paused for a moment.");
  assert.equal(d.copy.welcomeTitle, "Hi");
  assert.deepEqual(d.tabs, ["plan", "home", "more"]);
  assert.equal(d.timing.liveRefreshSec, 15);
  stored = null;
});

test("only an admin can change it", async () => {
  const r = await W.__default.fetch(new Request("https://t.example/api/app/config", { method: "POST", headers: { "cf-connecting-ip": "10.7.0.3", "content-type": "application/json" }, body: "{}" }), env, { waitUntil() {} });
  assert.equal(r.status, 403);
});

test("merge ignores junk", () => {
  const d = W.mergeAppConfig({ flags: [1, 2], tabs: "x", timing: null });
  assert.equal(d.flags.ask, true);
  assert.deepEqual(d.tabs, ["home", "plan", "watching", "more"]);
});
