// Builds the deployable folder (default: site/): the static files plus worker.mjs.
// Secrets are read from the environment (or a local .env file) and written only into
// the server side worker: TFNSW_API_KEY, VAPID_PRIVATE_KEY, TICK_KEY, ADMIN_KEY.
// VAPID_PUBLIC_KEY is public by design and is also served to the browser.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

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
// Security headers for the static files (served before the worker runs). The Content
// Security Policy allows only this site's own scripts plus the exact inline scripts in the
// built pages, hashed here at build time so later page edits stay covered.
const htmlFiles = [];
const walkOut = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walkOut(f); else if (e.name.endsWith(".html")) htmlFiles.push(f); } };
walkOut(out);
const hashes = new Set();
for (const f of htmlFiles) {
  for (const m of fs.readFileSync(f, "utf8").matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    hashes.add("'sha256-" + crypto.createHash("sha256").update(m[1], "utf8").digest("base64") + "'");
  }
}
const csp = [
  "default-src 'self'",
  "script-src 'self' " + [...hashes].sort().join(" "),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");
fs.writeFileSync(path.join(out, "_headers"), [
  "/*",
  "  Content-Security-Policy: " + csp,
  "  Strict-Transport-Security: max-age=31536000",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  Permissions-Policy: geolocation=(self), microphone=(self), camera=(), payment=(), usb=(), browsing-topics=()",
  "  X-Frame-Options: DENY",
  "  Cross-Origin-Opener-Policy: same-origin",
  "",
].join("\n"));
// The hosting serves static pages without the headers above, so each page also carries the
// policy in a meta tag (frame-ancestors only works as a header, so it is left out here).
const metaCsp = csp.split("; ").filter((d) => !d.startsWith("frame-ancestors")).join("; ");
for (const f of htmlFiles) {
  const html = fs.readFileSync(f, "utf8");
  if (html.includes('http-equiv="Content-Security-Policy"')) continue;
  fs.writeFileSync(f, html.replace(/<head([^>]*)>/i, (m) => m + '\n<meta http-equiv="Content-Security-Policy" content="' + metaCsp + '">'));
}
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
