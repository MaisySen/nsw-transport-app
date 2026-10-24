// Store screenshots from the web export (store/screenshots/README.md).

import { chromium } from "playwright-core";
import fs from "node:fs";
const [,, port, outDir, W, H, DSF, scheme, look] = process.argv;
const exe = process.env.CHROME || undefined;
const b = await chromium.launch({ executablePath: exe });
const ua = look === "android" ? "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" : "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ctx = await b.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: +DSF, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: ua, locale: "en-AU", timezoneId: "Australia/Sydney",
  geolocation: { latitude: -33.8773, longitude: 151.1040 }, permissions: ["geolocation", "notifications"] });
await ctx.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = '[class*="navigationMenuRoot"]{display:none!important}'; document.head.appendChild(st); }); });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
const base = "http://127.0.0.1:" + port;
const vis = (l) => l.locator("visible=true").first();
const snap = async (name) => { await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const steps = JSON.parse(process.env.STEPS || '["setup","home"]');
await page.goto(base + "/home"); await page.waitForTimeout(6000);
if (page.url().includes("/welcome")) {
  await vis(page.getByLabel("Home station")).fill("Burwood"); await page.waitForTimeout(3500); await vis(page.getByText(/^Burwood( Station)?$/)).click({ timeout: 8000 });
  await vis(page.getByLabel("Work station")).fill("Strathfield"); await page.waitForTimeout(3500); await vis(page.getByText(/^Strathfield( Station)?$/)).click({ timeout: 8000 });
  await page.waitForTimeout(6000);
}
for (const s of steps) {
  try {
    if (s === "home") { await page.goto(base + "/home"); await page.waitForTimeout(9000); await snap("01-home"); }
    if (s === "board") { await page.goto(base + "/stop/200060?name=Central%20Station"); await page.waitForTimeout(9000); await snap("02-departures"); }
    if (s === "trip") { await page.goto(base + "" + (process.env.TRIP || "/trip?from=200060&fromName=Central+Station&to=215020&toName=Parramatta+Station") + ""); await page.waitForTimeout(10000); await snap("03-trip"); }
    if (s === "ask") { await page.goto(base + "/ask"); await page.waitForTimeout(4000);
      const box = vis(page.getByRole("textbox")); await box.fill(process.env.ASKQ || "next train Strathfield to Kings Cross"); await box.press("Enter"); await page.waitForTimeout(9000);
      if (look === "android") { const q = page.getByText(process.env.ASKQ || "next train Strathfield to Kings Cross").last(); await q.evaluate((e) => e.scrollIntoView({ block: "start" })); await page.waitForTimeout(800); } await snap("04-ask"); }
    if (s === "morning") { await page.goto(base + "/morning"); await page.waitForTimeout(6000);
      if (look !== "android") { const n = page.getByText(/get alerts while Transport is closed|Needs notifications/); for (const el of await n.all()) await el.evaluate((e) => { e.parentElement.style.display = "none"; }); await page.waitForTimeout(300); } await snap("05-morning"); }
    if (s === "watching") { await page.goto(base + "/watching"); await page.waitForTimeout(6000); await snap("05-watching"); }
    if (s === "plan") { await page.goto(base + "/search"); await page.waitForTimeout(5000); await snap("06-plan"); }
    if (s === "parking") { await page.goto(base + "/parking"); await page.waitForTimeout(8000); await snap("06-parking"); }
    if (s === "topup") { await page.goto(base + "/topup"); await page.waitForTimeout(9000); await snap("06-topup"); }
    if (s === "settings") { await page.goto(base + "/settings"); await page.waitForTimeout(5000); await snap("07-more"); }
  } catch (e) { console.log("fail", s, String(e).slice(0, 200)); }
}
fs.writeFileSync(`${outDir}/errs.json`, JSON.stringify(errs.slice(0, 20), null, 1));
await b.close();
