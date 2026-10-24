
// Browser replay of a real short trip in the web preview: plan Burwood to Strathfield with the live planner,
// tap Start trip, then move a fake clock through boarding, the one stop, arrival and 15 minutes past it.
// /api/service answers from the real service, with the vehicle placed by the fake time; a minute after arrival
// it answers with the NEXT run, like the live feed did on Bidur's trip. Every engine action is logged.
import { chromium } from "playwright-core";
import fs from "fs";
const [,, outDir, scheme, port, fromQ, fromPick, toQ, toPick] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  geolocation: { latitude: -33.8773, longitude: 151.1040 }, permissions: ["geolocation", "notifications"] });
await ctx.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = '[class*="navigationMenuRoot"]{top:auto!important;bottom:14px!important}'; document.head.appendChild(st); }); });
await ctx.route(/(entry|index)-.*\.js$/, async (route) => { const r = await route.fetch(); let body = await r.text(); body = body.replace("var t=class{static alert(){}}", "var t=class{static alert(a,b,c){window.__rnAlert&&window.__rnAlert(a,b,c)}}"); await route.fulfill({ response: r, body }); });
await ctx.addInitScript(() => {
  // Home and work were answered already, so the first launch setup does not open over this replay.
  if (!localStorage.getItem("store")) localStorage.setItem("store", JSON.stringify({ onboarded: true }));
  window.__log = [];
  // The phone's own alarms (Wake me before my stop): set, moved and cancelled by the app, rung here when their time comes.
  window.__alarms = {};
  window.__alarmLog = (a) => { if (a.cancel) delete window.__alarms[a.id]; else if (a.at == null) window.__tripLog({ t: "alert", id: a.id, title: a.title, body: a.body, by: "app" }); else window.__alarms[a.id] = a; };
  setInterval(() => { for (const [id, a] of Object.entries(window.__alarms)) if (Date.now() >= a.at) { delete window.__alarms[id]; window.__tripLog({ t: "alert", id, title: a.title, body: a.body, by: "phone", at: Date.now() }); } }, 1000);
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  window.__tripLog = (a) => {
    window.__log.push(a);
    if (a.t !== "alert") return;
    let box = document.getElementById("__notes");
    if (!box) { box = document.createElement("div"); box.id = "__notes"; box.style.cssText = "position:fixed;left:10px;right:10px;top:10px;z-index:99998;display:flex;flex-direction:column;gap:8px;font-family:Roboto,system-ui"; document.body.appendChild(box); }
    const n = document.createElement("div");
    n.style.cssText = `background:${dark ? "#2b2930" : "#f3edf7"};color:${dark ? "#e6e0e9" : "#1d1b20"};border-radius:20px;padding:12px 16px;box-shadow:0 4px 16px rgba(0,0,0,.25);font-size:14px`;
    n.innerHTML = `<div style="font-size:12px;opacity:.7">Transport</div><div style="font-weight:600;margin-top:2px">${a.title}</div><div style="opacity:.85;margin-top:2px">${a.body}</div>`;
    box.appendChild(n);
  };
});
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
const real = new Map();
let mode = "real";
let shiftAfter = null;
await page.route(/\/api\/service\?/, async (route) => {
  const url = route.request().url();
  const key = new URL(url).searchParams.get("trip") || url;
  if (!real.has(key)) { const r = await route.fetch(); real.set(key, await r.json()); }
  const R = real.get(key);
  if (mode === "real") return route.fulfill({ json: R });
  const now = await page.evaluate(() => Date.now());
  const ai = R.alightIndex ?? -1;
  const offT = ai >= 0 ? Date.parse(R.stops[ai].estimated || R.stops[ai].planned) : NaN;
  let shift = 0;
  if (shiftAfter != null && Number.isFinite(offT) && now > offT + shiftAfter) shift = 15 * 60000;
  const stops = R.stops.map((s) => ({ ...s, planned: s.planned ? new Date(Date.parse(s.planned) + shift).toISOString() : s.planned, estimated: s.estimated ? new Date(Date.parse(s.estimated) + shift).toISOString() : s.estimated, passed: false }));
  let ni = stops.findIndex((s) => Date.parse(s.estimated || s.planned) > now - 20000);
  if (ni < 0) ni = stops.length;
  return route.fulfill({ json: { ...R, stops, nextIndex: ni, live: true, vehicle: null } });
});
if (process.env.NOWATCH === '1') await page.route(/\/api\/watch(\?|$)/, (route) => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { error: 'off for this replay' } }) : route.continue());
await page.clock.install({ time: Date.now() });
const shots = [];
let n = 0;
async function shot(name) {
  n++;
  const f = `${outDir}/${String(n).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: f });
  shots.push({ f, at: await page.evaluate(() => Date.now()) });
  await page.evaluate(() => { const x = document.getElementById("__notes"); if (x) x.remove(); });
}
const vis = (loc) => loc.locator("visible=true").first();
await page.goto("http://127.0.0.1:" + port + "/search", { waitUntil: "load" });
await page.waitForTimeout(6000);
await vis(page.getByPlaceholder("Where from")).fill(fromQ); await page.waitForTimeout(3500);
await vis(page.getByText(fromPick, { exact: true })).click(); await page.waitForTimeout(1500);
await vis(page.getByPlaceholder("Where to")).fill(toQ); await page.waitForTimeout(3500);
await vis(page.getByText(toPick, { exact: true })).click(); await page.waitForTimeout(10000);
await shot("plan");
await vis(page.getByText("Start trip", { exact: true })).click({ timeout: 10000 });
await page.waitForTimeout(6000);
const g = await page.evaluate(() => JSON.parse(localStorage.getItem("liveTrip") || "null"));
if (!g) { console.log(JSON.stringify({ error: "no live trip", errs, url: page.url() })); await b.close(); process.exit(1); }
if (process.env.WAKE === "1") { await vis(page.getByRole("switch", { name: "Wake me before my stop" })).click({ timeout: 5000 }); await page.waitForTimeout(2500); }
await shot("started");
mode = "sim"; shiftAfter = 60000;
const L = g.legs, last = L.length - 1;
const dep0 = Date.parse(L[0].estimated || L[0].planned);
// The arrival the planner gave; the service feed decides the real one.
const svcLast = [...real.values()].pop();
const arrFeed = svcLast && svcLast.alightIndex >= 0 ? Date.parse(svcLast.stops[svcLast.alightIndex].estimated || svcLast.stops[svcLast.alightIndex].planned) : Date.parse(L[last].arrPlanned);
async function to(t, name, settle = 16000) {
  const now = await page.evaluate(() => Date.now());
  if (t > now) await page.clock.fastForward(t - now);
  await page.clock.runFor(settle);
  await page.waitForTimeout(2500);
  if (name) await shot(name);
}
await to(dep0 - 90000, "board-soon");
await to(dep0 + 30000, "riding");
await to(arrFeed - 40000, "next-stop-yours");
await to(arrFeed + 20000, "arrived");
await to(arrFeed + 5 * 60000, "arrived-plus-5");
await to(arrFeed + 10 * 60000 + 30000, "ended");
await to(arrFeed + 15 * 60000, "plus-15");
const log = await page.evaluate(() => window.__log);
const after = await page.evaluate(() => JSON.parse(localStorage.getItem("liveTrip") || "null"));
fs.writeFileSync(outDir + "/replay.json", JSON.stringify({ legs: L, dep0, arrFeed, log, shots, liveTripAfter: after, errs: errs.slice(0, 10) }, null, 1));
console.log(JSON.stringify({ ok: true, n: log.length }));
await b.close();
