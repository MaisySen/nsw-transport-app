// First paint from what the phone keeps (28 Oct liveness pass): for each main screen, how long until its times show
// when the phone already holds a copy and the server is slow, against a first open with nothing kept. The server is
// the local stand in (test/e2e/mockapi.mjs, MOCK_API=<port>, no Transport for NSW call); a latency on it makes every
// answer slow, so anything on screen before then came from the phone. Times are from navigation start to the first
// frame with at least two departure or trip times, read with requestAnimationFrame, in a headless Chrome on the build
// box with the web export (not a phone).
//   MOCK_API=8811 CHROME=<chrome> node test/e2e/paintcache.mjs <dist-web dir> OUT.json [webPort 8822] [latency 4000]
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
const [,, dist, out, webPort = "8822", latencyArg = "4000"] = process.argv;
const MOCK = process.env.MOCK_API;
const LAT = +latencyArg;
// The web export as a single page app: unknown paths get index.html.
const types = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ttf": "font/ttf", ".ico": "image/x-icon" };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let f = path.join(dist, u);
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html");
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(+webPort, "127.0.0.1");
const screens = [
  ["Stop board, train station", `/stop/200060?name=Central%20Station`],
  ["Stop board, another station", `/stop/206710?name=Chatswood%20Station`],
  ["Stop board, ferry wharf", `/stop/209573?name=Manly%20Wharf`],
  ["Trip list", `/trip?from=215020&fromName=Parramatta+Station&to=200060&toName=Central+Station`],
];
const clock = (latency) => fetch(`http://127.0.0.1:${MOCK}/__clock`, { method: "POST", body: JSON.stringify({ latency }) });
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
async function context() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "en-AU", timezoneId: "Australia/Sydney" });
  await ctx.route(/^https:\/\/(api\.transportsydney\.app|[a-z0-9-]+\.sites\.tab\.bot)\//, async (route) => {
    const q = route.request(); const u = new URL(q.url());
    if (q.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE" } });
    try {
      const r = await fetch(`http://127.0.0.1:${MOCK}${u.pathname}${u.search}`, { method: q.method(), headers: { "content-type": q.headers()["content-type"] || "application/json" }, body: q.method() === "GET" ? undefined : q.postData() });
      const hd = Object.fromEntries(r.headers); delete hd["content-encoding"]; delete hd["content-length"];
      await route.fulfill({ status: r.status, headers: { ...hd, "access-control-allow-origin": "*" }, body: Buffer.from(await r.arrayBuffer()) });
    } catch (e) { await route.abort().catch(() => {}); }
  });
  return ctx;
}
// Milliseconds from navigation start to the first frame with two or more times, and the words on that frame.
async function firstTimes(page, url, limitMs) {
  await page.goto(`http://127.0.0.1:${webPort}${url}`, { waitUntil: "commit" });
  return page.evaluate((limit) => new Promise((done) => {
    const re = /\b(\d{1,2}\s?min|Now|\d{1,2}:\d{2}\s?(am|pm))\b/gi;
    let shell = null;
    const tick = () => {
      const text = document.body ? document.body.innerText : "";
      const n = (text.match(re) || []).length;
      const t = performance.now();
      // The app's first frame with any words (its start, before any times): the floor under every screen.
      if (shell == null && text.trim().length > 10) shell = Math.round(t);
      if (n >= 2) return done({ ms: Math.round(t), shellMs: shell, times: n, live: /Live/.test(text), updatedLine: (text.match(/(Live, updated[^\n]*|Updated [^\n]*refreshing|Offline[^\n]*|Timetable times[^\n]*)/) || [null])[0] });
      if (t > limit) return done({ ms: null, shellMs: shell, times: n });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), limitMs);
}
const report = { at: new Date().toISOString(), latencyMs: LAT, viewport: "390x844", screens: [] };
for (const [name, url] of screens) {
  const row = { screen: name };
  // 1. Nothing kept, slow server: the first open.
  let ctx = await context(); let page = await ctx.newPage();
  await clock(LAT);
  row.nothingKept = await firstTimes(page, url, LAT + 8000);
  await ctx.close();
  // 2. Kept copy: open once with a quick server and let it keep its copy, then open again with the server slow.
  ctx = await context(); page = await ctx.newPage();
  await clock(0);
  await firstTimes(page, url, 15000);
  await page.waitForTimeout(3000);
  await page.close();
  await clock(LAT);
  const runs = [];
  for (let i = 0; i < 3; i++) { page = await ctx.newPage(); runs.push(await firstTimes(page, url, LAT + 8000)); await page.close(); }
  const ms = runs.map((r) => r.ms).filter((x) => x != null).sort((a, c) => a - c);
  row.keptCopy = { medianMs: ms.length ? ms[Math.floor((ms.length - 1) / 2)] : null, runs };
  row.fromPhone = row.keptCopy.medianMs != null && row.keptCopy.medianMs < LAT;
  await ctx.close();
  report.screens.push(row);
}
await clock(0);
await b.close();
server.close();
fs.writeFileSync(out, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
process.exit(0);
