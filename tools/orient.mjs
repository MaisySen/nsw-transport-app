#!/usr/bin/env node
// Prints the current state of Transport: Sydney Live in one go, for a new worker or engineer.
// Read only: it changes nothing, makes no Transport for NSW call and never prints a secret value.
//
//   node tools/orient.mjs            everything it can read
//   node tools/orient.mjs --engine   also reads /api/engine/status (wakes the engine objects; costs a few
//                                    Durable Object requests, so it is off by default)
//
// Secrets are read from the environment first, then from the operator's private files when they exist
// (never from the repo): CLOUDFLARE_API_TOKEN and CF_ACCOUNT_ID (or ~/.nsw-secrets/cloudflare.json),
// CF_ANALYTICS_TOKEN (or ~/.nsw-secrets/cloudflare-analytics.json), ADMIN_KEY (or backend/.env, ~/nsw-backend/.env).
// A missing secret skips that section and says so.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.transportsydney.app";
const EXPO_PROJECT = "cf1f4c4c-5157-41bf-a254-4480223f6368";
const SCRIPT = "transport-api";
const ENGINE = process.argv.includes("--engine");
const HOME = homedir();

const line = (s = "") => console.log(s);
const head = (s) => { line(); line("== " + s); };
const jsonFile = (p) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; } };
function envFile(p, k) {
  try {
    if (!existsSync(p)) return "";
    const m = readFileSync(p, "utf8").split("\n").find((l) => l.startsWith(k + "="));
    return m ? m.slice(k.length + 1).trim() : "";
  } catch { return ""; }
}
function sh(cmd, args) {
  try { return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 }).trim(); }
  catch { return ""; }
}
async function get(url, headers = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    const text = await r.text();
    return { status: r.status, text, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, text: String(e && e.message || e), ms: Date.now() - t0 };
  } finally { clearTimeout(t); }
}
const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };
const sydney = (d) => new Date(d).toLocaleString("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short" });

const cfFile = jsonFile(join(HOME, ".nsw-secrets", "cloudflare.json")) || {};
const anFile = jsonFile(join(HOME, ".nsw-secrets", "cloudflare-analytics.json")) || {};
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || cfFile.api_token || "";
const CF_ACCOUNT = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || cfFile.account_id || anFile.account_id || "";
const AN_TOKEN = process.env.CF_ANALYTICS_TOKEN || anFile.api_token || "";
const ADMIN = process.env.ADMIN_KEY || envFile(join(ROOT, "backend", ".env"), "ADMIN_KEY") || envFile(join(HOME, "nsw-backend", ".env"), "ADMIN_KEY");

line("Transport: Sydney Live, state at " + sydney(Date.now()) + " Sydney (" + new Date().toISOString() + ")");

// 1. Git
head("Git");
sh("git", ["fetch", "-q", "origin", "main"]);
line("local HEAD   " + (sh("git", ["log", "-1", "--format=%h %cd %s", "--date=iso"]) || "not a git checkout").slice(0, 160));
const om = sh("git", ["log", "-1", "--format=%h %cd %s", "--date=iso", "origin/main"]);
if (om) line("origin/main  " + om.slice(0, 160));
const behind = sh("git", ["rev-list", "--count", "HEAD..origin/main"]);
if (behind && behind !== "0") line("local is " + behind + " commits behind origin/main: git pull --rebase before any work");
const dirty = sh("git", ["status", "--porcelain"]);
line(dirty ? "working tree has uncommitted changes" : "working tree clean");

// 2. Over the air updates: read the live manifest the phones read (no token needed)
head("Over the air update on channel production (runtime 1.0.0)");
for (const platform of ["ios", "android"]) {
  const r = await get("https://u.expo.dev/" + EXPO_PROJECT, {
    "expo-channel-name": "production", "expo-runtime-version": "1.0.0", "expo-platform": platform,
    "expo-protocol-version": "1", accept: "multipart/mixed",
  });
  const i = r.text.indexOf('{"id"');
  const m = i >= 0 ? parse(r.text.slice(i, r.text.indexOf("\r\n--", i))) : null;
  if (m) line(`${platform.padEnd(8)} group ${m.metadata && m.metadata.updateGroup}  update ${m.id}  created ${sydney(m.createdAt)}  runtime ${m.runtimeVersion}`);
  else line(`${platform.padEnd(8)} could not read the manifest (HTTP ${r.status})`);
}
line("Rollback target and history: docs/RELEASES.md, section Over the air updates (newest first).");

// 3. Server deploys
head("Server: Cloudflare Worker " + SCRIPT);
if (CF_TOKEN && CF_ACCOUNT) {
  const auth = { Authorization: "Bearer " + CF_TOKEN };
  const d = parse((await get(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/workers/scripts/${SCRIPT}/deployments`, auth)).text);
  const list = d && d.result && (d.result.deployments || d.result) || [];
  if (Array.isArray(list) && list.length) {
    const sorted = [...list].sort((a, b) => String(b.created_on).localeCompare(String(a.created_on))).slice(0, 3);
    for (const x of sorted) {
      const v = (x.versions || []).map((y) => String(y.version_id).slice(0, 8) + " " + y.percentage + "%").join(", ");
      const msg = x.annotations && x.annotations["workers/message"] || "";
      line(`${sydney(x.created_on)}  version ${v}  ${msg.slice(0, 110)}`);
    }
    line("The newest is live. Roll back: cd backend && npx wrangler@4 rollback <the one below it> --name transport-api");
  } else line("could not list deployments" + (d && d.errors ? ": " + JSON.stringify(d.errors).slice(0, 160) : ""));
  const s = parse((await get(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/workers/scripts/${SCRIPT}/settings`, auth)).text);
  if (s && s.result && s.result.bindings) {
    const vars = s.result.bindings.filter((b) => b.type === "plain_text").map((b) => `${b.name}=${b.text}`);
    const secrets = s.result.bindings.filter((b) => b.type === "secret_text").map((b) => b.name);
    head("Server flags live on the Worker (plain vars; a flag not listed is off)");
    line(vars.join("\n"));
    line("secrets set (names only): " + secrets.join(", "));
  }
} else line("skipped: no CLOUDFLARE_API_TOKEN and CF_ACCOUNT_ID (operator secrets file ~/.nsw-secrets/cloudflare.json not found)");

head("Server flags in backend/wrangler.toml.template on this checkout (what the next deploy sets)");
try {
  const tpl = readFileSync(join(ROOT, "backend", "wrangler.toml.template"), "utf8");
  const vars = tpl.split("[vars]")[1].split(/\n\[/)[0].split("\n").filter((l) => /^[A-Z_]+ = /.test(l));
  line(vars.join("\n"));
} catch { line("backend/wrangler.toml.template not readable"); }

// 4. Remote config and app side switches
head("Remote config (what the phones read, /api/app/config)");
const rc = parse((await get(API + "/api/app/config?platform=ios")).text);
if (rc) {
  const off = Object.entries(rc.flags || {}).filter(([, v]) => v !== true).map(([k, v]) => `${k}=${v}`);
  line("flags on: " + Object.entries(rc.flags || {}).filter(([, v]) => v === true).map(([k]) => k).join(", "));
  line("flags not on: " + (off.join(", ") || "none") + (rc.flags && rc.flags.livePush === undefined ? " (livePush absent, so live push is off)" : ""));
  line("kill: " + JSON.stringify(rc.kill || {}) + "  timing: " + JSON.stringify(rc.timing || {}));
  const sv = parse((await get(API + "/api/app/config?platform=server")).text);
  if (sv) line("server switches: kill " + JSON.stringify(sv.kill || {}) + ", flags off: " + (Object.entries(sv.flags || {}).filter(([, v]) => v !== true).map(([k]) => k).join(", ") || "none"));
} else line("could not read remote config");
try {
  const f = readFileSync(join(ROOT, "app", "src", "lib", "features.ts"), "utf8");
  line("app switches in app/src/lib/features.ts: " + [...f.matchAll(/export const ([A-Z_]+) = (true|false)/g)].map((m) => m[1] + "=" + m[2]).join(", "));
} catch { /* no app folder */ }

// 5. Health and Transport for NSW quota (our own counter; no NSW call)
head("API health");
for (const p of ["/api/lines", "/api/trackwork", "/api/app/config?platform=ios"]) {
  const r = await get(API + p);
  line(`${p.padEnd(32)} ${r.status} in ${r.ms} ms`);
}
const h0 = await get(API + "/api/health");
line(`/api/health without key          ${h0.status} (403 expected)`);
if (ADMIN) {
  const h = parse((await get(API + "/api/health", { "x-admin-key": ADMIN })).text);
  if (h) line("/api/health with key             ok=" + h.ok + ", upstream refused=" + (h.upstream && h.upstream.refused) + ", busy=" + (h.upstream && h.upstream.busy));
  const u = parse((await get(API + "/api/usage", { "x-admin-key": ADMIN })).text);
  if (u && u.today) {
    line(`NSW calls today (day ${u.today.day}, resets midnight AEST = 1 AM AEDT): ${u.today.calls} of ${u.budget}` +
      (u.today.calls >= u.budget * 0.93 ? "  NEAR OR OVER THE DAILY LIMIT: expect refusals, see RUNBOOK 'NSW quota'" : ""));
    line("last minute tick: " + u.lastTick + (Date.now() - Date.parse(u.lastTick) > 180000 ? "  STALE (more than 3 min)" : ""));
  }
} else line("skipped admin checks: no ADMIN_KEY (operator copy is backend/.env of the deploy checkout)");
if (ENGINE) {
  const e = parse((await get(API + "/api/engine/status")).text);
  if (e) line(`engine: boots ${e.boots}, built ${e.builtAt}, days ${(e.days || []).join(",")}, NSW calls today ${e.dayCalls} of engine budget ${e.budget}, shards ${(e.shards || []).length}`);
}

// 6. Cloudflare usage this billing cycle (starts on the 25th, 00:00 UTC) against the Workers Paid included amounts
head("Cloudflare usage this cycle vs Workers Paid included (US$5 a month, aim: under 50% of each)");
if (AN_TOKEN && CF_ACCOUNT) {
  const now = new Date();
  let start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 25));
  if (start > now) start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 25));
  const q = `query($a:String!,$s:Time!,$e:Time!,$sd:Date!,$ed:Date!){viewer{accounts(filter:{accountTag:$a}){
    w:workersInvocationsAdaptive(limit:1000,filter:{datetime_geq:$s,datetime_lt:$e}){sum{requests cpuTimeUs}}
    d:durableObjectsInvocationsAdaptiveGroups(limit:1000,filter:{datetimeHour_geq:$s,datetimeHour_lt:$e}){sum{requests}}
    db:d1AnalyticsAdaptiveGroups(limit:1000,filter:{date_geq:$sd,date_lt:$ed}){sum{rowsRead rowsWritten}}}}}`;
  const vars = { a: CF_ACCOUNT, s: start.toISOString(), e: now.toISOString(), sd: start.toISOString().slice(0, 10), ed: new Date(now.getTime() + 86400000).toISOString().slice(0, 10) };
  let out = null;
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: { Authorization: "Bearer " + AN_TOKEN, "content-type": "application/json" }, body: JSON.stringify({ query: q, variables: vars }) });
    out = await r.json();
  } catch { out = null; }
  const acc = out && out.data && out.data.viewer && out.data.viewer.accounts && out.data.viewer.accounts[0];
  if (acc) {
    const sum = (arr, k) => (arr || []).reduce((n, x) => n + (x.sum[k] || 0), 0);
    const days = (now - start) / 86400000;
    const rows = [
      ["Worker requests", sum(acc.w, "requests"), 10e6],
      ["Worker CPU ms", Math.round(sum(acc.w, "cpuTimeUs") / 1000), 30e6],
      ["Durable Object requests", sum(acc.d, "requests"), 1e6],
      ["D1 rows read", sum(acc.db, "rowsRead"), 25e9],
      ["D1 rows written", sum(acc.db, "rowsWritten"), 50e6],
    ];
    line(`cycle from ${start.toISOString().slice(0, 10)} (${days.toFixed(1)} days in; the month pace counts any load test days in this cycle)`);
    for (const [n, used, inc] of rows) {
      const pace = used / Math.max(days, 0.5) * 30;
      line(`${n.padEnd(26)} ${String(used).padStart(12)} of ${inc >= 1e9 ? inc / 1e9 + "B" : inc / 1e6 + "M"} = ${(used / inc * 100).toFixed(2)}%  month pace ${(pace / inc * 100).toFixed(1)}%` + (pace > inc * 0.8 ? "  OVER 80% PACE" : ""));
    }
    line("Durable Object duration and storage: dashboard, Billing, Billable usage (or docs/COSTS.md).");
  } else line("analytics query failed" + (out && out.errors ? ": " + JSON.stringify(out.errors).slice(0, 200) : ""));
} else line("skipped: no CF_ANALYTICS_TOKEN (operator file ~/.nsw-secrets/cloudflare-analytics.json not found)");

head("Next");
line("Read docs/START_HERE.md, then docs/STATE.md (open work and what waits on the owner).");
