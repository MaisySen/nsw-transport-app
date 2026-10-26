// Compares our own trip planner with Transport for NSW's Trip Planner on the same searches (docs/SCALE_1M.md, the
// match gate before OWN_PLANNER goes on). Off peak only, capped: each pair is one /api/trip search (the Trip Planner,
// through our server and its shared cache) and one /api/raptor/plan search (ours, no NSW call).
//   ENGINE_LOAD_KEY=... node tools/planner_match.mjs [max searches, default 60] [api base] > match.json
// A pair matches when our first trip leaves and arrives within 2 minutes of the Trip Planner's first trip (planned
// times), or uses the same lines in the same order. Searches the Trip Planner did not answer (refused, timetable
// fallback) are skipped, not counted.
const max = Math.max(1, Math.min(300, Number(process.argv[2]) || 60));
const base = (process.argv[3] || "https://api.transportsydney.app").replace(/\/$/, "");
const key = process.env.ENGINE_LOAD_KEY || process.env.ADMIN_KEY;
if (!key) { console.error("ENGINE_LOAD_KEY is needed for /api/raptor/plan"); process.exit(2); }
const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(new Date()));
if (hour >= 6 && hour < 22 && !process.env.ANY_HOUR) { console.error("off peak only (10 PM to 6 AM Sydney)"); process.exit(2); }
// Station pairs across Sydney and NSW: trains, metro, light rail, ferries, buses, a regional trip.
const STATIONS = ["200060", "200070", "200080", "200020", "201510", "213510", "215020", "206710", "206010", "202210", "214110",
  "204420", "222010", "212110", "207720", "214810", "217020", "213410", "220010", "275010", "223210", "250020", "229310", "211340"];
const TIMES = ["0730", "0815", "1230", "1745", "2215"];
let seed = 11; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor((seed / 2147483648) * n); };
// Today in Sydney: run after the daily pack load (2:40 AM), 3 to 6 AM, or 10 PM to midnight; past times are skipped.
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date()).replace(/-/g, "");
const nowHm = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).replace(":", ""));
const pairs = [];
const later = TIMES.filter((x) => Number(x) > nowHm + 10);
if (!later.length) { console.error("no search times left today"); process.exit(2); }
while (pairs.length < max) { const a = STATIONS[rnd(STATIONS.length)], b = STATIONS[rnd(STATIONS.length)]; if (a !== b) pairs.push([a, b, later[rnd(later.length)]]); }
const t = (s) => Date.parse(s);
const lines = (j) => j.legs.filter((l) => l.kind === "transit").map((l) => l.line).join(">");
const out = { day, at: new Date().toISOString(), pairs: [] };
let matched = 0, counted = 0;
for (const [a, b, time] of pairs) {
  const q = `from=${a}&to=${b}&date=${day}&time=${time}&count=3`;
  const nsw = await fetch(`${base}/api/trip?${q}`).then((r) => r.json()).catch(() => null);
  const own = await fetch(`${base}/api/raptor/plan?from=${a}&to=${b}&day=${day}&time=${time}&count=3`, { headers: { "x-admin-key": key } }).then((r) => r.json()).catch(() => null);
  const row = { a, b, time };
  const nj = nsw && Array.isArray(nsw.journeys) && nsw.source !== "timetable" ? nsw.journeys[0] : null;
  const oj = own && Array.isArray(own.journeys) ? own.journeys[0] : null;
  if (!nj) { row.skip = nsw && nsw.source === "timetable" ? "planner refused (timetable answer)" : "no planner answer"; out.pairs.push(row); continue; }
  counted++;
  const nb = nj.legs.find((l) => l.kind === "transit"), ob = oj && oj.legs.find((l) => l.kind === "transit");
  row.nsw = { board: nb && nb.planned, arrive: nj.arrive, lines: lines(nj) };
  row.own = oj ? { board: ob && ob.planned, arrive: oj.arrive, lines: lines(oj) } : null;
  const near = oj && nb && ob && Math.abs(t(nb.planned) - t(ob.planned)) <= 120000 && Math.abs(t(nj.arrive) - t(oj.arrive)) <= 120000;
  row.match = !!(oj && (near || lines(nj) === lines(oj)));
  if (row.match) matched++;
  out.pairs.push(row);
  await new Promise((r) => setTimeout(r, 3000));
}
out.counted = counted; out.matched = matched; out.pct = counted ? Math.round((1000 * matched) / counted) / 10 : null;
console.log(JSON.stringify(out, null, 1));
console.error(`matched ${matched} of ${counted} (${out.pct}%), skipped ${pairs.length - counted}`);
