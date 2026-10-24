
// Taps every button on the main path once and checks it did its job on the first tap.
import { chromium } from "playwright-core";
import fs from "fs";
const [,, out, port] = process.argv;
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, geolocation: { latitude: -33.8773, longitude: 151.1040 }, permissions: ["geolocation", "notifications"] });
await ctx.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = '[class*="navigationMenuRoot"]{top:auto!important;bottom:14px!important}'; document.head.appendChild(st); }); });
await ctx.route(/entry-.*\.js$/, async (route) => { const r = await route.fetch(); let body = await r.text(); body = body.replace("var t=class{static alert(){}}", "var t=class{static alert(a,b,c){window.__rnAlert&&window.__rnAlert(a,b,c)}}"); await route.fulfill({ response: r, body }); });
await ctx.addInitScript(() => {
  window.__rnAlert = (t, m, btns) => { const o = document.createElement("div"); o.id = "__dlg"; o.innerHTML = `<div>${t}</div>`; for (const x of (btns && btns.length ? btns : [{ text: "OK" }])) { const e = document.createElement("button"); e.textContent = x.text; e.onclick = () => { o.remove(); x.onPress && x.onPress(); }; o.appendChild(e); } o.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff"; document.body.appendChild(o); };
  navigator.share = async () => {};
  window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; };
});
const page = await ctx.newPage();
const base = "http://127.0.0.1:" + port;
const res = [];
const vis = (l) => l.locator("visible=true").first();
async function check(name, act, ok) { let pass = false, note = ""; try { await act(); await page.waitForTimeout(1500); pass = !!(await ok()); } catch (e) { note = String(e).slice(0, 160); } res.push({ name, pass, note, url: page.url().replace(base, "") }); }
await page.goto(base + "/home"); await page.waitForTimeout(7000);
for (const [tab, path] of [["Plan", "/search"], ["Ask", "/ask"], ["More", "/settings"], ["Home", "/home"]]) {
  await check(`tab ${tab}`, () => vis(page.getByRole("tab", { name: tab, exact: true })).click({ timeout: 5000 }), async () => page.url().endsWith(path));
}
await page.goto(base + "/trip?from=213410&fromName=Burwood+Station&to=213510&toName=Strathfield+Station"); await page.waitForTimeout(9000);
await check("Opal fare row opens", () => vis(page.getByRole("button", { name: /^Opal fare/ })).click({ timeout: 5000 }), async () => (await page.getByText(/An estimate from the Opal fare tables/).locator("visible=true").count()) > 0);
const rows0 = await page.getByLabel(/^Leaves /).locator("visible=true").count();
await check("Later services", () => vis(page.getByText("Later services", { exact: true })).click({ timeout: 5000 }), async () => { await page.waitForTimeout(4000); return (await page.getByLabel(/^Leaves /).locator("visible=true").count()) > rows0; });
await check("Include trips with a change", () => vis(page.getByRole("switch", { name: "Include trips with a change" })).click({ timeout: 5000 }), async () => (await vis(page.getByRole("switch", { name: "Include trips with a change" })).isChecked()));
await check("Tap a service closes its details", () => vis(page.getByLabel(/^Leaves /)).click({ timeout: 5000 }), async () => (await page.getByText("Start trip", { exact: true }).locator("visible=true").count()) === 0);
await check("Tap a service opens its details", () => vis(page.getByLabel(/^Leaves /)).click({ timeout: 5000 }), async () => (await page.getByText("Start trip", { exact: true }).locator("visible=true").count()) === 1);
await check("Start trip", () => vis(page.getByText("Start trip", { exact: true })).click({ timeout: 5000 }), async () => { await page.waitForTimeout(2500); return page.url().includes("/go"); });
await check("Share trip", () => vis(page.getByText("Share trip", { exact: true })).click({ timeout: 5000 }), async () => (await page.locator("#__dlg").count()) === 1);
await check("Share dialog Cancel", () => page.locator("#__dlg button", { hasText: "Cancel" }).click({ timeout: 5000 }), async () => (await page.locator("#__dlg").count()) === 0);
await check("End trip asks", () => vis(page.getByText("End trip", { exact: true })).click({ timeout: 5000 }), async () => (await page.locator("#__dlg").count()) === 1);
await check("End trip ends", () => page.locator("#__dlg button", { hasText: "End trip" }).click({ timeout: 5000 }), async () => { await page.waitForTimeout(1500); return !page.url().includes("/go") && !(await page.evaluate(() => localStorage.getItem("liveTrip"))); });
await check("Save trip star", () => vis(page.getByRole("button", { name: "Save trip" })).click({ timeout: 5000 }), async () => page.url().includes("/new-trip"));
await page.goto(base + "/stop/200060?name=Central+Station"); await page.waitForTimeout(6000);
await check("Star a stop", () => vis(page.getByLabel("Add to Starred stops")).click({ timeout: 5000 }), async () => (await page.getByLabel("Remove from Starred stops").locator("visible=true").count()) === 1);
await page.goto(base + "/settings"); await page.waitForTimeout(5000);
await check("More: Watching", () => vis(page.getByText("Watching", { exact: true })).click({ timeout: 5000 }), async () => page.url().endsWith("/watching"));
await page.goBack(); await page.waitForTimeout(1500);
await check("More: Opal fare type", () => vis(page.getByText("Opal fare type", { exact: true })).click({ timeout: 5000 }), async () => (await page.getByText(/(current)/).locator("visible=true").count()) > 0);
// A choice in a menu sheet runs after the sheet has closed (it used to be able to vanish with the sheet on Android).
await check("Fare type sheet: choose Concession", () => vis(page.getByText("Concession", { exact: true })).click({ timeout: 5000 }), async () => { await page.waitForTimeout(800); return (await page.getByText("Concession", { exact: true }).locator("visible=true").count()) === 1 && (await page.getByText(/(current)/).locator("visible=true").count()) === 0; });
await check("Fare type sheet: back to Adult", async () => { await vis(page.getByText("Opal fare type", { exact: true })).click({ timeout: 5000 }); await page.waitForTimeout(800); await vis(page.getByText("Adult", { exact: true })).click({ timeout: 5000 }); }, async () => { await page.waitForTimeout(800); return (await page.getByText("Adult", { exact: true }).locator("visible=true").count()) === 1; });
await check("About: Made by Fintex Australia Pty Ltd", async () => {}, async () => (await page.getByText("Fintex Australia Pty Ltd", { exact: true }).count()) >= 1);
await check("About: Contact us opens email to contact@fintex.au", () => page.getByText("Contact us", { exact: true }).first().click({ timeout: 5000 }), async () => (await page.evaluate(() => window.__opened)).some((u) => u.startsWith("mailto:contact@fintex.au")));
await check("About: Fintex website opens fintex.au", () => page.getByText("Fintex website", { exact: true }).first().click({ timeout: 5000 }), async () => (await page.evaluate(() => window.__opened)).some((u) => u.startsWith("https://fintex.au")));
await page.goto(base + "/topup"); await page.waitForTimeout(9000);
await check("Opal machines: list from the server", async () => {}, async () => (await page.getByText(/Burwood|Strathfield|Croydon/).locator("visible=true").count()) > 0);
await check("Opal machines: Takes cash filter", () => vis(page.getByRole("tab", { name: "Takes cash" })).click({ timeout: 5000 }), async () => (await page.getByText("Card only", { exact: true }).locator("visible=true").count()) === 0);
await check("Opal machines: a row opens the stop", () => vis(page.getByText("Strathfield", { exact: true })).click({ timeout: 5000 }), async () => page.url().includes("/stop/"));
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log(res.map((r) => `${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.note ? "  " + r.note : ""}`).join("\n"));
await b.close();
