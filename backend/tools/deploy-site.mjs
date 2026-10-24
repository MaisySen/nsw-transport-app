// Publishes site/ (the public site) to Cloudflare Pages and connects transportsydney.app and
// www.transportsydney.app. Safe to run again: each step checks what exists first.
// Needs in the environment: CLOUDFLARE_API_TOKEN, CF_ACCOUNT_ID, CF_ZONE_ID (the transportsydney.app zone).
// Usage: node tools/deploy-site.mjs [--dry-run]
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const siteDir = path.join(root, "..", "site");
const PROJECT = process.env.PAGES_PROJECT || "transportsydney";
const APEX = "transportsydney.app";
const WWW = "www." + APEX;
const DRY = process.argv.includes("--dry-run");
const { CLOUDFLARE_API_TOKEN: TOKEN, CF_ACCOUNT_ID: ACC, CF_ZONE_ID: ZONE } = process.env;
if (!TOKEN || !ACC || !ZONE) { console.error("Set CLOUDFLARE_API_TOKEN, CF_ACCOUNT_ID and CF_ZONE_ID"); process.exit(1); }

async function cf(method, p, body) {
  if (DRY && method !== "GET") { console.log("  would " + method + " " + p); return { success: true, result: {} }; }
  const r = await fetch("https://api.cloudflare.com/client/v4" + p, { method, headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({ success: false, errors: [{ message: "HTTP " + r.status }] }));
  if (!j.success) throw new Error(method + " " + p + ": " + (j.errors || []).map((e) => e.code + " " + e.message).join("; "));
  return j;
}
const step = (s) => console.log(s);

step("1. Pages project " + PROJECT);
const projects = (await cf("GET", `/accounts/${ACC}/pages/projects`)).result || [];
if (!projects.some((p) => p.name === PROJECT)) await cf("POST", `/accounts/${ACC}/pages/projects`, { name: PROJECT, production_branch: "main" });

step("2. Upload site/");
if (!DRY) {
  const r = spawnSync("npx", ["--yes", "wrangler@4", "pages", "deploy", siteDir, "--project-name", PROJECT, "--branch", "main", "--commit-dirty=true"], { stdio: "inherit", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACC } });
  if (r.status !== 0) process.exit(r.status || 1);
}

step("3. Custom domains on the project");
const domains = DRY && !projects.some((p) => p.name === PROJECT) ? [] : ((await cf("GET", `/accounts/${ACC}/pages/projects/${PROJECT}/domains`)).result || []);
for (const d of [APEX, WWW]) if (!domains.some((x) => x.name === d)) await cf("POST", `/accounts/${ACC}/pages/projects/${PROJECT}/domains`, { name: d });

step("4. DNS: both names point at the project, proxied");
const target = `${PROJECT}.pages.dev`;
for (const name of [APEX, WWW]) {
  const recs = (await cf("GET", `/zones/${ZONE}/dns_records?name=${name}`)).result || [];
  const same = recs.find((r) => r.type === "CNAME" && r.content === target);
  if (same) continue;
  const clash = recs.filter((r) => ["A", "AAAA", "CNAME"].includes(r.type));
  if (clash.length) { console.log(`  ${name} already has ${clash.map((r) => r.type + " " + r.content).join(", ")}; replacing with CNAME ${target}`); for (const r of clash) await cf("DELETE", `/zones/${ZONE}/dns_records/${r.id}`); }
  await cf("POST", `/zones/${ZONE}/dns_records`, { type: "CNAME", name, content: target, proxied: true, ttl: 1, comment: "Public site (Cloudflare Pages)" });
}

step("5. www redirects to the bare domain");
const phase = "http_request_dynamic_redirect";
let rs = null;
try { rs = (await cf("GET", `/zones/${ZONE}/rulesets/phases/${phase}/entrypoint`)).result; } catch (e) { rs = null; }
const rule = {
  description: "www to transportsydney.app",
  expression: `(http.host eq "${WWW}")`,
  action: "redirect",
  action_parameters: { from_value: { status_code: 301, preserve_query_string: true, target_url: { expression: `concat("https://${APEX}", http.request.uri.path)` } } },
};
const rules = (rs && rs.rules) || [];
if (!rules.some((r) => r.description === rule.description)) {
  try {
    await cf("PUT", `/zones/${ZONE}/rulesets/phases/${phase}/entrypoint`, { rules: [...rules.map(({ id, version, last_updated, ref, ...r }) => r), rule] });
  } catch (e) {
    console.log("  not added (" + e.message + "). The token needs Zone, Single Redirect, Edit. Until then www serves the same pages, which point search engines at the bare domain.");
  }
}
console.log(DRY ? "Dry run done." : `Done. Check: curl -sI https://${APEX}/ and https://${WWW}/`);
