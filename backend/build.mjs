// Builds the deployable folder (default: site/): the static files plus worker.mjs.
// Secrets are read from the environment (or a local .env file) and written only into
// the server side worker: TFNSW_API_KEY, VAPID_PRIVATE_KEY, TICK_KEY, ADMIN_KEY.
// VAPID_PUBLIC_KEY is public by design and is also served to the browser.
import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const out = process.argv[2] || path.join(root, "site");

const envFile = path.join(root, ".env");
const fileEnv = {};
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) fileEnv[m[1]] = m[2].trim();
  }
}
const need = ["TFNSW_API_KEY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "TICK_KEY", "ADMIN_KEY"];
const vals = {};
for (const k of need) {
  vals[k] = process.env[k] || fileEnv[k] || "";
  if (!vals[k]) { console.error(`Set ${k} (see .env.example) before building.`); process.exit(1); }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, "src/public"), out, { recursive: true });
let worker = fs.readFileSync(path.join(root, "src/worker.js"), "utf8");
for (const k of need) worker = worker.split(`__${k}__`).join(vals[k]);
fs.writeFileSync(path.join(out, "worker.mjs"), worker);
// Stamp the service worker so each deploy refreshes the offline cache.
const swPath = path.join(out, "sw.js");
if (fs.existsSync(swPath)) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
  fs.writeFileSync(swPath, fs.readFileSync(swPath, "utf8").split("__BUILD__").join(stamp));
}
fs.writeFileSync(path.join(out, "tab-site.json"), JSON.stringify({
  kind: "worker",
  entry: "worker.mjs",
  bindings: [{ type: "d1", name: "DB" }, { type: "r2", name: "FILES" }],
  worker: { compatibility_date: "2026-08-01", compatibility_flags: ["nodejs_compat"] },
}, null, 2));
console.log("Built", out);
