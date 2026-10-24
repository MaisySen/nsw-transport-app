// The Opal machines page has a map inside a scrolling page. Checks that a wheel or drag over the map
// does not trap the page on the web preview (the map takes no wheel zoom there; + and - buttons instead),
// and that the page scrolls normally away from the map. Phones use the touch lock in components/MapCard.tsx,
// covered by test/press.test.mjs. Run: node test/e2e/mapscroll.mjs PORT
import { chromium } from "playwright-core";
const [,, port] = process.argv;
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, geolocation: { latitude: -33.8773, longitude: 151.1040 }, permissions: ["geolocation"] });
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:" + port + "/topup"); await page.waitForTimeout(9000);
const scroller = async () => page.evaluate(() => { let best = null; for (const e of document.querySelectorAll("div")) { if (e.scrollHeight > e.clientHeight + 50 && getComputedStyle(e).overflowY.match(/auto|scroll/)) { if (!best || e.scrollHeight > best.scrollHeight) best = e; } } if (best) best.dataset.sc = "1"; return best ? best.scrollTop : -1; });
const top = async () => page.evaluate(() => document.querySelector('[data-sc="1"]')?.scrollTop ?? -1);
await scroller();
const res = [];
const frame = await page.locator("iframe").first().boundingBox();
res.push({ name: "map is on the page", pass: !!frame });
const zoomBtn = await page.frameLocator("iframe").locator(".leaflet-control-zoom-in").count();
res.push({ name: "map has + and - buttons", pass: zoomBtn === 1 });
const t0 = await top();
await page.mouse.move(206, 200); await page.mouse.wheel(0, 400); await page.waitForTimeout(800);
const t1 = await top();
res.push({ name: "page scrolls with the pointer off the map", pass: t1 > t0, note: `${t0} -> ${t1}` });
await page.evaluate(() => { document.querySelector('[data-sc="1"]').scrollTop = 0; }); await page.waitForTimeout(500);
const fb = await page.locator("iframe").first().boundingBox();
await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
const z0 = await page.frameLocator("iframe").locator(".leaflet-map-pane").getAttribute("style");
await page.mouse.wheel(0, 400); await page.waitForTimeout(1200);
const z1 = await page.frameLocator("iframe").locator(".leaflet-map-pane").getAttribute("style");
const t2 = await top();
res.push({ name: "wheel over the map does not zoom it", pass: z0 === z1 });
res.push({ name: "wheel over the map scrolls the page", pass: t2 > 0, note: `scrollTop ${t2}` });
console.log(res.map((r) => `${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.note ? "  " + r.note : ""}`).join("\n"));
await b.close();
process.exit(res.every((r) => r.pass) ? 0 : 1);
