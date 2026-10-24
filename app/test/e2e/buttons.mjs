
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
// First launch: two questions, home and work, then Home shows the commute card at once.
await check("Setup opens on first launch", async () => {}, async () => page.url().includes("/welcome") && (await page.getByText("Where's home?").locator("visible=true").count()) === 1);
await check("Setup: pick home Burwood", async () => { await vis(page.getByLabel("Home station")).fill("Burwood"); await page.waitForTimeout(3500); await vis(page.getByText(/^Burwood( Station)?$/)).click({ timeout: 5000 }); }, async () => (await page.getByText("Where's work?").locator("visible=true").count()) === 1);
await check("Setup: pick work Strathfield", async () => { await vis(page.getByLabel("Work station")).fill("Strathfield"); await page.waitForTimeout(3500); await vis(page.getByText(/^Strathfield( Station)?$/)).click({ timeout: 5000 }); }, async () => page.url().endsWith("/home"));
const commuteTitle = async () => (await page.getByText(/^To (work|home): /).locator("visible=true").first().textContent({ timeout: 8000 }).catch(() => "")) || "";
let t0 = "";
await check("Home: commute card on top, direction by time of day", async () => { await page.waitForTimeout(5000); t0 = await commuteTitle(); }, async () => { const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Australia/Sydney" }).format(new Date())) % 24; return h < 12 ? t0 === "To work: Burwood to Strathfield" : t0 === "To home: Strathfield to Burwood"; });
await check("Home: swap flips the commute", () => vis(page.getByRole("button", { name: /^Swap direction/ })).click({ timeout: 5000 }), async () => { await page.waitForTimeout(3000); const t1 = await commuteTitle(); return page.url().endsWith("/home") && !!t1 && t1 !== t0; });
// After the swap at night the card is To work, Burwood to Strathfield; the browser stands at Burwood.
await check("Home: Leave in N min from your location", async () => { await page.waitForTimeout(6000); }, async () => (await page.getByText(/^Leave (now|in \d+ (min|h))/).locator("visible=true").count()) >= 1);
// Remind me shows while there is at least a minute before you have to leave; wait for one if it is Leave now.
for (let k = 0; k < 6 && (await page.getByRole("button", { name: /^Remind me at / }).locator("visible=true").count()) === 0; k++) await page.waitForTimeout(15000);
{
  await check("Home: Remind me sets a leave alert", () => vis(page.getByRole("button", { name: /^Remind me at / })).click({ timeout: 5000 }), async () => (await page.getByRole("button", { name: /^Cancel the reminder at / }).locator("visible=true").count()) === 1);
  await check("Home: Cancel the reminder", () => vis(page.getByRole("button", { name: /^Cancel the reminder at / })).click({ timeout: 5000 }), async () => (await page.getByRole("button", { name: /^Remind me at / }).locator("visible=true").count()) === 1);
}
await check("Home: swap back", () => vis(page.getByRole("button", { name: /^Swap direction/ })).click({ timeout: 5000 }), async () => { await page.waitForTimeout(2500); return page.url().endsWith("/home") && (await commuteTitle()) === t0; });
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
await check("Wake me before my stop: on", () => vis(page.getByRole("switch", { name: "Wake me before my stop" })).click({ timeout: 5000 }), async () => { await page.waitForTimeout(1500); return (await vis(page.getByRole("switch", { name: "Wake me before my stop" })).isChecked()) && JSON.parse((await page.evaluate(() => localStorage.getItem("liveTrip"))) || "{}").wake === true; });
await check("Wake me before my stop: off", () => vis(page.getByRole("switch", { name: "Wake me before my stop" })).click({ timeout: 5000 }), async () => { await page.waitForTimeout(1500); return !(await vis(page.getByRole("switch", { name: "Wake me before my stop" })).isChecked()); });
await check("Share trip", () => vis(page.getByText("Share trip", { exact: true })).click({ timeout: 5000 }), async () => (await page.locator("#__dlg").count()) === 1);
await check("Share dialog Cancel", () => page.locator("#__dlg button", { hasText: "Cancel" }).click({ timeout: 5000 }), async () => (await page.locator("#__dlg").count()) === 0);
await check("End trip asks", () => vis(page.getByText("End trip", { exact: true })).click({ timeout: 5000 }), async () => (await page.locator("#__dlg").count()) === 1);
await check("End trip ends", () => page.locator("#__dlg button", { hasText: "End trip" }).click({ timeout: 5000 }), async () => { await page.waitForTimeout(1500); return !page.url().includes("/go") && !(await page.evaluate(() => localStorage.getItem("liveTrip"))); });
await check("Save trip star", () => vis(page.getByRole("button", { name: "Save trip" })).click({ timeout: 5000 }), async () => page.url().includes("/new-trip"));
await page.goto(base + "/stop/200060?name=Central+Station"); await page.waitForTimeout(6000);
await check("Star a stop", () => vis(page.getByLabel("Add to Starred stops")).click({ timeout: 5000 }), async () => (await page.getByLabel("Remove from Starred stops").locator("visible=true").count()) === 1);
await page.goto(base + "/settings"); await page.waitForTimeout(5000);
await check("More: Home and work shows both", async () => {}, async () => (await page.getByText("Home Burwood, Work Strathfield", { exact: true }).locator("visible=true").count()) === 1);
await check("More: Home and work opens setup to edit", () => vis(page.getByText("Home and work", { exact: true })).click({ timeout: 5000 }), async () => page.url().includes("/welcome") && (await page.getByText("Home now").locator("visible=true").count()) === 1);
await page.goto(base + "/settings"); await page.waitForTimeout(4000);
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
