// Shadow compare of our own planner's trip lists (src/daylist.js, OWN_PLANNER off) with Transport for NSW's Trip
// Planner, for the 95% gate before trip lists come from our planner (docs/API.md, docs/SCALE_1M.md). For each A to B
// pair: the Trip Planner's next 10 trips (one /api/trip?page=1 call, so one planner call at most, through our server
// and its shared cache) and our planner's day list (/api/raptor/day, engine load key, no Transport for NSW call). A
// Trip Planner trip counts as matched when one of ours leaves within 60 s of it (first service, timetable times) on the
// same lines in the same order and changes at the same stations. Prints matched and counted (numerator and
// denominator), by mode and with every miss and its reason.
//
// Pairs: --pairs <file> (one "from,to" or "from,to,HHMM" a line), or --gen <n> [--seed <s>]: a sample drawn from the
// station and bus stop lists the site serves (src/public/stations), mostly Greater Sydney with some NSW wide trips,
// with at most 5% of pairs touching an owner stop (OWNER_STOPS: stop ids, OWNER_NAMES: names, comma separated, from
// the environment; none are kept in this repo).
//   ENGINE_LOAD_KEY=... node tools/trips-compare.mjs --gen 40 --live 40 --out compare.json     (11 PM to 5 AM only)
//   node tools/trips-compare.mjs --dry --gen 10             (tools/local-dev.mjs on 8787)
// --live caps the Trip Planner calls (at most 40, whatever is asked). --dry: a local server (tools/local-dev.mjs
// with tools/fake-nsw.mjs in planner mode), any hour, its planner pack loaded with tools/load_planner.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LIVE_CAP = 40;
export const DEP_TOL_MS = 60000;
export const TOP_N = 10;
export const OWNER_SHARE = 0.05;

// ---- the sample ----
function rng(seed) { let s = (Number(seed) >>> 0) || 1; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; }
const SYD = { lat: [-34.2, -33.4], lon: [150.6, 151.4] };
const inSyd = (p) => p[2] >= SYD.lat[0] && p[2] <= SYD.lat[1] && p[3] >= SYD.lon[0] && p[3] <= SYD.lon[1];
function km(a, b) { const r = Math.PI / 180, x = (b[3] - a[3]) * r * Math.cos(((a[2] + b[2]) / 2) * r), y = (b[2] - a[2]) * r; return Math.sqrt(x * x + y * y) * 6371; }
// Places to draw from: [id, name, lat, lon, mode] from the site's station lists and every 7th bus stop of its routes.
export function places(dir) {
  const out = [];
  for (const m of ["train", "metro", "lightrail", "ferry"]) {
    const f = path.join(dir, m + ".json");
    if (fs.existsSync(f)) for (const s of JSON.parse(fs.readFileSync(f, "utf8"))) out.push([String(s[0]), s[1], s[2], s[3], m]);
  }
  const bd = path.join(dir, "bus");
  if (fs.existsSync(bd)) {
    let k = 0;
    for (const fn of fs.readdirSync(bd).sort()) {
      const routes = JSON.parse(fs.readFileSync(path.join(bd, fn), "utf8"));
      for (const r of Object.values(routes)) for (const dirn of r) for (const s of dirn.stops || []) if (k++ % 7 === 0) out.push([String(s[0]), s[1], s[2], s[3], "bus"]);
    }
  }
  const seen = new Set();
  return out.filter((p) => p[2] && p[3] && !seen.has(p[0]) && seen.add(p[0]));
}
// n pairs: 85% inside Greater Sydney (3 to 45 km apart), 15% NSW wide (20 to 200 km); modes mixed in the proportion of
// the lists (trains and buses most). Owner stops: at most floor(5% of n) pairs.
export function sample(all, n, seed = 27, owner = { ids: [], names: [] }) {
  const r = rng(seed);
  const ids = new Set((owner.ids || []).map(String)), names = (owner.names || []).map((x) => x.toLowerCase()).filter(Boolean);
  const isOwner = (p) => ids.has(p[0]) || names.some((x) => p[1].toLowerCase().includes(x));
  const maxOwner = Math.floor(n * OWNER_SHARE);
  // Each end's mode first (bus stops far outnumber stations), then a place of that mode.
  const MODES = [["train", 0.42], ["bus", 0.3], ["metro", 0.1], ["lightrail", 0.1], ["ferry", 0.08]];
  const pools = {};
  for (const [m] of MODES) pools[m] = { syd: all.filter((p) => p[4] === m && inSyd(p)), all: all.filter((p) => p[4] === m) };
  const pick = (wide) => {
    let x = r(), m = MODES[0][0];
    for (const [k, w] of MODES) { if (x < w) { m = k; break; } x -= w; }
    const pool = pools[m][wide ? "all" : "syd"];
    return pool.length ? pool[Math.floor(r() * pool.length)] : null;
  };
  const pairs = [], keys = new Set();
  let owned = 0, tries = 0;
  while (pairs.length < n && tries++ < n * 500) {
    const wide = r() < 0.15;
    const a = pick(wide), b = pick(wide);
    if (!a || !b || a[0] === b[0]) continue;
    const d = km(a, b);
    if (wide ? d < 20 || d > 200 : d < 3 || d > 45) continue;
    const own = isOwner(a) || isOwner(b);
    if (own && owned >= maxOwner) continue;
    const key = a[0] + ">" + b[0];
    if (keys.has(key)) continue;
    keys.add(key); if (own) owned++;
    pairs.push({ from: a[0], to: b[0], fromName: a[1], toName: b[1], modes: a[4] + ">" + b[4], km: Math.round(d), owner: own });
  }
  return pairs;
}

// ---- matching ----
const ms = (s) => (s ? Date.parse(s) : NaN);
const transit = (j) => (j.legs || []).filter((l) => l.kind === "transit");
export const firstDep = (j) => { const l = transit(j)[0]; return l ? ms(l.planned) : NaN; };
export const linesOf = (j) => transit(j).map((l) => String(l.line || "").trim().toUpperCase()).join(">");
const placeKey = (n) => String(n || "").toLowerCase().replace(/,.*$/, "").replace(/\s+(station|wharf|light rail|interchange)$/, "").trim();
// Where each change happens: the station (or stop) the next service leaves from.
export const changesOf = (j) => transit(j).slice(1).map((l) => ({ id: String(l.fromParent || l.stopId || ""), name: placeKey(l.from) }));
const sameChange = (a, b) => a.length === b.length && a.every((x, i) => (x.id && x.id === b[i].id) || (x.name && x.name === b[i].name));
// The next TOP_N trips from `at` (ms): ours and the Trip Planner's, matched one to one.
export function matchTrips(nsw, own, at) {
  const keep = (l) => l.filter((j) => Number.isFinite(firstDep(j)) && firstDep(j) >= at - DEP_TOL_MS).sort((a, b) => firstDep(a) - firstDep(b));
  const N = keep(nsw).slice(0, TOP_N), O = keep(own);
  const used = new Set(), rows = [];
  let matched = 0;
  for (const j of N) {
    const near = O.filter((o) => !used.has(o) && Math.abs(firstDep(o) - firstDep(j)) <= DEP_TOL_MS);
    const ok = near.find((o) => linesOf(o) === linesOf(j) && sameChange(changesOf(o), changesOf(j)));
    const row = { dep: new Date(firstDep(j)).toISOString(), lines: linesOf(j), changes: changesOf(j).map((c) => c.name || c.id), mode: (transit(j)[0] || {}).mode || "" };
    if (ok) { used.add(ok); matched++; row.ok = true; }
    else {
      const sameLines = near.find((o) => linesOf(o) === linesOf(j));
      row.ok = false;
      row.why = !near.length ? "no trip of ours within 60 s" : !sameLines ? "other lines" : "other change";
      const close = O.slice().sort((a, b) => Math.abs(firstDep(a) - firstDep(j)) - Math.abs(firstDep(b) - firstDep(j)))[0];
      if (close) row.ours = { dep: new Date(firstDep(close)).toISOString(), lines: linesOf(close), changes: changesOf(close).map((c) => c.name || c.id) };
    }
    rows.push(row);
  }
  return { matched, counted: N.length, rows };
}

// ---- run ----
function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2), v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "1";
    o[k] = v;
  }
  return o;
}
const sydParts = (t = Date.now()) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t));
  const g = (k) => f.find((x) => x.type === k).value;
  return { date: g("year") + g("month") + g("day"), time: g("hour") + g("minute"), hour: Number(g("hour")) };
};
// A Sydney wall clock time as epoch ms.
function sydMs(date, hhmm) {
  const guess = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), +hhmm.slice(0, 2), +hhmm.slice(2, 4));
  for (const off of [10, 11]) { const x = guess - off * 3600000; if (sydParts(x).time === hhmm && sydParts(x).date === date) return x; }
  return guess - 11 * 3600000;
}
// The day list (3 AM to 3 AM) holding a moment.
const dayOf = (t) => sydParts(t - 3 * 3600000).date;

async function main() {
  const o = args(process.argv.slice(2));
  const dry = !!o.dry;
  const base = (o.base || (dry ? "http://127.0.0.1:8787" : "https://api.transportsydney.app")).replace(/\/$/, "");
  const key = process.env.ENGINE_LOAD_KEY || process.env.ADMIN_KEY || (dry ? "local-admin-key" : "");
  if (!key) { console.error("ENGINE_LOAD_KEY is needed for /api/raptor/day"); process.exit(2); }
  const live = Math.max(0, Math.min(LIVE_CAP, Number(o.live) || LIVE_CAP));
  const now = sydParts();
  if (!dry && !(now.hour >= 23 || now.hour < 5) && !process.env.ANY_HOUR) { console.error("Transport for NSW calls only 11 PM to 5 AM Sydney (or --dry against the local fake NSW)"); process.exit(2); }
  if (!dry && /localhost|127\.0\.0\.1/.test(base) === false && base !== "https://api.transportsydney.app") console.error("note: base " + base);
  let pairs;
  if (o.pairs) {
    pairs = fs.readFileSync(o.pairs, "utf8").split(/\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#")).map((x) => { const [from, to, time] = x.split(/[,\s]+/); return { from, to, time }; });
  } else {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const all = places(path.join(here, "..", "src", "public", "stations"));
    const owner = { ids: (process.env.OWNER_STOPS || "").split(",").map((x) => x.trim()).filter(Boolean), names: (process.env.OWNER_NAMES || "").split(",").map((x) => x.trim()).filter(Boolean) };
    pairs = sample(all, Math.max(1, Number(o.gen) || 30), Number(o.seed) || Number(now.date), owner);
  }
  if (o.sample) { console.log(JSON.stringify(pairs, null, 1)); return; }
  // One search time for all pairs unless a pair has its own: --time HHMM, else 10 minutes from now.
  const t0 = o.time && /^\d{4}$/.test(o.time) ? sydMs(o.date || now.date, o.time) : Math.ceil((Date.now() + 10 * 60000) / 60000) * 60000;
  const out = { at: new Date().toISOString(), base, dry, liveCap: live, pairs: [], byMode: {} };
  let calls = 0, matched = 0, counted = 0, skipped = 0;
  const get = async (u, h) => { const t = Date.now(); const r = await fetch(u, { headers: h || {} }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) })); const j = r.ok ? await r.json().catch(() => null) : null; return { status: r.status, j, ms: Date.now() - t }; };
  for (const p of pairs) {
    if (calls >= live) { out.pairs.push({ ...p, skip: "live call cap reached" }); skipped++; continue; }
    const at = p.time ? sydMs(o.date || now.date, p.time) : t0;
    const s = sydParts(at);
    // Ours first (no Transport for NSW call): the day list holding the time, and the next day's when near its end.
    const day = dayOf(at);
    const ownA = await get(`${base}/api/raptor/day?from=${encodeURIComponent(p.from)}&to=${encodeURIComponent(p.to)}&day=${day}`, { "x-admin-key": key });
    let own = ownA.j && Array.isArray(ownA.j.journeys) ? ownA.j.journeys : null;
    if (own && ownA.j.nextDay && own.filter((j) => firstDep(j) >= at).length < TOP_N) {
      const nx = await get(`${base}/api/raptor/day?from=${encodeURIComponent(p.from)}&to=${encodeURIComponent(p.to)}&day=${ownA.j.nextDay}`, { "x-admin-key": key });
      if (nx.j && Array.isArray(nx.j.journeys)) own = own.concat(nx.j.journeys);
    }
    calls++;
    const nswA = await get(`${base}/api/trip?page=1&from=${encodeURIComponent(p.from)}&to=${encodeURIComponent(p.to)}&date=${s.date}&time=${s.time}&cb=${Date.now()}`);
    const row = { ...p, at: new Date(at).toISOString(), ownMs: ownA.ms, nswMs: nswA.ms, ownError: own ? null : (ownA.j && ownA.j.error) || "http " + ownA.status };
    const nsw = nswA.j && Array.isArray(nswA.j.journeys) && nswA.j.source !== "timetable" ? nswA.j.journeys : null;
    if (!nsw || !nsw.length) { row.skip = nswA.j && nswA.j.source === "timetable" ? "planner refused (timetable answer)" : "no planner answer (" + nswA.status + ")"; skipped++; out.pairs.push(row); continue; }
    const m = matchTrips(nsw, own || [], at);
    Object.assign(row, { matched: m.matched, counted: m.counted, rows: m.rows });
    matched += m.matched; counted += m.counted;
    for (const r of m.rows) { const b = (out.byMode[r.mode || "other"] ||= { matched: 0, counted: 0 }); b.counted++; if (r.ok) b.matched++; }
    out.pairs.push(row);
    console.error(`${p.from} > ${p.to}: ${m.matched} of ${m.counted}${own ? "" : " (no list of ours: " + row.ownError + ")"}`);
    if (!dry) await new Promise((r) => setTimeout(r, 1500));
  }
  Object.assign(out, { matched, counted, pct: counted ? Math.round((1000 * matched) / counted) / 10 : null, plannerCalls: calls, pairsSkipped: skipped });
  const text = JSON.stringify(out, null, 1);
  if (o.out) fs.writeFileSync(o.out, text); else console.log(text);
  console.error(`matched ${matched} of ${counted} Trip Planner trips (${out.pct}%), ${calls} planner calls, ${skipped} pairs skipped`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
