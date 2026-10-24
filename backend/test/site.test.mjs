// Checks the built site: core files, phone viewport, no secrets, no dashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const pub = path.join(root, "src/public");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("page has title, viewport and local assets", () => {
  const html = read("src/public/index.html");
  assert.match(html, /<title>Transport/);
  assert.match(html, /name="viewport" content="width=device-width/);
  for (const ref of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
    const f = ref[1].split(/[?#]/)[0];
    if (f === "/" || f.endsWith("/")) continue;
    assert.ok(fs.existsSync(path.join(pub, f)), "missing asset " + ref[1]);
  }
});

test("no API key in the public files or source", () => {
  const files = ["src/public/app.js", "src/public/index.html", "src/worker.js", "README.md"];
  for (const f of files) assert.doesNotMatch(read(f), new RegExp("eyJhbG" + "ciOi"), f + " contains a key");
  assert.match(read("src/worker.js"), /__TFNSW_API_KEY__/);
  for (const k of ["VAPID_PRIVATE_KEY", "TICK_KEY", "ADMIN_KEY"]) assert.match(read("src/worker.js"), new RegExp("__" + k + "__"), k + " must stay a placeholder in source");
  assert.ok(fs.existsSync(path.join(pub, "sw.js")), "service worker present");
});

test("no em dashes or en dashes anywhere", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (["node_modules", "site", ".git"].includes(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
  for (const f of walk(root).filter((f) => /\.(js|mjs|css|html|md|json|py)$/.test(f))) {
    assert.doesNotMatch(fs.readFileSync(f, "utf8"), /[\u2013\u2014]/, f);
  }
});

test("live features are present in the app", () => {
  const js = read("src/public/app.js");
  for (const s of ["`Live ${fmtSecs(S.lastOk)}`", "Scheduled", "/api/service", "every(15000", "every(10000", "tb_saved", "tb_stars"]) assert.ok(js.includes(s), "missing " + s);
});

test("proactive layer is present", () => {
  const js = read("src/public/app.js"), w = read("src/worker.js"), sw = read("src/public/sw.js");
  for (const s of ["pushManager.subscribe", "/api/watch", "openWatchSheet", "openCommuteSheet", "Make this your"]) assert.ok(js.includes(s), "app missing " + s);
  for (const s of ["aes128gcm", "vapid t=", "runTick", "rescuePlan", "Connection at risk", "commuteSuggestion", "predictions("]) assert.ok(w.includes(s), "worker missing " + s);
  for (const s of ["addEventListener(\"push\"", "showNotification", "notificationclick"]) assert.ok(sw.includes(s), "sw missing " + s);
});

test("worker merges GTFS realtime feeds", () => {
  const w = read("src/worker.js");
  for (const s of ["/v1/gtfs/realtime/buses", "/v1/gtfs/vehiclepos/buses", "/v2/gtfs/realtime/sydneytrains", "readTripUpdate", "readVehiclePosition", "CREATE TABLE IF NOT EXISTS obs"]) assert.ok(w.includes(s), "missing " + s);
});
