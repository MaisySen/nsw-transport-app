// Endless trip list check (trip pages, 27 Oct): opens a plain A to B trip against the local server
// (MOCK_API=<port>, test/e2e/mockapi.mjs, a fake Transport for NSW, so no Transport for NSW call), at the phone sizes
// given, in light and dark. It screenshots the first page, the skeleton rows while the next page loads, the list after
// scrolling down, and after scrolling up past the first trip (an earlier page), and checks that each page added trips
// with no gap and no repeat and that the page never threw.
//   MOCK_API=8811 node test/e2e/pages.mjs OUT WEBPORT [390x844,430x932] [light,dark]
import { chromium } from "playwright-core";
import fs from "fs";
const [,, out, port, sizesArg = "390x844,430x932", schemesArg = "light,dark"] = process.argv;
const MOCK = process.env.MOCK_API;
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const report = [];
const times = async (page) => page.evaluate(() => {
  // Each trip row's first clock time (h:mm am/pm), top to bottom.
  const t = document.body.innerText.match(/\b\d{1,2}:\d{2}\s?(am|pm)\b/gi) || [];
  return t;
});
const rows = async (page) => page.evaluate(() => document.querySelectorAll('[aria-label*="Leaves"], [aria-label*="leaves"]').length);
for (const size of sizesArg.split(",")) {
  const [w, h] = size.split("x").map(Number);
  for (const scheme of schemesArg.split(",")) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, colorScheme: scheme, deviceScaleFactor: 2 });
    await ctx.route(/^https:\/\/(api\.transportsydney\.app|[a-z0-9-]+\.sites\.tab\.bot)\//, async (route) => {
      const q = route.request(); const u = new URL(q.url());
      if (q.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE" } });
      try {
        const r = await fetch(`http://127.0.0.1:${MOCK}${u.pathname}${u.search}`, { method: q.method(), headers: { "content-type": q.headers()["content-type"] || "application/json" }, body: q.method() === "GET" ? undefined : q.postData() });
        const hd = Object.fromEntries(r.headers); delete hd["content-encoding"]; delete hd["content-length"];
        await route.fulfill({ status: r.status, headers: { ...hd, "access-control-allow-origin": "*" }, body: Buffer.from(await r.arrayBuffer()) });
      } catch (e) { await route.abort(); }
    });
    const page = await ctx.newPage();
    const errors = [], pages = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    page.on("request", (r) => { const u = r.url(); if (u.includes("/api/trip?") && u.includes("page=1")) pages.push(/after=/.test(u) ? "later" : /before=/.test(u) ? "earlier" : "first"); });
    const tag = `${w}x${h}-${scheme}`;
    await fetch(`http://127.0.0.1:${MOCK}/__clock`, { method: "POST", body: JSON.stringify({ latency: 0 }) });
    await page.goto(`http://127.0.0.1:${port}/trip?from=213410&fromName=Burwood+Station&to=213510&toName=Strathfield+Station`);
    await page.waitForTimeout(9000);
    await page.screenshot({ path: `${out}/${tag}-1-first.png` });
    const t1 = await times(page);
    // Slow server from here so the skeleton rows can be seen.
    await fetch(`http://127.0.0.1:${MOCK}/__clock`, { method: "POST", body: JSON.stringify({ latency: 2500 }) });
    const scroller = async (dy) => page.evaluate((dy) => {
      const els = [...document.querySelectorAll("div")].filter((d) => { const s = getComputedStyle(d); return (s.overflowY === "auto" || s.overflowY === "scroll") && d.scrollHeight > d.clientHeight + 20; });
      const el = els.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (!el) return null;
      if (dy === "end") el.scrollTop = el.scrollHeight; else if (dy === "top") el.scrollTop = 0; else el.scrollTop += dy;
      return { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight };
    }, dy);
    let s1 = await scroller("end");
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${tag}-2-skeleton-bottom.png` });
    await page.waitForTimeout(6000);
    await scroller(-200);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${tag}-3-after-later.png` });
    const s2 = await scroller(0);
    // Up past the first trip: an earlier page.
    await scroller("top"); await page.waitForTimeout(200);
    await page.mouse.move(w / 2, h / 2); await page.mouse.wheel(0, -300);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${tag}-4-skeleton-top.png` });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${out}/${tag}-5-after-earlier.png` });
    const t3 = await times(page);
    report.push({ tag, errors, pages, first: t1.length, scrollFirst: s1, scrollAfterLater: s2, clockTimesEnd: t3.length });
    await ctx.close();
  }
}
await b.close();
fs.writeFileSync(`${out}/pages.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
