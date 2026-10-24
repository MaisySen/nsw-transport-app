// Accessibility check on the web export: axe (WCAG 2.1 A and AA) on every main screen, light and dark, plus
// a touch target scan (anything tappable smaller than 48 by 48 dp, counting its hit slop is not possible on
// the web, so those are listed for a look). Run: AXE=<path to axe.min.js> node test/e2e/a11y.mjs OUT PORT
import { chromium } from "playwright-core";
import fs from "fs";
const [,, out, port] = process.argv;
const axe = fs.readFileSync(process.env.AXE, "utf8");
const base = "http://127.0.0.1:" + port;
const screens = [
  ["home", "/home"], ["plan", "/search"], ["ask", "/ask"], ["more", "/settings"],
  ["stop", "/stop/200060?name=Central+Station"],
  ["trip", "/trip?from=213410&fromName=Burwood+Station&to=213510&toName=Strathfield+Station"],
  ["topup", "/topup"], ["parking", "/parking"], ["watching", "/watching"], ["newtrip", "/new-trip"],
];
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const report = {};
let total = 0;
for (const scheme of ["light", "dark"]) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, colorScheme: scheme, geolocation: { latitude: -33.8773, longitude: 151.1040 }, permissions: ["geolocation"] });
  const page = await ctx.newPage();
  for (const [name, path] of screens) {
    await page.goto(base + path); await page.waitForTimeout(name === "trip" ? 9000 : 5000);
    await page.addScriptTag({ content: axe });
    const r = await page.evaluate(async () => {
      // The map is a third party iframe (Leaflet and OpenStreetMap tiles) in the web preview only; phones draw a native map.
      const res = await window.axe.run({ exclude: [["iframe"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
      return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 6).map((n) => ({ t: n.target.join(" "), s: n.failureSummary.slice(0, 220), h: n.html.slice(0, 160) })), count: v.nodes.length }));
    });
    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('[role="button"],[role="tab"],[role="switch"],[role="link"],button,a,input')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const st = getComputedStyle(el); if (st.visibility === "hidden" || st.display === "none") continue;
        if (r.width < 48 || r.height < 48) out.push({ label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
      }
      return out;
    });
    report[`${scheme}:${name}`] = { violations: r, small };
    total += r.reduce((a, v) => a + v.count, 0);
    await page.screenshot({ path: `${out}/${scheme}-${name}.png` });
  }
  await ctx.close();
}
fs.writeFileSync(`${out}/a11y.json`, JSON.stringify(report, null, 1));
for (const [k, v] of Object.entries(report)) console.log(`${k}: ${v.violations.length ? v.violations.map((x) => `${x.id} x${x.count}`).join(", ") : "axe clean"}; small targets ${v.small.length}`);
console.log("TOTAL axe nodes", total);
await b.close();
