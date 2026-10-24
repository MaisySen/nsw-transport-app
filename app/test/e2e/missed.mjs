// Browser check of the missed connection card: a live trip Ashfield to Kings Cross with a change at Redfern, where
// the live feed makes the first train 8 min late so the T4 is missed. The next option comes from the real /api/plan
// (Redfern to Kings Cross after you reach the platform); Switch to this replaces the rest of the trip.
// Run: node test/e2e/missed.mjs OUT light|dark PORT
import { chromium } from "playwright-core";
import fs from "fs";
const [,, outDir, scheme, port] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36" });
const now = Date.now();
const iso = (m) => new Date(now + m * 60000).toISOString();
const legs = [
  { mode: "train", line: "T2", tripId: "T2.seed", stopId: "2131113", toStopId: "2015133", toParent: "201510", from: "Ashfield Station", to: "Redfern Station", planned: iso(2), arrPlanned: iso(15), fromPlatform: "Platform 3", towards: "Central Station", color: "#0098CD" },
  { mode: "train", line: "T4", tripId: "T4.seed", stopId: "2015139", toStopId: "2011122", toParent: "201110", from: "Redfern Station", to: "Kings Cross Station", planned: iso(19), arrPlanned: iso(28), fromPlatform: "Platform 9", towards: "Bondi Junction Station", color: "#005AA3", walkBefore: 3 },
];
const trip = { id: "gseed", title: "Ashfield to Kings Cross", origin: { id: "213110", name: "Ashfield Station" }, to: { id: "201110", name: "Kings Cross Station" }, legs, fare: null, started: now, alerted: {}, share: null, watchId: null };
await ctx.addInitScript(([t]) => { if (!sessionStorage.getItem("__seeded")) { sessionStorage.setItem("__seeded", "1"); localStorage.setItem("store", JSON.stringify({ onboarded: true })); localStorage.setItem("liveTrip", JSON.stringify(t)); } }, [trip]);
const runs = {
  "T2.seed": { delay: 8, stops: [["Ashfield", 2, "mine"], ["Stanmore", 8], ["Newtown", 10], ["Redfern", 15, "alight"], ["Central", 18]] },
  "T4.seed": { delay: 0, stops: [["Wolli Creek", 12], ["Redfern", 19, "mine"], ["Central", 21], ["Kings Cross", 28, "alight"]] },
};
await ctx.route(/\/api\/service\?/, (route) => {
  const u = new URL(route.request().url());
  const r = runs[u.searchParams.get("trip")];
  if (!r) return route.continue();
  const t = Date.now();
  const stops = r.stops.map(([n, m, k], i) => ({ id: n.slice(0, 3) + i, name: n + " Station", planned: iso(m), estimated: new Date(now + (m + r.delay) * 60000).toISOString(), mine: k === "mine", alight: k === "alight" }));
  let ni = stops.findIndex((s) => Date.parse(s.estimated) > t - 20000); if (ni < 0) ni = stops.length;
  return route.fulfill({ json: { kind: "service", live: true, line: u.searchParams.get("line"), mode: "train", mineIndex: stops.findIndex((s) => s.mine), alightIndex: stops.findIndex((s) => s.alight), nextIndex: ni, stops } });
});
await ctx.route(/\/api\/watch(\?|$)/, (route) => route.request().method() === "POST" ? route.fulfill({ status: 503, json: { error: "off for this check" } }) : route.continue());
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
const planCalls = []; page.on("request", (r) => { if (r.url().includes("/api/plan?")) planCalls.push(decodeURIComponent(r.url().split("?")[1])); });
const res = [];
await page.goto("http://127.0.0.1:" + port + "/go"); await page.waitForTimeout(12000);
// Pull the sheet up so the whole card shows.
const card = page.getByText(/^You'll miss the /).locator("visible=true").first();
res.push({ name: "missed change shows at once", pass: (await card.count()) === 1, text: await card.textContent().catch(() => "") });
await card.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(1500);
const sw = page.getByRole("button", { name: "Switch my trip to this option" }).locator("visible=true").first();
const has = (await sw.count()) === 1;
const none = (await page.getByText(/^See all trips from /).locator("visible=true").count()) === 1;
res.push({ name: "next option from /api/plan (or an honest none)", pass: has || none, option: has, plan: planCalls[0] || null });
await page.screenshot({ path: `${outDir}/missed-${scheme}.png` });
if (has) {
  await sw.click();
  await page.waitForTimeout(6000);
  const g = await page.evaluate(() => JSON.parse(localStorage.getItem("liveTrip") || "null"));
  res.push({ name: "switch to this replaces the rest of the trip", pass: !!g && g.legs.length >= 2 && g.legs[0].tripId === "T2.seed" && g.legs[1].tripId !== "T4.seed", legs: g && g.legs.map((l) => `${l.line} ${l.from} ${l.planned}`) });
  res.push({ name: "card gone after the switch", pass: (await page.getByText(/^You'll miss the /).locator("visible=true").count()) === 0 });
  await page.screenshot({ path: `${outDir}/switched-${scheme}.png` });
}
fs.writeFileSync(`${outDir}/missed-${scheme}.json`, JSON.stringify({ res, errs: errs.slice(0, 5) }, null, 1));
console.log(res.map((r) => `${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.text ? "  " + r.text : ""}${r.legs ? "  " + r.legs.join(" | ") : ""}`).join("\n"));
await b.close();
