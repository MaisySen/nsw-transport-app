// Board engine match check (docs/ENGINE.md): /api/departures?engine=1 (the engine's board) against engine=0&refresh=1
// (the Trip Planner path) for the same stop in the same seconds. Services due in the next 90 minutes, times within
// 60 s, platforms and stands where the planner names one. Boards the engine did not make are not counted.
//
//   Tonight (live, NSW window only):
//     node backend/tools/match_x.mjs --stops 207720,217020,... --out run.json --live
//   Dry run against the local API and the fake Transport for NSW (tools/local-dev.mjs running), no NSW call:
//     node backend/tools/match_x.mjs --dry --load
//
// Options: --stops a,b,c or --stops-file f; --base URL (default https://api.transportsydney.app, or the local API
// with --dry); --warm-batch N stops opened together (default 3); --warm-gap-s S between batches (default 20);
// --settle-s S at most, after the last batch, waiting for the engine's name queue to empty (default 240);
// --max-planner N Trip Planner calls at most for the whole run, the engine's own name reads included (default 60);
// --no-warm skips the warm up. --live is needed for any host that is not local, and is refused outside 11 PM to
// 5 AM Sydney. --load (dry only) loads the fake network into the local engine first (admin key local-admin-key).
//
// Warm up, staggered: stops are opened a few at a time and every opened stop is read again each minute, so each
// shard sees its boards and the core reads their planner boards for stand names (ENGINE_LEARN_CORE) before the match
// reads them; the match starts when the name queue is empty or the settle time is up. (27 Oct, 4:08 AM: the warm up
// opened 22 stops at once and the match came 9 minutes later; 20 of the 26 misses were stands not learnt yet.)
//
// Timing (27 Oct: 2 trains due 90.5 minutes out counted as missing): the engine builds a board up to 60 s before it is
// read, and its horizon is 90 minutes from that build. A planner row counts only when it is due by the earlier of the
// engine's build and the request, plus 90 minutes, less 60 s; an engine row only inside the same span.
import fs from "node:fs";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i < 0 ? d : argv[i + 1]; };
const flag = (k) => argv.includes("--" + k);
const DRY = flag("dry"), LIVE = flag("live");
const base = opt("base", DRY ? "http://127.0.0.1:8787" : "https://api.transportsydney.app");
const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base);
const HORIZON = 90 * 60000, EDGE = 60000;
const sydHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Sydney", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
if (!local) {
  if (DRY) { console.error("--dry runs against the local API only"); process.exit(2); }
  if (!LIVE) { console.error("A host that is not local needs --live (it spends Trip Planner calls)"); process.exit(2); }
  if (!(sydHour >= 23 || sydHour < 5)) { console.error("NSW calls only between 11 PM and 5 AM Sydney; it is " + sydHour + " h"); process.exit(2); }
}
const maxPlanner = Number(opt("max-planner", 60));
const warmBatch = Math.max(1, Number(opt("warm-batch", DRY ? 4 : 3)));
const warmGap = Number(opt("warm-gap-s", DRY ? 3 : 20)) * 1000;
const settleMax = Number(opt("settle-s", DRY ? 30 : 240)) * 1000;
const outFile = opt("out", null);
const ms = (t) => Date.parse(t);
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const given = (p) => /^(Platform|Stand|Wharf) [A-Za-z0-9]{1,4}(, Side \w)?$/.test(p || "");
let plannerCalls = 0; // calls this script caused: planner reads, and engine reads that fell back to the planner
const get = async (q) => { const t = Date.now(); const r = await fetch(base + "/api/departures?" + q); return { status: r.status, ms: Date.now() - t, j: r.ok ? await r.json() : null }; };
const status = async () => { try { const r = await fetch(base + "/api/engine/status?cb=" + Date.now()); return r.ok ? await r.json() : null; } catch (e) { return null; } };
const learnAsked = (st) => (st && st.learn ? st.learn.asked || 0 : 0);
const spent = (st0, st) => plannerCalls + Math.max(0, learnAsked(st) - learnAsked(st0));

// ---- the stops ----
let stops = (opt("stops", "") || (opt("stops-file") ? fs.readFileSync(opt("stops-file"), "utf8") : "")).split(/[\s,]+/).filter(Boolean);
if (DRY && flag("load")) {
  // The fake network, made for one moment, into the local engine and the fake planner alike.
  const { trainNetwork } = await import(new URL("./fake-feed.mjs", import.meta.url));
  const fake = opt("fake", "http://127.0.0.1:8799");
  // 200 trips: dense enough for full boards, sparse enough that two trips seldom share a platform and minute (the
  // engine keeps one row per line, minute and platform, for trips that are in two bundles).
  const at = Date.now(), cfg = { trips: 200, stations: 60, unknown: 4, empty: 6, stands: 6, at };
  await fetch(fake + "/__mode?set=trains&" + new URLSearchParams(Object.entries(cfg).map(([k, v]) => [k, String(v)])));
  const net = trainNetwork(cfg);
  const H = { "x-admin-key": opt("admin-key", "local-admin-key") };
  const post = async (p, b) => { const r = await fetch(base + "/api/engine/load/" + p, { method: "POST", headers: H, body: typeof b === "string" ? b : JSON.stringify(b) }); if (!r.ok) throw new Error("load " + p + " " + r.status + " " + (await r.text()).slice(0, 120)); return r.json(); };
  await post("begin", net.meta);
  await post("stops", Object.entries(net.stops).map(([id, s]) => [id, ...s]));
  await post("days", Object.entries(net.rows).map(([s, r]) => JSON.stringify({ s, d: net.day, r })).join("\n"));
  await post("trips", net.trips.map((t) => JSON.stringify(t)).join("\n"));
  console.log("loaded the fake network into the local engine:", JSON.stringify(await post("commit", {})));
  if (!stops.length) stops = ["ST0", "ST1", "ST2", "ST3", "ST4", "ST5", "ST10", "ST17", "ST24", "ST31", "ST38", "ST45"];
}
if (!stops.length) { console.error("Give --stops a,b,c (or --dry --load for the fake network's stations)"); process.exit(2); }

const st0 = await status();
console.log(new Date().toISOString(), base, stops.length, "stops; planner calls at most", maxPlanner, st0 && st0.learn ? "| engine name queue " + st0.learn.queued + ", read today " + st0.learn.today : "| engine status has no name queue (old code)");

// ---- warm up, staggered ----
const warm = [];
if (!flag("no-warm")) {
  const opened = [];
  const readAll = async (list) => Promise.all(list.map(async (s) => {
    const r = await get(`stop=${s}&engine=1&cb=${Date.now()}`).catch(() => null);
    const isE = !!(r && r.j && r.j.engine);
    if (r && r.status === 200 && !isE) plannerCalls++; // fell back to the planner
    return { stop: s, status: r && r.status, engine: isE, items: r && r.j && r.j.items ? r.j.items.length : 0, noStand: r && r.j && r.j.items ? r.j.items.filter((i) => !i.platform).length : 0 };
  }));
  let lastAll = 0;
  for (let i = 0; i < stops.length; i += warmBatch) {
    if (spent(st0, await status()) >= maxPlanner - stops.length) { console.log("warm up stopped: planner budget"); break; }
    const batch = stops.slice(i, i + warmBatch);
    opened.push(...batch);
    for (const w of await readAll(batch)) warm.push({ ...w, at: new Date().toISOString(), first: true });
    // Every opened stop read again once a minute, so its board stays built (a board unread for 5 minutes is dropped).
    if (Date.now() - lastAll > 55000) { lastAll = Date.now(); await readAll(opened.filter((s) => !batch.includes(s))); }
    console.log("opened", opened.length, "of", stops.length);
    if (i + warmBatch < stops.length) await sleep(warmGap);
  }
  // Settle: until the engine's name queue is empty (and at least one shard tick plus one core tick have passed).
  const t0 = Date.now();
  await sleep(Math.min(settleMax, DRY ? 12000 : 30000));
  for (;;) {
    const st = await status();
    const q = st && st.learn ? st.learn.queued : 0;
    console.log("settle", Math.round((Date.now() - t0) / 1000) + " s", "name queue", q, "planner calls so far", spent(st0, st));
    if (!q || Date.now() - t0 >= settleMax) break;
    if (Date.now() - lastAll > 55000) { lastAll = Date.now(); await readAll(opened); }
    await sleep(10000);
  }
  // One more read of every stop, so the boards are hot and built with the names learnt.
  await readAll(opened);
  await sleep(DRY ? 6000 : 16000);
}

// ---- match ----
const report = []; let totP = 0, totOk = 0, totFound = 0, totExtra = 0, totEng = 0; const cat = {}; const extras = [];
const empty = { hidden: 0, onPlanner: 0, plannerLive: 0, rows: [] };
for (const stop of stops) {
  if (spent(st0, await status()) + 1 > maxPlanner) { console.log("match stopped: planner budget", maxPlanner); report.push({ stop, skipped: "planner budget" }); continue; }
  const cb = Date.now();
  const [E, P] = await Promise.all([get(`stop=${stop}&engine=1&cb=${cb}`), get(`stop=${stop}&engine=0&refresh=1&cb=${cb}`)]);
  plannerCalls++;
  if (!E.j || !P.j) { report.push({ stop, error: "http " + E.status + " " + P.status }); console.log(stop, "error", E.status, P.status); continue; }
  const now = Date.now();
  const isEngine = !!E.j.engine;
  // A board the engine did not make (it fell back to the Trip Planner) is the planner's own rows: not counted.
  if (!isEngine) { plannerCalls++; report.push({ stop, name: P.j.stop && P.j.stop.name, engine: false }); console.log(stop, "engine fell back, not counted"); continue; }
  const built = Math.min((E.j.engine && E.j.engine.builtAt) || cb, cb);
  const edge = built + HORIZON - EDGE; // later than this, one side may have cut the row at its horizon
  const pItems = P.j.items.filter((i) => !i.onDemand && i.mode !== "other" && ms(i.planned) <= edge && ms(i.estimated || i.planned) >= now);
  const rows = []; let ok = 0, found = 0; const used = new Set();
  for (const p of pItems) {
    const near = (l) => l.sort((a, b) => Math.abs(ms(a.planned) - ms(p.planned)) - Math.abs(ms(b.planned) - ms(p.planned)))[0];
    let e = p.tripId ? near(E.j.items.filter((x) => x.tripId === p.tripId)) : null;
    if (!e) e = E.j.items.find((x) => !used.has(x) && x.line === p.line && Math.abs(ms(x.planned) - ms(p.planned)) <= 60000);
    const r = { line: p.line, mode: p.mode, pDest: p.dest, planned: p.planned, pEst: p.estimated, pPlat: p.platform, pPlatFrom: p.platformChangedFrom || null, tripId: p.tripId, pLive: !!p.realtime };
    const lastE = E.j.items.length ? E.j.items[E.j.items.length - 1] : null;
    if (!e) { r.result = E.j.items.length >= 60 && lastE && ms(p.estimated || p.planned) > ms(lastE.estimated || lastE.planned) ? "past engine list" : "missing"; rows.push(r); if (r.result === "past engine list") continue; cat[r.result] = (cat[r.result] || 0) + 1; continue; }
    found++; used.add(e);
    const pt = ms(p.estimated || p.planned), et = ms(e.estimated || e.planned);
    Object.assign(r, { eTrip: e.tripId, eDest: e.dest, eEst: e.estimated, ePlat: e.platform, eLive: !!e.realtime, diffS: Math.round((et - pt) / 1000) });
    const timeOk = Math.abs(et - pt) <= 60000 || (p.cancelled && e.cancelled);
    const platOk = !given(p.platform) || p.platform === e.platform;
    r.result = timeOk && platOk ? "ok" : !timeOk ? "time" : "platform";
    const k = r.result + (r.result === "time" ? (r.pLive && r.eLive ? ":both live" : r.eLive ? ":planner scheduled" : ":engine scheduled") : r.result === "platform" && !e.platform ? ":engine none" : "");
    cat[k] = (cat[k] || 0) + 1;
    if (r.result === "ok") ok++;
    rows.push(r);
  }
  const counted = rows.filter((r) => r.result !== "past engine list").length;
  // Engine rows the planner does not list (ghosts), inside the span the planner's list covers.
  const lastP = P.j.items.length ? Math.max(...P.j.items.map((i) => ms(i.planned))) : now;
  const span = Math.min(P.j.items.length >= 40 ? lastP : Infinity, edge);
  const eIn = E.j.items.filter((i) => !i.onDemand && i.mode !== "other" && ms(i.planned) <= span && ms(i.estimated || i.planned) >= now);
  const ex = eIn.filter((i) => !used.has(i));
  totEng += eIn.length; totExtra += ex.length;
  for (const i of ex) extras.push({ stop, line: i.line, mode: i.mode, planned: i.planned, tripId: i.tripId, live: !!i.realtime, dest: i.dest });
  // Evidence for Empty Train rows on timetable times: the rows the engine left off (engine.emptyHidden) that are
  // inside the span, and whether the planner lists each (by trip id, else the same line within 60 s).
  for (const [tripId, planned, line, sid] of (E.j.engine && E.j.engine.emptyHidden) || []) {
    if (ms(planned) > span || ms(planned) < now) continue;
    const p = P.j.items.find((x) => x.tripId === tripId) || P.j.items.find((x) => x.line === line && Math.abs(ms(x.planned) - ms(planned)) <= 60000 && !rows.some((r) => r.eTrip === x.tripId));
    empty.hidden++; if (p) { empty.onPlanner++; if (p.realtime) empty.plannerLive++; }
    empty.rows.push({ stop, tripId, planned, line, stopId: sid, onPlanner: !!p, plannerTrip: p ? p.tripId : null, plannerDest: p ? p.dest : null, plannerLive: p ? !!p.realtime : null });
  }
  totP += counted; totOk += ok; totFound += found;
  report.push({ stop, name: P.j.stop && P.j.stop.name, engine: isEngine, engineMs: E.ms, plannerMs: P.ms, builtAgeS: Math.round((cb - built) / 1000), planner: counted, found, ok, rows });
  console.log(stop, (P.j.stop && P.j.stop.name) || "", "planner", counted, "found", found, "ok", ok, "| ms engine", E.ms, "planner", P.ms);
}
const st1 = await status();
const byMode = {};
for (const s of report) for (const r of s.rows || []) { if (r.result === "past engine list") continue; const b = (byMode[r.mode] = byMode[r.mode] || [0, 0]); b[1]++; if (r.result === "ok") b[0]++; }
const learnt = st1 && st1.learn ? { asked: learnAsked(st1) - learnAsked(st0), queuedAtEnd: st1.learn.queued, moved: st1.learn.moved, conflicts: st1.learn.conflicts } : null;
console.log("by mode ok/counted", JSON.stringify(byMode));
console.log("TOTAL", totP, "found", totFound, "ok", totOk, "match %", (100 * totOk / Math.max(1, totP)).toFixed(1));
console.log("by result", JSON.stringify(cat));
console.log("engine rows in span", totEng, "not on planner", totExtra);
console.log("Empty Train rows the engine left off (no live time):", empty.hidden, "on the planner", empty.onPlanner, "(live there", empty.plannerLive + ")");
console.log("planner calls: this script", plannerCalls, "| engine name reads", learnt ? learnt.asked : "n/a", "| cap", maxPlanner);
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), base, dry: DRY, byMode, totP, totFound, totOk, pct: Math.round(1000 * totOk / Math.max(1, totP)) / 10, cat, totEng, totExtra, extras, empty, plannerCalls, learnt, warm, report }, null, 1));
