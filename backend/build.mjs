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
// The Content Security Policy allows only this site's own scripts plus the exact inline
// scripts in the built pages, hashed here at build time so later page edits stay covered.
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
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://tiles.openfreemap.org",
  "connect-src 'self' https://tiles.openfreemap.org",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "child-src blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");
// The host serves static files before the worker runs and ignores a _headers file, so every
// HTML page is moved into the worker (PAGES) and served there with the full header set,
// including frame-ancestors and HSTS. The pages also keep the policy in a meta tag.
const metaCsp = csp.split("; ").filter((d) => !d.startsWith("frame-ancestors")).join("; ");
const pages = {};
for (const f of htmlFiles) {
  let html = fs.readFileSync(f, "utf8");
  if (!html.includes('http-equiv="Content-Security-Policy"')) html = html.replace(/<head([^>]*)>/i, (m) => m + '\n<meta http-equiv="Content-Security-Policy" content="' + metaCsp + '">');
  const rel = "/" + path.relative(out, f).split(path.sep).join("/");
  pages[rel.endsWith("/index.html") || rel === "/index.html" ? rel.slice(0, -"index.html".length) : rel] = html;
  fs.rmSync(f);
}
for (const k of ["/", "/404.html", "/privacy/", "/support/", "/terms/", "/download/", "/live/"]) {
  if (!(k in pages)) { console.error("Missing page " + k); process.exit(1); }
}
const marker = (name) => { const re = new RegExp("[^\\n]*/\\*__" + name + "__\\*/"); if (!re.test(worker)) { console.error("worker.js lacks the " + name + " marker"); process.exit(1); } return re; };
worker = worker.replace(marker("PAGES"), () => "const PAGES = " + JSON.stringify(pages) + ";");
worker = worker.replace(marker("PAGE_CSP"), () => "const PAGE_CSP = " + JSON.stringify(csp) + ";");
fs.writeFileSync(path.join(out, "worker.mjs"), worker);
fs.rmSync(path.join(out, "_headers"), { force: true });
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
