// Screens for the four rider wins (g31): where the bus is on Home and trip rows, the Walking choice, Get me home and
// the exact stand pin. Runs the web export against test/e2e/mockapi.mjs (no Transport for NSW call); the mock has no
// live vehicle feed, so the first ride of each trip answer gets a live position here (3 stops away, 4 min late) and a
// short walk and bus path, to draw what a live answer draws.
// node test/e2e/riderwins.mjs OUTDIR WEBPORT MOCKPORT WIDTH HEIGHT light|dark
// HOME and WORK (station ids from backend/src/public/stations/train.json) and HERE (lat,lon) pick the places.
import { chromium } from "playwright-core";
import fs from "node:fs";
const [,, out, port, mock, W, H, scheme] = process.argv;
const HOME = (process.env.HOME_STOP || "275010|Penrith Station").split("|");
const WORK = (process.env.WORK_STOP || "215020|Parramatta Station").split("|");
const [hlat, hlon] = (process.env.HERE || "-33.8160,151.0040").split(",").map(Number);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await b.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, locale: "en-AU", timezoneId: "Australia/Sydney",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  geolocation: { latitude: hlat, longitude: hlon }, permissions: ["geolocation"] });
await ctx.addInitScript(([home, work]) => {
  if (!localStorage.getItem("store")) localStorage.setItem("store", JSON.stringify({ places: { home: { id: home[0], name: home[1] }, work: { id: work[0], name: work[1] } }, onboarded: true }));
  document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = '[class*="navigationMenuRoot"]{display:none!important}'; document.head.appendChild(st); });
}, [HOME, WORK]);
const live = (j, k) => {
  const i = j.legs.findIndex((l) => l.kind === "transit");
  if (i < 0) return;
  const l = j.legs[i];
  const off = (t, m) => new Date(Date.parse(t) + m * 60000).toISOString();
  const s = l.path && l.path[0] ? l.path[0] : [hlat, hlon];
  // A northbound first stretch from the stand, and a walk to it from 30 m east of the road (the far side).
  l.path = [s, [s[0] + 0.0004, s[1]], [s[0] + 0.0010, s[1] + 0.0001], [s[0] + 0.0020, s[1] + 0.0002], ...(l.path || []).slice(1)];
  if (k === 0) { Object.assign(l, { realtime: true, delayMin: 4, estimated: off(l.planned, 4), arrEstimated: off(l.arrPlanned, 4), stopsAway: 3, vehicle: { lat: s[0] - 0.006, lon: s[1], ageS: 15 } }); }
  if (k === 0 && process.env.BUS !== "0") Object.assign(l, { mode: "bus", line: l.line && /^T/.test(l.line) ? "M52" : l.line, fromPlatform: "Stand C3", color: "#00B5EF" });
  if (i === 0) j.legs.unshift({ kind: "walk", mode: "walk", durationMin: 2, distanceM: 150, from: "Your location", to: l.from, path: [[s[0] - 0.0002, s[1] + 0.00032], s] });
};
await ctx.route(/^https:\/\/(api\.transportsydney\.app|[a-z0-9-]+\.sites\.tab\.bot)\//, async (route) => {
  const q = route.request(); const u = new URL(q.url());
  if (q.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE,PUT" } });
  try {
    const r = await fetch("http://127.0.0.1:" + mock + u.pathname + u.search, { method: q.method(), headers: { "content-type": "application/json" }, body: ["GET", "HEAD"].includes(q.method()) ? undefined : q.postData() });
    let body = Buffer.from(await r.arrayBuffer());
    if (u.pathname === "/api/trip" && r.status === 200) { const d = JSON.parse(body.toString()); (d.journeys || []).forEach(live); body = Buffer.from(JSON.stringify(d)); }
    await route.fulfill({ status: r.status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body });
  } catch (e) { await route.abort(); }
});
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
const base = "http://127.0.0.1:" + port;
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const tag = `${W}x${H}-${scheme}`;
const report = { tag, checks: {} };
await page.goto(base + "/home", { waitUntil: "networkidle" }).catch(() => {});
await page.getByText(/stops? away/).first().waitFor({ timeout: 20000 }).catch(() => {});
// g32: the status line says the delay, so the where line says only where it is.
report.checks.homeWhere = await page.getByText(/^3 stops away$/).count();
report.checks.getMeHome = await page.getByRole("button", { name: /^Get me home/ }).count();
await shot(`home-${tag}`);
await page.getByRole("button", { name: /^Get me home/ }).first().click();
await page.waitForURL(/\/trip/, { timeout: 15000 }).catch(() => {});
await page.getByRole("button", { name: /^Walking/ }).first().waitFor({ timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);
report.checks.tripUrl = page.url().replace(base, "");
report.checks.walking = await page.getByRole("button", { name: /^Walking/ }).count();
report.checks.rowWhere = await page.getByText(/^3 stops away$/).count();
report.checks.saveHidden = (await page.getByRole("button", { name: "Save trip" }).count()) === 0;
await shot(`trip-${tag}`);
// Open the first trip and its stand map.
const rows = page.getByRole("button", { name: /^Leaves / });
if (!(await page.getByRole("button", { name: /on the map/ }).count()) && (await rows.count())) await rows.first().click();
await page.waitForTimeout(800);
const pin = page.getByRole("button", { name: /on the map/ }).first();
report.checks.pinRow = await page.getByRole("button", { name: /on the map/ }).count();
report.checks.across = await page.getByText(/across the road from where your walk starts/).count();
if (await pin.count()) { await pin.scrollIntoViewIfNeeded(); await pin.click(); await page.waitForTimeout(2500); }
report.checks.mapsLink = await page.getByRole("link", { name: /in Maps$/ }).count();
await shot(`pin-${tag}`);
// The Walking menu (drawn menu on the web) and a 5 min limit.
const walk = page.getByRole("button", { name: /^Walking/ }).first();
await walk.scrollIntoViewIfNeeded(); await walk.click(); await page.waitForTimeout(600);
await shot(`walkmenu-${tag}`);
const five = page.getByText("Up to 5 min", { exact: true }).last();
if (await five.count()) { await five.click(); await page.waitForTimeout(800); }
report.checks.walkValue = await page.getByRole("button", { name: /^Walking, Up to 5 min/ }).count();
report.checks.stored = await page.evaluate(() => JSON.parse(localStorage.getItem("store") || "{}").walkPref || null);
await page.evaluate(() => window.scrollTo(0, 0));
await shot(`walk5-${tag}`);
report.errors = errs.slice(0, 5);
fs.writeFileSync(`${out}/report-${tag}.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
await b.close();
