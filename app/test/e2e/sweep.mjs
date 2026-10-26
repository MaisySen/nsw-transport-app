// Screen sweep for the button check (docs/BUTTON_CHECK.md): opens every screen of the web export, saves a screenshot,
// lists page errors and wording that should never show (raw status codes, undefined, NaN, "No more services" with
// no data), and taps every visible control once to see whether anything happened (a new screen, a dialog, a link,
// a change on the page). A tap with no visible effect is listed for a person to judge: some are fine on the web
// (haptics, speech), the rest are dead taps.
// node test/e2e/sweep.mjs <outDir> <webPort> <tag> [taps]   with MOCK_API, AT, W, H, SCHEME (light|dark), CHROME
import { chromium } from "playwright-core";
import fs from "fs";
const [,, outDir, port, tag, taps] = process.argv;
const W = +(process.env.W || 390), H = +(process.env.H || 844), SCHEME = process.env.SCHEME || "light";
fs.mkdirSync(outDir, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: SCHEME, locale: "en-AU", timezoneId: "Australia/Sydney",
  geolocation: { latitude: -33.8170, longitude: 151.0034 }, permissions: ["geolocation", "notifications"] });
await ctx.route(/(entry|index)-.*\.js$/, async (route) => { const r = await route.fetch(); let body = await r.text(); body = body.replace("var t=class{static alert(){}}", "var t=class{static alert(a,b,c){window.__rnAlert&&window.__rnAlert(a,b,c)}}"); await route.fulfill({ response: r, body }); });
const P = (id, name) => ({ id, name });
const SEED = { onboarded: true, places: { home: P("215020", "Parramatta Station"), work: P("200080", "Wynyard Station") },
  starred: [P("200060", "Central Station"), P("209573", "Manly Wharf")], recents: [P("206710", "Chatswood Station")], recentTrips: [], watchedTrips: {},
  myTrips: [{ from: P("206710", "Chatswood Station"), to: P("202210", "Bondi Junction Station"), name: "Chatswood to Bondi Junction" }], tripOrder: [], allServices: {}, fareType: "adult" };
await ctx.addInitScript(([s]) => {
  if (!localStorage.getItem("store")) localStorage.setItem("store", JSON.stringify(s));
  window.__rnAlert = (t, m, btns) => { const o = document.createElement("div"); o.id = "__dlg"; o.innerHTML = `<div>${t}</div><div>${m || ""}</div>`; for (const x of (btns && btns.length ? btns : [{ text: "OK" }])) { const e = document.createElement("button"); e.textContent = x.text; e.onclick = () => { o.remove(); x.onPress && x.onPress(); }; o.appendChild(e); } o.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff;color:#000"; document.body.appendChild(o); };
  navigator.share = async () => { window.__shared = (window.__shared || 0) + 1; };
  window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; };
}, [SEED]);
const MOCK = process.env.MOCK_API;
if (MOCK) {
  if (process.env.AT) await fetch(`http://127.0.0.1:${MOCK}/__clock`, { method: "POST", body: JSON.stringify({ t: Date.parse(process.env.AT), mode: process.env.NSW_MODE || "ok", headway: process.env.HEADWAY || 10, latency: 0 }) });
  await ctx.route(/^https:\/\/(api\.transportsydney\.app|[a-z0-9-]+\.sites\.tab\.bot)\//, async (route) => {
    const q = route.request(); const u = new URL(q.url());
    if (q.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE,PUT" } });
    try {
      const r = await fetch(`http://127.0.0.1:${MOCK}${u.pathname}${u.search}`, { method: q.method(), headers: { "content-type": q.headers()["content-type"] || "application/json" }, body: ["GET", "HEAD"].includes(q.method()) ? undefined : q.postDataBuffer() || undefined });
      const h = Object.fromEntries(r.headers); delete h["content-encoding"]; delete h["content-length"];
      await route.fulfill({ status: r.status, headers: { ...h, "access-control-allow-origin": "*" }, body: Buffer.from(await r.arrayBuffer()) });
    } catch { await route.abort(); }
  });
}
// Anything else outside this machine (fonts aside) is refused, so nothing reaches a real server.
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|api\.transportsydney\.app|[a-z0-9-]+\.sites\.tab\.bot|fonts\.|unpkg\.com|[a-z0-9.-]*(openstreetmap|cartocdn|basemaps)[a-z0-9.-]*)/, (r) => r.abort());
if (process.env.AT) await ctx.clock.install({ time: new Date(process.env.AT) });
const page = await ctx.newPage();
const base = "http://127.0.0.1:" + port;
const errors = [];
page.on("pageerror", (e) => errors.push({ url: page.url().replace(base, ""), error: String(e.message || e).slice(0, 300) }));
const SCREENS = [
  ["home", "/home"], ["plan", "/search"], ["ask", "/ask"], ["more", "/settings"],
  ["stop-train", "/stop/215020?name=Parramatta%20Station"], ["stop-ferry", "/stop/209573?name=Manly%20Wharf"], ["stop-bus", "/stop/G219234?name=Burwood%20Rd%20Before%20Canterbury%20Rd"],
  ["board", "/board?id=200060&name=Central%20Station"],
  ["trip", "/trip?from=215020&fromName=Parramatta+Station&to=200080&toName=Wynyard+Station"],
  ["trip-regional", "/trip?from=229310&fromName=Newcastle+Interchange&to=250020&toName=Wollongong+Station"],
  ["route", "/route?line=T1&mode=train&stop=215020&towards=Emu%20Plains&color=%23F99D1C"],
  ["morning", "/morning"], ["parking", "/parking"], ["topup", "/topup"], ["watching", "/watching"], ["simple", "/simple"], ["voice", "/voice"],
  ["new-trip", "/new-trip"], ["add-trip", "/add-trip"], ["plan-link", "/plan?from=215020&to=200080&fromName=Parramatta%20Station&toName=Wynyard%20Station"],
  ["welcome-edit", "/welcome?edit=1"], ["go-none", "/go"], ["shared-bad", "/shared/nope"], ["profile-bad", "/profile/nope"], ["watch-bad", "/watch/nope"],
  ["carpark", "/carpark?stop=215020"], ["unknown-link", "/platform"],
];
const BAD = [/\b(500|502|503|504|429|404)\b/, /\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /No more services/i, /Something went wrong \(/, /\bnull\b/, /TypeError|ReferenceError/];
const out = [];
const state = () => page.evaluate(() => { const h = document.body.innerHTML.replace(/ data-sweep="\d+"/g, ""); return { url: location.pathname + location.search, html: h.length + ":" + [...h].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0), dlg: !!document.getElementById("__dlg"), opened: (window.__opened || []).length, shared: window.__shared || 0 }; });
for (const [name, path] of SCREENS) {
  const row = { name, path, errorsBefore: errors.length };
  try {
    await page.goto(base + path); await page.waitForTimeout(6500);
    await page.screenshot({ path: `${outDir}/${tag}-${name}.png` });
    const text = await page.evaluate(() => document.body.innerText);
    row.bad = BAD.filter((re) => re.test(text)).map((re) => { const m = text.match(re); const i = text.indexOf(m[0]); return text.slice(Math.max(0, i - 60), i + 60).replace(/\n/g, " | "); });
    row.text = text.slice(0, 600).replace(/\n/g, " | ");
    if (taps) {
      // Every visible control, outermost only (a button inside a row that is itself a button is the row's job).
      const list = () => page.evaluate(() => {
        const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && e.offsetParent !== null; };
        const all = [...document.querySelectorAll('[role=button],[role=link],[role=switch],[role=tab],[role=checkbox],[role=radio],a[href],button')].filter(vis);
        all.forEach((e, i) => e.setAttribute("data-sweep", String(i)));
        return all.map((e) => (e.getAttribute("aria-label") || e.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80) || "(no name)");
      });
      const controls = await list();
      const seen = {}; row.taps = [];
      for (const label of controls.slice(0, 60)) {
        const nth = seen[label] = (seen[label] ?? -1) + 1;
        if (/^(Home|Plan|Ask|More)$/.test(label) && nth === 0 && name !== "home") continue; // the tab bar, checked once on Home
        const t = { label, nth };
        try {
          if (page.url().replace(base, "") !== path) { await page.goto(base + path); await page.waitForTimeout(4000); }
          await page.evaluate(() => document.getElementById("__dlg")?.remove());
          // Number the controls again (the page may have changed) and take the nth one with this name.
          const now = await list();
          let k = -1; for (let i = 0, n = -1; i < now.length; i++) if (now[i] === label && ++n === nth) { k = i; break; }
          if (k < 0) { t.effect = "gone"; row.taps.push(t); continue; }
          const el = page.locator(`[data-sweep="${k}"]`);
          await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
          const s0 = await state();
          await el.click({ timeout: 3000 });
          await page.waitForTimeout(1300);
          const s1 = await state();
          t.effect = s1.url !== s0.url ? "opens " + s1.url.slice(0, 80) : s1.dlg && !s0.dlg ? "dialog" : s1.opened > s0.opened ? "link" : s1.shared > s0.shared ? "share" : s1.html !== s0.html ? "changes" : "none";
          if (s1.url !== s0.url || s1.dlg) { await page.evaluate(() => document.getElementById("__dlg")?.remove()); }
        } catch (e) { t.effect = "error " + String(e).slice(0, 120); }
        row.taps.push(t);
      }
    }
  } catch (e) { row.fail = String(e).slice(0, 200); }
  row.errors = errors.slice(row.errorsBefore); delete row.errorsBefore;
  out.push(row);
  fs.writeFileSync(`${outDir}/${tag}-sweep.json`, JSON.stringify(out, null, 1));
}
console.log(out.map((r) => `${r.name}: ${r.fail || ""}${r.bad?.length ? " BAD " + JSON.stringify(r.bad) : ""}${r.errors.length ? " ERR " + r.errors.length : ""}${r.taps ? " taps " + r.taps.length + ", none " + r.taps.filter((t) => t.effect === "none").length + ", err " + r.taps.filter((t) => t.effect.startsWith("error")).length : ""}`).join("\n"));
await b.close();
