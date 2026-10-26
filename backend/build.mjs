// Builds the deployable folder.
//   node build.mjs [out]                single folder deploy (default out: site/): static files plus
//                                       worker.mjs with the secrets written in from the environment or .env
//   node build.mjs --cloudflare [out]   wrangler deploy (default out: dist/): dist/worker.mjs and the
//                                       static files in dist/public; no secrets are written, the Worker
//                                       reads them from wrangler secrets (see docs/DEPLOY_CLOUDFLARE.md)
// Secrets: TFNSW_API_KEY, VAPID_PRIVATE_KEY, TICK_KEY, ADMIN_KEY. VAPID_PUBLIC_KEY is public by design.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.dirname(new URL(import.meta.url).pathname);
const cf = process.argv.includes("--cloudflare");
const outArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const out = outArg ? path.resolve(outArg) : path.join(root, cf ? "dist" : "site");
const pub = cf ? path.join(out, "public") : out;

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
  if (!vals[k] && !cf) { console.error(`Set ${k} (see .env.example) before building.`); process.exit(1); }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, "src/public"), pub, { recursive: true });
// Every bus and coach stop as [id, name], once each, from the route files (stations/bus/*.json): the stop search
// index the server answers from and the list the app keeps for search as you type (app/src/lib/localSearch.ts).
{
  const dir = path.join(pub, "stations", "bus");
  const seen = new Map();
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const dirs of Object.values(d)) for (const one of Array.isArray(dirs) ? dirs : [dirs]) for (const s of (one && one.stops) || []) if (s && s[0] && s[1] && !seen.has(String(s[0]))) seen.set(String(s[0]), [String(s[0]), String(s[1])]);
  }
  fs.writeFileSync(path.join(pub, "stations", "bus-stops.json"), JSON.stringify([...seen.values()]));
}
let worker = fs.readFileSync(path.join(root, "src/worker.js"), "utf8");
// The board engine (src/engine.js, docs/ENGINE.md) shares the worker's module: it uses the worker's feed readers and
// labels, and its Durable Object class is exported from the same file.
worker += "\n" + fs.readFileSync(path.join(root, "src/engine.js"), "utf8");
// On phone timetable packs (src/pack.js, docs/TIMETABLE_PACKS.md): adds the object's /pack path, after engine.js.
worker += "\n" + fs.readFileSync(path.join(root, "src/pack.js"), "utf8");
// Timetable trips and nearby stops for when the Trip Planner is refused (src/ttplan.js, docs/API.md), after pack.js.
worker += "\n" + fs.readFileSync(path.join(root, "src/ttplan.js"), "utf8");
// Our own trip planner, RAPTOR over the timetable (src/raptor.js, docs/SCALE_1M.md), behind OWN_PLANNER; after ttplan.js.
worker += "\n" + fs.readFileSync(path.join(root, "src/raptor.js"), "utf8");
// Saved trip alerts (src/tripalerts.js, docs/API.md): the minute tick matches service alerts to the phones' trips.
worker += "\n" + fs.readFileSync(path.join(root, "src/tripalerts.js"), "utf8");
// Live push for Trip Planner boards and the socket limits the board shards share (src/livehub.js), last.
worker += "\n" + fs.readFileSync(path.join(root, "src/livehub.js"), "utf8");
if (!cf) for (const k of need) worker = worker.split(`__${k}__`).join(vals[k]);
// The Content Security Policy allows only this site's own scripts plus the exact inline
// scripts in the built pages, hashed here at build time so later page edits stay covered.
const htmlFiles = [];
const walkOut = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walkOut(f); else if (e.name.endsWith(".html")) htmlFiles.push(f); } };
walkOut(pub);
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
  const rel = "/" + path.relative(pub, f).split(path.sep).join("/");
  pages[rel.endsWith("/index.html") || rel === "/index.html" ? rel.slice(0, -"index.html".length) : rel] = html;
  fs.rmSync(f);
}
for (const k of cf ? ["/live/"] : ["/", "/404.html", "/privacy/", "/support/", "/terms/", "/download/", "/live/"]) {
  if (!(k in pages)) { console.error("Missing page " + k); process.exit(1); }
}
// The Cloudflare deploy serves the API, the shared live trip page and the APK only (the public site
// is static on its own domain), so the old web app files and pages are left out of it.
if (cf) {
  for (const k of Object.keys(pages)) if (k !== "/live/") delete pages[k];
  for (const f of ["app.js", "ask.js", "ask.css", "hit.js", "sw.js", "manifest.webmanifest", "site.css", "robots.txt", "sitemap.xml", "img", "download", "icon-maskable-512.png", "icon-1024.png", "vendor/maplibre-gl.js", "vendor/maplibre-gl.css", "vendor/leaflet-maplibre-gl.js"]) {
    fs.rmSync(path.join(pub, f), { recursive: true, force: true });
  }
  for (const d of fs.readdirSync(pub)) {
    const p = path.join(pub, d);
    if (fs.statSync(p).isDirectory() && !fs.readdirSync(p, { recursive: true }).some((x) => fs.statSync(path.join(p, x)).isFile())) fs.rmSync(p, { recursive: true });
  }
}
const marker = (name) => { const re = new RegExp("[^\\n]*/\\*__" + name + "__\\*/"); if (!re.test(worker)) { console.error("worker.js lacks the " + name + " marker"); process.exit(1); } return re; };
worker = worker.replace(marker("PAGES"), () => "const PAGES = " + JSON.stringify(pages) + ";");
worker = worker.replace(marker("PAGE_CSP"), () => "const PAGE_CSP = " + JSON.stringify(csp) + ";");
fs.writeFileSync(path.join(out, "worker.mjs"), worker);
fs.rmSync(path.join(pub, "_headers"), { force: true });
// Stamp the service worker so each deploy refreshes the offline cache.
const swPath = path.join(pub, "sw.js");
if (fs.existsSync(swPath)) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
  fs.writeFileSync(swPath, fs.readFileSync(swPath, "utf8").split("__BUILD__").join(stamp));
}
if (!cf) fs.writeFileSync(path.join(out, "tab-site.json"), JSON.stringify({
  kind: "worker",
  entry: "worker.mjs",
  bindings: [{ type: "d1", name: "DB" }, { type: "r2", name: "FILES" }],
  worker: { compatibility_date: "2026-08-01", compatibility_flags: ["nodejs_compat"] },
}, null, 2));
console.log("Built", out);
