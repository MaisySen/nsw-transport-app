// Screens and alerts for the get off alert (g32). Seeds a live trip Strathfield to Central (5 stops, live times
// from a fake run answered here), opens trip mode, checks the Get off alert row, picks 3 stops before and Get off
// now from its menu, and reads what the app set on the phone (the web build logs each local alert). Every other API
// call goes to test/e2e/mockapi.mjs (no Transport for NSW call). Then Home, for the delay said once.
// node test/e2e/getoff.mjs OUTDIR WEBPORT MOCKPORT WIDTH HEIGHT light|dark
import { chromium } from "playwright-core";
import fs from "node:fs";
const [,, out, port, mock, W, H, scheme] = process.argv;
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await b.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, locale: "en-AU", timezoneId: "Australia/Sydney",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  permissions: ["notifications"] });
const now = Date.now();
const iso = (m) => new Date(now + m * 60000).toISOString();
const leg = { mode: "train", line: "T1", tripId: "T1.getoff", stopId: "2135234", toStopId: "2000334", toParent: "200060", from: "Strathfield Station", to: "Central Station", planned: iso(-1), arrPlanned: iso(16), fromPlatform: "Platform 4", towards: "Hornsby Station", color: "#F99D1C" };
const trip = { id: "gseed", title: "Strathfield to Central", origin: { id: "213510", name: "Strathfield Station" }, to: { id: "200060", name: "Central Station" }, legs: [leg], fare: null, started: now, alerted: {}, share: null, watchId: null };
const run = [["Homebush", -3], ["Strathfield", -1, "mine"], ["Burwood", 2], ["Croydon", 4], ["Ashfield", 6], ["Redfern", 12], ["Central", 16, "alight"], ["Town Hall", 18]];
await ctx.addInitScript(([t, home]) => {
  if (!sessionStorage.getItem("__seeded")) { sessionStorage.setItem("__seeded", "1"); localStorage.setItem("store", JSON.stringify({ onboarded: true, places: home })); localStorage.setItem("liveTrip", JSON.stringify(t)); }
  window.__alarms = [];
  window.__alarmLog = (a) => window.__alarms.push(a);
  document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = '[class*="navigationMenuRoot"]{display:none!important}'; document.head.appendChild(st); });
}, [trip, { home: { id: "275010", name: "Penrith Station" }, work: { id: "215020", name: "Parramatta Station" } }]);
const veh = (j) => {
  const l = j.legs.find((x) => x.kind === "transit");
  if (!l) return;
  const off = (t, m) => new Date(Date.parse(t) + m * 60000).toISOString();
  const s = l.path && l.path[0] ? l.path[0] : [-33.81, 151.0];
  Object.assign(l, { realtime: true, delayMin: 4, estimated: off(l.planned, 4), arrEstimated: off(l.arrPlanned, 4), stopsAway: 3, vehicle: { lat: s[0] - 0.006, lon: s[1], ageS: 15 } });
};
await ctx.route(/^https:\/\/(api\.transportsydney\.app|[a-z0-9-]+\.sites\.tab\.bot)\//, async (route) => {
  const q = route.request(); const u = new URL(q.url());
  if (q.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE,PUT" } });
  const cors = { "content-type": "application/json", "access-control-allow-origin": "*" };
  if (u.pathname === "/api/service" && u.searchParams.get("trip") === "T1.getoff") {
    const t = Date.now();
    const stops = run.map(([n, m, k], i) => ({ id: n.slice(0, 3) + i, name: n + " Station", planned: iso(m), estimated: iso(m + 1), mine: k === "mine", alight: k === "alight", lat: -33.87 + i * 0.002, lon: 151.09 + i * 0.01 }));
    let ni = stops.findIndex((s) => Date.parse(s.estimated) > t - 20000); if (ni < 0) ni = stops.length;
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ kind: "service", live: true, progress: "live", line: "T1", mode: "train", mineIndex: 1, alightIndex: 6, nextIndex: ni, stops }) });
  }
  if (u.pathname === "/api/watch" && q.method() === "POST") return route.fulfill({ status: 503, headers: cors, body: JSON.stringify({ error: "off for this check" }) });
  try {
    const r = await fetch("http://127.0.0.1:" + mock + u.pathname + u.search, { method: q.method(), headers: { "content-type": "application/json" }, body: ["GET", "HEAD"].includes(q.method()) ? undefined : q.postData() });
    let body = Buffer.from(await r.arrayBuffer());
    if (u.pathname === "/api/trip" && r.status === 200) { const d = JSON.parse(body.toString()); (d.journeys || []).slice(0, 1).forEach(veh); body = Buffer.from(JSON.stringify(d)); }
    await route.fulfill({ status: r.status, headers: cors, body });
  } catch (e) { await route.abort(); }
});
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
const base = "http://127.0.0.1:" + port;
const tag = `${W}x${H}-${scheme}`;
const shot = (n) => page.screenshot({ path: `${out}/${n}-${tag}.png` });
const report = { tag, checks: {} };
await page.goto(base + "/go", { waitUntil: "networkidle" }).catch(() => {});
const row = page.getByRole("button", { name: /^Get off alert/ }).locator("visible=true").first();
await row.waitFor({ timeout: 20000 }).catch(() => {});
report.checks.row = await row.getAttribute("aria-label").catch(() => null);
report.checks.sub1 = await page.getByText(/^As you leave the stop before Central$/).count();
await row.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(800);
await shot("row");
await row.click(); await page.waitForTimeout(700);
await shot("menu");
const three = page.getByText(/^3 stops before/).last();
if (await three.count()) { await three.click(); await page.waitForTimeout(2500); }
report.checks.after3 = await page.getByRole("button", { name: /^Get off alert/ }).locator("visible=true").first().getAttribute("aria-label").catch(() => null);
await page.getByRole("button", { name: /^Get off alert/ }).locator("visible=true").first().click(); await page.waitForTimeout(700);
const nowItem = page.getByText(/^Also Get off now/).last();
if (await nowItem.count()) { await nowItem.click(); await page.waitForTimeout(2500); }
report.checks.afterNow = await page.getByRole("button", { name: /^Get off alert/ }).locator("visible=true").first().getAttribute("aria-label").catch(() => null);
report.checks.stored = await page.evaluate(() => JSON.parse(localStorage.getItem("store") || "{}").getOff || null);
report.checks.alarms = await page.evaluate(() => (window.__alarms || []).filter((a) => a.getOff).map((a) => ({ id: a.id.replace(/^getoff-[^-]+-/, ""), at: a.at ? new Date(a.at).toISOString() : null, title: a.title, cancel: a.cancel || 0 })));
await row.scrollIntoViewIfNeeded().catch(() => {});
await shot("row3now");
// Home: the delay once on the trip cards.
await page.goto(base + "/home", { waitUntil: "networkidle" }).catch(() => {});
await page.getByText(/stops? away/).first().waitFor({ timeout: 20000 }).catch(() => {});
report.checks.homeWhereOnly = await page.getByText(/^3 stops away$/).count();
report.checks.homeWhereDouble = await page.getByText(/3 stops away \u00b7 4 min late/).count();
report.checks.homeLate = await page.getByText(/4 min late/).count();
await shot("home");
report.errors = errs.slice(0, 5);
fs.writeFileSync(`${out}/getoff-${tag}.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
await b.close();
